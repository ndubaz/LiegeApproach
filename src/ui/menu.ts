import './menu.css';
import { CHALLENGES, TIER_NAMES, unlockedTiers } from '../engine/scenarios';
import type { Aircraft, Comp, Scenario, SimEvent } from '../engine/types';
import { dailyShift, utcPlus, type FreePlayOpts } from '../engine/traffic';
import { COMPS, COMP_NAMES, COMP_PLAIN, GRADE_NAMES, type Grade, type Result } from '../engine/assess';
import { Sim } from '../engine/sim';
import { windComponents } from '../engine/weather';
import { PERF, wakeMinNm, type Recat } from '../engine/perf';
import {
  RANKS, bestGrade, dailyStatus, loadBest, loadLogbook, loadRecords, passedChallenges, rankOf, saveSettings, type Settings,
} from '../store';
import { Attract } from './attract';
import { SKIN } from './scope';
import { GLOSSARY, GLOSSARY_GROUPS } from './glossary';
import { LESSONS, tutorialDone } from './tutorial';
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
  settings: Settings;
  liveMetar(): Promise<string | undefined>;
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
  const recs = loadRecords();
  const passed = passedChallenges();
  const tut = tutorialDone();
  const firstTime = tut.size === 0 && recs.length === 0;
  const now = new Date();
  const daily = dailyStatus(now);
  const rank = rankOf(loadLogbook(), loadBest());
  const strip = (go: string, kind: string, code: string, name: string, line: string, stat: string, statLabel: string, extra = '') => `
    <button class="bay-strip ${kind} ${extra}" data-go="${go}">
      <span class="bs-bay mono">${code}</span>
      <span class="bs-body"><b>${name}</b><span>${line}</span></span>
      <span class="bs-stat"><b class="mono">${stat}</b><small>${statLabel}</small></span>
    </button>`;
  const dLine = daily.today
    ? `Today: ${GRADE_NAMES[daily.today.grade].toLowerCase()}, ${daily.today.landed} landed. Same traffic for everyone.`
    : `${now.getDate()} ${MONTHS[now.getMonth()]}. Twenty-five minutes of cargo night, the same for everyone today.`;
  root.innerHTML = `
  <div class="home">
    <canvas class="home-scope" aria-hidden="true"></canvas>
    <div class="home-shade"></div>
    <main class="home-main">
      <header class="home-id">
        <p class="home-freq mono">119.280 <span class="home-rank">${rank.name}</span></p>
        <h1>Liège<br>Approach</h1>
        <p class="home-sub">Work the approach radar at Liège Airport. Real Belgian AIP procedures, freighters around the clock, military traffic in the next sector.</p>
        <p class="home-live mono" data-e="live"></p>
      </header>
      <nav class="bay" aria-label="Main menu">
        ${strip('tutorial', 'tut', 'T', 'Learn the position', 'Seven short lessons, from first contact to the safety nets', `${tut.size}/${LESSONS.length}`, 'lessons', firstTime ? 'start' : '')}
        ${strip('daily', 'day', 'D', 'Daily shift', dLine, String(daily.streak), daily.streak === 1 ? 'day streak' : 'day streak', daily.today ? 'played' : '')}
        ${strip('free', 'arr', 'F', 'Free play', 'Cargo night shift or your own mix of hour, weather and military activity', '∞', 'sessions')}
        ${strip('challenges', 'dep', 'C', 'Challenges', `${CHALLENGES.length} scripted scenarios, one freighter to a compound emergency`, `${passed.size}/${CHALLENGES.length}`, 'passed')}
        ${strip('records', 'rec', 'L', 'Logbook', 'Hours, movements, best grades and your rank', String(recs.length), 'sessions')}
        <div class="bay-row">
          <button class="bay-strip mini help" data-go="help"><span class="bs-bay mono">?</span><span class="bs-body"><b>Help</b><span>Controls and glossary</span></span></button>
          <button class="bay-strip mini set" data-go="settings"><span class="bs-bay mono">S</span><span class="bs-body"><b>Settings</b><span>Voices, labels, input</span></span></button>
        </div>
      </nav>
      <p class="fine">Not a training device. Procedures from the Belgian AIP; some airspace is approximate. Flights are fictional.</p>
    </main>
    <aside class="home-radio mono" data-e="radio" aria-live="off"></aside>
  </div>`;
  const canvas = root.querySelector<HTMLCanvasElement>('.home-scope')!;
  const live = root.querySelector('[data-e="live"]')!;
  const radio = root.querySelector('[data-e="radio"]')!;
  try {
    attract = new Attract(hd.pack, canvas, hd.settings);
    const upd = () => {
      if (!attract) return;
      const sim = attract.sim, w = sim.weather;
      live.innerHTML = [`${sim.utc().slice(0, 5)}Z`, `RWY ${sim.runway}`, `WIND ${String(Math.round((w.windDir - 2) / 10) * 10).padStart(3, '0')}/${w.windKt}`, `QNH ${w.qnh}`, `${sim.aircraft.filter((a) => a.state === 'assumed').length} ON FREQ`].map((x) => `<span>${x}</span>`).join('');
    };
    upd();
    const iv = window.setInterval(() => { if (!attract) { clearInterval(iv); return; } upd(); }, 1000);
    attract.onTx = (tx, sim) => {
      if (tx.from === 'SYS' || !tx.text || tx.channel === 'icom') return;
      const row = document.createElement('div');
      row.className = `hr ${tx.from === 'ATC' ? 'atc' : ''}`;
      row.innerHTML = `<span>${sim.utc(tx.t0).slice(0, 5)}</span><b>${tx.from === 'ATC' ? 'APP' : esc(tx.cs)}</b><em>${esc(tx.text.replace(/^Liège Approach, /, ''))}</em>`;
      radio.appendChild(row);
      while (radio.children.length > 4) radio.firstChild!.remove();
    };
  } catch { /* the menu works without the live radar */ }
}

