import { describe, expect, it } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import { LESSONS } from '../src/ui/tutorial';
import { crossTrack } from '../src/geo';
import type { Item } from '../src/engine/clearance';

// Fly each tutorial lesson the way the coach tells a student to, and check the
// lesson geometry gives a clean result: everyone lands, nothing costs points.
const pack = loadPack(EBLG);
const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
const calling = (sim: Sim, cs: string) => { const a = sim.find(cs); return !!a && a.awaitingSince !== undefined && sim.t > a.awaitingSince + 2; };
function fly(id: string, script: (sim: Sim, say: (cs: string, items: Item[]) => void, once: (k: string, c: boolean) => boolean) => void, until: (s: Sim) => boolean) {
  const sim = new Sim(pack, lesson(id).scenario);
  const did = new Set<string>();
  const once = (k: string, c: boolean) => (c && !did.has(k) ? (did.add(k), true) : false);
  const say = (cs: string, items: Item[]) => sim.issue({ cs, items });
  while (sim.t < 1500 && !until(sim)) {
    sim.step();
    script(sim, say, once);
    for (const c of sim.aircraft) if (c.kind === 'arr' && c.app?.locCap && sim.dthr(c) < 10 && once('twr' + c.cs, true)) say(c.cs, [{ k: 'spd', spd: 160 }, { k: 'xfr', unit: 'TWR' }]);
  }
  return sim;
}
const penalties = (sim: Sim) => sim.events.filter((e) => e.cost > 0).map((e) => e.text);
const ILS: Item = { k: 'app', app: 'ILS', rwy: '22L' };

describe('tutorial lessons fly clean', () => {
  it('vectors: downwind, base, 30° intercept', () => {
    const r = pack.runways.get('22L')!;
    const sim = fly('vectors', (sim, say, once) => {
      const a = sim.find('CHG201'); if (!a) return;
      if (once('dw', calling(sim, 'CHG201'))) say('CHG201', [{ k: 'hdg', hdg: 45, dir: 'L' }, { k: 'lvl', lvl: { fl: 60 } }]);
      if (once('lo', sim.t > 45)) say('CHG201', [{ k: 'lvl', lvl: { ft: 3000 } }, { k: 'spd', spd: 210 }]);
      if (once('base', sim.t > 60 && sim.dthr(a) > 11)) say('CHG201', [{ k: 'hdg', hdg: 135, dir: 'R' }]);
      if (once('icpt', sim.t > 60 && Math.abs(crossTrack(a.p, r.thr, r.crs)) < 2.2)) say('CHG201', [{ k: 'hdg', hdg: 195, dir: 'R' }, ILS]);
    }, (s) => s.landings.length > 0);
    expect(sim.landings.map((l) => l.cs)).toEqual(['CHG201']);
    expect(penalties(sim)).toEqual([]);
  });

  it('transitions: one via ALHUV1A, one held then released', () => {
    const sim = fly('transitions', (sim, say, once) => {
      if (once('a', calling(sim, 'AZG7321'))) say('AZG7321', [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS]);
      if (once('q', calling(sim, 'QTR8152'))) say('QTR8152', [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 5000 } }]);
      if (once('rel', !!sim.find('AZG7321')?.app?.locCap && sim.find('QTR8152')?.mode === 'HOLD')) say('QTR8152', [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS]);
    }, (s) => s.landings.length >= 2);
    expect(sim.landings.length).toBe(2);
    expect(penalties(sim)).toEqual([]);
  });

  it('spacing: 180 kt keeps the 767 just outside 4 NM; no action infringes', () => {
    const run = (spd?: number) => fly('spacing', (sim, say, once) => {
      if (once('c', calling(sim, 'CLX7HK'))) say('CLX7HK', [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS]);
      if (once('t', calling(sim, 'TAY4EK'))) say('TAY4EK', [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS]);
      const a = sim.find('CLX7HK'), b = sim.find('TAY4EK');
      if (spd && once('s', !!a?.app?.locCap && !!b && sim.dthr(b) < 16)) say('TAY4EK', [{ k: 'spd', spd }]);
    }, (s) => s.landings.length >= 2);
    const good = run(180);
    const gap = good.spacing.find((s) => s.leader === 'CLX7HK')!;
    expect(gap.gap).toBeGreaterThanOrEqual(4);
    expect(gap.gap).toBeLessThan(5);
    expect(penalties(good)).toEqual([]);
    expect(run().events.some((e) => e.kind === 'wake')).toBe(true);
  });
});
