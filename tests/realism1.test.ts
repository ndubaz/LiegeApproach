import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import type { Scenario, SpawnSpec } from '../src/engine/types';
import { DEP_S, depMinS } from '../src/engine/perf';
import { distToThr } from '../src/engine/pilot';
import { landingOrder, sequenceMembers, slotFor, bestTransition } from '../src/engine/sequence';
import { releaseAdvice, suggest } from '../src/engine/suggest';
import { freePlay } from '../src/engine/traffic';
import { phraseology, UNITS, unitName } from '../src/engine/clearance';
import { angDiff, crossTrack, move, norm360 } from '../src/geo';

// Fixes from the independent rated-controller validation of 1.0 (docs/REALISM.md, "Independent validation (1.0)").
const pack = loadPack(EBLG);
const M22 = 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG';
const M00 = 'EBLG 120140Z 00000KT 9999 FEW035 12/07 Q1013 NOSIG';
const sc = (spawns: SpawnSpec[], x: Partial<Scenario> = {}): Scenario => ({ id: 'r1', title: 'r1', desc: '', seed: 7, durationMin: 90, startUtc: '01:30', metar: M22, runway: '22L', spawns, events: [], readbackErr: 0, noSayAgain: true, earlyTransferRate: 0, coordination: false, ...x });
const stepUntil = (sim: Sim, f: () => boolean, max = 1200) => { const end = sim.t + max; while (!f() && sim.t < end && !sim.ended) sim.step(); return f(); };
const settle = (sim: Sim, cs: string) => stepUntil(sim, () => !sim.readbackPending(cs) && !sim.freqBusy(), 40);
const assumed = (sim: Sim, cs: string) => stepUntil(sim, () => sim.find(cs)?.state === 'assumed' && !sim.freqBusy());
const say = (sim: Sim, cs: string, items: Parameters<Sim['issue']>[0]['items']) => { sim.issue({ cs, items }); settle(sim, cs); };
const r22 = pack.runways.get('22L')!;

describe('1. departure wake (RECAT-EU time minima)', () => {
  it('has the departure table and never less than 60 s', () => {
    expect(DEP_S.BD).toBe(100);
    expect(depMinS('B', 'D')).toBe(100);
    expect(depMinS('A', 'F')).toBe(180);
    expect(depMinS('D', 'B')).toBe(60);
    expect(depMinS('D', 'D')).toBe(60);
  });
  it('Tower waits the wake time between a B744 and an A320 released together, and the advice says so', () => {
    const sim = new Sim(pack, sc([{ t: 1, kind: 'dep', cs: 'DH1', type: 'B744', sid: 'LNO9S' }, { t: 2, kind: 'dep', cs: 'DM1', type: 'A320', sid: 'LNO9S' }], { metar: M00 }));
    stepUntil(sim, () => sim.releases.length === 2, 10);
    sim.issue({ cs: 'DH1', items: [{ k: 'rel' }] });
    sim.issue({ cs: 'DM1', items: [{ k: 'rel' }] });
    const air: Record<string, number> = {};
    stepUntil(sim, () => {
      for (const r of sim.releases) if (r.state === 'airborne' && air[r.cs] === undefined) air[r.cs] = r.tAirborne!;
      if (air.DH1 !== undefined && air.DM1 === undefined) {
        const adv = releaseAdvice(sim, 'DM1');
        if (sim.depWakeWait('DM1').s > 0) expect(adv.why).toMatch(/waits \d+ s for wake behind DH1/);
      }
      return air.DM1 !== undefined;
    }, 400);
    expect(air.DM1 - air.DH1).toBeGreaterThanOrEqual(100);
  });
});

