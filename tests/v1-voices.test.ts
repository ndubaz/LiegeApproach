import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import type { Scenario, SpawnSpec } from '../src/engine/types';
import { CHALLENGES } from '../src/engine/scenarios';
import { assess } from '../src/engine/assess';
import { EVENT_DECK, freePlay, shiftCurveForHour, curveOf } from '../src/engine/traffic';
import { coordAdvice, releaseAdvice, suggest } from '../src/engine/suggest';
import { landingOrder, slotFor } from '../src/engine/sequence';
import { hints } from '../src/engine/hints';
import { autoControl } from '../src/engine/autopilot';
import { phraseology, readback } from '../src/engine/clearance';
import { bearing, dist, move, norm360, pointInPolygon } from '../src/geo';
import { glideAlt } from '../src/engine/pilot';

const pack = loadPack(EBLG);
const M22 = 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG';
function sc(spawns: SpawnSpec[], x: Partial<Scenario> = {}): Scenario {
  return { id: 'v1', title: 'v1', desc: '', seed: 7, durationMin: 60, startUtc: '02:00', metar: M22, runway: '22L', spawns, events: [], readbackErr: 0, noSayAgain: true, earlyTransferRate: 0, ...x };
}
const ARR = (cs: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t: 1, kind: 'arr', cs, type: 'B744', star: 'KOK7X', spawnDist: 40, ...x });
const DEP = (cs: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t: 1, kind: 'dep', cs, type: 'B77L', sid: 'LNO9S', ...x });
const stepUntil = (sim: Sim, f: () => boolean, max = 1200) => { const end = sim.t + max; while (!f() && sim.t < end && !sim.ended) sim.step(); return f(); };
const icom = (sim: Sim, from: string) => sim.log.filter((x) => x.channel === 'icom' && x.from === from).map((x) => x.text);
const assumed = (sim: Sim, cs: string) => stepUntil(sim, () => sim.find(cs)?.state === 'assumed' && !sim.freqBusy());
const settle = (sim: Sim, cs: string) => stepUntil(sim, () => !sim.readbackPending(cs) && !sim.freqBusy(), 40);
function onFinal(sim: Sim, cs: string, d: number, rwy = sim.rwy) {
  const a = sim.find(cs)!;
  a.p = move(rwy.thr, rwy.crs + 180, d); a.hdg = a.trk = rwy.crs; a.vs = 0; a.ias = 160;
  a.alt = glideAlt(rwy, d); a.mode = 'LOC'; a.route = []; a.app = { type: 'ILS', rwy, locCap: true, gsCap: true };
  a.cleared = a.cflSys = sim.levelFor(3000); a.tgtAlt = 3000;
  return a;
}

