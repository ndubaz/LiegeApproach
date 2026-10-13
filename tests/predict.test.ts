import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import { predict } from '../src/engine/predict';
import { angDiff, crossTrack, dist, move } from '../src/geo';
import type { Scenario } from '../src/engine/types';

const pack = loadPack(EBLG);
const sc: Scenario = {
  id: 't', title: 't', desc: '', seed: 3, durationMin: 30, startUtc: '02:00', metar: 'EBLG 120140Z 00000KT 9999 FEW035 12/07 Q1013 NOSIG', runway: '22L',
  spawns: [{ t: 1, kind: 'arr', cs: 'TST1', type: 'B744', star: pack.stars.find((s) => s.runways.includes('22L'))!.name, spawnDist: 40 }], events: [], readbackErr: 0,
};
function setup() {
  const sim = new Sim(pack, sc);
  sim.step(); sim.step();
  const ac = sim.find('TST1')!;
  return { sim, ac };
}

describe('predict', () => {
  it('flies straight on a steady heading and does not touch the real aircraft', () => {
    const { sim, ac } = setup();
    ac.mode = 'HDG'; ac.hdg = 90; ac.hdgAssigned = 90; ac.turnDir = undefined; ac.alt = 6000; ac.tgtAlt = 6000; ac.vs = 0; ac.ias = 220; ac.spdAssigned = 220; ac.app = undefined; ac.p = { x: 0, y: 20 };
    const before = JSON.stringify(ac);
    const pts = predict(sim, ac, 120);
    expect(JSON.stringify(ac)).toBe(before);
    expect(pts.length).toBe(24);
    expect(pts[0].t).toBe(5);
    const last = pts[pts.length - 1];
    expect(Math.abs(last.p.y - 20)).toBeLessThan(0.05);
    expect(last.p.x).toBeGreaterThan(7);
    expect(Math.abs(last.alt - 6000)).toBeLessThan(1);
  });

  it('draws an arc for a heading change', () => {
    const { sim, ac } = setup();
    ac.mode = 'HDG'; ac.hdg = 0; ac.hdgAssigned = 90; ac.turnDir = 'R'; ac.alt = 6000; ac.tgtAlt = 6000; ac.vs = 0; ac.ias = 220; ac.app = undefined; ac.p = { x: 0, y: 20 };
    const pts = predict(sim, ac, 90);
    const hdgs = pts.map((p) => p.hdg);
    expect(hdgs[0]).toBeGreaterThan(5);
    expect(Math.abs(angDiff(hdgs[hdgs.length - 1], 90))).toBeLessThan(1);
    // the turn bends the path: midpoint is off the chord
    const a = { x: 0, y: 20 }, b = pts[pts.length - 1].p, m = pts[Math.floor(pts.length / 3)].p;
    expect(Math.abs(crossTrack(m, a, Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI))).toBeGreaterThan(0.2);
  });

  it('marks the level-off point', () => {
    const { sim, ac } = setup();
    ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg; ac.alt = 8000; ac.tgtAlt = 5000; ac.vs = -1500; ac.app = undefined;
    const pts = predict(sim, ac, 240);
    const lo = pts.find((p) => p.event === 'leveloff');
    expect(lo).toBeDefined();
    expect(Math.abs(lo!.alt - 5000)).toBeLessThan(50);
    expect(lo!.t).toBeGreaterThan(60);
    expect(lo!.t).toBeLessThan(200);
  });

  it('predicts the localizer capture on an intercept heading', () => {
    const { sim, ac } = setup();
    const r = sim.rwy;
    // 18 NM final, 3 NM right of the centreline, 30 degree intercept, below the glidepath
    const onFinal = move(r.thr, r.crs + 180, 18);
    ac.p = move(onFinal, r.crs + 90, 3);
    ac.hdg = (r.crs - 30 + 360) % 360; ac.hdgAssigned = ac.hdg; ac.turnDir = undefined; ac.mode = 'HDG';
    ac.alt = 3000; ac.tgtAlt = 3000; ac.vs = 0; ac.ias = 180; ac.spdAssigned = 180;
    ac.app = { type: 'ILS', rwy: r, locCap: false, gsCap: false };
    const real = { ...ac.p };
    const pts = predict(sim, ac, 300);
    const loc = pts.find((p) => p.event === 'loc');
    expect(loc).toBeDefined();
    expect(loc!.locCap).toBe(true);
    expect(pts.some((p) => p.event === 'gs')).toBe(true);
    expect(ac.app.locCap).toBe(false);
    expect(dist(ac.p, real)).toBe(0);
  });

  it('gives the same picture with a coarser integration step', () => {
    const { sim, ac } = setup();
    const r = sim.rwy;
    ac.p = move(move(r.thr, r.crs + 180, 18), r.crs + 90, 3);
    ac.hdg = (r.crs - 30 + 360) % 360; ac.hdgAssigned = ac.hdg; ac.turnDir = undefined; ac.mode = 'HDG';
    ac.alt = 4000; ac.tgtAlt = 3000; ac.vs = 0; ac.ias = 180; ac.spdAssigned = 180;
    ac.app = { type: 'ILS', rwy: r, locCap: false, gsCap: false };
    const a = predict(sim, ac, 120, 5), b = predict(sim, ac, 120, 5, undefined, 2.5);
    const pa = a.filter((q) => q.t % 5 === 0), pb = b.filter((q) => q.t % 5 === 0);
    expect(pb.length).toBe(pa.length);
    expect(dist(pa[pa.length - 1].p, pb[pb.length - 1].p)).toBeLessThan(0.3);
    expect(b.some((q) => q.event === 'loc')).toBe(a.some((q) => q.event === 'loc'));
  });

  it('is fast enough for 20 aircraft every radar refresh', () => {
    const { sim, ac } = setup();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) predict(sim, ac, 120);
    expect(performance.now() - t0).toBeLessThan(80);
  });
});