describe('2. the sequence counts everyone already committed to the final', () => {
  it('an arrival told to hold and then cleared for a transition is in the sequence; the next one is #2 behind it', () => {
    const sim = new Sim(pack, sc([
      { t: 1, kind: 'arr', cs: 'QTR1', type: 'B77L', star: 'LNO6X', spawnDist: 30 },
      { t: 150, kind: 'arr', cs: 'CHG2', type: 'B744', star: 'GESLO6X', spawnDist: 40 },
    ]));
    assumed(sim, 'QTR1');
    say(sim, 'QTR1', [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 4000 } }]);
    say(sim, 'QTR1', [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }, { k: 'spd', spd: 180 }]);
    const q = sim.find('QTR1')!;
    expect((q as any)._holdAt).toBeUndefined();
    assumed(sim, 'CHG2');
    const c = sim.find('CHG2')!;
    expect(sequenceMembers(sim, c).map((a) => a.cs)).toContain('QTR1');
    const slot = slotFor(sim, c, bestTransition(sim, c));
    expect(slot.leader?.cs).toBe('QTR1');
    expect(slot.pos).toBe(2);
    for (const s of suggest(sim, c)) expect(s.why).not.toMatch(/nobody ahead/);
  });

  it('two aircraft on converging transitions both count: a third is #3', () => {
    const sim = new Sim(pack, sc([
      { t: 1, kind: 'arr', cs: 'AAA1', type: 'B77L', star: 'LNO6X', spawnDist: 25 },
      { t: 2, kind: 'arr', cs: 'BBB2', type: 'B744', star: 'CIV7X', spawnDist: 30 },
      { t: 240, kind: 'arr', cs: 'CCC3', type: 'B763', star: 'KOK7X', spawnDist: 40 },
    ]));
    assumed(sim, 'AAA1'); assumed(sim, 'BBB2');
    say(sim, 'AAA1', [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }]);
    say(sim, 'BBB2', [{ k: 'hold', fix: 'ALHUV' }]);
    say(sim, 'BBB2', [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }]);
    assumed(sim, 'CCC3');
    const c = sim.find('CCC3')!;
    const mem = sequenceMembers(sim, c).map((a) => a.cs).sort();
    expect(mem).toEqual(['AAA1', 'BBB2']);
    const slot = slotFor(sim, c, bestTransition(sim, c));
    expect(slot.pos).toBe(3);
    expect(['AAA1', 'BBB2']).toContain(slot.leader?.cs);
    const order = landingOrder(sim).map((x) => x.ac.cs);
    expect(order.indexOf('CCC3')).toBe(2);
  });
});

describe('3. wake behind, not only on the localizer', () => {
  it('an A320 3.2 NM directly behind a B744 at the same level on vectors is a wake infringement (4 NM)', () => {
    const sim = new Sim(pack, sc([
      { t: 1, kind: 'arr', cs: 'HVY1', type: 'B744', star: 'KOK7X', spawnDist: 40, level: { ft: 5000 }, alt: 5000, spd: 220 },
      { t: 1, kind: 'arr', cs: 'MED1', type: 'A320', star: 'KOK7X', spawnDist: 40, level: { ft: 5000 }, alt: 5000, spd: 220 },
    ], { metar: M00 }));
    stepUntil(sim, () => !!sim.find('HVY1') && !!sim.find('MED1'), 5);
    const h = sim.find('HVY1')!, m = sim.find('MED1')!;
    const p0 = { x: -25, y: 10 };
    for (const [a, d] of [[h, 0], [m, 3.2]] as const) { a.p = move(p0, 270, d); a.hdg = a.trk = 90; a.mode = 'HDG'; a.hdgAssigned = 90; a.route = []; a.ias = 220; a.alt = 5000; a.tgtAlt = 5000; a.vs = 0; }
    stepUntil(sim, () => sim.t > 130, 140);
    sim.finish();
    const w = sim.events.find((e) => e.kind === 'wake');
    expect(w?.text).toMatch(/^Wake: MED1 3\.\d NM behind HVY1, minimum 4 NM$/);
  });
});

