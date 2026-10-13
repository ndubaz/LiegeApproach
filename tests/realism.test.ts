// Locks in facts validated against the skeyes eAIP (AIRAC effective 01 OCT 2026) and ICAO
// Doc 4444 / Doc 9432 phraseology. See docs/REALISM.md for sources and remaining deviations.
import { describe, it, expect } from 'vitest';
import { loadPack, tlFromTable } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { gcDistance, parseLatLon, pointInPolygon, type LatLon } from '../src/geo';
import { freqSpeech, phraseology, readback, unitName, type Ctx } from '../src/engine/clearance';

const pack = loadPack(EBLG);
const ll = (id: string) => pack.fixes.get(id)!.ll;
const R = (id: string) => EBLG.runways.find((r) => r.id === id)!;
const thr = (id: string) => parseLatLon(R(id).thr.lat, R(id).thr.lon);
const DEG = Math.PI / 180;
/** Initial great-circle course, true. */
function course(a: LatLon, b: LatLon) {
  const la1 = a.lat * DEG, la2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(la2), x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}
const angErr = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('aerodrome data (EBLG AD 2.2, 2.12, 2.18, 2.19)', () => {
  it('runway thresholds, courses, elevations and lengths', () => {
    expect(R('22L')).toMatchObject({ thr: { lat: '503852.63N', lon: '0052739.08E' }, crsTrue: 225.16, elevation: 595, lengthM: 3690 });
    expect(R('04R')).toMatchObject({ thr: { lat: '503743.10N', lon: '0052548.82E' }, crsTrue: 45.16, elevation: 644, lengthM: 3690 });
    expect(R('22R')).toMatchObject({ thr: { lat: '503845.91N', lon: '0052713.03E' }, crsTrue: 225.16, elevation: 577, lengthM: 2340 });
    expect(R('04L')).toMatchObject({ thr: { lat: '503752.59N', lon: '0052548.50E' }, crsTrue: 45.16, elevation: 629, lengthM: 2340 });
    expect(EBLG.meta.elevation).toBe(651);
    expect(EBLG.meta.arp).toEqual({ lat: '503811N', lon: '0052634E' });
  });
  it('threshold geometry agrees with the published true bearing', () => {
    // 22R and 04L share a strip end to end (2,340 m); 04R is displaced, so 22L-04R is shorter than the runway.
    expect(angErr(course(thr('22R'), thr('04L')), 225.16)).toBeLessThan(0.05);
    expect(gcDistance(thr('22R'), thr('04L')) * 1852).toBeCloseTo(2340, -1);
    expect(angErr(course(thr('22L'), thr('04R')), 225.16)).toBeLessThan(0.05);
    expect(gcDistance(thr('22L'), thr('04R')) * 1852).toBeLessThan(3690);
  });
  it('runway designators follow the magnetic course (variation 2°E)', () => {
    for (const r of EBLG.runways) {
      const mag = r.crsTrue - EBLG.meta.magVar;
      expect(String(Math.round(mag / 10)).padStart(2, '0')).toBe(r.id.slice(0, 2));
    }
  });
  it('ILS idents, frequencies and categories', () => {
    expect(R('22L').ils).toEqual({ ident: 'ILG', freq: '109.350', cat: 'III', gp: '331.850' });
    expect(R('04R').ils).toEqual({ ident: 'IHH', freq: '108.750', cat: 'III', gp: '330.350' });
    expect(R('22R').ils).toEqual({ ident: 'IBI', freq: '109.350', cat: 'I', gp: '331.850' });
    expect(R('04L').ils).toBeUndefined();
    expect([R('22L').tch, R('04R').tch, R('22R').tch, R('04L').tch]).toEqual([56, 58, 54, 50]);
  });
  it('frequencies and transition altitude', () => {
    expect(EBLG.meta).toMatchObject({ appFreq: '119.280', twrFreq: '118.130', atisFreq: '126.255', gndFreq: '121.915', transitionAltitude: 4500 });
    expect(EBLG.meta.appCallsign).toBe('Liège Approach');
    expect(EBLG.meta.twrCallsign).toBe('Liège Tower');
    expect(EBLG.meta.squawkBlock).toEqual(['6330', '6343']);
  });
});