// ---------------------------------------------------------------- 1. Brussels coordination
describe('Brussels coordination', () => {
  it('sends an estimate 2 to 4 minutes before the transfer, and the arrival is handed over at the agreed level', () => {
    const sim = new Sim(pack, sc([ARR('CLX7HK', { t: 400 })]));
    stepUntil(sim, () => sim.estimates.length > 0, 400);
    const e = sim.estimates[0];
    expect(400 - sim.t).toBeGreaterThanOrEqual(120);
    expect(400 - sim.t).toBeLessThanOrEqual(240);
    expect(e).toMatchObject({ cs: 'CLX7HK', star: 'KOK7X', xfl: { fl: 80 }, state: 'expected' });
    const msg = icom(sim, 'BRU').slice(-1)[0]!;
    expect(msg).toMatch(/^Liège, Brussels, estimate CLX7HK, KOK7X, [A-Z]+ at \d\d, FL080$/);
    expect(msg).toContain(`${e.fix} at ${sim.utc(e.t).slice(3, 5)}`);
    stepUntil(sim, () => !!sim.find('CLX7HK'), 300);
    const a = sim.find('CLX7HK')!;
    expect(a.estimate).toEqual({ fix: e.fix, t: e.t, xfl: { fl: 80 } });
    expect(a.cleared).toEqual({ fl: 80 });
    expect(sim.estimates[0].state).toBe('handed');
  });

  it('when Brussels cannot make the level it says so, and the aircraft comes at the new level', () => {
    let found = false;
    for (let seed = 1; seed <= 400 && !found; seed++) {
      const sim = new Sim(pack, sc([ARR('CLX7HK', { t: 300 })], { seed }));
      stepUntil(sim, () => !!sim.find('CLX7HK'), 310);
      const said = icom(sim, 'BRU').find((t) => t.includes('will be'));
      if (!said) continue;
      found = true;
      expect(said).toBe('Liège, Brussels, CLX7HK will be FL090, unable lower due traffic');
      expect(sim.find('CLX7HK')!.cleared).toEqual({ fl: 90 });
      expect(sim.estimates[0]).toMatchObject({ revised: true, xfl: { fl: 90 } });
    }
    expect(found).toBe(true);
  });

  it('early transfer: approve brings it now at the offered level; unable keeps the plan; no answer costs CORD', () => {
    const mk = () => new Sim(pack, sc([ARR('KZR912', { t: 400, star: 'CIV7X' })], { earlyTransferRate: 1 }));
    // approve
    let sim = mk();
    stepUntil(sim, () => sim.coordReqs.length > 0, 400);
    const r = sim.coordReqs[0];
    expect(r).toMatchObject({ cs: 'KZR912', state: 'pending', level: { fl: 90 } });
    expect(icom(sim, 'BRU').slice(-1)[0]).toBe("Liège, Brussels, request early transfer of KZR912, he's maintaining FL090, can you take him?");
    expect(coordAdvice(sim, 'KZR912')?.ok).toBe(true);
    sim.step(); sim.step();
    expect(sim.issue({ cs: 'KZR912', items: [{ k: 'appr' }] }).ok).toBe(true);
    expect(icom(sim, 'ATC').slice(-1)[0]).toBe('Approved, KZR912 at FL090');
    const a = sim.find('KZR912')!;
    expect(a).toBeDefined();
    expect(sim.t).toBeLessThan(300);
    expect(a.cleared).toEqual({ fl: 90 });
    expect(Math.abs(a.alt - sim.ftOf({ fl: 90 }))).toBeLessThan(50);
    expect(a.alt).toBeLessThan(sim.ftOf(pack.sectorCeiling));
    expect(Math.hypot(a.p.x, a.p.y)).toBeLessThanOrEqual(pack.meta.sectorRadiusNm + 16.5);
    expect(sim.events.some((e) => e.kind === 'coord_answered')).toBe(true);
    stepUntil(sim, () => sim.t > 420, 500);
    expect(sim.aircraft.filter((x) => x.cs === 'KZR912').length).toBe(1); // not spawned twice
    // deny
    sim = mk();
    stepUntil(sim, () => sim.coordReqs.length > 0, 400);
    sim.issue({ cs: 'KZR912', items: [{ k: 'deny' }] });
    expect(icom(sim, 'ATC').slice(-1)[0]).toBe('Negative, KZR912 at FL080 as coordinated');
    expect(sim.find('KZR912')).toBeUndefined();
    stepUntil(sim, () => !!sim.find('KZR912'), 300);
    expect(sim.t).toBe(400);
    expect(sim.find('KZR912')!.cleared).toEqual({ fl: 80 });
    // no answer
    sim = mk();
    stepUntil(sim, () => !!sim.find('KZR912'), 500);
    expect(sim.t).toBe(400);
    expect(icom(sim, 'BRU').some((t) => t === 'Liège, Brussels, still need an answer on KZR912')).toBe(true);
    expect(sim.events.find((e) => e.kind === 'coord_unanswered')).toMatchObject({ comp: 'CORD', cost: 10 });
    sim.finish();
    expect(assess(sim).ratings.CORD).toBe(4);
  });

  it('departures go to Brussels climbing to the agreed FL090: lower is a CORD event', () => {
    for (const lvl of [{ fl: 70 }, { fl: 90 }]) {
      const sim = new Sim(pack, sc([DEP('CHG7302', { released: true })]));
      assumed(sim, 'CHG7302');
      sim.issue({ cs: 'CHG7302', items: [{ k: 'lvl', lvl }, { k: 'xfr', unit: 'BRU' }] });
      settle(sim, 'CHG7302');
      const ev = sim.events.filter((e) => e.kind === 'xfr_level');
      if (lvl.fl === 70) expect(ev[0]).toMatchObject({ comp: 'CORD', text: 'CHG7302: transferred cleared to FL070, agreed level FL090' });
      else expect(ev).toEqual([]);
      expect(sim.find('CHG7302')?.xfl ?? { fl: 90 }).toEqual({ fl: 90 });
    }
  });

  it('tutorial scenarios have no Brussels traffic on the intercom unless asked for', () => {
    const sim = new Sim(pack, sc([ARR('TST1', { t: 300 })], { tutorial: true }));
    stepUntil(sim, () => false, 320);
    expect(icom(sim, 'BRU')).toEqual([]);
    const sim2 = new Sim(pack, sc([ARR('TST1', { t: 300 })], { tutorial: true, coordination: true }));
    stepUntil(sim2, () => false, 320);
    expect(icom(sim2, 'BRU').length).toBe(1);
  });
});

