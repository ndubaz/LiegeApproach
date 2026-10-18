import type { Sim } from './sim';
import type { Aircraft } from './types';
import type { Procedure, Runway } from '../pack/load';
import { alongTrack, angDiff, bearing, crossTrack, dist, norm360 } from '../geo';
import { wakeMinNm } from './perf';
import { distToThr } from './pilot';
import { predict } from './predict';

// The arrival sequence as an approach controller keeps it in their head: who is committed to the
// final, roughly when each will touch down, and whether a newcomer fits between them with wake
// spacing to spare. Used by the suggestion chips (is the transition safe now?) and by the hold EFC.

/** Track length of a transition from its first fix to the threshold. */
export function transitionNm(tr: Procedure, r: Runway): number {
  let d = 0;
  for (let i = 1; i < tr.legs.length; i++) d += dist(tr.legs[i - 1].p, tr.legs[i].p);
  return d + distToThr(tr.legs[tr.legs.length - 1].p, r);
}

/** The STAR-to-final transition from the aircraft's stack fix whose first leg points most nearly at the aircraft. */
export function bestTransition(sim: Sim, ac: Aircraft) {
  const sf = sim.entryFixOf(ac);
  const all = sim.transitionsFor(sim.runway).filter((t) => !t.atcDiscretion);
  const mine = all.filter((t) => t.legs[0]?.fix === sf);
  const trs = mine.length ? mine : all;
  const alh = sim.pack.fixes.get(sf)?.p ?? sim.rwy.thr;
  const brgAc = bearing(alh, ac.p);
  let best = trs[0], bd = 999;
  for (const t of trs) {
    const leg = t.legs[1] ?? t.legs[0];
    const d = Math.abs(angDiff(bearing(alh, leg.p), brgAc));
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

const isTransition = (sim: Sim, name?: string) => !!name && sim.pack.transitions.some((t) => t.name === name);

/**
 * Track miles to touchdown along the path the aircraft will most likely fly:
 * on the localizer, on a published route (via the stack fix and `via` or the best transition), or on vectors.
 */
export function trackNm(sim: Sim, ac: Aircraft, via?: Procedure): number {
  const r = ac.app?.rwy ?? sim.pack.runways.get(ac.expectRwy ?? sim.runway) ?? sim.rwy;
  if (ac.app?.locCap) return Math.max(0, distToThr(ac.p, r));
  const stacks = sim.entryFixes(r.id);
  const alh = sim.pack.fixes.get(sim.entryFixOf(ac, r.id))?.p ?? r.thr;
  const tr = via ?? bestTransition(sim, ac);
  const trLen = tr ? transitionNm(tr, r) : 20;
  // a hold on the transition (the Düsseldorf downwind holds): the rest of the transition from the hold fix
  const restFrom = (fix: string): number | undefined => {
    if (!sim.stacksOnTransitions) return undefined;
    const legs = ac.savedRoute?.[0]?.fix === fix ? ac.savedRoute : tr?.legs.slice(tr.legs.findIndex((l) => l.fix === fix));
    if (!legs?.length || legs[0].fix !== fix) return undefined;
    const end = legs[legs.length - 1];
    if (end.fix !== r.ifFix && !sim.isFinalFix(end.fix, r.id)) return undefined;
    let d = 0;
    for (let i = 1; i < legs.length; i++) d += dist(legs[i - 1].p, legs[i].p);
    return d + Math.max(0, distToThr(end.p, r));
  };
  if (ac.mode === 'HOLD' && ac.hold) { const rest = restFrom(ac.hold.fix); return dist(ac.p, ac.hold.p) + (rest ?? (stacks.includes(ac.hold.fix) ? trLen : dist(ac.hold.p, r.thr) + 12)); }
  if (ac.mode === 'NAV' && ac.route.length) {
    let p = ac.p, d = 0;
    for (const l of ac.route) { d += dist(p, l.p); p = l.p; }
    const last = ac.route[ac.route.length - 1];
    if (last.fix === r.ifFix || sim.isFinalFix(last.fix, r.id)) return d + Math.max(0, distToThr(last.p, r));
    const rest = restFrom(last.fix);
    if (rest !== undefined) return d + rest;
    if (stacks.includes(last.fix)) return d + trLen;
    return d + dist(p, r.thr) + 12;
  }
  // on vectors (or at the end of its route)
  const out = distToThr(ac.p, r);
  const xt = Math.abs(crossTrack(ac.p, r.thr, r.crs));
  const outbound = Math.abs(angDiff(ac.trk, norm360(r.crs + 180))) < 60;
  if (out > 2 && xt < 15) {
    if (outbound) return 2 * (out + 4) + xt;     // downwind: out, base, back down the final
    return out + xt * 0.4 + 1;                   // base or intercept heading
  }
  return dist(ac.p, alh) + trLen;
}

/** Rough time in seconds to fly the last `d` NM to touchdown, with the usual speed profile and any speed limit. */
export function etaS(ac: Aircraft, d: number): number {
  const pf = ac.perf;
  const clean = Math.min(230, Math.max(200, pf.vminClean));
  const far = Math.max(clean, Math.min(250, Math.max(ac.ias, 220)));
  // [from NM, to NM, speed]
  const segs: [number, number, number][] = [[0, 4, pf.vapp], [4, 7, Math.max(pf.vapp, 160)], [7, 12, Math.max(pf.vapp, 180)], [12, 22, clean], [22, Infinity, far]];
  const limitFrom = ac.spdAssigned ? (ac.spdUntil ?? 6) : Infinity;
  // on the localizer the crew never speeds up without an instruction: no faster than it is now
  const cap = ac.app?.locCap && !ac.spdAssigned ? Math.max(ac.ias, pf.vapp) : Infinity;
  let t = 0;
  for (const [a, b, v0] of segs) {
    if (d <= a) break;
    const len = Math.min(d, b) - a;
    const v = Math.min(cap, a >= limitFrom - 0.01 ? Math.min(v0, Math.max(ac.spdAssigned!, pf.vapp)) : v0);
    t += (len / Math.max(60, v)) * 3600;
  }
  return t;
}
/** Track miles flown in the last `s` seconds before touchdown (the inverse of etaS). */
export function nmIn(ac: Aircraft, s: number): number {
  let lo = 0, hi = 80;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (etaS(ac, m) < s) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Time the follower needs behind the leader at the threshold: the wake (or 3 NM radar) minimum at its final speed. */
export const sepS = (lead: Aircraft, foll: Aircraft, sim?: Sim) => etaS(foll, sim ? sim.wakeMin(lead, foll, 3) : wakeMinNm(lead.perf.recat, foll.perf.recat, 3));

/** Arrivals committed to the final: cleared for the approach, on a transition, vectored near the final, or in an emergency. */
export function sequenceMembers(sim: Sim, except?: Aircraft): Aircraft[] {
  return sim.aircraft.filter((o) => {
    if (o === except || o.remove || o.landed || o.kind !== 'arr' || o.lowPass) return false;
    if (o.state === 'unconcerned') return false;
    // cleared for the approach (or in an emergency): committed, whatever hold instruction came before
    if (o.app || o.emergency) return true;
    if (o.mode === 'HOLD') return false;
    // on a transition to the final (an earlier hold instruction no longer counts once it is on one)
    if (o.mode === 'NAV' && o.route.some((l) => l.fix === sim.rwy.ifFix || l.fix === (o.expectRwy && sim.pack.runways.get(o.expectRwy)?.ifFix) || sim.isFinalFix(l.fix, o.expectRwy ?? sim.runway)) && isTransition(sim, o.proc)) return true;
    if ((o as any)._holdAt) return false;
    if (o.mode === 'HDG' && o.state === 'assumed') {
      const r = sim.rwy;
      return Math.abs(crossTrack(o.p, r.thr, r.crs)) < 12 && alongTrack(o.p, r.thr, norm360(r.crs + 180)) > -2 && dist(o.p, r.thr) < 25;
    }
    return false;
  });
}

/** The player's landing order, restricted to arrivals still flying: callsign to position (0 = first). */
export function seqIndex(sim: Sim): Map<string, number> {
  const m = new Map<string, number>();
  for (const cs of sim.sequence ?? []) { const a = sim.find(cs); if (a && !a.landed && a.kind === 'arr' && !m.has(cs)) m.set(cs, m.size); }
  return m;
}

/**
 * Every arrival with its time to touchdown, in landing order: by ETA, except that aircraft in the player's
 * sequence keep the player's order (they take the places the ETA order gives to sequenced aircraft).
 */
export function landingOrder(sim: Sim): { ac: Aircraft; etaS: number; pos: number; sequenced: boolean }[] {
  const arr = sim.aircraft.filter((a) => !a.remove && !a.landed && a.kind === 'arr' && a.state !== 'unconcerned')
    .map((ac) => ({ ac, etaS: etaS(ac, trackNm(sim, ac)) }))
    .sort((a, b) => a.etaS - b.etaS);
  const si = seqIndex(sim);
  const slots = arr.map((x, i) => (si.has(x.ac.cs) ? i : -1)).filter((i) => i >= 0);
  const seqd = arr.filter((x) => si.has(x.ac.cs)).sort((a, b) => si.get(a.ac.cs)! - si.get(b.ac.cs)!);
  const out = [...arr];
  slots.forEach((slot, k) => { out[slot] = seqd[k]; });
  return out.map((x, i) => ({ ...x, pos: i + 1, sequenced: si.has(x.ac.cs) }));
}

export interface Slot {
  /** the newcomer fits now with wake spacing to spare */
  ok: boolean;
  /** landing position if it goes now */
  pos: number;
  /** aircraft ahead of it at touchdown, and the predicted gap in NM */
  leader?: Aircraft;
  gapNm?: number;
  /** the aircraft that would end up too close (ahead or behind), when not ok */
  clash?: Aircraft;
  /** seconds of delay needed for a clear slot (0 when ok) */
  waitS: number;
  /** predicted seconds to touchdown if it goes now */
  etaS: number;
}

/** Margin on top of the wake minimum: more for an aircraft that is still far away (predictions are rough). */
const bufferS = (eta: number) => Math.min(60, 20 + eta * 0.035);

/** Would `ac`, sent now along `via` (or its current path), land clear of every committed arrival by the wake minimum? */
export function slotFor(sim: Sim, ac: Aircraft, via?: Procedure): Slot {
  return slotAt(sim, ac, trackNm(sim, ac, via));
}
/** The same check for a path of `d` track miles to touchdown (a shortcut off the transition). */
export function slotAt(sim: Sim, ac: Aircraft, d: number): Slot {
  const t = etaS(ac, d);
  const buf = bufferS(t);
  const others = sequenceMembers(sim, ac).map((o) => ({ o, t: etaS(o, trackNm(sim, o)) })).sort((a, b) => a.t - b.t);
  // the player's sequence fixes who goes first between two sequenced aircraft; otherwise the ETA decides
  const si = seqIndex(sim);
  const mine = si.get(ac.cs);
  const isAhead = (o: Aircraft, to: number, tc: number) => { const oi = si.get(o.cs); return mine !== undefined && oi !== undefined ? oi < mine : to <= tc; };
  // an aircraft on vectors near the final (not yet on the localizer) has a rough ETA: 30 s more margin either side
  const bufFor = (o: Aircraft) => buf + (o.mode === 'HDG' && !o.app?.locCap ? 30 : 0);
  const fits = (tc: number) => others.every(({ o, t: to }) => {
    if (isAhead(o, to, tc)) return tc - to >= sepS(o, ac, sim) + bufFor(o);
    // sequenced behind it but still able to give way (not yet on the localizer): its spacing is a later problem
    if (mine !== undefined && si.has(o.cs) && !o.app?.locCap) return true;
    return to - tc >= sepS(ac, o, sim) + bufFor(o);
  });
  const ok = fits(t);
  let waitS = 0;
  if (!ok) {
    const cands = others.map(({ o, t: to }) => to + sepS(o, ac, sim) + bufFor(o) - t).filter((x) => x > 0).sort((a, b) => a - b);
    waitS = cands.find((w) => fits(t + w)) ?? (cands.length ? cands[cands.length - 1] : 0);
  }
  const ahead = others.filter((x) => isAhead(x.o, x.t, t)).sort((a, b) => a.t - b.t);
  const lead = mine !== undefined ? ahead.filter((x) => si.has(x.o.cs)).sort((a, b) => si.get(a.o.cs)! - si.get(b.o.cs)!).pop() ?? ahead[ahead.length - 1] : ahead[ahead.length - 1];
  let clash: Aircraft | undefined;
  if (!ok) clash = others.find(({ o, t: to }) => (isAhead(o, to, t) ? t - to < sepS(o, ac, sim) + buf : !(mine !== undefined && si.has(o.cs) && !o.app?.locCap) && to - t < sepS(ac, o, sim) + buf))?.o;
  const pos = mine !== undefined ? (landingOrder(sim).find((x) => x.ac === ac)?.pos ?? ahead.length + 1) : ahead.length + 1;
  return { ok, pos, leader: lead?.o, gapNm: lead ? nmIn(ac, Math.max(0, t - lead.t)) : undefined, clash, waitS, etaS: t };
}

/** For an aircraft already in the sequence: the one ahead of it and how many seconds short of the spacing it is (negative = spare). */
export function shortfall(sim: Sim, ac: Aircraft): { leader?: Aircraft; shortS: number; gapNm?: number; needNm?: number } {
  const t = etaS(ac, trackNm(sim, ac));
  const si = seqIndex(sim);
  const mine = si.get(ac.cs);
  const members = sequenceMembers(sim, ac).map((o) => ({ o, t: etaS(o, trackNm(sim, o)) }));
  // in the player's sequence the leader is the sequenced aircraft just before it
  const seqLead = mine !== undefined ? members.filter((x) => (si.get(x.o.cs) ?? Infinity) < mine).sort((a, b) => si.get(b.o.cs)! - si.get(a.o.cs)!)[0] : undefined;
  const ahead = seqLead ?? members.filter((x) => x.t <= t).sort((a, b) => b.t - a.t)[0];
  if (!ahead) return { shortS: -Infinity };
  const need = sepS(ahead.o, ac, sim) + 15;
  return { leader: ahead.o, shortS: need - (t - ahead.t), gapNm: nmIn(ac, Math.max(0, t - ahead.t)), needNm: sim.wakeMin(ahead.o, ac, 3) };
}

/** Try a transition, level and approach clearance on a prediction clone (what Sim.apply would do). */
export function asCleared(sim: Sim, trName: string | undefined, ft: number | undefined, rwyId: string): (c: Aircraft) => void {
  return (c) => {
    const tr = trName ? sim.pack.transitions.find((t) => t.name === trName) : undefined;
    if (tr) {
      const legs = tr.legs.map((l) => ({ ...l }));
      const i = c.route.findIndex((l) => l.fix === legs[0].fix);
      c.route = i >= 0 ? [...c.route.slice(0, i), ...legs] : legs.slice(dist(c.p, legs[0].p) < 2 ? 1 : 0);
      c.mode = 'NAV'; c.hold = undefined; c.proc = tr.name; (c as any)._holdAt = undefined;
    }
    if (ft !== undefined) c.tgtAlt = ft;
    const r = sim.pack.runways.get(rwyId);
    if (r) { c.app = { type: 'ILS', rwy: r, locCap: false, gsCap: false }; (c as any)._holdAt = undefined; }
  };
}

/** Look-ahead for a transition or approach clearance: long enough to cover the whole transition to the final. */
export const TRANSITION_HORIZON_S = 600;

/**
 * The first aircraft this one would lose separation with (3 NM, 1,000 ft) in the next `horizon` seconds,
 * stepping the real pilot model for everyone; `mutate` tries a candidate clearance first.
 */
export function predictedConflict(sim: Sim, ac: Aircraft, mutate?: (c: Aircraft) => void, horizon = 300, vertFt = 950): { with: Aircraft; t: number } | undefined {
  const on10 = (q: { t: number }) => Math.abs(q.t / 10 - Math.round(q.t / 10)) < 1e-6;
  const mine = predict(sim, ac, horizon, 10, mutate, 2.5).filter(on10);
  const prev = (sim as any)._predCache as { t: number; h: number; m: Map<Aircraft, ReturnType<typeof predict>> } | undefined;
  const cache = prev && prev.t === sim.t && prev.h === horizon ? prev.m : new Map<Aircraft, ReturnType<typeof predict>>();
  (sim as any)._predCache = { t: sim.t, h: horizon, m: cache };
  let best: { with: Aircraft; t: number } | undefined;
  for (const o of sim.aircraft) {
    if (o === ac || o.remove || o.landed || o.rules === 'VFR' || o.state === 'unconcerned' || dist(o.p, ac.p) > 40) continue;
    let theirs = cache.get(o);
    if (!theirs) { theirs = predict(sim, o, horizon, 10, undefined, 2.5).filter(on10); cache.set(o, theirs); }
    const n = Math.min(mine.length, theirs.length);
    for (let i = 0; i < n; i++) {
      const a = mine[i], b = theirs[i];
      if (a.t !== b.t) break;
      const near = (q: typeof a) => Math.hypot(q.p.x, q.p.y) < 4 && q.alt < 1500 && !q.locCap;
      if (near(a) || near(b)) continue;
      if (a.locCap && b.locCap) continue; // spacing on the final is the slot check's job
      // the wider margin applies against traffic descending on the final (the turn onto the transition over short final)
      if (dist(a.p, b.p) < 3.2 && Math.abs(a.alt - b.alt) < (b.locCap ? vertFt : 950)) { if (!best || a.t < best.t) best = { with: o, t: a.t }; break; }
    }
  }
  return best;
}