describe('4. no speeding up on the localizer without an instruction', () => {
  it('an A320 at 160 kt on the localizer at 11 NM stays at 160 kt or less', () => {
    const sim = new Sim(pack, sc([{ t: 1, kind: 'arr', cs: 'L1', type: 'A320', star: 'KOK7X', spawnDist: 40, level: { ft: 3000 }, alt: 3000, spd: 160 }], { metar: M00 }));
    stepUntil(sim, () => !!sim.find('L1'), 5);
    const a = sim.find('L1')!;
    a.p = move(r22.thr, r22.crs + 180, 11); a.hdg = a.trk = r22.crs; a.mode = 'LOC'; a.route = []; a.ias = 160; a.alt = 3000;
    a.app = { type: 'ILS', rwy: r22, locCap: true, gsCap: false };
    let maxIas = 0;
    stepUntil(sim, () => { maxIas = Math.max(maxIas, a.ias); return distToThr(a.p, r22) < 5; }, 400);
    expect(maxIas).toBeLessThanOrEqual(160.01);
  });
});

describe('5. speed chips do not flip-flop', () => {
  it('no "Speed 180" chip right after a 170 kt instruction', () => {
    const sim = new Sim(pack, sc([{ t: 1, kind: 'arr', cs: 'S1', type: 'B744', star: 'LNO6X', spawnDist: 30 }]));
    assumed(sim, 'S1');
    say(sim, 'S1', [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }]);
    const a = sim.find('S1')!;
    stepUntil(sim, () => sim.dthr(a) < 17, 900);
    say(sim, 'S1', [{ k: 'spd', spd: 170 }]);
    for (let i = 0; i < 60; i++) {
      sim.step();
      for (const s of suggest(sim, a)) for (const it of s.items) if (it.k === 'spd') expect(it.spd, s.label).toBeLessThanOrEqual(160);
    }
  });
});

describe('6 and 7. holds: within the published band, never twice, expected approach time', () => {
  it('a hold chip never carries a level above the published maximum, and an aircraft already told to hold gets no second hold', () => {
    const spawns: SpawnSpec[] = ['H1', 'H2', 'H3', 'H4'].map((cs, i) => ({ t: 1 + i * 60, kind: 'arr', cs, type: 'B77L', star: i % 2 ? 'CIV7X' : 'KOK7X', spawnDist: 35 } as SpawnSpec));
    const sim = new Sim(pack, sc(spawns));
    for (const cs of ['H1', 'H2', 'H3', 'H4']) {
      assumed(sim, cs);
      const a = sim.find(cs)!;
      const ss = suggest(sim, a);
      for (const s of ss) {
        const h = s.items.find((i) => i.k === 'hold') as { fix: string } | undefined;
        if (!h) continue;
        const hold = pack.holds.find((x) => x.fix === h.fix)!;
        const lv = (s.items.find((i) => i.k === 'lvl') as any)?.lvl ?? a.cleared;
        expect(sim.ftOf(lv), s.label).toBeLessThanOrEqual(sim.ftOf(hold.max) + 50);
        expect(sim.ftOf(lv), s.label).toBeGreaterThanOrEqual(sim.ftOf(hold.min) - 50);
      }
      const hold = ss.find((s) => s.items.some((i) => i.k === 'hold'));
      if (hold) {
        say(sim, cs, hold.items);
        for (const s of suggest(sim, a)) expect(s.items.some((i) => i.k === 'hold'), s.label).toBe(false);
      }
    }
  });

  it('says "expected approach time", revises it only with an EAT item, and the crew calls when it runs out', () => {
    const ctx = { alt: 5000, qnh: 1018, hdgMag: 0 };
    expect(phraseology({ cs: 'DHK7', items: [{ k: 'hold', fix: 'ALHUV' }] }, { ...ctx, efc: '0214' }).text).toBe('DHK7, hold at ALHUV as published, expected approach time 0214');
    expect(phraseology({ cs: 'DHK7', items: [{ k: 'eat' }] }, { ...ctx, efc: '0225' })).toEqual({ text: 'DHK7, revised expected approach time 0225', speech: 'World Express seven, revised expected approach time zero two two five' });
    const sim = new Sim(pack, sc([{ t: 1, kind: 'arr', cs: 'AAA1', type: 'B77L', star: 'KOK7X', spawnDist: 20 }, { t: 2, kind: 'arr', cs: 'BBB2', type: 'B77L', star: 'CIV7X', spawnDist: 20 }]));
    assumed(sim, 'AAA1'); assumed(sim, 'BBB2');
    say(sim, 'AAA1', [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 4000 } }]);
    say(sim, 'BBB2', [{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 5000 } }]);
    const b = sim.find('BBB2')!;
    expect(b.efc).toBeDefined();
    expect(sim.validate({ cs: 'BBB2', items: [{ k: 'eat' }] })).toEqual([]);
    stepUntil(sim, () => sim.log.some((x) => x.from === 'PILOT' && x.cs === 'BBB2' && /approach time expired, request onward clearance/.test(x.text)), 1800);
    expect(sim.log.some((x) => x.from === 'PILOT' && /approach time expired, request onward clearance/.test(x.text))).toBe(true);
    stepUntil(sim, () => !sim.freqBusy(), 30);
    const before = b.efc!;
    sim.issue({ cs: 'BBB2', items: [{ k: 'eat' }] });
    expect(sim.log.filter((x) => x.from === 'ATC').slice(-1)[0].text).toMatch(/^BBB2, (revised expected approach time \d{4}|no delay expected)$/);
    settle(sim, 'BBB2');
    expect(b.efcCalled).toBe(false);
    if (b.efc !== undefined) expect(b.efc).toBeGreaterThan(before);
  });
});