// ---------------------------------------------------------------- 2. Military
describe('military notices and crossings', () => {
  const tsa = pack.tsas.find((x) => x.name === 'TSA29A')!;
  const centre = { x: tsa.poly.reduce((s, p) => s + p.x, 0) / tsa.poly.length, y: tsa.poly.reduce((s, p) => s + p.y, 0) / tsa.poly.length };

  it('MIL announces a TSA 5 minutes before it goes live, with its levels', () => {
    const sim = new Sim(pack, sc([ARR('LATE1', { t: 3000 })], { events: [{ t: 600, kind: 'tsa', name: 'TSA29A', on: true }, { t: 900, kind: 'tsa', name: 'TSA29A', on: false }] }));
    stepUntil(sim, () => icom(sim, 'MIL').length > 0, 600);
    expect(sim.t).toBe(300);
    expect(icom(sim, 'MIL')[0]).toBe('Liège, MIL, TSA 29A active from 0210, 4,500 ft to FL145');
    expect(sim.tsaPending.get('TSA29A')).toBe(600);
    stepUntil(sim, () => sim.tsaOn.has('TSA29A'), 400);
    expect(sim.t).toBe(600);
    expect(sim.tsaPending.size).toBe(0);
    stepUntil(sim, () => !sim.tsaOn.has('TSA29A'), 400);
    expect(icom(sim, 'MIL').slice(-1)[0]).toBe('Liège, MIL, TSA 29A released');
  });

  it('routing traffic into an announced TSA warns and counts against coordination', () => {
    const from = move(centre, 0, 14);
    while (pointInPolygon(from, tsa.poly)) from.y += 2;
    const sim = new Sim(pack, sc([{ t: 1, kind: 'ovf', cs: 'RCH101', type: 'C17', route: ['LNO'], from: { brg: 0, dist: 1 }, level: { fl: 80 }, callNow: true }], { events: [{ t: 400, kind: 'tsa', name: 'TSA29A', on: true }] }));
    assumed(sim, 'RCH101');
    stepUntil(sim, () => sim.tsaPending.has('TSA29A'), 200);
    const a = sim.find('RCH101')!;
    a.p = from; a.alt = sim.ftOf({ fl: 80 });
    const toward = Math.round(norm360(bearing(from, centre) - pack.meta.magVar) / 5) * 5;
    const w = sim.validate({ cs: 'RCH101', items: [{ k: 'hdg', hdg: toward }] });
    expect(w.some((x) => /^Heading into TSA29A, active from 0206/.test(x))).toBe(true);
    sim.issue({ cs: 'RCH101', items: [{ k: 'hdg', hdg: toward }] });
    expect(sim.events.find((e) => e.kind === 'tsa_routed')).toMatchObject({ comp: 'CORD', text: 'RCH101: routed into TSA 29A after the military notice' });
    // turning away is fine
    const n0 = sim.events.length;
    settle(sim, 'RCH101');
    sim.issue({ cs: 'RCH101', items: [{ k: 'hdg', hdg: norm360(toward + 180) || 360 }] });
    expect(sim.events.slice(n0).some((e) => e.kind === 'tsa_routed')).toBe(false);
  });

  it('a MIL crossing request names the route and a level block', () => {
    const sim = new Sim(pack, sc([{ t: 1, kind: 'mil', cs: 'BAF61', type: 'F35', formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: { fl: 70 }, spd: 300, request: { kind: 'climb', level: { fl: 150 } } }]));
    sim.step();
    const lo = sim.tl <= 60 ? 'FL060' : '6,000 ft';
    expect(icom(sim, 'MIL')[0]).toBe(`Approach, MIL, request crossing for BAF61 flight of 2, F35, via GILOM, ALHUV, VERVIERS, block ${lo} to FL080`);
    expect(sim.find('BAF61')!.request).toMatchObject({ kind: 'milxing', band: [sim.tl <= 60 ? { fl: 60 } : { ft: 6000 }, { fl: 80 }], route: ['GILOM', 'ALHUV', 'VERVIERS'] });
    sim.issue({ cs: 'BAF61', items: [{ k: 'appr' }] });
    expect(icom(sim, 'ATC').slice(-1)[0]).toBe(`BAF61 crossing approved via GILOM, ALHUV, VERVIERS, block ${lo} to FL080, call me on 119.280`);
  });
});

