import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import type { Scenario, SimEvent, SpawnSpec } from '../src/engine/types';
import { CHALLENGES, unlockedTiers } from '../src/engine/scenarios';
import { assess, explain, liveStats, seqChain, track } from '../src/engine/assess';
import { dailyShift, freePlay, handoverViolations, shiftPhases, type FreePlayOpts } from '../src/engine/traffic';
import { PERF } from '../src/engine/perf';
import { dist } from '../src/geo';
import { autoControl } from './auto';

const pack = loadPack(EBLG);
const opts = (template: FreePlayOpts['template'], seed: number, durationMin = 75): FreePlayOpts => ({ template, durationMin, military: 1, weather: 'good', emergencies: true, difficulty: 2, seed });

describe('free-play traffic generation', () => {
  it('Brussels never hands over two arrivals on the same STAR within 10 NM at the same level (10 seeds, flown)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      for (const tpl of ['night', 'shift'] as const) {
        const sc = freePlay(pack, opts(tpl, seed, 60));
        expect(handoverViolations(pack, sc.spawns)).toEqual([]);
        // fly the traffic with no controller and measure at each arrival's handover
        const sim = new Sim(pack, sc);
        const seen = new Set<number>();
        const lastArr = Math.max(...sc.spawns.filter((s) => s.kind === 'arr').map((s) => s.t));
        while (sim.t <= lastArr + 1) {
          sim.step();
          for (const a of sim.aircraft) {
            if (seen.has(a.id)) continue;
            seen.add(a.id);
            if (a.kind !== 'arr') continue;
            for (const o of sim.aircraft) {
              if (o === a || o.kind !== 'arr' || (o.proc ?? 'DIVERT') !== (a.proc ?? 'DIVERT')) continue;
              if (Math.abs(sim.ftOf(o.cleared) - sim.ftOf(a.cleared)) >= 1000) continue;
              expect(dist(o.p, a.p), `${tpl} seed ${seed}: ${a.cs} handed over behind ${o.cs}`).toBeGreaterThanOrEqual(10);
            }
          }
        }
      }
    }
  });

  it('departures are at least 2 min behind the same SID or a heavier one, otherwise 60 s', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sc = freePlay(pack, opts('shift', seed));
      const deps = sc.spawns.filter((s) => s.kind === 'dep').sort((a, b) => a.t - b.t);
      for (let i = 0; i < deps.length; i++) for (let j = 0; j < i; j++) {
        const a = deps[j], b = deps[i];
        const need = a.sid === b.sid || PERF[a.type].recat < PERF[b.type].recat ? 120 : 60;
        expect(b.t - a.t, `${a.cs} -> ${b.cs}`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it('the first arrival is already calling at t=2, and the session cap is 15 min after the last spawn (25 after a last arrival)', () => {
    for (const tpl of ['night', 'day', 'quiet', 'shift'] as const) {
      const sc = freePlay(pack, opts(tpl, 42, 45));
      const first = [...sc.spawns].sort((a, b) => a.t - b.t)[0];
      expect(first.t).toBeLessThanOrEqual(2);
      expect(first.callNow).toBe(true);
      const last = Math.max(...sc.spawns.map((s) => s.t));
      expect(sc.durationMin * 60 - last).toBeGreaterThanOrEqual(15 * 60);
      expect(sc.durationMin * 60 - last).toBeLessThanOrEqual(26 * 60);
      expect(sc.briefing).toMatch(/inbound/);
    }
  });

  it('the shift has its peak in the bank and departures in the crossover', () => {
    let warm = 0, bank = 0, depBank = 0, depLate = 0;
    const W = 60 * 60;
    for (let seed = 1; seed <= 20; seed++) {
      const sc = freePlay(pack, { ...opts('shift', seed), emergencies: false });
      const ph = (n: string) => shiftPhases(W).find((p) => p.name === n)!;
      for (const s of sc.spawns) {
        const x = s.t / W;
        if (s.kind === 'arr' && s.t > 2 && x < ph('warmup').to) warm++;
        if (s.kind === 'arr' && x >= ph('bank').from && x < ph('bank').to) bank++;
        if (s.kind === 'dep' && x < ph('bank').to) depBank++;
        if (s.kind === 'dep' && x >= ph('crossover').from) depLate++;
      }
    }
    const P = shiftPhases(W);
    const warmRate = warm / (P[0].to * 20), bankRate = bank / ((P[1].to - P[1].from) * 20);
    expect(bankRate).toBeGreaterThan(2 * warmRate);
    expect(depLate).toBeGreaterThan(3 * depBank);
    // the warm-up is short: the bank starts within 4 minutes, so the first quarter hour is busy
    expect(P[1].from * W).toBeLessThanOrEqual(240);
  });

  it('the shift draws events from the deck and briefs them', () => {
    const sc = freePlay(pack, opts('shift', 7));
    expect(sc.briefing).toMatch(/^Night shift\. \d+ inbound, \d+ out\. Runway 22L\. Wave peaks around \d\d:\d\dZ/);
    const marks = sc.events.length + sc.spawns.filter((s) => s.goAroundAt || s.unfamiliar || s.kind === 'mil' || s.kind === 'heli' || s.kind === 'vfr').length;
    expect(marks).toBeGreaterThanOrEqual(4);
  });

  it('dailyShift is deterministic by date', () => {
    const a = dailyShift(pack, new Date(2026, 9, 13));
    const b = dailyShift(pack, new Date(2026, 9, 13, 18, 30));
    const c = dailyShift(pack, new Date(2026, 9, 14));
    expect(a.title).toBe('Daily shift 13 Oct');
    expect(a.id).toBe('daily-20261013');
    expect(a.seed).toBe(20261013);
    expect(b.spawns).toEqual(a.spawns);
    expect(b.events).toEqual(a.events);
    expect(c.spawns).not.toEqual(a.spawns);
    const last = Math.max(...a.spawns.map((s) => s.t));
    expect(last).toBeLessThanOrEqual(27 * 60);
    expect(a.briefing).toMatch(/^Daily shift\./);
  });

  it('the autopilot completes a free-play shift', () => {
    const sc = freePlay(pack, { ...opts('shift', 3, 45), emergencies: false });
    const sim = new Sim(pack, sc);
    while (!sim.ended) { sim.step(); autoControl(sim); }
    expect(sim.ended).toBe(true);
    expect(sim.landings.length).toBeGreaterThanOrEqual(Math.floor(sim.arrivalsSpawned * 0.6));
    const r = assess(sim);
    expect(r.grade).toBeTypeOf('string');
  });
});

describe('challenges', () => {
  it('every challenge starts hot and is capped 15 to 30 min after its last spawn', () => {
    for (const sc of CHALLENGES) {
      const first = [...sc.spawns].sort((a, b) => a.t - b.t)[0];
      expect(first.t, sc.id).toBeLessThanOrEqual(5);
      expect(first.callNow, sc.id).toBe(true);
      const last = Math.max(...sc.spawns.map((s) => s.t));
      expect(sc.durationMin * 60 - last, sc.id).toBeLessThanOrEqual(31 * 60);
      expect(handoverViolations(pack, sc.spawns), sc.id).toEqual([]);
    }
  });
  it('ids are stable and the new ones exist', () => {
    const ids = CHALLENGES.map((c) => c.id);
    for (const id of ['first-freighter', 'trombone', 'cross-streams', 'night-bank', 'first-release', 'half-bank', 'night-bank-full', 'smoke']) expect(ids).toContain(id);
    expect(CHALLENGES.find((c) => c.id === 'night-bank')!.spawns.filter((s) => s.kind === 'arr').length).toBe(10);
    expect(CHALLENGES.find((c) => c.id === 'night-bank-full')!.spawns.filter((s) => s.kind === 'arr').length).toBe(14);
    expect(CHALLENGES.find((c) => c.id === 'smoke')!.objectives?.[0].text).toMatch(/^Land ETH3721 within 12:00$/);
  });
  it('a tier opens only when every challenge of the previous tier is passed', () => {
    const t1 = CHALLENGES.filter((c) => c.tier === 1).map((c) => c.id);
    expect([...unlockedTiers(new Set(t1.slice(1)))]).toEqual([1]);
    expect([...unlockedTiers(new Set(t1))]).toEqual([1, 2]);
  });
  it('the autopilot passes Tier 1', () => {
    for (const sc of CHALLENGES.filter((c) => c.tier === 1)) {
      const sim = new Sim(pack, sc);
      while (!sim.ended) { sim.step(); autoControl(sim); }
      expect(assess(sim).pass?.ok, sc.id).toBe(true);
    }
  });
});

function tiny(spawns: SpawnSpec[], min = 30): Scenario {
  return { id: 'test', title: 'test', desc: '', seed: 11, durationMin: min, startUtc: '02:00', metar: 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG', runway: '22L', spawns, events: [], readbackErr: 0, noSayAgain: true };
}
function finished(): Sim {
  const sim = new Sim(pack, CHALLENGES.find((c) => c.id === 'first-freighter')!);
  while (!sim.ended) { sim.step(); autoControl(sim); }
  return sim;
}

describe('grades and live stats', () => {
  it('grades a synthetic run', () => {
    const sim = finished();
    // force the inputs of each grade step
    sim.responseTimes = [2, 3];
    sim.spacing = [];
    sim.events = sim.events.filter((e) => e.kind !== 'stca' && e.cost === 0);
    (sim.landings[0] as any).levelOffs = 0;
    (sim.landings[0] as any).holdSec = 0;
    let r = assess(sim);
    expect(r.grade).toBe('rated');
    expect(r.gradeNotes).toEqual([]);
    sim.responseTimes = [9, 9];
    r = assess(sim);
    expect(r.grade).toBe('good');
    expect(r.gradeNotes.join(' ')).toMatch(/5 seconds/);
    sim.spacing = [{ leader: 'A', follower: 'B', gap: 6, min: 3 }];
    r = assess(sim);
    expect(r.grade).toBe('pass');
    expect(r.gradeNotes.join(' ')).toMatch(/spacing/);
    sim.events.push({ t: 100, kind: 'los', cs: 'A', cs2: 'B', comp: 'SEPC', sev: 'serious', text: 'Loss of separation A / B: 1.0 NM, 100 ft', cost: 150 } as SimEvent);
    r = assess(sim);
    expect(r.grade).toBe('fail');
  });

  it('collapses repeated alerts between the same pair and caps the list at three', () => {
    const sim = finished();
    for (let i = 0; i < 5; i++) sim.events.push({ t: 100 + i * 20, kind: 'los', cs: 'A', cs2: 'B', comp: 'SEPC', sev: 'minor', text: 'Loss of separation A / B: 2.8 NM, 300 ft', cost: 45 } as SimEvent);
    for (let i = 0; i < 4; i++) sim.events.push({ t: 90 + i * 20, kind: 'stca', cs: i % 2 ? 'B' : 'A', cs2: i % 2 ? 'A' : 'B', comp: 'SITU', sev: 'minor', text: 'STCA A / B', cost: 15 } as SimEvent);
    sim.events.push({ t: 300, kind: 'unanswered', cs: 'C', comp: 'WORK', sev: 'minor', text: 'C: call unanswered for 25 s', cost: 10 } as SimEvent);
    sim.events.push({ t: 400, kind: 'late_xfr', cs: 'D', comp: 'CORD', sev: 'minor', text: 'D: transferred to Tower late (3.1 NM)', cost: 12 } as SimEvent);
    const r = assess(sim);
    expect(r.costliest.length).toBe(3);
    expect(r.costliest[0].kind).toBe('los');
    expect(r.costliest[0].count).toBe(5);
    expect(r.costliest.filter((c) => c.kind === 'los').length).toBe(1);
    expect(r.costliest[1].kind).toBe('stca');
    expect(r.evidence.SEPC).toMatch(/^1 losses of separation/);
    for (const c of r.costliest) expect(c.why.length).toBeGreaterThan(20);
  });

  it('competencies with no evidence are n/a, and unanswered calls with no answers rate workload 1', () => {
    const sim = new Sim(pack, tiny([{ t: 2, kind: 'arr', cs: 'TST1', type: 'B744', star: 'KOK7X', spawnDist: 40, callNow: true }], 3));
    while (!sim.ended) sim.step();
    const r = assess(sim);
    expect(r.ratings.SITU).toBeNull();
    expect(r.ratings.CORD).toBeNull();
    expect(r.ratings.SEPC).toBeNull();
    expect(r.ratings.WORK).toBe(1);
  });

  it('includes aircraft still airborne in the fuel figure', () => {
    const sim = new Sim(pack, tiny([{ t: 2, kind: 'arr', cs: 'TST1', type: 'B744', star: 'KOK7X', spawnDist: 40 }], 30));
    while (sim.t < 600) sim.step();
    const ac = sim.find('TST1')!;
    ac.flownNm += 30; // pretend it flew a long detour
    sim.finish();
    const fuel = assess(sim).metrics.find((m) => m.key === 'fuel')!;
    expect(fuel.raw!).toBeGreaterThan(500);
  });

  it('seqChain counts tight landings and breaks on a big gap or a go-around', () => {
    const sim = new Sim(pack, tiny([], 5));
    const land = (cs: string, t: number, excess?: number) => {
      sim.landings.push({ cs, type: 'B744', t, spawnT: 0, flownNm: 0, baselineNm: 0, holdSec: 0, levelOffs: 0, fuelKg: 0, goArounds: 0 });
      if (excess !== undefined) sim.spacing.push({ leader: cs, follower: 'X', gap: 4 + excess, min: 4 });
    };
    land('A', 100, 0.3); land('B', 200, 0.5); land('C', 300, 1.0); land('D', 400, 0.2);
    expect(seqChain(sim)).toMatchObject({ current: 3, best: 3, lastGap: { gap: 4.2, min: 4 } });
    sim.events.push({ t: 450, kind: 'goaround', cs: 'E', comp: 'TRAF', sev: 'major', text: 'E: go-around, unstable approach', cost: 35 });
    land('F', 500, 0.1);
    expect(seqChain(sim)).toMatchObject({ current: 1, best: 3 });
    land('G', 600, 2.0);
    expect(seqChain(sim)).toMatchObject({ current: 0, best: 3 });
  });

  it('liveStats reports holding and fuel burn', () => {
    const sim = new Sim(pack, tiny([{ t: 2, kind: 'arr', cs: 'TST1', type: 'B744', star: 'KOK7X', spawnDist: 20, callNow: true }], 40));
    while (sim.t < 900 && !sim.find('TST1')?.hold) sim.step();
    const s = liveStats(sim);
    expect(s.holding).toBe(1);
    expect(s.fuelBurnKgPerMin).toBeGreaterThan(100);
    expect(s.delayMin).toBeGreaterThanOrEqual(0);
    expect(s.landed).toBe(0);
  });
});

describe('cause chains', () => {
  const assumed = (sim: Sim, cs: string) => { while (sim.find(cs)?.state !== 'assumed') sim.step(); };

  it('explains an unstable go-around caused by a level that cancelled the transition restrictions', () => {
    const sim = new Sim(pack, tiny([{ t: 2, kind: 'arr', cs: 'TST1', type: 'B744', star: 'KOK7X', spawnDist: 20, callNow: true }], 40));
    track(sim);
    assumed(sim, 'TST1');
    sim.issue({ cs: 'TST1', items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'app', app: 'ILS', rwy: '22L' }] });
    for (let i = 0; i < 30; i++) sim.step();
    sim.issue({ cs: 'TST1', items: [{ k: 'lvl', lvl: { ft: 6000 } }] });
    while (!sim.ended && !sim.events.some((e) => e.kind === 'goaround')) sim.step();
    sim.finish();
    const r = assess(sim);
    const ga = r.costliest.find((c) => c.kind === 'goaround')!;
    expect(ga).toBeTruthy();
    expect(ga.why).toMatch(/^Your 6,000 ft at 02:0\d cancelled the ALHUV1A level restrictions/);
    expect(ga.why).toMatch(/ft above the glidepath/);
    expect(ga.why).not.toMatch(/\b(SEPC|TRAF|STCA|MVA|LoS)\b/);
  });

  it('explains a forced (Tower) go-around', () => {
    const sc = CHALLENGES.find((c) => c.id === 'go-around')!;
    const sim = new Sim(pack, sc);
    track(sim);
    while (!sim.ended && !sim.events.some((e) => e.kind === 'goaround')) { sim.step(); autoControl(sim); }
    const ev = sim.events.find((e) => e.kind === 'goaround')!;
    expect(ev.text).toMatch(/Tower/);
    for (let i = 0; i < 60; i++) { sim.step(); autoControl(sim); }
    expect(explain(sim, ev)).toMatch(/^Tower sent AZG7321 around; that was not your call/);
  });
});
