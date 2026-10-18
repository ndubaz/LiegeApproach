// The 2.0 independent review of the Düsseldorf pack: each fix has a test here (see docs/REALISM-EDDL.md).
import { describe, expect, it } from 'vitest';
import { loadPackById } from '../src/pack/index';
import { Sim } from '../src/engine/sim';
import { PERF, wakeNmOf } from '../src/engine/perf';
import { itemChip, phraseology } from '../src/engine/clearance';
import { freePlay, inCurfew, curfewText } from '../src/engine/traffic';
import { suggest } from '../src/engine/suggest';
import { A, D, scFactory } from '../src/ui/lessons/kit';

const pack = loadPackById('EDDL');
const liege = loadPackById('EBLG');
const sc = scFactory({ icao: 'EDDL', metar: 'EDDL 121250Z 24008KT 9999 FEW040 12/06 Q1018 NOSIG', runway: '23L', startUtc: '13:00' });
const until = (sim: Sim, cond: () => boolean, maxS = 1800) => { while (!cond() && sim.t < maxS && !sim.ended) sim.step(); return cond(); };

describe('H1 holds on the downwind, the STAR limit, unpublished holds', () => {
  it('the stacks are the downwind holds; the entry fixes have none', () => {
    const sim = new Sim(pack, sc('h1', []));
    expect(sim.stackFixes('23L')).toEqual(['DL429', 'DL409']);
    expect(sim.stackFixes('05R')).toEqual(['DL524', 'DL503']);
    expect(sim.entryFixes('23L')).toContain('BIKMU');
    for (const f of ['BIKMU', 'DOMUX', 'HALME', 'PISAP']) expect(pack.holds.some((h) => h.fix === f), f).toBe(false);
    expect(pack.holds.find((h) => h.fix === 'DUS')?.min.ft).toBe(3000);
  });

  it('an arrival left on its STAR continues to DUS and asks for an onward clearance', () => {
    const sim = new Sim(pack, sc('h1b', [A(1, 'EWG1AB', 'A320', 'BIKMU1A', 14)]));
    until(sim, () => sim.log.some((t) => t.cs === 'EWG1AB' && /continuing to DUS/.test(t.text)), 1500);
    expect(sim.log.some((t) => t.cs === 'EWG1AB' && /BIKMU, continuing to DUS on the arrival, request onward clearance/.test(t.text))).toBe(true);
  });

  it('a hold that is not published comes with the inbound track and the turns', () => {
    const sim = new Sim(pack, sc('h1c', [A(1, 'EWG1AB', 'A320', 'BIKMU1A', 40)]));
    until(sim, () => !!sim.find('EWG1AB') && sim.callers().some((a) => a.cs === 'EWG1AB'), 300);
    sim.issue({ cs: 'EWG1AB', items: [{ k: 'hold', fix: 'NVO' }, { k: 'lvl', lvl: { fl: 100 } }] });
    until(sim, () => sim.log.some((t) => t.from === 'ATC' && t.cs === 'EWG1AB' && /hold/.test(t.text)), 120);
    const said = sim.log.find((t) => t.from === 'ATC' && t.cs === 'EWG1AB' && /hold/.test(t.text))!.text;
    expect(said).toMatch(/hold at NVO, inbound track \d{3}, (left|right) turns/);
  });
});

describe('H2 conditional departure releases', () => {
  it('Tower launches a MEVEL departure without a release', () => {
    const sim = new Sim(pack, sc('h2', [D(5, 'EWG2KL', 'A320', 'MEVEL4T')]));
    until(sim, () => !!sim.find('EWG2KL'), 600);
    expect(sim.find('EWG2KL')).toBeDefined();
    expect(sim.log.some((t) => /request release/.test(t.text))).toBe(false);
  });

  it('a southern exit needs a release while the Köln agreement is in force, a northern one does not', () => {
    const sim = new Sim(pack, sc('h2b', [], { neighbourBusy: true }));
    expect(sim.needsRelease({ t: 0, kind: 'dep', cs: 'X', type: 'A320', sid: 'COL6T' })).toBe(true);
    expect(sim.needsRelease({ t: 0, kind: 'dep', cs: 'X', type: 'A320', sid: 'MEVEL4T' })).toBe(false);
    const quiet = new Sim(pack, sc('h2c', []));
    expect(quiet.needsRelease({ t: 0, kind: 'dep', cs: 'X', type: 'A320', sid: 'COL6T' })).toBe(false);
  });

  it('Liège still releases every departure', () => {
    const sim = new Sim(liege, { ...sc('h2d', []), icao: 'EBLG', runway: '22L' } as any);
    expect(sim.needsRelease({ t: 0, kind: 'dep', cs: 'X', type: 'B744', sid: 'CIV7Z' } as any)).toBe(true);
  });
});

