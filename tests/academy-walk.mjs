// Walk the 2.0 academy through the real phone UI (390×844, touch, dpr 2), both curricula.
// A student who does what the coach says: taps the control the coach highlights, answers the
// coach's questions, taps the aircraft a step is about, presses Next and Skip ahead. When a step
// offers nothing to tap it takes the bright suggestion chip (logged as a fallback). Exams are flown
// with the lesson's own instructor solution. Checks on the way: page errors, the coach card covering
// the control it points at, and that every exam ends in a pass.
//
//   npm run build && (npx vite preview --port 4371 --strictPort &) && OUT=/tmp/academy node tests/academy-walk.mjs [EBLG|EDDL|lesson-id,...]
import fs from 'fs';
const PW = process.env.PW ?? '/home/claude/liege-approach/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const OUT = process.env.OUT ?? './academy-shots';
const URL = process.env.URL ?? 'http://localhost:4371/';
const arg = process.argv[2] ?? 'EBLG,EDDL';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const problems = [], notes = [], results = [];
const log = (...a) => console.log(...a);
page.on('pageerror', (e) => { problems.push(`PAGEERROR ${e.message}`); log('PAGEERROR', e.message); });
page.on('console', (m) => { if (m.type() === 'error') log('CONSOLE', m.text()); });
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(URL);
await wait(900);
await page.evaluate(() => { try { localStorage.removeItem('lgg.tutorial'); } catch {} });
const ids = await page.evaluate((a) => {
  const L = window.__lgg.lessons;
  return a.split(',').flatMap((x) => (/^[A-Z]{4}$/.test(x) ? L.for(x).map((l) => l.id) : [x]));
}, arg);

const state = () => page.evaluate(() => {
  const c = document.querySelector('.coach');
  if (!c) return null;
  const vis = (sel) => { const e = c.querySelector(sel); return !!e && e.getClientRects().length > 0; };
  const hl = document.querySelector('.coach-hl');
  const hlVis = !!hl && hl.getClientRects().length > 0 && getComputedStyle(hl).visibility !== 'hidden';
  let covered = false;
  if (hlVis) {
    const a = hl.getBoundingClientRect(), b = c.getBoundingClientRect();
    const cx = a.left + a.width / 2, cy = a.top + a.height / 2;
    covered = cx > b.left && cx < b.right && cy > b.top && cy < b.bottom;
  }
  return { collapsed: c.classList.contains('collapsed'), phase: c.dataset.phase, step: c.dataset.step, next: vis('[data-c="next"]'), ff: vis('[data-c="ff"]'), start: vis('[data-c="startExam"]'), ask: vis('[data-c="ask"]'), hl: hlVis, covered, t: window.__lgg.game?.sim.t ?? 0 };
});

async function tapLoc(loc) {
  const box = await loc.boundingBox().catch(() => null);
  if (!box) return false;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}
