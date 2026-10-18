import type { Sim } from './sim';
import type { Aircraft } from './types';
import type { Item } from './clearance';
import type { Level } from '../pack/load';
import { alongTrack, angDiff, bearing, crossTrack, dist, norm360 } from '../geo';
import { asCleared, bestTransition, etaS, predictedConflict, sequenceMembers, shortfall, slotAt, slotFor, trackNm, TRANSITION_HORIZON_S, type Slot } from './sequence';
import type { Procedure } from '../pack/load';

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
/** Vertical margin for the transition look-ahead: the turn onto the transition against traffic on short final (ALHUV1B at Liège) is only clear with 1,100 ft to spare, since the final descends through it. */
const TRANSITION_VERT_FT = 1100;
/** The level a long transition is flown at until the descent for the final (Düsseldorf chart overlay: 5,000 ft to the downwind). */
const TRANS_OVERLAY_FT = 5000;
/** The overlay level, kept 1,000 ft above the SID initial climb so arrivals on the downwind stay clear of departures still at it. */
export function overlayFtOf(sim: Sim): number {
  let sidTop = 0;
  for (const sd of sim.pack.sids) sidTop = Math.max(sidTop, sim.ftOf(sd.initialClimb));
  return Math.max(TRANS_OVERLAY_FT, Math.ceil((sidTop + 1000) / 1000) * 1000);
}
/** The highest minimum vectoring altitude along a straight path, sampled every 2 NM. */
export function mvaAlong(sim: Sim, from: { x: number; y: number }, to: { x: number; y: number }): number {
  const L = dist(from, to);
  let m = sim.mvaAt(from);
  for (let d = 2; d < L; d += 2) m = Math.max(m, sim.mvaAt({ x: from.x + ((to.x - from.x) * d) / L, y: from.y + ((to.y - from.y) * d) / L }));
  return Math.max(m, sim.mvaAt(to));
}
/** A transition longer than this (its legs, without the final) is flown at the overlay altitude first. */
export const LONG_TRANSITION_NM = 28;
export const legsNm = (tr: { legs: { p: { x: number; y: number } }[] }) => tr.legs.reduce((s, l, i) => (i ? s + dist(tr.legs[i - 1].p, l.p) : 0), 0);
/** Track miles from the final approach fix to the threshold (the FAF is the last transition fix where the pack has no IF on the transition). */
export const finalFixNmOf = (sim: Sim, rw: Sim['rwy']) => { const f = sim.pack.fixes.get(rw.faf); return f ? Math.max(0, -alongTrack(f.p, rw.thr, rw.crs)) : 6; };

