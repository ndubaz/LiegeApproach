import './tutorial.css';
import type { Game } from './game';
import type { Sim } from '../engine/sim';
import type { Aircraft, Scenario, SpawnSpec } from '../engine/types';
import { levelText, type Clearance, type Item } from '../engine/clearance';
import { assess, GRADE_NAMES } from '../engine/assess';
import { hints } from '../engine/hints';
import { remainNm } from '../engine/autopilot';
import { alongTrack, crossTrack, dist, norm360 } from '../geo';
import { GLOSSARY } from './glossary';

// Learning path: eleven lessons, each a scripted scenario in the real sim with a
// coach that points at the control to use and waits until you have used it,
// then an exam: a short session with no coaching, judged from the sim, PASS or
// RETRY with one line of why and up to three stars.

// ---------------------------------------------------------------- types
type ElRef = string | ((g: Game) => Element | null | undefined);
export interface Mark { cs?: string; fix?: string; text?: string }
export interface Step {
  /** stable id (tests fly the lesson step by step by id) */
  id: string;
  /** short and imperative: on a phone it is all the collapsed coach shows */
  title: string;
  body: string | ((g: Game) => string);
  /** sim speed while the step is open: 0 = paused for you to act */
  run?: 0 | 1 | 2 | 4;
  /** control to highlight */
  el?: ElRef;
  mark?: Mark | ((g: Game) => Mark | undefined);
  focus?: { fix?: string; cs?: string; scale?: number };
  /** the aircraft this step is about: marked, auto-selected when it is there, and transmissions to anyone else are stopped */
  cs?: string;
  /** do not auto-select `cs` (the step teaches how to select it) */
  noAutoSelect?: boolean;
  /** start collapsed on a phone: the action is on the scope */
  compact?: boolean;
  /** a question to answer before the step is done */
  ask?: { options: string[] | ((g: Game) => string[]); correct: number | ((g: Game) => number); why: string | ((g: Game) => string) };
  onEnter?(g: Game, ctx: StepCtx): void;
  /** finish automatically when true; otherwise the coach shows Next */
  done?(g: Game, ctx: StepCtx): boolean;
  /** "Skip ahead" fast-forwards until this is true (default: done) */
  until?(g: Game, ctx: StepCtx): boolean;
}
export interface StepCtx { cmdStart: number; logStart: number; t0: number; s0: number; tap?: { x: number; y: number; t: number }; asked?: boolean; note?: string }
export interface Verdict { pass: boolean; why: string; stars: 0 | 1 | 2 | 3 }
export interface ExamMem { t0: number; answers: number[]; [k: string]: any }
export interface QuizQ { q: string | ((sim: Sim) => string); options: string[] | ((sim: Sim) => string[]); answer: (sim: Sim) => number }
export interface Exam {
  title: string;
  /** what you will be asked to do, shown before the exam starts */
  brief: string;
  /** the pass rule in one line */
  rule: string;
  /** a fresh scenario; without one the exam continues in the lesson's sim (quizzes) */
  scenario?: Scenario;
  run?: 0 | 1 | 2 | 4;
  limitS?: number;
  quiz?: QuizQ[];
  /** called after every sim second */
  watch?(sim: Sim, m: ExamMem): void;
  /** one live line while the exam runs */
  status?(sim: Sim, m: ExamMem): string;
  /** undefined while the exam is still running */
  judge(sim: Sim, m: ExamMem): Verdict | undefined;
  /** marks to show during the exam (gates) */
  marks?: Mark[];
}
export interface Lesson { id: string; title: string; summary: string; minutes: number; scenario: Scenario; steps: Step[]; exam?: Exam }

// ---------------------------------------------------------------- scenario helpers
const METAR = 'EBLG 121405Z 22006KT 9999 FEW040 15/07 Q1018 NOSIG';
const sc = (id: string, spawns: SpawnSpec[], extra: Partial<Scenario> = {}): Scenario => ({
  id: `tut-${id}`, title: 'Tutorial', desc: '', seed: 4242, durationMin: 60, startUtc: '14:05', metar: METAR, runway: '22L', spawns, events: [], readbackErr: 0,
  noSayAgain: true, tutorial: true, ...extra,
});
const A = (t: number, cs: string, type: string, star: string, spawnDist: number, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t, kind: 'arr', cs, type, star, spawnDist, ...x });
const D = (t: number, cs: string, type: string, sid: string): SpawnSpec => ({ t, kind: 'dep', cs, type, sid });

// ---------------------------------------------------------------- condition helpers
const ILS: Item = { k: 'app', app: 'ILS', rwy: '22L' };
const find = (g: { sim: Sim }, cs: string) => g.sim.find(cs);
export const isCalling = (sim: Sim, cs: string) => { const a = sim.find(cs); return !!a && a.awaitingSince !== undefined && sim.t >= a.awaitingSince; };
const calling = (g: Game, cs: string) => isCalling(g.sim, cs);
const sentTo = (g: Game, x: StepCtx, cs: string, pred: (it: Item) => boolean = () => true) =>
  g.sim.cmdLog.slice(x.cmdStart).some((c) => c.cl.cs === cs && c.cl.items.some(pred));
const sentAny = (sim: Sim, from: number, cs: string, pred: (it: Item) => boolean = () => true) =>
  sim.cmdLog.slice(from).some((c) => c.cl.cs === cs && c.cl.items.some(pred));
const staged = (g: Game, cs: string, pred: (it: Item) => boolean) => g.cs === cs && g.items.some(pred);
const heardFrom = (g: Game, x: StepCtx, cs: string, re?: RegExp) => g.sim.log.slice(x.logStart).some((t) => t.from === 'PILOT' && t.cs === cs && !t.text.startsWith('Liège') && (!re || re.test(t.text)));
const heardAny = (g: Game, x: StepCtx, cs: string, re: RegExp) => g.sim.log.slice(x.logStart).some((t) => t.from === 'PILOT' && t.cs === cs && re.test(t.text));
const pickerKind = (g: Game) => { const p = g.els?.picker; return p && !p.hidden ? p.dataset.kind : undefined; };
const magHdg = (sim: Sim, a?: Aircraft) => (a?.hdgSys === undefined ? undefined : norm360(a.hdgSys - sim.pack.meta.magVar));
const inRange = (v: number | undefined, lo: number, hi: number) => v !== undefined && v >= lo && v <= hi;
const isLvl = (pred: (ft: number) => boolean, sim: Sim) => (it: Item) => it.k === 'lvl' && pred(sim.ftOf(it.lvl));
const isHdg = (lo: number, hi: number) => (it: Item) => it.k === 'hdg' && inRange(it.hdg, lo, hi);
const offCl = (sim: Sim, a: Aircraft) => crossTrack(a.p, sim.rwy.thr, sim.rwy.crs);
const alongFinal = (sim: Sim, a: Aircraft) => alongTrack(a.p, sim.rwy.thr, norm360(sim.rwy.crs + 180));
const gone = (sim: Sim, cs: string) => !sim.find(cs) || sim.find(cs)!.state === 'transferred';
const landed = (sim: Sim, cs: string) => sim.landings.some((l) => l.cs === cs);
const pastFix = (a: Aircraft | undefined, fix: string) => !!a && !a.route.some((l) => l.fix === fix);
const fmtLvl = (sim: Sim, ft: number) => { const l = sim.levelFor(Math.round(ft / 100) * 100); return l.fl !== undefined ? `FL${String(l.fl).padStart(3, '0')}` : `${l.ft!.toLocaleString('en-US')} ft`; };
const costly = (sim: Sim, from = 0) => sim.events.filter((e) => e.t >= from && e.cost > 0);
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- text helpers
/** A glossary word: tap it for the meaning. Only GLOSSARY keys are allowed (tests check). */
const G = (term: keyof typeof GLOSSARY & string, text: string = term) => `<button class="gl" data-gloss="${term}">${text}</button>`;
/** a control or value as it appears on screen */
const K = (s: string) => `<b class="k">${s}</b>`;

// ---------------------------------------------------------------- element helpers
const q = (sel: string): ElRef => (g) => g.root.querySelector(sel);
/** the suggestion chip whose label starts with this text */
const sg = (prefix: string): ElRef => (g) => [...g.root.querySelectorAll<HTMLElement>('.sg')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(prefix));
/** a picker flow: highlight the button that opens the picker, then the choice, then TRANSMIT */
const flow = (...parts: { k: Item['k'][]; btn: string; picker: string; pick: string }[]): ElRef => (g) => {
  const open = pickerKind(g);
  for (const p of parts) {
    if (g.items.some((i) => p.k.includes(i.k))) continue;
    if (open === p.picker) return g.root.querySelector(`.picker [data-pick="${p.pick}"]`);
    return g.root.querySelector(p.btn);
  }
  return g.root.querySelector('[data-a="send"]');
};
const LVL = (pick: string) => ({ k: ['lvl'] as Item['k'][], btn: '[data-p="lvl"]', picker: 'lvl', pick });
const SPD = (pick: string) => ({ k: ['spd', 'spdmin'] as Item['k'][], btn: '[data-p="spd"]', picker: 'spd', pick });
const MORE = (k: Item['k'], pick: string) => ({ k: [k], btn: '[data-p="more"]', picker: 'more', pick });

// =====================================================================================
// LESSONS
// =====================================================================================

