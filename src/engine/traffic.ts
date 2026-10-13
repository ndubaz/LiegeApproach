import { Rng } from './rng';
import type { Scenario, ScEvent, SpawnSpec, Storm } from './types';
import { parseMetar, selectRunway } from './weather';
import { PERF } from './perf';
import { bearing, dist, move, type XY } from '../geo';
import type { Level, Pack } from '../pack/load';

// Operators that fly freighters into Liège, with the types they typically use.
export const CARGO_OPS: { op: string; types: string[]; w: number }[] = [
  { op: 'FDX', types: ['B77L', 'MD11', 'B763'], w: 4 },
  { op: 'QTR', types: ['B77L', 'B748'], w: 4 },
  { op: 'THY', types: ['A332', 'B77L'], w: 3 },
  { op: 'ETH', types: ['B77L', 'B763'], w: 3 },
  { op: 'CHG', types: ['B748', 'B744'], w: 3 },
  { op: 'TAY', types: ['B744', 'B763', 'B738'], w: 4 },
  { op: 'MSR', types: ['A332'], w: 1 },
  { op: 'AZG', types: ['B748', 'B744'], w: 2 },
  { op: 'CAO', types: ['B77L'], w: 1 },
  { op: 'CKS', types: ['B744', 'B77L'], w: 2 },
  { op: 'CLX', types: ['B748', 'B744'], w: 2 },
  { op: 'DHK', types: ['B763', 'A306'], w: 2 },
  { op: 'BCS', types: ['A306', 'B752'], w: 2 },
];
/** The night inbound bank: long-haul heavies, mostly from the Gulf, Africa and Asia. */
export const BANK_OPS: { op: string; types: string[]; w: number }[] = [
  { op: 'TAY', types: ['B744', 'B763'], w: 4 },
  { op: 'QTR', types: ['B77L', 'B748'], w: 4 },
  { op: 'ETH', types: ['B77L'], w: 3 },
  { op: 'CKS', types: ['B744', 'B77L'], w: 2 },
  { op: 'FDX', types: ['B77L', 'MD11'], w: 3 },
  { op: 'CHG', types: ['B748', 'B744'], w: 3 },
  { op: 'AZG', types: ['B748'], w: 1 },
];
export const PAX_OPS: { op: string; types: string[]; w: number }[] = [
  { op: 'JAF', types: ['B738'], w: 3 },
  { op: 'RYR', types: ['B738'], w: 2 },
  { op: 'BEL', types: ['A320', 'A321'], w: 2 },
  { op: 'TRA', types: ['B738'], w: 1 },
];

export const ARR_STAR_BASES = [
  { base: 'KOK7', w: 3 }, { base: 'CIV7', w: 3 }, { base: 'NIK7', w: 2 }, { base: 'LNO6', w: 3 }, { base: 'GESLO6', w: 2 },
];
/** Bank arrivals come mostly from the west (KOK, CIV) and the south-east (GESLO). */
export const BANK_STAR_BASES = [
  { base: 'KOK7', w: 3 }, { base: 'CIV7', w: 3 }, { base: 'GESLO6', w: 3 }, { base: 'LNO6', w: 2 }, { base: 'NIK7', w: 1 },
];
export const starFor = (base: string, rwy: string) => base + (rwy.startsWith('22') ? 'X' : 'D');
export const DEP_SIDS: Record<string, { name: string; w: number }[]> = {
  '22': [{ name: 'LNO9S', w: 3 }, { name: 'CIV5S', w: 2 }, { name: 'BUB9S', w: 2 }],
  '04': [{ name: 'LNO2R', w: 3 }, { name: 'CIV6R', w: 2 }, { name: 'BUB1R', w: 2 }],
};
export const sidFor = (rng: Rng, rwy: string) => rng.weighted(DEP_SIDS[rwy.slice(0, 2)].map((s) => ({ w: s.w, v: s.name })));

