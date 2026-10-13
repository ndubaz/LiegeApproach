import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-sans-condensed/latin-400.css';
import '@fontsource/ibm-plex-sans-condensed/latin-500.css';
import '@fontsource/ibm-plex-sans-condensed/latin-600.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { loadPack } from './pack/load';
import { EBLG } from './pack/eblg';
import { CHALLENGES } from './engine/scenarios';
import { dailyShift, freePlay, type FreePlayOpts } from './engine/traffic';
import { track } from './engine/assess';
import { autoControl } from './engine/autopilot';
import type { Sim } from './engine/sim';
import type { Scenario } from './engine/types';
import type { Clearance } from './engine/clearance';
import { Game, type GameOpts } from './ui/game';
import { Radio } from './ui/audio';
import { careerNow, loadSettings, nextDrillVariant, recordCheckride, saveDrillResult, saveRecord } from './store';
import {
  debriefData, renderBriefing, renderCareer, renderChallenges, renderDebrief, renderDrills, renderFree, renderHelp, renderHome, renderRecords, renderSettings, renderTutorial,
  startTrace, stopAttract, type DebriefExtra, type MenuHandlers,
} from './ui/menu';
import { RANKS, attachExaminer, bestExpertAsync, checkrideById, chipControl, examinerVerdict, firstDivergence, reportInputOf, sampleTracks, supervisorReport, type ExamState } from './engine/career';
import { attachDrill, drillById, drillScenario, drillSolver, drillVerdict, parseDrillScenario } from './engine/drills';
import { GRADE_NAMES } from './engine/assess';
import type { GhostData } from './ui/poster';
import { LESSONS, coachFor } from './ui/tutorial';

if (!__SINGLE__ && 'serviceWorker' in navigator) registerSW({ immediate: true });

const pack = loadPack(EBLG);
const app = document.getElementById('app')!;
const radio = new Radio();
const settings = loadSettings();
let game: Game | undefined;
let lastScenario: Scenario | undefined;

async function liveMetar(): Promise<string | undefined> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch('/api/metar?ids=EBLG', { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return undefined;
    const j = await r.json();
    return typeof j.metar === 'string' ? j.metar : undefined;
  } catch { return undefined; }
}

const handlers: MenuHandlers & { startLesson(i: number): void } = {
  pack,
  settings,
  startLesson: (i: number) => lesson(i),
  liveMetar,
  startChallenge: (sc) => brief(sc, 'challenges'),
  startFree: (o: FreePlayOpts) => brief(freePlay(pack, o), 'free'),
  startDaily: () => brief(dailyShift(pack, new Date()), 'home'),
  startCheckride: (def) => brief(def.scenario, 'career'),
  startDrill: (id) => brief(drillScenario(pack, id, nextDrillVariant(id)), 'drills'),
};

/** Session hooks every Sim gets: assessment snapshots, the debrief timeline, 4 s track samples, and the examiner or drill script. */
function attachSession(sim: Sim, sc: Scenario) {
  track(sim);
  startTrace(sim);
  sampleTracks(sim, 4);
  const ride = checkrideById(sc.id);
  if (ride) attachExaminer(sim, ride);
  const dr = parseDrillScenario(sc.id);
  if (dr) attachDrill(sim, drillById(dr.id)!);
}

/** The expert's run over the same seed, for "Watch the expert". Challenges, checkrides and drills only. */
function ghostFor(sc: Scenario, sim: Sim, playerGrade: string): (() => Promise<GhostData>) | undefined {
  const ride = checkrideById(sc.id);
  const dr = parseDrillScenario(sc.id);
  const isChallenge = CHALLENGES.some((c) => c.id === sc.id);
  if (!ride && !dr && !isChallenge) return undefined;
  const playerTracks = sampleTracks(sim);
  const playerCmds = sim.cmdLog.slice();
  const rw = sim.rwy;
  let cached: Promise<GhostData> | undefined;
  return () => cached ??= (async () => {
    const attach = (s: Sim) => { if (ride) attachExaminer(s, ride); if (dr) attachDrill(s, drillById(dr.id)!); };
    const ctrls = dr ? { solution: drillSolver(drillById(dr.id)!) } : undefined;
    const ex = await bestExpertAsync(pack, sc, attach, ctrls);
    const div = firstDivergence({ cmds: playerCmds, tracks: playerTracks }, { cmds: ex.cmds, tracks: ex.tracks }, { crs: rw.crs, magVar: pack.meta.magVar });
    const dv = dr ? drillVerdict(ex.sim) : undefined;
    return {
      player: playerTracks, expert: ex.tracks, div, startUtc: sc.startUtc, runway: sim.runway, playerGrade,
      expertGrade: dv ? (dv.pass ? `score ${dv.score}` : 'not passed') : GRADE_NAMES[ex.result.grade],
    };
  })();
}

/** The handover sheet before every session; "Take the position" starts it. */
function brief(sc: Scenario, back: string) {
  game?.destroy(); game = undefined;
  stopAttract();
  document.body.classList.remove('in-game');
  renderBriefing(app, pack, sc, { start: () => play(sc), back: () => go(back) });
  window.scrollTo(0, 0);
}