// ---- 1. The scope
const L1: Lesson = {
  id: 'scope', title: 'The scope', minutes: 5,
  summary: 'Zoom, find the runway and the high ground, read a label. Miles, levels, altitudes and QNH.',
  scenario: sc('scope', [A(1, 'QTR8125', 'B77L', 'KOK7X', 26), A(1, 'FDX5203', 'MD11', 'GESLO6X', 20)]),
  steps: [
    {
      id: 'intro', title: 'You are Liège Approach',
      body: `You work the radar for Liège airport: everything within about 40 ${G('NM')} and below ${G('FL', 'FL095')}. Brussels hands you arrivals, Tower hands you departures, and you hand them on. This lesson is a tour by doing. The clock is stopped, so take your time.`,
      onEnter: (g) => { for (let k = 0; k < 3; k++) g.sim.step(); g.scope.fit(); },
    },
    {
      id: 'zoom', title: 'Zoom in twice: tap +',
      body: `Tap ${K('+')} twice (or pinch). The faint rings are 5 NM apart, centred on the airport. Every second ring is a little brighter and carries its distance: 10, 20, 30. A nautical mile is 1.852 km.`,
      el: '[data-z="in"]', onEnter: (g, x) => { x.s0 = g.scope.scale; },
      done: (g, x) => g.scope.scale >= x.s0 * 1.6,
    },
    {
      id: 'alhuv', title: 'Tap ALHUV',
      body: `Every arrival route (${G('STAR')}) ends at ALHUV, half a mile from the runway. Arrivals you forget about will hold there. Find it in the ring and tap it.`,
      mark: { fix: 'ALHUV', text: 'ALHUV' }, focus: { fix: 'ALHUV', scale: 16 }, compact: true,
      done: (g, x) => !!x.tap && dist(g.scope.toW(x.tap.x, x.tap.y), g.sim.pack.fixes.get('ALHUV')!.p) < 2.5,
    },
    {
      id: 'final', title: 'Runway 22L and its final',
      body: `Runway 22L is in use. The dashed line running north-east from it is the final approach, with a tick every mile. Beside it, the gap ruler counts the miles. L22LF, 5.8 NM out, is where arrivals start down the 3° glidepath from 2,500 ft (the ${G('FAF')}).`,
      mark: { fix: 'L22LF', text: 'L22LF · 2,500 ft' }, focus: { fix: 'L22LF', scale: 14 },
    },
    {
      id: 'mva', title: 'Tap the 3,500 ft area (high ground)',
      body: (g) => `The overlay shows the ${G('MVA')}: the lowest level you may give an aircraft on your headings. 2,500 ft over the flat north-west, 3,000 ft and 3,500 ft over the Ardennes to the south-east. Each area shows its value in hundreds of feet. Tap anywhere in the 3,500 ft area.${(g as any)._tutNote ? ` <i>${(g as any)._tutNote}</i>` : ''}`,
      compact: true,
      onEnter: (g) => { g.settings.showMva = true; g.scope.focus({ x: 6, y: -10 }, Math.min(g.scope.scale, 7)); },
      done: (g, x) => {
        if (!x.tap) return false;
        if (x.tap.t !== (x as any)._seenTap) {
          (x as any)._seenTap = x.tap.t;
          const mva = g.sim.mvaAt(g.scope.toW(x.tap.x, x.tap.y));
          (x as any)._ok = mva >= 3500;
          (g as any)._tutNote = mva >= 3500 ? '' : `That spot is ${mva.toLocaleString('en-US')} ft. Try further south.`;
        }
        return !!(x as any)._ok;
      },
    },
    {
      id: 'select', title: 'Tap QTR8125 to select it',
      body: `This is an arrival from the west. Tap its symbol or its label. The bar at the bottom then shows the selected aircraft.`,
      cs: 'QTR8125', noAutoSelect: true, compact: true, mark: { cs: 'QTR8125', text: 'tap' },
      onEnter: (g) => { g.settings.showMva = false; (g as any)._tutNote = ''; },
      done: (g) => g.cs === 'QTR8125',
    },
    {
      id: 'label', title: 'Read the label',
      body: (g) => {
        const a = find(g, 'QTR8125');
        const now = a ? fmtLvl(g.sim, a.alt) : 'FL093';
        const gs = a ? Math.round(a.gs / 10) : 30;
        return `Selected, the label opens up. Top line: callsign, wake category (B, a heavy), the level now (${K(now.replace('FL', '').replace(' ft', ''))} means ${now}) with an arrow while it descends, and ground speed in tens of ${G('kt', 'knots')} (${gs} is ${gs * 10} kt). Below, four chips you can tap: ${K('CFL')}, the level you cleared it to; ${K('IAS')}, its speed; ${K('NAV')}, where it is going; ${K('APP')}, its approach. Unselected labels show the same in four short lines. The line ahead of the symbol shows where it will be in one minute.`;
      },
      cs: 'QTR8125', mark: { cs: 'QTR8125' },
    },
    {
      id: 'levels', title: 'Levels and altitudes',
      body: `High up, everyone sets the standard pressure, 1013 hPa, and flies ${G('FL', 'flight levels')}: FL080 is about 8,000 ft. Low down, pilots set the local pressure, the ${G('QNH')}, and fly altitudes in feet above the sea. Today the QNH is 1018, so the lowest flight level you can use, the ${G('Transition level', 'transition level')}, is FL055. Below it you give altitudes: 5,000 ft, 4,000 ft, 3,000 ft.`,
      ask: { options: ['FL060', 'FL050', '5,000 ft'], correct: 1, why: 'FL050 is below the transition level FL055 today. Below it you say an altitude, such as 5,000 ft.' },
    },
  ],
  exam: {
    title: 'Read the scope', run: 0,
    brief: 'Four questions about the traffic on your scope right now. Look, zoom and tap as much as you like before you answer.',
    rule: '<b>Pass:</b> 3 of 4 right. All 4 right earns three stars.',
    quiz: [
      { q: 'Which aircraft is higher right now?', options: ['QTR8125', 'FDX5203'], answer: (s) => ((s.find('QTR8125')?.alt ?? 0) >= (s.find('FDX5203')?.alt ?? 0) ? 0 : 1) },
      { q: 'About how far is FDX5203 from the airport?', options: ['About 10 NM', 'About 20 NM', 'About 30 NM'], answer: (s) => { const a = s.find('FDX5203'); const d = a ? Math.hypot(a.p.x, a.p.y) : 20; return d < 15 ? 0 : d < 25 ? 1 : 2; } },
      { q: 'What is the minimum vectoring altitude where FDX5203 is now?', options: ['2,500 ft', '3,000 ft', '3,500 ft'], answer: (s) => { const a = s.find('FDX5203'); const m = a ? s.mvaAt(a.p) : 3000; return m <= 2500 ? 0 : m <= 3000 ? 1 : 2; } },
      { q: 'QNH 1018, transition level FL055. Which is the highest?', options: ['FL060', '5,000 ft', 'FL055'], answer: () => 0 },
    ],
    judge: (_s, m) => {
      if (m.answers.length < 4) return undefined;
      const right = m.right as number;
      return right >= 3 ? { pass: true, stars: right === 4 ? 3 : 2, why: `${right} of 4 right.` } : { pass: false, stars: 0, why: `${right} of 4 right. Zoom in and look at the labels and the MVA overlay before you answer.` };
    },
  },
};