export function renderTutorial(root: HTMLElement, hd: MenuHandlers & { startLesson(i: number): void }) {
  const done = tutorialDone();
  const next = LESSONS.findIndex((l) => !done.has(l.id));
  root.innerHTML = shell(`
    <h2>Learn the position</h2>
    <p class="lede">Each lesson runs in the real sim. The coach pauses the clock, points at the button or aircraft to use, and waits until you have done it. Take them in order the first time.</p>
    <ol class="lessons">
      ${LESSONS.map((l, i) => `<li><button class="bay-strip lesson ${done.has(l.id) ? 'done' : ''} ${i === next ? 'next' : ''}" data-lesson="${i}">
        <span class="bs-bay mono">${i + 1}</span>
        <span class="bs-body"><b>${l.title}</b><span>${l.summary}</span></span>
        <span class="bs-stat"><b class="mono">${done.has(l.id) ? '✓' : l.minutes}</b><small>${done.has(l.id) ? 'done' : 'min'}</small></span>
      </button></li>`).join('')}
    </ol>`);
  root.querySelectorAll<HTMLButtonElement>('[data-lesson]').forEach((b) => b.addEventListener('click', () => hd.startLesson(Number(b.dataset.lesson))));
}

// ===========================================================================
// Free play setup
export function renderFree(root: HTMLElement, hd: MenuHandlers) {
  root.innerHTML = shell(`
    <h2>Free play</h2>
    <form class="form" data-e="free">
      <fieldset class="tpl"><legend>Shift</legend>
        <label class="wide"><input type="radio" name="template" value="shift" checked><span><b>Cargo night shift</b><small>A real Liège night: a quiet warm-up, the inbound bank, then the departure push and a tail. Random events along the way.</small></span></label>
        <label><input type="radio" name="template" value="night"><span>Night bank<small>18 arr/h, steady</small></span></label>
        <label><input type="radio" name="template" value="day"><span>Daytime mix<small>11 arr/h, some passengers</small></span></label>
        <label><input type="radio" name="template" value="quiet"><span>Quiet hour<small>6 arr/h</small></span></label>
      </fieldset>
      <fieldset><legend>Weather</legend>
        <label><input type="radio" name="weather" value="good" checked><span>Good, 22L</span></label>
        <label><input type="radio" name="weather" value="windy-ne"><span>Gusty NE, 04R</span></label>
        <label><input type="radio" name="weather" value="lvp"><span>Fog, LVP</span></label>
        <label><input type="radio" name="weather" value="storms"><span>Thunderstorms</span></label>
        <label><input type="radio" name="weather" value="live"><span>Live METAR<small>needs a connection</small></span></label>
      </fieldset>
      <fieldset data-e="mil"><legend>Military and transient traffic <small>(the night shift draws its own)</small></legend>
        <label><input type="radio" name="military" value="0"><span>None</span></label>
        <label><input type="radio" name="military" value="1" checked><span>Light<small>VFR crosser, HEMS</small></span></label>
        <label><input type="radio" name="military" value="2"><span>Busy<small>+ fighters, E-3A, TSA</small></span></label>
        <label><input type="radio" name="military" value="3"><span>Heavy<small>+ C-17, flight check, A400M</small></span></label>
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
      st.textContent = 'Fetching the current Liège METAR…';
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

export interface BriefingKind { kind: 'challenge' | 'free' | 'daily' | 'shift' }

export function renderBriefing(root: HTMLElement, pack: Pack, sc: Scenario, hd: { start(): void; back(): void; kind?: BriefingKind['kind'] }) {
  let sim: Sim | undefined;
  try { sim = new Sim(pack, sc); } catch { /* briefing still works from the scenario alone */ }
  const w = sim?.weather;
  const rwyId = sim?.runway ?? sc.runway ?? '22L';
  const rwy = pack.runways.get(rwyId);
  const kind = hd.kind ?? (sc.id.startsWith('daily-') ? 'daily' : sc.freePlay ? 'free' : 'challenge');

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
  const planned = sc.events.filter((e) => e.kind === 'tsa' && e.on || e.kind === 'flow').map((e) => e.kind === 'tsa' ? `${(e as any).name} active from ${utcPlus(sc.startUtc, e.t)}` : `Brussels flow from ${utcPlus(sc.startUtc, e.t)}: ${(e as any).mit} NM in trail via ${(e as any).exitFix}`);

  // ---- criteria
  const pc = sc.pass;
  const crit: string[] = [];
  if (pc) {
    crit.push('Pass the safety gate');
    if (pc.minLanded !== undefined) crit.push(`Land at least ${pc.minLanded}`);
    if (pc.allArrivalsHandled) crit.push('Land every arrival');
    if (pc.minDeparturesHandled !== undefined) crit.push(`Hand at least ${pc.minDeparturesHandled} departures to Brussels`);
    if (pc.maxHoldMinPerArrival !== undefined) crit.push(`Under ${pc.maxHoldMinPerArrival} min holding per arrival on average`);
    if (pc.noMissedReadbacks) crit.push('Catch every wrong readback');
    if (pc.noTsa) crit.push('Nobody inside an active military area');
    if (pc.emergencyLandedWithinMin !== undefined) crit.push(`Emergency on the ground within ${pc.emergencyLandedWithinMin} min`);
    for (const [c, v] of Object.entries(pc.minRatings ?? {})) crit.push(`${COMP_PLAIN[c as Comp]} rated ${v} or better`);
  }
  const best = bestGrade(sc.id);
  const serial = String(sc.seed % 10000).padStart(4, '0');
  const kindName = { challenge: `Challenge · Tier ${sc.tier ?? 1} ${TIER_NAMES[sc.tier ?? 1] ?? ''}`, free: 'Free play', daily: 'Daily shift', shift: 'Free play · night shift' }[kind];
  const brief = sc.briefing ? `${sc.briefing}` : '';

  root.innerHTML = shell(`
    <article class="sheet" aria-label="Position handover">
      <header class="sh-head">
        <div class="sh-org mono">EBLG APP · 119.280<br><span>POSITION HANDOVER</span></div>
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

      <section class="sh-sec">
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
      </section>

      ${sc.objectives?.length || crit.length ? `<section class="sh-sec">
        <h3>3 · ${crit.length ? 'To pass' : 'Objectives'}</h3>
        <ul class="sh-check">
          ${(sc.objectives ?? []).map((o) => `<li><i></i>${esc(o.text)} <span class="mono sh-by">by ${utcPlus(sc.startUtc, o.byT)}</span></li>`).join('')}
          ${crit.map((c) => `<li><i></i>${esc(c)}</li>`).join('')}
        </ul>
      </section>` : ''}

      <section class="sh-sec">
        <h3>${sc.objectives?.length || crit.length ? 4 : 3} · Grades</h3>
        <div class="sh-grades">
          <div class="g-pass"><b>Pass</b><p>${pc ? 'Every item above, including the safety gate.' : 'The safety gate: no loss of separation beyond the tolerance and nobody below the minimum vectoring altitude.'}</p></div>
          <div class="g-good"><b>Good</b><p>Pass, plus landings within 1.0 NM of the minimum spacing (median) and under 1 minute holding per arrival.</p></div>
          <div class="g-rated"><b>Rated</b><p>Good, plus no conflict alerts at all, pilots answered within 5 seconds (median) and 60% continuous descents.</p></div>
        </div>
      </section>

      <footer class="sh-foot">
        <div><small>Handed over by</small><span class="sh-sign">Supervisor</span></div>
        <div><small>Taken over by</small><span class="sh-line"></span></div>
      </footer>
    </article>
    <div class="sh-actions">
      <button class="primary take" data-a="take">Take the position</button>
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
  const passed = passedChallenges();
  const tiers = unlockedTiers(passed, hd.settings.unlockAll);
  const best = loadBest();
  const recs = loadRecords();
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
    return `<section class="tier ${open ? '' : 'locked'}"><h3><span>Tier ${t}</span> ${TIER_NAMES[t]} <small class="mono">${done}/${list.length}</small>${open ? '' : ` <small>· ${need}</small>`}</h3><div class="ch-grid">${cards}</div></section>`;
  }).join('');
  root.innerHTML = shell(`<h2>Challenges</h2><p class="lede ch-key">${(['pass', 'good', 'rated'] as Grade[]).map((g) => `${gradeChip(g)} ${GRADE_NAMES[g]}`).join('<span class="sep"></span>')}</p>${html}`);
  root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => hd.startChallenge(CHALLENGES.find((c) => c.id === b.dataset.ch)!)));
}

