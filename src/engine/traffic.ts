import { Rng } from './rng';
import type { Scenario, ScEvent, SpawnSpec, Storm } from './types';
import { isDst, parseMetar, presetMetar, selectConfig } from './weather';
import { PERF } from './perf';
import { bearing, dist, move, type XY } from '../geo';
import { parseLevel, type Level, type Pack } from '../pack/load';
import type { OperatorSpec, PatternSpec, PhaseSpec, TemplateSpec, TrafficSpec } from '../pack/types';
import { areaSpoken } from './clearance';

// Traffic generation reads everything from the pack's `traffic` block (operators, the demand curve, STAR and SID
// weights, transient-traffic patterns, templates). A pack without one gets believable defaults derived from its
// procedures and a generic regional day.

export type Op = { op: string; types: string[]; w: number };

/** A generic passenger mix for packs that list no operators. */
const GENERIC_PAX: Op[] = [
  { op: 'DLH', types: ['A320', 'A321', 'A20N'], w: 3 }, { op: 'EWG', types: ['A320', 'A319'], w: 3 }, { op: 'RYR', types: ['B738', 'B38M'], w: 2 },
  { op: 'EZY', types: ['A320', 'A20N'], w: 2 }, { op: 'KLM', types: ['B738', 'E190'], w: 1 }, { op: 'THY', types: ['A321', 'B738'], w: 1 },
];
const GENERIC_CARGO: Op[] = [{ op: 'FDX', types: ['B763', 'B77L'], w: 2 }, { op: 'UPS', types: ['B763'], w: 1 }, { op: 'DHK', types: ['B763', 'A306'], w: 2 }];

export const ARR_STAR_BASES = [{ base: 'KOK7', w: 3 }, { base: 'CIV7', w: 3 }, { base: 'NIK7', w: 2 }, { base: 'LNO6', w: 3 }, { base: 'GESLO6', w: 2 }];
/** The STAR of a family for a runway: the pack's STAR whose name starts with `base` and serves `rwy` (KOK7 + 22L = KOK7X at Liège). */
export const starFor = (base: string, rwy: string, pack?: Pack) => pack?.stars.find((s) => s.name.startsWith(base) && s.name.length === base.length + 1 && s.runways.includes(rwy))?.name ?? base + (rwy.startsWith('22') ? 'X' : 'D');
/** The STAR families (name without the runway letter) that serve a runway. */
export function starBasesFor(pack: Pack, rwy: string): string[] {
  const out: string[] = [];
  for (const s of pack.stars) if (s.runways.includes(rwy) && !s.atcDiscretion) { const b = s.name.slice(0, -1); if (!out.includes(b)) out.push(b); }
  return out;
}
/** Weighted STAR families for a runway, in a bank phase or not, from the pack (default: every family, equal weight). */
export function arrivalWeights(pack: Pack, rwy: string, bank: boolean): { w: number; v: string }[] {
  const t = pack.spec.traffic;
  const spec: { base: string; w: number; wBank?: number }[] | undefined = bank && t?.arrivalsBank?.length ? t.arrivalsBank : t?.arrivals;
  const bases = starBasesFor(pack, rwy);
  if (spec?.length) {
    const out = spec.filter((a) => bases.includes(a.base) || pack.stars.some((s) => s.name.startsWith(a.base) && s.runways.includes(rwy))).map((a) => ({ w: bank ? a.wBank ?? a.w : a.w, v: a.base }));
    if (out.length) return out;
  }
  return bases.map((b) => ({ w: 1, v: b }));
}
/** Weighted SIDs of a runway from the pack (default: every non-discretionary SID, equal weight). */
export function sidWeights(pack: Pack, rwy: string): { w: number; v: string }[] {
  const spec = pack.spec.traffic?.departures;
  const sids = pack.sids.filter((s) => s.runways.includes(rwy) && !s.atcDiscretion);
  if (spec?.length) {
    const out = spec.filter((d) => sids.some((s) => s.name === d.name)).map((d) => ({ w: d.w, v: d.name }));
    if (out.length) return out;
  }
  return sids.map((s) => ({ w: 1, v: s.name }));
}
export const sidFor = (rng: Rng, rwy: string, pack: Pack) => rng.weighted(sidWeights(pack, rwy));

export class CallsignPool {
  used = new Set<string>();
  constructor(private rng: Rng, private registration: { prefix: string; length: number } = { prefix: 'OO', length: 5 }) {}
  make(op: string): string {
    for (let i = 0; i < 50; i++) {
      const n = this.rng.chance(0.5) ? this.rng.int(10, 999) : this.rng.int(1000, 9899);
      const suffix = this.rng.chance(0.25) ? String.fromCharCode(65 + this.rng.int(0, 25)) : '';
      const cs = `${op}${n}${suffix}`;
      if (!this.used.has(cs)) { this.used.add(cs); return cs; }
    }
    return `${op}${this.used.size + 100}`;
  }
  /** A registration mark: the pack's prefix plus random letters (OO-xxx at Liège, D-Exxx in Germany). */
  reg(): string {
    const L = 'ABCDEFGHIJKLMNOPRSTUVW';
    const { prefix, length } = this.registration;
    let cs = prefix;
    for (let i = prefix.length; i < length; i++) cs += L[this.rng.int(0, L.length - 1)];
    this.used.add(cs);
    return cs;
  }
}

export interface FreePlayOpts {
  template: 'night' | 'day' | 'quiet' | 'shift';
  /** Session length the player picked. Traffic is generated over the first (durationMin - 15) minutes. */
  durationMin: number;
  military: 0 | 1 | 2 | 3;
  weather: 'good' | 'windy-ne' | 'lvp' | 'storms' | 'live';
  liveMetar?: string;
  emergencies: boolean;
  difficulty: 1 | 2 | 3 | 4 | 5;
  seed?: number;
  /**
   * Start time, UTC hours (e.g. 1.5 for 01:30). When set, the traffic follows the airport's real day
   * (the pack's demand curve) from that time instead of the template's flat rates or compressed night.
   */
  startHour?: number;
  // ---- 2.0 free-play designer (all optional; the UI shows the sliders designerOptions(pack) lists) ----
  /** Traffic mix as shares (they need not sum to 1): cargo and passenger split the scheduled traffic; ga and mil add VFR / military movements on top. */
  mix?: { cargo: number; pax: number; ga: number; mil: number };
  /** Weather trend over the session. */
  trend?: 'steady' | 'deteriorating' | 'improving' | 'wind-shift';
  /** Reserved-area activity: 0 none, 1 one activation, 2 two (needs a pack with `traffic.reserved`). */
  reserved?: 0 | 1 | 2;
  /** Expected emergencies per hour (0 to 2). Overrides `emergencies` when set. */
  emergencyRate?: number;
  /** 2.0 review: calendar date of the session (yyyy-mm-dd): summer time moves the airport's local day one hour earlier in UTC. */
  date?: string;
}

