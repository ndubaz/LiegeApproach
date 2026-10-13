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
- **Restrictions**: the STARs from LNO (LNO6X, GESLO6X) and all the D-series STARs end at ALHUV at 3,000 ft or above; CIV7X, KOK7X and NIK7X end at ALHUV at FL060 or above. All at 250 kt or less. Transitions 3,000 ft+/250 kt, with LIBVA/LAVTO at 2,500 ft+/200 kt; ALHUV1W and ALHUV1Y are ATC discretion only. SIDs: FL060 initial climb, LG003 6,500 ft+ and LG013 6,000 ft+, 220 kt on the turning legs.
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
- Upstream callsigns and frequencies: Beek Approach 123.980 is verified (EHBK AD 2.18, LVNL eAIP). Brussels Control 131.100 and Maastricht Radar 132.755 are not verified. The "Military" unit (129.100) is a sim construct; Belgian military en-route control is Steenokkerzeel ATCC. All of them now sit in one table, `UNITS` in `clearance.ts`.
- Border segments of TMA Three/Five and TSA28 are straight lines between the published border points.
- The 04R ILS initial from ALHUV via ABLAZ (2,500 ft), PIZVE (2,200 ft), KAQZI (IF 2,100 ft) is published but not modelled as a procedure (noted on the runway).
- Video map (river, roads, borders, towns) is drawn by hand.

## 6. Deviations found, and their status in 1.0

Severity: **High** = a rated controller would call it wrong in normal play. **Medium** = visible to a rated controller, rarely matters to the game. **Low** = cosmetic or edge case. Status is as of the 1.0 build.

| # | Deviation found | Real | Severity | Status in 1.0 |
|---|---|---|---|---|
| 1 | RECAT-EU categories: A320, A321, B738 were E; B752 was D | A320/A321/B738 are D; B752 is C (RECAT-EU Ed. 1.1 Table 2) | High | **Fixed** (`perf.ts`) |
| 2 | RECAT-EU table: C to E 3.5 NM; F to F missing | C to E 4 NM; F to F 3 NM | Medium | **Fixed** (`perf.ts`) |
| 3 | 2.5 NM on the same final inside 10 NM used everywhere | Doc 4444 8.7.3.2: only where the authority approves it. Not found in the EBLG AIP | Medium | **Fixed**: 3 NM unless the pack sets `meta.reducedFinalSep`; EBLG does not |
| 4 | Transition level computed from a formula | ENR 1.7 table; the formula was one FL low at QNH 995, 977, 959 | Medium | **Fixed**: the published table is used (`tlFromTable`) |
| 5 | SID initial climb FL060 at every QNH | FL070 when QNH is 995 hPa or below (AD 2.22) | Medium | **Fixed** |
| 6 | Transcript showed "descend 4,000 ft", "reduce speed 210 kt" | ICAO: "descend to altitude 4,000 ft", "reduce speed to 210 knots" | Medium | **Fixed**: transcript and speech both use ICAO wording |
| 7 | Hold entry always direct | Doc 8168 sectors: parallel, offset (teardrop), direct | Medium | **Fixed** (`pilot.ts` `holdEntry`, tested for every STAR) |
| 8 | Active TSA closed over its whole volume (5.3) | GAT in controlled airspace keeps it unless delegated | Medium | Open: deliberate, stricter than reality |
| 9 | Bank arrival rate up to 24-27 per hour | 2025 average about 32 movements per night; declared capacity 34-35 per hour | Medium | Open: deliberate compression, within declared capacity |
| 10 | VFR crossing squawks 70xx | 6330-6343 (ENR 1.6) | Low | **Fixed** |
| 11 | Glide path reference 50 ft for every runway | TCH 56/58/54/50 ft | Low | **Fixed** (`rwy.tch`) |
| 12 | Missed approach speed not applied | 215 kt to ALHUV at 3,000 ft | Low | **Fixed** (`missedSpd`, `missedAlt`) |
| 13 | Readback error rate 2-4 % | About 1 % (Cardosi 1996); higher at the body-clock low | Low | Open: training emphasis; fatigue raises it from 0030 to 0730 local time, worst 0200 to 0600 local |
| 14 | Runway occupancy 50 s for every type | Wide-body freighters about 55-70 s | Low | **Fixed**: 60 s for heavies, 50 s otherwise, 120 s in LVP |
| 15 | Almost no narrow-body freighters | B737F (ASL), A321P2F, ATR 72F also operate | Low | **Partly fixed**: ASL B738 added; ATR 72F not modelled |
| 16 | TSA29A could go active at night | Weekday daytime area by NOTAM | Low | **Fixed**: at night the event-deck card becomes a military crossing (1.0), and the free-play briefing path (military level 2) no longer activates it at night (after the independent validation) |
| 17 | Maastricht transfer callsign | Probably "Maastricht Radar" | Low | **Changed** to "Maastricht Radar", matching the pack's upstream list; still not verified |

