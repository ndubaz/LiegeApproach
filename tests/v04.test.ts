import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import type { Aircraft, Scenario, SpawnSpec } from '../src/engine/types';
import { CHALLENGES } from '../src/engine/scenarios';
import { assess } from '../src/engine/assess';
import { freePlay } from '../src/engine/traffic';
import { suggest, roundHdg, releaseAdvice } from '../src/engine/suggest';
import { hints } from '../src/engine/hints';
import { parseShorthand } from '../src/engine/parser';
import { phraseology, readback } from '../src/engine/clearance';
import { move, norm360 } from '../src/geo';
import { autoControl } from './auto';
import { chipBot, sepCounts } from './chipbot';

const pack = loadPack(EBLG);
const METAR = 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG';
const CALM = 'EBLG 120140Z 00000KT 9999 FEW035 12/07 Q1018 NOSIG';
function tiny(spawns: SpawnSpec[], min = 40, metar = METAR): Scenario {
  return { id: 'test', title: 'test', desc: '', seed: 11, durationMin: min, startUtc: '02:00', metar, runway: '22L', spawns, events: [], readbackErr: 0, noSayAgain: true };
}
const arr = (cs: string, type = 'B744', x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t: 1, kind: 'arr', cs, type, star: 'KOK7X', spawnDist: 40, callNow: true, ...x });
const stepUntil = (sim: Sim, f: () => boolean, max = 1200) => { const end = sim.t + max; while (!f() && sim.t < end && !sim.ended) sim.step(); return f(); };
const assumed = (sim: Sim, cs: string) => stepUntil(sim, () => sim.find(cs)?.state === 'assumed');
const settle = (sim: Sim, cs: string) => stepUntil(sim, () => !sim.readbackPending(cs), 30);
/** Put an aircraft `d` NM out on the 22L final, `off` NM to the right of the centreline, on a heading. */
function place(sim: Sim, a: Aircraft, d: number, off: number, hdgTrue: number, alt: number, ias: number) {
  const r = sim.rwy;
  a.p = move(move(r.thr, norm360(r.crs + 180), d), norm360(r.crs + 90), off);
  a.hdg = a.trk = a.hdgAssigned = hdgTrue; a.mode = 'HDG'; a.route = []; a.turnDir = undefined;
  a.alt = a.tgtAlt = alt; a.cleared = a.cflSys = { ft: alt }; a.ias = ias; a.vs = 0;
}
const magOf = (sim: Sim, trueHdg: number) => roundHdg(trueHdg - sim.pack.meta.magVar);

