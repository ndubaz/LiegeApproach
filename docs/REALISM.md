# Liège Approach: realism validation report

Version 1.0 data pack. Checked 13 October 2026 against the AIRAC cycle effective **01 OCT 2026**.
Written for a rated approach controller. It says what was checked against which source, what changed, and what still differs from the real unit.

`tests/realism.test.ts` locks in every fact marked "verified" below.

## 1. Scope

| Area | Files | Checked |
|---|---|---|
| Aerodrome, runways, ILS, frequencies | `src/pack/eblg.ts` | AD 2.2, 2.12, 2.17, 2.18, 2.19 |
| STAR, transitions, IAC, SID, holds | `src/pack/eblg.ts` | AD 2.22 coding tables, leg by leg |
| CTR, TMA, TSA, TL | `src/pack/eblg.ts` | AD 2.17, ENR 2.1, ENR 5.2, ENR 1.7 |
| Minimum vectoring altitudes | `src/pack/eblg.ts` | ATCSMAC not retrievable, see 5.1 |
| RTF phraseology | `src/engine/clearance.ts` | ICAO Doc 4444 ch. 12, Doc 9432, UK practice |
| Aircraft and traffic behaviour | `src/engine/pilot.ts`, `perf.ts`, `sim.ts`, `traffic.ts`, `weather.ts` | Measured headless. Not edited here; see section 7 |

## 2. Sources

| Source | URL | Date seen | Access |
|---|---|---|---|
| skeyes eAIP EB AD 2 EBLG (current) | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-AD-2.EBLG-en-GB.html | valid from 01 OCT 2026 | Read through the page-text tool; the raw page and PDFs return 403 (WAF) to scripts |
| skeyes eAIP EB AD 2 EBLG (next) | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Next/html/eAIP/EB-AD-2.EBLG-en-GB.html | valid from 29 OCT 2026 | Compared: same holds, ILS and frequencies |
| skeyes eAIP EB ENR 2.1 | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-2.1-en-GB.html | AIRAC 01 OCT 2026 | Read |
| skeyes eAIP EB ENR 5.2 | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-5.2-en-GB.html | AIRAC 01 OCT 2026 | Read |
| skeyes eAIP EB ENR 1.7 | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-1.7-en-GB.html | AIRAC 01 OCT 2026 | Read |
| skeyes eAIP EB ENR 1.6 | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/EB-ENR-1.6-en-GB.html | AIRAC 01 OCT 2026 | Read |
| EBLG AD 2 PDF (charts incl. ATCSMAC) | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/pdf/EB_AD_2_EBLG_en.pdf | n/a | **Not reachable** (403) |
| AIP Amdt A 008/2024 checklist (shows AD 2.EBLG-ATCSMAC.01 dated 21 MAR 2024) | https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Previous/pdf/EB_Amdt_A_2024_008_en.pdf | 08 AUG 2024 | Read |
| skeyes EBLG runway and movement report 2025 | https://www.skeyes.be/media/2574/2025_eblg_rpr.pdf | calendar 2025 | Read |
| ICAO Doc 4444 PANS-ATM, 16th ed., ch. 12 (copy) | https://anyflip.com/hfqv/ghsb/basic/251-300 | Amdt 10/11/16 | Secondary copy, medium confidence |
| UK CAA FODCOM 09/2010 ("to" not used with flight levels) | https://caa.co.uk/publication/download/13881 | 31 MAR 2010 | Read |
| EUROCONTROL RECAT-EU, Ed. 1.1 | https://code7700.com/pdfs/wake_turbulence_recat-eu-september-2015.pdf | 15 JUL 2015 | Secondary copy of the EUROCONTROL document |
| EUROCONTROL Specification for STCA, Ed. 1.0 | https://www.eurocontrol.int/archive_download/all/node/11638 | 22 NOV 2007 | Read |
| Cardosi, Brett, Han: TRACON controller-pilot voice communications (FAA) | https://rosap.ntl.bts.gov/view/dot/8711/dot_8711_DS1.pdf | June 1996 | Read |
| EUROCONTROL Air-Ground Communication Safety Study (via Flight Safety Foundation) | https://flightsafety.org/?p=6760 | 2006 | Secondary |