Still approximate after 1.0: the minimum vectoring altitudes (the ATCSMAC chart could not be downloaded; areas follow the TMA floors and terrain), the delegation of the Brussels CTA above FL055 to Liège, upstream unit frequencies and callsigns, and the hand-drawn video map.

## 7. Engine measurements

All from headless runs (`Sim.step()` at 1 s, calm wind, QNH 1013). Not edited here.

| Check | Measured | Typical | Verdict |
|---|---|---|---|
| Climb 2,000-5,000 ft | B744 1,650; B748 1,650; MD11 1,860; B77L 2,020; A306 2,020; B763 2,310 fpm | Heavy freighters at 250 kt below FL100: 1,500-2,500 fpm | Realistic |
| Departure speed at 2,000 ft | 183-199 kt, 250 kt by 5,000 ft | Flap retraction and 250 kt by 3,000-5,000 ft | Realistic |
| Descent FL080 to 3,000 ft, 250 kt | about 1,250 fpm average, 2,000-2,200 peak, all types | Idle at 250 kt: 1,200-2,000 fpm; more with speedbrake | Realistic, a little uniform across types |
| Descent while slowing 250 to 210 kt | 1,060-1,140 fpm; slowing takes 110-142 s | A heavy cannot slow and descend steeply at once | Realistic |
| Turn rate | Bank limited to 25°, capped at 3°/s: 1.9°/s at 250 kt, 2.3°/s at 210 kt, 3°/s at 160 kt | Autopilot heading mode 25-30° bank | Realistic |
| LOC capture | The validator measured no overshoot at any angle, even 90°. Since the fix: none at 30°, 0.4 NM at 60°, 1.0 NM at 90° (B744, 180 kt) | Small overshoot at 45°, near zero at 30° | Fixed (section 9) |
| ILS speeds | 180 kt to 12 NM, 160 kt to about 4.5 NM, Vapp inside; stable gate 1,000 ft. A crew already slower never speeds up on the localizer without an instruction | Common European pattern (160 kt to 4 NM) | Realistic |
| Hold at ALHUV, 230 kt | Lap 292 s: 74 s turn, 60 s outbound, about 76 s turn, 82 s inbound | 1 min legs at 25° bank: about 290 s | Realistic timing; Doc 8168 entries since 1.0 |
| Go-arounds, autopilot on all challenges | 2 in 113 landings (17.7 per 1,000) | 1-4 per 1,000 approaches in normal operations | Driven by the autopilot player, not the pilot model |
| Wake and radar minima | 3 NM everywhere (2.5 NM only with unit approval), RECAT-EU table corrected | See rows 1-3 | Fixed in 1.0 |
| Runway occupancy | 50 s (120 s LVP) | See row 14 | Acceptable |
| Readback errors | 2-4 % per level/heading clearance | See row 13 | Higher than real, by design |
| Traffic, free play 120 min | Night template: 22 then 12 arrivals per hour, 6-7 departures. Shift: 27 then 7 arrivals; 13 departures in hour two | See row 9 | Busy-night peak, not an average night |
| TSA events after the outline change (autopilot) | Hot TSA: 2 before, 8 after. Five 04 shifts with military: 6 before, 11 after | | The autopilot does not route round the larger TSA29A |

