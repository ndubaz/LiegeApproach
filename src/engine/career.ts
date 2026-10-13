// Career: the rank ladder from student to supervisor, checkrides with a hidden examiner script,
// the scripted "expert" used for ghost replays, per-aircraft track sampling (ghost replay and poster),
// and the supervisor's end-of-shift report.
//
// Everything here is pure engine code: no DOM, no storage. store.ts feeds it the saved logbook,
// and main.ts attaches the examiner and the samplers to a live Sim through GameOpts.onSim.

import type { Sim } from './sim';
import { Sim as SimClass } from './sim';
import type { Pack } from '../pack/load';
import type { Clearance, Item } from './clearance';
import type { Comp, Scenario, SpawnSpec } from './types';
import { assess, COMP_PLAIN, GRADE_NAMES, type Grade, type Result } from './assess';
import { CHALLENGES } from './scenarios';
import { durationFor, hotStart } from './traffic';
import { autoControl } from './autopilot';
import { releaseAdvice, suggest } from './suggest';
import { angDiff, dist } from '../geo';

// ===========================================================================
// Ranks and requirements

export const RANKS = ['Student', 'OJT', 'Validated', 'Senior', 'Supervisor'] as const;
export type RankName = (typeof RANKS)[number];
/** What each rank means, in a few plain words. */
export const RANK_LONG: Record<RankName, string> = {
  Student: 'Student controller: learning the position with an instructor',
  OJT: 'On-the-job trainee: working real traffic with an instructor plugged in',
  Validated: 'Validated controller: rated for the position, working alone',
  Senior: 'Senior controller: trusted with the night bank and anything abnormal',
  Supervisor: 'Supervisor: runs the room and signs off other controllers',
};

const GRADES: Grade[] = ['fail', 'pass', 'good', 'rated'];
const gRank = (g?: Grade) => (g ? GRADES.indexOf(g) : -1);

/** A logged shift: a free-play or daily session of at least 15 minutes on position. */
export interface ShiftLog { date: string; id: string; title: string; grade: Grade; min: number }
export interface CheckrideLog { id: string; date: string; pass: boolean; score?: number; credited?: boolean }
export interface CareerData { v: 1; shifts: ShiftLog[]; checkrides: CheckrideLog[] }
export const emptyCareer = (): CareerData => ({ v: 1, shifts: [], checkrides: [] });
/** Shortest session that counts as a logged shift, in minutes. */
export const SHIFT_MIN_MINUTES = 15;
/** Logged shifts needed after a failed checkride before a retake. */
export const RETAKE_SHIFTS = 2;

/** Is this session a shift for the career log (free play or a daily shift)? */
export const isShiftScenario = (id: string) => id === 'free' || id.startsWith('free') || id.startsWith('daily-');
export const isCheckrideScenario = (id: string) => id.startsWith('checkride-');
export const isDrillScenario = (id: string) => id.startsWith('drill-');

export interface CareerInput {
  log: { sessions: number; seconds: number; moves: number };
  best: Record<string, Grade>;
  career: CareerData;
  /** Tutorial exams passed. */
  lessonsPassed: number;
}
export interface Requirement { key: string; text: string; ok: boolean; progress?: string }
export interface Promotion {
  from: RankName; to: RankName;
  reqs: Requirement[];
  checkride: CheckrideDef;
  /** Every requirement met and no retake lock: the checkride can be taken now. */
  ready: boolean;
  /** Logged shifts still needed before a retake (after a failed attempt). */
  retakeIn: number;
  attempts: number;
  lastFail?: CheckrideLog;
}
export interface CareerStatus { index: number; name: RankName; next?: RankName; promotion?: Promotion; promotedOn: (string | undefined)[] }

interface StepSpec { shifts: { n: number; min: Grade; rated?: number }; challenges: string[]; hours?: number; moves?: number; lessons?: number }
const STEPS: StepSpec[] = [
  { lessons: 3, shifts: { n: 2, min: 'pass' }, challenges: ['first-freighter'] },
  { shifts: { n: 5, min: 'pass' }, challenges: ['trombone', 'first-release', 'cross-streams'], hours: 2 },
  { shifts: { n: 8, min: 'good' }, challenges: ['night-bank', 'runway-change', 'hot-tsa'], moves: 400 },
  { shifts: { n: 12, min: 'good', rated: 3 }, challenges: ['go-around', 'radio-failure', 'compound-night'], hours: 20 },
];

const chTitle = (id: string) => CHALLENGES.find((c) => c.id === id)?.title ?? id;

export function careerStatus(inp: CareerInput): CareerStatus {
  const passedRide = (id: string) => inp.career.checkrides.find((c) => c.id === id && c.pass);
  let index = 0;
  const promotedOn: (string | undefined)[] = [undefined];
  while (index < CHECKRIDES.length && passedRide(CHECKRIDES[index].id)) { promotedOn.push(passedRide(CHECKRIDES[index].id)!.date); index++; }
  const name = RANKS[index];
  if (index >= STEPS.length) return { index, name, promotedOn };
  const st = STEPS[index];
  const reqs: Requirement[] = [];
  if (st.lessons) {
    const n = Math.min(st.lessons, inp.lessonsPassed);
    reqs.push({ key: 'lessons', text: `Pass ${st.lessons} lesson exams`, ok: inp.lessonsPassed >= st.lessons, progress: `${n}/${st.lessons}` });
  }
  {
    const ok = inp.career.shifts.filter((s) => gRank(s.grade) >= gRank(st.shifts.min));
    const n = Math.min(ok.length, st.shifts.n);
    reqs.push({ key: 'shifts', text: `${st.shifts.n} logged shifts graded ${GRADE_NAMES[st.shifts.min]} or better`, ok: ok.length >= st.shifts.n, progress: `${n}/${st.shifts.n}` });
    if (st.shifts.rated) {
      const r = inp.career.shifts.filter((s) => s.grade === 'rated').length;
      reqs.push({ key: 'rated', text: `${st.shifts.rated} of them Rated`, ok: r >= st.shifts.rated, progress: `${Math.min(r, st.shifts.rated)}/${st.shifts.rated}` });
    }
  }
  for (const id of st.challenges) {
    const g = inp.best[id];
    reqs.push({ key: `ch:${id}`, text: `Pass the challenge "${chTitle(id)}"`, ok: gRank(g) >= 1, progress: g ? GRADE_NAMES[g] : 'not tried' });
  }
  if (st.hours) { const h = inp.log.seconds / 3600; reqs.push({ key: 'hours', text: `${st.hours} hours on position`, ok: h >= st.hours, progress: `${h.toFixed(1)}/${st.hours}` }); }
  if (st.moves) reqs.push({ key: 'moves', text: `${st.moves} movements`, ok: inp.log.moves >= st.moves, progress: `${Math.min(inp.log.moves, st.moves)}/${st.moves}` });
  const ride = CHECKRIDES[index];
  const tries = inp.career.checkrides.filter((c) => c.id === ride.id);
  const lastFail = [...tries].reverse().find((c) => !c.pass);
  const since = lastFail ? inp.career.shifts.filter((s) => s.date > lastFail.date).length : RETAKE_SHIFTS;
  const retakeIn = Math.max(0, RETAKE_SHIFTS - since);
  const ready = reqs.every((r) => r.ok) && retakeIn === 0;
  return { index, name, next: RANKS[index + 1], promotedOn, promotion: { from: name, to: RANKS[index + 1], reqs, checkride: ride, ready, retakeIn, attempts: tries.length, lastFail } };
}

