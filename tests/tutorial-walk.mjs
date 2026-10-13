// Phone walkthrough of every lesson through the real UI (390×844, touch, dpr 2).
// Taps the controls the coach names: suggestion chips, picker buttons, the heading
// dial, drags on the scope, intercom buttons, the coach's own buttons. sim.step()
// is used only to skip time inside exams. Screenshots go to $OUT.
//
//   npx vite build && (npx vite preview --port 4371 --strictPort &) && OUT=/tmp/shots node tests/tutorial-walk.mjs [lessons, e.g. 1,5]
import fs from 'fs';
const PW = process.env.PW ?? '/home/claude/liege-approach/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const OUT = process.env.OUT ?? './tut-shots';
const URL = process.env.URL ?? 'http://localhost:4371/';
const only = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const problems = [];
const log = (...a) => console.log(...a);
page.on('pageerror', (e) => { problems.push(`PAGEERROR ${e.message}`); log('PAGEERROR', e.message); });
page.on('crash', () => { problems.push('page crashed'); log('PAGE CRASHED'); });
page.on('console', (m) => { if (m.type() === 'error') log('CONSOLE', m.text()); });
const wait = (ms) => page.waitForTimeout(ms);

// ---------------------------------------------------------------- page helpers
const state = () => page.evaluate(() => {
  const c = document.querySelector('.coach');
  if (!c) return null;
  const vis = (sel) => { const e = c.querySelector(sel); return !!e && e.getClientRects().length > 0; };
  return { phase: c.dataset.phase, step: c.dataset.step, collapsed: c.classList.contains('collapsed'), next: vis('[data-c="next"]'), ff: !!c.querySelector('[data-c="ff"]'), start: vis('[data-c="startExam"]'), t: window.__lgg.game.sim.t };
});
const xy = (what) => page.evaluate((w) => {
  const g = window.__lgg.game;
  const p = w.cs ? (g.sim.find(w.cs) && g.scope.plot(g.sim.find(w.cs))) : g.sim.pack.fixes.get(w.fix)?.p ?? w.p;
  if (!p) return null;
  const s = g.scope.toS(p), r = g.scope.canvas.getBoundingClientRect();
  return { x: r.left + s.x, y: r.top + s.y };
}, what);
async function tap(sel, opts = {}) {
  const el = page.locator(`${sel} >> visible=true`).first();
  try { await el.tap({ timeout: 2500, ...opts }); } catch (e) { problems.push(`tap failed ${sel}: ${e.message.split('\n')[0]}`); log('  TAP FAILED', sel, e.message.split('\n').slice(0, 6).join(' | ')); }
  await wait(350);
}
async function tapChip(prefix) {
  const el = page.locator('.sg').filter({ hasText: new RegExp(`^\\s*${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first();
  try { await el.tap({ timeout: 2500 }); } catch { problems.push(`no chip "${prefix}"`); log(`  NO CHIP "${prefix}" for ${await page.evaluate(() => window.__lgg.game.cs)}:`, await page.evaluate(() => [...document.querySelectorAll('.sg')].map((b) => b.textContent.trim()).join(' | '))); }
  await wait(400);
}
async function tapAt(p) { if (!p) { problems.push('tapAt: no point'); return; } if (process.env.VERBOSE) log('  tapAt', Math.round(p.x), Math.round(p.y)); await page.touchscreen.tap(p.x, p.y); await wait(400); }
async function drag(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let k = 1; k <= steps; k++) { await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps); await wait(16); }
  await page.mouse.up(); await wait(450);
}
/** drag from an aircraft out along a magnetic heading */
async function dragHeading(cs, hdgMag, len = 90) {
  const a = await xy({ cs });
  const t = ((hdgMag + 2) * Math.PI) / 180;
  await drag(a, { x: a.x + Math.sin(t) * len, y: a.y - Math.cos(t) * len });
}
async function dial(hdgMag) {
  await tap('[data-p="hdg"]');
  const r = await page.locator('.picker .rose').boundingBox();
  if (!r) { problems.push('no heading dial'); return; }
  const a = (hdgMag * Math.PI) / 180, cx = r.x + r.width / 2, cy = r.y + r.height / 2, rr = r.width * 0.42;
  await page.mouse.click(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr);
  await wait(400);
}
async function picker(btn, key) { await tap(btn); await tap(`.picker [data-pick="${key}"]`); }
const send = () => tap('[data-a="send"]');
const notes = [];
const select = async (cs) => {
  await tapAt(await xy({ cs }));
  if (await page.evaluate((c) => window.__lgg.game.cs !== c, cs)) { notes.push(`tap on ${cs} selected ${await page.evaluate(() => window.__lgg.game.cs)}; used ☎/strip instead`); await page.evaluate((c) => window.__lgg.game.select(c, true), cs); }
};
const evalSim = (fn, arg) => page.evaluate(fn, arg);
/** let the clock run (sim.step) until a condition in the page is true */
async function ffUntil(cond, max = 900, chunk = 5) {
  for (let k = 0; k < max / chunk; k++) {
    const ok = await page.evaluate(([c, n]) => { const g = window.__lgg.game; const f = new Function('g', `return (${c})`); for (let i = 0; i < n; i++) { if (f(g)) return true; g.sim.step(); } return f(g); }, [cond, chunk]);
    if (ok) return true;
    await wait(30);
  }
  return false;
}
async function shot(name) { await wait(250); await page.screenshot({ path: `${OUT}/${name}.png` }); }

/** Is anything the coach points at covered by the coach card, or off screen? */
async function coverage(tag) {
  const r = await page.evaluate(() => {
    const c = document.querySelector('.coach'); if (!c) return null;
    const k = c.getBoundingClientRect();
    const g = window.__lgg.game;
    const out = { card: [Math.round(k.top), Math.round(k.bottom)], issues: [] };
    const over = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const hl = document.querySelector('.coach-hl');
    if (hl && hl.getClientRects().length) { const h = hl.getBoundingClientRect(); if (over(h, k) && !c.contains(hl)) out.issues.push(`highlighted ${hl.className.split(' ')[0]} under the card`); if (h.bottom > innerHeight || h.top < 0 || h.width === 0) out.issues.push(`highlighted ${hl.className.split(' ')[0]} off screen`); }
    for (const m of g.scope.marks) {
      const p = m.cs ? (g.sim.find(m.cs) && g.scope.plot(g.sim.find(m.cs))) : g.sim.pack.fixes.get(m.fix)?.p;
      if (!p) continue;
      const s = g.scope.toS(p), cr = g.scope.canvas.getBoundingClientRect();
      const pt = { x: cr.left + s.x, y: cr.top + s.y };
      if (pt.x >= k.left && pt.x <= k.right && pt.y >= k.top && pt.y <= k.bottom) out.issues.push(`mark ${m.cs ?? m.fix} under the card`);
      if (pt.x < cr.left || pt.x > cr.right || pt.y < cr.top || pt.y > cr.bottom) out.issues.push(`mark ${m.cs ?? m.fix} off the scope`);
    }
    // the coach must never cover the bar
    const bar = document.querySelector('.bar').getBoundingClientRect();
    if (k.bottom > bar.top + 1) out.issues.push('card overlaps the clearance bar');
    return out;
  });
  if (r?.issues.length) { for (const i of r.issues) problems.push(`${tag}: ${i}`); log(`  !! ${tag}: ${r.issues.join('; ')}`); }
  return r;
}

/** select the first established arrival still with you and tap its Tower chip */
async function towerChip() {
  const info = await evalSim(() => { const g = window.__lgg.game; const a = g.sim.aircraft.find((x) => x.state === 'assumed' && x.app?.locCap && !g.sim.readbackPending(x.cs)); return a && { cs: a.cs, ias: a.ias, t: g.sim.t, speed: g.speed }; });
  if (!info) return;
  if (process.env.VERBOSE) log('  towerChip', JSON.stringify(info));
  await select(info.cs);
  await tapChip(info.ias > 175 ? '160 to 4' : 'Tower');
  await wait(300);
  if (process.env.VERBOSE) log('   ->', JSON.stringify(await evalSim((c) => { const g = window.__lgg.game; const a = g.sim.find(c); return { cs: g.cs, state: a?.state, pend: g.sim.readbackPending(c), log: g.sim.log.slice(-2).map((t) => t.text) }; }, info.cs)));
}
// ---------------------------------------------------------------- per-lesson actions (by step id)
const ACTS = {
  1: {
    intro: async () => {
      // a glossary word in the coach text opens the glossary sheet; the coach steps up out of the way
      await tap('.coach .gl[data-gloss="NM"]');
      const kind = await page.evaluate(() => document.querySelector('.picker:not([hidden])')?.dataset.kind);
      if (kind !== 'gloss') problems.push(`glossary word did not open the glossary (${kind})`);
      await shot('L1-glossary');
      await tap('.picker [data-pick="#close"]');
    },
    zoom: async () => { await tap('[data-z="in"]'); await tap('[data-z="in"]'); },
    alhuv: async () => { await wait(600); await tapAt(await xy({ fix: 'ALHUV' })); },
    mva: async () => { await wait(600); await tapAt(await xy({ p: { x: -2, y: -26 } })); },
    select: async () => { await select('QTR8125'); },
    levels: async () => { await tap('.coach [data-c="ask"][data-k="1"]'); },
  },
  2: {
    select: () => tap('[data-e="callers"]'),
    chip: () => tapChip('Descend'),
    grid: async () => { await tap('[data-p="lvl"]'); await shot('L2-grid-picker'); await tap('.picker [data-pick="F70"]'); },
    send: () => send(),
    answer: async () => { await tap('[data-e="callers"]'); await page.locator('.sg').first().tap(); await wait(400); },
  },
  3: {
    select: () => tap('[data-e="callers"]'),
    dial: () => tap('[data-p="hdg"]'),
    pick: async () => { const r = await page.locator('.picker .rose').boundingBox(); const a = (60 * Math.PI) / 180, cx = r.x + r.width / 2, cy = r.y + r.height / 2, rr = r.width * 0.42; await shot('L3-dial'); await page.mouse.click(cx + Math.sin(a) * rr, cy - Math.cos(a) * rr); await wait(400); },
    send: () => send(),
    drag: async () => { await wait(700); await dragHeading('CHG201', 120, 70); },
    lr: () => tap('.coach [data-c="ask"][data-k="0"]'),
  },
  4: {
    need: () => tap('.coach [data-c="ask"][data-k="1"]'),
    have: () => tap('.coach [data-c="ask"][data-k="1"]'),
    step: () => tapChip('Descend'),
    rest: () => tap('.sg.lead'),
    fix: async () => { await picker('[data-p="lvl"]', 'A2500'); await send(); },
    tayTwr: { when: '(g.sim.find("TAY4EK")?.app?.locCap)', do: () => towerChip(), repeat: true },
    land: { when: '(g.sim.find("QTR8152")?.app?.locCap)', do: () => towerChip(), repeat: true },
  },
  5: {
    downwind: async () => { await wait(700); await dragHeading('CHG201', 45, 70); },
    down: async () => { await picker('[data-p="lvl"]', 'A3000'); await picker('[data-p="spd"]', 'S210'); await send(); },
    base: () => tapChip('Base R135'),
    intercept: { when: 'Math.abs(require_xt(g, "CHG201")) < 2.2', do: () => tapChip('R195') },
    twr: () => tapChip('160 to 4'),
  },
  6: {
    rbl: async () => { await tap('[data-z="rbl"]'); await drag(await xy({ cs: 'AZG7321' }), await xy({ cs: 'ETH3721' })); },
    cpa: () => tap('.coach [data-c="ask"][data-k="1"]'),
    act: () => tapChip('Descend'),
  },
  7: {
    trans: () => tap('.sg.lead'),
    hold: async () => { await tap('[data-p="more"]'); await shot('L7-more'); await tap('.picker [data-pick="HOLD ALHUV"]'); await send(); },
    tl: () => tap('.coach [data-c="ask"][data-k="1"]'),
    stack: async () => { await picker('[data-p="lvl"]', 'A5000'); await send(); },
    release: () => tapChip('Leave hold'),
    twr: { when: '(g.sim.find("AZG7321")?.app?.locCap)', do: () => tapChip('Tower') },
    land: { when: '(g.sim.find("QTR8152")?.app?.locCap)', do: () => tapChip('Tower') },
  },
  8: {
    speed: async () => { await tap('[data-p="spd"]'); await shot('L8-speed-picker'); await tap('.picker [data-pick="S180"]'); await send(); },
    land: { when: 'g.sim.aircraft.some((a) => a.state === "assumed" && a.app?.locCap && !g.sim.readbackPending(a.cs))', do: () => towerChip(), repeat: true },
  },
  9: {
    card: { when: '!!document.querySelector(\'.icom [data-rel="CHG7302"][data-v^="after"]\')', do: async () => { await shot('L9-intercom'); await tap('.icom [data-rel="CHG7302"][data-v^="after"]'); } },
    fdx: { when: '(g.sim.find("FDX5203")?.app?.locCap)', do: () => tapChip('Tower') },
    answer: async () => { await picker('[data-p="lvl"]', 'F60'); await send(); },
    climb: { when: '!!document.querySelector(".sg") && [...document.querySelectorAll(".sg")].some((b) => b.textContent.trim().startsWith("Climb")) && (() => { const a = g.sim.find("CHG7302"), z = g.sim.find("AZG7321"); return !z || Math.hypot(a.p.x - z.p.x, a.p.y - z.p.y) > 6 && ((z.p.x - a.p.x) * Math.sin(a.trk * Math.PI / 180) + (z.p.y - a.p.y) * Math.cos(a.trk * Math.PI / 180)) < 0; })()', do: () => tapChip('Climb FL090') },
    bru: { when: '[...document.querySelectorAll(".sg")].some((b) => b.textContent.trim().startsWith("Brussels"))', do: () => tapChip('Brussels') },
  },
  10: {
    clear: () => tapChip('Descend'),
    spot: () => tap('.coach [data-c="ask"][data-k="1"]'),
    negative: () => tapChip('Negative'),
    approach: () => tap('.sg.lead'),
    card: async () => { await shot('L10-mayday'); await tap('.emer-card .em'); },
    priority: () => tap('.sg.lead'),
    ethTwr: { when: '(g.sim.find("ETH3721")?.app?.locCap)', do: () => towerChip(), repeat: true },
    land: { when: '(g.sim.find("CLX7HK")?.app?.locCap)', do: () => towerChip(), repeat: true },
  },
};

// ---------------------------------------------------------------- exam drivers
/** Run a script inside the page every sim second (sends go through game.quick, the same path as the bar). */
async function examLoop(script, max = 2400) {
  for (let k = 0; k < max / 20; k++) {
    const st = await state();
    if (!st || st.phase !== 'exam') return st;
    await page.evaluate((src) => {
      const g = window.__lgg.game, w = window;
      w.__once ??= new Set();
      const once = (key, c) => (c && !w.__once.has(key) ? (w.__once.add(key), true) : false);
      const calling = (cs) => { const a = g.sim.find(cs); return !!a && a.awaitingSince !== undefined && g.sim.t >= a.awaitingSince && !g.sim.readbackPending(cs); };
      const say = (cs, items) => g.quick(cs, items);
      const f = new Function('g', 'once', 'calling', 'say', src);
      for (let i = 0; i < 20; i++) { g.sim.step(); if (document.querySelector('.coach')?.dataset.phase !== 'exam') break; f(g, once, calling, say); }
    }, script);
    await wait(40);
  }
  return state();
}
const TOWER = `for (const a of g.sim.aircraft) if (a.kind === 'arr' && a.state === 'assumed' && a.app?.locCap && g.sim.dthr(a) < 12 && once('twr' + a.cs + a.goArounds, true)) say(a.cs, [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: 'TWR' }]);`;
const ILS = `{ k: 'app', app: 'ILS', rwy: '22L' }`;
const EXAMS = {
  1: async () => { for (let q = 0; q < 4; q++) { const k = await page.evaluate((qi) => window.__lgg.LESSONS[0].exam.quiz[qi].answer(window.__lgg.game.sim), q); if (q === 0) await shot('L1-exam-q1'); await tap(`.coach [data-c="quiz"][data-k="${k}"]`); } },
  2: async () => {
    for (let k = 0; k < 200; k++) {
      const st = await state(); if (st.phase !== 'exam') break;
      const waiting = await page.evaluate(() => window.__lgg.game.sim.callers().some((a) => window.__lgg.game.sim.t >= a.awaitingSince + 2 && !window.__lgg.game.sim.readbackPending(a.cs)));
      if (waiting) { await tap('[data-e="callers"]'); await tapChip('Descend'); }
      else await page.evaluate(() => { for (let i = 0; i < 2; i++) window.__lgg.game.sim.step(); });
      await wait(60);
    }
  },
  3: () => examLoop(`const a = g.sim.find('CHG201'); if (!a) return; const g1 = g.sim.pack.fixes.get('LG008').p; if (once('h1', calling('CHG201'))) say('CHG201', [{ k: 'hdg', hdg: 65, dir: 'L' }]); if (once('h2', Math.hypot(a.p.x - g1.x, a.p.y - g1.y) < 0.9)) say('CHG201', [{ k: 'hdg', hdg: 200, dir: 'R' }]);`),
  4: () => examLoop(`const a = g.sim.find('QTR8152'); if (!a) return; if (once('c', calling('QTR8152'))) say('QTR8152', [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { fl: 60 } }, ${ILS}]); if (once('d', !!a.app && a.alt < 6600)) say('QTR8152', [{ k: 'lvl', lvl: { ft: 2500 } }, { k: 'spd', spd: 210 }]); ${TOWER}`),
  5: () => examLoop(`const a = g.sim.find('DHK7'); if (!a) return; const r = g.sim.rwy; const rad = (d) => d * Math.PI / 180; const dx = a.p.x - r.thr.x, dy = a.p.y - r.thr.y; const xt = dx * Math.cos(rad(r.crs)) - dy * Math.sin(rad(r.crs)); const al = -(dx * Math.sin(rad(r.crs)) + dy * Math.cos(rad(r.crs)));
    if (once('dw', calling('DHK7'))) say('DHK7', [{ k: 'hdg', hdg: 45, dir: 'R' }, { k: 'lvl', lvl: { ft: 4000 } }]);
    if (once('lo', g.sim.t > 60)) say('DHK7', [{ k: 'lvl', lvl: { ft: 3000 } }, { k: 'spd', spd: 210 }]);
    if (once('base', g.sim.t > 60 && al > 12)) say('DHK7', [{ k: 'hdg', hdg: 315, dir: 'L' }]);
    if (once('icpt', g.sim.t > 80 && w_base() && Math.abs(xt) < 2.3)) say('DHK7', [{ k: 'hdg', hdg: 255, dir: 'L' }, ${ILS}]);
    function w_base() { return window.__once.has('base') && a.hdgSys !== undefined && ((a.hdgSys - 2 + 360) % 360) > 300; }
    ${TOWER}`),
  6: () => examLoop(`if (once('p1', calling('ETH3721'))) say('ETH3721', [{ k: 'lvl', lvl: { fl: 60 } }]); if (once('p2', calling('TAY4EK'))) say('TAY4EK', [{ k: 'lvl', lvl: { fl: 60 } }]); for (const cs of ['CLX7HK', 'FDX5203']) if (once(cs, calling(cs))) say(cs, [{ k: 'lvl', lvl: { fl: 80 } }]);`),
  7: () => examLoop(`window.__lgg.autoControl(g.sim);`, 3000),
  8: () => examLoop(`const c = g.sim.find('CLX7HK'), t = g.sim.find('TAY4EK'), d = g.sim.find('DHK7'); if (t && once('t', !!c?.app?.locCap && g.sim.dthr(t) < 16)) say('TAY4EK', [{ k: 'spd', spd: 180 }]); if (d && once('d', !!t?.app?.locCap && g.sim.dthr(d) < 16)) say('DHK7', [{ k: 'spd', spd: 180 }]); ${TOWER}`, 3000),
  9: async () => {
    // releases through the intercom card, the rest through game.quick
    for (let k = 0; k < 400; k++) {
      const st = await state(); if (st.phase !== 'exam') break;
      const rel = await page.evaluate(() => { const g = window.__lgg.game; return g.sim.releases.find((r) => r.state === 'pending' && g.sim.t - r.t > 4)?.cs; });
      if (rel) { if (rel === 'CHG7302') await shot('L9-exam-intercom'); await tap(`.icom [data-rel="${rel}"][data-v="rel"]`); continue; }
      await page.evaluate(() => {
        const g = window.__lgg.game, w = window; w.__once ??= new Set();
        const once = (key, c) => (c && !w.__once.has(key) ? (w.__once.add(key), true) : false);
        const calling = (cs) => { const a = g.sim.find(cs); return !!a && a.awaitingSince !== undefined && g.sim.t >= a.awaitingSince && !g.sim.readbackPending(cs); };
        for (let i = 0; i < 5; i++) {
          g.sim.step();
          const q = g.sim.find('QTR8125');
          if (q && once('q', calling('QTR8125'))) g.quick('QTR8125', [{ k: 'lvl', lvl: { fl: 80 } }]);
          for (const cs of ['CHG7302', 'BCS7']) {
            const a = g.sim.find(cs); if (!a || a.state !== 'assumed') continue;
            if (once('ans' + cs, calling(cs))) g.quick(cs, [{ k: 'lvl', lvl: { fl: 60 } }]);
            const behind = q && ((q.p.x - a.p.x) * Math.sin(a.trk * Math.PI / 180) + (q.p.y - a.p.y) * Math.cos(a.trk * Math.PI / 180)) < 0;
            const clear = !q || q.state !== 'assumed' || (Math.hypot(a.p.x - q.p.x, a.p.y - q.p.y) > 8 && behind) || Math.abs(a.p.x - q.p.x) > 15;
            if (once('cl' + cs, clear && a.alt > 4000 && w.__once.has('ans' + cs))) g.quick(cs, [{ k: 'lvl', lvl: { fl: 90 } }]);
            if (once('bru' + cs, Math.hypot(a.p.x, a.p.y) > 20)) g.quick(cs, [{ k: 'xfr', unit: 'BRU' }]);
          }
          if (document.querySelector('.coach')?.dataset.phase !== 'exam') break;
        }
      });
      await wait(40);
    }
  },
  10: () => examLoop(`for (const a of g.sim.aircraft) if (a.wrong && !g.sim.readbackPending(a.cs) && once('neg' + a.cs + a.wrong.t, true)) { g.select(a.cs, true); const b = [...document.querySelectorAll('.sg')].find((x) => x.textContent.trim().startsWith('Negative')); if (b) b.click(); } window.__lgg.autoControl(g.sim);`, 3000),
};

// ---------------------------------------------------------------- run
await page.goto(URL);
await wait(900);
await page.evaluate(() => { try { localStorage.removeItem('lgg.tutorial'); } catch {} });
const results = [];
const T0 = Date.now();
for (let n = 1; n <= 10; n++) {
  if (only && !only.includes(n)) continue;
  log(`\n=== Lesson ${n}`);
  await page.evaluate((i) => { window.__once = new Set(); window.__lgg.lesson(i); }, n - 1);
  await wait(700);
  // helper used by "when" strings
  await page.evaluate(() => { window.require_xt = (g, cs) => { const a = g.sim.find(cs); const r = g.sim.rwy; const rad = (d) => d * Math.PI / 180; const dx = a.p.x - r.thr.x, dy = a.p.y - r.thr.y; return dx * Math.cos(rad(r.crs)) - dy * Math.sin(rad(r.crs)); }; });
  const did = new Set();
  let last = '', shotN = 0, stuck = 0;
  for (let k = 0; k < 600; k++) {
    const st = await state();
    if (!st) { problems.push(`L${n}: coach vanished`); break; }
    const key = `${st.phase}:${st.step}`;
    if (key !== last) {
      last = key; stuck = 0;
      if (st.phase === 'steps') { shotN++; await wait(500); await coverage(`L${n}/${st.step}`); await shot(`L${n}-${String(shotN).padStart(2, '0')}-${st.step}`); log(`  step ${st.step} t=${st.t}${st.collapsed ? ' (collapsed)' : ''} [${Math.round((Date.now() - T0) / 1000)} s]`); }
    } else stuck++;
    if (st.phase === 'intro') { await shot(`L${n}-exam-intro`); await tap('.coach [data-c="startExam"]'); await wait(700); await shot(`L${n}-exam-running`); await coverage(`L${n}/exam`); await EXAMS[n](); continue; }
    if (st.phase === 'result') {
      await wait(400); await shot(`L${n}-result`);
      const v = await page.evaluate(() => document.querySelector('.coach-verdict')?.textContent.trim() + ' · ' + (document.querySelector('.coach p')?.textContent ?? ''));
      log(`  RESULT ${v}`); results.push(`L${n}: ${v}`);
      if (!/^PASS/.test(v)) problems.push(`L${n} exam: ${v}`);
      break;
    }
    if (st.phase === 'exam') { stuck++; await wait(300); if (stuck > 40) { problems.push(`L${n}: exam did not finish`); break; } continue; }
    const act = ACTS[n]?.[st.step];
    if (act && (!did.has(st.step) || act.repeat)) {
      if (typeof act === 'function') { did.add(st.step); await act(); await wait(500); continue; }
      const ready = await page.evaluate((c) => { const g = window.__lgg.game; return !!new Function('g', `return (${c})`)(g); }, act.when);
      if (ready) { did.add(st.step); await act.do(); await wait(500); continue; }
    }
    if (st.next) { await tap('.coach [data-c="next"]'); continue; }
    if (st.ff) { await tap('.coach [data-c="ff"]'); await wait(600); continue; }
    if (stuck > 60) { problems.push(`L${n}: stuck at ${st.step}`); log(`  STUCK at ${st.step}`); await shot(`L${n}-STUCK-${st.step}`); break; }
    await wait(300);
  }
}
log('\n=== Results'); for (const r of results) log(r);
log('\n=== Notes'); for (const n of notes) log(n);
log('\n=== Problems'); for (const p of problems) log(p);
log(problems.length ? `${problems.length} problems` : 'no problems');
await browser.close();
process.exitCode = problems.length ? 1 : 0;