/** A speed the aircraft can fly here: never below minimum clean speed until it is established (or within 15 NM). */
function spdFor(sim: Sim, ac: Aircraft, want: number): number {
  // on a downwind transition (Düsseldorf) the aircraft is abeam the field but far from the final: clean speed until the localizer
  const established = !!ac.app?.locCap || (sim.dthr(ac) < 15 && !(sim.approachOnDownwind && ac.mode === 'NAV' && !!ac.route.length));
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
export function pathBlocker(sim: Sim, ac: Aircraft, toFt: number, members?: Set<Aircraft>): Aircraft | undefined {
  const lo = Math.min(ac.alt, toFt) - 900, hi = Math.max(ac.alt, toFt) + 900;
  for (const o of sim.aircraft) {
    if (o === ac || o.remove || o.landed || o.rules === 'VFR' || o.state === 'unconcerned') continue;
    // the arrival sequence itself is spaced by the slot check, not here
    if (o.app?.locCap || members?.has(o)) continue;
    const oLo = Math.min(o.alt, o.tgtAlt), oHi = Math.max(o.alt, o.tgtAlt);
    if (oHi < lo || oLo > hi) continue;
    // a holding aircraft turns through every heading: treat its racetrack as a 6 NM circle round the fix
    const hf = o.mode === 'HOLD' && o.hold ? o.hold.p : holdAtOf(sim, o) ? sim.fixP(holdAtOf(sim, o)!) : undefined;
    if (hf) {
      const v = { x: (Math.sin((ac.trk * Math.PI) / 180) * ac.gs) / 3600, y: (Math.cos((ac.trk * Math.PI) / 180) * ac.gs) / 3600 };
      let best = dist(ac.p, hf);
      for (let t = 10; t <= 240; t += 10) best = Math.min(best, Math.hypot(ac.p.x + v.x * t - hf.x, ac.p.y + v.y * t - hf.y));
      if (best < 6) return o;
    }
    if (cpa(ac, o) < 5) return o;
  }
  return undefined;
}

/** An arrival the centre has announced (not yet handed over) whose arrival route passes within 8 NM of this departure's route, within 1,000 ft of `lvl`. */
function estimateAcross(sim: Sim, ac: Aircraft, lvl: Level): { cs: string; fix: string; xfl: Level; nom: number } | undefined {
  const mine = [...ac.route, ...(ac.savedRoute ?? [])].map((l) => l.p);
  if (!mine.length) return undefined;
  for (const e of sim.estimates) {
    if (e.state !== 'expected' || Math.abs(sim.ftOf(e.xfl) - sim.ftOf(lvl)) >= 1000) continue;
    const st = sim.pack.stars.find((x) => x.name === e.star);
    if (st && st.legs.some((l) => mine.some((p) => dist(p, l.p) < 8))) return { cs: e.cs, fix: e.fix, xfl: e.xfl, nom: e.xfl.fl !== undefined ? e.xfl.fl * 100 : e.xfl.ft! };
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
  // a go-around flying the missed approach below the stack may climb into it (the transitions start at the fix at its level)
  const climbIn = ac.goArounds > 0 && sim.ftOf(ac.cleared) < sim.ftOf(h.min) + 1050;
  const top = climbIn ? sim.ftOf(h.max) : Math.min(sim.ftOf(h.max), sim.ftOf(ac.cleared) + 50);
  const near = dist(ac.p, sim.fixP(fix)) < 15;
  for (let ft = Math.max(4000, Math.ceil(sim.ftOf(h.min) / 1000) * 1000); ft <= top + 1; ft += 1000) {
    if (others.some((x) => Math.abs(x - ft) < 900)) continue;
    // close to the fix, do not descend through someone already holding there
    if (near && others.some((x) => x > ft && x < ac.alt - 300)) continue;
    out.push(sim.levelFor(ft));
    if (climbIn) break;
  }
  return out;
}

/**
 * When the stack is full: the nearest other published hold (GIREL, GSY at Liège) with a free level inside its published band,
 * clear of anyone holding or passing there, outside any active or announced reserved area, and clear of traffic on the way.
 */
function remoteHold(sim: Sim, ac: Aircraft): { fix: string; lvl: Level } | undefined {
  // every approach stack is out (at Düsseldorf the downwind holds of both directions)
  const stacks = sim.stacksOnTransitions ? Object.values(sim.pack.spec.stacksByDirection ?? {}).flat() : sim.stackFixes();
  // Düsseldorf: the centre holds the arrivals of its own feed (NVO and ELDAR for BIKMU, DOMEG for HALME), not someone else's
  const star = sim.approachOnDownwind && ac.proc ? sim.pack.stars.find((x) => x.name === ac.proc) : undefined;
  const ownFeed = (fix: string) => !sim.approachOnDownwind || (fix !== sim.pack.spec.starLimit && !!star && star.legs.some((l) => dist(l.p, sim.fixP(fix)) < 12));
  const cands = sim.pack.holds.filter((h) => !stacks.includes(h.fix) && sim.pack.fixes.has(h.fix) && dist(ac.p, sim.fixP(h.fix)) < 50 && ownFeed(h.fix))
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
      // a centre hold on an arrival route (NVO on BIKMU1A at Düsseldorf): clear of the level the next arrivals come in at
      if (sim.approachOnDownwind && sim.pack.stars.some((st) => st.legs.some((l) => l.fix === fix) && Math.abs(sim.ftOf(st.handoffLevel) - ft) < 900)) continue;
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
      const blk = pathBlocker(sim, ac, sim.ftOf(rq.level)) ?? (sim.approachOnDownwind ? predictedConflict(sim, ac, (c) => { c.tgtAlt = sim.ftOf(rq.level!); }, 300)?.with : undefined);
      const est = sim.approachOnDownwind && !blk && ac.kind === 'dep' ? estimateAcross(sim, ac, rq.level) : undefined;
      add({ label: `Climb ${lvlLabel(rq.level)}`, items: [{ k: 'lvl', lvl: rq.level }], why: blk ? `Wait: ${blk.cs} is in the way.` : est ? `Wait: ${est.cs} is expected over ${est.fix} at ${lvlWords(est.xfl)}.` : rq.text, primary: !blk && !est });
    } else if (rq.kind === 'direct' && rq.fix) add({ label: `Direct ${rq.fix}`, items: [{ k: 'dct', fix: rq.fix }], why: rq.text, primary: true });
    else if (rq.kind === 'vectors' && ac.app && !ac.app.tooHigh && !ac.app.locCap) {
      // cleared for the ILS but cannot intercept from where it is: a 30° intercept heading
      const xt = crossTrack(ac.p, rw.thr, rw.crs);
      const h = roundHdg(crsMag - 30 * (Math.sign(xt) || 1));
      add({ label: `Intercept ${turnDir(curMag, h)}${p3(h)}`, items: [hdgItem(sim, ac, h)], why: `${Math.abs(xt).toFixed(1)} NM off the centreline. 30° to the final course so the localizer captures.`, primary: true });
    } else if (rq.kind === 'vectors' && !ac.app && ac.kind === 'arr' && !ac.emergency) {
      // a diversion with no local procedure: route it to the nearest entry fix and work it like the others from there
      const sf = sim.entryFixOf(ac);
      const mvaFt = Math.ceil(mvaAlong(sim, ac.p, sim.fixP(sf)) / 500) * 500;
      const items: Item[] = [{ k: 'dct', fix: sf }];
      if (sim.ftOf(ac.cleared) < mvaFt) items.push({ k: 'lvl', lvl: sim.levelFor(mvaFt) });
      add({ label: `Direct ${sf}`, items, why: `No local arrival: send it to ${sf}, the entry fix, and give it the transition from there like everyone else.`, primary: true });
    } else if (rq.kind === 'vectors') {
      const away = norm360(crsMag + 180);
      const items: Item[] = [{ k: 'brk' }, hdgItem(sim, ac, away)];
      const l3 = sim.levelFor(3000);
      if (!sameAsCleared(l3)) items.push({ k: 'lvl', lvl: l3 });
      add({ label: `Break off · H${p3(away)}${sameAsCleared(l3) ? '' : ' · 3000'}`, items, why: ac.app?.tooHigh ? 'Too high for the glide. Take it off the approach and bring it round again.' : 'It asks for vectors. Take it off the approach and bring it round again.', primary: true });
    } else if (rq.kind === 'deviate' && rq.hdg !== undefined && ac.kind === 'arr') {
      const hdgTrue = norm360(rq.hdg + sim.pack.meta.magVar);
      const onHdg = (c: Aircraft) => { c.mode = 'HDG'; c.hdgAssigned = hdgTrue; c.route = []; c.app = c.app?.locCap ? c.app : undefined; };
      const hit = predictedConflict(sim, ac, onHdg, 240)?.with;
      let lvl: Level | undefined;
      if (hit) {
        // the deviation runs into someone: approve it with a level 1,000 ft clear, above the vectoring minimum
        const mva = sim.mvaAt(ac.p);
        for (const cand of [ac.alt - 1000, ac.alt + 1000]) {
          const ft = Math.round(cand / 1000) * 1000;
          if (ft < Math.max(mva, rw.ifAlt)) continue;
          if (predictedConflict(sim, ac, (c) => { onHdg(c); c.tgtAlt = ft; }, 240)) continue;
          lvl = sim.levelFor(ft); break;
        }
      }
      add({ label: `Approve${lvl ? ' · ' + lvlLabel(lvl) : ''}`, items: lvl ? [{ k: 'appr' }, { k: 'lvl', lvl }] : [{ k: 'appr' }], why: hit ? (lvl ? `Weather avoidance, but heading ${p3(rq.hdg)} runs into ${hit.cs}: approve it with ${lvlWords(lvl)}.` : `Heading ${p3(rq.hdg)} runs into ${hit.cs} and no level is free. Refuse it and offer the other side.`) : rq.text, primary: !hit || !!lvl });
    } else add({ label: 'Approve', items: [{ k: 'appr' }], why: rq.text, primary: true });
    add({ label: 'Unable', items: [{ k: 'deny' }], why: 'Refuse the request.' });
  }
  if (ac.atisOld) add({ label: `ATIS ${sim.atis} current`, items: [{ k: 'atis' }], why: 'The pilot has an old ATIS. Give the current letter and QNH.' });
  if (ac.state !== 'assumed' || ac.radioFail) return finish(sim, ac, out);

  if (ac.kind === 'arr') arrival(sim, ac, add, { rw, crsMag, curMag, ifLvl, ils, appName, clearedFt, sameAsCleared });
  else if (ac.kind === 'dep' || ac.kind === 'mil' || ac.kind === 'ovf') {
    const xfl = sim.depXfl;
    if (ac.kind === 'dep' && clearedFt < sim.ftOf(xfl) - 50) {
      // where the SIDs cross the arrival flows (Düsseldorf), the climb is checked along the SID as flown, turns included
      const blk = pathBlocker(sim, ac, sim.ftOf(xfl)) ?? (sim.approachOnDownwind ? predictedConflict(sim, ac, (c) => { c.tgtAlt = sim.ftOf(xfl); }, 300)?.with : undefined);
      // an arrival the centre has announced on a route the SID crosses, at the transfer level: stop the climb 1,000 ft below it
      const est = sim.approachOnDownwind && !blk ? estimateAcross(sim, ac, xfl) : undefined;
      if (est) {
        const below = sim.levelFor(est.nom - 1000);
        if (sim.ftOf(below) > clearedFt + 50) add({ label: `Climb ${lvlLabel(below)}`, items: [{ k: 'lvl', lvl: below }], why: `${est.cs} is expected over ${est.fix} at ${lvlWords(est.xfl)}, across this departure's route: climb it to ${lvlWords(below)} for now.`, primary: !pathBlocker(sim, ac, sim.ftOf(below)) });
      }
      if (!est) add({ label: `Climb ${lvlLabel(xfl)}`, items: [{ k: 'lvl', lvl: xfl }], why: blk ? `Wait: ${blk.cs} is in the way. It stays at ${lvlWords(ac.cleared)} until they have passed.` : 'The agreed transfer level. Nothing is in the way.', primary: (ac.alt > 3000 || sim.approachOnDownwind) && !blk });
    }
    // already cleared to the transfer level when the centre announces an arrival across its route: stop it below
    if (sim.approachOnDownwind && ac.kind === 'dep' && clearedFt >= sim.ftOf(xfl) - 50) {
      const est = estimateAcross(sim, ac, xfl);
      const below = est ? sim.levelFor(est.nom - 1000) : undefined;
      if (est && below && ac.alt < sim.ftOf(below) - 300) add({ label: `Stop climb ${lvlLabel(below)}`, items: [{ k: 'lvl', lvl: below }], why: `${est.cs} is expected over ${est.fix} at ${lvlWords(est.xfl)}, across this departure's route.`, primary: true });
    }
    const r0 = dist(ac.p, { x: 0, y: 0 });
    const R = sim.pack.meta.sectorRadiusNm;
    const to = ac.kind === 'mil' ? sim.mil : ac.kind === 'dep' ? sim.xfrUnitFor(ac) : sim.acc;
    // the next sector climbs it at once: not into an arrival still above it (unless it is about to leave the sector)
    const above = sim.approachOnDownwind && ac.kind === 'dep' && r0 < R - 4 ? predictedConflict(sim, ac, (c) => { c.tgtAlt = sim.ftOf(xfl) + 6000; }, 240)?.with : undefined;
    if (r0 > R * 0.45 || ac.alt > 7000) add({ label: ac.kind === 'mil' ? 'Military' : to.say, items: [{ k: 'xfr', unit: to.id }], why: above ? `Not yet: the next sector will climb it, and ${above.cs} is still in the way.` : sim.pack.spec.xfrByExit && ac.kind === 'dep' ? `${ac.exitFix} departures go to ${to.callsign} ${to.label}, ${to.freq}. Hand it on before it leaves the ${R} NM ring.` : `Hand it on before it leaves the ${R} NM ring.`, primary: r0 > R * 0.625 && !above });
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
  if (!ac.app?.locCap && sim.needReclear().includes(ac) && !(sim.approachOnDownwind && ac.mode !== 'HDG')) {
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
  // miles to touchdown: straight down the final once established, else along the path it will most likely fly
  const d = ac.app?.locCap ? sim.dthr(ac) : trackNm(sim, ac);
  const dStraight = sim.dthr(ac);
  const xt = crossTrack(ac.p, rw.thr, rw.crs);
  const along = alongTrack(ac.p, rw.thr, norm360(rw.crs + 180));
  const finalFt = Math.max(TRANS_FT, rw.ifAlt);
  // a long transition (Düsseldorf: 40 NM round the downwind) is flown at the overlay altitude first; the descent to the
  // final approach altitude comes as its own call about 3 NM per 1,000 ft before the final approach fix
  const bt = ac.mode !== 'HDG' ? bestTransition(sim, ac) : undefined;
  const overlayFt = overlayFtOf(sim);
  const longTrans = !!bt && legsNm(bt) > LONG_TRANSITION_NM && sim.ftOf(ac.cleared) > overlayFt + 50;
  const transLvl0 = sim.levelFor(longTrans ? overlayFt : finalFt);
  /**
   * The level for a transition clearance: the overlay (or final) level, or 1,000 ft above it when the transition merges
   * with another aircraft's transition at a fix they would reach within 5 minutes of each other. Crossing paths at a
   * merge are kept apart vertically until both are in trail; the descent for the final comes later.
   */
  const transLvlFor = (tr: Procedure | undefined, eta: number, _leader?: Aircraft): Level => {
    if (!tr) return transLvl0;
    const mine = new Set(tr.legs.slice(0, -1).map((l) => l.fix));
    const nom = (l: Level) => (l.fl !== undefined ? l.fl * 100 : l.ft!);
    let want = nom(transLvl0);
    // track miles along a route to a fix (from the aircraft's present position)
    const nmTo = (p: { x: number; y: number }, legs: { fix: string; p: { x: number; y: number } }[], fix: string) => {
      let d = 0, q = p;
      for (const l of legs) { d += dist(q, l.p); q = l.p; if (l.fix === fix) return d; }
      return undefined;
    };
    const myLegs = tr.legs.map((l) => ({ fix: l.fix, p: l.p ?? sim.fixP(l.fix) }));
    // a transition cleared in the last minute whose readback has not come yet counts too: the pilot will fly it
    const pendingTrans = (o: Aircraft) => {
      for (let i = sim.cmdLog.length - 1; i >= 0 && sim.t - sim.cmdLog[i].t < 60; i--) {
        const c = sim.cmdLog[i];
        if (c.cl.cs !== o.cs) continue;
        const it = c.cl.items.find((x) => x.k === 'trans') as { k: 'trans'; name: string } | undefined;
        const lv = c.cl.items.find((x) => x.k === 'lvl') as { k: 'lvl'; lvl: Level } | undefined;
        const p = it && sim.pack.transitions.find((x) => x.name === it.name);
        if (p) return { name: p.name, route: p.legs.map((l) => ({ fix: l.fix, p: l.p ?? sim.fixP(l.fix) })), cleared: lv?.lvl ?? o.cleared };
        return undefined;
      }
      return undefined;
    };
    const dw = sim.approachOnDownwind;
    const nearLevels: number[] = [];
    for (const o of sim.aircraft) {
      if (o === ac || o.remove || o.kind !== 'arr' || o.app?.locCap) continue;
      const pend = !o.app ? pendingTrans(o) : undefined;
      // where the approach comes on the downwind (Düsseldorf), an arrival on its transition has no approach clearance yet
      const onTr = (!!o.app || (dw && o.mode === 'NAV' && !!o.proc && sim.pack.transitions.some((x) => x.name === o.proc))) && o.mode === 'NAV' && sequenceMembers(sim, ac).includes(o);
      if (!onTr && !pend) continue;
      const route = pend?.route ?? o.route;
      // Düsseldorf: an arrival on the same transition less than three minutes ahead or behind gets its own level too
      if ((pend?.name ?? o.proc) === tr.name && dw) { if (Math.abs(etaS(o, trackNm(sim, o)) - eta) < 180 || Math.abs(trackNm(sim, o) - trackNm(sim, ac, tr)) < 10) nearLevels.push(nom(pend?.cleared ?? o.cleared)); continue; }
      if ((pend?.name ?? o.proc) === tr.name || !route.some((l) => mine.has(l.fix))) continue;
      const oCleared = pend?.cleared ?? o.cleared;
      // compare the times over the first fix both routes share (the merge point), not over the threshold:
      // two transitions of different lengths can meet at the merge with very different touchdown times
      const merge = route.find((l) => mine.has(l.fix))!.fix;
      const dO = nmTo(o.p, route, merge), dMe = nmTo(ac.p, myLegs, merge);
      // seconds this aircraft reaches the merge after the other (negative: before it)
      const lag = dO !== undefined && dMe !== undefined ? ((dMe / Math.max(150, ac.gs || ac.ias)) - (dO / Math.max(150, o.gs || o.ias))) * 3600 : undefined;
      // within 5 minutes of each other at the merge: 1,000 ft apart until they are in trail (speed control changes who
      // leads, so the rule does not depend on it); the descents for the final then come one at a time
      const near = lag !== undefined ? Math.abs(lag) < 300 : Math.abs(etaS(o, trackNm(sim, o)) - eta) < 420;
      if (near && !dw) want = Math.max(want, Math.min(nom(oCleared), overlayFt) + 1000);
      if (near && dw) nearLevels.push(nom(oCleared));
    }
    // Düsseldorf: the lowest level from the overlay up that is 1,000 ft clear of every arrival meeting it at the merge
    if (dw) while (nearLevels.some((l) => Math.abs(l - want) < 900)) want += 1000;
    return want > nom(ac.cleared) ? ac.cleared : sim.levelFor(want);
  };
  let transLvl = transLvl0;
  const lvlTo = (l: Level): Item[] => (sim.ftOf(l) < clearedFt - 50 ? [{ k: 'lvl', lvl: l }] : []);
  const lvlTag = (l: Level) => (sim.ftOf(l) < clearedFt - 50 ? ` · ${lvlLabel(l)}` : '');

  if (ac.app?.locCap) {
    if (ac.app.tooHigh) return;
    add({ label: 'Tower', items: [{ k: 'xfr', unit: sim.twr.id }], why: 'Established on the localizer. Hand it to Tower.', primary: d < 14 });
    if (ac.ias > 175 && d > 5 && worthSlowing(ac, 160) && !speedQuiet(sim, ac)) add({ label: '160 to 4 · Tower', items: [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: sim.twr.id }], why: 'Slow it for a stable approach and hand it over in one call.' });
    return;
  }

  // MAYDAY (or a diversion with no local procedure asking for vectors): the shortest way in, straight to the final,
  // not round a transition or into the hold, at a level that keeps it above the vectoring minimum on the way
  const joinDirect = ac.emergency && ac.emergency !== 'radio' && !ac.app;
  if (joinDirect) {
    // with both runways open (Düsseldorf), the emergency gets the longer one (the southern runway, 3,000 m against 2,700 m)
    const longer = sim.approachOnDownwind && sim.inParallelOps ? sim.landingRunways().map((id) => sim.pack.runways.get(id)!).reduce((a, b) => (b.lengthM > a.lengthM ? b : a)) : undefined;
    const er = longer && longer.id !== rw.id ? longer : rw;
    const eIls: Item = er === rw ? ils : { k: 'app', app: er.ils && !sim.ilsOut.has(er.id) ? 'ILS' : 'RNP', rwy: er.id };
    const eName = er === rw ? appName : `${(eIls as Extract<Item, { k: 'app' }>).app} ${er.id}`;
    const ifFix = er.ifFix;
    const ifP = sim.fixP(ifFix);
    const mvaFt = Math.ceil(mvaAlong(sim, ac.p, ifP) / 500) * 500;
    const l = sim.levelFor(Math.max(TRANS_FT, er.ifAlt, mvaFt));
    const why = ac.emergency ? `${ac.emergencyText ?? 'Emergency'}: the shortest way to the final${er !== rw ? `, on ${er.id}, the longer runway` : ''}, everyone else makes room.` : `No local procedure: direct to the intermediate fix and the approach. ${lvlWords(l)} keeps it above the vectoring minimum on the way.`;
    add({ label: `Direct ${ifFix}${lvlTag(l)} · ${eName}`, items: [{ k: 'dct', fix: ifFix }, ...lvlTo(l), eIls], why, primary: true });
    if (ac.mode === 'HDG' && Math.abs(xt) < 4.5 && along > 6) {
      const h = roundHdg(crsMag - 30 * (Math.sign(xt) || 1));
      add({ label: `${turnDir(curMag, h)}${p3(h)} · ${appName}`, items: [hdgItem(sim, ac, h), ...lvlTo(l), ils], why: 'Already close to the final: 30° intercept and the approach.' });
    }
    return;
  }

  // Düsseldorf: the transition with "expect ILS" first, the approach clearance on the downwind, the shortcut off it when the
  // slot allows, and the downwind holds when the sequence is full
  if (sim.approachOnDownwind && (ac.mode === 'NAV' || ac.mode === 'HOLD')) {
    downwind(sim, ac, add, c, { SF, late, lateWhy, transLvlFor, lvlTo, lvlTag, finalFt, d });
    return;
  }

  if (ac.mode === 'HOLD') {
    const fix = ac.hold?.fix ?? SF;
    const tr = bestTransition(sim, ac);
    const slot = slotFor(sim, ac, tr);
    transLvl = transLvlFor(tr, slot.etaS, slot.leader);
    // lowest first in its own stack, and the stack at the transition fix before anyone holding further out
    const lower = sim.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && !o.app && (isHolder(sim, o, fix) ? lvlFt(sim, o) < clearedFt - 50 : fix !== SF && isHolder(sim, o, SF)));
    const blk0 = pathBlocker(sim, ac, sim.ftOf(transLvl), new Set(sequenceMembers(sim)));
    const blk = blk0 ?? (slot.ok && !lower.length ? predictedConflict(sim, ac, asCleared(sim, tr?.name, sim.ftOf(transLvl), rw.id), TRANSITION_HORIZON_S, TRANSITION_VERT_FT)?.with : undefined);
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

  // off its route on a heading (a weather deviation, a vector) with the route still to fly: back to the next fix once the way is clear
  if (ac.mode === 'HDG' && !ac.request && (ac.route.length || ac.savedRoute?.length) && !ac.app?.locCap && !(sim.approachOnDownwind && ac.app)) {
    const legs = ac.route.length ? ac.route : ac.savedRoute!;
    // the first fix of the route that is ahead of the aircraft (within 100 degrees of its track)
    const next = legs.find((l) => Math.abs(angDiff(ac.trk, bearing(ac.p, l.p))) < 100 && dist(ac.p, l.p) > 1.5);
    if (next) {
      const clear = !sim.storms.some((st) => { const L = dist(ac.p, next.p); for (let k = 0; k <= L; k += 2) { const q = { x: ac.p.x + ((next.p.x - ac.p.x) * k) / L, y: ac.p.y + ((next.p.y - ac.p.y) * k) / L }; if (dist(q, st.p) < st.r + 2) return true; } return false; });
      const hit = clear ? predictedConflict(sim, ac, (c) => { c.mode = 'NAV'; c.route = legs.slice(legs.indexOf(next)).map((l) => ({ ...l })); c.hold = undefined; }, 300)?.with : undefined;
      add({ label: `Direct ${next.fix}`, items: [{ k: 'dct', fix: next.fix }], why: !clear ? `Weather still between it and ${next.fix}. Keep the heading for now.` : hit ? `Wait: ${hit.cs} is in the way to ${next.fix}.` : `The way to ${next.fix} is clear: back onto its route.`, primary: clear && !hit && !ac.turnQuery });
    }
  }
  if (ac.app && !ac.app.locCap) {
    // on a transition at the overlay altitude: down to the final approach altitude in time for the glide
    if (ac.mode === 'NAV' && ac.route.length && ac.tgtAlt > finalFt + 300) {
      const toFaf = Math.max(0, d - finalFixNmOf(sim, rw));
      const need = ((ac.alt - finalFt) / 1000) * 3 + 3;
      const l = sim.levelFor(finalFt);
      if (toFaf <= need + 4) {
        const hit0 = predictedConflict(sim, ac, (c) => { c.tgtAlt = finalFt; }, 300)?.with;
        // proximity that exists whether or not it descends (in trail on the same downwind) is not a reason to wait:
        // only a conflict the descent itself would create blocks it
        const hit = hit0 && hit0 !== predictedConflict(sim, ac, undefined, 300)?.with ? hit0 : undefined;
        add({ label: `Descend ${lvlLabel(l)}`, items: [{ k: 'lvl', lvl: l }], why: hit ? `Wait: ${hit.cs} is in the way down.` : `${toFaf.toFixed(0)} NM to the final approach fix: about ${need.toFixed(0)} NM needed to get down to ${lvlWords(l)}.`, primary: toFaf <= need + 2 && !hit });
      }
    }
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
    transLvl = transLvlFor(tr, slot.etaS, slot.leader);
    const blk0 = pathBlocker(sim, ac, sim.ftOf(transLvl), new Set(sequenceMembers(sim)));
    const blk = blk0 ?? (slot.ok && !holders.length && tr ? predictedConflict(sim, ac, asCleared(sim, tr.name, sim.ftOf(transLvl), rw.id), TRANSITION_HORIZON_S, TRANSITION_VERT_FT)?.with : undefined);
    const ok = slot.ok && !holders.length && !blk && !late(slot.etaS);
    if (tr) {
      const why = late(slot.etaS) ? lateWhy : holders.length ? `${holders.length} already holding at ${SF}: they go first.` : blk ? `Wait: ${blk.cs} is in the way down.` : slot.ok ? `${slotWhy(slot)}. Transition, ${lvlWords(transLvl)} and the approach: it flies to final by itself.` : `No gap: ${slot.clash?.cs ?? 'the sequence'} would be too close. About ${Math.max(1, Math.round(slot.waitS / 60))} min to wait.`;
      add({ label: `${tr.name}${lvlTag(transLvl)} · ${appName}`, items: [{ k: 'trans', name: tr.name }, ...lvlTo(transLvl), ils], why, primary: ok });
    }
    // already told to hold: no second hold instruction, only the way down into the stack
    if (!ok && myHold) stackDescend(sim, ac, myHold, clearedFt, add, true);
    // a short delay with miles still to run: absorb it with speed instead of a hold
    const toSF = dist(ac.p, sim.fixP(SF));
    const slowable = !ok && !myHold && !late(slot.etaS) && !holders.length && !blk && slot.waitS > 0 && slot.waitS <= 180 && toSF > 14 && ac.spdAssigned === undefined && !ac.spdMin && !speedQuiet(sim, ac);
    if (slowable) {
      const v = spdFor(sim, ac, Math.max(ac.perf.vminClean, 210));
      if (worthSlowing(ac, v)) add({ label: `Speed ${v}`, items: [{ k: 'spd', spd: v }], why: `About ${Math.round(slot.waitS)} s short behind ${slot.clash?.cs ?? 'the one ahead'}. Slow it now and it will not need the hold.`, primary: true });
    }
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
        const climb = sim.ftOf(sl) > clearedFt + 50;
        const lvlItems: Item[] = climb ? [{ k: 'lvl', lvl: sl }] : lvlTo(sl);
        const why = climb ? `Going around below the stack: climb into it at ${lvlWords(sl)}, clear of the transitions starting at ${SF}.` : holders.length ? `${holders.length} holding ahead of it. Join the stack at ${lvlWords(sl)}.` : `No gap in the sequence yet. Hold at ${lvlWords(sl)} until there is one.`;
        add({ label: `Hold ${SF}${climb ? ' · ' + lvlLabel(sl) : lvlTag(sl)}`, items: [{ k: 'hold', fix: SF }, ...lvlItems], why: blkS ? `Wait: ${blkS.cs} is in the way down.` : why, primary: !blkS && !slowable });
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
    if (step && dStraight < 30) add({ label: `Descend ${lvlLabel(step)}`, items: [{ k: 'lvl', lvl: step }], why: 'Keep it coming down: about 3 NM per 1,000 ft.' });
  }
  if (ac.mode === 'HDG' && ac.tgtAlt > rw.ifAlt + 300) {
    const mva = sim.mvaAt(ac.p);
    const lv = levelList(sim).find((l) => sim.ftOf(l) <= ac.tgtAlt - 900 && sim.ftOf(l) >= Math.max(mva, rw.ifAlt));
    if (lv) add({ label: `Descend ${lvlLabel(lv)}`, items: [{ k: 'lvl', lvl: lv }], why: `Minimum vectoring altitude here is ${mva} ft.` });
  }
  if (ac.ias > 230 && dStraight < 25 && !ac.spdAssigned && !speedQuiet(sim, ac)) { const s = spdFor(sim, ac, 210); if (worthSlowing(ac, s)) add({ label: `Speed ${s}`, items: [{ k: 'spd', spd: s }], why: 'Slow it to make the sequence work.' }); }
}

interface DownwindCtx {
  SF: string; late: (etaS: number) => boolean; lateWhy: string; transLvlFor: (tr: Procedure | undefined, eta: number, leader?: Aircraft) => Level;
  lvlTo: (l: Level) => Item[]; lvlTag: (l: Level) => string; finalFt: number; d: number;
}
const isTransitionName = (sim: Sim, name?: string) => !!name && sim.pack.transitions.some((t) => t.name === name);
/** Lowest level clear of the holders at a stack fix: 1,000 ft above the highest (the stack builds upward), within the hold's band. */
/** A level as its nominal number of feet (FL070 is 7,000): levels are picked 1,000 ft apart in these, never in QNH feet. */
const nomOf = (l: Level) => (l.fl !== undefined ? l.fl * 100 : l.ft!);
/** The lowest nominal level from `want` up that is clear of the holders at a stack fix (the stack builds upward) and of everyone flying through it, inside the hold's band. */
function aboveStack(sim: Sim, ac: Aircraft, fix: string, want: number): number | undefined {
  const h = sim.pack.holds.find((x) => x.fix === fix);
  const lv = stackOf(sim, fix, ac).map((o) => nomOf(o.cflSys ?? o.cleared));
  let ft = lv.length ? Math.max(want, Math.max(...lv) + 1000) : want;
  ft = Math.round(ft / 1000) * 1000;
  while (lv.some((x) => Math.abs(x - ft) < 900)) ft += 1000;
  return h && ft > nomOf(h.max) ? undefined : ft;
}

/**
 * The shortcut off the downwind: direct to the final approach fix when that joins the final at 30 degrees or less with
 * the miles to get down, else a base heading 40 degrees to the final course that joins well outside the fix.
 */
function shortcutOf(sim: Sim, ac: Aircraft, rw: Sim['rwy'], ils: Item, appName: string, finalFt: number, lvlTo: (l: Level) => Item[], lvlTag: (l: Level) => string): { items: Item[]; label: string; nm: number; why: string; apply: (c: Aircraft) => void } | undefined {
  const fafNm = finalFixNmOf(sim, rw);
  const along = alongTrack(ac.p, rw.thr, norm360(rw.crs + 180));
  const xt = crossTrack(ac.p, rw.thr, rw.crs);
  if (along < fafNm + 4 || Math.abs(xt) > 12) return undefined;
  // already on its way to the final approach fix with the approach clearance
  if (ac.app && ac.mode === 'NAV' && ac.route.length === 1 && ac.route[0].fix === rw.faf) return undefined;
  const fafP = sim.fixP(rw.faf);
  const app = (c: Aircraft) => { c.app = { type: 'ILS', rwy: rw, locCap: false, gsCap: false }; (c as any)._holdAt = undefined; c.hold = undefined; };
  const brg = bearing(ac.p, fafP), dF = dist(ac.p, fafP);
  if (Math.abs(angDiff(rw.crs, brg)) <= 40 && dF >= 5) {
    const ft = Math.max(finalFt, Math.ceil(mvaAlong(sim, ac.p, fafP) / 500) * 500);
    if (dF >= ((ac.alt - ft) / 1000) * 3 + 2) {
      const l = sim.levelFor(ft);
      return {
        items: [{ k: 'dct', fix: rw.faf }, ...lvlTo(l), ils], label: `Direct ${rw.faf}${lvlTag(l)} · ${appName}`, nm: dF + fafNm,
        why: `Direct ${rw.faf} joins the final at ${Math.round(Math.abs(angDiff(rw.crs, brg)))}°, ${Math.round(dF)} NM to get down.`,
        apply: (c) => { c.route = [{ fix: rw.faf, p: fafP }]; c.mode = 'NAV'; c.tgtAlt = sim.ftOf(l); app(c); },
      };
    }
  }
  return undefined;
}

function downwind(sim: Sim, ac: Aircraft, add0: (s: Suggestion) => void, c: ArrCtx, x: DownwindCtx) {
  // one clearance at a time on the downwinds: while another arrival's readback is still to come, nothing here is the lead
  const busy = sim.aircraft.find((o) => o !== ac && !o.remove && o.kind === 'arr' && sim.readbackPending(o.cs));
  // and never a lead chip that the look-ahead says would bring it into a new conflict (whatever the clearance is)
  let base: Aircraft | null | undefined = null;
  const add = (sg: Suggestion) => {
    if (busy && sg.primary) { add0({ ...sg, primary: false, why: `${sg.why} (Wait for ${busy.cs}'s readback first.)` }); return; }
    if (sg.primary && sg.items.some((i) => i.k !== 'eat' && i.k !== 'roger')) {
      // never bright with a same-level warning showing
      const same = sim.validate({ cs: ac.cs, items: sg.items }).find((w) => w.startsWith('Same level as'));
      if (same) { add0({ ...sg, primary: false, why: `Wait: ${same}.` }); return; }
      if (base === null) base = predictedConflict(sim, ac, undefined, TRANSITION_HORIZON_S)?.with;
      const hit = predictedConflict(sim, ac, cloneApply(sim, ac, sg.items), TRANSITION_HORIZON_S)?.with;
      if (hit && hit !== base) { add0({ ...sg, primary: false, why: `Wait: ${hit.cs} would be in the way.` }); return; }
    }
    add0(sg);
  };
  const { rw, ils, appName, clearedFt } = c;
  const { late, lateWhy, transLvlFor, lvlTo, lvlTag, finalFt, d } = x;
  const expect: Item = { k: 'expect', app: (ils as Extract<Item, { k: 'app' }>).app, rwy: rw.id };
  const fafNm = finalFixNmOf(sim, rw);
  const stacks = sim.stackFixes(rw.id);
  // holding (or cleared to hold) at a downwind stack; a centre hold or DUS is left by the transition below
  const holdFix = ac.mode === 'HOLD' ? ac.hold?.fix : holdAtOf(sim, ac);
  const atStack = !!holdFix && stacks.includes(holdFix);
  const holding = atStack && ac.mode === 'HOLD';
  const toHold = atStack && ac.mode !== 'HOLD' ? holdFix : undefined;
  const trDir = sim.pack.transitions.find((t) => t.name === ac.proc)?.runways[0]?.slice(0, 2);
  const onTrans = !holding && !toHold && isTransitionName(sim, ac.proc) && trDir === rw.id.slice(0, 2) && ac.route.some((l) => l.fix === rw.ifFix || sim.isFinalFix(l.fix, rw.id));
  const members = new Set(sequenceMembers(sim));
  const hh = (t: number) => sim.utc(t).slice(0, 5).replace(':', '');
  // one approach clearance at a time: another arrival's readback of a clearance still to come changes the sequence
  const pendingOther = sim.aircraft.find((o) => o !== ac && !o.remove && o.kind === 'arr' && sim.readbackPending(o.cs));

  // ---- holding (or cleared to hold) on the downwind: lowest first, out by the shortcut or the rest of the transition
  if (holding || toHold) {
    const fix = ac.hold?.fix ?? toHold!;
    const lower = sim.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && !o.app && isHolder(sim, o, fix) && lvlFt(sim, o) < clearedFt - 50);
    const sc = shortcutOf(sim, ac, rw, ils, appName, finalFt, lvlTo, lvlTag);
    let out = sc;
    if (!out) {
      // the rest of the transition from the hold fix
      const rest = (ac.savedRoute?.[0]?.fix === fix ? ac.savedRoute : undefined) ?? bestTransition(sim, ac)?.legs.slice((bestTransition(sim, ac)?.legs.findIndex((l) => l.fix === fix) ?? -1));
      const next = rest && rest.length > 1 && rest[0].fix === fix ? rest[1] : undefined;
      if (next) {
        let nm = dist(ac.p, next.p);
        for (let i = rest!.indexOf(next) + 1; i < rest!.length; i++) nm += dist(rest![i - 1].p, rest![i].p);
        nm += Math.max(0, sim.dthr({ ...ac, p: rest![rest!.length - 1].p } as Aircraft));
        const need = ((ac.alt - finalFt) / 1000) * 3 + 3;
        const l = nm - fafNm >= need ? sim.levelFor(finalFt) : sim.levelFor(Math.max(finalFt, Math.min(clearedFt, finalFt + 1000)));
        out = { items: [{ k: 'dct', fix: next.fix }, ...lvlTo(l), ils], label: `${next.fix}${lvlTag(l)} · ${appName}`, nm, why: `Back onto the transition at ${next.fix}.`, apply: (cl: Aircraft) => { cl.route = rest!.slice(rest!.indexOf(next)).map((q) => ({ ...q })); cl.mode = 'NAV'; cl.hold = undefined; (cl as any)._holdAt = undefined; cl.tgtAlt = sim.ftOf(l); cl.app = { type: 'ILS', rwy: rw, locCap: false, gsCap: false }; } };
      }
    }
    if (out) {
      const slot = slotAt(sim, ac, out.nm);
      const blk = slot.ok && !lower.length ? predictedConflict(sim, ac, out.apply, TRANSITION_HORIZON_S, TRANSITION_VERT_FT)?.with : undefined;
      const ok = slot.ok && !lower.length && !blk && !late(slot.etaS) && !pendingOther;
      const why = late(slot.etaS) ? lateWhy : lower.length ? `Release the lowest first: ${lower[0].cs} is below it.` : blk ? `Wait: ${blk.cs} is in the way.` : pendingOther ? `Wait for ${pendingOther.cs}'s readback first.` : slot.ok ? `${slotWhy(slot)}. ${out.why}` : `No gap yet: ${slot.clash?.cs ?? 'the sequence'} is too close. About ${Math.max(1, Math.round(slot.waitS / 60))} min.`;
      add({ label: `Leave hold · ${out.label}`, items: out.items, why, primary: ok });
      if (!ok) {
        stackDescend(sim, ac, fix, clearedFt, add, true);
        if (holding) {
          const e = sim.efcFor(ac, fix);
          const moved = ac.efc !== undefined ? Math.abs(e.t - ac.efc) >= 300 : e.say !== null && e.t - sim.t >= 300;
          if (moved && e.say) add({ label: `EAT ${e.say}`, items: [{ k: 'eat' }], why: ac.efc !== undefined ? `Its expected approach time ${hh(ac.efc)} is out of date. Give the revised time.` : 'The delay has grown. Give it an expected approach time.', primary: ac.efc !== undefined && sim.t >= ac.efc - 30 });
        }
      }
    } else stackDescend(sim, ac, fix, clearedFt, add, true);
    return;
  }

  // ---- on its transition (cleared with "expect ILS", or with the approach already)
  if (onTrans) {
    const SF = stacks.find((f) => ac.route.some((l) => l.fix === f));
    const sf = shortfall(sim, ac);
    const holdersAhead = SF ? stackOf(sim, SF, ac).filter((o) => isHolder(sim, o, SF)) : [];
    // the shortcut, for the first of the arrivals not yet cleared for the approach
    const sc = shortcutOf(sim, ac, rw, ils, appName, finalFt, lvlTo, lvlTag);
    let scGo = false;
    if (sc && !holdersAhead.length) {
      const myEta = etaS(ac, d);
      const ahead = [...members].filter((o) => o !== ac && !o.app && etaS(o, trackNm(sim, o)) < myEta);
      const slot = slotAt(sim, ac, sc.nm);
      const hit = slot.ok && !ahead.length ? predictedConflict(sim, ac, sc.apply, TRANSITION_HORIZON_S)?.with : undefined;
      scGo = slot.ok && !ahead.length && !hit && !late(slot.etaS) && !pendingOther;
      add({ label: sc.label, items: sc.items, why: scGo ? `Shortcut: ${slotWhy(slot)}. ${sc.why}` : late(slot.etaS) ? lateWhy : pendingOther && slot.ok && !ahead.length && !hit ? `Wait for ${pendingOther.cs}'s readback first.` : ahead.length ? `${ahead[0].cs} is ahead of it and not yet cleared: it goes first.` : hit ? `Wait: ${hit.cs} is in the way.` : `Not yet: ${slot.clash?.cs ?? 'the one ahead'} would be too close. Keep it on the downwind.`, primary: scGo });
    }
    // the approach clearance with the descent for the final, in time for the glide
    const toFaf = Math.max(0, d - fafNm);
    const need = ((ac.alt - finalFt) / 1000) * 3 + 3;
    if (!scGo && !holdersAhead.length && (!ac.app || ac.tgtAlt > finalFt + 300) && toFaf <= need + 6) {
      const l = sim.levelFor(finalFt);
      const items: Item[] = [...lvlTo(l), ...(ac.app ? [] : [ils])];
      if (items.length) {
        const hit0 = lvlTo(l).length ? predictedConflict(sim, ac, (cl) => { cl.tgtAlt = finalFt; }, 300)?.with : undefined;
        // the descent near a downwind stack: never through the holders' levels
        const hit = (hit0 && hit0 !== predictedConflict(sim, ac, undefined, 300)?.with ? hit0 : undefined) ?? (lvlTo(l).length ? pathBlocker(sim, ac, finalFt, members) : undefined);
        // the approach clearance only with the gap behind the one ahead (else speed on the downwind first)
        const tight = !ac.app && !!sf.leader && sf.shortS > 30 ? sf : undefined;
        add({ label: `${lvlTo(l).length ? `Descend ${lvlLabel(l)}` : 'Cleared'}${ac.app ? '' : ` · ${appName}`}`, items, why: hit ? `Wait: ${hit.cs} is in the way down.` : tight ? `Not yet: ${tight.gapNm!.toFixed(1)} NM behind ${tight.leader!.cs}, needs ${tight.needNm} NM. Keep it on the downwind.` : `${toFaf.toFixed(0)} NM to the final approach fix: about ${need.toFixed(0)} NM needed to get down to ${lvlWords(l)}. The approach clearance comes with the descent.`, primary: toFaf <= need + 3 && !hit && !tight });
        // the way to the final altitude is not clear yet: part of the way now, 1,000 ft above it (the glide is captured from there)
        const l1 = sim.levelFor(finalFt + 1000);
        if (hit && lvlTo(l).length && sim.ftOf(l1) < clearedFt - 50 && !pathBlocker(sim, ac, sim.ftOf(l1), members) && !predictedConflict(sim, ac, (cl) => { cl.tgtAlt = sim.ftOf(l1); }, 300)) add({ label: `Descend ${lvlLabel(l1)}${ac.app ? '' : ` · ${appName}`}`, items: [{ k: 'lvl', lvl: l1 }, ...(ac.app ? [] : [ils])], why: `${hit.cs} is in the way to ${lvlWords(l)}: down to ${lvlWords(l1)} now, the rest on the glide.`, primary: toFaf <= need + 3 && !tight });
      }
    }
    // still high above the downwind level (no descent with the transition): down to it when the way is clear
    const ovl = transLvlFor(sim.pack.transitions.find((t) => t.name === ac.proc), etaS(ac, d));
    if (!scGo && sim.ftOf(ovl) < clearedFt - 50 && toFaf > need + 3) add({ label: `Descend ${lvlLabel(ovl)}`, items: [{ k: 'lvl', lvl: ovl }], why: `Down to ${lvlWords(ovl)} for the downwind.`, primary: !pathBlocker(sim, ac, sim.ftOf(ovl), members) });
    // too close behind the one ahead even on the full transition: speed first, then the downwind hold
    if (!scGo && sf.leader && sf.shortS > 0) {
      speedForSpacing(sim, ac, add);
      const holdable = !!SF && dist(ac.p, sim.fixP(SF)) > 2 && !ac.app;
      if (holdable && (sf.shortS > 90 || ac.spdMin || (ac.spdAssigned !== undefined && ac.spdAssigned <= ac.perf.vminClean + 10))) holdChip(sim, ac, SF!, clearedFt, add, `${sf.gapNm!.toFixed(1)} NM behind ${sf.leader.cs} even on the full transition. Hold it on the downwind.`);
    } else if (holdersAhead.length && SF && !ac.app) holdChip(sim, ac, SF, clearedFt, add, `${holdersAhead.length} holding at ${SF} ahead of it: they go first. Join the stack.`);
    return;
  }

  // ---- on the arrival (first contact), in a centre hold, after a missed approach, or on another direction's transition
  // after a runway change: the transition, a level and "expect ILS"
  const tr = bestTransition(sim, ac);
  if (!tr) return;
  const SF = stacks.find((f) => tr.legs.some((l) => l.fix === f));
  // close to the field (a missed approach, the DUS hold): join the transition at the start of its downwind
  const si = SF ? tr.legs.findIndex((l) => l.fix === SF) : -1;
  const join = Math.hypot(ac.p.x, ac.p.y) < 15 && si > 0 ? tr.legs[si - 1].fix : undefined;
  // in a centre hold: the lowest leaves first
  const lowerHere = holdFix ? sim.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && !o.app && isHolder(sim, o, holdFix) && lvlFt(sim, o) < clearedFt - 50) : [];
  const slot = slotFor(sim, ac, tr);
  let lvl = transLvlFor(tr, slot.etaS, slot.leader);
  let full = false;
  if (SF) {
    const above = aboveStack(sim, ac, SF, nomOf(lvl));
    if (above === undefined) full = true;
    else if (above > nomOf(lvl)) lvl = above > nomOf(ac.cleared) ? ac.cleared : sim.levelFor(above);
  }
  // the descent is checked along the transition as flown (a follower in trail behind it is no reason to keep it high)
  let blk: Aircraft | undefined;
  if (sim.ftOf(lvl) < clearedFt - 50 && predictedConflict(sim, ac, asCleared(sim, tr.name, sim.ftOf(lvl), rw.id), TRANSITION_HORIZON_S, TRANSITION_VERT_FT)) {
    const keep = predictedConflict(sim, ac, asCleared(sim, tr.name, clearedFt, rw.id), TRANSITION_HORIZON_S, TRANSITION_VERT_FT)?.with;
    if (!keep) { blk = predictedConflict(sim, ac, asCleared(sim, tr.name, sim.ftOf(lvl), rw.id), TRANSITION_HORIZON_S, TRANSITION_VERT_FT)?.with; lvl = ac.cleared; }
  }
  const items: Item[] = [...(ac.app ? [{ k: 'brk' } as Item] : []), { k: 'trans', name: tr.name }, ...(join ? [{ k: 'dct', fix: join } as Item] : []), ...lvlTo(lvl), expect];
  const tryIt = (cl: Aircraft) => { asCleared(sim, tr.name, sim.ftOf(lvl), rw.id)(cl); cl.app = undefined; if (join) { const i = cl.route.findIndex((q) => q.fix === join); if (i >= 0) cl.route = cl.route.slice(i); } };
  const hit = predictedConflict(sim, ac, tryIt, TRANSITION_HORIZON_S, TRANSITION_VERT_FT)?.with;
  // out of a hold: only into a slot
  const noSlot = !!holdFix && !slot.ok;
  const go = !late(slot.etaS) && !full && !hit && !lowerHere.length && !noSlot;
  const why = late(slot.etaS) ? lateWhy : full ? `The ${SF} stack is full.` : lowerHere.length ? `Release the lowest first: ${lowerHere[0].cs} is below it.` : noSlot ? `No gap yet: ${slot.clash?.cs ?? 'the sequence'} is too close. About ${Math.max(1, Math.round(slot.waitS / 60))} min.` : hit ? `Wait: ${hit.cs} is in the way.` : `${tr.name}${join ? ` from ${join}` : ''}, ${lvlWords(lvl)}${blk ? ` (${blk.cs} is in the way down: the descent comes later)` : ''}, and expect the ILS: it flies the published route at 220 kt. The approach clearance comes on the downwind.`;
  add({ label: `${ac.mode === 'HOLD' ? 'Leave hold · ' : ''}${tr.name}${join ? ` · ${join}` : ''}${lvlTag(lvl)} · expect ${appName}`, items, why, primary: go });
  if (full && !holdFix) {
    const remote = remoteHold(sim, ac);
    const entry = sim.entryFixOf(ac);
    // no centre hold on its feed: a hold at its entry fix, which the AIP does not publish, so ATC describes it
    const atEntry = !remote && ac.route.some((l) => l.fix === entry) && !stackOf(sim, entry, ac).some((o) => Math.abs(lvlFt(sim, o) - clearedFt) < 900);
    if (remote) add({ label: `Hold ${remote.fix} · ${lvlLabel(remote.lvl)}`, items: [{ k: 'hold', fix: remote.fix }, ...lvlTo(remote.lvl)], why: `The ${SF} stack is full. Hold it at ${remote.fix}, ${lvlWords(remote.lvl)}, until there is room.`, primary: true });
    else if (atEntry) add({ label: `Hold ${entry}`, items: [{ k: 'hold', fix: entry }], why: `The ${SF} stack is full and the centre has no hold on its feed: hold it at ${entry} (not a published hold: give the inbound track and the turns).`, primary: true });
    else if (!ac.spdMin && ac.spdAssigned === undefined) add({ label: 'Min clean speed', items: [{ k: 'spdmin' }], why: `The ${SF} stack is full. Slow it down to buy time.`, primary: true });
  }
  if (late(slot.etaS)) {
    const step = levelList(sim).find((l) => sim.ftOf(l) <= clearedFt - 1900 && sim.ftOf(l) >= sim.mvaAt(ac.p) + 500);
    if (step) add({ label: `Descend ${lvlLabel(step)}`, items: [{ k: 'lvl', lvl: step }], why: `${lateWhy} A level costs nothing to keep.`, primary: true });
  }
}