// ---- 2. First contact
const L2: Lesson = {
  id: 'contact', title: 'First contact', minutes: 6,
  summary: 'Answer a pilot with a suggestion chip, then with the level grid. Readbacks and "how do you read".',
  scenario: sc('contact', [A(2, 'QTR8125', 'B77L', 'KOK7X', 26), A(45, 'AZG7321', 'B748', 'CIV7X', 30), A(100, 'ETH3721', 'B77L', 'NIK7X', 34)]),
  steps: [
    {
      id: 'wait', title: 'Traffic is coming', run: 2,
      body: `Brussels has handed you QTR8125, a 777 freighter from the west. Its label flashes until the pilot calls you on 119.280.`,
      focus: { cs: 'QTR8125' }, mark: { cs: 'QTR8125' }, done: (g) => calling(g, 'QTR8125'),
    },
    {
      id: 'select', title: 'Answer it: tap ☎ (top bar)',
      body: `QTR8125 is calling. ${K('☎')} counts the pilots waiting for you; tap it and it selects the one who has waited longest. You can also tap the aircraft.`,
      el: '[data-e="callers"]', cs: 'QTR8125', noAutoSelect: true, done: (g) => g.cs === 'QTR8125',
    },
    {
      id: 'chip', title: 'Tap the “Descend FL060” chip',
      body: `The bar now offers the calls a controller would most likely make. The bright one is the usual choice; here you only want it lower for now. One tap transmits. (Press and hold a chip instead to put it in the bar and edit it first.)`,
      cs: 'QTR8125', el: sg('Descend'), done: (g, x) => sentTo(g, x, 'QTR8125', (it) => it.k === 'lvl'),
    },
    {
      id: 'readback', title: 'Listen to the readback', run: 1,
      body: `The pilot repeats your clearance: the ${G('Readback')}. It includes the ${G('QNH')}, because you gave the first altitude. Check level, callsign and numbers every time.`,
      cs: 'QTR8125', done: (g, x) => heardFrom(g, x, 'QTR8125'),
    },
    {
      id: 'next', title: 'Another arrival', run: 2,
      body: `QTR8125 is descending. Its label shows the cleared level after the arrow. AZG7321, a 747, will call next.`,
      mark: { cs: 'AZG7321' }, done: (g) => calling(g, 'AZG7321'),
    },
    {
      id: 'grid', title: 'Tap LVL, then FL070',
      body: `This time pick the level yourself. ${K('LVL')} opens the level grid: flight levels at the top, altitudes in feet below the transition level. The current and cleared levels are marked, and a red line shows the ${G('MVA')}. Choose ${K('FL070')}.`,
      cs: 'AZG7321', el: flow(LVL('F70')),
      done: (g, x) => staged(g, 'AZG7321', isLvl((ft) => ft < 7500 && ft > 6500, g.sim)) || sentTo(g, x, 'AZG7321', isLvl((ft) => ft < 8000, g.sim)),
    },
    {
      id: 'send', title: 'Check the words, then TRANSMIT',
      body: `Your choice is a chip in the bar, with the exact words underneath. Amber text would warn you, for example below the MVA. If it reads right, tap ${K('TRANSMIT')}.`,
      cs: 'AZG7321', el: '[data-a="send"]', done: (g, x) => sentTo(g, x, 'AZG7321', (it) => it.k === 'lvl'),
    },
    {
      id: 'ignore', title: 'ETH3721 calls: leave it for now', run: 2,
      body: `ETH3721 will call next. This once, do not answer, and listen. After 25 seconds of silence the pilot asks “how do you read?”. In a real session that costs you: an unanswered call is a slip.`,
      mark: { cs: 'ETH3721' }, onEnter: (g) => g.select(undefined),
      done: (g, x) => heardAny(g, x, 'ETH3721', /how do you read/),
    },
    {
      id: 'answer', title: 'Answer ETH3721 now',
      body: `Select it with ${K('☎')} and answer with a chip or the grid. Any descent will do.`,
      cs: 'ETH3721', noAutoSelect: true, el: (g) => (g.cs === 'ETH3721' ? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'ETH3721'),
    },
    {
      id: 'wrap', title: 'That is the loop',
      body: `Select, answer, check the readback. Answer every call within a few seconds, even if only with a level. Next: the exam, three arrivals calling close together.`,
    },
  ],
  exam: {
    title: 'Three on frequency', run: 1, limitS: 240,
    brief: 'Three arrivals will call within half a minute. Answer each one with a descent below the level it reports.',
    rule: '<b>Pass:</b> every call answered with a descent, nobody left waiting 20 s. <b>Stars:</b> answer each within 8 s.',
    scenario: sc('contact-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 24, { callNow: true }), A(10, 'AZG7321', 'B748', 'CIV7X', 28), A(18, 'FDX5203', 'MD11', 'GESLO6X', 22)], { seed: 77 }),
    watch: (sim, m) => {
      m.waits ??= {} as Record<string, number>;
      for (const a of sim.aircraft) if (isCalling(sim, a.cs)) m.waits[a.cs] = Math.max(m.waits[a.cs] ?? 0, sim.t - a.awaitingSince!);
    },
    status: (sim) => { const w = sim.callers().filter((a) => sim.t >= (a.awaitingSince ?? 0)); return w.length ? `${w.length} waiting: ${w.map((a) => `${a.cs} ${Math.round(sim.t - a.awaitingSince!)} s`).join(', ')}` : 'Nobody waiting'; },
    judge: (sim, m) => {
      const css = ['QTR8125', 'AZG7321', 'FDX5203'];
      const late = Object.entries((m.waits ?? {}) as Record<string, number>).find(([, w]) => w > 20);
      if (late || sim.events.some((e) => e.kind === 'unanswered')) return { pass: false, stars: 0, why: `${late?.[0] ?? 'A pilot'} waited more than 20 s. Use ☎ to jump to the next caller.` };
      if (sim.events.some((e) => e.kind === 'warning_sent')) return { pass: false, stars: 0, why: 'You transmitted a clearance with a warning showing. Read the amber text before you send.' };
      const done = css.every((cs) => { const a = sim.find(cs); return !!a && a.cflSys !== undefined && sim.ftOf(a.cflSys) < a.alt - 600 && sentAny(sim, 0, cs) && !isCalling(sim, cs) && !sim.readbackPending(cs); });
      if (!done) return undefined;
      const worst = Math.max(...css.map((cs) => (m.waits?.[cs] ?? 0)));
      return { pass: true, stars: worst <= 8 ? 3 : worst <= 14 ? 2 : 1, why: `All three answered; the longest wait was ${Math.round(worst)} s.` };
    },
  },
};

// ---- 3. Turns
const L3: Lesson = {
  id: 'turns', title: 'Turns', minutes: 6,
  summary: 'The heading dial and the heading drag. Magnetic headings, left and right. Exam: fly through two gates.',
  scenario: sc('turns', [A(2, 'CHG201', 'B744', 'KOK7X', 30)]),
  steps: [
    {
      id: 'intro', title: 'Headings',
      body: `A heading is the direction the nose points, in degrees from magnetic north: 360 north, 090 east, 180 south, 270 west. The ring of numbers round the airport, 25 NM out, is a compass rose. Pilots always turn the short way unless you say otherwise.`,
    },
    { id: 'wait', title: 'CHG201 will call', run: 2, body: 'A 747 from the west. Wait for its call.', focus: { cs: 'CHG201' }, mark: { cs: 'CHG201' }, done: (g) => calling(g, 'CHG201') },
    { id: 'select', title: 'Select CHG201 (☎)', body: `Tap ${K('☎')} or the aircraft.`, el: '[data-e="callers"]', cs: 'CHG201', noAutoSelect: true, done: (g) => g.cs === 'CHG201' },
    {
      id: 'dial', title: 'Tap HDG to open the heading dial',
      body: `${K('HDG')} opens a compass dial. The dotted line is the present heading. FINAL and DNWD mark the runway course and its opposite, the downwind.`,
      cs: 'CHG201', el: '[data-p="hdg"]', done: (g, x) => pickerKind(g) === 'hdg' || staged(g, 'CHG201', (it) => it.k === 'hdg') || sentTo(g, x, 'CHG201', (it) => it.k === 'hdg'),
    },
    {
      id: 'pick', title: 'Drag round the dial to 060, then lift',
      body: `Press anywhere on the dial and slide round to ${K('060')}. The centre shows ${K('L060')}: left, because left is the short way from where it points now, and how many degrees it will turn. Lift your finger to choose it.`,
      cs: 'CHG201', el: (g) => (pickerKind(g) === 'hdg' ? g.root.querySelector('.picker .rose') : g.root.querySelector('[data-p="hdg"]')),
      done: (g, x) => staged(g, 'CHG201', isHdg(50, 70)) || sentTo(g, x, 'CHG201', isHdg(50, 70)),
    },
    { id: 'send', title: 'TRANSMIT the turn', body: `The chip reads ${K('L060')} and the words say “turn left heading 060”. Transmit.`, cs: 'CHG201', el: '[data-a="send"]', done: (g, x) => sentTo(g, x, 'CHG201', isHdg(50, 70)) },
    {
      id: 'watch', title: 'Watch it turn', run: 2,
      body: `Airliners turn at about 3° a second, so a 45° turn takes 15 seconds and a mile or more of sky. The heading you gave shows as ${K('H060')} on line 3 of the label.`, cs: 'CHG201',
      done: (g, x) => g.sim.t - x.t0 > 25,
    },
    {
      id: 'drag', title: 'Drag from the aircraft to R120, lift',
      body: `The quick way. Press on the aircraft symbol itself (not the label) and drag out to the south-east. A line follows your finger and a bubble shows the heading. When it reads ${K('R120')}, lift: it transmits at once. If you hold still before lifting, it waits in the bar instead: then tap TRANSMIT. Over a fix the bubble says DCT and the fix name instead; move off it.`,
      cs: 'CHG201', compact: true, mark: { cs: 'CHG201', text: 'press here, drag' }, focus: { cs: 'CHG201', scale: 12 },
      el: (g) => (g.items.some((it) => it.k === 'hdg') ? g.root.querySelector('[data-a="send"]') : null),
      done: (g, x) => sentTo(g, x, 'CHG201', isHdg(105, 135)),
    },
    {
      id: 'lr', title: 'Left or right?',
      body: `CHG201 flies heading 120. You say “heading 330”, without a direction. Which way does it turn?`,
      ask: { options: ['Left', 'Right'], correct: 0, why: 'The short way: 150° to the left rather than 210° to the right. The dial and the drag pick the short way and say it. Say “turn right” only when you really want the long way round.' },
    },
    {
      id: 'magnetic', title: 'Magnetic, not true',
      body: `Headings are magnetic. At Liège magnetic north is 2° from true north, so runway 22L points 223° magnetic. You never need to correct for it: the dial, the drag and the compass rose already work in magnetic.`,
    },
  ],
  exam: {
    title: 'Two gates', run: 2, limitS: 480,
    brief: 'CHG201 will call from the west. Using headings only, fly it through GATE 1, north-west of the field, then GATE 2, just south of gate 1. A direct-to does not count.',
    rule: '<b>Pass:</b> within 1.5 NM of gate 1, then of gate 2, on headings, in 8 minutes. <b>Stars:</b> within 0.75 NM of both.',
    marks: [{ fix: 'LG008', text: 'GATE 1' }, { fix: 'LG009', text: 'GATE 2' }],
    scenario: sc('turns-exam', [A(1, 'CHG201', 'B744', 'KOK7X', 26, { callNow: true })]),
    watch: (sim, m) => {
      const a = sim.find('CHG201'); if (!a) return;
      const g1 = sim.pack.fixes.get('LG008')!.p, g2 = sim.pack.fixes.get('LG009')!.p;
      m.best1 = Math.min(m.best1 ?? 99, dist(a.p, g1));
      if (m.best1 < 1.5) m.best2 = Math.min(m.best2 ?? 99, dist(a.p, g2));
    },
    status: (_s, m) => (m.best1 === undefined || m.best1 >= 1.5 ? `Gate 1: closest ${m.best1 === undefined ? '-' : m.best1.toFixed(1)} NM` : `Gate 1 done (${m.best1.toFixed(1)} NM). Gate 2: closest ${m.best2?.toFixed(1) ?? '-'} NM`),
    judge: (sim, m) => {
      if (sim.cmdLog.some((c) => c.cl.items.some((i) => i.k === 'dct' || i.k === 'trans' || i.k === 'hold'))) return { pass: false, stars: 0, why: 'A direct-to, transition or hold was used. Headings only.' };
      const a = sim.find('CHG201');
      if (m.best2 !== undefined && m.best2 < 1.5 && a && dist(a.p, sim.pack.fixes.get('LG009')!.p) > m.best2 + 0.3) {
        const both = Math.max(m.best1, m.best2);
        return { pass: true, stars: both <= 0.75 ? 3 : both <= 1.1 ? 2 : 1, why: `Gate 1 at ${m.best1.toFixed(1)} NM, gate 2 at ${m.best2.toFixed(1)} NM.` };
      }
      if (m.best1 !== undefined && m.best1 >= 1.5 && a && sim.t - m.t0 > 200 && dist(a.p, sim.pack.fixes.get('LG008')!.p) > m.best1 + 2) return { pass: false, stars: 0, why: `Missed gate 1 by ${m.best1.toFixed(1)} NM. Turn earlier, and aim a little inside the turn.` };
      if (m.best2 !== undefined && m.best2 >= 1.5 && a && dist(a.p, sim.pack.fixes.get('LG009')!.p) > m.best2 + 2) return { pass: false, stars: 0, why: `Missed gate 2 by ${m.best2.toFixed(1)} NM. A 747 needs over a mile to turn; start the turn before the gate.` };
      return undefined;
    },
  },
};

// ---- 4. Descent planning
const L4: Lesson = {
  id: 'descent', title: 'Descent planning', minutes: 7,
  summary: 'Three miles per thousand feet, plus room to slow down. The SUP line and the level-off tick.',
  scenario: sc('descent', [A(2, 'TAY4EK', 'B763', 'LNO6X', 16, { level: { fl: 90 } }), A(520, 'QTR8152', 'B77L', 'KOK7X', 12, { level: { fl: 90 } })]),
  steps: [
    {
      id: 'rule', title: 'Three miles per thousand feet',
      body: `An airliner comes down comfortably at about 1,000 ft for every 3 NM it flies, and it cannot slow down and descend steeply at the same time. So: height to lose in thousands of feet, times 3, plus about 4 NM to slow down. That is the ${G('Track miles', 'track miles')} it needs.`,
    },
    { id: 'wait', title: 'TAY4EK will call at FL090', run: 2, body: 'A 767 from the east, on LNO6X.', focus: { cs: 'TAY4EK' }, mark: { cs: 'TAY4EK' }, done: (g) => calling(g, 'TAY4EK') },
    {
      id: 'need', title: 'How many miles does it need?', cs: 'TAY4EK',
      body: `TAY4EK must get from FL090 (about 9,000 ft) to 2,500 ft, the height at which it joins the final. About how many track miles does it need?`,
      ask: { options: ['About 12 NM', 'About 24 NM', 'About 40 NM'], correct: 1, why: '6,500 ft to lose: 6.5 × 3 is about 20 NM, plus about 4 NM to slow down.' },
    },
    {
      id: 'have', title: 'Is it high?', cs: 'TAY4EK',
      body: `Its route: 16 NM to ALHUV, then the ALHUV1B transition round to LIBVA and down the final, about 26 NM more. Is it high?`,
      ask: { options: ['Yes, it must start down at once', 'No, it has miles to spare'], correct: 1, why: 'About 42 NM to go against 24 needed. It can start down gently.' },
    },
    {
      id: 'step', title: 'Tap “Descend FL070”',
      body: `Start it down gently. Each step down should come before it levels off, so the descent never stops.`,
      cs: 'TAY4EK', el: sg('Descend'), done: (g, x) => sentTo(g, x, 'TAY4EK', (it) => it.k === 'lvl'),
    },
    {
      id: 'tick', title: 'The level-off tick', run: 2, cs: 'TAY4EK',
      body: `Look ahead of TAY4EK: the dotted ghost line shows where it will be over the next two minutes, and the small tick with a level on it marks where it will level off. Before it reaches that tick, give the next level.`,
      done: (g, x) => g.sim.t - x.t0 > 30,
    },
    {
      id: 'rest', title: 'Tap the ALHUV1B chip: the rest in one call',
      body: `The bright chip clears the transition, 3,000 ft and the ILS in one call. From here the aircraft flies to the final by itself and never needs to level off above 3,000 ft until LIBVA.`,
      cs: 'TAY4EK', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'TAY4EK', (it) => it.k === 'trans'),
    },
    {
      id: 'tayTwr', title: 'TAY4EK to Tower when it shows LOC22L', run: 4, cs: 'TAY4EK', el: sg('160'),
      body: (g) => { const a = find(g, 'TAY4EK'); return `Watch TAY4EK come down the transition without levelling off${a ? ` (now ${fmtLvl(g.sim, a.alt)})` : ''}. When line 4 of its label reads LOC22L, tap its ${K('160 to 4 · Tower')} chip. Skip ahead if you like.`; },
      done: (g) => gone(g.sim, 'TAY4EK') || landed(g.sim, 'TAY4EK'), until: (g) => !!find(g, 'TAY4EK')?.app?.locCap,
    },
    {
      id: 'second', title: 'QTR8152 is next', run: 2,
      body: `A 777 is coming from the west at FL090. Watch for the SUP line at the top of the bar: your supervisor speaks up when something needs you.`,
      mark: { cs: 'QTR8152' },
      onEnter: (g) => { g.coachHints = true; },
      done: (g) => isCalling(g.sim, 'QTR8152') || !!find(g, 'QTR8152')?.app,
    },
    {
      id: 'cleared', title: 'Watch the SUP line', run: 2, cs: 'QTR8152',
      body: `The coach has answered QTR8152 for you: transition and ILS, but no descent, so it stays at FL090. Now watch: the SUP line at the top of the bar will tell you when it is getting too high.`,
      onEnter: (g) => { if (!find(g, 'QTR8152')?.app) g.sim.issue({ cs: 'QTR8152', items: [{ k: 'trans', name: 'ALHUV1A' }, ILS] }); },
      el: '[data-e="hint"]',
      done: (g) => hints(g.sim)[0]?.key === 'high:QTR8152', // the SUP line shows the most urgent hint
    },
    {
      id: 'fix', title: 'Fix it now: LVL → 2,500 → TRANSMIT',
      body: `The SUP line says it needs more miles than it has. Three cures: descend now, slow down, or give it more miles. Careful with slowing: a jet that is slowing down cannot also descend steeply. Here the quickest cure is the level: ${K('LVL')} → ${K('2,500')} → ${K('TRANSMIT')}. The clock is stopped until you do.`,
      cs: 'QTR8152', el: flow(LVL('A2500')),
      done: (g, x) => sentTo(g, x, 'QTR8152', isLvl((ft) => ft <= 3000, g.sim)),
    },
    {
      id: 'land', title: 'QTR8152 to Tower when it shows LOC22L', run: 4, cs: 'QTR8152', el: sg('160'),
      body: `It made it. Hand it to Tower with its chip once it is established. Use Skip ahead to save time.`,
      onEnter: (g) => { g.coachHints = false; },
      done: (g) => gone(g.sim, 'QTR8152') || landed(g.sim, 'QTR8152'),
      until: (g) => !!find(g, 'QTR8152')?.app?.locCap,
    },
    {
      id: 'wrap', title: 'Plan the descent before you need it',
      body: `Height to lose times 3, plus 4 to slow down, against the track miles left. Too high? Descend, slow, or add miles. Next: the exam.`,
    },
  ],
  exam: {
    title: 'Down from FL090', run: 2, limitS: 900,
    brief: 'QTR8152 calls at FL090 from the south-east. Get it to L22LF at 2,500 ft, established, without ever levelling off above 3,000 ft for more than a minute.',
    rule: '<b>Pass:</b> at L22LF on the localizer at 2,500 ft, no level-off above 3,000 ft longer than 60 s, no go-around. <b>Stars:</b> little time dragged in level at low altitude.',
    scenario: sc('descent-exam', [A(1, 'QTR8152', 'B77L', 'GESLO6X', 14, { level: { fl: 90 }, callNow: true })]),
    watch: (sim, m) => {
      const a = sim.find('QTR8152'); if (!a) return;
      if (m.called === undefined && isCalling(sim, 'QTR8152')) m.called = sim.t;
      if (m.called === undefined) return;
      const level = Math.abs(a.vs) < 100 && !a.app?.gsCap;
      if (level && a.alt > 3100) { m.lvlRun = (m.lvlRun ?? 0) + 1; m.maxLvl = Math.max(m.maxLvl ?? 0, m.lvlRun); m.lvlAt = a.alt; } else m.lvlRun = 0;
      if (level && a.alt <= 3100) m.low = (m.low ?? 0) + 1;
      if (m.faf === undefined && a.app?.locCap && sim.dthr(a) < 5.8) m.faf = a.alt;
    },
    status: (sim, m) => { const a = sim.find('QTR8152'); return a ? `${fmtLvl(sim, a.alt)} · ${Math.round(sim.dthr(a))} NM · longest level-off ${m.maxLvl ?? 0} s` : ''; },
    judge: (sim, m) => {
      if ((m.maxLvl ?? 0) > 60) return { pass: false, stars: 0, why: `It levelled off at ${fmtLvl(sim, m.lvlAt)} for over a minute. Give the next level before it reaches the level-off tick.` };
      if (sim.events.some((e) => e.kind === 'goaround') || sim.find('QTR8152')?.app?.tooHigh) return { pass: false, stars: 0, why: 'Too high to join the glidepath. Start down earlier, or slow it down sooner.' };
      if (sim.events.some((e) => e.kind === 'mva')) return { pass: false, stars: 0, why: 'It went below the minimum vectoring altitude.' };
      if (m.faf !== undefined) {
        if (m.faf > 2800) return { pass: false, stars: 0, why: `At L22LF it was at ${Math.round(m.faf)} ft, above the glidepath.` };
        const low = m.low ?? 0;
        return { pass: true, stars: low <= 100 ? 3 : low <= 180 ? 2 : 1, why: `At L22LF at ${Math.round(m.faf / 10) * 10} ft. Longest level-off above 3,000 ft: ${m.maxLvl ?? 0} s; level at low altitude: ${low} s.` };
      }
      return undefined;
    },
  },
};

