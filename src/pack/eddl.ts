import type { PackSpec } from './types';

// Düsseldorf (EDDL) location pack: the Düsseldorf arrival sector of Langen Radar.
// Checked against the DFS AIP IFR Germany (aip.dfs.de, free "basic" edition), AIRAC
// cycle effective 01 OCT 2026 (page dates as printed on each page):
//   AD 2 EDDL 1-1 .. 1-26  (AD 2.2, 2.12, 2.13, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22)
//   AD 2 EDDL 3-1-2        (STAR text: BIKMU 1A, DOMUX 1A, HALME 1A, LMA 1A, PISAP 1A)
//   AD 2 EDDL 3-1-3, 3-1-4 (RNAV transitions to final, RWY 05L/05R and 23L/23R)
//   AD 2 EDDL 4-2-1 .. 4-2-4 (ILS charts: FAF, GP, RDH, missed approach)
//   AD 2 EDDL 5-7-1 .. 5-7-18 (SID text and RNAV coding for all four runways)
//   AD 2 EDDL 6-1 .. 6-5   (waypoint list: every transition and SID coordinate)
//   ENR 1.7 (transition altitude 5,000 ft, transition level rule), ENR 2.1 (CTR
//   Düsseldorf, Langen ACC sectors EDGGDUS and EDGGBOT), ENR 4.4 (TEBRO, DOMEG,
//   BARAG), ENR 5.1 (ED-R 111 Jülich), AIP VFR EDDL 4 (visual operation chart).
// The AIP pages are served as images; they were read by OCR and by eye. Every
// coordinate below is copied from the AIP waypoint list or the ENR tables unless
// its note says otherwise. Items from secondary sources (VATSIM Germany SOP,
// the VFR chart read by eye, terrain) carry `approx: true` or a note, and
// docs/REALISM-EDDL.md lists each one and why.
//
// How the real operation maps onto the sim's STAR / transition model: the
// published STARs all end at the DUS VOR and are not flown in practice; Langen
// ACC hands arrivals over at BIKMU, DOMUX, XAMOD or TEBRO and the approach
// sector clears a published RNAV transition from the entry fix (the IAF of the
// sim) to the downwind and the final approach fix. In this pack a "STAR" is the
// en-route feed from the sector edge to that entry fix, carrying the published
// STAR designator; the transitions are the AIP's coded RNAV transitions.

