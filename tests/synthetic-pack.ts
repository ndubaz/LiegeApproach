import type { PackSpec } from '../src/pack/types';

// A tiny second airport for the engine tests: "Testfeld" (ZZTF), two parallel runways 05L/23R and 05R/23L used
// at the same time (23L landing, 23R departures), one IAF per arrival side (WEST, EAST) with a hold at each and an
// RNAV transition from each IAF to each landing runway, a passenger mix with a night curfew, "Langen Radar" as the
// centre, a German transition altitude and QNH table, ED-R reserved areas. Everything is placed on a flat grid of
// nautical miles around the reference point (x east, y north) and converted to lat/lon.

const LAT0 = 51, LON0 = 7;
const COSLAT = Math.cos((LAT0 * Math.PI) / 180);
const dms = (deg: number, lat: boolean) => {
  const d = Math.floor(deg), m = Math.floor((deg - d) * 60), s = ((deg - d) * 60 - m) * 60;
  return `${String(d).padStart(lat ? 2 : 3, '0')}${String(m).padStart(2, '0')}${s.toFixed(1).padStart(4, '0')}${lat ? 'N' : 'E'}`;
};
/** Lat/lon strings for a grid point (NM east and north of the reference point). */
export const ll = (x: number, y: number) => ({ lat: dms(LAT0 + y / 60, true), lon: dms(LON0 + x / (60 * COSLAT), false) });
const poly = (pts: [number, number][]) => pts.map(([x, y]) => ll(x, y));

// runway strips: 05R/23L south of the reference point, 05L/23R 1.2 NM north of it; 3,000 m long on 050/230 true
const LEN = 3000 / 1852, ux = Math.sin((50 * Math.PI) / 180), uy = Math.cos((50 * Math.PI) / 180);
const strip = (cy: number) => ({ sw: [-ux * LEN / 2, cy - uy * LEN / 2] as [number, number], ne: [ux * LEN / 2, cy + uy * LEN / 2] as [number, number] });
const A = strip(-0.6), B = strip(0.6);
/** A point d NM out along the final of a runway whose threshold is at thr, approaching on course crs. */
const onFinal = (thr: [number, number], crs: number, d: number): [number, number] => [thr[0] - Math.sin((crs * Math.PI) / 180) * d, thr[1] - Math.cos((crs * Math.PI) / 180) * d];
const F = (p: [number, number]) => ll(p[0], p[1]);

const fixes: PackSpec['fixes'] = {
  ARP: ll(0, 0),
  // IAFs, holds and STAR entries
  WEST: ll(-20, 0), EAST: ll(20, 0),
  ALFA: ll(-45, 10), BRAVO: ll(45, -10), NORD: ll(0, 40), SUED: ll(0, -40),
  // transitions
  W23A: ll(-8, 12), E23A: ll(14, 10), W05A: ll(-16, -8), E05A: ll(10, -12),
  IF23L: F(onFinal(A.ne, 230, 13)), FF23L: F(onFinal(A.ne, 230, 9)),
  IF05R: F(onFinal(A.sw, 50, 13)), FF05R: F(onFinal(A.sw, 50, 9)),
  IF23R: F(onFinal(B.ne, 230, 13)), FF23R: F(onFinal(B.ne, 230, 9)),
  IF05L: F(onFinal(B.sw, 50, 13)), FF05L: F(onFinal(B.sw, 50, 9)),
  M23A: ll(-7, -6), M05A: ll(7, 6),
  // SIDs
  D23A: ll(-6, -4), D23B: ll(-10, 6), D05A: ll(6, 4), D05B: ll(10, 14),
  // VFR
  VICTOR: { lat: ll(-6, 7).lat, lon: ll(-6, 7).lon, kind: 'vfr' }, WHISKEY: { lat: ll(6, -7).lat, lon: ll(6, -7).lon, kind: 'vfr' },
  TOWN: { lat: ll(3, 5).lat, lon: ll(3, 5).lon, kind: 'town', note: 'Testfeld' },
};

const rwy = (id: string, thr: [number, number], crs: number, ifFix: string, faf: string, missed: string[], contingency = false): PackSpec['runways'][number] => ({
  id, thr: ll(thr[0], thr[1]), crsTrue: crs, elevation: 150, lengthM: 3000,
  ils: { ident: `I${id}`, freq: '110.300', cat: 'III' }, rnp: true,
  if: { fix: ifFix, alt: 3000 }, faf: { fix: faf, alt: 3000 }, missed, gpDeg: 3, tch: 50, missedAlt: 3000, missedSpd: 220, contingency,
});

