import type { Grade, Result } from './engine/assess';
import { CHALLENGES } from './engine/scenarios';
import {
  CHECKRIDES, RANKS, SHIFT_MIN_MINUTES, careerStatus, checkridesFor, emptyCareer, isShiftScenario, type CareerData, type CareerStatus, type CheckrideLog,
} from './engine/career';
import { DEFAULT_PACK } from './pack/index';
import type { DrillId, DrillVerdict } from './engine/drills';
export { RANKS };

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
  hints: boolean;          // supervisor hints during free play and challenges
  pttKey: string;          // KeyboardEvent.code held to talk ('' = off); pause then moves to P
  pedal: { kind: 'key'; code: string } | { kind: 'pad'; button: number; pad?: string } | null; // foot pedal binding
  voiceLang: 'en-GB' | 'en-US';
  voiceEngine: 'neural' | 'browser'; // neural radio voices (downloaded once) or the device's voices
  speakIcom: boolean;      // speak intercom lines from Tower, the centre and the others
  /** 2.0: the airport in use (ICAO id of a pack in src/pack/index.ts). */
  airport: string;
}

export const DEFAULT_SETTINGS: Settings = {
  voice: true, speakAtc: false, speechRate: 1.08, radarRefresh: 4, quickMode: false, trainingWheels: false,
  leftHanded: false, labelSize: 'M', brightness: 'night', unlockAll: false, speedVectorMin: 1, showMva: false, showProcedures: true, hints: true,
  pttKey: 'Space', pedal: null, voiceLang: 'en-GB', voiceEngine: 'neural', speakIcom: true, airport: DEFAULT_PACK,
};

// ---------------------------------------------------------------------------
// Airport scoping. Records, the career, the daily shift and drill results are kept per airport. Liège keeps the
// 1.0 keys (lgg.career, lgg.daily, lgg.drills, lgg.best); other airports get lgg.<key>.<ICAO>. The logbook is one
// book across airports; its entries carry the airport.

let activeAirport = DEFAULT_PACK;
/** Set once by main.ts (and again on an airport change); every store function defaults to it. */
export const setActiveAirport = (icao: string) => { activeAirport = icao || DEFAULT_PACK; };
export const getActiveAirport = () => activeAirport;
/** The storage key for an airport-scoped record. */
export const airportKey = (base: string, icao = activeAirport) => (icao === DEFAULT_PACK ? base : `${base}.${icao}`);

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
  /** 2.0: the airport (older records without it are Liège). */
  icao?: string;
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
  /** The airport of the session (default: the active one). */
  icao?: string;
}

/** Every record, all airports (`icao` missing on 1.0 records means Liège). */
export const loadAllRecords = (): RecordSummary[] => getArr<RecordSummary>('lgg.records');
/** The records of one airport (default: the active one). */
export const loadRecords = (icao = activeAirport): RecordSummary[] => loadAllRecords().filter((r) => (r.icao ?? DEFAULT_PACK) === icao);

export function saveRecord(r: Result, x?: SessionExtra) {
  const icao = x?.icao ?? activeAirport;
  loadCareer(icao); // migrate older saves before this record joins the history, so it is not logged twice
  const recs = loadAllRecords();
  recs.push({
    id: r.id, scenarioId: r.scenarioId, title: r.title, date: r.date, durationMin: r.durationMin, ratings: r.ratings, landed: r.landed, arrivals: r.arrivals,
    suggested: r.suggested, gatePass: r.gate.pass, passed: r.pass?.ok, grade: r.grade, seqBest: r.seqBest, moves: x?.moves, departures: x?.departures, icao,
  });
  put('lgg.records', recs.slice(-200));
  if (x && !x.counts) return;
  // best grade per scenario (challenges and daily shifts)
  if (r.pass || r.scenarioId.startsWith('daily-')) {
    const best = loadBest(icao);
    best[r.scenarioId] = better(best[r.scenarioId], r.grade);
    put(airportKey('lgg.best', icao), best);
  }
  // a daily shift counts toward the streak once at least one arrival has landed, so opening and quitting does not
  if (r.scenarioId.startsWith('daily-') && r.landed > 0) recordDaily(r, icao);
  addToLogbook(r, x, icao);
  // a free-play or daily session of 15 minutes or more is a logged shift for the career
  const seconds = x?.seconds ?? r.durationMin * 60;
  if (isShiftScenario(r.scenarioId) && seconds >= SHIFT_MIN_MINUTES * 60) {
    const c = loadCareer(icao);
    c.shifts.push({ date: r.date, id: r.scenarioId, title: r.title, grade: r.grade, min: Math.round(seconds / 60) });
    c.shifts = c.shifts.slice(-400);
    saveCareer(c, icao);
  }
}

