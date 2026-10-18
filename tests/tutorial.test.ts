import { describe, expect, it } from 'vitest';
import { loadPackById } from '../src/pack/index';
import { Sim } from '../src/engine/sim';
import { suggest, levelList } from '../src/engine/suggest';
import { hints } from '../src/engine/hints';
import { autoControl } from '../src/engine/autopilot';
import { mergeItem, sortItems, type Item } from '../src/engine/clearance';
import {
  LESSONS, ALL_LESSONS, lessonsFor, lessonById, STAGES, examMem, examVerdict, isCalling, bestInstructorSync, narrate, drillOfTheDay, curriculumProgress,
  type Lesson, type Step, type StepCtx, type Verdict,
} from '../src/ui/tutorial';
import { GLOSSARY } from '../src/ui/glossary';
import { alongTrack, crossTrack, dist, norm360 } from '../src/geo';

// Every lesson is flown here the way its coach tells a student to: each step's
// action uses the control the coach names (a suggestion chip must really be on
// offer with that label; a picker value must really be in the picker), then the
// step's done-condition must come true. Every exam is flown by its instructor (the
// lesson's solution, or the engine's scripted controllers) and must pass; several are
// also ignored or flown badly and must fail.

const packOf = (l: Lesson) => loadPackById(l.icao);
const L = (id: string) => lessonById(id)!;
const ILS: Item = { k: 'app', app: 'ILS', rwy: '22L' };