// ---------------------------------------------------------------- 3. Runway change
describe('runway change', () => {
  const windShift = { t: 60, kind: 'wind' as const, dir: 40, kt: 12 };
  it('tailwind over 5 kt: 10 minutes of notice, then 04R; established traffic lands 22L; the rest is re-cleared via the D arrivals', () => {
    const sim = new Sim(pack, sc([ARR('QTR8125', { callNow: true }), ARR('TAY4EK', { t: 420, star: 'CIV7X', callNow: true }), DEP('CHG7302', { t: 30 }), ARR('ETH3721', { t: 900, star: 'NIK7X' })], { events: [windShift] }));
    assumed(sim, 'QTR8125');
    stepUntil(sim, () => sim.t >= 60, 100);
    expect(sim.tailwind()).toBeGreaterThan(5);
    expect(sim.rwyChange).toMatchObject({ to: '04R', at: 660, reason: 'wind' });
    expect(icom(sim, 'SUP').slice(-1)[0]).toMatch(/^Runway change to 04R at 0211, tailwind 12 kt on 22L\./);
    expect(sim.runway).toBe('22L');
    expect(sim.releases[0].sid).toBe('LNO9S');
    assumed(sim, 'TAY4EK');
    stepUntil(sim, () => sim.t >= 655, 700);
    expect(sim.runway).toBe('22L');
    onFinal(sim, 'QTR8125', 8);
    sim.find('QTR8125')!.state = 'transferred'; sim.find('QTR8125')!.xfrUnit = 'TWR';
    stepUntil(sim, () => sim.runway === '04R', 20);
    expect(sim.t).toBe(660);
    expect(sim.releases[0]).toMatchObject({ sid: 'LNO2R', rwy: '04R' });
    expect(icom(sim, 'TWR').slice(-1)[0]).toBe('Approach, Tower, runway 04R: CHG7302 LNO2R');
    expect(icom(sim, 'SUP').slice(-1)[0]).toBe('Runway 04R in use. QTR8125 continues to 22L. Re-clear TAY4EK for 04R');
    expect(sim.needReclear().map((a) => a.cs)).toEqual(['TAY4EK']);
    // the suggestion is the matching D arrival, with the runway-change phraseology
    const tay = sim.find('TAY4EK')!;
    stepUntil(sim, () => !sim.freqBusy(), 30);
    const chip = suggest(sim, tay)[0];
    expect(chip).toMatchObject({ label: 'Runway 04R · CIV7D', primary: true, items: [{ k: 'star', name: 'CIV7D' }] });
    expect(sim.previewPhrase({ cs: 'TAY4EK', items: chip.items })!.text).toBe('TAY4EK, runway change, now runway 04R, expect ILS 04R, cleared CIV7D arrival');
    expect(hints(sim).some((h) => h.key === 'reclear:TAY4EK')).toBe(true);
    sim.issue({ cs: 'TAY4EK', items: chip.items });
    settle(sim, 'TAY4EK');
    expect(sim.log.filter((x) => x.from === 'PILOT' && x.cs === 'TAY4EK').slice(-1)[0]!.text).toBe('runway 04R, expect ILS 04R, cleared CIV7D arrival, TAY4EK');
    expect(tay.proc).toBe('CIV7D');
    expect(tay.expectRwy).toBe('04R');
    expect(tay.route.map((l) => l.fix)).toContain('RUDIX');
    expect(sim.needReclear()).toEqual([]);
    // the established aircraft lands on the old runway
    stepUntil(sim, () => sim.landings.some((l) => l.cs === 'QTR8125'), 400);
    expect(sim.events.find((e) => e.kind === 'landed' && e.cs === 'QTR8125')!.text).toBe('QTR8125 landed 22L');
    // later arrivals come on the D arrivals
    stepUntil(sim, () => !!sim.find('ETH3721'), 400);
    expect(sim.find('ETH3721')!.proc).toBe('NIK7D');
    expect(sim.find('ETH3721')!.expectRwy).toBe('04R');
  });

  it('a scheduled change with notice is announced first; one without notice happens at once', () => {
    const sim = new Sim(pack, sc([ARR('LATE1', { t: 3000 })], { events: [{ t: 30, kind: 'runway', rwy: '04R', notice: 300 }] }));
    stepUntil(sim, () => sim.t >= 31, 40);
    expect(sim.rwyChange?.at).toBe(330);
    expect(icom(sim, 'SUP').slice(-1)[0]).toMatch(/^Runway change to 04R at 0205\./);
    stepUntil(sim, () => sim.runway === '04R', 400);
    expect(sim.t).toBe(330);
    const now = new Sim(pack, sc([ARR('LATE1', { t: 3000 })], { events: [{ t: 30, kind: 'runway', rwy: '04R' }] }));
    stepUntil(now, () => now.runway === '04R', 100);
    expect(now.t).toBe(30);
    expect(now.log.some((x) => x.from === 'SUP' && /^Runway change to/.test(x.text))).toBe(false);
    // the runway-change challenge gives ten minutes of notice: announced at 04:01, made at 04:11
    const ch = new Sim(pack, CHALLENGES.find((c) => c.id === 'runway-change')!);
    stepUntil(ch, () => ch.runway === '04R', 700);
    expect(ch.t).toBe(660);
    expect(ch.log.some((x) => x.from === 'SUP' && /^Runway change to 04R at 0411\./.test(x.text))).toBe(true);
  });

  it('is in the night shift event deck and in the new challenge, which the autopilot flies through', () => {
    expect(EVENT_DECK.some((d) => d.card === 'runway')).toBe(true);
    let drawn = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = freePlay(pack, { template: 'shift', durationMin: 60, military: 1, weather: 'good', emergencies: false, difficulty: 2, seed });
      if (s.events.some((e) => e.kind === 'wind' && e.dir >= 20 && e.dir <= 60)) drawn++;
    }
    expect(drawn).toBeGreaterThan(0);
    const ch = CHALLENGES.find((c) => c.id === 'runway-change-night')!;
    expect(ch).toMatchObject({ tier: 3, title: 'Runway change at night' });
    const sim = new Sim(pack, ch);
    while (!sim.ended) { sim.step(); autoControl(sim); }
    expect(sim.lastRwyChange).toMatchObject({ from: '22L', to: '04R' });
    expect(sim.landings.length).toBeGreaterThanOrEqual(7);
    expect(sim.events.filter((e) => e.kind === 'goaround' && /unstable/.test(e.text))).toEqual([]);
  });
});

