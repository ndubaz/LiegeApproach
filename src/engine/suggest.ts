import type { Sim } from './sim';
import type { Aircraft } from './types';
import type { Item } from './clearance';
import type { Level } from '../pack/load';
import { alongTrack, angDiff, crossTrack, dist, norm360 } from '../geo';
import { asCleared, bestTransition, predictedConflict, sequenceMembers, shortfall, slotFor, trackNm, TRANSITION_HORIZON_S, type Slot } from './sequence';

// Next-call suggestions: the one or two clearances an approach controller would
// most likely give this aircraft now, worked out from its phase and geometry.
// The game shows them as one-tap chips; the player still decides. A chip is
// marked primary only when it is safe as it stands: the transition only with a
// clear slot in the landing sequence, a climb or descent only through clear air.

export interface Suggestion {
  /** short chip label, e.g. "ALHUV1A · 3000 · ILS 22L" */
  label: string;
  items: Item[];
  /** one plain-English line on why */
  why: string;
  /** primary = the most likely call */
  primary?: boolean;
  /** sim.validate warnings for this suggestion */
  warn?: string[];
  /** intercom answer (release / MIL) rather than a radio call */
  icom?: boolean;
}

/** Round a heading to `step` degrees, 360 for north (5° by default; the fine dial uses 1°). */
export function roundHdg(h: number, step = 5): number {
  return (Math.round(norm360(h) / step) * step) % 360 || 360;
}
const mag = (sim: Sim, trueHdg: number, step = 5) => roundHdg(trueHdg - sim.pack.meta.magVar, step);
const p3 = (n: number) => String(Math.round(n) % 360 || 360).padStart(3, '0');
export const turnDir = (fromMag: number, toMag: number): 'L' | 'R' => (norm360(toMag - fromMag) <= 180 ? 'R' : 'L');
export const hdgItem = (sim: Sim, ac: Aircraft, toMag: number): Item => ({ k: 'hdg', hdg: toMag, dir: turnDir(norm360(ac.hdg - sim.pack.meta.magVar), toMag) });
const lvlLabel = (l: Level) => (l.fl !== undefined ? `FL${String(l.fl).padStart(3, '0')}` : `${l.ft}`);
const lvlWords = (l: Level) => (l.fl !== undefined ? lvlLabel(l) : `${l.ft!.toLocaleString('en-US')} ft`);

/** Valid levels for pickers and the ladder, highest first: flight levels from FL140 down to the transition level, then altitudes. */
export function levelList(sim: Sim, top = 140): Level[] {
  const out: Level[] = [];
  for (let fl = top; fl >= sim.tl; fl -= 10) out.push({ fl });
  for (const ft of [7000, 6000, 5000, 4500, 4000, 3500, 3000, 2500, 2000]) if (ft < sim.tl * 100 - 400) out.push({ ft });
  return out;
}

export { bestTransition };

/** Lowest level an arrival is given with a transition: the published 3,000 ft (never below the transition restrictions). */
const TRANS_FT = 3000;

/** A speed the aircraft can fly here: never below minimum clean speed until it is established (or within 15 NM). */
function spdFor(sim: Sim, ac: Aircraft, want: number): number {
  const established = !!ac.app?.locCap || sim.dthr(ac) < 15;
  const floor = established ? Math.max(ac.perf.vminFlap, 160) : ac.perf.vminClean;
  return Math.ceil(Math.max(want, floor) / 10) * 10;
}

/** Sim time of the last speed instruction to this aircraft (-Infinity when none). */
function lastSpeedT(sim: Sim, ac: Aircraft): number {
  for (let i = sim.cmdLog.length - 1; i >= 0; i--) {
    const c = sim.cmdLog[i];
    if (c.cl.cs === ac.cs && c.cl.items.some((x) => x.k === 'spd' || x.k === 'spdmin' || x.k === 'spdres')) return c.t;
  }
  return -Infinity;
}
/** Speed suggestions stay quiet for 90 s after a speed instruction, so the chips do not flip between two speeds. */
const SPEED_QUIET_S = 90;
const speedQuiet = (sim: Sim, ac: Aircraft) => sim.t - lastSpeedT(sim, ac) < SPEED_QUIET_S;
/** A new speed at least 10 kt below whatever it is already flying to (assigned, or its present speed). */
const worthSlowing = (ac: Aircraft, v: number) => v <= (ac.spdAssigned ?? Infinity) - 10 && v < ac.ias - 5;

/** Linear closest approach of two aircraft over the next `horizon` seconds. */
function cpa(a: Aircraft, b: Aircraft, horizon = 240): number {
  const v = (x: Aircraft) => ({ x: (Math.sin((x.trk * Math.PI) / 180) * x.gs) / 3600, y: (Math.cos((x.trk * Math.PI) / 180) * x.gs) / 3600 });
  const va = v(a), vb = v(b);
  let best = dist(a.p, b.p);
  for (let s = 10; s <= horizon; s += 10) best = Math.min(best, Math.hypot(a.p.x + va.x * s - b.p.x - vb.x * s, a.p.y + va.y * s - b.p.y - vb.y * s));
  return best;
}
/** Another aircraft in the way of a climb or descent from the current altitude to `toFt` in the next few minutes, if any. */
function pathBlocker(sim: Sim, ac: Aircraft, toFt: number, members?: Set<Aircraft>): Aircraft | undefined {
  const lo = Math.min(ac.alt, toFt) - 900, hi = Math.max(ac.alt, toFt) + 900;
  for (const o of sim.aircraft) {
    if (o === ac || o.remove || o.landed || o.rules === 'VFR' || o.state === 'unconcerned') continue;
    // the arrival sequence itself is spaced by the slot check, not here
    if (o.app?.locCap || members?.has(o)) continue;
    const oLo = Math.min(o.alt, o.tgtAlt), oHi = Math.max(o.alt, o.tgtAlt);
    if (oHi < lo || oLo > hi) continue;
    if (cpa(ac, o) < 5) return o;
  }
  return undefined;
}

