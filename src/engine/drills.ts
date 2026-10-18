// Drills: short, repeatable exercises on one skill each, with a pass rule, a score and a best time.
// Every drill is a seeded scenario generator (a new variation per attempt), a set-up hook that places the
// aircraft exactly where the exercise needs them, a judge, and a scripted solution (used by the tests and
// as the "expert" in the ghost replay).

import type { Sim } from './sim';
import { Sim as SimClass } from './sim';
import type { Pack, Leg } from '../pack/load';
import type { Aircraft, Scenario, SpawnSpec } from './types';
import type { Item } from './clearance';
import { Rng, hashStr } from './rng';
import { angDiff, bearing, crossTrack, dist, move, norm360, type XY } from '../geo';
import { distToThr, glideAlt, tas } from './pilot';
import { PERF, wakeMinNm } from './perf';
import { afterEachStep } from './career';

export type DrillId = 'intercept' | 'wake' | 'conflict' | 'descent' | 'release';
/** The Düsseldorf drills (the UI keys its icons by DrillId; these need their own entries). */
export type DusDrillId = 'dus-intercept' | 'dus-wake' | 'dus-conflict' | 'dus-descent' | 'dus-release' | 'dus-parallel' | 'dus-merge' | 'dus-goaround';
export type AnyDrillId = DrillId | DusDrillId;
export interface DrillVerdict {
  pass: boolean;
  /** Seconds the drill measures (see `timeLabel`). */
  timeS: number;
  /** 0 to 100. */
  score: number;
  /** One plain-English sentence on why. */
  why: string;
  /** Short measured facts for the debrief. */
  facts: string[];
}
export interface DrillState {
  def: DrillDef;
  p: Record<string, any>;
  t0: number;
  ready: boolean;
  m: Record<string, any>;
  verdict?: DrillVerdict;
}
export interface DrillDef {
  /** Typed as DrillId so the 1.0 UI tables compile; the Düsseldorf drills carry a DusDrillId (CONSOLE widens its tables). */
  id: DrillId;
  /** Seed base for the drill's variations (unique per drill). Default: the 1.0 table. */
  base?: number;
  /** The callsigns the set-up waits for (default: the 1.0 parameter names). */
  cs?(p: Record<string, any>): string[];
  /** The airport the drill is written for; default EBLG. */
  icao?: string;
  title: string;
  /** One line on the home of the drills screen. */
  summary: string;
  /** The pass rule in plain words. */
  goal: string;
  /** What the time measures. */
  timeLabel: string;
  limitS: number;
  /** Variation parameters for a seed. */
  params(seed: number): Record<string, any>;
  scenario(pack: Pack, seed: number, p: Record<string, any>): Omit<Scenario, 'id' | 'title' | 'desc' | 'seed' | 'durationMin'>;
  /** Place the aircraft (runs once, right after they appear). */
  setup(sim: Sim, st: DrillState): void;
  judge(sim: Sim, st: DrillState): DrillVerdict | undefined;
  /** A scripted controller that passes the drill. */
  solve(sim: Sim, st: DrillState): void;
}

const GOOD22 = 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG';
const GOOD04 = 'EBLG 121010Z 05008KT 9999 FEW040 14/05 Q1024 NOSIG';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (seed: number, id: string) => new Rng((hashStr(id) ^ Math.imul(seed, 2654435761)) >>> 0);
const magOf = (sim: Sim, trueHdg: number) => Math.round(norm360(trueHdg - sim.pack.meta.magVar)) || 360;
const hdgTo = (sim: Sim, ac: Aircraft, trueHdg: number): Item => {
  const to = magOf(sim, trueHdg);
  const cur = norm360(ac.hdg - sim.pack.meta.magVar);
  return { k: 'hdg', hdg: to, dir: norm360(to - cur) <= 180 ? 'R' : 'L' };
};
const fmtS = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Put an aircraft exactly where a drill wants it. */
export function place(sim: Sim, ac: Aircraft, o: { p: XY; hdg: number; alt: number; ias: number; cleared?: number; route?: Leg[]; proc?: string; loc?: boolean; twr?: boolean; fl?: number }) {
  ac.p = { ...o.p }; ac.hdg = o.hdg; ac.trk = o.hdg; ac.alt = o.alt; ac.ias = o.ias; ac.vs = 0; ac.gs = tas(o.ias, o.alt);
  ac.history = [{ ...o.p }];
  const lvl = o.fl !== undefined ? { fl: o.fl } : { ft: o.cleared ?? Math.round(o.alt / 100) * 100 };
  ac.cleared = lvl; ac.cflSys = lvl; ac.tgtAlt = sim.ftOf(lvl);
  ac.route = o.route ?? []; ac.proc = o.proc ?? ac.proc; ac.hold = undefined; ac.savedRoute = undefined;
  ac.mode = o.route?.length ? 'NAV' : 'HDG';
  ac.hdgAssigned = ac.mode === 'HDG' ? o.hdg : undefined;
  ac.turnDir = undefined;
  ac.baselineNm = 0; ac.flownNm = 0;
  if (o.loc) {
    const r = sim.rwy;
    ac.mode = 'LOC';
    ac.app = { type: 'ILS', rwy: r, locCap: true, gsCap: true, capT: sim.t };
    ac.expectRwy = r.id;
    ac.stable4 = undefined;
  }
  if (o.twr) { ac.state = 'transferred'; ac.xfrUnit = 'TWR'; ac.checkInAt = undefined; ac.awaitingSince = undefined; }
  else if (ac.state === 'inbound') ac.checkInAt = sim.t + 1;
}

/** Track miles along a route from the aircraft's position to the end. */
const routeNm = (ac: Aircraft) => { let p = ac.p, d = 0; for (const l of ac.route) { d += dist(p, l.p); p = l.p; } return d; };

/** A point `nm` back along a chain of legs from its end, with the legs still to fly. */
function backAlong(legs: Leg[], nm: number): { p: XY; route: Leg[] } {
  let remaining = nm;
  for (let i = legs.length - 1; i > 0; i--) {
    const seg = dist(legs[i - 1].p, legs[i].p);
    if (remaining <= seg) return { p: move(legs[i].p, bearing(legs[i].p, legs[i - 1].p), remaining), route: legs.slice(i).map((l) => ({ ...l })) };
    remaining -= seg;
  }
  return { p: move(legs[0].p, bearing(legs[1].p, legs[0].p), remaining), route: legs.map((l) => ({ ...l })) };
}

const sends = (sim: Sim, cs: string, t0: number) => sim.cmdLog.filter((c) => c.t >= t0 && c.cl.cs === cs);
const losOrStca = (sim: Sim, a: string, b: string) => sim.events.find((e) => (e.kind === 'stca' || e.kind === 'los') && ((e.cs === a && e.cs2 === b) || (e.cs === b && e.cs2 === a)));

// ===========================================================================
// 1. Intercept: vector to a clean ILS capture