describe('9. 250 kt below FL100 only outside class C', () => {
  it('classes the airspace: D in the CTR, C in the TMA and the Brussels CTA, G below them', () => {
    const sim = new Sim(pack, sc([]));
    expect(sim.airspaceClassAt({ x: 0, y: 0 }, 1500)).toBe('D');
    expect(sim.airspaceClassAt({ x: 0, y: 0 }, 4000)).toBe('C');
    expect(sim.airspaceClassAt({ x: 0, y: 0 }, 8000)).toBe('C');
    expect(sim.airspaceClassAt({ x: 30, y: 25 }, 3000)).toBe('G');
    expect(sim.speedLimitAt({ x: 0, y: 0 }, 8000)).toBe(false);
    expect(sim.speedLimitAt({ x: 0, y: 0 }, 8000, true)).toBe(true);
    expect(sim.speedLimitAt({ x: 0, y: 0 }, 1500)).toBe(true);
  });
  it('no speed-limit event for an IFR arrival at 280 kt in class C', () => {
    const sim = new Sim(pack, sc([{ t: 1, kind: 'arr', cs: 'F1', type: 'B77L', star: 'KOK7X', spawnDist: 30, level: { fl: 80 }, alt: 8000, spd: 280 }], { metar: M00 }));
    assumed(sim, 'F1');
    const a = sim.find('F1')!;
    a.p = { x: 5, y: 5 }; a.mode = 'HDG'; a.hdgAssigned = a.hdg = 90; a.spdAssigned = 280; a.route = [];
    expect(sim.validate({ cs: 'F1', items: [{ k: 'spd', spd: 280 }] })).not.toContain('Above 250 kt below FL100');
    stepUntil(sim, () => sim.t > 100, 100);
    expect(sim.events.some((e) => e.kind === 'speed_limit')).toBe(false);
  });
});

describe('10. intercom answers work before the aircraft exists', () => {
  it('approve on a Brussels request validates clean and is accepted with no aircraft yet', () => {
    const sim = new Sim(pack, sc([{ t: 400, kind: 'arr', cs: 'KZR912', type: 'B744', star: 'CIV7X' }], { earlyTransferRate: 1, coordination: true }));
    stepUntil(sim, () => sim.coordReqs.length > 0, 400);
    expect(sim.find('KZR912')).toBeUndefined();
    expect(sim.isIntercomAnswer({ cs: 'KZR912', items: [{ k: 'appr' }] })).toBe('coord');
    expect(sim.validate({ cs: 'KZR912', items: [{ k: 'appr' }] })).toEqual([]);
    expect(sim.issue({ cs: 'KZR912', items: [{ k: 'deny' }] }).ok).toBe(true);
    expect(sim.coordReqs[0].state).toBe('denied');
  });
});