// ---- 5. Vectors to the ILS
const L5: Lesson = {
  id: 'vectors', title: 'Vectors to the ILS', minutes: 8,
  summary: 'Downwind, base, a 30° intercept and the approach clearance, slow to 160, Tower. Exam from the other side.',
  scenario: sc('vectors', [A(2, 'CHG201', 'B744', 'KOK7X', 13)]),
  steps: [
    {
      id: 'wait', title: 'CHG201: a 747 from the west', run: 2,
      body: `Instead of letting it fly to ALHUV, you will vector it: a downwind north of the field, a base turn, and a 30° turn onto the final. The ${G('ILS')} then takes it down to the runway.`,
      focus: { cs: 'CHG201' }, mark: { cs: 'CHG201' }, done: (g) => calling(g, 'CHG201'),
    },
    {
      id: 'downwind', title: 'Drag from CHG201 to L045 (downwind)',
      body: `Press on the aircraft and drag out to the north-east until the bubble reads ${K('L045')}, then lift. (Or ${K('HDG')} and the dial.) The downwind runs parallel to the final, the opposite way, 6 to 8 NM to the side.`,
      cs: 'CHG201', compact: true, mark: { cs: 'CHG201', text: 'drag from here' }, focus: { cs: 'CHG201', scale: 11 },
      done: (g, x) => sentTo(g, x, 'CHG201', isHdg(20, 70)),
    },
    {
      id: 'down', title: 'LVL 3,000, SPD 210, TRANSMIT', run: 1,
      body: `North-west of the field the ${G('MVA')} is 2,500 ft, so 3,000 ft is safe. Tap ${K('LVL')} → ${K('3,000')}, ${K('SPD')} → ${K('210')}, then ${K('TRANSMIT')}: both in one call.`,
      cs: 'CHG201', el: flow(LVL('A3000'), SPD('S210')),
      done: (g, x) => sentTo(g, x, 'CHG201', isLvl((ft) => ft <= 4000, g.sim)) && sentTo(g, x, 'CHG201', (it) => it.k === 'spd'),
    },
    {
      id: 'fly', title: 'Fly the downwind', run: 4, cs: 'CHG201',
      body: (g) => { const a = find(g, 'CHG201'); const al = a ? alongFinal(g.sim, a) : 0; return `Turn base when it is about 11 NM out along the final, abeam the 10 mark of the gap ruler. Now ${al.toFixed(1)} NM.`; },
      done: (g) => { const a = find(g, 'CHG201'); return !!a && alongFinal(g.sim, a) > 10.5; },
    },
    {
      id: 'base', title: 'Tap the “Base R135” chip',
      body: `Base: perpendicular to the final, heading 135. The bar offers it now. (A drag to ${K('R135')} does the same.)`,
      cs: 'CHG201', el: sg('Base'), done: (g, x) => sentTo(g, x, 'CHG201', isHdg(100, 170)),
    },
    {
      id: 'intercept', title: 'At 2 NM from the centreline: tap “R195 · ILS 22L”', run: 1, cs: 'CHG201',
      body: (g) => { const a = find(g, 'CHG201'); const xt = a ? Math.abs(offCl(g.sim, a)) : 0; return `Wait until it is about 2 NM from the centreline (now ${xt.toFixed(1)} NM). Then tap the chip ${K('R195 · ILS 22L')}: a 30° intercept and the approach clearance in one call. Too early and it joins late; too late and it flies through.`; },
      el: sg('R195'), until: (g) => { const a = find(g, 'CHG201'); return !!a && Math.abs(offCl(g.sim, a)) < 2.4; },
      done: (g) => { const a = find(g, 'CHG201'); return !!a?.app && inRange(magHdg(g.sim, a), 160, 215); },
    },
    {
      id: 'loc', title: 'Wait for LOC22L on the label', run: 2, cs: 'CHG201', el: '[data-z="vp"]',
      body: (g) => { const a = find(g, 'CHG201'); return a && !a.app?.locCap && Math.abs(offCl(g.sim, a)) > 1.2 && alongFinal(g.sim, a) > 4 && Math.sign(offCl(g.sim, a)) > 0 === (g as any)._tutSide < 0 ? 'It flew through the localizer. Turn it back with a heading of about 250 and keep the approach clearance.' : `Line 4 changes to ${K('LOC22L')} when it captures the ${G('LOC', 'localizer')}. From then on it follows the beam and the ${G('GS', 'glidepath')} by itself. ${K('VP')} on the right opens a side view.`; },
      onEnter: (g) => { const a = find(g, 'CHG201'); (g as any)._tutSide = a ? Math.sign(offCl(g.sim, a)) : 0; },
      done: (g) => !!find(g, 'CHG201')?.app?.locCap,
    },
    {
      id: 'twr', title: 'Tap “160 to 4 · Tower”',
      body: `Established 8 to 12 NM out: slow it to 160 kt until 4 NM and hand it to Tower, in one call. Left at 210 kt it arrives at 4 NM too fast to be stable and goes around. Without a Tower handoff it has no landing clearance.`,
      cs: 'CHG201', el: sg('160'), run: 1, done: (g) => gone(g.sim, 'CHG201') || landed(g.sim, 'CHG201'),
    },
    { id: 'land', title: 'Let it land', run: 4, body: 'Tower has it now.', done: (g) => landed(g.sim, 'CHG201') },
    {
      id: 'wrap', title: 'Downwind, base, intercept, ILS, Tower',
      body: `Vectors are shorter than the transitions, and they are how you build a tight sequence. In the exam you do the same from the other side of the final, without the coach.`,
    },
  ],
  exam: {
    title: 'From the other side', run: 2, limitS: 900,
    brief: 'DHK7, a 757 from the east, calls at FL070. Vector it onto the ILS from the south-east side: downwind, base, intercept, approach clearance, then Tower. No transitions.',
    rule: '<b>Pass:</b> it lands off your vectors with no warnings, go-arounds or MVA busts. <b>Stars:</b> shorter than the published transition.',
    scenario: sc('vectors-exam', [A(1, 'DHK7', 'B752', 'LNO6X', 13, { callNow: true })]),
    status: (sim) => { const a = sim.find('DHK7'); return a ? `${fmtLvl(sim, a.alt)} · ${Math.round(a.ias)} kt · ${Math.abs(offCl(sim, a)).toFixed(1)} NM off the centreline` : 'Landed'; },
    judge: (sim) => {
      const bad = costly(sim)[0];
      if (bad) return { pass: false, stars: 0, why: bad.text };
      if (sim.cmdLog.some((c) => c.cl.items.some((i) => i.k === 'trans'))) return { pass: false, stars: 0, why: 'A transition was used. Vectors only.' };
      const l = sim.landings.find((x) => x.cs === 'DHK7');
      if (!l) return undefined;
      const extra = l.flownNm - l.baselineNm;
      return { pass: true, stars: extra <= -3 ? 3 : extra <= 2 ? 2 : 1, why: `Landed, ${extra >= 0 ? `${extra.toFixed(1)} NM more` : `${(-extra).toFixed(1)} NM less`} than the published route.` };
    },
  },
};

