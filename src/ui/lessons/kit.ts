// The lesson-authoring kit: the types a lesson is made of and the helpers the lesson files use to write
// steps, exams and solutions. The coach that runs a lesson lives in src/ui/tutorial.ts; the lessons
// themselves, with their airport geometry, in src/ui/lessons/eblg.ts and src/ui/lessons/eddl.ts.
import type { Game } from '../game';
import type { Sim } from '../../engine/sim';
import type { Aircraft, Comp, Scenario, SpawnSpec } from '../../engine/types';
import type { Clearance, Item } from '../../engine/clearance';
import { alongTrack, crossTrack, norm360 } from '../../geo';
import { GLOSSARY } from '../glossary';

// ---------------------------------------------------------------- types
export type ElFn = (g: Game) => Element | null | undefined;
export type ElRef = string | ElFn;
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
/** A once-per-key latch for exam solutions: `once('k', cond)` is true the first time cond is. */
export type Once = (key: string, cond: boolean) => boolean;
/** Issue a clearance from a solution, with the reason the instructor would give out loud. */
export type Say = (cs: string, items: Item[], why?: string) => void;
/** The instructor's scripted run of an exam: called after every sim second. */
export type Solution = (sim: Sim, once: Once, say: Say) => void;
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
  /** the instructor's run for the mistake replay; without one the engine's scripted controllers are tried */
  solution?: Solution;
}
export type Stage = 'basics' | 'procedures' | 'judgement';
export interface Lesson {
  id: string;
  /** the airport this lesson is written for */
  icao: string;
  stage: Stage;
  title: string;
  summary: string;
  minutes: number;
  /** the ICAO controller competencies this lesson trains (the drill of the day reads them) */
  comps: Comp[];
  scenario: Scenario;
  steps: Step[];
  exam?: Exam;
}
export const STAGES: { id: Stage; title: string; blurb: string }[] = [
  { id: 'basics', title: 'Basics', blurb: 'The picture and the console: what to look at first, and how to get a clearance out in the time you have.' },
  { id: 'procedures', title: 'Procedures', blurb: 'The book of the unit: arrivals, transitions, holds, departures, the centre and the runway change.' },
  { id: 'judgement', title: 'Judgement', blurb: 'The on-the-job stage: sequencing, vectoring, conflicts, emergencies, and a long mixed session.' },
];

// ---------------------------------------------------------------- scenario helpers
export interface ScDefaults { icao: string; metar: string; runway: string; startUtc: string }
/** A scenario factory for one airport: `sc('id', spawns, extra)`. */
export const scFactory = (d: ScDefaults) => (id: string, spawns: SpawnSpec[], extra: Partial<Scenario> = {}): Scenario => ({
  id: `tut-${d.icao === 'EBLG' ? '' : d.icao.toLowerCase() + '-'}${id}`, title: 'Tutorial', desc: '', seed: 4242, durationMin: 60, startUtc: d.startUtc, metar: d.metar, runway: d.runway, spawns, events: [], readbackErr: 0,
  noSayAgain: true, tutorial: true, icao: d.icao, ...extra,
});
export const A = (t: number, cs: string, type: string, star: string, spawnDist: number, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t, kind: 'arr', cs, type, star, spawnDist, ...x });
export const D = (t: number, cs: string, type: string, sid: string): SpawnSpec => ({ t, kind: 'dep', cs, type, sid });

// ---------------------------------------------------------------- condition helpers
export const find = (g: { sim: Sim }, cs: string) => g.sim.find(cs);
export const isCalling = (sim: Sim, cs: string) => { const a = sim.find(cs); return !!a && a.awaitingSince !== undefined && sim.t >= a.awaitingSince; };
export const calling = (g: Game, cs: string) => isCalling(g.sim, cs);
export const sentTo = (g: Game, x: StepCtx, cs: string, pred: (it: Item) => boolean = () => true) =>
  g.sim.cmdLog.slice(x.cmdStart).some((c) => c.cl.cs === cs && c.cl.items.some(pred));