describe('11. localizer capture', () => {
  const fly = (ang: number, dTh: number) => {
    const sim = new Sim(pack, sc([{ t: 1, kind: 'arr', cs: 'L1', type: 'B744', star: 'KOK7X', spawnDist: 40, level: { ft: 3000 }, alt: 3000, spd: 180 }], { metar: M00 }));
    stepUntil(sim, () => !!sim.find('L1'), 5);
    assumed(sim, 'L1');
    const a = sim.find('L1')!;
    const p = move(move(r22.thr, r22.crs + 180, dTh), r22.crs + 90, 4);
    const ih = norm360(r22.crs - ang);
    a.p = p; a.hdg = a.trk = ih; a.mode = 'HDG'; a.hdgAssigned = ih; a.ias = 180; a.alt = 3000; a.tgtAlt = 3000; a.route = []; a.vs = 0;
    const warn = sim.validate({ cs: 'L1', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] });
    sim.issue({ cs: 'L1', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] });
    const side = Math.sign(crossTrack(p, r22.thr, r22.crs));
    let over = 0;
    stepUntil(sim, () => {
      const x = crossTrack(a.p, r22.thr, r22.crs);
      if (a.app?.locCap && Math.sign(x) !== side) over = Math.max(over, Math.abs(x));
      return (!!a.app?.locCap && Math.abs(angDiff(a.trk, r22.crs)) < 2 && Math.abs(x) < 0.05) || !!a.remove;
    }, 600);
    return { warn, over };
  };
  it('overshoots more at steeper intercepts, about none at 30°', () => {
    const o30 = fly(30, 16).over, o60 = fly(60, 15).over, o90 = fly(90, 15).over;
    expect(o30).toBeLessThan(0.15);
    expect(o60).toBeGreaterThan(o30);
    expect(o90).toBeGreaterThan(0.5);
  });
  it('warns when the heading meets the localizer inside the FAF', () => {
    expect(fly(30, 10).warn).toContain('Intercept inside the FAF');
    expect(fly(30, 16).warn).not.toContain('Intercept inside the FAF');
  });
});

describe('12. TSA 29A is a daytime area in free-play briefings too', () => {
  it('a night session with military 2 has no TSA 29A activation', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const night = freePlay(pack, { template: 'night', durationMin: 60, military: 2, weather: 'good', emergencies: false, difficulty: 2, seed });
      expect(night.events.some((e) => e.kind === 'tsa')).toBe(false);
      expect(night.briefing ?? '').not.toMatch(/TSA 29A active/);
    }
  });
});

describe('15 and 16. units and the departure check-in', () => {
  it('one unit table with the AIP Beek frequency', () => {
    expect(UNITS.BEEK.freq).toBe('123.980');
    expect(unitName('BEEK').text).toBe('Beek Approach 123.980');
    expect(UNITS.MIL.callsign).toBe('Military');
    expect(unitName('MIL').text).toBe('Military 129.100');
  });
  it('says "passing two thousand ... feet climbing"', () => {
    const sim = new Sim(pack, sc([{ t: 1, kind: 'dep', cs: 'QTR8125', type: 'B77L', sid: 'LNO9S', released: true }], { metar: M00 }));
    stepUntil(sim, () => sim.log.some((x) => x.from === 'PILOT' && x.cs === 'QTR8125'), 60);
    const c = sim.log.find((x) => x.from === 'PILOT' && x.cs === 'QTR8125')!;
    expect(c.speech).toMatch(/passing (one|two|three) thousand( [a-z]+ hundred)? feet climbing flight level six zero/);
    expect(c.speech).not.toMatch(/ {2}/);
  });
});
