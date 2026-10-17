import type { PackSpec } from './types';

// Liège (EBLG) location pack.
// Checked against the skeyes eAIP Belgium & Luxembourg, AIRAC cycle effective
// 01 OCT 2026 (eAIP_Main; the 29 OCT 2026 edition was compared for EBLG AD 2):
//   EB AD 2 EBLG  (AD 2.2, 2.12, 2.17, 2.18, 2.19, 2.22 incl. the procedure coding tables)
//   EB ENR 2.1    (Liège TMA sub-areas, Brussels CTA remark)
//   EB ENR 5.2    (TSA 26, 28, 29)
//   EB ENR 1.7    (transition level table)
//   EB ENR 1.6    (SSR code block)
// Fix coordinates in the AD section are copied verbatim from the AIP coding
// tables. En-route fixes that the AD section does not list (KOK, MAK, GILOM,
// RUDIX, GESLO, RITAX) are solved by least squares from every published STAR
// leg that touches them (initial true course and distance), residual 0.1 NM or
// less. NIK is the centre of the 40 NM arc in ENR 2.1 (Liège TMA), which
// reproduces the coded NIK legs exactly. Items marked approximate are not from
// the AIP; docs/REALISM.md lists each one and why.

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
      'skeyes eAIP EB AD 2 EBLG, AIRAC effective 01 OCT 2026: https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-AD-2.EBLG-en-GB.html',
      'skeyes eAIP EB ENR 2.1 (Liège TMA): https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-2.1-en-GB.html',
      'skeyes eAIP EB ENR 5.2 (TSA 26/28/29): https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-5.2-en-GB.html',
      'skeyes eAIP EB ENR 1.7 (transition level): https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-1.7-en-GB.html',
      'skeyes eAIP EB ENR 1.6 (SSR codes 6330-6343 Liège): https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-1.6-en-GB.html',
    ],
    approximations: [
      'Minimum vectoring altitudes: the ATC Surveillance Minimum Altitude Chart (AD 2.EBLG-ATCSMAC.01) could not be retrieved; areas follow the TMA floors and terrain',
      'Sector ceiling FL095: the Liège TMA tops at FL055; the Brussels CTA above it (FL055 to FL095) is treated as delegated to Liège Approach',
      'Upstream unit frequencies (Brussels Control, Maastricht, Beek)',
      'Military unit name and frequency',
      'TMA and TSA boundaries that follow national borders are drawn as straight lines between the published border points',
      'Meuse river, motorways, national borders and town positions on the video map',
    ],
    tlTable: [
      { qnhMin: 942.2, qnhMax: 959.4, fl: 75 },
      { qnhMin: 959.5, qnhMax: 977.1, fl: 70 },
      { qnhMin: 977.2, qnhMax: 995.0, fl: 65 },
      { qnhMin: 995.1, qnhMax: 1013.2, fl: 60 },
      { qnhMin: 1013.3, qnhMax: 1031.6, fl: 55 },
      { qnhMin: 1031.7, qnhMax: 1050.3, fl: 50 },
    ],
    gndFreq: '121.915',
    squawkBlock: ['6330', '6343'],
    effective: '2026-10-01',
    initialClimbLowQnh: { qnhMax: 995, level: 'F070' },
    // The Brussels CTA over and around the TMA (ENR 2.1 remark): class C from 4,500 ft, delegated to Liège up to the sector ceiling.
    upperClass: { floor: 4500, cls: 'C' },
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
    // En-route fixes solved from the STAR coding tables: least squares on the initial
    // true course and distance of every coded leg that touches the fix (residual <= 0.1 NM).
    RUDIX: { lat: '502505.0N', lon: '0050604.2E', note: 'Solved from RUDIX-ALHUV 044.7/20.0, GSY-RUDIX 094.6/25.4, GIREL-RUDIX 300.4/19.6' },
    GILOM: { lat: '504506.7N', lon: '0044630.1E', note: 'Solved from GILOM-ALHUV 102.2/27.2, CIV-GILOM 073.1/37.5, NIK-GILOM 137.7/33.4' },
    MAK: { lat: '505754.7N', lon: '0032926.1E', note: 'Solved from MAK-ALHUV 103.2/77.4' },
    KOK: { lat: '510544.4N', lon: '0023843.0E', kind: 'vor', note: 'Solved from KOK-MAK 103.4/32.9 and KOK-GSY 118.8/78.3' },
    NIK: { lat: '510954N', lon: '0041102E', kind: 'vor', note: 'Centre of the ENR 2.1 Liège TMA 40 NM arc; reproduces NIK-GSY 167.0/43.8' },
    GESLO: { lat: '500443.7N', lon: '0060022.9E', note: 'Solved from GESLO-LNO 339.7/32.5 and GESLO-RITAX 269.5/7.7' },
    RITAX: { lat: '500439.7N', lon: '0054824.5E', note: 'Solved from GESLO-RITAX 269.5/7.7 and RITAX-GIREL 316.0/14.7' },
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
    // Motorways and national borders for the video map (approximate; motorways pass through the AIP VFR points)
    R_E40W: { lat: '504536N', lon: '0045700E', kind: 'map' },
    R_LONCIN: { lat: '504000N', lon: '0053000E', kind: 'map' },
    R_BATTICE: { lat: '503850N', lon: '0054950E', kind: 'map' },
    R_E40A: { lat: '504200N', lon: '0060000E', kind: 'map' },
    R_AACHEN: { lat: '504600N', lon: '0060500E', kind: 'map' },
    R_NAMUR: { lat: '502830N', lon: '0045230E', kind: 'map' },
    R_E42A: { lat: '503750N', lon: '0052300E', kind: 'map' },
    R_HASSELT: { lat: '505600N', lon: '0052030E', kind: 'map' },
    R_E25N: { lat: '505100N', lon: '0054200E', kind: 'map' },
    R_LIEGEC: { lat: '503730N', lon: '0053500E', kind: 'map' },
    R_E25S1: { lat: '502840N', lon: '0054100E', kind: 'map' },
    R_E25S2: { lat: '501930N', lon: '0054630E', kind: 'map' },
    B_TRI1: { lat: '504516N', lon: '0060117E', kind: 'map' },
    B_NL1: { lat: '504600N', lon: '0055000E', kind: 'map' },
    B_EIJSDEN: { lat: '504540N', lon: '0054200E', kind: 'map' },
    B_NL2: { lat: '504800N', lon: '0054100E', kind: 'map' },
    B_NL3: { lat: '505100N', lon: '0053830E', kind: 'map' },
    B_NL4: { lat: '505400N', lon: '0053900E', kind: 'map' },
    B_NL5: { lat: '505800N', lon: '0054400E', kind: 'map' },
    B_NL6: { lat: '510400N', lon: '0054800E', kind: 'map' },
    B_DE1: { lat: '504000N', lon: '0060700E', kind: 'map' },
    B_DE2: { lat: '503300N', lon: '0061500E', kind: 'map' },
    B_DE3: { lat: '502400N', lon: '0062400E', kind: 'map' },
    B_DE4: { lat: '501800N', lon: '0062000E', kind: 'map' },
    B_TRI2: { lat: '500800N', lon: '0060800E', kind: 'map' },
    B_LU1: { lat: '495800N', lon: '0055600E', kind: 'map' },
    B_LU2: { lat: '494800N', lon: '0055100E', kind: 'map' },
    // Hospital pad used by HEMS traffic (approximate, CHU Sart Tilman area)
    CHU: { lat: '503400N', lon: '0053400E', kind: 'map', note: 'CHU hospital (approximate)' },
    // Geilenkirchen departure gate for E-3A traffic (sim construct)
    G_ETNG: { lat: '505200N', lon: '0055400E', kind: 'map' },
  },

  runways: [
    {
      id: '22L', thr: { lat: '503852.63N', lon: '0052739.08E' }, crsTrue: 225.16, elevation: 595, lengthM: 3690,
      ils: { ident: 'ILG', freq: '109.350', cat: 'III', gp: '331.850' }, rnp: true,
      if: { fix: 'LIBVA', alt: 2500 }, faf: { fix: 'L22LF', alt: 2500 }, missed: ['L22LT', 'ALHUV'],
      gpDeg: 3, tch: 56, missedAlt: 3000, missedSpd: 215,
    },
    {
      id: '04R', thr: { lat: '503743.10N', lon: '0052548.82E' }, crsTrue: 45.16, elevation: 644, lengthM: 3690,
      ils: { ident: 'IHH', freq: '108.750', cat: 'III', gp: '330.350' }, rnp: true,
      if: { fix: 'TUTSO', alt: 3000 }, faf: { fix: 'L04RF', alt: 3000 }, missed: ['L04RT', 'ALHUV'],
      gpDeg: 3, tch: 58, missedAlt: 3000, missedSpd: 215,
      notes: 'Displaced threshold (3,046 m to the 22L threshold). The ILS is also flown from ALHUV via ABLAZ 2,500 ft, PIZVE 2,200 ft, KAQZI (IF) 2,100 ft',
    },
    {
      id: '22R', thr: { lat: '503845.91N', lon: '0052713.03E' }, crsTrue: 225.16, elevation: 577, lengthM: 2340,
      ils: { ident: 'IBI', freq: '109.350', cat: 'I', gp: '331.850' }, rnp: true, contingency: true,
      if: { fix: 'LAVTO', alt: 2500 }, faf: { fix: 'L22RF', alt: 2500 }, missed: ['L22RT', 'ALHUV'],
      gpDeg: 3, tch: 54, missedAlt: 3000, missedSpd: 215,
      notes: 'Contingency runway, ILS CAT I only. Shares 109.350 with ILS 22L (ident IBI); the two runways are never in use together',
    },
    {
      id: '04L', thr: { lat: '503752.59N', lon: '0052548.50E' }, crsTrue: 45.16, elevation: 629, lengthM: 2340,
      rnp: true, contingency: true,
      if: { fix: 'MAPUP', alt: 3000 }, faf: { fix: 'L04LF', alt: 3000 }, missed: ['L04LT', 'ALHUV'],
      gpDeg: 3, tch: 50, missedAlt: 3000, missedSpd: 215,
      notes: 'Contingency runway, no ILS (RNP APCH only)',
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
    // AD 2.22 holding table and the HM coding: 1 minute legs; inbound 043/314/093 magnetic (variation 2°E)
    { fix: 'ALHUV', inboundTrue: 45, turn: 'L', minAlt: 3000, maxAlt: 'F050', maxSpd: 230, inboundMag: 43, legMin: 1 },
    { fix: 'GIREL', inboundTrue: 316, turn: 'L', minAlt: 'F060', maxAlt: 'F140', maxSpd: 250, atcDiscretion: true, inboundMag: 314, legMin: 1 },
    { fix: 'GSY', inboundTrue: 94.6, turn: 'R', minAlt: 'F070', maxAlt: 'F100', maxSpd: 250, atcDiscretion: true, inboundMag: 93, legMin: 1 },
  ],

  ctr: {
    name: 'Liège CTR', floor: 0, ceiling: 2500, cls: 'D', hours: 'H24',
    poly: [
      { lat: '504512N', lon: '0052633E' },
      { arcCentre: { lat: '504137N', lon: '0053205E' }, radius: 5, to: { lat: '503802N', lon: '0053736E' }, dir: 'cw' },
      { lat: '503113N', lon: '0052641E' },
      { arcCentre: { lat: '503447N', lon: '0052110E' }, radius: 5, to: { lat: '503821N', lon: '0051538E' }, dir: 'cw' },
    ],
  },
  // ENR 2.1: the H24 core of the Liège TMA (class C, 2,500 ft to FL055; top 4,500 ft while TRA23 is active).
  // All five published sub-areas are in tmaParts; this one is drawn on the scope.
  tma: {
    name: 'Liège TMA One', floor: 2500, ceiling: 'F055', cls: 'C', hours: 'H24', note: 'Upper limit 4,500 ft when TRA23 is active',
    poly: [
      { lat: '503101N', lon: '0050701E' }, { lat: '503814N', lon: '0050408E' }, { lat: '504817N', lon: '0051953E' },
      { lat: '505150N', lon: '0052933E' }, { lat: '505223N', lon: '0053408E' }, { lat: '505000N', lon: '0053854E' },
      { lat: '504935N', lon: '0053857E' }, { lat: '504851N', lon: '0053815E' }, { lat: '504611N', lon: '0054446E' },
      { lat: '504519N', lon: '0054824E' }, { lat: '504503N', lon: '0055324E' }, { lat: '503917N', lon: '0054900E' },
      { lat: '502426N', lon: '0052347E' },
      { arcCentre: { lat: '502912N', lon: '0051650E' }, radius: 6.5, to: { lat: '503101N', lon: '0050701E' }, dir: 'cw' },
    ],
  },
  // ENR 2.1 sub-areas in AIP order. Names One..Five are sim labels; the AIP rows carry no name column in the extract read.
  // Times are UTC; the bracketed AIP times apply in summer.
  tmaParts: [
    {
      name: 'Liège TMA One', floor: 2500, ceiling: 'F055', cls: 'C', hours: 'H24', note: 'Upper limit 4,500 ft when TRA23 is active',
      poly: [
        { lat: '503101N', lon: '0050701E' }, { lat: '503814N', lon: '0050408E' }, { lat: '504817N', lon: '0051953E' },
        { lat: '505150N', lon: '0052933E' }, { lat: '505223N', lon: '0053408E' }, { lat: '505000N', lon: '0053854E' },
        { lat: '504935N', lon: '0053857E' }, { lat: '504851N', lon: '0053815E' }, { lat: '504611N', lon: '0054446E' },
        { lat: '504519N', lon: '0054824E' }, { lat: '504503N', lon: '0055324E' }, { lat: '503917N', lon: '0054900E' },
        { lat: '502426N', lon: '0052347E' },
        { arcCentre: { lat: '502912N', lon: '0051650E' }, radius: 6.5, to: { lat: '503101N', lon: '0050701E' }, dir: 'cw' },
      ],
    },
    {
      name: 'Liège TMA Two', floor: 2000, ceiling: 2500, cls: 'C', hours: 'H24', note: 'North-east of the CTR, partly in the Amsterdam FIR',
      poly: [
        { lat: '503802N', lon: '0053736E' },
        { arcCentre: { lat: '504137N', lon: '0053205E' }, radius: 5, to: { lat: '504512N', lon: '0052633E' }, dir: 'ccw' },
        { lat: '505119N', lon: '0053615E' }, { lat: '505000N', lon: '0053854E' }, { lat: '504935N', lon: '0053857E' },
        { lat: '504851N', lon: '0053815E' }, { lat: '504611N', lon: '0054446E' }, { lat: '504519N', lon: '0054824E' },
        { lat: '504516N', lon: '0054926E' },
      ],
    },
    {
      name: 'Liège TMA Three', floor: 2500, ceiling: 'F055', cls: 'C', hours: 'Daily 2200-0500 UTC (summer 2100-0400), not with Beauvechain TMA or TRA23 active',
      approx: true, note: 'Night ring around TMA One. The short Belgian-Dutch border segment is straightened',
      poly: [
        { lat: '503917N', lon: '0054900E' }, { lat: '502426N', lon: '0052347E' },
        { arcCentre: { lat: '502912N', lon: '0051650E' }, radius: 6.5, to: { lat: '503101N', lon: '0050701E' }, dir: 'cw' },
        { lat: '503814N', lon: '0050408E' }, { lat: '504817N', lon: '0051953E' }, { lat: '505150N', lon: '0052933E' },
        { lat: '505223N', lon: '0053408E' }, { lat: '505000N', lon: '0053854E' }, { lat: '505247N', lon: '0053956E' },
        { lat: '505525N', lon: '0053956E' }, { lat: '505530N', lon: '0052754E' }, { lat: '505107N', lon: '0050712E' },
        { arcCentre: { lat: '510954N', lon: '0041102E' }, radius: 40, to: { lat: '503810N', lon: '0044949E' }, dir: 'cw' },
        { lat: '503640N', lon: '0045629E' }, { lat: '502239N', lon: '0045928E' },
        { arcCentre: { lat: '501521N', lon: '0045417E' }, radius: 8, to: { lat: '501843N', lon: '0050539E' }, dir: 'cw' },
        { arcCentre: { lat: '503914N', lon: '0052814E' }, radius: 25, to: { lat: '501418N', lon: '0053224E' }, dir: 'ccw' },
        { lat: '502118N', lon: '0054222E' }, { lat: '502627N', lon: '0053920E' },
      ],
    },
    {
      name: 'Liège TMA Four', floor: 3000, ceiling: 'F055', cls: 'C', hours: 'As TMA Three',
      poly: [
        { lat: '504503N', lon: '0055324E' }, { lat: '504459N', lon: '0055454E' }, { lat: '504508N', lon: '0055956E' },
        { lat: '503042N', lon: '0055956E' }, { lat: '502627N', lon: '0053920E' },
      ],
    },
    {
      name: 'Liège TMA Five', floor: 3500, ceiling: 'F055', cls: 'C', hours: 'As TMA Three', approx: true,
      note: 'TSA28A excluded. The Belgian-German border segment is straightened',
      poly: [
        { lat: '503042N', lon: '0055956E' }, { lat: '504513N', lon: '0055956E' }, { lat: '504515N', lon: '0060116E' },
        { lat: '503325N', lon: '0061027E' },
      ],
    },
  ],
  // ENR 5.2 lateral limits as published (borders straightened between the published points).
  // Activation is by NOTAM/AUP; the sim switches them with scenario events.
  tsas: [
    {
      name: 'TSA28A', floor: 0, ceiling: 'F105', note: 'Elsenborn, GND to FL105', hours: 'NOTAM', approx: true,
      poly: [{ lat: '503420N', lon: '0055956E' }, { lat: '503754N', lon: '0061308E' }, { lat: '502557N', lon: '0062234E' }, { lat: '502557N', lon: '0060648E' }, { lat: '503042N', lon: '0055956E' }],
    },
    {
      name: 'TSA28B', floor: 0, ceiling: 'F105', note: 'Elsenborn south, GND to FL105', hours: 'NOTAM', approx: true,
      poly: [{ lat: '503042N', lon: '0055956E' }, { lat: '502557N', lon: '0060648E' }, { lat: '502557N', lon: '0062234E' }, { lat: '501328N', lon: '0061006E' }, { lat: '501328N', lon: '0060341E' }, { lat: '501955N', lon: '0055956E' }],
    },
    {
      name: 'TSA29A', floor: 4500, ceiling: 'F145', note: 'Ardennes, 4,500 ft to FL145 (base FL065 inside CBA16B), Monday to Friday by NOTAM', hours: 'NOTAM',
      poly: [
        { lat: '495835N', lon: '0040853E' }, { lat: '500338N', lon: '0040939E' }, { lat: '501425N', lon: '0043911E' },
        { lat: '502231N', lon: '0045226E' }, { lat: '503001N', lon: '0052456E' }, { lat: '502627N', lon: '0053920E' },
        { lat: '500426N', lon: '0055210E' }, { lat: '500120N', lon: '0055102E' }, { lat: '500118N', lon: '0054241E' },
        { lat: '494735N', lon: '0054237E' }, { lat: '494137N', lon: '0051624E' }, { lat: '494030N', lon: '0051133E' },
        { lat: '494040N', lon: '0045055E' }, { lat: '494920N', lon: '0041830E' },
      ],
    },
    {
      name: 'TSA29B', floor: 4500, ceiling: 'F095', note: 'East of TSA29A, only together with it; top may be lowered to FL075', hours: 'NOTAM', approx: true,
      poly: [
        { lat: '502627N', lon: '0053920E' }, { lat: '503042N', lon: '0055956E' }, { lat: '501955N', lon: '0055956E' },
        { lat: '501324N', lon: '0060343E' }, { lat: '501011N', lon: '0060832E' }, { lat: '500748N', lon: '0060816E' },
        { lat: '500426N', lon: '0055210E' },
      ],
    },
    {
      name: 'TSA26B', floor: 4500, ceiling: 'F095', note: 'Western Ardennes, 4,500 ft to FL095 (TSA26A above it, FL095 to UNL)', hours: 'NOTAM',
      poly: [
        { lat: '495854N', lon: '0054241E' }, { lat: '494735N', lon: '0054237E' }, { lat: '494137N', lon: '0051624E' },
        { lat: '494030N', lon: '0051133E' }, { lat: '494040N', lon: '0045055E' }, { lat: '494920N', lon: '0041830E' },
        { lat: '495835N', lon: '0040853E' }, { lat: '500853N', lon: '0041028E' }, { lat: '503205N', lon: '0040655E' },
        { lat: '503335N', lon: '0041214E' }, { lat: '503813N', lon: '0043620E' }, { lat: '503519N', lon: '0045040E' },
        { lat: '500118N', lon: '0054241E' },
      ],
    },
  ],
  // Minimum vectoring altitudes. The ATCSMAC chart (AD 2.EBLG-ATCSMAC.01, pages dated 21 MAR 2024)
  // could not be retrieved. Approximation: the areas follow the published TMA floors (TMA One 2,500 ft,
  // TMA Four 3,000 ft, TMA Five 3,500 ft) and terrain plus 1,000 ft obstacle clearance rounded up to
  // 500 ft (Condroz 3,000 ft; Hautes Fagnes, Botrange 694 m, and the Ardennes 3,500 ft). The published
  // procedure altitudes inside the 2,500 ft area (KAQZI 2,100 ft, PIZVE 2,200 ft) are lower still.
  mva: [
    {
      alt: 2500,
      poly: [{ lat: '505700N', lon: '0045100E' }, { lat: '505700N', lon: '0055700E' }, { lat: '504503N', lon: '0055324E' }, { lat: '503917N', lon: '0054900E' }, { lat: '503712N', lon: '0053900E' }, { lat: '503300N', lon: '0052700E' }, { lat: '502700N', lon: '0050600E' }, { lat: '502400N', lon: '0045100E' }],
    },
    {
      alt: 3000,
      poly: [{ lat: '504503N', lon: '0055324E' }, { lat: '504508N', lon: '0055956E' }, { lat: '503042N', lon: '0055956E' }, { lat: '501800N', lon: '0055000E' }, { lat: '501800N', lon: '0045100E' }, { lat: '502400N', lon: '0045100E' }, { lat: '502700N', lon: '0050600E' }, { lat: '503300N', lon: '0052700E' }, { lat: '503712N', lon: '0053900E' }, { lat: '503917N', lon: '0054900E' }],
    },
    {
      alt: 3500,
      poly: [{ lat: '504508N', lon: '0055956E' }, { lat: '505000N', lon: '0055956E' }, { lat: '505000N', lon: '0063600E' }, { lat: '495400N', lon: '0063600E' }, { lat: '495400N', lon: '0045100E' }, { lat: '501800N', lon: '0045100E' }, { lat: '501800N', lon: '0055000E' }, { lat: '503042N', lon: '0055956E' }],
    },
  ],
  vfrRoutes: [
    { name: 'ROMEO-FOXHE', points: ['ROMEO', 'FOXHE'], alt: 1500 },
    { name: 'OSCAR-INDIA', points: ['OSCAR', 'INDIA'], alt: 1500 },
  ],
  mapLines: [
    { name: 'Meuse', style: 'river', points: ['NAMUR', 'M_ANDENNE', 'HUY', 'M_AMAY', 'M_SERAING', 'LIEGE', 'M_VISE', 'MAASTR'] },
    { name: 'E40', style: 'road', points: ['R_E40W', 'ROMEO', 'R_LONCIN', 'ECHO', 'R_BATTICE', 'R_E40A', 'R_AACHEN'] },
    { name: 'E42', style: 'road', points: ['R_NAMUR', 'WISKY', 'R_E42A', 'R_LONCIN'] },
    { name: 'E313', style: 'road', points: ['R_LONCIN', 'NOVEM', 'R_HASSELT'] },
    { name: 'E25', style: 'road', points: ['R_E25N', 'ECHO', 'R_LIEGEC', 'R_E25S1', 'R_E25S2'] },
    { name: 'BE-NL', style: 'border', points: ['B_TRI1', 'B_NL1', 'B_EIJSDEN', 'B_NL2', 'B_NL3', 'B_NL4', 'B_NL5', 'B_NL6'] },
    { name: 'BE-DE', style: 'border', points: ['B_TRI1', 'B_DE1', 'B_DE2', 'B_DE3', 'B_DE4', 'B_TRI2'] },
    { name: 'BE-LU', style: 'border', points: ['B_TRI2', 'B_LU1', 'B_LU2'] },
  ],

  // ---------------------------------------------------------------------------
  // 2.0: what the engine used to assume about Liège.
  stackFix: 'ALHUV',
  country: 'BE',
  utcOffsetWinter: 1,
  depXfl: 'F090',
  reservedAreasName: 'TSA',
  runwayConfigs: [{ land: '22L', dep: '22L' }, { land: '04R', dep: '04R' }],
  // Intercom units. Ids are what clearances, strips, keys and saved tutorials use; keep them.
  // Liège Tower 118.130 (8.33 kHz channel): EBLG AD 2.18. Beek Approach 123.980: EHBK AD 2.18 (LVNL eAIP).
  // Brussels Control and Maastricht Radar are plausible values, not verified; the military unit is a sim construct.
  units: [
    { id: 'TWR', role: 'tower', callsign: 'Liège Tower', freq: '118.130', label: 'TWR', source: 'EBLG AD 2.18', voices: ['fr'], say: 'Tower' },
    { id: 'BRU', role: 'acc', callsign: 'Brussels Control', freq: '131.100', label: 'ACC', source: 'not verified', voices: ['nl', 'fr'], say: 'Brussels' },
    { id: 'MIL', role: 'military', callsign: 'Military', freq: '129.100', label: 'Steenokkerzeel', source: 'sim construct (Belgian military ATCC, Steenokkerzeel)', voices: ['nl', 'fr'], say: 'MIL' },
    { id: 'BEEK', role: 'neighbour', callsign: 'Beek Approach', freq: '123.980', label: 'BEEK', source: 'EHBK AD 2.18 (LVNL eAIP)', voices: ['nl'] },
    { id: 'MUAC', role: 'upper', callsign: 'Maastricht Radar', freq: '132.755', label: '> FL245', source: 'callsign as in the upstream list; not verified', voices: ['de', 'nl', 'uk'] },
    { id: 'SUP', role: 'supervisor', callsign: 'Supervisor', freq: '', label: 'supervisor', source: 'sim construct', voices: ['fr'], say: 'Supervisor' },
  ],
  // How crews say five-letter fixes and local names (voice engine). Hard g is written "gh" so it is not read as "j".
  fixSay: {
    ALHUV: 'Al-hoov', GILOM: 'Ghee-lom', GESLO: 'Guess-low', RUDIX: 'Roo-dix', RITAX: 'Ree-tax', IPLAN: 'Ee-plan',
    RERTI: 'Rare-tee', OLPUN: 'Ol-pun', GIKLI: 'Ghee-klee', LIBVA: 'Lib-vah', LAVTO: 'Lav-toe', LITPO: 'Lit-poe',
    OSTAT: 'Oh-stat', NEPIV: 'Neh-piv', EVSEN: 'Ev-sen', MAPUP: 'Mah-pup', TUTSO: 'Toot-so', ABLAZ: 'Ab-laz',
    PIZVE: 'Piz-veh', KAQZI: 'Kak-zee', GIREL: 'Ghee-rel', FOXHE: 'Fox-hay', WISKY: 'Whisky', NOVEM: 'November',
    SIERA: 'Sierra', NAMUR: 'Nah-moor', ROMEO: 'Romeo', INDIA: 'India', OSCAR: 'Oscar',
    'Liège': 'Leeyezh', 'Beek': 'Bake', 'Maastricht': 'Mah-strikt', 'Steenokkerzeel': 'Stain-ocker-zail', 'Bierset': 'Beer-say',
  },
  // Traffic generation: a cargo hub with one long runway. Operators that fly freighters into Liège, with the types
  // they typically use; the night inbound bank is long-haul heavies, mostly from the Gulf, Africa and Asia.
  traffic: {
    cargo: [
      { op: 'FDX', types: ['B77L', 'MD11', 'B763'], w: 4 },
      { op: 'QTR', types: ['B77L', 'B748'], w: 4 },
      { op: 'THY', types: ['A332', 'B77L'], w: 3 },
      { op: 'ETH', types: ['B77L', 'B763'], w: 3 },
      { op: 'CHG', types: ['B748', 'B744'], w: 3 },
      { op: 'TAY', types: ['B744', 'B763', 'B738'], w: 4 },
      { op: 'MSR', types: ['A332'], w: 1 },
      { op: 'AZG', types: ['B748', 'B744'], w: 2 },
      { op: 'CAO', types: ['B77L'], w: 1 },
      { op: 'CKS', types: ['B744', 'B77L'], w: 2 },
      { op: 'CLX', types: ['B748', 'B744'], w: 2 },
      { op: 'DHK', types: ['B763', 'A306'], w: 2 },
      { op: 'ABR', types: ['B738'], w: 2 },
      { op: 'BCS', types: ['A306', 'B752'], w: 2 },
    ],
    bank: [
      { op: 'TAY', types: ['B744', 'B763'], w: 4 },
      { op: 'QTR', types: ['B77L', 'B748'], w: 4 },
      { op: 'ETH', types: ['B77L'], w: 3 },
      { op: 'CKS', types: ['B744', 'B77L'], w: 2 },
      { op: 'FDX', types: ['B77L', 'MD11'], w: 3 },
      { op: 'CHG', types: ['B748', 'B744'], w: 3 },
      { op: 'AZG', types: ['B748'], w: 1 },
    ],
    pax: [
      { op: 'JAF', types: ['B738'], w: 3 },
      { op: 'RYR', types: ['B738'], w: 2 },
      { op: 'BEL', types: ['A320', 'A321'], w: 2 },
      { op: 'TRA', types: ['B738'], w: 1 },
    ],
    military: [
      { op: 'BAF', types: ['F35', 'A400'], w: 2 },
      { op: 'NATO', types: ['E3TF'], w: 1 },
      { op: 'RCH', types: ['C17'], w: 1 },
    ],
    gaPrefixes: ['OO'],
    registration: { prefix: 'OO', length: 5 },
    // Liège over 24 hours (UTC). Long-haul departures in the evening, the night inbound bank (integrator feeders and
    // long-haul freighters), a short lull while the hub sorts, the outbound bank, a quiet early morning, then a
    // steady daytime mix with a few passenger flights. Rates are movements per hour, linear between points.
    curve: {
      arr: [[0, 16], [0.75, 22], [1.25, 24], [2.4, 23], [2.7, 6], [3.25, 4], [5.25, 3], [6, 3], [7, 6], [8, 8], [17, 8], [18, 6], [21.5, 6], [22.5, 9], [23.5, 13], [24, 16]],
      dep: [[0, 3], [2.75, 2], [3.25, 4], [3.5, 18], [3.75, 22], [4.75, 20], [5.25, 6], [6, 3], [7, 5], [8, 7], [17, 7], [18, 9], [19.5, 11], [21.5, 8], [22.5, 4], [24, 3]],
      max: { arr: 24, dep: 22 },
      phases: [
        { from: 0, to: 2.75, phase: 'bank', label: 'night inbound bank', paxShare: 0 },
        { from: 2.75, to: 3.25, phase: 'sort', label: 'the sort', paxShare: 0 },
        { from: 3.25, to: 5.25, phase: 'outbound', label: 'outbound bank', paxShare: 0 },
        { from: 5.25, to: 8, phase: 'morning', label: 'quiet morning', paxShare: 0.15 },
        { from: 8, to: 18, phase: 'day', label: 'daytime mix', paxShare: 0.25 },
        { from: 18, to: 23.5, phase: 'evening', label: 'evening departures', paxShare: 0.1 },
        { from: 23.5, to: 24, phase: 'bank', label: 'night inbound bank', paxShare: 0 },
      ],
    },
    // Bank arrivals come mostly from the west (KOK, CIV) and the south-east (GESLO).
    arrivals: [{ base: 'KOK7', w: 3 }, { base: 'CIV7', w: 3 }, { base: 'NIK7', w: 2 }, { base: 'LNO6', w: 3 }, { base: 'GESLO6', w: 2 }],
    arrivalsBank: [{ base: 'KOK7', w: 3 }, { base: 'CIV7', w: 3 }, { base: 'GESLO6', w: 3 }, { base: 'LNO6', w: 2 }, { base: 'NIK7', w: 1 }],
    departures: [
      { name: 'LNO9S', w: 3 }, { name: 'CIV5S', w: 2 }, { name: 'BUB9S', w: 2 },
      { name: 'LNO2R', w: 3 }, { name: 'CIV6R', w: 2 }, { name: 'BUB1R', w: 2 },
    ],
    templates: {
      night: { title: 'Night bank', arrPerHr: 18, depPerHr: 9, start: '01:40', paxShare: 0 },
      day: { title: 'Daytime mix', arrPerHr: 11, depPerHr: 9, start: '10:15', paxShare: 0.25 },
      quiet: { title: 'Quiet hour', arrPerHr: 6, depPerHr: 4, start: '15:30', paxShare: 0.2 },
      shift: { title: 'Night shift', arrPerHr: 14, depPerHr: 6, start: '01:40', paxShare: 0 },
    },
    // TSA 29A is activated by NOTAM for weekday daytime flying only: 0600 to 2000 UTC in the sim.
    reserved: { name: 'TSA29A', hoursUtc: [6, 20] },
    // Diversions come from Brussels, straight at the field from the north-west.
    diversion: { from: 'Brussels', icao: 'EBBR', brg: 300 },
    // Transient traffic: VFR crossings on the published routes, the HEMS helicopter to the CHU pad, Belgian F-35s and
    // an A400M crossing the TMA, the NATO E-3A out of Geilenkirchen, a USAF C-17 overflight and a flight-check King Air.
    patterns: [
      { at: 1, deck: 'hems', w: 0.4, kind: 'vfr', csReg: true, types: ['C172', 'PA28'], route: ['ROMEO', 'FOXHE'], from: { brg: 300, dist: 7 }, level: 1500, request: { kind: 'crossing', route: ['ROMEO', 'FOXHE'] } },
      { at: 1, deck: 'hems', w: 0.6, kind: 'heli', cs: 'LIFE3', types: ['EC45'], route: ['NOVEM', 'CHU'], from: { brg: 5, dist: 8 }, level: 1500, request: { kind: 'direct', fix: 'CHU' } },
      { at: 2, deck: 'military', w: 0.5, kind: 'mil', csOp: 'BAF', csNum: [51, 79], types: ['F35'], formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: 'F070', spd: 300, request: { kind: 'climb', level: 'F150' } },
      { at: 2, kind: 'mil', csOp: 'NATO0', csNum: [1, 9], types: ['E3TF'], route: ['G_ETNG', 'ECHO', 'LNO', 'GIREL'], from: { brg: 30, dist: 3 }, level: 4000, request: { kind: 'climb', level: 'F150' } },
      { at: 2, kind: 'vfr', csReg: true, types: ['PA28'], route: ['OSCAR', 'INDIA'], from: { brg: 150, dist: 7 }, level: 1500, request: { kind: 'crossing', route: ['OSCAR', 'INDIA'] } },
      { at: 3, kind: 'ovf', csOp: 'RCH', csNum: [100, 899], types: ['C17'], route: ['BUB', 'LG013', 'LNO'], from: { brg: 300, dist: 6 }, level: 'F090', request: { kind: 'direct', fix: 'LNO' } },
      { at: 3, kind: 'cal', cs: 'FCK12', types: ['B350'], route: ['NOVEM'], from: { brg: 0, dist: 10 }, level: 3000, request: { kind: 'lowpass' } },
      { at: 3, deck: 'military', w: 0.5, kind: 'mil', csOp: 'BAF7', csNum: [10, 99], types: ['A400'], route: ['ROMEO', 'ALHUV', 'SPA'], from: { brg: 300, dist: 10 }, level: 'F060', request: { kind: 'climb', level: 'F090' } },
    ],
  },
};
