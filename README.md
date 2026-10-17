# Liège Approach

An approach and departure radar simulator for Liège (EBLG) and, since 2.0, Düsseldorf (EDDL). It runs as an installable web app on phone, iPad and desktop. You work Liège Approach on 119.280 or Langen Radar on 128.555: AIP procedures, a cargo hub's night banks or a passenger airport's waves onto parallel runways, Tower release requests on the intercom, military crossings, emergencies, and a debrief graded against the ICAO controller competencies.

Not a training device. Flights are fictional. Some airspace is approximate (listed in `src/pack/eblg.ts` and `src/pack/eddl.ts`, and reviewed in `docs/REALISM.md` and `docs/REALISM-EDDL.md`).

## What is new in 2.0

- **Two airports on one engine.** Pick Liège or Düsseldorf on the home page (or in Settings). Everything the console says comes from the airport's location pack: the frequency, the callsign, the intercom units (Liège Tower, Brussels Control, the military; Düsseldorf Tower, Langen Radar's Bottrop sector, Frisbee Radar), the stack fix (ALHUV, BIKMU), the reserved areas (TSA, ED-R), the runways in use (Düsseldorf lands on the northern runway and departs on the southern when both are in use), the free-play templates and the weather presets. Records, careers, drills and the daily shift are kept per airport; the logbook is one book with an airport column. The lessons run at Liège for now and are listed as "Liège lessons" when Düsseldorf is selected. `docs/REALISM-EDDL.md` has the Düsseldorf sources and approximations.
- **A commands module built for the seconds a controller has.** The NEXT button is an attention queue (who needs what next, each row with its one-tap action); the selected aircraft wears a command halo on the scope (a level ladder, a speed ladder, the fixes that make sense, ILS, HOLD and the handoff keys, one tap sends, long press stages, two-second undo); the command line takes partial callsigns and short fix names (`81 >lib d70`); readbacks track inline on a card above the composer; clearances for several aircraft can be queued. Measured before and after in `docs/COMMANDS.md`.
- **A scope that reads like a modern display.** Three skins (night, day, amber), a weighted video map with terrain, towns, other aerodromes, airspace states and holds as racetracks, a label solver that keeps leaders short, history dots, interpolated motion between radar plots, a level filter, a settable ring step, a sweep line, a cursor readout and a trail replay of the last minute. `docs/GRAPHICS.md` has the critique, the changes and the frame-time measurements. The options live in Settings and under MORE on the console.
- **Voices for both airports.** Casting reads each pack's units and operators (German crews at Düsseldorf, Dutch and French on the Liège landline), and the sample calls in Settings follow the airport.

## What is in 1.0

- **A full working position.** On a wide screen (1400 px and up) the console lays out like a real sector: strip bay on the left (offered by Brussels, landing sequence you reorder by dragging, hold stack, departures), the radar in the middle, and AMAN, coordination, comms and a monitor with a large transmit key on the right. iPad gets the same panels as tabs; the phone keeps a drawer.
- **Radio voices.** Pilots and the other units speak with neural voices generated on the device and played through a simulated VHF radio: band-limited speech, carrier hiss that grows with distance, fading on weak signals, squelch tails. Each airline gets the accents its crews plausibly have (Indian and Arab voices for Qatar, American for FedEx, Irish for ASL Ireland, German for German operators), and every flight keeps its voice for the shift. The models download once (about 60 MB) and run offline; see `docs/VOICES.md`.
- **Voice and push to talk.** Hold Space, a foot pedal (learned in Settings) or the mic button, say the clearance, let go. If the recognizer is sure it sends; otherwise the shorthand waits in the command line for Enter. A correction key takes back a clearance within three seconds.
- **Coordination like the real room.** Brussels passes estimates and asks for early transfers, Tower requests departure releases, the military asks to cross, and intercom keys light up for TWR, BRU, MIL, BEEK, MUAC and the supervisor. A safety-net list shows STCA, loss of separation, Mode S level mismatch, MSAW and cleared-level deviations.
- **Orders in one tap.** Suggestion chips, heading dial and drag, level and speed ladders, radial menu, Roger and Standby, typed shorthand with live preview, ICAO phraseology in the transcript.
- **Career.** Ranks with checkrides and a retake rule, drills, challenges in four tiers, a daily shift with a streak, a cargo night shift in free play, ghost replay of your shift against an expert run, a shift poster, and save export and import.
- **Learning the job.** Eleven lessons in the real sim, each ending in an exam, plus supervisor hints and a glossary.
- **Validated realism.** A rated-controller review checked the data pack against the Belgian eAIP and flew the procedures. See `docs/REALISM.md` for what was checked, what was fixed in 1.0 and the remaining approximations.