// ---- 6. Separation
const L6: Lesson = {
  id: 'separation', title: 'Separation', minutes: 7,
  summary: '3 NM or 1,000 ft. Ghost tracks, RBL and CPA, the STCA alarm. Exam: two converging pairs.',
  scenario: sc('separation', [A(2, 'AZG7321', 'B748', 'CIV7X', 40), A(2, 'ETH3721', 'B77L', 'NIK7X', 40)]),
  steps: [
    {
      id: 'rule', title: '3 NM or 1,000 ft',
      body: `Two aircraft must be at least 3 NM apart sideways, or 1,000 ft apart up and down. Lose both at once and it is a ${G('LoS', 'loss of separation')}: the worst thing you can do in this job.`,
    },
    {
      id: 'wait', title: 'Two arrivals check in', run: 2,
      body: `AZG7321 comes from the west on CIV7X, ETH3721 from the north on NIK7X. Both will call at FL080.`,
      focus: { fix: 'GILOM', scale: 9 }, done: (g) => ['AZG7321', 'ETH3721'].every((cs) => isCalling(g.sim, cs) || sentAny(g.sim, 0, cs)),
    },
    {
      id: 'ghosts', title: 'Read the ghosts', run: 1,
      body: `The coach answered both for you: stay at FL080. Each aircraft drags a dotted ghost line: where it will be in the next two minutes. Both ghosts end at GILOM, at the same level.`,
      mark: { fix: 'GILOM', text: 'both meet here' }, focus: { fix: 'GILOM', scale: 9 },
      onEnter: (g) => { for (const cs of ['AZG7321', 'ETH3721']) if (!sentAny(g.sim, 0, cs)) g.sim.issue({ cs, items: [{ k: 'lvl', lvl: { fl: 80 } }] }); },
      done: (g, x) => g.sim.t - x.t0 > 12,
    },
    {
      id: 'rbl', title: 'Tap RBL, then drag from one to the other',
      body: `${K('RBL')} is your ruler. Turn it on, then drag from AZG7321 to ETH3721. The readout shows the distance now and the ${G('CPA')}: how close they will get, and when, if nothing changes.`,
      el: '[data-z="rbl"]', compact: true, done: (g) => g.scope.rbls.length > 0,
    },
    {
      id: 'cpa', title: 'Will they be separated?',
      body: `Read the CPA on the line you drew. Will they be separated at GILOM if you do nothing?`,
      ask: { options: ['Yes, the CPA is more than 3 NM', 'No, they will be almost on top of each other'], correct: 1, why: 'Same level, same point, same time. Tap RBL again to switch it off; the line stays until you tap its readout.' },
    },
    {
      id: 'stcaWait', title: 'This once, wait for the alarm', run: 2,
      body: `Normally you would act right now. This once, let it run so you see the alarm: the ${G('STCA')} turns both labels red and draws a line between them about a minute before they would lose separation.`,
      onEnter: (g) => { if (g.scope.rblMode) { g.scope.rblMode = false; g.root.querySelector('[data-z="rbl"]')?.classList.remove('on'); } },
      done: (g) => g.sim.alerts().some((a) => a.kind === 'stca'),
    },
    {
      id: 'act', title: 'STCA! Tap ETH3721’s “Descend FL060” chip',
      body: `Act at once. The quickest cure is a level: 1,000 ft takes about half a minute. Send ETH3721 down to FL060 with its chip. (A turn of 30° or more also works, if it is early enough.)`,
      cs: 'ETH3721', el: sg('Descend'), done: (g, x) => sentTo(g, x, 'ETH3721', isLvl((ft) => ft <= 7200, g.sim)),
    },
    {
      id: 'watch', title: 'Watch the gap open', run: 2,
      body: `Watch ETH3721’s level drop. The alarm stops once the prediction shows 1,000 ft between them.`,
      done: (g) => { const a = find(g, 'AZG7321'), b = find(g, 'ETH3721'); return pastFix(a, 'GILOM') && pastFix(b, 'GILOM') && !g.sim.alerts().length; },
    },
    {
      id: 'wrap', title: 'Separate early, check the ghosts',
      body: (g) => `${g.sim.events.some((e) => e.kind === 'los') ? 'They lost separation that time. In the exam act as soon as you see two ghosts meet. ' : 'No loss of separation. '}Look for ghosts that meet at the same level, measure with RBL when unsure, and fix it early with a level or a 30° turn. The alarm is a safety net, not a plan. Next: the exam, two pairs at once.`,
    },
  ],
  exam: {
    title: 'Two converging pairs', run: 2, limitS: 720,
    brief: 'Two pairs of arrivals converge at FL080: CLX7HK and ETH3721 near GILOM in the west, FDX5203 and TAY4EK at LNO in the east. Keep every pair separated.',
    rule: '<b>Pass:</b> no loss of separation until both pairs are past their meeting point. <b>Stars:</b> no STCA alarm at all.',
    marks: [{ fix: 'GILOM', text: 'pair 1' }, { fix: 'LNO', text: 'pair 2' }],
    scenario: sc('separation-exam', [
      A(2, 'CLX7HK', 'B748', 'KOK7X', 52), A(2, 'ETH3721', 'B77L', 'NIK7X', 52),
      A(2, 'FDX5203', 'MD11', 'GESLO6X', 38, { level: { fl: 80 } }), A(2, 'TAY4EK', 'B763', 'LNO6X', 38, { level: { fl: 80 } }),
    ], { seed: 99 }),
    status: (sim) => `${sim.alerts().length ? 'STCA active · ' : ''}${sim.events.filter((e) => e.kind === 'stca').length} alarms so far`,
    judge: (sim, m) => {
      const los = sim.events.find((e) => e.kind === 'los') ?? (sim.alerts().some((a) => a.kind === 'los') ? { text: 'Loss of separation' } : undefined);
      if (los) return { pass: false, stars: 0, why: `${los.text}. Give a level change as soon as two ghosts meet at the same level.` };
      // a pair is done once both are past the meeting point (or off its route) and no alarm is running for them
      const past = (cs: string, fix: string) => { const a = sim.find(cs); return !a || a.mode !== 'NAV' || pastFix(a, fix); };
      const pairs = [['CLX7HK', 'ETH3721', 'GILOM'], ['FDX5203', 'TAY4EK', 'LNO']] as const;
      const clear = pairs.every(([a, b, f]) => past(a, f) && past(b, f) && !sim.alerts().some((x) => [a, b].includes(x.a as never) || [a, b].includes(x.b as never)));
      if (!clear) return undefined;
      m.clearT ??= sim.t;
      if (sim.t - m.clearT < 45) return undefined;
      const n = new Set(sim.events.filter((e) => e.kind === 'stca').map((e) => `${e.cs}${e.cs2}`)).size;
      return { pass: true, stars: n === 0 ? 3 : n === 1 ? 2 : 1, why: n === 0 ? 'Both pairs separated before any alarm.' : `Separated, with ${n} STCA alarm${n > 1 ? 's' : ''}. Act when the ghosts meet, before the alarm.` };
    },
  },
};

// ---- 7. Transitions, the hold and the expected approach time
const L7: Lesson = {
  id: 'transitions', title: 'Transitions and the hold', minutes: 8,
  summary: 'The one-call transition, holding at ALHUV, 5,000 ft not FL050, releasing from the hold.',
  scenario: sc('transitions', [A(2, 'AZG7321', 'B748', 'CIV7X', 24), A(25, 'QTR8152', 'B77L', 'LNO6X', 20)]),
  steps: [
    {
      id: 'wait', title: 'Two arrivals, one gap', run: 2,
      body: `AZG7321 (747) comes from the west, QTR8152 (777) from the east. They reach ALHUV at about the same time. One goes first, the other holds.`,
      focus: { fix: 'ALHUV', scale: 6 }, done: (g) => calling(g, 'AZG7321'),
    },
    {
      id: 'trans', title: 'Tap AZG7321’s chip “ALHUV1A · 3000 · ILS 22L”',
      body: `A ${G('Transition')} is a published path from ALHUV round to LIBVA on the final. This chip clears the transition, 3,000 ft and the ILS in one call. The aircraft does the rest by itself.`,
      cs: 'AZG7321', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'AZG7321', (it) => it.k === 'trans') && sentTo(g, x, 'AZG7321', (it) => it.k === 'app'),
    },
    { id: 'second', title: 'QTR8152 will call', run: 1, body: 'It is too close to follow AZG7321 straight in.', mark: { cs: 'QTR8152' }, done: (g) => calling(g, 'QTR8152') },
    {
      id: 'hold', title: 'MORE → Hold ALHUV → TRANSMIT',
      body: `Hold it at ALHUV as published: left turns, 3,000 ft to FL050. Tap ${K('MORE')}, then ${K('Hold ALHUV')}, then ${K('TRANSMIT')}. The amber line warns that FL070 is above the top of the hold: you fix that next, so tap ${K('TRANSMIT')} a second time to send anyway. The phrase includes an expected approach time (${G('EFC')}), the time it can expect to leave.`,
      cs: 'QTR8152', el: flow(MORE('hold', 'HOLD ALHUV')), done: (g, x) => sentTo(g, x, 'QTR8152', (it) => it.k === 'hold'),
    },
    {
      id: 'tl', title: 'The top of the hold',
      body: `The chart says the hold goes up to FL050. But today the ${G('Transition level', 'transition level')} is FL055. What do you clear QTR8152 to?`,
      cs: 'QTR8152', ask: { options: ['FL050', '5,000 ft'], correct: 1, why: 'Below the transition level, levels become altitudes in feet. FL050 does not exist today; 5,000 ft is the same height on the local QNH.' },
    },
    {
      id: 'stack', title: 'LVL → 5,000 → TRANSMIT',
      body: `Clear QTR8152 to ${K('5,000')} ft, the top of the stack.`, cs: 'QTR8152', el: flow(LVL('A5000')),
      done: (g, x) => sentTo(g, x, 'QTR8152', isLvl((ft) => ft <= 5100, g.sim)),
    },
    {
      id: 'gap', title: 'Wait until AZG7321 shows LOC22L', run: 4,
      body: `Both transitions meet at LIBVA. Release the holder only once AZG7321 is established on the localizer (line 4 reads LOC22L), or they arrive at LIBVA together.`,
      mark: { cs: 'AZG7321' }, done: (g) => { const a = find(g, 'AZG7321'); return !a || !!a.app?.locCap; },
    },
    {
      id: 'release', title: 'Tap QTR8152’s “Leave hold” chip',
      body: `The chip clears it out of the hold onto ALHUV1B, 3,000 ft and the ILS, in one call.`,
      cs: 'QTR8152', el: sg('Leave hold'), run: 1, done: (g, x) => sentTo(g, x, 'QTR8152', (it) => it.k === 'trans') && !!find(g, 'QTR8152')?.app,
    },
    {
      id: 'twr', title: 'Hand AZG7321 to Tower (its Tower chip)', run: 2, cs: 'AZG7321', el: sg('Tower'),
      body: `It is established. Its lead chip reads ${K('Tower')}.`, done: (g) => gone(g.sim, 'AZG7321') || landed(g.sim, 'AZG7321'),
    },
    {
      id: 'land', title: 'Then QTR8152 to Tower too', run: 4, cs: 'QTR8152', el: sg('Tower'),
      body: `When QTR8152 shows LOC22L, give it the Tower chip as well. Skip ahead if you like.`,
      done: (g) => gone(g.sim, 'QTR8152') || landed(g.sim, 'QTR8152'),
      until: (g) => !!find(g, 'QTR8152')?.app?.locCap,
    },
    {
      id: 'wrap', title: 'Transitions are cheap, the hold is your buffer',
      body: `One call per arrival on the transition. When the sequence is full, hold, stack them 1,000 ft apart, and release the lowest first. Next: the exam with three arrivals.`,
    },
  ],
  exam: {
    title: 'Three for one runway', run: 2, limitS: 1500,
    brief: 'Three arrivals: AZG7321 from the west, QTR8152 from the east and ETH3721 from the north. Get them all established on the ILS and to Tower. Hold whoever has to wait, 1,000 ft apart.',
    rule: '<b>Pass:</b> all three to Tower on the localizer, no loss of separation, no wake or stack conflicts, no go-arounds. <b>Stars:</b> little holding.',
    scenario: sc('transitions-exam', [A(2, 'AZG7321', 'B748', 'CIV7X', 22), A(15, 'QTR8152', 'B77L', 'LNO6X', 18), A(40, 'ETH3721', 'B77L', 'NIK7X', 30)], { seed: 31 }),
    status: (sim) => `${sim.aircraft.filter((a) => a.state === 'transferred' || a.landed).length + sim.landings.length} of 3 with Tower · ${sim.aircraft.filter((a) => a.mode === 'HOLD').length} holding`,
    judge: (sim) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'stack', 'goaround', 'mva'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const css = ['AZG7321', 'QTR8152', 'ETH3721'];
      if (!css.every((cs) => landed(sim, cs) || (sim.find(cs)?.state === 'transferred' && sim.find(cs)?.app?.locCap))) return undefined;
      const holdMin = css.reduce((s, cs) => s + (sim.landings.find((l) => l.cs === cs)?.holdSec ?? sim.find(cs)?.holdSec ?? 0), 0) / 60;
      return { pass: true, stars: holdMin <= 3 ? 3 : holdMin <= 7 ? 2 : 1, why: `All three with Tower; ${holdMin.toFixed(1)} min of holding in total.` };
    },
  },
};