const INTERCEPT: DrillDef = {
  id: 'intercept', title: 'Intercept', timeLabel: 'to the localizer', limitS: 420,
  summary: 'Turn a freighter off base onto the ILS 22L with a clean 30° intercept.',
  goal: 'Localizer captured at no more than 30° and at least 7 NM out, then the glide captured from below.',
  params(seed) {
    const r = rnd(seed, 'intercept');
    return { D: +r.range(17, 21).toFixed(1), X: +r.range(3.5, 5.5).toFixed(1), side: r.chance(0.5) ? 1 : -1, type: r.pick(['B763', 'A306', 'B77L', 'MD11', 'B752']), cs: r.pick(['DHK7', 'TAY4EK', 'BCS5AB', 'FDX5203', 'ABR3WK']) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '02:30', metar: GOOD22, runway: '22L', readbackErr: 0, events: [], spawns: [{ t: 1, kind: 'arr', cs: p.cs, type: p.type, star: 'KOK7X', spawnDist: 20, level: { ft: 4000 }, alt: 4000 }] };
  },
  setup(sim, st) {
    const r = sim.rwy, p = st.p;
    const c = move(r.thr, r.crs + 180, p.D);
    const pos = move(c, r.crs + 180 + p.side * 90, p.X);
    const ac = sim.find(p.cs)!;
    const hdg = norm360(r.crs + p.side * 90);
    place(sim, ac, { p: pos, hdg, alt: 4000, ias: 210, proc: `heading ${String(magOf(sim, hdg)).padStart(3, '0')}` });
    ac.spdAssigned = 210;
  },
  judge(sim, st) {
    const ac = sim.find(st.p.cs);
    const r = sim.rwy, m = st.m;
    if (!ac) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'The aircraft left the scope.', facts: [] };
    if (sim.events.some((e) => e.kind === 'mva' && e.cs === ac.cs)) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'It went below the minimum vectoring altitude.', facts: [] };
    const xte = crossTrack(ac.p, r.thr, r.crs);
    if (!ac.app?.locCap) {
      m.lastHdg = ac.mode === 'HDG' ? ac.hdgAssigned : undefined;
      if (m.xte0 === undefined) m.xte0 = xte;
      if (Math.sign(xte) !== Math.sign(m.xte0) && Math.abs(xte) > 0.4) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'It flew through the localizer without capturing it. Clear the approach before the turn, and intercept at 30° or less.', facts: [] };
      if (distToThr(ac.p, r) < 5) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'Not established by 5 NM.', facts: [] };
      return undefined;
    }
    // the intercept angle is the heading the aircraft was given to join (or its track if it joined straight off a heading)
    if (m.capD === undefined) { m.capD = distToThr(ac.p, r); m.capA = Math.abs(angDiff(r.crs, ac.hdgAssigned ?? m.lastHdg ?? ac.trk)); m.capT = sim.t; }
    const facts = [`Localizer at ${m.capD.toFixed(1)} NM`, `intercept ${Math.round(m.capA)}°`];
    if (m.capA > 32) return { pass: false, timeS: sim.t - st.t0, score: 0, why: `The intercept angle was ${Math.round(m.capA)}°. Thirty degrees or less, so the crew captures without overshooting.`, facts };
    if (m.capD < 7) return { pass: false, timeS: sim.t - st.t0, score: 0, why: `Captured only ${m.capD.toFixed(1)} NM out. Give the crew at least 7 NM to settle.`, facts };
    if (ac.app.tooHigh || ac.request?.kind === 'vectors') return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'Too high for the glide. Descend it before the turn so it meets the glide from below.', facts };
    if (!ac.app.gsCap) return undefined;
    const timeS = m.capT - st.t0;
    const score = Math.round(clamp(100 - Math.max(0, m.capA - 25) * 3 - Math.max(0, 10 - m.capD) * 6 - Math.max(0, timeS - 60) / 2, 0, 100));
    return { pass: true, timeS, score, why: `Clean capture at ${m.capD.toFixed(1)} NM, ${Math.round(m.capA)}° cut, glide from below.`, facts: [...facts, `established after ${fmtS(timeS)}`] };
  },
  solve(sim, st) {
    const ac = sim.find(st.p.cs);
    if (!ac || st.m.solved || sim.t < st.t0 + 3) return;
    const r = sim.rwy;
    // hold the base leg until about 1.6 NM from the centreline, then a 30° cut; descend to 3,000 ft and clear the ILS
    const xte = Math.abs(crossTrack(ac.p, r.thr, r.crs));
    if (!st.m.desc) { sim.issue({ cs: ac.cs, items: [{ k: 'lvl', lvl: { ft: 3000 } }] }); st.m.desc = true; return; }
    if (xte > 1.8 || sim.freqBusy()) return;
    sim.issue({ cs: ac.cs, items: [hdgTo(sim, ac, r.crs + st.p.side * 30), { k: 'app', app: 'ILS', rwy: r.id }] });
    st.m.solved = true;
  },
};

// ===========================================================================
// 2. Wake gap: set the follower's speed for a target gap

const WAKE: DrillDef = {
  id: 'wake', title: 'Wake gap', timeLabel: 'to your speed call', limitS: 360,
  summary: 'Two on the localizer. One speed call to the follower sets the gap at touchdown.',
  goal: 'When the leader lands, the follower is between the wake minimum and 1 NM more.',
  params(seed) {
    const r = rnd(seed, 'wake');
    return {
      dL: +r.range(5.5, 7.5).toFixed(1), delta: +r.range(-1.5, 0.4).toFixed(1), lead: r.pick(['B744', 'B748', 'B77L']), fol: r.pick(['B738', 'A320', 'B763', 'A306', 'A321']),
      csL: r.pick(['QTR8125', 'CLX7HK', 'CKS231']), csF: r.pick(['RYR83KM', 'BCS5AB', 'TAY4EK', 'DHK7']),
    };
  },
  scenario(_pack, _seed, p) {
    return {
      startUtc: '03:05', metar: GOOD22, runway: '22L', readbackErr: 0, events: [],
      spawns: [{ t: 1, kind: 'arr', cs: p.csL, type: p.lead, star: 'KOK7X', spawnDist: 40 }, { t: 1, kind: 'arr', cs: p.csF, type: p.fol, star: 'NIK7X', spawnDist: 40 }],
    };
  },
  setup(sim, st) {
    const r = sim.rwy, p = st.p;
    const L = sim.find(p.csL)!, F = sim.find(p.csF)!;
    const min = wakeMinNm(L.perf.recat, F.perf.recat, sim.finalMinNm);
    // about 2.5 NM closes up at 210 kt: left alone, the gap ends near min + delta
    const g0 = min + 2.5 + p.delta;
    const pl = move(r.thr, r.crs + 180, p.dL), pf = move(r.thr, r.crs + 180, p.dL + g0);
    place(sim, L, { p: pl, hdg: r.crs, alt: glideAlt(r, p.dL), ias: 165, cleared: 2500, loc: true, twr: true });
    place(sim, F, { p: pf, hdg: r.crs, alt: glideAlt(r, p.dL + g0), ias: 210, cleared: 2500, loc: true });
    F.spdAssigned = 210;
    st.m.min = min;
  },
  judge(sim, st) {
    const p = st.p, m = st.m;
    const landed = sim.landings.find((l) => l.cs === p.csL);
    const F = sim.find(p.csF);
    if (!landed) {
      if (sim.events.some((e) => e.kind === 'goaround' && e.cs === p.csL)) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'The leader went around.', facts: [] };
      return undefined;
    }
    if (!F) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'The follower is gone.', facts: [] };
    const gap = distToThr(F.p, sim.rwy);
    const call = sends(sim, p.csF, st.t0).find((c) => c.cl.items.some((i) => i.k === 'spd' || i.k === 'spdmin' || i.k === 'spdres'));
    const timeS = call ? call.t - st.t0 : sim.t - st.t0;
    const min = m.min as number, target = min + 0.5;
    const facts = [`gap ${gap.toFixed(1)} NM`, `minimum ${min} NM`];
    if (gap < min - 0.05) return { pass: false, timeS, score: 0, why: `${gap.toFixed(1)} NM at touchdown: inside the ${min} NM wake minimum. Slow the follower earlier.`, facts };
    if (gap > min + 1) return { pass: false, timeS, score: Math.round(clamp(40 - (gap - min - 1) * 20, 0, 40)), why: `${gap.toFixed(1)} NM: more than 1 NM above the ${min} NM minimum. That is a lost landing slot.`, facts };
    const score = Math.round(clamp(100 - Math.abs(gap - target) * 70 - Math.max(0, timeS - 40) / 3, 0, 100));
    return { pass: true, timeS, score, why: `${gap.toFixed(1)} NM behind the leader, on a ${min} NM minimum.`, facts };
  },
  solve(sim, st) {
    if (st.m.solved || sim.t < st.t0 + 4) return;
    const F = sim.find(st.p.csF);
    if (!F || sim.freqBusy()) return;
    // search: fly the same drill from scratch with each candidate speed and keep the one nearest the target gap
    const t = sim.t;
    let best = { spd: 0, err: Infinity };
    for (let spd = 140; spd <= 220; spd += 10) {
      const g = probeGap(sim, st, t, spd);
      if (g === undefined) continue;
      const err = Math.abs(g - (st.m.min + 0.5));
      if (err < best.err) best = { spd, err };
    }
    sim.issue({ cs: F.cs, items: best.spd >= 210 ? [{ k: 'spd', spd: 210, until: 4 }] : [{ k: 'spd', spd: best.spd, until: 4 }] });
    st.m.solved = true;
  },
};
function probeGap(sim: Sim, st: DrillState, at: number, spd: number): number | undefined {
  const sub = new SimClass(sim.pack, sim.sc);
  const sst = attachDrill(sub, st.def, { noEnd: true });
  while (sub.t < at) sub.step();
  sub.issue({ cs: st.p.csF, items: [{ k: 'spd', spd, until: 4 }] });
  while (sub.t < at + st.def.limitS && !sub.landings.some((l) => l.cs === st.p.csL)) sub.step();
  const F = sub.find(st.p.csF);
  void sst;
  return F ? distToThr(F.p, sub.rwy) : undefined;
}

