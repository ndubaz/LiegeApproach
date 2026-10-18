import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EDDL } from '../src/pack/eddl';
import { EBLG } from '../src/pack/eblg';
import { PERF } from '../src/engine/perf';
import { gcDistance, bearing, dist, pointInPolygon } from '../src/geo';

const pack = loadPack(EDDL);
const ll = (id: string) => pack.fixes.get(id)!.ll;
const p = (id: string) => pack.fixes.get(id)!.p;

describe('EDDL pack: loads and is self-consistent', () => {
  it('loads through loadPack with the published aerodrome data', () => {
    expect(pack.meta.icao).toBe('EDDL');
    expect(pack.meta.transitionAltitude).toBe(5000);
    expect(pack.meta.elevation).toBe(147);
    expect(pack.meta.appCallsign).toBe('Langen Radar');
    expect(pack.meta.appFreq).toBe('128.555');
    expect(pack.meta.twrFreq).toBe('118.305');
    expect(pack.meta.atisFreq).toBe('123.780');
    expect(pack.runways.size).toBe(4);
    expect(pack.stars.length).toBe(5);
    expect(pack.transitions.length).toBe(11);
    expect(pack.sids.length).toBe(44);
    expect(pack.spec.country).toBe('DE');
    expect(pack.spec.utcOffsetWinter).toBe(1);
    expect(pack.spec.stackFix).toBe('BIKMU');
  });

  it('every procedure fix, hold fix, missed approach fix, VFR route point and map line point exists', () => {
    const procs = [...pack.spec.stars, ...pack.spec.transitions, ...pack.spec.sids];
    for (const pr of procs) for (const l of pr.legs) expect(EDDL.fixes[l.fix], `${pr.name} leg ${l.fix}`).toBeDefined();
    for (const s of EDDL.sids) expect(EDDL.fixes[s.exitFix], `${s.name} exit`).toBeDefined();
    for (const h of EDDL.holds) expect(EDDL.fixes[h.fix], `hold ${h.fix}`).toBeDefined();
    for (const r of EDDL.runways) {
      expect(EDDL.fixes[r.if.fix], `${r.id} IF`).toBeDefined();
      expect(EDDL.fixes[r.faf.fix], `${r.id} FAF`).toBeDefined();
      for (const m of r.missed) expect(EDDL.fixes[m], `${r.id} missed ${m}`).toBeDefined();
    }
    for (const v of EDDL.vfrRoutes) for (const f of v.points) expect(EDDL.fixes[f], `VFR ${v.name} ${f}`).toBeDefined();
    for (const m of EDDL.mapLines) for (const f of m.points) expect(EDDL.fixes[f], `map ${m.name} ${f}`).toBeDefined();
    expect(EDDL.fixes[EDDL.stackFix!]).toBeDefined();
  });

  it('every STAR ends at an entry fix that a transition starts from, and the stack fix is one of them', () => {
    const starts = new Set(pack.transitions.map((t) => t.legs[0].fix));
    for (const s of pack.stars) {
      const end = s.legs[s.legs.length - 1].fix;
      expect(starts.has(end), `${s.name} ends at ${end}`).toBe(true);
      expect(s.legs.length).toBeGreaterThanOrEqual(2);
    }
    expect(starts.has(EDDL.stackFix!)).toBe(true);
    // every runway in use has a transition from the stack fix
    for (const rwy of EDDL.preferredRunways) {
      const other = pack.runways.get(rwy)!;
      const pair = pack.strips.find((s) => s.ends.includes(rwy))!;
      const dir = rwy.slice(0, 2);
      const rwysInDir = [...pack.runways.keys()].filter((r) => r.startsWith(dir));
      expect(pack.transitions.some((t) => t.legs[0].fix === EDDL.stackFix && t.runways.some((r) => rwysInDir.includes(r))), `stack transition for ${rwy}`).toBe(true);
      expect(pair).toBeDefined();
      expect(other).toBeDefined();
    }
  });

  it('each transition ends at the final approach fix of its runway, on the localizer, 8.8 to 8.9 NM out', () => {
    for (const t of pack.transitions) {
      const end = t.legs[t.legs.length - 1];
      for (const rid of t.runways) {
        const r = pack.runways.get(rid)!;
        expect([r.faf, r.ifFix], `${t.name} -> ${rid}`).toContain(end.fix);
        const faf = pack.fixes.get(r.faf)!;
        const d = dist(faf.p, r.thr);
        expect(d).toBeGreaterThan(8.7);
        expect(d).toBeLessThan(9.0);
        // the FAF sits on the localizer course
        const b = bearing(faf.p, r.thr);
        expect(Math.abs(((b - r.crs + 540) % 360) - 180)).toBeLessThan(0.5);
        // FAF altitude 3,000 ft agrees with a 3 degree path from threshold elevation plus TCH (within 150 ft)
        const glide = r.elevation + (r.tch ?? 50) + d * 6076 * Math.tan((3 * Math.PI) / 180);
        expect(Math.abs(glide - r.fafAlt)).toBeLessThan(150);
      }
      // speed limit 220 kt from the first K220 waypoint to the end
      expect(end.spd).toBe(220);
      expect(end.min?.ft).toBe(3000);
    }
  });

  it('intermediate fixes lie on the localizer 4 NM outside the FAF', () => {
    for (const r of pack.runways.values()) {
      const ifx = pack.fixes.get(r.ifFix)!, faf = pack.fixes.get(r.faf)!;
      expect(dist(ifx.p, faf.p)).toBeCloseTo(4, 1);
      expect(Math.abs(((bearing(ifx.p, r.thr) - r.crs + 540) % 360) - 180)).toBeLessThan(0.5);
      expect(r.ifAlt).toBeGreaterThanOrEqual(r.fafAlt);
    }
  });

  it('holds are on fixes with sane bands, and the downwind holds sit on the downwind tracks', () => {
    for (const h of pack.holds) {
      expect(pack.fixes.has(h.fix)).toBe(true);
      const lo = h.min.fl !== undefined ? h.min.fl * 100 : h.min.ft!;
      const hi = h.max.fl !== undefined ? h.max.fl * 100 : h.max.ft!;
      expect(hi).toBeGreaterThan(lo);
      expect(h.spd).toBeGreaterThanOrEqual(220);
    }
    const dus = pack.holds.find((h) => h.fix === 'DUS')!;
    expect(dus.min.ft).toBe(3000);
    // the transition charts (3-1-3, 3-1-4) publish no holding at the entry fixes
    for (const f of ['BIKMU', 'DOMUX', 'HALME', 'PISAP']) expect(pack.holds.some((h) => h.fix === f), `no hold at ${f}`).toBe(false);
    // the centre's en-route holds are not in the AD section: ATC describes them
    for (const f of ['NVO', 'ELDAR', 'DOMEG']) expect(pack.holds.find((h) => h.fix === f)!.published).toBe(false);
    // the stacks are the downwind holds, per runway direction
    expect(EDDL.stacksByDirection).toEqual({ '23': ['DL429', 'DL409'], '05': ['DL524', 'DL503'] });
    // the 23 downwind holds are on the 050 (053 true) track between DL426 and DL430 / DL406 and DL410
    expect(bearing(p('DL426'), p('DL429'))).toBeCloseTo(53, 0);
    expect(bearing(p('DL406'), p('DL409'))).toBeCloseTo(53, 0);
    // the 05 downwind holds are on the 230 (233 true) track
    expect(Math.abs(bearing(p('RONAD'), p('DL524')) - 233)).toBeLessThan(1);
    expect(Math.abs(bearing(p('DL502'), p('DL503')) - 233)).toBeLessThan(1);
    for (const h of pack.holds.filter((x) => x.fix.startsWith('DL'))) {
      expect(h.max.fl).toBe(70);
      expect(h.min.ft).toBe(4000);
    }
  });

  it('runways pair into two parallel strips with the AIP lengths and displaced thresholds', () => {
    expect(pack.strips.length).toBe(2);
    for (const s of pack.strips) {
      const [a, b] = s.ends.map((id) => pack.runways.get(id)!);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(Math.abs(((a.crs - b.crs + 540) % 360) - 180)).toBeCloseTo(180, 1);
      expect(a.lengthM).toBe(b.lengthM);
      // the drawn strip is the full runway length, within 10 m
      expect(Math.abs(dist(s.a, s.b) * 1852 - a.lengthM)).toBeLessThan(10);
      // threshold to threshold is the landing distance available (AD 2.13), 2,400 m or 2,696 m
      const thr2thr = dist(a.thr, b.thr) * 1852;
      expect(Math.abs(thr2thr - (a.lengthM - 2 * (a.lengthM === 2700 ? 300 : 301)))).toBeLessThan(10);
    }
    // the two runways are parallel and about 500 m apart
    const [s1, s2] = pack.strips;
    expect(Math.abs(bearing(s1.a, s1.b) - bearing(s2.a, s2.b))).toBeLessThan(0.1);
    const sep = Math.abs((s2.a.x - s1.a.x) * Math.cos(52.8 * Math.PI / 180) - (s2.a.y - s1.a.y) * Math.sin(52.8 * Math.PI / 180)) * 1852;
    expect(sep).toBeGreaterThan(400);
    expect(sep).toBeLessThan(600);
    for (const r of pack.runways.values()) expect(['I', 'III']).toContain(r.ils!.cat);
  });

  it('MVA covers the sector and the TMA, and nothing published is below the vectoring altitude under it', () => {
    const sample = (poly: { x: number; y: number }[]) => {
      // every vertex and the centroid of the polygon are inside some MVA area
      const pts = [...poly, { x: poly.reduce((s, q) => s + q.x, 0) / poly.length, y: poly.reduce((s, q) => s + q.y, 0) / poly.length }];
      for (const q of pts) expect(pack.mva.some((m) => pointInPolygon(q, m.poly)), `MVA at ${q.x.toFixed(1)},${q.y.toFixed(1)}`).toBe(true);
    };
    sample(pack.tma.poly);
    sample(pack.ctr.poly);
    for (const part of pack.tmaParts!) sample(part.poly);
    // 40 NM ring
    for (let a = 0; a < 360; a += 15) {
      const q = { x: Math.sin(a * Math.PI / 180) * 40, y: Math.cos(a * Math.PI / 180) * 40 };
      expect(pack.mva.some((m) => pointInPolygon(q, m.poly)), `MVA on the 40 NM ring at ${a}`).toBe(true);
    }
    // the FAFs (3,000 ft) and the downwind holds (4,000 ft) are above the MVA beneath them
    const mvaAt = (q: { x: number; y: number }) => pack.mva.find((m) => pointInPolygon(q, m.poly))?.alt ?? 3000;
    for (const r of pack.runways.values()) expect(mvaAt(pack.fixes.get(r.faf)!.p)).toBeLessThanOrEqual(r.fafAlt);
    for (const h of pack.holds) expect(mvaAt(h.p)).toBeLessThanOrEqual(h.min.fl !== undefined ? h.min.fl * 100 : h.min.ft!);
  });

  it('airspace: CTR class D to 2,500 ft, sector to FL155, class C steps, ED-R 111', () => {
    expect(pack.ctr.cls).toBe('D');
    expect(pack.ctr.ceiling.ft).toBe(2500);
    expect(pack.ctr.poly.length).toBeGreaterThan(8);
    // the ARP and both runways are inside the CTR
    expect(pointInPolygon({ x: 0, y: 0 }, pack.ctr.poly)).toBe(true);
    for (const r of pack.runways.values()) expect(pointInPolygon(r.thr, pack.ctr.poly)).toBe(true);
    expect(pack.sectorCeiling.fl).toBe(155);
    expect(pack.tma.ceiling.fl).toBe(155);
    expect(pack.tmaParts!.length).toBe(12);
    expect(pack.tmaParts!.map((t) => t.floor.ft ?? t.floor.fl)).toEqual([1500, 2000, 2500, 2500, 3500, 3500, 4500, 4500, 65, 65, 85, 85]);
    for (const t of pack.tmaParts!) expect(t.ceiling.fl).toBe(100);
    // the field and the CTR lie under area D (2,500 ft); the Essen side under A (1,500 ft)
    const part = (n: string) => pack.tmaParts!.find((t) => t.name.endsWith(' ' + n))!;
    expect(pointInPolygon({ x: 0, y: 0 }, part('D').poly)).toBe(true);
    expect(pointInPolygon(p('EDLE'), part('A').poly)).toBe(true);
    expect(pointInPolygon(p('EDLN'), part('C').poly)).toBe(true);
    expect(pointInPolygon(p('EDDK'), part('E').poly)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, pack.tma.poly)).toBe(true);
    expect(pack.tsas.map((t) => t.name)).toEqual(['ED-R 111', 'Dortmund area']);
    expect(pack.tsas[0].ceiling.ft).toBe(2300);
  });

  it('transition level table follows the ENR 1.7 rule: at least 1,000 ft above 5,000 ft', () => {
    for (const row of pack.meta.tlTable!) {
      for (const qnh of [row.qnhMin, row.qnhMax]) {
        const ft = row.fl * 100 + (qnh - 1013.25) * 27;
        // the level is at least 1,000 ft above the 5,000 ft transition altitude (30 ft of rounding at the band edge)
        expect(ft).toBeGreaterThanOrEqual(5970);
        // and the next lower flight level would not be
        expect((row.fl - 10) * 100 + (qnh - 1013.25) * 27).toBeLessThan(6030);
      }
    }
    expect(pack.meta.tlTable!.map((r) => r.fl)).toEqual([80, 70, 60]);
    // FL060 needs QNH 1014: at 1013 hPa it is 5,993 ft
    expect(pack.meta.tlTable!.find((r) => r.fl === 60)!.qnhMin).toBe(1014);
  });
});