// ---- 8. Wake spacing with speed
const L8: Lesson = {
  id: 'spacing', title: 'Wake spacing with speed', minutes: 8,
  summary: 'RECAT-EU minima on final, the gap ruler, and speed control: 180 kt holds the gap.',
  scenario: sc('spacing', [A(2, 'CLX7HK', 'B748', 'KOK7X', 20), A(40, 'TAY4EK', 'B763', 'KOK7X', 21)]),
  steps: [
    {
      id: 'wait', title: 'A 747 then a 767', run: 2,
      body: `Big aircraft leave wake vortices behind them. ${G('RECAT-EU')} sorts them into categories: CLX7HK, a 747-8F, is B; TAY4EK, a 767, is C. Behind a B, a C needs 4 NM on final, not the usual 3. The letter after the callsign on the label is the category.`,
      mark: { cs: 'CLX7HK' }, done: (g) => calling(g, 'CLX7HK'),
    },
    {
      id: 'lead', title: 'The leader is cleared', run: 2,
      body: `To save time the coach clears CLX7HK for ALHUV1A, 3,000 ft and the ILS. TAY4EK, on the same route a minute behind, calls next.`,
      onEnter: (g) => { g.sim.issue({ cs: 'CLX7HK', items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS] }); },
      done: (g) => calling(g, 'TAY4EK'),
    },
    {
      id: 'follow', title: 'The follower is cleared too',
      body: `TAY4EK gets the same clearance. Both now fly the same path to the same runway. The spacing is up to you, with speed.`,
      onEnter: (g) => { g.sim.issue({ cs: 'TAY4EK', items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS] }); },
    },
    {
      id: 'ruler', title: 'Watch the gap ruler', run: 4,
      body: (g) => {
        const a = find(g, 'CLX7HK'), b = find(g, 'TAY4EK');
        const gap = a?.app?.locCap && b?.app?.locCap ? ` Gap now ${(g.sim.dthr(b) - g.sim.dthr(a)).toFixed(1)} NM.` : '';
        return `Beside the final, the gap ruler marks each arrival with a tick and, once both are on the localizer, the gap between them in NM. A chevron on the centreline shows where the follower should be: 4 NM behind.${gap}`;
      },
      focus: { fix: 'LIBVA', scale: 9 },
      done: (g) => { const a = find(g, 'CLX7HK'), b = find(g, 'TAY4EK'); return !!a?.app?.locCap && !!b && g.sim.dthr(b) < 16; },
    },
    {
      id: 'speed', title: 'Give TAY4EK 180 kt (SPD → 180)',
      body: (g) => {
        const a = find(g, 'CLX7HK'), b = find(g, 'TAY4EK');
        const gap = a && b ? (a.app?.locCap && b.app?.locCap ? g.sim.dthr(b) - g.sim.dthr(a) : remainNm(g.sim, b) - remainNm(g.sim, a)).toFixed(1) : '-';
        return `TAY4EK is about ${gap} NM behind CLX7HK along the route, and the gap will shrink: the 747 slows first and the 767 catches up. Left alone, TAY4EK ends up inside 4 NM. 180 kt holds the gap near 4.4 NM; 160 kt opens it wider than needed; 200 kt or more closes it. Tap ${K('SPD')} → ${K('180')} and transmit, or slide up and down on the speed chip of its label.`;
      },
      cs: 'TAY4EK', el: flow(SPD('S180')), done: (g, x) => sentTo(g, x, 'TAY4EK', (it) => it.k === 'spd' || it.k === 'spdmin'),
    },
    {
      id: 'land', title: 'Tower chips for both, then watch the gap', run: 4,
      body: (g) => { const a = find(g, 'CLX7HK'), b = find(g, 'TAY4EK'); const gap = a?.app?.locCap && b?.app?.locCap ? `Gap ${(g.sim.dthr(b) - g.sim.dthr(a)).toFixed(1)} NM. ` : ''; return `${gap}Hand each one to Tower with its chip once it shows LOC22L. The landing strip at the top reports each gap at touchdown.`; },
      done: (g) => g.sim.landings.length >= 2,
      until: (g) => g.sim.aircraft.some((a) => a.state === 'assumed' && a.app?.locCap) || g.sim.landings.length >= 2,
    },
    {
      id: 'result', title: 'Result',
      body: (g) => {
        const s = g.sim.spacing.find((x) => x.leader === 'CLX7HK');
        if (g.sim.events.some((e) => e.kind === 'wake')) return 'TAY4EK got inside 4 NM on final: a wake infringement. Restart and try 180 kt earlier. Real approach units aim for the minimum plus about half a mile.';
        return s ? `TAY4EK was ${s.gap.toFixed(1)} NM behind at touchdown against a ${s.min} NM minimum${s.gap < s.min ? ': too close' : s.gap - s.min > 1.5 ? ': safe, but you gave away a landing slot' : ': well judged'}. Real units aim for the minimum plus about half a mile.` : 'Both are down. Real units aim for the minimum plus about half a mile.';
      },
    },
  ],
  exam: {
    title: 'Two gaps', run: 2, limitS: 1500,
    brief: 'Three arrivals on the same route: a 747 (B), a 767 (C), a 757 (D). Your assistant clears each one for ALHUV1A and the ILS when it calls. You control the speeds and hand them to Tower. Behind the 747 the 767 needs 4 NM; behind the 767 the 757 needs 3 NM.',
    rule: '<b>Pass:</b> both gaps at touchdown between the minimum and the minimum plus 1 NM, no go-arounds. <b>Stars:</b> both within half a mile of the minimum.',
    scenario: sc('spacing-exam', [A(2, 'CLX7HK', 'B748', 'KOK7X', 20), A(40, 'TAY4EK', 'B763', 'KOK7X', 21), A(110, 'DHK7', 'B752', 'KOK7X', 21)], { seed: 5 }),
    watch: (sim) => {
      for (const cs of ['CLX7HK', 'TAY4EK', 'DHK7']) {
        const a = sim.find(cs);
        if (a && isCalling(sim, cs) && !a.app && !sim.readbackPending(cs)) sim.issue({ cs, items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS] });
      }
    },
    status: (sim) => { const s = sim.spacing.map((x) => `${x.follower} ${x.gap.toFixed(1)}/${x.min}`).join(' · '); const fin = sim.aircraft.filter((a) => a.app?.locCap).sort((a, b) => sim.dthr(a) - sim.dthr(b)); const live = fin.length >= 2 ? `gap ${(sim.dthr(fin[1]) - sim.dthr(fin[0])).toFixed(1)} NM` : ''; return [s, live].filter(Boolean).join(' · ') || 'Waiting for the first touchdown'; },
    judge: (sim) => {
      const ga = sim.events.find((e) => e.kind === 'goaround' || e.kind === 'los' || e.kind === 'wake');
      if (ga) return { pass: false, stars: 0, why: ga.text };
      const s1 = sim.spacing.find((x) => x.leader === 'CLX7HK'), s2 = sim.spacing.find((x) => x.leader === 'TAY4EK');
      for (const s of [s1, s2]) if (s && (s.gap < s.min || s.gap > s.min + 1)) return { pass: false, stars: 0, why: `${s.follower} was ${s.gap.toFixed(1)} NM behind ${s.leader} at touchdown; the window is ${s.min} to ${s.min + 1} NM. ${s.gap < s.min ? 'Slow it earlier.' : 'Keep it faster for longer.'}` };
      if (!s1 || !s2) { if (sim.landings.length >= 3) return { pass: false, stars: 0, why: 'A follower was not on the final when its leader landed.' }; return undefined; }
      const tight = [s1, s2].filter((s) => s.gap - s.min <= 0.5).length;
      return { pass: true, stars: tight === 2 ? 3 : tight === 1 ? 2 : 1, why: `Gaps ${s1.gap.toFixed(1)} NM (min ${s1.min}) and ${s2.gap.toFixed(1)} NM (min ${s2.min}).` };
    },
  },
};

// ---- 9. Departures and releases
const L9: Lesson = {
  id: 'departures', title: 'Departures and releases', minutes: 8,
  summary: 'Tower asks for a release on the intercom: Release, After an arrival, or Hold. Climb clear of arrivals, hand to Brussels.',
  scenario: sc('departures', [A(1, 'FDX5203', 'MD11', 'GESLO6X', 14), D(150, 'CHG7302', 'B748', 'LNO9S'), A(240, 'AZG7321', 'B748', 'CIV7X', 34)]),
  steps: [
    {
      id: 'arr', title: 'FDX5203 is on its way in', run: 2,
      body: `FDX5203, an MD-11, comes from the south-east. When it calls, the coach clears it for ALHUV1B, 3,000 ft and the ILS. Departures today climb out west on LNO9S, to FL060 at first.`,
      mark: { cs: 'FDX5203' },
      done: (g) => { if (isCalling(g.sim, 'FDX5203') && !find(g, 'FDX5203')?.app && !g.sim.readbackPending('FDX5203')) g.sim.issue({ cs: 'FDX5203', items: [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { ft: 3000 } }, ILS] }); return g.sim.releases.some((r) => r.cs === 'CHG7302'); },
    },
    {
      id: 'card', title: 'Tower asks: tap “After FDX5203”',
      body: `A purple card: Tower, on the ${G('Intercom')}, wants to launch CHG7302. You decide when. ${K('Release')} lets it go as soon as the runway is free. ${K('After FDX5203')} lets it go once that arrival has landed. ${K('Hold 3 min')} keeps it on the ground. FDX5203 is on its way to the runway, so: after FDX5203.`,
      cs: 'CHG7302', el: (g) => g.root.querySelector('.icom [data-rel="CHG7302"][data-v^="after"]') ?? g.root.querySelector('.icom [data-rel="CHG7302"]'),
      done: (g) => g.sim.releases.some((r) => r.cs === 'CHG7302' && r.state === 'released') || !!find(g, 'CHG7302'),
    },
    {
      id: 'fdx', title: 'FDX5203 to Tower when it shows LOC', run: 2, cs: 'FDX5203', el: sg('Tower'),
      body: `While CHG7302 waits, hand FDX5203 to Tower with its chip once it is established.`,
      done: (g) => gone(g.sim, 'FDX5203') || landed(g.sim, 'FDX5203'), until: (g) => !!find(g, 'FDX5203')?.app?.locCap,
    },
    {
      id: 'airborne', title: 'CHG7302 will call after take-off', run: 2,
      body: `Tower launches CHG7302 once FDX5203 is down. ${G(`SID`)}s stop at FL060 until you climb them.`,
      done: (g) => calling(g, 'CHG7302'), until: (g) => calling(g, 'CHG7302'),
    },
    {
      id: 'answer', title: 'Answer it: LVL → FL060 (no higher yet)',
      body: (g) => { const z = find(g, 'AZG7321'); return `${z ? `AZG7321 is inbound from the west at ${fmtLvl(g.sim, z.alt)}, right where CHG7302 climbs out. ` : ''}Do not climb CHG7302 above it yet. Answer with ${K('LVL')} → ${K('FL060')}: “maintain FL060”.`; },
      cs: 'CHG7302', el: flow(LVL('F60')), done: (g, x) => sentTo(g, x, 'CHG7302', (it) => it.k === 'lvl'),
      onEnter: (g) => { const z = find(g, 'AZG7321'); if (z && isCalling(g.sim, 'AZG7321')) g.sim.issue({ cs: 'AZG7321', items: [{ k: 'lvl', lvl: { fl: 80 } }] }); },
    },
    {
      id: 'climb', title: 'Once they have passed: “Climb FL090”', run: 2,
      body: (g) => { const a = find(g, 'CHG7302'), z = find(g, 'AZG7321'); const d = a && z ? dist(a.p, z.p) : 99; const passed = !z || (a && z && (dist(a.p, z.p) > 6 && Math.cos(((a.trk - z.trk) * Math.PI) / 180) < 0 && alongTrack(z.p, a.p, a.trk) < 0)); return `${z ? `AZG7321 is ${d.toFixed(0)} NM from CHG7302${passed ? ' and behind it now' : ''}. ` : ''}${passed ? `Climb CHG7302 to FL090, the top of your airspace: tap its ${K('Climb FL090')} chip.` : 'Wait until AZG7321 has passed. The ghosts and RBL help.'} Keep AZG7321 at FL080 meanwhile (the coach answers it if it calls).`; },
      cs: 'CHG7302', el: sg('Climb'),
      onEnter: (g) => { (g as any)._tutAzg = () => { const z = find(g, 'AZG7321'); if (z && isCalling(g.sim, 'AZG7321') && !sentAny(g.sim, 0, 'AZG7321')) g.sim.issue({ cs: 'AZG7321', items: [{ k: 'lvl', lvl: { fl: 80 } }] }); }; },
      done: (g, x) => { (g as any)._tutAzg?.(); return sentTo(g, x, 'CHG7302', (it) => it.k === 'lvl' && it.lvl.fl === 90); },
      until: (g) => { (g as any)._tutAzg?.(); const a = find(g, 'CHG7302'), z = find(g, 'AZG7321'); return !z || (!!a && dist(a.p, z.p) > 6 && alongTrack(z.p, a.p, a.trk) < 0); },
    },
    {
      id: 'bru', title: 'Before the 40 NM ring: tap “Brussels”', run: 2, cs: 'CHG7302', el: sg('Brussels'),
      body: `Hand it to Brussels Control before it leaves your sector. The ${K('Brussels')} chip appears once it is above 7,000 ft or 18 NM out.`,
      done: (g) => gone(g.sim, 'CHG7302'), until: (g) => { const a = find(g, 'CHG7302'); return !a || Math.hypot(a.p.x, a.p.y) > 18 || a.alt > 7000; },
    },
    {
      id: 'wrap', title: 'Release, climb, hand on',
      body: `Release when the runway and the climb-out are clear, keep departures below arrivals coming the other way until they have passed, and transfer them before the boundary. ${G('Release')} and ${G('Handoff')} are in the glossary. Next: the exam.`,
      onEnter: (g) => { (g as any)._tutAzg = undefined; },
    },
  ],
  exam: {
    title: 'Two departures, one arrival', run: 2, limitS: 900,
    brief: 'Tower will ask for two releases. QTR8125 is inbound from the west at FL080 on your climb-out path. Release both departures, climb them to FL090 when clear, and hand them to Brussels. Handle QTR8125 too.',
    rule: '<b>Pass:</b> releases answered within 60 s, both departures with Brussels inside your sector, no loss of separation. <b>Stars:</b> quick releases and handoffs.',
    scenario: sc('departures-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 30), D(10, 'CHG7302', 'B748', 'LNO9S'), D(60, 'BCS7', 'B752', 'CIV5S')], { seed: 17 }),
    watch: (sim, m) => {
      m.relWait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.relWait[r.cs] = sim.t - r.t;
    },
    status: (sim) => `${sim.releases.filter((r) => r.state === 'pending').length} release request${sim.releases.filter((r) => r.state === 'pending').length === 1 ? '' : 's'} waiting · ${sim.departuresHandled} of 2 with Brussels`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'exit_unxfr', 'airspace', 'release_delay', 'mva'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.relWait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `Tower waited ${Math.round(slow[1])} s for a release for ${slow[0]}. Answer the intercom card within a minute.` };
      if (sim.departuresHandled < 2) return undefined;
      const waits = Object.values((m.relWait ?? {}) as Record<string, number>);
      const quick = waits.length >= 2 && waits.every((w) => w <= 20);
      return { pass: true, stars: quick && !sim.events.some((e) => e.kind === 'stca') ? 3 : quick ? 2 : 1, why: `Both departures with Brussels; releases answered in ${waits.map((w) => `${Math.round(w)} s`).join(' and ')}.` };
    },
  },
};