/** The level the controller last gave (system CFL), which counts before the readback is in. */
const lvlFt = (sim: Sim, o: Aircraft) => sim.ftOf(o.cflSys ?? o.cleared);
/** The fix the aircraft is cleared to hold at, counting a hold instruction whose readback is still to come. */
function holdAtOf(sim: Sim, o: Aircraft): string | undefined {
  const h = (o as any)._holdAt as string | undefined;
  if (h) return h;
  if (!sim.readbackPending(o.cs)) return undefined;
  for (let i = sim.cmdLog.length - 1; i >= 0; i--) {
    const c = sim.cmdLog[i];
    if (c.cl.cs !== o.cs) continue;
    const it = c.cl.items.find((x) => x.k === 'hold') as { fix: string } | undefined;
    return it?.fix;
  }
  return undefined;
}

/** Arrivals that will hold at `fix` (holding, cleared to, or flying a STAR that ends there with no onward clearance). */
function stackOf(sim: Sim, fix: string, except?: Aircraft): Aircraft[] {
  return sim.aircraft.filter((o) => o !== except && !o.remove && o.kind === 'arr' && !o.app && (
    (o.mode === 'HOLD' && o.hold?.fix === fix) || holdAtOf(sim, o) === fix
    || (o.mode === 'NAV' && o.route.length > 0 && o.route[o.route.length - 1].fix === fix && dist(o.p, sim.fixP(fix)) < 25)));
}
const isHolder = (sim: Sim, o: Aircraft, fix: string) => (o.mode === 'HOLD' && o.hold?.fix === fix) || holdAtOf(sim, o) === fix;

/**
 * Free levels in the hold at `fix`: 1,000 ft clear of everyone else there, from 4,000 ft (and the published minimum)
 * up to the published maximum, never a climb. Empty when the stack is full.
 */
function stackLevels(sim: Sim, ac: Aircraft, fix: string): Level[] {
  const out: Level[] = [];
  const h = sim.pack.holds.find((x) => x.fix === fix);
  if (!h) return out;
  const others = stackOf(sim, fix, ac).map((o) => lvlFt(sim, o));
  const top = Math.min(sim.ftOf(h.max), sim.ftOf(ac.cleared) + 50);
  const near = dist(ac.p, sim.fixP(fix)) < 15;
  for (let ft = Math.max(4000, Math.ceil(sim.ftOf(h.min) / 1000) * 1000); ft <= top + 1; ft += 1000) {
    if (others.some((x) => Math.abs(x - ft) < 900)) continue;
    // close to the fix, do not descend through someone already holding there
    if (near && others.some((x) => x > ft && x < ac.alt - 300)) continue;
    out.push(sim.levelFor(ft));
  }
  return out;
}

/**
 * When the stack is full: the nearest other published hold (GIREL, GSY at Liège) with a free level inside its published band,
 * clear of anyone holding or passing there, outside any active or announced reserved area, and clear of traffic on the way.
 */
function remoteHold(sim: Sim, ac: Aircraft): { fix: string; lvl: Level } | undefined {
  const stacks = sim.stackFixes();
  const cands = sim.pack.holds.filter((h) => !stacks.includes(h.fix) && sim.pack.fixes.has(h.fix) && dist(ac.p, sim.fixP(h.fix)) < 50)
    .sort((a, b) => dist(ac.p, sim.fixP(a.fix)) - dist(ac.p, sim.fixP(b.fix)));
  for (const h of cands) {
    const fix = h.fix, fp = sim.fixP(fix);
    const there = sim.aircraft.filter((o) => o !== ac && !o.remove && !o.landed && o.rules !== 'VFR' && ((o.mode === 'HOLD' && o.hold?.fix === fix) || holdAtOf(sim, o) === fix
      || dist(o.p, fp) < 12 || (o.mode === 'NAV' && o.route.some((l) => l.fix === fix) && dist(o.p, fp) < 30))).map((o) => lvlFt(sim, o));
    const nom = (l: Level) => (l.fl !== undefined ? l.fl * 100 : l.ft!);
    const lo = nom(h.min), hi = Math.min(nom(h.max), nom(ac.cleared) + 50);
    // stay as high as possible: the fewest level changes, and out of the way of the traffic below
    for (let n = Math.floor(hi / 1000) * 1000; n >= lo; n -= 1000) {
      const lvl = Math.abs(n - nom(ac.cleared)) < 300 ? ac.cleared : sim.levelFor(n);
      const ft = sim.ftOf(lvl);
      if (there.some((x) => Math.abs(x - ft) < 900)) continue;
      if (sim.tsaOnPath(ac, [{ k: 'dct', fix }, { k: 'lvl', lvl }])) break;
      if (predictedConflict(sim, ac, (c) => { c.tgtAlt = sim.ftOf(lvl); c.route = [{ fix, p: fp }]; c.mode = 'NAV'; (c as any)._holdAt = fix; }, TRANSITION_HORIZON_S)) continue;
      return { fix, lvl };
    }
  }
  return undefined;
}