// ---------------------------------------------------------------------------
// Best grade per challenge. Older saves only knew "passed": those migrate as 'pass'.

export function loadBest(icao = activeAirport): Record<string, Grade> {
  const b = getRaw<Record<string, Grade>>(airportKey('lgg.best', icao));
  if (b) return b;
  const out: Record<string, Grade> = {};
  for (const r of loadRecords(icao)) {
    if (r.passed === undefined && !r.grade) continue;
    const g: Grade = r.grade ?? (r.passed ? 'pass' : 'fail');
    out[r.scenarioId] = better(out[r.scenarioId], g);
  }
  put(airportKey('lgg.best', icao), out);
  return out;
}
export const bestGrade = (id: string, icao = activeAirport): Grade | undefined => loadBest(icao)[id];
export const passedChallenges = (icao = activeAirport): Set<string> => new Set(Object.entries(loadBest(icao)).filter(([, g]) => g !== 'fail').map(([k]) => k));

// ---------------------------------------------------------------------------
// Daily shift: one entry per local date, and a streak of consecutive days played.

export interface DailyEntry { grade: Grade; landed: number; plays: number }
export const ymdOf = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const loadDaily = (icao = activeAirport) => get<Record<string, DailyEntry>>(airportKey('lgg.daily', icao), {});

function recordDaily(r: Result, icao = activeAirport) {
  const days = loadDaily(icao);
  const ymd = r.scenarioId.slice(6);
  const o = days[ymd];
  days[ymd] = o ? { grade: better(o.grade, r.grade)!, landed: Math.max(o.landed, r.landed), plays: o.plays + 1 } : { grade: r.grade, landed: r.landed, plays: 1 };
  put(airportKey('lgg.daily', icao), days);
}

/** Today's best and the run of consecutive days played, ending today (or yesterday, if today is not played yet). */
export function dailyStatus(now = new Date(), icao = activeAirport): { today?: DailyEntry; streak: number; best: number } {
  const days = loadDaily(icao);
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

export interface LogEvent { date: string; kind: 'emergency' | 'rated' | 'good' | 'chain' | 'rank'; text: string; icao?: string }
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
  /** 2.0: sessions, seconds and movements per airport (older books have none: everything was Liège). */
  byAirport?: Record<string, { sessions: number; seconds: number; moves: number; landings: number }>;
}

