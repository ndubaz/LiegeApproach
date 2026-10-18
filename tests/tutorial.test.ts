import { describe, expect, it } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { Sim } from '../src/engine/sim';
import { suggest, levelList } from '../src/engine/suggest';
import { hints } from '../src/engine/hints';
import { autoControl } from '../src/engine/autopilot';
import { mergeItem, sortItems, type Item } from '../src/engine/clearance';
import { LESSONS, examMem, examVerdict, isCalling, type Lesson, type Step, type StepCtx, type Verdict } from '../src/ui/tutorial';
import { GLOSSARY } from '../src/ui/glossary';
import { alongTrack, crossTrack, dist, norm360 } from '../src/geo';

// Every lesson is flown here the way its coach tells a student to: each step's
// action uses the control the coach names (a suggestion chip must really be on
// offer with that label; a picker value must really be in the picker), then the
// step's done-condition must come true. Every exam is flown well (it must pass)
// and, for several, ignored or flown badly (it must fail).

const pack = loadPack(EBLG);
const L = (id: string) => LESSONS.find((l) => l.id === id)!;
const ILS: Item = { k: 'app', app: 'ILS', rwy: '22L' };

// ---------------------------------------------------------------- a stand-in for the game screen
interface Fake { sim: Sim; cs?: string; items: Item[]; coachHints: boolean; scope: any; settings: any; els: any; root: any; select(cs?: string): void; setSpeed(n: number): void }
function fake(sim: Sim): Fake {
  const f: Fake = {
    sim, items: [], coachHints: false,
    scope: { scale: 8, rbls: [], marks: [], reserved: [], rblMode: false, w: 390, h: 577, toW: (x: number, y: number) => ({ x, y }), plot: (a: any) => a.p, fit() {}, focus() {}, animateTo() {} },
    settings: { showMva: false },
    els: { picker: { hidden: true, dataset: {} as Record<string, string> } },
    root: { querySelector: () => null, querySelectorAll: () => [] },
    select(cs?: string) { if (cs !== f.cs) f.items = []; f.cs = cs; },
    setSpeed() {},
  };
  return f;
}
const chips = (sim: Sim, cs: string) => { const a = sim.find(cs); return a ? suggest(sim, a) : []; };
/** Tap the suggestion chip whose label starts with `prefix` (it must be on offer). */
function chip(f: Fake, cs: string, prefix: string) {
  const s = chips(f.sim, cs).find((x) => x.label.startsWith(prefix));
  if (!s) throw new Error(`t=${f.sim.t}: no "${prefix}" chip for ${cs}; offered: ${chips(f.sim, cs).map((x) => x.label).join(' | ') || 'nothing'}`);
  f.select(cs);
  const r = f.sim.issue({ cs, items: s.items });
  expect(r.ok).toBe(true);
  return s;
}
/** Tap the bright (primary) chip. */
function lead(f: Fake, cs: string, prefix?: string) {
  const s = chips(f.sim, cs)[0];
  if (!s?.primary || (prefix && !s.label.startsWith(prefix))) throw new Error(`t=${f.sim.t}: lead chip for ${cs} is "${s?.label}" (${s?.primary ? 'primary' : 'not primary'}), expected ${prefix ?? 'a primary'}`);
  f.select(cs);
  f.sim.issue({ cs, items: s.items });
  return s;
}
/** Pick a value in a picker: the value must be offered there. */
function pick(f: Fake, cs: string, it: Item) {
  if (it.k === 'lvl') expect(levelList(f.sim).some((l) => f.sim.ftOf(l) === f.sim.ftOf(it.lvl)), `level ${JSON.stringify(it.lvl)} in the grid`).toBe(true);
  f.select(cs);
  f.items = mergeItem(f.items, it);
}
function transmit(f: Fake) { expect(f.cs).toBeDefined(); const r = f.sim.issue({ cs: f.cs!, items: sortItems(f.items) }); f.items = []; return r; }
const say = (f: Fake, cs: string, items: Item[]) => { f.select(cs); return f.sim.issue({ cs, items }); };