describe('localizer capture and the final approach', () => {
  it('captures from a parallel offset inside the localizer, and asks for vectors when outside it', () => {
    const sim = new Sim(pack, tiny([arr('TST1')], 40, CALM));
    assumed(sim, 'TST1');
    const a = sim.find('TST1')!;
    place(sim, a, 12, 1.0, sim.rwy.crs, 3000, 200);
    sim.issue({ cs: 'TST1', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] });
    expect(stepUntil(sim, () => !!a.app?.locCap, 120)).toBe(true);

    const s2 = new Sim(pack, tiny([arr('TST2')], 40, CALM));
    assumed(s2, 'TST2');
    const b = s2.find('TST2')!;
    place(s2, b, 14, 3.5, norm360(s2.rwy.crs + 2), 3000, 200); // parallel, slowly diverging, well outside
    s2.issue({ cs: 'TST2', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] });
    stepUntil(s2, () => s2.log.some((t) => t.cs === 'TST2' && /unable to intercept/.test(t.text)), 120);
    expect(b.app?.locCap).toBe(false);
    expect(s2.log.filter((t) => t.cs === 'TST2' && /unable to intercept/.test(t.text)).length).toBe(1);
    expect(b.request?.kind).toBe('vectors');
    expect(suggest(s2, b)[0].label).toMatch(/^Intercept/);
  });

  it('a sensibly flown approach with 180 kt at 12 NM lands without an unstable go-around (heavy and medium)', () => {
    for (const type of ['B748', 'B763', 'MD11', 'A332']) {
      const sim = new Sim(pack, tiny([arr('TST1', type)]));
      assumed(sim, 'TST1');
      const a = sim.find('TST1')!;
      place(sim, a, 16, 2.5, norm360(sim.rwy.crs - 30), 3000, 220);
      sim.issue({ cs: 'TST1', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] });
      stepUntil(sim, () => sim.dthr(a) < 12.2, 400);
      sim.issue({ cs: 'TST1', items: [{ k: 'spd', spd: 180 }] });
      stepUntil(sim, () => !!a.app?.locCap && !sim.readbackPending('TST1'), 400);
      sim.issue({ cs: 'TST1', items: [{ k: 'xfr', unit: 'TWR' }] });
      stepUntil(sim, () => sim.landings.length > 0 || sim.events.some((e) => e.kind === 'goaround'), 900);
      expect(sim.events.filter((e) => e.kind === 'goaround').map((e) => `${type}: ${e.text}`)).toEqual([]);
      expect(sim.landings.length, type).toBe(1);
    }
  });

  it('the autopilot flies every challenge with almost no unstable go-arounds', () => {
    let unstable = 0, landed = 0;
    for (const sc of CHALLENGES) {
      const sim = new Sim(pack, sc);
      while (!sim.ended) { sim.step(); autoControl(sim); }
      unstable += sim.events.filter((e) => e.kind === 'goaround' && /unstable/.test(e.text)).length;
      landed += sim.landings.length;
    }
    if ((globalThis as any).process?.env?.SURVEY) console.log('autopilot challenges: unstable go-arounds', unstable, 'of', landed, 'landings');
    expect(unstable).toBeLessThanOrEqual(Math.ceil(landed * 0.02));
  });
});

describe('roger, standby and the turn query', () => {
  it('roger answers a check-in ("identified") and needs no readback; later calls get "roger"', () => {
    const sim = new Sim(pack, tiny([arr('TST1')]));
    stepUntil(sim, () => sim.find('TST1')?.awaitingSince !== undefined && sim.t > sim.find('TST1')!.awaitingSince!);
    expect(parseShorthand('TST1 R', { callsigns: ['TST1'], runway: '22L', tl: 55, fixes: new Set(), transitions: new Set() }).items).toEqual([{ k: 'roger' }]);
    expect(parseShorthand('SB', { callsigns: ['TST1'], selected: 'TST1', runway: '22L', tl: 55, fixes: new Set(), transitions: new Set() }).items).toEqual([{ k: 'standby' }]);
    const n = sim.log.length;
    sim.issue({ cs: 'TST1', items: [{ k: 'roger' }] });
    expect(sim.log[n].text).toBe('TST1, Liège Approach, identified');
    expect(sim.find('TST1')!.awaitingSince).toBeUndefined();
    expect(sim.responseTimes.length).toBe(1);
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.log.slice(n + 1).filter((t) => t.cs === 'TST1').length).toBe(0);
    const ctx = { alt: 5000, qnh: 1018, hdgMag: 0 };
    expect(phraseology({ cs: 'TST1', items: [{ k: 'roger' }] }, ctx).text).toBe('TST1, roger');
  });

  it('standby answers the call for now; the pilot calls again about 45 s later if nothing follows', () => {
    const sim = new Sim(pack, tiny([arr('TST1')]));
    stepUntil(sim, () => sim.find('TST1')?.awaitingSince !== undefined && sim.t > sim.find('TST1')!.awaitingSince!);
    sim.issue({ cs: 'TST1', items: [{ k: 'standby' }] });
    const a = sim.find('TST1')!;
    expect(a.awaitingSince).toBeUndefined();
    expect(sim.responseTimes.length).toBe(1);
    stepUntil(sim, () => sim.log.some((t) => t.from === 'PILOT' && /standing by/.test(t.text)), 80);
    expect(sim.log.some((t) => t.from === 'PILOT' && /standing by/.test(t.text))).toBe(true);
    stepUntil(sim, () => a.awaitingSince !== undefined, 10);
    expect(a.awaitingSince).toBeDefined();
  });

  it('warns on a turn of more than 180° the stated way, and the pilot queries one over 200° once', () => {
    const sim = new Sim(pack, tiny([arr('TST1')]));
    assumed(sim, 'TST1');
    settle(sim, 'TST1');
    const a = sim.find('TST1')!;
    const cur = magOf(sim, a.hdg);
    const tgt = roundHdg(cur + 90); // 90° right is 270° left
    expect(sim.validate({ cs: 'TST1', items: [{ k: 'hdg', hdg: tgt, dir: 'L' }] })).toContain('Left turn of 270°');
    expect(sim.validate({ cs: 'TST1', items: [{ k: 'hdg', hdg: tgt, dir: 'R' }] }).some((w) => /turn of/.test(w))).toBe(false);
    a.awaitingSince = undefined;
    sim.issue({ cs: 'TST1', items: [{ k: 'hdg', hdg: tgt, dir: 'L' }] });
    settle(sim, 'TST1');
    const q = sim.log.filter((t) => t.cs === 'TST1' && t.from === 'PILOT').pop()!;
    expect(q.text).toMatch(/confirm left turn heading \d{3}\?/);
    expect(a.mode).not.toBe('HDG');
    expect(a.turnQuery).toMatchObject({ hdg: tgt, dir: 'L' });
    const chip = suggest(sim, a)[0];
    expect(chip.label).toMatch(/^Affirm/);
    expect(chip.primary).toBe(true);
    sim.issue({ cs: 'TST1', items: chip.items });
    settle(sim, 'TST1');
    expect(a.mode).toBe('HDG');
    expect(a.turnDir).toBe('L');
    expect(a.turnQuery).toBeUndefined();
  });
});

