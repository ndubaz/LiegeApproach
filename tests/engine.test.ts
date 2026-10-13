import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import type { Scenario, SpawnSpec } from '../src/engine/types';
import { CHALLENGES } from '../src/engine/scenarios';
import { assess } from '../src/engine/assess';
import { autoControl } from './auto';
import { move } from '../src/geo';
import { glideAlt } from '../src/engine/pilot';
import { freqSpeech, phraseology, readback, unitName, type Ctx, type Item } from '../src/engine/clearance';

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

// ---------------------------------------------------------------- v0.4 engine
const ARR = (cs: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t: 1, kind: 'arr', cs, type: 'B744', star: 'KOK7X', spawnDist: 40, ...x });
const DEP = (cs: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t: 1, kind: 'dep', cs, type: 'B77L', sid: 'LNO9S', ...x });
/** Put an aircraft on the 22L final at d NM. */
function onFinal(sim: Sim, cs: string, d: number, o: { above?: number; tower?: boolean; ias?: number; gs?: boolean } = {}) {
  const a = sim.find(cs)!;
  const r = sim.rwy;
  a.p = move(r.thr, r.crs + 180, d); a.hdg = r.crs; a.trk = r.crs; a.vs = 0;
  a.alt = glideAlt(r, d) + (o.above ?? 0); a.ias = o.ias ?? 170;
  a.mode = 'LOC'; a.route = []; a.app = { type: 'ILS', rwy: r, locCap: true, gsCap: o.gs ?? !o.above };
  a.checkInAt = undefined; a.awaitingSince = undefined;
  a.cleared = sim.levelFor(Math.round(a.alt / 100) * 100); a.tgtAlt = sim.ftOf(a.cleared);
  a.state = o.tower ? 'transferred' : 'assumed'; a.xfrUnit = o.tower ? 'TWR' : undefined;
  return a;
}
const stepUntil = (sim: Sim, cond: () => boolean, max = 1200) => { const end = sim.t + max; while (!sim.ended && sim.t < end && !cond()) sim.step(); return cond(); };
const texts = (sim: Sim, from?: string) => sim.log.filter((x) => !from || x.from === from).map((x) => x.text);

