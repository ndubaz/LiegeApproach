import type { Sim } from './sim';
import type { Aircraft } from './types';
import type { Item } from './clearance';
import type { Level } from '../pack/load';
import { alongTrack, angDiff, crossTrack, dist, norm360 } from '../geo';
import { asCleared, bestTransition, predictedConflict, sequenceMembers, shortfall, slotFor, type Slot } from './sequence';

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

/** Highest level the suggestions stack an ALHUV hold to when the published levels are full (the crew will ask for lower). */
const STACK_TOP_FT = 9000;
/**
 * A free level in the hold at `fix` (1,000 ft clear of everyone else there, from 4,000 ft up, never a climb), or undefined when the stack is full.
 * Above the published maximum only when every published level is taken: a higher, warned hold beats two aircraft at one level.
 */
function stackLevels(sim: Sim, ac: Aircraft, fix: string): Level[] {
  const out: Level[] = [];
  const h = sim.pack.holds.find((x) => x.fix === fix);
  if (!h) return out;
  const others = stackOf(sim, fix, ac).map((o) => lvlFt(sim, o));
  const top = Math.min(Math.max(sim.ftOf(h.max), STACK_TOP_FT), sim.ftOf(ac.cleared) + 50);
  const near = dist(ac.p, sim.fixP(fix)) < 15;
  for (let ft = Math.max(4000, Math.ceil(sim.ftOf(h.min) / 1000) * 1000); ft <= top + 1; ft += 1000) {
    if (others.some((x) => Math.abs(x - ft) < 900)) continue;
    // close to the fix, do not descend through someone already holding there
    if (near && others.some((x) => x > ft && x < ac.alt - 300)) continue;
    out.push(sim.levelFor(ft));
  }
  return out;
}

/** A hold at the STAR fix before ALHUV, at a level 1,000 ft clear of anyone else holding or heading there, for when ALHUV is full. */
function remoteHold(sim: Sim, ac: Aircraft): { fix: string; lvl: Level } | undefined {
  const fix = ac.route.length >= 2 ? ac.route[ac.route.length - 2].fix : undefined;
  if (!fix || !sim.pack.fixes.has(fix) || dist(ac.p, sim.fixP(fix)) < 4) return undefined;
  const there = sim.aircraft.filter((o) => o !== ac && !o.remove && ((o.mode === 'HOLD' && o.hold?.fix === fix) || holdAtOf(sim, o) === fix
    || (o.mode === 'NAV' && o.route.some((l) => l.fix === fix) && dist(o.p, sim.fixP(fix)) < 15))).map((o) => lvlFt(sim, o));
  const cl = sim.ftOf(ac.cleared);
  for (let ft = Math.round(cl / 1000) * 1000; ft >= 6000; ft -= 1000) {
    if (there.some((x) => Math.abs(x - ft) < 900)) continue;
    const lvl = ft >= cl - 300 ? ac.cleared : sim.levelFor(ft);
    if (predictedConflict(sim, ac, (c) => { c.tgtAlt = sim.ftOf(lvl); c.route = c.route.slice(0, c.route.findIndex((l) => l.fix === fix) + 1); (c as any)._holdAt = fix; })) continue;
    return { fix, lvl };
  }
  return undefined;
}

const slotWhy = (s: Slot) => (s.leader ? `#${s.pos} to land, ${s.gapNm!.toFixed(1)} NM behind ${s.leader.cs}` : `#${s.pos} to land, nobody ahead`);