## Run it

```bash
nvm use            # Node 20 (18.18 or newer works)
npm ci
npm run dev        # local dev server on http://localhost:5173
npm test           # 336 tests: both packs, engine, separation, scoring, suggestions, parser, voice, career, scope, commands, every tutorial lesson
npm run build      # type check + PWA build in dist/ (what Vercel deploys)
npm run preview    # serve dist/ locally
```

Other scripts:

| Script | What it does |
|---|---|
| `npm run typecheck` | TypeScript only |
| `npm run build:single` | one self-contained HTML file in `dist-single/` (used for the Claude artifact preview) |
| `npm run test:survey` | slow bot surveys of every challenge and the suggestion chips (about 1 minute) |
| `npm run walk` | phone walkthrough of every lesson through the real UI (needs `npm run preview -- --port 4371` running and a Chromium for Playwright) |

## Put it on GitHub

```bash
git remote add origin git@github.com:<you>/liege-approach.git
git push -u origin main
```

Keep the repository **private**: the location pack contains transcribed AIP data. CI (`.github/workflows/ci.yml`) runs the type check, the tests and the build on every push and pull request.

## Deploy on Vercel

1. In Vercel: **Add New → Project → Import** the GitHub repo. It detects Vite; `vercel.json` sets the install, build and output, so there is nothing to change.
2. Every push to `main` deploys to production; pull requests get preview URLs.
3. Open the URL on the phone or iPad and use **Share → Add to Home Screen** (Safari) or **Install app** (Chrome). It opens full screen and works offline after the first visit.

Notes:

- The voice models live in `public/voices/` (about 20 MB each) and are fetched by the voice worker on first use, not precached by the service worker. `vercel.json` sends cross-origin isolation headers (COOP/COEP) so the voice engine can use several CPU cores; anything loaded from another origin would now need CORS or CORP headers.
- `api/metar.ts` is the only serverless function. It fetches the live EBLG METAR for the "Live METAR" weather option. Everything else is static.
- Every response sends `X-Robots-Tag: noindex`. Treat the URL as private as well.
- The service worker (`sw.js`) is served with `no-cache`, so installed copies pick up new versions on the next launch. Hashed assets are cached for a year.
- Saved progress (settings, logbook, grades, tutorial results) lives in the browser's local storage on each device. It does not sync between devices, and clearing site data erases it.

## How it is built

```
src/
  pack/        location packs: eblg.ts and eddl.ts (data), types.ts (schema), load.ts (projection, compile), index.ts (the airports on offer)
  engine/      sim.ts (clock, radio and intercom, clearances, releases, monitors)
               pilot.ts (flight model and pilot logic), perf.ts (per-type envelopes, RECAT-EU)
               predict.ts (side-effect-free look-ahead), suggest.ts + sequence.ts (next-call chips, landing slots)
               hints.ts (supervisor hints), traffic.ts (free play, night shift, daily shift)
               scenarios.ts (21 challenges), assess.ts (safety gate, grades, cause chains, competencies)
               parser.ts (shorthand and voice), clearance.ts (phraseology), weather.ts, autopilot.ts (demo and tests)
  ui/          scope.ts + scope.css (canvas radar), skins.ts (the night, day and amber colour sets), game.ts (orders bar, pickers, intercom, panels, loop)
               commands/ (attention queue, halo, readback cards, staging, command line)
               menu.ts + menu.css (home with the airport switch, briefing, debrief, logbook, help), tutorial.ts + tutorial.css (lessons, coach)
               attract.ts (live radar on the home screen), audio.ts, glossary.ts (pack-aware), poster.ts
  voice/       radio-fx.ts (the VHF channel), casting.ts (voices by operator and unit), neural.ts, speech-text.ts
api/metar.ts   live METAR proxy (Vercel function)
tests/         pack checks, fly-throughs, engine, game, suggestions, prediction, tutorial lessons
```