// ===========================================================================
// Checkrides: a scenario with a hidden examiner script

export type ExamKind = 'birds' | 'goaround' | 'radio' | 'milxing' | 'qnh';
export interface ExamEvent {
  /** Seconds from the start: when the examiner springs it (for spawned events, roughly). */
  t: number;
  kind: ExamKind;
  cs?: string;
  /** Runway closure length (birds). */
  min?: number;
  /** QNH change in hPa. */
  dq?: number;
}
export interface CheckrideDef {
  id: string;
  /** Rank index this checkride promotes to. */
  to: number;
  title: string;
  /** What the examiner says before you start (nothing about the script). */
  brief: string;
  /** Minimum session grade. */
  minGrade: Grade;
  script: ExamEvent[];
  scenario: Scenario;
}

const GOOD22 = 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG';
const NIGHT22 = 'EBLG 120140Z 23010KT 9999 SCT030 10/06 Q1015 NOSIG';
const GUSTY22 = 'EBLG 120140Z 24016G26KT 9999 SCT025 BKN040 09/04 Q1009 NOSIG';
const A = (t: number, cs: string, type: string, star: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t, kind: 'arr', cs, type, star, spawnDist: 40, ...x });
const D = (t: number, cs: string, type: string, sid: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t, kind: 'dep', cs, type, sid, ...x });
const FIGHTERS = (t: number, cs: string): SpawnSpec => ({ t, kind: 'mil', cs, type: 'F35', formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: { fl: 70 }, spd: 300 });

function ride(id: string, to: number, title: string, brief: string, minGrade: Grade, seed: number, startUtc: string, metar: string, spawns: SpawnSpec[], script: ExamEvent[], readbackErr = 0.02): CheckrideDef {
  const sp = spawns.map((s) => ({ ...s }));
  hotStart(sp);
  const scenario: Scenario = {
    id: `checkride-${id}`, title, desc: brief, seed, durationMin: durationFor(sp), startUtc, metar, runway: '22L', readbackErr,
    spawns: sp, events: [], briefing: 'An examiner is plugged in behind you. Work the traffic as you would on any night. Expect the unexpected.',
  };
  return { id, to, title, brief, minGrade, script, scenario };
}

export const CHECKRIDES: CheckrideDef[] = [
  ride('ojt', 1, 'Checkride: Student to OJT', 'Four freighters and two departures on a quiet night. Your instructor watches how you handle the basics and one or two surprises.', 'pass', 501, '02:10', GOOD22, [
    A(5, 'QTR8125', 'B77L', 'KOK7X', { spawnDist: 32 }), A(200, 'TAY4EK', 'B763', 'CIV7X', { goAroundAt: 1.2 }), A(470, 'CHG201', 'B748', 'LNO6X', { spawnDist: 30 }), A(760, 'ETH3721', 'B77L', 'NIK7X'),
    D(330, 'FDX5240', 'MD11', 'LNO9S'), D(900, 'CHG7302', 'B748', 'BUB9S'),
  ], [{ t: 500, kind: 'goaround', cs: 'TAY4EK' }, { t: 420, kind: 'qnh', dq: -3 }]),
  ride('validated', 2, 'Checkride: OJT to Validated', 'A busy hour on runway 22L: six arrivals, three departures and the military next door. The examiner wants to see you run it alone.', 'pass', 502, '01:40', NIGHT22, [
    A(5, 'CHG201', 'B748', 'KOK7X', { spawnDist: 34 }), A(170, 'QTR8125', 'B77L', 'CIV7X'), A(360, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }), A(560, 'ETH3721', 'B77L', 'GESLO6X'),
    A(760, 'BCS5AB', 'A306', 'NIK7X'), A(960, 'FDX5203', 'MD11', 'KOK7X'),
    D(250, 'FDX5240', 'MD11', 'LNO9S'), D(700, 'TAY71K', 'B744', 'BUB9S'), D(1150, 'QTR8217', 'B77L', 'CIV5S'),
    FIGHTERS(300, 'BAF61'),
  ], [{ t: 300, kind: 'milxing', cs: 'BAF61' }, { t: 640, kind: 'birds', min: 4 }]),
  ride('senior', 3, 'Checkride: Validated to Senior', 'Half a night bank with a mixed fleet. The examiner will throw the abnormal at you while the sequence is full.', 'pass', 503, '01:25', NIGHT22, [
    A(5, 'QTR8125', 'B77L', 'KOK7X'), A(150, 'CHG201', 'B748', 'LNO6X', { spawnDist: 30 }), A(300, 'THY6411', 'A332', 'CIV7X', { emergency: { after: 140, type: 'radio' } }),
    A(450, 'ETH3721', 'B77L', 'GESLO6X'), A(600, 'BCS5AB', 'A306', 'NIK7X', { goAroundAt: 1.4 }), A(760, 'AZG7321', 'B748', 'KOK7X'), A(920, 'FDX5203', 'MD11', 'CIV7X'), A(1080, 'CKS231', 'B744', 'LNO6X', { spawnDist: 30 }),
    D(380, 'FDX5240', 'MD11', 'LNO9S'), D(820, 'CHG7302', 'B748', 'BUB9S'), D(1250, 'ETH3730', 'B77L', 'CIV5S'),
  ], [{ t: 440, kind: 'radio', cs: 'THY6411' }, { t: 900, kind: 'qnh', dq: 2 }, { t: 1000, kind: 'goaround', cs: 'BCS5AB' }], 0.04),
  ride('supervisor', 4, 'Checkride: Senior to Supervisor', 'A gusty night bank with everything at once. The examiner is looking for a controller who stays ahead of the room.', 'good', 504, '01:15', GUSTY22, [
    A(5, 'CHG201', 'B748', 'KOK7X'), A(140, 'QTR8125', 'B77L', 'CIV7X'), A(280, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }), A(420, 'ETH3721', 'B77L', 'NIK7X', { emergency: { after: 200, type: 'radio' } }),
    A(560, 'BCS5AB', 'A306', 'GESLO6X'), A(700, 'AZG7321', 'B748', 'KOK7X', { goAroundAt: 1.3 }), A(840, 'FDX5203', 'MD11', 'CIV7X'), A(980, 'THY6411', 'A332', 'NIK7X'),
    A(1120, 'CKS231', 'B744', 'LNO6X', { spawnDist: 30 }), A(1260, 'CLX7HK', 'B748', 'KOK7X'),
    D(300, 'FDX5240', 'MD11', 'LNO9S'), D(760, 'TAY71K', 'B744', 'BUB9S'), D(1200, 'QTR8217', 'B77L', 'CIV5S'), D(1500, 'CHG7302', 'B748', 'LNO9S'),
    FIGHTERS(520, 'BAF73'),
  ], [{ t: 520, kind: 'milxing', cs: 'BAF73' }, { t: 650, kind: 'radio', cs: 'ETH3721' }, { t: 840, kind: 'birds', min: 4 }, { t: 1100, kind: 'goaround', cs: 'AZG7321' }, { t: 1300, kind: 'qnh', dq: -2 }], 0.05),
];
export const checkrideById = (id: string) => CHECKRIDES.find((c) => c.id === id || c.scenario.id === id);