type Act = ((f: Fake, x: StepCtx) => void) | { when: (f: Fake, x: StepCtx) => boolean; do: (f: Fake, x: StepCtx) => void };
interface WalkOpts { answers?: Record<string, number>; background?: (f: Fake, step: string) => void; maxStepS?: number }

/** Fly a lesson step by step. Returns the fake game so the exam (quizzes) can continue in it. */
function walk(lesson: Lesson, acts: Record<string, Act>, o: WalkOpts = {}) {
  const sim = new Sim(pack, lesson.scenario);
  try { return walk0(lesson, acts, o, sim); } catch (e) {
    const ctx = sim.log.slice(-14).map((t) => `  ${t.t0} ${t.from} ${t.cs}: ${t.text}`).join('\n') + '\n  events: ' + sim.events.map((x) => `${x.t} ${x.kind} ${x.cs ?? ''}`).join(', ') + '\n  aircraft: ' + sim.aircraft.map((a) => `${a.cs} (${a.p.x.toFixed(1)},${a.p.y.toFixed(1)}) ${Math.round(a.alt)} ${a.mode} ${a.state} app=${a.app ? (a.app.locCap ? 'LOC' : 'armed') : '-'}`).join('; ');
    (e as Error).message += `\n${ctx}`;
    throw e;
  }
}
function walk0(lesson: Lesson, acts: Record<string, Act>, o: WalkOpts, sim: Sim) {
  if ((globalThis as any).process?.env?.TUT_DEBUG) sim.onEvent.push((e) => { if (e.kind === 'stca') console.log('STCA', e.t, sim.aircraft.map((a) => `${a.cs} (${a.p.x.toFixed(1)},${a.p.y.toFixed(1)}) ${Math.round(a.alt)}->${Math.round(a.tgtAlt)} hdg${Math.round(a.hdg)} ${a.mode} ${a.route.map((l) => l.fix).join('-')} ${a.state}`).join(' | ')); });
  const f = fake(sim);
  const trail: string[] = [];
  for (const st of lesson.steps) {
    const x: StepCtx = { cmdStart: sim.cmdLog.length, logStart: sim.log.length, t0: sim.t, s0: f.scope.scale };
    st.onEnter?.(f as any, x);
    if (st.cs && !st.noAutoSelect && sim.find(st.cs)) f.select(st.cs);
    // body text must render at every step
    const body = typeof st.body === 'function' ? st.body(f as any) : st.body;
    expect(body.length, `${lesson.id}/${st.id} body`).toBeGreaterThan(10);
    if (st.ask) {
      const opts = typeof st.ask.options === 'function' ? st.ask.options(f as any) : st.ask.options;
      const right = typeof st.ask.correct === 'function' ? st.ask.correct(f as any) : st.ask.correct;
      expect(right).toBeLessThan(opts.length);
      if (o.answers?.[st.id] !== undefined) expect(o.answers[st.id]).toBe(right);
      x.asked = true;
    }
    const act = acts[st.id];
    let did = !act;
    const limit = o.maxStepS ?? 1200;
    let k = 0;
    for (; k <= limit; k++) {
      if (!did) {
        const a = act!;
        if (typeof a === 'function') { a(f, x); did = true; }
        else if (a.when(f, x)) { a.do(f, x); did = true; }
      }
      if (!st.done || st.done(f as any, x)) break;
      if (!st.run && did && k === 0) {
        // a paused step must be finished by the student's action alone
        throw new Error(`${lesson.id}/${st.id}: paused step not done after its action (t=${sim.t})`);
      }
      sim.step();
      o.background?.(f, st.id);
    }
    trail.push(`${st.id}@${sim.t}`);
    expect(did, `${lesson.id}/${st.id}: action never became possible (${trail.join(' ')})`).toBe(true);
    expect(!st.done || st.done(f as any, x), `${lesson.id}/${st.id}: not done after ${k} s (${trail.join(' ')})`).toBe(true);
  }
  return { sim, f, trail };
}

