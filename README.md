# Liège Approach

An approach and departure radar simulator for Liège (EBLG). It runs as an installable web app on phone, iPad and desktop. You work Liège Approach on 119.280 with real Belgian AIP procedures, freighter-heavy traffic, military and transient traffic, 18 graded challenges, and an assessment scored against the ICAO controller competency units.

Not a training device. Flights are fictional. Some airspace is approximate (listed in `src/pack/eblg.ts`).

## Run it

```bash
npm install
npm run dev          # local dev server
npm test             # 45 tests, including a fly-through of every STAR, transition, ILS and SID
npm run build        # PWA build in dist/ (what Vercel deploys)
npm run build:single # one self-contained HTML file in dist-single/
```

## Deploy on Vercel

1. Push this repo to GitHub (private).
2. In Vercel: **Add New → Project → Import** the repo. Framework preset: Vite. No settings to change; `vercel.json` sets the build.
3. Open the URL on the phone or iPad and use **Share → Add to Home Screen** (Safari) or **Install app** (Chrome). It opens full screen and works offline after the first visit.

`api/metar.ts` is a Vercel function that fetches the live EBLG METAR for the "Live METAR" weather option. Everything else is static. Every response sends `X-Robots-Tag: noindex`; keep the repo private and treat the URL as private, because the packs contain transcribed AIP data.

## How it is built

```
src/
  pack/        location packs: eblg.ts (data), types.ts (schema), load.ts (projection, compile)
  engine/      sim.ts (clock, comms, clearances, monitors), pilot.ts (flight model and pilot logic),
               perf.ts (per-type envelopes, RECAT-EU), traffic.ts (free play), scenarios.ts (18 challenges),
               assess.ts (safety gate, ICAO ratings, metrics), parser.ts (shorthand and voice), weather.ts
  ui/          scope.ts (canvas radar + SKIN colours), game.ts (bar, pickers, panels, loop), menu.ts, audio.ts
api/metar.ts   live METAR proxy
tests/         pack checks, procedure fly-through, determinism/replay, parser
```

- The sim is deterministic: a seed plus the command log reproduces a session exactly, which is what "Replay from here" uses.
- All scope colours live in `SKIN` in `src/ui/scope.ts`, so the display can be tuned to match the real skeyes screen.
- Pilots use a plain level clearance the ICAO way: it cancels published altitude restrictions, while speed restrictions stay.

## Adding an airport

Write a new `PackSpec` (copy `src/pack/eblg.ts`), transcribe fixes, runways, STARs, transitions, SIDs, holds and airspace from the AIP, then add a fly-through test for it. The engine reads only the pack. Charleroi (EBCI) is next; Munich (EDDM) needs parallel-runway support in the engine first.

## Controls

- **Select:** tap a track, label, strip or AMAN entry. `Tab` or **CALLS** jumps to the next pilot waiting.
- **Heading:** drag from the aircraft; release on a fix for a direct.
- **Level / speed / approach:** tap the matching line of the label, or use the buttons.
- **Typed:** `DHK7 L250 D40 S210 ILS` then Enter. `D40` = 4,000 ft, `C80` = FL080, `S160/4` = 160 kt until 4 DME, `DCT LIBVA`, `ALHUV1A`, `HOLD`, `TWR`, `BRU`, `Y`/`N` for requests.
- **Voice (experimental):** hold the mic button and speak standard phraseology. It fills the clearance bar for you to check before sending. Needs a browser with speech recognition (Safari, Chrome).
