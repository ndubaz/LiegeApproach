// Scope 2.0: label placement and geometry helpers (pure functions, no canvas).
import { describe, expect, it } from 'vitest';
import {
  boxEdgePoint, cornerLabelPoint, cpaLinear, interpFraction, labelCandidates, overlap, passesLevelFilter, segmentsCross, solveLabel, tailDot, timeToFix, type LabelInput,
} from '../src/ui/scope';
import { SKIN, SKIN_NAMES, skinFor, withAlpha } from '../src/ui/skins';

const bounds = { w: 1200, h: 800, top: 24 };
const base = (over: Partial<LabelInput> = {}): LabelInput => ({ s: { x: 600, y: 400 }, w: 80, h: 48, obstacles: [], symbols: [], leaders: [], vEnd: { x: 640, y: 400 }, bounds, priority: 5, ...over });

describe('geometry helpers', () => {
  it('overlap is the intersection area and zero when apart', () => {
    expect(overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(25);
    expect(overlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(0);
  });
  it('segmentsCross detects a proper crossing only', () => {
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBe(false);
    expect(segmentsCross({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 10 }, { x: 20, y: 0 })).toBe(false);
  });
  it('boxEdgePoint clamps the symbol onto the box', () => {
    expect(boxEdgePoint({ x: 0, y: 0 }, { x: 10, y: 20, w: 30, h: 10 })).toEqual({ x: 10, y: 20 });
    expect(boxEdgePoint({ x: 25, y: 100 }, { x: 10, y: 20, w: 30, h: 10 })).toEqual({ x: 25, y: 30 });
  });
  it('cpaLinear finds the meeting point of two converging tracks', () => {
    // A heads north from (0,-5) at 300 kt, B heads west from (5,0) at 300 kt: both reach the origin in one minute
    const r = cpaLinear({ p: { x: 0, y: -5 }, trk: 0, gs: 300 }, { p: { x: 5, y: 0 }, trk: 270, gs: 300 });
    expect(r.t).toBe(60);
    expect(r.d).toBeLessThan(0.01);
    expect(r.pa.x).toBeCloseTo(0, 3); expect(r.pa.y).toBeCloseTo(0, 3);
  });
  it('cpaLinear reports now for diverging tracks', () => {
    const r = cpaLinear({ p: { x: 0, y: 0 }, trk: 0, gs: 250 }, { p: { x: 0, y: -10 }, trk: 180, gs: 250 });
    expect(r.t).toBe(0);
    expect(r.d).toBeCloseTo(10, 5);
  });
  it('cornerLabelPoint sits inside the top-left corner of the polygon', () => {
    const poly = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 250 }, { x: 100, y: 250 }];
    const p = cornerLabelPoint(poly, 10);
    expect(p.x).toBeGreaterThan(100); expect(p.x).toBeLessThan(120);
    expect(p.y).toBeGreaterThan(100); expect(p.y).toBeLessThan(120);
  });
  it('interpFraction clamps to [0, 1] and handles a zero interval', () => {
    expect(interpFraction(2000, 4000)).toBe(0.5);
    expect(interpFraction(9000, 4000)).toBe(1);
    expect(interpFraction(-5, 4000)).toBe(0);
    expect(interpFraction(5, 0)).toBe(1);
  });
  it('passesLevelFilter treats open bounds as pass-all', () => {
    expect(passesLevelFilter(5000)).toBe(true);
    expect(passesLevelFilter(5000, { lo: 3000 })).toBe(true);
    expect(passesLevelFilter(2000, { lo: 3000 })).toBe(false);
    expect(passesLevelFilter(12000, { hi: 10000 })).toBe(false);
    expect(passesLevelFilter(7000, { lo: 3000, hi: 10000 })).toBe(true);
  });
  it('tailDot fades and thins toward the past', () => {
    const old = tailDot(0, 5), recent = tailDot(4, 5);
    expect(recent.alpha).toBeGreaterThan(old.alpha);
    expect(recent.r).toBeGreaterThan(old.r);
    expect(old.alpha).toBeGreaterThan(0);
  });
  it('timeToFix is distance over ground speed and undefined when stopped', () => {
    expect(timeToFix({ x: 0, y: 0 }, { x: 0, y: 10 }, 300)).toBeCloseTo(120, 5);
    expect(timeToFix({ x: 0, y: 0 }, { x: 0, y: 10 }, 0)).toBeUndefined();
  });
});