/** answer the open coach question with the right option */
async function answer(id) {
  const k = await page.evaluate((lid) => {
    const l = window.__lgg.lessons.byId(lid); const g = window.__lgg.game;
    const st = l.steps.find((s) => s.id === document.querySelector('.coach').dataset.step);
    return typeof st.ask.correct === 'function' ? st.ask.correct(g) : st.ask.correct;
  }, id);
  await tapLoc(page.locator(`.coach [data-c="ask"][data-k="${k}"]`).first());
}
/** tap the aircraft a step is about, on the scope (what a student does for "select it" steps) */
async function tapAircraft(id) {
  const p = await page.evaluate((lid) => {
    const l = window.__lgg.lessons.byId(lid); const g = window.__lgg.game;
    const st = l.steps.find((s) => s.id === document.querySelector('.coach').dataset.step);
    const m = typeof st.mark === 'function' ? st.mark(g) : st.mark;
    const cs = st.cs ?? m?.cs;
    const a = cs && g.sim.find(cs);
    if (!a || g.cs === cs) return null;
    const s = g.scope.toS(g.scope.plot ? g.scope.plot(a) : a.p), r = g.scope.canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y, cs };
  }, id);
  if (!p) return false;
  await page.touchscreen.tap(p.x, p.y);
  return true;
}
/** a step about a fix on the scope: tap the fix */
async function tapMarkedFix(id) {
  const p = await page.evaluate((lid) => {
    const l = window.__lgg.lessons.byId(lid); const g = window.__lgg.game;
    const st = l.steps.find((s) => s.id === document.querySelector('.coach').dataset.step);
    const m = typeof st.mark === 'function' ? st.mark(g) : st.mark;
    const fx = m?.fix && g.sim.pack.fixes.get(m.fix);
    if (!fx) return null;
    const s = g.scope.toS(fx.p), r = g.scope.canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y };
  }, id);
  if (!p) return false;
  await page.touchscreen.tap(p.x, p.y);
  return true;
}
/** a step that wants a tap on an area of the scope: try a grid of points, nearest the centre first */
async function probeTaps(n) {
  const r = await page.evaluate(() => { const b = window.__lgg.game.scope.canvas.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height }; });
  const pts = [];
  for (let i = 1; i < 7; i++) for (let j = 1; j < 9; j++) pts.push({ x: r.l + (r.w * i) / 7, y: r.t + (r.h * j) / 9 });
  pts.sort((a, b) => Math.hypot(a.x - r.l - r.w / 2, a.y - r.t - r.h / 2) - Math.hypot(b.x - r.l - r.w / 2, b.y - r.t - r.h / 2));
  const p = pts[n % pts.length];
  await page.touchscreen.tap(p.x, p.y);
}
/** the bright chip for the step's aircraft (fallback when a step names nothing to tap) */
async function leadChip(id) {
  return page.evaluate((lid) => {
    const l = window.__lgg.lessons.byId(lid); const g = window.__lgg.game;
    const st = l.steps.find((s) => s.id === document.querySelector('.coach').dataset.step);
    const m = typeof st.mark === 'function' ? st.mark(g) : st.mark;
    const cs = st.cs ?? m?.cs ?? g.cs;
    if (!cs || !g.sim.find(cs) || g.sim.readbackPending(cs)) return false;
    if (g.cs !== cs) g.select(cs, true);
    const b = document.querySelector('.sg.lead') ?? [...document.querySelectorAll('.sg')][0];
    if (!b) return false;
    b.click();
    return b.textContent.trim().slice(0, 40);
  }, id);
}
/** fly the exam with the lesson's instructor solution, the sim stepped from the page */
async function flyExam(id) {
  return page.evaluate(async (lid) => {
    const l = window.__lgg.lessons.byId(lid); const g = window.__lgg.game;
    const ex = l.exam;
    if (ex.quiz) {
      for (let q = 0; q < ex.quiz.length; q++) {
        const k = ex.quiz[q].answer(g.sim);
        const b = document.querySelector(`.coach [data-c="quiz"][data-k="${k}"]`);
        if (b) { b.click(); await new Promise((r) => setTimeout(r, 250)); }
      }
      return 'quiz';
    }
    g.setSpeed(0);
    const done = new Set();
    const once = (k, c) => (c && !done.has(k) ? (done.add(k), true) : false);
    const say = (cs, items) => { g.sim.issue({ cs, items }); };
    for (let i = 0; i < (ex.limitS ?? 3600) + 600; i++) {
      if (!document.querySelector('.coach') || document.querySelector('.coach').dataset.phase !== 'exam') break;
      if (ex.solution) ex.solution(g.sim, once, say); else window.__lgg.autoControl(g.sim);
      g.sim.step();
      if (i % 120 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return 'flown';
  }, id);
}

for (const id of ids) {
  log(`\n=== ${id}`);
  const before = results.length + problems.length;
  await page.evaluate((lid) => window.__lgg.lesson(lid), id);
  await wait(800);
  let last = '', stuck = 0, shotN = 0, fallbacks = 0, lastT = -1, still = 0;
  const acted = new Set();
  for (let k = 0; k < 900; k++) {
    const st = await state();
    if (!st) { problems.push(`${id}: coach vanished`); break; }
    if (st.t !== lastT) { lastT = st.t; still = 0; } else still++;
    const key = `${st.phase}:${st.step}`;
    if (key !== last) {
      last = key; stuck = 0;
      if (st.phase === 'steps') { shotN++; await wait(350); await page.screenshot({ path: `${OUT}/${id}-${String(shotN).padStart(2, '0')}-${st.step}.png` }); log(`  step ${st.step} t=${st.t}`); }
    } else stuck++;
    if (st.covered) { const n = `${id}/${st.step}: the coach covers the control it points at`; if (!problems.includes(n)) problems.push(n); }
    if (st.phase === 'intro') { await tapLoc(page.locator('.coach [data-c="startExam"]').first()); await wait(600); continue; }
    if (st.phase === 'exam') { const how = await flyExam(id); await wait(900); if (stuck > 30) { problems.push(`${id}: exam did not finish (${how})`); break; } continue; }
    if (st.phase === 'result' || st.phase === 'replay') {
      await wait(300); await page.screenshot({ path: `${OUT}/${id}-result.png` });
      const v = await page.evaluate(() => (document.querySelector('.coach-verdict')?.textContent ?? '').trim() + ' · ' + (document.querySelector('.coach p')?.textContent ?? '').trim());
      log(`  RESULT ${v}`); results.push(`${id}: ${v}${fallbacks ? ` (${fallbacks} fallback taps)` : ''}`);
      if (!/^PASS/i.test(v)) problems.push(`${id} exam: ${v}`);
      break;
    }
    if (st.ask && !st.next && !(await page.evaluate(() => !!document.querySelector(".coach .coach-why:not(.bad)")))) { await answer(id); await wait(300); continue; }
    if (st.collapsed && !st.hl && stuck % 3 === 1) { await tapLoc(page.locator('.coach [data-c="min"]').first()); await wait(300); continue; }
    if (st.hl && stuck % 4 === 0) { await tapLoc(page.locator('.coach-hl >> visible=true').first()); await wait(450); continue; }
    if (st.next) { await tapLoc(page.locator('.coach [data-c="next"]').first()); await wait(300); continue; }
    if (!acted.has(st.step) && (await tapAircraft(id))) { acted.add(st.step); await wait(400); continue; }
    if (!acted.has('fix:' + st.step) && (await tapMarkedFix(id))) { acted.add('fix:' + st.step); await wait(400); continue; }
    if (!st.hl && !st.ff && !st.next && stuck > 8 && stuck <= 40) { await probeTaps(stuck - 9); await wait(250); continue; }
    if (st.ff && stuck > 4) { await tapLoc(page.locator('.coach [data-c="ff"]').first()); await wait(700); continue; }
    if (stuck > 25 && stuck % 10 === 6) { const c = await leadChip(id); if (c) { fallbacks++; notes.push(`${id}/${st.step}: fallback tap on "${c}"`); await wait(500); continue; } }
    // a step that wants typing: type what its title says ("Type 4ek D70 S210, Enter")
    if (stuck === 6) {
      const typed = await page.evaluate(() => { const t = document.querySelector('.coach h4')?.textContent ?? ''; const m = t.match(/^Type (.+?),? (?:then )?Enter/i); return m ? m[1] : null; });
      if (typed) { if (!(await page.locator('[data-e="cmd"] >> visible=true').count())) await tapLoc(page.locator('[data-a="kbd"]').first()); await page.locator('[data-e="cmd"]').first().focus(); await page.locator('[data-e="cmd"]').first().fill(''); await page.keyboard.type(typed); await page.keyboard.press('Enter'); await wait(500); notes.push(`${id}/${st.step}: typed "${typed}"`); continue; }
    }
    // a drag-only step (dial, drag from an aircraft, ruler, strip order): the walker cannot drag, so it skips and says so
    if (stuck >= 70 && still >= 40 && (await page.locator('.coach [data-c="skip"] >> visible=true').count())) { notes.push(`${id}/${st.step}: skipped (gesture the walker cannot make)`); await tapLoc(page.locator('.coach [data-c="skip"] >> visible=true').first()); await wait(500); continue; }
    if ((stuck > 160 && still > 60) || stuck > 600) { problems.push(`${id}: stuck at ${st.step}`); await page.screenshot({ path: `${OUT}/${id}-STUCK-${st.step}.png` }); break; }
    await wait(300);
  }
  if (results.length + problems.length === before) { const st = await state(); problems.push(`${id}: walker gave up at ${st?.phase}:${st?.step}`); }
}
log('\n=== Results'); for (const r of results) log(r);
log('\n=== Notes'); for (const n of notes) log(n);
log('\n=== Problems'); for (const p of problems) log(p);
log(problems.length ? `${problems.length} problems` : 'no problems');
await browser.close();
process.exit(problems.length ? 1 : 0);