describe('departure release protocol', () => {
  it('Tower asks for a release on the intercom; nothing departs until released; chases after 3 min', () => {
    const sim = new Sim(pack, scenario('22L', [DEP('CHG9598')], 10));
    sim.step();
    expect(sim.releases.map((r) => [r.cs, r.state, r.sid, r.rwy])).toEqual([['CHG9598', 'pending', 'LNO9S', '22L']]);
    const tx = sim.log.find((x) => x.from === 'TWR')!;
    expect(tx.channel).toBe('icom');
    expect(tx.text).toBe('Approach, Tower, request release CHG9598, LNO9S, runway 22L');
    expect(sim.atcAirtime + sim.pilotAirtime).toBe(0);
    stepUntil(sim, () => false, 200);
    expect(sim.find('CHG9598')).toBeUndefined();
    expect(sim.events.some((e) => e.kind === 'release_delay')).toBe(true);
    expect(texts(sim, 'TWR').some((t) => t.includes('still waiting release for CHG9598'))).toBe(true);
  });

  it('a released departure launches only when no arrival is within 5 NM, and then calls on RT', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('QTR586'), DEP('CHG9598')], 20));
    sim.step();
    onFinal(sim, 'QTR586', 4.5, { tower: true });
    const res = sim.issue({ cs: 'CHG9598', items: [{ k: 'rel' }] });
    expect(res.ok).toBe(true);
    expect(texts(sim).includes('CHG9598 released')).toBe(true);
    expect(sim.log[sim.log.length - 1].channel).toBe('icom');
    stepUntil(sim, () => !!sim.find('CHG9598'));
    const landed = sim.landings.find((l) => l.cs === 'QTR586')!;
    expect(landed).toBeDefined();
    expect(sim.t).toBeGreaterThanOrEqual(landed.t + 50); // runway occupied after landing
    stepUntil(sim, () => sim.log.some((x) => x.from === 'PILOT' && x.cs === 'CHG9598'), 30);
    expect(sim.log.find((x) => x.from === 'PILOT' && x.cs === 'CHG9598')!.text).toMatch(/^Liège Approach, CHG9598, passing/);
  });

  it('"released after" waits for that arrival to land', () => {
    const go = (after?: string) => {
      const sim = new Sim(pack, scenario('22L', [ARR('QTR586'), DEP('CHG9598')], 20));
      sim.step();
      onFinal(sim, 'QTR586', 10, { tower: true });
      sim.issue({ cs: 'CHG9598', items: [{ k: 'rel', after }] });
      stepUntil(sim, () => !!sim.find('CHG9598'), 600);
      return { t: sim.t, landT: sim.landings[0]?.t, sim };
    };
    const free = go();
    expect(free.landT).toBeUndefined(); // launched well before the arrival landed
    expect(free.t).toBeLessThan(80);
    const after = go('QTR586');
    expect(after.landT).toBeDefined();
    expect(after.t).toBeGreaterThan(after.landT!);
    expect(texts(after.sim).includes('CHG9598 released after QTR586')).toBe(true);
  });

  it('release with heading and level; hold with an expected time', () => {
    const sim = new Sim(pack, scenario('22L', [DEP('CHG9598'), DEP('TAY71K', { t: 2, sid: 'BUB9S' })], 20));
    sim.step(); sim.step();
    sim.issue({ cs: 'TAY71K', items: [{ k: 'relhold', mins: 3 }] });
    expect(texts(sim).includes('hold TAY71K, expect release in 3 minutes')).toBe(true);
    expect(sim.releases.find((r) => r.cs === 'TAY71K')!.state).toBe('held');
    sim.issue({ cs: 'CHG9598', items: [{ k: 'rel', hdg: 250, lvl: { ft: 5000 } }] });
    expect(texts(sim).includes('CHG9598 released, heading 250, climb 5,000 ft')).toBe(true);
    stepUntil(sim, () => !!sim.find('CHG9598'));
    const a = sim.find('CHG9598')!;
    expect(a.mode).toBe('HDG');
    expect(a.cleared).toEqual({ ft: 5000 });
    stepUntil(sim, () => sim.log.some((x) => x.from === 'PILOT' && x.cs === 'CHG9598'), 30);
    expect(sim.log.find((x) => x.from === 'PILOT' && x.cs === 'CHG9598')!.text).toContain('heading 250');
    stepUntil(sim, () => sim.events.some((e) => e.kind === 'release_delay' && e.cs === 'TAY71K'), 400);
    expect(sim.events.some((e) => e.kind === 'release_delay' && e.cs === 'TAY71K')).toBe(true);
    expect(sim.find('TAY71K')).toBeUndefined();
  });
});

describe('go-around via Tower', () => {
  it('Tower reports on the intercom; the crew calls Approach 20-40 s later', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('CHG4654', { goAroundAt: 3 })], 20));
    sim.step();
    onFinal(sim, 'CHG4654', 6, { tower: true });
    stepUntil(sim, () => sim.events.some((e) => e.kind === 'goaround'), 200);
    const t0 = sim.t;
    const tw = sim.log.find((x) => x.from === 'TWR')!;
    expect(tw.channel).toBe('icom');
    expect(tw.text).toBe('Approach, Tower, CHG4654 going around, runway occupied, climbing 3,000 ft on the missed approach');
    expect(sim.find('CHG4654')!.state).toBe('inbound');
    stepUntil(sim, () => sim.log.some((x) => x.from === 'PILOT' && x.cs === 'CHG4654'), 60);
    expect(sim.t - t0).toBeGreaterThanOrEqual(20);
    expect(sim.t - t0).toBeLessThanOrEqual(42);
    stepUntil(sim, () => sim.find('CHG4654')!.state === 'assumed', 15);
    expect(sim.find('CHG4654')!.state).toBe('assumed');
  });
});

