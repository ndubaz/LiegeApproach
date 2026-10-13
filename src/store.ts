import type { Grade, Result } from './engine/assess';
import { CHALLENGES } from './engine/scenarios';

export interface Settings {
  voice: boolean;          // speak pilot transmissions
  speakAtc: boolean;       // also speak your own clearances
  speechRate: number;
  radarRefresh: 1 | 4;
  quickMode: boolean;      // each picker choice transmits at once
  trainingWheels: boolean; // warnings block transmission
  leftHanded: boolean;
  labelSize: 'S' | 'M' | 'L';
  brightness: 'night' | 'day';
  unlockAll: boolean;
  speedVectorMin: 1 | 2 | 3;
  showMva: boolean;
  showProcedures: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  voice: true, speakAtc: false, speechRate: 1.08, radarRefresh: 4, quickMode: false, trainingWheels: false,
  leftHanded: false, labelSize: 'M', brightness: 'night', unlockAll: false, speedVectorMin: 1, showMva: false, showProcedures: true,
};

const get = <T>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; }
};
const getArr = <T>(k: string): T[] => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : []; } catch { return []; }
};
const getRaw = <T>(k: string): T | undefined => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : undefined; } catch { return undefined; }
};
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export const loadSettings = (): Settings => get('lgg.settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => put('lgg.settings', s);

// ---------------------------------------------------------------------------
// Session records

export const GRADE_ORDER: Grade[] = ['fail', 'pass', 'good', 'rated'];
export const gradeRank = (g?: Grade) => (g ? GRADE_ORDER.indexOf(g) : -1);
const better = (a: Grade | undefined, b: Grade) => (gradeRank(b) > gradeRank(a) ? b : a ?? b);

export type RecordSummary = Pick<Result, 'id' | 'scenarioId' | 'title' | 'date' | 'durationMin' | 'ratings' | 'landed' | 'arrivals' | 'suggested'> & {
  gatePass: boolean; passed?: boolean;
  grade?: Grade; seqBest?: number; moves?: number; departures?: number;
};

/** What the session contributed beyond the Result (counted by main.ts from the Sim). */
export interface SessionExtra {
  /** Movements handled: landings plus departures handed on. */
  moves: number;
  departures: number;
  /** Emergencies on frequency this session, and whether each landed. */
  emergencies: { cs: string; type: string; landed: boolean }[];
  /** Sim seconds on position. */
  seconds: number;
  /** A replay or tutorial does not count toward the logbook. */
  counts: boolean;
}

export const loadRecords = (): RecordSummary[] => getArr<RecordSummary>('lgg.records');

export function saveRecord(r: Result, x?: SessionExtra) {
  const recs = loadRecords();
  recs.push({
    id: r.id, scenarioId: r.scenarioId, title: r.title, date: r.date, durationMin: r.durationMin, ratings: r.ratings, landed: r.landed, arrivals: r.arrivals,
    suggested: r.suggested, gatePass: r.gate.pass, passed: r.pass?.ok, grade: r.grade, seqBest: r.seqBest, moves: x?.moves, departures: x?.departures,
  });
  put('lgg.records', recs.slice(-200));
  if (x && !x.counts) return;
  const before = rankOf(loadLogbook(), loadBest());
  // best grade per scenario (challenges and daily shifts)
  if (r.pass || r.scenarioId.startsWith('daily-')) {
    const best = loadBest();
    best[r.scenarioId] = better(best[r.scenarioId], r.grade);
    put('lgg.best', best);
  }
  if (r.scenarioId.startsWith('daily-')) recordDaily(r);
  addToLogbook(r, x, before.index);
}

// ---------------------------------------------------------------------------
// Best grade per challenge. Older saves only knew "passed": those migrate as 'pass'.

export function loadBest(): Record<string, Grade> {
  const b = getRaw<Record<string, Grade>>('lgg.best');
  if (b) return b;
  const out: Record<string, Grade> = {};
  for (const r of loadRecords()) {
    if (r.passed === undefined && !r.grade) continue;
    const g: Grade = r.grade ?? (r.passed ? 'pass' : 'fail');
    out[r.scenarioId] = better(out[r.scenarioId], g);
  }
  put('lgg.best', out);
  return out;
}
export const bestGrade = (id: string): Grade | undefined => loadBest()[id];
export const passedChallenges = (): Set<string> => new Set(Object.entries(loadBest()).filter(([, g]) => g !== 'fail').map(([k]) => k));

// ---------------------------------------------------------------------------
// Daily shift: one entry per local date, and a streak of consecutive days played.

export interface DailyEntry { grade: Grade; landed: number; plays: number }
export const ymdOf = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const loadDaily = () => get<Record<string, DailyEntry>>('lgg.daily', {});

function recordDaily(r: Result) {
  const days = loadDaily();
  const ymd = r.scenarioId.slice(6);
  const o = days[ymd];
  days[ymd] = o ? { grade: better(o.grade, r.grade)!, landed: Math.max(o.landed, r.landed), plays: o.plays + 1 } : { grade: r.grade, landed: r.landed, plays: 1 };
  put('lgg.daily', days);
}

/** Today's best and the run of consecutive days played, ending today (or yesterday, if today is not played yet). */
export function dailyStatus(now = new Date()): { today?: DailyEntry; streak: number; best: number } {
  const days = loadDaily();
  const d = new Date(now);
  const today = days[ymdOf(d)];
  if (!today) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days[ymdOf(d)]) { streak++; d.setDate(d.getDate() - 1); }
  // longest streak ever
  const keys = Object.keys(days).sort();
  let best = 0, run = 0, prev: Date | undefined;
  for (const k of keys) {
    const cur = new Date(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)));
    run = prev && Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = cur;
  }
  return { today, streak, best };
}