Doc 9432 (Manual of Radiotelephony) was not available online; its examples follow Doc 4444 chapter 12 and Annex 10 Vol II, which the checks use.

## 3. Verified and unchanged

- **ARP** 503811N 0052634E, elevation 651 ft, variation 2°E (2020), TA 4,500 ft.
- **Runways** (AD 2.12): thresholds, true bearings 045.16/225.16, elevations 644/595/629/577 ft, lengths 3,690 m and 2,340 m. 04R threshold is displaced (3,046 m to the 22L threshold). Designators agree with the magnetic course.
- **ILS** (AD 2.19): 22L ILG 109.350 CAT III, 04R IHH 108.750 CAT III, 22R IBI 109.350 CAT I (same channel as 22L; the runways are never used together), 04L none. GP 3.0°.
- **Frequencies** (AD 2.18): Liège Approach 119.280, Liège Tower 118.130 (secondary 130.625), Liège Ground 121.915, ATIS 126.255. All 8.33 kHz channels.
- **Terminal fixes**: every AD 2.22 coordinate, and every coded leg of the 10 STARs, 8 transitions, 7 SIDs and the 4 RNP finals: true course and distance reproduced within 0.2 NM and 0.6° (56 legs in the test).
- **Final approach**: FAF to threshold 5.8 (22L), 5.9 (22R), 7.3 (04L), 7.2 (04R) NM; the FAF altitudes (2,500 ft for 22, 3,000 ft for 04) sit on a 3° path from threshold elevation plus TCH within 0.15 NM. IF to FAF is on the final course.
- **Restrictions**: STARs end at ALHUV 3,000 ft or above, 250 kt or less; transitions 3,000 ft+/250 kt, with LIBVA/LAVTO at 2,500 ft+/200 kt; ALHUV1W and ALHUV1Y are ATC discretion only. SIDs: FL060 initial climb, LG003 6,500 ft+ and LG013 6,000 ft+, 220 kt on the turning legs.
- **Holds** (AD 2.22): ALHUV 043°M left, 3,000 ft to FL050, 230 kt; GIREL 314°M left, FL060 to FL140, ATC discretion; GSY 093°M right, FL070 to FL100, ATC discretion. 1 minute legs.
- **CTR**: class D, surface to 2,500 ft, H24, lateral limits as published.
- **VFR points** ROMEO, INDIA, OSCAR, FOXHE (standard) and ECHO, WISKY, NOVEM, SIERA (ATC discretion).

## 4. Changed

### 4.1 Pack data (`src/pack/eblg.ts`)

| Item | Was | Now | Source |
|---|---|---|---|
| RUDIX, GILOM, MAK, KOK, GESLO, RITAX | Derived from one leg each, using the reciprocal of the published course. The published course is the *initial* great-circle course, so long legs were off by up to 2.8 NM (KOK) | Least-squares fit to every coded leg touching the fix. Residual 0.1 NM or less | AD 2.22 coding |
| NIK | Derived from GILOM (0.6 NM off) | 510954N 0041102E, the centre of the ENR 2.1 40 NM arc. Reproduces NIK-GSY 167.0°/43.8 NM exactly | ENR 2.1, AD 2.22 |
| TMA | One rectangle "approximate", 2,500 ft to FL095 | `tma` = TMA One, class C, 2,500 ft to FL055 (H24). `tmaParts` = all five sub-areas with floors 2,500 / 2,000 / 2,500 / 3,000 / 3,500 ft and the night activation of Three to Five (2200-0500 UTC, summer 2100-0400) | ENR 2.1 |
| TSA28 | One box, ground to FL105 | TSA28A and TSA28B, ground to FL105, published outlines | ENR 5.2 |
| TSA29A | Box over the Ardennes, 4,500 ft to FL145 | Published outline. It now covers GIREL and RUDIX, so the D-series STAR loop lies inside it | ENR 5.2 |
| TSA29B | Absent | Added, 4,500 ft to FL095 | ENR 5.2 |
| TSA26 | Box, ground to FL095 | TSA26B, 4,500 ft to FL095, published outline (TSA26A is FL095 to UNL above it) | ENR 5.2 |
| MVA | 3,000 ft over the Hautes Fagnes and TMA Five | 3,500 ft east of 5°59'56"E and over the Ardennes; 3,000 ft over TMA Four; 2,500 ft round the field. Basis in 5.1 | TMA floors, terrain |
| Runways | No TCH, GP, missed-approach data | `tch` 56/58/54/50 ft, `gpDeg` 3, `missedAlt` 3,000 ft, `missedSpd` 215 kt, GP frequencies | AD 2.19, IAC coding |
| Meta | | `tlTable` (ENR 1.7), `gndFreq`, `squawkBlock` 6330-6343, `effective`, `initialClimbLowQnh` (FL070 when QNH 995 or below), source URLs | ENR 1.7, AD 2.18, ENR 1.6, AD 2.22 |

