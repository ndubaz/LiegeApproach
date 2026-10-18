# Düsseldorf (EDDL): realism report for the location pack

Version 2.0 data pack, `src/pack/eddl.ts`. Checked 17 October 2026 against the DFS AIP IFR Germany, AIRAC cycle effective **01 OCT 2026** (the AIP VFR cycle of 15 OCT 2026 for the visual chart).
Written for a rated approach controller and for the reviewer of phase 2. It says what was checked against which source, what is approximate, and what the reviewer should look at first.

`tests/eddl.test.ts` locks in every fact marked "verified" below (18 tests).

## 1. Scope

The pack models the **Düsseldorf arrival sector of Langen Radar**: the position that takes arrivals from Langen ACC at BIKMU, DOMUX, XAMOD and TEBRO, works them down the published RNAV transitions or on vectors to the final, and takes departures from Düsseldorf Tower passing 2,000 ft. In the real room this is the EDGGDUS sector, split into "Langen Radar" 128.555 (pickup) and "Düsseldorf Arrival" 128.655 (feeder, the final approach position) and "Langen Radar" 121.355 (departure). The player works the pickup frequency; the feeder and the departure position are units on the intercom.

| Area | Files | Checked |
|---|---|---|
| Aerodrome, runways, ILS, frequencies | `src/pack/eddl.ts` | AD 2.2, 2.12, 2.13, 2.17, 2.18, 2.19 |
| Night restrictions, parallel runway rules, transfer levels | `src/pack/eddl.ts` | AD 2.20, 2.21, 2.22 |
| STAR, RNAV transitions, ILS finals, SIDs | `src/pack/eddl.ts` | AD 2 EDDL 3-1-2, 3-1-3, 3-1-4, 4-2-1 to 4-2-4, 5-7-1 to 5-7-18, 6-1 to 6-5 (waypoint list) |
| CTR, class C areas, Langen sectors, TA and TL | `src/pack/eddl.ts` | ENR 2.1, ENR 1.7, AD 2.17 |
| Restricted areas | `src/pack/eddl.ts` | ENR 5.1 |
| VFR points | `src/pack/eddl.ts` | AIP VFR EDDL 4 |
| Minimum vectoring altitudes | `src/pack/eddl.ts` | No published chart, see 5.1 |
| Units, traffic, demand | `src/pack/eddl.ts` | AD 2.18, ENR 2.1, VATSIM SOP, 2025 traffic figures (secondary), see 5.5 |

## 2. Sources

The DFS AIP is published free of charge at aip.dfs.de ("basicIFR" and "basicVFR"). The server refuses scripted clients but serves a browser user agent; every page is a PNG image, so each page was downloaded, enlarged three times and read with tesseract, and every number used in the pack was then checked by eye against the page image. The AIP URLs below are the ones fetched.