/** Run an exam scenario with a script. */
function exam(lesson: Lesson, script: (sim: Sim, once: (k: string, c: boolean) => boolean) => void, maxS = 2400): { v: Verdict | undefined; sim: Sim } {
  const ex = lesson.exam!;
  const sim = new Sim(pack, ex.scenario!);
  const m = examMem(sim);
  const did = new Set<string>();
  const once = (k: string, c: boolean) => (c && !did.has(k) ? (did.add(k), true) : false);
  let v: Verdict | undefined;
  while (sim.t < maxS) {
    sim.step();
    ex.watch?.(sim, m);
    v = examVerdict(ex, sim, m);
    if (v) break;
    script(sim, once);
    ex.status?.(sim, m);
  }
  if ((globalThis as any).process?.env?.TUT_DEBUG) console.log(lesson.id, 'exam', JSON.stringify(v), '\n', sim.log.slice(-30).map((t) => `  ${t.t0} ${t.from} ${t.cs}: ${t.text}`).join('\n'), '\n events:', sim.events.map((x) => `${x.t} ${x.kind} ${x.text}`).join('\n  '));
  return { v, sim };
}
const calling = (sim: Sim, cs: string) => isCalling(sim, cs) && !sim.readbackPending(cs);
/** Arrivals established on the localizer: 160 kt and Tower, as the "160 to 4 · Tower" chip does. */
const towerWhenEstablished = (sim: Sim, once: (k: string, c: boolean) => boolean) => {
  for (const a of sim.aircraft) if (a.kind === 'arr' && a.state === 'assumed' && a.app?.locCap && sim.dthr(a) < 12 && once('twr' + a.cs + a.goArounds, true)) sim.issue({ cs: a.cs, items: [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: 'TWR' }] });
};
/** the student's Tower handoffs during the steps that say so ("Tower chips for both") */
const towerIn = (...steps: string[]) => (f: Fake, step: string) => { if (steps.includes(step)) towerFake(f); };
const towerFake = (f: Fake) => { for (const a of f.sim.aircraft) if (a.kind === 'arr' && a.state === 'assumed' && a.app?.locCap && f.sim.dthr(a) < 12 && !f.sim.readbackPending(a.cs)) chip(f, a.cs, a.ias > 175 ? '160 to 4' : 'Tower'); };
const penalties = (sim: Sim) => sim.events.filter((e) => e.cost > 0).map((e) => e.text);
const xt = (sim: Sim, cs: string) => { const a = sim.find(cs)!; return crossTrack(a.p, sim.rwy.thr, sim.rwy.crs); };
const along = (sim: Sim, cs: string) => { const a = sim.find(cs)!; return alongTrack(a.p, sim.rwy.thr, norm360(sim.rwy.crs + 180)); };