// ---------------------------------------------------------------- 4. Traffic by hour
describe('traffic by hour', () => {
  it('follows the Liège day: evening departures, night bank, sort, outbound bank, quiet morning', () => {
    const at = (h: number) => shiftCurveForHour(h, curveOf(pack));
    expect(at(19.5)).toMatchObject({ phase: 'evening' });
    expect(at(19.5).dep).toBeGreaterThan(at(19.5).arr);
    expect(at(1.5)).toMatchObject({ phase: 'bank' });
    expect(at(1.5).arr).toBeGreaterThanOrEqual(20);
    expect(at(3)).toMatchObject({ phase: 'sort' });
    expect(at(3).arr + at(3).dep).toBeLessThan(12);
    expect(at(4)).toMatchObject({ phase: 'outbound' });
    expect(at(4).dep).toBeGreaterThanOrEqual(18);
    expect(at(6.5)).toMatchObject({ phase: 'morning' });
    expect(at(6.5).arr + at(6.5).dep).toBeLessThanOrEqual(10);
    expect(at(12)).toMatchObject({ phase: 'day' });
    expect(at(25.5)).toEqual(at(1.5));
    let peak = 0;
    for (let h = 0; h < 24; h += 0.25) peak = Math.max(peak, at(h).arr + at(h).dep);
    expect(peak).toBeGreaterThanOrEqual(20);
    expect(peak).toBeLessThanOrEqual(28);
    expect(curveOf(pack).arr[0][0]).toBe(0);
  });

  it("free play's start hour drives the mix and the clock", () => {
    const run = (startHour: number) => {
      let arr = 0, dep = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const s = freePlay(pack, { template: 'night', durationMin: 75, military: 0, weather: 'good', emergencies: false, difficulty: 2, seed, startHour });
        arr += s.spawns.filter((x) => x.kind === 'arr').length; dep += s.spawns.filter((x) => x.kind === 'dep').length;
      }
      return { arr: arr / 8, dep: dep / 8 };
    };
    const bank = run(1), out = run(3.4), day = run(12);
    expect(bank.arr).toBeGreaterThan(3 * bank.dep);
    expect(out.dep).toBeGreaterThan(3 * out.arr);
    expect(bank.arr + bank.dep).toBeLessThanOrEqual(28 * 1.25);
    expect(day.arr).toBeLessThan(bank.arr);
    const s = freePlay(pack, { template: 'night', durationMin: 75, military: 0, weather: 'good', emergencies: false, difficulty: 2, seed: 4, startHour: 2.5 });
    expect(s.startUtc).toBe('02:30');
    expect(s.briefing).toMatch(/Starts in the night inbound bank, the sort from 0245Z, outbound bank from 0315Z\./);
    // without a start hour nothing changes
    const legacy = freePlay(pack, { template: 'shift', durationMin: 60, military: 1, weather: 'good', emergencies: false, difficulty: 2, seed: 7 });
    expect(legacy.startUtc).toBe('01:40');
  });
});

