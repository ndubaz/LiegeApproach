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
import { loadSettings, saveRecord } from './store';
import { debriefData, renderBriefing, renderChallenges, renderDebrief, renderFree, renderHelp, renderHome, renderRecords, renderSettings, renderTutorial, startTrace, stopAttract, type MenuHandlers } from './ui/menu';
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
};

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
  const onSim = (sim: Sim) => { track(sim); startTrace(sim); };
  const opts: GameOpts & { onSim?: (sim: Sim) => void } = {
    replay,
    coach,
    onSim,
    onQuit: () => go('home'),
    onEnd: (r, sim) => {
      const data = debriefData(sim);
      saveRecord(r, {
        moves: sim.landings.length + sim.departuresHandled,
        departures: sim.departuresHandled,
        emergencies: sim.emergencies.map((e) => ({ cs: e.cs, type: e.type, landed: e.landedT !== undefined })),
        seconds: replay ? Math.max(0, sim.t - replay.until) : sim.t,
        counts: !replay && !sc.tutorial,
      });
      const cmds = sim.cmdLog.slice();
      game = undefined;
      document.body.classList.remove('in-game');
      renderDebrief(app, r, {
        replay: (t) => play(sc, { cmds: cmds.filter((c) => c.t < t), until: t }),
        retry: () => brief(sc.freePlay ? { ...sc } : sc, 'home'),
        home: () => go('home'),
        next: r.suggested ? () => { const n = CHALLENGES.find((c) => c.id === r.suggested); if (n) brief(n, 'challenges'); } : undefined,
      }, data);
      window.scrollTo(0, 0);
    },
  };
  game = new Game(pack, sc, settings, app, radio, opts);
  onSim(game.sim);
}

app.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
  if (b) go(b.dataset.go!);
});

document.fonts?.ready.then(() => game?.scope.draw(performance.now()));
go('home');
(window as any).__lgg = { pack, get game() { return game; }, play, brief, autoControl, lesson, LESSONS, CHALLENGES, lastScenario: () => lastScenario };