describe('final approach geometry (IAC coding)', () => {
  const finals: [string, string, string, number][] = [['22L', 'LIBVA', 'L22LF', 5.8], ['22R', 'LAVTO', 'L22RF', 5.9], ['04L', 'MAPUP', 'L04LF', 7.3], ['04R', 'TUTSO', 'L04RF', 7.2]];
  for (const [rwy, ifx, faf, nm] of finals) {
    it(`${rwy}: IF ${ifx} and FAF ${faf} sit on the final course; the FAF altitude is on a 3° path`, () => {
      const r = pack.runways.get(rwy)!;
      expect(r.ifFix).toBe(ifx);
      expect(r.faf).toBe(faf);
      // FAF -> threshold: coded distance, and the course is the runway course
      expect(gcDistance(ll(faf), thr(rwy))).toBeCloseTo(nm, 0);
      expect(Math.abs(gcDistance(ll(faf), thr(rwy)) - nm)).toBeLessThan(0.1);
      expect(angErr(course(ll(faf), thr(rwy)), R(rwy).crsTrue)).toBeLessThan(0.3);
      // IF -> FAF is flown on the final course too
      expect(angErr(course(ll(ifx), ll(faf)), R(rwy).crsTrue)).toBeLessThan(0.5);
      // 3° glide path: height above threshold + TCH reaches the FAF altitude at the FAF distance
      const ftPerNm = 6076.12 * Math.tan(3 * DEG);
      const gpNm = (r.fafAlt - r.elevation - R(rwy).tch!) / ftPerNm;
      expect(Math.abs(gpNm - nm)).toBeLessThan(0.15);
      expect(r.ifAlt).toBeGreaterThanOrEqual(r.fafAlt);
    });
  }
});