// ---------------------------------------------------------------------------
// Controller logbook: running totals that outlive the 200-record history.

export interface LogEvent { date: string; kind: 'emergency' | 'rated' | 'good' | 'chain' | 'rank'; text: string }
export interface Logbook {
  sessions: number;
  seconds: number;
  moves: number;
  landings: number;
  departures: number;
  bestSeq: number;
  emergencies: number;
  rated: number;
  good: number;
  events: LogEvent[];
}

export function loadLogbook(): Logbook {
  const l = getRaw<Logbook>('lgg.log');
  if (l) return l;
  // first run with a logbook: rebuild what we can from the session history
  const recs = loadRecords();
  const out: Logbook = { sessions: recs.length, seconds: 0, moves: 0, landings: 0, departures: 0, bestSeq: 0, emergencies: 0, rated: 0, good: 0, events: [] };
  for (const r of recs) {
    out.seconds += r.durationMin * 60;
    out.landings += r.landed;
    out.moves += r.moves ?? r.landed;
    out.departures += r.departures ?? 0;
    out.bestSeq = Math.max(out.bestSeq, r.seqBest ?? 0);
    if (r.grade === 'rated') out.rated++;
    if (r.grade === 'good') out.good++;
  }
  put('lgg.log', out);
  return out;
}

function addToLogbook(r: Result, x: SessionExtra | undefined, beforeIdx: number) {
  const l = loadLogbook();
  const date = r.date;
  l.sessions++;
  l.seconds += x?.seconds ?? r.durationMin * 60;
  l.landings += r.landed;
  l.moves += x?.moves ?? r.landed;
  l.departures += x?.departures ?? 0;
  if (r.seqBest > l.bestSeq && r.seqBest >= 3) l.events.push({ date, kind: 'chain', text: `New best sequence: ${r.seqBest} landings in a row on the minimum (${r.title})` });
  l.bestSeq = Math.max(l.bestSeq, r.seqBest);
  if (r.grade === 'rated') { l.rated++; l.events.push({ date, kind: 'rated', text: `Rated on ${r.title}` }); }
  if (r.grade === 'good') l.good++;
  for (const e of x?.emergencies ?? []) {
    if (!e.landed) continue;
    l.emergencies++;
    l.events.push({ date, kind: 'emergency', text: `${e.cs} landed safely after ${e.type === 'radio' ? 'a radio failure' : e.type === 'engine' ? 'an engine failure' : e.type === 'smoke' ? 'smoke in the hold' : 'an emergency'} (${r.title})` });
  }
  l.events = l.events.slice(-60);
  put('lgg.log', l);
  const after = rankOf(l, loadBest());
  if (after.index > beforeIdx) { l.events.push({ date, kind: 'rank', text: `Promoted to ${after.name}` }); put('lgg.log', l); }
}

// ---------------------------------------------------------------------------
// Career rank, derived from the logbook and best grades. No gameplay gates.

export const RANKS = ['Student', 'Trainee', 'Validated', 'Senior', 'Supervisor'] as const;
export interface RankReq { text: string; ok: boolean }
export interface Rank { index: number; name: string; next?: string; reqs: RankReq[] }

const tierIds: Record<number, string[]> = {};
for (const c of CHALLENGES) (tierIds[c.tier ?? 1] ??= []).push(c.id);

export function rankOf(l: Logbook, best: Record<string, Grade>): Rank {
  const hours = l.seconds / 3600;
  const passedTier = (t: number) => (tierIds[t] ?? []).filter((id) => best[id] && best[id] !== 'fail').length;
  const allTier = (t: number) => (tierIds[t]?.length ?? 0) > 0 && passedTier(t) === tierIds[t].length;
  const grades = Object.values(best);
  const good = grades.filter((g) => gradeRank(g) >= 2).length;
  const rated = grades.filter((g) => g === 'rated').length;
  const n = (t: number) => tierIds[t]?.length ?? 0;
  const steps: RankReq[][] = [
    [{ text: 'Pass any challenge', ok: passedTier(1) + passedTier(2) + passedTier(3) + passedTier(4) > 0 }, { text: 'Finish 3 sessions', ok: l.sessions >= 3 }],
    [{ text: `Pass every Tier 1 challenge (${passedTier(1)}/${n(1)})`, ok: allTier(1) }, { text: `2 hours on position (${hours.toFixed(1)})`, ok: hours >= 2 }, { text: `100 movements (${l.moves})`, ok: l.moves >= 100 }],
    [{ text: `Pass every Tier 2 challenge (${passedTier(2)}/${n(2)})`, ok: allTier(2) }, { text: `Good or better on 3 challenges (${good})`, ok: good >= 3 }, { text: `400 movements (${l.moves})`, ok: l.moves >= 400 }],
    [{ text: `Pass every Tier 3 and Tier 4 challenge (${passedTier(3) + passedTier(4)}/${n(3) + n(4)})`, ok: allTier(3) && allTier(4) }, { text: `Rated on 5 challenges (${rated})`, ok: rated >= 5 }, { text: `20 hours on position (${hours.toFixed(1)})`, ok: hours >= 20 }],
  ];
  let index = 0;
  while (index < steps.length && steps[index].every((r) => r.ok)) index++;
  return { index, name: RANKS[index], next: RANKS[index + 1], reqs: steps[index] ?? [] };
}
