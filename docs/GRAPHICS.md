# The scope in 2.0

What the 1.0 radar display got right, what a real approach display does that it did not, what a game needs that a real display does not, and what the 2.0 scope (`src/ui/scope.ts`, `src/ui/skins.ts`, `src/ui/scope.css`) changed. Measurements are at the end.

## Critique of the 1.0 scope

Screenshots of the night bank at the four sizes are in the review folder (`before-night-*.png`, `before-day-*.png`). The 1.0 picture was already a working position: white assumed tracks, green inbounds, amber for the next caller, red for safety only, a cached video map, predicted tracks, FTDi chevrons and a gap ruler. Set beside a modern approach display it still fell short in these ways.

**What a real display does that 1.0 did not**

- *Thales TopSky, Indra iTEC, Frequentis PRISMA, Eurocat, skeyes CANAC 2 at Liège, DFS Phoenix and iCAS at Langen* all draw the video map in weight classes: borders and coastlines above rivers, rivers above motorways, towns in two or three sizes, other aerodromes as small symbols with their code. 1.0 drew one weight for roads, one for the river, and every town the same.
- They label MVA/MRVA cells with the altitude in the cell's corner, not at the centroid, so the figure sits where the eye enters the cell and never under a track.
- They draw holds as racetracks with the inbound track printed, and procedures as faint spines that are named at the entry fix rather than along the longest leg.
- Reserved areas (TSA, TRA, ED-R) show three states: active, pending activation, inactive. 1.0 knew two.
- The weather overlay is a radar precipitation picture in a small number of intensity bands that moves with the cells, not a texture with a motion arrow. Low visibility has no symbol on a real scope; the field itself looks the same. A game can afford a hint.
- Position symbols on CANAC 2 and TopSky are small, with a history of four to seven past plots fading behind them (speed-proportional spacing follows from the fixed update rate) and a vector of a settable number of minutes. 1.0 had the dots but at one alpha ramp and one size.
- Labels on a real display are placed by a solver with a leader line that stays short, never covers another position symbol, and keeps its place from frame to frame. Priorities are explicit: the aircraft under the cursor, STCA pairs and callers win. 1.0's solver was close but could cover a symbol under load and let leaders cross.
- A level filter (a vertical band) and a settable range-ring step are standard working-position controls; 1.0 had neither.
- A QDM/range readout for the cursor position and a range-and-bearing line are standard tools; 1.0 had the RBL, not the readout.
- Day and night colour sets with the information hierarchy preserved. 1.0's day set was a dimmed night set and did not have the contrast a tablet in sunlight needs.

**What a game needs that a real display does not**

- Smooth motion. A real plot jumps every 4 s and the controller's brain fills the gaps. A game on a phone looks broken that way. Interpolating the symbol between the previous and the current plot, over the observed update interval, keeps the data honest (nothing is shown before it exists) while the picture moves. The latest plot stays visible as a faint ghost while the symbol catches up, so the lag is never hidden.
- Touch targets, the armed label with chips for the selected aircraft, ladders, the radial menu, the heading drag with its predicted turn, and the "next caller" box. None of these exist on a real position; they replace the keyboard, the mouse and the strip bay.
- Declutter for small screens: two-line labels, fewer map names, no rank-3 towns, no procedure names.
- A replay of the last minute of a track for a debrief, and ghost predictions of where traffic will be, which a real position does not draw for every aircraft.
- Skins for taste rather than for the room: the amber CRT homage is a game feature.

## What changed in 2.0

**Skins** (`src/ui/skins.ts`): `night`, `day` and `amber`, all with the same keys and the same hierarchy (red safety only, amber act-now, cyan selection, white assumed, green inbound, grey transferred, map dimmest). Day is a light ground with dark ink for daylight tablets. Amber is a single-phosphor look where brightness carries the hierarchy and red stays for safety. `SKIN` is still exported from `scope.ts` for the help page. The scope puts `data-skin` on the canvas wrapper, which `scope.css` uses for the ground colour and the overlay controls.

**Video map** (`renderMap`, cached offscreen and redrawn only when the view or the map state changes): terrain contours, spot heights and region names from the pack's `terrain`; towns from the pack's `places` with ranks (1 always, 2 from 42 NM range, 3 when zoomed in); other aerodromes from `airports` (circle and runway bar, a second ring for military, the ICAO code beside it); lines ordered motorway, river, rail, border, coast with their own weights and names at zoom; TMA and CTR with class-specific fills and the CTR named in its corner; TMA sub-areas on their published hours; reserved areas in three states (active hatched, pending dashed in the active colour, off faint); MVA cells with the altitude in the top-left corner; procedures as faint spines named at the first fix (SIDs at their exit fix) with a cap of two names and a count; holds as racetracks with an arrow and the inbound magnetic track; the active centreline with 1 NM ticks, longer every 5, a dim centreline for the other end; fixes in bold when they are the stack fix, the IF or the FAF; an LVP haze over the field when low visibility procedures are in force; range rings at 5, 10 or 20 NM. Nothing in the file names a Liège fix any more: the key fixes, the stack fix and the visible fix set come from the pack.