const slotWhy = (s: Slot) => (s.leader ? `#${s.pos} to land, ${s.gapNm!.toFixed(1)} NM behind ${s.leader.cs}` : `#${s.pos} to land, nobody ahead`);

export function suggest(sim: Sim, ac: Aircraft): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => { if (out.length < 4 && !out.some((o) => o.label === s.label)) out.push(s); };
  // after a runway change, anyone not established is worked onto the new runway
  const exp = ac.app?.locCap ? ac.app.rwy.id : ac.expectRwy;
  const rw = (exp && exp.slice(0, 2) === sim.runway.slice(0, 2) ? sim.pack.runways.get(exp) : undefined) ?? (ac.app?.locCap ? ac.app.rwy : sim.rwy);
  const crsMag = mag(sim, rw.crs);
  const curMag = norm360(ac.hdg - sim.pack.meta.magVar);
  const ifLvl = sim.levelFor(rw.ifAlt);
  const ils: Item = { k: 'app', app: rw.ils && !sim.ilsOut.has(rw.id) ? 'ILS' : 'RNP', rwy: rw.id };
  const appName = `${(ils as any).app} ${rw.id}`;
  const clearedFt = sim.ftOf(ac.cleared);
  const sameAsCleared = (l: Level) => l.fl === ac.cleared.fl && l.ft === ac.cleared.ft;

  // 1. wrong readback: say it again, correctly
  if (ac.wrong) {
    if (ac.wrong.item.k === 'lvl' && ac.cflSys) add({ label: `Negative · ${lvlLabel(ac.cflSys)}`, items: [{ k: 'lvl', lvl: ac.cflSys }], why: `The pilot read back ${lvlLabel((ac.wrong.item as any).lvl)}. Say the level again.`, primary: true });
    else if (ac.wrong.item.k === 'hdg' && ac.hdgSys !== undefined) { const h = mag(sim, ac.hdgSys); add({ label: `Negative · H${p3(h)}`, items: [hdgItem(sim, ac, h)], why: 'The pilot read back the wrong heading. Say it again.', primary: true }); }
  }
  // a readback is still to come: nothing new until the pilot has answered (a correction is fine)
  if (sim.readbackPending(ac.cs)) return finish(sim, ac, out);

  // 1b. the crew queried a big turn: confirm it, or give the short way round
  if (ac.turnQuery) {
    const q = ac.turnQuery;
    const other = q.dir === 'L' ? 'R' : 'L';
    add({ label: `Affirm · ${q.dir}${p3(q.hdg)}`, items: [{ k: 'hdg', hdg: q.hdg, dir: q.dir }], why: `The pilot asks you to confirm the ${q.dir === 'L' ? 'left' : 'right'} turn. Say it again to confirm.`, primary: true });
    add({ label: `${other}${p3(q.hdg)}`, items: [{ k: 'hdg', hdg: q.hdg, dir: other }], why: 'Or turn it the short way.' });
  }

  // 2. requests
  const rq = ac.request;
  if (rq && ac.state === 'assumed') {
    if (rq.kind === 'climb' && rq.level) {
      const blk = pathBlocker(sim, ac, sim.ftOf(rq.level));
      add({ label: `Climb ${lvlLabel(rq.level)}`, items: [{ k: 'lvl', lvl: rq.level }], why: blk ? `Wait: ${blk.cs} is in the way.` : rq.text, primary: !blk });
    } else if (rq.kind === 'direct' && rq.fix) add({ label: `Direct ${rq.fix}`, items: [{ k: 'dct', fix: rq.fix }], why: rq.text, primary: true });
    else if (rq.kind === 'vectors' && ac.app && !ac.app.tooHigh && !ac.app.locCap) {
      // cleared for the ILS but cannot intercept from where it is: a 30° intercept heading
      const xt = crossTrack(ac.p, rw.thr, rw.crs);
      const h = roundHdg(crsMag - 30 * (Math.sign(xt) || 1));
      add({ label: `Intercept ${turnDir(curMag, h)}${p3(h)}`, items: [hdgItem(sim, ac, h)], why: `${Math.abs(xt).toFixed(1)} NM off the centreline. 30° to the final course so the localizer captures.`, primary: true });
    } else if (rq.kind === 'vectors') {
      const away = norm360(crsMag + 180);
      const items: Item[] = [{ k: 'brk' }, hdgItem(sim, ac, away)];
      const l3 = sim.levelFor(3000);
      if (!sameAsCleared(l3)) items.push({ k: 'lvl', lvl: l3 });
      add({ label: `Break off · H${p3(away)}${sameAsCleared(l3) ? '' : ' · 3000'}`, items, why: ac.app?.tooHigh ? 'Too high for the glide. Take it off the approach and bring it round again.' : 'It asks for vectors. Take it off the approach and bring it round again.', primary: true });
    } else add({ label: 'Approve', items: [{ k: 'appr' }], why: rq.text, primary: true });
    add({ label: 'Unable', items: [{ k: 'deny' }], why: 'Refuse the request.' });
  }
  if (ac.atisOld) add({ label: `ATIS ${sim.atis} current`, items: [{ k: 'atis' }], why: 'The pilot has an old ATIS. Give the current letter and QNH.' });
  if (ac.state !== 'assumed' || ac.radioFail) return finish(sim, ac, out);

  if (ac.kind === 'arr') arrival(sim, ac, add, { rw, crsMag, curMag, ifLvl, ils, appName, clearedFt, sameAsCleared });
  else if (ac.kind === 'dep' || ac.kind === 'mil' || ac.kind === 'ovf') {
    const xfl = sim.depXfl;
    if (ac.kind === 'dep' && clearedFt < sim.ftOf(xfl) - 50) {
      const blk = pathBlocker(sim, ac, sim.ftOf(xfl));
      add({ label: `Climb ${lvlLabel(xfl)}`, items: [{ k: 'lvl', lvl: xfl }], why: blk ? `Wait: ${blk.cs} is in the way.` : 'Top of your airspace. Nothing is in the way.', primary: ac.alt > 3000 && !blk });
    }
    const r0 = dist(ac.p, { x: 0, y: 0 });
    const R = sim.pack.meta.sectorRadiusNm;
    const to = ac.kind === 'mil' ? sim.mil : sim.acc;
    if (r0 > R * 0.45 || ac.alt > 7000) add({ label: ac.kind === 'mil' ? 'Military' : to.say, items: [{ k: 'xfr', unit: to.id }], why: `Hand it on before it leaves the ${R} NM ring.`, primary: r0 > R * 0.625 });
  }
  // a call with nothing else to say yet: acknowledge it
  if (ac.awaitingSince !== undefined) {
    const first = ac.txCount === 0;
    add({ label: first ? 'Identified' : 'Roger', items: [{ k: 'roger' }], why: first ? 'Answer the check-in now and plan the next instruction.' : 'Acknowledge the call.', primary: !out.some((s) => s.primary) });
  }
  return finish(sim, ac, out);
}