describe('STAR, transition and SID coding (AD 2.22 tables)', () => {
  // [from, to, initial true course, NM] exactly as published
  const legs: [string, string, number, number][] = [
    ['LNO', 'ALHUV', 294.1, 10.0], ['GESLO', 'LNO', 339.7, 32.5], ['CIV', 'GILOM', 73.1, 37.5], ['GILOM', 'ALHUV', 102.2, 27.2],
    ['KOK', 'MAK', 103.4, 32.9], ['MAK', 'ALHUV', 103.2, 77.4], ['NIK', 'GILOM', 137.7, 33.4], ['LNO', 'GIREL', 198.1, 21.0],
    ['GIREL', 'RUDIX', 300.4, 19.6], ['RUDIX', 'ALHUV', 44.7, 20.0], ['GESLO', 'RITAX', 269.5, 7.7], ['RITAX', 'GIREL', 316.0, 14.7],
    ['CIV', 'GSY', 107.0, 24.4], ['GSY', 'RUDIX', 94.6, 25.4], ['KOK', 'GSY', 118.8, 78.3], ['NIK', 'GSY', 167.0, 43.8],
    ['ALHUV', 'IPLAN', 345.2, 8.0], ['IPLAN', 'RERTI', 45.2, 5.2], ['RERTI', 'LIBVA', 135.3, 6.9], ['ALHUV', 'OLPUN', 89.5, 7.2],
    ['OLPUN', 'GIKLI', 45.2, 4.0], ['GIKLI', 'LIBVA', 315.5, 5.0], ['RERTI', 'LAVTO', 135.3, 6.8], ['GIKLI', 'LAVTO', 315.5, 5.1],
    ['LIBVA', 'L22LF', 225.4, 3.9], ['LAVTO', 'L22RF', 225.3, 4.1], ['ALHUV', 'LITPO', 254.9, 12.1], ['LITPO', 'OSTAT', 224.7, 4.1],
    ['OSTAT', 'MAPUP', 135.0, 5.8], ['OSTAT', 'TUTSO', 135.0, 5.9], ['ALHUV', 'NEPIV', 194.6, 11.6], ['NEPIV', 'EVSEN', 224.9, 4.6],
    ['EVSEN', 'MAPUP', 315.2, 6.0], ['EVSEN', 'TUTSO', 315.2, 5.9], ['MAPUP', 'L04LF', 45.0, 5.2], ['TUTSO', 'L04RF', 45.0, 5.1],
    ['ALHUV', 'ABLAZ', 194.9, 5.8], ['ABLAZ', 'PIZVE', 225.0, 4.7], ['PIZVE', 'KAQZI', 314.9, 3.0],
    ['LG001', 'LG002', 298.0, 6.6], ['LG002', 'LG003', 300.1, 5.1], ['LG003', 'LG004', 220.9, 5.9], ['LG004', 'LG005', 130.3, 13.2],
    ['LG005', 'LNO', 66.7, 18.9], ['LG003', 'LG006', 28.6, 6.4], ['LG006', 'LNO', 118.4, 23.3], ['LG003', 'BUB', 302.6, 25.0],
    ['BUB', 'CIV', 234.0, 33.3], ['LG011', 'LG012', 45.3, 4.6], ['LG012', 'LG013', 285.7, 7.4], ['LG013', 'LG008', 282.8, 11.1],
    ['LG008', 'LG009', 175.0, 7.4], ['LG009', 'LG010', 121.6, 17.6], ['LG010', 'LNO', 65.9, 6.5], ['LG008', 'BUB', 282.4, 23.6],
  ];
  it('every coded leg is reproduced within 0.2 NM and 0.6°', () => {
    const bad = legs.filter(([a, b, c, d]) => Math.abs(gcDistance(ll(a), ll(b)) - d) > 0.2 || angErr(course(ll(a), ll(b)), c) > 0.6)
      .map(([a, b, c, d]) => `${a}-${b} ${c}/${d} vs ${course(ll(a), ll(b)).toFixed(1)}/${gcDistance(ll(a), ll(b)).toFixed(2)}`);
    expect(bad).toEqual([]);
  });
  it('STAR restrictions', () => {
    const star = (n: string) => EBLG.stars.find((s) => s.name === n)!;
    for (const s of EBLG.stars) {
      const last = s.legs[s.legs.length - 1];
      expect(last.fix).toBe('ALHUV');
      expect(last.spd).toBe(250);
    }
    expect(star('LNO6X').legs.map((l) => [l.fix, l.min])).toEqual([['LNO', 3000], ['ALHUV', 3000]]);
    expect(star('GESLO6X').legs.map((l) => l.min)).toEqual(['F140', 'F140', 3000]);
    expect(star('CIV7X').legs.map((l) => l.min)).toEqual(['F080', 'F080', 'F060']);
    expect(star('GESLO6D').legs.map((l) => [l.fix, l.min])).toEqual([['GESLO', 'F140'], ['RITAX', 'F140'], ['GIREL', 'F060'], ['RUDIX', 'F060'], ['ALHUV', 3000]]);
    expect(star('NIK7D').legs.map((l) => l.fix)).toEqual(['NIK', 'GSY', 'RUDIX', 'ALHUV']);
  });
  it('transition restrictions: 3,000 ft and 250 kt to the IAF legs, 2,500 ft and 200 kt at the runway 22 IF', () => {
    for (const t of EBLG.transitions) {
      const last = t.legs[t.legs.length - 1];
      for (const l of t.legs.slice(0, -1)) expect([l.min, l.spd]).toEqual([3000, 250]);
      if (t.runways[0].startsWith('22')) expect([last.min, last.spd]).toEqual([2500, 200]);
      else expect([last.min, last.spd]).toEqual([3000, 250]);
    }
    expect(EBLG.transitions.filter((t) => t.atcDiscretion).map((t) => t.name).sort()).toEqual(['ALHUV1W', 'ALHUV1Y']);
  });
  it('SIDs: initial climb FL060, LG003 6,500 ft+, LG013 6,000 ft+, 220 kt on the turning legs', () => {
    for (const s of EBLG.sids) expect(s.initialClimb).toBe('F060');
    expect(EBLG.meta.initialClimbLowQnh).toEqual({ qnhMax: 995, level: 'F070' });
    const lg = (sid: string, fix: string) => EBLG.sids.find((s) => s.name === sid)!.legs.find((l) => l.fix === fix)!;
    expect([lg('LNO9S', 'LG003').min, lg('LNO9S', 'LG003').spd]).toEqual([6500, 220]);
    expect([lg('LNO2R', 'LG013').min, lg('LNO2R', 'LG013').spd]).toEqual([6000, 220]);
    expect(lg('LNO2R', 'LG009').spd).toBe(220);
    expect(lg('CIV5S', 'LG003').spd).toBeUndefined();
  });
  it('missed approach: direct ALHUV, 3,000 ft, 215 kt', () => {
    for (const r of EBLG.runways) {
      expect(r.missed[r.missed.length - 1]).toBe('ALHUV');
      expect([r.missedAlt, r.missedSpd]).toEqual([3000, 215]);
    }
  });
});