export const sentAny = (sim: Sim, from: number, cs: string, pred: (it: Item) => boolean = () => true) =>
  sim.cmdLog.slice(from).some((c) => c.cl.cs === cs && c.cl.items.some(pred));
export const staged = (g: Game, cs: string, pred: (it: Item) => boolean) => g.cs === cs && g.items.some(pred);
export const heardFrom = (g: Game, x: StepCtx, cs: string, re?: RegExp) => g.sim.log.slice(x.logStart).some((t) => t.from === 'PILOT' && t.cs === cs && !t.text.startsWith(g.sim.appCallsign.split(' ')[0]) && (!re || re.test(t.text)));
export const heardAny = (g: Game, x: StepCtx, cs: string, re: RegExp) => g.sim.log.slice(x.logStart).some((t) => t.from === 'PILOT' && t.cs === cs && re.test(t.text));
export const pickerKind = (g: Game) => { const p = g.els?.picker; return p && !p.hidden ? p.dataset.kind : undefined; };
export const magHdg = (sim: Sim, a?: Aircraft) => (a?.hdgSys === undefined ? undefined : norm360(a.hdgSys - sim.pack.meta.magVar));
export const inRange = (v: number | undefined, lo: number, hi: number) => v !== undefined && v >= lo && v <= hi;
export const isLvl = (pred: (ft: number) => boolean, sim: Sim) => (it: Item) => it.k === 'lvl' && pred(sim.ftOf(it.lvl));
export const isHdg = (lo: number, hi: number) => (it: Item) => it.k === 'hdg' && inRange(it.hdg, lo, hi);
export const offCl = (sim: Sim, a: Aircraft) => crossTrack(a.p, sim.rwy.thr, sim.rwy.crs);
export const alongFinal = (sim: Sim, a: Aircraft) => alongTrack(a.p, sim.rwy.thr, norm360(sim.rwy.crs + 180));
export const gone = (sim: Sim, cs: string) => !sim.find(cs) || sim.find(cs)!.state === 'transferred';
export const landed = (sim: Sim, cs: string) => sim.landings.some((l) => l.cs === cs);
export const pastFix = (a: Aircraft | undefined, fix: string) => !!a && !a.route.some((l) => l.fix === fix);
export const fmtLvl = (sim: Sim, ft: number) => { const l = sim.levelFor(Math.round(ft / 100) * 100); return l.fl !== undefined ? `FL${String(l.fl).padStart(3, '0')}` : `${l.ft!.toLocaleString('en-US')} ft`; };
export const costly = (sim: Sim, from = 0) => sim.events.filter((e) => e.t >= from && e.cost > 0);
export const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
/** the aircraft is established and still yours: the Tower handoff is due */
export const dueTower = (sim: Sim, cs: string) => { const a = sim.find(cs); return !!a && a.state === 'assumed' && !!a.app?.locCap && !sim.readbackPending(cs); };
/** For a step that runs until one of several aircraft needs the student: ring the first that is calling or due to Tower. */
export const markDue = (list: string[], also?: (g: Game, cs: string) => boolean) => (g: Game) => {
  const cs = list.find((c) => { const a = g.sim.find(c); return !!a && a.state === 'assumed' && !g.sim.readbackPending(c) && (a.awaitingSince !== undefined || dueTower(g.sim, c) || !!also?.(g, c)); });
  return cs ? { cs } : undefined;
};
/** a clearance matches these items by kind */
export const sameItems = (a: Item[], b: Item[]) => a.length === b.length && a.every((x) => b.some((y) => JSON.stringify(x) === JSON.stringify(y)));