// ===========================================================================
// 3. Conflict: resolve a converging pair with zero conflict alerts

const CONFLICT: DrillDef = {
  id: 'conflict', title: 'Conflict', timeLabel: 'to a safe solution', limitS: 300,
  summary: 'Two jets converging at the same level. Fix it before the alert does.',
  goal: 'They pass with no conflict alert and no loss of separation.',
  params(seed) {
    const r = rnd(seed, 'conflict');
    const hA = r.int(0, 35) * 10;
    return {
      cx: +r.range(-14, 14).toFixed(1), cy: +r.range(-16, -6).toFixed(1), hA, hB: norm360(hA + (r.chance(0.5) ? 1 : -1) * r.int(7, 11) * 10),
      tc: r.int(140, 175), fl: r.pick([70, 80, 90]), csA: r.pick(['DLH4KM', 'EZY52TP', 'BEL7AF']), csB: r.pick(['RYR4VB', 'TRA6421', 'JAF4NT']), tA: r.pick(['A320', 'A321']), tB: r.pick(['B738', 'E190']),
    };
  },
  scenario(_pack, _seed, p) {
    return {
      startUtc: '14:20', metar: GOOD22, runway: '22L', readbackErr: 0, events: [],
      spawns: [{ t: 1, kind: 'ovf', cs: p.csA, type: p.tA, level: { fl: p.fl }, from: { brg: 90, dist: 30 } }, { t: 1, kind: 'ovf', cs: p.csB, type: p.tB, level: { fl: p.fl }, from: { brg: 270, dist: 30 } }],
    };
  },
  setup(sim, st) {
    const p = st.p;
    const c = { x: p.cx, y: p.cy };
    const alt = sim.ftOf({ fl: p.fl });
    for (const [cs, h] of [[p.csA, p.hA], [p.csB, p.hB]] as [string, number][]) {
      const ac = sim.find(cs)!;
      const gs = tas(250, alt);
      place(sim, ac, { p: move(c, h + 180, (gs * p.tc) / 3600), hdg: h, alt, ias: 250, fl: p.fl });
      ac.spdAssigned = 250;
    }
  },
  judge(sim, st) {
    const p = st.p, m = st.m;
    const a = sim.find(p.csA), b = sim.find(p.csB);
    const hit = losOrStca(sim, p.csA, p.csB);
    if (hit) return { pass: false, timeS: sim.t - st.t0, score: 0, why: hit.kind === 'los' ? 'They lost separation.' : 'The conflict alert went off. Move one of them sooner, with a turn or 1,000 ft.', facts: [] };
    if (!a || !b) return { pass: true, timeS: m.safeT ?? sim.t - st.t0, score: 60, why: 'They passed safely.', facts: [] };
    // straight-line closest approach from here, with the vertical gap they are cleared to
    const va = { x: Math.sin((a.trk * Math.PI) / 180) * a.gs, y: Math.cos((a.trk * Math.PI) / 180) * a.gs };
    const vb = { x: Math.sin((b.trk * Math.PI) / 180) * b.gs, y: Math.cos((b.trk * Math.PI) / 180) * b.gs };
    const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, dvx = (vb.x - va.x) / 3600, dvy = (vb.y - va.y) / 3600;
    const tcpa = Math.max(0, -(dx * dvx + dy * dvy) / Math.max(1e-9, dvx * dvx + dvy * dvy));
    const cpa = Math.hypot(dx + dvx * tcpa, dy + dvy * tcpa);
    const vert = Math.abs(sim.ftOf(a.cleared) - sim.ftOf(b.cleared));
    const safe = cpa >= 3.5 || (vert >= 1000 && Math.abs(a.alt - b.alt) >= 900);
    if (!safe) m.safeT = undefined; else if (m.safeT === undefined) m.safeT = sim.t - st.t0;
    m.minCpa = Math.min(m.minCpa ?? 99, dist(a.p, b.p));
    const passed = (tcpa === 0 && (dist(a.p, b.p) > 5 || (vert >= 1000 && Math.abs(a.alt - b.alt) >= 950))) || (safe && sim.t - st.t0 > p.tc + 60);
    if (!passed) return undefined;
    const timeS = m.safeT ?? sim.t - st.t0;
    const score = Math.round(clamp(100 - Math.max(0, timeS - 15) * 0.6, 0, 100));
    return { pass: true, timeS, score, why: `Solved ${fmtS(timeS)} in, with no alert. Closest they came: ${m.minCpa.toFixed(1)} NM.`, facts: [`closest ${m.minCpa.toFixed(1)} NM`] };
  },
  solve(sim, st) {
    if (st.m.solved || sim.t < st.t0 + 4 || sim.freqBusy()) return;
    const a = sim.find(st.p.csA), b = sim.find(st.p.csB);
    if (!a || !b) return;
    // climb one 1,000 ft and turn the other 40° away behind it
    if (!st.m.climb) { sim.issue({ cs: a.cs, items: [{ k: 'lvl', lvl: { fl: st.p.fl + 10 } }] }); st.m.climb = true; return; }
    const away = angDiff(bearing(b.p, a.p), b.hdg) > 0 ? 40 : -40;
    sim.issue({ cs: b.cs, items: [hdgTo(sim, b, b.hdg + away)] });
    st.m.solved = true;
  },
};

