import { CHALLENGES, TIER_NAMES } from '../engine/scenarios';
import type { Scenario } from '../engine/types';
import type { FreePlayOpts } from '../engine/traffic';
import { COMPS, COMP_NAMES, type Result } from '../engine/assess';
import { loadRecords, passedChallenges, saveSettings, type Settings } from '../store';
import type { Comp } from '../engine/types';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface MenuHandlers {
  startChallenge(sc: Scenario): void;
  startFree(o: FreePlayOpts): void;
  settings: Settings;
  liveMetar(): Promise<string | undefined>;
}

const shell = (inner: string, back = true) => `
  <div class="menu">
    <div class="menu-inner">
      ${back ? '<button class="back" data-go="home">‹ Back</button>' : ''}
      ${inner}
    </div>
  </div>`;

export function unlockedTiers(settings: Settings): Set<number> {
  const passed = passedChallenges();
  const tiers = new Set([1]);
  if (settings.unlockAll) return new Set([1, 2, 3, 4]);
  const n = (t: number) => CHALLENGES.filter((c) => c.tier === t && passed.has(c.id)).length;
  if (n(1) >= 2) tiers.add(2);
  if (tiers.has(2) && n(2) >= 3) tiers.add(3);
  if (tiers.has(3) && n(3) >= 3) tiers.add(4);
  return tiers;
}

export function renderHome(root: HTMLElement, hd: MenuHandlers) {
  const recs = loadRecords();
  const last = recs[recs.length - 1];
  root.innerHTML = shell(`
    <header class="brand">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <h1>Liège Approach</h1>
        <p class="sub mono">EBLG · APP 119.280 · RWY 04R/22L</p>
      </div>
    </header>
    <nav class="home-grid">
      <button class="card big" data-go="free"><b>Free play</b><span>Generated traffic. Pick the hour, the weather and how much military and transient traffic to mix in.</span></button>
      <button class="card big" data-go="challenges"><b>Challenges</b><span>18 scripted scenarios in four tiers, from one freighter to a compound emergency night.</span></button>
      <button class="card" data-go="records"><b>Records</b><span>${recs.length ? `${recs.length} sessions · last: ${esc(last.title)}` : 'Your sessions and competency trend'}</span></button>
      <button class="card" data-go="settings"><b>Settings</b><span>Voices, labels, input, brightness</span></button>
      <button class="card" data-go="help"><b>How to control</b><span>Tap, drag, type: the clearance loop in one page</span></button>
    </nav>
    <p class="fine">Not a training device. Procedures transcribed from the Belgian AIP; some airspace is approximate. Flights are fictional.</p>
  `, false);
}

export function renderFree(root: HTMLElement, hd: MenuHandlers) {
  root.innerHTML = shell(`
    <h2>Free play</h2>
    <form class="form" data-e="free">
      <fieldset><legend>Hour</legend>
        <label><input type="radio" name="template" value="night" checked><span>Night bank<small>18 arr/h, freighters</small></span></label>
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
      <fieldset><legend>Military and transient traffic</legend>
        <label><input type="radio" name="military" value="0"><span>None</span></label>
        <label><input type="radio" name="military" value="1" checked><span>Light<small>VFR crosser, HEMS</small></span></label>
        <label><input type="radio" name="military" value="2"><span>Busy<small>+ fighters, E-3A, TSA</small></span></label>
        <label><input type="radio" name="military" value="3"><span>Heavy<small>+ C-17, flight check, A400M</small></span></label>
      </fieldset>
      <fieldset><legend>Session</legend>
        <label><input type="radio" name="duration" value="30"><span>30 min</span></label>
        <label><input type="radio" name="duration" value="45" checked><span>45 min</span></label>
        <label><input type="radio" name="duration" value="60"><span>60 min</span></label>
      </fieldset>
      <fieldset><legend>Difficulty <small>(wrong readbacks, similar callsigns)</small></legend>
        ${[1, 2, 3, 4, 5].map((d) => `<label><input type="radio" name="difficulty" value="${d}" ${d === 3 ? 'checked' : ''}><span>${d}</span></label>`).join('')}
      </fieldset>
      <label class="toggle"><input type="checkbox" name="emergencies"><span>Random emergency</span></label>
      <button class="primary" type="submit">Start</button>
      <p class="fine" data-e="status"></p>
    </form>
  `);
  const form = root.querySelector('form')!;
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

export function renderChallenges(root: HTMLElement, hd: MenuHandlers) {
  const passed = passedChallenges();
  const tiers = unlockedTiers(hd.settings);
  const recs = loadRecords();
  const html = [1, 2, 3, 4].map((t) => {
    const open = tiers.has(t);
    const cards = CHALLENGES.filter((c) => c.tier === t).map((c) => {
      const tries = recs.filter((r) => r.scenarioId === c.id).length;
      return `<button class="card ch ${passed.has(c.id) ? 'passed' : ''}" data-ch="${c.id}" ${open ? '' : 'disabled'}>
        <b>${esc(c.title)}</b><span>${esc(c.desc)}</span>
        <em>${passed.has(c.id) ? 'Passed' : tries ? `${tries} attempt${tries > 1 ? 's' : ''}` : `${c.durationMin} min`}</em></button>`;
    }).join('');
    const need = t === 2 ? 'Pass two Tier 1 challenges to unlock' : t > 2 ? `Pass three Tier ${t - 1} challenges to unlock` : '';
    return `<section class="tier ${open ? '' : 'locked'}"><h3><span>Tier ${t}</span> ${TIER_NAMES[t]}${open ? '' : ` <small>· ${need}</small>`}</h3><div class="ch-grid">${cards}</div></section>`;
  }).join('');
  root.innerHTML = shell(`<h2>Challenges</h2>${html}`);
  root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => b.addEventListener('click', () => hd.startChallenge(CHALLENGES.find((c) => c.id === b.dataset.ch)!)));
}