/** What the examiner saw happen, collected while the session runs. */
export interface ExamState {
  def: CheckrideDef;
  closures: { t0: number; t1: number; rwy: string }[];
  qnh: { t: number; qnh: number; cs: string[] }[];
}

/**
 * Close the runway in use for `min` minutes. Uses the engine hook `sim.closeRunway(min, reason)` when it exists;
 * otherwise falls back to holding the runway "occupied" (arrivals go around at the threshold, departures wait).
 */
export function closeRunway(sim: Sim, min: number, reason: string) {
  const s = sim as any;
  if (typeof s.closeRunway === 'function') { s.closeRunway(min, reason); return; }
  s.runwayBusyUntil = Math.max(s.runwayBusyUntil ?? 0, sim.t + min * 60);
  sim.icom('TWR', `Approach, Tower, ${reason} on runway ${sim.runway}, runway closed for about ${min} minutes`);
}

/** Change the QNH now: new ATIS letter, supervisor on the intercom; every aircraft that has had the old QNH needs the new one. */
export function changeQnh(sim: Sim, dq: number) {
  const s = sim as any;
  if (typeof s.changeQnh === 'function') { s.changeQnh(dq); return; }
  sim.setWeather({ ...sim.weather, qnh: sim.weather.qnh + dq }, true);
  sim.icom('SUP', `New ATIS: information ${sim.atis} now current, QNH ${sim.qnh}`);
}

/** Wrap a Sim's step so `fn` runs after every step (idempotent per key). */
export function afterEachStep(sim: Sim, key: string, fn: () => void) {
  const s = sim as any;
  s._afterStep ??= {};
  if (s._afterStep[key]) return;
  s._afterStep[key] = fn;
  const orig = sim.step.bind(sim);
  sim.step = (dt?: number) => { orig(dt); fn(); };
}

/** Attach the examiner's hidden script to a running checkride. Deterministic: actions fire on sim time. */
export function attachExaminer(sim: Sim, def: CheckrideDef): ExamState {
  const s = sim as any;
  if (s._exam) return s._exam;
  const st: ExamState = { def, closures: [], qnh: [] };
  s._exam = st;
  const todo = def.script.filter((e) => e.kind === 'birds' || e.kind === 'qnh').map((e) => ({ ...e, done: false }));
  afterEachStep(sim, 'exam', () => {
    for (const e of todo) {
      if (e.done || sim.t < e.t) continue;
      e.done = true;
      if (e.kind === 'birds') {
        const m = e.min ?? 4;
        closeRunway(sim, m, 'birds');
        st.closures.push({ t0: sim.t, t1: sim.t + m * 60, rwy: sim.runway });
      } else {
        // aircraft that already have the old QNH and still need it (not yet established on the localizer)
        const need = sim.aircraft.filter((a) => !a.remove && a.state === 'assumed' && a.kind === 'arr' && !a.app?.locCap && !a.radioFail);
        changeQnh(sim, e.dq ?? -2);
        for (const a of sim.aircraft) a.qnhGiven = false;
        st.qnh.push({ t: sim.t, qnh: sim.qnh, cs: need.map((a) => a.cs) });
      }
    }
    for (const c of st.closures) if (sim.t === c.t1) sim.icom('TWR', `Approach, Tower, runway ${c.rwy} open again`);
  });
  return st;
}

export interface VerdictItem { kind: ExamKind | 'gate' | 'grade'; text: string; ok: boolean; note: string; t?: number }
export interface CheckrideVerdict { id: string; pass: boolean; score: number; items: VerdictItem[]; report: string[] }

