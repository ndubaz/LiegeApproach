# Liège Approach

An approach and departure radar simulator for Liège (EBLG). It runs as an installable web app on phone, iPad and desktop. You work Liège Approach on 119.280: Belgian AIP procedures, a cargo hub's night banks, Tower release requests on the intercom, military crossings, emergencies, and a debrief graded against the ICAO controller competencies.

Not a training device. Flights are fictional. Some airspace is approximate (listed in `src/pack/eblg.ts`).

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
npm test           # 262 tests: procedures, engine, separation, scoring, suggestions, voice, career, every tutorial lesson
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
  pack/        location packs: eblg.ts (data), types.ts (schema), load.ts (projection, compile)
  engine/      sim.ts (clock, radio and intercom, clearances, releases, monitors)
               pilot.ts (flight model and pilot logic), perf.ts (per-type envelopes, RECAT-EU)
               predict.ts (side-effect-free look-ahead), suggest.ts + sequence.ts (next-call chips, landing slots)
               hints.ts (supervisor hints), traffic.ts (free play, night shift, daily shift)
               scenarios.ts (21 challenges), assess.ts (safety gate, grades, cause chains, competencies)
               parser.ts (shorthand and voice), clearance.ts (phraseology), weather.ts, autopilot.ts (demo and tests)
  ui/          scope.ts (canvas radar, SKIN colours), game.ts (orders bar, pickers, intercom, panels, loop)
               menu.ts + menu.css (home, briefing, debrief, logbook, help), tutorial.ts + tutorial.css (lessons, coach)
               attract.ts (live radar on the home screen), audio.ts, glossary.ts
api/metar.ts   live METAR proxy (Vercel function)
tests/         pack checks, fly-throughs, engine, game, suggestions, prediction, tutorial lessons
```

- The sim is deterministic. A seed plus the command log reproduces a session exactly, which is how "Replay from here" works.
- All scope colours live in `SKIN` in `src/ui/scope.ts`.
- Pilots treat a plain level clearance the ICAO way: it cancels published altitude restrictions, while speed restrictions stay.

## Adding an airport

Write a new `PackSpec` (copy `src/pack/eblg.ts`). Transcribe fixes, runways, STARs, transitions, SIDs, holds and airspace from the AIP, then add a fly-through test. The engine reads only the pack. Charleroi (EBCI) is next. Munich (EDDM) needs parallel-runway support in the engine first.

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

Shorthand: `D40` descend 4,000 ft, `C80` climb FL080, `S160/4` 160 kt until 4 NM, `DCT LIBVA`, `ALHUV1A`, `HOLD`, `TWR`, `BRU`, `MIL`, `BRK` cancel approach, `ATIS`, `Y`/`N` for requests. A clearance with a warning needs a second Enter or a second tap on TRANSMIT.

Voice (experimental): hold the mic button and speak standard phraseology. It fills the clearance bar for you to check before sending. It needs a browser with speech recognition (Safari, Chrome).