**Traffic**: history dots as a fading, thinning tail of up to seven plots (`trailLen`); the IFR square turns with the track; interpolation between plots with a faint latest-plot ghost (`smooth`); predicted vector per the speed-vector setting; level filter (`levelFilter`, feet) that dims traffic outside the band to a one-line label unless it is selected, calling, or in a conflict; conflict pairs with the closest-point marker, distance, vertical and time (at most six readouts on the picture, the safety-net list has them all); the label solver `solveLabel` with three candidate rings, a disqualifying cost for covering another symbol, a cost for crossing another label's leader, the own-vector quadrant, screen edges and reserved controls, and hysteresis.

**Weather**: the precipitation texture is banded into two intensities (moderate, heavy) and moves with the cells; the +10 minute ring and motion arrow stay. The sweep line is an option (`sweep`), one turn per radar update, off by default and off under `prefers-reduced-motion`.

**Tools**: the cursor readout (bearing and range from the aerodrome; hovering a fix adds the fix and, for the selected aircraft, its distance and time to it); quick measure is the existing RBL drag (right-drag with a mouse); `startReplay(cs)` runs the last 60 s of a track along its sampled trail in four seconds; `setRange(nm)` animates a range change; `cycleRingStep()` steps the rings.

**Performance**: the static map is an offscreen canvas; the dynamic pass avoids most per-frame allocation (reused scratch arrays for symbols and leaders, in-line projection in the hot loops); the phone canvas is capped at two device pixels per CSS pixel; predictions are spread over frames as before.

**Poster** (`src/ui/poster.ts`): the same video map language (terrain, line weights, airspace fills, ticks, ranked places, aerodromes), colours from the night skin, and the title block from the pack (`meta.icao`, `meta.appFreq`, `meta.appCallsign`) instead of Liège strings.

## Options and hooks for the UI

`scope.opts` (`ScopeOptions`, defaults in `DEFAULT_SCOPE_OPTIONS`): `skin`, `ringStep`, `showRings`, `sweep`, `smooth`, `trailLen`, `levelFilter`, `declutter`, `showWeather`, `cursorReadout`, `mapDetail`. Methods: `startReplay(cs)`, `stopReplay()`, `cycleRingStep()`, `setRange(nm)`. Events appended to `ScopeEvents`: `replayDone(cs)`, `rangeChanged(nm)`. All existing settings (label size, brightness, speed vector, MVA, procedures) keep working; `brightness` may now also be `'amber'` once the settings type allows it.

## Measurements

Headless Chromium (software rasteriser, no GPU), CDP `Performance.getMetrics` over 5 s after a 3.5 s warm-up, the full night bank advanced to its peak and topped up to 26 aircraft with three storm cells, MVA and procedures on, 8 to 24 simultaneous losses of separation on the picture (an abusive picture; "main thread busy" includes the software paint, "script" is the JavaScript share).

| Picture | 1.0 scope | 2.0 scope |
|---|---|---|
| 1920×1080, dpr 1, 26 aircraft, 3 cells | 59.4 fps, busy 54.9 %, script 18.5 %, worst frame 33 ms | 56.3 fps, busy 55.5 %, script 16.0 %, worst frame 83 ms |
| 390×844 phone, 26 aircraft, 3 cells | 59.7 fps (dpr 3), busy 73.2 %, script 15.6 %, worst frame 67 ms | 58.3 fps (dpr 2), busy 61.8 %, script 17.6 %, worst frame 67 ms |

`Scope.draw()` alone, measured in the page over 200 calls with 9 aircraft and one storm cell at 1920×1080: 1.0 scope 3.5 ms per frame, 2.0 scope 1.8 ms per frame (2.2 ms with interpolation, 1.4 ms with the weather off). Steady-state frame rate at 1920×1080 with 9 aircraft is 60 fps on both; the first three seconds after a scenario loads run slower while textures, caches and the JIT warm up.

The 25 % CPU phone target is met for the JavaScript share (about 17 % of a 5 s window including the sim and the panels) but not for total main-thread time in this headless software-rendered measurement, where paint dominates. On a real phone the canvas is composited on the GPU and the paint share is much smaller; this has not been measured on hardware.

## Unfinished

- The halo is large on a 320 px phone: it covers most of the scope while an aircraft is selected. Other labels move off it where they can.
- Precipitation moves with the storm cells but the cells themselves do not grow, split or decay.
- Hardware measurements on an iPad and a phone.