describe('EDDL pack: 2.0 fields', () => {
  it('units validate: one tower, one acc, one ground, ids unique, frequencies well formed, voices known', () => {
    const units = EDDL.units!;
    const ids = units.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(units.filter((u) => u.role === 'tower').length).toBe(1);
    expect(units.filter((u) => u.role === 'acc').length).toBe(1);
    expect(units.filter((u) => u.role === 'ground').length).toBe(1);
    expect(units.find((u) => u.role === 'tower')!.freq).toBe(EDDL.meta.twrFreq);
    const groups = new Set(['de', 'uk', 'nl', 'fr', 'us', 'ca', 'ie', 'scot', 'in', 'ar', 'es', 'zh', 'ko', 'vi', 'sa', 'au']);
    for (const u of units) {
      expect(u.freq === '' || /^\d{3}\.\d{3}$/.test(u.freq), `${u.id} freq ${u.freq}`).toBe(true);
      expect(u.label.length).toBeGreaterThan(0);
      expect(u.source.length).toBeGreaterThan(0);
      for (const v of u.voices ?? []) expect(groups.has(v), `${u.id} voice ${v}`).toBe(true);
    }
    // the player's own frequency is not a unit, the departure and the feeder are
    expect(units.some((u) => u.freq === '128.555')).toBe(false);
    expect(units.some((u) => u.freq === '121.355')).toBe(true);
    expect(units.some((u) => u.freq === '128.655')).toBe(true);
  });

  it('traffic validates: every type exists in PERF, weights positive, demand has 24 hours and a night curfew', () => {
    const t = EDDL.traffic!;
    for (const op of [...t.pax, ...t.cargo, ...t.bank, ...(t.military ?? [])]) {
      expect(op.w).toBeGreaterThanOrEqual(0);
      expect(/^[A-Z]{3}$/.test(op.op), op.op).toBe(true);
      for (const ty of op.types) expect(PERF[ty], `${op.op} type ${ty}`).toBeDefined();
    }
    expect(t.bank.length).toBe(0);
    expect(t.demand!.length).toBe(24);
    for (const h of t.demand!) {
      expect(h.perHour).toBeGreaterThanOrEqual(0);
      expect(h.paxShare).toBeGreaterThan(0.5);
    }
    // AD 2.20: no take-offs 22:00 to 06:00 local, no scheduled landings 23:00 to 06:00 (delayed to 23:30)
    for (const h of [22, 23, 0, 1, 2, 3, 4, 5]) expect(t.demand![h].dep ?? 0).toBe(0);
    for (const h of [0, 1, 2, 3, 4, 5]) expect(t.demand![h].perHour).toBeLessThanOrEqual(1);
    expect(t.demand![23].arr).toBeLessThanOrEqual(4);
    // the 06:00 departure wave and the 22:00 arrival hour
    expect(t.demand![6].dep!).toBeGreaterThan(3 * t.demand![6].arr!);
    expect(t.demand![22].arr!).toBeGreaterThanOrEqual(20);
    expect(t.demand![21].arr!).toBeGreaterThan(t.demand![21].dep!);
    for (const h of t.demand!) expect((h.arr ?? 0) + (h.dep ?? 0)).toBe(h.perHour);
    // a real day: 400 to 500 movements, morning and evening peaks
    const total = t.demand!.reduce((s, h) => s + h.perHour, 0);
    expect(total).toBeGreaterThan(400);
    expect(total).toBeLessThan(500);
    expect(t.demand![7].perHour).toBeGreaterThan(t.demand![13].perHour);
    expect(t.demand![17].perHour).toBeGreaterThan(t.demand![13].perHour);
    // STAR and SID tables name real procedures
    for (const s of t.arrStars!) expect(pack.stars.some((x) => x.name === s.name), s.name).toBe(true);
    for (const [rwy, sids] of Object.entries(t.depSids!)) {
      expect(pack.runways.has(rwy)).toBe(true);
      for (const s of sids) {
        const sid = pack.sids.find((x) => x.name === s.name);
        expect(sid, s.name).toBeDefined();
        expect(sid!.runways).toContain(rwy);
      }
    }
    // telephony for every operator the engine does not know
    for (const op of t.pax) expect(op.telephony ?? t.telephony![op.op] ?? ['THY', 'QTR', 'RYR'].includes(op.op), `telephony ${op.op}`).toBeTruthy();
    expect(EDDL.curfew).toBeDefined();
    expect(EDDL.parallelOps!.length).toBe(2);
  });

  it('fixSay covers every five-letter fix used by a procedure or hold', () => {
    const used = new Set<string>();
    for (const pr of [...pack.stars, ...pack.transitions, ...pack.sids]) for (const l of pr.legs) used.add(l.fix);
    for (const h of pack.holds) used.add(h.fix);
    for (const f of used) if (/^[A-Z]{5}$/.test(f)) expect(EDDL.fixSay![f], `fixSay ${f}`).toBeDefined();
  });

  it('SIDs: initial climb 5,000 ft (the transition altitude), each runway has a departure set, exits are fixes', () => {
    for (const s of pack.sids) {
      expect(s.initialClimb.ft).toBe(5000);
      expect(s.runways.length).toBe(1);
      expect(pack.fixes.has(s.exitFix)).toBe(true);
      expect(s.legs[s.legs.length - 1].fix).toBe(s.exitFix);
    }
    for (const rwy of pack.runways.keys()) expect(pack.sids.filter((s) => s.runways.includes(rwy)).length).toBeGreaterThanOrEqual(11);
    // 23L and 05R carry the normal departures; the northern runway SIDs are ATC discretion
    for (const s of pack.sids.filter((x) => x.runways[0] === '23R' || x.runways[0] === '05L')) expect(s.atcDiscretion).toBe(true);
  });
});