// ===========================================================================
// Records: the controller logbook
export function renderRecords(root: HTMLElement, hd: MenuHandlers) {
  const recs = loadRecords();
  const log = loadLogbook();
  const best = loadBest();
  const rank = rankOf(log, best);
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
  const tierTable = [1, 2, 3, 4].map((t) => `<div class="lb-tier"><h4><span class="mono">T${t}</span> ${TIER_NAMES[t]}</h4>${CHALLENGES.filter((c) => c.tier === t).map((c) => `<div class="lb-ch ${best[c.id] ? '' : 'none'}"><span>${esc(c.title)}</span>${best[c.id] ? gradeChip(best[c.id]) : '<i class="gmark empty"></i>'}</div>`).join('')}</div>`).join('');

  root.innerHTML = shell(`
    <h2>Controller logbook</h2>
    <section class="lb-rank">
      <div class="lb-badge"><small>Rank</small><b>${rank.name}</b></div>
      <ol class="lb-ladder">${ladder}</ol>
      ${rank.next ? `<div class="lb-next"><h3>For ${rank.next}</h3><ul>${rank.reqs.map((r) => `<li class="${r.ok ? 'ok' : ''}"><i>${r.ok ? '✓' : ''}</i>${esc(r.text)}</li>`).join('')}</ul></div>` : '<div class="lb-next"><h3>Top of the ladder</h3><p class="lede">You run the room now.</p></div>'}
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
      <section class="panel"><h3>Best grade per challenge</h3><div class="lb-tiers">${tierTable}</div></section>
      <section class="panel"><h3>Notable</h3>${log.events.length ? `<ul class="lb-events">${[...log.events].reverse().slice(0, 14).map((e) => `<li class="ev-${e.kind}"><span class="mono">${evIcon[e.kind]}</span><div>${esc(e.text)}<small class="mono">${e.date.slice(0, 10)}</small></div></li>`).join('')}</ul>` : '<p class="lede">Emergencies you bring home, rated sessions and promotions appear here.</p>'}</section>
    </div>
    ${recs.length ? `
    <section class="trend"><h3>Competency trend <small>last ${last.length} sessions, 1 to 5</small></h3>${COMPS.map(spark).join('')}</section>
    ${weakest ? `<p class="lede">Weakest recently: <b>${COMP_PLAIN[weakest].toLowerCase()}</b>.${ch ? ` Suggested next: <button class="link" data-ch="${ch.id}">${esc(ch.title)}</button>` : ''}</p>` : ''}
    <div class="rec-wrap"><table class="rec"><thead><tr><th>Date</th><th>Session</th><th>Landed</th><th>Grade</th></tr></thead><tbody>
    ${[...recs].reverse().slice(0, 40).map((r) => { const g = r.grade ?? (r.passed ? 'pass' : r.gatePass ? 'pass' : 'fail'); return `<tr><td class="mono">${r.date.slice(5, 16).replace('T', ' ')}</td><td>${esc(r.title)}</td><td class="mono">${r.landed}/${r.arrivals}</td><td>${gradeChip(g)} ${g === 'fail' ? 'Not yet' : GRADE_NAMES[g]}</td></tr>`; }).join('')}
    </tbody></table></div>` : '<p class="lede">No sessions yet. Your first debrief starts the logbook.</p>'}`, true, 'records');
  root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => hd.startChallenge(CHALLENGES.find((c) => c.id === b.dataset.ch)!)));
}