describe('validation and phraseology', () => {
  it('approach clearance: intercepts under 15° (outside the localizer) or over 45° are flagged', () => {
    const sim = new Sim(pack, tiny([arr('TST1')]));
    assumed(sim, 'TST1');
    const a = sim.find('TST1')!;
    place(sim, a, 14, 3, norm360(sim.rwy.crs - 8), 3000, 200);
    expect(sim.validate({ cs: 'TST1', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] }).join()).toMatch(/less than 15°/);
    place(sim, a, 14, 3, norm360(sim.rwy.crs - 70), 3000, 200);
    expect(sim.validate({ cs: 'TST1', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] }).join()).toMatch(/more than 45°/);
    place(sim, a, 14, 3, norm360(sim.rwy.crs - 30), 3000, 200);
    expect(sim.validate({ cs: 'TST1', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] })).toEqual([]);
  });

  it('a redundant level warns and is never phrased as climb or descend; refusals are acknowledged, not read back', () => {
    const sim = new Sim(pack, tiny([arr('TST1')]));
    assumed(sim, 'TST1');
    settle(sim, 'TST1');
    const a = sim.find('TST1')!;
    a.awaitingSince = undefined;
    a.cleared = a.cflSys = { ft: 3000 }; a.alt = 2950; a.tgtAlt = 3000;
    expect(sim.validate({ cs: 'TST1', items: [{ k: 'lvl', lvl: { ft: 3000 } }] })).toContain('Already cleared to 3,000 ft');
    expect(sim.previewPhrase({ cs: 'TST1', items: [{ k: 'lvl', lvl: { ft: 3000 } }] })!.text).toMatch(/maintain 3,000 ft/);
    const ctx = { alt: 5000, qnh: 1018, hdgMag: 0 };
    expect(readback('TST1', [{ k: 'deny' }], ctx).text).toBe('roger, TST1');
    expect(readback('TST1', [{ k: 'deny' }], ctx).text).not.toMatch(/unable/);
  });

  it('approving a direct request says "proceed direct"; the hold gives an EFC when someone already holds there', () => {
    const sim = new Sim(pack, tiny([arr('TST1'), arr('TST2', 'B77L', { star: 'CIV7X', t: 3 })]));
    assumed(sim, 'TST1'); assumed(sim, 'TST2');
    const a = sim.find('TST1')!;
    a.request = { kind: 'direct', fix: 'ALHUV', text: 'Direct ALHUV', speech: '', t: sim.t };
    expect(sim.previewPhrase({ cs: 'TST1', items: [{ k: 'appr' }] })!.text).toBe('TST1, proceed direct ALHUV');
    a.request = undefined;
    sim.issue({ cs: 'TST1', items: [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 4000 } }] });
    settle(sim, 'TST1');
    expect(sim.previewPhrase({ cs: 'TST2', items: [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 5000 } }] })!.text).toMatch(/expect approach clearance at \d{4}/);
  });

  it('the emergency description is the same in the MAYDAY call and on the aircraft', () => {
    const sim = new Sim(pack, tiny([arr('TST1', 'B744', { emergency: { after: 20, type: 'smoke' } })]));
    stepUntil(sim, () => !!sim.find('TST1')?.emergency, 300);
    const a = sim.find('TST1')!;
    expect(a.emergencyText).toBe('Smoke in the cargo hold');
    stepUntil(sim, () => sim.log.some((t) => t.emergency), 30);
    expect(sim.log.find((t) => t.emergency)!.text).toMatch(/smoke in the cargo hold/);
  });
});