export function loadLogbook(): Logbook {
  const l = getRaw<Logbook>('lgg.log');
  if (l) return l;
  // first run with a logbook: rebuild what we can from the session history
  const recs = loadAllRecords();
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

/** The logbook totals of one airport (the whole book for Liège when the book predates 2.0). */
export function logbookFor(icao = activeAirport, l = loadLogbook()): { sessions: number; seconds: number; moves: number; landings: number } {
  const by = l.byAirport?.[icao];
  if (by) return by;
  return icao === DEFAULT_PACK ? { sessions: l.sessions, seconds: l.seconds, moves: l.moves, landings: l.landings } : { sessions: 0, seconds: 0, moves: 0, landings: 0 };
}

function addToLogbook(r: Result, x: SessionExtra | undefined, icao = activeAirport) {
  const l = loadLogbook();
  const date = r.date;
  const secs = x?.seconds ?? r.durationMin * 60, moves = x?.moves ?? r.landed;
  l.sessions++;
  l.seconds += secs;
  l.landings += r.landed;
  l.moves += moves;
  l.departures += x?.departures ?? 0;
  l.byAirport ??= { [DEFAULT_PACK]: { sessions: l.sessions - 1, seconds: l.seconds - secs, moves: l.moves - moves, landings: l.landings - r.landed } };
  const by = (l.byAirport[icao] ??= { sessions: 0, seconds: 0, moves: 0, landings: 0 });
  by.sessions++; by.seconds += secs; by.moves += moves; by.landings += r.landed;
  if (r.seqBest > l.bestSeq && r.seqBest >= 3) l.events.push({ date, kind: 'chain', text: `New best sequence: ${r.seqBest} landings in a row on the minimum (${r.title})`, icao });
  l.bestSeq = Math.max(l.bestSeq, r.seqBest);
  if (r.grade === 'rated') { l.rated++; l.events.push({ date, kind: 'rated', text: `Rated on ${r.title}`, icao }); }
  if (r.grade === 'good') l.good++;
  for (const e of x?.emergencies ?? []) {
    if (!e.landed) continue;
    l.emergencies++;
    l.events.push({ date, kind: 'emergency', text: `${e.cs} landed safely after ${e.type === 'radio' ? 'a radio failure' : e.type === 'engine' ? 'an engine failure' : e.type === 'smoke' ? 'smoke in the hold' : 'an emergency'} (${r.title})`, icao });
  }
  l.events = l.events.slice(-60);
  put('lgg.log', l);
}

// ---------------------------------------------------------------------------
// Career: rank comes from checkrides; each checkride needs logged shifts, challenges and hours first.

export interface RankReq { text: string; ok: boolean }
export interface Rank { index: number; name: string; next?: string; reqs: RankReq[] }

const tierIds: Record<number, string[]> = {};
for (const c of CHALLENGES.filter((x) => (x.icao ?? 'EBLG') === 'EBLG')) (tierIds[c.tier ?? 1] ??= []).push(c.id);

/** The v0.4 rank rule (logbook only). Used once, to credit existing players with the checkrides they would have had. */
export function legacyRankIndex(l: Logbook, best: Record<string, Grade>): number {
  const hours = l.seconds / 3600;
  const passedTier = (t: number) => (tierIds[t] ?? []).filter((id) => best[id] && best[id] !== 'fail').length;
  const allTier = (t: number) => (tierIds[t]?.length ?? 0) > 0 && passedTier(t) === tierIds[t].length;
  const grades = Object.values(best);
  const good = grades.filter((g) => gradeRank(g) >= 2).length;
  const rated = grades.filter((g) => g === 'rated').length;
  const steps: boolean[][] = [
    [passedTier(1) + passedTier(2) + passedTier(3) + passedTier(4) > 0, l.sessions >= 3],
    [allTier(1), hours >= 2, l.moves >= 100],
    [allTier(2), good >= 3, l.moves >= 400],
    [allTier(3) && allTier(4), rated >= 5, hours >= 20],
  ];
  let i = 0;
  while (i < steps.length && steps[i].every(Boolean)) i++;
  return i;
}

/** Tutorial exams passed (read straight from the tutorial's own key). */
export function lessonsPassed(): number {
  try {
    const raw = JSON.parse(localStorage.getItem('lgg.tutorial') ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0;
    return Object.values(raw).filter((r: any) => r && r.pass).length;
  } catch { return 0; }
}

export function loadCareer(icao = activeAirport): CareerData {
  const key = airportKey('lgg.career', icao);
  const c = getRaw<CareerData>(key);
  if (c && Array.isArray(c.shifts) && Array.isArray(c.checkrides)) return c;
  // first run with careers: logged shifts from the session history, and checkrides credited for the rank already held
  const out = emptyCareer();
  for (const r of loadRecords(icao)) {
    if (!isShiftScenario(r.scenarioId) || r.durationMin < SHIFT_MIN_MINUTES) continue;
    out.shifts.push({ date: r.date, id: r.scenarioId, title: r.title, grade: r.grade ?? (r.gatePass ? 'pass' : 'fail'), min: r.durationMin });
  }
  const held = icao === DEFAULT_PACK && getRaw<Logbook>('lgg.log') ? legacyRankIndex(loadLogbook(), loadBest(icao)) : 0;
  const now = new Date().toISOString();
  for (let i = 0; i < held; i++) out.checkrides.push({ id: CHECKRIDES[i].id, date: now, pass: true, credited: true });
  put(key, out);
  return out;
}
export const saveCareer = (c: CareerData, icao = activeAirport) => put(airportKey('lgg.career', icao), c);

/** Career status at an airport: its own checkride ladder, shifts, best grades and hours. */
export function careerNow(l = loadLogbook(), best = loadBest(), icao = activeAirport): CareerStatus {
  return careerStatus({ log: logbookFor(icao, l), best, career: loadCareer(icao), lessonsPassed: lessonsPassed() }, checkridesFor(icao));
}

/** Rank and what the next promotion needs (the checkride is the last line). */
export function rankOf(l: Logbook, best: Record<string, Grade>, icao = activeAirport): Rank {
  const st = careerNow(l, best, icao);
  const p = st.promotion;
  const reqs: RankReq[] = p ? p.reqs.map((r) => ({ text: r.progress && !r.ok ? `${r.text} (${r.progress})` : r.text, ok: r.ok })) : [];
  if (p) reqs.push({ text: p.retakeIn ? `Checkride retake after ${p.retakeIn} more logged shift${p.retakeIn > 1 ? 's' : ''}` : `Pass the checkride${p.ready ? ' (ready to book)' : ''}`, ok: false });
  return { index: st.index, name: st.name, next: st.next, reqs };
}

/** Log a checkride attempt. A pass is a promotion, noted in the logbook. */
export function recordCheckride(id: string, pass: boolean, score: number, date = new Date().toISOString(), icao = activeAirport): CheckrideLog {
  const c = loadCareer(icao);
  const e: CheckrideLog = { id, date, pass, score };
  c.checkrides.push(e);
  c.checkrides = c.checkrides.slice(-100);
  saveCareer(c, icao);
  const def = CHECKRIDES.find((d) => d.id === id);
  const l = loadLogbook();
  l.events.push({ date, kind: 'rank', text: pass ? `Promoted to ${RANKS[def?.to ?? 0]} after the checkride` : `Checkride for ${RANKS[def?.to ?? 0]} not passed`, icao });
  l.events = l.events.slice(-60);
  put('lgg.log', l);
  return e;
}

// ---------------------------------------------------------------------------
// Drills: best score, best time on a pass, and the next variation to fly.

export interface DrillRecord { plays: number; passes: number; bestScore: number; bestTime?: number; lastVariant: number; last?: { pass: boolean; score: number; timeS: number } }
export const loadDrills = (icao = activeAirport): Partial<Record<DrillId, DrillRecord>> => get<Partial<Record<DrillId, DrillRecord>>>(airportKey('lgg.drills', icao), {});
export const nextDrillVariant = (id: DrillId, icao = activeAirport) => (loadDrills(icao)[id]?.lastVariant ?? 0) + 1;
/** Save a drill attempt; says whether it beat the best score or the best time. */
export function saveDrillResult(id: DrillId, variant: number, v: DrillVerdict, icao = activeAirport): { record: DrillRecord; newScore: boolean; newTime: boolean; prev?: DrillRecord } {
  const all = loadDrills(icao);
  const prev = all[id] ? { ...all[id]! } : undefined;
  const r: DrillRecord = { ...(all[id] ?? { plays: 0, passes: 0, bestScore: 0, lastVariant: 0 }) };
  r.plays++;
  r.lastVariant = Math.max(r.lastVariant, variant);
  const newScore = v.pass && v.score > r.bestScore;
  const newTime = v.pass && (r.bestTime === undefined || v.timeS < r.bestTime);
  if (v.pass) { r.passes++; r.bestScore = Math.max(r.bestScore, v.score); if (newTime) r.bestTime = Math.round(v.timeS); }
  r.last = { pass: v.pass, score: v.score, timeS: Math.round(v.timeS) };
  all[id] = r;
  put(airportKey('lgg.drills', icao), all);
  return { record: r, newScore, newTime, prev };
}

// ---------------------------------------------------------------------------
// Save file: every lgg.* key, versioned, with a checksum. Import replaces everything.

export const SAVE_APP = 'liege-approach';
export const SAVE_VERSION = 1;
export interface SaveFile { app: string; kind: 'save'; version: number; exported: string; keys: Record<string, string>; checksum: string }
export interface SaveSummary { sessions: number; rank: string; exported?: string; keys: number }

/** FNV-1a over the sorted key=value lines. */
export function saveChecksum(keys: Record<string, string>): string {
  let h = 2166136261;
  const s = Object.keys(keys).sort().map((k) => `${k}=${keys[k]}\n`).join('');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'fnv1a:' + (h >>> 0).toString(16).padStart(8, '0');
}

/** Can we write to local storage at all (private windows and blocked site data say no)? */
export function storageAvailable(): boolean {
  try { const k = 'lgg.__probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch { return false; }
}

const SAVE_KEY_RE = /^lgg\.[A-Za-z0-9._-]{1,40}$/;
function lggKeys(): string[] {
  const out: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && SAVE_KEY_RE.test(k) && k !== 'lgg.__probe') out.push(k); } } catch { /* storage unavailable */ }
  return out.sort();
}