/** Minimal view of a finished session the examiner needs (a live Sim satisfies it; tests can build one). */
export interface ExamRun {
  t: number;
  events: { t: number; kind: string; cs?: string; cs2?: string; text: string }[];
  landings: { cs: string; t: number }[];
  cmdLog: { t: number; cl: Clearance }[];
  spawnLog: { cs: string; t: number }[];
  utc(t?: number): string;
}

const hhmm = (run: ExamRun, t: number) => run.utc(t).slice(0, 5);
const involves = (e: { cs?: string; cs2?: string }, cs: string) => e.cs === cs || e.cs2 === cs;

/** The examiner's verdict: the session result plus checkride-specific criteria, with a short plain-English report. */
export function examinerVerdict(run: ExamRun, def: CheckrideDef, r: Pick<Result, 'gate' | 'grade' | 'landed' | 'arrivals'>, st?: Pick<ExamState, 'closures' | 'qnh'>): CheckrideVerdict {
  const items: VerdictItem[] = [];
  items.push({ kind: 'gate', text: 'Everyone kept apart and above the safe altitude', ok: r.gate.pass, note: r.gate.pass ? 'Nobody got too close.' : 'You lost separation or let someone below the safe altitude. That ends a checkride on its own.' });
  const gOk = gRank(r.grade) >= gRank(def.minGrade);
  items.push({ kind: 'grade', text: `Session graded ${GRADE_NAMES[def.minGrade]} or better`, ok: gOk, note: gOk ? `The session graded ${GRADE_NAMES[r.grade]}.` : `The session graded ${GRADE_NAMES[r.grade].toLowerCase()}; this checkride needs ${GRADE_NAMES[def.minGrade]}.` });
  const los = run.events.filter((e) => e.kind === 'los');
  const landedAt = (cs: string) => run.landings.find((l) => l.cs === cs)?.t;
  for (const ex of def.script) {
    switch (ex.kind) {
      case 'birds': {
        const closures = st?.closures.length ? st.closures : [{ t0: ex.t, t1: ex.t + (ex.min ?? 4) * 60, rwy: '22L' }];
        for (const c of closures) {
          const ga = run.events.filter((e) => e.kind === 'goaround' && /occupied/.test(e.text) && e.t >= c.t0 && e.t <= c.t1 + 30);
          const ok = ga.length === 0;
          items.push({ kind: 'birds', t: c.t0, text: 'Nobody reached the runway while Tower had it closed for birds', ok,
            note: ok ? `Tower closed ${c.rwy} at ${hhmm(run, c.t0)}. You kept everyone off it until it reopened.` : `${ga.map((g) => g.cs).join(' and ')} reached the threshold while ${c.rwy} was shut and had to go around. Hold or extend arrivals as soon as Tower closes the runway.` });
        }
        break;
      }
      case 'goaround': {
        const ev = run.events.find((e) => e.kind === 'goaround' && e.cs === ex.cs);
        if (!ev) { items.push({ kind: 'goaround', text: `Pick up ${ex.cs} after an unannounced go-around`, ok: true, note: `${ex.cs} never reached the point where Tower would send it around.` }); break; }
        const lt = landedAt(ex.cs!);
        const bad = los.filter((e) => involves(e, ex.cs!) && e.t >= ev.t);
        const ok = lt !== undefined && !bad.length;
        items.push({ kind: 'goaround', t: ev.t, text: `Pick up ${ex.cs} after an unannounced go-around`, ok,
          note: ok ? `${ex.cs} went around at ${hhmm(run, ev.t)} and was back on the ground ${Math.round((lt! - ev.t) / 60)} minutes later.` : bad.length ? `${ex.cs} lost separation with ${bad[0].cs === ex.cs ? bad[0].cs2 : bad[0].cs} after the go-around. Climb it and turn it away from the departures first.` : `${ex.cs} went around at ${hhmm(run, ev.t)} and never landed. Bring it back into the sequence.` });
        break;
      }
      case 'radio': {
        const ev = run.events.find((e) => e.kind === 'emer' && e.cs === ex.cs);
        if (!ev) { items.push({ kind: 'radio', text: `Protect ${ex.cs} after its radio failure`, ok: true, note: `${ex.cs} landed before its radio failed.` }); break; }
        const lt = landedAt(ex.cs!);
        const bad = los.filter((e) => involves(e, ex.cs!));
        const ok = lt !== undefined && !bad.length;
        items.push({ kind: 'radio', t: ev.t, text: `Protect ${ex.cs} after its radio failure`, ok,
          note: ok ? `${ex.cs} lost its radio at ${hhmm(run, ev.t)}. You kept the others out of its way and it landed.` : bad.length ? `Someone got too close to ${ex.cs} after its radio failed. Predict where it will fly and move everyone else.` : `${ex.cs} never landed after its radio failed.` });
        break;
      }
      case 'milxing': {
        const sp = run.spawnLog.find((s) => s.cs === ex.cs);
        const ans = run.cmdLog.find((c) => c.cl.cs === ex.cs && c.cl.items.some((i) => i.k === 'appr' || i.k === 'deny'));
        const wait = sp && ans ? ans.t - sp.t : undefined;
        const bad = los.filter((e) => involves(e, ex.cs!));
        const ok = wait !== undefined && wait <= 60 && !bad.length;
        items.push({ kind: 'milxing', t: sp?.t, text: 'Answer the military crossing request within a minute', ok,
          note: ok ? `You answered the military about ${ex.cs} in ${Math.round(wait!)} seconds.` : wait === undefined ? `The military asked to cross with ${ex.cs} and never got an answer.` : bad.length ? `${ex.cs} lost separation with your traffic.` : `The military waited ${Math.round(wait)} seconds for an answer about ${ex.cs}. Approve or refuse it quickly, even if the answer is "unable".` });
        break;
      }
      case 'qnh': {
        const q = st?.qnh.find((x) => Math.abs(x.t - ex.t) < 5) ?? st?.qnh[0];
        if (!q) break;
        const after = (cs: string) => run.cmdLog.filter((c) => c.t >= q.t && c.cl.cs === cs);
        // the new QNH goes with an "information X now current" call or with the next altitude clearance; an aircraft
        // handed to Tower within 90 seconds of the change (Tower passes it) does not count
        const missed = q.cs.filter((cs) => !after(cs).some((c) => c.cl.items.some((i: Item) => i.k === 'atis' || (i.k === 'lvl' && i.lvl.ft !== undefined)))
          && !after(cs).some((c) => c.t - q.t <= 90 && c.cl.items.some((i: Item) => i.k === 'xfr' && i.unit === 'TWR')));
        const ok = missed.length === 0;
        items.push({ kind: 'qnh', t: q.t, text: 'Pass the new QNH to everyone who had the old one', ok,
          note: ok ? (q.cs.length ? `The QNH changed to ${q.qnh} at ${hhmm(run, q.t)} and every arrival got it.` : `The QNH changed to ${q.qnh} at ${hhmm(run, q.t)}; nobody on frequency needed it.`) : `The QNH changed to ${q.qnh} at ${hhmm(run, q.t)}. ${missed.join(', ')} never got it. Give it with the next altitude, or tell them the new ATIS letter.` });
        break;
      }
    }
  }
  const pass = items.every((i) => i.ok);
  const score = Math.round((items.filter((i) => i.ok).length / items.length) * 100);
  const report: string[] = [];
  report.push(pass ? `Checkride passed. You are cleared to work as ${RANKS[def.to]}.` : 'Not this time.');
  const misses = items.filter((i) => !i.ok);
  const hits = items.filter((i) => i.ok && i.kind !== 'gate' && i.kind !== 'grade');
  for (const m of misses.slice(0, 3)) report.push(m.note);
  if (hits.length) report.push(hits.slice(0, pass ? 3 : 1).map((h) => h.note).join(' '));
  if (!pass) report.push(`Log ${RETAKE_SHIFTS} more shifts, then book the retake.`);
  return { id: def.id, pass, score, items, report };
}