// ===========================================================================
// 4. Descent: make the IF at 3,000 ft from FL090

const DESCENT: DrillDef = {
  id: 'descent', title: 'Descent', timeLabel: 'to the IF', limitS: 600,
  summary: 'From FL090 on the transition, one continuous descent to TUTSO at 3,000 ft.',
  goal: 'Cross TUTSO, the intermediate fix for 04R, between 2,900 and 3,300 ft, without levelling off on the way.',
  params(seed) {
    const r = rnd(seed, 'descent');
    return { nm: +r.range(27, 33).toFixed(1), type: r.pick(['B763', 'B77L', 'A332', 'B744']), cs: r.pick(['ETH3721', 'THY6411', 'QTR8152', 'AZG7321']) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '10:20', metar: GOOD04, runway: '04R', readbackErr: 0, events: [], spawns: [{ t: 1, kind: 'arr', cs: p.cs, type: p.type, star: 'CIV7D', spawnDist: 20, level: { fl: 90 } }] };
  },
  setup(sim, st) {
    const pack = sim.pack;
    const tr = pack.transitions.find((t) => t.name === 'ALHUV1Z')!;
    const chain: Leg[] = [{ fix: 'RUDIX', p: pack.fixes.get('RUDIX')!.p }, ...tr.legs.map((l) => ({ fix: l.fix, p: l.p }))];
    const at = backAlong(chain, st.p.nm);
    const ac = sim.find(st.p.cs)!;
    place(sim, ac, { p: at.p, hdg: bearing(at.p, at.route[0].p), alt: sim.ftOf({ fl: 90 }), ias: 250, fl: 90, route: at.route, proc: 'ALHUV1Z' });
    st.m.ifFix = sim.rwy.ifFix;
    st.m.ifAlt = sim.rwy.ifAlt;
  },
  judge(sim, st) {
    const ac = sim.find(st.p.cs), m = st.m;
    if (!ac) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'The aircraft left the scope.', facts: [] };
    if (sim.events.some((e) => e.kind === 'mva' && e.cs === ac.cs)) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'It went below the minimum vectoring altitude.', facts: [] };
    // step-downs: a descent that stops above 3,300 ft and starts again
    const desc = ac.vs < -300;
    if (m.wasDesc && !desc && Math.abs(ac.vs) < 100 && ac.alt > m.ifAlt + 300) m.paused = true;
    if (m.paused && desc) { m.steps = (m.steps ?? 0) + 1; m.paused = false; }
    m.wasDesc = desc || (m.wasDesc && Math.abs(ac.vs) >= 100);
    if (Math.abs(ac.vs) < 100 && ac.alt <= m.ifAlt + 150) m.lowNm = (m.lowNm ?? 0) + ac.gs / 3600;
    const ifP = sim.pack.fixes.get(m.ifFix)!.p;
    const d = dist(ac.p, ifP);
    const still = ac.route.some((l) => l.fix === m.ifFix);
    if (still && d > 0.6) { m.lastD = d; return undefined; }
    const alt = ac.alt;
    const timeS = sim.t - st.t0;
    const facts = [`${Math.round(alt / 10) * 10} ft at ${m.ifFix}`, `${m.steps ?? 0} step-downs`, `${(m.lowNm ?? 0).toFixed(1)} NM level at 3,000 ft before it`];
    if (alt > m.ifAlt + 300) return { pass: false, timeS, score: 0, why: `${Math.round(alt)} ft at ${m.ifFix}: too high to join the glide. Start the descent earlier.`, facts };
    if (alt < m.ifAlt - 100) return { pass: false, timeS, score: 0, why: `${Math.round(alt)} ft at ${m.ifFix}: below the published altitude.`, facts };
    const score = Math.round(clamp(100 - Math.abs(alt - m.ifAlt) / 6 - (m.steps ?? 0) * 15 - Math.max(0, (m.lowNm ?? 0) - 1) * 5, 0, 100));
    if (m.steps) return { pass: false, timeS, score: Math.min(score, 40), why: 'It levelled off on the way down. Give one clearance to 3,000 ft at the right moment instead of steps.', facts };
    return { pass: true, timeS, score, why: `${Math.round(alt)} ft at ${m.ifFix} in one continuous descent.`, facts };
  },
  solve(sim, st) {
    const ac = sim.find(st.p.cs);
    if (!ac || st.m.solved || sim.t < st.t0 + 3 || sim.freqBusy()) return;
    // 3 NM per 1,000 ft plus 2 NM to slow down
    const need = ((ac.alt - st.m.ifAlt) / 1000) * 3 + 2;
    if (routeNm(ac) > need) return;
    sim.issue({ cs: ac.cs, items: [{ k: 'lvl', lvl: { ft: st.m.ifAlt } }] });
    st.m.solved = true;
  },
};

// ===========================================================================
// 5. Release: time a departure between two arrivals

