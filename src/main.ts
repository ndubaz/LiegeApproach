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
import { freePlay, type FreePlayOpts } from './engine/traffic';
import type { Scenario } from './engine/types';
import type { Clearance } from './engine/clearance';
import { Game } from './ui/game';
import { Radio } from './ui/audio';
import { loadSettings, saveRecord } from './store';
import { renderChallenges, renderDebrief, renderFree, renderHelp, renderHome, renderRecords, renderSettings, type MenuHandlers } from './ui/menu';

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

const handlers: MenuHandlers = {
  settings,
  liveMetar,
  startChallenge: (sc) => play(sc),
  startFree: (o: FreePlayOpts) => play(freePlay(pack, o)),
};

function go(screen: string) {
  game?.destroy(); game = undefined;
  document.body.classList.remove('in-game');
  const map: Record<string, () => void> = {
    home: () => renderHome(app, handlers), free: () => renderFree(app, handlers), challenges: () => renderChallenges(app, handlers),
    records: () => renderRecords(app, handlers), settings: () => renderSettings(app, handlers), help: () => renderHelp(app),
  };
  (map[screen] ?? map.home)();
  window.scrollTo(0, 0);
}

function play(sc: Scenario, replay?: { cmds: { t: number; cl: Clearance }[]; until: number }) {
  radio.unlock();
  lastScenario = sc;
  game?.destroy();
  document.body.classList.add('in-game');
  game = new Game(pack, sc, settings, app, radio, {
    replay,
    onQuit: () => go('home'),
    onEnd: (r, sim) => {
      saveRecord(r);
      const cmds = sim.cmdLog.slice();
      game = undefined;
      document.body.classList.remove('in-game');
      renderDebrief(app, r, {
        replay: (t) => play(sc, { cmds: cmds.filter((c) => c.t < t), until: t }),
        retry: () => play(sc.freePlay ? { ...sc } : sc),
        home: () => go('home'),
        next: r.suggested ? () => { const n = CHALLENGES.find((c) => c.id === r.suggested); if (n) play(n); } : undefined,
      });
    },
  });
}

app.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
  if (b) go(b.dataset.go!);
});

document.fonts?.ready.then(() => game?.scope.draw(performance.now()));
go('home');
(window as any).__lgg = { pack, get game() { return game; }, play, CHALLENGES, lastScenario: () => lastScenario };