New optional schema fields (appended, nothing removed): `RunwaySpec.gpDeg, tch, missedAlt, missedSpd`, `ils.gp`; `HoldSpec.inboundMag, legMin`; `AreaSpec.cls, hours`; `meta.tlTable, gndFreq, squawkBlock, effective, initialClimbLowQnh`; `PackSpec.tmaParts`. `load.ts` passes them through (`Runway`, `Area`, `Pack.tmaParts`) and adds `tlFromTable(meta, qnh)`.

### 4.2 Phraseology (`src/engine/clearance.ts`)

What is said on the frequency (speech, which drives the voice and the airtime) now follows Doc 4444. The written transcript keeps its compact form until the lead flips `PHRASE_STYLE.icaoText` (section 8), because tests the realism track does not own pin the old strings.

| Phrase | Before | After | Source |
|---|---|---|---|
| Altitude, climb or descend | "descend altitude three thousand feet" | "descend **to** altitude three thousand feet, QNH one zero one eight" | Doc 4444 12.3.3: CLIMB/DESCEND TO (level) |
| Flight level | "climb flight level niner zero" | unchanged: no "to" before a flight level | UK FODCOM 09/2010: avoids "to"/"two" (e.g. FL220). Doc 4444 has TO; Belgian practice not confirmed |
| Maintain | "maintain altitude ..." | unchanged; never "to" | Doc 4444 12.3.2.3: MAINTAIN (level) |
| Speed | "reduce speed one eight zero knots" | "reduce speed **to** one eight zero knots"; "increase speed to"; "maintain one six zero knots [until ...]" | Doc 4444 12.4.1.6 |
| Transfer to Tower | "contact Tower one one eight decimal one three zero" | "contact **Liège Tower** one one eight decimal one three zero" (text "Liège Tower 118.130") | AD 2.18 callsign |
| Readback | inherits the controller's words | "descend to altitude three thousand feet, QNH one zero one eight, reduce speed to two two zero knots, World Express seven" | Doc 4444 4.5.7.5 (readback of level, speed, QNH) |

Checked and left as they were: "turn left heading two five zero" and "fly heading" (Doc 4444 12.4.1, vectoring); "vectoring for ILS approach runway two two left" (12.4.2.1); "(n) miles from touchdown, cleared ILS approach runway 22L" (Doc 4444 radar section prints CLEARED FOR (type) APPROACH; the UK and most European units drop "for"); "hold at ALHUV as published, expect approach clearance at zero two one four" / "no delay expected" (12.3.3.3 prints PROCEED TO (fix) ... HOLD AS PUBLISHED); "Liège Approach, identified" (12.4.1.1); "reduce to minimum clean speed", "resume normal speed"; "squawk"; numbers per Annex 10 ("niner", "one zero thousand"); 8.33 kHz frequencies said in six digits unless the last two are zero.

## 5. Still approximate, and why

### 5.1 Minimum vectoring altitudes
The ATC Surveillance Minimum Altitude Chart exists (AD 2.EBLG-ATCSMAC.01, pages dated 21 MAR 2024) but the chart PDF could not be fetched. The sim's areas are built from:
- the TMA floors, since vectoring stays inside controlled airspace: TMA One 2,500 ft, TMA Four 3,000 ft, TMA Five 3,500 ft;
- terrain plus 1,000 ft obstacle clearance, rounded up to the next 500 ft: Condroz south of the field 3,000 ft; Hautes Fagnes (Botrange 694 m, 2,277 ft) and the Ardennes 3,500 ft;
- consistency with the procedures: KAQZI 2,100 ft and PIZVE 2,200 ft on the 04R ILS initial lie inside the 2,500 ft area, so the real chart is likely no higher there.
Expect the real chart to have more, smaller sectors and some values 100-300 ft different.