export function renderSettings(root: HTMLElement, hd: MenuHandlers) {
  const s = hd.settings;
  const tog = (k: keyof Settings, label: string, note = '') => `<label class="toggle"><input type="checkbox" data-k="${k}" ${s[k] ? 'checked' : ''}><span>${label}${note ? `<small>${note}</small>` : ''}</span></label>`;
  const radio = (k: keyof Settings, label: string, opts: [string, string][]) => `<fieldset><legend>${label}</legend>${opts.map(([v, l]) => `<label><input type="radio" name="${k}" data-k="${k}" value="${v}" ${String(s[k]) === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`;
  root.innerHTML = shell(`
    <h2>Settings</h2>
    <div class="form">
      ${tog('voice', 'Pilot voices', 'Spoken readbacks at 1× speed')}
      ${tog('speakAtc', 'Speak my clearances too')}
      ${tog('quickMode', 'Quick mode', 'Each picker choice transmits at once')}
      ${tog('trainingWheels', 'Training wheels', 'Warnings block the transmission')}
      ${tog('leftHanded', 'Left-handed layout')}
      ${tog('unlockAll', 'Unlock all challenges')}
      ${radio('labelSize', 'Label size', [['S', 'Small'], ['M', 'Medium'], ['L', 'Large']])}
      ${radio('radarRefresh', 'Radar update', [['4', '4 s (realistic)'], ['1', '1 s (smooth)']])}
      ${radio('brightness', 'Console brightness', [['night', 'Night'], ['day', 'Day']])}
      ${radio('speedVectorMin', 'Speed vector', [['1', '1 min'], ['2', '2 min'], ['3', '3 min']])}
      <fieldset><legend>Voice speed</legend><input type="range" min="0.8" max="1.4" step="0.02" data-k="speechRate" value="${s.speechRate}"></fieldset>
    </div>
  `);
  root.querySelectorAll<HTMLInputElement>('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.k as keyof Settings;
    const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'range' ? Number(inp.value) : (['radarRefresh', 'speedVectorMin'].includes(k) ? Number(inp.value) : inp.value);
    (s as any)[k] = v;
    saveSettings(s);
  }));
}

// ===========================================================================
// Help: controls, shorthand, label anatomy, colours, glossary
export function renderHelp(root: HTMLElement) {
  const sk = SKIN.night;
  const controls: [string, string, string, string][] = [
    ['Select an aircraft', 'Tap its track, label, strip or AMAN entry', 'Click', '<kbd>Tab</kbd> next pilot waiting · type the callsign'],
    ['Heading', 'Drag from the aircraft and lift', 'Drag, or wheel over the label', '<span class="mono">H250 L250 R250</span>'],
    ['Direct to a fix', 'Drag from the aircraft and lift on the fix', 'Drag onto the fix', '<span class="mono">DCT LIBVA</span> · <span class="mono">&gt;LIBVA</span>'],
    ['Level', 'Tap the level line of the label', 'Click it, or wheel', '<span class="mono">D40 C80 A30 FL070</span>'],
    ['Speed', 'Tap the speed line', 'Click it, or wheel', '<span class="mono">S210 S160/4 SMIN SRES</span>'],
    ['Approach and transitions', 'Tap the bottom line', 'Click it', '<span class="mono">ILS RNP22L ALHUV1A HOLD</span>'],
    ['More orders', 'Long-press a track', 'Long-press', '<span class="mono">RON SQ4521</span>'],
    ['Transmit', 'SEND', 'SEND', '<kbd>Enter</kbd>'],
    ['Clear the bar', '×', '×', '<kbd>Esc</kbd>'],
    ['Pause', '❚❚', '❚❚', '<kbd>Space</kbd>'],
    ['Zoom and pan', 'Pinch, drag empty scope', 'Wheel on empty scope, drag', '+ − ◎ buttons'],
    ['Measure', 'RBL, then two points', 'RBL, then two points', ''],
  ];
  const shorthand: [string, string][] = [
    ['H250 · L250 · R250', 'Heading 250, shortest way / turn left / turn right'],
    ['D40 · C80 · A30 · FL070', 'Descend 4,000 ft · climb FL080 · altitude 3,000 ft · flight level 70. Below the transition level numbers are feet.'],
    ['S210 · S160/4 · SMIN · SRES', 'Speed 210 kt · 160 kt until 4 NM · minimum clean speed · resume normal speed'],
    ['DCT LIBVA · >LIBVA', 'Direct to a fix'],
    ['ALHUV1A · ILS · RNP22L · VIS22L', 'Transition · ILS on the runway in use · RNP or visual approach'],
    ['HOLD · HOLD ALHUV', 'Hold at the published fix (give an expected time)'],
    ['TWR · BRU · MIL', 'Hand off to Tower · Brussels · military control'],
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
    [sk.tsaOn, 'Amber outline', 'Active military area (TSA)'],
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
      <p class="lede">Pilots read back every instruction. Some get it wrong on purpose: re-issue the item within 30 seconds to correct them. A flashing box around a callsign means that pilot is waiting for you.</p>
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
          <div>LOC22L D8.4</div>
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
      <p class="lede">Liège in one paragraph: every STAR ends at ALHUV, right over the 22L threshold. X-series STARs feed runway 22, D-series loop south through RUDIX for runway 04. RNAV transitions (ALHUV1A to 1Z) lead to the intermediate fix at 2,500 ft (22) or 3,000 ft (04). Departures climb to FL060 and must go to Brussels before they leave the 40 NM sector.</p>
    </section>

    <section class="hp-sec" id="hp-glossary">
      <h3>Glossary</h3>
      <input class="hp-search" type="search" placeholder="Find a term" aria-label="Find a term">
      ${GLOSSARY_GROUPS.map((g) => `<div class="hp-group"><h4>${g.title}</h4><dl class="hp-gl">${g.terms.filter((t) => GLOSSARY[t]).map((t) => `<div data-term="${esc(t.toLowerCase())} ${esc(GLOSSARY[t].toLowerCase())}"><dt>${esc(t)}</dt><dd>${esc(GLOSSARY[t])}</dd></div>`).join('')}</dl></div>`).join('')}
    </section>
  `, true, 'help');
  const q = root.querySelector<HTMLInputElement>('.hp-search')!;
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    root.querySelectorAll<HTMLElement>('[data-term]').forEach((el) => { el.hidden = !!s && !el.dataset.term!.includes(s); });
    root.querySelectorAll<HTMLElement>('.hp-group').forEach((g) => { g.hidden = !g.querySelector('[data-term]:not([hidden])'); });
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

export function renderDebrief(root: HTMLElement, r: Result, hd: { replay(t: number): void; retry(): void; home(): void; next?: () => void }, data?: DebriefData) {
  const pips = (v: number | null) => v === null ? '<span class="na">n/a, no evidence</span>' : `<span class="pips" aria-label="${v} of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''} r${v}"></i>`).join('')}</span><b class="mono">${v}</b>`;
  const end = data?.endReason === 'complete' ? 'Traffic complete' : data?.endReason === 'time' ? 'Session time up' : data?.endReason === 'manual' ? 'Ended by you' : '';
  const g = r.grade;
  const sug = r.suggested ? CHALLENGES.find((c) => c.id === r.suggested) : undefined;
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
      ${g !== 'rated' && r.gradeNotes.length ? `<section class="db-notes g-${g}"><h3>${NEXT_GRADE[g]}</h3><ul>${r.gradeNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></section>` : g === 'rated' ? '<section class="db-notes g-rated"><h3>Top grade</h3><p>Safe, tight and quiet. Nothing left to ask for.</p></section>' : ''}
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