// ===========================================================================
// Track sampling: per-aircraft position history for the ghost replay and the poster.

export interface TrackPt { t: number; x: number; y: number; alt: number }
export interface TrackLine { cs: string; kind: string; pts: TrackPt[]; landedT?: number; rwy?: string; emer?: boolean }
export interface Spark { t: number; x: number; y: number; kind: string; cs?: string; cs2?: string }
export interface TrackLog { every: number; t1: number; lines: TrackLine[]; sparks: Spark[] }

/** Sample every aircraft's position every `every` sim seconds (idempotent). Conflicts and landings are recorded as they happen. */
export function sampleTracks(sim: Sim, every = 4): TrackLog {
  const s = sim as any;
  if (s._tracks) return s._tracks;
  const log: TrackLog = { every, t1: sim.t, lines: [], sparks: [] };
  s._tracks = log;
  const by = new Map<string, TrackLine>();
  const line = (cs: string, kind: string) => { let l = by.get(cs); if (!l) { l = { cs, kind, pts: [] }; by.set(cs, l); log.lines.push(l); } return l; };
  const sample = () => {
    for (const a of sim.aircraft) {
      if (a.remove) continue;
      const l = line(a.cs, a.kind);
      if (a.emergency) l.emer = true;
      l.pts.push({ t: sim.t, x: +a.p.x.toFixed(3), y: +a.p.y.toFixed(3), alt: Math.round(a.alt) });
    }
    log.t1 = sim.t;
  };
  sim.onEvent.push((e) => {
    if (e.kind === 'landed' && e.cs) {
      const a = sim.aircraft.find((x) => x.cs === e.cs);
      const l = line(e.cs, a?.kind ?? 'arr');
      const r = a?.app?.rwy ?? sim.rwy;
      l.pts.push({ t: sim.t, x: +r.thr.x.toFixed(3), y: +r.thr.y.toFixed(3), alt: r.elevation });
      l.landedT = sim.t; l.rwy = r.id;
    }
    if ((e.kind === 'stca' || e.kind === 'los' || e.kind === 'wake') && e.cs) {
      const a = sim.aircraft.find((x) => x.cs === e.cs), b = e.cs2 ? sim.aircraft.find((x) => x.cs === e.cs2) : undefined;
      if (a) {
        const p = b ? { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 } : a.p;
        log.sparks.push({ t: sim.t, x: +p.x.toFixed(3), y: +p.y.toFixed(3), kind: e.kind, cs: e.cs, cs2: e.cs2 });
      }
    }
  });
  sample();
  let last = sim.t;
  afterEachStep(sim, 'tracks', () => { if (sim.t - last >= every || sim.ended) { last = sim.t; sample(); } });
  return log;
}

/** Position of one aircraft at time t (linear between samples), or undefined if it was not on the scope. */
export function posAt(l: TrackLine, t: number): TrackPt | undefined {
  const p = l.pts;
  if (!p.length || t < p[0].t || t > p[p.length - 1].t) return undefined;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].t <= t) lo = m; else hi = m; }
  const a = p[lo], b = p[hi];
  if (b.t === a.t) return a;
  const k = (t - a.t) / (b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, alt: a.alt + (b.alt - a.alt) * k };
}

// ===========================================================================
// The expert: scripted controllers run over the same seed; the best one is the ghost.

/** A controller that only ever taps the primary suggestion chip and answers Tower with the engine's release advice. */
export function chipControl(sim: Sim) {
  const S = ((sim as any)._chipX ??= { last: -99, per: new Map<string, { t: number; label: string }>(), lastRel: -999 });
  const pending = sim.releases.filter((r) => r.state === 'pending');
  if (pending.length && sim.t - S.lastRel >= 120) {
    const adv = releaseAdvice(sim, pending[0].cs);
    if (adv.ok) { sim.issue({ cs: pending[0].cs, items: adv.items }); S.lastRel = sim.t; }
  }
  for (const a of sim.aircraft) if (a.request?.kind === 'milxing' && a.state === 'inbound') sim.issue({ cs: a.cs, items: [{ k: 'appr' }] });
  if (sim.freqBusy() || sim.t - S.last < 4) return;
  const order = [...sim.callers(), ...sim.aircraft.filter((a) => a.awaitingSince === undefined)];
  for (const a of order) {
    if (a.remove || sim.readbackPending(a.cs)) continue;
    const prev = S.per.get(a.cs);
    if (prev && sim.t - prev.t < 20) continue;
    const s = suggest(sim, a).find((x) => x.primary);
    if (!s) continue;
    if (prev && prev.label === s.label && sim.t - prev.t < 60 && a.awaitingSince === undefined) continue;
    sim.issue({ cs: a.cs, items: s.items });
    S.per.set(a.cs, { t: sim.t, label: s.label });
    S.last = sim.t;
    return;
  }
}