/** What a clearance would do to the aircraft, on a prediction clone (the lateral, vertical and speed parts of Sim.apply). */
function cloneApply(sim: Sim, ac: Aircraft, items: Item[]): (c: Aircraft) => void {
  return (c) => {
    for (const it of items) {
      switch (it.k) {
        case 'trans': {
          const tr = sim.pack.transitions.find((t) => t.name === it.name);
          if (!tr) break;
          const legs = tr.legs.map((l) => ({ ...l }));
          const i = c.route.findIndex((l) => l.fix === legs[0].fix);
          c.route = i >= 0 ? [...c.route.slice(0, i), ...legs] : dist(c.p, legs[0].p) >= 2 && sim.stacksOnTransitions ? sim.starJoin(c, legs) : legs.slice(dist(c.p, legs[0].p) < 2 ? 1 : 0);
          c.mode = 'NAV'; c.hold = undefined; c.proc = tr.name; (c as any)._holdAt = undefined;
          break;
        }
        case 'dct': {
          const i = c.route.findIndex((l) => l.fix === it.fix);
          const j = c.savedRoute?.findIndex((l) => l.fix === it.fix) ?? -1;
          const tl = sim.stacksOnTransitions && j < 0 ? sim.pack.transitions.find((t) => t.name === c.proc)?.legs : undefined;
          const k = tl ? tl.findIndex((l) => l.fix === it.fix) : -1;
          c.route = i >= 0 ? c.route.slice(i) : j >= 0 ? c.savedRoute!.slice(j) : k >= 0 ? tl!.slice(k).map((l) => ({ ...l })) : [{ fix: it.fix, p: sim.fixP(it.fix) }];
          c.mode = 'NAV'; c.hold = undefined; (c as any)._holdAt = undefined;
          break;
        }
        case 'hold': {
          const i = sim.stacksOnTransitions && c.mode === 'NAV' ? c.route.findIndex((l) => l.fix === it.fix) : -1;
          c.route = i >= 0 ? c.route.slice(0, i + 1) : [{ fix: it.fix, p: sim.fixP(it.fix) }];
          c.mode = 'NAV'; (c as any)._holdAt = it.fix;
          break;
        }
        case 'hdg': c.mode = 'HDG'; c.hdgAssigned = norm360(it.hdg + sim.pack.meta.magVar); c.route = []; c.hold = undefined; break;
        case 'lvl': c.tgtAlt = sim.ftOf(it.lvl); break;
        case 'spd': c.spdAssigned = it.spd; c.spdMin = false; break;
        case 'spdmin': c.spdMin = true; c.spdAssigned = undefined; break;
        case 'app': { const r = sim.pack.runways.get(it.rwy); if (r) c.app = { type: it.app, rwy: r, locCap: false, gsCap: false }; break; }
        default: break;
      }
    }
  };
}

