import { describe, it, expect, beforeEach } from 'vitest';

// a minimal localStorage for node (store.ts reads it at call time)
class MemStorage {
  m = new Map<string, string>();
  broken = false;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { if (this.broken) throw new Error('blocked'); return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { if (this.broken) throw new Error('blocked'); this.m.set(k, String(v)); }
  removeItem(k: string) { if (this.broken) throw new Error('blocked'); this.m.delete(k); }
  clear() { this.m.clear(); }
}
const mem = new MemStorage();
(globalThis as any).localStorage = mem;

import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import type { Grade, Result } from '../src/engine/assess';
import {
  CHECKRIDES, RETAKE_SHIFTS, attachExaminer, careerStatus, emptyCareer, examinerVerdict, firstDivergence, keyMoments, sampleTracks, supervisorReport,
  type CareerData, type ExamRun, type ReportInput, type TrackLog,
} from '../src/engine/career';
import { DRILLS, attachDrill, drillScenario, drillSolver, drillVerdict, parseDrillScenario } from '../src/engine/drills';
import {
  applySave, careerNow, exportSave, loadCareer, rankOf, recordCheckride, saveChecksum, saveDrillResult, saveRecord, loadDrills, nextDrillVariant, validateSave, loadLogbook, loadBest,
} from '../src/store';

const pack = loadPack(EBLG);
const log0 = { sessions: 0, seconds: 0, moves: 0 };
const shifts = (n: number, grade: Grade, date = '2026-10-01T00:00:00.000Z') => Array.from({ length: n }, (_, i) => ({ date: date.replace('00:00:00', `00:00:${String(i).padStart(2, '0')}`), id: 'free', title: 'Free play', grade, min: 30 }));

describe('career: rank derivation', () => {
  it('a new player is a Student, and the first checkride is locked until the requirements are met', () => {
    const st = careerStatus({ log: log0, best: {}, career: emptyCareer(), lessonsPassed: 0 });
    expect(st.name).toBe('Student');
    expect(st.next).toBe('OJT');
    expect(st.promotion!.ready).toBe(false);
    expect(st.promotion!.reqs.every((r) => !r.ok)).toBe(true);
    expect(st.promotion!.checkride.id).toBe('ojt');
  });
  it('meeting every requirement makes the checkride bookable; passing it promotes', () => {
    const career: CareerData = { v: 1, shifts: shifts(2, 'pass'), checkrides: [] };
    const inp = { log: log0, best: { 'first-freighter': 'good' as Grade }, career, lessonsPassed: 3 };
    expect(careerStatus(inp).promotion!.ready).toBe(true);
    career.checkrides.push({ id: 'ojt', date: '2026-10-02T00:00:00.000Z', pass: true });
    const st = careerStatus(inp);
    expect(st.name).toBe('OJT');
    expect(st.promotion!.checkride.id).toBe('validated');
    expect(st.promotedOn[1]).toBe('2026-10-02T00:00:00.000Z');
  });
  it('shifts below the minimum grade do not count; rated shifts are required for supervisor', () => {
    const career: CareerData = { v: 1, shifts: [...shifts(5, 'fail'), ...shifts(1, 'pass')], checkrides: [] };
    const st = careerStatus({ log: log0, best: { 'first-freighter': 'pass' }, career, lessonsPassed: 5 });
    expect(st.promotion!.reqs.find((r) => r.key === 'shifts')!.ok).toBe(false);
    const top: CareerData = { v: 1, shifts: shifts(12, 'good'), checkrides: CHECKRIDES.slice(0, 3).map((c) => ({ id: c.id, date: '2026-01-01', pass: true })) };
    const s3 = careerStatus({ log: { sessions: 50, seconds: 30 * 3600, moves: 900 }, best: { 'go-around': 'pass', 'radio-failure': 'pass', 'compound-night': 'pass' }, career: top, lessonsPassed: 10 });
    expect(s3.name).toBe('Senior');
    expect(s3.promotion!.reqs.find((r) => r.key === 'rated')!.ok).toBe(false);
    expect(s3.promotion!.ready).toBe(false);
  });
  it(`a failed checkride needs ${RETAKE_SHIFTS} more logged shifts before the retake`, () => {
    const career: CareerData = { v: 1, shifts: shifts(2, 'pass'), checkrides: [{ id: 'ojt', date: '2026-10-05T00:00:00.000Z', pass: false }] };
    const inp = { log: log0, best: { 'first-freighter': 'pass' as Grade }, career, lessonsPassed: 3 };
    let p = careerStatus(inp).promotion!;
    expect(p.retakeIn).toBe(2);
    expect(p.ready).toBe(false);
    career.shifts.push(...shifts(1, 'fail', '2026-10-06T00:00:00.000Z'));
    expect(careerStatus(inp).promotion!.retakeIn).toBe(1);
    career.shifts.push(...shifts(1, 'pass', '2026-10-07T00:00:00.000Z'));
    p = careerStatus(inp).promotion!;
    expect(p.retakeIn).toBe(0);
    expect(p.ready).toBe(true);
    expect(p.attempts).toBe(1);
  });
});

describe('career: store', () => {
  beforeEach(() => { mem.broken = false; mem.clear(); });
  const result = (over: Partial<Result> = {}): Result => ({
    id: '1', scenarioId: 'free', title: 'Free play · Night bank', date: '2026-10-10T20:00:00.000Z', durationMin: 40, seed: 1,
    gate: { pass: true, lines: [] }, ratings: { SEPC: 5, SITU: null, TRAF: 4, COMM: 5, CORD: 5, WORK: 5, NONR: null, SPP: 5 }, evidence: {} as any, metrics: [], costliest: [],
    narrative: [], landed: 8, arrivals: 8, grade: 'pass', gradeNotes: [], seqBest: 0, ...over,
  });
  it('a free-play session of 15 minutes or more is a logged shift; a short one or a challenge is not', () => {
    saveRecord(result(), { moves: 10, departures: 2, emergencies: [], seconds: 2400, counts: true });
    saveRecord(result({ id: '2' }), { moves: 2, departures: 0, emergencies: [], seconds: 600, counts: true });
    saveRecord(result({ id: '3', scenarioId: 'trombone', title: 'Trombone', pass: { ok: true, reasons: [] } }), { moves: 4, departures: 0, emergencies: [], seconds: 1500, counts: true });
    expect(loadCareer().shifts.length).toBe(1);
    expect(loadCareer().shifts[0].grade).toBe('pass');
  });
  it('existing v0.4 players keep their rank: checkrides are credited from the old rule', () => {
    mem.setItem('lgg.log', JSON.stringify({ sessions: 30, seconds: 3 * 3600, moves: 150, landings: 100, departures: 50, bestSeq: 0, emergencies: 0, rated: 0, good: 0, events: [] }));
    const tier1 = ['first-freighter', 'trombone', 'first-release', 'cross-streams'];
    mem.setItem('lgg.best', JSON.stringify(Object.fromEntries(tier1.map((id) => [id, 'pass']))));
    const c = loadCareer();
    expect(c.checkrides.map((x) => x.id)).toEqual(['ojt', 'validated']);
    expect(c.checkrides.every((x) => x.credited)).toBe(true);
    expect(careerNow().name).toBe('Validated');
    expect(rankOf(loadLogbook(), loadBest()).name).toBe('Validated');
  });
  it('recording a checkride pass promotes and notes it in the logbook', () => {
    recordCheckride('ojt', true, 100);
    expect(careerNow().name).toBe('OJT');
    expect(loadLogbook().events.some((e) => e.kind === 'rank' && /OJT/.test(e.text))).toBe(true);
  });
  it('drill results keep the best score and best time, and move to the next variation', () => {
    expect(nextDrillVariant('wake')).toBe(1);
    saveDrillResult('wake', 1, { pass: true, timeS: 30, score: 70, why: '', facts: [] });
    const r = saveDrillResult('wake', 2, { pass: true, timeS: 20, score: 60, why: '', facts: [] });
    expect(r.newTime).toBe(true);
    expect(r.newScore).toBe(false);
    saveDrillResult('wake', 3, { pass: false, timeS: 5, score: 0, why: '', facts: [] });
    const w = loadDrills().wake!;
    expect([w.bestScore, w.bestTime, w.plays, w.passes]).toEqual([70, 20, 3, 2]);
    expect(nextDrillVariant('wake')).toBe(4);
  });
});

describe('career: save file', () => {
  beforeEach(() => { mem.broken = false; mem.clear(); });
  it('round-trips every lgg.* key, and ignores other keys', () => {
    mem.setItem('lgg.settings', JSON.stringify({ voice: false }));
    mem.setItem('lgg.log', JSON.stringify({ sessions: 4, seconds: 100, moves: 3, landings: 3, departures: 0, bestSeq: 0, emergencies: 0, rated: 0, good: 0, events: [] }));
    mem.setItem('lgg.career', JSON.stringify({ v: 1, shifts: [], checkrides: [{ id: 'ojt', date: 'x', pass: true }] }));
    mem.setItem('other.app', 'keep me');
    const text = JSON.stringify(exportSave(new Date('2026-10-13T10:00:00Z')));
    const v = validateSave(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.summary).toMatchObject({ sessions: 4, rank: 'OJT', keys: 3 });
    mem.clear();
    mem.setItem('lgg.records', '[]');
    mem.setItem('other.app', 'keep me');
    expect(applySave(v.save).ok).toBe(true);
    expect(mem.getItem('lgg.records')).toBeNull();
    expect(JSON.parse(mem.getItem('lgg.settings')!)).toEqual({ voice: false });
    expect(mem.getItem('other.app')).toBe('keep me');
    expect(JSON.stringify(exportSave(new Date('2026-10-13T10:00:00Z')))).toBe(text);
  });
  it('rejects tampered, foreign, newer and malformed files', () => {
    mem.setItem('lgg.log', '{"sessions":1}');
    const f = exportSave();
    expect(validateSave(JSON.stringify({ ...f, keys: { ...f.keys, 'lgg.log': '{"sessions":99}' } }))).toMatchObject({ ok: false, error: expect.stringMatching(/checksum/) });
    expect(validateSave(JSON.stringify({ ...f, app: 'other' })).ok).toBe(false);
    expect(validateSave(JSON.stringify({ ...f, version: 99 }))).toMatchObject({ ok: false, error: expect.stringMatching(/newer/) });
    expect(validateSave('not json').ok).toBe(false);
    const bad = { 'evil.key': '1' };
    expect(validateSave(JSON.stringify({ ...f, keys: bad, checksum: saveChecksum(bad) })).ok).toBe(false);
    const broken = { 'lgg.log': '{oops' };
    expect(validateSave(JSON.stringify({ ...f, keys: broken, checksum: saveChecksum(broken) })).ok).toBe(false);
  });
  it('is robust when storage is unavailable', () => {
    mem.setItem('lgg.log', '{"sessions":1}');
    const f = exportSave();
    mem.broken = true;
    expect(() => exportSave()).not.toThrow();
    expect(Object.keys(exportSave().keys)).toEqual([]);
    expect(applySave(f)).toMatchObject({ ok: false });
    expect(() => careerNow()).not.toThrow();
    expect(careerNow().name).toBe('Student');
  });
});

describe('career: checkride examiner', () => {
  const def = CHECKRIDES.find((c) => c.id === 'validated')!;
  const run = (over: Partial<ExamRun>): ExamRun => ({
    t: 2000, events: [], landings: [], cmdLog: [], spawnLog: [{ cs: 'BAF61', t: 300 }], utc: (t = 0) => `01:${String(40 + Math.floor(t / 60)).padStart(2, '0')}:00`, ...over,
  });
  const ok = { gate: { pass: true, lines: [] }, grade: 'pass' as Grade, landed: 6, arrivals: 6 };
  const closures = [{ t0: 640, t1: 880, rwy: '22L' }];
  it('passes a clean synthetic run', () => {
    const v = examinerVerdict(run({ cmdLog: [{ t: 320, cl: { cs: 'BAF61', items: [{ k: 'appr' }] } }] }), def, ok, { closures, qnh: [] });
    expect(v.pass).toBe(true);
    expect(v.items.map((i) => i.kind)).toEqual(['gate', 'grade', 'milxing', 'birds']);
    expect(v.report[0]).toMatch(/passed/);
  });
  it('fails on a go-around into the closed runway, a late military answer, a low grade or a lost gate, with plain-English reasons', () => {
    const late = examinerVerdict(run({ cmdLog: [{ t: 420, cl: { cs: 'BAF61', items: [{ k: 'appr' }] } }] }), def, ok, { closures, qnh: [] });
    expect(late.pass).toBe(false);
    expect(late.items.find((i) => i.kind === 'milxing')!.note).toMatch(/waited 120 seconds/);
    const ga = examinerVerdict(run({ cmdLog: [{ t: 310, cl: { cs: 'BAF61', items: [{ k: 'appr' }] } }], events: [{ t: 700, kind: 'goaround', cs: 'TAY4EK', text: 'TAY4EK: go-around, runway occupied' }] }), def, ok, { closures, qnh: [] });
    expect(ga.pass).toBe(false);
    expect(ga.items.find((i) => i.kind === 'birds')!.note).toMatch(/TAY4EK/);
    const low = examinerVerdict(run({ cmdLog: [{ t: 310, cl: { cs: 'BAF61', items: [{ k: 'appr' }] } }] }), def, { ...ok, grade: 'fail', gate: { pass: false, lines: [] } }, { closures, qnh: [] });
    expect(low.items.filter((i) => !i.ok).map((i) => i.kind)).toEqual(['gate', 'grade']);
    for (const v of [late, ga, low]) for (const line of [...v.report, ...v.items.map((i) => i.note)]) expect(line).not.toMatch(/—|\b(SEPC|STCA|ICAO)\b/);
  });
  it('the QNH change needs the new QNH passed to every arrival that had the old one', () => {
    const d = CHECKRIDES.find((c) => c.id === 'ojt')!;
    const qnh = [{ t: 420, qnh: 1015, cs: ['QTR8125', 'TAY4EK'] }];
    const one = examinerVerdict(run({ cmdLog: [{ t: 430, cl: { cs: 'QTR8125', items: [{ k: 'lvl', lvl: { ft: 3000 } }] } }] }), d, ok, { closures: [], qnh });
    const q = one.items.find((i) => i.kind === 'qnh')!;
    expect(q.ok).toBe(false);
    expect(q.note).toMatch(/TAY4EK never got it/);
    const both = examinerVerdict(run({ cmdLog: [{ t: 430, cl: { cs: 'QTR8125', items: [{ k: 'atis' }] } }, { t: 440, cl: { cs: 'TAY4EK', items: [{ k: 'xfr', unit: 'TWR' }] } }] }), d, ok, { closures: [], qnh });
    expect(both.items.find((i) => i.kind === 'qnh')!.ok).toBe(true);
  });
  it('the hidden script runs in the live sim: the runway closes for birds, the military calls, the QNH changes on time', () => {
    const sim = new Sim(pack, def.scenario);
    const st = attachExaminer(sim, def);
    while (sim.t < 660) sim.step();
    expect(st.closures).toHaveLength(1);
    expect(st.closures[0].t0).toBe(640);
    expect(sim.runwayBusy()).toBe(true);
    expect(sim.log.some((t) => t.from === 'MIL' && /BAF61/.test(t.text))).toBe(true);
    expect(sim.log.some((t) => t.from === 'TWR' && /birds/.test(t.text))).toBe(true);
    const ojt = CHECKRIDES[0];
    const s2 = new Sim(pack, ojt.scenario);
    const q0 = s2.qnh;
    const st2 = attachExaminer(s2, ojt);
    while (s2.t < 430) s2.step();
    expect(s2.qnh).toBe(q0 - 3);
    expect(st2.qnh[0].t).toBe(420);
  });
});

describe('drills', () => {
  it('generators are deterministic per variant, and vary between variants', () => {
    for (const d of DRILLS) {
      const a = drillScenario(pack, d.id, 3), b = drillScenario(pack, d.id, 3), c = drillScenario(pack, d.id, 4);
      expect(a).toEqual(b);
      expect(parseDrillScenario(a.id)).toEqual({ id: d.id, variant: 3 });
      expect(d.params(a.seed)).not.toEqual(d.params(c.seed));
      const pos = (sc: typeof a) => { const s = new Sim(pack, sc); attachDrill(s, d); while (s.t < 40 && !s.ended) s.step(); return s.aircraft.map((x) => [x.cs, x.p.x.toFixed(4), x.p.y.toFixed(4), Math.round(x.alt)]); };
      expect(pos(a)).toEqual(pos(b));
    }
  });
  it('every drill is passable by its scripted solution, and fails when nobody acts', () => {
    for (const d of DRILLS) {
      for (let v = 1; v <= 3; v++) {
        const sc = drillScenario(pack, d.id, v);
        const sim = new Sim(pack, sc);
        attachDrill(sim, d);
        const solve = drillSolver(d);
        let n = 0;
        while (!sim.ended && n++ < 3000) { solve(sim); sim.step(); }
        const verdict = drillVerdict(sim)!;
        expect(verdict.pass, `${d.id} v${v}: ${verdict.why}`).toBe(true);
        expect(verdict.score).toBeGreaterThan(50);
        expect(sim.events.filter((e) => e.kind === 'los' || e.kind === 'stca')).toEqual([]);
      }
      if (d.id === 'wake') continue; // a wake variation can start on the right gap: leaving it alone is then the correct answer
      const idle = new Sim(pack, drillScenario(pack, d.id, 1));
      attachDrill(idle, d);
      let n = 0;
      while (!idle.ended && n++ < 3000) idle.step();
      expect(drillVerdict(idle)!.pass, d.id).toBe(false);
    }
  });
});

describe('ghost replay and supervisor', () => {
  it('finds the first meaningful divergence between two command logs', () => {
    const empty: TrackLog = { every: 4, t1: 900, lines: [], sparks: [] };
    const P = [{ t: 100, cl: { cs: 'QTR8125', items: [{ k: 'lvl' as const, lvl: { ft: 4000 } }] } }, { t: 340, cl: { cs: 'QTR8125', items: [{ k: 'trans' as const, name: 'ALHUV1A' }] } }];
    const E = [{ t: 110, cl: { cs: 'QTR8125', items: [{ k: 'lvl' as const, lvl: { ft: 4000 } }] } }, { t: 300, cl: { cs: 'QTR8125', items: [{ k: 'trans' as const, name: 'ALHUV1A' }] } }];
    const d = firstDivergence({ cmds: P, tracks: empty }, { cmds: E, tracks: empty })!;
    expect(d.t).toBe(300);
    expect(d.text).toBe('The expert cleared QTR8125 for the approach here, 40 s earlier than you.');
    expect(firstDivergence({ cmds: E, tracks: empty }, { cmds: E, tracks: empty })).toBeUndefined();
    expect(keyMoments([{ t: 5, cl: { cs: 'X', items: [{ k: 'hdg', hdg: 313 }] } }]).map((m) => m.kind)).toEqual(['base']);
  });
  it('samples tracks every 4 s, with landings recorded at the threshold', () => {
    const sim = new Sim(pack, CHECKRIDES[0].scenario);
    const tr = sampleTracks(sim, 4);
    while (sim.t < 120) sim.step();
    const l = tr.lines[0];
    expect(l.pts.length).toBeGreaterThan(20);
    expect(l.pts[1].t - l.pts[0].t).toBe(4);
  });
  it('the supervisor writes 3 to 5 plain lines, terser as the rank rises', () => {
    const base: ReportInput = { rank: 0, grade: 'pass', gatePass: true, landed: 8, arrivals: 9, departures: 3, alerts: 2, losses: 0, spacing: 2.1, holdMin: 6, answerS: 11, emergencies: [], weakest: 'SITU', strongest: 'COMM' };
    const lens: number[] = [];
    for (let rank = 0; rank <= 4; rank++) {
      for (const x of [base, { ...base, gatePass: false, losses: 2, grade: 'fail' as Grade }, { ...base, grade: 'rated' as Grade, alerts: 0, spacing: 0.4, holdMin: 0, answerS: 3 }, { ...base, checkride: { pass: true } }, { ...base, drill: { pass: true, score: 80, title: 'Intercept' } }]) {
        const lines = supervisorReport({ ...x, rank });
        expect(lines.length).toBeGreaterThanOrEqual(3);
        expect(lines.length).toBeLessThanOrEqual(5);
        for (const l of lines) {
          expect(l).not.toMatch(/\b(SEPC|SITU|TRAF|COMM|CORD|WORK|NONR|SPP|STCA|MVA|ICAO|ILS)\b/);
          expect(l).not.toMatch(/—|delve|crucial|furthermore|moreover/i);
        }
      }
      lens.push(supervisorReport({ ...base, rank }).join(' ').length);
    }
    for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeLessThanOrEqual(lens[i - 1]);
    expect(lens[4]).toBeLessThan(lens[0] / 2);
  });
});