/** What the free-play designer can offer at an airport: which sliders make sense and what the pack calls things. */
export function designerOptions(pack: Pack): { mix: { cargo: boolean; pax: boolean; ga: boolean; mil: boolean }; reserved?: string; trends: NonNullable<FreePlayOpts['trend']>[]; templates: Record<string, TemplateSpec>; curfew?: string } {
  const t = pack.spec.traffic;
  const ops = opsOf(pack);
  return {
    mix: { cargo: ops.cargo.length > 0 && ops.cargo !== ops.pax, pax: ops.pax.length > 0, ga: true, mil: (t?.patterns ?? []).some((p) => p.kind === 'mil') || (t?.military?.length ?? 0) > 0 },
    reserved: t?.reserved?.name,
    trends: ['steady', 'deteriorating', 'improving', 'wind-shift'],
    templates: templatesOf(pack),
    curfew: curfewText(pack),
  };
}

/** The night flight restriction in words: "22:00 to 06:00 local", or per movement type where the pack splits it. */
export function curfewText(pack: Pack): string | undefined {
  const c = pack.spec.curfew;
  if (!c) return undefined;
  if (c.arrFromLocal) return `take-offs ${c.fromLocal} to ${c.toLocal}, landings ${c.arrFromLocal} to ${c.arrToLocal ?? c.toLocal} local`;
  return `${c.fromLocal} to ${c.toLocal} local`;
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h + (m || 0) / 60; };
const inWindow = (h: number, from: number, to: number) => (from <= to ? h >= from && h < to : h >= from || h < to);
/**
 * 2.0 review: the movement is inside the night restriction at this local time (hours). Departures: `fromLocal` to
 * `toLocal`. Arrivals: landings after the latest delayed landing (`arrLateLocal`, else `arrFromLocal`) until `arrToLocal`.
 */
export function inCurfew(pack: Pack, kind: 'arr' | 'dep', localH: number): boolean {
  const c = pack.spec.curfew;
  if (!c) return false;
  if (kind === 'dep') return inWindow(((localH % 24) + 24) % 24, hm(c.fromLocal), hm(c.toLocal));
  const from = c.arrLateLocal ?? c.arrFromLocal ?? c.fromLocal, to = c.arrToLocal ?? c.toLocal;
  return inWindow(((localH % 24) + 24) % 24, hm(from), hm(to));
}
/** The airport's local offset from UTC for a session (summer time when the date is in it). */
export const localOffsetOf = (pack: Pack, date?: string) => pack.utcOffsetWinter + (date && isDst(date) ? 1 : 0);

/** The engine's fallback templates (a cargo hub's night and day); packs give their own in `traffic.templates`. */
export const TEMPLATES: Record<'night' | 'day' | 'quiet' | 'shift', TemplateSpec> = {
  night: { title: 'Night bank', arrPerHr: 18, depPerHr: 9, start: '01:40', paxShare: 0 },
  day: { title: 'Daytime mix', arrPerHr: 11, depPerHr: 9, start: '10:15', paxShare: 0.25 },
  quiet: { title: 'Quiet hour', arrPerHr: 6, depPerHr: 4, start: '15:30', paxShare: 0.2 },
  /** Average rates; the real shape is SHIFT_CURVE. */
  shift: { title: 'Night shift', arrPerHr: 14, depPerHr: 6, start: '01:40', paxShare: 0 },
};

/** The free-play templates of a pack: its own, or ones derived from its demand curve (busiest night hour, busiest day hour, quietest hour). */
export function templatesOf(pack: Pack): Record<'night' | 'day' | 'quiet' | 'shift', TemplateSpec> {
  const own = pack.spec.traffic?.templates;
  if (own?.night && own.day && own.quiet && own.shift) return own as Record<'night' | 'day' | 'quiet' | 'shift', TemplateSpec>;
  const curve = curveOf(pack);
  const at = (h: number) => shiftCurveForHour(h, curve);
  const busiest = (from: number, to: number) => {
    let best = from, bv = -1;
    for (let h = from; h < to; h += 0.25) { const m = at(h); if (m.arr + m.dep > bv) { bv = m.arr + m.dep; best = h; } }
    return best;
  };
  const quietest = () => {
    let best = 12, bv = Infinity;
    for (let h = 0; h < 24; h += 0.25) { const m = at(h); const v = m.arr + m.dep; if (v > 0 && v < bv) { bv = v; best = h; } }
    return best;
  };
  const off = pack.utcOffsetWinter;
  const tpl = (h: number, title?: string): TemplateSpec => { const m = at(h); return { title: title ?? cap(m.label), arrPerHr: Math.max(1, Math.round(m.arr)), depPerHr: Math.max(1, Math.round(m.dep)), start: hhmmOfHour(h), paxShare: m.paxShare }; };
  const peak = busiest(0, 24);
  const derived = {
    night: tpl(busiest(22 - off, 30 - off)),
    day: tpl(busiest(8 - off, 18 - off)),
    quiet: tpl(quietest(), 'Quiet hour'),
    shift: tpl(Math.max(0, peak - 0.33), `${cap(at(peak).label)} shift`),
  };
  return { ...derived, ...own } as Record<'night' | 'day' | 'quiet' | 'shift', TemplateSpec>;
}