describe('pilot on the ILS', () => {
  it('captures the glide from above at no more than 1,500 fpm and lands', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('DHK7')], 20));
    sim.step();
    const a = onFinal(sim, 'DHK7', 13, { above: 800, tower: true });
    let minVs = 0;
    stepUntil(sim, () => { if (!a.app?.gsCap) minVs = Math.min(minVs, a.vs); return !!a.app?.gsCap; }, 400);
    expect(a.app!.gsCap).toBe(true);
    expect(minVs).toBeGreaterThanOrEqual(-1500);
    expect(minVs).toBeLessThan(-1000);
    stepUntil(sim, () => sim.landings.length > 0, 600);
    expect(sim.landings.length).toBe(1);
  });

  it('too high at 10 NM: pilot says so, asks for vectors, does not capture; break-off works', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('DHK7')], 20));
    sim.step();
    const a = onFinal(sim, 'DHK7', 9.5, { above: 1500 });
    stepUntil(sim, () => sim.log.some((x) => x.from === 'PILOT' && x.text.includes('too high')), 30);
    expect(texts(sim, 'PILOT')).toContain('DHK7, too high, unable to capture the glide, request vectors');
    expect(a.request?.kind).toBe('vectors');
    stepUntil(sim, () => false, 40);
    expect(a.app!.gsCap).toBe(false);
    sim.issue({ cs: 'DHK7', items: [{ k: 'brk' }, { k: 'hdg', hdg: 40, dir: 'L' }, { k: 'lvl', lvl: { ft: 7000 } }] });
    expect(texts(sim, 'ATC').pop()).toBe('DHK7, cancel approach clearance, turn left heading 040, climb 7,000 ft, QNH 1018');
    stepUntil(sim, () => !a.app, 20);
    expect(a.app).toBeUndefined();
    expect(a.mode).toBe('HDG');
    expect(a.request).toBeUndefined();
  });

  it('stability gate is at 1,000 ft above the aerodrome (about 3 NM): too fast means a go-around', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('DHK7')], 20));
    sim.step();
    const a = onFinal(sim, 'DHK7', 3.6, { tower: true, ias: 250 });
    stepUntil(sim, () => sim.dthr(a) < 3.25, 30);
    expect(a.stable4).toBeUndefined();
    stepUntil(sim, () => sim.events.some((e) => e.kind === 'goaround'), 30);
    expect(sim.events.find((e) => e.kind === 'goaround')!.text).toContain('unstable');
  });

  it('the level segment at the IF is not a level-off', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('DHK7')], 20));
    sim.step();
    const r = sim.rwy;
    const a = onFinal(sim, 'DHK7', 14, { tower: true });
    a.alt = r.fafAlt; a.cleared = { ft: r.fafAlt }; a.tgtAlt = r.fafAlt; a.app!.gsCap = false;
    stepUntil(sim, () => !!a.app?.gsCap, 300);
    expect(a.app!.gsCap).toBe(true);
    expect(a.levelOffs).toBe(0);
  });
});