| Source | URL | Date on the page | Access |
|---|---|---|---|
| AD 2 EDDL chapter (all 77 pages) | https://aip.dfs.de/BasicIFR/2026OCT01/chapter/8416f0a7e8c8e37b5751eefaacefdf5f.html | AIRAC 01 OCT 2026; individual pages dated 26 DEC 2024 to 06 AUG 2026 | Read (OCR and by eye) |
| AD 2 EDDL 1-1 (ARP, elevation, variation) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/9308E4BE431B027AFA00B74332F8752D.html | 26 DEC 2024 | Read |
| AD 2 EDDL 1-6, 1-7 (AD 2.12, 2.13 runways) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/63843036C74F4F7931DC7DBB7D959474.html | 22 JAN 2026, 27 NOV 2025 | Read |
| AD 2 EDDL 1-9 (AD 2.17 airspace, 2.18 frequencies) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/DEA17D37F6EFF202B32EA7A5AA914CCB.html | 25 DEC 2025 | Read |
| AD 2 EDDL 1-10 to 1-12 (AD 2.19 navaids, ILS) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/940E0290C50C155032C07647077F075D.html | 27 NOV 2025, 20 MAR 2025 | Read |
| AD 2 EDDL 1-13 to 1-15 (AD 2.20 night restrictions, HIRO) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/EDAA33297B796034451BEB000625130D.html | 02 OCT 2025, 06 OCT 2022, 11 JUL 2024 | Read |
| AD 2 EDDL 1-24, 1-25 (AD 2.21, 2.22 flight procedures, LVP) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/B5569D2E1CBF9BAC1EA015661486DACA.html | 06 AUG 2026 | Read |
| AD 2 EDDL 3-1-2 (STAR text) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/D96866F1AD157BA1755D8EF187DA1DB0.html | 28 NOV 2024 | Read by eye |
| AD 2 EDDL 3-1-3, 3-1-4 (RNAV transitions 05 and 23) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/E6B1DF7B8C51BE41773BE27E87E35496.html, https://aip.dfs.de/BasicIFR/2026OCT01/pages/F5B39EC787A37FCC6929F234FAB1416A.html | 19 MAR 2026 | Read by eye |
| AD 2 EDDL 4-2-1 to 4-2-4 (ILS 05L, 05R, 23L, 23R) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/078629E043C811AC2FA6D1E99F21D421.html and the three following chart pages | 16 APR 2026 | Read by eye |
| AD 2 EDDL 5-7-1 to 5-7-18 (SIDs, text and RNAV coding) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/15A659F6DED333B8831A87ED76624951.html and following | 28 NOV 2024, 15 MAY 2025 | Read (OCR and by eye) |
| AD 2 EDDL 6-1 to 6-5 (waypoint list) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/D21CD939D6C9A7CC965C1379021FE31F.html and following | 28 NOV 2024 | Read (OCR) |
| ENR 1.7 (altimeter setting, TA 5,000 ft) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/27EB7AAFC3678219BFC868AD24AB89F1.html | 22 FEB 2024 | Read |
| ENR 2.1-23 to 2.1-26 (class C areas DUESSELDORF/KOELN-BONN A to Y) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/2DB4995DA9E80367ECF2C90A7B20C062.html and following | AIRAC AMDT 03/24 | Read (OCR) |
| ENR 2.1-41 (CTR Düsseldorf) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/6082AB9D58B4C675CAB9C93FDC766E7B.html | AIRAC AMDT 03/26 | Read |
| ENR 2.1-112, 2.1-113 (Langen sectors Bottrop, Düsseldorf Terminal) | https://aip.dfs.de/BasicIFR/2026OCT01/pages/F0F6B90105058A2A638418B03D5BD69F.html | 19 MAR 2026 | Read |
| ENR 4.4 (TEBRO, DOMEG, BARAG, SONEB, MEVEL, MODRU, NETEX, VEBAK) | https://aip.dfs.de/BasicIFR/2026OCT01/chapter/c69c6f01acfee2d1608fb933f70b7cc1.html | AIRAC 01 OCT 2026 | Read (OCR and by eye) |
| ENR 5.1 (ED-R 111 Jülich) | https://aip.dfs.de/BasicIFR/2026OCT01/chapter/e5ef8334db6c5358588c2a468f506e5e.html | AIRAC AMDT 03/26 | Read (OCR) |
| AIP VFR EDDL 4 (visual operation chart) | https://aip.dfs.de/BasicVFR/2026OCT15/pages/92B50F84CF65897B600133A824C88D96.html | 24 JUL 2025 | Read by eye |
| AD 2 EDDK, EDLN, EDLV, EDLW 1-1 (reference points) | https://aip.dfs.de/BasicIFR/2026OCT01/chapter/68f5f29b15db47a74919a3a11c055500.html (AD 2 index) | AIRAC 01 OCT 2026 | Read |
| VATSIM Germany, SOP FIR Langen: EDDL Approach, Tower, Delivery, Overview | https://knowledgebase.vatsim-germany.org/books/sops-fir-langen/page/eddl-approach (and eddl-tower, eddl-delivery, eddl-overview) | current | Secondary: working method, holds, MVA figures, releases |
| VATSIM Germany, EDDK overview (Köln stations) | https://knowledgebase.vatsim-germany.org/books/sops-fir-langen/page/eddk-overview | current | Secondary, cross-check of ENR 2.1 |
| Aero International, Düsseldorf 2025 traffic | https://www.aerointernational.de/aktuelles/flughafen-duesseldorf-21-millionen-passagiere-und-starkes-wachstum-2025.html | 2026 | Secondary: 21 million passengers, 159,900 movements |

