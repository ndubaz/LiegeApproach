import type { PackSpec } from './types';

// Liège (EBLG) location pack.
// Source: skeyes eAIP Belgium & Luxembourg, EB AD 2 EBLG (AIRAC current Oct 2026),
// EB ENR 5.2. Fix coordinates are copied verbatim from the AIP database coding
// tables. Fixes outside the AIP AD section (KOK, NIK, GESLO, MAK, GILOM, RUDIX,
// RITAX) are derived from the STAR coding tables (true course + distance).
// Items marked approximate are NOT from the AIP and must be replaced from the
// relevant chart before anyone relies on them.

export const EBLG: PackSpec = {
  meta: {
    icao: 'EBLG',
    name: 'Liège',
    arp: { lat: '503811N', lon: '0052634E' },
    elevation: 651,
    magVar: 2,
    transitionAltitude: 4500,
    appCallsign: 'Liège Approach',
    appFreq: '119.280',
    twrCallsign: 'Liège Tower',
    twrFreq: '118.130',
    atisFreq: '126.255',
    sectorRadiusNm: 40,
    sectorCeiling: 'F095',
    airac: '2026-10',
    upstream: [
      { name: 'Brussels ACC', callsign: 'Brussels Control', freq: '131.100' },
      { name: 'Maastricht UAC', callsign: 'Maastricht Radar', freq: '132.755' },
      { name: 'Beek Approach', callsign: 'Beek Approach', freq: '123.980' },
    ],
    sources: [
      'skeyes eAIP EB AD 2 EBLG',
      'skeyes eAIP EB ENR 5.2',
    ],
    approximations: [
      'TMA outline (AIP ENR 2.1 sub-areas not yet coded)',
      'Minimum vectoring altitudes (ATCSMAC chart not yet coded)',
      'TSA outlines (ENR 5.2 coordinates not yet coded)',
      'Upstream unit frequencies',
      'Sector radius and ceiling',
      'Meuse river and town positions on the video map',
    ],
  },

  fixes: {
    // Airport-area fixes (AIP AD 2.22 / 2.24 coding tables)
    ALHUV: { lat: '503914.4N', lon: '0052813.5E' },
    IPLAN: { lat: '504657.5N', lon: '0052501.2E' },
    RERTI: { lat: '505036.4N', lon: '0053049.9E' },
    OLPUN: { lat: '503917.7N', lon: '0053933.1E' },
    GIKLI: { lat: '504207.2N', lon: '0054402.2E' },
    LIBVA: { lat: '504541.5N', lon: '0053829.6E' },
    LAVTO: { lat: '504546.6N', lon: '0053821.7E' },
    L22LF: { lat: '504258.5N', lon: '0053409.8E' },
    L22RF: { lat: '504253.9N', lon: '0053347.1E' },
    L22LT: { lat: '503419.0N', lon: '0052026.0E' },
    L22RT: { lat: '503423.5N', lon: '0052018.5E' },
    LITPO: { lat: '503605.0N', lon: '0050958.1E' },
    OSTAT: { lat: '503311.7N', lon: '0050529.3E' },
    NEPIV: { lat: '502805.3N', lon: '0052334.5E' },
    EVSEN: { lat: '502450.7N', lon: '0051831.7E' },
    MAPUP: { lat: '502904.7N', lon: '0051156.0E' },
    TUTSO: { lat: '502859.8N', lon: '0051203.6E' },
    L04LF: { lat: '503244.7N', lon: '0051741.6E' },
    L04RF: { lat: '503237.1N', lon: '0051745.5E' },
    L04LT: { lat: '504311.2N', lon: '0053414.7E' },
    L04RT: { lat: '504306.3N', lon: '0053422.4E' },
    ABLAZ: { lat: '503338.2N', lon: '0052553.1E' },
    PIZVE: { lat: '503020.9N', lon: '0052043.7E' },
    KAQZI: { lat: '503225.7N', lon: '0051727.4E' },
    GIREL: { lat: '501514.0N', lon: '0053229.0E' },
    // SID waypoints
    LG001: { lat: '503506.7N', lon: '0052139.4E' },
    LG002: { lat: '503812.8N', lon: '0051227.8E' },
    LG003: { lat: '504044.7N', lon: '0050535.8E' },
    LG004: { lat: '503617.9N', lon: '0045932.2E' },
    LG005: { lat: '502743.5N', lon: '0051519.1E' },
    LG006: { lat: '504619.4N', lon: '0051023.9E' },
    LG008: { lat: '504909.0N', lon: '0050844.6E' },
    LG009: { lat: '504146.6N', lon: '0050945.6E' },
    LG010: { lat: '503230.9N', lon: '0053318.5E' },
    LG011: { lat: '504129.0N', lon: '0053147.5E' },
    LG012: { lat: '504444.5N', lon: '0053659.1E' },
    LG013: { lat: '504643.1N', lon: '0052550.3E' },
    // Navaids
    LNO: { lat: '503509.3N', lon: '0054237.0E', kind: 'vor' },
    CIV: { lat: '503426.3N', lon: '0034958.4E', kind: 'vor' },
    BUB: { lat: '505408.4N', lon: '0043217.1E', kind: 'vor' },
    GSY: { lat: '502714.1N', lon: '0042629.0E', kind: 'vor' },
    ONL: { lat: '504203.9N', lon: '0053257.0E', kind: 'ndb' },
    // Derived from STAR coding (true course and distance between fixes)
    RUDIX: { from: 'ALHUV', brg: 224.7, dist: 20.0, note: 'RUDIX→ALHUV 044.7°T 20.0 NM' },
    GILOM: { from: 'ALHUV', brg: 282.2, dist: 27.2, note: 'GILOM→ALHUV 102.2°T 27.2 NM' },
    MAK: { from: 'ALHUV', brg: 283.2, dist: 77.4, kind: 'vor', note: 'MAK→ALHUV 103.2°T 77.4 NM' },
    KOK: { from: 'MAK', brg: 283.4, dist: 32.9, kind: 'vor', note: 'KOK→MAK 103.4°T 32.9 NM' },
    NIK: { from: 'GILOM', brg: 317.7, dist: 33.4, kind: 'vor', note: 'NIK→GILOM 137.7°T 33.4 NM' },
    GESLO: { from: 'LNO', brg: 159.7, dist: 32.5, note: 'GESLO→LNO 339.7°T 32.5 NM' },
    RITAX: { from: 'GESLO', brg: 269.5, dist: 7.7, note: 'GESLO→RITAX 269.5°T 7.7 NM' },
    // VFR reporting points (AIP AD 2.22)
    ROMEO: { lat: '504217N', lon: '0051736E', kind: 'vfr' },
    INDIA: { lat: '503530N', lon: '0052742E', kind: 'vfr' },
    OSCAR: { lat: '503400N', lon: '0053258E', kind: 'vfr' },
    FOXHE: { lat: '503958N', lon: '0052353E', kind: 'vfr' },
    ECHO: { lat: '504049N', lon: '0053934E', kind: 'vfr' },
    WISKY: { lat: '503451N', lon: '0051238E', kind: 'vfr' },
    NOVEM: { lat: '504736N', lon: '0053151E', kind: 'vfr' },
    SIERA: { lat: '502833N', lon: '0052232E', kind: 'vfr' },
    // Video map references (approximate)
    LIEGE: { lat: '503845N', lon: '0053425E', kind: 'town', note: 'Liège' },
    HUY: { lat: '503112N', lon: '0051424E', kind: 'town', note: 'Huy' },
    NAMUR: { lat: '502800N', lon: '0045200E', kind: 'town', note: 'Namur' },
    MAASTR: { lat: '505100N', lon: '0054100E', kind: 'town', note: 'Maastricht' },
    HASSELT: { lat: '505600N', lon: '0052000E', kind: 'town', note: 'Hasselt' },
    VERVIERS: { lat: '503500N', lon: '0055200E', kind: 'town', note: 'Verviers' },
    TONGEREN: { lat: '504650N', lon: '0052750E', kind: 'town', note: 'Tongeren' },
    SPA: { lat: '502930N', lon: '0055150E', kind: 'town', note: 'Spa' },
    GEILENK: { lat: '505740N', lon: '0060233E', kind: 'town', note: 'Geilenkirchen (ETNG)' },
    M_ANDENNE: { lat: '502924N', lon: '0050600E', kind: 'map' },
    M_AMAY: { lat: '503300N', lon: '0051900E', kind: 'map' },
    M_SERAING: { lat: '503600N', lon: '0053000E', kind: 'map' },
    M_VISE: { lat: '504406N', lon: '0054145E', kind: 'map' },
    // Hospital pad used by HEMS traffic (approximate, CHU Sart Tilman area)
    CHU: { lat: '503400N', lon: '0053400E', kind: 'map', note: 'CHU hospital (approximate)' },
    // Geilenkirchen departure gate for E-3A traffic (sim construct)
    G_ETNG: { lat: '505200N', lon: '0055400E', kind: 'map' },
  },

  runways: [
    {
      id: '22L', thr: { lat: '503852.63N', lon: '0052739.08E' }, crsTrue: 225.16, elevation: 595, lengthM: 3690,
      ils: { ident: 'ILG', freq: '109.350', cat: 'III' }, rnp: true,
      if: { fix: 'LIBVA', alt: 2500 }, faf: { fix: 'L22LF', alt: 2500 }, missed: ['L22LT', 'ALHUV'],
    },
    {
      id: '04R', thr: { lat: '503743.10N', lon: '0052548.82E' }, crsTrue: 45.16, elevation: 644, lengthM: 3690,
      ils: { ident: 'IHH', freq: '108.750', cat: 'III' }, rnp: true,
      if: { fix: 'TUTSO', alt: 3000 }, faf: { fix: 'L04RF', alt: 3000 }, missed: ['L04RT', 'ALHUV'],
    },
    {
      id: '22R', thr: { lat: '503845.91N', lon: '0052713.03E' }, crsTrue: 225.16, elevation: 577, lengthM: 2340,
      ils: { ident: 'IBI', freq: '109.350', cat: 'I' }, rnp: true, contingency: true,
      if: { fix: 'LAVTO', alt: 2500 }, faf: { fix: 'L22RF', alt: 2500 }, missed: ['L22RT', 'ALHUV'],
      notes: 'Contingency runway, VMC and CAT I only; also TWY B',
    },
    {
      id: '04L', thr: { lat: '503752.59N', lon: '0052548.50E' }, crsTrue: 45.16, elevation: 629, lengthM: 2340,
      rnp: true, contingency: true,
      if: { fix: 'MAPUP', alt: 3000 }, faf: { fix: 'L04LF', alt: 3000 }, missed: ['L04LT', 'ALHUV'],
      notes: 'Contingency runway, no ILS',
    },
  ],
  strips: [
    { ends: ['04R', '22L'], drawFrom: { lat: '503737.74N', lon: '0052540.32E' }, drawTo: { lat: '503901.80N', lon: '0052753.53E' } },
    { ends: ['04L', '22R'], drawFrom: { lat: '503752.59N', lon: '0052548.50E' }, drawTo: { lat: '503845.91N', lon: '0052713.03E' } },
  ],
  preferredRunways: ['22L', '04R'],

  stars: [
    // X series: direct to ALHUV (used with runway 22 in this sim)
    { name: 'LNO6X', runways: ['22L', '22R'], handoffLevel: 'F070', legs: [{ fix: 'LNO', min: 3000, spd: 250 }, { fix: 'ALHUV', min: 3000, spd: 250 }] },
    { name: 'GESLO6X', runways: ['22L', '22R'], handoffLevel: 'F090', legs: [{ fix: 'GESLO', min: 'F140' }, { fix: 'LNO', min: 'F140' }, { fix: 'ALHUV', min: 3000, spd: 250 }] },
    { name: 'CIV7X', runways: ['22L', '22R'], handoffLevel: 'F080', legs: [{ fix: 'CIV', min: 'F080', spd: 250 }, { fix: 'GILOM', min: 'F080', spd: 250 }, { fix: 'ALHUV', min: 'F060', spd: 250 }] },
    { name: 'KOK7X', runways: ['22L', '22R'], handoffLevel: 'F080', legs: [{ fix: 'KOK', min: 'F080', spd: 250 }, { fix: 'MAK', min: 'F080', spd: 250 }, { fix: 'ALHUV', min: 'F060', spd: 250 }] },
    { name: 'NIK7X', runways: ['22L', '22R'], handoffLevel: 'F080', legs: [{ fix: 'NIK', min: 'F080', spd: 250 }, { fix: 'GILOM', min: 'F080', spd: 250 }, { fix: 'ALHUV', min: 'F060', spd: 250 }] },
    // D series: southern loop through RUDIX, on the 04 extended centreline (used with runway 04)
    { name: 'LNO6D', runways: ['04R', '04L'], handoffLevel: 'F070', legs: [{ fix: 'LNO', min: 'F060' }, { fix: 'GIREL', min: 'F060', spd: 250 }, { fix: 'RUDIX', min: 'F060', spd: 250 }, { fix: 'ALHUV', min: 3000, spd: 250 }] },
    { name: 'GESLO6D', runways: ['04R', '04L'], handoffLevel: 'F090', legs: [{ fix: 'GESLO', min: 'F140' }, { fix: 'RITAX', min: 'F140' }, { fix: 'GIREL', min: 'F060', spd: 250 }, { fix: 'RUDIX', min: 'F060', spd: 250 }, { fix: 'ALHUV', min: 3000, spd: 250 }] },
    { name: 'CIV7D', runways: ['04R', '04L'], handoffLevel: 'F080', legs: [{ fix: 'CIV', min: 'F080' }, { fix: 'GSY', min: 'F080', spd: 250 }, { fix: 'RUDIX', min: 'F060', spd: 250 }, { fix: 'ALHUV', min: 3000, spd: 250 }] },
    { name: 'KOK7D', runways: ['04R', '04L'], handoffLevel: 'F080', legs: [{ fix: 'KOK', min: 'F080' }, { fix: 'GSY', min: 'F080', spd: 250 }, { fix: 'RUDIX', min: 'F060', spd: 250 }, { fix: 'ALHUV', min: 3000, spd: 250 }] },
    { name: 'NIK7D', runways: ['04R', '04L'], handoffLevel: 'F080', legs: [{ fix: 'NIK', min: 'F080' }, { fix: 'GSY', min: 'F080', spd: 250 }, { fix: 'RUDIX', min: 'F060', spd: 250 }, { fix: 'ALHUV', min: 3000, spd: 250 }] },
  ],

  transitions: [
    { name: 'ALHUV1A', runways: ['22L'], legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'IPLAN', min: 3000, spd: 250 }, { fix: 'RERTI', min: 3000, spd: 250 }, { fix: 'LIBVA', min: 2500, spd: 200 }] },
    { name: 'ALHUV1B', runways: ['22L'], legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'OLPUN', min: 3000, spd: 250 }, { fix: 'GIKLI', min: 3000, spd: 250 }, { fix: 'LIBVA', min: 2500, spd: 200 }] },
    { name: 'ALHUV1C', runways: ['22R'], legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'IPLAN', min: 3000, spd: 250 }, { fix: 'RERTI', min: 3000, spd: 250 }, { fix: 'LAVTO', min: 2500, spd: 200 }] },
    { name: 'ALHUV1D', runways: ['22R'], legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'OLPUN', min: 3000, spd: 250 }, { fix: 'GIKLI', min: 3000, spd: 250 }, { fix: 'LAVTO', min: 2500, spd: 200 }] },
    { name: 'ALHUV1W', runways: ['04L'], atcDiscretion: true, legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'LITPO', min: 3000, spd: 250 }, { fix: 'OSTAT', min: 3000, spd: 250 }, { fix: 'MAPUP', min: 3000, spd: 250 }] },
    { name: 'ALHUV1X', runways: ['04L'], legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'NEPIV', min: 3000, spd: 250 }, { fix: 'EVSEN', min: 3000, spd: 250 }, { fix: 'MAPUP', min: 3000, spd: 250 }] },
    { name: 'ALHUV1Y', runways: ['04R'], atcDiscretion: true, legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'LITPO', min: 3000, spd: 250 }, { fix: 'OSTAT', min: 3000, spd: 250 }, { fix: 'TUTSO', min: 3000, spd: 250 }] },
    { name: 'ALHUV1Z', runways: ['04R'], legs: [{ fix: 'ALHUV', min: 3000, spd: 250 }, { fix: 'NEPIV', min: 3000, spd: 250 }, { fix: 'EVSEN', min: 3000, spd: 250 }, { fix: 'TUTSO', min: 3000, spd: 250 }] },
  ],

  sids: [
    { name: 'LNO9S', runways: ['22L', '22R'], initialClimb: 'F060', exitFix: 'LNO', legs: [{ fix: 'LG001', min: 1100 }, { fix: 'LG002' }, { fix: 'LG003', min: 6500, spd: 220 }, { fix: 'LG004', spd: 220 }, { fix: 'LG005' }, { fix: 'LNO' }] },
    { name: 'LNO7E', runways: ['22L', '22R'], initialClimb: 'F060', exitFix: 'LNO', legs: [{ fix: 'LG001', min: 1100 }, { fix: 'LG002' }, { fix: 'LG003', min: 6500, spd: 220 }, { fix: 'LG006', spd: 220 }, { fix: 'LNO' }], atcDiscretion: true },
    { name: 'CIV5S', runways: ['22L', '22R'], initialClimb: 'F060', exitFix: 'CIV', legs: [{ fix: 'LG001', min: 1100 }, { fix: 'LG002' }, { fix: 'LG003', min: 6500 }, { fix: 'BUB' }, { fix: 'CIV' }] },
    { name: 'BUB9S', runways: ['22L', '22R'], initialClimb: 'F060', exitFix: 'BUB', legs: [{ fix: 'LG001', min: 1100 }, { fix: 'LG002' }, { fix: 'LG003', min: 6500 }, { fix: 'BUB' }] },
    { name: 'LNO2R', runways: ['04R', '04L'], initialClimb: 'F060', exitFix: 'LNO', legs: [{ fix: 'LG011', min: 1100 }, { fix: 'LG012' }, { fix: 'LG013', min: 6000, spd: 220 }, { fix: 'LG008', spd: 220 }, { fix: 'LG009', spd: 220 }, { fix: 'LG010' }, { fix: 'LNO' }] },
    { name: 'CIV6R', runways: ['04R', '04L'], initialClimb: 'F060', exitFix: 'CIV', legs: [{ fix: 'LG011', min: 1100 }, { fix: 'LG012' }, { fix: 'LG013', min: 6000, spd: 220 }, { fix: 'LG008' }, { fix: 'BUB' }, { fix: 'CIV' }] },
    { name: 'BUB1R', runways: ['04R', '04L'], initialClimb: 'F060', exitFix: 'BUB', legs: [{ fix: 'LG011', min: 1100 }, { fix: 'LG012' }, { fix: 'LG013', min: 6000, spd: 220 }, { fix: 'LG008' }, { fix: 'BUB' }] },
  ],

  holds: [
    { fix: 'ALHUV', inboundTrue: 45, turn: 'L', minAlt: 3000, maxAlt: 'F050', maxSpd: 230 },
    { fix: 'GIREL', inboundTrue: 316, turn: 'L', minAlt: 'F060', maxAlt: 'F140', maxSpd: 250, atcDiscretion: true },
    { fix: 'GSY', inboundTrue: 94.6, turn: 'R', minAlt: 'F070', maxAlt: 'F100', maxSpd: 250, atcDiscretion: true },
  ],

  ctr: {
    name: 'Liège CTR', floor: 0, ceiling: 2500,
    poly: [
      { lat: '504512N', lon: '0052633E' },
      { arcCentre: { lat: '504137N', lon: '0053205E' }, radius: 5, to: { lat: '503802N', lon: '0053736E' }, dir: 'cw' },
      { lat: '503113N', lon: '0052641E' },
      { arcCentre: { lat: '503447N', lon: '0052110E' }, radius: 5, to: { lat: '503821N', lon: '0051538E' }, dir: 'cw' },
    ],
  },
  tma: {
    name: 'Liège TMA (approximate)', floor: 2500, ceiling: 'F095', approx: true,
    poly: [
      { lat: '505700N', lon: '0050000E' }, { lat: '505700N', lon: '0055800E' },
      { lat: '502100N', lon: '0055800E' }, { lat: '502100N', lon: '0050000E' },
    ],
  },
  tsas: [
    {
      name: 'TSA28', floor: 0, ceiling: 'F105', approx: true, note: 'Elsenborn, ground to FL105',
      poly: [{ lat: '503100N', lon: '0060300E' }, { lat: '503100N', lon: '0062400E' }, { lat: '501900N', lon: '0062400E' }, { lat: '501900N', lon: '0060300E' }],
    },
    {
      name: 'TSA29A', floor: 4500, ceiling: 'F145', approx: true, note: 'Ardennes, 4,500 ft to FL145',
      poly: [{ lat: '501800N', lon: '0050600E' }, { lat: '501800N', lon: '0055100E' }, { lat: '500000N', lon: '0055100E' }, { lat: '500000N', lon: '0050600E' }],
    },
    {
      name: 'TSA26', floor: 0, ceiling: 'F095', approx: true, note: 'Southern Ardennes, up to FL095',
      poly: [{ lat: '495700N', lon: '0045400E' }, { lat: '495700N', lon: '0054800E' }, { lat: '494500N', lon: '0054800E' }, { lat: '494500N', lon: '0045400E' }],
    },
  ],
  mva: [
    {
      alt: 2500,
      poly: [{ lat: '505700N', lon: '0045100E' }, { lat: '505700N', lon: '0055700E' }, { lat: '504200N', lon: '0055700E' }, { lat: '503712N', lon: '0053900E' }, { lat: '503300N', lon: '0052700E' }, { lat: '502700N', lon: '0050600E' }, { lat: '502400N', lon: '0045100E' }],
    },
    {
      alt: 3000,
      poly: [{ lat: '504200N', lon: '0055700E' }, { lat: '504200N', lon: '0061200E' }, { lat: '502700N', lon: '0061200E' }, { lat: '501800N', lon: '0053600E' }, { lat: '501800N', lon: '0045100E' }, { lat: '502400N', lon: '0045100E' }, { lat: '502700N', lon: '0050600E' }, { lat: '503300N', lon: '0052700E' }, { lat: '503712N', lon: '0053900E' }],
    },
    {
      alt: 3500,
      poly: [{ lat: '502700N', lon: '0061200E' }, { lat: '502700N', lon: '0063600E' }, { lat: '495400N', lon: '0063600E' }, { lat: '495400N', lon: '0045100E' }, { lat: '501800N', lon: '0045100E' }, { lat: '501800N', lon: '0053600E' }],
    },
  ],
  vfrRoutes: [
    { name: 'ROMEO-FOXHE', points: ['ROMEO', 'FOXHE'], alt: 1500 },
    { name: 'OSCAR-INDIA', points: ['OSCAR', 'INDIA'], alt: 1500 },
  ],
  mapLines: [
    { name: 'Meuse', style: 'river', points: ['NAMUR', 'M_ANDENNE', 'HUY', 'M_AMAY', 'M_SERAING', 'LIEGE', 'M_VISE', 'MAASTR'] },
  ],
};