// ---------------------------------------------------------------- a stand-in for the game screen
interface Fake { sim: Sim; cs?: string; items: Item[]; coachHints: boolean; scope: any; settings: any; els: any; root: any; halo: { enabled: boolean }; staging: { queue: { cs: string; items: Item[] }[]; length: number }; select(cs?: string): void; setSpeed(n: number): void }
function fake(sim: Sim): Fake {
  const cls = new Set<string>();
  const f: Fake = {
    sim, items: [], coachHints: false,
    scope: { scale: 8, rbls: [], marks: [], reserved: [], rblMode: false, w: 390, h: 577, toW: (x: number, y: number) => ({ x, y }), plot: (a: any) => a.p, fit() {}, focus() {}, animateTo() {} },
    settings: { showMva: false },
    els: { picker: { hidden: true, dataset: {} as Record<string, string> } },
    root: { querySelector: () => null, querySelectorAll: () => [], classList: { contains: (c: string) => cls.has(c), add: (c: string) => cls.add(c), toggle: (c: string) => (cls.has(c) ? (cls.delete(c), false) : (cls.add(c), true)) } },
    halo: { enabled: false },
    staging: { queue: [], get length() { return this.queue.length; } },
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
  if (!s?.primary || (prefix && !s.label.startsWith(prefix))) throw new Error(`t=${f.sim.t}: lead chip for ${cs} is "${s?.label}" (${s?.primary ? 'primary' : 'not primary'}), expected ${prefix ?? 'a primary'}; offered: ${chips(f.sim, cs).map((x) => x.label).join(' | ')}`);
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
/** A halo rung: the level must be one the halo's ladder could show (any level in the grid). */
const rung = (f: Fake, cs: string, it: Item) => { if (it.k === 'lvl') expect(levelList(f.sim).some((l) => f.sim.ftOf(l) === f.sim.ftOf(it.lvl))).toBe(true); return say(f, cs, [it]); };

type Act = ((f: Fake, x: StepCtx) => void) | { when: (f: Fake, x: StepCtx) => boolean; do: (f: Fake, x: StepCtx) => void };
interface WalkOpts { answers?: Record<string, number>; background?: (f: Fake, step: string) => void; maxStepS?: number }

/** Fly a lesson step by step. Returns the fake game so the exam (quizzes) can continue in it. */
function walk(lesson: Lesson, acts: Record<string, Act>, o: WalkOpts = {}) {
  const sim = new Sim(packOf(lesson), lesson.scenario);
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
      if (sim.pack.meta.icao === 'EDDL' && lesson.id !== 'eddl-transitions') downwindDescents(f);
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
  const sim = new Sim(packOf(lesson), ex.scenario!);
  const m = examMem(sim);
  const did = new Set<string>();
  const once = (k: string, c: boolean) => (c && !did.has(k) ? (did.add(k), true) : false);
  let v: Verdict | undefined;
  while (sim.t < maxS) {
    const t0 = sim.t;
    sim.step();
    ex.watch?.(sim, m);
    v = examVerdict(ex, sim, m);
    if (v) break;
    if (sim.t === t0) { v = { pass: false, stars: 0, why: 'The session ended before the exam was complete.' }; break; }
    script(sim, once);
    ex.status?.(sim, m);
  }
  if ((globalThis as any).process?.env?.TUT_DEBUG) console.log(lesson.id, 'exam', JSON.stringify(v), '\n', sim.log.slice(-30).map((t) => `  ${t.t0} ${t.from} ${t.cs}: ${t.text}`).join('\n'), '\n events:', sim.events.map((x) => `${x.t} ${x.kind} ${x.text}`).join('\n  '));
  return { v, sim };
}
const calling = (sim: Sim, cs: string) => isCalling(sim, cs) && !sim.readbackPending(cs);
/** the student's Tower handoffs during the steps that say so ("Tower chips for both") */
/** what a student who has taken the transitions lesson does at Düsseldorf: the descent off the FL060 downwind when its chip turns bright */
const downwindDescents = (f: Fake) => {
  for (const a of f.sim.aircraft) {
    if (a.kind !== 'arr' || a.state !== 'assumed' || !a.app || a.app.locCap || a.mode !== 'NAV' || f.sim.readbackPending(a.cs) || f.sim.ftOf(a.cleared) <= 3000) continue;
    const s = chips(f.sim, a.cs)[0];
    if (s?.primary && s.label.startsWith('Descend')) f.sim.issue({ cs: a.cs, items: s.items });
  }
};
/** the step says "use speed": the student takes the bright speed chip when one comes up */
const speedChips = (f: Fake) => {
  for (const a of f.sim.aircraft) {
    if (a.kind !== 'arr' || a.state !== 'assumed' || f.sim.readbackPending(a.cs)) continue;
    const s = chips(f.sim, a.cs)[0];
    if (s?.primary && s.items.length === 1 && (s.items[0].k === 'spd' || s.items[0].k === 'spdmin')) f.sim.issue({ cs: a.cs, items: s.items });
  }
};
const towerIn = (...steps: string[]) => (f: Fake, step: string) => { if (steps.includes(step)) towerFake(f); };
const towerFake = (f: Fake) => { for (const a of f.sim.aircraft) if (a.kind === 'arr' && a.state === 'assumed' && a.app?.locCap && f.sim.dthr(a) < 12 && !f.sim.readbackPending(a.cs)) chip(f, a.cs, a.ias > 175 ? '160 to 4' : 'Tower'); };
const penalties = (sim: Sim) => sim.events.filter((e) => e.cost > 0).map((e) => e.text);
const xt = (sim: Sim, cs: string) => { const a = sim.find(cs)!; return crossTrack(a.p, sim.rwy.thr, sim.rwy.crs); };
const along = (sim: Sim, cs: string) => { const a = sim.find(cs)!; return alongTrack(a.p, sim.rwy.thr, norm360(sim.rwy.crs + 180)); };
const established = (f: Fake, cs: string) => !!f.sim.find(cs)?.app?.locCap && !f.sim.readbackPending(cs);
/** the lead chip when it is on offer (any text), used by the Düsseldorf steps that say "its lead chip" */
const leadWhenCalling = (cs: string): Act => ({ when: (f) => calling(f.sim, cs), do: (f) => lead(f, cs) });
/** holders leave the hold on the primary Leave hold chip (what the student does in the long Düsseldorf steps) */
const releaseHolds = (f: Fake) => { for (const a of f.sim.aircraft) if (a.state === 'assumed' && !f.sim.readbackPending(a.cs) && a.mode === 'HOLD') { const s = chips(f.sim, a.cs).find((x) => x.label.startsWith('Leave hold') && x.primary); if (s) f.sim.issue({ cs: a.cs, items: s.items }); } };

/** the bright chip for this aircraft starts with `prefix` */
const leadOn = (f: Fake, cs: string, prefix: string) => { const s = chips(f.sim, cs)[0]; return !!s?.primary && s.label.startsWith(prefix) && !f.sim.readbackPending(cs); };
/** the student works the arrivals off the downwind: the bright shortcut, approach, descent or hold chip when one comes up */
const arrivalsLead = (f: Fake, only?: string[]) => {
  for (const a of f.sim.aircraft) {
    if (a.kind !== 'arr' || a.state !== 'assumed' || a.app?.locCap || a.txCount === 0 || f.sim.readbackPending(a.cs) || (only && !only.includes(a.cs))) continue;
    const s = chips(f.sim, a.cs)[0];
    if (s?.primary && s.items.some((i) => ['app', 'dct', 'hold', 'trans', 'lvl', 'expect'].includes(i.k))) f.sim.issue({ cs: a.cs, items: s.items });
  }
};
/** a departure that has called: its bright climb or hand-on chip, or a roger while it waits */
const departuresOn = (f: Fake, cs: string) => {
  const a = f.sim.find(cs);
  if (!a || a.state !== 'assumed' || f.sim.readbackPending(cs)) return;
  const s = chips(f.sim, cs)[0];
  if (s?.primary && s.items.some((i) => i.k === 'lvl' || i.k === 'xfr')) f.sim.issue({ cs, items: s.items });
  else if (calling(f.sim, cs)) f.sim.issue({ cs, items: [{ k: 'roger' }] });
};

// ---------------------------------------------------------------- text rules and structure
describe('academy structure and text', () => {
  const texts: [string, string][] = [];
  for (const l of ALL_LESSONS) {
    texts.push([`${l.id}.title`, l.title], [`${l.id}.summary`, l.summary]);
    for (const s of l.steps) { texts.push([`${l.id}/${s.id}.title`, s.title]); if (typeof s.body === 'string') texts.push([`${l.id}/${s.id}`, s.body]); if (s.ask && typeof s.ask.why === 'string') texts.push([`${l.id}/${s.id}.why`, s.ask.why]); }
    if (l.exam) texts.push([`${l.id}.exam`, l.exam.brief + ' ' + l.exam.rule + ' ' + l.exam.title]);
  }
  it('has two curricula in three stages, every lesson ending in an exam, with unique ids', () => {
    expect(LESSONS.length).toBe(15);
    expect(lessonsFor('EBLG')).toEqual(LESSONS);
    expect(lessonsFor('EDDL').length).toBe(10);
    expect(lessonsFor('ZZZZ')).toEqual(LESSONS);
    expect(new Set(ALL_LESSONS.map((l) => l.id)).size).toBe(ALL_LESSONS.length);
    for (const l of ALL_LESSONS) {
      expect(l.exam, l.id).toBeDefined();
      expect(new Set(l.steps.map((s) => s.id)).size, l.id).toBe(l.steps.length);
      expect(l.steps.length, l.id).toBeGreaterThanOrEqual(3);
      expect(l.comps.length, `${l.id} comps`).toBeGreaterThan(0);
      expect(STAGES.some((s) => s.id === l.stage), l.id).toBe(true);
      expect(l.scenario.icao).toBe(l.icao);
      expect(l.exam!.scenario?.icao ?? l.icao).toBe(l.icao);
    }
    for (const icao of ['EBLG', 'EDDL']) {
      const order = lessonsFor(icao).map((l) => STAGES.findIndex((s) => s.id === l.stage));
      expect(order, `${icao} stages in order`).toEqual([...order].sort((a, b) => a - b));
      for (const s of STAGES) expect(lessonsFor(icao).some((l) => l.stage === s.id), `${icao} has ${s.id}`).toBe(true);
    }
  });
  it('uses plain English: no em dashes, none of the banned words', () => {
    for (const [k, t] of texts) {
      expect(t, k).not.toMatch(/—/);
      expect(t.toLowerCase(), k).not.toMatch(/\b(delve|crucial|furthermore|moreover|testament|beacon|tapestry|revolutionize)\b/);
    }
  });
  it('only links words that are in the glossary', () => {
    const all = texts.map(([, t]) => t).join(' ') + ALL_LESSONS.flatMap((l) => l.steps.map((s) => (typeof s.body === 'function' ? s.body.toString() : ''))).join(' ');
    const keys = [...all.matchAll(/G\('([^']+)'/g), ...all.matchAll(/data-gloss="([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const k of keys) expect(GLOSSARY[k], k).toBeDefined();
  });
  it('the Liège lessons speak of Brussels and the Düsseldorf lessons of Langen', () => {
    const pack = loadPackById('EDDL');
    const sim = new Sim(pack, L('eddl-departures').scenario);
    const f = fake(sim);
    const body = (L('eddl-departures').steps.find((s) => s.id === 'bottrop')!.body as (g: any) => string)(f);
    expect(body).toContain('Langen');
    expect(body).not.toContain('Brussels');
    const simL = new Sim(loadPackById('EBLG'), L('departures').scenario);
    const bodyL = (L('departures').steps.find((s) => s.id === 'bru')!.body as (g: any) => string)(fake(simL));
    expect(bodyL).toContain('Brussels');
  });
  it('the curriculum progress and the drill of the day read the records', () => {
    const p = curriculumProgress('EDDL', {}, new Set());
    expect(p.total).toBe(10); expect(p.next?.id).toBe('eddl-picture');
    const none = drillOfTheDay('EBLG', [], {});
    expect(none?.lesson.id).toBe('scope');
    expect(none?.reason[0]).toMatch(/No sessions/);
    const rec = (r: Partial<Record<string, number>>) => ({ id: 'x', scenarioId: 'free', title: 'x', date: 'd', durationMin: 30, ratings: { SEPC: 4, SITU: 4, TRAF: 4, COMM: 4, CORD: 4, WORK: 4, NONR: 4, SPP: 4, ...r }, landed: 3, arrivals: 3, gatePass: true } as any);
    const weakSep = drillOfTheDay('EBLG', [rec({ SEPC: 1.5 }), rec({ SEPC: 2 })], { separation: { pass: true, stars: 3 }, spacing: { pass: true, stars: 1 } });
    expect(weakSep?.comp).toBe('SEPC');
    expect(['departures', 'spacing', 'safety']).toContain(weakSep?.lesson.id); // the SEPC lesson with the fewest stars (none passed) wins
    expect(weakSep?.reason[0]).toMatch(/Keeping aircraft apart/);
    const weakCord = drillOfTheDay('EDDL', [rec({ CORD: 2 })], {});
    expect(weakCord?.comp).toBe('CORD');
    expect(weakCord?.lesson.icao).toBe('EDDL');
  });
});

// ---------------------------------------------------------------- every exam's instructor passes
describe('the instructor passes every exam', () => {
  for (const l of ALL_LESSONS) {
    if (!l.exam?.scenario) continue;
    it(`${l.id}: ${l.exam.title}`, () => {
      const r = bestInstructorSync(l.exam!, packOf(l));
      expect(r.verdict.pass, `${l.id} instructor (${r.name}): ${r.verdict.why}`).toBe(true);
      expect(r.cmds.length).toBeGreaterThan(0);
      // narration: every clearance has words; scripted ones carry their reason
      const sim = new Sim(packOf(l), l.exam!.scenario!);
      const c = r.cmds[0];
      while (sim.t < c.t) sim.step();
      const nar = narrate(sim, c.cl, c.why);
      expect(nar.words.length).toBeGreaterThan(5);
      if (l.exam!.solution && c.why) expect(nar.why).toBe(c.why);
    });
  }
});

// ---------------------------------------------------------------- Liège lessons
describe('Liège lessons fly the way the coach says', () => {
  it('1 the picture, and the quiz exam', () => {
    const { sim, f } = walk(L('scope'), {
      zoom: (f) => { f.scope.scale *= 1.35 * 1.35; },
      alhuv: (f, x) => { const p = f.sim.pack.fixes.get('ALHUV')!.p; x.tap = { x: p.x + 0.5, y: p.y, t: 1 }; },
      mva: (f, x) => { x.tap = { x: 0, y: -25, t: 2 }; },
      select: (f) => f.select('QTR8125'),
    }, { answers: { levels: 1, scan: 1 } });
    expect(sim.t).toBeLessThan(5);
    expect(f.settings.showMva).toBe(false);
    const ex = L('scope').exam!;
    const good = examMem(sim), bad = examMem(sim);
    for (const q of ex.quiz!) { const r = q.answer(sim); good.answers.push(r); good.right++; bad.answers.push((r + 1) % (typeof q.options === 'function' ? q.options(sim) : q.options).length); }
    expect(examVerdict(ex, sim, good)).toMatchObject({ pass: true, stars: 3 });
    expect(examVerdict(ex, sim, bad)?.pass).toBe(false);
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
    const ignored = exam(L('contact'), () => {});
    expect(ignored.v?.pass).toBe(false);
    expect(bestInstructorSync(L('contact').exam!, packOf(L('contact'))).verdict.stars).toBe(3);
  });

  it('3 turns: dial, drag, and the two-gate exam', () => {
    walk(L('turns'), {
      select: (f) => f.select('CHG201'),
      dial: (f) => { f.els.picker.hidden = false; f.els.picker.dataset.kind = 'hdg'; },
      pick: (f) => { f.items = mergeItem(f.items, { k: 'hdg', hdg: 60, dir: 'L' }); f.els.picker.hidden = true; },
      send: (f) => transmit(f),
      drag: (f) => say(f, 'CHG201', [{ k: 'hdg', hdg: 120, dir: 'R' }]),
    }, { answers: { lr: 0 } });
    const straight = exam(L('turns'), (sim, once) => { if (once('a', calling(sim, 'CHG201'))) sim.issue({ cs: 'CHG201', items: [{ k: 'lvl', lvl: { fl: 70 } }] }); });
    expect(straight.v?.pass).toBe(false);
    const cheat = exam(L('turns'), (sim, once) => { if (once('a', calling(sim, 'CHG201'))) sim.issue({ cs: 'CHG201', items: [{ k: 'dct', fix: 'LG008' }] }); });
    expect(cheat.v).toMatchObject({ pass: false });
  });

  it('4 the command halo: rung, undo, stage, and the quick-hands exam', () => {
    const { sim, f } = walk(L('halo'), {
      select: (f) => f.select('QTR8125'),
      rung: (f) => rung(f, 'QTR8125', { k: 'lvl', lvl: { fl: 70 } }),
      undo: (f) => { expect(say(f, 'QTR8125', [{ k: 'spd', spd: 210 }]).ok).toBe(true); expect(f.sim.correct('QTR8125')).toBe(true); },
      stage: (f) => { pick(f, 'QTR8125', { k: 'spd', spd: 220 }); transmit(f); },
      eth: { when: (f) => calling(f.sim, 'ETH3721'), do: (f) => rung(f, 'ETH3721', { k: 'lvl', lvl: { fl: 70 } }) },
    }, { answers: { words: 1 } });
    expect(f.halo.enabled).toBe(true);
    expect(sim.cmdLog.some((c) => c.op === 'correct')).toBe(true);
    const slow = exam(L('halo'), (sim, once) => { for (const cs of ['QTR8125', 'AZG7321', 'FDX5203']) if (once(cs, calling(sim, cs))) sim.issue({ cs, items: [{ k: 'lvl', lvl: { fl: 60 } }] }); });
    expect(slow.v?.pass).toBe(false); // levels only, never a speed
    expect(slow.v?.why).toMatch(/speed/);
  });

  it('5 the attention queue and readback cards, and the busy minute', () => {
    const { sim } = walk(L('queue'), {
      next: (f) => f.select('QTR8125'),
      go: (f) => lead(f, 'QTR8125'),
      next2: (f) => lead(f, 'AZG7321'),
      fix: (f) => lead(f, 'AZG7321', 'Negative'),
      third: { when: (f) => calling(f.sim, 'FDX5203'), do: (f) => { f.select('FDX5203'); lead(f, 'FDX5203'); } },
    });
    expect(sim.events.some((e) => e.kind === 'readback_caught' && e.cs === 'AZG7321')).toBe(true);
    expect(sim.events.filter((e) => e.kind === 'readback_missed' || e.kind === 'unanswered')).toEqual([]);
    const ignored = exam(L('queue'), () => {});
    expect(ignored.v?.pass).toBe(false);
    // answers everyone but never corrects the wrong readback
    const deaf = exam(L('queue'), (sim, once) => { for (const cs of ['QTR8125', 'AZG7321', 'FDX5203', 'ETH3721']) if (once(cs, calling(sim, cs))) { const s = suggest(sim, sim.find(cs)!).find((x) => x.label.startsWith('Descend')); if (s) sim.issue({ cs, items: s.items }); } });
    expect(deaf.v?.pass).toBe(false);
    expect(deaf.v?.why).toMatch(/wrong readback/i);
  });

  it('6 command line and staging, and four check-ins', () => {
    const { sim, f } = walk(L('cmdline'), {
      open: (f) => f.root.classList.add('kbd'),
      type: (f) => say(f, 'QTR8125', [{ k: 'lvl', lvl: { fl: 60 } }]),
      two: (f) => say(f, 'TAY4EK', [{ k: 'lvl', lvl: { fl: 70 } }, { k: 'spd', spd: 210 }]),
      stage1: (f) => { pick(f, 'CHG201', { k: 'lvl', lvl: { fl: 70 } }); f.staging.queue.push({ cs: 'CHG201', items: f.items }); f.items = []; },
      stage2: (f) => { pick(f, 'QTR8125', { k: 'spd', spd: 220 }); f.staging.queue.push({ cs: 'QTR8125', items: f.items }); f.items = []; },
      send: (f) => { for (const q of f.staging.queue.splice(0)) say(f, q.cs, q.items); },
    }, { answers: { history: 0 } });
    expect(f.staging.length).toBe(0);
    expect(sim.cmdLog.filter((c) => c.cl.cs === 'QTR8125').length).toBe(2);
    expect(exam(L('cmdline'), () => {}).v?.pass).toBe(false);
  });

  it('7 descent planning: the SUP line, and the FL090 exam', () => {
    let hintSeen = false;
    const { sim } = walk(L('descent'), {
      step: (f) => chip(f, 'TAY4EK', 'Descend FL070'),
      rest: (f) => lead(f, 'TAY4EK', 'ALHUV1B · 3000 · ILS 22L'),
      fix: (f) => { pick(f, 'QTR8152', { k: 'lvl', lvl: { ft: 2500 } }); expect(transmit(f).warnings).toEqual([]); },
      tayTwr: { when: (f) => established(f, 'TAY4EK'), do: (f) => chip(f, 'TAY4EK', '160 to 4') },
      land: { when: (f) => established(f, 'QTR8152'), do: (f) => chip(f, 'QTR8152', '160 to 4') },
    }, { answers: { need: 1, have: 1 }, background: (f) => { if (hints(f.sim)[0]?.key === 'high:QTR8152') hintSeen = true; } });
    expect(hintSeen).toBe(true);
    expect(sim.landings.length + sim.aircraft.filter((a) => a.state === 'transferred').length).toBe(2);
    expect(sim.events.filter((e) => ['goaround', 'los', 'mva', 'stca', 'wake'].includes(e.kind))).toEqual([]);
    expect(bestInstructorSync(L('descent').exam!, packOf(L('descent'))).verdict.stars).toBe(3);
    const ignored = exam(L('descent'), (sim, once) => { if (once('c', calling(sim, 'QTR8152'))) sim.issue({ cs: 'QTR8152', items: [{ k: 'trans', name: 'ALHUV1B' }, ILS] }); });
    expect(ignored.v?.pass).toBe(false);
  });

  it('8 transitions and the hold, and three for one runway', () => {
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
    const ignored = exam(L('transitions'), () => {}, 2000);
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
    expect(exam(L('departures'), () => {}).v?.pass).toBe(false);
  });

  it('10 the centre and the runway change, and the wind shift', () => {
    const { sim } = walk(L('runway'), {
      early: { when: (f) => f.sim.coordReqs.some((r) => r.state === 'pending'), do: (f) => { const r = f.sim.coordReqs.find((x) => x.state === 'pending')!; say(f, r.cs, [{ k: 'appr' }]); } },
      calls: { when: (f) => ['CLX7HK', 'TAY4EK'].every((cs) => calling(f.sim, cs) || f.sim.cmdLog.some((c) => c.cl.cs === cs && c.cl.items.some((i) => i.k === 'lvl'))), do: (f) => { for (const cs of ['CLX7HK', 'TAY4EK']) if (calling(f.sim, cs)) chip(f, cs, 'Descend'); } },
      reclear: (f) => lead(f, 'CLX7HK'),
      reclear2: { when: (f) => !!chips(f.sim, 'TAY4EK')[0]?.primary && !f.sim.readbackPending('TAY4EK'), do: (f) => lead(f, 'TAY4EK') },
      land: { when: () => true, do: () => {} },
    }, { answers: { notice: 1 }, maxStepS: 2400, background: (f, step) => { for (const r of f.sim.coordReqs.filter((x) => x.state === 'pending' && x.cs !== 'CLX7HK')) say(f, r.cs, [{ k: 'appr' }]); if (step === 'land') { towerFake(f); for (const cs of ['CLX7HK', 'TAY4EK']) { const a = f.sim.find(cs); if (a && a.state === 'assumed' && !f.sim.readbackPending(cs)) { const s = chips(f.sim, cs)[0]; if (s?.primary && (s.items.some((i) => i.k === 'trans' || i.k === 'xfr'))) f.sim.issue({ cs, items: s.items }); } } } } });
    expect(sim.runway).toBe('04R');
    expect(sim.landings.length + sim.aircraft.filter((a) => a.state === 'transferred').length).toBe(2);
    expect(sim.events.filter((e) => ['los', 'goaround', 'mva', 'coord_unanswered'].includes(e.kind))).toEqual([]);
    const ignored = exam(L('runway'), () => {});
    expect(ignored.v?.pass).toBe(false);
  });

  it('11 vectors, and the exam from the other side', () => {
    const { sim } = walk(L('vectors'), {
      downwind: (f) => say(f, 'CHG201', [{ k: 'hdg', hdg: 45, dir: 'L' }]),
      down: (f) => { pick(f, 'CHG201', { k: 'lvl', lvl: { ft: 3000 } }); pick(f, 'CHG201', { k: 'spd', spd: 210 }); expect(transmit(f).warnings).toEqual([]); },
      base: (f) => chip(f, 'CHG201', 'Base R135'),
      intercept: { when: (f) => Math.abs(xt(f.sim, 'CHG201')) < 2.2, do: (f) => chip(f, 'CHG201', 'R195 · ILS 22L') },
      twr: (f) => chip(f, 'CHG201', '160 to 4'),
    });
    expect(sim.landings.map((l) => l.cs)).toEqual(['CHG201']);
    expect(penalties(sim)).toEqual([]);
    const late = exam(L('vectors'), (sim, once) => {
      if (once('dw', calling(sim, 'DHK7'))) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 45, dir: 'R' }, { k: 'lvl', lvl: { ft: 4000 } }] });
      if (once('base', sim.t > 60 && along(sim, 'DHK7') > 12)) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 315, dir: 'L' }] });
      if (once('icpt', sim.t > 80 && Math.abs(xt(sim, 'DHK7')) < 2.3)) sim.issue({ cs: 'DHK7', items: [{ k: 'hdg', hdg: 255, dir: 'L' }, ILS] });
    });
    expect(late.v?.pass).toBe(false);
  });

  it('12 separation: the alarm, and two converging pairs', () => {
    const { sim } = walk(L('separation'), {
      rbl: (f) => { f.scope.rbls.push({ a: { cs: 'AZG7321' }, b: { cs: 'ETH3721' } }); },
      act: (f) => chip(f, 'ETH3721', 'Descend FL060'),
    }, { answers: { cpa: 1 } });
    expect(sim.events.filter((e) => e.kind === 'stca').length).toBe(1);
    expect(sim.events.filter((e) => e.kind === 'los')).toEqual([]);
    expect(bestInstructorSync(L('separation').exam!, packOf(L('separation'))).verdict.stars).toBe(3);
    expect(exam(L('separation'), () => {}).v?.pass).toBe(false);
  });

  it('13 wake spacing: 180 kt holds about 4.4 NM, and the two-gap exam', () => {
    const { sim } = walk(L('spacing'), {
      speed: (f) => { pick(f, 'TAY4EK', { k: 'spd', spd: 180 }); transmit(f); },
    }, { background: towerIn('land') });
    const gap = sim.spacing.find((s) => s.leader === 'CLX7HK')!;
    expect(gap.gap).toBeGreaterThanOrEqual(4);
    expect(gap.gap).toBeLessThan(5);
    expect(sim.events.filter((e) => e.kind === 'wake' || e.kind === 'goaround')).toEqual([]);
    const ignored = exam(L('spacing'), (sim, once) => { for (const a of sim.aircraft) if (a.kind === 'arr' && a.state === 'assumed' && a.app?.locCap && sim.dthr(a) < 12 && once('twr' + a.cs, true)) sim.issue({ cs: a.cs, items: [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: 'TWR' }] }); });
    expect(ignored.v?.pass).toBe(false);
  });

  it('14 safety nets and a MAYDAY, and the checkride', () => {
    const { sim } = walk(L('safety'), {
      clear: (f) => chip(f, 'ETH3721', 'Descend FL060'),
      negative: (f) => lead(f, 'ETH3721', 'Negative · FL060'),
      approach: (f) => lead(f, 'ETH3721', 'ALHUV1A · 3000 · ILS 22L'),
      card: (f) => f.select('CLX7HK'),
      priority: (f) => lead(f, 'CLX7HK', 'Direct LIBVA'),
      ethTwr: { when: (f) => established(f, 'ETH3721'), do: (f) => chip(f, 'ETH3721', '160 to 4') },
      land: { when: (f) => established(f, 'CLX7HK'), do: (f) => chip(f, 'CLX7HK', '160 to 4') },
    }, { answers: { spot: 1 } });
    expect(sim.events.some((e) => e.kind === 'readback_caught')).toBe(true);
    expect(['CLX7HK', 'ETH3721'].every((cs) => sim.landings.some((l) => l.cs === cs) || sim.find(cs)?.state === 'transferred')).toBe(true);
    expect(sim.events.filter((e) => ['los', 'goaround', 'readback_missed', 'wake', 'stca', 'mva'].includes(e.kind)).map((e) => e.text + ' @' + e.t)).toEqual([]);
    expect(exam(L('safety'), () => {}).v?.pass).toBe(false);
  });

  it('15 the full position: estimates, sequence, correction, and half a shift', () => {
    const { sim } = walk(L('position'), {
      seq: (f) => { f.sim.setSequence(['TAY4EK', 'CLX7HK']); },
      corr: (f) => { const r = say(f, 'CLX7HK', [{ k: 'spd', spd: 220 }]); expect(r.ok).toBe(true); expect(f.sim.correct('CLX7HK')).toBe(true); },
    });
    expect(sim.events.filter((e) => ['los', 'wake'].includes(e.kind))).toEqual([]);
    expect(exam(L('position'), () => {}).v?.pass).toBe(false);
  });
});