- The sim is deterministic. A seed plus the command log reproduces a session exactly, which is how "Replay from here" works.
- All scope colours live in `src/ui/skins.ts`, one object per skin with the same keys; `SKIN` is re-exported from `src/ui/scope.ts` for the help page.
- Settings (`src/store.ts`) carry the scope options (`brightness` is the skin: night, day or amber; `ringStep`, `levelFilter`, `trailLen`, `sweep`, `smooth`) and the airport (`airport`). The console mirrors them onto `scope.opts` at start and after every change.
- Pilots treat a plain level clearance the ICAO way: it cancels published altitude restrictions, while speed restrictions stay.

## Adding an airport

Write a new `PackSpec` (copy `src/pack/eblg.ts`) and register it in `src/pack/index.ts` (`PACKS`). Transcribe fixes, runways, STARs, transitions, SIDs, holds and airspace from the AIP, then fill the 2.0 block: the intercom `units` (ids, roles, callsigns, frequencies, voices), `traffic` (operators, the demand curve or an hourly `demand` table with a curfew as 0, STAR and SID weights, transient-traffic patterns), `fixSay`, `stackFix`, `depXfl`, `utcOffsetWinter`, `reservedAreasName` and, for an airport that lands and departs on different runways at the same time, `runwayConfigs`. The engine reads only the pack: `tests/synthetic-pack.ts` is a complete two-runway example and `tests/multiairport.test.ts` runs it. Scripted challenges, checkrides and drills carry an `icao` and only show for their airport; free play and the daily shift work at any airport from its pack alone.

## Controls

| Action | Touch | Mouse and keyboard |
|---|---|---|
| Next caller | ☎ button | `Tab` |
| Select | tap a track, label, strip or AMAN entry | click |
| Suggested call | tap a chip; long-press to edit it first | click a chip |
| Heading | drag from the aircraft, or HDG → drag on the dial | same, or `←` `→` in 5° steps |
| Level / speed | slide the CFL or IAS chip on the selected label, or LVL / SPD | scroll on the chip, `↑` `↓`, or LVL / SPD |
| Anything else | long-press a track for the radial menu, or MORE | right-click a track |
| Answer a call | Roger / Standby | `R`, `SB` |
| Releases | the Tower card: Release, After, Hold | `CHG7302 REL`, `REL/QTR586`, `RH3` |
| Typed | ⌨ button | just type: `DHK7 L250 D40 S210 ILS`, then Enter |

Shorthand: `D40` descend 4,000 ft, `C80` climb FL080, `S160/4` 160 kt until 4 NM, `DCT LIBVA` or `>lib`, `ALHUV1A`, `HOLD` (the airport's stack fix), `TWR`, `BRU` or `ACC` or the unit's name (`LANGEN`), `MIL`, `BRK` cancel approach, `ATIS`, `Y`/`N` for requests, `Q` queues a clearance, Backspace undoes a send within two seconds. Digits alone pick the aircraft (`81` for QTR8125). A clearance with a warning needs a second Enter or a second tap on TRANSMIT.

## Version notes

- **2.0.0** Two airports (Liège, Düsseldorf), the commands module, the 2.0 scope and skins, pack-driven console text and glossary, per-airport records and careers, scope options in Settings and under MORE. Saved settings from 1.0 load unchanged; records without an airport are Liège's.
- **1.0.0** The Liège position with radio voices, career, drills, challenges, the daily shift and eleven lessons.

Voice (experimental): hold the mic button and speak standard phraseology. It fills the clearance bar for you to check before sending. It needs a browser with speech recognition (Safari, Chrome).