/** A hold at a downwind stack fix at the lowest free level it can reach without meeting anyone on the way. */
function holdChip(sim: Sim, ac: Aircraft, SF: string, clearedFt: number, add: (s: Suggestion) => void, why: string) {
  // far from the stack (the BIKMU23 first leg crosses the final): hold at the present level, the descent into the stack comes near it
  if (dist(ac.p, sim.fixP(SF)) > 15) {
    const free = !stackOf(sim, SF, ac).some((o) => Math.abs(lvlFt(sim, o) - clearedFt) < 900);
    const h = sim.pack.holds.find((q) => q.fix === SF);
    if (free && h && clearedFt <= sim.ftOf(h.max) + 50 && clearedFt >= sim.ftOf(h.min) - 50) { add({ label: `Hold ${SF}`, items: [{ k: 'hold', fix: SF }], why, primary: true }); return; }
  }
  const tr = sim.pack.transitions.find((t) => t.name === ac.proc);
  const si = tr ? tr.legs.findIndex((l) => l.fix === SF) : -1;
  const beforeDownwind = si > 1 && ac.route.some((l) => l.fix === tr!.legs[si - 1].fix);
  const floor = beforeDownwind ? overlayFtOf(sim) : 0;
  const cands = stackLevels(sim, ac, SF).filter((l) => (l.fl !== undefined ? l.fl * 100 : l.ft!) >= floor);
  const members = new Set(sequenceMembers(sim));
  let sl: Level | undefined, blkS: Aircraft | undefined;
  for (const l of cands) {
    const ft = sim.ftOf(l);
    const b = (ft < ac.alt - 300 ? pathBlocker(sim, ac, ft, members) : undefined) ?? predictedConflict(sim, ac, (c) => { c.tgtAlt = ft; const i = c.route.findIndex((q) => q.fix === SF); if (i >= 0) c.route = c.route.slice(0, i + 1); (c as any)._holdAt = SF; })?.with;
    if (!b) { sl = l; blkS = undefined; break; }
    if (!sl) { sl = l; blkS = b; }
  }
  if (!sl) {
    // the downwind stack is full: the centre's holds, or slow down
    const remote = remoteHold(sim, ac);
    if (remote) add({ label: `Hold ${remote.fix} · ${lvlLabel(remote.lvl)}`, items: [{ k: 'hold', fix: remote.fix }, ...(sim.ftOf(remote.lvl) < clearedFt - 50 ? [{ k: 'lvl', lvl: remote.lvl } as Item] : [])], why: `The ${SF} stack is full. Hold it at ${remote.fix}, ${lvlWords(remote.lvl)}, for now.`, primary: true });
    else if (!ac.spdMin) add({ label: 'Min clean speed', items: [{ k: 'spdmin' }], why: `The ${SF} stack is full. Slow it down to buy time.`, primary: true });
    return;
  }
  const items: Item[] = [{ k: 'hold', fix: SF }];
  if (sim.ftOf(sl) < clearedFt - 50) items.push({ k: 'lvl', lvl: sl });
  add({ label: `Hold ${SF}${sim.ftOf(sl) < clearedFt - 50 ? ' · ' + lvlLabel(sl) : ''}`, items, why: blkS ? `Wait: ${blkS.cs} is in the way down.` : why, primary: !blkS });
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
  let want = spdFor(sim, ac, Math.min(ac.ias, sf.leader.ias) - 20);
  if (sim.approachOnDownwind && !ac.app?.locCap) {
    // never slower than one in trail behind it on the same route can fly (a heavy's clean speed is 220 kt)
    const next = ac.route[0]?.fix;
    const myNm = trackNm(sim, ac);
    for (const o of sim.aircraft) {
      if (o === ac || o.remove || o.kind !== 'arr' || o.app?.locCap || !next || !o.route.some((l) => l.fix === next)) continue;
      const behind = trackNm(sim, o) - myNm;
      if (behind > 0 && behind < 12) want = Math.max(want, Math.ceil(o.perf.vminClean / 10) * 10);
    }
  }
  if (!worthSlowing(ac, want)) return;
  // just slowed: give it time to work, unless the gap is still closing well below the minimum
  if (speedQuiet(sim, ac) && sf.shortS < 20) return;
  // slowing must not bring the one behind onto it (in trail on the same downwind)
  const behind = sim.approachOnDownwind ? predictedConflict(sim, ac, (c) => { c.spdAssigned = want; c.spdMin = false; }, 300)?.with : undefined;
  add({ label: `Speed ${want}`, items: [{ k: 'spd', spd: want }], why: behind ? `${sf.gapNm!.toFixed(1)} NM behind ${sf.leader.cs}, but slowing it brings ${behind.cs} onto it.` : `${sf.gapNm!.toFixed(1)} NM behind ${sf.leader.cs}, needs ${sf.needNm} NM. Slow it down.`, primary: !behind });
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
  const nearField = sim.entryFixes().filter((f) => dist(sim.fixP(f), { x: 0, y: 0 }) < 8);
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