const RELEASE: DrillDef = {
  id: 'release', title: 'Release', timeLabel: 'to release', limitS: 420,
  summary: 'Tower has a departure ready and two arrivals on final. Fit it in the gap.',
  goal: 'The departure gets airborne after the first arrival lands and before the second, with nobody going around.',
  params(seed) {
    const r = rnd(seed, 'release');
    return {
      d1: +r.range(3, 4).toFixed(1), d2: +r.range(13.4, 14.4).toFixed(1), dep: r.pick(['B738', 'A321', 'MD11', 'B763']), sid: r.pick(['LNO9S', 'BUB9S', 'CIV5S']),
      cs1: r.pick(['QTR8125', 'CHG201']), cs2: r.pick(['ETH3721', 'TAY4EK']), csD: r.pick(['FDX5240', 'CHG7302', 'TAY71K', 'ABR3XC']),
    };
  },
  scenario(_pack, _seed, p) {
    const sp: SpawnSpec[] = [
      { t: 1, kind: 'arr', cs: p.cs1, type: 'B77L', star: 'KOK7X', spawnDist: 40 }, { t: 1, kind: 'arr', cs: p.cs2, type: 'B763', star: 'NIK7X', spawnDist: 40 },
      { t: 3, kind: 'dep', cs: p.csD, type: p.dep, sid: p.sid },
    ];
    return { startUtc: '23:40', metar: GOOD22, runway: '22L', readbackErr: 0, events: [], spawns: sp };
  },
  setup(sim, st) {
    const r = sim.rwy, p = st.p;
    for (const [cs, d, ias] of [[p.cs1, p.d1, 150], [p.cs2, p.d2, 170]] as [string, number, number][]) {
      const ac = sim.find(cs)!;
      place(sim, ac, { p: move(r.thr, r.crs + 180, d), hdg: r.crs, alt: glideAlt(r, d), ias, cleared: 2500, loc: true, twr: true });
    }
  },
  judge(sim, st) {
    const p = st.p;
    const ga = sim.events.find((e) => e.kind === 'goaround');
    if (ga) return { pass: false, timeS: sim.t - st.t0, score: 0, why: `${ga.cs} went around.`, facts: [] };
    const rel = sim.cmdLog.find((c) => c.cl.cs === p.csD && c.cl.items.some((i) => i.k === 'rel'));
    const req = st.m.reqT ?? (st.m.reqT = sim.releases.find((r) => r.cs === p.csD)?.t);
    const dep = sim.spawnLog.find((s) => s.cs === p.csD);
    const l1 = sim.landings.find((l) => l.cs === p.cs1), l2 = sim.landings.find((l) => l.cs === p.cs2);
    const timeS = rel && req !== undefined ? rel.t - req : sim.t - st.t0;
    if (sim.events.some((e) => e.kind === 'los')) return { pass: false, timeS, score: 0, why: 'Loss of separation.', facts: [] };
    if (!l2) {
      if (dep && l1) {
        const a2 = sim.find(p.cs2);
        const d2 = a2 ? distToThr(a2.p, sim.rwy) : 0;
        if (!st.m.d2) st.m.d2 = d2;
      }
      return undefined;
    }
    if (!dep || dep.t > l2.t) return { pass: false, timeS, score: 0, why: rel ? `Released ${fmtS(timeS)} after Tower asked: too late, the gap had closed. Decide while the first arrival is still on final.` : 'Never released: the gap closed. Tower needs an answer.', facts: [] };
    const score = Math.round(clamp(100 - Math.max(0, timeS - 5) * 0.5, 0, 100));
    return { pass: true, timeS, score, why: `Airborne in the gap, ${st.m.d2 ? st.m.d2.toFixed(1) + ' NM ahead of ' + p.cs2 : 'ahead of the second arrival'}. Released ${Math.round(timeS)} s after Tower asked.`, facts: [`released after ${Math.round(timeS)} s`] };
  },
  solve(sim, st) {
    if (st.m.solved) return;
    const r = sim.releases.find((x) => x.cs === st.p.csD && x.state === 'pending');
    if (!r || sim.t < r.t + 2) return;
    sim.issue({ cs: r.cs, items: [{ k: 'rel' }] });
    st.m.solved = true;
  },
};


// ===========================================================================
// Düsseldorf drills: the same skills with Düsseldorf geometry (runway 23L, the BIKMU23 and DOMUX23 transitions, the
// parallel 23R), and three of its own: the 2.5 NM diagonal between the parallels, the merge of the two downwinds and a
// go-around off 23R into the 23L departure climb.

const DUS_GOOD = 'EDDL 120550Z 23008KT 9999 FEW035 12/07 Q1018 NOSIG';
const DUS_PAX = ['A320', 'A321', 'B738', 'A319', 'A20N'];
const DUS_CS = ['EWG4KL', 'DLH9TW', 'CFG2EP', 'TUI7MD', 'SXS3LR', 'RYR8JB', 'EJU59KE', 'KLM1855'];
const dusArr = (cs: string, type: string, star = 'BIKMU1A', x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t: 1, kind: 'arr', cs, type, star, spawnDist: 30, ...x });

const DUS_INTERCEPT: DrillDef = {
  ...INTERCEPT, id: 'dus-intercept' as DrillId, icao: 'EDDL', base: 7600,
  summary: 'Turn a Eurowings off base onto the ILS 23L with a clean 30° intercept.',
  params(seed) {
    const r = rnd(seed, 'dus-intercept');
    return { D: +r.range(17, 21).toFixed(1), X: +r.range(3.5, 5.5).toFixed(1), side: r.chance(0.5) ? 1 : -1, type: r.pick(DUS_PAX), cs: r.pick(DUS_CS) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '09:30', metar: DUS_GOOD, runway: '23L', readbackErr: 0, events: [], spawns: [dusArr(p.cs, p.type, 'BIKMU1A', { spawnDist: 20, level: { ft: 4000 }, alt: 4000 })] };
  },
};

const DUS_WAKE: DrillDef = {
  ...WAKE, id: 'dus-wake' as DrillId, icao: 'EDDL', base: 7700,
  summary: 'An Emirates heavy and a Eurowings on the 23L localizer. One speed call to the follower sets the gap at touchdown.',
  params(seed) {
    const r = rnd(seed, 'dus-wake');
    return { dL: +r.range(5.5, 7.5).toFixed(1), delta: +r.range(-1.5, 0.4).toFixed(1), lead: r.pick(['A388', 'B77W', 'A333']), fol: r.pick(['A320', 'B738', 'A321', 'E190']), csL: r.pick(['UAE55', 'UAE57', 'CFG1708']), csF: r.pick(['EWG2EK', 'DLH7PK', 'TUI3EA', 'KLM1853']) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '12:05', metar: DUS_GOOD, runway: '23L', readbackErr: 0, events: [], spawns: [dusArr(p.csL, p.lead, 'DOMUX1A', { spawnDist: 40 }), dusArr(p.csF, p.fol, 'BIKMU1A', { spawnDist: 40 })] };
  },
};

const DUS_CONFLICT: DrillDef = {
  ...CONFLICT, id: 'dus-conflict' as DrillId, icao: 'EDDL', base: 7800,
  summary: 'Two jets converging over the Ruhr at the same level. Fix it before the alert does.',
  params(seed) {
    const r = rnd(seed, 'dus-conflict');
    const hA = r.int(0, 35) * 10;
    return {
      cx: +r.range(-10, 14).toFixed(1), cy: +r.range(8, 20).toFixed(1), hA, hB: norm360(hA + (r.chance(0.5) ? 1 : -1) * r.int(7, 11) * 10),
      tc: r.int(140, 175), fl: r.pick([90, 100, 110]), csA: r.pick(['DLH4KM', 'EWG52TP', 'CFG7AF']), csB: r.pick(['RYR4VB', 'TUI6421', 'SXS4NT']), tA: r.pick(['A320', 'A321']), tB: r.pick(['B738', 'E190']),
    };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '14:20', metar: DUS_GOOD, runway: '23L', readbackErr: 0, events: [], spawns: [{ t: 1, kind: 'ovf', cs: p.csA, type: p.tA, level: { fl: p.fl }, from: { brg: 90, dist: 30 } }, { t: 1, kind: 'ovf', cs: p.csB, type: p.tB, level: { fl: p.fl }, from: { brg: 270, dist: 30 } }] };
  },
};