export type Controller = (sim: Sim) => void;
export const EXPERTS: Record<string, Controller> = { auto: autoControl, chips: chipControl };

export interface ExpertRun { name: string; result: Result; tracks: TrackLog; cmds: { t: number; cl: Clearance }[]; sim: Sim }

const expertScore = (r: Result) => (r.gate.pass ? 1000 : 0) + gRank(r.grade) * 100 + (r.pass?.ok ? 50 : 0) + r.landed * 5;

/**
 * Run one scripted controller over a scenario from scratch (same seed as the player), with the same hooks the
 * live game attaches (examiner, drill setup). Returns its command log, tracks and grade.
 */
export function runExpert(pack: Pack, sc: Scenario, ctrl: Controller, name: string, attach?: (sim: Sim) => void, every = 4): ExpertRun {
  const sim = new SimClass(pack, sc);
  attach?.(sim);
  const tracks = sampleTracks(sim, every);
  const cap = sc.durationMin * 60 + 5;
  while (!sim.ended && sim.t < cap) { ctrl(sim); sim.step(); }
  sim.finish();
  const result = assess(sim);
  return { name, result, tracks, cmds: sim.cmdLog.slice(), sim };
}

/** As runExpert, but yields to the browser every `chunk` sim seconds so the page stays responsive. */
export async function runExpertAsync(pack: Pack, sc: Scenario, ctrl: Controller, name: string, attach?: (sim: Sim) => void, chunk = 240): Promise<ExpertRun> {
  const sim = new SimClass(pack, sc);
  attach?.(sim);
  const tracks = sampleTracks(sim, 4);
  const cap = sc.durationMin * 60 + 5;
  while (!sim.ended && sim.t < cap) {
    for (let i = 0; i < chunk && !sim.ended && sim.t < cap; i++) { ctrl(sim); sim.step(); }
    await new Promise((r) => setTimeout(r, 0));
  }
  sim.finish();
  return { name, result: assess(sim), tracks, cmds: sim.cmdLog.slice(), sim };
}
export async function bestExpertAsync(pack: Pack, sc: Scenario, attach?: (sim: Sim) => void, ctrls: Record<string, Controller> = EXPERTS): Promise<ExpertRun> {
  let best: ExpertRun | undefined;
  for (const [name, c] of Object.entries(ctrls)) {
    const r = await runExpertAsync(pack, sc, c, name, attach);
    if (!best || expertScore(r.result) > expertScore(best.result)) best = r;
  }
  return best!;
}

/** The strongest of the scripted controllers on this scenario. */
export function bestExpert(pack: Pack, sc: Scenario, attach?: (sim: Sim) => void, ctrls: Record<string, Controller> = EXPERTS): ExpertRun {
  let best: ExpertRun | undefined;
  for (const [name, c] of Object.entries(ctrls)) {
    const r = runExpert(pack, sc, c, name, attach);
    if (!best || expertScore(r.result) > expertScore(best.result)) best = r;
  }
  return best!;
}

// ---------------------------------------------------------------------------
// Where the player and the expert part ways

export type MomentKind = 'approach' | 'base' | 'intercept' | 'descent' | 'speed' | 'handoff' | 'release' | 'hold';
export interface Moment { cs: string; kind: MomentKind; t: number }
const MOMENT_WORDS: Record<MomentKind, string> = {
  approach: 'cleared {cs} for the approach', base: 'turned {cs} onto base', intercept: 'turned {cs} to intercept the final',
  descent: 'started {cs} down', speed: 'slowed {cs} down', handoff: 'sent {cs} to Tower', release: 'released {cs}', hold: 'put {cs} in the hold',
};

/** Key decisions in a command log: the first approach clearance, base turn, descent, speed, handoff and release per aircraft. */
export function keyMoments(cmds: { t: number; cl: Clearance }[], finalCrsTrue = 225, magVar = 2): Moment[] {
  const seen = new Set<string>();
  const out: Moment[] = [];
  const add = (cs: string, kind: MomentKind, t: number) => { const k = cs + '|' + kind; if (!seen.has(k)) { seen.add(k); out.push({ cs, kind, t }); } };
  const crsMag = finalCrsTrue - magVar;
  for (const c of cmds) {
    for (const it of c.cl.items) {
      if (it.k === 'app' || it.k === 'trans') add(c.cl.cs, 'approach', c.t);
      else if (it.k === 'hdg') {
        const off = Math.abs(angDiff(crsMag, it.hdg));
        if (off <= 45) add(c.cl.cs, 'intercept', c.t);
        else if (off >= 60 && off <= 120) add(c.cl.cs, 'base', c.t);
      } else if (it.k === 'lvl') add(c.cl.cs, 'descent', c.t);
      else if (it.k === 'spd' || it.k === 'spdmin') add(c.cl.cs, 'speed', c.t);
      else if (it.k === 'xfr' && it.unit === 'TWR') add(c.cl.cs, 'handoff', c.t);
      else if (it.k === 'rel') add(c.cl.cs, 'release', c.t);
      else if (it.k === 'hold') add(c.cl.cs, 'hold', c.t);
    }
  }
  return out;
}

export interface Divergence { t: number; cs: string; kind: MomentKind | 'path'; text: string; tPlayer?: number; tExpert?: number }
const fmtGap = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

/**
 * The first moment the player's session and the expert's differ in a way that matters: the same decision
 * at least `minGap` seconds apart, a decision only one of them made, or the same aircraft 4 NM apart.
 */
