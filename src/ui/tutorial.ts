import './tutorial.css';
import type { Game } from './game';
import type { Sim } from '../engine/sim';
import { Sim as SimClass } from '../engine/sim';
import type { Pack } from '../pack/load';
import type { Comp } from '../engine/types';
import type { Clearance, Item } from '../engine/clearance';
import { suggest } from '../engine/suggest';
import { autoControl } from '../engine/autopilot';
import { chipControl, type Controller } from '../engine/career';
import { COMP_PLAIN, COMPS } from '../engine/assess';
import { loadRecords, type RecordSummary } from '../store';
import { EBLG_LESSONS } from './lessons/eblg';
import { EDDL_LESSONS } from './lessons/eddl';
import { STAGES, mmss, sameItems, type Exam, type ExamMem, type Lesson, type Mark, type Once, type Say, type Stage, type Step, type StepCtx, type Verdict } from './lessons/kit';

// The academy (docs/TRAINING.md): two curricula on one coach. A lesson is a scripted scenario in the
// real sim with a coach that points at the control to use, says why, and waits until you have used it,
// then an exam: a short session with no coaching, judged from the sim, PASS or RETRY with one line of
// why and up to three stars. A failed exam offers the instructor's run of the same traffic. The lesson
// definitions live in src/ui/lessons/{eblg,eddl}.ts; the authoring kit in src/ui/lessons/kit.ts.

export type { Exam, ExamMem, Lesson, Mark, QuizQ, Stage, Step, StepCtx, Verdict, Solution, Once, Say } from './lessons/kit';
export { STAGES, isCalling } from './lessons/kit';

// =====================================================================================
// CURRICULA
// =====================================================================================
/** Every lesson of every airport, in curriculum order. */
export const ALL_LESSONS: Lesson[] = [...EBLG_LESSONS, ...EDDL_LESSONS];
/** The Liège curriculum (the 1.0 callers' list). */
export const LESSONS: Lesson[] = EBLG_LESSONS;
/** The curriculum of one airport, in order (Liège when the airport has none). */
export const lessonsFor = (icao: string): Lesson[] => { const l = ALL_LESSONS.filter((x) => x.icao === icao); return l.length ? l : EBLG_LESSONS; };
export const lessonById = (id: string): Lesson | undefined => ALL_LESSONS.find((l) => l.id === id);
/** The lessons of one stage of a curriculum. */
export const lessonsInStage = (icao: string, stage: Stage) => lessonsFor(icao).filter((l) => l.stage === stage);
/** The airports that have a curriculum. */
export const curriculumAirports = (): string[] => [...new Set(ALL_LESSONS.map((l) => l.icao))];