const DUS_DESCENT: DrillDef = {
  ...DESCENT, id: 'dus-descent' as DrillId, icao: 'EDDL', base: 7900, timeLabel: 'to REGNO',
  summary: 'From 6,000 ft on the BIKMU transition round the downwind, one continuous descent to REGNO at 3,000 ft.',
  goal: 'Cross REGNO, the final approach fix for the 23 finals, between 2,900 and 3,300 ft, without levelling off on the way.',
  params(seed) {
    const r = rnd(seed, 'dus-descent');
    return { nm: +r.range(16, 21).toFixed(1), type: r.pick(DUS_PAX), cs: r.pick(DUS_CS) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '10:20', metar: DUS_GOOD, runway: '23L', readbackErr: 0, events: [], spawns: [dusArr(p.cs, p.type, 'BIKMU1A', { spawnDist: 20, level: { ft: 6000 } })] };
  },
  setup(sim, st) {
    const tr = sim.pack.transitions.find((t) => t.name === 'BIKMU23')!;
    const chain: Leg[] = tr.legs.map((l) => ({ fix: l.fix, p: l.p }));
    const at = backAlong(chain, st.p.nm);
    const ac = sim.find(st.p.cs)!;
    place(sim, ac, { p: at.p, hdg: bearing(at.p, at.route[0].p), alt: 6000, ias: 220, cleared: 6000, route: at.route, proc: 'BIKMU23' });
    ac.spdAssigned = 220;
    ac.app = { type: 'ILS', rwy: sim.rwy, locCap: false, gsCap: false };
    ac.expectRwy = sim.rwy.id;
    st.m.ifFix = 'REGNO';
    st.m.ifAlt = 3000;
  },
  solve(sim, st) {
    const ac = sim.find(st.p.cs);
    if (!ac || st.m.solved || sim.t < st.t0 + 3 || sim.freqBusy()) return;
    const need = ((ac.alt - st.m.ifAlt) / 1000) * 3 + 2;
    if (routeNm(ac) > need) return;
    sim.issue({ cs: ac.cs, items: [{ k: 'lvl', lvl: { ft: st.m.ifAlt } }] });
    st.m.solved = true;
  },
};

const DUS_RELEASE: DrillDef = {
  ...RELEASE, id: 'dus-release' as DrillId, icao: 'EDDL', base: 8000,
  summary: 'Single-runway operation on 23L: Tower has a departure ready and two arrivals on final. Fit it in the gap.',
  params(seed) {
    const r = rnd(seed, 'dus-release');
    return {
      d1: +r.range(3, 4).toFixed(1), d2: +r.range(13.4, 14.4).toFixed(1), dep: r.pick(['A320', 'B738', 'A321', 'B753']), sid: r.pick(['MODRU2T', 'MEVEL4T', 'COL6T', 'KUMIK7T']),
      cs1: r.pick(['EWG2EK', 'CFG1414']), cs2: r.pick(['DLH7PK', 'TUI3EA']), csD: r.pick(['EWG8766', 'DLH1VL', 'SXS6KA', 'CFG3192']),
    };
  },
  scenario(_pack, _seed, p) {
    const sp: SpawnSpec[] = [dusArr(p.cs1, 'A321', 'BIKMU1A', { spawnDist: 40 }), dusArr(p.cs2, 'B738', 'DOMUX1A', { spawnDist: 40 }), { t: 3, kind: 'dep', cs: p.csD, type: p.dep, sid: p.sid }];
    return { startUtc: '07:40', metar: DUS_GOOD, runway: '23L', readbackErr: 0, events: [], spawns: sp };
  },
};

// 6. Parallel: the 2.5 NM diagonal between the two 23 finals
const DUS_PARALLEL: DrillDef = {
  id: 'dus-parallel' as DrillId, icao: 'EDDL', base: 8100, title: 'Parallels', timeLabel: 'to your speed call', limitS: 360,
  summary: 'One on the 23R localizer, one joining 23L beside it. Set the follower so it stays 2.5 NM diagonal inside 10 NM.',
  goal: 'When the leader lands on 23R, the follower on 23L is between 2.5 and 3.5 NM from its threshold.',
  cs: (p) => [p.csL, p.csF],
  params(seed) {
    const r = rnd(seed, 'dus-parallel');
    return { dL: +r.range(6, 8).toFixed(1), delta: +r.range(-1.2, 0.6).toFixed(1), lead: r.pick(['A320', 'B738', 'A321']), fol: r.pick(['A320', 'A319', 'E190', 'B738']), csL: r.pick(['EWG2EK', 'CFG1414', 'TUI3EA']), csF: r.pick(['DLH7PK', 'SXS6KA', 'KLM1853']) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '15:10', metar: DUS_GOOD, runway: '23R', readbackErr: 0, events: [], spawns: [dusArr(p.csL, p.lead, 'BIKMU1A', { spawnDist: 40 }), dusArr(p.csF, p.fol, 'DOMUX1A', { spawnDist: 40 })] };
  },
  setup(sim, st) {
    const p = st.p;
    const rR = sim.pack.runways.get('23R')!, rL = sim.pack.runways.get('23L')!;
    const L = sim.find(p.csL)!, F = sim.find(p.csF)!;
    const g0 = 2.5 + 2.2 + p.delta;
    place(sim, L, { p: move(rR.thr, rR.crs + 180, p.dL), hdg: rR.crs, alt: glideAlt(rR, p.dL), ias: 165, cleared: 3000, loc: true, twr: true });
    L.app = { type: 'ILS', rwy: rR, locCap: true, gsCap: true, capT: sim.t }; L.expectRwy = '23R';
    place(sim, F, { p: move(rL.thr, rL.crs + 180, p.dL + g0), hdg: rL.crs, alt: glideAlt(rL, p.dL + g0), ias: 210, cleared: 3000, loc: true });
    F.app = { type: 'ILS', rwy: rL, locCap: true, gsCap: true, capT: sim.t }; F.expectRwy = '23L';
    F.spdAssigned = 210;
  },
  judge(sim, st) {
    const p = st.p;
    const landed = sim.landings.find((l) => l.cs === p.csL);
    const F = sim.find(p.csF);
    if (sim.events.some((e) => e.kind === 'los')) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'They came inside 2.5 NM of each other inside 10 NM. Slow the follower earlier.', facts: [] };
    if (!landed) return sim.events.some((e) => e.kind === 'goaround' && e.cs === p.csL) ? { pass: false, timeS: sim.t - st.t0, score: 0, why: 'The leader went around.', facts: [] } : undefined;
    if (!F) return { pass: false, timeS: sim.t - st.t0, score: 0, why: 'The follower is gone.', facts: [] };
    const gap = distToThr(F.p, sim.pack.runways.get('23L')!);
    const call = sends(sim, p.csF, st.t0).find((c) => c.cl.items.some((i) => i.k === 'spd' || i.k === 'spdmin' || i.k === 'spdres'));
    const timeS = call ? call.t - st.t0 : sim.t - st.t0;
    const facts = [`${gap.toFixed(1)} NM from the 23L threshold`, 'minimum 2.5 NM diagonal'];
    if (gap < 2.45) return { pass: false, timeS, score: 0, why: `${gap.toFixed(1)} NM when the leader landed: inside the 2.5 NM the parallels allow. Slow the follower earlier.`, facts };
    if (gap > 3.5) return { pass: false, timeS, score: Math.round(clamp(40 - (gap - 3.5) * 20, 0, 40)), why: `${gap.toFixed(1)} NM: more than 1 NM above the 2.5 NM diagonal. That is a lost landing slot on the parallel.`, facts };
    const score = Math.round(clamp(100 - Math.abs(gap - 3) * 70 - Math.max(0, timeS - 40) / 3, 0, 100));
    return { pass: true, timeS, score, why: `${gap.toFixed(1)} NM diagonal behind the leader on the other runway: 2.5 NM applies between the parallels inside 10 NM.`, facts };
  },
  solve(sim, st) {
    if (st.m.solved || sim.t < st.t0 + 4) return;
    const F = sim.find(st.p.csF);
    if (!F || sim.freqBusy()) return;
    let best = { spd: 0, err: Infinity };
    for (let spd = 140; spd <= 210; spd += 10) {
      const g = probeGapOn(sim, st, sim.t, spd, '23L', st.p.csL);
      if (g === undefined) continue;
      const err = Math.abs(g - 3);
      if (err < best.err) best = { spd, err };
    }
    sim.issue({ cs: F.cs, items: [{ k: 'spd', spd: best.spd || 180, until: 4 }] });
    st.m.solved = true;
  },
};
function probeGapOn(sim: Sim, st: DrillState, at: number, spd: number, rwyId: string, leaderCs: string): number | undefined {
  const sub = new SimClass(sim.pack, sim.sc);
  attachDrill(sub, st.def, { noEnd: true });
  while (sub.t < at) sub.step();
  sub.issue({ cs: st.p.csF, items: [{ k: 'spd', spd, until: 4 }] });
  while (sub.t < at + st.def.limitS && !sub.landings.some((l) => l.cs === leaderCs)) sub.step();
  const F = sub.find(st.p.csF);
  return F ? distToThr(F.p, sub.pack.runways.get(rwyId)!) : undefined;
}