export const ZZTF: PackSpec = {
  meta: {
    icao: 'ZZTF', name: 'Testfeld', arp: ll(0, 0), elevation: 150, magVar: 2, transitionAltitude: 5000,
    appCallsign: 'Testfeld Director', appFreq: '120.500', twrCallsign: 'Testfeld Tower', twrFreq: '118.500', atisFreq: '123.450',
    sectorRadiusNm: 50, sectorCeiling: 'F105', airac: '2026-10',
    upstream: [{ name: 'Langen ACC', callsign: 'Langen Radar', freq: '127.000' }],
    sources: ['synthetic test pack'], approximations: ['everything: a synthetic airport for the engine tests'],
    tlTable: [
      { qnhMin: 942.2, qnhMax: 959.4, fl: 90 }, { qnhMin: 959.5, qnhMax: 977.1, fl: 85 }, { qnhMin: 977.2, qnhMax: 995.0, fl: 80 },
      { qnhMin: 995.1, qnhMax: 1013.2, fl: 75 }, { qnhMin: 1013.3, qnhMax: 1031.6, fl: 70 }, { qnhMin: 1031.7, qnhMax: 1050.3, fl: 65 },
    ],
    squawkBlock: ['2501', '2520'],
    upperClass: { floor: 'F100', cls: 'C' },
  },
  fixes,
  runways: [
    rwy('23L', A.ne, 230, 'IF23L', 'FF23L', ['M23A', 'WEST']),
    rwy('05R', A.sw, 50, 'IF05R', 'FF05R', ['M05A', 'EAST']),
    rwy('23R', B.ne, 230, 'IF23R', 'FF23R', ['M23A', 'WEST']),
    rwy('05L', B.sw, 50, 'IF05L', 'FF05L', ['M05A', 'EAST']),
  ],
  strips: [
    { ends: ['05R', '23L'], drawFrom: ll(A.sw[0], A.sw[1]), drawTo: ll(A.ne[0], A.ne[1]) },
    { ends: ['05L', '23R'], drawFrom: ll(B.sw[0], B.sw[1]), drawTo: ll(B.ne[0], B.ne[1]) },
  ],
  preferredRunways: ['23L', '05R'],
  runwayConfigs: [{ land: '23L', dep: '23R', note: '23 operation: 23L landing, 23R take-off' }, { land: '05R', dep: '05L', note: '05 operation: 05R landing, 05L take-off' }],
  stars: [
    { name: 'ALFA1A', runways: ['23L', '05R', '23R', '05L'], handoffLevel: 'F080', legs: [{ fix: 'ALFA', min: 'F080', spd: 250 }, { fix: 'WEST', min: 'F070', spd: 250 }] },
    { name: 'BRAVO1A', runways: ['23L', '05R', '23R', '05L'], handoffLevel: 'F080', legs: [{ fix: 'BRAVO', min: 'F080', spd: 250 }, { fix: 'EAST', min: 'F070', spd: 250 }] },
  ],
  transitions: [
    { name: 'WEST1L', runways: ['23L'], legs: [{ fix: 'WEST', min: 4000, spd: 250 }, { fix: 'W23A', min: 4000, spd: 220 }, { fix: 'IF23L', min: 3000, spd: 200 }] },
    { name: 'EAST1L', runways: ['23L'], legs: [{ fix: 'EAST', min: 4000, spd: 250 }, { fix: 'E23A', min: 4000, spd: 220 }, { fix: 'IF23L', min: 3000, spd: 200 }] },
    { name: 'WEST1R', runways: ['05R'], legs: [{ fix: 'WEST', min: 4000, spd: 250 }, { fix: 'W05A', min: 4000, spd: 220 }, { fix: 'IF05R', min: 3000, spd: 200 }] },
    { name: 'EAST1R', runways: ['05R'], legs: [{ fix: 'EAST', min: 4000, spd: 250 }, { fix: 'E05A', min: 4000, spd: 220 }, { fix: 'IF05R', min: 3000, spd: 200 }] },
  ],
  sids: [
    { name: 'NORD1S', runways: ['23R'], initialClimb: 5000, exitFix: 'NORD', legs: [{ fix: 'D23A', min: 1000 }, { fix: 'D23B', min: 4000 }, { fix: 'NORD' }] },
    { name: 'SUED1S', runways: ['23R'], initialClimb: 5000, exitFix: 'SUED', legs: [{ fix: 'D23A', min: 1000 }, { fix: 'SUED' }] },
    { name: 'NORD1N', runways: ['05L'], initialClimb: 5000, exitFix: 'NORD', legs: [{ fix: 'D05A', min: 1000 }, { fix: 'D05B', min: 4000 }, { fix: 'NORD' }] },
    { name: 'SUED1N', runways: ['05L'], initialClimb: 5000, exitFix: 'SUED', legs: [{ fix: 'D05A', min: 1000 }, { fix: 'SUED' }] },
  ],
  holds: [
    { fix: 'WEST', inboundTrue: 90, turn: 'R', minAlt: 4000, maxAlt: 'F070', maxSpd: 230, legMin: 1 },
    { fix: 'EAST', inboundTrue: 270, turn: 'L', minAlt: 4000, maxAlt: 'F070', maxSpd: 230, legMin: 1 },
  ],
  ctr: { name: 'Testfeld CTR', floor: 0, ceiling: 2500, cls: 'D', hours: 'H24', poly: poly([[-8, 8], [8, 8], [8, -8], [-8, -8]]) },
  tma: { name: 'Testfeld TMA', floor: 2500, ceiling: 'F100', cls: 'C', hours: 'H24', poly: poly([[-32, 30], [32, 30], [32, -30], [-32, -30]]) },
  tsas: [
    { name: 'ED-R117', floor: 0, ceiling: 'F100', note: 'Military exercise area, by NOTAM', hours: 'NOTAM', poly: poly([[-40, -20], [-25, -20], [-25, -35], [-40, -35]]) },
  ],
  mva: [{ alt: 2500, poly: poly([[-70, 70], [70, 70], [70, -70], [-70, -70]]) }],
  vfrRoutes: [{ name: 'VICTOR-WHISKEY', points: ['VICTOR', 'WHISKEY'], alt: 1500 }],
  mapLines: [],
  // ---- 2.0 ----
  stackFix: 'WEST',
  country: 'DE',
  utcOffsetWinter: 1,
  depXfl: 'F070',
  reservedAreasName: 'ED-R',
  units: [
    { id: 'TWR', role: 'tower', callsign: 'Testfeld Tower', freq: '118.500', label: 'TWR', source: 'synthetic', voices: ['de'], say: 'Tower' },
    { id: 'LANGEN', role: 'acc', callsign: 'Langen Radar', freq: '127.000', label: 'Langen', source: 'synthetic', voices: ['de'] },
    { id: 'MIL', role: 'military', callsign: 'Military', freq: '129.900', label: 'MIL', source: 'synthetic', voices: ['de'], say: 'MIL' },
    { id: 'RHEIN', role: 'upper', callsign: 'Rhein Radar', freq: '133.800', label: '> FL245', source: 'synthetic', voices: ['de'] },
    { id: 'SUP', role: 'supervisor', callsign: 'Supervisor', freq: '', label: 'supervisor', source: 'synthetic', voices: ['de'] },
  ],
  fixSay: { ALFA: 'Alfa', BRAVO: 'Bravo', WEST: 'West', EAST: 'East', NORD: 'Nord', SUED: 'Sued', Testfeld: 'Test-felt', Langen: 'Lang-en' },
  traffic: {
    cargo: [{ op: 'DHK', types: ['B763', 'A306'], w: 1 }],
    bank: [],
    pax: [{ op: 'DLH', types: ['A320', 'A21N'], w: 3 }, { op: 'EWG', types: ['A319', 'A320'], w: 3 }, { op: 'RYR', types: ['B738'], w: 1 }, { op: 'CFG', types: ['A21N'], w: 1 }],
    telephony: { EWG: 'Eurowings', CFG: 'Condor' },
    gaPrefixes: ['DE'],
    registration: { prefix: 'DE', length: 5 },
    // local hours 00..23: a night curfew from 23:00 to 05:00 local, waves morning and evening
    demand: [0, 0, 0, 0, 0, 6, 24, 30, 26, 20, 18, 18, 20, 20, 18, 20, 24, 28, 26, 20, 16, 10, 6, 0].map((perHour) => ({ perHour, paxShare: 0.95 })),
    reserved: { name: 'ED-R117', hoursUtc: [7, 16] },
    diversion: { from: 'Frankfurt', icao: 'EDDF', brg: 160 },
    patterns: [
      { at: 1, deck: 'hems', w: 1, kind: 'vfr', csReg: true, types: ['C172'], route: ['VICTOR', 'WHISKEY'], from: { brg: 315, dist: 6 }, level: 1500, request: { kind: 'crossing', route: ['VICTOR', 'WHISKEY'] } },
      { at: 2, deck: 'military', w: 1, kind: 'mil', csOp: 'GAF', csNum: [10, 99], types: ['A400'], route: ['SUED', 'EAST', 'NORD'], from: { brg: 180, dist: 10 }, level: 'F060', request: { kind: 'climb', level: 'F090' } },
    ],
  },
};