export class CallsignPool {
  used = new Set<string>();
  constructor(private rng: Rng) {}
  make(op: string): string {
    for (let i = 0; i < 50; i++) {
      const n = this.rng.chance(0.5) ? this.rng.int(10, 999) : this.rng.int(1000, 9899);
      const suffix = this.rng.chance(0.25) ? String.fromCharCode(65 + this.rng.int(0, 25)) : '';
      const cs = `${op}${n}${suffix}`;
      if (!this.used.has(cs)) { this.used.add(cs); return cs; }
    }
    return `${op}${this.used.size + 100}`;
  }
  reg(): string {
    const L = 'ABCDEFGHIJKLMNOPRSTUVW';
    const cs = `OO${L[this.rng.int(0, L.length - 1)]}${L[this.rng.int(0, L.length - 1)]}${L[this.rng.int(0, L.length - 1)]}`;
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
   * Start time, UTC hours (e.g. 1.5 for 01:30). When set, the traffic follows Liège's real day
   * (shiftCurveForHour) from that time instead of the template's flat rates or compressed night.
   */
  startHour?: number;
}

export const TEMPLATES = {
  night: { title: 'Night bank', arrPerHr: 18, depPerHr: 9, start: '01:40', paxShare: 0 },
  day: { title: 'Daytime mix', arrPerHr: 11, depPerHr: 9, start: '10:15', paxShare: 0.25 },
  quiet: { title: 'Quiet hour', arrPerHr: 6, depPerHr: 4, start: '15:30', paxShare: 0.2 },
  /** Average rates; the real shape is SHIFT_CURVE. */
  shift: { title: 'Night shift', arrPerHr: 14, depPerHr: 6, start: '01:40', paxShare: 0 },
};

export const WEATHER_PRESETS: Record<string, string> = {
  good: 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG',
  'windy-ne': 'EBLG 120140Z 04016G26KT 9999 SCT025 09/04 Q1004 NOSIG',
  lvp: 'EBLG 120140Z 21004KT 0300 R22L/0350 FG VV001 08/08 Q1022 NOSIG',
  storms: 'EBLG 120140Z 20012G22KT 8000 TSRA SCT030CB BKN060 21/17 Q1009 TEMPO TSRA',
};

// ---------------------------------------------------------------------------
// Demand curve for the 'shift' template: a real Liège cargo night, as fractions
// of the traffic window. Rates are movements per hour, linear between points.
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
// Liège over 24 hours (UTC). A cargo hub with one long runway: long-haul departures in the evening,
// the night inbound bank (integrator feeders and long-haul freighters), a short lull while the hub sorts,
// the outbound bank, a quiet early morning, then a steady daytime mix with a few passenger flights.
// Rates are movements per hour, linear between points; the peaks add up to about 25 movements an hour.
export type HourPhase = 'evening' | 'bank' | 'sort' | 'outbound' | 'morning' | 'day';
export const HOUR_CURVE: { arr: [number, number][]; dep: [number, number][] } = {
  arr: [[0, 16], [0.75, 22], [1.25, 24], [2.4, 23], [2.7, 6], [3.25, 4], [5.25, 3], [6, 3], [7, 6], [8, 8], [17, 8], [18, 6], [21.5, 6], [22.5, 9], [23.5, 13], [24, 16]],
  dep: [[0, 3], [2.75, 2], [3.25, 4], [3.5, 18], [3.75, 22], [4.75, 20], [5.25, 6], [6, 3], [7, 5], [8, 7], [17, 7], [18, 9], [19.5, 11], [21.5, 8], [22.5, 4], [24, 3]],
};
const HOUR_PHASES: { from: number; to: number; phase: HourPhase; label: string; paxShare: number }[] = [
  { from: 0, to: 2.75, phase: 'bank', label: 'night inbound bank', paxShare: 0 },
  { from: 2.75, to: 3.25, phase: 'sort', label: 'the sort', paxShare: 0 },
  { from: 3.25, to: 5.25, phase: 'outbound', label: 'outbound bank', paxShare: 0 },
  { from: 5.25, to: 8, phase: 'morning', label: 'quiet morning', paxShare: 0.15 },
  { from: 8, to: 18, phase: 'day', label: 'daytime mix', paxShare: 0.25 },
  { from: 18, to: 23.5, phase: 'evening', label: 'evening departures', paxShare: 0.1 },
  { from: 23.5, to: 24, phase: 'bank', label: 'night inbound bank', paxShare: 0 },
];
/** Highest hourly rates on HOUR_CURVE (for the thinning sampler). */
export const HOUR_MAX = { arr: 24, dep: 22 };
/** Traffic mix at a UTC hour (fractional hours, any value; wraps at 24). */
export function shiftCurveForHour(hourUtc: number): { arr: number; dep: number; phase: HourPhase; label: string; paxShare: number } {
  const h = ((hourUtc % 24) + 24) % 24;
  const ph = HOUR_PHASES.find((p) => h >= p.from && h < p.to) ?? HOUR_PHASES[0];
  return { arr: curveAt(HOUR_CURVE.arr, h), dep: curveAt(HOUR_CURVE.dep, h), phase: ph.phase, label: ph.label, paxShare: ph.paxShare };
}
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const hhmmOfHour = (h: number) => { const m = Math.round((((h % 24) + 24) % 24) * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------------------
// Brussels handover rules.
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

interface ArrTrack { spec: SpawnSpec; key: string; level: Level; at: (dRemain: number) => XY }
function trackOf(pack: Pack, s: SpawnSpec): ArrTrack | undefined {
  if (s.kind !== 'arr') return undefined;
  if (s.unfamiliar) {
    // diversions without a STAR come in from the north-west, straight at the field
    return { spec: s, key: 'DIVERT', level: s.level ?? { fl: 80 }, at: (d) => move({ x: 0, y: 0 }, 300, Math.max(0, d)) };
  }
  const star = pack.stars.find((x) => x.name === s.star);
  if (!star) return undefined;
  return { spec: s, key: star.name, level: s.level ?? star.handoffLevel, at: (d) => starPoint(pack, star.name, d)! };
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
        const clash = placed.some((p) => p.key === me.key && Math.abs(lvlFt(p.level) - lvlFt(L)) < 1000 && handoverGap(p, me, p.spec.t, t) < minNm + 0.5);
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

/** Session cap: 15 minutes after the last spawn, 25 after a last arrival (measured 15 to 19 min on the full published procedure, more with holding). The engine ends the session earlier once traffic is complete. */
export function durationFor(spawns: SpawnSpec[]): number {
  let end = 0;
  for (const s of spawns) end = Math.max(end, s.t + (s.kind === 'arr' ? 25 : 15) * 60);
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

interface DeckCtx { rng: Rng; cs: CallsignPool; spawns: SpawnSpec[]; events: ScEvent[]; objectives: NonNullable<Scenario['objectives']>; rwy: string; notes: string[]; start: string }

function playCard(card: DeckCard, t: number, c: DeckCtx) {
  const { rng } = c;
  switch (card) {
    case 'tsa': {
      c.events.push({ t, kind: 'tsa', name: 'TSA29A', on: true });
      c.events.push({ t: t + rng.int(15, 25) * 60, kind: 'tsa', name: 'TSA29A', on: false });
      c.notes.push(`TSA 29A active from ${utcPlus(c.start, t)}.`);
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
      const base = c.rwy.startsWith('22') ? 220 : 40;
      const dir = Math.round((base + rng.int(-40, 40) + 360) % 360 / 10) * 10 || 360;
      const kt = rng.int(10, 18);
      c.events.push({ t, kind: 'wind', dir, kt, gust: rng.chance(0.4) ? kt + rng.int(8, 12) : undefined });
      break;
    }
    case 'hems': {
      if (rng.chance(0.6)) c.spawns.push({ t, kind: 'heli', cs: 'LIFE3', type: 'EC45', route: ['NOVEM', 'CHU'], from: { brg: 5, dist: 8 }, level: { ft: 1500 }, request: { kind: 'direct', fix: 'CHU' } });
      else c.spawns.push({ t, kind: 'vfr', cs: c.cs.reg(), type: rng.pick(['C172', 'PA28']), route: ['ROMEO', 'FOXHE'], from: { brg: 300, dist: 7 }, level: { ft: 1500 }, request: { kind: 'crossing', route: ['ROMEO', 'FOXHE'] } });
      break;
    }
    case 'medical': {
      // A passenger jet diverts with a sick passenger: no Liège STAR, wants priority.
      const op = rng.weighted(PAX_OPS.map((x) => ({ w: x.w, v: x })));
      const cs = c.cs.make(op.op);
      c.spawns.push({ t, kind: 'arr', cs, type: rng.pick(op.types), unfamiliar: true, spawnDist: rng.range(28, 34) });
      c.events.push({ t: Math.max(1, t - 20), kind: 'note', text: `Brussels ACC: ${cs} diverting to Liège with a medical emergency on board, requests priority landing` });
      c.objectives.push({ cs, text: `Land ${cs} within 15:00`, byT: t + 15 * 60 });
      break;
    }
    case 'unfamiliar': {
      const op = rng.weighted(PAX_OPS.map((x) => ({ w: x.w, v: x })));
      c.spawns.push({ t, kind: 'arr', cs: c.cs.make(op.op), type: rng.pick(op.types), unfamiliar: true, spawnDist: rng.range(30, 38) });
      break;
    }
    case 'runway': {
      const into = c.rwy.startsWith('22') ? 40 : 220;
      const dir = Math.round((into + rng.int(-20, 20) + 360) % 360 / 10) * 10 || 360;
      const kt = rng.int(9, 14);
      c.events.push({ t, kind: 'wind', dir, kt });
      c.notes.push(`Wind expected to swing round to ${String(dir).padStart(3, '0')}° later in the shift: be ready for a runway change.`);
      break;
    }
    case 'military': {
      if (rng.chance(0.5)) c.spawns.push({ t, kind: 'mil', cs: 'BAF' + rng.int(51, 79), type: 'F35', formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: { fl: 70 }, spd: 300, request: { kind: 'climb', level: { fl: 150 } } });
      else c.spawns.push({ t, kind: 'mil', cs: 'BAF7' + rng.int(10, 99), type: 'A400', route: ['ROMEO', 'ALHUV', 'SPA'], from: { brg: 300, dist: 10 }, level: { fl: 60 }, request: { kind: 'climb', level: { fl: 90 } } });
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

/** Build a free-play scenario from options. */
export function freePlay(pack: Pack, o: FreePlayOpts): Scenario {
  const seed = o.seed ?? Math.floor(Math.random() * 1e9);
  const rng = new Rng(seed);
  const tpl0 = TEMPLATES[o.template];
  const byHour = o.startHour !== undefined;
  const tpl = byHour ? { ...tpl0, start: hhmmOfHour(o.startHour!) } : tpl0;
  const hourAt = (t: number) => (o.startHour ?? 0) + t / 3600;
  const metar = o.weather === 'live' && o.liveMetar ? o.liveMetar : WEATHER_PRESETS[o.weather === 'live' ? 'good' : o.weather];
  const rwy = selectRunway(pack, parseMetar(metar));
  const cs = new CallsignPool(rng);
  const spawns: SpawnSpec[] = [];
  const W = Math.max(10, o.durationMin - 15) * 60; // traffic window
  const shift = o.template === 'shift';
  const arrCurve = shiftArrCurve(W);
  const compressed = shift && !byHour;

  const arrRate = (t: number) => (byHour ? shiftCurveForHour(hourAt(t)).arr : compressed ? curveAt(arrCurve, t / W) : tpl.arrPerHr);
  const depRate = (t: number) => (byHour ? shiftCurveForHour(hourAt(t)).dep : compressed ? curveAt(SHIFT_CURVE.dep, t / W) : tpl.depPerHr);
  const arrT = poissonTimes(rng, W, arrRate, byHour ? HOUR_MAX.arr : compressed ? 24 : tpl.arrPerHr);
  const depT = poissonTimes(rng, W, depRate, byHour ? HOUR_MAX.dep : compressed ? 20 : tpl.depPerHr).filter((t) => t >= 60);
  if (!arrT.length || arrT[0] > 2) arrT.unshift(2);
  else arrT[0] = 2;
  const bankEnd = 0.5 * W, bankStart = shiftPhases(W)[1].from * W;
  for (const t of arrT) {
    const inBank = byHour ? shiftCurveForHour(hourAt(t)).phase === 'bank' : shift && t >= bankStart && t < bankEnd;
    const pax = !inBank && rng.chance(byHour ? shiftCurveForHour(hourAt(t)).paxShare : tpl.paxShare);
    const op = rng.weighted((pax ? PAX_OPS : inBank ? BANK_OPS : CARGO_OPS).map((x) => ({ w: x.w, v: x })));
    const base = rng.weighted((inBank ? BANK_STAR_BASES : ARR_STAR_BASES).map((b) => ({ w: b.w, v: b.base })));
    spawns.push({ t, kind: 'arr', cs: cs.make(op.op), type: rng.pick(op.types), star: starFor(base, rwy), spawnDist: rng.range(36, 46) });
  }
  for (const t of depT) {
    const op = rng.weighted((byHour && rng.chance(shiftCurveForHour(hourAt(t)).paxShare) ? PAX_OPS : CARGO_OPS).map((x) => ({ w: x.w, v: x })));
    spawns.push({ t, kind: 'dep', cs: cs.make(op.op), type: rng.pick(op.types), sid: sidFor(rng, rwy) });
  }
  // Military and transient traffic
  const extras: SpawnSpec[] = [];
  const at = () => Math.round(rng.range(120, Math.max(180, W - 120)));
  if (o.military >= 1 && !shift) {
    extras.push({ t: at(), kind: 'vfr', cs: cs.reg(), type: rng.pick(['C172', 'PA28']), route: ['ROMEO', 'FOXHE'], from: { brg: 300, dist: 7 }, level: { ft: 1500 }, request: { kind: 'crossing', route: ['ROMEO', 'FOXHE'] } });
    extras.push({ t: at(), kind: 'heli', cs: 'LIFE3', type: 'EC45', route: ['NOVEM', 'CHU'], from: { brg: 5, dist: 8 }, level: { ft: 1500 }, request: { kind: 'direct', fix: 'CHU' } });
  }
  if (o.military >= 2) {
    extras.push({ t: at(), kind: 'mil', cs: 'BAF' + rng.int(51, 79), type: 'F35', formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: { fl: 70 }, spd: 300, request: { kind: 'climb', level: { fl: 150 } } });
    extras.push({ t: at(), kind: 'mil', cs: 'NATO0' + rng.int(1, 9), type: 'E3TF', route: ['G_ETNG', 'ECHO', 'LNO', 'GIREL'], from: { brg: 30, dist: 3 }, level: { ft: 4000 }, request: { kind: 'climb', level: { fl: 150 } } });
    extras.push({ t: at(), kind: 'vfr', cs: cs.reg(), type: 'PA28', route: ['OSCAR', 'INDIA'], from: { brg: 150, dist: 7 }, level: { ft: 1500 }, request: { kind: 'crossing', route: ['OSCAR', 'INDIA'] } });
  }
  if (o.military >= 3) {
    extras.push({ t: at(), kind: 'ovf', cs: 'RCH' + rng.int(100, 899), type: 'C17', route: ['BUB', 'LG013', 'LNO'], from: { brg: 300, dist: 6 }, level: { fl: 90 }, request: { kind: 'direct', fix: 'LNO' } });
    extras.push({ t: at(), kind: 'cal', cs: 'FCK12', type: 'B350', route: ['NOVEM'], from: { brg: 0, dist: 10 }, level: { ft: 3000 }, request: { kind: 'lowpass' } });
    extras.push({ t: at(), kind: 'mil', cs: 'BAF7' + rng.int(10, 99), type: 'A400', route: ['ROMEO', 'ALHUV', 'SPA'], from: { brg: 300, dist: 10 }, level: { fl: 60 }, request: { kind: 'climb', level: { fl: 90 } } });
  }
  spawns.push(...extras);
  // Emergencies
  if (o.emergencies) {
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
  if (shift) drawDeck({ rng, cs, spawns, events, objectives, rwy, notes, start: tpl.start }, W);
  else if (o.military >= 2) {
    const on = Math.round(W * 0.4);
    events.push({ t: on, kind: 'tsa', name: 'TSA29A', on: true }, { t: Math.round(W * 0.9), kind: 'tsa', name: 'TSA29A', on: false });
    notes.push(`TSA 29A active from ${utcPlus(tpl.start, on)}.`);
  }
  // Brussels hands over in trail; the tower lines departures up with wake gaps.
  separateHandovers(pack, spawns);
  spaceDepartures(spawns);
  hotStart(spawns.filter((s) => s.kind === 'arr'));
  // The session lasts exactly what the player chose: arrivals appear early enough to land
  // (20 minutes before the end), everything else at least 10 minutes before it.
  const endS = o.durationMin * 60;
  const lastArr = Math.max(8 * 60, endS - 20 * 60), lastOther = Math.max(10 * 60, endS - 10 * 60);
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
  const parts = [`${byHour ? cap(shiftCurveForHour(o.startHour!).label) : tpl.title}.`, `${nArr} inbound, ${nDep} out.`, `Runway ${rwy}.`];
  if (byHour) parts.push(hourBrief(o.startHour!, W));
  else if (shift) parts.push(`Wave peaks around ${utcPlus(tpl.start, Math.round(0.33 * W))}, departures push from ${utcPlus(tpl.start, Math.round(0.6 * W))}.`);
  else parts.push(o.template === 'quiet' ? 'A gentle flow.' : 'Steady flow all session.');
  parts.push(...notes);
  if (o.weather === 'lvp') parts.push('Fog: low visibility procedures, CAT III only.');
  if (o.weather === 'storms') parts.push('Thunderstorms drifting in from the south-west; expect deviation requests.');
  if (o.weather === 'windy-ne') parts.push('Strong north-easterly, gusting 26 kt.');
  if (o.military >= 2 && !shift) parts.push('Military traffic crossing the area.');

  return {
    id: 'free', title: `Free play · ${byHour ? `${cap(shiftCurveForHour(o.startHour!).label)} from ${tpl.start}Z` : tpl.title}`, desc: 'Generated session', seed, durationMin: o.durationMin, startUtc: tpl.start, metar,
    runway: rwy, spawns, events, storms, readbackErr: [0, 0.02, 0.04, 0.06, 0.08, 0.1][o.difficulty], confusion: o.difficulty >= 4, freePlay: true,
    briefing: parts.join(' '), objectives: objectives.length ? objectives : undefined,
  };
}

/** One line on what the clock brings: the phase the session starts in and the phase changes during it. */
export function hourBrief(startHour: number, windowS: number): string {
  const first = shiftCurveForHour(startHour);
  const out = [`Starts in the ${first.label}`];
  let cur = first.label;
  for (let s = 60; s < windowS; s += 60) {
    const h = Math.round(startHour * 60 + s / 60) / 60;
    const m = shiftCurveForHour(h);
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
  return { ...sc, id: `daily-${ymd}`, title, desc: 'Today\'s shift. Everyone gets the same traffic.', briefing: sc.briefing?.replace(/^Night shift\./, 'Daily shift.') };
}
