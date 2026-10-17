// Measures the commands module: pointer actions, keystrokes and wall time from "I decide" to
// "transmitted" for the ten commonest night-bank clearances, on a phone (390×844, touch) and a
// desktop (1440×900, mouse and keyboard). The sim is paused during every task, so the time is
// the console's alone (plus Playwright's own per-action latency, the same for both versions).
//
//   npx vite build && (npx vite preview --port 4383 --strictPort &) && V=2 node tests/commands-measure.mjs
//
// V=1 drives the 1.0 console (pickers, chips, typed line); V=2 drives the 2.0 paths (attention
// queue, halo, command line, inline readback). Results print as a Markdown table for docs/COMMANDS.md.
const PW = process.env.PW ?? '/home/claude/liege-approach/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const URL = process.env.URL ?? 'http://localhost:4383/';
const V = Number(process.env.V ?? 1);
const KEY_MS = Number(process.env.KEY_MS ?? 60); // a fast typist: about 60 ms per key
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell' });

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
};

// ---------------------------------------------------------------- page helpers
async function open(dev) {
  const ctx = await browser.newContext(DEVICES[dev]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(URL);
  await page.evaluate(() => { try { localStorage.setItem('lgg.settings', JSON.stringify({ voice: false, hints: false, quickMode: false, trainingWheels: false })); } catch {} });
  await page.reload();
  await page.waitForFunction(() => !!window.__lgg);
  // count pointer actions (a tap, click or drag start) and keystrokes; both start at zero for every task
  await page.evaluate(() => {
    window.__m = { ptr: 0, key: 0 };
    document.addEventListener('pointerdown', () => window.__m.ptr++, true);
    document.addEventListener('keydown', (e) => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) window.__m.key++; }, true);
  });
  return { ctx, page };
}
const wait = (page, ms) => page.waitForTimeout(ms);
/** Start a scenario and run the sim until `cond` holds, then pause. */
async function prepare(page, lessonIdx, cond, extra = '') {
  await page.evaluate(([i, c, x]) => {
    const L = window.__lgg;
    L.play(L.LESSONS[i].scenario);
    const g = L.game; g.setSpeed(0);
    const f = new Function('g', `return (${c})`);
    const fx = x ? new Function('g', x) : null;
    for (let k = 0; k < 3000 && !f(g); k++) { g.sim.step(); if (fx) fx(g); }
    if (!f(g)) throw new Error('prepare: condition never held ' + c);
    g.select(undefined); g.halo.enabled = true;
  }, [lessonIdx, cond, extra]);
  await wait(page, 400);
  await page.evaluate(() => { const g = window.__lgg.game; g.scope.fit(); window.__m.ptr = 0; window.__m.key = 0; window.__m.cmds = g.sim.cmdLog.length; });
  await wait(page, 350);
}
const sent = (page) => page.waitForFunction(() => window.__lgg.game.sim.cmdLog.length > window.__m.cmds, null, { timeout: 4000, polling: 10 });
const xy = (page, cs) => page.evaluate((c) => { const g = window.__lgg.game, a = g.sim.find(c); if (!a) return null; const s = g.scope.toS(g.scope.plot(a)), r = g.scope.canvas.getBoundingClientRect(); return { x: r.left + s.x, y: r.top + s.y }; }, cs);
let lastPress = 0;
async function press(page, sel, dev) {
  // a finger needs about half a second between a tap that selects and a tap on the halo that appears
  if (sel.startsWith('.halo')) { const d = 450 - (Date.now() - lastPress); if (d > 0) await wait(page, d); }
  lastPress = Date.now();
  const el = page.locator(`${sel} >> visible=true`).first();
  if (dev === 'phone') await el.tap({ timeout: 2500 }); else await el.click({ timeout: 2500 });
}
async function pressAt(page, p, dev) { lastPress = Date.now(); if (dev === 'phone') await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); }
async function drag(page, from, to, steps = 10) {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  for (let k = 1; k <= steps; k++) { await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps); await wait(page, 12); }
  await page.mouse.up();
}
async function type(page, text) { for (const ch of text) { await page.keyboard.press(ch === '\n' ? 'Enter' : ch === ' ' ? 'Space' : ch); await wait(page, KEY_MS); } }
async function tapChip(page, prefix, dev) {
  const el = page.locator('.sg').filter({ hasText: new RegExp(`^\\s*${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first();
  if (dev === 'phone') await el.tap({ timeout: 2500 }); else await el.click({ timeout: 2500 });
}
async function roseAt(page, hdg, dev) {
  const r = await page.locator('.picker .rose').boundingBox();
  const a = (hdg * Math.PI) / 180, p = { x: r.x + r.width / 2 + Math.sin(a) * r.width * 0.42, y: r.y + r.height / 2 - Math.cos(a) * r.height * 0.42 };
  await pressAt(page, p, dev);
}
async function dragHeading(page, cs, hdgMag, len = 80) {
  await wait(page, 450); // the scope settles after a selection pans it
  const a = await xy(page, cs);
  const t = ((hdgMag + 2) * Math.PI) / 180;
  await drag(page, a, { x: a.x + Math.sin(t) * len, y: a.y - Math.cos(t) * len });
}

// ---------------------------------------------------------------- the ten clearances
// Each task: how to reach the state, then the action lists per version and device.
// 'kbd' actions are what a keyboard player does on the desktop (typed shorthand or the 2.0 command line).
const CALLING = (cs) => `(() => { const a = g.sim.find('${cs}'); return !!a && a.state === 'assumed' && a.awaitingSince !== undefined && g.sim.t >= a.awaitingSince; })()`;
const TASKS = [
  {
    name: 'Descend to a level (first call)', lesson: 1, cond: CALLING('QTR8125'),
    v1: { phone: async (p) => { await press(p, '[data-e="callers"]', 'phone'); await press(p, '[data-p="lvl"]', 'phone'); await press(p, '.picker [data-pick="F70"]', 'phone'); await press(p, '[data-a="send"]', 'phone'); },
          desktop: async (p) => { await press(p, '[data-e="callers"]', 'desktop'); await press(p, '[data-p="lvl"]', 'desktop'); await press(p, '.picker [data-pick="F70"]', 'desktop'); await press(p, '[data-a="send"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'QTR8125 D70\n'); } },
    v2: { phone: async (p) => { await attRow(p, 'QTR8125', 'sel', 'phone'); await press(p, '.halo [data-halo="lvl"][data-v="F070"]', 'phone'); },
          desktop: async (p) => { await attRow(p, 'QTR8125', 'sel', 'desktop'); await press(p, '.halo [data-halo="lvl"][data-v="F070"]', 'desktop'); },
          kbd: async (p) => { await type(p, '81 d70\n'); } },
  },
  {
    name: 'Suggested clearance (the lead chip)', lesson: 1, cond: CALLING('QTR8125'),
    v1: { phone: async (p) => { await press(p, '[data-e="callers"]', 'phone'); await tapChip(p, 'Descend', 'phone'); },
          desktop: async (p) => { await press(p, '[data-e="callers"]', 'desktop'); await tapChip(p, 'Descend', 'desktop'); },
          kbd: async (p) => { await type(p, 'QTR8125 D60\n'); } },
    v2: { phone: async (p) => { await attRow(p, 'QTR8125', 'go', 'phone'); },
          desktop: async (p) => { await attRow(p, 'QTR8125', 'go', 'desktop'); },
          kbd: async (p) => { await page_key(p, 'Tab'); await page_key(p, 'Enter'); } },
  },
  {
    name: 'Heading', lesson: 2, cond: CALLING('CHG201'),
    v1: { phone: async (p) => { await press(p, '[data-e="callers"]', 'phone'); await press(p, '[data-p="hdg"]', 'phone'); await roseAt(p, 60, 'phone'); await press(p, '[data-a="send"]', 'phone'); },
          desktop: async (p) => { await press(p, '[data-e="callers"]', 'desktop'); await press(p, '[data-p="hdg"]', 'desktop'); await roseAt(p, 60, 'desktop'); await press(p, '[data-a="send"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'CHG201 L060\n'); } },
    v2: { phone: async (p) => { await attRow(p, 'CHG201', 'sel', 'phone'); await dragHeading(p, 'CHG201', 60); },
          desktop: async (p) => { await attRow(p, 'CHG201', 'sel', 'desktop'); await dragHeading(p, 'CHG201', 60); },
          kbd: async (p) => { await type(p, '201 l60\n'); } },
  },
  {
    name: 'Speed', lesson: 7, cond: CALLING('TAY4EK'),
    v1: { phone: async (p) => { await press(p, '[data-e="callers"]', 'phone'); await press(p, '[data-p="spd"]', 'phone'); await press(p, '.picker [data-pick="S180"]', 'phone'); await press(p, '[data-a="send"]', 'phone'); },
          desktop: async (p) => { await press(p, '[data-e="callers"]', 'desktop'); await press(p, '[data-p="spd"]', 'desktop'); await press(p, '.picker [data-pick="S180"]', 'desktop'); await press(p, '[data-a="send"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'TAY4EK S180\n'); } },
    v2: { phone: async (p) => { await attRow(p, 'TAY4EK', 'sel', 'phone'); await press(p, '.halo [data-halo="spd"][data-v="S180"]', 'phone'); },
          desktop: async (p) => { await attRow(p, 'TAY4EK', 'sel', 'desktop'); await press(p, '.halo [data-halo="spd"][data-v="S180"]', 'desktop'); },
          kbd: async (p) => { await type(p, '4ek s180\n'); } },
  },
  {
    name: 'Direct to a fix (LIBVA)', lesson: 1, cond: CALLING('QTR8125'),
    v1: { phone: async (p) => { await press(p, '[data-e="callers"]', 'phone'); await press(p, '[data-p="dct"]', 'phone'); await press(p, `.picker [data-pick="DCT LIBVA"]`, 'phone'); await press(p, '[data-a="send"]', 'phone'); },
          desktop: async (p) => { await press(p, '[data-e="callers"]', 'desktop'); await press(p, '[data-p="dct"]', 'desktop'); await press(p, `.picker [data-pick="DCT LIBVA"]`, 'desktop'); await press(p, '[data-a="send"]', 'desktop'); },
          kbd: async (p) => { await type(p, `QTR8125 DCT LIBVA\n`); } },
    v2: { phone: async (p) => { await attRow(p, 'QTR8125', 'sel', 'phone'); await press(p, `.halo [data-halo="fix"][data-v="LIBVA"]`, 'phone'); },
          desktop: async (p) => { await attRow(p, 'QTR8125', 'sel', 'desktop'); await press(p, `.halo [data-halo="fix"][data-v="LIBVA"]`, 'desktop'); },
          kbd: async (p) => { await type(p, '81 >lib\n'); } },
  },
  {
    name: 'Transition, level and ILS', lesson: 6, cond: `(() => { const a = g.sim.find('AZG7321'); return !!a && a.state === 'assumed' && g.sim.t >= 8 && !g.sim.readbackPending('AZG7321'); })()`,
    v1: { phone: async (p) => { const a = await xy(p, 'AZG7321'); await pressAt(p, a, 'phone'); await press(p, '[data-p="more"]', 'phone'); await press(p, '.picker [data-pick^="T "]', 'phone'); await press(p, '.picker [data-pick="T ALHUV1A"]', 'phone'); await press(p, '[data-p="lvl"]', 'phone'); await press(p, '.picker [data-pick="A3000"]', 'phone'); await press(p, '[data-p="more"]', 'phone'); await press(p, '.picker [data-pick="ILS 22L"]', 'phone'); await press(p, '[data-a="send"]', 'phone'); },
          desktop: async (p) => { const a = await xy(p, 'AZG7321'); await pressAt(p, a, 'desktop'); await press(p, '[data-p="trans"]', 'desktop'); await press(p, '.picker [data-pick="T ALHUV1A"]', 'desktop'); await press(p, '[data-p="lvl"]', 'desktop'); await press(p, '.picker [data-pick="A3000"]', 'desktop'); await press(p, '[data-e="appBtn"]', 'desktop'); await press(p, '[data-a="send"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'AZG7321 ALHUV1A A30 ILS\n'); } },
    v2: { phone: async (p) => { const a = await xy(p, 'AZG7321'); await pressAt(p, a, 'phone'); await tapChip(p, 'ALHUV1A', 'phone'); },
          desktop: async (p) => { const a = await xy(p, 'AZG7321'); await pressAt(p, a, 'desktop'); await tapChip(p, 'ALHUV1A', 'desktop'); },
          kbd: async (p) => { await type(p, '7321 alhuv1a a30 ils\n'); } },
  },
  {
    name: 'Hold with a level', lesson: 6, cond: `(() => { const a = g.sim.find('QTR8152'); return !!a && a.state === 'assumed' && g.sim.t >= 8 && !g.sim.readbackPending('QTR8152'); })()`,
    v1: { phone: async (p) => { const a = await xy(p, 'QTR8152'); await pressAt(p, a, 'phone'); await press(p, '[data-p="more"]', 'phone'); await press(p, '.picker [data-pick="HOLD ALHUV"]', 'phone'); await press(p, '[data-p="lvl"]', 'phone'); await press(p, '.picker [data-pick="A5000"]', 'phone'); await press(p, '[data-a="send"]', 'phone'); },
          desktop: async (p) => { const a = await xy(p, 'QTR8152'); await pressAt(p, a, 'desktop'); await press(p, '[data-a="hold"]', 'desktop'); await press(p, '[data-p="lvl"]', 'desktop'); await press(p, '.picker [data-pick="A5000"]', 'desktop'); await press(p, '[data-a="send"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'QTR8152 HOLD A50\n'); } },
    v2: { phone: async (p) => { const a = await xy(p, 'QTR8152'); await pressAt(p, a, 'phone'); await press(p, '.halo [data-halo="more"][data-v="hold"]', 'phone'); await press(p, '.halo [data-halo="lvl"][data-v="A5000"]', 'phone'); },
          desktop: async (p) => { const a = await xy(p, 'QTR8152'); await pressAt(p, a, 'desktop'); await press(p, '.halo [data-halo="more"][data-v="hold"]', 'desktop'); await press(p, '.halo [data-halo="lvl"][data-v="A5000"]', 'desktop'); },
          kbd: async (p) => { await type(p, '8152 hold a50\n'); } },
  },
  {
    name: 'Hand off to Tower (established)', lesson: 7, cond: `(() => { const a = g.sim.find('CLX7HK'); return !!a && a.state === 'assumed' && !!a.app?.locCap && g.sim.dthr(a) < 13 && !g.sim.readbackPending('CLX7HK'); })()`,
    extra: `const a = g.sim.find('CLX7HK'); if (a && !a.app && a.awaitingSince !== undefined && g.sim.t >= a.awaitingSince && !g.sim.readbackPending('CLX7HK')) g.sim.issue({ cs: 'CLX7HK', items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }] });`,
    v1: { phone: async (p) => { const a = await xy(p, 'CLX7HK'); await pressAt(p, a, 'phone'); await press(p, '[data-p="more"]', 'phone'); await press(p, '.picker [data-pick="XTWR"]', 'phone'); await press(p, '[data-a="send"]', 'phone'); },
          desktop: async (p) => { const a = await xy(p, 'CLX7HK'); await pressAt(p, a, 'desktop'); await press(p, '[data-a="twr"]', 'desktop'); await press(p, '[data-a="send"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'CLX7HK TWR\n'); } },
    v2: { phone: async (p) => { await attRow(p, 'CLX7HK', 'go', 'phone'); },
          desktop: async (p) => { await attRow(p, 'CLX7HK', 'go', 'desktop'); },
          kbd: async (p) => { await type(p, '7hk twr\n'); } },
  },
  {
    name: 'Release a departure', lesson: 8, cond: `g.sim.releases.some((r) => r.state === 'pending')`,
    v1: { phone: async (p) => { await press(p, '.icom [data-v="rel"]', 'phone'); }, desktop: async (p) => { await press(p, '.icom [data-v="rel"], .coord [data-v="rel"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'CHG7302 REL\n'); } },
    v2: { phone: async (p) => { await attRow(p, 'CHG7302', 'go', 'phone'); }, desktop: async (p) => { await attRow(p, 'CHG7302', 'go', 'desktop'); },
          kbd: async (p) => { await type(p, '7302 rel\n'); } },
  },
  {
    name: 'Answer a call with Roger', lesson: 1, cond: CALLING('QTR8125'),
    v1: { phone: async (p) => { await press(p, '[data-e="callers"]', 'phone'); await press(p, '[data-a="roger"]', 'phone'); },
          desktop: async (p) => { await press(p, '[data-e="callers"]', 'desktop'); await press(p, '[data-a="roger"]', 'desktop'); },
          kbd: async (p) => { await type(p, 'QTR8125 R\n'); } },
    v2: { phone: async (p) => { await attRow(p, 'QTR8125', 'sel', 'phone'); await press(p, '[data-a="roger"]', 'phone'); },
          desktop: async (p) => { await attRow(p, 'QTR8125', 'sel', 'desktop'); await press(p, '[data-a="roger"]', 'desktop'); },
          kbd: async (p) => { await type(p, '81 r\n'); } },
  },
  {
    name: 'Correct a wrong readback', lesson: 9, cond: `(() => { const a = g.sim.find('ETH3721'); return !!a && !!a.wrong && !g.sim.readbackPending('ETH3721'); })()`,
    extra: `const a = g.sim.find('ETH3721'); if (a && a.awaitingSince !== undefined && g.sim.t >= a.awaitingSince && !g.__w) { g.__w = 1; g.sim.forceWrong.add('ETH3721'); g.sim.issue({ cs: 'ETH3721', items: [{ k: 'lvl', lvl: { fl: 60 } }] }); }`,
    v1: { phone: async (p) => { const a = await xy(p, 'ETH3721'); await pressAt(p, a, 'phone'); await tapChip(p, 'Negative', 'phone'); },
          desktop: async (p) => { const a = await xy(p, 'ETH3721'); await pressAt(p, a, 'desktop'); await tapChip(p, 'Negative', 'desktop'); },
          kbd: async (p) => { await type(p, 'ETH3721 D60\n'); } },
    v2: { phone: async (p) => { await press(p, '.rb-card [data-a="rb-fix"]', 'phone'); },
          desktop: async (p) => { await press(p, '.rb-card [data-a="rb-fix"]', 'desktop'); },
          kbd: async (p) => { await page_key(p, 'Tab'); await page_key(p, 'Enter'); } },
  },
];
/** Tap a queue row (or its action). On a phone only the top row shows; a row further down needs the queue opened first (one more tap). */
async function attRow(p, cs, what, dev) {
  const sel = `.att-row[data-cs="${cs}"] .att-${what}`;
  const vis = await p.locator(sel).first().isVisible().catch(() => false);
  if (!vis) await press(p, '.att-more', dev);
  await press(p, sel, dev);
}
async function page_key(p, k) { await p.keyboard.press(k); await wait(p, KEY_MS); }

// ---------------------------------------------------------------- run
const rows = [];
for (const dev of ['phone', 'desktop']) {
  const { ctx, page } = await open(dev);
  for (const t of TASKS) {
    const modes = dev === 'phone' ? ['phone'] : ['desktop', 'kbd'];
    for (const mode of modes) {
      const act = t[`v${V}`][mode];
      let r = { task: t.name, dev: mode === 'kbd' ? 'desktop keyboard' : dev, ptr: '-', key: '-', ms: '-', note: '' };
      try {
        await prepare(page, t.lesson, t.cond, t.extra ?? '');
        if (mode === 'kbd') await page.evaluate(() => document.body.focus());
        const t0 = Date.now();
        await act(page);
        await sent(page);
        const ms = Date.now() - t0;
        const m = await page.evaluate(() => window.__m);
        const last = await page.evaluate(() => { const c = window.__lgg.game.sim.cmdLog.at(-1).cl; return `${c.cs} ${c.items.map((i) => i.k).join('+')}`; });
        r = { ...r, ptr: m.ptr, key: m.key, ms, note: last };
      } catch (e) {
        r.note = `FAILED: ${e.message.split('\n')[0].slice(0, 90)}`;
        try { await page.screenshot({ path: `/tmp/claude-0/-home-claude/84bad614-5061-5290-9fc8-e6b39963c216/scratchpad/v2/commands/fail-v${V}-${dev}-${t.name.replace(/\W+/g, '_')}.png` }); } catch {}
      }
      rows.push(r);
      console.log(`${r.dev.padEnd(17)} ${t.name.padEnd(40)} ptr=${String(r.ptr).padStart(2)} key=${String(r.key).padStart(2)} ${String(r.ms).padStart(5)} ms  ${r.note}`);
    }
  }
  await ctx.close();
}
console.log('\n| Clearance | Device | Pointer actions | Keystrokes | Time (ms) | Sent |\n|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.task} | ${r.dev} | ${r.ptr} | ${r.key} | ${r.ms} | ${r.note} |`);
await browser.close();