// ---------------------------------------------------------------- text rules
describe('tutorial text', () => {
  const texts: [string, string][] = [];
  for (const l of LESSONS) {
    texts.push([`${l.id}.title`, l.title], [`${l.id}.summary`, l.summary]);
    for (const s of l.steps) { texts.push([`${l.id}/${s.id}.title`, s.title]); if (typeof s.body === 'string') texts.push([`${l.id}/${s.id}`, s.body]); if (s.ask && typeof s.ask.why === 'string') texts.push([`${l.id}/${s.id}.why`, s.ask.why]); }
    if (l.exam) texts.push([`${l.id}.exam`, l.exam.brief + ' ' + l.exam.rule + ' ' + l.exam.title]);
  }
  it('has eleven lessons, each ending in an exam, with unique ids', () => {
    expect(LESSONS.length).toBe(11);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(11);
    for (const l of LESSONS) { expect(l.exam, l.id).toBeDefined(); expect(new Set(l.steps.map((s) => s.id)).size, l.id).toBe(l.steps.length); }
  });
  it('uses plain English: no em dashes, none of the banned words', () => {
    for (const [k, t] of texts) {
      expect(t, k).not.toMatch(/—/);
      expect(t.toLowerCase(), k).not.toMatch(/\b(delve|crucial|furthermore|moreover|testament|beacon|tapestry)\b/);
    }
  });
  it('only links words that are in the glossary', () => {
    const all = texts.map(([, t]) => t).join(' ') + LESSONS.flatMap((l) => l.steps.map((s) => (typeof s.body === 'function' ? s.body.toString() : ''))).join(' ');
    const keys = [...all.matchAll(/G\('([^']+)'/g), ...all.matchAll(/data-gloss="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect(GLOSSARY[k], k).toBeDefined();
  });
});

// ---------------------------------------------------------------- lessons
describe('lessons fly the way the coach says', () => {
  it('1 the scope, and the quiz exam', () => {
    const { sim, f } = walk(L('scope'), {
      zoom: (f) => { f.scope.scale *= 1.35 * 1.35; },
      alhuv: (f, x) => { const p = f.sim.pack.fixes.get('ALHUV')!.p; x.tap = { x: p.x + 0.5, y: p.y, t: 1 }; },
      mva: (f, x) => { x.tap = { x: 0, y: -25, t: 2 }; },
      select: (f) => f.select('QTR8125'),
    }, { answers: { levels: 1 } });
    // the clock stayed stopped: nobody called
    expect(sim.t).toBeLessThan(5);
    expect(f.settings.showMva).toBe(false);
    // quiz: right answers pass with three stars, wrong ones fail
    const ex = L('scope').exam!;
    const good = examMem(sim), bad = examMem(sim);
    for (const q of ex.quiz!) { const r = q.answer(sim); good.answers.push(r); good.right++; bad.answers.push((r + 1) % (typeof q.options === 'function' ? q.options(sim) : q.options).length); }
    expect(examVerdict(ex, sim, good)).toMatchObject({ pass: true, stars: 3 });
    expect(examVerdict(ex, sim, bad)?.pass).toBe(false);
    // the answers are distinct and stable while paused
    const a = sim.find('FDX5203')!;
    expect(Math.hypot(a.p.x, a.p.y)).toBeGreaterThan(15);
    expect(Math.hypot(a.p.x, a.p.y)).toBeLessThan(25);
  });

  it('2 first contact, and the three-caller exam', () => {
    const { sim } = walk(L('contact'), {
      select: (f) => f.select('QTR8125'),
      chip: (f) => chip(f, 'QTR8125', 'Descend FL060'),
      grid: (f) => pick(f, 'AZG7321', { k: 'lvl', lvl: { fl: 70 } }),
      send: (f) => transmit(f),
      answer: (f) => { f.select('ETH3721'); lead(f, 'ETH3721'); },
    });
    expect(sim.events.filter((e) => e.kind === 'unanswered').map((e) => e.cs)).toEqual(['ETH3721']);
    // exam: answer each caller a few seconds after it calls
    const good = exam(L('contact'), (sim, once) => {
      for (const cs of ['QTR8125', 'AZG7321', 'FDX5203']) if (calling(sim, cs) && sim.t - sim.find(cs)!.awaitingSince! >= 3 && once(cs, true)) { const s = suggest(sim, sim.find(cs)!).find((x) => x.label.startsWith('Descend'))!; sim.issue({ cs, items: s.items }); }
    });
    expect(good.v).toMatchObject({ pass: true, stars: 3 });
    const ignored = exam(L('contact'), () => {});
    expect(ignored.v?.pass).toBe(false);
  });

  it('3 turns: dial, drag, and the two-gate exam', () => {
    walk(L('turns'), {
      select: (f) => f.select('CHG201'),
      dial: (f) => { f.els.picker.hidden = false; f.els.picker.dataset.kind = 'hdg'; },
      pick: (f) => { f.items = mergeItem(f.items, { k: 'hdg', hdg: 60, dir: 'L' }); f.els.picker.hidden = true; },
      send: (f) => transmit(f),
      drag: (f) => say(f, 'CHG201', [{ k: 'hdg', hdg: 120, dir: 'R' }]),
    }, { answers: { lr: 0 } });
    const g1 = pack.fixes.get('LG008')!.p;
    const good = exam(L('turns'), (sim, once) => {
      const a = sim.find('CHG201'); if (!a) return;
      if (once('h1', calling(sim, 'CHG201'))) sim.issue({ cs: 'CHG201', items: [{ k: 'hdg', hdg: 65, dir: 'L' }] });
      if (once('h2', dist(a.p, g1) < 0.9)) sim.issue({ cs: 'CHG201', items: [{ k: 'hdg', hdg: 200, dir: 'R' }] });
    });
    expect(good.v?.pass, good.v?.why).toBe(true);
    const straight = exam(L('turns'), (sim, once) => { if (once('a', calling(sim, 'CHG201'))) sim.issue({ cs: 'CHG201', items: [{ k: 'lvl', lvl: { fl: 70 } }] }); });
    expect(straight.v?.pass).toBe(false);
    const cheat = exam(L('turns'), (sim, once) => { if (once('a', calling(sim, 'CHG201'))) sim.issue({ cs: 'CHG201', items: [{ k: 'dct', fix: 'LG008' }] }); });
    expect(cheat.v).toMatchObject({ pass: false });
  });

  it('4 descent planning: the SUP line, and the FL090 exam', () => {
    let hintSeen = false;
    const { sim } = walk(L('descent'), {
      step: (f) => chip(f, 'TAY4EK', 'Descend FL070'),
      rest: (f) => lead(f, 'TAY4EK', 'ALHUV1B · 3000 · ILS 22L'),
      fix: (f) => { pick(f, 'QTR8152', { k: 'lvl', lvl: { ft: 2500 } }); expect(transmit(f).warnings).toEqual([]); },
      tayTwr: { when: (f) => !!f.sim.find('TAY4EK')?.app?.locCap && !f.sim.readbackPending('TAY4EK'), do: (f) => chip(f, 'TAY4EK', '160 to 4') },
      land: { when: (f) => !!f.sim.find('QTR8152')?.app?.locCap && !f.sim.readbackPending('QTR8152'), do: (f) => chip(f, 'QTR8152', '160 to 4') },
    }, { answers: { need: 1, have: 1 }, background: (f) => {
      // what the SUP line shows is the most urgent hint: it must be the descent warning when the coach says so
      const top = hints(f.sim)[0];
      if (top?.key === 'high:QTR8152') hintSeen = true;
    } });
    expect(hintSeen).toBe(true);
    expect(sim.landings.length + sim.aircraft.filter((a) => a.state === 'transferred').length).toBe(2);
    expect(sim.events.filter((e) => ['goaround', 'los', 'mva', 'stca', 'wake'].includes(e.kind))).toEqual([]);
    // exam: step down in good time, then the transition
    const good = exam(L('descent'), (sim, once) => {
      const a = sim.find('QTR8152'); if (!a) return;
      if (once('c', calling(sim, 'QTR8152'))) sim.issue({ cs: 'QTR8152', items: [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { fl: 60 } }, ILS] });
      if (once('d', !!a.app && a.alt < 6600)) sim.issue({ cs: 'QTR8152', items: [{ k: 'lvl', lvl: { ft: 2500 } }, { k: 'spd', spd: 210 }] });
      towerWhenEstablished(sim, once);
    });
    expect(good.v?.pass, good.v?.why).toBe(true);
    expect(good.v!.stars).toBe(3);
    const ignored = exam(L('descent'), (sim, once) => { if (once('c', calling(sim, 'QTR8152'))) sim.issue({ cs: 'QTR8152', items: [{ k: 'trans', name: 'ALHUV1B' }, ILS] }); towerWhenEstablished(sim, once); });
    expect(ignored.v?.pass).toBe(false);
  });

  it('5 vectors, and the exam from the other side', () => {
    const { sim } = walk(L('vectors'), {
      downwind: (f) => say(f, 'CHG201', [{ k: 'hdg', hdg: 45, dir: 'L' }]),
      down: (f) => { pick(f, 'CHG201', { k: 'lvl', lvl: { ft: 3000 } }); pick(f, 'CHG201', { k: 'spd', spd: 210 }); expect(transmit(f).warnings).toEqual([]); },
      base: (f) => chip(f, 'CHG201', 'Base R135'),
      intercept: { when: (f) => Math.abs(xt(f.sim, 'CHG201')) < 2.2, do: (f) => chip(f, 'CHG201', 'R195 · ILS 22L') },
      twr: (f) => chip(f, 'CHG201', '160 to 4'),
    });
    expect(sim.landings.map((l) => l.cs)).toEqual(['CHG201']);
    expect(penalties(sim)).toEqual([]);
    const good = exam(L('vectors'), (sim, once) => {
      const a = sim.find('DHK7'); if (!a) return;
      if (once('dw', calling(sim, 'DHK7'))) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 45, dir: 'R' }, { k: 'lvl', lvl: { ft: 4000 } }] });
      if (once('lo', sim.t > 60)) sim.issue({ cs: 'DHK7', items: [{ k: 'lvl', lvl: { ft: 3000 } }, { k: 'spd', spd: 210 }] });
      if (once('base', sim.t > 60 && along(sim, 'DHK7') > 12)) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 315, dir: 'L' }] });
      if (once('icpt', sim.t > 80 && a.hdgSys !== undefined && norm360(a.hdgSys - 2) > 300 && Math.abs(xt(sim, 'DHK7')) < 2.3)) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 255, dir: 'L' }, ILS] });
      towerWhenEstablished(sim, once);
    });
    expect(good.v?.pass, good.v?.why).toBe(true);
    const late = exam(L('vectors'), (sim, once) => {
      if (once('dw', calling(sim, 'DHK7'))) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 45, dir: 'R' }, { k: 'lvl', lvl: { ft: 4000 } }] });
      if (once('base', sim.t > 60 && along(sim, 'DHK7') > 12)) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 315, dir: 'L' }] });
      if (once('icpt', sim.t > 80 && Math.abs(xt(sim, 'DHK7')) < 2.3)) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 255, dir: 'L' }, ILS] });
    }); // never slowed, never handed to Tower
    expect(late.v?.pass).toBe(false);
  });

  it('6 separation: the alarm, and two converging pairs', () => {
    const { sim } = walk(L('separation'), {
      rbl: (f) => { f.scope.rbls.push({ a: { cs: 'AZG7321' }, b: { cs: 'ETH3721' } }); },
      act: (f) => chip(f, 'ETH3721', 'Descend FL060'),
    }, { answers: { cpa: 1 } });
    expect(sim.events.filter((e) => e.kind === 'stca').length).toBe(1);
    expect(sim.events.filter((e) => e.kind === 'los')).toEqual([]);
    const good = exam(L('separation'), (sim, once) => {
      if (once('p1', calling(sim, 'ETH3721'))) sim.issue({ cs: 'ETH3721', items: [{ k: 'lvl', lvl: { fl: 60 } }] });
      if (once('p2', calling(sim, 'TAY4EK'))) sim.issue({ cs: 'TAY4EK', items: [{ k: 'lvl', lvl: { fl: 60 } }] });
      for (const cs of ['CLX7HK', 'FDX5203']) if (once(cs, calling(sim, cs))) sim.issue({ cs, items: [{ k: 'lvl', lvl: { fl: 80 } }] });
    });
    expect(good.v).toMatchObject({ pass: true, stars: 3 });
    const ignored = exam(L('separation'), () => {});
    expect(ignored.v?.pass).toBe(false);
  });

  it('7 transitions and the hold, and three for one runway', () => {
    const { sim } = walk(L('transitions'), {
      trans: (f) => lead(f, 'AZG7321', 'ALHUV1A · 3000 · ILS 22L'),
      hold: (f) => { pick(f, 'QTR8152', { k: 'hold', fix: 'ALHUV' }); transmit(f); },
      stack: (f) => { pick(f, 'QTR8152', { k: 'lvl', lvl: { ft: 5000 } }); expect(transmit(f).warnings).toEqual([]); },
      // the chip turns bright a moment after AZG7321 captures the localizer (the slot and conflict checks run first)
      release: { when: (f) => !!chips(f.sim, 'QTR8152')[0]?.label.startsWith('Leave hold') && !!chips(f.sim, 'QTR8152')[0]?.primary, do: (f) => lead(f, 'QTR8152', 'Leave hold') },
      twr: { when: (f) => chips(f.sim, 'AZG7321').some((s) => s.label === 'Tower'), do: (f) => chip(f, 'AZG7321', 'Tower') },
      land: { when: (f) => chips(f.sim, 'QTR8152').some((s) => s.label === 'Tower'), do: (f) => chip(f, 'QTR8152', 'Tower') },
    }, { answers: { tl: 1 } });
    expect(sim.events.filter((e) => ['los', 'wake', 'stack', 'goaround', 'stca', 'mva'].includes(e.kind))).toEqual([]);
    // exam: the autopilot's sequencing (transition, stack, release in order) passes; doing nothing fails
    const good = exam(L('transitions'), (sim) => autoControl(sim));
    expect(good.v?.pass, good.v?.why).toBe(true);
    const ignored = exam(L('transitions'), () => {}, 2000);
    expect(ignored.v?.pass).toBe(false);
  });

  it('8 wake spacing: 180 kt holds about 4.4 NM, and the two-gap exam', () => {
    const { sim } = walk(L('spacing'), {
      speed: (f) => { pick(f, 'TAY4EK', { k: 'spd', spd: 180 }); transmit(f); },
    }, { background: towerIn('land') });
    const gap = sim.spacing.find((s) => s.leader === 'CLX7HK')!;
    expect(gap.gap).toBeGreaterThanOrEqual(4);
    expect(gap.gap).toBeLessThan(5);
    expect(sim.events.filter((e) => e.kind === 'wake' || e.kind === 'goaround')).toEqual([]);
    // exam: slow each follower when its leader is established
    const good = exam(L('spacing'), (sim, once) => {
      const c = sim.find('CLX7HK'), t = sim.find('TAY4EK'), d = sim.find('DHK7');
      if (t && once('t', !!c?.app?.locCap && sim.dthr(t) < 16)) sim.issue({ cs: 'TAY4EK', items: [{ k: 'spd', spd: 180 }] });
      if (d && once('d', !!t?.app?.locCap && sim.dthr(d) < 16)) sim.issue({ cs: 'DHK7', items: [{ k: 'spd', spd: SPACING_EXAM_SPD }] });
      towerWhenEstablished(sim, once);
    });
    expect(good.v?.pass, good.v?.why).toBe(true);
    const ignored = exam(L('spacing'), (sim, once) => towerWhenEstablished(sim, once));
    expect(ignored.v?.pass).toBe(false);
  });

  it('9 departures and releases, and the two-departure exam', () => {
    const { sim } = walk(L('departures'), {
      card: { when: (f) => !!f.sim.releases.find((r) => r.cs === 'CHG7302' && r.state === 'pending'), do: (f) => { const fdx = f.sim.find('FDX5203')!; expect(fdx.app && f.sim.dthr(fdx) < 14, 'After FDX5203 is on offer').toBeTruthy(); say(f, 'CHG7302', [{ k: 'rel', after: 'FDX5203' }]); } },
      fdx: { when: (f) => chips(f.sim, 'FDX5203').some((s) => s.label === 'Tower'), do: (f) => chip(f, 'FDX5203', 'Tower') },
      answer: (f) => { pick(f, 'CHG7302', { k: 'lvl', lvl: { fl: 60 } }); transmit(f); },
      climb: { when: (f) => { const a = f.sim.find('CHG7302')!, z = f.sim.find('AZG7321'); if (f.sim.readbackPending('CHG7302')) return false; return !z || (dist(a.p, z.p) > 6 && alongTrack(z.p, a.p, a.trk) < 0); }, do: (f) => chip(f, 'CHG7302', 'Climb FL090') },
      bru: { when: (f) => chips(f.sim, 'CHG7302').some((s) => s.label === 'Brussels'), do: (f) => chip(f, 'CHG7302', 'Brussels') },
    });
    expect(sim.events.filter((e) => ['los', 'stca', 'exit_unxfr', 'release_delay', 'airspace'].includes(e.kind))).toEqual([]);
    const good = exam(L('departures'), (sim, once) => {
      for (const r of sim.releases) if (r.state === 'pending' && once('rel' + r.cs, sim.t - r.t > 4)) sim.issue({ cs: r.cs, items: [{ k: 'rel' }] });
      const q = sim.find('QTR8125');
      if (q && once('q', calling(sim, 'QTR8125'))) sim.issue({ cs: 'QTR8125', items: [{ k: 'lvl', lvl: { fl: 80 } }] });
      for (const cs of ['CHG7302', 'BCS7']) {
        const a = sim.find(cs); if (!a || a.state !== 'assumed') continue;
        if (once('ans' + cs, calling(sim, cs))) sim.issue({ cs, items: [{ k: 'lvl', lvl: { fl: 60 } }] });
        const clear = !q || q.state !== 'assumed' || dist(a.p, q.p) > 8 && alongTrack(q.p, a.p, a.trk) < 0 || Math.abs(a.p.x - q.p.x) > 15;
        if (once('cl' + cs, clear && a.alt > 4000 && sentAnyTo(sim, cs))) sim.issue({ cs, items: [{ k: 'lvl', lvl: { fl: 90 } }] });
        if (once('bru' + cs, Math.hypot(a.p.x, a.p.y) > 20)) sim.issue({ cs, items: [{ k: 'xfr', unit: 'BRU' }] });
      }
    });
    expect(good.v?.pass, good.v?.why).toBe(true);
    const ignored = exam(L('departures'), () => {});
    expect(ignored.v?.pass).toBe(false);
  });

  it('11 the full position: estimates, sequence, correction, and the short night', () => {
    const { sim } = walk(L('position'), {
      seq: (f) => { const order = ['TAY4EK', 'CLX7HK']; f.sim.setSequence(order); },
      corr: (f) => { const r = say(f, 'CLX7HK', [{ k: 'spd', spd: 220 }]); expect(r.ok).toBe(true); expect(f.sim.correct('CLX7HK')).toBe(true); },
    });
    expect(sim.events.filter((e) => ['los', 'wake'].includes(e.kind))).toEqual([]);
    const good = exam(L('position'), (sim) => {
      autoControl(sim);
      for (const r of sim.coordReqs) if (r.state === 'pending') sim.issue({ cs: r.cs, items: [{ k: 'appr' }] });
      for (const r of sim.releases) if (r.state === 'pending' && sim.t - r.t > 3) sim.issue({ cs: r.cs, items: [{ k: 'rel' }] });
    });
    expect(good.v?.pass, good.v?.why).toBe(true);
    const ignored = exam(L('position'), () => {});
    expect(ignored.v?.pass).toBe(false);
  });

  it('10 safety nets and a MAYDAY, and the checkride', () => {
    const { sim } = walk(L('safety'), {
      clear: (f) => chip(f, 'ETH3721', 'Descend FL060'),
      negative: (f) => lead(f, 'ETH3721', 'Negative · FL060'),
      approach: (f) => lead(f, 'ETH3721', 'ALHUV1A · 3000 · ILS 22L'),
      card: (f) => f.select('CLX7HK'),
      priority: (f) => lead(f, 'CLX7HK', 'Direct LIBVA'),
      ethTwr: { when: (f) => !!f.sim.find('ETH3721')?.app?.locCap && !f.sim.readbackPending('ETH3721'), do: (f) => chip(f, 'ETH3721', '160 to 4') },
      land: { when: (f) => !!f.sim.find('CLX7HK')?.app?.locCap && !f.sim.readbackPending('CLX7HK'), do: (f) => chip(f, 'CLX7HK', '160 to 4') },
    }, { answers: { spot: 1 } });
    expect(sim.events.some((e) => e.kind === 'readback_caught')).toBe(true);
    expect(['CLX7HK', 'ETH3721'].every((cs) => sim.landings.some((l) => l.cs === cs) || sim.find(cs)?.state === 'transferred')).toBe(true);
    expect(sim.events.filter((e) => ['los', 'goaround', 'readback_missed', 'wake', 'stca', 'mva'].includes(e.kind)).map((e) => e.text + ' @' + e.t + ' ' + JSON.stringify(sim.landings))).toEqual([]);
    // a careful controller: the autopilot's plan, plus catching every wrong readback with the Negative chip
    const good = exam(L('safety'), (sim, once) => {
      for (const a of sim.aircraft) if (a.wrong && !sim.readbackPending(a.cs) && once('neg' + a.cs + a.wrong.t, true)) { const s = suggest(sim, a)[0]; expect(s?.label.startsWith('Negative')).toBe(true); sim.issue({ cs: a.cs, items: s.items }); }
      autoControl(sim);
    }, 3000);
    expect(good.v?.pass, good.v?.why).toBe(true);
    const ignored = exam(L('safety'), () => {});
    expect(ignored.v?.pass).toBe(false);
  });
});

const sentAnyTo = (sim: Sim, cs: string) => sim.cmdLog.some((c) => c.cl.cs === cs);
const SPACING_EXAM_SPD = 180;
void (null as unknown as Step);