### 5.2 Airspace above FL055
The Liège TMA tops at FL055. Above it is the Brussels CTA (FL055 to FL095 in this area; 4,500 ft base east of TMA One). The STAR handoff levels (FL070 to FL090) suggest Liège works that block by delegation, so the sim keeps a sector ceiling of FL095. No published delegation was found.

### 5.3 TSAs are closed volumes in the sim
The sim treats an active TSA as closed to your traffic over its full published volume. ENR 5.2 says TSA 26 and 29 users "must stay clear of controlled airspace", so in reality the part that overlaps the Liège TMA and the Brussels CTA stays usable for GAT unless the military get it delegated. With the published TSA29A outline, the Hot TSA challenge and the free-play TSA card now cover the whole D-series loop (GIREL and RUDIX). That is stricter than reality.

### 5.4 Other
- Upstream callsigns and frequencies (Brussels Control 131.100, Maastricht 132.755, Beek Approach 123.980) and the "Military" unit: not verified.
- Border segments of TMA Three/Five and TSA28 are straight lines between the published border points.
- The 04R ILS initial from ALHUV via ABLAZ (2,500 ft), PIZVE (2,200 ft), KAQZI (IF 2,100 ft) is published but not modelled as a procedure (noted on the runway).
- Video map (river, roads, borders, towns) is drawn by hand.

## 6. Remaining deviations

Severity: **High** = a rated controller would call it wrong in normal play. **Medium** = visible to a rated controller, rarely matters to the game. **Low** = cosmetic or edge case.

| # | Deviation | Where | Real | Severity |
|---|---|---|---|---|
| 1 | RECAT-EU categories: A320, A321, B738 are E; B752 is D | `perf.ts` PERF | A320/A321/B738 are D (upper medium); B752 is C (lower heavy) | High |
| 2 | RECAT-EU table: C to E 3.5 NM; F to F missing | `perf.ts` RECAT_NM | C to E 4 NM; F to F 3 NM; C to C is the radar minimum | Medium |
| 3 | 2.5 NM on the same final inside 10 NM used everywhere | `sim.ts` monitor(), onTouchdown() | Doc 4444 8.7.3.2 allows it only where the authority approves it (ROT 50 s or less, braking good, wake minima not applicable). Not found in the EBLG AIP | Medium (unverified) |
| 4 | Transition level computed (27 ft/hPa, 1,000 ft layer) | `weather.ts` transitionLevel() | ENR 1.7 table. Differs at QNH 995, 977, 959 (sim one FL low) | Medium |
| 5 | SID initial climb is FL060 at every QNH | `sim.ts` release (line ~377) | FL070 when QNH is 995 hPa or below (AD 2.22) | Medium |
| 6 | Transcript shows "descend 4,000 ft", "reduce speed 210 kt" | `clearance.ts` PHRASE_STYLE | ICAO wording, already used in speech | Medium |
| 7 | Hold entry: always direct to the fix then turn outbound | `pilot.ts` HOLD 'entry' | Doc 8168 sector entries: parallel, offset (teardrop), direct | Medium |
| 8 | Active TSA closed over its whole volume (5.3) | `sim.ts` monitor(), pack TSAs | GAT in CAS keeps its airspace unless delegated | Medium |
| 9 | Bank arrival rate up to 24-27 per hour | `traffic.ts` SHIFT_CURVE, TEMPLATES | 2025 average: 7.4 movements in the 00:00 hour, 6.3 at 04:00, about 32 per night (23:00-06:00). Declared capacity 34 (RWY 22) / 35 (RWY 04) per hour | Medium (deliberate game compression; within declared capacity) |
| 10 | VFR crossing squawks 70xx | `sim.ts` around line 790 | Liège assigns from 6330-6343 (ENR 1.6) | Low |
| 11 | Glide path reference 50 ft above threshold | `pilot.ts` glideAlt() | TCH 56/58/54/50 ft per runway (`rwy.tch`) | Low |
| 12 | Missed approach speed not applied | `sim.ts` goAround | 215 kt to ALHUV at 3,000 ft (`rwy.missedSpd`) | Low |
| 13 | Readback error rate 2-4 % of level/heading clearances (x3 for "unfamiliar" crews) | `scenarios.ts` readbackErr | About 1 % of TRACON readbacks (0.5 % with two items, 3.6 % with five or more), Cardosi 1996 | Low (training emphasis) |
| 14 | Runway occupancy 50 s (120 s in LVP) for every type | `sim.ts` onTouchdown() | Wide-body freighters on 22L typically 55-70 s (estimate; no Liège ROT data found) | Low |
| 15 | Type mix has almost no narrow-body freighters or turboprops | `traffic.ts` CARGO_OPS | Liège sees B737F (ASL), A321P2F and ATR 72F alongside the wide-bodies (fleet knowledge, not a published count) | Low |
| 16 | Free-play TSA card can activate TSA29A at night | `traffic.ts` deck | TSA29A: Monday to Friday by NOTAM, mostly daytime CSAR | Low |
| 17 | Maastricht callsign "Maastricht" on transfer | `clearance.ts` UNIT_NAME | Probably "Maastricht Radar" (pack meta uses that); not verified, an engine test pins the current word | Low |