function go(screen: string) {
  game?.destroy(); game = undefined;
  stopAttract();
  document.body.classList.remove('in-game');
  const map: Record<string, () => void> = {
    home: () => renderHome(app, handlers), free: () => renderFree(app, handlers), challenges: () => renderChallenges(app, handlers),
    records: () => renderRecords(app, handlers), tutorial: () => renderTutorial(app, handlers), settings: () => renderSettings(app, handlers), help: () => renderHelp(app), daily: () => handlers.startDaily!(),
    career: () => renderCareer(app, handlers), drills: () => renderDrills(app, handlers),
  };
  (map[screen] ?? map.home)();
  window.scrollTo(0, 0);
}

function lesson(i: number) {
  const l = LESSONS[i];
  play(l.scenario, undefined, coachFor(l, {
    next: i < LESSONS.length - 1 ? () => lesson(i + 1) : undefined,
    exit: () => go('tutorial'),
    restart: () => lesson(i),
  }));
}

function play(sc: Scenario, replay?: { cmds: { t: number; cl: Clearance }[]; until: number }, coach?: ReturnType<typeof coachFor>) {
  radio.unlock();
  stopAttract();
  lastScenario = sc;
  game?.destroy();
  document.body.classList.add('in-game');
  /** Called by Game as soon as its Sim exists (before a replay fast-forwards), if Game supports it. */
  const onSim = (sim: Sim) => attachSession(sim, sc);
  const opts: GameOpts = {
    replay,
    coach,
    onSim,
    onQuit: () => go('home'),
    onEnd: (r, sim) => {
      const data = debriefData(sim);
      const ride = checkrideById(sc.id);
      const dr = parseDrillScenario(sc.id);
      const rankBefore = careerNow().index;
      if (!replay) saveRecord(r, {
        moves: sim.landings.length + sim.departuresHandled,
        departures: sim.departuresHandled,
        emergencies: sim.emergencies.map((e) => ({ cs: e.cs, type: e.type, landed: e.landedT !== undefined })),
        seconds: sim.t,
        counts: !sc.tutorial && !dr,
      });
      const extra: DebriefExtra = { pack };
      if (ride) {
        const verdict = examinerVerdict(sim, ride, r, (sim as any)._exam as ExamState | undefined);
        if (!replay) recordCheckride(ride.id, verdict.pass, verdict.score);
        const after = careerNow().index;
        extra.checkride = { title: ride.title, verdict, promotedTo: !replay && after > rankBefore ? RANKS[after] : undefined };
      }
      if (dr) {
        const def = drillById(dr.id)!;
        const verdict = drillVerdict(sim)!;
        const saved = replay ? undefined : saveDrillResult(dr.id, dr.variant, verdict);
        extra.drill = {
          title: def.title, verdict, timeLabel: def.timeLabel, best: saved?.record, newScore: saved?.newScore && !!saved.prev?.passes, newTime: saved?.newTime && !!saved.prev?.passes,
          again: () => handlers.startDrill!(dr.id), list: () => go('drills'),
        };
      }
      if (!sc.tutorial) {
        const rank = careerNow();
        extra.supervisor = {
          rank: `To: ${rank.name === 'OJT' ? 'OJT trainee' : rank.name}`,
          lines: supervisorReport(reportInputOf(r, rank.index, {
            departures: sim.departuresHandled,
            emergencies: sim.emergencies.map((e) => ({ cs: e.cs, landed: e.landedT !== undefined })),
            endedEarly: sim.endReason === 'manual' && !dr && sim.t < sim.durationS * 0.6,
            checkride: extra.checkride ? { pass: extra.checkride.verdict.pass } : undefined,
            drill: extra.drill ? { pass: extra.drill.verdict.pass, score: extra.drill.verdict.score, title: extra.drill.title } : undefined,
          })),
        };
        extra.ghost = ghostFor(sc, sim, extra.drill ? (extra.drill.verdict.pass ? `score ${extra.drill.verdict.score}` : 'not passed') : GRADE_NAMES[r.grade]);
        const now = new Date();
        extra.poster = {
          tracks: sampleTracks(sim),
          meta: {
            title: sc.title.replace(/^Free play · /, ''), kind: ride ? 'Checkride' : dr ? 'Drill' : sc.id.startsWith('daily-') ? 'Daily shift' : sc.freePlay ? 'Free play' : 'Challenge',
            dateText: `${now.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()]} ${now.getFullYear()}`,
            utcSpan: `${sim.utc(0).slice(0, 5)}–${sim.utc().slice(0, 5)}`, landed: sim.landings.length, departures: sim.departuresHandled, moves: sim.landings.length + sim.departuresHandled,
            runway: sim.runway, grade: GRADE_NAMES[r.grade], rank: rank.name, seed: sc.seed,
          },
        };
      }
      const cmds = sim.cmdLog.slice();
      game = undefined;
      document.body.classList.remove('in-game');
      renderDebrief(app, r, {
        replay: (t) => play(sc, { cmds: cmds.filter((c) => c.t < t), until: t }),
        retry: () => brief(sc.freePlay ? { ...sc } : sc, 'home'),
        home: () => go('home'),
        next: r.suggested && !dr ? () => { const n = CHALLENGES.find((c) => c.id === r.suggested); if (n) brief(n, 'challenges'); } : undefined,
      }, data, extra);
      window.scrollTo(0, 0);
    },
  };
  game = new Game(pack, sc, settings, app, radio, opts);
}

app.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
  if (b) go(b.dataset.go!);
});

document.fonts?.ready.then(() => game?.scope.draw(performance.now()));
go('home');
(window as any).__lgg = { pack, get game() { return game; }, play, brief, autoControl, lesson, LESSONS, CHALLENGES, lastScenario: () => lastScenario, go, handlers, dev: { drillSolver, drillById, chipControl } };