// =====================================================================================
// RESULTS
// =====================================================================================
const KEY = 'lgg.tutorial';
export interface LessonRecord { done?: boolean; pass?: boolean; stars?: number }
/** Best result per lesson. Older saves (a list of finished lesson ids) are read as "done". */
export function tutorialResults(): Record<string, LessonRecord> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (Array.isArray(raw)) return Object.fromEntries(raw.map((id: string) => [id, { done: true }]));
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}
/** Lessons finished (steps completed or exam passed). */
export const tutorialDone = (): Set<string> => new Set(Object.entries(tutorialResults()).filter(([, r]) => r.done || r.pass).map(([id]) => id));
export function saveLessonResult(id: string, r: LessonRecord) {
  try {
    const all = tutorialResults();
    const o = all[id] ?? {};
    all[id] = { done: o.done || r.done || r.pass || undefined, pass: o.pass || r.pass || undefined, stars: Math.max(o.stars ?? 0, r.stars ?? 0) || undefined };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}
/** Curriculum progress for the menu: exams passed, stars, the next lesson to take. */
export function curriculumProgress(icao: string, res = tutorialResults(), done = tutorialDone()) {
  const list = lessonsFor(icao);
  const next = list.find((l) => !res[l.id]?.pass && !(done.has(l.id) && !l.exam));
  return { total: list.length, passed: list.filter((l) => res[l.id]?.pass).length, stars: list.reduce((s, l) => s + (res[l.id]?.stars ?? 0), 0), done: list.filter((l) => done.has(l.id)).length, next };
}

// =====================================================================================
// DRILL OF THE DAY: spaced practice aimed at the weakest competency
// =====================================================================================
export interface DrillPick { lesson: Lesson; comp?: Comp; reason: [string, string] }
/**
 * The lesson that trains the player's weakest competency at this airport, with a two-line reason.
 * The weakest competency is the lowest mean rating over the last twelve logged sessions (store.ts records, read
 * only); among the lessons tagged with it, the one with the fewest exam stars wins. With no sessions yet: the
 * next lesson not passed in curriculum order.
 */
export function drillOfTheDay(icao: string, records: RecordSummary[] = loadRecords(icao), res = tutorialResults()): DrillPick | undefined {
  const list = lessonsFor(icao);
  if (!list.length) return undefined;
  const recent = records.slice(-12);
  const means: Partial<Record<Comp, number>> = {};
  for (const c of COMPS) {
    const xs = recent.map((r) => r.ratings?.[c]).filter((v): v is number => typeof v === 'number');
    if (xs.length) means[c] = xs.reduce((a, b) => a + b, 0) / xs.length;
  }
  const ranked = (Object.entries(means) as [Comp, number][]).sort((a, b) => a[1] - b[1]);
  const starsOf = (l: Lesson) => (res[l.id]?.pass ? res[l.id]?.stars ?? 1 : -1);
  for (const [comp, mean] of ranked) {
    const cands = list.filter((l) => l.comps.includes(comp)).sort((a, b) => starsOf(a) - starsOf(b));
    if (!cands.length) continue;
    const l = cands[0];
    const st = starsOf(l);
    return {
      lesson: l, comp,
      reason: [
        `${COMP_PLAIN[comp]} is your lowest competency: ${mean.toFixed(1)} of 5 over your last ${recent.length} session${recent.length === 1 ? '' : 's'}.`,
        st < 0 ? `${l.title} trains it and you have not passed its exam yet.` : `${l.title} trains it; your best is ${st} of 3 stars.`,
      ],
    };
  }
  const next = list.find((l) => !res[l.id]?.pass) ?? list[0];
  return { lesson: next, reason: [`No sessions logged at ${icao} yet, so there is nothing to measure.`, `${next.title} is the next lesson in the course${res[next.id]?.done ? ' with an exam still to pass' : ''}.`] };
}

// =====================================================================================
// EXAM RUNNER (shared by the coach, the instructor and the tests)
// =====================================================================================
export function examMem(sim: Sim): ExamMem { return { t0: sim.t, answers: [], right: 0 }; }
/** One judge pass, with the generic time limit. */
export function examVerdict(ex: Exam, sim: Sim, m: ExamMem): Verdict | undefined {
  const v = ex.judge(sim, m);
  if (v) return v;
  if (ex.limitS !== undefined && sim.t - m.t0 > ex.limitS) return { pass: false, stars: 0, why: `Out of time.${ex.status ? ` ${ex.status(sim, m)}.` : ''}` };
  return undefined;
}

// =====================================================================================
// THE INSTRUCTOR: the mistake replay
// =====================================================================================
export interface InstructorCmd { t: number; cl: Clearance; why?: string }
export interface InstructorRun { name: string; verdict: Verdict; cmds: InstructorCmd[]; sim: Sim }
/** Wrap an engine controller (autoControl, chipControl) as a solution: the chip's `why` is the narration. */
const asSolution = (ctrl: Controller) => (sim: Sim) => ctrl(sim);
const INSTRUCTORS: Record<string, Controller> = { chips: chipControl, auto: autoControl };
const score = (v: Verdict | undefined) => (v ? (v.pass ? 100 + v.stars : 1) : 0);

/** Run one exam offline with a scripted controller, judging it as the student is judged. */
export function instructorRunSync(ex: Exam, pack: Pack, ctrl: (sim: Sim, once: Once, say: Say) => void, name = 'instructor', maxS = 3600): InstructorRun {
  const sim = new SimClass(pack, ex.scenario!);
  const m = examMem(sim);
  const did = new Set<string>();
  const once: Once = (k, c) => (c && !did.has(k) ? (did.add(k), true) : false);
  const whys = new Map<number, string>();
  const say: Say = (cs, items, why) => { const n = sim.cmdLog.length; const r = sim.issue({ cs, items }); if (r.ok && why) whys.set(n, why); };
  let v: Verdict | undefined;
  while (sim.t < maxS) {
    const t0 = sim.t;
    sim.step();
    ex.watch?.(sim, m);
    v = examVerdict(ex, sim, m);
    if (v) break;
    if (sim.t === t0) { v = { pass: false, stars: 0, why: 'The session ended before the exam was complete.' }; break; } // the sim has ended: the clock no longer moves
    ctrl(sim, once, say);
  }
  const cmds: InstructorCmd[] = sim.cmdLog.map((c, i) => ({ t: c.t, cl: c.cl, why: whys.get(i) }));
  return { name, verdict: v ?? { pass: false, stars: 0, why: 'Out of time.' }, cmds, sim };
}
/** The best available instructor for an exam: the lesson's solution, else the better of the engine's controllers. */
export function bestInstructorSync(ex: Exam, pack: Pack): InstructorRun {
  if (ex.solution) return instructorRunSync(ex, pack, ex.solution, 'solution');
  let best: InstructorRun | undefined;
  for (const [name, c] of Object.entries(INSTRUCTORS)) {
    const r = instructorRunSync(ex, pack, asSolution(c), name);
    if (!best || score(r.verdict) > score(best.verdict)) best = r;
  }
  return best!;
}
/** As bestInstructorSync, yielding to the browser between runs so the page stays responsive. */
export async function bestInstructor(ex: Exam, pack: Pack): Promise<InstructorRun> {
  await new Promise((r) => setTimeout(r, 0));
  return bestInstructorSync(ex, pack);
}
/** Narrate a clearance the instructor sends: its words, and the reason (the matching chip's `why` when there is one). */
export function narrate(sim: Sim, cl: Clearance, why?: string): { words: string; why: string } {
  const words = sim.previewPhrase(cl)?.text ?? `${cl.cs}: ${cl.items.map((i) => i.k).join(', ')}`;
  if (why) return { words, why };
  const a = sim.find(cl.cs);
  const s = a ? suggest(sim, a).find((x) => sameItems(x.items, cl.items)) : undefined;
  return { words, why: s?.why ?? '' };
}

// =====================================================================================
// THE COACH
// =====================================================================================
const stars = (n: number) => `<span class="stars" aria-label="${n} of 3 stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
export interface CoachOpts { /** start at the exam (the drill of the day) */ toExam?: boolean }

export function coachFor(lesson: Lesson, nav: { next?: () => void; exit: () => void; restart: () => void }, copts: CoachOpts = {}) {
  return (g: Game) => {
    const host = g.root.querySelector<HTMLElement>('.scope-wrap')!;
    const card = document.createElement('section');
    card.className = 'coach';
    card.setAttribute('aria-live', 'polite');
    host.appendChild(card);
    host.classList.add('coached');
    const canvas = g.scope.canvas;
    const savedHints = g.coachHints;

    type Phase = 'steps' | 'intro' | 'exam' | 'result' | 'replay';
    let phase: Phase = 'steps';
    let i = -1;
    let ctx: StepCtx = { cmdStart: 0, logStart: 0, t0: 0, s0: 0 };
    let hl: Element | null = null;
    let collapsed = false;
    let lastTouch = -1e9;
    let skipping = false;
    let answered: { idx: number; ok: boolean } | undefined;
    let mem: ExamMem | undefined;
    let verdict: Verdict | undefined;
    let qIdx = 0;
    let targetSeen = false;
    let pkCollapsed = false;
    // the instructor's run
    let run: InstructorRun | undefined;
    let runIdx = 0;
    let runLines: { words: string; why: string; cs: string }[] = [];
    let runBusy = false;
    let runDone: Verdict | undefined;
    const ex = lesson.exam;
    const total = lesson.steps.length + (ex ? 1 : 0);
    const phone = () => window.innerWidth < 600;
    const seenBefore = tutorialDone().has(lesson.id);
    const cur = () => lesson.steps[i];
    const curriculum = lessonsFor(lesson.icao);
    const n = curriculum.indexOf(lesson) + 1;
    const stageTitle = STAGES.find((s) => s.id === lesson.stage)?.title ?? '';

    // ---------- scope taps (for "tap a fix" steps) and touch-to-collapse
    let down: { x: number; y: number } | undefined;
    const onDown = (e: PointerEvent) => {
      down = { x: e.offsetX, y: e.offsetY };
      lastTouch = performance.now();
      if (phone() && !collapsed && phase !== 'result' && phase !== 'intro' && !(phase === 'steps' && cur()?.ask && !answered?.ok)) { collapsed = true; render(); }
    };
    const onUp = (e: PointerEvent) => { if (down && Math.hypot(e.offsetX - down.x, e.offsetY - down.y) < 10) ctx.tap = { x: e.offsetX, y: e.offsetY, t: performance.now() }; down = undefined; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);

    // ---------- send guard: steps about one aircraft stop transmissions to the others; the instructor keeps the frequency
    g.onBeforeSend = (cl: Clearance) => {
      if (phase === 'replay') return 'The instructor has the frequency. Watch, then retry the exam.';
      if (phase !== 'steps') return undefined;
      const st = cur();
      if (!st?.cs || cl.cs === st.cs) return undefined;
      const want = st.cs;
      window.setTimeout(() => { if (g.sim.find(want)) { g.select(want, true); keepInView(want, true); } }, 0);
      return `That's ${cl.cs}. The coach wants ${want}.`;
    };

    // ---------- geometry: the part of the scope the card leaves free, in canvas px
    const freeRect = () => {
      const cr = canvas.getBoundingClientRect();
      const r = { x: 8, y: 26, w: cr.width - 64, h: cr.height - 34 };
      if (card.offsetParent) {
        const k = card.getBoundingClientRect();
        if (phone()) r.h = Math.max(80, k.top - cr.top - r.y - 8);
        else { const right = k.right - cr.left + 8; r.w = cr.width - 64 - right; r.x = right; }
      }
      return r;
    };
    const pointOf = (m?: Mark) => {
      if (!m) return undefined;
      if (m.cs) { const a = g.sim.find(m.cs); return a ? g.scope.plot(a) : undefined; }
      if (m.fix) return g.sim.pack.fixes.get(m.fix)?.p;
      return undefined;
    };
    /** Move the scope so this world point sits in the middle of the free area. */
    const centreIn = (p: { x: number; y: number }, scale?: number) => {
      const s = scale ?? g.scope.scale, f = freeRect(), W = g.scope.w, H = g.scope.h;
      const tx = f.x + f.w / 2, ty = f.y + f.h * 0.5;
      g.scope.animateTo(s, { x: p.x - (tx - W / 2) / s, y: p.y + (ty - H / 2) / s }, 500);
    };
    const visible = (p: { x: number; y: number }) => { const s = g.scope.toS(p), f = freeRect(); return s.x > f.x + 20 && s.x < f.x + f.w - 20 && s.y > f.y + 20 && s.y < f.y + f.h - 20; };
    const keepInView = (cs: string, force = false) => { const a = g.sim.find(cs); if (!a) return; const p = g.scope.plot(a); if (force || !visible(p)) centreIn(p); };
    const markOf = (st: Step): Mark | undefined => (typeof st.mark === 'function' ? st.mark(g) : st.mark) ?? (st.cs ? { cs: st.cs } : undefined);
    const syncReserved = () => {
      const cr = canvas.getBoundingClientRect(), k = card.getBoundingClientRect();
      g.scope.reserved = card.offsetParent && k.width ? [{ x: k.left - cr.left - 6, y: k.top - cr.top - 6, w: k.width + 12, h: k.height + 12 }] : [];
      host.style.setProperty('--coach-h', `${Math.round(k.height)}px`);
    };

    // ---------- steps
    const go = (k: number) => {
      skipping = false;
      i = k; answered = undefined; targetSeen = false;
      const st = cur();
      ctx = { cmdStart: g.sim.cmdLog.length, logStart: g.sim.log.length, t0: g.sim.t, s0: g.scope.scale };
      st.onEnter?.(g, ctx);
      g.setSpeed(st.run ?? 0);
      collapsed = phone() && !!st.compact;
      const m = markOf(st);
      g.scope.marks = m ? [m] : [];
      if (st.cs && !st.noAutoSelect && g.sim.find(st.cs) && g.cs !== st.cs) { g.select(st.cs, true); targetSeen = true; }
      render();
      requestAnimationFrame(() => {
        syncReserved();
        const f = st.focus;
        const p = f ? (f.fix ? g.sim.pack.fixes.get(f.fix)?.p : f.cs ? pointOf({ cs: f.cs }) : undefined) : pointOf(m);
        if (p && (f || !visible(p))) centreIn(p, f?.scale);
      });
    };
    const advance = () => {
      if (i < lesson.steps.length - 1) { go(i + 1); return; }
      saveLessonResult(lesson.id, { done: true });
      if (ex) { phase = 'intro'; g.scope.marks = []; g.setSpeed(0); collapsed = false; render(); requestAnimationFrame(syncReserved); }
      else { phase = 'result'; render(); }
    };

    // ---------- exams
    const hookStep = (onStep: (sim: Sim) => void) => {
      const sim = g.sim;
      const step0 = sim.step.bind(sim);
      sim.step = (dt?: number) => { step0(dt); onStep(sim); };
    };
    const startExam = () => {
      if (!ex) return;
      verdict = undefined; qIdx = 0; run = undefined; runDone = undefined;
      if (ex.scenario) g.loadScenario(ex.scenario);
      g.coachHints = false;
      const sim = g.sim;
      mem = examMem(sim);
      const m = mem;
      if (ex.scenario) hookStep((s) => {
        if (verdict || phase !== 'exam') return;
        ex.watch?.(s, m);
        const v = examVerdict(ex, s, m);
        if (v) finishExam(v);
      });
      phase = 'exam';
      g.scope.marks = ex.marks ?? [];
      g.setSpeed(ex.run ?? 1);
      collapsed = phone() && !ex.quiz;
      render();
      requestAnimationFrame(() => { syncReserved(); if (ex.scenario) g.scope.fit(true); });
    };
    const finishExam = (v: Verdict) => {
      verdict = v;
      phase = 'result';
      g.setSpeed(0);
      collapsed = false;
      saveLessonResult(lesson.id, { done: true, pass: v.pass, stars: v.pass ? v.stars : 0 });
      window.setTimeout(() => { render(); syncReserved(); }, 0);
    };
    const answerQuiz = (k: number) => {
      if (!ex?.quiz || !mem) return;
      const qq = ex.quiz[qIdx];
      const ok = qq.answer(g.sim) === k;
      mem.answers.push(k);
      if (ok) mem.right = (mem.right ?? 0) + 1;
      qIdx++;
      const v = examVerdict(ex, g.sim, mem);
      if (v) finishExam(v); else render();
    };

    // ---------- the instructor's run: compute offline, then replay live with narration
    const startReplay = async () => {
      if (!ex?.scenario || runBusy) return;
      runBusy = true; runDone = undefined; runLines = []; runIdx = 0;
      phase = 'replay'; g.setSpeed(0); collapsed = false; render();
      try { run = await bestInstructor(ex, g.sim.pack); } catch { run = undefined; }
      runBusy = false;
      if (!run || phase !== 'replay') { render(); return; }
      const r = run;
      g.loadScenario(ex.scenario);
      g.scope.marks = ex.marks ?? [];
      const sim = g.sim;
      const m = examMem(sim);
      hookStep((s) => {
        if (phase !== 'replay' || runDone) return;
        while (runIdx < r.cmds.length && r.cmds[runIdx].t <= s.t) {
          const c = r.cmds[runIdx++];
          const nar = narrate(s, c.cl, c.why);
          const res = s.issue(c.cl);
          if (res.ok) { runLines.push({ ...nar, cs: c.cl.cs }); if (runLines.length > 3) runLines.shift(); if (s.find(c.cl.cs)) g.select(c.cl.cs, true); }
        }
        ex.watch?.(s, m);
        const v = examVerdict(ex, s, m);
        if (v || s.ended || (runIdx >= r.cmds.length && s.t > r.sim.t)) { runDone = v ?? r.verdict; g.setSpeed(0); }
      });
      g.setSpeed(4);
      render();
      requestAnimationFrame(() => { syncReserved(); g.scope.fit(true); });
    };

    // ---------- skip ahead: fast-step the sim until the step is ready
    const skipAhead = () => {
      const st = cur();
      if (skipping || !st) return;
      const ready = st.until ?? st.done;
      if (!ready) return;
      skipping = true;
      g.setSpeed(0);
      const t0 = g.sim.t, callers0 = new Set(g.sim.callers().map((a) => a.cs));
      const tick = () => {
        if (!skipping || cur() !== st) return;
        let stop = false;
        for (let k = 0; k < 20 && !stop; k++) {
          g.sim.step();
          const newCaller = g.sim.callers().some((a) => !callers0.has(a.cs) && g.sim.t >= (a.awaitingSince ?? 0) && a.cs !== st.cs);
          stop = ready(g, ctx) || g.sim.t - t0 > 900 || g.sim.ended || g.sim.alerts().length > 0 || g.sim.releases.some((r) => r.state === 'pending' && r.t >= t0) || newCaller;
        }
        if (stop) { skipping = false; g.setSpeed(st.run ?? 0); render(); return; }
        requestAnimationFrame(tick);
      };
      render();
      tick();
    };

    // ---------- rendering
    const bodyOf = (st: Step) => (typeof st.body === 'function' ? st.body(g) : st.body);
    const renderAsk = (st: Step) => {
      const a = st.ask!;
      const opts = typeof a.options === 'function' ? a.options(g) : a.options;
      const right = typeof a.correct === 'function' ? a.correct(g) : a.correct;
      const why = typeof a.why === 'function' ? a.why(g) : a.why;
      return `<div class="coach-ask">${opts.map((o, k) => `<button data-c="ask" data-k="${k}" class="${answered && answered.idx === k ? (answered.ok ? 'right' : 'wrong') : answered?.ok && k === right ? 'right' : ''}">${o}</button>`).join('')}</div>${answered ? `<div class="coach-why ${answered.ok ? '' : 'bad'}">${answered.ok ? 'Right. ' : 'Not quite. '}${why}</div>` : ''}`;
    };
    const lineFor = (title: string, nn: string, extra = '') => `<div class="coach-line"><span class="cl-n">${nn}</span><button class="cl-t" data-c="min">${title}</button>${extra}<button data-c="min" aria-label="Expand">▴</button></div>`;
    const render = () => {
      card.dataset.phase = phase;
      card.dataset.step = phase === 'steps' ? cur()?.id ?? '' : '';
      card.dataset.lesson = lesson.id;
      card.classList.toggle('collapsed', collapsed);
      card.classList.toggle('exam', phase === 'exam' || phase === 'intro' || phase === 'replay' || (phase === 'result' && !!verdict));
      const head = (label: string, step: string, prog: number) => `<header><span class="coach-lesson">${label}</span><span class="coach-step">${step}</span><button class="coach-min" data-c="min" aria-label="${collapsed ? 'Expand' : 'Minimise'}">▾</button></header><div class="coach-bar"><i style="width:${prog * 100}%"></i></div>`;
      const label = `${n} · ${lesson.title}`;
      if (phase === 'steps') {
        const st = cur();
        const last = i === lesson.steps.length - 1;
        const waiting = (!!st.done || (!!st.ask && !answered?.ok)) && !(st.done && st.done(g, ctx));
        const canSkipAhead = (st.run ?? 0) > 0 && !!(st.until ?? st.done);
        const toExam = i === 0 && seenBefore && ex ? '<button data-c="toExam">Go to the exam</button>' : '';
        const ff = canSkipAhead ? `<button data-c="ff" class="ff">${skipping ? 'Skipping…' : '⏩ Skip ahead'}</button>` : '';
        card.innerHTML = `${lineFor(st.title, `${i + 1}/${total}`, canSkipAhead ? `<button data-c="ff" class="ff" aria-label="Skip ahead">⏩</button>` : '')}
          ${head(label, `${stageTitle} · ${i + 1} / ${total}`, (i + 1) / total)}
          <h4>${st.title}</h4>
          <p>${bodyOf(st)}</p>
          ${st.ask ? renderAsk(st) : ''}
          <footer>
            <button data-c="exit">Exit</button><button data-c="restart">Restart</button>
            <span class="grow"></span>
            ${waiting ? `${toExam}${st.ask ? '' : `<span class="coach-wait">${(st.run ?? 0) > 0 ? 'Clock running' : 'Your move'}</span>`}${ff}<button data-c="skip" class="ghost">Skip</button>`
              : `${ff}${toExam}<button data-c="next" class="go">${last ? (ex ? 'On to the exam' : 'Finish') : 'Next'}</button>`}
          </footer>`;
      } else if (phase === 'intro' && ex) {
        card.innerHTML = `${lineFor(`Exam: ${ex.title}`, 'EXAM')}
          ${head(`${label} · exam`, `${total} / ${total}`, 1)}
          <h4>Exam: ${ex.title}</h4>
          <p>${ex.brief} No coach this time.</p>
          <div class="coach-rule">${ex.rule}</div>
          <footer><button data-c="exit">Exit</button><span class="grow"></span><button data-c="skipExam" class="ghost">Skip exam</button><button data-c="startExam" class="go">Start exam</button></footer>`;
      } else if (phase === 'exam' && ex && mem) {
        if (ex.quiz) {
          const qq = ex.quiz[Math.min(qIdx, ex.quiz.length - 1)];
          const opts = typeof qq.options === 'function' ? qq.options(g.sim) : qq.options;
          card.innerHTML = `${lineFor(`Question ${qIdx + 1} of ${ex.quiz.length}`, 'EXAM')}
            ${head(`Exam · ${ex.title}`, `${qIdx + 1} / ${ex.quiz.length}`, qIdx / ex.quiz.length)}
            <h4>${typeof qq.q === 'function' ? qq.q(g.sim) : qq.q}</h4>
            <div class="coach-ask">${opts.map((o, k) => `<button data-c="quiz" data-k="${k}">${o}</button>`).join('')}</div>
            <footer><button data-c="exit">Exit</button><span class="grow"></span><span class="coach-wait">Look at the scope, then answer</span></footer>`;
        } else {
          const left = ex.limitS !== undefined ? mmss(ex.limitS - (g.sim.t - mem.t0)) : '';
          const status = ex.status?.(g.sim, mem) ?? '';
          card.innerHTML = `${lineFor(`${left ? `${left} · ` : ''}${status || ex.title}`, '<span class="cl-x">EXAM</span>')}
            ${head(`Exam · ${ex.title}`, left, 1)}
            <p>${ex.brief}</p>
            <div class="coach-rule">${ex.rule}</div>
            <div class="coach-status" data-c2="status">${status}</div>
            <footer><button data-c="exit">Exit</button><span class="grow"></span><button data-c="retryExam">Restart exam</button></footer>`;
        }
      } else if (phase === 'replay' && ex) {
        const lines = runLines.map((l) => `<div class="coach-say"><b class="mono">${esc(l.cs)}</b> <span class="say-w">“${esc(l.words.replace(/^[A-Z0-9]+, /, ''))}”</span>${l.why ? `<span class="say-y">${esc(l.why)}</span>` : ''}</div>`).join('');
        const left = ex.limitS !== undefined && mem ? mmss(ex.limitS - (g.sim.t - mem.t0)) : '';
        card.innerHTML = `${lineFor(runBusy ? 'Preparing the instructor’s run…' : runDone ? `Instructor: ${runDone.pass ? 'PASS' : 'did not pass'}` : runLines[runLines.length - 1]?.words ?? 'Instructor’s run', '<span class="cl-x">INSTRUCTOR</span>')}
          ${head(`Instructor · ${ex.title}`, left, 1)}
          ${runBusy ? '<h4>Preparing the instructor’s run…</h4><p>The same traffic, flown by the instructor. A moment.</p>'
            : runDone ? `<div class="coach-verdict ${runDone.pass ? 'pass' : 'retry'}">INSTRUCTOR: ${runDone.pass ? 'PASS' : 'RETRY'} ${runDone.pass ? stars(runDone.stars) : ''}</div><p>${esc(runDone.why)}${runDone.pass ? '' : ' Even the instructor did not pass this one as scripted; the exam may be too hard, tell the author.'}</p>`
            : `<h4>Watch what the instructor does</h4><p class="coach-dim">Same seed, same traffic. Each clearance appears here with the reason, as it goes out.</p>`}
          <div class="coach-run" data-c2="run">${lines}</div>
          <footer><button data-c="exit">Lessons</button><span class="grow"></span>${runDone ? '' : '<button data-c="stopReplay">Stop</button>'}<button data-c="retryExam" class="go">Retry exam</button></footer>`;
      } else if (phase === 'result') {
        const nextBtn = nav.next ? '<button data-c="nextLesson" class="go">Next lesson</button>' : '<button data-c="exit" class="go">Finish</button>';
        if (verdict && ex) {
          const watch = !verdict.pass && ex.scenario ? '<button data-c="replay" class="ghost">Watch the instructor</button>' : '';
          card.innerHTML = `${head(`${label} · exam`, '', 1)}
            <div class="coach-verdict ${verdict.pass ? 'pass' : 'retry'}">${verdict.pass ? 'PASS' : 'RETRY'} ${verdict.pass ? stars(verdict.stars) : ''}</div>
            <p>${verdict.why}</p>
            <footer><button data-c="exit">Lessons</button><span class="grow"></span>${watch}<button data-c="retryExam" class="${verdict.pass ? '' : 'go'}">Retry exam</button>${verdict.pass ? nextBtn : ''}</footer>`;
        } else {
          card.innerHTML = `${head(label, '', 1)}<h4>Lesson complete</h4><p>${ex ? 'You skipped the exam. You can take it any time from the lesson list.' : ''}</p><footer><button data-c="exit">Lessons</button><span class="grow"></span>${nextBtn}</footer>`;
        }
      }
    };

    card.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-c]') as HTMLElement | null;
      if (!b) return; // glossary words bubble up to the game, which opens the sheet
      e.stopPropagation();
      const c = b.dataset.c;
      if (c === 'min') { collapsed = !collapsed; render(); requestAnimationFrame(syncReserved); return; }
      if (c === 'next' || c === 'skip') { advance(); return; }
      if (c === 'ff') { skipAhead(); return; }
      if (c === 'ask') {
        const st = cur(); const a = st.ask!; const k = Number(b.dataset.k);
        const right = typeof a.correct === 'function' ? a.correct(g) : a.correct;
        answered = { idx: k, ok: k === right };
        ctx.asked = answered.ok;
        render();
        return;
      }
      if (c === 'quiz') { answerQuiz(Number(b.dataset.k)); return; }
      if (c === 'startExam') { startExam(); return; }
      if (c === 'toExam') { i = lesson.steps.length - 1; advance(); return; }
      if (c === 'retryExam') { if (ex?.scenario) startExam(); else { phase = 'exam'; mem = examMem(g.sim); qIdx = 0; verdict = undefined; render(); } return; }
      if (c === 'skipExam') { phase = 'result'; verdict = undefined; render(); return; }
      if (c === 'replay') { void startReplay(); return; }
      if (c === 'stopReplay') { runDone = run?.verdict ?? { pass: false, stars: 0, why: 'Stopped.' }; g.setSpeed(0); render(); return; }
      if (c === 'nextLesson') { nav.next?.(); return; }
      if (c === 'exit') { nav.exit(); return; }
      if (c === 'restart') nav.restart();
    });

    // ---------- the poll
    let lastStatus = '';
    const timer = window.setInterval(() => {
      if (phase === 'steps') {
        const st = cur();
        if (!st) return;
        const doneNow = st.ask ? !!answered?.ok && (!st.done || st.done(g, ctx)) : !!st.done && st.done(g, ctx);
        if (doneNow && st.done && !st.ask) { advance(); return; }
        if (st.ask && answered?.ok && !st.done && !(card.querySelector('[data-c="next"]'))) render();
        if (typeof st.body === 'function' && !skipping) { const p = card.querySelector('p'); if (p) p.innerHTML = bodyOf(st); }
        // highlight the control (the bar re-renders, so look it up again each time)
        const el = typeof st.el === 'function' ? st.el(g) ?? null : st.el ? g.root.querySelector(st.el) : null;
        if (el !== hl) { hl?.classList.remove('coach-hl'); hl = el; hl?.classList.add('coach-hl'); }
        // the target aircraft: select it once it turns up, keep it in view
        if (st.cs && !st.noAutoSelect && !targetSeen && g.sim.find(st.cs) && (g.sim.find(st.cs)!.awaitingSince !== undefined && g.sim.t >= g.sim.find(st.cs)!.awaitingSince! || !g.cs)) { targetSeen = true; if (g.cs !== st.cs) g.select(st.cs, true); }
        const m = markOf(st);
        if (m?.cs && performance.now() - lastTouch > 5000) keepInView(m.cs);
      } else if (phase === 'exam' && ex && mem) {
        if (!ex.scenario && !ex.quiz) { const v = examVerdict(ex, g.sim, mem); if (v) finishExam(v); }
        const s = ex.status?.(g.sim, mem) ?? '';
        const left = ex.limitS !== undefined ? mmss(ex.limitS - (g.sim.t - mem.t0)) : '';
        if (s + left !== lastStatus) {
          lastStatus = s + left;
          const el = card.querySelector('[data-c2="status"]'); if (el) el.textContent = s;
          const ln = card.querySelector('.coach-line .cl-t'); if (ln) ln.textContent = `${left ? `${left} · ` : ''}${s || ex.title}`;
          const st = card.querySelector('.coach-step'); if (st) st.textContent = left;
        }
        if (hl) { hl.classList.remove('coach-hl'); hl = null; }
      } else if (phase === 'replay') {
        const sig = `${runLines.length}:${runLines[runLines.length - 1]?.words ?? ''}:${runDone ? 1 : 0}:${runBusy ? 1 : 0}`;
        if (sig !== lastStatus) { lastStatus = sig; render(); }
        if (hl) { hl.classList.remove('coach-hl'); hl = null; }
      } else if (hl) { hl.classList.remove('coach-hl'); hl = null; }
      // a picker or the glossary sheet is open: on a phone it shares the bottom of the screen, so the coach steps up to one line at the top
      const pk = phone() && !!(g.els?.picker && !g.els.picker.hidden);
      if (pk !== card.classList.contains('pk-open')) {
        card.classList.toggle('pk-open', pk);
        if (pk && !collapsed) { collapsed = true; pkCollapsed = true; render(); }
        else if (!pk && pkCollapsed) { collapsed = false; pkCollapsed = false; render(); }
      }
      syncReserved();
    }, 300);
    const onResize = () => { render(); requestAnimationFrame(syncReserved); };
    window.addEventListener('resize', onResize);

    if (copts.toExam && ex) { i = lesson.steps.length - 1; phase = 'intro'; g.setSpeed(0); render(); requestAnimationFrame(syncReserved); }
    else go(0);
    return {
      destroy() {
        clearInterval(timer);
        skipping = false;
        window.removeEventListener('resize', onResize);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup', onUp);
        hl?.classList.remove('coach-hl');
        g.scope.marks = []; g.scope.reserved = [];
        g.onBeforeSend = undefined; g.coachHints = savedHints;
        host.classList.remove('coached');
        card.remove();
      },
    };
  };
}

// For the browser walk and for a console that has not yet wired lessonsFor: the academy's entry points.
if (typeof window !== 'undefined') {
  (window as any).__lggTut = { ALL_LESSONS, LESSONS, lessonsFor, lessonById, coachFor, drillOfTheDay, curriculumProgress, STAGES };
}
void (null as unknown as Item);