interface ArrCtx {
  rw: Sim['rwy']; crsMag: number; curMag: number; ifLvl: Level; ils: Item; appName: string; clearedFt: number; sameAsCleared: (l: Level) => boolean;
}

function arrival(sim: Sim, ac: Aircraft, add: (s: Suggestion) => void, c: ArrCtx) {
  const { rw, crsMag, curMag, ils, appName, clearedFt, sameAsCleared } = c;
  /** the stack fix this arrival is heading for (ALHUV at Liège) */
  const SF = sim.stackFixOf(ac, rw.id);
  const stacks = sim.stackFixes(rw.id);
  // runway change: still on the old runway's STAR or cleared for its approach
  if (!ac.app?.locCap && sim.needReclear().includes(ac)) {
    const st = ac.proc ? sim.mapStar(ac.proc, sim.runway) : undefined;
    if (st && ac.mode === 'NAV' && ac.route.some((l) => stacks.includes(l.fix))) {
      add({ label: `Runway ${sim.runway} · ${st.name}`, items: [{ k: 'star', name: st.name }], why: `Runway changed to ${sim.runway}. Re-clear it via the ${st.name} arrival.`, primary: true });
      return;
    }
    if (ac.app) {
      // cleared for the old runway's approach: the new transition if it fits, otherwise off the approach and into the hold
      const tr = bestTransition(sim, ac);
      const slot = tr ? slotFor(sim, ac, tr) : undefined;
      const blk = tr && slot?.ok ? predictedConflict(sim, ac, asCleared(sim, tr.name, undefined, rw.id), TRANSITION_HORIZON_S)?.with : undefined;
      const go = !!tr && !!slot?.ok && !blk;
      if (tr) add({ label: `${tr.name} · ${appName}`, items: [{ k: 'trans', name: tr.name }, ils], why: go ? `Runway changed to ${sim.runway}: new transition and approach. ${slotWhy(slot!)}.` : blk ? `Wait: ${blk.cs} is in the way.` : `No gap yet: ${slot?.clash?.cs ?? 'the sequence'} is too close.`, primary: go });
      add({ label: `Break off · Hold ${SF}`, items: [{ k: 'brk' }, { k: 'hold', fix: SF }], why: `Runway changed to ${sim.runway}. Take it off the old approach and hold it until there is a slot.`, primary: !go });
      return;
    }
    // holding or on vectors: the usual calls below, now for the new runway
  }
  // runway change announced: anyone who would land after it waits for the new runway
  const chg = sim.rwyChange;
  const late = (etaS: number) => !!chg && chg.to.slice(0, 2) !== rw.id.slice(0, 2) && sim.t + etaS > chg.at - 60;
  const lateWhy = chg ? `Runway change to ${chg.to} at ${sim.utc(chg.at).slice(0, 5).replace(':', '')}: it would land after it. Keep it at ${SF} until then.` : ''
  const d = sim.dthr(ac);
  const xt = crossTrack(ac.p, rw.thr, rw.crs);
  const along = alongTrack(ac.p, rw.thr, norm360(rw.crs + 180));
  const transLvl = sim.levelFor(Math.max(TRANS_FT, rw.ifAlt));
  const lvlTo = (l: Level): Item[] => (sim.ftOf(l) < clearedFt - 50 ? [{ k: 'lvl', lvl: l }] : []);
  const lvlTag = (l: Level) => (sim.ftOf(l) < clearedFt - 50 ? ` · ${lvlLabel(l)}` : '');

  if (ac.app?.locCap) {
    if (ac.app.tooHigh) return;
    add({ label: 'Tower', items: [{ k: 'xfr', unit: sim.twr.id }], why: 'Established on the localizer. Hand it to Tower.', primary: d < 14 });
    if (ac.ias > 175 && d > 5 && worthSlowing(ac, 160) && !speedQuiet(sim, ac)) add({ label: '160 to 4 · Tower', items: [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: sim.twr.id }], why: 'Slow it for a stable approach and hand it over in one call.' });
    return;
  }

  // MAYDAY: the shortest way in, straight to the final, not round a transition or into the hold
  if (ac.emergency && ac.emergency !== 'radio' && !ac.app) {
    const ifFix = rw.ifFix;
    const l = sim.levelFor(Math.max(TRANS_FT, rw.ifAlt));
    add({ label: `Direct ${ifFix}${lvlTag(l)} · ${appName}`, items: [{ k: 'dct', fix: ifFix }, ...lvlTo(l), ils], why: `${ac.emergencyText ?? 'Emergency'}: the shortest way to the final, everyone else makes room.`, primary: true });
    if (ac.mode === 'HDG' && Math.abs(xt) < 4.5 && along > 6) {
      const h = roundHdg(crsMag - 30 * (Math.sign(xt) || 1));
      add({ label: `${turnDir(curMag, h)}${p3(h)} · ${appName}`, items: [hdgItem(sim, ac, h), ...lvlTo(l), ils], why: 'Already close to the final: 30° intercept and the approach.' });
    }
    return;
  }

  if (ac.mode === 'HOLD') {
    const fix = ac.hold?.fix ?? SF;
    const tr = bestTransition(sim, ac);
    const slot = slotFor(sim, ac, tr);
    // lowest first in its own stack, and the stack at the transition fix before anyone holding further out
    const lower = sim.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && !o.app && (isHolder(sim, o, fix) ? lvlFt(sim, o) < clearedFt - 50 : fix !== SF && isHolder(sim, o, SF)));
    const blk0 = pathBlocker(sim, ac, sim.ftOf(transLvl), new Set(sequenceMembers(sim)));
    const blk = blk0 ?? (slot.ok && !lower.length ? predictedConflict(sim, ac, asCleared(sim, tr?.name, sim.ftOf(transLvl), rw.id), TRANSITION_HORIZON_S)?.with : undefined);
    const ok = slot.ok && !lower.length && !blk && !late(slot.etaS);
    const why = late(slot.etaS) ? lateWhy : lower.length ? `Release the lowest first: ${lower[0].cs} is below it.` : blk ? `Wait: ${blk.cs} is in the way down.` : slot.ok ? `${slotWhy(slot)}.` : `No gap yet: ${slot.clash?.cs ?? 'the sequence'} is too close. About ${Math.max(1, Math.round(slot.waitS / 60))} min.`;
    add({ label: `Leave hold · ${tr?.name ?? ''}${lvlTag(transLvl)} · ${appName}`, items: [...(tr ? [{ k: 'trans', name: tr.name } as Item] : []), ...lvlTo(transLvl), ils], why, primary: ok });
    stackDescend(sim, ac, fix, clearedFt, add, !ok);
    // a revised expected approach time, only when it moves by 5 minutes or more
    if (!ok) {
      const e = sim.efcFor(ac, fix);
      const hh = (t: number) => sim.utc(t).slice(0, 5).replace(':', '');
      const moved = ac.efc !== undefined ? Math.abs(e.t - ac.efc) >= 300 : e.say !== null && e.t - sim.t >= 300;
      if (moved && e.say) add({ label: `EAT ${e.say}`, items: [{ k: 'eat' }], why: ac.efc !== undefined ? `Its expected approach time ${hh(ac.efc)} is out of date. Give the revised time.` : 'The delay has grown. Give it an expected approach time.', primary: ac.efc !== undefined && sim.t >= ac.efc - 30 });
    }
    return;
  }

  if (ac.app && !ac.app.locCap) {
    if (ac.mode === 'HDG' && Math.abs(xt) > 0.6 && Math.abs(angDiff(curMag, crsMag)) > 50) {
      const h = roundHdg(crsMag - 30 * Math.sign(xt));
      add({ label: `Intercept ${turnDir(curMag, h)}${p3(h)}`, items: [hdgItem(sim, ac, h)], why: '30° to the final course so the localizer captures cleanly.', primary: Math.abs(xt) < 3 });
    }
    speedForSpacing(sim, ac, add);
    if (ac.ias > 200 && d < 18 && !speedQuiet(sim, ac)) { const s = spdFor(sim, ac, 180); if (worthSlowing(ac, s)) add({ label: `Speed ${s}`, items: [{ k: 'spd', spd: s }], why: 'Slow it before the localizer.' }); }
    return;
  }

  if (ac.mode === 'HDG') {
    const s = Math.sign(xt) || 1;
    const intercept = roundHdg(crsMag - 30 * s);
    const towards = Math.sin(((ac.hdg - rw.crs) * Math.PI) / 180) * s < 0; // closing the centreline
    if (Math.abs(xt) < 4.5 && along > 6 && (towards || Math.abs(angDiff(curMag, crsMag)) < 100)) {
      const items: Item[] = [hdgItem(sim, ac, intercept), ils];
      if (ac.tgtAlt > rw.ifAlt + 300) items.splice(1, 0, { k: 'lvl', lvl: c.ifLvl });
      const sf = shortfall(sim, ac);
      const tight = sf.shortS > 0;
      add({ label: `${turnDir(curMag, intercept)}${p3(intercept)} · ${appName}`, items, why: tight ? `Too close behind ${sf.leader!.cs} (${sf.gapNm!.toFixed(1)} NM, needs ${sf.needNm} NM). Extend first.` : `${Math.abs(xt).toFixed(1)} NM from the centreline. 30° intercept and approach clearance.`, primary: Math.abs(xt) < 3 && !tight });
    }
    const downwind = norm360(crsMag + 180);
    if (along > 10 && Math.abs(angDiff(curMag, downwind)) < 40 && Math.abs(xt) > 3) {
      const base = roundHdg(crsMag - 90 * s);
      const sf = shortfall(sim, ac);
      add({ label: `Base ${turnDir(curMag, base)}${p3(base)}`, items: [hdgItem(sim, ac, base)], why: sf.shortS > 0 ? `Not yet: ${sf.leader!.cs} is too close ahead.` : `${along.toFixed(0)} NM out along the final. Turn base.`, primary: along > 11 && !(sf.shortS > 0) });
    }
    if (along < 6 && Math.abs(xt) > 2 && Math.abs(angDiff(curMag, downwind)) > 40) add({ label: `Downwind ${turnDir(curMag, downwind)}${p3(downwind)}`, items: [hdgItem(sim, ac, downwind)], why: 'Too close in to turn onto final. Take it out on a downwind.' });
  }

  // on a STAR: the low-workload transition when there is a slot, otherwise the hold or a slower speed
  if (ac.mode === 'NAV' && !ac.app) {
    const tr = bestTransition(sim, ac);
    const myHold = holdAtOf(sim, ac);
    const transFt = sim.ftOf(transLvl);
    // the stack goes first, lowest first: anyone holding below this aircraft's level. The transitions start at the stack
    // fix at 3,000 ft, so nobody is sent down one while another aircraft holds at the bottom of that stack.
    const holders = sim.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && !o.app && (o.mode === 'HOLD' || !!holdAtOf(sim, o))
      && (lvlFt(sim, o) < clearedFt - 50 || (isHolder(sim, o, SF) && lvlFt(sim, o) < transFt + 950)));
    const slot = slotFor(sim, ac, tr);
    const blk0 = pathBlocker(sim, ac, sim.ftOf(transLvl), new Set(sequenceMembers(sim)));
    const blk = blk0 ?? (slot.ok && !holders.length && tr ? predictedConflict(sim, ac, asCleared(sim, tr.name, sim.ftOf(transLvl), rw.id), TRANSITION_HORIZON_S)?.with : undefined);
    const ok = slot.ok && !holders.length && !blk && !late(slot.etaS);
    if (tr) {
      const why = late(slot.etaS) ? lateWhy : holders.length ? `${holders.length} already holding at ${SF}: they go first.` : blk ? `Wait: ${blk.cs} is in the way down.` : slot.ok ? `${slotWhy(slot)}. Transition, ${lvlWords(transLvl)} and the approach: it flies to final by itself.` : `No gap: ${slot.clash?.cs ?? 'the sequence'} would be too close. About ${Math.max(1, Math.round(slot.waitS / 60))} min to wait.`;
      add({ label: `${tr.name}${lvlTag(transLvl)} · ${appName}`, items: [{ k: 'trans', name: tr.name }, ...lvlTo(transLvl), ils], why, primary: ok });
    }
    // already told to hold: no second hold instruction, only the way down into the stack
    if (!ok && myHold) stackDescend(sim, ac, myHold, clearedFt, add, true);
    if (!ok && !myHold && ac.route[ac.route.length - 1]?.fix === SF) {
      // the lowest free level in the stack that it can reach without meeting anyone on the way
      const cands = stackLevels(sim, ac, SF);
      const members = new Set(sequenceMembers(sim));
      let sl: Level | undefined, blkS: Aircraft | undefined;
      for (const l of cands) {
        const ft = sim.ftOf(l);
        const b = (ft < ac.alt - 300 ? pathBlocker(sim, ac, ft, members) : undefined) ?? predictedConflict(sim, ac, (c) => { c.tgtAlt = ft; (c as any)._holdAt = SF; })?.with;
        if (!b) { sl = l; blkS = undefined; break; }
        if (!sl) { sl = l; blkS = b; }
      }
      if (sl) {
        const why = holders.length ? `${holders.length} holding ahead of it. Join the stack at ${lvlWords(sl)}.` : `No gap in the sequence yet. Hold at ${lvlWords(sl)} until there is one.`;
        add({ label: `Hold ${SF}${lvlTag(sl)}`, items: [{ k: 'hold', fix: SF }, ...lvlTo(sl)], why: blkS ? `Wait: ${blkS.cs} is in the way down.` : why, primary: !blkS });
      }
      if (!sl || blkS) {
        // the stack is full: another published hold (GIREL, GSY at Liège) at a level inside its band
        const remote = remoteHold(sim, ac);
        // slowing down must not bring the one behind onto it
        const myNm = trackNm(sim, ac);
        const slowHit = !remote && !ac.spdMin && ac.spdAssigned === undefined ? predictedConflict(sim, ac, (c) => { c.spdMin = true; })?.with : undefined;
        const slowBlk = slowHit && slowHit.kind === 'arr' && trackNm(sim, slowHit) > myNm ? slowHit : undefined;
        if (remote) add({ label: `Hold ${remote.fix} · ${lvlLabel(remote.lvl)}`, items: [{ k: 'hold', fix: remote.fix }, ...lvlTo(remote.lvl)], why: `The ${SF} stack is full. Hold it at ${remote.fix}, ${lvlWords(remote.lvl)}, for now.`, primary: true });
        else if (!ac.spdMin && ac.spdAssigned === undefined) add({ label: 'Min clean speed', items: [{ k: 'spdmin' }], why: slowBlk ? `The ${SF} stack is full, but ${slowBlk.cs} is close behind: slowing it would close the gap.` : `The ${SF} stack is full. Slow it down to buy time.`, primary: !slowBlk });
      }
    }
    const step = levelList(sim).find((l) => sim.ftOf(l) <= clearedFt - 1900 && sim.ftOf(l) >= sim.mvaAt(ac.p) + 500);
    if (step && d < 30) add({ label: `Descend ${lvlLabel(step)}`, items: [{ k: 'lvl', lvl: step }], why: 'Keep it coming down: about 3 NM per 1,000 ft.' });
  }
  if (ac.mode === 'HDG' && ac.tgtAlt > rw.ifAlt + 300) {
    const mva = sim.mvaAt(ac.p);
    const lv = levelList(sim).find((l) => sim.ftOf(l) <= ac.tgtAlt - 900 && sim.ftOf(l) >= Math.max(mva, rw.ifAlt));
    if (lv) add({ label: `Descend ${lvlLabel(lv)}`, items: [{ k: 'lvl', lvl: lv }], why: `Minimum vectoring altitude here is ${mva} ft.` });
  }
  if (ac.ias > 230 && d < 25 && !ac.spdAssigned && !speedQuiet(sim, ac)) { const s = spdFor(sim, ac, 210); if (worthSlowing(ac, s)) add({ label: `Speed ${s}`, items: [{ k: 'spd', spd: s }], why: 'Slow it to make the sequence work.' }); }
}