// ---------------------------------------------------------------------------
// Demand curve for the 'shift' template: a cargo night, as fractions of the traffic window.
// Rates are movements per hour, linear between points.
export type Phase = 'warmup' | 'bank' | 'crossover' | 'tail';
export const SHIFT_PHASES: { name: Phase; from: number; to: number }[] = [
  { name: 'warmup', from: 0, to: 0.15 },
  { name: 'bank', from: 0.15, to: 0.5 },
  { name: 'crossover', from: 0.5, to: 0.8 },
  { name: 'tail', from: 0.8, to: 1 },
];
export const SHIFT_CURVE = {
  arr: [[0, 6], [0.15, 6], [0.2, 24], [0.5, 24], [0.8, 4], [1, 2]] as [number, number][],
  dep: [[0, 2], [0.15, 1], [0.5, 0], [0.8, 20], [1, 10]] as [number, number][],
};
/** Longest warm-up before the bank starts, seconds: the first bank arrivals call within about 4 minutes. */
export const WARMUP_MAX_S = 240;
/** Shift phases for a traffic window of `windowS` seconds: a warm-up of at most 4 minutes, then the bank. */
export function shiftPhases(windowS: number): { name: Phase; from: number; to: number }[] {
  const w = Math.min(0.15, WARMUP_MAX_S / Math.max(1, windowS));
  return SHIFT_PHASES.map((p) => (p.name === 'warmup' ? { ...p, to: w } : p.name === 'bank' ? { ...p, from: w } : p));
}
/** Arrival rate curve for a traffic window of `windowS` seconds (the warm-up shortened as in shiftPhases). */
export function shiftArrCurve(windowS: number): [number, number][] {
  const w = shiftPhases(windowS)[0].to;
  const ramp = Math.min(0.05, 120 / Math.max(1, windowS));
  return [[0, 6], [w, 6], [w + ramp, 24], [0.5, 24], [0.8, 4], [1, 2]];
}
/** Piecewise-linear interpolation of a [x, y] curve. */
export function curveAt(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    const [x0, y0] = curve[i - 1];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return curve[curve.length - 1][1];
}
/** Spawn times (s) for a non-homogeneous Poisson process with rate(t) per hour, by thinning. */
export function poissonTimes(rng: Rng, windowS: number, ratePerHr: (t: number) => number, maxPerHr: number): number[] {
  const out: number[] = [];
  if (maxPerHr <= 0) return out;
  let t = 0;
  for (;;) {
    t += (-Math.log(1 - rng.next()) * 3600) / maxPerHr;
    if (t >= windowS) break;
    if (rng.next() * maxPerHr <= ratePerHr(t)) out.push(Math.round(t));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The airport's day (UTC): movements per hour as piecewise-linear curves with named phases.
export type HourPhase = string;
export type HourCurve = NonNullable<TrafficSpec['curve']>;
/** A generic regional day for packs without a curve: a morning wave, a steady day, an evening wave, little at night. */
export const DEFAULT_CURVE: HourCurve = {
  arr: [[0, 1], [4, 1], [5, 4], [6, 12], [8, 14], [10, 10], [13, 12], [16, 14], [19, 12], [21, 8], [22.5, 3], [24, 1]],
  dep: [[0, 1], [4, 1], [5, 8], [6, 16], [8, 12], [10, 10], [13, 12], [16, 12], [19, 10], [21, 4], [22.5, 2], [24, 1]],
  max: { arr: 14, dep: 16 },
  phases: [
    { from: 0, to: 5, phase: 'night', label: 'quiet night', paxShare: 0.6 },
    { from: 5, to: 9, phase: 'morning', label: 'morning wave', paxShare: 0.9 },
    { from: 9, to: 16, phase: 'day', label: 'daytime flow', paxShare: 0.9 },
    { from: 16, to: 21, phase: 'evening', label: 'evening wave', paxShare: 0.9 },
    { from: 21, to: 24, phase: 'night', label: 'late evening', paxShare: 0.8 },
  ],
};
/** The pack's demand curve: `traffic.curve`, else built from the hourly `demand` table (local time), else the generic day. */
export function curveOf(pack: Pack, offsetH = pack.utcOffsetWinter): HourCurve {
  const t = pack.spec.traffic;
  if (t?.curve) return t.curve;
  if (t?.demand?.length === 24) {
    const off = offsetH;
    const arr: [number, number][] = [], dep: [number, number][] = [];
    for (let u = 0; u <= 24; u++) {
      const d = t.demand[(((u + off) % 24) + 24) % 24];
      // an even split unless the pack gives arrivals and departures (Düsseldorf: the 06:00 departure wave, the 22:00 arrivals)
      arr.push([u, d.arr ?? d.perHour / 2]); dep.push([u, d.dep ?? d.perHour / 2]);
    }
    const phases: PhaseSpec[] = [];
    for (let u = 0; u < 24; u++) {
      const d = t.demand[(((u + off) % 24) + 24) % 24];
      const phase = d.perHour === 0 ? 'curfew' : d.perHour >= 20 ? 'wave' : 'day';
      const label = d.perHour === 0 ? 'night curfew' : d.perHour >= 20 ? 'peak wave' : 'steady flow';
      const last = phases[phases.length - 1];
      if (last && last.phase === phase && Math.abs(last.paxShare - d.paxShare) < 0.01) last.to = u + 1;
      else phases.push({ from: u, to: u + 1, phase, label, paxShare: d.paxShare });
    }
    const max = { arr: Math.max(...arr.map((x) => x[1])), dep: Math.max(...dep.map((x) => x[1])) };
    return { arr, dep, max, phases };
  }
  return DEFAULT_CURVE;
}
/** Traffic mix at a UTC hour (fractional hours, any value; wraps at 24). */
export function shiftCurveForHour(hourUtc: number, curve: HourCurve = DEFAULT_CURVE): { arr: number; dep: number; phase: HourPhase; label: string; paxShare: number } {
  const h = ((hourUtc % 24) + 24) % 24;
  const ph = curve.phases.find((p) => h >= p.from && h < p.to) ?? curve.phases[0];
  return { arr: curveAt(curve.arr, h), dep: curveAt(curve.dep, h), phase: ph.phase, label: ph.label, paxShare: ph.paxShare };
}
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
/** A wind direction as a word: "north-easterly". */
export const compassName = (dir: number) => ['northerly', 'north-easterly', 'easterly', 'south-easterly', 'southerly', 'south-westerly', 'westerly', 'north-westerly'][Math.round((((dir % 360) + 360) % 360) / 45) % 8];
const hhmmOfHour = (h: number) => { const m = Math.round((((h % 24) + 24) % 24) * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------
// Centre handover rules.
/** Ground speed of an arrival on the STAR at handover, NM per minute (measured 4.6 to 5.0; conservative). */
export const ARR_NM_PER_MIN = 4.5;
export const HANDOVER_TRAIL_NM = 10;
const lvlFt = (l: Level) => (l.fl !== undefined ? l.fl * 100 : l.ft ?? 0);
const lvlUp = (l: Level): Level => (l.fl !== undefined ? { fl: l.fl + 10 } : { ft: (l.ft ?? 0) + 1000 });
/** Point `d` track miles before the end of a STAR (the same walk-back the sim uses to spawn). */
export function starPoint(pack: Pack, starName: string, d: number): XY | undefined {
  const star = pack.stars.find((s) => s.name === starName);
  if (!star) return undefined;
  const pts = star.legs.map((l) => l.p);
  let remaining = Math.max(0, d);
  for (let i = pts.length - 1; i > 0; i--) {
    const seg = dist(pts[i - 1], pts[i]);
    if (remaining <= seg) return move(pts[i], bearing(pts[i], pts[i - 1]), remaining);
    remaining -= seg;
  }
  const b = pts.length > 1 ? bearing(pts[1], pts[0]) : bearing({ x: 0, y: 0 }, pts[0]);
  return move(pts[0], b, remaining);
}

interface ArrTrack { spec: SpawnSpec; key: string; level: Level; at: (dRemain: number) => XY; /** fixes the STAR passes (for merges between different STARs) */ fixes?: string[]; /** track miles from the handover to each fix */ nmTo?: Record<string, number> }
function trackOf(pack: Pack, s: SpawnSpec): ArrTrack | undefined {
  if (s.kind !== 'arr') return undefined;
  if (s.unfamiliar) {
    // diversions without a STAR come in from the north-west, straight at the field
    return { spec: s, key: 'DIVERT', level: s.level ?? { fl: 80 }, at: (d) => move({ x: 0, y: 0 }, pack.spec.traffic?.diversion?.brg ?? 300, Math.max(0, d)) };
  }
  const star = pack.stars.find((x) => x.name === s.star);
  if (!star) return undefined;
  // track miles from the handover point to each STAR fix: the whole remaining STAR length minus the length after the fix
  const D = s.spawnDist ?? 42;
  const after = (i: number) => { let d = 0; for (let k = i; k < star.legs.length - 1; k++) d += dist(star.legs[k].p, star.legs[k + 1].p); return d; };
  const nmTo: Record<string, number> = {};
  star.legs.forEach((l, i) => { nmTo[l.fix] = D - after(i); });
  return { spec: s, key: star.name, level: s.level ?? star.handoffLevel, at: (d) => starPoint(pack, star.name, d)!, fixes: star.legs.map((l) => l.fix), nmTo };
}
/**
 * Two arrivals on different STARs that share a fix (KOK7X and CIV7X join at GILOM): the seconds between their arrivals
 * over the first common fix, flying at the handover speed. Infinity when they share nothing.
 */
function joinGapS(a: ArrTrack, b: ArrTrack, ta: number, tb: number): number {
  if (!a.fixes || !b.fixes || a.key === b.key) return Infinity;
  const common = a.fixes.find((f) => b.fixes!.includes(f) && (a.nmTo![f] ?? -1) >= 0 && (b.nmTo![f] ?? -1) >= 0);
  if (!common) return Infinity;
  const tA = ta + (a.nmTo![common] / ARR_NM_PER_MIN) * 60, tB = tb + (b.nmTo![common] / ARR_NM_PER_MIN) * 60;
  return Math.abs(tA - tB);
}
/** Distance between the two aircraft at the moment the later one is handed over (ignores controller action). */
function handoverGap(a: ArrTrack, b: ArrTrack, ta: number, tb: number): number {
  const [lead, foll, tl, tf] = ta <= tb ? [a, b, ta, tb] : [b, a, tb, ta];
  const dl = (lead.spec.spawnDist ?? 42) - ((tf - tl) / 60) * ARR_NM_PER_MIN;
  if (dl < 0) return 99; // leader has reached the end of its STAR (or is being worked); far from the entry
  return dist(lead.at(dl), foll.at(foll.spec.spawnDist ?? 42));
}

/**
 * Brussels ACC never hands over two arrivals on the same STAR closer than 10 NM in trail at the
 * same level. Where they would be, the follower is handed over 1,000 ft higher (FL080 vs FL090);
 * if that level is also taken, it is held back. Mutates the arrival specs in place (t, level).
 */
export function separateHandovers(pack: Pack, spawns: SpawnSpec[], minNm = HANDOVER_TRAIL_NM): SpawnSpec[] {
  const arrs = spawns.filter((s) => s.kind === 'arr').sort((a, b) => a.t - b.t);
  const placed: ArrTrack[] = [];
  for (const s of arrs) {
    const base = trackOf(pack, s);
    if (!base) continue;
    const fixedLevel = s.level !== undefined;
    const levels: Level[] = fixedLevel ? [s.level!] : [base.level, lvlUp(base.level)];
    let t = s.t;
    let chosen: Level | undefined;
    for (let tries = 0; tries < 80 && !chosen; tries++) {
      for (const L of levels) {
        const me: ArrTrack = { ...base, level: L };
        const clash = placed.some((p) => Math.abs(lvlFt(p.level) - lvlFt(L)) < 1000 && ((p.key === me.key && handoverGap(p, me, p.spec.t, t) < minNm + 1) || joinGapS(p, me, p.spec.t, t) < ((minNm + 0.5) / ARR_NM_PER_MIN) * 60));
        if (!clash) { chosen = L; break; }
      }
      if (!chosen) t += 15;
    }
    s.t = t;
    if (chosen && !fixedLevel && lvlFt(chosen) !== lvlFt(base.level)) s.level = chosen;
    placed.push({ ...base, level: chosen ?? base.level, spec: s });
  }
  return spawns;
}

/** Pairs of arrivals on the same STAR handed over closer than `minNm` at the same level (planning estimate). */
export function handoverViolations(pack: Pack, spawns: SpawnSpec[], minNm = HANDOVER_TRAIL_NM): { a: string; b: string; nm: number }[] {
  const tr = spawns.map((s) => trackOf(pack, s)).filter((x): x is ArrTrack => !!x);
  const out: { a: string; b: string; nm: number }[] = [];
  for (let i = 0; i < tr.length; i++) for (let j = i + 1; j < tr.length; j++) {
    const a = tr[i], b = tr[j];
    if (a.key !== b.key || Math.abs(lvlFt(a.level) - lvlFt(b.level)) >= 1000) continue;
    const nm = handoverGap(a, b, a.spec.t, b.spec.t);
    if (nm < minNm) out.push({ a: a.spec.cs, b: b.spec.cs, nm });
  }
  return out;
}

/** Wake order: true when `lead` is in a heavier RECAT-EU category than `foll`. */
const heavierAhead = (lead: SpawnSpec, foll: SpawnSpec) => (PERF[lead.type]?.recat ?? 'D') < (PERF[foll.type]?.recat ?? 'D');
/**
 * Departure spacing at the holding point: at least 2 minutes behind a departure on the same SID
 * or a heavier one ahead, otherwise at least 60 seconds. Mutates t in place.
 */
export function spaceDepartures(spawns: SpawnSpec[]): SpawnSpec[] {
  const deps = spawns.filter((s) => s.kind === 'dep').sort((a, b) => a.t - b.t);
  for (let i = 1; i < deps.length; i++) {
    const cur = deps[i];
    let t = cur.t;
    for (let j = 0; j < i; j++) {
      const prev = deps[j];
      const need = prev.sid === cur.sid || heavierAhead(prev, cur) ? 120 : 60;
      if (t < prev.t + need) t = prev.t + need;
    }
    cur.t = t;
  }
  return spawns;
}

/** Make the first arrival (or the first spawn) call in at t=2 so the session starts hot. */
export function hotStart(spawns: SpawnSpec[], at = 2) {
  if (!spawns.length) return;
  const first = [...spawns].filter((s) => !s.silent).sort((a, b) => a.t - b.t)[0];
  if (!first) return;
  if (first.t > at) first.t = at;
  first.callNow = true;
}

/** Minutes an arrival needs from handover to touchdown at this airport: the handover distance, the longest transition and the final, at about 4.2 NM a minute, plus a little; never under 20. */
export function arrivalMinutes(pack: Pack): number {
  let longest = 15;
  for (const t of pack.transitions) {
    let d = 0;
    for (let i = 1; i < t.legs.length; i++) d += dist(t.legs[i - 1].p, t.legs[i].p);
    longest = Math.max(longest, d);
  }
  return Math.max(20, Math.ceil((42 + longest + 10) / 4.2) + 3);
}
/** Session cap: 15 minutes after the last spawn, 25 after a last arrival (measured 15 to 19 min on the full published procedure, more with holding). The engine ends the session earlier once traffic is complete. */
export function durationFor(spawns: SpawnSpec[]): number {
  let end = 0;
  for (const s of spawns) end = Math.max(end, s.t + (s.kind === 'arr' ? 30 : 15) * 60);
  return Math.max(10, Math.ceil(end / 60));
}

export const utcPlus = (start: string, s: number) => {
  const [h, m] = start.split(':').map(Number);
  const tot = Math.floor((h * 3600 + m * 60 + s) / 60);
  return `${String(Math.floor(tot / 60) % 24).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}Z`;
};

/** Objective timers for emergency spawns (MAYDAY and medical), usable by the UI as countdowns. */
export function emergencyObjectives(spawns: SpawnSpec[]): NonNullable<Scenario['objectives']> {
  const out: NonNullable<Scenario['objectives']> = [];
  for (const s of spawns) {
    if (!s.emergency || s.emergency.type === 'radio') continue;
    const mins = s.emergency.type === 'engine' ? 15 : 12;
    const t0 = s.t + s.emergency.after + (s.kind === 'arr' ? 20 : 5);
    out.push({ cs: s.cs, text: `Land ${s.cs} within ${mins}:00`, byT: t0 + mins * 60 });
  }
  return out;
}


// ---------------------------------------------------------------------------
// Event deck for the shift template.
export type DeckCard = 'tsa' | 'goaround' | 'wind' | 'hems' | 'medical' | 'unfamiliar' | 'military' | 'runway';
export const EVENT_DECK: { card: DeckCard; w: number; once?: boolean; phases?: Phase[] }[] = [
  { card: 'tsa', w: 2, once: true, phases: ['warmup', 'bank', 'crossover'] },
  { card: 'goaround', w: 3, phases: ['bank', 'crossover'] },
  { card: 'wind', w: 2, once: true },
  { card: 'hems', w: 2 },
  { card: 'medical', w: 1, once: true, phases: ['bank', 'crossover', 'tail'] },
  { card: 'unfamiliar', w: 2 },
  { card: 'military', w: 2, once: true },
  // the wind swings round: tailwind on the runway in use, the supervisor announces a change 10 minutes later
  { card: 'runway', w: 1, once: true, phases: ['bank', 'crossover'] },
];

/** The pack's reserved area may be active now: inside its NOTAM hours (TSA 29A at Liège: 0600 to 2000 UTC). */
export const reservedActive = (pack: Pack, start: string, t: number) => {
  const r = pack.spec.traffic?.reserved;
  if (!r) return false;
  const hr = Number(utcPlus(start, t).slice(0, 2));
  return hr >= r.hoursUtc[0] && hr < r.hoursUtc[1];
};
/** TSA 29A is activated by NOTAM for weekday daytime flying only: 0600 to 2000 UTC in the sim (kept for 1.0 callers). */
export const tsaDaytime = (start: string, t: number) => { const hr = Number(utcPlus(start, t).slice(0, 2)); return hr >= 6 && hr < 20; };

/** The operator pools of a pack, with generic fallbacks for packs that list none. */
export function opsOf(pack: Pack): { cargo: Op[]; bank: Op[]; pax: Op[] } {
  const t = pack.spec.traffic;
  const ops = (xs?: OperatorSpec[]): Op[] => (xs ?? []).map((o) => ({ op: o.op, types: o.types, w: o.w }));
  const pax = ops(t?.pax), cargo = ops(t?.cargo), bank = ops(t?.bank);
  return { cargo: cargo.length ? cargo : pax.length ? pax : GENERIC_CARGO, bank, pax: pax.length ? pax : cargo.length ? cargo : GENERIC_PAX };
}
const patternsOf = (pack: Pack): PatternSpec[] => pack.spec.traffic?.patterns ?? [];
/** A spawn from a pattern (callsign and type drawn in the pattern's order: callsign first, then the type). */
function spawnFromPattern(p: PatternSpec, t: number, rng: Rng, cs: CallsignPool): SpawnSpec {
  const callsign = p.cs ?? (p.csReg ? cs.reg() : `${p.csOp ?? 'GA'}${rng.int(p.csNum?.[0] ?? 1, p.csNum?.[1] ?? 99)}`);
  const type = p.types.length > 1 ? rng.pick(p.types) : p.types[0];
  const req = p.request ? { kind: p.request.kind, level: parseLevel(p.request.level), fix: p.request.fix, route: p.request.route } : undefined;
  return { t, kind: p.kind, cs: callsign, type, route: p.route, from: p.from, level: parseLevel(p.level), spd: p.spd, formation: p.formation, request: req, ...(p.twr ? { twr: true as const } : {}) };
}
/** 2.0 review: the pattern flies at this local hour (a HEMS helicopter by day only); patterns without hours always do. */
const patternFlies = (p: PatternSpec, localH: number) => !p.hoursLocal || inWindow(((localH % 24) + 24) % 24, p.hoursLocal[0], p.hoursLocal[1]);
/** Magnetic heading of a runway rounded to 10 degrees (the wind direction that favours it). */
const rwyWindDir = (pack: Pack, rwy: string) => { const r = pack.runways.get(rwy); return r ? (Math.round((((r.crs - pack.meta.magVar) % 360) + 360) % 360 / 10) * 10 || 360) : 220; };
const accName = (pack: Pack) => pack.meta.upstream[0]?.name ?? 'The centre';

interface DeckCtx { rng: Rng; cs: CallsignPool; spawns: SpawnSpec[]; events: ScEvent[]; objectives: NonNullable<Scenario['objectives']>; rwy: string; notes: string[]; start: string; pack: Pack; offsetH?: number }

function playCard(card: DeckCard, t: number, c: DeckCtx) {
  const { rng, pack } = c;
  const ops = opsOf(pack);
  const tagged = (deck: 'hems' | 'military') => patternsOf(pack).filter((p) => p.deck === deck).sort((a, b) => (b.w ?? 1) - (a.w ?? 1));
  switch (card) {
    case 'tsa': {
      // the reserved area is a daytime area (by NOTAM): at night, or without one, the card becomes a military crossing instead
      const r = pack.spec.traffic?.reserved;
      if (!r || !reservedActive(pack, c.start, t)) { playCard('military', t, c); break; }
      c.events.push({ t, kind: 'tsa', name: r.name, on: true });
      c.events.push({ t: t + rng.int(15, 25) * 60, kind: 'tsa', name: r.name, on: false });
      c.notes.push(`${areaSpoken(r.name)} active from ${utcPlus(c.start, t)}.`);
      break;
    }
    case 'goaround': {
      // an arrival that will be about 1 to 2 NM out roughly now: spawned ~15 min earlier
      const cands = c.spawns.filter((s) => s.kind === 'arr' && !s.goAroundAt && !s.emergency && !s.unfamiliar && s.t > 0);
      if (!cands.length) break;
      const pick = cands.reduce((b, s) => (Math.abs(s.t + 900 - t) < Math.abs(b.t + 900 - t) ? s : b), cands[0]);
      pick.goAroundAt = rng.pick([1, 1.5, 2]);
      break;
    }
    case 'wind': {
      const base = rwyWindDir(pack, c.rwy);
      const dir = Math.round((base + rng.int(-40, 40) + 360) % 360 / 10) * 10 || 360;
      const kt = rng.int(10, 18);
      c.events.push({ t, kind: 'wind', dir, kt, gust: rng.chance(0.4) ? kt + rng.int(8, 12) : undefined });
      break;
    }
    case 'hems': case 'military': {
      const localH = hm(c.start) + t / 3600 + (c.offsetH ?? pack.utcOffsetWinter);
      const pats = tagged(card).filter((p) => patternFlies(p, localH));
      if (!pats.length) break;
      const p = pats.length > 1 ? rng.weighted(pats.map((x) => ({ w: x.w ?? 1, v: x }))) : pats[0];
      c.spawns.push(spawnFromPattern(p, t, rng, c.cs));
      break;
    }
    case 'medical': {
      // A passenger jet diverts with a sick passenger: no local STAR, wants priority.
      const op = rng.weighted(ops.pax.map((x) => ({ w: x.w, v: x })));
      const cs = c.cs.make(op.op);
      c.spawns.push({ t, kind: 'arr', cs, type: rng.pick(op.types), unfamiliar: true, spawnDist: rng.range(28, 34) });
      c.events.push({ t: Math.max(1, t - 20), kind: 'note', text: `${accName(pack)}: ${cs} diverting to ${pack.meta.name} with a medical emergency on board, requests priority landing` });
      c.objectives.push({ cs, text: `Land ${cs} within 15:00`, byT: t + 15 * 60 });
      break;
    }
    case 'unfamiliar': {
      const op = rng.weighted(ops.pax.map((x) => ({ w: x.w, v: x })));
      c.spawns.push({ t, kind: 'arr', cs: c.cs.make(op.op), type: rng.pick(op.types), unfamiliar: true, spawnDist: rng.range(30, 38) });
      break;
    }
    case 'runway': {
      const into = (rwyWindDir(pack, c.rwy) + 180) % 360 || 360;
      const dir = Math.round((into + rng.int(-20, 20) + 360) % 360 / 10) * 10 || 360;
      const kt = rng.int(9, 14);
      c.events.push({ t, kind: 'wind', dir, kt });
      c.notes.push(`Wind expected to swing round to ${String(dir).padStart(3, '0')}° later in the shift: be ready for a runway change.`);
      break;
    }
  }
}

/** Draw 1–2 events per phase, never two within 5 minutes of each other. Returns the cards played with times. */
export function drawDeck(c: DeckCtx, windowS: number): { card: DeckCard; t: number; phase: Phase }[] {
  const played: { card: DeckCard; t: number; phase: Phase }[] = [];
  const used = new Set<DeckCard>();
  for (const ph of shiftPhases(windowS)) {
    const a = ph.from * windowS + 60, b = ph.to * windowS - 30;
    if (b <= a) continue;
    const n = c.rng.int(1, 2);
    for (let k = 0; k < n; k++) {
      const deck = EVENT_DECK.filter((d) => (!d.once || !used.has(d.card)) && (!d.phases || d.phases.includes(ph.name)));
      if (!deck.length) break;
      const card = c.rng.weighted(deck.map((d) => ({ w: d.w, v: d.card })));
      let t: number | undefined;
      for (let tries = 0; tries < 12; tries++) {
        const cand = Math.round(c.rng.range(a, b));
        if (played.every((p) => Math.abs(p.t - cand) >= 300)) { t = cand; break; }
      }
      if (t === undefined) continue;
      used.add(card);
      played.push({ card, t, phase: ph.name });
      playCard(card, t, c);
    }
  }
  return played;
}

/** Build a free-play scenario from options, at any airport, from its pack alone. */
export function freePlay(pack: Pack, o: FreePlayOpts): Scenario {
  const seed = o.seed ?? Math.floor(Math.random() * 1e9);
  const rng = new Rng(seed);
  const templates = templatesOf(pack);
  const offsetH = localOffsetOf(pack, o.date);
  const curve = curveOf(pack, offsetH);
  const tpl0 = templates[o.template];
  const byHour = o.startHour !== undefined;
  const tpl = byHour ? { ...tpl0, start: hhmmOfHour(o.startHour!) } : tpl0;
  const hourAt = (t: number) => (o.startHour ?? 0) + t / 3600;
  const mixAt = (t: number) => shiftCurveForHour(hourAt(t), curve);
  const metar = o.weather === 'live' && o.liveMetar ? o.liveMetar : presetMetar(pack, o.weather === 'live' ? 'good' : o.weather);
  const cfg = selectConfig(pack, parseMetar(metar));
  const rwy = cfg.land, depRwy = cfg.dep;
  const ops = opsOf(pack);
  const cs = new CallsignPool(rng, pack.spec.traffic?.registration ?? (pack.spec.traffic?.gaPrefixes?.[0] ? { prefix: pack.spec.traffic.gaPrefixes[0], length: 5 } : undefined));
  const spawns: SpawnSpec[] = [];
  const W = Math.max(10, o.durationMin - 15) * 60; // traffic window
  const shift = o.template === 'shift';
  const arrCurve = shiftArrCurve(W);
  const compressed = shift && !byHour;

  // the pack's own shift (Düsseldorf: the 06:00 departure wave) instead of the cargo night
  const own = compressed ? pack.spec.traffic?.shiftCurve : undefined;
  const arrRate = (t: number) => (byHour ? mixAt(t).arr : own ? curveAt(own.arr, t / W) : compressed ? curveAt(arrCurve, t / W) : tpl.arrPerHr);
  const depRate = (t: number) => (byHour ? mixAt(t).dep : own ? curveAt(own.dep, t / W) : compressed ? curveAt(SHIFT_CURVE.dep, t / W) : tpl.depPerHr);
  const arrT = poissonTimes(rng, W, arrRate, byHour ? curve.max.arr : own ? own.max.arr : compressed ? 24 : tpl.arrPerHr);
  // the night restriction (AD 2.20 at Düsseldorf): no scheduled take-off inside it, whatever the template
  const localAt = (t: number) => hm(tpl.start) + t / 3600 + offsetH;
  const depT = poissonTimes(rng, W, depRate, byHour ? curve.max.dep : own ? own.max.dep : compressed ? 20 : tpl.depPerHr).filter((t) => t >= 60 && !inCurfew(pack, 'dep', localAt(t)));
  // a curfew (rate 0 over the whole window) stays empty; otherwise the session starts hot
  const curfew = byHour && arrT.length === 0 && depT.length === 0 && arrRate(0) === 0 && arrRate(W) === 0;
  if (!curfew) {
    if (!arrT.length || arrT[0] > 2) arrT.unshift(2);
    else arrT[0] = 2;
  }
  const bankEnd = 0.5 * W, bankStart = shiftPhases(W)[1].from * W;
  const mixPax = o.mix && o.mix.cargo + o.mix.pax > 0 ? o.mix.pax / (o.mix.cargo + o.mix.pax) : undefined;
  for (const t of arrT) {
    // a bank phase draws from the bank operators; an airport without a bank list keeps its usual mix
    const inBank = (byHour ? mixAt(t).phase === 'bank' : shift && t >= bankStart && t < bankEnd) && ops.bank.length > 0;
    const pax = !inBank && rng.chance(mixPax ?? (byHour ? mixAt(t).paxShare : tpl.paxShare));
    const pool = pax ? ops.pax : inBank ? ops.bank : ops.cargo;
    const op = rng.weighted(pool.map((x) => ({ w: x.w, v: x })));
    const base = rng.weighted(arrivalWeights(pack, rwy, inBank));
    spawns.push({ t, kind: 'arr', cs: cs.make(op.op), type: rng.pick(op.types), star: starFor(base, rwy, pack), spawnDist: rng.range(36, 46) });
  }
  for (const t of depT) {
    // no random draw unless a share is in play, so seeded sessions (and replays of them) keep their traffic
    const share = mixPax ?? (byHour ? mixAt(t).paxShare : undefined);
    const pool = share !== undefined && rng.chance(share) ? ops.pax : ops.cargo;
    const op = rng.weighted(pool.map((x) => ({ w: x.w, v: x })));
    spawns.push({ t, kind: 'dep', cs: cs.make(op.op), type: rng.pick(op.types), sid: sidFor(rng, depRwy, pack) });
  }
  // Military and transient traffic, from the pack's patterns by free-play military level
  const extras: SpawnSpec[] = [];
  const at = () => Math.round(rng.range(120, Math.max(180, W - 120)));
  for (const p of patternsOf(pack)) {
    if (!p.at || p.at > o.military) continue;
    if (p.at === 1 && shift) continue;
    const sp = spawnFromPattern(p, at(), rng, cs);
    if (patternFlies(p, localAt(sp.t))) extras.push(sp);
  }
  // the designer's general-aviation and military shares: VFR crossings and military transits on top of the schedule
  if (o.mix) {
    const hours = W / 3600;
    const nGa = Math.round(o.mix.ga * 6 * hours), nMil = Math.round(o.mix.mil * 4 * hours);
    const vfrPats = patternsOf(pack).filter((p) => p.kind === 'vfr' || p.kind === 'heli');
    const milPats = patternsOf(pack).filter((p) => p.kind === 'mil');
    for (let i = 0; i < nGa; i++) {
      const p = vfrPats.length ? rng.pick(vfrPats) : undefined;
      if (p) extras.push(spawnFromPattern(p, at(), rng, cs));
      else if (pack.vfrRoutes.length) { const vr = rng.pick(pack.vfrRoutes); extras.push({ t: at(), kind: 'vfr', cs: cs.reg(), type: rng.pick(['C172', 'PA28']), route: vr.points, from: { brg: rng.int(0, 359), dist: 6 }, level: { ft: vr.alt }, request: { kind: 'crossing', route: vr.points } }); }
    }
    for (let i = 0; i < nMil; i++) {
      const p = milPats.length ? rng.pick(milPats) : undefined;
      if (p) extras.push(spawnFromPattern(p, at(), rng, cs));
      else { const sf = pack.stackFix; const exit = pack.sids[0]?.exitFix ?? sf; extras.push({ t: at(), kind: 'mil', cs: `${pack.spec.traffic?.military?.[0]?.op ?? 'GAF'}${rng.int(10, 99)}`, type: 'A400', route: [sf, exit], from: { brg: rng.int(0, 359), dist: 12 }, level: { fl: 70 }, request: { kind: 'climb', level: { fl: 110 } } }); }
    }
  }
  spawns.push(...extras);
  // Emergencies: the designer's rate (expected per hour) or the 1.0 switch (one per session)
  if (o.emergencyRate !== undefined) {
    const n = Math.min(4, poissonTimes(rng, W, () => o.emergencyRate!, Math.max(0.01, o.emergencyRate!)).length);
    const arrivals = spawns.filter((s) => s.kind === 'arr' && !s.unfamiliar && !s.emergency);
    const deps = spawns.filter((s) => s.kind === 'dep' && !s.emergency);
    for (let i = 0; i < n; i++) {
      const pickType = rng.pick(['smoke', 'radio', 'engine'] as const);
      const dep = pickType === 'engine' ? deps.filter((d) => !d.emergency) : [];
      if (dep.length) rng.pick(dep).emergency = { after: rng.int(60, 150), type: 'engine' };
      else { const free = arrivals.filter((a) => !a.emergency); if (free.length > 2) rng.pick(free.slice(1, -1)).emergency = { after: rng.int(60, 240), type: pickType === 'engine' ? 'smoke' : pickType }; }
    }
  } else if (o.emergencies) {
    const arrivals = spawns.filter((s) => s.kind === 'arr' && !s.unfamiliar);
    const deps = spawns.filter((s) => s.kind === 'dep');
    const pickType = rng.pick(['smoke', 'radio', 'engine'] as const);
    if (pickType === 'engine' && deps.length) rng.pick(deps).emergency = { after: rng.int(60, 150), type: 'engine' };
    else if (arrivals.length > 2) rng.pick(arrivals.slice(1, -1)).emergency = { after: rng.int(60, 240), type: pickType === 'engine' ? 'smoke' : pickType };
  }
  const events: ScEvent[] = [];
  const objectives: NonNullable<Scenario['objectives']> = [];
  const notes: string[] = [];
  let storms: Storm[] | undefined;
  if (o.weather === 'storms') storms = [{ p: { x: -14, y: -10 }, r: 4, vx: 8, vy: 10 }, { p: { x: -22, y: 6 }, r: 3.5, vx: 9, vy: 6 }, { p: { x: 8, y: -20 }, r: 5, vx: 4, vy: 9 }];
  const reserved = pack.spec.traffic?.reserved;
  if (shift) drawDeck({ rng, cs, spawns, events, objectives, rwy, notes, start: tpl.start, pack, offsetH }, W);
  else if (o.reserved === undefined && o.military >= 2 && reserved && reservedActive(pack, tpl.start, Math.round(W * 0.4)) && reservedActive(pack, tpl.start, Math.round(W * 0.9))) {
    const on = Math.round(W * 0.4);
    events.push({ t: on, kind: 'tsa', name: reserved.name, on: true }, { t: Math.round(W * 0.9), kind: 'tsa', name: reserved.name, on: false });
    notes.push(`${areaSpoken(reserved.name)} active from ${utcPlus(tpl.start, on)}.`);
  }
  // the designer's reserved-area activity: one or two activations of the pack's area
  if (o.reserved && reserved) {
    const windows: [number, number][] = o.reserved === 1 ? [[0.3, 0.7]] : [[0.15, 0.4], [0.55, 0.85]];
    for (const [a, b] of windows) {
      const on = Math.round(W * a), off = Math.round(W * b);
      events.push({ t: on, kind: 'tsa', name: reserved.name, on: true }, { t: off, kind: 'tsa', name: reserved.name, on: false });
      notes.push(`${areaSpoken(reserved.name)} active ${utcPlus(tpl.start, on)} to ${utcPlus(tpl.start, off)}.`);
    }
  }
  // the designer's weather trend
  if (o.trend === 'deteriorating' && o.weather !== 'lvp') {
    const t = Math.round(W * 0.55);
    events.push({ t, kind: 'lvp', on: true, rvr: 400, vis: 450, ceiling: 100 });
    notes.push(`Visibility dropping: fog expected around ${utcPlus(tpl.start, t)}, low visibility procedures from then.`);
  } else if (o.trend === 'improving' && o.weather === 'lvp') {
    const t = Math.round(W * 0.5);
    events.push({ t, kind: 'lvp', on: false });
    notes.push(`Fog lifting around ${utcPlus(tpl.start, t)}.`);
  } else if (o.trend === 'wind-shift') {
    const into = (rwyWindDir(pack, rwy) + 180) % 360 || 360;
    const dir = Math.round((into + rng.int(-20, 20) + 360) % 360 / 10) * 10 || 360;
    const t = Math.round(W * 0.45);
    events.push({ t, kind: 'wind', dir, kt: rng.int(9, 14) });
    notes.push(`Wind expected to swing round to ${String(dir).padStart(3, '0')} degrees around ${utcPlus(tpl.start, t)}: be ready for a runway change.`);
  }
  // The centre hands over in trail; the tower lines departures up with wake gaps.
  separateHandovers(pack, spawns);
  spaceDepartures(spawns);
  hotStart(spawns.filter((s) => s.kind === 'arr'));
  // The session lasts exactly what the player chose: arrivals appear early enough to land
  // (20 minutes before the end), everything else at least 10 minutes before it.
  const endS = o.durationMin * 60;
  const lastArr = Math.max(8 * 60, endS - arrivalMinutes(pack) * 60), lastOther = Math.max(10 * 60, endS - 10 * 60);
  for (let i = spawns.length - 1; i >= 0; i--) {
    const s = spawns[i];
    if (s.t > 2 && s.t > (s.kind === 'arr' ? lastArr : lastOther)) spawns.splice(i, 1);
  }
  for (let i = events.length - 1; i >= 0; i--) if (events[i].t >= endS) events.splice(i, 1);
  for (let i = objectives.length - 1; i >= 0; i--) if (!spawns.some((s) => s.cs === objectives[i].cs)) objectives.splice(i, 1);
  events.sort((a, b) => a.t - b.t);
  spawns.sort((a, b) => a.t - b.t);
  objectives.push(...emergencyObjectives(spawns));

  const nArr = spawns.filter((s) => s.kind === 'arr').length;
  const nDep = spawns.filter((s) => s.kind === 'dep').length;
  const rwyText = depRwy === rwy ? `Runway ${rwy}.` : `Runway ${rwy} landing, ${depRwy} departures.`;
  const parts = [`${byHour ? cap(mixAt(0).label) : tpl.title}.`, `${nArr} inbound, ${nDep} out.`, rwyText];
  if (byHour) parts.push(hourBrief(o.startHour!, W, curve));
  else if (shift) parts.push(`Wave peaks around ${utcPlus(tpl.start, Math.round(0.33 * W))}, departures push from ${utcPlus(tpl.start, Math.round(0.6 * W))}.`);
  else parts.push(o.template === 'quiet' ? 'A gentle flow.' : 'Steady flow all session.');
  if (!byHour && tpl.note) parts.push(tpl.note);
  if (o.mix) { const bits: string[] = []; if (o.mix.ga > 0) bits.push('general aviation crossing the zone'); if (o.mix.mil > 0) bits.push('military transits'); if (bits.length) parts.push(`Also ${bits.join(' and ')}.`); }
  parts.push(...notes);
  if (o.weather === 'lvp') parts.push('Fog: low visibility procedures, CAT III only.');
  if (o.weather === 'storms') parts.push('Thunderstorms drifting in from the south-west; expect deviation requests.');
  if (o.weather === 'windy-ne') parts.push(`Strong ${compassName(parseMetar(metar).windDir)}, gusting 26 kt.`);
  if (o.military >= 2 && !shift) parts.push('Military traffic crossing the area.');

  return {
    id: 'free', title: `Free play · ${byHour ? `${cap(mixAt(0).label)} from ${tpl.start}Z` : tpl.title}`, desc: 'Generated session', seed, durationMin: o.durationMin, startUtc: tpl.start, metar,
    runway: rwy, spawns, events, storms, readbackErr: [0, 0.02, 0.04, 0.06, 0.08, 0.1][o.difficulty], confusion: o.difficulty >= 4, freePlay: true,
    briefing: parts.join(' '), objectives: objectives.length ? objectives : undefined, icao: pack.meta.icao,
    ...(o.date ? { date: o.date } : {}),
  };
}

/** One line on what the clock brings: the phase the session starts in and the phase changes during it. */
export function hourBrief(startHour: number, windowS: number, curve: HourCurve = DEFAULT_CURVE): string {
  const first = shiftCurveForHour(startHour, curve);
  const out = [`Starts in the ${first.label}`];
  let cur = first.label;
  for (let s = 60; s < windowS; s += 60) {
    const h = Math.round(startHour * 60 + s / 60) / 60;
    const m = shiftCurveForHour(h, curve);
    if (m.label !== cur) { out.push(`${m.label} from ${hhmmOfHour(h).replace(':', '')}Z`); cur = m.label; }
  }
  return out.join(', ') + '.';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Today's shift: the same for everyone on a given date (seeded from yyyymmdd), 25 minutes of shaped traffic. */
export function dailyShift(pack: Pack, date: Date): Scenario {
  const ymd = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const rng = new Rng(ymd);
  const weather = rng.weighted<FreePlayOpts['weather']>([{ w: 6, v: 'good' }, { w: 2, v: 'windy-ne' }, { w: 1, v: 'storms' }, { w: 1, v: 'lvp' }]);
  const sc = freePlay(pack, { template: 'shift', durationMin: 40, military: 1, weather, emergencies: false, difficulty: 2, seed: ymd });
  const title = `Daily shift ${date.getDate()} ${MONTHS[date.getMonth()]}`;
  const shiftTitle = templatesOf(pack).shift.title;
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { ...sc, id: `daily-${ymd}`, title, desc: 'Today\'s shift. Everyone gets the same traffic.', date: iso, briefing: sc.briefing?.startsWith(`${shiftTitle}.`) ? `Daily shift.${sc.briefing.slice(shiftTitle.length + 1)}` : sc.briefing };
}
