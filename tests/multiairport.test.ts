import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { loadPackById, PACKS, DEFAULT_PACK, airportList } from '../src/pack/index';
import { EBLG } from '../src/pack/eblg';
import { ZZTF } from './synthetic-pack';
import { Sim } from '../src/engine/sim';
import { freePlay, dailyShift, templatesOf, curveOf, shiftCurveForHour } from '../src/engine/traffic';
import { chipBot, sepCounts } from './chipbot';
import { suggest } from '../src/engine/suggest';
import { unitName, UNITS, telephony } from '../src/engine/clearance';
import { spokenText } from '../src/voice/speech-text';
import { groupsFor, setCastingPack, unitGroupsOf } from '../src/voice/casting';
import { assess } from '../src/engine/assess';
import { presetMetar, isDst } from '../src/engine/weather';
import { PERF } from '../src/engine/perf';

const tf = loadPack(ZZTF);
const lg = loadPack(EBLG);
const LIEGE = /Li[eè]ge|Brussels|ALHUV|Beek|Maastricht|Steenokkerzeel|EBLG|TSA/;

describe('pack registry', () => {
  it('lists Liège as the default and compiles it on demand', () => {
    expect(DEFAULT_PACK).toBe('EBLG');
    expect(Object.keys(PACKS)).toContain('EBLG');
    expect(loadPackById('EBLG').meta.icao).toBe('EBLG');
    expect(loadPackById('EBLG')).toBe(loadPackById('EBLG'));
    expect(loadPackById('XXXX').meta.icao).toBe('EBLG');
    expect(airportList()[0]).toMatchObject({ icao: 'EBLG', name: 'Liège', callsign: 'Liège Approach', country: 'BE' });
  });
  it('the Liège pack carries its 2.0 fields and the engine derives the same values it used to assume', () => {
    expect(lg.stackFix).toBe('ALHUV');
    expect(lg.depXfl).toEqual({ fl: 90 });
    expect(lg.utcOffsetWinter).toBe(1);
    expect(lg.reservedAreasName).toBe('TSA');
    expect(lg.runwayConfigs).toEqual([{ land: '22L', dep: '22L' }, { land: '04R', dep: '04R' }]);
    expect(lg.units.map((u) => u.id)).toEqual(['TWR', 'BRU', 'MIL', 'BEEK', 'MUAC', 'SUP']);
    const sim = new Sim(lg, { id: 't', title: 't', desc: '', seed: 1, durationMin: 5, startUtc: '02:00', metar: presetMetar(lg, 'good'), spawns: [], events: [], readbackErr: 0 });
    expect(sim.runway).toBe('22L');
    expect(sim.depRunway).toBe('22L');
    expect(sim.acc.id).toBe('BRU');
    expect(sim.accCall).toBe('Liège, Brussels');
    expect(sim.stackFixes()).toEqual(['ALHUV']);
    expect(sim.vfrSquawk(0)).toBe('6330');
    expect(sim.vfrSquawk(11)).toBe('6343');
    expect(sim.airspaceClassAt({ x: 0, y: 0 }, 1000)).toBe('D');
    expect(sim.airspaceClassAt({ x: 30, y: 30 }, 6000)).toBe('C');
    expect(sim.airspaceClassAt({ x: 30, y: 30 }, 2000)).toBe('G');
    expect(presetMetar(lg, 'good')).toBe('EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG');
    expect(presetMetar(lg, 'lvp')).toBe('EBLG 120140Z 21004KT 0300 R22L/0350 FG VV001 08/08 Q1022 NOSIG');
    expect(templatesOf(lg).shift).toMatchObject({ title: 'Night shift', start: '01:40' });
    expect(unitName('TWR').text).toBe('Liège Tower 118.130');
  });
});

