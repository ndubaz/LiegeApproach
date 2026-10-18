import { createPtt } from './ptt';
import './menu.css';
import { CHALLENGES, TIER_NAMES, challengesFor, tierName as tierNameFor, unlockedTiers } from '../engine/scenarios';
import type { Aircraft, Comp, Scenario, SimEvent } from '../engine/types';
import { dailyShift, templatesOf, utcPlus, type FreePlayOpts } from '../engine/traffic';
import { COMPS, COMP_NAMES, COMP_PLAIN, GRADE_NAMES, type Grade, type Result } from '../engine/assess';
import { Sim } from '../engine/sim';
import { parseMetar, presetMetar, selectConfig, windComponents } from '../engine/weather';
import { PERF, wakeMinNm, type Recat } from '../engine/perf';
import {
  LEVEL_FILTERS, RANKS, applySave, bestGrade, careerNow, currentSummary, dailyStatus, exportSave, levelFilterId, loadBest, loadCareer, loadDrills, loadLogbook, loadRecords, loadSettings,
  passedChallenges, saveFileName, saveSettings, storageAvailable, validateSave, type DrillRecord, type SaveFile, type Settings,
} from '../store';
import { RANK_LONG, checkrideById, checkridesFor, type CheckrideDef, type CheckrideVerdict, type TrackLog } from '../engine/career';
import { drillById, drillsFor, parseDrillScenario, type DrillId, type DrillVerdict } from '../engine/drills';
import { unitByRole, unitTable } from '../engine/clearance';
import { SKIN_NAMES } from './skins';
import { GhostViewer, downloadCanvas, downloadText, renderPoster, type GhostData, type PosterMeta } from './poster';
import { Attract } from './attract';
import { SKIN } from './scope';
import { GLOSSARY_GROUPS, glossaryFor } from './glossary';
import type { Radio } from './audio';
import { VOICE_MODELS, neuralSupported } from '../voice/neural';
import { STAGES, curriculumProgress, drillOfTheDay, lessonsFor, tutorialDone, tutorialResults } from './tutorial';
import type { Pack } from '../pack/load';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MenuHandlers {
  pack: Pack;
  startChallenge(sc: Scenario): void;
  startFree(o: FreePlayOpts): void;
  /** Today's daily shift. Optional so older callers keep working. */
  startDaily?(): void;
  /** Book a checkride (career screen). */
  startCheckride?(def: CheckrideDef): void;
  /** Fly the next variation of a drill. */
  startDrill?(id: DrillId): void;
  settings: Settings;
  liveMetar(): Promise<string | undefined>;
  /** The radio, for the voice download and the sample call. */
  radio?: Radio;
  /** 2.0: the airports on offer and the switch (the home page and Settings show them when present). */
  airports?: { icao: string; name: string; callsign: string; country?: string }[];
  setAirport?(icao: string, screen?: string): void;
  /** 2.0: the challenges written for the airport in use. */
  challenges?(): Scenario[];
}

// ---------------------------------------------------------------------------
// Airport identity on the home page and the briefing. Liège keeps its 1.0 words; another airport gets its own,
// or a line written from its pack.
interface HomeCopy { sub: string; fine: string; shift: string }
const HOME_COPY: Record<string, HomeCopy> = {
  EBLG: {
    sub: 'Work the approach radar at Liège Airport. Real Belgian AIP procedures, freighters around the clock, military traffic in the next sector.',
    fine: 'Not a training device. Procedures from the Belgian AIP; some airspace is approximate. Flights are fictional.',
    shift: 'A real Liège night: a quiet warm-up, the inbound bank, then the departure push and a tail. Random events along the way.',
  },
  EDDL: {
    sub: 'Work the arrival radar at Düsseldorf as Langen Radar. Real German AIP procedures, Eurowings and Condor waves onto the parallel runways, the Rhine below you and Köln next door.',
    fine: 'Not a training device. Procedures from the German AIP; some airspace is approximate. Flights are fictional.',
    shift: 'A real Düsseldorf day: the morning wave builds from six, the field stays full until the evening, and the curfew empties it. Random events along the way.',
  },
};
const COUNTRY_NAME: Record<string, string> = { BE: 'Belgian', DE: 'German', NL: 'Dutch', FR: 'French' };
function homeCopy(pack: Pack): HomeCopy {
  const own = HOME_COPY[pack.meta.icao];
  if (own) return own;
  const c = COUNTRY_NAME[pack.spec.country ?? ''] ?? 'national';
  return {
    sub: `Work the approach radar at ${pack.meta.name} as ${pack.meta.appCallsign}. Real ${c} AIP procedures.`,
    fine: `Not a training device. Procedures from the ${c} AIP; some airspace is approximate. Flights are fictional.`,
    shift: `A real ${pack.meta.name} shift: the traffic follows the airport's own day. Random events along the way.`,
  };
}
/** The centre's short name on the landline ("Brussels", "Langen"). */
const centreOf = (pack: Pack) => unitByRole(unitTable(pack), 'acc')?.say ?? 'the centre';
/** The airport switch on the home page: one tab per pack, the active one lit. */
function airportSwitch(hd: MenuHandlers): string {
  const list = hd.airports ?? [];
  if (list.length < 2) return '';
  return `<nav class="ap-switch" aria-label="Airport">${list.map((a) => `<button class="ap ${a.icao === hd.pack.meta.icao ? 'on' : ''}" data-ap="${esc(a.icao)}" aria-pressed="${a.icao === hd.pack.meta.icao}"><span class="mono">${esc(a.icao)}</span><b>${esc(a.name)}</b></button>`).join('')}</nav>`;
}
function wireAirportSwitch(root: HTMLElement, hd: MenuHandlers) {
  root.querySelectorAll<HTMLButtonElement>('[data-ap]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.ap !== hd.pack.meta.icao) hd.setAirport?.(b.dataset.ap!); }));
}

const shell = (inner: string, back = true, cls = '') => `
  <div class="menu ${cls}">
    <div class="menu-inner">
      ${back ? '<button class="back" data-go="home">‹ Back</button>' : ''}
      ${inner}
    </div>
  </div>`;

const GRADE_MARK: Record<Grade, string> = { fail: '–', pass: 'P', good: 'G', rated: 'R' };
const gradeChip = (g: Grade | undefined, big = false) =>
  g ? `<span class="gmark g-${g} ${big ? 'big' : ''}" title="${GRADE_NAMES[g]}"><b>${GRADE_MARK[g]}</b>${big ? `<i>${g === 'fail' ? 'Tried' : GRADE_NAMES[g]}</i>` : ''}</span>` : '';

let attract: Attract | undefined;
export function stopAttract() { attract?.destroy(); attract = undefined; }

// ===========================================================================
// Home: live attract radar behind a strip bay
export function renderHome(root: HTMLElement, hd: MenuHandlers) {
  stopAttract();
  const pack = hd.pack, icao = pack.meta.icao, copy = homeCopy(pack);
  const liege = icao === 'EBLG';
  const recs = loadRecords();
  const passed = passedChallenges();
  const tut = tutorialDone();
  const firstTime = tut.size === 0 && recs.length === 0;
  const now = new Date();
  const daily = dailyStatus(now);
  const career = careerNow();
  const rank = career;
  const drills = loadDrills();
  const DRILLS = drillsFor(icao);
  const CHALLENGES = hd.challenges?.() ?? challengesFor(icao);
  const rides = checkridesFor(icao);
  const drillsPlayed = DRILLS.filter((d) => drills[d.id]?.passes).length;
  const prom = career.promotion;
  const cLine = !rides.length ? `No checkrides at ${pack.meta.name} yet: the logbook still counts your shifts here` : !prom ? 'Top of the ladder. You run the room.' : prom.ready ? `Checkride for ${prom.to} is ready to book` : prom.retakeIn ? `Retake for ${prom.to} after ${prom.retakeIn} more shift${prom.retakeIn > 1 ? 's' : ''}` : `Next: ${prom.to}. ${prom.reqs.filter((r) => r.ok).length} of ${prom.reqs.length} requirements met`;
  const tpl = templatesOf(pack);
  const callsignLine = pack.meta.appCallsign === `${pack.meta.name} Approach` ? '' : `<span class="home-call">${esc(pack.meta.appCallsign)}</span>`;
  const strip = (go: string, kind: string, code: string, name: string, line: string, stat: string, statLabel: string, extra = '') => `
    <button class="bay-strip ${kind} ${extra}" data-go="${go}">
      <span class="bs-bay mono">${code}</span>
      <span class="bs-body"><b>${name}</b><span>${line}</span></span>
      <span class="bs-stat"><b class="mono">${stat}</b><small>${statLabel}</small></span>
    </button>`;
  const dLine = daily.today
    ? `Today: ${GRADE_NAMES[daily.today.grade].toLowerCase()}, ${daily.today.landed} landed. Same traffic for everyone.`
    : `${now.getDate()} ${MONTHS[now.getMonth()]}. Twenty-five minutes of ${liege ? 'cargo night' : `the ${pack.meta.name} day`}, the same for everyone today.`;
  root.innerHTML = `
  <div class="home">
    <canvas class="home-scope" aria-hidden="true"></canvas>
    <div class="home-shade"></div>
    <main class="home-main">
      <header class="home-id">
        ${airportSwitch(hd)}
        <p class="home-freq mono">${esc(pack.meta.appFreq)} ${callsignLine}<span class="home-rank">${rank.name}</span></p>
        <h1>${esc(pack.meta.name)}<br>Approach</h1>
        <p class="home-sub">${esc(copy.sub)}</p>
        <p class="home-live mono" data-e="live"></p>
      </header>
      <nav class="bay" aria-label="Main menu">
        ${strip('tutorial', 'tut', 'T', 'Learn the position', `${lessonsFor(pack.meta.icao).length} lessons at ${pack.meta.name} in three stages, from the scope to a full shift`, `${lessonsFor(pack.meta.icao).filter((l) => tut.has(l.id)).length}/${lessonsFor(pack.meta.icao).length}`, 'lessons', firstTime ? 'start' : '')}
        ${strip('daily', 'day', 'D', 'Daily shift', dLine, String(daily.streak), daily.streak === 1 ? 'day streak' : 'day streak', daily.today ? 'played' : '')}
        ${strip('free', 'arr', 'F', 'Free play', `${tpl.shift.title} or your own mix of hour, weather and military activity`, '∞', 'sessions')}
        ${strip('challenges', 'dep', 'C', 'Challenges', CHALLENGES.length ? `${CHALLENGES.length} scripted scenarios, ${liege ? 'one freighter to a compound emergency' : 'from a first arrival to the abnormal'}` : `No scripted scenarios at ${pack.meta.name} yet; free play and the daily shift run from the pack`, CHALLENGES.length ? `${passed.size}/${CHALLENGES.length}` : '0', 'passed')}
        ${strip('career', 'car', 'K', 'Career', cLine, rank.name, 'rank', prom?.ready ? 'ready' : '')}
        ${strip('drills', 'drl', 'X', 'Drills', DRILLS.length ? `Two-minute exercises: ${DRILLS.map((d) => d.title.toLowerCase()).slice(0, 5).join(', ')}` : `No drills at ${pack.meta.name} yet`, `${drillsPlayed}/${DRILLS.length}`, 'passed')}
        <div class="bay-row three">
          <button class="bay-strip mini rec" data-go="records"><span class="bs-bay mono">L</span><span class="bs-body"><b>Logbook</b><span>${recs.length} session${recs.length === 1 ? '' : 's'}, save file</span></span></button>
          <button class="bay-strip mini help" data-go="help"><span class="bs-bay mono">?</span><span class="bs-body"><b>Help</b><span>Controls and glossary</span></span></button>
          <button class="bay-strip mini set" data-go="settings"><span class="bs-bay mono">S</span><span class="bs-body"><b>Settings</b><span>Voices, labels, input</span></span></button>
        </div>
      </nav>
      <p class="fine">${esc(copy.fine)}</p>
    </main>
    <aside class="home-radio mono" data-e="radio" aria-live="off"></aside>
  </div>`;
  wireAirportSwitch(root, hd);
  const canvas = root.querySelector<HTMLCanvasElement>('.home-scope')!;
  const live = root.querySelector('[data-e="live"]')!;
  const radio = root.querySelector('[data-e="radio"]')!;
  try {
    attract = new Attract(hd.pack, canvas, hd.settings);
    const upd = () => {
      if (!attract) return;
      const sim = attract.sim, w = sim.weather;
      live.innerHTML = [`${sim.utc().slice(0, 5)}Z`, `RWY ${sim.runway}`, `WIND ${String(Math.round(((w.windDir - pack.meta.magVar + 360) % 360) / 10) * 10).padStart(3, '0')}/${w.windKt}`, `QNH ${w.qnh}`, `${sim.aircraft.filter((a) => a.state === 'assumed').length} ON FREQ`].map((x) => `<span>${x}</span>`).join('');
    };
    upd();
    const iv = window.setInterval(() => { if (!attract) { clearInterval(iv); return; } upd(); }, 1000);
    attract.onTx = (tx, sim) => {
      if (tx.from === 'SYS' || !tx.text || tx.channel === 'icom') return;
      const row = document.createElement('div');
      row.className = `hr ${tx.from === 'ATC' ? 'atc' : ''}`;
      row.innerHTML = `<span>${sim.utc(tx.t0).slice(0, 5)}</span><b>${tx.from === 'ATC' ? 'APP' : esc(tx.cs)}</b><em>${esc(tx.text.startsWith(`${pack.meta.appCallsign}, `) ? tx.text.slice(pack.meta.appCallsign.length + 2) : tx.text)}</em>`;
      radio.appendChild(row);
      while (radio.children.length > 4) radio.firstChild!.remove();
    };
  } catch { /* the menu works without the live radar */ }
}

export function renderTutorial(root: HTMLElement, hd: MenuHandlers & { startLesson(id: string | number, opts?: { toExam?: boolean }): void }) {
  const icao = hd.pack.meta.icao;
  const list = lessonsFor(icao);
  const done = tutorialDone();
  const res = tutorialResults();
  const prog = curriculumProgress(icao, res, done);
  let pick: ReturnType<typeof drillOfTheDay>;
  try { pick = drillOfTheDay(icao); } catch { pick = undefined; }
  const stat = (l: (typeof list)[number]) => {
    const r = res[l.id];
    if (r?.pass) return `<span class="tut-stars" aria-label="${r.stars ?? 1} of 3 stars">${'★'.repeat(r.stars ?? 1)}<i>${'★'.repeat(3 - (r.stars ?? 1))}</i></span><small>exam passed</small>`;
    if (done.has(l.id)) return `<b class="mono">✓</b><small>${l.exam ? 'exam to do' : 'done'}</small>`;
    return `<b class="mono">${l.minutes}</b><small>min</small>`;
  };
  let n = 0;
  const stages = STAGES.map((st) => {
    const ls = list.filter((l) => l.stage === st.id);
    if (!ls.length) return '';
    return `<section class="tut-stage"><h3>${esc(st.title)}</h3><p class="lede">${esc(st.blurb)}</p>
      <ol class="lessons" start="${n + 1}">
      ${ls.map((l) => { n++; return `<li><button class="bay-strip lesson ${res[l.id]?.pass ? 'done passed' : done.has(l.id) ? 'done' : ''} ${prog.next?.id === l.id ? 'next' : ''}" data-lesson="${esc(l.id)}">
        <span class="bs-bay mono">${n}</span>
        <span class="bs-body"><b>${esc(l.title)}</b><span>${esc(l.summary)}</span></span>
        <span class="bs-stat">${stat(l)}</span>
      </button></li>`; }).join('')}
      </ol></section>`;
  }).join('');
  root.innerHTML = shell(`
    <h2>Learn the position <small class="mono">${esc(icao)}</small></h2>
    <p class="lede">${list.length} lessons at ${esc(hd.pack.meta.name)}, in three stages, the way a real rating course runs: the picture and the console, the procedures, then judgement. The coach pauses the clock, points at the control or aircraft to use, and explains why. Each lesson ends with an exam without the coach; if it goes wrong you can watch the instructor fly it. Change airport on the home page for the other curriculum.</p>
    ${prog.passed ? `<p class="tut-sum mono">${prog.passed} of ${prog.total} exams passed · ${prog.stars} of ${prog.total * 3} stars</p>` : ''}
    ${pick ? `<button class="bay-strip lesson drill-day" data-lesson="${esc(pick.lesson.id)}" data-exam="1"><span class="bs-bay mono">D</span><span class="bs-body"><b>Drill of the day: ${esc(pick.lesson.title)}</b><span>${esc(pick.reason.join(' '))}</span></span><span class="bs-stat"><b class="mono">exam</b><small>only</small></span></button>` : ''}
    ${stages}`);
  root.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach((b) => b.addEventListener('click', () => hd.startLesson(b.dataset.lesson!, { toExam: !!b.dataset.exam })));
}

// ===========================================================================
// Free play setup
export function renderFree(root: HTMLElement, hd: MenuHandlers) {
  const pack = hd.pack, copy = homeCopy(pack), tpl = templatesOf(pack);
  const liege = pack.meta.icao === 'EBLG';
  // the runway each preset weather puts in use, as the engine will pick it
  const rwyOf = (kind: 'good' | 'windy-ne' | 'lvp' | 'storms') => { try { return selectConfig(pack, parseMetar(presetMetar(pack, kind))).land; } catch { return ''; } };
  const tplLine = (t: { arrPerHr: number; paxShare: number; start: string }, note = '') => `${t.arrPerHr} arr/h${note || (t.paxShare >= 0.5 ? ', passengers' : t.paxShare > 0 ? ', some passengers' : '')}, from ${t.start}Z`;
  const wind = (kind: 'windy-ne') => { try { const w = parseMetar(presetMetar(pack, kind)); return compass(w.windDir).replace(/-/, ' '); } catch { return 'NE'; } };
  const areas = pack.reservedAreasName;
  root.innerHTML = shell(`
    <h2>Free play</h2>
    <form class="form" data-e="free">
      <fieldset class="tpl"><legend>Shift</legend>
        <label class="wide"><input type="radio" name="template" value="shift" checked><span><b>${esc(tpl.shift.title)}</b><small>${esc(copy.shift)}</small></span></label>
        <label><input type="radio" name="template" value="night"><span>${esc(tpl.night.title)}<small>${esc(tplLine(tpl.night, liege ? '18 arr/h, steady' : ''))}</small></span></label>
        <label><input type="radio" name="template" value="day"><span>${esc(tpl.day.title)}<small>${esc(tplLine(tpl.day))}</small></span></label>
        <label><input type="radio" name="template" value="quiet"><span>${esc(tpl.quiet.title)}<small>${esc(tplLine(tpl.quiet))}</small></span></label>
      </fieldset>
      <fieldset><legend>Weather</legend>
        <label><input type="radio" name="weather" value="good" checked><span>Good, ${esc(rwyOf('good'))}</span></label>
        <label><input type="radio" name="weather" value="windy-ne"><span>Gusty ${esc(wind('windy-ne'))}, ${esc(rwyOf('windy-ne'))}</span></label>
        <label><input type="radio" name="weather" value="lvp"><span>Fog, LVP</span></label>
        <label><input type="radio" name="weather" value="storms"><span>Thunderstorms</span></label>
        <label><input type="radio" name="weather" value="live"><span>Live ${esc(pack.meta.icao)} METAR<small>needs a connection</small></span></label>
      </fieldset>
      <fieldset data-e="mil"><legend>Military and transient traffic <small>(the ${esc(tpl.shift.title.toLowerCase())} draws its own)</small></legend>
        <label><input type="radio" name="military" value="0"><span>None</span></label>
        <label><input type="radio" name="military" value="1" checked><span>Light<small>VFR crosser, HEMS</small></span></label>
        <label><input type="radio" name="military" value="2"><span>Busy<small>+ fighters, ${liege ? 'E-3A, ' : ''}${esc(areas)}</small></span></label>
        <label><input type="radio" name="military" value="3"><span>Heavy<small>+ ${liege ? 'C-17, flight check, A400M' : 'transports, flight check'}</small></span></label>
      </fieldset>
      <fieldset><legend>Session</legend>
        <label><input type="radio" name="duration" value="30"><span>30 min</span></label>
        <label><input type="radio" name="duration" value="45"><span>45 min</span></label>
        <label><input type="radio" name="duration" value="60" checked><span>60 min</span></label>
      </fieldset>
      <fieldset><legend>Difficulty <small>(wrong readbacks, similar callsigns)</small></legend>
        ${[1, 2, 3, 4, 5].map((d) => `<label><input type="radio" name="difficulty" value="${d}" ${d === 3 ? 'checked' : ''}><span>${d}</span></label>`).join('')}
      </fieldset>
      <label class="toggle"><input type="checkbox" name="emergencies"><span>Random emergency</span></label>
      <button class="primary" type="submit">Brief me</button>
      <p class="fine" data-e="status"></p>
    </form>
  `);
  const form = root.querySelector('form')!;
  const milSet = root.querySelector<HTMLElement>('[data-e="mil"]')!;
  const syncMil = () => milSet.classList.toggle('muted', new FormData(form).get('template') === 'shift');
  form.addEventListener('change', syncMil);
  syncMil();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const o: FreePlayOpts = {
      template: f.get('template') as any, weather: f.get('weather') as any, military: Number(f.get('military')) as any,
      durationMin: Number(f.get('duration')), difficulty: Number(f.get('difficulty')) as any, emergencies: f.get('emergencies') === 'on',
    };
    if (o.weather === 'live') {
      const st = root.querySelector('[data-e="status"]')!;
      st.textContent = `Fetching the current ${pack.meta.icao} METAR…`;
      o.liveMetar = await hd.liveMetar();
      if (!o.liveMetar) { st.textContent = 'No live METAR available here; using good weather instead.'; o.weather = 'good'; await new Promise((r) => setTimeout(r, 1200)); }
    }
    hd.startFree(o);
  });
}

