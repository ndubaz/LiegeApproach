import { describe, expect, it } from 'vitest';
import { loadPackById } from '../src/pack/index';
import { Sim } from '../src/engine/sim';
import { challengesFor } from '../src/engine/scenarios';
import { checkridesFor } from '../src/engine/career';
import { drillsFor, drillScenario, drillSolver } from '../src/engine/drills';
import { autoControl } from '../src/engine/autopilot';
import { freePlay } from '../src/engine/traffic';
import { assess } from '../src/engine/assess';

const pack = loadPackById('EDDL');
const run = (sim: Sim, ctl: (s: Sim) => void, maxS = 4 * 3600) => { while (!sim.ended && sim.t < maxS) { ctl(sim); sim.step(); } return sim; };
const banned = /Liège|Brussels|ALHUV|Beek|Steenokkerzeel|\bTSA\b/;

describe('Düsseldorf content', () => {
  it('has 12 challenges in four tiers, 4 checkrides and 8 drills, all for EDDL', () => {
    const ch = challengesFor('EDDL');
    expect(ch.length).toBe(12);
    expect(new Set(ch.map((c) => c.tier))).toEqual(new Set([1, 2, 3, 4]));
    expect(ch.every((c) => c.icao === 'EDDL' && c.briefing && c.pass)).toBe(true);
    expect(checkridesFor('EDDL').length).toBe(4);
    expect(drillsFor('EDDL').length).toBe(8);
  });

  it('every challenge runs to the end under the autopilot, in Düsseldorf words', () => {
    for (const sc of challengesFor('EDDL')) {
      const sim = run(new Sim(pack, sc), autoControl);
      expect(sim.ended, sc.id).toBe(true);
      const said = sim.log.filter((t) => t.from !== 'SYS').map((t) => t.text).join('\n');
      expect(said.match(banned)?.[0], `${sc.id} says a Liège name`).toBeUndefined();
      expect(() => assess(sim), sc.id).not.toThrow();
    }
  });

  it('every checkride runs to the end under the autopilot', () => {
    for (const r of checkridesFor('EDDL')) expect(run(new Sim(pack, r.scenario), autoControl).ended, r.id).toBe(true);
  });

  it('every drill passes with its own solver', () => {
    for (const d of drillsFor('EDDL')) {
      const sim = new Sim(pack, drillScenario(pack, d.id as any, 1));
      const solve = drillSolver(d);
      run(sim, solve, 3600);
      expect(sim.ended, d.id).toBe(true);
    }
  });
});

describe('Düsseldorf operations', () => {
  const day = (seed: number, startHour: number) => freePlay(pack, { template: 'day', durationMin: 60, military: 0, weather: 'good', emergencies: false, difficulty: 3, seed, startHour });

  it('the night curfew: no scheduled traffic between 22:00 and 06:00 local', () => {
    const sc = freePlay(pack, { template: 'quiet', durationMin: 60, military: 0, weather: 'good', emergencies: false, difficulty: 2, seed: 4, startHour: 0 });
    const sched = sc.spawns.filter((s) => s.kind === 'arr' || s.kind === 'dep');
    expect(sched.length).toBeLessThanOrEqual(2);
  });

  it('a daytime hour is busy, holds only where a hold is published or described, and calls the departures to Langen Radar', () => {
    const sim = run(new Sim(pack, day(7, 15)), autoControl, 3600);
    expect(sim.landings.length + sim.departuresHandled).toBeGreaterThan(10);
    const said = sim.log.map((t) => t.text).join('\n');
    expect(said).toMatch(/Langen/);
    expect(said.match(banned)?.[0]).toBeUndefined();
    // a hold the AD section publishes ("as published"), or one ATC describes: inbound track and turns
    for (const t of sim.log.filter((x) => x.from === 'ATC' && /hold at (\w+)/.test(x.text))) {
      const h = t.text.match(/hold at (\w+)/)![1];
      const spec = pack.holds.find((x) => x.fix === h);
      expect((!!spec && spec.published !== false) || /inbound track \d{3}/.test(t.text), t.text).toBe(true);
    }
  });

  it('the supervisor announces a shift plan at the start', () => {
    const sim = new Sim(pack, day(3, 15));
    while (sim.t < 10) sim.step();
    expect(sim.log.some((t) => t.from === sim.sup.id && /Shift plan/.test(t.text))).toBe(true);
  });

  it('segregated parallel operations land on one runway and depart from its parallel', () => {
    const sc = challengesFor('EDDL').find((c) => c.events.some((e) => e.kind === 'parallel'));
    expect(sc, 'a challenge with the second runway').toBeTruthy();
    const sim = new Sim(pack, sc!);
    let seen = false;
    while (!sim.ended && sim.t < 3 * 3600) {
      autoControl(sim); sim.step();
      if (sim.inParallelOps) {
        seen = true;
        expect(sim.depRunway).not.toBe(sim.runway);
        for (const r of sim.releases.filter((x) => x.state === 'pending')) expect(r.rwy).toBe(sim.depRunway);
      }
    }
    expect(seen).toBe(true);
  });
});