describe('holding discipline', () => {
  it('EFC in the hold clearance, maximum holding level, stack alert, EFC call', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('AAA1', { star: 'LNO6X', spawnDist: 12, callNow: true }), ARR('BBB2', { star: 'LNO6X', spawnDist: 14, callNow: true })], 30));
    sim.step();
    expect(sim.find('AAA1')!.recat).toBe('B');
    stepUntil(sim, () => sim.find('AAA1')!.state === 'assumed' && sim.find('BBB2')!.state === 'assumed', 60);
    sim.issue({ cs: 'AAA1', items: [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 4000 } }] });
    expect(texts(sim, 'ATC').pop()).toBe('AAA1, hold at ALHUV as published, no delay expected, descend 4,000 ft, QNH 1018');
    sim.step(); sim.step();
    const w = sim.issue({ cs: 'BBB2', items: [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { fl: 60 } }] });
    expect(w.warnings.some((x) => x.includes('holding maximum'))).toBe(true);
    expect(texts(sim, 'ATC').pop()).toMatch(/^BBB2, hold at ALHUV as published, expect approach clearance at \d{4}, descend FL060$/);
    const efc = sim.find('BBB2')!.efc!;
    expect(efc - sim.t).toBeGreaterThanOrEqual(150);
    stepUntil(sim, () => texts(sim, 'PILOT').some((t) => t.includes('maximum holding altitude')), 400);
    expect(texts(sim, 'PILOT')).toContain('BBB2, request lower, maximum holding altitude FL050');
    stepUntil(sim, () => !sim.freqBusy() && !sim.readbackPending('BBB2'), 30);
    sim.issue({ cs: 'BBB2', items: [{ k: 'lvl', lvl: { ft: 4000 } }] });
    stepUntil(sim, () => sim.events.some((e) => e.kind === 'stack'), 400);
    expect(sim.events.filter((e) => e.kind === 'stack').length).toBe(1);
    stepUntil(sim, () => texts(sim, 'PILOT').some((t) => t.includes('EFC time')), 600);
    expect(texts(sim, 'PILOT').some((t) => /EFC time, request onward clearance/.test(t))).toBe(true);
  });
});

describe('phraseology', () => {
  const ctx = { alt: 6000, qnh: 1018, hdgMag: 200, ias: 230 };
  const say = (items: Item[], c: Partial<Ctx> = {}) => phraseology({ cs: 'QTR8125', items }, { ...ctx, ...c }).text;
  it('QNH with the first altitude, speed verbs, minimum clean speed', () => {
    expect(say([{ k: 'lvl', lvl: { ft: 4000 } }], { qnhSay: true })).toBe('QTR8125, descend 4,000 ft, QNH 1018');
    expect(say([{ k: 'spd', spd: 210 }])).toBe('QTR8125, reduce speed 210 kt');
    expect(say([{ k: 'spd', spd: 250 }])).toBe('QTR8125, increase speed 250 kt');
    expect(say([{ k: 'spd', spd: 230 }])).toBe('QTR8125, maintain 230 kt');
    expect(say([{ k: 'spdmin' }])).toBe('QTR8125, reduce to minimum clean speed');
  });
  it('frequencies in six digits unless the last two are zero', () => {
    expect(freqSpeech('118.130')).toBe('one one eight decimal one three zero');
    expect(freqSpeech('131.100')).toBe('one three one decimal one');
    expect(unitName('MUAC').speech).toBe('Maastricht one three two decimal seven five five');
  });
  it('vectoring for the ILS, position on approach clearance, request answers', () => {
    expect(say([{ k: 'hdg', hdg: 250, dir: 'L' }], { vectorFor: { app: 'ILS', rwy: '22L' } })).toBe('QTR8125, turn left heading 250, vectoring for ILS approach runway 22L');
    expect(say([{ k: 'hdg', hdg: 250, dir: 'L' }, { k: 'app', app: 'ILS', rwy: '22L' }], { posNm: 8.2 })).toBe('QTR8125, 8 miles from touchdown, turn left heading 250, cleared ILS approach runway 22L');
    expect(say([{ k: 'deny' }], { req: { kind: 'climb' } })).toBe('QTR8125, unable, due traffic');
    expect(say([{ k: 'deny' }], { req: { kind: 'crossing', vfr: true, route: ['OSCAR', 'INDIA'] } })).toBe('QTR8125, remain outside the control zone, expect 5 minutes delay');
    expect(say([{ k: 'appr' }], { req: { kind: 'crossing', vfr: true, route: ['OSCAR', 'INDIA'], sqk: '7012', alt: 1500 } }))
      .toBe('QTR8125, cleared to cross the control zone via OSCAR, INDIA, VFR, altitude 1,500 ft or below, squawk 7012, QNH 1018, report INDIA');
  });
  it("a wrong readback keeps the controller's verb", () => {
    const rb = readback('QTR8125', [{ k: 'lvl', lvl: { ft: 5000 } }], { ...ctx, alt: 5500 }, { idx: 0, item: { k: 'lvl', lvl: { ft: 6000 } } });
    expect(rb.text).toBe('descend 6,000 ft, QTR8125');
  });
  it('in the sim: QNH only once, vectoring only on the first heading', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('DHK7', { callNow: true })], 10));
    stepUntil(sim, () => sim.find('DHK7')?.state === 'assumed', 30);
    sim.forceWrong.clear();
    sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 270, dir: 'L' }, { k: 'lvl', lvl: { ft: 5000 } }] });
    expect(texts(sim, 'ATC').pop()).toBe('DHK7, turn left heading 270, vectoring for ILS approach runway 22L, descend 5,000 ft, QNH 1018');
    stepUntil(sim, () => !sim.readbackPending('DHK7') && !sim.freqBusy(), 30);
    sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 240 }, { k: 'lvl', lvl: { ft: 4000 } }] });
    expect(texts(sim, 'ATC').pop()).toBe('DHK7, fly heading 240, descend 4,000 ft');
  });
});