export function firstDivergence(player: { cmds: { t: number; cl: Clearance }[]; tracks: TrackLog }, expert: { cmds: { t: number; cl: Clearance }[]; tracks: TrackLog }, opts: { crs?: number; magVar?: number; minGap?: number } = {}): Divergence | undefined {
  const minGap = opts.minGap ?? 30;
  const P = keyMoments(player.cmds, opts.crs, opts.magVar), E = keyMoments(expert.cmds, opts.crs, opts.magVar);
  const key = (m: Moment) => m.cs + '|' + m.kind;
  const pm = new Map(P.map((m) => [key(m), m])), em = new Map(E.map((m) => [key(m), m]));
  // aircraft that were on the scope in both runs (the player may have ended early)
  const tEnd = Math.min(player.tracks.t1, expert.tracks.t1);
  const cands: Divergence[] = [];
  for (const k of new Set([...pm.keys(), ...em.keys()])) {
    const p = pm.get(k), e = em.get(k);
    const m = (p ?? e)!;
    const words = MOMENT_WORDS[m.kind].replace('{cs}', m.cs);
    if (p && e) {
      const d = p.t - e.t;
      if (Math.abs(d) < minGap) continue;
      cands.push({ t: Math.min(p.t, e.t), cs: m.cs, kind: m.kind, tPlayer: p.t, tExpert: e.t, text: d > 0 ? `The expert ${words} here, ${fmtGap(d)} earlier than you.` : `You ${words} here. The expert waited ${fmtGap(-d)} longer.` });
    } else if (e && e.t < tEnd) cands.push({ t: e.t, cs: m.cs, kind: m.kind, tExpert: e.t, text: `The expert ${words} here. You never did.` });
    else if (p && p.t < tEnd) cands.push({ t: p.t, cs: m.cs, kind: m.kind, tPlayer: p.t, text: `You ${words} here. The expert never needed to.` });
  }
  // paths that split by more than 4 NM
  const eBy = new Map(expert.tracks.lines.map((l) => [l.cs, l]));
  for (const pl of player.tracks.lines) {
    const el = eBy.get(pl.cs);
    if (!el) continue;
    for (const pt of pl.pts) {
      const q = posAt(el, pt.t);
      if (!q) continue;
      if (dist(pt, q) > 4) { cands.push({ t: pt.t, cs: pl.cs, kind: 'path', text: `${pl.cs} is on a different path from here: ${dist(pt, q).toFixed(0)} NM from where the expert had it.` }); break; }
    }
  }
  cands.sort((a, b) => a.t - b.t || (a.kind === 'path' ? 1 : 0) - (b.kind === 'path' ? 1 : 0));
  // a path split right after a decision split is the same story: prefer the decision
  return cands[0];
}

// ===========================================================================
// The supervisor's end-of-shift report

export interface ReportInput {
  rank: number;
  grade: Grade;
  gatePass: boolean;
  landed: number;
  arrivals: number;
  departures: number;
  /** Distinct conflict alerts and losses of separation. */
  alerts: number;
  losses: number;
  /** Median landing spacing above the minimum (NM), if measured. */
  spacing: number | null;
  holdMin: number;
  /** Median seconds to answer a pilot. */
  answerS: number | null;
  emergencies: { cs: string; landed: boolean }[];
  weakest?: Comp;
  strongest?: Comp;
  endedEarly?: boolean;
  checkride?: { pass: boolean };
  /** A drill: the report is about the drill result, not the traffic. */
  drill?: { pass: boolean; score: number; title: string };
}

export function reportInputOf(r: Result, rank: number, x: { departures: number; emergencies: { cs: string; landed: boolean }[]; endedEarly?: boolean; checkride?: { pass: boolean }; drill?: { pass: boolean; score: number; title: string } }): ReportInput {
  const num = (k: string) => r.metrics.find((m) => m.key === k)?.raw ?? null;
  const losses = Number(/Losses of separation: (\d+)/.exec(r.gate.lines[0]?.text ?? '')?.[1] ?? 0);
  const alerts = Number(/(\d+) conflict alerts/.exec(r.evidence.SEPC ?? '')?.[1] ?? 0);
  const rated = (Object.keys(r.ratings) as Comp[]).filter((c) => r.ratings[c] !== null);
  const weakest = [...rated].sort((a, b) => r.ratings[a]! - r.ratings[b]!)[0];
  const strongest = [...rated].sort((a, b) => r.ratings[b]! - r.ratings[a]!)[0];
  return {
    rank, grade: r.grade, gatePass: r.gate.pass, landed: r.landed, arrivals: r.arrivals, departures: x.departures, alerts, losses,
    spacing: num('spacing'), holdMin: num('hold') ?? 0, answerS: num('resp'), emergencies: x.emergencies,
    weakest: weakest && r.ratings[weakest]! <= 3 ? weakest : undefined, strongest: strongest && r.ratings[strongest]! >= 4 ? strongest : undefined,
    endedEarly: x.endedEarly, checkride: x.checkride, drill: x.drill,
  };
}

/**
 * Three to five plain-English lines "from your supervisor". A student gets the long, encouraging version;
 * the higher the logbook rank, the shorter and more trusting it gets. No codes or abbreviations.
 */