// 7. Merge: the two downwinds meet on the 23L final
const DUS_MERGE: DrillDef = {
  id: 'dus-merge' as DrillId, icao: 'EDDL', base: 8200, title: 'Two downwinds', timeLabel: 'to a decided order', limitS: 720,
  summary: 'One on the north-eastern downwind, one on the south-eastern, both at 5,000 ft and a minute apart from the final. Bring them onto one final.',
  goal: 'Both land 23L in trail with no conflict alert, the second at least 3 NM behind the first at the first touchdown. Keep 1,000 ft between them until they are in trail.',
  cs: (p) => [p.csN, p.csS],
  params(seed) {
    const r = rnd(seed, 'dus-merge');
    return { nmN: +r.range(14, 18).toFixed(1), bias: +r.range(5, 7).toFixed(1), tN: r.pick(DUS_PAX), tS: r.pick(['A320', 'A319', 'A20N', 'E190']), csN: r.pick(['EWG4KL', 'DLH9TW', 'TUI7MD']), csS: r.pick(['CFG2EP', 'SXS3LR', 'RYR8JB']) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '16:30', metar: DUS_GOOD, runway: '23L', readbackErr: 0, events: [], spawns: [dusArr(p.csN, p.tN, 'BIKMU1A', { spawnDist: 20, level: { ft: 5000 } }), dusArr(p.csS, p.tS, 'DOMUX1A', { spawnDist: 20, level: { ft: 5000 } })] };
  },
  setup(sim, st) {
    const p = st.p;
    const north = sim.pack.transitions.find((t) => t.name === 'BIKMU23')!, south = sim.pack.transitions.find((t) => t.name === 'DOMUX23')!;
    const n = backAlong(north.legs.map((l) => ({ fix: l.fix, p: l.p })), p.nmN);
    const s = backAlong(south.legs.map((l) => ({ fix: l.fix, p: l.p })), p.nmN + p.bias);
    for (const [cs, at, proc] of [[p.csN, n, 'BIKMU23'], [p.csS, s, 'DOMUX23']] as [string, typeof n, string][]) {
      const ac = sim.find(cs)!;
      place(sim, ac, { p: at.p, hdg: bearing(at.p, at.route[0].p), alt: 5000, ias: 220, cleared: 5000, route: at.route, proc });
      ac.spdAssigned = 220;
      ac.expectRwy = sim.rwy.id;
    }
  },
  judge(sim, st) {
    const p = st.p, m = st.m;
    const hit = losOrStca(sim, p.csN, p.csS);
    if (hit) return { pass: false, timeS: sim.t - st.t0, score: 0, why: hit.kind === 'los' ? 'They lost separation at the merge.' : 'The conflict alert went off. Decide the order early: slow one, or keep 1,000 ft between them until they are in trail.', facts: [] };
    const first = sends(sim, p.csN, st.t0).concat(sends(sim, p.csS, st.t0)).sort((a, b) => a.t - b.t)[0];
    if (first && m.decidedT === undefined) m.decidedT = first.t - st.t0;
    const l1 = sim.landings[0], l2 = sim.landings[1];
    if (sim.events.some((e) => e.kind === 'goaround')) return { pass: false, timeS: sim.t - st.t0, score: 0, why: `${sim.events.find((e) => e.kind === 'goaround')!.cs} went around.`, facts: [] };
    if (!l1) return undefined;
    const second = sim.find(l1.cs === p.csN ? p.csS : p.csN);
    if (!l2) {
      if (second && m.gap === undefined && second.app?.locCap) m.gap = distToThr(second.p, sim.rwy);
      return undefined;
    }
    const gap = m.gap as number | undefined;
    const timeS = m.decidedT ?? sim.t - st.t0;
    const facts = [`${l1.cs} first`, gap !== undefined ? `${gap.toFixed(1)} NM between them at the first touchdown` : ''].filter(Boolean);
    if (gap !== undefined && gap < 2.95) return { pass: false, timeS, score: 0, why: `Only ${gap.toFixed(1)} NM between them at the first touchdown.`, facts };
    const score = Math.round(clamp(100 - Math.max(0, timeS - 20) * 0.4 - Math.max(0, (gap ?? 4) - 5) * 15, 0, 100));
    return { pass: true, timeS, score, why: `${l1.cs} first, ${l2.cs} ${gap !== undefined ? gap.toFixed(1) + ' NM' : 'well'} behind. Decided ${fmtS(timeS)} in.`, facts };
  },
  solve(sim, st) {
    if (st.m.solved || sim.t < st.t0 + 4 || sim.freqBusy()) return;
    const n = sim.find(st.p.csN), s = sim.find(st.p.csS);
    if (!n || !s) return;
    // the northern one goes first: down to 3,000 ft and the approach now; the southern one stays at 5,000 ft until the
    // first is on the localizer, then gets its descent and approach behind it
    const once = (key: string, cs: string, items: Item[]) => { if (st.m[key]) return false; sim.issue({ cs, items }); st.m[key] = sim.t; return true; };
    if (once('first', n.cs, [{ k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: sim.rwy.id }])) return;
    if (once('slow', s.cs, [{ k: 'spd', spd: s.perf.vminClean }])) return;
    if (n.alt < 3400 && sim.dthr(s) < 15.5 && once('second', s.cs, [{ k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: sim.rwy.id }])) return;
    for (const a of [n, s]) if (a.app?.locCap && a.state === 'assumed' && !sim.readbackPending(a.cs)) { sim.issue({ cs: a.cs, items: [{ k: 'xfr', unit: sim.twr.id }] }); return; }
  },
};