export const EDDL: PackSpec = {
  meta: {
    icao: 'EDDL',
    name: 'Düsseldorf',
    arp: { lat: '511651.33N', lon: '0064526.32E' },
    elevation: 147,
    magVar: 3.2,
    transitionAltitude: 5000,
    appCallsign: 'Langen Radar',
    appFreq: '128.555',
    twrCallsign: 'Düsseldorf Tower',
    twrFreq: '118.305',
    atisFreq: '123.780',
    sectorRadiusNm: 40,
    sectorCeiling: 'F155',
    airac: '2026-10',
    upstream: [
      { name: 'Langen ACC, Bottrop sector', callsign: 'Langen Radar', freq: '119.110' },
      { name: 'Langen ACC, Köln arrival sector', callsign: 'Langen Radar', freq: '135.350' },
      { name: 'Maastricht UAC', callsign: 'Maastricht Radar', freq: '134.455' },
    ],
    sources: [
      'DFS AIP IFR Germany, AD 2 EDDL (text pages 1-1 to 1-26), AIRAC effective 01 OCT 2026: https://aip.dfs.de/BasicIFR/2026OCT01/chapter/8416f0a7e8c8e37b5751eefaacefdf5f.html',
      'DFS AIP IFR Germany, AD 2 EDDL 3-1-2 STAR text: https://aip.dfs.de/BasicIFR/2026OCT01/pages/D96866F1AD157BA1755D8EF187DA1DB0.html',
      'DFS AIP IFR Germany, AD 2 EDDL 3-1-3 and 3-1-4 RNAV transitions: https://aip.dfs.de/BasicIFR/2026OCT01/pages/E6B1DF7B8C51BE41773BE27E87E35496.html and https://aip.dfs.de/BasicIFR/2026OCT01/pages/F5B39EC787A37FCC6929F234FAB1416A.html',
      'DFS AIP IFR Germany, AD 2 EDDL 4-2-1 to 4-2-4 ILS charts: https://aip.dfs.de/BasicIFR/2026OCT01/pages/078629E043C811AC2FA6D1E99F21D421.html (05L), 7702EB23E7C985ACF278E773A618D80D (05R), 0B8E5BE8087BDED74BF18F548DC75336 (23L), C8593EFC368B76C1598679E2C94762EA (23R)',
      'DFS AIP IFR Germany, AD 2 EDDL 5-7-1 to 5-7-18 SID text: https://aip.dfs.de/BasicIFR/2026OCT01/pages/15A659F6DED333B8831A87ED76624951.html (23L) and following pages',
      'DFS AIP IFR Germany, AD 2 EDDL 6-1 to 6-5 waypoint list: https://aip.dfs.de/BasicIFR/2026OCT01/pages/D21CD939D6C9A7CC965C1379021FE31F.html and following pages',
      'DFS AIP IFR Germany, ENR 1.7 altimeter setting: https://aip.dfs.de/BasicIFR/2026OCT01/pages/27EB7AAFC3678219BFC868AD24AB89F1.html',
      'DFS AIP IFR Germany, ENR 2.1 (CTR Düsseldorf, Langen sectors EDGGDUS, EDGGBOT, EDGGDKA): https://aip.dfs.de/BasicIFR/2026OCT01/pages/6082AB9D58B4C675CAB9C93FDC766E7B.html and https://aip.dfs.de/BasicIFR/2026OCT01/pages/F0F6B90105058A2A638418B03D5BD69F.html',
      'DFS AIP IFR Germany, ENR 4.4 significant points (TEBRO, DOMEG, BARAG): https://aip.dfs.de/BasicIFR/2026OCT01/chapter/c69c6f01acfee2d1608fb933f70b7cc1.html',
      'DFS AIP IFR Germany, ENR 5.1 (ED-R 111 Jülich): https://aip.dfs.de/BasicIFR/2026OCT01/chapter/e5ef8334db6c5358588c2a468f506e5e.html',
      'DFS AIP VFR Germany, EDDL visual operation chart (VFR reporting points, class C floors): https://aip.dfs.de/BasicVFR/2026OCT15/pages/92B50F84CF65897B600133A824C88D96.html',
      'DFS AIP IFR Germany, AD 2 EDDK / EDLN / EDLV / EDLW 1-1 (neighbouring aerodrome reference points)',
      'VATSIM Germany, SOP FIR Langen, EDDL Approach / Tower / Delivery / Overview (sector working method, holdings, MVA figures, release agreements): https://knowledgebase.vatsim-germany.org/books/sops-fir-langen/page/eddl-approach',
      'Aero International, Düsseldorf 2025 traffic (about 21 million passengers, 159,900 movements): https://www.aerointernational.de/aktuelles/flughafen-duesseldorf-21-millionen-passagiere-und-starkes-wachstum-2025.html',
    ],
    approximations: [
      'Minimum vectoring altitudes: the DFS AIP publishes no ATC surveillance minimum altitude chart for EDDL in the free edition; the areas follow the VATSIM Germany SOP figures (2,200 ft around the field, 3,200 ft south of final 23L, winter values) and terrain plus 1,000 ft rounded up to 500 ft further out',
      'STARs: the published STARs (BIKMU 1A, DOMUX 1A, HALME 1A, LMA 1A, PISAP 1A) end at the DUS VOR; the sim flies them only to the entry fix, where the transitions start, and prepends one en-route fix (NVO, BARAG, DOMEG, VEBAK, TEBRO) so the aircraft has a track before the fix. Handoff levels are the middle of the AD 2.22 planning bands',
      'Transition runway assignment: the AIP says the runway assignment of the transitions is valid for lost communication only and that both runways are used during normal operations. The sim assigns each transition to the runway whose final approach fix it ends at',
      'Intermediate fixes I05L, I05R, I23L, I23R are sim constructs 4 NM outside the published final approach fix on the localizer course (the ILS charts have no named IF)',
      'Holding turn directions and the DUS holding inbound track were read from the small chart images (3-1-3, 3-1-4, 4-2-1) and may be wrong; the hold levels at DL409, DL429, DL503, DL524 (4,000 ft to FL070) and at DOMEG, NVO, ELDAR follow the VATSIM Germany SOP, not the AIP',
      'Class C area X (Niederrhein) follows the Dutch border between two published points; it is drawn as a straight line',
      'Transition level table: ENR 1.7 publishes a rule (the lowest flight level at least 1,000 ft above 5,000 ft) rather than a table; the table here is computed from the rule',
      'Maastricht Radar frequency, the Langen supervisor and the Geilenkirchen military unit (Frisbee Radar) are not verified',
      'Departure transfer level FL100 to Langen ACC is an assumption; the letter of agreement is not public',
      'Rhine, motorways, national border and town positions on the video map are drawn by hand; Essen/Mülheim (EDLE) position from its published location, not the AIP',
      'Traffic mix, fleets and the hourly demand curve are estimates built from the 2025 traffic figures and the published night restrictions',
    ],
    // ENR 1.7: TA 5,000 ft; TL = the lowest FL at least 1,000 ft above the TA at the current QNH (computed, see approximations).
    // Whole-hPa bands as German ATIS broadcasts them: FL60 at QNH 1013 and above, FL70 from 977 to 1012, FL80 below 977.
    tlTable: [
      { qnhMin: 942, qnhMax: 976.9, fl: 80 },
      { qnhMin: 977, qnhMax: 1012.9, fl: 70 },
      { qnhMin: 1013, qnhMax: 1051, fl: 60 },
    ],
    gndFreq: '121.680',
    effective: '2026-10-01',
  },

  fixes: {
    // ---- Transition entry fixes (IAFs of the sim) and transfer points (AD 2 EDDL 6-1 to 6-3, AD 2.22) ----
    BIKMU: { lat: '510620.40N', lon: '0064021.52E' },
    DOMUX: { lat: '512511.46N', lon: '0073210.88E' },
    HALME: { lat: '514219.00N', lon: '0071200.00E' },
    PISAP: { lat: '514738.47N', lon: '0063825.47E' },
    ELDAR: { lat: '510123.00N', lon: '0064046.00E' },
    XAMOD: { lat: '514123.36N', lon: '0070803.82E' },
    // ---- En-route feed fixes (ENR 4.4; AD 2.19 for the navaids) ----
    TEBRO: { lat: '515339N', lon: '0063516E', note: 'ENR 4.4, airway P62; Langen ACC transfer point FL130 to FL150' },
    DOMEG: { lat: '514234N', lon: '0073514E', note: 'ENR 4.4, airway T846; en-route holding for HALME arrivals (VATSIM SOP)' },
    BARAG: { lat: '512507N', lon: '0074831E', note: 'ENR 4.4, airways M170 and Z858 east of DOMUX' },
    VEBAK: { lat: '512728.72N', lon: '0062053.04E' },
    NVO: { lat: '504921.63N', lon: '0063811.52E', kind: 'vor', note: 'Nörvenich DVORTAC 116.20' },
    // ---- Transitions RWY 05L/05R (AD 2 EDDL 6-1, 6-2) ----
    VALSU: { lat: '512805.00N', lon: '0064528.00E' },
    GAPNU: { lat: '512244.13N', lon: '0064427.11E' },
    DL522: { lat: '512018.83N', lon: '0063922.33E' },
    RONAD: { lat: '511720.84N', lon: '0063310.33E' },
    DL524: { lat: '511527.57N', lon: '0062914.39E' },
    DL530: { lat: '511035.44N', lon: '0061908.60E' },
    DIKMI: { lat: '511143.59N', lon: '0063351.45E' },
    BOMBA: { lat: '513306.00N', lon: '0070625.00E' },
    DOLAV: { lat: '512518.00N', lon: '0071019.00E' },
    DL502: { lat: '511221.60N', lon: '0064901.01E' },
    DL503: { lat: '510956.50N', lon: '0064357.14E' },
    DL510: { lat: '510239.90N', lon: '0062848.74E' },
    NATOS: { lat: '511129.48N', lon: '0063404.52E' },
    DL501: { lat: '510822.68N', lon: '0065349.09E' },
    DL513: { lat: '512239.01N', lon: '0062829.04E' },
    IBIKO: { lat: '512730.34N', lon: '0063838.51E' },
    // ---- Transitions RWY 23L/23R (AD 2 EDDL 6-2, 6-3) ----
    AGEDA: { lat: '514658.61N', lon: '0070117.11E' },
    DL422: { lat: '513409.90N', lon: '0065241.04E' },
    DL426: { lat: '512922.99N', lon: '0065829.02E' },
    DL428: { lat: '513147.45N', lon: '0070335.83E' },
    DL429: { lat: '513411.68N', lon: '0070843.19E' },
    DL430: { lat: '513747.61N', lon: '0071625.25E' },
    REGNO: { lat: '512309.64N', lon: '0065751.21E' },
    DL405: { lat: '511500.42N', lon: '0070747.94E' },
    DL406: { lat: '511859.91N', lon: '0070300.38E' },
    DL409: { lat: '512612.02N', lon: '0071819.66E' },
    DL410: { lat: '512947.31N', lon: '0072601.12E' },
    METMA: { lat: '512259.21N', lon: '0065811.99E' },
    // ---- Additional transition waypoints drawn on the charts but not in the coded routes (AD 2 EDDL 6-4) ----
    DL402: { lat: '512140.63N', lon: '0072343.91E' },
    DL403: { lat: '511927.47N', lon: '0071824.73E' },
    DL404: { lat: '511714.06N', lon: '0071306.08E' },
    DL407: { lat: '512124.17N', lon: '0070806.27E' },
    DL408: { lat: '512348.21N', lon: '0071312.70E' },
    DL420: { lat: '513859.10N', lon: '0070255.68E' },
    DL421: { lat: '513634.62N', lon: '0065748.09E' },
    DL450: { lat: '513347.56N', lon: '0072113.61E' },
    DL452: { lat: '513011.95N', lon: '0071331.85E' },
    DL454: { lat: '512747.93N', lon: '0070824.69E' },
    DL455: { lat: '512523.68N', lon: '0070318.07E' },
    DL504: { lat: '510731.19N', lon: '0063853.81E' },
    DL505: { lat: '510505.65N', lon: '0063351.01E' },
    DL514: { lat: '512504.79N', lon: '0063333.51E' },
    DL517: { lat: '512958.68N', lon: '0065944.71E' },
    DL518: { lat: '512734.05N', lon: '0065438.30E' },
    DL519: { lat: '512509.20N', lon: '0064932.44E' },
    DL525: { lat: '511301.62N', lon: '0062411.23E' },
    DL550: { lat: '510637.77N', lon: '0062359.09E' },
    DL555: { lat: '510903.73N', lon: '0062901.54E' },
    // ---- Intermediate fixes on the localizer, 4 NM before the FAF (sim constructs, see approximations) ----
    I05L: { from: 'DIKMI', brg: 232.8, dist: 4, note: 'Sim construct: 12.9 NM final 05L' },
    I05R: { from: 'NATOS', brg: 232.8, dist: 4, note: 'Sim construct: 12.9 NM final 05R' },
    I23L: { from: 'METMA', brg: 52.8, dist: 4, note: 'Sim construct: 13 NM final 23L' },
    I23R: { from: 'REGNO', brg: 52.8, dist: 4, note: 'Sim construct: 13 NM final 23R' },
    // ---- SID waypoints (AD 2 EDDL 6-5) ----
    DL050: { lat: '511953.79N', lon: '0065142.56E' },
    DL051: { lat: '512028.59N', lon: '0065300.51E' },
    DL052: { lat: '512441.81N', lon: '0065014.15E' },
    DL053: { lat: '512102.47N', lon: '0065416.39E' },
    DL054: { lat: '515141.50N', lon: '0064934.13E' },
    DL058: { lat: '512115.66N', lon: '0065445.95E' },
    DL230: { lat: '511617.78N', lon: '0064404.71E' },
    DL235: { lat: '511718.06N', lon: '0064107.27E' },
    DL236: { lat: '511551.46N', lon: '0064308.01E' },
    DL237: { lat: '511559.02N', lon: '0064244.82E' },
    DL239: { lat: '511328.03N', lon: '0063759.54E' },
    DL240: { lat: '511325.23N', lon: '0063759.99E' },
    DL241: { lat: '510743.20N', lon: '0063854.64E' },
    DL242: { lat: '510912.37N', lon: '0072006.64E' },
    DL243: { lat: '511338.14N', lon: '0063821.26E' },
    DL244: { lat: '510843.03N', lon: '0070546.75E' },
    DL245: { lat: '515128.67N', lon: '0064410.19E' },
    DL247: { lat: '511337.03N', lon: '0063822.68E' },
    DL248: { lat: '512312.60N', lon: '0064144.34E' },
    ANAVI: { lat: '511843.07N', lon: '0072318.45E' },
    BETZO: { lat: '505800.02N', lon: '0074411.04E' },
    DEGOM: { lat: '510951.15N', lon: '0074025.88E' },
    DODEN: { lat: '503608.12N', lon: '0080535.70E' },
    ELBAL: { lat: '510925.41N', lon: '0072646.52E' },
    ERKUM: { lat: '513711.95N', lon: '0064146.66E' },
    KULIX: { lat: '512104.82N', lon: '0081450.05E' },
    KUMIK: { lat: '505011.71N', lon: '0080423.97E' },
    LIPMI: { lat: '510706.32N', lon: '0071608.33E' },
    LUSIX: { lat: '514224.50N', lon: '0065305.58E' },
    MAMIB: { lat: '511318.86N', lon: '0074237.19E' },
    MEVEL: { lat: '515117.18N', lon: '0071234.23E' },
    MODRU: { lat: '510102.96N', lon: '0060524.28E' },
    NETEX: { lat: '511940.87N', lon: '0061616.88E' },
    NIKOG: { lat: '512949.25N', lon: '0065636.85E' },
    NUDGO: { lat: '512449.05N', lon: '0082627.39E' },
    ORSOV: { lat: '513344.11N', lon: '0064015.02E' },
    SONEB: { lat: '520125.00N', lon: '0064551.00E' },
    UBORO: { lat: '512229.70N', lon: '0062700.19E' },
    // ---- Navaids (AD 2.19) ----
    DUS: { lat: '511659.48N', lon: '0064513.41E', kind: 'vor', note: 'Düsseldorf DVOR/DME 115.15; end of the published STARs, missed approach holding fix' },
    LMA: { lat: '512215.29N', lon: '0062341.73E', kind: 'ndb', note: 'Lima NDB 311.0' },
    BAM: { lat: '511939.93N', lon: '0071037.14E', kind: 'vor', note: 'Barmen DVOR/DME 114.00' },
    GMH: { lat: '511013.84N', lon: '0075331.34E', kind: 'vor', note: 'Germinghausen DVOR/DME 115.40' },
    COL: { lat: '504700.70N', lon: '0070539.03E', kind: 'vor', note: 'Cola DVOR/DME 108.80' },
    MHV: { lat: '511414.28N', lon: '0062924.88E', kind: 'vor', note: 'Mönchengladbach DVOR 109.80' },
    // ---- VFR reporting points of the CTR (AIP VFR EDDL visual operation chart) ----
    NOVEMBER: { lat: '512424N', lon: '0064454E', kind: 'vfr' },
    SIERRA: { lat: '510830N', lon: '0064712E', kind: 'vfr' },
    ECHO: { lat: '511130N', lon: '0065630E', kind: 'vfr' },
    // ---- Neighbouring aerodromes (AD 2.2 of each; EDLE from its published position) ----
    EDDK: { lat: '505157.30N', lon: '0070833.88E', kind: 'map', note: 'Köln/Bonn' },
    EDLN: { lat: '511349.28N', lon: '0063016.18E', kind: 'map', note: 'Mönchengladbach' },
    EDLV: { lat: '513608.69N', lon: '0060831.82E', kind: 'map', note: 'Niederrhein (Weeze)' },
    EDLW: { lat: '513105.93N', lon: '0073644.07E', kind: 'map', note: 'Dortmund' },
    EDLE: { lat: '512408N', lon: '0065614E', kind: 'map', note: 'Essen/Mülheim (approximate)' },
    // ---- Towns for the video map (approximate) ----
    DUESSELDORF: { lat: '511300N', lon: '0064700E', kind: 'town', note: 'Düsseldorf (city centre; the ARP is 4 NM north of it, AD 2.2)' },
    DUISBURG: { lat: '512600N', lon: '0064600E', kind: 'town', note: 'Duisburg' },
    ESSEN: { lat: '512730N', lon: '0070100E', kind: 'town', note: 'Essen' },
    KREFELD: { lat: '512000N', lon: '0063400E', kind: 'town', note: 'Krefeld' },
    NEUSS: { lat: '511200N', lon: '0064130E', kind: 'town', note: 'Neuss' },
    MGLADBACH: { lat: '511130N', lon: '0062600E', kind: 'town', note: 'Mönchengladbach' },
    KOELN: { lat: '505600N', lon: '0065730E', kind: 'town', note: 'Köln' },
    WUPPERTAL: { lat: '511600N', lon: '0071100E', kind: 'town', note: 'Wuppertal' },
    DORTMUND: { lat: '513100N', lon: '0072800E', kind: 'town', note: 'Dortmund' },
    BOCHUM: { lat: '512900N', lon: '0071300E', kind: 'town', note: 'Bochum' },
    LEVERKUSEN: { lat: '510200N', lon: '0070000E', kind: 'town', note: 'Leverkusen' },
    VENLO: { lat: '512200N', lon: '0061000E', kind: 'town', note: 'Venlo (NL)' },
    // ---- Rhine (approximate) ----
    M_RH1: { lat: '505000N', lon: '0070100E', kind: 'map' },
    M_RH2: { lat: '510800N', lon: '0065200E', kind: 'map' },
    M_RH3: { lat: '511330N', lon: '0064500E', kind: 'map' },
    M_RH4: { lat: '511800N', lon: '0064400E', kind: 'map' },
    M_RH5: { lat: '512300N', lon: '0064300E', kind: 'map' },
    M_RH6: { lat: '512700N', lon: '0064400E', kind: 'map' },
    M_RH7: { lat: '513300N', lon: '0063600E', kind: 'map' },
    M_RH8: { lat: '513900N', lon: '0063600E', kind: 'map' },
    M_RH9: { lat: '514600N', lon: '0062400E', kind: 'map' },
    M_RH10: { lat: '515000N', lon: '0061500E', kind: 'map' },
    // ---- Motorways (approximate) ----
    R_A3S: { lat: '505200N', lon: '0070400E', kind: 'map' },
    R_A3HI: { lat: '511000N', lon: '0065700E', kind: 'map' },
    R_A3RA: { lat: '511900N', lon: '0065200E', kind: 'map' },
    R_A3DU: { lat: '512800N', lon: '0064800E', kind: 'map' },
    R_A3WE: { lat: '514000N', lon: '0063900E', kind: 'map' },
    R_A3EM: { lat: '515000N', lon: '0061600E', kind: 'map' },
    R_A44W: { lat: '511000N', lon: '0062600E', kind: 'map' },
    R_A44N: { lat: '511400N', lon: '0063800E', kind: 'map' },
    R_A44A: { lat: '511700N', lon: '0064700E', kind: 'map' },
    R_A44E: { lat: '512100N', lon: '0070400E', kind: 'map' },
    R_A57S: { lat: '505700N', lon: '0065200E', kind: 'map' },
    R_A57N: { lat: '511000N', lon: '0064300E', kind: 'map' },
    R_A57K: { lat: '512100N', lon: '0063600E', kind: 'map' },
    R_A57M: { lat: '512800N', lon: '0063400E', kind: 'map' },
    R_A57G: { lat: '514100N', lon: '0060500E', kind: 'map' },
    R_A40V: { lat: '512300N', lon: '0061200E', kind: 'map' },
    R_A40D: { lat: '512600N', lon: '0064500E', kind: 'map' },
    R_A40E: { lat: '512700N', lon: '0070000E', kind: 'map' },
    R_A40B: { lat: '512900N', lon: '0071400E', kind: 'map' },
    R_A40DO: { lat: '513100N', lon: '0072600E', kind: 'map' },
    // ---- Dutch border (approximate) ----
    B_NL1: { lat: '504700N', lon: '0060100E', kind: 'map' },
    B_NL2: { lat: '505400N', lon: '0060200E', kind: 'map' },
    B_NL3: { lat: '510200N', lon: '0055700E', kind: 'map' },
    B_NL4: { lat: '511000N', lon: '0060400E', kind: 'map' },
    B_NL5: { lat: '511800N', lon: '0061200E', kind: 'map' },
    B_NL6: { lat: '512400N', lon: '0061300E', kind: 'map' },
    B_NL7: { lat: '513200N', lon: '0061200E', kind: 'map' },
    B_NL8: { lat: '514000N', lon: '0060500E', kind: 'map' },
    B_NL9: { lat: '514700N', lon: '0060700E', kind: 'map' },
    B_NL10: { lat: '515200N', lon: '0061000E', kind: 'map' },
    B_NL11: { lat: '515300N', lon: '0062500E', kind: 'map' },
    B_NL12: { lat: '515500N', lon: '0063800E', kind: 'map' },
    B_NL13: { lat: '515900N', lon: '0065000E', kind: 'map' },
    B_NL14: { lat: '520300N', lon: '0065600E', kind: 'map' },
    // ---- Hospital pads used by HEMS (approximate: Christoph 9 at BGU Duisburg, UKD Düsseldorf) ----
    BGU: { lat: '512330N', lon: '0064700E', kind: 'map', note: 'BGU Duisburg hospital pad (approximate)' },
    UKD: { lat: '511130N', lon: '0064800E', kind: 'map', note: 'University hospital Düsseldorf (approximate)' },
  },

  // AD 2.12 thresholds and true bearings (05L/23R 2,700 m; 05R/23L 2,997 m), AD 2.19 ILS, AD 2 EDDL 4-2-x finals.
  // Threshold elevations are the AD 2.12 values rounded to the foot. All four ILS have a 3.0 degree glide path.
  // Missed approaches: climb on runway track, then a turn towards DUS climbing 4,000 ft; speed limit 190 or 220 kt
  // during the first turn and 230 kt afterwards (AD 2 EDDL 4-2-1 to 4-2-4).
  runways: [
    {
      id: '23L', thr: { lat: '511739.431N', lon: '0064658.073E' }, crsTrue: 232.8, elevation: 138, lengthM: 2997,
      ils: { ident: 'IDSW', freq: '109.900', cat: 'III', gp: '333.800' }, rnp: true,
      if: { fix: 'I23L', alt: 3000 }, faf: { fix: 'METMA', alt: 3000 }, missed: ['DUS'],
      gpDeg: 3, tch: 58, missedAlt: 4000, missedSpd: 220,
      notes: 'Southern runway: all departures and, in single-runway operation, all arrivals. Threshold displaced 301 m (LDA 2,696 m). Missed approach: heading 230 to 2.6 DME DUS, right onto 307 to R277 DUS, right direct DUS climbing 4,000 ft',
    },
    {
      id: '23R', thr: { lat: '511748.248N', lon: '0064633.931E' }, crsTrue: 232.8, elevation: 123, lengthM: 2700,
      ils: { ident: 'IDNW', freq: '109.300', cat: 'III', gp: '332.000' }, rnp: true,
      if: { fix: 'I23R', alt: 3000 }, faf: { fix: 'REGNO', alt: 3000 }, missed: ['DUS'],
      gpDeg: 3, tch: 57, missedAlt: 4000, missedSpd: 190,
      notes: 'Northern runway: landings only, and only in the 56 hours a week it may be used (AD 2.20). Threshold displaced 300 m (LDA 2,400 m). Missed approach: heading 230 to 0.6 DME west of DUS, right onto 318 to 6.4 DME DUS, right direct DUS climbing 4,000 ft',
    },
    {
      id: '05R', thr: { lat: '511652.445N', lon: '0064519.467E' }, crsTrue: 52.8, elevation: 120, lengthM: 2997,
      ils: { ident: 'IDSE', freq: '110.150', cat: 'III', gp: '334.250' }, rnp: true,
      if: { fix: 'I05R', alt: 3000 }, faf: { fix: 'NATOS', alt: 3000 }, missed: ['DUS'],
      gpDeg: 3, tch: 52, missedAlt: 4000, missedSpd: 220,
      notes: 'Southern runway. Threshold displaced 301 m (LDA 2,696 m). Missed approach: heading 050 to 6.0 DME DUS, left onto 320 to R012 DUS, left direct DUS climbing 4,000 ft',
    },
    {
      id: '05L', thr: { lat: '511707.132N', lon: '0064507.643E' }, crsTrue: 52.8, elevation: 116, lengthM: 2700,
      ils: { ident: 'IDNE', freq: '110.950', cat: 'I', gp: '330.650' }, rnp: true,
      if: { fix: 'I05L', alt: 3000 }, faf: { fix: 'DIKMI', alt: 3000 }, missed: ['DUS'],
      gpDeg: 3, tch: 52, missedAlt: 4000, missedSpd: 190,
      notes: 'Northern runway, ILS CAT I only. Threshold displaced 300 m (LDA 2,400 m). Missed approach: heading 050 to 1.6 DME IDNE, left onto 007 to 7.0 DME IDNE, left direct DUS climbing 4,000 ft',
    },
  ],
  // Runway ends: both thresholds of each runway are displaced about 300 m (AD 2.13: LDA 2,400 m of 2,700 m and
  // 2,696 m of 2,997 m), so the ends are computed 300 m (301 m) beyond each threshold along the runway course.
  strips: [
    { ends: ['05R', '23L'], drawFrom: { lat: '511646.553N', lon: '0064507.058E' }, drawTo: { lat: '511745.323N', lon: '0064710.487E' } },
    { ends: ['05L', '23R'], drawFrom: { lat: '511701.260N', lon: '0064455.274E' }, drawTo: { lat: '511754.120N', lon: '0064646.304E' } },
  ],
  // Single-runway operation uses the southern runway (AD 2.20 item 5.1); 23 is the usual direction.
  preferredRunways: ['23L', '05R'],

  // The published STARs (AD 2 EDDL 3-1-2) run from the entry fix to the DUS VOR at 4,000 ft or above; the sim
  // flies them to the entry fix only (see the file header and meta.approximations). Levels: AD 2.22 planning
  // bands at the transfer points (BIKMU FL080-110, DOMUX and XAMOD FL100-140, TEBRO FL130-150) and the
  // transition entry limits (BIKMU FL150-, DOMUX and HALME FL140-, PISAP FL170-).
  stars: [
    { name: 'BIKMU1A', runways: ['23L', '23R', '05L', '05R'], handoffLevel: 'F100', legs: [{ fix: 'NVO', max: 'F150' }, { fix: 'BIKMU', max: 'F150' }] },
    { name: 'DOMUX1A', runways: ['23L', '23R', '05L', '05R'], handoffLevel: 'F120', legs: [{ fix: 'BARAG', max: 'F140' }, { fix: 'DOMUX', max: 'F140' }] },
    { name: 'HALME1A', runways: ['23L', '23R', '05L', '05R'], handoffLevel: 'F120', legs: [{ fix: 'DOMEG', max: 'F140' }, { fix: 'HALME', max: 'F140' }] },
    { name: 'PISAP1A', runways: ['23L', '23R', '05L', '05R'], handoffLevel: 'F140', legs: [{ fix: 'TEBRO', max: 'F170' }, { fix: 'PISAP', max: 'F170' }] },
    { name: 'LMA1A', runways: ['23L', '23R', '05L', '05R'], handoffLevel: 'F070', legs: [{ fix: 'VEBAK', max: 'F100' }, { fix: 'LMA', max: 'F100' }], atcDiscretion: true },
  ],

  // GPS/FMS RNAV transitions to final approach, coded as in AD 2 EDDL 6-1 to 6-3 (K220 = 220 kt IAS from that
  // waypoint on; A3000+ = at or above 3,000 ft at the FAF). Altitudes along the transition are assigned by ATC
  // (chart remark 5); the overlay altitudes are 5,000 ft to the downwind and 4,000 ft along it.
  transitions: [
    { name: 'PISAP05', runways: ['05L'], legs: [{ fix: 'PISAP', max: 'F170' }, { fix: 'VALSU' }, { fix: 'GAPNU', spd: 220 }, { fix: 'DL524', spd: 220 }, { fix: 'DL530', spd: 220 }, { fix: 'DIKMI', min: 3000, spd: 220 }] },
    { name: 'HALME05', runways: ['05L'], legs: [{ fix: 'HALME', max: 'F140' }, { fix: 'BOMBA' }, { fix: 'DL524' }, { fix: 'DL530', spd: 220 }, { fix: 'DIKMI', min: 3000, spd: 220 }] },
    { name: 'BIKMU05', runways: ['05L'], legs: [{ fix: 'BIKMU', max: 'F150' }, { fix: 'RONAD', spd: 220 }, { fix: 'DL513', spd: 220 }, { fix: 'IBIKO', spd: 220 }, { fix: 'GAPNU', spd: 220 }, { fix: 'DL524', spd: 220 }, { fix: 'DL530', spd: 220 }, { fix: 'DIKMI', min: 3000, spd: 220 }] },
    { name: 'LMA05', runways: ['05L'], legs: [{ fix: 'LMA' }, { fix: 'IBIKO', spd: 220 }, { fix: 'GAPNU', spd: 220 }, { fix: 'DL524', spd: 220 }, { fix: 'DL530', spd: 220 }, { fix: 'DIKMI', min: 3000, spd: 220 }] },
    { name: 'DOMUX05', runways: ['05R'], legs: [{ fix: 'DOMUX', max: 'F140' }, { fix: 'DOLAV' }, { fix: 'DL502', spd: 220 }, { fix: 'DL503', spd: 220 }, { fix: 'DL510', spd: 220 }, { fix: 'NATOS', min: 3000, spd: 220 }] },
    { name: 'ELDAR05', runways: ['05R'], legs: [{ fix: 'ELDAR', max: 'F170' }, { fix: 'DL501', spd: 220 }, { fix: 'DL502', spd: 220 }, { fix: 'DL503', spd: 220 }, { fix: 'DL510', spd: 220 }, { fix: 'NATOS', min: 3000, spd: 220 }] },
    { name: 'PISAP23', runways: ['23R'], legs: [{ fix: 'PISAP', max: 'F170' }, { fix: 'AGEDA' }, { fix: 'XAMOD', spd: 220 }, { fix: 'DL422', spd: 220 }, { fix: 'DL426', spd: 220 }, { fix: 'DL429', spd: 220 }, { fix: 'DL430', spd: 220 }, { fix: 'REGNO', min: 3000, spd: 220 }] },
    { name: 'HALME23', runways: ['23R'], legs: [{ fix: 'HALME', max: 'F140' }, { fix: 'XAMOD', spd: 220 }, { fix: 'DL422', spd: 220 }, { fix: 'DL426', spd: 220 }, { fix: 'DL429', spd: 220 }, { fix: 'DL430', spd: 220 }, { fix: 'REGNO', min: 3000, spd: 220 }] },
    { name: 'BIKMU23', runways: ['23R'], legs: [{ fix: 'BIKMU', max: 'F150' }, { fix: 'DL426', spd: 220 }, { fix: 'DL429', spd: 220 }, { fix: 'DL430', spd: 220 }, { fix: 'REGNO', min: 3000, spd: 220 }] },
    { name: 'LMA23', runways: ['23R'], legs: [{ fix: 'LMA' }, { fix: 'DL426', spd: 220 }, { fix: 'DL429', spd: 220 }, { fix: 'DL430', spd: 220 }, { fix: 'REGNO', min: 3000, spd: 220 }] },
    { name: 'DOMUX23', runways: ['23L'], legs: [{ fix: 'DOMUX', max: 'F140' }, { fix: 'DL405', spd: 220 }, { fix: 'DL406', spd: 220 }, { fix: 'DL409', spd: 220 }, { fix: 'DL410', spd: 220 }, { fix: 'METMA', min: 3000, spd: 220 }] },
  ],

  // SIDs: the GPS/FMS RNAV coding of AD 2 EDDL 5-7-1 to 5-7-18. Initial climb 5,000 ft on every SID (the transition
  // altitude); the crew stays with Tower until passing 2,000 ft, then calls Langen Radar 121.355. The first waypoint
  // carries A600+ (turn at 600 ft or later). Speed limits: SONEB/MEVEL 190 kt to the NVO R001 (DL235 K190-), MODRU/
  // NETEX K 210 kt to the 318 track (DL243/DL247 K210-) and 250 kt to NETEX. Level constraints on the exits as coded.
  sids: [
    // RWY 23L (suffix T; the RNP SID MODRU 2K and NETEX 1K are RNP-only and not modelled)
    { name: 'LMA3T', runways: ['23L'], initialClimb: 5000, exitFix: 'LMA', legs: [{ fix: 'DL236', min: 600 }, { fix: 'LMA' }], atcDiscretion: true },
    { name: 'SONEB8T', runways: ['23L'], initialClimb: 5000, exitFix: 'SONEB', legs: [{ fix: 'DL230', min: 600 }, { fix: 'DL235', spd: 190 }, { fix: 'DL248' }, { fix: 'ERKUM' }, { fix: 'DL245', min: 'F140' }, { fix: 'SONEB' }] },
    { name: 'MEVEL4T', runways: ['23L'], initialClimb: 5000, exitFix: 'MEVEL', legs: [{ fix: 'DL230', min: 600 }, { fix: 'DL235', spd: 190 }, { fix: 'DL248' }, { fix: 'ERKUM' }, { fix: 'LUSIX' }, { fix: 'MEVEL' }] },
    { name: 'GMH1T', runways: ['23L'], initialClimb: 5000, exitFix: 'GMH', legs: [{ fix: 'DL239', min: 3000 }, { fix: 'DL241' }, { fix: 'GMH' }] },
    { name: 'NVO2T', runways: ['23L'], initialClimb: 5000, exitFix: 'NVO', legs: [{ fix: 'DL239', min: 3000 }, { fix: 'DL241' }, { fix: 'NVO' }] },
    { name: 'DODEN1T', runways: ['23L'], initialClimb: 5000, exitFix: 'DODEN', legs: [{ fix: 'DL239', min: 3000 }, { fix: 'DL241' }, { fix: 'DL242', min: 'F150' }, { fix: 'ELBAL' }, { fix: 'BETZO' }, { fix: 'DODEN', min: 'F250' }] },
    { name: 'NUDGO6T', runways: ['23L'], initialClimb: 5000, exitFix: 'NUDGO', legs: [{ fix: 'DL239', min: 3000 }, { fix: 'DL241' }, { fix: 'ELBAL' }, { fix: 'MAMIB' }, { fix: 'KULIX' }, { fix: 'NUDGO' }] },
    { name: 'MODRU2T', runways: ['23L'], initialClimb: 5000, exitFix: 'MODRU', legs: [{ fix: 'DL243', min: 600, spd: 210 }, { fix: 'UBORO' }, { fix: 'NETEX', spd: 250 }, { fix: 'MODRU', min: 'F210' }] },
    { name: 'NETEX6T', runways: ['23L'], initialClimb: 5000, exitFix: 'NETEX', legs: [{ fix: 'DL236', min: 600 }, { fix: 'LMA' }, { fix: 'NETEX' }] },
    { name: 'KUMIK7T', runways: ['23L'], initialClimb: 5000, exitFix: 'KUMIK', legs: [{ fix: 'DL239', min: 3000 }, { fix: 'DL241' }, { fix: 'ELBAL' }, { fix: 'DEGOM', min: 'F150' }, { fix: 'KUMIK' }] },
    { name: 'COL6T', runways: ['23L'], initialClimb: 5000, exitFix: 'COL', legs: [{ fix: 'DL239', min: 3000 }, { fix: 'DL241' }, { fix: 'DL244' }, { fix: 'LIPMI', min: 'F150' }, { fix: 'COL' }] },
    // RWY 23R (suffix H / U; departures from the northern runway are rare, AD 2.22 item 1.1)
    { name: 'LMA3H', runways: ['23R'], initialClimb: 5000, exitFix: 'LMA', legs: [{ fix: 'DL237', min: 600 }, { fix: 'LMA' }], atcDiscretion: true },
    { name: 'SONEB4H', runways: ['23R'], initialClimb: 5000, exitFix: 'SONEB', legs: [{ fix: 'DL230', min: 600 }, { fix: 'DL235', spd: 190 }, { fix: 'DL248' }, { fix: 'ERKUM' }, { fix: 'DL245', min: 'F140' }, { fix: 'SONEB' }], atcDiscretion: true },
    { name: 'MEVEL4H', runways: ['23R'], initialClimb: 5000, exitFix: 'MEVEL', legs: [{ fix: 'DL230', min: 600 }, { fix: 'DL235', spd: 190 }, { fix: 'DL248' }, { fix: 'ERKUM' }, { fix: 'LUSIX' }, { fix: 'MEVEL' }], atcDiscretion: true },
    { name: 'GMH4H', runways: ['23R'], initialClimb: 5000, exitFix: 'GMH', legs: [{ fix: 'DL240', min: 3000 }, { fix: 'DL241' }, { fix: 'GMH' }], atcDiscretion: true },
    { name: 'NVO2U', runways: ['23R'], initialClimb: 5000, exitFix: 'NVO', legs: [{ fix: 'DL240', min: 3000 }, { fix: 'DL241' }, { fix: 'NVO' }], atcDiscretion: true },
    { name: 'DODEN4H', runways: ['23R'], initialClimb: 5000, exitFix: 'DODEN', legs: [{ fix: 'DL240', min: 3000 }, { fix: 'DL241' }, { fix: 'DL242', min: 'F150' }, { fix: 'ELBAL' }, { fix: 'BETZO' }, { fix: 'DODEN', min: 'F250' }], atcDiscretion: true },
    { name: 'NUDGO4H', runways: ['23R'], initialClimb: 5000, exitFix: 'NUDGO', legs: [{ fix: 'DL240', min: 3000 }, { fix: 'DL241' }, { fix: 'ELBAL' }, { fix: 'MAMIB' }, { fix: 'KULIX' }, { fix: 'NUDGO' }], atcDiscretion: true },
    { name: 'MODRU2H', runways: ['23R'], initialClimb: 5000, exitFix: 'MODRU', legs: [{ fix: 'DL247', min: 600, spd: 210 }, { fix: 'UBORO' }, { fix: 'NETEX', spd: 250 }, { fix: 'MODRU', min: 'F210' }], atcDiscretion: true },
    { name: 'NETEX3H', runways: ['23R'], initialClimb: 5000, exitFix: 'NETEX', legs: [{ fix: 'DL237', min: 600 }, { fix: 'LMA' }, { fix: 'NETEX' }], atcDiscretion: true },
    { name: 'KUMIK4H', runways: ['23R'], initialClimb: 5000, exitFix: 'KUMIK', legs: [{ fix: 'DL240', min: 3000 }, { fix: 'DL241' }, { fix: 'ELBAL' }, { fix: 'DEGOM', min: 'F150' }, { fix: 'KUMIK' }], atcDiscretion: true },
    { name: 'COL4H', runways: ['23R'], initialClimb: 5000, exitFix: 'COL', legs: [{ fix: 'DL240', min: 3000 }, { fix: 'DL241' }, { fix: 'DL244' }, { fix: 'LIPMI', min: 'F150' }, { fix: 'COL' }], atcDiscretion: true },
    // RWY 05R (suffix Z / X)
    { name: 'LMA2Z', runways: ['05R'], initialClimb: 5000, exitFix: 'LMA', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL051' }, { fix: 'DL052' }, { fix: 'LMA' }], atcDiscretion: true },
    { name: 'SONEB6Z', runways: ['05R'], initialClimb: 5000, exitFix: 'SONEB', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'LUSIX' }, { fix: 'DL054', min: 'F140' }, { fix: 'SONEB' }] },
    { name: 'MEVEL1Z', runways: ['05R'], initialClimb: 5000, exitFix: 'MEVEL', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'LUSIX' }, { fix: 'MEVEL' }] },
    { name: 'GMH6Z', runways: ['05R'], initialClimb: 5000, exitFix: 'GMH', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ANAVI' }, { fix: 'GMH' }] },
    { name: 'NVO3Z', runways: ['05R'], initialClimb: 5000, exitFix: 'NVO', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'NVO' }] },
    { name: 'DODEN7Z', runways: ['05R'], initialClimb: 5000, exitFix: 'DODEN', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ELBAL', min: 'F150' }, { fix: 'BETZO' }, { fix: 'DODEN', min: 'F250' }] },
    { name: 'NUDGO5Z', runways: ['05R'], initialClimb: 5000, exitFix: 'NUDGO', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ANAVI' }, { fix: 'MAMIB' }, { fix: 'KULIX' }, { fix: 'NUDGO' }] },
    { name: 'MODRU7Z', runways: ['05R'], initialClimb: 5000, exitFix: 'MODRU', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'ORSOV' }, { fix: 'VEBAK' }, { fix: 'NETEX' }, { fix: 'MODRU', min: 'F210' }] },
    { name: 'NETEX4Z', runways: ['05R'], initialClimb: 5000, exitFix: 'NETEX', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'ORSOV' }, { fix: 'VEBAK' }, { fix: 'NETEX' }] },
    { name: 'KUMIK5Z', runways: ['05R'], initialClimb: 5000, exitFix: 'KUMIK', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ANAVI' }, { fix: 'DEGOM', min: 'F150' }, { fix: 'KUMIK' }] },
    { name: 'COL5Z', runways: ['05R'], initialClimb: 5000, exitFix: 'COL', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'LIPMI', min: 'F150' }, { fix: 'COL' }] },
    // RWY 05L (suffix J / Y); same coding as 05R from DL050
    { name: 'LMA7Y', runways: ['05L'], initialClimb: 5000, exitFix: 'LMA', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL051' }, { fix: 'DL052' }, { fix: 'LMA' }], atcDiscretion: true },
    { name: 'SONEB6J', runways: ['05L'], initialClimb: 5000, exitFix: 'SONEB', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'LUSIX' }, { fix: 'DL054', min: 'F140' }, { fix: 'SONEB' }], atcDiscretion: true },
    { name: 'MEVEL9J', runways: ['05L'], initialClimb: 5000, exitFix: 'MEVEL', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'LUSIX' }, { fix: 'MEVEL' }], atcDiscretion: true },
    { name: 'GMH9Y', runways: ['05L'], initialClimb: 5000, exitFix: 'GMH', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ANAVI' }, { fix: 'GMH' }], atcDiscretion: true },
    { name: 'NVO3Y', runways: ['05L'], initialClimb: 5000, exitFix: 'NVO', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'NVO' }], atcDiscretion: true },
    { name: 'DODEN7J', runways: ['05L'], initialClimb: 5000, exitFix: 'DODEN', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ELBAL', min: 'F150' }, { fix: 'BETZO' }, { fix: 'DODEN', min: 'F250' }], atcDiscretion: true },
    { name: 'NUDGO5J', runways: ['05L'], initialClimb: 5000, exitFix: 'NUDGO', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ANAVI' }, { fix: 'MAMIB' }, { fix: 'KULIX' }, { fix: 'NUDGO' }], atcDiscretion: true },
    { name: 'MODRU7J', runways: ['05L'], initialClimb: 5000, exitFix: 'MODRU', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'ORSOV' }, { fix: 'VEBAK' }, { fix: 'NETEX' }, { fix: 'MODRU', min: 'F210' }], atcDiscretion: true },
    { name: 'NETEX4J', runways: ['05L'], initialClimb: 5000, exitFix: 'NETEX', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL053' }, { fix: 'NIKOG' }, { fix: 'ORSOV' }, { fix: 'VEBAK' }, { fix: 'NETEX' }], atcDiscretion: true },
    { name: 'KUMIK5J', runways: ['05L'], initialClimb: 5000, exitFix: 'KUMIK', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'ANAVI' }, { fix: 'DEGOM', min: 'F150' }, { fix: 'KUMIK' }], atcDiscretion: true },
    { name: 'COL5J', runways: ['05L'], initialClimb: 5000, exitFix: 'COL', legs: [{ fix: 'DL050', min: 600 }, { fix: 'DL058' }, { fix: 'BAM' }, { fix: 'LIPMI', min: 'F150' }, { fix: 'COL' }], atcDiscretion: true },
  ],

  // Holdings. DUS: the missed approach holding (MAHF 4,000 ft on the ILS charts; 3,000 ft to FL240 in the VATSIM SOP).
  // DL503 / DL524 (05 operations) and DL409 / DL429 (23 operations): the downwind holds drawn on the transition
  // charts, 4,000 ft to FL070 (chart: "4000 (FL70*)", operational FL). Inbound tracks are the downwind tracks
  // (050 / 230 magnetic, variation 3 E); turn directions as read from the charts. DOMEG, NVO and ELDAR: the
  // en-route holds Langen uses to keep the arrival sector clear (VATSIM SOP; not in the AD section).
  holds: [
    { fix: 'DUS', inboundTrue: 149, turn: 'L', minAlt: 4000, maxAlt: 'F240', maxSpd: 230, inboundMag: 146, legMin: 1 },
    { fix: 'DL524', inboundTrue: 233, turn: 'R', minAlt: 4000, maxAlt: 'F070', maxSpd: 220, inboundMag: 230, legMin: 1 },
    { fix: 'DL503', inboundTrue: 233, turn: 'L', minAlt: 4000, maxAlt: 'F070', maxSpd: 220, inboundMag: 230, legMin: 1 },
    { fix: 'DL429', inboundTrue: 53, turn: 'L', minAlt: 4000, maxAlt: 'F070', maxSpd: 220, inboundMag: 50, legMin: 1 },
    { fix: 'DL409', inboundTrue: 53, turn: 'R', minAlt: 4000, maxAlt: 'F070', maxSpd: 220, inboundMag: 50, legMin: 1 },
    { fix: 'DOMEG', inboundTrue: 173, turn: 'L', minAlt: 5000, maxAlt: 'F140', maxSpd: 250, atcDiscretion: true, inboundMag: 170, legMin: 1 },
    { fix: 'NVO', inboundTrue: 71, turn: 'R', minAlt: 6000, maxAlt: 'F140', maxSpd: 250, atcDiscretion: true, inboundMag: 68, legMin: 1 },
    { fix: 'ELDAR', inboundTrue: 1, turn: 'L', minAlt: 6000, maxAlt: 'F140', maxSpd: 250, atcDiscretion: true, inboundMag: 358, legMin: 1 },
  ],

  // ENR 2.1 CTR Düsseldorf: GND to 2,500 ft MSL, class D (AD 2.17), Düsseldorf Tower 118.305 (124.355 standby).
  ctr: {
    name: 'Düsseldorf CTR', floor: 0, ceiling: 2500, cls: 'D', hours: 'H24',
    poly: [
      { lat: '511015N', lon: '0063925E' },
      { lat: '511514N', lon: '0063329E' },
      { lat: '511533N', lon: '0063407E' },
      { arcCentre: { lat: '511528N', lon: '0064516E' }, radius: 7, to: { lat: '512213N', lon: '0064815E' }, dir: 'cw' },
      { lat: '512419N', lon: '0065241E' },
      { lat: '511921N', lon: '0065835E' },
    ],
  },
  // ENR 2.1 Langen ACC sector EDGGDUS2, the Düsseldorf terminal sector (GND to FL155, Langen Radar 121.355 /
  // 128.555). Drawn as the sector boundary. Class C applies from 2,500 ft (1,500 to 3,500 ft in steps, see
  // tmaParts) to FL100 around the field; class E below the steps and above FL100 class C everywhere (ENR 1.4).
  tma: {
    name: 'Düsseldorf Terminal (EDGGDUS2)', floor: 2500, ceiling: 'F155', cls: 'C', hours: 'H24',
    note: 'Langen ACC sector EDGGDUS2, GND to FL155; the class C steps around it are the ENR 2.1 areas in tmaParts',
    poly: [
      { lat: '512421N', lon: '0062409E' }, { lat: '512955N', lon: '0063544E' }, { lat: '513548N', lon: '0064803E' },
      { lat: '514617N', lon: '0071017E' }, { lat: '513927N', lon: '0072437E' }, { lat: '513100N', lon: '0071820E' },
      { lat: '512526N', lon: '0072036E' }, { lat: '511913N', lon: '0072717E' }, { lat: '511201N', lon: '0071136E' },
      { lat: '510935N', lon: '0070620E' }, { lat: '510554N', lon: '0065839E' }, { lat: '510524N', lon: '0064521E' },
      { lat: '510135N', lon: '0063658E' }, { lat: '505506N', lon: '0062311E' }, { lat: '510207N', lon: '0061437E' },
      { lat: '510724N', lon: '0061411E' },
    ],
  },
  // ENR 2.1: the class C areas DUESSELDORF/KOELN-BONN A to Y (EDDLCLCx), all to FL100, H24, Langen Radar. The parts
  // that lie in or touch the Düsseldorf sector are listed; B, F, G, H, J, L, O, S, T, U, V belong to the Köln/Bonn side.
  tmaParts: [
    {
      name: 'Düsseldorf/Köln-Bonn A', floor: 1500, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCA: 1,500 ft MSL to FL100, Essen side, inside area D (the area with a lower limit of 1,500 ft that D excludes)',
      poly: [
        { lat: '511921N', lon: '0065835E' }, { lat: '512058N', lon: '0070204E' }, { lat: '512556N', lon: '0065607E' },
        { lat: '512419N', lon: '0065241E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn C', floor: 2000, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCC: 2,000 ft MSL to FL100, over Mönchengladbach, west of the CTR',
      poly: [
        { lat: '511930N', lon: '0062659E' }, { lat: '511533N', lon: '0063407E' }, { lat: '511514N', lon: '0063329E' },
        { lat: '511015N', lon: '0063925E' }, { lat: '510815N', lon: '0063402E' }, { lat: '511348N', lon: '0062245E' },
        { lat: '511557N', lon: '0062212E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn D', floor: 2500, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCD: 2,500 ft MSL to FL100, the core around the CTR',
      poly: [
        { lat: '511643N', lon: '0061948E' }, { lat: '513319N', lon: '0070257E' }, { lat: '512006N', lon: '0071517E' },
        { lat: '511412N', lon: '0070213E' }, { lat: '510415N', lon: '0064014E' }, { lat: '510430N', lon: '0063840E' },
        { lat: '510657N', lon: '0062304E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn E', floor: 2500, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCE: 2,500 ft MSL to FL100, the Köln/Bonn core, south of the sector',
      poly: [
        { lat: '503714N', lon: '0071244E' }, { lat: '504646N', lon: '0070202E' }, { lat: '505142N', lon: '0065823E' },
        { lat: '505656N', lon: '0065451E' }, { lat: '505548N', lon: '0064923E' }, { lat: '505337N', lon: '0064140E' },
        { lat: '505600N', lon: '0064000E' }, { lat: '505837N', lon: '0064226E' }, { lat: '510515N', lon: '0065716E' },
        { lat: '510552N', lon: '0071125E' }, { lat: '505900N', lon: '0072839E' }, { lat: '505617N', lon: '0073039E' },
        { lat: '504020N', lon: '0073150E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn I', floor: 3500, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCI: 3,500 ft MSL to FL100, north-east ring from Krefeld to Dortmund',
      poly: [
        { lat: '511643N', lon: '0061948E' }, { lat: '512105N', lon: '0062259E' }, { lat: '513848N', lon: '0070851E' },
        { lat: '513100N', lon: '0071820E' }, { lat: '512526N', lon: '0072036E' }, { lat: '512326N', lon: '0072245E' },
        { lat: '512006N', lon: '0071517E' }, { lat: '513319N', lon: '0070257E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn K', floor: 3500, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCK: 3,500 ft MSL to FL100, south-west of the core towards Jülich',
      poly: [
        { lat: '510657N', lon: '0062304E' }, { lat: '510430N', lon: '0063840E' }, { lat: '510302N', lon: '0063527E' },
        { lat: '510207N', lon: '0063534E' }, { lat: '510010N', lon: '0063119E' }, { lat: '510010N', lon: '0062520E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn M', floor: 4500, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCM: 4,500 ft MSL to FL100, north-west ring along the Dutch border',
      poly: [
        { lat: '511521N', lon: '0061330E' }, { lat: '512235N', lon: '0061733E' }, { lat: '513920N', lon: '0070051E' },
        { lat: '513848N', lon: '0070851E' }, { lat: '512105N', lon: '0062259E' }, { lat: '511643N', lon: '0061948E' },
        { lat: '510657N', lon: '0062304E' }, { lat: '510010N', lon: '0062520E' }, { lat: '510010N', lon: '0061954E' },
        { lat: '510207N', lon: '0061437E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn N', floor: 4500, ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCN: 4,500 ft MSL to FL100, east of the core over Wuppertal',
      poly: [
        { lat: '511412N', lon: '0070213E' }, { lat: '512006N', lon: '0071517E' }, { lat: '512326N', lon: '0072245E' },
        { lat: '511847N', lon: '0072745E' }, { lat: '511238N', lon: '0071338E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn Q', floor: 'F065', ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCQ: FL065 to FL100, the Ruhr north-east, over the Dortmund approach area',
      poly: [
        { lat: '512235N', lon: '0061733E' }, { lat: '512657N', lon: '0062000E' }, { lat: '513956N', lon: '0065337E' },
        { lat: '514535N', lon: '0070818E' }, { lat: '513518N', lon: '0073121E' }, { lat: '511822N', lon: '0074052E' },
        { lat: '511847N', lon: '0072745E' }, { lat: '512326N', lon: '0072245E' }, { lat: '512526N', lon: '0072036E' },
        { lat: '513100N', lon: '0071820E' }, { lat: '513848N', lon: '0070851E' }, { lat: '513920N', lon: '0070051E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn R', floor: 'F065', ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCR: FL065 to FL100, the band between the Düsseldorf and Köln cores',
      poly: [
        { lat: '510207N', lon: '0061437E' }, { lat: '510010N', lon: '0061954E' }, { lat: '510010N', lon: '0062520E' },
        { lat: '510010N', lon: '0063119E' }, { lat: '510207N', lon: '0063534E' }, { lat: '510302N', lon: '0063527E' },
        { lat: '510430N', lon: '0063840E' }, { lat: '510415N', lon: '0064014E' }, { lat: '511412N', lon: '0070213E' },
        { lat: '511238N', lon: '0071338E' }, { lat: '511847N', lon: '0072745E' }, { lat: '510637N', lon: '0072951E' },
        { lat: '510613N', lon: '0071954E' }, { lat: '510552N', lon: '0071125E' }, { lat: '510515N', lon: '0065716E' },
        { lat: '505837N', lon: '0064226E' }, { lat: '505600N', lon: '0064000E' }, { lat: '505337N', lon: '0064140E' },
        { lat: '504813N', lon: '0064525E' }, { lat: '504430N', lon: '0064800E' }, { lat: '503809N', lon: '0065222E' },
        { lat: '504010N', lon: '0064350E' }, { lat: '505640N', lon: '0062100E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn X', floor: 'F085', ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCX: FL085 to FL100, the Niederrhein up to the Dutch border (border segment straightened)',
      poly: [
        { lat: '513035N', lon: '0061247E' }, { lat: '514247N', lon: '0064605E' }, { lat: '513956N', lon: '0065337E' },
        { lat: '512657N', lon: '0062000E' }, { lat: '512235N', lon: '0061733E' }, { lat: '511521N', lon: '0061330E' },
        { lat: '512117N', lon: '0061259E' },
      ],
    },
    {
      name: 'Düsseldorf/Köln-Bonn Y', floor: 'F085', ceiling: 'F100', cls: 'C', hours: 'H24',
      note: 'EDDLCLCY: FL085 to FL100, north of Dortmund',
      poly: [
        { lat: '514535N', lon: '0070818E' }, { lat: '514541N', lon: '0071733E' }, { lat: '513705N', lon: '0073645E' },
        { lat: '513518N', lon: '0073121E' },
      ],
    },
  ],
  // Reserved airspace that touches the sector (ENR 5.1). Düsseldorf has no military training area nearby;
  // the one restricted area inside 40 NM is the Jülich research centre. Dortmund's approach area (GND to FL065,
  // sector EDGGPADL) is drawn as a coordination area because the sim's traffic must stay above it.
  tsas: [
    {
      name: 'ED-R 111', floor: 0, ceiling: 2300, hours: 'H24', note: 'Jülich research centre, 2 NM radius, GND to 2,300 ft MSL',
      poly: [
        { lat: '505600N', lon: '0062500E' },
        { arcCentre: { lat: '505400N', lon: '0062500E' }, radius: 2, to: { lat: '505200N', lon: '0062500E' }, dir: 'cw' },
        { arcCentre: { lat: '505400N', lon: '0062500E' }, radius: 2, to: { lat: '505600N', lon: '0062500E' }, dir: 'cw' },
      ],
    },
    {
      name: 'Dortmund area', floor: 0, ceiling: 'F065', hours: 'H24', approx: true,
      note: 'Langen sector EDGGDUS3 below FL065 is worked by Paderborn Low for Dortmund traffic; Düsseldorf traffic stays at FL070 or above (ENR 2.1, VATSIM SOP)',
      poly: [
        { lat: '513927N', lon: '0072437E' }, { lat: '513727N', lon: '0072846E' }, { lat: '512848N', lon: '0073501E' },
        { lat: '512239N', lon: '0073922E' }, { lat: '512210N', lon: '0073334E' }, { lat: '511913N', lon: '0072717E' },
        { lat: '512526N', lon: '0072036E' }, { lat: '513100N', lon: '0071820E' },
      ],
    },
  ],
  // Minimum vectoring altitudes (approximate, see meta.approximations). Flat Rhine land around the field 2,200 ft;
  // the Bergisches Land east of the Rhine 3,200 ft (Wuppertal, Solingen) rising to 3,800 ft (Remscheid, Velbert
  // hills) and 4,500 ft over the Sauerland beyond 7 degrees 40 minutes east; the Ruhr 2,500 ft; the Köln lowland
  // south of the sector 2,500 ft; the Niederrhein and the Netherlands 2,200 ft.
  mva: [
    {
      alt: 2200,
      poly: [{ lat: '520500N', lon: '0054000E' }, { lat: '520500N', lon: '0065800E' }, { lat: '512500N', lon: '0070200E' }, { lat: '511200N', lon: '0070000E' }, { lat: '510500N', lon: '0065000E' }, { lat: '510500N', lon: '0054000E' }],
    },
    {
      alt: 2500,
      poly: [{ lat: '520500N', lon: '0065800E' }, { lat: '520500N', lon: '0074000E' }, { lat: '512800N', lon: '0074000E' }, { lat: '512500N', lon: '0072000E' }, { lat: '512500N', lon: '0070200E' }],
    },
    {
      alt: 3200,
      poly: [{ lat: '512500N', lon: '0070200E' }, { lat: '512500N', lon: '0072000E' }, { lat: '511200N', lon: '0072000E' }, { lat: '510500N', lon: '0071000E' }, { lat: '510500N', lon: '0065000E' }, { lat: '511200N', lon: '0070000E' }],
    },
    {
      alt: 3800,
      poly: [{ lat: '512800N', lon: '0074000E' }, { lat: '505800N', lon: '0074000E' }, { lat: '505800N', lon: '0071000E' }, { lat: '510500N', lon: '0071000E' }, { lat: '511200N', lon: '0072000E' }, { lat: '512500N', lon: '0072000E' }],
    },
    {
      alt: 4500,
      poly: [{ lat: '520500N', lon: '0074000E' }, { lat: '520500N', lon: '0083000E' }, { lat: '503000N', lon: '0083000E' }, { lat: '503000N', lon: '0074000E' }],
    },
    {
      alt: 2500,
      poly: [{ lat: '510500N', lon: '0054000E' }, { lat: '510500N', lon: '0071000E' }, { lat: '505800N', lon: '0071000E' }, { lat: '505800N', lon: '0074000E' }, { lat: '503000N', lon: '0074000E' }, { lat: '503000N', lon: '0054000E' }],
    },
  ],
  // VFR arrivals and departures of the CTR (AIP VFR EDDL 4): via NOVEMBER (north), SIERRA (south-west) and ECHO
  // (south-east), at or below 2,500 ft MSL; aircraft hold at the published VFR holding at the point until cleared in.
  vfrRoutes: [
    { name: 'NOVEMBER', points: ['NOVEMBER', 'DUS'], alt: 2000 },
    { name: 'SIERRA', points: ['SIERRA', 'DUS'], alt: 2000 },
    { name: 'ECHO', points: ['ECHO', 'DUS'], alt: 2000 },
  ],
  mapLines: [
    { name: 'Rhein', style: 'river', points: ['M_RH1', 'LEVERKUSEN', 'M_RH2', 'M_RH3', 'M_RH4', 'M_RH5', 'M_RH6', 'M_RH7', 'M_RH8', 'M_RH9', 'M_RH10'] },
    { name: 'A3', style: 'road', points: ['R_A3S', 'LEVERKUSEN', 'R_A3HI', 'ECHO', 'R_A3RA', 'R_A3DU', 'R_A3WE', 'R_A3EM'] },
    { name: 'A44', style: 'road', points: ['R_A44W', 'R_A44N', 'R_A44A', 'R_A44E'] },
    { name: 'A57', style: 'road', points: ['R_A57S', 'R_A57N', 'R_A57K', 'R_A57M', 'R_A57G'] },
    { name: 'A40', style: 'road', points: ['R_A40V', 'R_A40D', 'R_A40E', 'R_A40B', 'R_A40DO'] },
    { name: 'DE-NL', style: 'border', points: ['B_NL1', 'B_NL2', 'B_NL3', 'B_NL4', 'B_NL5', 'B_NL6', 'B_NL7', 'B_NL8', 'B_NL9', 'B_NL10', 'B_NL11', 'B_NL12', 'B_NL13', 'B_NL14'] },
  ],

  // ---- 2.0 fields ----
  // The arrival flow has one entry fix per direction. BIKMU is the busiest (traffic from the south and west,
  // and all Köln-side arrivals); it feeds both the 05 and the 23 structure, so the stack forms there.
  stackFix: 'BIKMU',
  units: [
    { id: 'TWR', role: 'tower', callsign: 'Düsseldorf Tower', freq: '118.305', label: 'Tower', source: 'AD 2 EDDL 2.18 (124.355 standby)', voices: ['de'] },
    { id: 'GND', role: 'ground', callsign: 'Düsseldorf Ground', freq: '121.680', label: 'Ground', source: 'AD 2 EDDL 2.18 (121.605 east, 121.680 west)', voices: ['de'] },
    { id: 'DIR', role: 'neighbour', callsign: 'Düsseldorf Arrival', freq: '128.655', label: 'Arrival', source: 'AD 2 EDDL 2.18: DUESSELDORF ARRIVAL 128.655, 0445-2130 UTC, the final approach (feeder) position', voices: ['de'] },
    { id: 'DEP', role: 'neighbour', callsign: 'Langen Radar', freq: '121.355', label: 'Departure', source: 'AD 2 EDDL 2.18 and the SID pages: departures call Langen Radar 121.355 passing 2,000 ft', voices: ['de'] },
    { id: 'ACC', role: 'acc', callsign: 'Langen Radar', freq: '119.110', label: 'Bottrop', source: 'ENR 2.1: Langen ACC sector Bottrop (EDGGBOT) 119.110, the sector above and north of Düsseldorf', voices: ['de'] },
    { id: 'KOLN', role: 'neighbour', callsign: 'Langen Radar', freq: '135.350', label: 'Köln', source: 'ENR 2.1: Langen ACC sector Köln Arrival (EDGGDKA) 135.350', voices: ['de'] },
    { id: 'PAD', role: 'neighbour', callsign: 'Langen Radar', freq: '135.650', label: 'Paderborn', source: 'ENR 2.1: Langen sector Paderborn High (EDGGPADH) 135.650; Paderborn Low works the Dortmund area', voices: ['de'] },
    { id: 'MUAC', role: 'upper', callsign: 'Maastricht Radar', freq: '134.455', label: 'Maastricht', source: 'not verified', voices: ['nl', 'de', 'uk'] },
    { id: 'MIL', role: 'military', callsign: 'Frisbee Radar', freq: '131.800', label: 'Frisbee', source: 'Geilenkirchen (ETNG) approach per the VATSIM Germany SOP; frequency not verified', voices: ['de', 'uk', 'us'] },
    { id: 'SUP', role: 'supervisor', callsign: 'Supervisor', freq: '', label: 'SUP', source: 'sim construct (Langen ACC supervisor, AD 2.20 item 12)', voices: ['de'] },
  ],
  // Düsseldorf is a passenger airport: Eurowings and Condor hubs, Lufthansa, TUI, the Turkish carriers, Emirates
  // with the A380, the low-cost carriers, and summer leisure peaks. Cargo is marginal (a few UPS and feeder
  // flights). There is no night bank: AD 2.20 closes the field to scheduled traffic 2200 to 0500 UTC (winter
  // 2100 to 0400; local 22:00 to 06:00). Fleet types use the engine's performance table; types the table
  // does not have yet are listed in docs/REALISM-EDDL.md with the stand-in used here.
  traffic: {
    pax: [
      { op: 'EWG', types: ['A320', 'A321', 'A320'], w: 14, telephony: 'Eurowings', voices: ['de'] },
      { op: 'DLH', types: ['A320', 'A321'], w: 5, telephony: 'Lufthansa', voices: ['de'] },
      { op: 'CFG', types: ['A321', 'B752', 'A332'], w: 6, telephony: 'Condor', voices: ['de'] },
      { op: 'TUI', types: ['B738'], w: 4, telephony: 'Tuijet', voices: ['de'] },
      { op: 'THY', types: ['A321', 'B738', 'A332'], w: 4 },
      { op: 'SXS', types: ['B738'], w: 3, telephony: 'Sunexpress', voices: ['de', 'ar'] },
      { op: 'PGT', types: ['A321', 'B738'], w: 3, telephony: 'Sunturk', voices: ['ar'] },
      { op: 'UAE', types: ['B77L'], w: 1, telephony: 'Emirates', voices: ['uk', 'in', 'ar', 'au'] },
      { op: 'QTR', types: ['B77L', 'A332'], w: 1 },
      { op: 'ETD', types: ['B77L'], w: 1, telephony: 'Etihad', voices: ['ar', 'uk', 'in'] },
      { op: 'RYR', types: ['B738'], w: 3 },
      { op: 'EJU', types: ['A320', 'A321'], w: 3, telephony: 'Alpine', voices: ['de', 'uk', 'es'] },
      { op: 'EZY', types: ['A320'], w: 1, telephony: 'Easy', voices: ['uk', 'scot'] },
      { op: 'KLM', types: ['E190', 'B738'], w: 2, telephony: 'KLM', voices: ['nl'] },
      { op: 'BAW', types: ['A320', 'A321'], w: 2, telephony: 'Speedbird', voices: ['uk', 'scot'] },
      { op: 'AUA', types: ['A320', 'E190'], w: 2, telephony: 'Austrian', voices: ['de'] },
      { op: 'SWR', types: ['A320', 'E190'], w: 2, telephony: 'Swiss', voices: ['de', 'fr'] },
      { op: 'AFR', types: ['A320', 'E190'], w: 2, telephony: 'Airfrans', voices: ['fr'] },
      { op: 'AEE', types: ['A320', 'A321'], w: 1, telephony: 'Aegean', voices: ['uk', 'es'] },
      { op: 'CAI', types: ['B738'], w: 1, telephony: 'Corendon', voices: ['nl', 'ar'] },
      { op: 'DAL', types: ['B763'], w: 1, telephony: 'Delta', voices: ['us'] },
      { op: 'WZZ', types: ['A321', 'A320'], w: 1, telephony: 'Wizz Air', voices: ['uk', 'es'] },
    ],
    cargo: [
      { op: 'UPS', types: ['B763'], w: 2 },
      { op: 'ASL', types: ['B738'], w: 1, telephony: 'Contract', voices: ['ie', 'uk'] },
    ],
    bank: [],
    telephony: {
      EWG: 'Eurowings', DLH: 'Lufthansa', CFG: 'Condor', TUI: 'Tuijet', SXS: 'Sunexpress', PGT: 'Sunturk', UAE: 'Emirates',
      ETD: 'Etihad', EJU: 'Alpine', EZY: 'Easy', KLM: 'KLM', BAW: 'Speedbird', AUA: 'Austrian', SWR: 'Swiss', AFR: 'Airfrans',
      AEE: 'Aegean', CAI: 'Corendon', DAL: 'Delta', WZZ: 'Wizz Air', ASL: 'Contract', GAF: 'German Air Force', BPO: 'Pirol',
      HUMMEL: 'Hummel', CHRISTOPH: 'Christoph',
    },
    // Movements per hour, local time from 00:00, typical summer weekday (about 440 to 460 movements a day, from the
    // 2025 figure of 159,900 movements a year with a summer weekday about 10 percent above the daily mean). The
    // field is shut to scheduled traffic 22:00 to 06:00 local; the few movements in those hours are late landings
    // with an exemption, HEMS and the first positioning flights.
    demand: [
      { perHour: 1, paxShare: 0.9 }, { perHour: 0, paxShare: 0.9 }, { perHour: 0, paxShare: 0.9 }, { perHour: 0, paxShare: 0.9 },
      { perHour: 0, paxShare: 0.9 }, { perHour: 3, paxShare: 0.8 }, { perHour: 28, paxShare: 0.95 }, { perHour: 32, paxShare: 0.95 },
      { perHour: 28, paxShare: 0.94 }, { perHour: 25, paxShare: 0.92 }, { perHour: 26, paxShare: 0.92 }, { perHour: 27, paxShare: 0.92 },
      { perHour: 26, paxShare: 0.92 }, { perHour: 25, paxShare: 0.92 }, { perHour: 26, paxShare: 0.92 }, { perHour: 27, paxShare: 0.93 },
      { perHour: 29, paxShare: 0.94 }, { perHour: 30, paxShare: 0.95 }, { perHour: 29, paxShare: 0.95 }, { perHour: 27, paxShare: 0.95 },
      { perHour: 24, paxShare: 0.95 }, { perHour: 19, paxShare: 0.95 }, { perHour: 8, paxShare: 0.95 }, { perHour: 2, paxShare: 0.9 },
    ],
    gaPrefixes: ['D-E', 'D-I', 'D-C', 'PH-', 'OO-', 'G-'],
    military: [
      { op: 'GAF', types: ['A400', 'A321'], w: 1 },
    ],
    arrStars: [
      { name: 'BIKMU1A', w: 4 }, { name: 'DOMUX1A', w: 3 }, { name: 'HALME1A', w: 2 }, { name: 'PISAP1A', w: 3 }, { name: 'LMA1A', w: 0 },
    ],
    depSids: {
      '23L': [{ name: 'MEVEL4T', w: 3 }, { name: 'SONEB8T', w: 1 }, { name: 'MODRU2T', w: 3 }, { name: 'NETEX6T', w: 1 }, { name: 'COL6T', w: 2 }, { name: 'KUMIK7T', w: 2 }, { name: 'DODEN1T', w: 2 }, { name: 'NUDGO6T', w: 2 }, { name: 'GMH1T', w: 1 }, { name: 'NVO2T', w: 1 }],
      '05R': [{ name: 'MEVEL1Z', w: 3 }, { name: 'SONEB6Z', w: 1 }, { name: 'MODRU7Z', w: 3 }, { name: 'NETEX4Z', w: 1 }, { name: 'COL5Z', w: 2 }, { name: 'KUMIK5Z', w: 2 }, { name: 'DODEN7Z', w: 2 }, { name: 'NUDGO5Z', w: 2 }, { name: 'GMH6Z', w: 1 }, { name: 'NVO3Z', w: 1 }],
      '23R': [{ name: 'MEVEL4H', w: 3 }, { name: 'MODRU2H', w: 3 }, { name: 'COL4H', w: 2 }, { name: 'KUMIK4H', w: 2 }, { name: 'DODEN4H', w: 2 }, { name: 'NUDGO4H', w: 2 }],
      '05L': [{ name: 'MEVEL9J', w: 3 }, { name: 'MODRU7J', w: 3 }, { name: 'COL5J', w: 2 }, { name: 'KUMIK5J', w: 2 }, { name: 'DODEN7J', w: 2 }, { name: 'NUDGO5J', w: 2 }],
    },
  },
  // How crews say the five-letter fixes and the local names (German crews say them as German words).
  fixSay: {
    BIKMU: 'Bik-moo', DOMUX: 'Doh-mux', HALME: 'Hal-may', PISAP: 'Pee-sap', ELDAR: 'El-dar', XAMOD: 'Za-mod', TEBRO: 'Teb-roh',
    DOMEG: 'Doh-meg', BARAG: 'Bah-rag', VEBAK: 'Vay-bak', VALSU: 'Val-soo', GAPNU: 'Gap-noo', RONAD: 'Roh-nad', DIKMI: 'Dik-mee',
    BOMBA: 'Bom-bah', DOLAV: 'Doh-lav', NATOS: 'Nah-tos', IBIKO: 'Ee-bee-ko', AGEDA: 'Ah-gay-dah', REGNO: 'Reg-no', METMA: 'Met-mah',
    ANAVI: 'Ah-nah-vee', BETZO: 'Bet-zo', DEGOM: 'Day-gom', DODEN: 'Doh-den', ELBAL: 'El-bal', ERKUM: 'Air-koom', KULIX: 'Koo-lix',
    KUMIK: 'Koo-mik', LIPMI: 'Lip-mee', LUSIX: 'Loo-six', MAMIB: 'Mah-mib', MEVEL: 'May-vel', MODRU: 'Mod-roo', NETEX: 'Net-ex',
    NIKOG: 'Nee-kog', NUDGO: 'Nud-go', ORSOV: 'Or-sov', SONEB: 'So-neb', UBORO: 'Oo-boh-ro', NOVEMBER: 'November', SIERRA: 'Sierra',
    ECHO: 'Echo', DUESSELDORF: 'Doosseldorf', DUISBURG: 'Doosburg', ESSEN: 'Essen', KREFELD: 'Kray-feld', NEUSS: 'Noyss',
    MGLADBACH: 'Mernchen-gladbach', KOELN: 'Kerln', WUPPERTAL: 'Vupper-tal', DORTMUND: 'Dortmund', BOCHUM: 'Bo-khum',
    LEVERKUSEN: 'Layver-koozen', VENLO: 'Ven-lo', Langen: 'Lang-en', Bottrop: 'Bot-trop', Frisbee: 'Frisbee',
  },
  utcOffsetWinter: 1,
  depXfl: 'F100',
  reservedAreasName: 'ED-R',
  country: 'DE',
  curfew: { fromLocal: '22:00', toLocal: '06:00', note: 'AD 2.20: no scheduled take-offs 21:00 to 05:00 UTC winter (22:00 to 06:00 local) and no scheduled landings 22:00 to 06:00 local; delayed landings to 23:00 local, home-based carriers to 00:00; exemptions for diversions, HEMS and calibration flights' },
  parallelOps: [
    { arrivals: '23R', departures: '23L', note: 'AD 2.22 item 1.1: dependent parallel operations; the northern runway lands, the southern departs; 2.5 NM between alternating approaches to the two runways inside 10 NM (item 1.2)' },
    { arrivals: '05L', departures: '05R', note: 'As for 23; the northern runway may be used 56 hours a week (AD 2.20 item 5.1)' },
  ],
};