// ===========================================================================
// Briefing: a printed position-handover sheet before every session

const WX: Record<string, string> = {
  FG: 'fog', BR: 'mist', RA: 'rain', '-RA': 'light rain', '+RA': 'heavy rain', SN: 'snow', TS: 'thunderstorms', TSRA: 'thunderstorms with rain', DZ: 'drizzle', SHRA: 'showers', BCFG: 'fog patches',
};
const plainVis = (m: number) => (m >= 9999 ? '10 km or more' : m >= 5000 ? `${Math.round(m / 1000)} km` : `${thousands(m)} m`);

export interface BriefingKind { kind: 'challenge' | 'free' | 'daily' | 'shift' | 'checkride' | 'drill' }

export function renderBriefing(root: HTMLElement, pack: Pack, sc: Scenario, hd: { start(): void; back(): void; kind?: BriefingKind['kind'] }) {
  let sim: Sim | undefined;
  try { sim = new Sim(pack, sc); } catch { /* briefing still works from the scenario alone */ }
  const w = sim?.weather;
  const rwyId = sim?.runway ?? sc.runway ?? pack.runwayConfigs[0]?.land ?? pack.preferredRunways[0];
  const centre = centreOf(pack);
  const rwy = pack.runways.get(rwyId);
  const kind = hd.kind ?? (sc.id.startsWith('daily-') ? 'daily' : sc.id.startsWith('checkride-') ? 'checkride' : sc.id.startsWith('drill-') ? 'drill' : sc.freePlay ? 'free' : 'challenge');
  const ride = kind === 'checkride' ? checkrideById(sc.id) : undefined;
  const drillP = kind === 'drill' ? parseDrillScenario(sc.id) : undefined;
  const drill = drillP ? drillById(drillP.id) : undefined;
  const drillRec = drillP ? loadDrills()[drillP.id] : undefined;

  // ---- weather in plain words
  const rows: [string, string, string][] = [];
  if (w) {
    const kt = Math.max(w.windKt, w.gustKt ?? 0);
    const c = rwy ? windComponents(rwy.crs, w.windDir, kt) : undefined;
    const comp = c ? (c.head >= 0 ? `${c.head} kt on the nose` : `${-c.head} kt tailwind`) + (Math.abs(c.cross) >= 3 ? `, ${Math.abs(c.cross)} kt across` : '') : '';
    rows.push(['Wind', `${String(Math.round(w.windDir / 10) * 10).padStart(3, '0')}° ${w.windKt} kt${w.gustKt ? ` G${w.gustKt}` : ''}`, `From the ${compass(w.windDir)} at ${w.windKt} knots${w.gustKt ? `, gusting ${w.gustKt}` : ''}. ${comp ? `On runway ${rwyId}: ${comp}.` : ''}`]);
    const wxTxt = w.wx ? (WX[w.wx] ?? w.wx.toLowerCase()) : '';
    rows.push(['Visibility', plainVis(w.visM) + (w.rvrM ? ` · RVR ${w.rvrM} m` : ''), `${w.visM >= 9999 ? 'Clear' : 'Visibility ' + plainVis(w.visM)}${wxTxt ? ` in ${wxTxt}` : ''}${w.rvrM ? `. Pilots see ${w.rvrM} m along the runway` : ''}.`]);
    rows.push(['Cloud', w.ceilingFt !== undefined ? `${thousands(w.ceilingFt)} ft` : 'No ceiling', w.ceilingFt !== undefined ? `Cloud base ${thousands(w.ceilingFt)} ft${w.cb ? ', with thunderstorm cells about' : ''}.` : `No low cloud${w.cb ? ', but thunderstorm cells about' : ''}.`]);
    rows.push(['QNH', `${w.qnh} hPa`, `Pass it to every arrival. Transition level FL${String(sim!.tl).padStart(3, '0')}, transition altitude ${thousands(pack.meta.transitionAltitude)} ft.`]);
  }
  const lvp = sim?.lvp;

  // ---- traffic expected
  const arr = sc.spawns.filter((s) => s.kind === 'arr');
  const dep = sc.spawns.filter((s) => s.kind === 'dep');
  const oth = sc.spawns.filter((s) => s.kind !== 'arr' && s.kind !== 'dep' && !s.silent);
  const types = new Map<string, number>();
  for (const s of [...arr, ...dep]) types.set(s.type, (types.get(s.type) ?? 0) + 1);
  const mix = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${PERF[t]?.name ?? t} ×${n}`).join(', ');
  const lastT = Math.max(60, ...sc.spawns.map((s) => s.t));
  const bin = lastT > 1800 ? 300 : 120;
  const nb = Math.ceil((lastT + 1) / bin);
  const ba = new Array(nb).fill(0), bd = new Array(nb).fill(0);
  for (const s of arr) ba[Math.floor(s.t / bin)]++;
  for (const s of dep) bd[Math.floor(s.t / bin)]++;
  const peak = Math.max(1, ...ba.map((v, i) => v + bd[i]));
  const demand = `<svg class="bf-demand" viewBox="0 0 ${nb * 10} 40" preserveAspectRatio="none" aria-hidden="true">${ba.map((v, i) => {
    const ha = (v / peak) * 38, hdp = (bd[i] / peak) * 38;
    return `<rect x="${i * 10 + 1}" y="${40 - ha}" width="8" height="${ha}" class="a"/><rect x="${i * 10 + 1}" y="${40 - ha - hdp}" width="8" height="${hdp}" class="d"/>`;
  }).join('')}</svg>`;
  const planned = sc.events.filter((e) => e.kind === 'tsa' && e.on || e.kind === 'flow').map((e) => e.kind === 'tsa' ? `${(e as any).name} active from ${utcPlus(sc.startUtc, e.t)}` : `${centre} flow from ${utcPlus(sc.startUtc, e.t)}: ${(e as any).mit} NM in trail via ${(e as any).exitFix}`);

  // ---- criteria
  const pc = sc.pass;
  const crit: string[] = [];
  if (pc) {
    crit.push('Pass the safety gate');
    if (pc.minLanded !== undefined) crit.push(`Land at least ${pc.minLanded}`);
    if (pc.allArrivalsHandled) crit.push('Land every arrival');
    if (pc.minDeparturesHandled !== undefined) crit.push(`Hand at least ${pc.minDeparturesHandled} departures to ${centre}`);
    if (pc.maxHoldMinPerArrival !== undefined) crit.push(`Under ${pc.maxHoldMinPerArrival} min holding per arrival on average`);
    if (pc.noMissedReadbacks) crit.push('Catch every wrong readback');
    if (pc.noTsa) crit.push('Nobody inside an active military area');
    if (pc.emergencyLandedWithinMin !== undefined) crit.push(`Emergency on the ground within ${pc.emergencyLandedWithinMin} min`);
    for (const [c, v] of Object.entries(pc.minRatings ?? {})) crit.push(`${COMP_PLAIN[c as Comp]} rated ${v} or better`);
  }
  const best = bestGrade(sc.id);
  const serial = String(sc.seed % 10000).padStart(4, '0');
  const kindName = { challenge: `Challenge · Tier ${sc.tier ?? 1} ${tierNameFor(sc.tier ?? 1, sc.icao ?? pack.meta.icao)}`, free: 'Free play', daily: 'Daily shift', shift: 'Free play · night shift', checkride: `Checkride · for ${RANKS[ride?.to ?? 1]}`, drill: `Drill · variation ${drillP?.variant ?? 1}` }[kind];
  const brief = sc.briefing ? `${sc.briefing}` : '';

  root.innerHTML = shell(`
    <article class="sheet" aria-label="Position handover">
      <header class="sh-head">
        <div class="sh-org mono">${esc(pack.meta.icao)} APP · ${esc(pack.meta.appFreq)}<br><span>POSITION HANDOVER</span></div>
        <div class="sh-no mono">No. ${serial}<br><span>${sc.startUtc}Z</span></div>
      </header>
      <p class="sh-kind mono">${esc(kindName)}</p>
      <h2 class="sh-title">${esc(sc.title.replace(/^Free play · /, ''))}</h2>
      ${best ? `<p class="sh-best">Your best on this one: ${gradeChip(best)} <b>${best === 'fail' ? 'not passed yet' : GRADE_NAMES[best]}</b></p>` : ''}
      <p class="sh-brief">${esc(sc.desc && !sc.freePlay ? sc.desc : brief)}</p>
      ${!sc.freePlay && brief ? `<p class="sh-sup"><span class="mono">SUP</span> ${esc(brief)}</p>` : ''}

      <section class="sh-sec">
        <h3>1 · Runway and weather</h3>
        <div class="sh-rwy"><div class="sh-rwybox mono"><small>RWY</small>${esc(rwyId)}</div><div class="sh-atis mono"><small>ATIS</small>${sim?.atis ?? '-'}</div>${lvp ? '<div class="sh-lvp mono">LVP<small>in force</small></div>' : ''}</div>
        <table class="sh-wx">${rows.map(([k, v, p]) => `<tr><th>${k}</th><td class="mono">${esc(v)}</td><td>${esc(p)}</td></tr>`).join('')}</table>
        <p class="sh-metar mono">${esc(sc.metar)}</p>
      </section>

      ${drill ? `<section class="sh-sec">
        <h3>2 · The exercise</h3>
        <p class="sh-goal">${esc(drill.goal)}</p>
        <div class="sh-counts">
          <div><b class="mono">${drillRec?.bestScore ? drillRec.bestScore : '–'}</b><span>best score</span></div>
          <div><b class="mono">${drillRec?.bestTime !== undefined ? fmtT(drillRec.bestTime).slice(1) : '–'}</b><span>best time ${esc(drill.timeLabel)}</span></div>
          <div><b class="mono">${drillRec?.plays ?? 0}</b><span>attempts</span></div>
        </div>
        <p class="sh-mix">Every attempt is a new variation. The drill ends itself as soon as the examiner can judge it.</p>
      </section>` : `<section class="sh-sec">
        <h3>2 · Traffic expected</h3>
        <div class="sh-counts">
          <div><b class="mono">${arr.length}</b><span>arrivals</span></div>
          <div><b class="mono">${dep.length}</b><span>departures</span></div>
          ${oth.length ? `<div><b class="mono">${oth.length}</b><span>military and other</span></div>` : ''}
          <div class="sh-span"><b class="mono">${utcPlus(sc.startUtc, 0)}–${utcPlus(sc.startUtc, lastT)}</b><span>traffic window</span></div>
        </div>
        <figure class="sh-fig">${demand}<figcaption><i class="k a"></i>arrivals <i class="k d"></i>departures, per ${bin / 60} min</figcaption></figure>
        ${mix ? `<p class="sh-mix">Mostly ${esc(mix)}.</p>` : ''}
        ${planned.length ? `<ul class="sh-list">${planned.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </section>`}

      ${sc.objectives?.length || crit.length ? `<section class="sh-sec">
        <h3>3 · ${crit.length ? 'To pass' : 'Objectives'}</h3>
        <ul class="sh-check">
          ${(sc.objectives ?? []).map((o) => `<li><i></i>${esc(o.text)} <span class="mono sh-by">by ${utcPlus(sc.startUtc, o.byT)}</span></li>`).join('')}
          ${crit.map((c) => `<li><i></i>${esc(c)}</li>`).join('')}
        </ul>
      </section>` : ''}

      ${ride ? `<section class="sh-sec">
        <h3>3 · The examiner</h3>
        <ul class="sh-check">
          <li><i></i>Pass the safety gate</li>
          <li><i></i>Session graded ${GRADE_NAMES[ride.minGrade]} or better</li>
          <li><i></i>Handle what the examiner puts in front of you. You will not be told what or when.</li>
        </ul>
        <p class="sh-mix">A failed checkride needs two more logged shifts before the retake.</p>
      </section>` : drill ? '' : `<section class="sh-sec">
        <h3>${sc.objectives?.length || crit.length ? 4 : 3} · Grades</h3>
        <div class="sh-grades">
          <div class="g-pass"><b>Pass</b><p>${pc ? 'Every item above, including the safety gate.' : 'The safety gate: no loss of separation beyond the tolerance and nobody below the minimum vectoring altitude.'}</p></div>
          <div class="g-good"><b>Good</b><p>Pass, plus landings within 1.0 NM of the minimum spacing (median) and under 1 minute holding per arrival.</p></div>
          <div class="g-rated"><b>Rated</b><p>Good, plus no conflict alerts at all, pilots answered within 5 seconds (median) and 60% continuous descents.</p></div>
        </div>
      </section>`}

      <footer class="sh-foot">
        <div><small>${ride ? 'Examiner' : 'Handed over by'}</small><span class="sh-sign">${ride ? 'Examiner' : drill ? 'Instructor' : 'Supervisor'}</span></div>
        <div><small>Taken over by</small><span class="sh-line"></span></div>
      </footer>
    </article>
    <div class="sh-actions">
      <button class="primary take" data-a="take">${drill ? 'Start the drill' : ride ? 'Start the checkride' : 'Take the position'}</button>
    </div>
  `, false, 'briefing');
  const backBtn = document.createElement('button');
  backBtn.className = 'back';
  backBtn.textContent = '‹ Back';
  backBtn.addEventListener('click', hd.back);
  root.querySelector('.menu-inner')!.prepend(backBtn);
  root.querySelector('[data-a="take"]')!.addEventListener('click', hd.start);
}

const compass = (deg: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// ===========================================================================
// Challenges
export function renderChallenges(root: HTMLElement, hd: MenuHandlers) {
  const pack = hd.pack;
  const CHALLENGES = hd.challenges?.() ?? challengesFor(pack.meta.icao);
  const passed = passedChallenges();
  const tiers = unlockedTiers(passed, hd.settings.unlockAll, CHALLENGES);
  const best = loadBest();
  const recs = loadRecords();
  const tierName = (t: number) => (TIER_NAMES[t] ?? '').replace(/^Liège\b/, pack.meta.name);
  if (!CHALLENGES.length) {
    root.innerHTML = shell(`<h2>Challenges</h2><p class="lede">No scripted challenges at ${esc(pack.meta.name)} yet. Free play and the daily shift run here from the pack, and the logbook counts them.</p><p class="lede"><button class="link" data-go="free">Free play ›</button></p>`);
    return;
  }
  const html = [1, 2, 3, 4].map((t) => {
    const open = tiers.has(t);
    const list = CHALLENGES.filter((c) => c.tier === t);
    const done = list.filter((c) => passed.has(c.id)).length;
    const cards = list.map((c) => {
      const tries = recs.filter((r) => r.scenarioId === c.id).length;
      const g = best[c.id];
      return `<button class="card ch ${g && g !== 'fail' ? 'passed' : ''} ${g ? 'g-' + g : ''}" data-ch="${c.id}" ${open ? '' : 'disabled'}>
        <span class="ch-top"><b>${esc(c.title)}</b>${gradeChip(g, true)}</span><span>${esc(c.desc)}</span>
        <em>${c.durationMin} min${tries ? ` · ${tries} attempt${tries > 1 ? 's' : ''}` : ''}</em></button>`;
    }).join('');
    const prev = CHALLENGES.filter((c) => c.tier === t - 1);
    const need = t > 1 ? `Pass every Tier ${t - 1} challenge to unlock (${prev.filter((c) => passed.has(c.id)).length}/${prev.length})` : '';
    if (!list.length) return '';
    return `<section class="tier ${open ? '' : 'locked'}"><h3><span>Tier ${t}</span> ${esc(tierName(t))} <small class="mono">${done}/${list.length}</small>${open ? '' : ` <small>· ${need}</small>`}</h3><div class="ch-grid">${cards}</div></section>`;
  }).join('');
  root.innerHTML = shell(`<h2>Challenges</h2><p class="lede ch-key">${(['pass', 'good', 'rated'] as Grade[]).map((g) => `${gradeChip(g)} ${GRADE_NAMES[g]}`).join('<span class="sep"></span>')}</p>${html}`);
  root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => hd.startChallenge(CHALLENGES.find((c) => c.id === b.dataset.ch)!)));
}