export function suggest(sim: Sim, ac: Aircraft): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => { if (out.length < 4 && !out.some((o) => o.label === s.label)) out.push(s); };
  const rw = sim.pack.runways.get(ac.expectRwy ?? sim.runway) ?? sim.rwy;
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
    if (ac.kind === 'dep' && clearedFt < sim.ftOf({ fl: 90 }) - 50) {
      const blk = pathBlocker(sim, ac, sim.ftOf({ fl: 90 }));
      add({ label: 'Climb FL090', items: [{ k: 'lvl', lvl: { fl: 90 } }], why: blk ? `Wait: ${blk.cs} is in the way.` : 'Top of your airspace. Nothing is in the way.', primary: ac.alt > 3000 && !blk });
    }
    const r0 = dist(ac.p, { x: 0, y: 0 });
    if (r0 > 18 || ac.alt > 7000) add({ label: 'Brussels', items: [{ k: 'xfr', unit: ac.kind === 'mil' ? 'MIL' : 'BRU' }], why: 'Hand it on before it leaves the 40 NM ring.', primary: r0 > 25 });
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
  const d = sim.dthr(ac);
  const xt = crossTrack(ac.p, rw.thr, rw.crs);
  const along = alongTrack(ac.p, rw.thr, norm360(rw.crs + 180));
  const transLvl = sim.levelFor(Math.max(TRANS_FT, rw.ifAlt));
  const lvlTo = (l: Level): Item[] => (sim.ftOf(l) < clearedFt - 50 ? [{ k: 'lvl', lvl: l }] : []);
  const lvlTag = (l: Level) => (sim.ftOf(l) < clearedFt - 50 ? ` · ${lvlLabel(l)}` : '');

  if (ac.app?.locCap) {
    if (ac.app.tooHigh) return;
    add({ label: 'Tower', items: [{ k: 'xfr', unit: 'TWR' }], why: 'Established on the localizer. Hand it to Tower.', primary: d < 14 });
    if (ac.ias > 175 && d > 5) add({ label: '160 to 4 · Tower', items: [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: 'TWR' }], why: 'Slow it for a stable approach and hand it over in one call.' });
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
    const fix = ac.hold?.fix ?? 'ALHUV';
    const tr = bestTransition(sim, ac);
    const slot = slotFor(sim, ac, tr);
    // lowest first in its own stack, and the ALHUV stack before anyone holding further out
    const lower = sim.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && !o.app && (isHolder(sim, o, fix) ? lvlFt(sim, o) < clearedFt - 50 : fix !== 'ALHUV' && isHolder(sim, o, 'ALHUV')));
    const blk0 = pathBlocker(sim, ac, sim.ftOf(transLvl), new Set(sequenceMembers(sim)));
    const blk = blk0 ?? (slot.ok && !lower.length ? predictedConflict(sim, ac, asCleared(sim, tr?.name, sim.ftOf(transLvl), rw.id))?.with : undefined);
    const ok = slot.ok && !lower.length && !blk;
    const why = lower.length ? `Release the lowest first: ${lower[0].cs} is below it.` : blk ? `Wait: ${blk.cs} is in the way down.` : slot.ok ? `${slotWhy(slot)}.` : `No gap yet: ${slot.clash?.cs ?? 'the sequence'} is too close. About ${Math.max(1, Math.round(slot.waitS / 60))} min.`;
    add({ label: `Leave hold · ${tr?.name ?? ''}${lvlTag(transLvl)} · ${appName}`, items: [...(tr ? [{ k: 'trans', name: tr.name } as Item] : []), ...lvlTo(transLvl), ils], why, primary: ok });
    const hold = sim.pack.holds.find((h) => h.fix === fix);
    if (hold && clearedFt > sim.ftOf(hold.max) + 50) {
      // down into the stack, without passing through anyone holding below
      const others = stackOf(sim, fix, ac).map((o) => lvlFt(sim, o));
      let target: Level | undefined;
      for (let ft = Math.floor((clearedFt - 200) / 1000) * 1000; ft >= Math.max(4000, sim.ftOf(hold.min)); ft -= 1000) {
        if (others.some((x) => Math.abs(x - ft) < 900)) break;
        target = sim.levelFor(ft);
      }
      if (target) add({ label: `Descend ${lvlLabel(target)}`, items: [{ k: 'lvl', lvl: target }], why: `Into the stack, clear of the others holding at ${fix}.`, primary: !ok });
    }
    return;
  }

  if (ac.app && !ac.app.locCap) {
    if (ac.mode === 'HDG' && Math.abs(xt) > 0.6 && Math.abs(angDiff(curMag, crsMag)) > 50) {
      const h = roundHdg(crsMag - 30 * Math.sign(xt));
      add({ label: `Intercept ${turnDir(curMag, h)}${p3(h)}`, items: [hdgItem(sim, ac, h)], why: '30° to the final course so the localizer captures cleanly.', primary: Math.abs(xt) < 3 });
    }
    speedForSpacing(sim, ac, add);
    if (ac.ias > 200 && d < 18) { const s = spdFor(sim, ac, 180); if (s < ac.ias - 5) add({ label: `Speed ${s}`, items: [{ k: 'spd', spd: s }], why: 'Slow it before the localizer.' }); }
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
    // the stack goes first, lowest first: anyone holding below this aircraft's level
    const holders = sim.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && !o.app && (o.mode === 'HOLD' || !!holdAtOf(sim, o)) && lvlFt(sim, o) < clearedFt - 50);
    const slot = slotFor(sim, ac, tr);
    const blk0 = pathBlocker(sim, ac, sim.ftOf(transLvl), new Set(sequenceMembers(sim)));
    const blk = blk0 ?? (slot.ok && !holders.length && tr ? predictedConflict(sim, ac, asCleared(sim, tr.name, sim.ftOf(transLvl), rw.id))?.with : undefined);
    const ok = slot.ok && !holders.length && !blk;
    if (tr) {
      const why = holders.length ? `${holders.length} already holding at ALHUV: they go first.` : blk ? `Wait: ${blk.cs} is in the way down.` : slot.ok ? `${slotWhy(slot)}. Transition, 3,000 ft and the approach: it flies to final by itself.` : `No gap: ${slot.clash?.cs ?? 'the sequence'} would be too close. About ${Math.max(1, Math.round(slot.waitS / 60))} min to wait.`;
      add({ label: `${tr.name}${lvlTag(transLvl)} · ${appName}`, items: [{ k: 'trans', name: tr.name }, ...lvlTo(transLvl), ils], why, primary: ok });
    }
    if (!ok && ac.route[ac.route.length - 1]?.fix === 'ALHUV') {
      // the lowest free level in the stack that it can reach without meeting anyone on the way
      const cands = stackLevels(sim, ac, 'ALHUV');
      const members = new Set(sequenceMembers(sim));
      let sl: Level | undefined, blkS: Aircraft | undefined;
      for (const l of cands) {
        const ft = sim.ftOf(l);
        const b = (ft < ac.alt - 300 ? pathBlocker(sim, ac, ft, members) : undefined) ?? predictedConflict(sim, ac, (c) => { c.tgtAlt = ft; (c as any)._holdAt = 'ALHUV'; })?.with;
        if (!b) { sl = l; blkS = undefined; break; }
        if (!sl) { sl = l; blkS = b; }
      }
      if (sl) {
        const why = holders.length ? `${holders.length} holding ahead of it. Join the stack at ${lvlWords(sl)}.` : `No gap in the sequence yet. Hold at ${lvlWords(sl)} until there is one.`;
        add({ label: `Hold ALHUV${lvlTag(sl)}`, items: [{ k: 'hold', fix: 'ALHUV' }, ...lvlTo(sl)], why: blkS ? `Wait: ${blkS.cs} is in the way down.` : why, primary: !blkS });
      }
      if (!sl || blkS) {
        // ALHUV is full: hold it further out, at the STAR fix before ALHUV, at a level nobody else holds there
        const remote = remoteHold(sim, ac);
        if (remote) add({ label: `Hold ${remote.fix}${lvlTag(remote.lvl)}`, items: [{ k: 'hold', fix: remote.fix }, ...lvlTo(remote.lvl)], why: `The ALHUV stack is full. Hold it at ${remote.fix} for now.`, primary: true });
        else if (!ac.spdMin && ac.spdAssigned === undefined) add({ label: 'Min clean speed', items: [{ k: 'spdmin' }], why: 'The ALHUV stack is full. Slow it down to buy time.', primary: true });
        else if (!sl) add({ label: 'Hold ALHUV', items: [{ k: 'hold', fix: 'ALHUV' }], why: 'The stack is full: it will hold at its present level.' });
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
  if (ac.ias > 230 && d < 25 && !ac.spdAssigned) { const s = spdFor(sim, ac, 210); if (s < ac.ias - 5) add({ label: `Speed ${s}`, items: [{ k: 'spd', spd: s }], why: 'Slow it to make the sequence work.' }); }
}

/** In the sequence and closing on the one ahead: a slower speed, as the primary call. */
function speedForSpacing(sim: Sim, ac: Aircraft, add: (s: Suggestion) => void) {
  const sf = shortfall(sim, ac);
  if (!(sf.shortS > 0) || !sf.leader) return;
  const want = spdFor(sim, ac, Math.min(ac.ias, sf.leader.ias) - 20);
  if (want >= ac.ias - 5 || (ac.spdAssigned !== undefined && ac.spdAssigned <= want)) return;
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
export function releaseAdvice(sim: Sim, cs: string): { ok: boolean; items: Item[]; why: string } {
  void cs;
  const short = sim.aircraft.find((a) => !a.remove && !a.landed && a.app?.locCap && a.app.rwy.id === sim.runway && sim.dthr(a) < 6);
  if (short) return { ok: false, items: [{ k: 'relhold', mins: 2 }], why: `${short.cs} is on short final. Hold it for now.` };
  const over = sim.aircraft.filter((a) => !a.remove && !a.landed && a.kind !== 'dep' && a.rules !== 'VFR' && !a.app?.locCap
    && Math.hypot(a.p.x, a.p.y) < 10 && Math.min(a.alt, a.tgtAlt) < 7500 && Math.max(a.alt, a.tgtAlt) > 2000);
  if (!over.length) return { ok: true, items: [{ k: 'rel' }], why: 'Nothing over the field. Release it.' };
  const low = Math.min(...over.map((a) => Math.min(a.alt, a.tgtAlt)));
  if (low >= 3900) {
    const cap = sim.levelFor(Math.floor((low - 1000) / 1000) * 1000);
    return { ok: true, items: [{ k: 'rel', lvl: cap }], why: `Traffic over the field from ${Math.round(low / 100) * 100} ft. Release it climbing to ${lvlWords(cap)} only.` };
  }
  return { ok: false, items: [{ k: 'relhold', mins: 3 }], why: `${over.find((a) => Math.min(a.alt, a.tgtAlt) === low)!.cs} is low over the field. Hold it for now.` };
}