describe('label placement', () => {
  it('offers three rings of eight candidates', () => {
    const c = labelCandidates(80, 48);
    expect(c).toHaveLength(24);
    const leader = (dx: number, dy: number) => Math.hypot(Math.max(0, -dx - 80, dx), Math.max(0, -dy - 48, dy));
    // every ring sits further out than the one before
    expect(leader(...c[0])).toBeLessThan(leader(...c[8]));
    expect(leader(...c[8])).toBeLessThan(leader(...c[16]));
  });
  it('prefers the first ring (a short leader) when nothing is in the way', () => {
    const r = solveLabel(base());
    const idx = labelCandidates(80, 48).findIndex(([dx, dy]) => dx === r.dx && dy === r.dy);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(8);
  });
  it('never covers another aircraft symbol when an alternative exists', () => {
    const symbols = [{ x: 600, y: 400 }, { x: 640, y: 360 }, { x: 640, y: 440 }];
    const r = solveLabel(base({ symbols }));
    const box = { x: 600 + r.dx, y: 400 + r.dy, w: 80, h: 48 };
    for (const q of symbols.slice(1)) expect(overlap(box, { x: q.x - 7, y: q.y - 7, w: 14, h: 14 })).toBe(0);
  });
  it('moves away from an obstacle rather than overlapping it', () => {
    const obstacle = { x: 614, y: 328, w: 80, h: 48 }; // where the first candidate would land
    const r = solveLabel(base({ obstacles: [obstacle] }));
    expect(overlap({ x: 600 + r.dx, y: 400 + r.dy, w: 80, h: 48 }, obstacle)).toBe(0);
  });
  it('stays on screen for a track near the edge', () => {
    const r = solveLabel(base({ s: { x: 1190, y: 790 }, priority: 0 }));
    const box = { x: 1190 + r.dx, y: 790 + r.dy, w: 80, h: 48 };
    expect(box.x + box.w).toBeLessThanOrEqual(1200);
    expect(box.y + box.h).toBeLessThanOrEqual(800);
  });
  it('keeps the previous offset when the picture has not changed (hysteresis)', () => {
    const first = solveLabel(base());
    const alt = labelCandidates(80, 48)[3];
    const again = solveLabel(base({ prev: { dx: alt[0], dy: alt[1] } }));
    expect(again.dx).toBe(alt[0]); expect(again.dy).toBe(alt[1]);
    expect(first.cost).toBeLessThanOrEqual(again.cost + 90);
  });
  it('avoids crossing the leader line of a neighbour', () => {
    // neighbour at (560,400) with its label to the right, leader running east across our first candidates
    const leaders = [{ a: { x: 560, y: 400 }, b: { x: 700, y: 352 } }];
    const r = solveLabel(base({ leaders }));
    const e = boxEdgePoint({ x: 600, y: 400 }, { x: 600 + r.dx, y: 400 + r.dy, w: 80, h: 48 });
    expect(segmentsCross({ x: 600, y: 400 }, e, leaders[0].a, leaders[0].b)).toBe(false);
  });
  it('keeps the label out of the quadrant the speed vector points into', () => {
    const r = solveLabel(base({ vEnd: { x: 700, y: 300 } })); // vector to the upper right
    expect(r.dx > 0 && r.dy < -24).toBe(false);
  });
});

describe('skins', () => {
  it('has night, day and amber with the same keys', () => {
    const keys = Object.keys(SKIN.night).sort();
    expect(Object.keys(SKIN.day).sort()).toEqual(keys);
    expect(Object.keys(SKIN.amber).sort()).toEqual(keys);
    expect(SKIN_NAMES.map((s) => s.id)).toEqual(['night', 'day', 'amber']);
  });
  it('falls back to night for an unknown name', () => {
    expect(skinFor('neon')).toBe(SKIN.night);
    expect(skinFor(undefined)).toBe(SKIN.night);
    expect(skinFor('amber')).toBe(SKIN.amber);
  });
  it('keeps red for safety in every skin', () => {
    for (const s of Object.values(SKIN)) {
      const m = s.urgent.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)!;
      const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
      expect(r).toBeGreaterThan(g + 60); expect(r).toBeGreaterThan(b + 60);
    }
  });
  it('withAlpha replaces the alpha of an rgba string only', () => {
    expect(withAlpha('rgba(1,2,3,0.5)', 0.2)).toBe('rgba(1,2,3,0.2)');
    expect(withAlpha('#ffffff', 0.2)).toBe('#ffffff');
  });
});