describe('EDDL pack: geometry against the AIP', () => {
  it('transition legs reproduce the chart distances and true tracks (AD 2 EDDL 3-1-3, 3-1-4)', () => {
    const leg = (a: string, b: string, nm: number, trueTrack: number) => {
      expect(gcDistance(ll(a), ll(b)), `${a}-${b} dist`).toBeCloseTo(nm, 0);
      expect(Math.abs(bearing(p(a), p(b)) - trueTrack), `${a}-${b} track`).toBeLessThan(0.6);
    };
    leg('PISAP', 'VALSU', 20.1, 167.3);
    leg('PISAP', 'AGEDA', 14.2, 92.5);
    leg('AGEDA', 'XAMOD', 7.0, 143.0);
    leg('HALME', 'XAMOD', 2.6, 249.3);
    leg('XAMOD', 'DL422', 12.0, 233.1);
    leg('HALME', 'BOMBA', 9.9, 200.7);
    leg('BOMBA', 'DL517', 5.2, 233.1);
    leg('DOLAV', 'DL502', 18.6, 226.0);
    leg('DOMUX', 'DOLAV', 13.7, 270.6);
    leg('ELDAR', 'DL501', 10.8, 49.5);
    leg('DL501', 'DL502', 5.0, 322.9);
    leg('BIKMU', 'DL426', 25.7, 26.1);
    leg('BIKMU', 'RONAD', 11.9, 337.7);
    leg('RONAD', 'DL513', 6.1, 331.1);
    leg('LMA', 'IBIKO', 10.7, 60.6);
    leg('IBIKO', 'GAPNU', 6.0, 142.7);
    leg('VALSU', 'GAPNU', 5.4, 186.8);
    leg('DL422', 'DL426', 6.0, 142.9);
    leg('DOMUX', 'DL402', 6.4, 236.5);
    leg('DL405', 'DL406', 5.0, 323.1);
    leg('LMA', 'DL426', 22.9, 71.6);
  });

  it('STARs reproduce the AD 2 EDDL 3-1-2 distances to the DUS VOR', () => {
    const near = (a: string, nm: number) => expect(Math.abs(gcDistance(ll(a), ll('DUS')) - nm), `${a}-DUS`).toBeLessThan(0.6);
    near('BIKMU', 11); near('DOMUX', 31); near('HALME', 30); near('LMA', 14); near('PISAP', 31);
    // magnetic tracks to DUS (variation 3 E): 013, 251, 210, 108, 169
    const mag = (a: string) => (bearing(p(a), p('DUS')) - 3 + 360) % 360;
    expect(mag('BIKMU')).toBeCloseTo(13, -1);
    expect(mag('DOMUX')).toBeCloseTo(251, -1);
    expect(mag('HALME')).toBeCloseTo(210, -1);
    expect(mag('LMA')).toBeCloseTo(108, -1);
    expect(mag('PISAP')).toBeCloseTo(169, -1);
  });

  it('the ARP is 4 NM north of the city and the neighbours lie where the AIP puts them', () => {
    expect(gcDistance(ll('DUESSELDORF'), { lat: 51 + 16 / 60 + 51.33 / 3600, lon: 6 + 45 / 60 + 26.32 / 3600 })).toBeCloseTo(4, 0);
    expect(gcDistance(ll('EDDK'), ll('DUS'))).toBeGreaterThan(28);
    expect(gcDistance(ll('EDDK'), ll('DUS'))).toBeLessThan(32);
    expect(gcDistance(ll('EDLN'), ll('DUS'))).toBeGreaterThan(9);
    expect(gcDistance(ll('EDLN'), ll('DUS'))).toBeLessThan(11);
    expect(gcDistance(ll('EDLW'), ll('DUS'))).toBeGreaterThan(34);
    expect(gcDistance(ll('EDLV'), ll('DUS'))).toBeGreaterThan(29);
  });

  it('the two packs do not share a fix table and both load', () => {
    const liege = loadPack(EBLG);
    expect(liege.meta.icao).toBe('EBLG');
    expect(pack.fixes.has('ALHUV')).toBe(false);
    expect(liege.fixes.has('BIKMU')).toBe(false);
  });
});