describe('H3 and M7 wake: ICAO categories, the close parallels', () => {
  it('Düsseldorf uses the ICAO distances, Liège RECAT-EU', () => {
    const a332 = PERF.A332, a320 = PERF.A320, a388 = PERF.A388 ?? PERF.A332;
    expect(wakeNmOf('ICAO', a332, a320)).toBe(5);
    expect(wakeNmOf('ICAO', a320, a320)).toBe(3);
    if (PERF.A388) expect(wakeNmOf('ICAO', a388, a320)).toBe(7);
    expect(new Sim(pack, sc('w', [])).wakeMin({ perf: a332 }, { perf: a320 })).toBe(5);
    expect(pack.spec.meta.closeParallels).toBe(true);
    expect(liege.spec.wakeScheme).toBeUndefined();
  });
});

describe('H4 and M8 the night restriction', () => {
  it('no take-off 22:00 to 06:00 local, no landing 23:00 to 06:00', () => {
    expect(inCurfew(pack, 'dep', 22.5)).toBe(true);
    expect(inCurfew(pack, 'arr', 22.5)).toBe(false);
    expect(inCurfew(pack, 'arr', 23.5)).toBe(true);
    expect(inCurfew(pack, 'dep', 6.1)).toBe(false);
    expect(curfewText(pack)).toMatch(/22:00/);
  });

  it('a free-play hour from 22:00 local (21:00 UTC in winter) has arrivals but no departures', () => {
    const s = freePlay(pack, { template: 'day', durationMin: 60, military: 0, weather: 'good', emergencies: false, difficulty: 3, seed: 5, startHour: 21 });
    expect(s.spawns.filter((x) => x.kind === 'dep').length).toBe(0);
    expect(s.spawns.filter((x) => x.kind === 'arr').length).toBeGreaterThan(5);
  });
});

describe('H5 "expect ILS" and the approach clearance on the downwind', () => {
  it('the expect item has its own phrase and chip', () => {
    expect(itemChip({ k: 'expect', app: 'ILS', rwy: '23R' })).toBe('EXP ILS 23R');
    const p = phraseology({ cs: 'EWG1AB', items: [{ k: 'expect', app: 'ILS', rwy: '23R' }] }, {} as any);
    expect(p.text).toMatch(/expect ILS approach runway 23R/);
  });

  it('first contact: the lead chip is transition, level and expect, never the approach clearance', () => {
    const sim = new Sim(pack, sc('h5', [A(1, 'EWG1AB', 'A320', 'BIKMU1A', 18)], { runway: '23R' }));
    until(sim, () => sim.callers().some((a) => a.cs === 'EWG1AB') && !sim.readbackPending('EWG1AB'), 300);
    const s = suggest(sim, sim.find('EWG1AB')!)[0];
    expect(s.items.map((i) => i.k)).toEqual(expect.arrayContaining(['trans', 'expect']));
    expect(s.items.some((i) => i.k === 'app')).toBe(false);
  });
});

describe('M3 CTR traffic and M4 departures by direction and exit', () => {
  it('the departure transfer level and the next sector follow the runway direction and the exit', () => {
    const sim = new Sim(pack, sc('m4', []));
    expect(sim.depXfl).toEqual({ fl: 100 });
    const sim05 = new Sim(pack, sc('m4b', [], { runway: '05R' }));
    expect(sim05.depXfl).toEqual({ fl: 80 });
    const unit = (exitFix: string) => sim.xfrUnitFor({ exitFix } as any).id;
    expect(unit('MEVEL')).toBe('ACC');
    expect(unit('COL')).toBe('NOR');
    expect(unit('NUDGO')).toBe('PAD');
  });

  it('the HEMS and VFR patterns are Tower traffic', () => {
    const ctr = (pack.spec.traffic?.patterns ?? []).filter((p) => p.deck === 'hems');
    expect(ctr.length).toBe(2);
    for (const p of ctr) { expect(p.twr).toBe(true); expect(p.hoursLocal).toBeDefined(); }
  });
});