// ---------------------------------------------------------------- 5. Fatigue
describe('crew fatigue', () => {
  it('follows local time: 0 before 0030 local, full 0200 to 0600 local (UTC+1 by default, UTC+2 in summer)', () => {
    const f = (utc: string, off?: number) => new Sim(pack, sc([], { startUtc: utc, utcOffsetH: off })).fatigue();
    expect(f('23:00')).toBe(0);
    expect(f('00:15')).toBeCloseTo(0.5, 5);
    expect(f('01:00')).toBe(1);
    expect(f('04:59')).toBe(1);
    expect(f('09:00')).toBe(0);
    expect(f('04:30', 2)).toBeCloseTo(2 / 3, 5); // 0630 local, summer
    expect(new Sim(pack, sc([], { startUtc: '23:30' })).fatigue(3600)).toBeCloseTo(2 / 3, 5);
  });

  it('raises the wrong-readback and say-again rates and slows readbacks', () => {
    const trial = (utc: string) => {
      const sim = new Sim(pack, sc([ARR('TST1', { callNow: true })], { startUtc: utc, readbackErr: 0.1, noSayAgain: false, durationMin: 600 }));
      assumed(sim, 'TST1');
      const a = sim.find('TST1')!;
      let wrong = 0, sayAgain = 0, delay = 0, n = 0;
      for (let i = 0; i < 300; i++) {
        a.p = { x: -20, y: 0 }; a.mode = 'HDG'; a.hdgAssigned = a.hdg = 90; a.app = undefined;
        const lvl = { fl: i % 2 ? 80 : 90 };
        const before = sim.log.length;
        sim.issue({ cs: 'TST1', items: [{ k: 'lvl', lvl }] });
        const t1 = sim.log.slice(-1)[0]!.t1;
        settle(sim, 'TST1');
        const rb = sim.log.slice(before).find((x) => x.from === 'PILOT');
        if (rb) { delay += rb.t0 - t1; n++; if (rb.text.startsWith('Say again')) sayAgain++; }
        if (a.wrong) wrong++;
        a.wrong = undefined; a.awaitingSince = undefined;
      }
      return { wrong, sayAgain, delay: delay / n };
    };
    const fresh = trial('22:00'), tired = trial('03:00');
    expect(tired.wrong).toBeGreaterThan(fresh.wrong * 1.4);
    expect(tired.sayAgain + tired.wrong).toBeGreaterThan((fresh.sayAgain + fresh.wrong) * 1.4);
    expect(tired.delay).toBeGreaterThan(fresh.delay * 1.15);
  });
});