/** Cleared to hold at `fix` above its published top: down into the stack, without passing anyone holding below. */
function stackDescend(sim: Sim, ac: Aircraft, fix: string, clearedFt: number, add: (s: Suggestion) => void, primary: boolean) {
  const hold = sim.pack.holds.find((h) => h.fix === fix);
  if (!hold || clearedFt <= sim.ftOf(hold.max) + 50) return;
  const others = stackOf(sim, fix, ac).map((o) => lvlFt(sim, o));
  let target: Level | undefined;
  for (let ft = Math.min(Math.floor((clearedFt - 200) / 1000) * 1000, Math.floor((sim.ftOf(hold.max) + 50) / 1000) * 1000); ft >= Math.max(4000, sim.ftOf(hold.min) - 50); ft -= 1000) {
    if (others.some((x) => Math.abs(x - ft) < 900)) break;
    target = sim.levelFor(ft);
    break;
  }
  if (target) add({ label: `Descend ${lvlLabel(target)}`, items: [{ k: 'lvl', lvl: target }], why: `Into the ${fix} stack, at or below its top (${lvlWords(hold.max)}), clear of the others holding there.`, primary });
}

/** In the sequence and closing on the one ahead: a slower speed, as the primary call. */
function speedForSpacing(sim: Sim, ac: Aircraft, add: (s: Suggestion) => void) {
  const sf = shortfall(sim, ac);
  if (!(sf.shortS > 0) || !sf.leader) return;
  const want = spdFor(sim, ac, Math.min(ac.ias, sf.leader.ias) - 20);
  if (!worthSlowing(ac, want)) return;
  // just slowed: give it time to work, unless the gap is still closing well below the minimum
  if (speedQuiet(sim, ac) && sf.shortS < 20) return;
  add({ label: `Speed ${want}`, items: [{ k: 'spd', spd: want }], why: `${sf.gapNm!.toFixed(1)} NM behind ${sf.leader.cs}, needs ${sf.needNm} NM. Slow it down.`, primary: true });
}