export function exportSave(now = new Date()): SaveFile {
  const keys: Record<string, string> = {};
  for (const k of lggKeys()) { try { const v = localStorage.getItem(k); if (v !== null) keys[k] = v; } catch { /* skip */ } }
  return { app: SAVE_APP, kind: 'save', version: SAVE_VERSION, exported: now.toISOString(), keys, checksum: saveChecksum(keys) };
}
export const saveFileName = (now = new Date()) => `liege-approach-save-${ymdOf(now)}.json`;

function summaryOf(keys: Record<string, string>, exported?: string): SaveSummary {
  const parse = (k: string) => { try { return keys[k] ? JSON.parse(keys[k]) : undefined; } catch { return undefined; } };
  const log = parse('lgg.log') as Logbook | undefined;
  const recs = parse('lgg.records') as unknown[] | undefined;
  const car = parse('lgg.career') as CareerData | undefined;
  let rank = 0;
  while (rank < CHECKRIDES.length && car?.checkrides?.some((c) => c.id === CHECKRIDES[rank].id && c.pass)) rank++;
  return { sessions: log?.sessions ?? recs?.length ?? 0, rank: RANKS[rank], exported, keys: Object.keys(keys).length };
}
export const currentSummary = (): SaveSummary => { const f = exportSave(); return summaryOf(f.keys); };

