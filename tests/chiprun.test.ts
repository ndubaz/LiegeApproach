import { it } from 'vitest';
import { loadPackById } from '../src/pack/index';
import { Sim } from '../src/engine/sim';
import { freePlay } from '../src/engine/traffic';
import { chipBot, sepCounts } from './chipbot';

// Survey: a player who only taps primary chips, ten night shifts. Run with SURVEY=1.
const env = (globalThis as any).process?.env ?? {};
// AIRPORT=EDDL surveys a Düsseldorf afternoon instead of the Liège night shift
const pack = loadPackById(env.AIRPORT ?? 'EBLG');
const eddl = pack.meta.icao === 'EDDL';
it.skipIf(!env.SURVEY)('chip-only bot survey', () => {
  const n = Number(env.SEEDS_N ?? 10);
  for (const advice of env.ADVICE_ONLY ? [true] : [false, true]) {
    const tot = { los: 0, wake: 0, ga: 0, landed: 0, arr: 0 };
    for (let seed = 1; seed <= n; seed++) {
      const sc = freePlay(pack, eddl ? { template: 'day', durationMin: 60, military: 1, weather: 'good', emergencies: false, difficulty: 2, seed, startHour: 15 } : { template: 'shift', durationMin: 60, military: 1, weather: 'good', emergencies: false, difficulty: 2, seed });
      const sim = new Sim(pack, sc);
      while (!sim.ended) { chipBot(sim, advice); sim.step(); }
      const c = sepCounts(sim);
      if (env.CHIPV) console.log(seed, JSON.stringify(c), sim.events.filter((e) => e.kind === 'los' || e.kind === 'wake' || e.kind === 'goaround').map((e) => `${Math.round(e.t)} ${e.text}`).join(' | '));
      for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += c[k];
    }
    console.log(advice ? 'release advice' : 'blind release', 'TOTAL', JSON.stringify(tot));
  }
}, 3600000);