// ---- 10. Safety nets and emergencies, and the final checkride
const L10: Lesson = {
  id: 'safety', title: 'Safety nets and emergencies', minutes: 10,
  summary: 'Catch a wrong readback with Mode S, the alarms, a MAYDAY. Then the final checkride.',
  scenario: sc('safety', [A(2, 'ETH3721', 'B77L', 'KOK7X', 18), A(600, 'CLX7HK', 'B748', 'LNO6X', 16, { emergency: { after: 40, type: 'engine' } })]),
  steps: [
    {
      id: 'wait', title: 'Readbacks go wrong', run: 2,
      body: `Pilots sometimes read back, and set, the wrong level. Liège needs Mode S, which shows you the level the pilot actually selected. This pilot is going to get it wrong.`,
      mark: { cs: 'ETH3721' }, done: (g) => calling(g, 'ETH3721'),
    },
    {
      id: 'clear', title: 'Tap ETH3721’s “Descend FL060” chip',
      body: `Clear it down as usual, then listen carefully.`, cs: 'ETH3721', el: sg('Descend'),
      onEnter: (g) => g.sim.forceWrong.add('ETH3721'),
      done: (g, x) => sentTo(g, x, 'ETH3721', (it) => it.k === 'lvl'),
    },
    { id: 'listen', title: 'Listen to the readback', run: 1, cs: 'ETH3721', body: 'What level does the pilot say?', done: (g, x) => heardFrom(g, x, 'ETH3721') },
    {
      id: 'spot', title: 'What did it read back?', cs: 'ETH3721',
      body: `Read the last line of the comms ticker above the bar, and line 2 of the label.`,
      ask: {
        options: (g) => { const a = find(g, 'ETH3721'); const w = a?.wrong?.item.k === 'lvl' ? levelText((a.wrong.item as any).lvl) : a ? levelText(a.cleared) : 'FL070'; return ['FL060, as cleared', `${w}, the wrong level`]; },
        correct: 1,
        why: (g) => { const a = find(g, 'ETH3721'); return `The label now shows an amber ${K('≠')} with the level the pilot set${a?.cleared ? ` (${levelText(a.cleared)})` : ''}. If it flies 300 ft through your level, ${G('CLAM')} flashes red.`; },
      },
    },
    {
      id: 'negative', title: 'Tap “Negative · FL060”', cs: 'ETH3721', el: sg('Negative'),
      body: `The bar offers the correction: “negative, descend FL060”. Correct it within 30 seconds; missing a wrong readback is a serious slip.`,
      done: (g) => g.sim.events.some((e) => e.kind === 'readback_caught' && e.cs === 'ETH3721'),
    },
    {
      id: 'confirm', title: 'Check the new readback', run: 1, cs: 'ETH3721',
      body: `This time the pilot should read back FL060, and the ${K('≠')} on the label goes away. Always wait for the readback before the next call to the same aircraft.`,
      done: (g, x) => heardFrom(g, x, 'ETH3721') && !find(g, 'ETH3721')?.wrong && !g.sim.readbackPending('ETH3721'),
    },
    {
      id: 'approach', title: 'Now its lead chip: transition and ILS', cs: 'ETH3721', el: '.sg.lead',
      body: `Send ETH3721 on its way: the lead chip clears ALHUV1A, 3,000 ft and the ILS.`,
      done: (g, x) => sentTo(g, x, 'ETH3721', (it) => it.k === 'app'),
    },
    {
      id: 'alarms', title: 'The other alarms',
      body: `${G('STCA')}: two labels turn red with a line between them; act at once with a level or a turn. ${G('MSAW')}: an aircraft is below the minimum vectoring altitude; climb it. ${G('CLAM')}: it has gone through its cleared level. The ${G('Squawk')} 7700 means an emergency, 7600 a radio failure.`,
    },
    {
      id: 'ethTwr', title: 'ETH3721 to Tower when it shows LOC22L', run: 4, cs: 'ETH3721', el: sg('160'),
      body: `When ETH3721 is established, tap its ${K('160 to 4 · Tower')} chip. Skip ahead if you like.`,
      done: (g) => gone(g.sim, 'ETH3721') || landed(g.sim, 'ETH3721'), until: (g) => !!find(g, 'ETH3721')?.app?.locCap,
    },
    {
      id: 'mayday', title: 'Wait for the next arrival', run: 2,
      body: `CLX7HK, a 747, is coming in from the east.`,
      done: (g) => !!find(g, 'CLX7HK')?.emergency && calling(g, 'CLX7HK'),
      until: (g) => !!find(g, 'CLX7HK')?.emergency || isCalling(g.sim, 'CLX7HK') || isCalling(g.sim, 'ETH3721'),
    },
    {
      id: 'card', title: 'MAYDAY! Tap the red card',
      body: `An engine has failed. The red card at the top shows the ${G('MAYDAY')}, how far it has to go, and its level. Tap it: it selects the aircraft and centres it.`,
      cs: 'CLX7HK', noAutoSelect: true, el: '.emer-card .em', done: (g) => g.cs === 'CLX7HK',
    },
    {
      id: 'priority', title: 'Give it the shortest way in: its lead chip', cs: 'CLX7HK', el: '.sg.lead',
      body: `An emergency comes first. Its lead chip clears it direct to LIBVA, 3,000 ft and the ILS: the shortest way in. In a real emergency you would also ask what help the crew needs, and keep others out of its way.`,
      done: (g, x) => sentTo(g, x, 'CLX7HK', (it) => it.k === 'app' || it.k === 'trans' || it.k === 'dct'),
    },
    {
      id: 'land', title: 'CLX7HK to Tower when it shows LOC22L', run: 4, cs: 'CLX7HK', el: sg('160'),
      body: `Hand the emergency to Tower once it is established, as usual. Tower has the fire service waiting.`,
      done: (g) => landed(g.sim, 'CLX7HK') || gone(g.sim, 'CLX7HK'),
      until: (g) => !!find(g, 'CLX7HK')?.app?.locCap,
    },
    {
      id: 'wrap', title: 'Ready for the checkride',
      body: `That is the whole job: answer, descend, vector or clear the transition, separate, space, release, climb, hand on, and watch for what goes wrong. The checkride is a short mixed session with no coach, graded like a real one.`,
    },
  ],
  exam: {
    title: 'Final checkride', run: 1, limitS: 20 * 60,
    brief: 'Twenty minutes at most, four arrivals and two departures, graded like a real session. Two of the arrivals converge at the same level in the east. Every arrival must land and both departures must reach Brussels.',
    rule: '<b>Pass:</b> grade Pass or better: safety gate passed, every arrival landed, both departures handed on, no missed readbacks. <b>Stars:</b> Pass 1, Good 2, Rated 3.',
    scenario: sc('checkride', [
      A(2, 'QTR8125', 'B77L', 'KOK7X', 12), A(40, 'AZG7321', 'B748', 'CIV7X', 14), D(80, 'CHG7302', 'B748', 'LNO9S'),
      A(60, 'FDX5203', 'MD11', 'GESLO6X', 26, { level: { fl: 80 } }), A(60, 'TAY4EK', 'B763', 'LNO6X', 26, { level: { fl: 80 } }), D(300, 'BCS7', 'B752', 'CIV5S'),
    ], { durationMin: 20, readbackErr: 0.08, seed: 2026, pass: { allArrivalsHandled: true, minDeparturesHandled: 2, noMissedReadbacks: true } }),
    status: (sim) => `${sim.landings.length} of 4 landed · ${sim.departuresHandled} of 2 departures · ${mmss(sim.durationS - sim.t)} left`,
    judge: (sim) => {
      if (!sim.ended) return undefined;
      const r = assess(sim);
      const pass = r.grade !== 'fail';
      return { pass, stars: r.grade === 'rated' ? 3 : r.grade === 'good' ? 2 : pass ? 1 : 0, why: pass ? `Grade: ${GRADE_NAMES[r.grade]}.${r.gradeNotes[0] ? ` Next step up: ${r.gradeNotes[0]}.` : ''}` : `Not yet: ${r.gradeNotes[0] ?? 'safety gate'}.` };
    },
  },
};