describe('holding (AD 2.22)', () => {
  it('ALHUV, GIREL and GSY as published', () => {
    const h = (f: string) => EBLG.holds.find((x) => x.fix === f)!;
    expect(h('ALHUV')).toMatchObject({ inboundTrue: 45, turn: 'L', minAlt: 3000, maxAlt: 'F050', maxSpd: 230, legMin: 1 });
    expect(h('GIREL')).toMatchObject({ inboundTrue: 316, turn: 'L', minAlt: 'F060', maxAlt: 'F140', atcDiscretion: true });
    expect(h('GSY')).toMatchObject({ inboundTrue: 94.6, turn: 'R', minAlt: 'F070', maxAlt: 'F100', atcDiscretion: true });
    for (const x of EBLG.holds) expect(angErr(x.inboundMag! + EBLG.meta.magVar, x.inboundTrue)).toBeLessThan(1);
  });
});

describe('airspace (AD 2.17, ENR 2.1, ENR 5.2, ENR 1.7)', () => {
  it('CTR class D, surface to 2,500 ft; TMA sub-areas class C to FL055 with the published floors', () => {
    expect(EBLG.ctr).toMatchObject({ floor: 0, ceiling: 2500, cls: 'D' });
    expect(EBLG.tma).toMatchObject({ floor: 2500, ceiling: 'F055', cls: 'C' });
    expect(EBLG.tmaParts!.map((t) => [t.floor, t.ceiling, t.cls])).toEqual([[2500, 'F055', 'C'], [2000, 2500, 'C'], [2500, 'F055', 'C'], [3000, 'F055', 'C'], [3500, 'F055', 'C']]);
  });
  it('TSA vertical limits', () => {
    const t = (n: string) => EBLG.tsas.find((x) => x.name === n)!;
    expect([t('TSA28A').floor, t('TSA28A').ceiling]).toEqual([0, 'F105']);
    expect([t('TSA28B').floor, t('TSA28B').ceiling]).toEqual([0, 'F105']);
    expect([t('TSA29A').floor, t('TSA29A').ceiling]).toEqual([4500, 'F145']);
    expect([t('TSA29B').floor, t('TSA29B').ceiling]).toEqual([4500, 'F095']);
    expect([t('TSA26B').floor, t('TSA26B').ceiling]).toEqual([4500, 'F095']);
  });
  it('TSA29A covers the southern loop (GIREL) but not GSY or the field', () => {
    const a = pack.tsas.find((x) => x.name === 'TSA29A')!;
    expect(pointInPolygon(pack.fixes.get('GIREL')!.p, a.poly)).toBe(true);
    expect(pointInPolygon(pack.fixes.get('GSY')!.p, a.poly)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, a.poly)).toBe(false);
  });
  it('transition level table (ENR 1.7, Brussels FIR)', () => {
    const tl = (q: number) => tlFromTable(EBLG.meta, q);
    expect([tl(1032), tl(1031), tl(1014), tl(1013), tl(996), tl(995), tl(978), tl(977), tl(960)]).toEqual([50, 55, 55, 60, 60, 65, 65, 70, 70]);
  });
  it('minimum vectoring areas: 2,500 ft round the field, 3,000 ft east, 3,500 ft over the Hautes Fagnes and the Ardennes', () => {
    const mva = (lat: string, lon: string) => {
      const p = pack.proj.toXY(parseLatLon(lat, lon));
      return pack.mva.find((m) => pointInPolygon(p, m.poly))?.alt;
    };
    expect(mva('503914N', '0052814E')).toBe(2500); // ALHUV
    expect(mva('503500N', '0055500E')).toBe(3000); // TMA Four, Herve plateau
    expect(mva('503000N', '0060500E')).toBe(3500); // Hautes Fagnes
    expect(mva('501000N', '0053000E')).toBe(3500); // Ardennes
  });
});