function finish(sim: Sim, ac: Aircraft, out: Suggestion[]) {
  for (const s of out) s.warn = s.items.some((i) => i.k === 'appr' || i.k === 'deny' || i.k === 'brk') ? [] : sim.validate({ cs: ac.cs, items: s.items });
  // the primary first; never more than one primary
  out.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  out.forEach((s, i) => { if (i > 0) s.primary = false; });
  return out;
}

/**
 * Advice for a departure release request: release now, release with a climb only to 1,000 ft below the lowest
 * traffic holding or descending over the field, or hold it on the ground. The UI can light up the matching button.
 */
export function releaseAdvice(sim: Sim, cs: string): { ok: boolean; items: Item[]; why: string; gap?: string } {
  let r = releaseAdvice0(sim);
  // RECAT-EU departure wake minimum behind the last departure: Tower waits it out after the release
  const wk = sim.depWakeWait(cs);
  if (r.ok && wk.s > 0) r = { ...r, why: `${r.why} Tower then waits ${wk.s} s for wake behind ${wk.behind ?? 'the last departure'}.` };
  try { return { ...r, gap: sim.departureGap(cs).text }; } catch { return r; }
}
function releaseAdvice0(sim: Sim): { ok: boolean; items: Item[]; why: string } {
  // after a runway change, the last arrivals to the old runway land first
  // the departure runway: an arrival landing the other way on its strip, or short final on it, holds the release
  const dep = sim.depRunway;
  const opp = sim.aircraft.find((a) => !a.remove && !a.landed && a.app?.locCap && sim.sameStrip(a.app.rwy.id, dep) && a.app.rwy.id.slice(0, 2) !== dep.slice(0, 2));
  if (opp) return { ok: false, items: [{ k: 'relhold', mins: 3 }], why: `${opp.cs} is still landing on ${opp.app!.rwy.id}, the other way. Hold it until it is down.` };
  const short = sim.aircraft.find((a) => !a.remove && !a.landed && a.app?.locCap && a.app.rwy.id === dep && sim.dthr(a) < 6);
  if (short) return { ok: false, items: [{ k: 'relhold', mins: 2 }], why: `${short.cs} is on short final. Hold it for now.` };
  const over = sim.aircraft.filter((a) => !a.remove && !a.landed && a.kind !== 'dep' && a.rules !== 'VFR' && !a.app?.locCap
    && Math.hypot(a.p.x, a.p.y) < 10 && Math.min(a.alt, a.tgtAlt) < 7500 && Math.max(a.alt, a.tgtAlt) > 2000);
  // arrivals about to cross the field low on their way through a stack fix over the field (ALHUV at Liège), where the SIDs climb out
  const nearField = sim.stackFixes().filter((f) => dist(sim.fixP(f), { x: 0, y: 0 }) < 8);
  const coming = nearField.length ? sim.aircraft.find((a) => !a.remove && !a.landed && a.kind === 'arr' && !a.app?.locCap && !over.includes(a)
    && nearField.some((f) => (a.route.some((l) => l.fix === f) || (a as any)._holdAt === f) && dist(a.p, sim.fixP(f)) < 12) && Math.min(a.alt, a.tgtAlt) < 5000) : undefined;
  if (coming && !over.length) return { ok: false, items: [{ k: 'relhold', mins: 2 }], why: `${coming.cs} is about to cross the field at ${Math.round(Math.min(coming.alt, coming.tgtAlt) / 100) * 100} ft, where the departure climbs. Hold it for now.` };
  if (!over.length) return { ok: true, items: [{ k: 'rel' }], why: 'Nothing over the field. Release it.' };
  const low = Math.min(...over.map((a) => Math.min(a.alt, a.tgtAlt)));
  if (low >= 3900) {
    const cap = sim.levelFor(Math.floor((low - 1000) / 1000) * 1000);
    return { ok: true, items: [{ k: 'rel', lvl: cap }], why: `Traffic over the field from ${Math.round(low / 100) * 100} ft. Release it climbing to ${lvlWords(cap)} only.` };
  }
  return { ok: false, items: [{ k: 'relhold', mins: 3 }], why: `${over.find((a) => Math.min(a.alt, a.tgtAlt) === low)!.cs} is low over the field. Hold it for now.` };
}