// ---------------------------------------------------------------- 6. Engine support for the console
describe('console support', () => {
  it("the player's landing order drives the AMAN order, the slot leader and '#n to land'", () => {
    const sim = new Sim(pack, sc([ARR('AAA1', { callNow: true, spawnDist: 30 }), ARR('BBB2', { t: 2, star: 'CIV7X', callNow: true })]));
    assumed(sim, 'AAA1'); assumed(sim, 'BBB2');
    const order0 = landingOrder(sim).map((x) => x.ac.cs);
    expect(order0[0]).toBe('AAA1');
    sim.setSequence(['BBB2', 'AAA1']);
    expect(landingOrder(sim).map((x) => [x.ac.cs, x.pos, x.sequenced])).toEqual([['BBB2', 1, true], ['AAA1', 2, true]]);
    sim.issue({ cs: 'BBB2', items: [{ k: 'app', app: 'ILS', rwy: '22L' }] });
    settle(sim, 'BBB2');
    const s = slotFor(sim, sim.find('AAA1')!);
    expect(s.pos).toBe(2);
    expect(s.leader?.cs).toBe('BBB2');
    expect(sim.cmdLog.slice(-2)[0]).toMatchObject({ op: 'seq', seq: ['BBB2', 'AAA1'] });
    // replay reproduces it
    const re = new Sim(pack, sim.sc);
    const cmds = sim.cmdLog.slice();
    let i = 0;
    while (re.t < sim.t) { re.step(); while (i < cmds.length && cmds[i].t === re.t) re.replay(cmds[i++]); }
    expect(re.sequence).toEqual(['BBB2', 'AAA1']);
    expect(re.find('BBB2')!.app?.rwy.id).toBe('22L');
  });

  it('departureGap gives the miles between the arrivals around the departure', () => {
    const sim = new Sim(pack, sc([ARR('QTR8125', { callNow: true }), ARR('TAY4EK', { t: 2, star: 'CIV7X', callNow: true }), DEP('CHG7302', { t: 3 })]));
    stepUntil(sim, () => !!sim.find('TAY4EK') && sim.releases.length > 0, 20);
    onFinal(sim, 'QTR8125', 3);
    onFinal(sim, 'TAY4EK', 9.5);
    const g = sim.departureGap('CHG7302');
    expect(g.after).toBe('QTR8125');
    expect(g.before).toBe('TAY4EK');
    expect(g.nm!).toBeGreaterThan(5);
    expect(g.nm!).toBeLessThan(7.5);
    expect(g.text).toBe(`Gap after QTR8125: ${g.nm!.toFixed(1)} NM to TAY4EK`);
    expect(releaseAdvice(sim, 'CHG7302').gap).toBe(g.text);
    const empty = new Sim(pack, sc([DEP('CHG7302')]));
    empty.step();
    expect(empty.departureGap('CHG7302')).toEqual({ nm: null, ok: true, text: 'No arrivals inbound' });
    expect(g.ok).toBe(false); // about 6.5 NM is too tight to fit a departure in
  });

  it('"correction, disregard" cancels a clearance whose readback has not started, and only then', () => {
    const sim = new Sim(pack, sc([ARR('TST1', { callNow: true })]));
    assumed(sim, 'TST1');
    const a = sim.find('TST1')!;
    const cfl0 = a.cflSys;
    sim.issue({ cs: 'TST1', items: [{ k: 'lvl', lvl: { fl: 70 } }] });
    expect(a.cflSys).toEqual({ fl: 70 });
    expect(sim.correct('TST1')).toBe(true);
    expect(sim.log.filter((x) => x.from === 'ATC').slice(-1)[0]!.text).toBe('TST1, correction, disregard');
    expect(a.cflSys).toEqual(cfl0);
    settle(sim, 'TST1');
    expect(a.cleared).toEqual(cfl0);
    expect(sim.log.filter((x) => x.from === 'PILOT').slice(-1)[0]!.text).toBe('Roger, TST1');
    expect(sim.cmdLog.slice(-1)[0]).toMatchObject({ op: 'correct', cl: { cs: 'TST1' } });
    // too late: the readback is done
    sim.issue({ cs: 'TST1', items: [{ k: 'lvl', lvl: { fl: 70 } }] });
    settle(sim, 'TST1');
    expect(sim.correct('TST1')).toBe(false);
    expect(a.cleared).toEqual({ fl: 70 });
  });

  it('"say again" makes the pilot repeat the last call', () => {
    const sim = new Sim(pack, sc([ARR('TST1', { callNow: true })]));
    stepUntil(sim, () => sim.log.some((x) => x.from === 'PILOT'), 30);
    stepUntil(sim, () => !sim.freqBusy(), 30);
    const call = sim.log.find((x) => x.from === 'PILOT')!.text;
    expect(phraseology({ cs: 'TST1', items: [{ k: 'sayagain' }] }, { alt: 8000, qnh: 1018, hdgMag: 0 }).text).toBe('TST1, say again');
    sim.issue({ cs: 'TST1', items: [{ k: 'sayagain' }] });
    expect(sim.log.slice(-1)[0]!.text).toBe('TST1, say again');
    stepUntil(sim, () => sim.log.filter((x) => x.from === 'PILOT').length > 1, 20);
    expect(sim.log.filter((x) => x.from === 'PILOT').slice(-1)[0]!.text).toBe(call);
    stepUntil(sim, () => !sim.freqBusy(), 10);
    expect(sim.find('TST1')!.awaitingSince).toBeDefined();
  });

  it('safety nets: STCA and LoS with time to closest approach, SFL mismatch, CLAM, MSAW, with stable ids', () => {
    const sim = new Sim(pack, sc([
      { t: 1, kind: 'ovf', cs: 'AAA1', type: 'A320', route: ['ALHUV', 'LG008'], from: { brg: 90, dist: 9 }, level: { fl: 80 }, callNow: true },
      { t: 1, kind: 'ovf', cs: 'BBB2', type: 'A320', route: ['ALHUV', 'GIKLI'], from: { brg: 270, dist: 9 }, level: { fl: 80 }, callNow: true },
    ], { durationMin: 10 }));
    stepUntil(sim, () => sim.safetyNets().some((n) => n.kind === 'STCA'), 200);
    const st = sim.safetyNets().find((n) => n.kind === 'STCA')!;
    expect(st).toMatchObject({ id: 'STCA:AAA1|BBB2', a: 'AAA1', b: 'BBB2' });
    if (st.kind !== 'STCA' && st.kind !== 'LOS') throw new Error();
    expect(st.tCpa).toBeGreaterThan(0);
    expect(st.tCpa).toBeLessThan(90);
    expect(st.cpaNm).toBeLessThan(1);
    const since = st.since;
    sim.step();
    expect(sim.safetyNets().find((n) => n.id === 'STCA:AAA1|BBB2')?.since).toBe(since);
    stepUntil(sim, () => sim.safetyNets().some((n) => n.kind === 'LOS'), 200);
    expect(sim.safetyNets().find((n) => n.kind === 'LOS')!.id).toBe('LOS:AAA1|BBB2');

    // SFL mismatch after a wrong readback, and CLAM when it flies through the cleared level
    const s2 = new Sim(pack, sc([ARR('TST1', { callNow: true })]));
    assumed(s2, 'TST1');
    const a = s2.find('TST1')!;
    a.p = { x: -25, y: 2 }; a.mode = 'HDG'; a.hdgAssigned = a.hdg = 90;
    a.alt = 6000; a.cleared = a.cflSys = { ft: 6000 }; a.tgtAlt = 6000; a.vs = 0;
    s2.forceWrong.add('TST1');
    s2.issue({ cs: 'TST1', items: [{ k: 'lvl', lvl: { ft: 5000 } }] });
    settle(s2, 'TST1');
    expect(a.cleared).not.toEqual({ ft: 5000 });
    s2.step();
    const sfl = s2.safetyNets().find((n) => n.kind === 'SFL');
    expect(sfl).toMatchObject({ id: 'SFL:TST1', cs: 'TST1', cfl: { ft: 5000 }, sfl: a.cleared });
    expect(s2.safetyNets().some((n) => n.kind === 'CLAM')).toBe(false);
    // the crew descends through the cleared 5,000 ft towards a wrong 4,000 ft: CLAM once 300 ft through it
    a.cleared = { ft: 4000 }; a.tgtAlt = 4000;
    stepUntil(s2, () => s2.safetyNets().some((n) => n.kind === 'CLAM'), 180);
    expect(a.alt).toBeLessThan(4710);
    expect(s2.safetyNets().find((n) => n.kind === 'CLAM')).toMatchObject({ id: 'CLAM:TST1', cfl: { ft: 5000 } });
    // MSAW: vectored below the minimum vectoring altitude
    const s3 = new Sim(pack, sc([ARR('LOW1', { callNow: true })]));
    assumed(s3, 'LOW1');
    const b = s3.find('LOW1')!;
    b.p = { x: 8, y: -14 }; b.mode = 'HDG'; b.hdgAssigned = b.hdg = 90;
    const mva = s3.mvaAt(b.p);
    b.alt = mva - 400; b.cleared = b.cflSys = s3.levelFor(Math.round((mva - 400) / 100) * 100); b.tgtAlt = b.alt; b.vs = 0;
    s3.step(); s3.step();
    expect(s3.safetyNets().find((n) => n.kind === 'MSAW')).toMatchObject({ id: 'MSAW:LOW1', cs: 'LOW1', mva });
  });
});