/** Check a save file before importing it. Nothing is written. */
export function validateSave(text: string): { ok: true; save: SaveFile; summary: SaveSummary } | { ok: false; error: string } {
  if (text.length > 8_000_000) return { ok: false, error: 'This file is too large to be a save file.' };
  let j: any;
  try { j = JSON.parse(text); } catch { return { ok: false, error: 'This file is not a Liège Approach save (it is not readable JSON).' }; }
  if (!j || typeof j !== 'object' || j.app !== SAVE_APP || j.kind !== 'save') return { ok: false, error: 'This file is not a Liège Approach save.' };
  if (typeof j.version !== 'number' || j.version < 1) return { ok: false, error: 'This save file has no version number.' };
  if (j.version > SAVE_VERSION) return { ok: false, error: 'This save comes from a newer version of the game. Update the game first.' };
  if (!j.keys || typeof j.keys !== 'object' || Array.isArray(j.keys)) return { ok: false, error: 'This save file has no progress in it.' };
  for (const [k, v] of Object.entries(j.keys)) {
    if (!SAVE_KEY_RE.test(k)) return { ok: false, error: `Unexpected entry "${k.slice(0, 40)}" in the save file.` };
    if (typeof v !== 'string') return { ok: false, error: `The entry ${k} is damaged.` };
    try { JSON.parse(v); } catch { return { ok: false, error: `The entry ${k} is damaged.` }; }
  }
  if (j.checksum !== saveChecksum(j.keys)) return { ok: false, error: 'The file has been changed or damaged since it was saved (checksum mismatch).' };
  return { ok: true, save: j as SaveFile, summary: summaryOf(j.keys, typeof j.exported === 'string' ? j.exported : undefined) };
}

/** Replace every lgg.* key with the save's. Rolls back if storage fails half-way. */
export function applySave(save: SaveFile): { ok: true } | { ok: false; error: string } {
  if (!storageAvailable()) return { ok: false, error: 'This browser is not letting the game store anything (private window or blocked site data), so the save cannot be loaded here.' };
  const backup = exportSave();
  try {
    for (const k of lggKeys()) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(save.keys)) localStorage.setItem(k, v);
    return { ok: true };
  } catch {
    try { for (const k of lggKeys()) localStorage.removeItem(k); for (const [k, v] of Object.entries(backup.keys)) localStorage.setItem(k, v); } catch { /* nothing more we can do */ }
    return { ok: false, error: 'The browser ran out of storage while loading the save. Your previous progress was put back.' };
  }
}
