import { it, expect } from 'vitest';
import { holdEntry } from '../src/engine/pilot';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
it('Doc 8168 entry sectors', () => {
  // right-hand hold, inbound 360
  expect(holdEntry(10, 360, 'R')).toBe('direct');
  expect(holdEntry(150, 360, 'R')).toBe('teardrop');
  expect(holdEntry(230, 360, 'R')).toBe('parallel');
  // left-hand hold mirrors it
  expect(holdEntry(210, 360, 'L')).toBe('teardrop');
  expect(holdEntry(130, 360, 'L')).toBe('parallel');
});
it('every STAR enters the ALHUV hold and stays in its protected area', () => {
  const pack = loadPack(EBLG);
  const h = pack.holds.find((x) => x.fix === 'ALHUV')!;
  expect(h.turn).toBe('L');
  for (const [star, cs] of [['KOK7X', 'A1'], ['LNO6X', 'A2'], ['NIK7X', 'A3'], ['GESLO6X', 'A4'], ['CIV7X', 'A5']] as const) {
    const sim = new Sim(pack, { id: 't', title: 't', desc: '', seed: 3, durationMin: 40, startUtc: '14:00', metar: 'EBLG 121400Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG', runway: '22L', spawns: [{ t: 1, kind: 'arr', cs, type: 'B744', star, spawnDist: 15, callNow: true }], events: [], readbackErr: 0, noSayAgain: true });
    let entry = '', maxD = 0, laps = 0, last = '';
    while (sim.t < 1500) { sim.step(); const a = sim.find(cs); if (!a) continue; if (a.awaitingSince !== undefined && sim.t > a.awaitingSince + 2 && !(a as any)._h) { (a as any)._h = 1; sim.issue({ cs, items: [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 5000 } }] }); }
      if (a.hold) { entry = a.hold.entry ?? entry; maxD = Math.max(maxD, Math.hypot(a.p.x - a.hold.p.x, a.p.y - a.hold.p.y)); if (a.hold.phase !== last) { if (a.hold.phase === 'turnOut') laps++; last = a.hold.phase; } } }
    expect(entry, star).not.toBe('');
    expect(laps, star).toBeGreaterThanOrEqual(3);
    expect(maxD).toBeLessThan(9);
  }
});