describe('phraseology (ICAO Doc 4444 ch. 12, Doc 9432)', () => {
  const ctx: Ctx = { alt: 8000, qnh: 1018, hdgMag: 270, ias: 250 };
  const say = (items: Parameters<typeof phraseology>[0]['items'], c: Partial<Ctx> = {}) => phraseology({ cs: 'DHK7', items }, { ...ctx, ...c }).speech;
  it('levels: "to" before an altitude, none before a flight level; QNH after the first altitude', () => {
    expect(say([{ k: 'lvl', lvl: { ft: 3000 } }], { qnhSay: true })).toBe('World Express seven, descend to altitude three thousand feet, Q N H one zero one eight');
    expect(say([{ k: 'lvl', lvl: { fl: 90 } }], { alt: 6000 })).toBe('World Express seven, climb flight level niner zero');
    expect(say([{ k: 'lvl', lvl: { ft: 2500 } }], { alt: 2500, cleared: { ft: 2500 } })).toBe('World Express seven, maintain altitude two thousand five hundred feet');
  });
  it('headings and vectors', () => {
    expect(say([{ k: 'hdg', hdg: 250, dir: 'L' }], { vectorFor: { app: 'ILS', rwy: '22L' } })).toBe('World Express seven, turn left heading two five zero, vectoring for I L S approach runway two two left');
    expect(say([{ k: 'hdg', hdg: 40 }])).toBe('World Express seven, fly heading zero four zero');
  });
  it('speed control', () => {
    expect(say([{ k: 'spd', spd: 180 }])).toBe('World Express seven, reduce speed to one eight zero knots');
    expect(say([{ k: 'spd', spd: 160, until: 4 }], { ias: 160 })).toBe('World Express seven, maintain one six zero knots until four D M E');
    expect(say([{ k: 'spdmin' }])).toBe('World Express seven, reduce to minimum clean speed');
  });
  it('approach clearance, hold, transfer', () => {
    expect(say([{ k: 'hdg', hdg: 250, dir: 'R' }, { k: 'app', app: 'ILS', rwy: '22L' }], { posNm: 11 })).toBe('World Express seven, one one miles from touchdown, turn right heading two five zero, cleared I L S approach runway two two left');
    expect(say([{ k: 'hold', fix: 'ALHUV' }], { efc: '0214' })).toBe('World Express seven, hold at ALHUV as published, expect approach clearance at zero two one four');
    expect(say([{ k: 'xfr', unit: 'TWR' }])).toBe('World Express seven, contact Liège Tower one one eight decimal one three zero');
    expect(unitName('TWR').text).toBe('Liège Tower 118.130');
    expect(freqSpeech('119.280')).toBe('one one niner decimal two eight zero');
    expect(freqSpeech('131.100')).toBe('one three one decimal one');
  });
  it('first contact is "identified"; readbacks end with the callsign and keep the words', () => {
    expect(say([{ k: 'roger' }], { firstCall: true })).toBe('World Express seven, Liège Approach, identified');
    const rb = readback('DHK7', [{ k: 'lvl', lvl: { ft: 3000 } }, { k: 'spd', spd: 220 }], { ...ctx, qnhSay: true });
    expect(rb.speech).toBe('descend to altitude three thousand feet, Q N H one zero one eight, reduce speed to two two zero knots, World Express seven');
  });
});