// 8. Go-around off 23R into the 23L departure climb
const DUS_GOAROUND: DrillDef = {
  id: 'dus-goaround' as DrillId, icao: 'EDDL', base: 8300, title: 'Go-around', timeLabel: 'to a safe solution', limitS: 420,
  summary: 'Tower sends an arrival on 23R around as a departure rolls from 23L. Both climb through the same airspace.',
  goal: 'No conflict alert and no loss of separation between the go-around and the departure in the first five minutes.',
  cs: (p) => [p.csA, p.csD],
  params(seed) {
    const r = rnd(seed, 'dus-goaround');
    return { dA: +r.range(1.2, 1.8).toFixed(1), tA: r.pick(DUS_PAX), tD: r.pick(['A320', 'B738', 'A321', 'B753']), sid: r.pick(['MEVEL4T', 'SONEB8T']), csA: r.pick(['EWG4KL', 'DLH9TW', 'TUI7MD']), csD: r.pick(['CFG2EP', 'SXS3LR', 'EJU59KE']) };
  },
  scenario(_pack, _seed, p) {
    return { startUtc: '15:40', metar: DUS_GOOD, runway: '23R', readbackErr: 0, events: [], spawns: [dusArr(p.csA, p.tA, 'BIKMU1A', { spawnDist: 40 }), { t: 1, kind: 'dep', cs: p.csD, type: p.tD, sid: p.sid, released: true }] };
  },
  setup(sim, st) {
    const p = st.p;
    const r = sim.pack.runways.get('23R')!;
    const a = sim.find(p.csA)!;
    place(sim, a, { p: move(r.thr, r.crs + 180, p.dA), hdg: r.crs, alt: glideAlt(r, p.dA), ias: a.perf.vapp + 5, cleared: 3000, loc: true, twr: true });
    a.app = { type: 'ILS', rwy: r, locCap: true, gsCap: true, capT: sim.t }; a.expectRwy = '23R';
    sim.goAround(a, 'forced');
  },
  judge(sim, st) {
    const p = st.p, m = st.m;
    const hit = losOrStca(sim, p.csA, p.csD);
    if (hit) return { pass: false, timeS: sim.t - st.t0, score: 0, why: hit.kind === 'los' ? 'The go-around and the departure lost separation.' : 'The conflict alert went off. Turn the departure away or stop its climb before the go-around reaches it.', facts: [] };
    const a = sim.find(p.csA), d = sim.find(p.csD);
    if (!a || !d) return { pass: true, timeS: m.firstT ?? sim.t - st.t0, score: 70, why: 'They parted safely.', facts: [] };
    const first = sends(sim, p.csA, st.t0).concat(sends(sim, p.csD, st.t0)).sort((x, y) => x.t - y.t)[0];
    if (first && m.firstT === undefined) m.firstT = first.t - st.t0;
    m.minD = Math.min(m.minD ?? 99, dist(a.p, d.p));
    if (sim.t - st.t0 < 300) return undefined;
    const timeS = m.firstT ?? sim.t - st.t0;
    const score = Math.round(clamp(100 - Math.max(0, timeS - 20) * 0.5, 0, 100));
    return { pass: true, timeS, score, why: `Five minutes with no alert. Your first call came ${fmtS(timeS)} after the go-around; closest they came was ${m.minD.toFixed(1)} NM.`, facts: [`closest ${m.minD.toFixed(1)} NM`] };
  },
  solve(sim, st) {
    if (st.m.solved || sim.t < st.t0 + 3 || sim.freqBusy()) return;
    const d = sim.find(st.p.csD);
    if (!d || d.state !== 'assumed') return;
    // the departure turns left, away from the missed approach that curls back north over the field, and keeps climbing
    sim.issue({ cs: d.cs, items: [hdgTo(sim, d, 180), { k: 'lvl', lvl: sim.depXfl }] });
    st.m.solved = true;
  },
};

export const DRILLS_EDDL: DrillDef[] = [DUS_INTERCEPT, DUS_WAKE, DUS_CONFLICT, DUS_DESCENT, DUS_RELEASE, DUS_PARALLEL, DUS_MERGE, DUS_GOAROUND];

export const DRILLS: DrillDef[] = [INTERCEPT, WAKE, CONFLICT, DESCENT, RELEASE, ...DRILLS_EDDL];
export const drillById = (id: string) => DRILLS.find((d) => d.id === id);
/** The drills written for an airport. */
export const drillsFor = (icao: string) => DRILLS.filter((d) => (d.icao ?? 'EBLG') === icao);
const DRILL_BASE: Record<DrillId, number> = { intercept: 7100, wake: 7200, conflict: 7300, descent: 7400, release: 7500 };

/** The scenario for one variation of a drill. Same id and variant, same session. */
export function drillScenario(pack: Pack, id: DrillId | DusDrillId, variant: number): Scenario {
  const def = drillById(id)!;
  const seed = (def.base ?? DRILL_BASE[id as DrillId]) * 1000 + variant;
  const p = def.params(seed);
  const base = def.scenario(pack, seed, p);
  return { ...base, id: `drill-${id}-${variant}`, title: `Drill · ${def.title}`, desc: `${def.summary} ${def.goal}`, briefing: def.goal, seed, durationMin: Math.ceil(def.limitS / 60) + 1, icao: def.icao ?? pack.meta.icao };
}
export function parseDrillScenario(scId: string): { id: DrillId; variant: number } | undefined {
  const m = /^drill-([a-z-]+)-(\d+)$/.exec(scId);
  return m && drillById(m[1]) ? { id: m[1] as DrillId, variant: Number(m[2]) } : undefined;
}

/** Attach a drill to a live Sim: place the aircraft, judge every second, and end the session on a verdict. */
export function attachDrill(sim: Sim, def: DrillDef, opts: { noEnd?: boolean } = {}): DrillState {
  const s = sim as any;
  if (s._drill) return s._drill;
  const st: DrillState = { def, p: def.params(sim.sc.seed), t0: 0, ready: false, m: {} };
  s._drill = st;
  afterEachStep(sim, 'drill', () => {
    if (!st.ready) {
      const need = def.cs ? def.cs(st.p) : def.id.endsWith('wake') ? [st.p.csL, st.p.csF] : def.id.endsWith('conflict') ? [st.p.csA, st.p.csB] : def.id.endsWith('release') ? [st.p.cs1, st.p.cs2] : [st.p.cs];
      if (!need.every((cs) => sim.find(cs))) return;
      def.setup(sim, st);
      st.ready = true;
      st.t0 = sim.t;
      return;
    }
    if (st.verdict || opts.noEnd) return;
    let v = def.judge(sim, st);
    if (!v && sim.t - st.t0 > def.limitS) v = { pass: false, timeS: sim.t - st.t0, score: 0, why: 'Out of time.', facts: [] };
    if (!v && sim.ended) v = { pass: false, timeS: sim.t - st.t0, score: 0, why: 'You ended the drill before it was done.', facts: [] };
    if (v) { st.verdict = v; sim.finish('complete'); }
  });
  return st;
}
/** The verdict of a finished drill (judged once more if the player ended it by hand). */
export function drillVerdict(sim: Sim): DrillVerdict | undefined {
  const st = (sim as any)._drill as DrillState | undefined;
  if (!st) return undefined;
  if (!st.verdict) st.verdict = (st.ready ? st.def.judge(sim, st) : undefined) ?? { pass: false, timeS: Math.max(0, sim.t - st.t0), score: 0, why: 'You ended the drill before it was done.', facts: [] };
  return st.verdict;
}
/** The drill's scripted solution, as a controller for the expert ghost and the tests. */
export const drillSolver = (def: DrillDef) => (sim: Sim) => { const st = (sim as any)._drill as DrillState | undefined; if (st?.ready) def.solve(sim, st); };