## 7. Engine measurements

All from headless runs (`Sim.step()` at 1 s, calm wind, QNH 1013). Not edited here.

| Check | Measured | Typical | Verdict |
|---|---|---|---|
| Climb 2,000-5,000 ft | B744 1,650; B748 1,650; MD11 1,860; B77L 2,020; A306 2,020; B763 2,310 fpm | Heavy freighters at 250 kt below FL100: 1,500-2,500 fpm | Realistic |
| Departure speed at 2,000 ft | 183-199 kt, 250 kt by 5,000 ft | Flap retraction and 250 kt by 3,000-5,000 ft | Realistic |
| Descent FL080 to 3,000 ft, 250 kt | about 1,250 fpm average, 2,000-2,200 peak, all types | Idle at 250 kt: 1,200-2,000 fpm; more with speedbrake | Realistic, a little uniform across types |
| Descent while slowing 250 to 210 kt | 1,060-1,140 fpm; slowing takes 110-142 s | A heavy cannot slow and descend steeply at once | Realistic |
| Turn rate | Bank limited to 25°, capped at 3°/s: 1.9°/s at 250 kt, 2.3°/s at 210 kt, 3°/s at 160 kt | Autopilot heading mode 25-30° bank | Realistic |
| LOC capture | 30° intercept: captures on the centreline, overshoot about 0.3 NM; 45° about 0.5 NM | Small overshoot at 45°, near zero at 30° | Acceptable |
| ILS speeds | 180 kt to 12 NM, 160 kt to about 4.5 NM, Vapp inside; stable gate 1,000 ft | Common European pattern (160 kt to 4 NM) | Realistic |
| Hold at ALHUV, 230 kt | Lap 292 s: 74 s turn, 60 s outbound, about 76 s turn, 82 s inbound | 1 min legs at 25° bank: about 290 s | Realistic timing; entries simplified (row 7) |
| Go-arounds, autopilot on all challenges | 2 in 113 landings (17.7 per 1,000) | 1-4 per 1,000 approaches in normal operations | Driven by the autopilot player, not the pilot model |
| Wake and radar minima | 3 NM, 2.5 NM on final inside 10 NM, RECAT-EU table | See rows 1-3 | Fix rows 1-3 |
| Runway occupancy | 50 s (120 s LVP) | See row 14 | Acceptable |
| Readback errors | 2-4 % per level/heading clearance | See row 13 | Higher than real, by design |
| Traffic, free play 120 min | Night template: 22 then 12 arrivals per hour, 6-7 departures. Shift: 27 then 7 arrivals; 13 departures in hour two | See row 9 | Busy-night peak, not an average night |
| TSA events after the outline change (autopilot) | Hot TSA: 2 before, 8 after. Five 04 shifts with military: 6 before, 11 after | | The autopilot does not route round the larger TSA29A |

## 8. Changes recommended in files this track does not own

Exact changes, in priority order.