// ---------------------------------------------------------------- text helpers
/** A glossary word: tap it for the meaning. Only GLOSSARY keys are allowed (tests check). */
export const G = (term: keyof typeof GLOSSARY & string, text: string = term) => `<button class="gl" data-gloss="${term}">${text}</button>`;
/** a control or value as it appears on screen */
export const K = (s: string) => `<b class="k">${s}</b>`;
/** the instructor's aside: the reason behind the number */
export const WHY = (s: string) => `<span class="why"><b>Why:</b> ${s}</span>`;
// pack-aware names (the same lesson reads "Brussels" at Liège and "Langen" at Düsseldorf)
export const acc = (g: { sim: Sim }) => g.sim.acc.say;
export const accLong = (g: { sim: Sim }) => g.sim.acc.callsign;
export const twr = (g: { sim: Sim }) => g.sim.twr.say;
export const app = (g: { sim: Sim }) => g.sim.appCallsign;
export const freq = (g: { sim: Sim }) => g.sim.pack.meta.appFreq;
export const stack = (g: { sim: Sim }) => g.sim.stackFix;
export const rwy = (g: { sim: Sim }) => g.sim.runway;
export const depRwy = (g: { sim: Sim }) => g.sim.depRunway;
export const tlText = (g: { sim: Sim }) => `FL${String(g.sim.tl).padStart(3, '0')}`;
export const city = (g: { sim: Sim }) => g.sim.pack.meta.name;

// ---------------------------------------------------------------- element helpers
export const q = (sel: string): ElFn => (g) => g.root.querySelector(sel);
/** the suggestion chip whose label starts with this text */
export const sg = (prefix: string): ElFn => (g) => [...g.root.querySelectorAll<HTMLElement>('.sg')].find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(prefix));
/** the attention row for an aircraft, or its action button */
export const att = (cs: string, go = false): ElFn => (g) => g.root.querySelector(`.att-row[data-cs="${cs}"] ${go ? '.att-go' : '.att-sel'}`) ?? g.root.querySelector(`.att-row[data-cs="${cs}"]`);
/** a halo rung */
export const halo = (kind: string, v?: string): ElFn => (g) => g.root.querySelector(`.halo [data-halo="${kind}"]${v ? `[data-v="${v}"]` : ''}`);
/** a picker flow: highlight the button that opens the picker, then the choice, then TRANSMIT */
export const flow = (...parts: { k: Item['k'][]; btn: string; picker: string; pick: string }[]): ElFn => (g) => {
  const open = pickerKind(g);
  for (const p of parts) {
    if (g.items.some((i) => p.k.includes(i.k))) continue;
    if (open === p.picker) return g.root.querySelector(`.picker [data-pick="${p.pick}"]`);
    return g.root.querySelector(p.btn);
  }
  return g.root.querySelector('[data-a="send"]');
};
export const LVL = (pick: string) => ({ k: ['lvl'] as Item['k'][], btn: '[data-p="lvl"]', picker: 'lvl', pick });
export const SPD = (pick: string) => ({ k: ['spd', 'spdmin'] as Item['k'][], btn: '[data-p="spd"]', picker: 'spd', pick });
export const MORE = (k: Item['k'], pick: string) => ({ k: [k], btn: '[data-p="more"]', picker: 'more', pick });

// ---------------------------------------------------------------- shared exam pieces
/** Arrivals established on the localizer: 160 kt and Tower, as the "160 to 4 · Tower" chip does. */
export const towerWhenEstablished = (sim: Sim, once: Once, say: Say) => {
  for (const a of sim.aircraft) if (a.kind === 'arr' && a.state === 'assumed' && a.app?.locCap && !a.app.tooHigh && sim.dthr(a) < 12 && once('twr' + a.cs + a.goArounds, true)) say(a.cs, [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: sim.twr.id }], 'Established: slow it to 160 kt for a stable approach and hand it to Tower in one call.');
};
/** The judge every scenario exam shares for its first line: a costly event fails the exam with the event's text. */
export const firstBad = (sim: Sim, kinds: string[]) => sim.events.find((e) => kinds.includes(e.kind));
export const ILS_OF = (sim: Sim): Item => ({ k: 'app', app: 'ILS', rwy: sim.runway });
export const isClearance = (c: { cl: Clearance }) => c.cl.items.length > 0;