export function supervisorReport(x: ReportInput): string[] {
  const rk = Math.max(0, Math.min(4, x.rank));
  const lines: string[] = [];
  const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const traffic = x.arrivals || x.departures ? `${pl(x.landed, 'landing')}${x.departures ? ` and ${pl(x.departures, 'departure')}` : ''}` : 'a quiet spell';
  const plain = (c?: Comp) => (c ? COMP_PLAIN[c].toLowerCase() : '');
  if (x.drill) {
    const d = x.drill;
    const head = !x.gatePass ? ['Separation went in the drill. Slow down and take it again.', 'Separation went. Again.', 'Lost separation. Again.', 'Separation. Again.', 'Again.'][rk]
      : d.pass ? (d.score >= 90 ? ['That was textbook. Exactly how it should look.', 'Textbook.', 'Textbook.', 'Textbook.', 'Good.'][rk] : ['Nicely done, that passes.', 'That passes.', 'Passes.', 'Passes.', 'Fine.'][rk])
      : ['Not quite yet. Every drill is a new variation, so the next one will feel different.', 'Not yet. Next variation.', 'Not yet.', 'Again.', 'Again.'][rk];
    const tip = d.pass && d.score < 90 ? [`The score is ${d.score}. Fly it again and look for an earlier, cleaner decision.`, `${d.score}. Make the decision earlier.`, `${d.score}. Earlier.`, '', ''][rk]
      : !d.pass ? [`${d.title} is about one decision at the right moment. Read the pass rule, then watch the expert do it.`, 'Watch the expert, then try again.', 'Watch the expert.', '', ''][rk] : '';
    const sign = ['Short drills like this add up quickly.', 'Keep at it.', 'Thanks.', 'Thanks.', 'Cheers.'][rk];
    return [head, ...(tip ? [tip] : rk <= 2 ? ['Nothing else to add.'] : ['Nothing to add.']), sign];
  }

  // 1. the headline
  if (!x.gatePass) {
    lines.push([
      `We need to talk about separation. ${x.losses ? `You lost it ${x.losses === 1 ? 'once' : pl(x.losses, 'time')} tonight` : 'Someone went below the safe altitude'}, and on a real position the session stops there.`,
      `Separation went tonight${x.losses ? ` (${pl(x.losses, 'time')})` : ''}. That comes before everything else.`,
      'You lost separation. Review it before your next shift.',
      'Separation went. Talk to me before the next one.',
      'Lost separation. My office.',
    ][rk]);
  } else if (x.grade === 'fail') {
    lines.push([
      `Everyone stayed safe, which is the most important part. The traffic got away from you a bit, though: ${traffic}${x.arrivals ? ` of ${x.arrivals} arrivals` : ''}.`,
      `Safe, but the traffic did not all get through: ${traffic}.`,
      `Safe, but not enough traffic worked: ${traffic}.`,
      `Safe. Not enough moved: ${traffic}.`,
      `Safe, slow. ${traffic}.`,
    ][rk]);
  } else {
    const word = x.grade === 'rated' ? ['That was excellent work', 'Very tidy shift', 'Tidy', 'Clean', 'Clean'][rk] : x.grade === 'good' ? ['That was a good shift', 'Good shift', 'Good shift', 'Good', 'Fine'][rk] : ['Nice work, you got everyone through safely', 'Safe shift', 'Safe, steady', 'Steady', 'Fine'][rk];
    lines.push(rk >= 3 ? `${word}. ${traffic[0].toUpperCase()}${traffic.slice(1)}.` : `${word}: ${traffic}, and nobody got too close.`);
  }
  // 2. something done well (students hear it every time; seniors only when it stands out)
  if (x.emergencies.length) {
    const ok = x.emergencies.filter((e) => e.landed).map((e) => e.cs);
    if (ok.length) lines.push(rk <= 1 ? `You got ${ok.join(' and ')} down safely in an emergency. That is exactly what the job is for.` : rk <= 2 ? `${ok.join(' and ')} landed safely. Well handled.` : `${ok.join(' and ')}: well handled.`);
    else lines.push(rk <= 2 ? `${x.emergencies.map((e) => e.cs).join(' and ')} did not land in time. An emergency goes to the front of the queue, always.` : 'The emergency did not make it down in time.');
  } else if (x.strongest && rk <= 2) lines.push(['The best part of it: ', 'Best part: ', 'Strongest: '][rk] + `${plain(x.strongest)}.`);
  // 3. the one thing to fix
  const fixes: string[] = [];
  if (x.gatePass && x.alerts > 0) fixes.push(rk <= 1 ? `The conflict alert went off ${x.alerts === 1 ? 'once' : x.alerts === 2 ? 'twice' : pl(x.alerts, 'time')}. Try to see those pairs coming a minute earlier and move one of them before the system has to tell you.` : rk <= 2 ? `${pl(x.alerts, 'conflict alert')}. See them sooner.` : `${pl(x.alerts, 'alert')}.`);
  if (x.spacing !== null && x.spacing > 1.2) fixes.push(rk <= 1 ? `Your gaps on final were ${x.spacing.toFixed(1)} miles wider than they needed to be. Slow the follower earlier rather than turning it late.` : rk <= 2 ? `Gaps on final ran ${x.spacing.toFixed(1)} miles loose.` : `Loose on final.`);
  if (x.answerS !== null && x.answerS > 8) fixes.push(rk <= 1 ? `Pilots waited about ${Math.round(x.answerS)} seconds for you. Answer the call first, even with a quick "standby", then plan.` : rk <= 2 ? `Answer pilots faster (about ${Math.round(x.answerS)} seconds tonight).` : 'Slow on the radio.');
  if (x.holdMin > 4 && x.arrivals) fixes.push(rk <= 1 ? `There was ${Math.round(x.holdMin)} minutes of holding. Plan the order early so fewer aircraft have to wait.` : rk <= 2 ? `${Math.round(x.holdMin)} minutes of holding. Plan the order sooner.` : 'Too much holding.');
  if (!fixes.length && x.weakest && rk <= 2) fixes.push(`If I had to pick one thing: ${plain(x.weakest)}.`);
  lines.push(...fixes.slice(0, rk <= 1 ? 2 : 1));
  // 4. the sign-off
  let sign: string;
  if (x.checkride) sign = x.checkride.pass ? ['Congratulations on the checkride. You have earned it.', 'Checkride done. Well earned.', 'Checkride passed. Well done.', 'Checkride passed.', 'Passed.'][rk] : ['The checkride did not go your way this time. Two more shifts and you can try again, and you will be ready.', 'Not the checkride result you wanted. Two more shifts, then again.', 'Checkride not passed. Two shifts, then retake.', 'Retake after two shifts.', 'Retake.'][rk];
  else if (x.endedEarly) sign = rk <= 2 ? 'You handed over early. Stay for the whole shift next time; the end is where the bank gets busy.' : 'Left early.';
  else sign = ['Get some rest. You are learning fast.', 'See you next shift.', 'Thanks for tonight.', 'Thanks.', 'Cheers.'][rk];
  // terser with rank: students up to 5 lines, supervisors 3
  const max = [5, 4, 4, 3, 3][rk];
  const body = lines.slice(0, max - 1);
  while (body.length < 2) body.push(rk <= 2 ? 'Nothing else to add.' : 'Nothing to add.');
  return [...body, sign];
}