// ===========================================================================
// Records: the controller logbook
export function renderRecords(root: HTMLElement, hd: MenuHandlers) {
  const pack = hd.pack;
  const CHALLENGES = hd.challenges?.() ?? challengesFor(pack.meta.icao);
  const recs = loadRecords();
  const log = loadLogbook();
  const best = loadBest();
  const rank = careerNow(log, best);
  const hrs = log.seconds / 3600;
  const ladder = RANKS.map((r, i) => `<li class="${i < rank.index ? 'done' : i === rank.index ? 'now' : ''}"><i></i><span>${r}</span></li>`).join('');
  const stat = (v: string, l: string) => `<div class="lb-stat"><b class="mono">${v}</b><span>${l}</span></div>`;
  const last = recs.slice(-8);
  const spark = (c: Comp) => {
    const vals = last.map((r) => r.ratings[c]);
    const pts = vals.map((v, i) => (v === null || v === undefined ? null : `${(i / Math.max(1, vals.length - 1)) * 100},${30 - (v - 1) * 6.5}`)).filter(Boolean);
    const latest = [...vals].reverse().find((v) => v !== null && v !== undefined);
    return `<div class="trend-row"><span>${COMP_PLAIN[c]} <small class="mono">${c}</small></span><svg viewBox="-4 -4 108 38" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}"/></svg><b class="mono">${latest ?? 'n/a'}</b></div>`;
  };
  const avg = (c: Comp) => { const v = recs.slice(-5).map((r) => r.ratings[c]).filter((x): x is number => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 9; };
  const weakest = COMPS.filter((c) => avg(c) < 9).sort((a, b) => avg(a) - avg(b))[0];
  const sugg = [...recs].reverse().find((r) => r.suggested)?.suggested;
  const ch = CHALLENGES.find((c) => c.id === sugg);
  const evIcon: Record<string, string> = { emergency: '7700', rated: 'R', good: 'G', chain: 'SEQ', rank: '★' };
  const daily = dailyStatus();
  const tierTable = [1, 2, 3, 4].filter((t) => CHALLENGES.some((c) => c.tier === t)).map((t) => `<div class="lb-tier"><h4><span class="mono">T${t}</span> ${esc((TIER_NAMES[t] ?? '').replace(/^Liège\b/, pack.meta.name))}</h4>${CHALLENGES.filter((c) => c.tier === t).map((c) => `<div class="lb-ch ${best[c.id] ? '' : 'none'}"><span>${esc(c.title)}</span>${best[c.id] ? gradeChip(best[c.id]) : '<i class="gmark empty"></i>'}</div>`).join('')}</div>`).join('');

  root.innerHTML = shell(`
    <h2>Controller logbook <small class="h-ap mono">${esc(pack.meta.icao)}</small></h2>
    <section class="lb-rank">
      <div class="lb-badge"><small>Rank</small><b>${rank.name}</b></div>
      <ol class="lb-ladder">${ladder}</ol>
      ${rank.promotion ? `<div class="lb-next"><h3>For ${rank.next}</h3><ul>${rank.promotion.reqs.map((r) => `<li class="${r.ok ? 'ok' : ''}"><i>${r.ok ? '✓' : ''}</i>${esc(r.text)}${r.progress && !r.ok ? ` <small class="mono">${esc(r.progress)}</small>` : ''}</li>`).join('')}<li class="ride"><i>★</i>Then the checkride ${rank.promotion.ready ? '<b>(ready)</b>' : ''}</li></ul><button class="link" data-go="career">Career and checkrides ›</button></div>` : '<div class="lb-next"><h3>Top of the ladder</h3><p class="lede">You run the room now.</p></div>'}
    </section>
    <section class="lb-stats">
      ${stat(String(log.sessions), 'sessions')}
      ${stat(hrs < 10 ? hrs.toFixed(1) : hrs.toFixed(0), 'hours on position')}
      ${stat(thousands(log.moves), 'movements')}
      ${stat(thousands(log.landings), 'landings')}
      ${stat(String(log.bestSeq), 'best sequence')}
      ${stat(String(daily.best), 'longest daily streak')}
    </section>
    <div class="lb-cols">
      <section class="panel"><h3>Best grade per challenge</h3>${tierTable ? `<div class="lb-tiers">${tierTable}</div>` : `<p class="lede">No scripted challenges at ${esc(pack.meta.name)} yet.</p>`}</section>
      <section class="panel"><h3>Notable</h3>${log.events.length ? `<ul class="lb-events">${[...log.events].reverse().slice(0, 14).map((e) => `<li class="ev-${e.kind}"><span class="mono">${evIcon[e.kind]}</span><div>${esc(e.text)}<small class="mono">${e.date.slice(0, 10)}</small></div></li>`).join('')}</ul>` : '<p class="lede">Emergencies you bring home, rated sessions and promotions appear here.</p>'}</section>
    </div>
    ${recs.length ? `
    <section class="trend"><h3>Competency trend <small>last ${last.length} sessions, 1 to 5</small></h3>${COMPS.map(spark).join('')}</section>
    ${weakest ? `<p class="lede">Weakest recently: <b>${COMP_PLAIN[weakest].toLowerCase()}</b>.${ch ? ` Suggested next: <button class="link" data-ch="${ch.id}">${esc(ch.title)}</button>` : ''}</p>` : ''}
    <div class="rec-wrap"><table class="rec"><thead><tr><th>Date</th><th>Session</th><th>Landed</th><th>Grade</th></tr></thead><tbody>
    ${[...recs].reverse().slice(0, 40).map((r) => { const g = r.grade ?? (r.passed ? 'pass' : r.gatePass ? 'pass' : 'fail'); return `<tr><td class="mono">${r.date.slice(5, 16).replace('T', ' ')}</td><td>${esc(r.title)}</td><td class="mono">${r.landed}/${r.arrivals}</td><td>${gradeChip(g)} ${g === 'fail' ? 'Not yet' : GRADE_NAMES[g]}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="lede">No sessions yet. Your first debrief starts the logbook.</p>'}
    ${savePanelHtml()}`, true, 'records');
  root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => hd.startChallenge(CHALLENGES.find((c) => c.id === b.dataset.ch)!)));
  wireSavePanel(root, hd, () => renderRecords(root, hd));
}

export function renderSettings(root: HTMLElement, hd: MenuHandlers) {
  const s = hd.settings;
  const tog = (k: keyof Settings, label: string, note = '') => `<label class="toggle"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span>${label}${note ? `<small>${note}</small>` : ''}</span></label>`;
  const radio = (k: keyof Settings, label: string, opts: [string, string][]) => `<fieldset><legend>${label}</legend>${opts.map(([v, l]) => `<label><input type="radio" name="${k}" data-k="${k}" value="${v}" ${String(s[k]) === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`;
  const aps = hd.airports ?? [];
  const lf = levelFilterId(s.levelFilter);
  root.innerHTML = shell(`
    <h2>Settings</h2>
    <div class="form">
      ${aps.length > 1 ? `<fieldset><legend>Airport</legend>${aps.map((a) => `<label><input type="radio" name="airport" data-ap="${esc(a.icao)}" value="${esc(a.icao)}" ${a.icao === hd.pack.meta.icao ? 'checked' : ''}><span>${esc(a.name)}<small>${esc(a.icao)} · ${esc(a.callsign)}</small></span></label>`).join('')}</fieldset>` : ''}
      ${tog('voice', 'Pilot voices', 'Spoken readbacks at 1× speed')}
      ${tog('speakAtc', 'Speak my clearances too')}
      ${tog('speakIcom', 'Speak intercom lines', `Tower, ${esc(centreOf(hd.pack))} and the military on the landline`)}
      ${radio('voiceEngine', 'Voice engine', [['neural', 'Radio voices (download once)'], ['browser', 'This device’s voices']])}
      ${hd.radio ? voicePanelHtml(hd.radio, s) : ''}
      ${tog('quickMode', 'Quick mode', 'Each picker choice transmits at once')}
      ${tog('trainingWheels', 'Training wheels', 'Warnings block the transmission')}
      ${tog('leftHanded', 'Left-handed layout')}
      ${tog('unlockAll', 'Unlock all challenges')}
      ${radio('labelSize', 'Label size', [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']])}
      ${radio('radarRefresh', 'Radar update', [['4', '4 s (realistic)'], ['1', '1 s (smooth)']])}
      ${radio('brightness', 'Scope skin', SKIN_NAMES.map((n) => [n.id, `${n.label}<small>${esc(n.blurb)}</small>`] as [string, string]))}
      ${radio('speedVectorMin', 'Speed vector', [['1', '1 min'], ['2', '2 min'], ['3', '3 min']])}
      ${radio('ringStep', 'Range rings', [['5', 'Every 5 NM'], ['10', 'Every 10 NM'], ['20', 'Every 20 NM']])}
      <fieldset><legend>Level filter <small>traffic outside the band is dimmed; the selected aircraft, callers and conflicts always show</small></legend>${LEVEL_FILTERS.map((f) => `<label><input type="radio" name="levelFilter" data-lf="${f.id}" value="${f.id}" ${f.id === lf ? 'checked' : ''}><span>${esc(f.label)}</span></label>`).join('')}</fieldset>
      ${radio('trailLen', 'History dots', [['0', 'None'], ['3', '3 plots'], ['5', '5 plots'], ['7', '7 plots']])}
      ${tog('smooth', 'Smooth motion', 'The symbol moves between radar plots; the latest plot stays as a faint ghost')}
      ${tog('sweep', 'Sweep line', 'One turn per radar update. Off under reduced motion.')}
      <fieldset><legend>Voice speed</legend><input type="range" min="0.8" max="1.4" step="0.02" data-k="speechRate" value="${s.speechRate}"></fieldset>
      ${radio('pttKey', 'Push-to-talk key <small>hold to speak a clearance; Shift+Space pauses</small>', [['Space', 'Space bar'], ['Backquote', '` key'], ['ControlRight', 'Right Ctrl'], ['', 'Off']])}
      ${radio('voiceLang', 'Speech recognition accent', [['en-GB', 'English (UK)'], ['en-US', 'English (US)']])}
      <fieldset><legend>Foot pedal <small>${s.pedal ? `bound: ${s.pedal.kind === 'key' ? s.pedal.code : `gamepad button ${s.pedal.button}`}` : 'none'}</small></legend><button class="link" type="button" data-pedal="learn">Press to learn your pedal</button>${s.pedal ? ' · <button class="link" type="button" data-pedal="clear">Clear</button>' : ''}<span data-e="pedalMsg" class="dim"></span></fieldset>
    </div>
    ${savePanelHtml()}
  `);
  wireSavePanel(root, hd, () => renderSettings(root, hd));
  if (hd.radio) wireVoicePanel(root, hd.radio, s, hd.pack);
  root.querySelectorAll<HTMLButtonElement>('[data-pedal]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.pedal === 'clear') { s.pedal = null; saveSettings(s); renderSettings(root, hd); return; }
    const msg = root.querySelector('[data-e="pedalMsg"]'); if (msg) msg.textContent = ' Press the pedal now (Escape to cancel)…';
    const ptt = createPtt({ target: document.createElement('button'), key: '', onDown() {}, onUp() {} });
    // leaving the settings page cancels learning, so the next key press elsewhere is not captured
    const watch = window.setInterval(() => { if (!b.isConnected) ptt.destroy(); }, 200);
    const got = await ptt.learnPedal(10000);
    clearInterval(watch);
    ptt.destroy();
    if (!b.isConnected) return;
    if (got && got.kind === 'key' && /^(Key[A-Z]|Digit\d|Enter|Tab|Backspace|Escape|Arrow\w+)$/.test(got.code)) {
      if (msg) msg.textContent = ` ${got.code.replace(/^Key|^Digit/, '')} is a typing key. Use a pedal, a function key or a gamepad button.`;
      return;
    }
    if (got) { s.pedal = got as Settings['pedal']; saveSettings(s); }
    renderSettings(root, hd);
  }));
  root.querySelectorAll<HTMLInputElement>('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.k as keyof Settings;
    const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : (['radarRefresh', 'speedVectorMin', 'ringStep', 'trailLen'].includes(k) ? Number(inp.value) : inp.value);
    (s as any)[k] = v;
    saveSettings(s);
    if (k === 'voiceEngine' && hd.radio) { hd.radio.engine = s.voiceEngine; renderSettings(root, hd); }
  }));
  root.querySelectorAll<HTMLInputElement>('[data-lf]').forEach((inp) => inp.addEventListener('change', () => { s.levelFilter = LEVEL_FILTERS.find((f) => f.id === inp.dataset.lf)?.band ?? null; saveSettings(s); }));
  root.querySelectorAll<HTMLInputElement>('input[data-ap]').forEach((inp) => inp.addEventListener('change', () => { if (inp.checked && inp.dataset.ap !== hd.pack.meta.icao) hd.setAirport?.(inp.dataset.ap!, 'settings'); }));
}

// ===========================================================================
// Career: the ladder, what the next promotion needs, and the checkride
const SHORT: Record<string, string> = { Student: 'Learning the position', OJT: 'Real traffic, instructor plugged in', Validated: 'Rated for the position', Senior: 'The night bank and the abnormal', Supervisor: 'Runs the room' };
const fmtDate = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return isNaN(+d) ? '' : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

export function renderCareer(root: HTMLElement, hd: MenuHandlers) {
  const pack = hd.pack;
  const rides = checkridesFor(pack.meta.icao);
  const st = careerNow();
  const car = loadCareer();
  const log = loadLogbook();
  const p = st.promotion;
  const passedRides = car.checkrides.filter((c) => c.pass).length;
  const goodShifts = car.shifts.filter((x) => x.grade !== 'fail').length;
  const req = (r: { text: string; ok: boolean; progress?: string }) => `<li class="${r.ok ? 'ok' : ''}"><i>${r.ok ? '✓' : ''}</i><span>${esc(r.text)}</span>${r.progress ? `<small class="mono">${esc(r.progress)}</small>` : ''}</li>`;
  const slip = (def: CheckrideDef) => {
    const tries = car.checkrides.filter((c) => c.id === def.id && !c.credited);
    const lock = !p ? '' : !p.reqs.every((r) => r.ok) ? 'Meet every requirement above to book it.' : p.retakeIn ? `Retake after ${p.retakeIn} more logged shift${p.retakeIn > 1 ? 's' : ''}.` : '';
    return `<article class="cr-slip ${p?.ready ? 'ready' : ''}">
      <header class="mono"><span>${esc(pack.meta.icao)} APP · CHECKRIDE</span><span>${tries.length ? `ATTEMPT ${tries.length + 1}` : 'FIRST ATTEMPT'}</span></header>
      <h4>${esc(def.title)}</h4>
      <p>${esc(def.brief)}</p>
      <ul class="cr-slip-list"><li>Pass the safety gate</li><li>Graded ${GRADE_NAMES[def.minGrade]} or better</li><li>Handle the examiner's surprises. The script is hidden.</li></ul>
      ${tries.length ? `<p class="cr-tries mono">${tries.map((t) => `<span class="${t.pass ? 'ok' : 'no'}">${fmtDate(t.date)} ${t.pass ? 'PASSED' : 'NOT YET'}</span>`).join('')}</p>` : ''}
      <div class="cr-slip-go">${p?.ready ? '<button class="primary" data-ride="go">Book the checkride</button>' : `<p class="cr-lock">${esc(lock)}</p>`}</div>
    </article>`;
  };
  const ladder = RANKS.map((r, i) => {
    const cls = i < st.index ? 'done' : i === st.index ? 'now' : i === st.index + 1 ? 'next' : 'later';
    const when = i === 0 ? '' : i <= st.index ? (car.checkrides.find((c) => c.id === rides[i - 1]?.id && c.pass)?.credited ? 'carried over' : fmtDate(st.promotedOn[i])) : '';
    return `<li class="cr-step ${cls}">
      <div class="cr-rail"><i>${i < st.index ? '✓' : i === st.index ? '●' : ''}</i></div>
      <div class="cr-body">
        <header><b>${r}</b><span>${SHORT[r]}</span>${when ? `<em class="mono">${when}</em>` : cls === 'now' ? '<em class="mono now">YOU ARE HERE</em>' : ''}</header>
        ${cls === 'next' && p ? `<div class="cr-next">
          <ul class="cr-reqs">${p.reqs.map(req).join('')}</ul>
          ${slip(p.checkride)}
        </div>` : ''}
      </div>
    </li>`;
  }).join('');
  root.innerHTML = shell(`
    <h2>Career <small class="h-ap mono">${esc(pack.meta.icao)}</small></h2>
    ${rides.length ? '' : `<p class="lede cr-none">There are no checkrides at ${esc(pack.meta.name)} yet, so the ladder stops at ${esc(st.name)} here. Your shifts and hours are logged all the same, and the Liège ladder keeps its own progress.</p>`}
    <p class="lede">From student to supervisor. Each promotion needs logged shifts at a minimum grade, a few challenges, and then a checkride with an examiner behind you. A logged shift is any free play or daily shift of 15 minutes or more.</p>
    <section class="cr-head">
      <div class="lb-badge"><small>Rank</small><b>${st.name}</b></div>
      <div class="cr-who">
        <h3>${esc(RANK_LONG[st.name])}</h3>
        <dl class="cr-nums">
          <div><dt>Logged shifts</dt><dd class="mono">${car.shifts.length}</dd></div>
          <div><dt>Passed or better</dt><dd class="mono">${goodShifts}</dd></div>
          <div><dt>Checkrides passed</dt><dd class="mono">${passedRides}</dd></div>
          <div><dt>Hours on position</dt><dd class="mono">${(log.seconds / 3600).toFixed(1)}</dd></div>
        </dl>
      </div>
    </section>
    ${rides.length ? `<ol class="cr-ladder">${ladder}</ol>` : ''}
    ${!p && rides.length ? '<p class="lede">Top of the ladder. Keep the logbook going; the drills and daily shift are always there.</p>' : ''}
  `, true, 'career');
  root.querySelector('[data-ride="go"]')?.addEventListener('click', () => p && hd.startCheckride?.(p.checkride));
}

// ===========================================================================
// Drills
const DRILL_ICON: Record<DrillId, string> = {
  intercept: '<path d="M4 30 L44 30"/><path d="M14 8 L30 30" class="hl"/><path d="M14 8 L10 4" class="dim"/>',
  wake: '<path d="M4 24 L44 24"/><circle cx="12" cy="24" r="3" class="hl"/><circle cx="34" cy="24" r="3"/><path d="M15 14 L31 14 M15 11 L15 17 M31 11 L31 17" class="hl"/>',
  conflict: '<path d="M6 30 L40 10" /><path d="M6 10 L40 30" class="dim"/><path d="M34 10 L40 10 L37 15" /><circle cx="23" cy="20" r="4" class="hl"/>',
  descent: '<path d="M4 8 L16 8 L40 30 L44 30" class="hl"/><path d="M4 8 L20 8 L20 18 L30 18 L30 30 L44 30" class="dim"/>',
  release: '<path d="M18 30 L44 30" class="hl"/><circle cx="8" cy="22" r="2.5"/><circle cx="40" cy="12" r="2.5"/><path d="M24 30 L34 22" /><path d="M31 21 L34 22 L33 25"/>',
};
export function renderDrills(root: HTMLElement, hd: MenuHandlers) {
  const DRILLS = drillsFor(hd.pack.meta.icao);
  const recs = loadDrills();
  const card = (i: number, id: DrillId) => {
    const d = drillById(id)!;
    const r: DrillRecord | undefined = recs[id];
    return `<article class="dr-card ${r?.passes ? 'passed' : ''}">
      <header><svg viewBox="0 0 48 36" aria-hidden="true">${DRILL_ICON[id] ?? ''}</svg><div><span class="mono">DRILL ${String(i + 1).padStart(2, '0')}</span><b>${esc(d.title)}</b></div></header>
      <p>${esc(d.summary)}</p>
      <p class="dr-goal"><span class="mono">PASS</span>${esc(d.goal)}</p>
      <dl class="dr-best">
        <div><dt>Best score</dt><dd class="mono">${r?.bestScore ? r.bestScore : '–'}</dd></div>
        <div><dt>Best time</dt><dd class="mono">${r?.bestTime !== undefined ? fmtT(r.bestTime).slice(1) : '–'}</dd><small>${esc(d.timeLabel)}</small></div>
        <div><dt>Passed</dt><dd class="mono">${r ? `${r.passes}/${r.plays}` : '0'}</dd></div>
      </dl>
      <button class="primary" data-drill="${id}">${r ? 'Again' : 'Fly it'}</button>
    </article>`;
  };
  root.innerHTML = shell(`
    <h2>Drills</h2>
    <p class="lede">Two-minute exercises, one skill each. Every attempt is a new variation and the drill ends itself as soon as it can be judged. Fast-forward is fine: the score does not care.</p>
    ${DRILLS.length ? `<div class="dr-grid">${DRILLS.map((d, i) => card(i, d.id)).join('')}</div>` : `<p class="lede">No drills at ${esc(hd.pack.meta.name)} yet. The Liège drills teach the same skills; switch airport on the home page to fly them.</p>`}
  `, true, 'drills');
  root.querySelectorAll<HTMLButtonElement>('[data-drill]').forEach((b) => b.addEventListener('click', () => hd.startDrill?.(b.dataset.drill as DrillId)));
}

// ===========================================================================
// Radio voices: download status, sample call, remove
const VOICE_TOTAL_MB = Object.values(VOICE_MODELS).reduce((a, m) => a + m.mb, 0) + 4;
function voiceStatus(r: Radio, s: Settings): string {
  if (s.voiceEngine === 'browser') return 'Using this device’s voices. Radio voices sound like a real frequency: accents from 15 countries, VHF radio sound, hiss on weak signals.';
  if (!neuralSupported()) return 'This browser cannot run the radio voices, so the device’s voices are used.';
  const n = r.neural;
  if (n.state === 'off') return `Not downloaded yet: about ${Math.round(VOICE_TOTAL_MB)} MB, once . It starts when you open a session, or tap Download now.`;
  if (n.state === 'loading') return `Downloading ${Math.round(n.fraction * 100)} % of ${Math.round(VOICE_TOTAL_MB)} MB. Device voices fill in until it finishes.`;
  if (n.state === 'error') return `Download failed (${[...n.failed.values()][0]}). Device voices are used. Tap Download now to retry.`;
  const t = n.timings.length ? ` A call takes about ${(n.timings.reduce((a, b) => a + b, 0) / n.timings.length / 1000).toFixed(1)} s to prepare on this device.` : '';
  return `Ready: ${n.ready.size} voice sets stored in this browser.${t}`;
}
function voicePanelHtml(r: Radio, s: Settings): string {
  return `<fieldset class="voice-panel"><legend>Radio voices</legend>
    <p class="dim" data-e="vstatus">${voiceStatus(r, s)}</p>
    <div class="sf-actions">
      ${s.voiceEngine === 'neural' && neuralSupported() && r.neural.state !== 'ready' ? '<button class="sf-btn" type="button" data-v="dl">Download now</button>' : ''}
      <button class="sf-btn" type="button" data-v="sample">Play a sample call</button>
      ${s.voiceEngine === 'neural' && neuralSupported() ? '<button class="sf-btn" type="button" data-v="rm">Remove download</button>' : ''}
    </div>
    <p class="dim small">Voices: Piper models trained on VCTK (Edinburgh, CC BY), L2-ARCTIC (Texas A&amp;M, CC BY-NC) and Thorsten Müller’s German voice (CC0); phonemes by espeak-ng (GPL-3). Generated on this device; nothing is sent anywhere.</p></fieldset>`;
}
const SAMPLES: Record<string, [string, string][]> = {
  EBLG: [
    ['QTR8125', 'Liège Approach, Qatari eight one two five, flight level niner five descending flight level eight zero, information Lima'],
    ['FDX5240', 'Liège Approach, FedEx five two four zero, passing two thousand three hundred feet climbing flight level six zero, L N O niner Sierra'],
    ['BCS5AB', 'descend flight level niner zero, reduce speed to two two zero knots, Eurotrans five Alfa Bravo'],
    ['ABR3JW', 'Contract three Juliett Whiskey, request direct Al-hoov'],
    ['TAY4EK', 'cleared I L S approach runway two two left, Quality four Echo Kilo'],
  ],
  EDDL: [
    ['EWG2LK', 'Langen Radar, Eurowings two Lima Kilo, flight level one one zero descending flight level eight zero, information Kilo'],
    ['DLH4KM', 'Langen Radar, Lufthansa four Kilo Mike, passing three thousand feet climbing flight level seven zero, MODRU two Tango'],
    ['CFG71B', 'descend flight level niner zero, reduce speed to two two zero knots, Condor seven one Bravo'],
    ['UAE57', 'Emirates five seven heavy, request direct Bik-moo'],
    ['THY1839', 'cleared I L S approach runway two three left, Turkish one eight three niner'],
  ],
};
/** Sample calls for the voice panel: the airport's own, or ones written from its pack. */
function samplesFor(pack: Pack): [string, string][] {
  const own = SAMPLES[pack.meta.icao];
  if (own) return own;
  const ops = [...(pack.spec.traffic?.pax ?? []), ...(pack.spec.traffic?.cargo ?? [])];
  const cs = (i: number) => `${ops[i % Math.max(1, ops.length)]?.op ?? 'QTR'}${100 + i * 37}`;
  const land = pack.runwayConfigs[0]?.land ?? pack.preferredRunways[0];
  return [
    [cs(1), `${pack.meta.appCallsign}, flight level one one zero descending flight level eight zero, information Kilo`],
    [cs(2), 'descend flight level niner zero, reduce speed to two two zero knots'],
    [cs(3), `cleared I L S approach runway ${land.split('').join(' ').replace('L', 'left').replace('R', 'right')}`],
  ];
}
let sampleN = 0;
function wireVoicePanel(root: HTMLElement, r: Radio, s: Settings, pack: Pack) {
  const st = root.querySelector<HTMLElement>('[data-e="vstatus"]');
  const refresh = () => { if (st?.isConnected) st.textContent = voiceStatus(r, s); else r.neural.onChange = undefined; };
  r.neural.onChange = refresh;
  root.querySelector('[data-v="dl"]')?.addEventListener('click', () => { r.unlock(); r.engine = 'neural'; r.loadVoices(); refresh(); });
  root.querySelector('[data-v="sample"]')?.addEventListener('click', () => {
    r.unlock(); r.engine = s.voiceEngine; r.enabled = true;
    const list = samplesFor(pack);
    const [cs, line] = list[sampleN++ % list.length];
    r.speak(line, cs, { kind: 'rt', signal: 0.45 + (sampleN % 3) * 0.25 });
  });
  root.querySelector('[data-v="rm"]')?.addEventListener('click', async () => {
    try { await caches.delete('lgg-voices-v1'); } catch { /* no cache storage */ }
    if (st) st.textContent = 'Removed from this browser. The models stay in memory until you reload the page.';
  });
}

// ===========================================================================
// Save file: export and import (Logbook and Settings)
function savePanelHtml(): string {
  const ok = storageAvailable();
  return `<section class="panel save-file" data-e="save">
    <h3>Save file</h3>
    <p>${ok ? 'Your progress lives in this browser only. Export it to keep a backup or to carry it to another device, then import it there.' : 'This browser is not letting the game store anything (a private window, or site data blocked), so nothing will be kept after you close it, and a save file cannot be loaded here. Open the game in a normal window to export or import.'}</p>
    <div class="sf-actions">
      <button class="sf-btn" data-sf="export">Export save</button>
      ${ok ? '<label class="sf-btn">Import save<input type="file" accept="application/json,.json" data-sf="file"></label>' : ''}
    </div>
    <div class="sf-confirm" data-sf="confirm" hidden></div>
    <p class="sf-status" data-sf="status" role="status"></p>
  </section>`;
}
function wireSavePanel(root: HTMLElement, hd: MenuHandlers, rerender: () => void) {
  const box = root.querySelector<HTMLElement>('[data-e="save"]');
  if (!box) return;
  const status = box.querySelector<HTMLElement>('[data-sf="status"]')!;
  const confirm = box.querySelector<HTMLElement>('[data-sf="confirm"]')!;
  const file = box.querySelector<HTMLInputElement>('[data-sf="file"]');
  const say = (t: string, bad = false) => { status.textContent = t; status.classList.toggle('bad', bad); };
  box.querySelector('[data-sf="export"]')!.addEventListener('click', () => {
    try {
      const f = exportSave();
      downloadText(JSON.stringify(f, null, 1), saveFileName());
      say(`Saved ${Object.keys(f.keys).length} items to ${saveFileName()}.`);
    } catch { say('Could not create the save file in this browser.', true); }
  });
  file?.addEventListener('change', async () => {
    if (!file) return;
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    let text = '';
    try { text = await f.text(); } catch { say('Could not read that file.', true); return; }
    const v = validateSave(text);
    if (!v.ok) { say(v.error, true); confirm.hidden = true; return; }
    const cur = currentSummary();
    say('');
    confirm.hidden = false;
    confirm.innerHTML = `<p><b>Replace your progress?</b> This browser has ${cur.sessions} session${cur.sessions === 1 ? '' : 's'} at ${cur.rank}. The file has ${v.summary.sessions} session${v.summary.sessions === 1 ? '' : 's'} at ${v.summary.rank}${v.summary.exported ? `, saved ${fmtDate(v.summary.exported)}` : ''}. Everything here will be replaced, including settings. This cannot be undone.</p>
      <div class="sf-actions"><button class="sf-btn danger" data-sf="yes">Replace my progress</button><button class="sf-btn" data-sf="no">Cancel</button></div>`;
    confirm.querySelector('[data-sf="no"]')!.addEventListener('click', () => { confirm.hidden = true; say('Import cancelled. Nothing changed.'); });
    confirm.querySelector('[data-sf="yes"]')!.addEventListener('click', () => {
      const r = applySave(v.save as SaveFile);
      if (!r.ok) { confirm.hidden = true; say(r.error, true); return; }
      Object.assign(hd.settings, loadSettings());
      rerender();
      root.querySelector<HTMLElement>('[data-sf="status"]')?.replaceChildren(document.createTextNode(`Save loaded: ${v.summary.sessions} session${v.summary.sessions === 1 ? '' : 's'}, rank ${v.summary.rank}.`));
    });
  });
}

// ===========================================================================
// Help: controls, shorthand, label anatomy, colours, glossary
/** The one-paragraph airport summary at the foot of the wake table. */
function airportParagraph(pack?: Pack): string {
  if (!pack || pack.meta.icao === 'EBLG') return 'Liège in one paragraph: every STAR ends at ALHUV, right over the 22L threshold. X-series STARs feed runway 22, D-series loop south through RUDIX for runway 04. RNAV transitions (ALHUV1A to 1Z) lead to the intermediate fix at 2,500 ft (22) or 3,000 ft (04). Departures climb to FL060 and must go to Brussels before they leave the 40 NM sector.';
  if (pack.meta.icao === 'EDDL') return 'Düsseldorf in one paragraph: you are Langen Radar on 128.555, feeding the parallel runways; the northern one (23R or 05L) lands and the southern one (23L or 05R) departs when both are in use. Arrivals come in over BIKMU, DOMUX, HALME and PISAP and the stack forms at BIKMU; the coded RNAV transitions lead from there to the intermediate fix 4 NM outside the final approach fix. Departures call Langen on 121.355 passing 2,000 ft, climb to FL100 and go to the Bottrop sector before they leave the 40 NM sector. The field is shut to scheduled traffic 22:00 to 06:00 local, and ED-R 111 Jülich is the military area next door.';
  const units = unitTable(pack), acc = unitByRole(units, 'acc');
  const lvl = pack.depXfl as { fl?: number; ft?: number };
  const xfl = lvl.fl !== undefined ? `FL${String(lvl.fl).padStart(3, '0')}` : `${thousands(lvl.ft ?? 0)} ft`;
  return `${pack.meta.name} in one paragraph: you are ${pack.meta.appCallsign} on ${pack.meta.appFreq}. The arrivals gather at ${pack.stackFix}, where the transitions to the intermediate fix start. Departures climb to ${xfl} and go to ${acc?.say ?? 'the centre'} before they leave the ${pack.meta.sectorRadiusNm} NM sector. The ${pack.reservedAreasName} areas are the military airspace you coordinate with.`;
}

export function renderHelp(root: HTMLElement, pack?: Pack) {
  const sk = SKIN.night;
  const GLOSSARY = glossaryFor(pack);
  const units = pack ? unitTable(pack) : undefined;
  const twr = units ? unitByRole(units, 'tower') : undefined, acc = units ? unitByRole(units, 'acc') : undefined, mil = units ? unitByRole(units, 'military') : undefined;
  const stack = pack?.stackFix ?? 'ALHUV';
  const trans = pack?.transitions[0]?.name ?? 'ALHUV1A';
  const rwy = pack ? (pack.runwayConfigs[0]?.land ?? pack.preferredRunways[0]) : '22L';
  const fix = pack ? (pack.transitions[0]?.legs[1]?.fix ?? stack) : 'LIBVA';
  const unitKeys = `${twr?.id ?? 'TWR'} · ${acc?.id ?? 'BRU'} · ${mil?.id ?? 'MIL'}`;
  const unitNames = `Hand off to ${twr?.callsign ?? 'Tower'} · ${acc?.callsign ?? 'Brussels'} · ${mil?.callsign ?? 'military control'}`;
  const areasName = pack?.reservedAreasName ?? 'TSA';
  const controls: [string, string, string, string][] = [
    ['Select an aircraft', 'Tap its track, label, strip, AMAN entry or attention row', 'Click', '<kbd>Tab</kbd> walks the attention queue · type the callsign, or just its digits'],
    ['Heading', 'Drag from the aircraft and lift', 'Drag, or wheel over the label', '<span class="mono">H250 L250 R250</span>'],
    ['Direct to a fix', 'Drag from the aircraft and lift on the fix', 'Drag onto the fix', `<span class="mono">DCT ${esc(fix)}</span> · <span class="mono">&gt;${esc(fix.slice(0, 3).toLowerCase())}</span>`],
    ['Level', 'Tap the level line of the label', 'Click it, or wheel', '<span class="mono">D40 C80 A30 FL070</span>'],
    ['Speed', 'Tap the speed line', 'Click it, or wheel', '<span class="mono">S210 S160/4 SMIN SRES</span>'],
    ['Approach and transitions', 'Tap the bottom line', 'Click it', `<span class="mono">ILS RNP${esc(rwy)} ${esc(trans)} HOLD</span>`],
    ['More orders', 'Long-press a track', 'Long-press', '<span class="mono">RON SQ4521</span>'],
    ['Transmit', 'SEND', 'SEND', '<kbd>Enter</kbd>'],
    ['Clear the bar', '×', '×', '<kbd>Esc</kbd>'],
    ['Pause', '❚❚', '❚❚', '<kbd>Shift</kbd>+<kbd>Space</kbd> (Space is push to talk)'],
    ['Undo the last send', 'Undo chip', 'Undo chip', '<kbd>Backspace</kbd>, within two seconds'],
    ['Queue a clearance', 'Q', 'Q', '<kbd>Q</kbd>, then <kbd>Enter</kbd> sends the first queued'],
    ['Replay the last minute', 'MORE', 'MORE', 'MORE · Replay'],
    ['Zoom and pan', 'Pinch, drag empty scope', 'Wheel on empty scope, drag', '+ − ◎ buttons'],
    ['Measure', 'RBL, then two points', 'RBL, then two points', ''],
  ];
  const shorthand: [string, string][] = [
    ['H250 · L250 · R250', 'Heading 250, shortest way / turn left / turn right'],
    ['D40 · C80 · A30 · FL070', 'Descend 4,000 ft · climb FL080 · altitude 3,000 ft · flight level 70. Below the transition level numbers are feet.'],
    ['S210 · S160/4 · SMIN · SRES', 'Speed 210 kt · 160 kt until 4 NM · minimum clean speed · resume normal speed'],
    [`DCT ${fix} · >${fix.slice(0, 3).toLowerCase()}`, 'Direct to a fix; a short start of the name is enough when it fits one fix'],
    [`${trans} · ILS · RNP${rwy} · VIS${rwy}`, 'Transition · ILS on the runway in use · RNP or visual approach'],
    [`HOLD · HOLD ${stack}`, 'Hold at the stack fix (give an expected time)'],
    [unitKeys, unitNames],
    ['Y · N', 'Approve or refuse a pilot request'],
    ['BRK H040 A30', 'Cancel the approach clearance (break off), with a heading and altitude'],
    ['ATIS', '"Information X now current, QNH …": answer a pilot with an old ATIS'],
    ['REL · REL AFTER QTR586 · REL H250 A50', 'Release a departure (on the intercom to Tower), after a given aircraft, or on a heading and level'],
    ['RH · RH3', 'Hold the departure; Tower can expect a release in 3 minutes'],
    ['SQ4521 · RON', 'Squawk a code · resume own navigation'],
  ];
  const recats: Recat[] = ['A', 'B', 'C', 'D', 'E', 'F'];
  const recatEx: Record<Recat, string> = { A: 'An-124', B: 'B747, B777, A330', C: 'MD-11, B767, A300', D: 'B757, C-130', E: 'A320, B737', F: 'Light' };
  const wakeTable = `<div class="hp-scroll"><table class="hp-wake"><thead><tr><th>Leader ↓ / follower →</th>${recats.map((r) => `<th>${r}</th>`).join('')}</tr></thead><tbody>
    ${recats.map((l) => `<tr><th>${l} <small>${recatEx[l]}</small></th>${recats.map((f) => { const v = wakeMinNm(l, f); return `<td class="${v > 3 ? 'w' : ''}">${v}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
  const colours: [string, string, string][] = [
    [sk.assumed, 'White track', 'On your frequency: you control it'],
    [sk.notified, 'Green track', 'Coming to you; not yet called'],
    [sk.transferred, 'Grey-blue track', 'Handed off to another unit'],
    [sk.unconcerned, 'Dark grey track', 'Not your traffic'],
    [sk.select, 'Cyan', 'Selected aircraft, and values you assigned'],
    [sk.warn, 'Amber', 'Something needs a look: a wrong readback, a request, a Mode S mismatch'],
    [sk.urgent, 'Red', 'Safety net or emergency: STCA, MSAW, CLAM, 7700, 7600'],
    [sk.tsaOn, 'Amber outline', `Active military area (${areasName})`],
  ];
  const nav = [['controls', 'Controls'], ['shorthand', 'Typed orders'], ['label', 'The label'], ['colours', 'Colours'], ['wake', 'Wake'], ['glossary', 'Glossary']];
  root.innerHTML = shell(`
    <h2>Help</h2>
    <nav class="hp-nav">${nav.map(([id, t]) => `<a href="#hp-${id}">${t}</a>`).join('')}</nav>

    <section class="hp-sec" id="hp-controls">
      <h3>How to give an order</h3>
      <ol class="hp-flow">
        <li><b>Select</b><span>the aircraft</span></li>
        <li><b>Compose</b><span>one or more items</span></li>
        <li><b>Check</b><span>the phraseology and warnings</span></li>
        <li><b>Send</b><span>and listen to the readback</span></li>
      </ol>
      <div class="hp-scroll"><table class="hp-table"><thead><tr><th></th><th>Touch</th><th>Mouse</th><th>Keyboard</th></tr></thead><tbody>
        ${controls.map(([a, t, m, k]) => `<tr><th>${a}</th><td data-l="Touch"><span>${t}</span></td><td data-l="Mouse"><span>${m}</span></td><td data-l="Keys"><span>${k || '-'}</span></td></tr>`).join('')}
      </tbody></table></div>
      <p class="lede">Pilots read back every instruction. Some get it wrong on purpose: the readback card above the composer turns amber and carries the correction; re-issue the item within 30 seconds. A flashing box around a callsign means that pilot is waiting for you; the NEXT button lists everyone who does, most urgent first.</p>
      <p class="lede">On the radar, the selected aircraft wears a halo: a ladder of levels on one side, speeds on the other, the fixes that make sense and the ILS, HOLD and handoff keys. One tap sends; a long press stages it for a longer clearance; Backspace or the Undo chip takes a send back within two seconds.</p>
    </section>

    <section class="hp-sec" id="hp-shorthand">
      <h3>Typed orders <small>desktop command line; start with the callsign or select first</small></h3>
      <p class="hp-example mono"><span>DHK7</span> <span>L250</span> <span>D40</span> <span>S210</span> <span>ILS</span> <kbd>Enter</kbd></p>
      <dl class="hp-sh">${shorthand.map(([k, v]) => `<dt class="mono">${esc(k).replace(/ · /g, '<i> · </i>')}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    </section>

    <section class="hp-sec" id="hp-label">
      <h3>Reading a label</h3>
      <div class="hp-label">
        <div class="hp-lab mono" aria-hidden="true">
          <div><b>QTR8125</b> <i class="dim">B</i> <i class="red">CLAM</i></div>
          <div>070↓ <i class="cy">040</i> <i class="amb">≠050</i></div>
          <div>24 <i class="cy">S210 H250</i></div>
          <div>LOC${esc(rwy)} D8.4</div>
        </div>
        <ol class="hp-callouts">
          <li><b>Line 1</b> callsign, RECAT-EU wake category for heavies, then any alert: <span class="mono red">CLAM</span>, <span class="mono red">MSAW</span>, <span class="mono red">7700</span>, <span class="mono">REQ</span> for a pilot request.</li>
          <li><b>Line 2</b> current level with climb or descent arrow, then the level you cleared (cyan). <span class="mono amb">≠050</span> means the pilot set something else (Mode S selected level). Tap it for the level ladder.</li>
          <li><b>Line 3</b> ground speed in tens of knots, then your assigned speed and heading. Tap for speeds.</li>
          <li><b>Line 4</b> what it is flying: next fix, hold, approach cleared, or LOC with distance to the threshold once established. Tap for approaches.</li>
        </ol>
      </div>
    </section>

    <section class="hp-sec" id="hp-colours">
      <h3>Colours</h3>
      <ul class="hp-colours">${colours.map(([c, n, d]) => `<li><i style="background:${c}"></i><b>${n}</b><span>${d}</span></li>`).join('')}</ul>
    </section>

    <section class="hp-sec" id="hp-wake">
      <h3>RECAT-EU wake minima on final <small>NM; never less than 3</small></h3>
      ${wakeTable}
      <p class="lede">${esc(airportParagraph(pack))}</p>
    </section>

    <section class="hp-sec" id="hp-glossary">
      <h3>Glossary</h3>
      <input class="hp-search" type="search" placeholder="Find a term" aria-label="Find a term">
      ${GLOSSARY_GROUPS.map((g) => `<div class="hp-group"><h4>${g.title}</h4><dl class="hp-gl">${g.terms.filter((t) => GLOSSARY[t]).map((t) => `<div data-term="${esc(t.toLowerCase())} ${esc(GLOSSARY[t].toLowerCase())}"><dt>${esc(t)}</dt><dd>${esc(GLOSSARY[t])}</dd></div>`).join('')}</dl></div>`).join('')}
      <p class="lede hp-none" hidden>No term matches. Try a shorter word, such as “wake” or “hold”.</p>
    </section>
  `, true, 'help');
  const q = root.querySelector<HTMLInputElement>('.hp-search')!;
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    root.querySelectorAll<HTMLElement>('[data-term]').forEach((el) => { el.hidden = !!s && !el.dataset.term!.includes(s); });
    root.querySelectorAll<HTMLElement>('.hp-group').forEach((g) => { g.hidden = !g.querySelector('[data-term]:not([hidden])'); });
    root.querySelector<HTMLElement>('.hp-none')!.hidden = !!root.querySelector('.hp-group:not([hidden])');
  });
  root.querySelectorAll<HTMLAnchorElement>('.hp-nav a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    root.querySelector(a.getAttribute('href')!)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ===========================================================================
// Session trace: per-aircraft state sampled every few sim seconds, for the debrief timeline.

export type LaneState = 'inbound' | 'assumed' | 'hold' | 'final' | 'xfr';
export interface TraceLane { cs: string; kind: string; type: string; emer: boolean; segs: { a: number; b: number; s: LaneState }[] }
export interface Trace { every: number; t0: number; t1: number; lanes: TraceLane[] }

const laneState = (ac: Aircraft): LaneState | undefined => {
  if (ac.state === 'inbound') return 'inbound';
  if (ac.state === 'transferred') return 'xfr';
  if (ac.state !== 'assumed') return undefined;
  if (ac.mode === 'HOLD') return 'hold';
  if (ac.app?.locCap) return 'final';
  return 'assumed';
};

/** Start sampling the sim (idempotent). Wraps sim.step, so it works at any game speed and in tests. */
export function startTrace(sim: Sim, every = 10): Trace {
  const ex = (sim as any)._menuTrace as Trace | undefined;
  if (ex) return ex;
  const tr: Trace = { every, t0: sim.t, t1: sim.t, lanes: [] };
  (sim as any)._menuTrace = tr;
  const by = new Map<string, TraceLane>();
  const sample = () => {
    const t = sim.t;
    for (const ac of sim.aircraft) {
      if (ac.remove) continue;
      const st = laneState(ac);
      if (!st) continue;
      let lane = by.get(ac.cs);
      if (!lane) {
        if (st === 'xfr') continue; // never ours
        lane = { cs: ac.cs, kind: ac.kind, type: ac.type, emer: false, segs: [] };
        by.set(ac.cs, lane);
        tr.lanes.push(lane);
      }
      if (ac.emergency) lane.emer = true;
      const last = lane.segs[lane.segs.length - 1];
      if (last && last.b >= t - every - 1) {
        last.b = t;
        if (last.s !== st) lane.segs.push({ a: t, b: t, s: st });
      } else lane.segs.push({ a: Math.max(tr.t0, t - every / 2), b: t, s: st });
    }
    tr.t1 = t;
  };
  sample();
  let lastS = sim.t;
  const orig = sim.step.bind(sim);
  sim.step = (dt?: number) => {
    orig(dt);
    if (sim.t - lastS >= every || sim.ended) { lastS = sim.t; sample(); }
  };
  (tr as any)._sample = sample;
  return tr;
}
/** Take a last sample (call when the session ends). */
export const finishTrace = (tr: Trace) => (tr as any)._sample?.();

export interface DebriefData {
  trace?: Trace;
  spacing: { leader: string; follower: string; gap: number; min: number }[];
  landings: { cs: string; t: number }[];
  events: SimEvent[];
  startUtc: string;
  endReason?: 'complete' | 'time' | 'manual';
  departures: number;
  simT: number;
}
export function debriefData(sim: Sim): DebriefData {
  const tr = (sim as any)._menuTrace as Trace | undefined;
  if (tr) finishTrace(tr);
  return {
    trace: tr, spacing: sim.spacing.slice(), landings: sim.landings.map((l) => ({ cs: l.cs, t: l.t })), events: sim.events.slice(),
    startUtc: sim.sc.startUtc, endReason: sim.endReason, departures: sim.departuresHandled, simT: sim.t,
  };
}

// ===========================================================================
// Debrief

const STAMP: Record<Grade, string> = { fail: 'FAIL', pass: 'PASS', good: 'GOOD', rated: 'RATED' };
const NEXT_GRADE: Record<Grade, string> = { fail: 'To pass', pass: 'For GOOD', good: 'For RATED', rated: '' };

/** Career extras on the debrief: all optional, so the debrief renders exactly as before without them. */
export interface DebriefExtra {
  pack?: Pack;
  /** 3 to 5 lines from the supervisor, and the rank they were written for. */
  supervisor?: { lines: string[]; rank: string };
  checkride?: { title: string; verdict: CheckrideVerdict; promotedTo?: string };
  drill?: { title: string; verdict: DrillVerdict; timeLabel: string; best?: DrillRecord; newScore?: boolean; newTime?: boolean; again(): void; list(): void };
  /** Runs the expert over the same seed (slow: call on demand). */
  ghost?: () => Promise<GhostData>;
  poster?: { tracks: TrackLog; meta: PosterMeta };
}

function drillPanel(x: NonNullable<DebriefExtra['drill']>): string {
  const v = x.verdict;
  const best = x.best;
  return `<section class="db-drill ${v.pass ? 'ok' : 'no'}">
    <div class="dd-score"><b class="mono">${v.pass ? v.score : '–'}</b><small>${v.pass ? 'score' : 'not passed'}</small></div>
    <div class="dd-body">
      <p class="db-kind mono">${esc(x.title)} · ${v.pass ? 'PASSED' : 'NOT YET'}</p>
      <h3>${esc(v.why)}</h3>
      ${v.facts.length ? `<p class="dd-facts mono">${v.facts.map((f) => `<span>${esc(f)}</span>`).join('')}<span>${fmtT(v.timeS).slice(1)} ${esc(x.timeLabel)}</span></p>` : ''}
      <p class="dd-best">${x.newScore ? '<b>New best score.</b> ' : ''}${x.newTime ? '<b>New best time.</b> ' : ''}${best?.bestScore ? `Best ${best.bestScore}${best.bestTime !== undefined ? ` · ${fmtT(best.bestTime).slice(1)} ${esc(x.timeLabel)}` : ''} · passed ${best.passes} of ${best.plays}` : 'No pass yet.'}</p>
    </div>
    <div class="dd-go"><button class="primary" data-a="again">Next variation</button><button data-a="drills">All drills</button></div>
  </section>`;
}
function examPanel(x: NonNullable<DebriefExtra['checkride']>): string {
  const v = x.verdict;
  return `<section class="db-exam ${v.pass ? 'ok' : 'no'}">
    <header class="mono"><span>EXAMINER'S REPORT</span><span>${esc(x.title.replace(/^Checkride: /, ''))}</span></header>
    <div class="ex-stamp"><span>${v.pass ? 'PASSED' : 'NOT YET'}</span></div>
    <p class="ex-lead">${esc(v.report[0])}</p>
    <ol class="ex-items">${v.items.map((i) => `<li class="${i.ok ? 'ok' : 'no'}"><i>${i.ok ? '✓' : '✗'}</i><div><b>${esc(i.text)}</b><span>${esc(i.note)}</span></div></li>`).join('')}</ol>
    ${v.report.length > 1 ? `<p class="ex-sum">${esc(v.report[v.report.length - 1])}</p>` : ''}
    ${x.promotedTo ? `<p class="ex-promo">Promoted to <b>${esc(x.promotedTo)}</b></p>` : ''}
    <footer><small>Examiner</small><span class="sh-sign">Examiner</span></footer>
  </section>`;
}

export function renderDebrief(root: HTMLElement, r: Result, hd: { replay(t: number): void; retry(): void; home(): void; next?: () => void }, data?: DebriefData, extra?: DebriefExtra) {
  const pips = (v: number | null) => v === null ? '<span class="na">n/a, no evidence</span>' : `<span class="pips" aria-label="${v} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''} r${v}"></i>`).join('')}</span><b class="mono">${v}</b>`;
  const end = data?.endReason === 'complete' ? 'Traffic complete' : data?.endReason === 'time' ? 'Session time up' : data?.endReason === 'manual' ? 'Ended by you' : '';
  const g: Grade = extra?.drill ? (extra.drill.verdict.pass ? 'pass' : 'fail') : r.grade;
  const sug = r.suggested ? CHALLENGES.find((c) => c.id === r.suggested && (c.icao ?? 'EBLG') === (r.icao ?? 'EBLG')) : undefined;
  const objs = r.objectives ?? [];
  root.innerHTML = `
  <div class="menu debrief">
    <div class="menu-inner">
      <header class="db-top">
        <div class="db-id">
          <p class="db-kind mono">Debrief${end ? ` · ${end}` : ''}</p>
          <h2>${esc(r.title)}</h2>
          <p class="db-sub mono"><span>${r.durationMin} min</span><span>${r.landed}/${r.arrivals} landed</span>${data ? `<span>${data.departures} dep</span>` : ''}${r.seqBest ? `<span>best chain ${r.seqBest}</span>` : ''}<span>seed ${r.seed}</span></p>
        </div>
        <div class="db-stamp g-${g}"><span>${STAMP[g]}</span></div>
      </header>
      ${extra?.drill ? drillPanel(extra.drill) : ''}
      ${extra?.checkride ? examPanel(extra.checkride) : ''}
      ${extra?.supervisor ? `<section class="db-sup"><header><span class="mono">SUP</span><b>From your supervisor</b><small>${esc(extra.supervisor.rank)}</small></header>${extra.supervisor.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</section>` : ''}
      ${extra?.drill ? '' : g !== 'rated' && r.gradeNotes.length ? `<section class="db-notes g-${g}"><h3>${NEXT_GRADE[g]}</h3><ul>${r.gradeNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : g === 'rated' ? '<section class="db-notes g-rated"><h3>Top grade</h3><p>Safe, tight and quiet. Nothing left to ask for.</p></section>' : ''}
      ${objs.length ? `<ul class="db-objs">${objs.map((o) => `<li class="${o.met ? 'met' : 'miss'}"><i>${o.met ? '✓' : '✗'}</i>${esc(o.text)}</li>`).join('')}</ul>` : ''}

      ${data?.trace && data.trace.lanes.length ? `<section class="panel db-tl"><h3>Session timeline <small>one lane per aircraft</small></h3><div class="tl-host" data-e="tl"></div>
        <p class="tl-legend">${tlLegend(data)}</p></section>` : ''}

      ${data && data.spacing.length ? `<section class="panel db-gap"><h3>Landing gaps <small>NM behind the previous landing, against the minimum</small></h3><div class="gap-host" data-e="gap"></div>
        <p class="tl-legend"><span><i class="k ok"></i>on the minimum, up to +1 NM</span><span><i class="k wide"></i>wider: a lost slot</span><span><i class="k tight"></i>below the minimum</span></p></section>` : ''}

      <section class="panel db-cost"><h3>What cost you most</h3>
        ${r.costliest.length ? r.costliest.map((e) => `<article class="cost-item">
          <header><b class="mono">${data ? utcPlus(data.startUtc, e.t) : fmtT(e.t)}</b><span>${esc(e.text)}</span>${e.count > 1 ? `<em class="mono">×${e.count}</em>` : ''}</header>
          <p>${esc(e.why)}</p>
          <button data-replay="${e.replayT}">Replay from ${data ? utcPlus(data.startUtc, e.replayT) : fmtT(e.replayT)}</button>
        </article>`).join('') : '<p class="lede">Nothing cost you anything worth replaying.</p>'}
      </section>

      <div class="db-grid">
        <section class="panel comps"><h3>Competencies <small>ICAO units, 1 to 5</small></h3>
          ${COMPS.map((c) => `<div class="comp"><span>${COMP_PLAIN[c]} <small class="mono" title="${COMP_NAMES[c]}">${c}</small></span>${pips(r.ratings[c])}<small class="ev">${esc(r.evidence[c])}</small></div>`).join('')}</section>
        <div class="db-stack">
          <section class="panel gate ${r.gate.pass ? 'gate-ok' : 'gate-fail'}"><h3>Safety gate <b>${r.gate.pass ? 'PASS' : 'FAIL'}</b></h3>
            <ul>${r.gate.lines.map((l) => `<li class="${l.bad ? 'gl-bad' : /: 0\b/.test(l.text) ? 'gl-zero' : 'gl-some'}">${esc(l.text)}</li>`).join('')}</ul>
            <p class="fine">A loss of separation beyond 10% of the minimum, or a serious MVA bust, fails the session.</p></section>
          ${r.pass ? `<section class="panel"><h3>Pass criteria</h3><ul class="crit">${r.pass.reasons.map((x) => `<li class="${x.ok ? 'c-ok' : 'c-bad'}"><i>${x.ok ? '✓' : '✗'}</i>${esc(x.text)}</li>`).join('')}</ul></section>` : ''}
          <section class="panel"><h3>Effectiveness</h3><dl class="metrics">${r.metrics.map((m) => `<dt>${esc(m.label)}</dt><dd class="mono">${esc(m.value)}</dd>`).join('')}</dl></section>
        </div>
      </div>
      <section class="panel db-narr"><h3>Instructor's notes</h3>${r.narrative.map((n) => `<p>${esc(n)}</p>`).join('')}</section>
      ${extra?.ghost || extra?.poster ? `<section class="panel db-look"><h3>Look back <small>${extra.ghost ? 'your shift against the expert\'s, and a poster of the night' : 'a poster of the night'}</small></h3>
        <div class="lk-row">
          ${extra.poster ? `<figure class="lk-poster"><canvas data-e="poster" aria-label="Session poster"></canvas></figure>` : ''}
          <div class="lk-side">
            ${extra.ghost ? `<p>The expert is a scripted controller flown over the same traffic and the same seed. It is good, not perfect. Watch both scopes side by side and see where you parted ways.</p><button class="primary" data-a="ghost">Watch the expert</button>` : ''}
            ${extra.poster ? `<p>Every track tonight as a trail of light: pale high, white low, red where an alert went off, bright threads down the final.</p><button data-a="poster">Save poster</button><span class="lk-status" data-e="pstatus"></span>` : ''}
          </div>
        </div>
        <div class="lk-ghost" data-e="ghost" hidden></div>
      </section>` : ''}
      <div class="db-actions">
        <button class="primary" data-a="retry">Try again</button>
        ${r.suggested && hd.next ? `<button data-a="next">Next: ${esc(sug?.title ?? 'suggested challenge')}</button>` : ''}
        <button data-a="home">Menu</button>
      </div>
    </div>
  </div>`;
  root.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => hd.replay(Number(b.dataset.replay))));
  root.querySelector('[data-a="retry"]')!.addEventListener('click', hd.retry);
  root.querySelector('[data-a="home"]')!.addEventListener('click', hd.home);
  root.querySelector('[data-a="next"]')?.addEventListener('click', () => hd.next?.());
  if (extra) wireDebriefExtra(root, extra);
  if (data) {
    const tl = root.querySelector<HTMLElement>('[data-e="tl"]');
    const gp = root.querySelector<HTMLElement>('[data-e="gap"]');
    const draw = () => {
      if (tl && data.trace) tl.innerHTML = timelineSvg(tl.clientWidth, data.trace, data);
      if (gp) gp.innerHTML = gapSvg(gp.clientWidth, data);
    };
    draw();
    let lastW = 0;
    const ro = new ResizeObserver(() => { const w = (tl ?? gp)?.clientWidth ?? 0; if (Math.abs(w - lastW) > 2) { lastW = w; draw(); } });
    if (tl || gp) ro.observe((tl ?? gp)!);
  }
}
function wireDebriefExtra(root: HTMLElement, x: DebriefExtra) {
  root.querySelector('[data-a="again"]')?.addEventListener('click', () => x.drill?.again());
  root.querySelector('[data-a="drills"]')?.addEventListener('click', () => x.drill?.list());
  const pc = root.querySelector<HTMLCanvasElement>('[data-e="poster"]');
  if (pc && x.poster && x.pack) {
    const paint = () => { try { renderPoster(pc, x.pack!, x.poster!.tracks, x.poster!.meta); } catch { /* the debrief works without the poster */ } };
    setTimeout(paint, 60);
    root.querySelector('[data-a="poster"]')?.addEventListener('click', async () => {
      const st = root.querySelector<HTMLElement>('[data-e="pstatus"]');
      if (!pc.width || pc.width < 400) paint();
      const ok = await downloadCanvas(pc, `${x.pack!.meta.icao.toLowerCase()}-approach-${x.poster!.meta.dateText.replace(/\s+/g, '-').toLowerCase()}-${x.poster!.meta.seed}.png`);
      if (st) st.textContent = ok ? 'Saved.' : 'This browser would not save the image.';
    });
  }
  const gb = root.querySelector<HTMLButtonElement>('[data-a="ghost"]');
  const host = root.querySelector<HTMLElement>('[data-e="ghost"]');
  let viewer: GhostViewer | undefined;
  gb?.addEventListener('click', async () => {
    if (!x.ghost || !host || !x.pack) return;
    if (viewer) { host.hidden = !host.hidden; gb.textContent = host.hidden ? 'Watch the expert' : 'Hide the expert'; return; }
    gb.disabled = true;
    gb.textContent = 'Flying the expert\'s shift…';
    try {
      const d = await x.ghost();
      host.hidden = false;
      viewer = new GhostViewer(host, x.pack, d);
      gb.textContent = 'Hide the expert';
      host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      gb.textContent = 'The expert could not be replayed';
    }
    gb.disabled = false;
  });
}
const LEGEND: [string, string][] = [['arr', 'arrival'], ['dep', 'departure'], ['oth', 'other'], ['final', 'on the localizer'], ['hold', 'holding'], ['inb', 'calling in'], ['xfr', 'handed off'], ['red', 'conflict'], ['amb', 'go-around'], ['land', 'landed']];
/** Legend entries for what actually appears on this session's timeline. */
function tlLegend(d: DebriefData): string {
  const used = new Set<string>();
  const lanes = new Set(d.trace?.lanes.map((l) => l.cs));
  for (const l of d.trace?.lanes ?? []) for (const s of l.segs) used.add(s.s === 'assumed' ? (l.kind === 'arr' ? 'arr' : l.kind === 'dep' ? 'dep' : 'oth') : s.s === 'inbound' ? 'inb' : s.s);
  for (const e of d.events) if ((e.cs && lanes.has(e.cs)) || (e.cs2 && lanes.has(e.cs2))) { if (RED_EV.has(e.kind)) used.add('red'); if (e.kind === 'goaround') used.add('amb'); }
  if (d.landings.some((l) => lanes.has(l.cs))) used.add('land');
  return LEGEND.filter(([k]) => used.has(k)).map(([k, t]) => `<span><i class="k ${k}"></i>${t}</span>`).join('');
}
const fmtT = (t: number) => `+${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const RED_EV = new Set(['stca', 'los', 'wake']);
function timelineSvg(width: number, tr: Trace, d: DebriefData): string {
  const W = Math.max(280, width);
  const lab = W < 500 ? 62 : 78;
  const padR = 10, top = 22, laneH = W < 500 ? 12 : 14, gap = 5;
  const t0 = 0, t1 = Math.max(tr.t1, d.simT, 60);
  const x = (t: number) => lab + ((t - t0) / (t1 - t0)) * (W - lab - padR);
  const lanes = tr.lanes;
  const H = top + lanes.length * (laneH + gap) + 4;
  const idx = new Map(lanes.map((l, i) => [l.cs, i]));
  const y = (i: number) => top + i * (laneH + gap);
  // time axis
  const step = t1 > 3600 ? 900 : t1 > 1500 ? 600 : t1 > 600 ? 300 : 120;
  let axis = '';
  const showFirst = x(step) - x(0) > 70;
  for (let t = 0; t <= t1; t += step) axis += `<line x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${H}" class="grid"/>${t > 0 || showFirst ? `<text x="${x(t)}" y="${top - 9}" class="ax" text-anchor="${t === 0 ? 'start' : 'middle'}">${utcPlus(d.startUtc, t).slice(0, 5)}</text>` : ''}`;
  const cls = (l: TraceLane, s: LaneState) => (s === 'assumed' ? (l.kind === 'arr' ? 'arr' : l.kind === 'dep' ? 'dep' : 'oth') : s === 'inbound' ? 'inb' : s);
  let bars = '';
  lanes.forEach((l, i) => {
    const yy = y(i);
    bars += `<text x="${lab - 6}" y="${yy + laneH - 3}" class="cs ${l.emer ? 'emer' : ''}" text-anchor="end">${esc(l.cs)}</text>`;
    bars += `<line x1="${lab}" x2="${W - padR}" y1="${yy + laneH / 2}" y2="${yy + laneH / 2}" class="rail"/>`;
    for (const s of l.segs) {
      const xa = x(s.a), w = Math.max(1.5, x(s.b) - xa);
      const c = cls(l, s.s);
      if (s.s === 'xfr') bars += `<rect x="${xa}" y="${yy + laneH / 2 - 1}" width="${w}" height="2" class="b xfr"/>`;
      else bars += `<rect x="${xa}" y="${yy + 1}" width="${w}" height="${laneH - 2}" rx="1.5" class="b ${c} ${l.emer && s.s !== 'inbound' ? 'emer' : ''}"/>`;
    }
  });
  let marks = '';
  for (const e of d.events) {
    const red = RED_EV.has(e.kind), amb = e.kind === 'goaround';
    if (!red && !amb) continue;
    for (const cs of [e.cs, e.cs2]) {
      const i = cs ? idx.get(cs) : undefined;
      if (i === undefined) continue;
      const xx = x(e.t), yy = y(i);
      marks += `<g class="${red ? 'mk-red' : 'mk-amb'}"><title>${utcPlus(d.startUtc, e.t)} ${esc(e.text)}</title><line x1="${xx}" x2="${xx}" y1="${yy - 2}" y2="${yy + laneH + 2}"/>${amb ? `<path d="M${xx - 3.5} ${yy - 2} L${xx + 3.5} ${yy - 2} L${xx} ${yy + 3} Z"/>` : ''}</g>`;
    }
  }
  for (const l of d.landings) {
    const i = idx.get(l.cs);
    if (i === undefined) continue;
    marks += `<circle cx="${x(l.t)}" cy="${y(i) + laneH / 2}" r="${laneH / 2 - 1}" class="land"><title>${esc(l.cs)} landed ${utcPlus(d.startUtc, l.t)}</title></circle>`;
  }
  return `<svg class="tl" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of ${lanes.length} aircraft">
    <defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#5a4520"/><line x1="0" y1="0" x2="0" y2="5" stroke="#f2b84b" stroke-width="2.4"/></pattern></defs>
    ${axis}${bars}${marks}</svg>`;
}

function gapSvg(width: number, d: DebriefData): string {
  const W = Math.max(280, width);
  const sp = d.spacing;
  const left = 30, right = 8, top = 20, plotH = 150, bottom = W < 500 ? 34 : 40;
  const H = top + plotH + bottom;
  const maxV = Math.min(14, Math.max(6, ...sp.map((s) => Math.max(s.gap, s.min + 1.5))));
  const yv = (v: number) => top + plotH - (Math.min(v, maxV) / maxV) * plotH;
  const slot = (W - left - right) / sp.length;
  const bw = Math.max(4, Math.min(26, slot * 0.62));
  let g = '';
  for (let v = 0; v <= maxV; v += maxV > 9 ? 3 : 2) g += `<line x1="${left}" x2="${W - right}" y1="${yv(v)}" y2="${yv(v)}" class="grid"/><text x="${left - 5}" y="${yv(v) + 3.5}" class="ax" text-anchor="end">${v}</text>`;
  const every = Math.ceil(28 / slot);
  sp.forEach((s, i) => {
    const cx = left + slot * (i + 0.5);
    const ex = s.gap - s.min;
    const c = ex < -0.05 ? 'tight' : ex <= 1 ? 'ok' : 'wide';
    g += `<rect x="${cx - slot / 2 + 1}" y="${yv(s.min + 1)}" width="${slot - 2}" height="${yv(s.min) - yv(s.min + 1)}" class="band"/>`;
    g += `<rect x="${cx - bw / 2}" y="${yv(s.gap)}" width="${bw}" height="${yv(0) - yv(s.gap)}" class="gb ${c}" rx="1.5"><title>${esc(s.follower)} behind ${esc(s.leader)}: ${s.gap.toFixed(1)} NM, minimum ${s.min} NM</title></rect>`;
    g += `<line x1="${cx - slot / 2 + 2}" x2="${cx + slot / 2 - 2}" y1="${yv(s.min)}" y2="${yv(s.min)}" class="minl"/>`;
    if (slot >= 22) g += `<text x="${cx}" y="${yv(s.gap) - 4}" class="val ${c}" text-anchor="middle">${s.gap.toFixed(1)}</text>`;
    if (i % every === 0) g += `<text x="${cx}" y="${top + plotH + 14}" class="cs" text-anchor="end" transform="rotate(-35 ${cx} ${top + plotH + 14})">${esc(s.follower)}</text>`;
  });
  return `<svg class="gap" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Landing gaps">${g}<text x="${left - 5}" y="${top - 8}" class="ax" text-anchor="end">NM</text></svg>`;
}