export function renderRecords(root: HTMLElement, hd: MenuHandlers) {
  const recs = loadRecords();
  if (!recs.length) { root.innerHTML = shell('<h2>Records</h2><p class="lede">No sessions yet. Your competency trend appears here after the first debrief.</p>'); return; }
  const last5 = recs.slice(-8);
  const spark = (c: Comp) => {
    const vals = last5.map((r) => r.ratings[c]);
    const pts = vals.map((v, i) => (v === null ? null : `${(i / Math.max(1, vals.length - 1)) * 100},${30 - (v - 1) * 6.5}`)).filter(Boolean);
    const latest = [...vals].reverse().find((v) => v !== null);
    return `<div class="trend-row"><span>${COMP_NAMES[c]}</span><svg viewBox="-4 -4 108 38" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(' ')}"/></svg><b class="mono">${latest ?? '—'}</b></div>`;
  };
  const avg = (c: Comp) => { const v = recs.slice(-5).map((r) => r.ratings[c]).filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 9; };
  const weakest = COMPS.filter((c) => avg(c) < 9).sort((a, b) => avg(a) - avg(b))[0];
  const sugg = [...recs].reverse().find((r) => r.suggested)?.suggested;
  const ch = CHALLENGES.find((c) => c.id === sugg);
  root.innerHTML = shell(`
    <h2>Records</h2>
    <section class="trend"><h3>Competency trend <small>last ${last5.length} sessions, 1 to 5</small></h3>${COMPS.map(spark).join('')}</section>
    ${weakest ? `<p class="lede">Weakest recently: <b>${COMP_NAMES[weakest]}</b>.${ch ? ` Suggested next: <button class="link" data-ch="${ch.id}">${esc(ch.title)}</button>` : ''}</p>` : ''}
    <table class="rec"><thead><tr><th>Date</th><th>Session</th><th>Gate</th><th>Landed</th><th>Result</th></tr></thead><tbody>
    ${[...recs].reverse().slice(0, 40).map((r) => `<tr><td class="mono">${r.date.slice(5, 16).replace('T', ' ')}</td><td>${esc(r.title)}</td><td class="${r.gatePass ? 'ok' : 'bad'}">${r.gatePass ? 'Pass' : 'Fail'}</td><td class="mono">${r.landed}/${r.arrivals}</td><td>${r.passed === undefined ? '—' : r.passed ? '<span class="ok">Passed</span>' : 'Not yet'}</td></tr>`).join('')}
    </tbody></table>`);
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

export function renderHelp(root: HTMLElement) {
  root.innerHTML = shell(`
    <h2>How to control</h2>
    <ol class="help">
      <li><b>Select.</b> Tap a track, its label, its strip or its AMAN entry. <kbd>Tab</kbd> or <b>CALLS</b> jumps to the next pilot waiting for you. A flashing box around a callsign means that pilot is waiting.</li>
      <li><b>Compose.</b> Drag from the aircraft to set a heading; release on a fix for a direct. Tap the level line of a label for the level ladder, the speed line for speeds, the bottom line for approaches. Or use the buttons: HDG, LVL, SPD, DCT, ILS, TRANS, HOLD, TWR, BRU, MORE.</li>
      <li><b>Check.</b> The bar shows the exact phraseology before you send. Amber warnings: below MVA, unflyable speed, poor intercept, same level as nearby traffic.</li>
      <li><b>Transmit.</b> One tap, or <kbd>Enter</kbd>. Desktop: type the whole thing, <span class="mono">DHK7 L250 D40 S210 ILS</span> then <kbd>Enter</kbd>.</li>
      <li><b>Hear back.</b> Pilots read back. Some get it wrong, on purpose. Re-issue the item within 30 seconds to correct them.</li>
    </ol>
    <h3>Typed shorthand</h3>
    <table class="rec"><tbody>
      <tr><td class="mono">H250 · L250 · R250</td><td>Heading, shortest / left / right</td></tr>
      <tr><td class="mono">D40 · C80 · A30 · FL070</td><td>Descend 4,000 ft · climb FL080 · altitude · flight level</td></tr>
      <tr><td class="mono">S210 · S160/4 · SMIN · SRES</td><td>Speed · until 4 DME · minimum clean · resume</td></tr>
      <tr><td class="mono">DCT LIBVA · &gt;LIBVA</td><td>Direct to a fix</td></tr>
      <tr><td class="mono">ALHUV1A · ILS · RNP22L</td><td>Transition · ILS on the runway in use · other approach</td></tr>
      <tr><td class="mono">HOLD · TWR · BRU · RON</td><td>Hold ALHUV · contact Tower / Brussels · resume own navigation</td></tr>
      <tr><td class="mono">Y · N</td><td>Approve / unable a pilot request</td></tr>
    </tbody></table>
    <h3>Liège in one paragraph</h3>
    <p class="lede">Every STAR ends at ALHUV, right over the 22L threshold. X-series STARs feed runway 22, D-series loop south through RUDIX for runway 04. RNAV transitions (ALHUV1A–1Z) lead to the intermediate fix at 2,500 ft (22) or 3,000 ft (04). Departures climb to FL060 initially and must be handed to Brussels before they leave the 40 NM sector. Wake spacing on final follows RECAT-EU.</p>
  `);
}

export function renderDebrief(root: HTMLElement, r: Result, hd: { replay(t: number): void; retry(): void; home(): void; next?: () => void }) {
  const bar = (v: number | null) => v === null ? '<span class="na">n/a</span>' : `<span class="bar5"><i style="width:${v * 20}%"></i></span><b class="mono">${v}</b>`;
  root.innerHTML = `
  <div class="menu debrief">
    <div class="menu-inner">
      <header class="db-head">
        <div><h2>${esc(r.title)}</h2><p class="sub mono">${r.durationMin} min · seed ${r.seed} · ${r.landed}/${r.arrivals} landed</p></div>
        ${r.pass ? `<div class="verdict ${r.pass.ok ? 'ok' : 'bad'}">${r.pass.ok ? 'CHALLENGE PASSED' : 'NOT PASSED YET'}</div>` : ''}
      </header>
      <div class="db-grid">
        <section class="panel gate ${r.gate.pass ? 'ok' : 'bad'}"><h3>Safety gate <b>${r.gate.pass ? 'PASS' : 'FAIL'}</b></h3>
          <ul>${r.gate.lines.map((l) => `<li class="${l.bad ? 'bad' : ''}">${esc(l.text)}</li>`).join('')}</ul>
          <p class="fine">A loss of separation beyond 10% of the minimum, or a serious MVA bust, fails the session.</p></section>
        <section class="panel"><h3>Effectiveness</h3><dl class="metrics">${r.metrics.map((m) => `<dt>${esc(m.label)}</dt><dd class="mono">${esc(m.value)}</dd>`).join('')}</dl></section>
        <section class="panel comps"><h3>Competencies <small>ICAO units, 1 to 5</small></h3>
          ${COMPS.map((c) => `<div class="comp"><span title="${esc(r.evidence[c])}">${COMP_NAMES[c]}</span>${bar(r.ratings[c])}<small>${esc(r.evidence[c])}</small></div>`).join('')}</section>
        <section class="panel"><h3>Costliest decisions</h3>
          ${r.costliest.length ? r.costliest.map((e) => `<div class="cost"><div><b class="mono">${fmtT(e.t, r)}</b> ${esc(e.text)}</div><button data-replay="${e.replayT}">Replay from here</button></div>`).join('') : '<p class="lede">Nothing cost you anything worth replaying.</p>'}
          ${r.pass ? `<h3 class="sp">Pass criteria</h3><ul class="crit">${r.pass.reasons.map((x) => `<li class="${x.ok ? 'ok' : 'bad'}">${x.ok ? '✓' : '✗'} ${esc(x.text)}</li>`).join('')}</ul>` : ''}
        </section>
        <section class="panel wide"><h3>Debrief</h3>${r.narrative.map((n) => `<p>${esc(n)}</p>`).join('')}</section>
      </div>
      <div class="db-actions">
        <button class="primary" data-a="retry">Try again</button>
        ${r.suggested && hd.next ? '<button data-a="next">Suggested next challenge</button>' : ''}
        <button data-a="home">Menu</button>
      </div>
    </div>
  </div>`;
  root.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach((b) => b.addEventListener('click', () => hd.replay(Number(b.dataset.replay))));
  root.querySelector('[data-a="retry"]')!.addEventListener('click', hd.retry);
  root.querySelector('[data-a="home"]')!.addEventListener('click', hd.home);
  root.querySelector('[data-a="next"]')?.addEventListener('click', () => hd.next?.());
}
const fmtT = (t: number, r: Result) => `+${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