describe('a second airport from its pack alone', () => {
  it('compiles with two parallel runways in a pair, an IAF per side, holds and a curfew', () => {
    expect(tf.runwayConfigs[0]).toMatchObject({ land: '23L', dep: '23R' });
    expect(tf.stackFix).toBe('WEST');
    expect(tf.depXfl).toEqual({ fl: 70 });
    expect(tf.reservedAreasName).toBe('ED-R');
    const curve = curveOf(tf);
    // 00:00 to 04:00 UTC is 01:00 to 05:00 local: curfew
    expect(shiftCurveForHour(1, curve)).toMatchObject({ arr: 0, dep: 0, phase: 'curfew' });
    expect(shiftCurveForHour(6.5, curve).arr).toBeGreaterThan(8);
    const t = templatesOf(tf);
    expect(t.night.arrPerHr).toBeGreaterThan(0);
    expect(t.day.arrPerHr).toBeGreaterThan(5);
    expect(t.shift.title).toMatch(/shift$/);
  });

  it('runs a 30-minute free-play shift under the chip bot on the right runways with the right names', () => {
    const sc = freePlay(tf, { template: 'day', durationMin: 30, military: 1, weather: 'good', emergencies: false, difficulty: 1, seed: 11, startHour: 6.75 });
    expect(sc.icao).toBe('ZZTF');
    expect(sc.metar.startsWith('ZZTF ')).toBe(true);
    expect(sc.runway).toBe('23L');
    expect(sc.briefing).toContain('Runway 23L landing, 23R departures');
    expect(sc.spawns.filter((s) => s.kind === 'arr').length).toBeGreaterThanOrEqual(3);
    expect(sc.spawns.filter((s) => s.kind === 'dep').length).toBeGreaterThanOrEqual(2);
    for (const s of sc.spawns) {
      if (s.kind === 'arr') expect(['ALFA1A', 'BRAVO1A']).toContain(s.star);
      if (s.kind === 'dep') expect(['NORD1S', 'SUED1S']).toContain(s.sid);
      expect(s.cs).not.toMatch(/^OO/);
    }
    const sim = new Sim(tf, sc);
    expect(sim.runway).toBe('23L');
    expect(sim.depRunway).toBe('23R');
    expect(sim.tl).toBe(70);
    expect(sim.atisText()).toContain('landing runway 23L, departure runway 23R');
    while (!sim.ended) { sim.step(); chipBot(sim); }
    const c = sepCounts(sim);
    expect(c.landed).toBeGreaterThanOrEqual(2);
    expect(c.los).toBe(0);
    // arrivals land on 23L, departures roll from 23R
    for (const e of sim.events.filter((x) => x.kind === 'landed')) expect(e.text).toMatch(/landed 23L$/);
    const relTx = sim.log.filter((x) => x.channel === 'icom' && /request release/.test(x.text));
    expect(relTx.length).toBeGreaterThanOrEqual(2);
    for (const x of relTx) { expect(x.text).toMatch(/runway 23R$/); expect(x.from).toBe('TWR'); }
    expect(sim.departuresHandled).toBeGreaterThanOrEqual(1);
    const deps = sim.spawnLog.filter((s) => s.kind === 'dep');
    expect(deps.length).toBeGreaterThanOrEqual(2);
    // the centre's estimates and the pilots' calls carry the pack's names
    const est = sim.log.filter((x) => x.from === 'LANGEN' && /estimate/.test(x.text));
    expect(est.length).toBeGreaterThanOrEqual(2);
    for (const x of est) expect(x.text).toMatch(/^Testfeld, Langen, estimate /);
    const checkIns = sim.log.filter((x) => x.from === 'PILOT' && /information [A-Z]$/.test(x.text));
    expect(checkIns.length).toBeGreaterThanOrEqual(3);
    for (const x of checkIns) expect(x.text).toMatch(/^Testfeld Director, /);
    // transfers go to the pack's units, with their frequencies
    const toTwr = sim.log.filter((x) => x.from === 'ATC' && /contact Testfeld Tower 118\.500/.test(x.text));
    expect(toTwr.length).toBeGreaterThanOrEqual(3);
    const toAcc = sim.log.filter((x) => x.from === 'ATC' && /contact Langen Radar 127\.000/.test(x.text));
    expect(toAcc.length).toBeGreaterThanOrEqual(1);
    expect(sim.log.some((x) => /Eurowings|Condor|Lufthansa/.test(x.speech))).toBe(true);
    // nothing says Liège, Brussels or ALHUV
    for (const x of sim.log) { expect(x.text).not.toMatch(LIEGE); expect(x.speech).not.toMatch(LIEGE); }
    for (const e of sim.events) expect(e.text).not.toMatch(LIEGE);
    for (const a of sim.aircraft) for (const s of suggest(sim, a)) { expect(s.label).not.toMatch(LIEGE); expect(s.why).not.toMatch(LIEGE); }
    const r = assess(sim);
    expect(r.ratings.SEPC).not.toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/Brussels|ALHUV/);
  });

  it('suggests the transition from the aircraft\'s own IAF and the hold at it', () => {
    const sc = freePlay(tf, { template: 'day', durationMin: 30, military: 0, weather: 'good', emergencies: false, difficulty: 1, seed: 3 });
    const sim = new Sim(tf, sc);
    while (!sim.aircraft.some((a) => a.state === 'assumed' && a.kind === 'arr')) sim.step();
    const a = sim.aircraft.find((x) => x.state === 'assumed' && x.kind === 'arr')!;
    const iaf = a.route[a.route.length - 1].fix;
    expect(['WEST', 'EAST']).toContain(iaf);
    expect(sim.stackFixOf(a)).toBe(iaf);
    const s = suggest(sim, a);
    const tr = s.find((x) => x.items.some((i) => i.k === 'trans'));
    expect(tr).toBeDefined();
    expect((tr!.items.find((i) => i.k === 'trans') as { name: string }).name).toBe(iaf === 'WEST' ? 'WEST1L' : 'EAST1L');
    expect(tr!.items.some((i) => i.k === 'app' && i.rwy === '23L')).toBe(true);
    const res = sim.issue({ cs: a.cs, items: [{ k: 'hold', fix: iaf }, { k: 'lvl', lvl: { fl: 70 } }] });
    expect(res.warnings).toEqual([]);
  });

  it('keeps a curfew empty and says so, and the daily shift is built from the pack', () => {
    const sc = freePlay(tf, { template: 'day', durationMin: 30, military: 0, weather: 'good', emergencies: false, difficulty: 1, seed: 5, startHour: 1 });
    expect(sc.spawns.length).toBe(0);
    expect(sc.briefing).toMatch(/curfew/);
    const d = dailyShift(tf, new Date(2026, 6, 14));
    expect(d.id).toBe('daily-20260714');
    expect(d.date).toBe('2026-07-14');
    expect(d.briefing?.startsWith('Daily shift.')).toBe(true);
    expect(d.spawns.length).toBeGreaterThan(3);
    expect(isDst('2026-07-14')).toBe(true);
    expect(isDst('2026-12-14')).toBe(false);
    const sim = new Sim(tf, d);
    expect(sim.utcOffsetH).toBe(2);
  });

  it('runs the 05 operation after a runway change: 05R landing, 05L departures', () => {
    const sc = freePlay(tf, { template: 'day', durationMin: 30, military: 0, weather: 'good', emergencies: false, difficulty: 1, seed: 8 });
    const sim = new Sim(tf, { ...sc, events: [{ t: 30, kind: 'runway', rwy: '05R' }] });
    while (sim.t < 60) sim.step();
    expect(sim.runway).toBe('05R');
    expect(sim.depRunway).toBe('05L');
    expect(sim.log.some((x) => x.from === 'SUP' && /Runway 05R in use/.test(x.text))).toBe(true);
    while (!sim.ended) { sim.step(); chipBot(sim); }
    for (const e of sim.events.filter((x) => x.kind === 'landed')) expect(e.text).toMatch(/landed 05R$/);
    for (const x of sim.log.filter((x) => /request release/.test(x.text))) expect(x.text).toMatch(/runway 05L$/);
    expect(sim.landings.length).toBeGreaterThanOrEqual(2);
  });

  it('names its reserved areas ED-R and its military unit on the intercom', () => {
    const sc = freePlay(tf, { template: 'day', durationMin: 20, military: 0, weather: 'good', emergencies: false, difficulty: 1, seed: 2 });
    const sim = new Sim(tf, { ...sc, events: [{ t: 400, kind: 'tsa', name: 'ED-R117', on: true }] });
    while (sim.t < 420) sim.step();
    const mil = sim.log.filter((x) => x.from === 'MIL');
    expect(mil[0].text).toBe('Testfeld, MIL, ED-R 117 active from ' + sim.utc(400).slice(0, 5).replace(':', '') + ', 0 ft to FL100');
    expect(sim.areasName).toBe('ED-R');
  });

  it('casts unit voices and says fixes from the pack', () => {
    expect(unitGroupsOf(tf)).toMatchObject({ TWR: ['de'], LANGEN: ['de'], ATC: ['de'] });
    setCastingPack(tf);
    expect(groupsFor('LANGEN')).toEqual(['de']);
    setCastingPack(lg);
    expect(groupsFor('TWR')).toEqual(['fr']);
    expect(groupsFor('BRU')).toEqual(['nl', 'fr']);
    expect(spokenText('Testfeld, Langen, estimate EWG123, ALFA1A, WEST at 38, FL080', tf)).toBe('Test-felt, Lang-en, estimate Eurowings one two three, Alfa one Alfa, West at three eight, flight level eight zero');
    expect(spokenText('Liège, Brussels, estimate QTR8125, KOK7X, ALHUV at 38, FL080', lg)).toBe('Leeyezh, Brussels, estimate Qatari eight one two five, K O K seven X-ray, Al-hoov at three eight, flight level eight zero');
    expect(telephony('DEABC', {}, ['DE'])).toBe('Delta Echo Alfa Bravo Charlie');
    expect(UNITS.TWR.callsign).toBeDefined();
  });

  it('has the passenger-hub fleet in the performance table', () => {
    for (const t of ['A319', 'A320', 'A321', 'A20N', 'A21N', 'B738', 'B38M', 'A332', 'A333', 'A339', 'A359', 'B77W', 'B788', 'B789', 'A388', 'B752', 'B753', 'E190', 'E195', 'E290', 'CRJ9', 'AT76', 'DH8D', 'B463', 'F2TH', 'C56X', 'CL60', 'GLF6']) {
      expect(PERF[t], t).toBeDefined();
      expect(PERF[t].vapp).toBeGreaterThan(100);
      expect(PERF[t].vminClean).toBeGreaterThan(PERF[t].vapp);
    }
    expect(PERF.A388.recat).toBe('A');
    expect(PERF.B77W.recat).toBe('B');
    expect(PERF.A20N.recat).toBe('D');
    expect(PERF.E195.recat).toBe('E');
  });
});