// ---------------------------------------------------------------- Düsseldorf lessons
describe('Düsseldorf lessons fly the way the coach says', () => {
  const E = (id: string) => L(`eddl-${id}`);
  it('1 the picture, and the quiz exam', () => {
    const { sim, f } = walk(E('picture'), {
      bikmu: (f, x) => { const p = f.sim.pack.fixes.get('BIKMU')!.p; x.tap = { x: p.x + 0.5, y: p.y, t: 1 }; },
      mva: (f, x) => { const p = f.sim.pack.fixes.get('WUPPERTAL')?.p ?? { x: 16, y: -6 }; x.tap = { x: p.x, y: p.y, t: 2 }; },
      select: (f) => f.select('EWG1AB'),
    }, { answers: { transitions: 0, ta: 1 } });
    expect(sim.t).toBeLessThan(5);
    expect(sim.tl).toBe(60);
    expect(f.halo.enabled).toBe(true);
    const ex = E('picture').exam!;
    const good = examMem(sim);
    for (const q of ex.quiz!) { good.answers.push(q.answer(sim)); good.right++; }
    expect(examVerdict(ex, sim, good)).toMatchObject({ pass: true, stars: 3 });
  });

  it('2 first contact at Langen, and three on frequency', () => {
    const { sim } = walk(E('contact'), {
      select: (f) => f.select('EWG1AB'),
      rung: (f) => rung(f, 'EWG1AB', { k: 'lvl', lvl: { fl: 80 } }),
      cfg: leadWhenCalling('CFG2PL'),
      thy: { when: (f) => calling(f.sim, 'THY5MK'), do: (f) => rung(f, 'THY5MK', { k: 'lvl', lvl: { fl: 100 } }) },
    }, { answers: { levels: 1 } });
    expect(sim.runway).toBe('23R'); expect(sim.depRunway).toBe('23L');
    expect(sim.events.filter((e) => e.kind === 'unanswered')).toEqual([]);
    expect(exam(E('contact'), () => {}).v?.pass).toBe(false);
  });

  it('3 the RNAV transitions: BIKMU23, expect ILS, the shortcut', () => {
    const { sim } = walk(E('transitions'), {
      lead: (f) => lead(f, 'EWG1AB', 'BIKMU23 · FL060 · expect ILS 23R'),
      short: { when: (f) => leadOn(f, 'EWG1AB', 'Direct REGNO'), do: (f) => lead(f, 'EWG1AB', 'Direct REGNO') },
      twr: (f) => chip(f, 'EWG1AB', '160 to 4'),
    }, { answers: { speed: 1 } });
    expect(sim.landings.map((l) => l.cs).concat(sim.aircraft.filter((a) => a.state === 'transferred').map((a) => a.cs))).toContain('EWG1AB');
    expect(penalties(sim)).toEqual([]);
    expect(exam(E('transitions'), () => {}, 3000).v?.pass).toBe(false);
  });

  it('4 holding on the downwind: DL429, leave hold on the shortcut', () => {
    const { sim } = walk(E('stack'), {
      first: (f) => lead(f, 'EWG1AB', 'BIKMU23'),
      merge: (f) => lead(f, 'DLH4KT', 'HALME23'),
      hold: (f) => { pick(f, 'DLH4KT', { k: 'hold', fix: 'DL429' }); expect(transmit(f).ok).toBe(true); },
      short: { when: (f) => leadOn(f, 'EWG1AB', 'Direct') || leadOn(f, 'EWG1AB', 'Descend'), do: (f) => lead(f, 'EWG1AB') },
      release: { when: (f) => leadOn(f, 'DLH4KT', 'Leave hold'), do: (f) => lead(f, 'DLH4KT', 'Leave hold') },
    }, { answers: { where: 1 }, maxStepS: 2400, background: towerIn('twr') });
    expect(sim.log.some((t) => t.cs === 'DLH4KT' && /DL429/.test(t.text))).toBe(true);
    expect(sim.events.filter((e) => ['los', 'stack', 'goaround', 'wake', 'mva'].includes(e.kind)).map((e) => e.text)).toEqual([]);
    expect(['EWG1AB', 'DLH4KT'].every((cs) => sim.landings.some((l) => l.cs === cs) || sim.find(cs)?.state === 'transferred')).toBe(true);
    expect(exam(E('stack'), () => {}, 3000).v?.pass).toBe(false);
  });

  it('5 departures to Langen: no release for MEVEL, the Köln release for COL, climb FL100, hand on by exit', () => {
    const { sim } = walk(E('departures'), {
      climb: (f) => chip(f, 'EWG2KL', 'Climb FL100'),
      release: { when: (f) => f.sim.releases.some((r) => r.cs === 'DLH9PA' && r.state === 'pending'), do: (f) => say(f, 'DLH9PA', [f.sim.find('CFG7HD') ? { k: 'rel', after: 'CFG7HD' } : { k: 'rel' }]) },
      klc: leadWhenCalling('KLC41X'),
      bottrop: { when: (f) => chips(f.sim, 'EWG2KL').some((s) => s.label === 'Langen'), do: (f) => chip(f, 'EWG2KL', 'Langen') },
      cfg: { when: (f) => established(f, 'CFG7HD'), do: (f) => chip(f, 'CFG7HD', f.sim.find('CFG7HD')!.ias > 175 ? '160 to 4' : 'Tower') },
      dlh: { when: (f) => calling(f.sim, 'DLH9PA'), do: (f) => lead(f, 'DLH9PA') },
    }, { maxStepS: 2400, background: (f, step) => { arrivalsLead(f); if (step === 'dlh' && f.sim.cmdLog.some((c) => c.cl.cs === 'DLH9PA' && c.cl.items.some((i) => i.k !== 'rel'))) departuresOn(f, 'DLH9PA'); } });
    expect(sim.departuresHandled).toBe(2);
    expect(sim.cmdLog.some((c) => c.cl.cs === 'DLH9PA' && c.cl.items.some((i) => i.k === 'xfr' && i.unit === 'NOR'))).toBe(true);
    expect(sim.cmdLog.some((c) => c.cl.cs === 'EWG2KL' && c.cl.items.some((i) => i.k === 'xfr' && i.unit === 'ACC'))).toBe(true);
    expect(sim.events.filter((e) => ['los', 'exit_unxfr', 'release_delay', 'airspace'].includes(e.kind)).map((e) => e.text)).toEqual([]);
    expect(exam(E('departures'), () => {}).v?.pass).toBe(false);
  });

  it('6 parallel runways: north lands, south departs, no releases', () => {
    const { sim } = walk(E('parallel'), {
      first: (f) => lead(f, 'EWG1AB', 'BIKMU23'),
      second: leadWhenCalling('TUI3LK'),
      dep: { when: (f) => calling(f.sim, 'DLH9PA'), do: (f) => lead(f, 'DLH9PA') },
      ewg: { when: (f) => leadOn(f, 'EWG1AB', '') && chips(f.sim, 'EWG1AB')[0].items.some((i) => i.k === 'app'), do: (f) => lead(f, 'EWG1AB') },
      twr1: { when: (f) => established(f, 'EWG1AB'), do: (f) => chip(f, 'EWG1AB', '160 to 4') },
    }, { answers: { wake: 1 }, maxStepS: 2400, background: (f, step) => { if (['ewg', 'twr1', 'twr2'].includes(step)) departuresOn(f, 'DLH9PA'); if (step === 'twr1' || step === 'twr2') { arrivalsLead(f, ['TUI3LK']); releaseHolds(f); } if (step === 'twr2') towerFake(f); } });
    expect(sim.depRunway).toBe('23L');
    expect(sim.releases).toEqual([]);
    expect(sim.departuresHandled).toBe(1);
    expect(sim.events.filter((e) => ['los', 'goaround', 'release_delay', 'exit_unxfr', 'wake'].includes(e.kind)).map((e) => e.text)).toEqual([]);
    expect(exam(E('parallel'), () => {}).v?.pass).toBe(false);
  });

  it('7 runway 05: the change and the re-clearance', () => {
    const { sim } = walk(E('runway05'), {
      ewg: { when: (f) => calling(f.sim, 'EWG1AB'), do: (f) => chip(f, 'EWG1AB', 'Descend') },
      reclear: { when: (f) => leadOn(f, 'EWG1AB', ''), do: (f) => lead(f, 'EWG1AB') },
      ryr: { when: (f) => calling(f.sim, 'RYR8CD'), do: (f) => lead(f, 'RYR8CD') },
    }, { answers: { notice: 1 }, maxStepS: 2400, background: (f, step) => { if (step === 'land') { releaseHolds(f); arrivalsLead(f); towerFake(f); } } });
    expect(sim.runway).toBe('05L'); expect(sim.depRunway).toBe('05R');
    expect(['EWG1AB', 'RYR8CD'].every((cs) => sim.landings.some((l) => l.cs === cs) || sim.find(cs)?.state === 'transferred')).toBe(true);
    expect(sim.events.filter((e) => ['los', 'goaround', 'mva'].includes(e.kind)).map((e) => e.text + '@' + e.t)).toEqual([]);
    expect(exam(E('runway05'), () => {}).v?.pass).toBe(false);
  });

  it('8 sequencing onto 23R: three fixes, one downwind', () => {
    const { sim } = walk(E('sequence'), {
      thy: (f) => lead(f, 'THY5MK', 'HALME23'),
      ewg: leadWhenCalling('EWG1AB'),
      cfg: leadWhenCalling('CFG2PL'),
    }, { maxStepS: 2400, background: (f, step) => { if (step === 'gap') { towerFake(f); releaseHolds(f); speedChips(f); arrivalsLead(f); } } });
    expect(sim.events.filter((e) => ['los', 'wake', 'goaround', 'mva'].includes(e.kind)).map((e) => e.text)).toEqual([]);
    expect(['THY5MK', 'EWG1AB', 'CFG2PL'].every((cs) => sim.landings.some((l) => l.cs === cs) || sim.find(cs)?.state === 'transferred')).toBe(true);
    expect(exam(E('sequence'), () => {}, 3000).v?.pass).toBe(false);
  });

  it('9 safety nets at Langen: the card, then the MAYDAY to 23L', () => {
    const { sim } = walk(E('emergency'), {
      clear: (f) => lead(f, 'EWG1AB', 'BIKMU23'),
      fix: (f) => lead(f, 'EWG1AB', 'Negative'),
      card: (f) => f.select('UAE57'),
      priority: (f) => lead(f, 'UAE57', 'Direct I23L'),
      others: leadWhenCalling('TUI3LK'),
    }, { maxStepS: 2400, background: (f, step) => { if (step === 'mayday' || step === 'land') { towerFake(f); arrivalsLead(f, ['EWG1AB']); } if (step === 'land') { releaseHolds(f); const u = f.sim.find('UAE57'); if (!u || u.app?.locCap || u.state !== 'assumed') arrivalsLead(f, ['TUI3LK']); } } });
    expect(sim.events.some((e) => e.kind === 'readback_caught')).toBe(true);
    expect(sim.events.filter((e) => ['los', 'goaround', 'readback_missed', 'wake', 'mva'].includes(e.kind)).map((e) => e.text)).toEqual([]);
    expect(['UAE57', 'TUI3LK', 'EWG1AB'].every((cs) => sim.landings.some((l) => l.cs === cs) || sim.find(cs)?.state === 'transferred')).toBe(true);
    expect(exam(E('emergency'), () => {}).v?.pass).toBe(false);
  });

  it('10 the 06:00 rush: departures first, and the first wave', () => {
    const { sim } = walk(E('rush'), {
      first: (f) => lead(f, 'EWG1AB', 'BIKMU23'),
      cfg: leadWhenCalling('CFG7HD'),
      dep: { when: (f) => calling(f.sim, 'EWG2KL'), do: (f) => lead(f, 'EWG2KL') },
    }, { maxStepS: 2400, background: (f, step) => { if (step === 'wave') { speedChips(f); autoControl(f.sim); } } });
    expect(sim.localHour()).toBeGreaterThan(5.8);
    expect(sim.releases).toEqual([]);
    expect(sim.departuresHandled).toBe(2);
    expect(sim.events.filter((e) => ['los', 'wake', 'release_delay', 'exit_unxfr'].includes(e.kind)).map((e) => e.text + '@' + e.t)).toEqual([]);
    expect(exam(E('rush'), () => {}, 3000).v?.pass).toBe(false);
  });
});

void (null as unknown as Step);
