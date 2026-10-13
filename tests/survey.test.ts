import { it } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import { CHALLENGES } from '../src/engine/scenarios';
import { assess } from '../src/engine/assess';
import { autoControl } from './auto';
const pack = loadPack(EBLG);
it.skipIf(!(globalThis as any).process?.env?.SURVEY)('survey', () => {
  for (const sc of CHALLENGES) {
    const sim = new Sim(pack, sc);
    while (!sim.ended) { sim.step(); autoControl(sim); }
    const r = assess(sim);
    const kinds: Record<string, number> = {};
    for (const e of sim.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    console.log(`${sc.id.padEnd(18)} landed ${sim.landings.length}/${sim.arrivalsSpawned} gate=${r.gate.pass} pass=${r.pass?.ok} grade=${r.grade} seq=${r.seqBest} ${JSON.stringify(kinds)}`);
  }
});