## 8. Changes recommended by the validation (applied in 1.0 except items 11 and 17)

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

## 9. Independent validation (1.0)

A rated approach controller validated the 1.0 build independently, with headless measurement scripts and two played sessions (desktop free play, phone runway-change challenge). Their spot checks of the published data, 12 data groups (aerodrome, runways, ILS, frequencies, terminal fixes, STAR, transition and SID coding, final approach, restrictions, holds, airspace, transition level table), all matched the AIP. The engine items they marked wrong were fixed as below. `tests/realism1.test.ts` covers each fix.

| # | Found | Fix | Where |
|---|---|---|---|
| 1 | High. Departures launched 60 s apart whatever their wake category (B744 then A320: 60 s) | RECAT-EU departure time minima `DEP_S` (AB 100, AC 120, AD 140, AE 160, AF 180, BD 100, BE 120, BF 140, CD 80, CE 100, CF 120, DF 120, EF 100, FF 80 s; 60 s otherwise). Tower waits them out after a release; `departureGap()` and the release advice account for it ("Tower then waits 40 s for wake behind DH1") | `perf.ts` `DEP_S`, `depMinS`; `sim.ts` `depSpacingS`, `depWakeWait`; `suggest.ts` `releaseAdvice` |
| 2 | High. The transition chip said "#1 to land, nobody ahead" with an aircraft already on a transition ahead, and the chips then led to a loss of separation | Root cause: an arrival told to hold and then cleared for a transition or approach kept its hold instruction internally, so the sequence ignored it. A transition, an approach clearance, vectors or a direct now cancel the hold instruction, and the sequence counts every arrival cleared for the approach or on a transition first. Also: the transition chip looks 10 minutes ahead for conflicts (was 5); nobody is sent down a transition while another aircraft holds at the bottom of the ALHUV stack; the release advice holds a departure while an arrival is about to cross the field low | `sim.ts` `apply`; `sequence.ts` `sequenceMembers`, `TRANSITION_HORIZON_S`; `suggest.ts` |
| 3 | Medium. Wake separation only checked with both aircraft on the localizer | Also when the follower is directly behind: within 0.5 NM of the leader's track, tracks within 30°, same level or less than 1,000 ft below (Doc 4444 8.7.3, RECAT-EU). Event `wake` | `sim.ts` `monitor` |
| 4 | Medium. On the localizer without a speed instruction, an A320 at 160 kt accelerated to 180 kt at 10 NM | The crew never speeds up on the localizer unprompted: 180 kt by 12 NM and 160 kt by 7 NM are upper limits | `pilot.ts` `speedTarget`; `sequence.ts` `etaS` |
| 5 | Medium. Speed chips flipped between 170 and 180 kt every 15 s | No speed chip within 10 kt of the present speed or assignment, and none for 90 s after a speed instruction unless the gap is still closing well below the minimum | `suggest.ts` |
| 6 | Medium. Hold chips at FL060 and above for ALHUV (published top FL050); a hold offered again to an aircraft already told to hold | Hold chips stay inside the published band ("Hold ALHUV · 5000"). When ALHUV is full the chip offers GIREL or GSY at a level inside their bands (never into an active or announced TSA), or minimum clean speed. No second hold instruction: an aircraft cleared to hold above the top is offered "Descend" into the stack | `suggest.ts` `stackLevels`, `remoteHold`, `stackDescend` |
| 7 | Medium. "expect approach clearance at", holds re-issued to update the time, pilot "EFC time" | ICAO wording "expected approach time 0214". A revised time is its own instruction, item `eat`: "revised expected approach time 0225", offered only when the time moves by 5 minutes or more. When the time runs out the crew says "approach time expired, request onward clearance". For an aircraft already holding, the time counts only those below it in the stack | `clearance.ts`; `sim.ts` `efcFor`; `suggest.ts` |
| 8 | Medium. Brussels asked for early transfers at FL100 to FL120, above the sector ceiling (FL095) | Early transfers come at FL090 at most: "he's maintaining FL090, can you take him?" | `sim.ts` `earlyLevel` |
| 9 | Medium. 250 kt below FL100 penalised in class C | ENR 1.4: no IFR speed limit in class C. The event and the warning now apply only in class D (the CTR), outside controlled airspace, or to VFR flights. STAR speed constraints are unchanged | `sim.ts` `airspaceClassAt`, `speedLimitAt` |
| 10 | Medium. A typed answer to a Brussels request did nothing before the aircraft existed | The engine validates and accepts approve / unable for a pending coordination request, a release or a MIL crossing with no aircraft yet (`sim.isIntercomAnswer`). The typed path in the UI needs the matching change | `sim.ts` |
| 11 | Low/medium. No localizer overshoot even at 90°; no warning for an intercept inside the FAF | The capture overshoot grows with the angle beyond 35° and with speed (none at 30°, 0.4 NM at 60°, 1.0 NM at 90° at 180 kt). New warning "Intercept inside the FAF" when the heading meets the final course inside the final approach fix | `pilot.ts` `locOvershootNm`; `sim.ts` `validate` |
| 12 | Low. TSA29A at night in free-play briefings | The daytime-only rule (0600 to 2000 UTC) also applies to the free-play military level 2 activation | `traffic.ts` `tsaDaytime` |
| 13 | Low. Fatigue followed UTC | Local time (UTC+1 by default, `sc.utcOffsetH` for summer time): full from 0200 to 0600 local | `sim.ts` `fatigue` |
| 14 | Low. The runway-change challenge switched without notice | Ten minutes of notice: announced at 04:01, made at 04:11 | `scenarios.ts` |
| 15 | Low. Unit names and frequencies inconsistent | One table, `UNITS`; Beek 123.980 from the EHBK AIP; "Maastricht Radar"; the military transfer chip is labelled "Military" | `clearance.ts`, `suggest.ts` |
| 16 | Low. Departure check-in "passing two thousand climbing" | "passing two thousand three hundred feet climbing flight level six zero" | `sim.ts` |