// ---------------------------------------------------------------- 7. Everything together
describe('suggestions, hints and grading with the new features', () => {
  it('Brussels requests get advice and a hint; CORD credits answers', () => {
    const sim = new Sim(pack, sc([ARR('KZR912', { t: 400, star: 'CIV7X' })], { earlyTransferRate: 1 }));
    stepUntil(sim, () => sim.coordReqs.length > 0, 400);
    stepUntil(sim, () => false, 25);
    expect(hints(sim).some((h) => h.key === 'bru:KZR912')).toBe(true);
    const adv = coordAdvice(sim, 'KZR912')!;
    sim.issue({ cs: 'KZR912', items: adv.items });
    sim.finish();
    const r = assess(sim);
    expect(r.ratings.CORD).toBe(5);
    expect(r.evidence.CORD).toContain('1 Brussels requests answered, 0 not');
  });

  it('the readback of a STAR re-clearance and the item chip', () => {
    const rb = readback('TAY4EK', [{ k: 'star', name: 'KOK7D' }], { alt: 8000, qnh: 1018, hdgMag: 0, starChange: { rwy: '04R', app: 'ILS' } });
    expect(rb.text).toBe('runway 04R, expect ILS 04R, cleared KOK7D arrival, TAY4EK');
    expect(phraseology({ cs: 'TAY4EK', items: [{ k: 'star', name: 'KOK7D' }] }, { alt: 8000, qnh: 1018, hdgMag: 0 }).text).toBe('TAY4EK, cleared KOK7D arrival');
  });

  it('determinism: the same seed and commands give the same coordination and nets', () => {
    const go = () => {
      const sim = new Sim(pack, CHALLENGES.find((c) => c.id === 'runway-change-night')!);
      while (sim.t < 1500) { sim.step(); autoControl(sim); }
      return JSON.stringify([sim.log.map((x) => x.text), sim.estimates, sim.coordReqs, sim.safetyNets().map((n) => n.id), sim.runway]);
    };
    expect(go()).toBe(go());
  });

  it('dist helper sanity (keeps the import used)', () => { expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5); });
});