describe('suggestions are safe and advisory', () => {
  it('nothing new while a readback is due; heavies never get a speed below minimum clean; a MAYDAY gets the shortest way in', () => {
    const sim = new Sim(pack, tiny([arr('TST1', 'B748')]));
    assumed(sim, 'TST1');
    settle(sim, 'TST1');
    const a = sim.find('TST1')!;
    sim.issue({ cs: 'TST1', items: [{ k: 'lvl', lvl: { fl: 70 } }] });
    expect(sim.readbackPending('TST1')).toBe(true);
    expect(suggest(sim, a)).toEqual([]);
    expect(hints(sim).filter((h) => h.cs === 'TST1')).toEqual([]);
    settle(sim, 'TST1');
    place(sim, a, 20, 2, norm360(sim.rwy.crs - 30), 4000, 250);
    a.app = { type: 'ILS', rwy: sim.rwy, locCap: false, gsCap: false };
    for (const s of suggest(sim, a)) for (const it of s.items) if (it.k === 'spd') expect(it.spd, s.label).toBeGreaterThanOrEqual(a.perf.vminClean);
    for (const s of suggest(sim, a)) expect(s.warn?.filter((w) => /min clean/.test(w)) ?? [], s.label).toEqual([]);

    const s2 = new Sim(pack, tiny([arr('TST2', 'B744', { emergency: { after: 15, type: 'engine' } })]));
    stepUntil(s2, () => !!s2.find('TST2')?.emergency && !s2.readbackPending('TST2'), 300);
    const top = suggest(s2, s2.find('TST2')!)[0];
    expect(top.label).toMatch(/^Direct LIBVA/);
    expect(top.primary).toBe(true);
    expect(top.items.some((i) => i.k === 'trans')).toBe(false);
  });

  it('the transition chip never goes below 3,000 ft, and is primary only with a clear slot', () => {
    const sim = new Sim(pack, tiny([arr('TST1', 'B77L', { spawnDist: 30 }), arr('TST2', 'B77L', { star: 'CIV7X', t: 20, spawnDist: 30 })]));
    assumed(sim, 'TST1');
    settle(sim, 'TST1');
    const first = suggest(sim, sim.find('TST1')!).find((s) => s.items.some((i) => i.k === 'trans'))!;
    expect(first.primary).toBe(true);
    expect(first.why).toMatch(/^#1 to land/);
    const lv = first.items.find((i) => i.k === 'lvl') as { lvl: { ft?: number } } | undefined;
    expect(lv?.lvl.ft ?? 3000).toBeGreaterThanOrEqual(3000);
    sim.issue({ cs: 'TST1', items: first.items });
    assumed(sim, 'TST2');
    settle(sim, 'TST1'); settle(sim, 'TST2');
    const second = suggest(sim, sim.find('TST2')!);
    const tr = second.find((s) => s.items.some((i) => i.k === 'trans'));
    if (tr?.primary) expect(tr.why).toMatch(/^#2 to land, [\d.]+ NM behind TST1/);
    else expect(second[0].label).toMatch(/^(Hold|Min clean|Speed)/);
  });

  it('a chip-only player on night shifts: no wake infringements and few losses of separation', () => {
    let tot = { los: 0, wake: 0 };
    for (const seed of [1, 2]) {
      const sc = freePlay(pack, { template: 'shift', durationMin: 40, military: 0, weather: 'good', emergencies: false, difficulty: 2, seed });
      const sim = new Sim(pack, sc);
      while (!sim.ended) { chipBot(sim); sim.step(); }
      const c = sepCounts(sim);
      tot = { los: tot.los + c.los, wake: tot.wake + c.wake };
    }
    // before v0.4 the same player had 188 losses and 73 wake infringements in ten 60-minute shifts
    if ((globalThis as any).process?.env?.SURVEY) console.log('chip-only 2 x 40 min', JSON.stringify(tot));
    expect(tot.wake).toBeLessThanOrEqual(1);
    expect(tot.los).toBeLessThanOrEqual(8);
  }, 60000);

  it('release advice holds a departure for short final and caps its climb under traffic over the field', () => {
    const sim = new Sim(pack, tiny([arr('TST1')]));
    assumed(sim, 'TST1');
    const a = sim.find('TST1')!;
    place(sim, a, 3, 0, sim.rwy.crs, 1500, 150);
    a.app = { type: 'ILS', rwy: sim.rwy, locCap: true, gsCap: true };
    expect(releaseAdvice(sim, 'X').ok).toBe(false);
    a.app = undefined;
    a.p = move(sim.rwy.thr, 0, 2); a.alt = a.tgtAlt = 5000; a.cleared = { ft: 5000 };
    const adv = releaseAdvice(sim, 'X');
    expect(adv.ok).toBe(true);
    expect(adv.items[0]).toMatchObject({ k: 'rel', lvl: { ft: 4000 } });
  });
});

describe('grading and records', () => {
  it('ending a free-play session at t=60 grades fail: no traffic worked', () => {
    const sc = freePlay(pack, { template: 'shift', durationMin: 60, military: 1, weather: 'good', emergencies: false, difficulty: 2, seed: 4 });
    const sim = new Sim(pack, sc);
    while (sim.t < 60) sim.step();
    sim.finish();
    const r = assess(sim);
    expect(r.grade).toBe('fail');
    expect(r.gradeNotes).toContain('No traffic worked');
  });

  it('free play lasts exactly the chosen duration and every arrival appears at least 20 minutes before the end', () => {
    for (const durationMin of [30, 45, 90]) {
      const sc = freePlay(pack, { template: 'night', durationMin, military: 2, weather: 'good', emergencies: true, difficulty: 3, seed: 9 });
      expect(sc.durationMin).toBe(durationMin);
      for (const s of sc.spawns) if (s.t > 2) expect(durationMin * 60 - s.t, `${s.cs} ${s.kind}`).toBeGreaterThanOrEqual((s.kind === 'arr' ? 20 : 10) * 60 - 1);
    }
  });

  it('landing spacing pairs consecutive landings on the runway', () => {
    const sim = new Sim(pack, CHALLENGES.find((c) => c.id === 'trombone')!);
    while (!sim.ended) { sim.step(); autoControl(sim); }
    expect(sim.spacing.length).toBeGreaterThanOrEqual(2);
    const order = sim.landings.map((l) => l.cs);
    for (const s of sim.spacing) expect(order.indexOf(s.follower), `${s.leader} -> ${s.follower}`).toBe(order.indexOf(s.leader) + 1);
  });

  it('a conflict counts as solved only when an instruction to one of the pair solved it', () => {
    const sim = new Sim(pack, CHALLENGES.find((c) => c.id === 'cross-streams')!);
    while (!sim.ended) { sim.step(); autoControl(sim); }
    for (const e of sim.events.filter((x) => x.kind === 'conflict_solved')) {
      expect(sim.cmdLog.some((c) => (c.cl.cs === e.cs || c.cl.cs === e.cs2) && c.t <= e.t)).toBe(true);
    }
  });
});