/**
 * Advice for the centre's early-transfer request: take it if nothing in the sector is within 1,000 ft of the offered
 * level near where it will enter, and the stack is not already busy; otherwise keep the agreed level.
 */
export function coordAdvice(sim: Sim, cs: string): { ok: boolean; items: Item[]; why: string } | undefined {
  const r = sim.coordReqs.find((x) => x.cs === cs && x.state === 'pending');
  if (!r) return undefined;
  const est = sim.estimates.find((e) => e.cs === cs);
  const fixP = est && sim.pack.fixes.has(est.fix) ? sim.fixP(est.fix) : undefined;
  const ft = sim.ftOf(r.level);
  const near = sim.aircraft.find((a) => !a.remove && !a.landed && a.rules !== 'VFR' && a.state !== 'unconcerned' && Math.abs(Math.max(a.alt, a.tgtAlt) - ft) < 1000
    && (!fixP || dist(a.p, fixP) < 20));
  const holding = sim.aircraft.filter((a) => !a.remove && a.mode === 'HOLD').length;
  if (near) return { ok: false, items: [{ k: 'deny' }], why: `${near.cs} is near ${lvlWords(r.level)} where it would come in. Keep it at the agreed level.` };
  if (holding >= 3) return { ok: false, items: [{ k: 'deny' }], why: `${holding} already holding. Taking it early only adds to the stack.` };
  return { ok: true, items: [{ k: 'appr' }], why: `Nothing near ${lvlWords(r.level)} on its way in. Taking it early saves it a level-off.` };
}