describe('session flow', () => {
  it('an arrival with callNow calls at once', () => {
    const sim = new Sim(pack, scenario('22L', [ARR('DHK7', { callNow: true })], 10));
    sim.step();
    expect(sim.log.some((x) => x.from === 'PILOT' && x.cs === 'DHK7')).toBe(true);
  });
  it('ends 30 s after the supervisor announces traffic complete', () => {
    const sim = new Sim(pack, scenario('22L', [DEP('TST2')], 30));
    run(sim, 30 * 60);
    const sup = sim.log.find((x) => x.from === 'SUP')!;
    expect(sup.text).toBe('Traffic complete. Hand-over in 30 s');
    expect(sup.channel).toBe('icom');
    expect(sim.ended).toBe(true);
    expect(sim.endReason).toBe('complete');
    expect(sim.t).toBe(sup.t0 + 30);
  });
  it('ATIS drift: new letter every 30 min, announced by the supervisor', () => {
    const sc = { ...scenario('22L', [{ t: 3000, kind: 'ovf', cs: 'ZZZ1', type: 'A320', route: ['LNO'], silent: true }], 60), atisDrift: true };
    const sim = new Sim(pack, sc);
    const a0 = sim.atis, q0 = sim.qnh;
    stepUntil(sim, () => sim.t >= 1800, 1900);
    expect(sim.atis).not.toBe(a0);
    expect(Math.abs(sim.qnh - q0)).toBeGreaterThanOrEqual(1);
    expect(texts(sim, 'SUP').some((t) => t.startsWith(`New ATIS: information ${sim.atis} now current`))).toBe(true);
  });
  it('MIL asks for a fighter crossing on the intercom; a transfer to MIL is not an unauthorised exit', () => {
    const sim = new Sim(pack, scenario('22L', [{ t: 1, kind: 'mil', cs: 'BAF61', type: 'F35', formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: { fl: 70 }, spd: 300, request: { kind: 'climb', level: { fl: 150 } } }], 20));
    sim.step();
    const a = sim.find('BAF61')!;
    expect(a.request?.kind).toBe('milxing');
    expect(sim.log.find((x) => x.from === 'MIL')!.text).toMatch(/^Approach, MIL, request crossing for BAF61 flight of 2/);
    stepUntil(sim, () => false, 30);
    expect(sim.log.some((x) => x.from === 'PILOT' && x.cs === 'BAF61')).toBe(false);
    sim.issue({ cs: 'BAF61', items: [{ k: 'appr' }] });
    stepUntil(sim, () => a.state === 'assumed', 60);
    expect(a.state).toBe('assumed');
    stepUntil(sim, () => !sim.readbackPending('BAF61') && !sim.freqBusy(), 20);
    sim.issue({ cs: 'BAF61', items: [{ k: 'xfr', unit: 'MIL' }] });
    stepUntil(sim, () => !sim.find('BAF61'), 900);
    expect(sim.events.some((e) => e.kind === 'exit_unxfr')).toBe(false);
  });
});