Not found: an ATC surveillance minimum altitude chart for EDDL in the free AIP (the chapter index has none), the Langen letters of agreement (departure transfer levels), the Maastricht sector frequencies, and the significant point ADEMI named by the VATSIM SOP (not in ENR 4.4).

## 3. Verified

- **ARP** 511651.33N 0064526.32E, elevation 147 ft, variation 3.2°E (2024), 4 NM north of the city. **TA** 5,000 ft (AD 2.17, ENR 1.7).
- **Runways** (AD 2.12, 2.13): thresholds as published; true bearings 052.80 / 232.80; 05R/23L 2,997 x 45 m, 05L/23R 2,700 x 45 m; threshold elevations 116 / 120 / 138 / 123 ft; every threshold displaced about 300 m (LDA 2,400 m and 2,696 m). The strips are drawn to the computed runway ends; threshold to threshold matches the LDA within 10 m (test).
- **ILS** (AD 2.19): 05L IDNE 110.95 CAT I (GP 330.65), 05R IDSE 110.15 CAT III (GP 334.25), 23L IDSW 109.90 CAT III (GP 333.80), 23R IDNW 109.30 CAT III (GP 332.00). All 3.0°. RDH 52 / 52 / 58 / 57 ft (AD 2 EDDL 4-2-x). LVP: 23R, 23L and 05R approved CAT III, 05L CAT I (AD 2.22).
- **Final approach**: FAF DIKMI (05L), NATOS (05R), METMA (23L), REGNO (23R), all 3,000 ft and 8.8 to 8.9 NM from the threshold, on the localizer course within 0.5° (test); 3,000 ft at the FAF sits on the 3° path from threshold plus RDH within 150 ft (test).
- **Missed approaches** (AD 2 EDDL 4-2-x): all climb to 4,000 ft and end direct DUS. 23L: heading 230 to 2.6 DME DUS, right onto 307 to the DUS R277, right direct DUS. 23R: heading 230 to 0.6 DME west of DUS, right 318 to 6.4 DME, right direct DUS. 05R: heading 050 to 6.0 DME, left 320 to the R012, left direct DUS. 05L: heading 050 to 1.6 DME IDNE, left 007 to 7.0 DME IDNE, left direct DUS. 190 kt (05L, 23R) or 220 kt (05R, 23L) in the first turn, 230 kt after. The pack flies each as two pseudo fixes (M23L1, M23L2 and so on, placed by bearing and distance from DUS) and then DUS.
- **Frequencies** (AD 2.18): Langen Radar 121.355 and 128.555 H24, Düsseldorf Arrival 128.655 (0445 to 2130 UTC, "primary frequency"), Düsseldorf Tower 118.305 (124.355 standby), Delivery 121.780, Ground 121.680 and 121.605, ATIS 123.780. Langen sectors (ENR 2.1): Düsseldorf Terminal EDGGDUS 121.355 / 128.555, Bottrop EDGGBOT 119.110, Köln Arrival EDGGDKA 135.350, Paderborn High 135.650, Nörvenich 127.365.
- **Transfer points and levels** (AD 2.22): BIKMU FL080 to FL110, DOMUX FL100 to FL140, XAMOD FL100 to FL140, TEBRO FL130 to FL150 ("for planning purposes"); average track miles from the transfer point to landing 27 to 75 NM as tabulated.
- **STARs** (AD 2 EDDL 3-1-2): BIKMU 1A (013°M, 11 NM to DUS), DOMUX 1A (251°, 31 NM), HALME 1A (210°, 30 NM), LMA 1A (108°, 14 NM), PISAP 1A (169°, 16 + 15 NM, FL060+ then 4,000+). The pack reproduces the five distances to DUS within 0.6 NM and the magnetic tracks within 5° (test). See 5.2 for how they are flown.
- **RNAV transitions** (AD 2 EDDL 6-1 to 6-3, charts 3-1-3 and 3-1-4): all eleven coded routes, every waypoint from the waypoint list, 220 kt from the first K220 point, 3,000 ft or above at the FAF. 21 chart legs reproduced within 0.5 NM and 0.6° (test), among them PISAP to VALSU 20.1 NM / 167.3°T, BIKMU to DL426 25.7 NM / 026.1°T, DOLAV to DL502 18.6 NM / 226.0°T, LMA to IBIKO 10.7 NM / 060.6°T.
- **SIDs** (AD 2 EDDL 5-7-x): all 44 published GPS/FMS RNAV codings for the four runways, with the published designators (23L suffix T, 23R suffix H and NVO 2U, 05R suffix Z and NETEX 1X, 05L suffix J and Y). Initial climb 5,000 ft on every SID; first turn at 600 ft or later; DL239/DL240 at 3,000 ft or above for the southern SIDs; 190 kt to the NVO radial on SONEB and MEVEL from 23; 210 kt and 250 kt on MODRU and NETEX; DL242, DEGOM, LIPMI at FL150 or above; DL245 and DL054 FL140 or above on SONEB; DODEN FL250 or above; MODRU FL210 or above. "Remain on Tower frequency until passing 2,000 ft, then contact Langen Radar 121.355." The RNP-only SIDs MODRU 2K and NETEX 1K are not modelled.
- **CTR** (ENR 2.1, AD 2.17): class D, GND to 2,500 ft MSL, the published seven-point outline with the 7 NM arc centred 511528N 0064516E. The field and all four thresholds are inside it (test).
- **Class C terminal airspace** (ENR 2.1 DUESSELDORF/KOELN-BONN A to Y): the twelve areas in or touching the sector with their published outlines and floors: A 1,500 ft (Essen side), C 2,000 ft (Mönchengladbach), D 2,500 ft (core), E 2,500 ft (Köln core), I and K 3,500 ft, M and N 4,500 ft, Q and R FL065, X and Y FL085; all to FL100, H24. The field is under D, Essen/Mülheim under A, Mönchengladbach under C, Köln/Bonn under E (test).
- **Sector**: Langen ACC Düsseldorf Terminal EDGGDUS2, GND to FL155, the published 16-point outline (ENR 2.1). EDGGDUS3 (the Dortmund area, FL065 to FL155 over Paderborn Low's GND to FL065) is drawn as a coordination area.
- **Restricted area**: ED-R 111 Jülich, 2 NM radius about 505400N 0062500E, GND to 2,300 ft MSL, H24 (ENR 5.1). No other ED-R or ED-D lies within 40 NM of the field.
- **VFR points** (AIP VFR EDDL 4): NOVEMBER 5124.4N 00644.9E, SIERRA 5108.5N 00647.2E, ECHO 5111.5N 00656.5E; VFR traffic at or below 2,500 ft.
- **Night restrictions** (AD 2.20, times UTC with the summer times one hour earlier): no scheduled take-offs 2100 to 0500 UTC, no scheduled landings 2200 to 0500 UTC, no delayed landings 2230 to 0500 UTC, and for delayed landings by home-based carriers 2300 to 0400 UTC. In local time: take-offs end at 22:00, scheduled landings at 23:00, delayed landings at 23:30, home-based carriers at 00:00; everything opens again at 06:00 (05:00 for a delayed home-based landing). Exemptions for diversions, HEMS and calibration flights. The pack's `curfew` holds each limit; free play drops departures inside the take-off restriction and the demand table has no departures from 22:00 to 05:59 and at most one arrival an hour from 00:00 to 05:59 (test).
- **Parallel runway rules** (AD 2.22): dependent operations; the northern runway 05L/23R lands and the southern 05R/23L departs; 2.5 NM between alternating approaches to the two runways inside 10 NM when no wake separation applies. The northern runway may be used 56 hours a week (AD 2.20 item 5.1); in single-runway operation everything uses the southern runway.
- **Neighbours**: Köln/Bonn 505157.30N 0070833.88E, Mönchengladbach 511349.28N 0063016.18E, Niederrhein 513608.69N 0060831.82E, Dortmund 513105.93N 0073644.07E (AD 2.2 of each).

## 4. Pack design decisions

| Item | Decision | Why |
|---|---|---|
| Position | Langen Radar 128.555, the pickup and the feeder combined; Düsseldorf Arrival 128.655 and Langen Radar 121.355 are intercom units | AD 2.18 lists both approach frequencies under Langen Radar. The real feeder works the final on 128.655 from 0445 to 2130 UTC; on a phone one player works both, and the picture lesson says so |
| STAR model | `stars` are the published designators, flown from one en-route fix to the transition entry fix (NVO to BIKMU, BARAG to DOMUX, DOMEG to HALME, TEBRO to PISAP, VEBAK to LMA); `starLimit` DUS: an arrival with no onward clearance continues on the STAR to DUS and asks for one | The published STARs end at DUS; Langen hands over at the entry fixes and the transitions take over there. The STAR clearance limit is DUS, so nobody holds at an entry fix on their own |
| Transitions | Eleven coded routes, each assigned to the runway whose FAF it ends at (05L: PISAP, HALME, BIKMU, LMA; 05R: DOMUX, ELDAR; 23R: PISAP, HALME, BIKMU, LMA; 23L: DOMUX) | The AIP's runway assignment is for lost communication only ("during normal operations both RWYs will be used"); the sim's auto-routing needs one FAF per transition. A runway swap is a vector in the sim as it is in reality |
| Intermediate fixes | I05L, I05R, I23L, I23R, 4 NM outside the FAF on the localizer, 3,000 ft | The ILS charts name no IF; the engine needs one for the IF to FAF segment |
| Holds | `stacksByDirection`: DL429 and DL409 for runway 23, DL524 and DL503 for 05, 4,000 ft to FL070 at 220 kt on the downwind tracks; DUS 3,000 ft to FL240, the missed approach hold; DOMEG, NVO and ELDAR are centre holds marked `published: false`, so ATC gives the inbound track and the turns; no holds at the entry fixes | Charts 3-1-3 and 3-1-4 draw the DL-point racetracks and no hold at BIKMU, DOMUX, HALME or PISAP; the VATSIM SOP gives DUS from 3,000 ft and the en-route holds |
| TL table | FL80 below QNH 977, FL70 from 977 to 1013, FL60 from 1014 | ENR 1.7 gives the rule (lowest FL at least 1,000 ft above the TA): FL060 is only 1,000 ft above 5,000 ft at 1013.25 hPa and above, so 1013 still gives FL070 |
| Departures | `departureRelease: 'conditional'`: Tower launches on its own and asks for a release only for five minutes after a go-around, in LVP, and for the southern exits off 23 while the Köln agreement is in force (`releaseExits`, scenario `neighbourBusy`). `depXflByDirection` FL100 off 23, FL080 off 05; `xfrByExit` hands MEVEL and SONEB to Bottrop, NUDGO and GMH to Paderborn, the southern and western exits to Nörvenich; SIDs stop at 5,000 ft | The VATSIM SOP: no routine releases, southern 23 departures released by Köln arrival when it is busy, 05 departures below FL090 under the inbounds at FL100. The letter of agreement is not public |
| Runways in use | `preferredRunways` 23L then 05R | AD 2.20: single-runway operation on the southern runway; westerlies make 23 the usual direction |
| Traffic | Passenger operators with weights (Eurowings 14, Condor 6, Lufthansa 5, TUI 4, Turkish 4, Ryanair, SunExpress, Pegasus, easyJet Europe 3 each, the rest 1 or 2), two cargo operators, no night bank | Eurowings and Condor base at DUS; cargo is marginal; AD 2.20 closes the night |

## 5. Approximate, and why

### 5.1 Minimum vectoring altitudes
The free AIP has no ATC surveillance minimum altitude chart for EDDL. The areas use the VATSIM Germany SOP figures, which are the real unit's winter values (2,200 ft around the field, 3,200 ft south of final 23L), and terrain plus 1,000 ft rounded up to 500 ft outside them: 2,500 ft over the Ruhr and the Köln lowland, 3,800 ft over the Bergisches Land, 4,500 ft east of 7°40'E over the Sauerland. The FAFs at 3,000 ft and the 4,000 ft downwind holds are above the areas beneath them (test). Expect the real chart to have more and smaller sectors.

### 5.2 STARs and transitions
The sim flies a STAR only to its entry fix and prepends one en-route fix (section 4). The feed fixes are real (ENR 4.4), the leg from them is not a published route; the handoff levels are the middle of the AD 2.22 planning bands. LMA 1A has no realistic feed (VEBAK is 4 NM away) and carries weight 0 in the arrival mix. Each transition is bound to one runway (section 4); the real unit uses either runway from any transition.

### 5.3 Holds
DL429 (left), DL409 (right), DL524 (right) and DL503 (left) were read from charts 3-1-3 and 3-1-4. The DUS inbound track (146°M) was read from a small chart image and may be wrong; the levels at DOMEG, NVO and ELDAR and the DUS minimum of 3,000 ft follow the VATSIM SOP. A reviewer with the Jeppesen or LIDO plates should check the DUS and DL-point racetracks first.

### 5.4 Airspace
Class C area X follows the Dutch border between two published points and is drawn straight. The 4,500 ft to FL100 class C rule of the engine ("Brussels CTA from 4,500 ft") does not apply in Germany; between the class C steps and FL100 the airspace is class E, which the engine treats as uncontrolled (speed limit 250 kt applies, which is correct for class E).

### 5.5 Other
- Maastricht Radar 134.455, the Geilenkirchen military unit "Frisbee Radar" 131.800 and the supervisor are not verified (the VATSIM SOP names Frisbee; the frequencies are placeholders).
- The departure transfer levels (FL100 off 23, FL080 off 05) and the exit-to-sector map are from the VATSIM SOP, not the letter of agreement. Which exits Nörvenich takes is not verified.
- Wake: ICAO categories (`wakeScheme: 'ICAO'`). DFS introduced RECAT-EU at Leipzig in 2018 and no source shows it at Düsseldorf.
- Essen/Mülheim's position is from its published coordinates, not the AIP; towns, the Rhine, the motorways and the border are drawn by hand.
- Traffic mix, fleets and the demand curve (about 440 movements on a summer weekday with 06:00 to 08:00 and 16:00 to 19:00 peaks) are estimates built on the 2025 figures. Operators are mapped to the engine's existing performance types; the stand-ins are: Condor B753 as `B752`, Condor and Turkish A330-300 as `A332`, Emirates B777-300ER and A380 as `B77L`, Qatar and Etihad B787 as `B77L`, Delta B767-400 as `B763`, Lufthansa and Eurowings A319 and A320neo as `A320`. Types the engine should add (performance from public type data, same scale as `perf.ts`): `A319` (recat D, M; vapp 130, vminClean 195, vminFlap 145, climb 3,000, descent 2,300), `A21N` (as A321), `B753` (recat C, M; vapp 140, vminClean 205, vminFlap 155, climb 2,800, descent 2,300), `A333` (recat B, H; vapp 140, vminClean 210, vminFlap 160, climb 2,200, descent 2,000), `B77W` (recat B, H; vapp 150, vminClean 215, vminFlap 165, climb 2,200), `A388` (recat A, J; vapp 140, vminClean 215, vminFlap 165, climb 1,800, descent 1,800, fuel 11,000 kg/h), `B789` (recat B, H; vapp 145, vminClean 210, vminFlap 160, climb 2,500), `E195` (as E190), `AT76` (recat E, M; vapp 115, vminClean 160, vminFlap 130, climb 1,500, descent 1,500), `DH8D` (recat E, M; vapp 120, vminClean 170, vminFlap 135, climb 1,800).

## 6. Open questions for the reviewer

1. Does Langen really hand BIKMU arrivals over from NVO, and DOMUX arrivals from BARAG, or from other fixes? The feed legs are the least verified part of the arrival picture.
2. The DUS racetrack (inbound 146°M, left turns in the pack).
3. The DUS sector ceiling FL155 (EDGGDUS2) as the sim's sector ceiling: is the pickup really working traffic up to FL155, or does Bottrop (FL155 to FL245 in EDGGBOT7) take the descent earlier?
4. The departure transfer levels (FL100 off 23, FL080 off 05) and which Langen sector takes each exit.
5. Whether the northern runway is in use often enough on a weekday afternoon to justify a parallel-runway scenario in phase 2 (56 hours a week by AD 2.20, scheduled a week ahead).

## 7. Independent review and fixes (2.0)

An independent controller review in October 2026 checked 22 values against the AIP images and found the data very good but the operating method half right. Each finding was checked against the AIP pages before the data changed. What changed:

| Finding | Change | Still approximate |
|---|---|---|
| H1 Invented holds at the entry fixes | The entry-fix holds are gone. The stacks are the downwind holds by runway direction (`stacksByDirection`); an arrival with no onward clearance continues on its STAR to DUS (`starLimit`) and asks for one; NVO, ELDAR and DOMEG stay as centre holds (remote holds on the aircraft's own feed) and, being unpublished, are given with the inbound track and the turns. A hold at an entry fix is still possible when there is no other choice, and is described the same way | The inbound tracks of the unpublished holds are taken along the arrival track |
| H2 No routine departure releases | `departureRelease: 'conditional'` (section 4). Departures wait in a Tower queue and launch into a runway gap; after four minutes of waiting Tower asks you for a 6 NM gap | Tower's gap rule is simple: the departure spacing after the last departure, the runway clear, no arrival inside 5 NM (6 NM for a heavy) and no approach to the opposite end inside 25 NM |
| H3 Wake between the close parallels | `closeParallels`: wake separation applies across 23L and 23R (the 2.5 NM diagonal only where no wake minimum applies); in LVP both are one runway for the arrival check and the monitor | |
| H4 Curfew and the shape of the day | Curfew per movement type (section 3); the demand table splits arrivals and departures by hour, with the 06:00 departure wave (22 out, 6 in), an arrival-heavy 21:00 and 25 arrivals with no departures from 22:00 to 23:00; free play applies summer time when given a date, and the EDDL morning shift has its own curve | The hourly figures are estimates from the coordinated slots |
| H5 Approach clearance late | A new `expect` item ("expect ILS approach runway 23R", chip `EXP ILS 23R`). The first-contact chip is the transition, a level and "expect ILS"; the approach clearance comes on the downwind or base with the descent, and the first in the sequence gets a shortcut (direct to the final approach fix when it meets the final at 40° or less). The autopilot at Düsseldorf taps the same chips | Base turns are flown as directs to the final approach fix, not as headings |
| M1 Missed approaches | Each runway's published missed approach as two pseudo fixes and DUS (section 3) | Fix positions are computed from the DME figures |
| M2 The feeder | The position is the pickup and the feeder combined (section 4) | |
| M3 Control-zone traffic | Christoph 9 and the NOVEMBER to SIERRA crossings work with Tower; Tower asks you on the intercom before they cross the final. HEMS flies 07:00 to 20:00 local, VFR 07:00 to 21:00 | |
| M4 Transfer level and next sector | By direction and by exit (section 4); the hand-off chip names the sector | |
| M5 Autopilot bugs | Düsseldorf uses a chip-driven autopilot, which never builds a level by hand and never says "resume normal speed" inside 15 NM. The Liège autopilot is unchanged so its sessions replay identically | The Liège autopilot keeps the FL071 and late "resume normal speed" quirks |
| M6 Lesson facts | The eight Düsseldorf procedure and judgement lessons were rewritten: north downwind for BIKMU, PISAP, HALME and LMA; ten minutes' notice for a runway change; the heavy emergency to 23L; departures first at 06:00 | |
| M7 Wake scheme | ICAO at Düsseldorf (section 5.5): 5 NM medium behind heavy, 6 NM heavy behind super, 7 NM medium behind super | |
| M8 Curfew in scenarios | The quiet-night challenge starts 22:20 UTC; the morning rush has no departure before 06:00 local; no HEMS at night | |
| L1 to L11 | Transitions spoken "BIKMU two three"; LMA is "Lima"; the first reply to an arrival is "<callsign>, Langen Radar"; departures check in "climbing five thousand feet"; ASL is Air Serbia, ABR is "Contract", KLM's Embraers fly as KLC "City"; DUS hold from 3,000 ft; "the agreed transfer level"; no STAR name in arrival check-ins; the Liège frequency comment removed; FL060 from QNH 1014 | L3 "Say again, <callsign>" and L7 (the north runway opened in free play 06:00 to 08:00 and 16:00 to 19:00) are not done |

L10: the centre's verbal estimates ("estimate EWG1AB, BIKMU1A, NVO at 06, FL100") are a game device. The real unit sees the flight plan and the track in the system and gets no spoken estimate.

The chip-only bot survey (30 seeds, a daytime hour) went from 10 losses of separation, 1 wake infringement and no go-arounds to 5 losses of separation, 4 wake infringements and 2 go-arounds, with 260 of 272 arrivals landed in the hour. The wake count reflects the stricter ICAO distances and the new check across the close parallels.