### Chip-only player, before and after

`tests/chiprun.test.ts` with `SURVEY=1` (`SEEDS_N` and `ADVICE_ONLY` for longer runs): a player who only taps the primary suggestion chip, one-hour night shifts. Counts are distinct aircraft pairs.

| Run | Before (1.0) | After |
|---|---|---|
| 10 shifts, blind releases | 43 losses of separation, 1 wake, 105 landed | 36 losses, 6 wake, 99 landed |
| 10 shifts, release advice | 34 losses, 1 wake, 107 landed | 28 losses, 5 wake, 100 landed |
| 30 shifts, release advice | 112 losses, 8 wake, 332 landed | 97 losses, 17 wake, 291 landed |

The wake count rose because wake behind another aircraft off the localizer is now detected at all (item 3). Fewer landings: holds stay inside their published band, Tower waits for departure wake, and departures wait while arrivals cross the field low.

### Still open after the validation

- The chips still lead a tap-only player into some losses of separation. The main remaining causes: a go-around flying the missed approach to ALHUV at 3,000 ft into traffic starting a transition there; the turn of about 155° at ALHUV onto ALHUV1B (traffic from LNO), which brings the aircraft within about 3 NM and 900 ft of traffic at 4 to 6 NM on final; merges at LIBVA between a transition and an aircraft vectored onto the localizer; Brussels handing over two arrivals at the same level on STARs that join at GILOM.
- The early-transfer level and the FL095 sector ceiling rest on the assumed delegation of the Brussels CTA (5.2).
- Brussels Control and Maastricht Radar frequencies, and the military unit, are not verified.