1. **`src/engine/perf.ts`, PERF**: `A321` and `A320` and `B738`: `recat: 'E'` to `recat: 'D'`. `B752`: `recat: 'D'` to `recat: 'C'`. (RECAT-EU Ed. 1.1 Table 2.) E190 stays E, C30J stays D.
2. **`src/engine/perf.ts`, RECAT_NM**: `CE: 3.5` to `CE: 4`; add `FF: 3`. (RECAT-EU Table 3.)
3. **`src/engine/weather.ts`**: use the published table when the pack has one: in `sim.ts` lines 86 and 1298, `this.tl = tlFromTable(pack.meta, this.qnh) ?? transitionLevel(this.qnh, pack.meta.transitionAltitude);` (import `tlFromTable` from `../pack/load`).
4. **`src/engine/sim.ts` line ~377**: `const low = this.pack.meta.initialClimbLowQnh; const level = rel?.lvl ?? (low && this.qnh <= low.qnhMax ? parseLevel(low.level)! : sid.initialClimb);` (import `parseLevel`). The tutorial says "SIDs stop at FL060"; leave its scenarios at QNH above 995 and nothing changes there.
5. **`src/engine/clearance.ts` `PHRASE_STYLE.icaoText`**: set to `true` and update these assertions:
   - `tests/engine.test.ts:218` `'DHK7, cancel approach clearance, turn left heading 040, climb to altitude 7,000 ft, QNH 1018'`
   - `tests/engine.test.ts:254` `'AAA1, hold at ALHUV as published, no delay expected, descend to altitude 4,000 ft, QNH 1018'`
   - `tests/engine.test.ts:276` `'QTR8125, descend to altitude 4,000 ft, QNH 1018'`
   - `tests/engine.test.ts:277` `'QTR8125, reduce speed to 210 kt'`
   - `tests/engine.test.ts:297` `'descend to altitude 6,000 ft, QTR8125'`
   - `tests/engine.test.ts:304` `'DHK7, turn left heading 270, vectoring for ILS approach runway 22L, descend to altitude 5,000 ft, QNH 1018'`
   - `tests/engine.test.ts:307` `'DHK7, fly heading 240, descend to altitude 4,000 ft'`
   - `tests/v04.test.ts:165` regex `/maintain altitude 3,000 ft/`
6. **`src/engine/sim.ts` monitor() (line ~1377) and onTouchdown() (line ~1117)**: make 2.5 NM on final depend on a pack flag, e.g. `const latMin = sameFinal && this.pack.meta.reducedFinalSep ? 2.5 : 3;` and `wakeMinNm(..., this.pack.meta.reducedFinalSep ? 2.5 : 3)`. Leave EBLG without the flag until a Liège source confirms approval. This makes final spacing harder; check the autopilot tests.
7. **`src/engine/pilot.ts` glideAlt()**: `rwy.elevation + (rwy.tch ?? 50) + dthr * GS_FT_PER_NM`.
8. **`src/engine/sim.ts` goAround**: set `ac.spdAssigned = rwy.missedSpd` (215 kt) on the missed approach, and climb to `rwy.missedAlt`.
9. **`src/engine/pilot.ts` HOLD 'entry'**: pick the Doc 8168 entry from the angle between the aircraft track and the inbound course (direct 180°, parallel 70°, offset 110° sectors) instead of always flying direct and turning outbound.
10. **`src/engine/sim.ts` ~790**: VFR crossing code from the Liège block (6330-6337, then 6340-6343):
    ```ts
    const n = ac.id % 12;
    sqk = (ac as any)._xsqk ?? ((ac as any)._xsqk = n < 8 ? `633${n}` : `634${n - 8}`);
    ```
11. **`src/engine/autopilot.ts`**: route round active TSAs (TSA29A now covers GIREL and RUDIX).
12. **`src/ui/game.ts:563`**: label `'Liège Tower 118.130'`.
13. **`src/engine/traffic.ts`**: optional "Realistic night" template: arrivals 5/h at 23:00, 8/h at 00:00, 3/h 01:00-03:00; departures peaking 7/h at 04:00 (skeyes 2025 report, average night). Add B738/B734 (TAY, ASL Belgium) and AT76 freighters to CARGO_OPS.
14. **Scope** (`src/ui/scope.ts`): draw `pack.tmaParts` (TMA Two to Five dashed and fainter; Three to Five only 2200-0500 UTC).