// ---- 11. The full position
const L11: Lesson = {
  id: 'position', title: 'The full position', minutes: 8,
  summary: 'The whole console: strip bay, landing order, Brussels estimates, push-to-talk, the correction window and the safety-net list.',
  scenario: sc('position', [A(150, 'CLX7HK', 'B748', 'KOK7X', 26), A(200, 'TAY4EK', 'B763', 'LNO6X', 22)], { coordination: true, earlyTransferRate: 0 }),
  steps: [
    {
      id: 'tour', title: 'Your working position',
      body: `On a wide screen the whole position is in front of you: the ${G('Strip', 'strip bay')} on the left, the radar in the middle, and on the right the ${G('AMAN')} landing ladder, coordination with Tower, Brussels and the military, the ${G('Safety nets', 'safety-net list')}, and the weather. On an iPad the right-hand panels sit under tabs; on a phone, under the ▤ button.`,
    },
    {
      id: 'est', title: 'Brussels passes an estimate', run: 2,
      body: `Before Brussels hands an arrival over, it tells you on the ${G('Intercom')} when the aircraft will reach your boundary and at what level: an estimate. It appears as a green strip under “Offered by Brussels”, so you can plan before the pilot calls.`,
      done: (g) => g.sim.estimates.length > 0, until: (g) => g.sim.estimates.length > 0,
    },
    {
      id: 'calls', title: 'Let both check in', run: 2,
      body: `CLX7HK comes from the west and TAY4EK from the south-east. The coach clears both for their transitions when they call.`,
      done: (g) => {
        for (const [cs, tr] of [['CLX7HK', 'ALHUV1A'], ['TAY4EK', 'ALHUV1B']] as const) if (isCalling(g.sim, cs) && !find(g, cs)?.app && !g.sim.readbackPending(cs)) g.sim.issue({ cs, items: [{ k: 'trans', name: tr }, { k: 'lvl', lvl: { ft: 3000 } }, ILS] });
        return !!find(g, 'CLX7HK')?.app && !!find(g, 'TAY4EK')?.app;
      },
    },
    {
      id: 'seq', title: 'Drag a strip to change the landing order',
      body: `The AMAN guessed an order from the times alone. You decide it. In the landing sequence bay, press the coloured tab on the left of a strip and drag it above or below the other one. The ladder on the right, the gap ruler and the suggestions all follow your order. On a phone, open the strips with ▤.`,
      el: (g) => g.root.querySelector('[data-e2="seq"] .strip .bay'),
      done: (g, x) => g.sim.cmdLog.slice(x.cmdStart).some((c) => c.op === 'seq'),
    },
    {
      id: 'ptt', title: 'Push to talk',
      body: `Real controllers key the transmitter, speak, and let go. Hold the Space bar (or a foot pedal set up in Settings, or the 🎙 button) and say the clearance the way you would on frequency: “TAY4EK, reduce speed one eight zero knots”. When you let go, the bar shows what it heard; if it is sure, it sends; if not, check it and press Enter. Shift and Space pauses the sim.`,
    },
    {
      id: 'corr', title: 'Say it, then take it back: CORRECTION',
      body: `Clear CLX7HK to ${K('Speed 220')} with ${K('SPD')} and ${K('TRANSMIT')}, then tap the amber ${K('CORRECTION')} button within three seconds. The pilot hears “correction, disregard” and the old clearance stands. After the readback has started it is too late: give the right clearance instead.`,
      cs: 'CLX7HK',
      done: (g, x) => g.sim.cmdLog.slice(x.cmdStart).some((c) => c.op === 'correct'),
    },
    {
      id: 'nets', title: 'The safety-net list',
      body: `Below the coordination cards, every live alarm has a line: ${G('STCA')} with distance and time to closest approach, a Mode S level that differs from what you cleared, ${G('MSAW')} for an aircraft below the minimum altitude, and a pilot climbing or descending through the cleared level. Tap a line to select the aircraft. Empty means clear.`,
    },
    {
      id: 'land', title: 'Bring them in', run: 4,
      body: `Hand each one to Tower with its chip once it is established, then you have finished the course.`,
      done: (g) => {
        for (const cs of ['CLX7HK', 'TAY4EK']) { const a = find(g, cs); if (a?.app?.locCap && a.state === 'assumed' && !g.sim.readbackPending(cs) && g.sim.dthr(a) < 10) g.sim.issue({ cs, items: [{ k: 'xfr', unit: 'TWR' }] }); }
        return ['CLX7HK', 'TAY4EK'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs));
      },
    },
  ],
  exam: {
    title: 'A short night on the position', run: 2, limitS: 22 * 60,
    brief: 'Three arrivals and a departure, with Brussels coordinating. Brussels will ask to transfer one early: answer it. Release the departure into a gap. Land everyone with no loss of separation.',
    rule: '<b>Pass:</b> all three arrivals with Tower or landed, the departure with Brussels, Brussels and Tower answered within a minute, no loss of separation. <b>Stars:</b> no conflict alerts and quick answers.',
    scenario: sc('position-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 24, { callNow: true }), A(120, 'ETH3721', 'B77L', 'LNO6X', 26), A(260, 'AZG7321', 'B748', 'CIV7X', 30), D(200, 'CHG7302', 'B748', 'LNO9S')], { seed: 23, coordination: true, earlyTransferRate: 1 }),
    watch: (sim, m) => {
      m.wait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.wait[r.cs] = Math.max(m.wait[r.cs] ?? 0, sim.t - r.t);
      for (const r of sim.coordReqs) if (r.state === 'pending') m.wait['BRU ' + r.cs] = Math.max(m.wait['BRU ' + r.cs] ?? 0, sim.t - r.t);
    },
    status: (sim) => `${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 3 arrivals done · ${sim.departuresHandled} of 1 departure with Brussels`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'coord_unanswered', 'release_delay'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.wait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `${slow[0]} waited ${Math.round(slow[1])} s for an answer. Answer the intercom within a minute.` };
      const arrDone = ['QTR8125', 'ETH3721', 'AZG7321'].every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred');
      if (!arrDone || sim.departuresHandled < 1) return undefined;
      const quick = Object.values((m.wait ?? {}) as Record<string, number>).every((w) => w <= 20);
      const stca = sim.events.some((e) => e.kind === 'stca');
      return { pass: true, stars: !stca && quick ? 3 : !stca || quick ? 2 : 1, why: `Everyone handled${stca ? ', with a conflict alert on the way' : ' with no conflict alerts'}.` };
    },
  },
};

export const LESSONS: Lesson[] = [L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11];

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

// =====================================================================================
// EXAM RUNNER (shared by the coach and the tests)
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
// THE COACH
// =====================================================================================
const stars = (n: number) => `<span class="stars" aria-label="${n} of 3 stars">${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i></span>`;

export function coachFor(lesson: Lesson, nav: { next?: () => void; exit: () => void; restart: () => void }) {
  return (g: Game) => {
    const host = g.root.querySelector<HTMLElement>('.scope-wrap')!;
    const card = document.createElement('section');
    card.className = 'coach';
    card.setAttribute('aria-live', 'polite');
    host.appendChild(card);
    host.classList.add('coached');
    const canvas = g.scope.canvas;
    const savedHints = g.coachHints;

    type Phase = 'steps' | 'intro' | 'exam' | 'result';
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
    const ex = lesson.exam;
    const total = lesson.steps.length + (ex ? 1 : 0);
    const phone = () => window.innerWidth < 600;
    const seenBefore = tutorialDone().has(lesson.id);
    const cur = () => lesson.steps[i];

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

    // ---------- send guard: steps about one aircraft stop transmissions to the others
    g.onBeforeSend = (cl: Clearance) => {
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
    const go = (n: number) => {
      skipping = false;
      i = n; answered = undefined; targetSeen = false;
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
    const startExam = () => {
      if (!ex) return;
      verdict = undefined; qIdx = 0;
      if (ex.scenario) g.loadScenario(ex.scenario);
      g.coachHints = false;
      const sim = g.sim;
      mem = examMem(sim);
      const m = mem;
      if (ex.scenario) {
        const step0 = sim.step.bind(sim);
        sim.step = (dt?: number) => {
          step0(dt);
          if (verdict || phase !== 'exam') return;
          ex.watch?.(sim, m);
          const v = examVerdict(ex, sim, m);
          if (v) finishExam(v);
        };
      }
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
    const lineFor = (title: string, n: string, extra = '') => `<div class="coach-line"><span class="cl-n">${n}</span><button class="cl-t" data-c="min">${title}</button>${extra}<button data-c="min" aria-label="Expand">▴</button></div>`;
    const render = () => {
      card.dataset.phase = phase;
      card.dataset.step = phase === 'steps' ? cur()?.id ?? '' : '';
      card.classList.toggle('collapsed', collapsed);
      card.classList.toggle('exam', phase === 'exam' || phase === 'intro' || (phase === 'result' && !!verdict));
      const head = (label: string, step: string, prog: number) => `<header><span class="coach-lesson">${label}</span><span class="coach-step">${step}</span><button class="coach-min" data-c="min" aria-label="${collapsed ? 'Expand' : 'Minimise'}">▾</button></header><div class="coach-bar"><i style="width:${prog * 100}%"></i></div>`;
      const n = LESSONS.indexOf(lesson) + 1;
      if (phase === 'steps') {
        const st = cur();
        const last = i === lesson.steps.length - 1;
        const waiting = (!!st.done || (!!st.ask && !answered?.ok)) && !(st.done && st.done(g, ctx));
        const canSkipAhead = (st.run ?? 0) > 0 && !!(st.until ?? st.done);
        const toExam = i === 0 && seenBefore && ex ? '<button data-c="toExam">Go to the exam</button>' : '';
        const ff = canSkipAhead ? `<button data-c="ff" class="ff">${skipping ? 'Skipping…' : '⏩ Skip ahead'}</button>` : '';
        card.innerHTML = `${lineFor(st.title, `${i + 1}/${total}`, canSkipAhead ? `<button data-c="ff" class="ff" aria-label="Skip ahead">⏩</button>` : '')}
          ${head(`${n} · ${lesson.title}`, `${i + 1} / ${total}`, (i + 1) / total)}
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
          ${head(`${n} · ${lesson.title} · exam`, `${total} / ${total}`, 1)}
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
      } else if (phase === 'result') {
        const nextBtn = nav.next ? '<button data-c="nextLesson" class="go">Next lesson</button>' : '<button data-c="exit" class="go">Finish</button>';
        if (verdict && ex) {
          card.innerHTML = `${head(`${n} · ${lesson.title} · exam`, '', 1)}
            <div class="coach-verdict ${verdict.pass ? 'pass' : 'retry'}">${verdict.pass ? 'PASS' : 'RETRY'} ${verdict.pass ? stars(verdict.stars) : ''}</div>
            <p>${verdict.why}</p>
            <footer><button data-c="exit">Lessons</button><span class="grow"></span><button data-c="retryExam" class="${verdict.pass ? '' : 'go'}">Retry exam</button>${verdict.pass ? nextBtn : ''}</footer>`;
        } else {
          card.innerHTML = `${head(`${n} · ${lesson.title}`, '', 1)}<h4>Lesson complete</h4><p>${ex ? 'You skipped the exam. You can take it any time from the lesson list.' : ''}</p><footer><button data-c="exit">Lessons</button><span class="grow"></span>${nextBtn}</footer>`;
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
        if (st.cs && !st.noAutoSelect && !targetSeen && g.sim.find(st.cs) && (isCalling(g.sim, st.cs) || !g.cs)) { targetSeen = true; if (g.cs !== st.cs) g.select(st.cs, true); }
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
      } else if (hl) { hl.classList.remove('coach-hl'); hl = null; }
      // a picker or the glossary sheet is open: on a phone it shares the bottom of the screen, so the coach steps up to one line at the top
      const pk = phone() && !!pickerKind(g);
      if (pk !== card.classList.contains('pk-open')) {
        card.classList.toggle('pk-open', pk);
        if (pk && !collapsed) { collapsed = true; pkCollapsed = true; render(); }
        else if (!pk && pkCollapsed) { collapsed = false; pkCollapsed = false; render(); }
      }
      syncReserved();
    }, 300);
    const onResize = () => { render(); requestAnimationFrame(syncReserved); };
    window.addEventListener('resize', onResize);

    go(0);
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
