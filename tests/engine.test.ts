import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import type { Scenario, SpawnSpec } from '../src/engine/types';
import { CHALLENGES } from '../src/engine/scenarios';
import { assess } from '../src/engine/assess';
import { autoControl } from './auto';

const pack = loadPack(EBLG);
const metar = (rwy: string) => (rwy.startsWith('22') ? 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG' : 'EBLG 120140Z 04008KT 9999 FEW035 12/07 Q1018 NOSIG');

function scenario(rwy: string, spawns: SpawnSpec[], min = 40): Scenario {
  return { id: 'test', title: 'test', desc: '', seed: 7, durationMin: min, startUtc: '02:00', metar: metar(rwy), runway: rwy, spawns, events: [], readbackErr: 0 };
}

function run(sim: Sim, maxS: number) {
  while (!sim.ended && sim.t < maxS) { sim.step(); autoControl(sim); }
}

describe('procedure fly-through', () => {
  for (const star of pack.stars) {
    for (const rwy of star.runways.filter((r) => pack.runways.get(r)!.ils && !pack.runways.get(r)!.contingency)) {
      it(`${star.name} + transition + ILS ${rwy} lands clean`, () => {
        const sim = new Sim(pack, scenario(rwy, [{ t: 1, kind: 'arr', cs: 'TST1', type: 'B744', star: star.name, spawnDist: 40 }]));
        run(sim, 40 * 60);
        const bad = sim.events.filter((e) => e.cost > 0);
        expect(bad.map((e) => e.text)).toEqual([]);
        expect(sim.landings.length).toBe(1);
      });
    }
  }
  for (const sid of pack.sids) {
    it(`${sid.name} departure climbs and is transferred`, () => {
      const rwy = sid.runways[0];
      const sim = new Sim(pack, scenario(rwy, [{ t: 1, kind: 'dep', cs: 'TST2', type: 'B77L', sid: sid.name }], 20));
      run(sim, 20 * 60);
      const bad = sim.events.filter((e) => e.cost > 0);
      expect(bad.map((e) => e.text)).toEqual([]);
      expect(sim.departuresHandled).toBe(1);
    });
  }
});

describe('determinism and replay', () => {
  it('the same seed and commands give identical results', () => {
    const sc = CHALLENGES.find((c) => c.id === 'trombone')!;
    const a = new Sim(pack, sc);
    run(a, 900);
    const b = new Sim(pack, sc);
    let i = 0;
    while (b.t < 900) {
      while (i < a.cmdLog.length && a.cmdLog[i].t === b.t) b.issue(a.cmdLog[i++].cl);
      b.step();
    }
    expect(b.aircraft.map((x) => [x.cs, x.p.x.toFixed(4), x.alt.toFixed(1)])).toEqual(a.aircraft.map((x) => [x.cs, x.p.x.toFixed(4), x.alt.toFixed(1)]));
  });
});

describe('challenges run headless', () => {
  for (const sc of CHALLENGES) {
    it(`${sc.id} runs to completion and assesses`, () => {
      const sim = new Sim(pack, sc);
      run(sim, sc.durationMin * 60 + 5);
      const r = assess(sim);
      expect(r.metrics.length).toBeGreaterThan(5);
      expect(sim.ended).toBe(true);
    });
  }
});

describe('separation monitor', () => {
  it('flags a head-on loss of separation', () => {
    const spawns: SpawnSpec[] = [
      { t: 1, kind: 'ovf', cs: 'AAA1', type: 'A320', route: ['ALHUV', 'LG008'], from: { brg: 90, dist: 8 }, level: { fl: 80 } },
      { t: 1, kind: 'ovf', cs: 'BBB2', type: 'A320', route: ['ALHUV', 'GIKLI'], from: { brg: 270, dist: 8 }, level: { fl: 80 } },
    ];
    const sim = new Sim(pack, scenario('22L', spawns, 5));
    while (!sim.ended) sim.step();
    expect(sim.events.some((e) => e.kind === 'los')).toBe(true);
    expect(sim.events.some((e) => e.kind === 'stca')).toBe(true);
  });
});
