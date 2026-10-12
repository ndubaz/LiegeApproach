import type { Result } from './engine/assess';

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
const put = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export const loadSettings = (): Settings => get('lgg.settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => put('lgg.settings', s);

export type RecordSummary = Pick<Result, 'id' | 'scenarioId' | 'title' | 'date' | 'durationMin' | 'ratings' | 'landed' | 'arrivals' | 'suggested'> & { gatePass: boolean; passed?: boolean };
export const loadRecords = (): RecordSummary[] => getArr<RecordSummary>('lgg.records');
export function saveRecord(r: Result) {
  const recs = loadRecords();
  recs.push({ id: r.id, scenarioId: r.scenarioId, title: r.title, date: r.date, durationMin: r.durationMin, ratings: r.ratings, landed: r.landed, arrivals: r.arrivals, suggested: r.suggested, gatePass: r.gate.pass, passed: r.pass?.ok });
  put('lgg.records', recs.slice(-200));
}
export const passedChallenges = (): Set<string> => new Set(loadRecords().filter((r) => r.passed).map((r) => r.scenarioId));
