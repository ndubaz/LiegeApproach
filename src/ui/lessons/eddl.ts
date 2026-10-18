// The Düsseldorf curriculum: ten lessons on the Langen Radar pickup position. The basics reuse the
// mechanics the Liège course teaches (NEXT, the halo, chips, pickers) on Düsseldorf traffic; the procedures
// and judgement lessons are Düsseldorf's own: the entry fixes and their RNAV transitions, holds at the
// entry fixes and on the downwind, the 5,000 ft transition altitude, departures to Langen, parallel
// runways, runway 05, and the 06:00 rush when the night curfew ends. Facts: src/pack/eddl.ts and
// docs/REALISM-EDDL.md.
import type { Game } from '../game';
import type { Sim } from '../../engine/sim';
import type { Item } from '../../engine/clearance';
import { assess, GRADE_NAMES } from '../../engine/assess';
import { autoControl } from '../../engine/autopilot';
import { suggest } from '../../engine/suggest';
import { alongTrack, dist } from '../../geo';
import {
  A, D, G, K, WHY, LVL, flow, sg, halo, scFactory, type Lesson,
  find, isCalling, calling, sentTo, sentAny, staged, heardFrom, isLvl, gone, landed, fmtLvl, mmss, towerWhenEstablished, acc, dueTower, markDue, tlText, offCl,
} from './kit';

// Winter, a westerly: 23 in use. The parallel lessons land on 23R and depart on 23L (AD 2.22).
const sc = scFactory({ icao: 'EDDL', metar: 'EDDL 121250Z 24008KT 9999 FEW040 12/06 Q1018 NOSIG', runway: '23L', startUtc: '13:00' });
const ILS = (rwy: string): Item => ({ k: 'app', app: 'ILS', rwy });
const TRANS = (name: string, rwy: string, ft = 3000): Item[] => [{ k: 'trans', name }, { k: 'lvl', lvl: { ft } }, ILS(rwy)];
const callingClear = (sim: Sim, cs: string) => isCalling(sim, cs) && !sim.readbackPending(cs);
const leadOf = (sim: Sim, cs: string) => { const a = sim.find(cs); const s = a && suggest(sim, a)[0]; return s?.primary ? s : undefined; };
/** Parallel operations: the northern runway lands, the southern departs (the pack's parallelOps, set here until the engine reads it). */
const parallel = (g: { sim: Sim }) => { if (g.sim.runway === '23R') g.sim.depRunway = '23L'; if (g.sim.runway === '05L') g.sim.depRunway = '05R'; };
const haloOn = (g: Game) => { g.halo.enabled = true; };
const tlIndex = (opts: number[]) => (g: { sim: Sim }) => Math.max(0, opts.indexOf(g.sim.tl));

// =====================================================================================
// BASICS
// =====================================================================================

// ---- 1. The Düsseldorf picture
const L_PICTURE: Lesson = {
  id: 'eddl-picture', icao: 'EDDL', stage: 'basics', title: 'The Düsseldorf picture', minutes: 6, comps: ['SITU', 'SPP'],
  summary: 'Langen Radar 128.555: four entry fixes, two parallel runways, the 5,000 ft transition altitude and the hills to the east.',
  scenario: sc('picture', [A(1, 'EWG1AB', 'A320', 'BIKMU1A', 22), A(1, 'DLH4KT', 'A321', 'DOMUX1A', 26)]),
  steps: [
    {
      id: 'intro', title: 'You are Langen Radar',
      body: (g) => `This is the Düsseldorf arrival sector of Langen Radar, the pickup position on ${K('128.555')}. Langen ACC hands you arrivals at four entry fixes, you work them down the published RNAV transitions or on vectors to the final, and Düsseldorf Tower (${g.sim.twr.freq}) hands you departures passing 2,000 ft. The clock is stopped: look around.`,
      onEnter: (g) => { for (let k = 0; k < 3; k++) g.sim.step(); g.scope.fit(); haloOn(g); },
    },
    {
      id: 'bikmu', title: 'Tap BIKMU',
      body: `The entry fixes are the corners of your picture: ${K('BIKMU')} south-west, ${K('DOMUX')} east, ${K('HALME')} north-east, ${K('PISAP')} north, and ${K('LMA')} west for the odd one. BIKMU is the busiest: everything from the south and west, and the Köln side. Find it and tap it. ${WHY('where the stack forms is where your eye goes first: a holding pattern at BIKMU is the first sign the sequence is full.')}`,
      mark: { fix: 'BIKMU', text: 'BIKMU' }, focus: { fix: 'BIKMU', scale: 10 }, compact: true,
      done: (g, x) => !!x.tap && dist(g.scope.toW(x.tap.x, x.tap.y), g.sim.pack.fixes.get('BIKMU')!.p) < 3,
    },
    {
      id: 'transitions', title: 'One transition per entry fix and direction',
      body: `From each entry fix a coded ${G('Transition', 'transition')} runs to the final: ${K('BIKMU23')} to REGNO on 23R, ${K('DOMUX23')} to METMA on 23L, and the 05 versions (${K('BIKMU05')} to DIKMI, ${K('DOMUX05')} to NATOS) when the wind turns round. An arrival over DOMUX today, runway 23L: which transition?`,
      ask: { options: ['DOMUX23', 'DOMUX05', 'BIKMU23'], correct: 0, why: 'The entry fix names the transition and the runway direction picks the version. The AIP binds each to a runway for lost communication only; in the room both runways are used from any fix, and the sim keeps the published pairing.' },
    },
    {
      id: 'final', title: 'Two runways, one final today',
      body: `The dashed line is the final for 23L, the southern runway: in single-runway operation everything lands and departs there. ${K('METMA')}, 8.8 NM out, is the final approach fix at 3,000 ft. The northern runway 23R may be used 56 hours a week; then it lands and 23L departs. ${WHY('two parallel finals 0.3 NM apart are dependent: 2.5 NM between alternating approaches inside 10 NM, when no wake minimum is larger.')}`,
      mark: { fix: 'METMA', text: 'METMA · 3,000 ft' }, focus: { fix: 'METMA', scale: 14 },
    },
    {
      id: 'mva', title: 'Tap the 3,200 ft area (the Bergisches Land)',
      body: (g) => `The ${G('MVA')} overlay: 2,200 ft over the flat Rhine land round the field, 3,200 ft and 3,800 ft over the hills east of the Rhine (Wuppertal, Remscheid), 4,500 ft over the Sauerland. Tap anywhere in the 3,200 ft area.${(g as any)._tutNote ? ` <i>${(g as any)._tutNote}</i>` : ''}`,
      compact: true,
      onEnter: (g) => { g.settings.showMva = true; g.scope.focus({ x: 14, y: -4 }, Math.min(g.scope.scale, 7)); },
      done: (g, x) => {
        if (!x.tap) return false;
        if (x.tap.t !== (x as any)._seenTap) {
          (x as any)._seenTap = x.tap.t;
          const mva = g.sim.mvaAt(g.scope.toW(x.tap.x, x.tap.y));
          (x as any)._ok = mva >= 3200 && mva < 3800;
          (g as any)._tutNote = (x as any)._ok ? '' : `That spot is ${mva.toLocaleString('en-US')} ft. The 3,200 ft area is east of the city, south of the Ruhr.`;
        }
        return !!(x as any)._ok;
      },
    },
    {
      id: 'ta', title: 'Transition altitude 5,000 ft',
      body: (g) => `Germany uses a transition altitude of ${K('5,000 ft')}, higher than Belgium's. The transition level follows the QNH: ${K('FL060')} at 1013 hPa and above, FL070 from 977 to 1012, FL080 below. Today the QNH is ${g.sim.qnh}, so the transition level is ${K(tlText(g))}. Which is the lowest flight level you may use today?`,
      onEnter: (g) => { g.settings.showMva = false; (g as any)._tutNote = ''; },
      ask: { options: ['FL050', 'FL060', 'FL070'], correct: tlIndex([50, 60, 70]), why: 'Between the transition altitude and the transition level you say altitudes on the way down and flight levels on the way up. Below 5,000 ft it is always feet.' },
    },
    {
      id: 'select', title: 'Tap EWG1AB to select it',
      body: `A Eurowings A320 from the south-west, over BIKMU. Tap its symbol or its label; the halo opens round it and the bar shows what you could say.`,
      cs: 'EWG1AB', noAutoSelect: true, compact: true, mark: { cs: 'EWG1AB', text: 'tap' },
      done: (g) => g.cs === 'EWG1AB',
    },
  ],
  exam: {
    title: 'Read the scope', run: 0,
    brief: 'Four questions about the traffic on your scope right now. Look, zoom and tap as much as you like before you answer.',
    rule: '<b>Pass:</b> 3 of 4 right. All 4 right earns three stars.',
    quiz: [
      { q: 'Which aircraft is higher right now?', options: ['EWG1AB', 'DLH4KT'], answer: (s) => ((s.find('EWG1AB')?.alt ?? 0) >= (s.find('DLH4KT')?.alt ?? 0) ? 0 : 1) },
      { q: 'About how far is DLH4KT from the airport?', options: ['About 20 NM', 'About 30 NM', 'About 40 NM'], answer: (s) => { const a = s.find('DLH4KT'); const d = a ? Math.hypot(a.p.x, a.p.y) : 30; return d < 25 ? 0 : d < 35 ? 1 : 2; } },
      { q: 'What is the minimum vectoring altitude where DLH4KT is now?', options: ['2,200 ft', '2,500 ft', '3,200 ft or more'], answer: (s) => { const a = s.find('DLH4KT'); const m = a ? s.mvaAt(a.p) : 2500; return m <= 2200 ? 0 : m <= 2500 ? 1 : 2; } },
      { q: 'Which frequency do departures call you on, passing 2,000 ft?', options: ['128.555', '121.355', '118.305'], answer: () => 1 },
    ],
    judge: (_s, m) => {
      if (m.answers.length < 4) return undefined;
      const right = m.right as number;
      return right >= 3 ? { pass: true, stars: right === 4 ? 3 : 2, why: `${right} of 4 right.` } : { pass: false, stars: 0, why: `${right} of 4 right. Zoom in and look at the labels and the MVA overlay before you answer.` };
    },
  },
};

// ---- 2. First contact at Langen
const L_CONTACT: Lesson = {
  id: 'eddl-contact', icao: 'EDDL', stage: 'basics', title: 'First contact at Langen', minutes: 6, comps: ['COMM', 'WORK'],
  summary: 'Three arrivals from three entry fixes. NEXT, the halo, the row action and the readback card, on Düsseldorf traffic.',
  scenario: sc('contact', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 24), A(40, 'CFG2PL', 'B752', 'PISAP1A', 24), A(90, 'THY5MK', 'A332', 'HALME1A', 26)], { runway: '23R' }),
  steps: [
    {
      id: 'wait', title: 'Traffic from BIKMU', run: 2,
      body: `Runway 23R lands today, 23L departs: parallel operations. Langen ACC has handed you EWG1AB at FL100 over BIKMU; its label flashes until the pilot calls you on 128.555.`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      focus: { cs: 'EWG1AB' }, mark: { cs: 'EWG1AB' }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'select', title: 'Tap NEXT',
      body: `${K('NEXT')} selects the pilot who has waited longest, and the halo opens round the aircraft.`,
      el: '[data-e="callers"]', cs: 'EWG1AB', noAutoSelect: true, done: (g) => g.cs === 'EWG1AB',
    },
    {
      id: 'rung', title: 'Tap FL080 on the level ladder',
      body: `One tap sends. ${WHY('the BIKMU23 transition runs up the east side of the field and back down to REGNO, nearly 60 track miles. From FL100 it needs 7 × 3 plus 4 to slow down: 25 NM. It has miles in hand, so one step down now keeps it moving, and the transition with the next call tells the pilot where the rest of the descent goes.')}`,
      cs: 'EWG1AB', compact: true, el: halo('lvl', 'F080'),
      done: (g, x) => sentTo(g, x, 'EWG1AB', isLvl((ft) => ft < 10000, g.sim)),
    },
    {
      id: 'readback', title: 'Listen to the readback', run: 1,
      body: `The grey card under the bar holds what you said and turns green when the ${G('Readback')} matches. No QNH yet: that comes with the first altitude, below the transition level.`,
      cs: 'EWG1AB', done: (g, x) => heardFrom(g, x, 'EWG1AB') && !g.sim.readbackPending('EWG1AB'),
    },
    {
      id: 'cfg', title: 'CFG2PL from the north: NEXT, then its row action', run: 2,
      body: `A Condor 757 over PISAP at FL140. ${K('NEXT')}, then tap the action on its row (or the bright chip).`,
      cs: 'CFG2PL', noAutoSelect: true, mark: { cs: 'CFG2PL' },
      el: (g) => (g.cs === 'CFG2PL' ? g.root.querySelector('.att-row[data-cs="CFG2PL"] .att-go') ?? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'CFG2PL'),
    },
    {
      id: 'thy', title: 'THY5MK from HALME: any descent', run: 2,
      body: `A Turkish A330, a heavy, over HALME at FL120. Answer it with a level from the ladder, a chip or ${K('LVL')}.`,
      cs: 'THY5MK', noAutoSelect: true, mark: { cs: 'THY5MK' },
      el: (g) => (g.cs === 'THY5MK' ? g.root.querySelector('.halo [data-halo="lvl"]:not(.cleared)') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'THY5MK', (it) => it.k === 'lvl'),
    },
    {
      id: 'levels', title: 'Feet or flight level?',
      body: (g) => `The transition altitude is 5,000 ft and today's transition level ${tlText(g)}. You want THY5MK at 4,000 ft on the downwind. What do you say?`,
      ask: { options: ['Descend FL040', 'Descend to altitude 4,000 ft, QNH 1018', 'Descend 4,000 ft, standard'], correct: 1, why: 'Below the transition level, altitudes on the QNH; the first altitude carries the QNH so the pilot sets it. Flight levels below the transition level do not exist.' },
    },
  ],
  exam: {
    title: 'Three on frequency', run: 1, limitS: 240,
    brief: 'Three arrivals will call within half a minute, from three entry fixes. Answer each one with a descent below the level it reports.',
    rule: '<b>Pass:</b> every call answered with a descent, nobody left waiting 20 s. <b>Stars:</b> answer each within 8 s.',
    scenario: sc('contact-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 22, { callNow: true }), A(10, 'CFG2PL', 'B752', 'PISAP1A', 24), A(18, 'THY5MK', 'A332', 'HALME1A', 26)], { seed: 77, runway: '23R' }),
    watch: (sim, m) => {
      m.waits ??= {} as Record<string, number>;
      for (const a of sim.aircraft) if (isCalling(sim, a.cs)) m.waits[a.cs] = Math.max(m.waits[a.cs] ?? 0, sim.t - a.awaitingSince!);
    },
    status: (sim) => { const w = sim.callers().filter((a) => sim.t >= (a.awaitingSince ?? 0)); return w.length ? `${w.length} waiting: ${w.map((a) => `${a.cs} ${Math.round(sim.t - a.awaitingSince!)} s`).join(', ')}` : 'Nobody waiting'; },
    judge: (sim, m) => {
      const css = ['EWG1AB', 'CFG2PL', 'THY5MK'];
      const late = Object.entries((m.waits ?? {}) as Record<string, number>).find(([, w]) => w > 20);
      if (late || sim.events.some((e) => e.kind === 'unanswered')) return { pass: false, stars: 0, why: `${late?.[0] ?? 'A pilot'} waited more than 20 s. Use NEXT to jump to the next caller.` };
      if (sim.events.some((e) => e.kind === 'warning_sent')) return { pass: false, stars: 0, why: 'You transmitted a clearance with a warning showing. Read the amber text before you send.' };
      const done = css.every((cs) => { const a = sim.find(cs); return !!a && a.cflSys !== undefined && sim.ftOf(a.cflSys) < a.alt - 600 && sentAny(sim, 0, cs) && !isCalling(sim, cs) && !sim.readbackPending(cs); });
      if (!done) return undefined;
      const worst = Math.max(...css.map((cs) => (m.waits?.[cs] ?? 0)));
      return { pass: true, stars: worst <= 8 ? 3 : worst <= 14 ? 2 : 1, why: `All three answered; the longest wait was ${Math.round(worst)} s.` };
    },
    solution: (sim, once, say) => {
      for (const cs of ['EWG1AB', 'CFG2PL', 'THY5MK']) if (callingClear(sim, cs) && sim.t - sim.find(cs)!.awaitingSince! >= 3 && once(cs, true)) { const a = sim.find(cs)!; const s = suggest(sim, a).find((x) => x.label.startsWith('Descend')); say(cs, s?.items ?? [{ k: 'lvl', lvl: sim.levelFor(Math.round((sim.ftOf(a.cflSys ?? a.cleared) - 2000) / 1000) * 1000) }], 'Oldest caller first, with its next level down.'); }
    },
  },
};

// =====================================================================================
// PROCEDURES
// =====================================================================================

// ---- 3. The RNAV transitions
const L_TRANSITIONS: Lesson = {
  id: 'eddl-transitions', icao: 'EDDL', stage: 'procedures', title: 'The RNAV transitions', minutes: 7, comps: ['SPP', 'TRAF'],
  summary: 'BIKMU23: entry fix, downwind points, 220 kt, 3,000 ft at REGNO. The transition at FL060 first, the descent to 3,000 ft later.',
  scenario: sc('transitions', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 18)], { runway: '23R' }),
  steps: [
    {
      id: 'wait', title: 'EWG1AB over BIKMU at FL100', run: 2,
      body: `The published ${G('Transition', 'transition')} ${K('BIKMU23')} runs BIKMU, DL426, DL429, DL430, REGNO: up the east side of the field, a right-hand downwind and a base onto the 23R final: nearly 60 track miles from BIKMU. 220 kt from DL426, 3,000 ft or above at REGNO, the ${G('FAF')} 8.8 NM out.`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      focus: { fix: 'DL429', scale: 7 }, mark: { cs: 'EWG1AB' }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'lead', title: 'Tap the lead chip: BIKMU23 · FL060 · ILS 23R',
      body: `Transition, ${K('FL060')} and the ILS in one call. ${WHY('the downwind runs over the departure routes, and departures stop at 5,000 ft, the top of every SID; at FL060 your arrival stays 1,000 ft above them. The pilot flies the published route and speeds, so the route and the approach are one clearance and one readback.')}`,
      cs: 'EWG1AB', el: '.sg.lead',
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'trans') && sentTo(g, x, 'EWG1AB', (it) => it.k === 'app'),
    },
    {
      id: 'speed', title: 'Do you need to say 220 kt?',
      body: `The chart says 220 kt from DL426. The pilot is at 280 kt. Do you need to assign the speed?`,
      ask: { options: ['Yes: assign 220 kt now', 'No: the published speed is part of the transition'], correct: 1, why: 'A published speed restriction stays with the procedure; the pilot flies it without being told. You assign a speed only when you want something different, and a plain speed clearance cancels the published one from then on.' },
    },
    {
      id: 'down', title: 'On the base: Descend 3000', run: 4, cs: 'EWG1AB', el: sg('Descend 3000'),
      body: `When the ${K('Descend 3000')} chip turns bright, tap it. ${WHY('about 3 NM for every 1,000 ft: from FL060 it needs some 9 NM to get down to 3,000 ft by REGNO, so the descent comes on the base, once the aircraft has crossed the departure routes. Too late and it reaches the localizer above the glidepath and goes around.')}`,
      done: (g) => { const a = find(g, 'EWG1AB'); return !a || !!a.app?.locCap || (a.cleared.ft !== undefined && a.cleared.ft <= 3000); },
    },
    {
      id: 'watch', title: 'Watch it fly the downwind', run: 4, cs: 'EWG1AB',
      body: (g) => { const a = find(g, 'EWG1AB'); return `${a ? `Now ${fmtLvl(g.sim, a.alt)}, ${Math.round(a.ias)} kt, next ${a.route[0]?.fix ?? 'the final'}. ` : ''}Line 4 of the label reads ${K('LOC23R')} when it captures the localizer at REGNO. Skip ahead if you like.`; },
      done: (g) => !!find(g, 'EWG1AB')?.app?.locCap, until: (g) => !!find(g, 'EWG1AB')?.app?.locCap,
    },
    {
      id: 'twr', title: 'Established: 160 to 4 · Tower', run: 1, cs: 'EWG1AB', el: sg('160'),
      body: `Slow it to 160 kt until 4 NM and hand it to Düsseldorf Tower, 118.305, in one call. ${WHY('at 220 kt it would arrive at 4 NM too fast to be stable; 160 kt to 4 NM is what the Tower expects on a dependent parallel final.')}`,
      done: (g) => gone(g.sim, 'EWG1AB') || landed(g.sim, 'EWG1AB'),
    },
    {
      id: 'wrap', title: 'One fix, one transition, one call',
      body: `Every entry fix has a transition to each runway direction: clear it with FL060 and the ILS, then the descent to 3,000 ft on the base, and the aircraft flies itself to the final. The exam adds a second arrival from HALME.`,
    },
  ],
  exam: {
    title: 'BIKMU and HALME', run: 2, limitS: 2100,
    brief: 'EWG1AB from BIKMU and RYR8CD from HALME, both for 23R. Clear each one its transition at FL060 with the ILS, the descent to 3,000 ft on the base, and hand both to Tower established. Use the hold if they would meet at the final.',
    rule: '<b>Pass:</b> both to Tower on the localizer, no loss of separation, no go-around. <b>Stars:</b> no holding.',
    scenario: sc('transitions-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20), A(30, 'RYR8CD', 'B738', 'HALME1A', 26)], { seed: 31, runway: '23R' }),
    status: (sim) => `${sim.aircraft.filter((a) => a.state === 'transferred' || a.landed).length + sim.landings.length} of 2 with Tower · ${sim.aircraft.filter((a) => a.mode === 'HOLD').length} holding`,
    judge: (sim) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'stack', 'goaround', 'mva'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const css = ['EWG1AB', 'RYR8CD'];
      if (!css.every((cs) => landed(sim, cs) || (sim.find(cs)?.state === 'transferred' && sim.find(cs)?.app?.locCap))) return undefined;
      const holdMin = css.reduce((s, cs) => s + (sim.landings.find((l) => l.cs === cs)?.holdSec ?? sim.find(cs)?.holdSec ?? 0), 0) / 60;
      return { pass: true, stars: holdMin <= 0.5 ? 3 : holdMin <= 4 ? 2 : 1, why: `Both with Tower; ${holdMin.toFixed(1)} min of holding.` };
    },
    solution: (sim) => autoControl(sim),
  },
};

// ---- 4. Holding at the entry fixes
const L_STACK: Lesson = {
  id: 'eddl-stack', icao: 'EDDL', stage: 'procedures', title: 'Holding at the entry fixes', minutes: 8, comps: ['SPP', 'TRAF'],
  summary: 'Two from BIKMU too close together: the second holds at the entry fix, FL060 not 6,000 ft, and leaves on the transition when the first is established.',
  scenario: sc('stack', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20), A(90, 'DLH4KT', 'A321', 'BIKMU1A', 24)], { runway: '23R' }),
  steps: [
    {
      id: 'wait', title: 'Two from BIKMU', run: 2,
      body: `EWG1AB and DLH4KT, both over BIKMU three minutes apart on the same transition. The first goes; the second cannot follow at that gap and will hold. At Düsseldorf you hold at the entry fix itself, or on the downwind at ${K('DL429')} and ${K('DL409')} (4,000 ft to FL070, 220 kt), or Langen holds them for you at NVO and DOMEG.`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      focus: { fix: 'BIKMU', scale: 7 }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'first', title: 'EWG1AB: its lead chip',
      body: `Transition, 3,000 ft and the ILS for the first one.`,
      cs: 'EWG1AB', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'trans'),
    },
    { id: 'second', title: 'DLH4KT will call', run: 2, body: 'It is too close behind to follow straight in.', mark: { cs: 'DLH4KT' }, done: (g) => calling(g, 'DLH4KT') },
    {
      id: 'level', title: 'Which level for the hold?',
      body: (g) => `EWG1AB is descending through the levels under DLH4KT. The transition altitude is 5,000 ft and the transition level ${tlText(g)}. You want DLH4KT 1,000 ft above an aircraft at 5,000 ft. What do you say?`,
      cs: 'DLH4KT', ask: { options: ['Descend 6,000 ft', 'Descend FL060', 'Descend FL050'], correct: tlIndex([0, 60, 50]), why: 'FL060 is the lowest flight level today; 6,000 ft does not exist above the transition altitude. Levels in the hold stack 1,000 ft apart, flight levels above the transition level and altitudes below it.' },
    },
    {
      id: 'hold', title: 'Tap HOLD in the halo, then FL060, then TRANSMIT',
      body: `${K('HOLD')} in the halo stages a hold at BIKMU (the stack fix). A hold nearly always comes with a level, so tap ${K('FL060')} on the ladder next: it completes the clearance and sends it. The phrase carries an expected approach time (${G('EFC')}). (${K('MORE')} → ${K('Hold BIKMU')} does the same from the bar.)`,
      cs: 'DLH4KT',
      el: (g) => (g.items.some((i) => i.k === 'hold') ? g.root.querySelector('.halo [data-halo="lvl"][data-v="F060"]') ?? g.root.querySelector('[data-a="send"]') : g.root.querySelector('.halo [data-halo="more"][data-v="hold"]') ?? g.root.querySelector('[data-p="more"]')),
      done: (g, x) => sentTo(g, x, 'DLH4KT', (it) => it.k === 'hold') && (sentTo(g, x, 'DLH4KT', isLvl((ft) => ft <= 7100, g.sim)) || staged(g, 'DLH4KT', (it) => it.k === 'lvl')),
    },
    {
      id: 'gap', title: 'Wait until EWG1AB shows LOC23R', run: 4,
      body: `Release the holder only once the first is established, or they arrive at REGNO together. Skip ahead if you like.`,
      mark: { cs: 'EWG1AB' }, done: (g) => { const a = find(g, 'EWG1AB'); return !a || !!a.app?.locCap; }, until: (g) => { const a = find(g, 'EWG1AB'); return !a || !!a.app?.locCap; },
    },
    {
      id: 'release', title: 'Tap DLH4KT’s “Leave hold” chip',
      body: `It clears the transition, 3,000 ft and the ILS out of the hold in one call.`,
      cs: 'DLH4KT', el: sg('Leave hold'), run: 1, done: (g, x) => sentTo(g, x, 'DLH4KT', (it) => it.k === 'trans') && !!find(g, 'DLH4KT')?.app,
    },
    {
      id: 'twr', title: 'Both to Tower when established', run: 4,
      body: `Hand each to Tower with its chip when line 4 reads LOC23R. Skip ahead if you like.`,
      done: (g) => ['EWG1AB', 'DLH4KT'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      mark: markDue(['EWG1AB', 'DLH4KT']),
      until: (g) => ['EWG1AB', 'DLH4KT'].some((cs) => dueTower(g.sim, cs)),
    },
    {
      id: 'wrap', title: 'The hold is the buffer',
      body: `Hold at the entry fix when the sequence is full, flight levels above the transition level, lowest leaves first. The exam puts two into one gap.`,
    },
  ],
  exam: {
    title: 'Two into one', run: 2, limitS: 2400,
    brief: 'Three arrivals: two from BIKMU close together and one from PISAP. Get all three established on 23R and to Tower. Hold whoever has to wait, 1,000 ft apart.',
    rule: '<b>Pass:</b> all three to Tower on the localizer, no loss of separation, no stack conflicts, no go-around. <b>Stars:</b> little holding.',
    scenario: sc('stack-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20), A(60, 'DLH4KT', 'A321', 'BIKMU1A', 22), A(40, 'CFG2PL', 'B752', 'PISAP1A', 24)], { seed: 32, runway: '23R' }),
    status: (sim) => `${sim.aircraft.filter((a) => a.state === 'transferred' || a.landed).length + sim.landings.length} of 3 with Tower · ${sim.aircraft.filter((a) => a.mode === 'HOLD').length} holding`,
    judge: (sim) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'stack', 'goaround', 'mva'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const css = ['EWG1AB', 'DLH4KT', 'CFG2PL'];
      if (!css.every((cs) => landed(sim, cs) || (sim.find(cs)?.state === 'transferred' && sim.find(cs)?.app?.locCap))) return undefined;
      const holdMin = css.reduce((s, cs) => s + (sim.landings.find((l) => l.cs === cs)?.holdSec ?? sim.find(cs)?.holdSec ?? 0), 0) / 60;
      return { pass: true, stars: holdMin <= 3 ? 3 : holdMin <= 7 ? 2 : 1, why: `All three with Tower; ${holdMin.toFixed(1)} min of holding in total.` };
    },
    solution: (sim) => autoControl(sim),
  },
};

// ---- 5. Departures to Langen
const L_DEPARTURES: Lesson = {
  id: 'eddl-departures', icao: 'EDDL', stage: 'procedures', title: 'Departures to Langen', minutes: 8, comps: ['CORD', 'SEPC'],
  summary: 'Tower asks for a release; the SID climbs to 5,000 ft and the pilot calls you passing 2,000 ft; climb to FL100 and hand to the Bottrop sector.',
  scenario: sc('departures', [A(1, 'CFG7HD', 'B752', 'DOMUX1A', 16), D(120, 'EWG2KL', 'A320', 'MEVEL4T'), A(200, 'KLM41X', 'E190', 'BIKMU1A', 30)]),
  steps: [
    {
      id: 'arr', title: 'CFG7HD is on its way in', run: 2,
      body: `Single runway today: 23L lands and departs. CFG7HD comes from DOMUX; when it calls, the coach clears it DOMUX23, 3,000 ft and the ILS. Every Düsseldorf ${G('SID')} climbs to ${K('5,000 ft')} and says: remain with Tower to 2,000 ft, then contact Langen Radar 121.355. In this sector the departure position is combined with yours, so they call you.`,
      onEnter: (g) => haloOn(g),
      mark: { cs: 'CFG7HD' },
      done: (g) => { if (isCalling(g.sim, 'CFG7HD') && !find(g, 'CFG7HD')?.app && !g.sim.readbackPending('CFG7HD')) g.sim.issue({ cs: 'CFG7HD', items: TRANS('DOMUX23', '23L') }); return g.sim.releases.some((r) => r.cs === 'EWG2KL'); },
    },
    {
      id: 'card', title: 'Tower asks: tap “After CFG7HD”',
      body: `Tower wants to launch EWG2KL on MEVEL4T, to the north. CFG7HD is on the way to the same runway: ${K('After CFG7HD')}. ${WHY('on a single runway a departure rolling in front of a landing aircraft forces the go-around; one that rolls after it has lost nothing.')}`,
      cs: 'EWG2KL', el: (g) => g.root.querySelector('.icom [data-rel="EWG2KL"][data-v^="after"]') ?? g.root.querySelector('.icom [data-rel="EWG2KL"]'),
      done: (g) => g.sim.releases.some((r) => r.cs === 'EWG2KL' && r.state === 'released') || !!find(g, 'EWG2KL'),
    },
    {
      id: 'cfg', title: 'CFG7HD to Tower when it shows LOC23L', run: 2, cs: 'CFG7HD', el: sg('Tower'),
      body: `While EWG2KL waits, hand CFG7HD to Tower with its chip once it is established.`,
      done: (g) => gone(g.sim, 'CFG7HD') || landed(g.sim, 'CFG7HD'), until: (g) => !!find(g, 'CFG7HD')?.app?.locCap,
    },
    {
      id: 'airborne', title: 'EWG2KL will call passing 2,000 ft', run: 2,
      body: `Tower launches it once CFG7HD is down. It climbs to 5,000 ft on the SID until you say more.`,
      done: (g) => calling(g, 'EWG2KL'), until: (g) => calling(g, 'EWG2KL'),
    },
    {
      id: 'climb', title: 'Tap “Climb FL100”',
      body: (g) => `${K('FL100')} is the agreed transfer level to ${g.sim.acc.label} (Langen Radar ${g.sim.acc.freq}), the sector above you. ${WHY('KLM41X is coming in from BIKMU to the south-west; the MEVEL departure climbs north, away from it, so there is nothing to wait for. A departure towards an arrival would stay at 5,000 ft until they had passed.')}`,
      cs: 'EWG2KL', el: sg('Climb'), done: (g, x) => sentTo(g, x, 'EWG2KL', (it) => it.k === 'lvl'),
    },
    {
      id: 'klm', title: 'KLM41X calls: answer it', run: 2,
      body: `An Embraer from BIKMU. Any descent, or its lead chip.`,
      cs: 'KLM41X', noAutoSelect: true, mark: { cs: 'KLM41X' },
      el: (g) => (g.cs === 'KLM41X' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'KLM41X'),
      until: (g) => calling(g, 'KLM41X'),
    },
    {
      id: 'bottrop', title: 'Hand EWG2KL to Langen before the boundary', run: 2, cs: 'EWG2KL', el: (g) => sg(acc(g))(g),
      body: (g) => `The ${K(acc(g))} chip appears once it is above 7,000 ft or 18 NM out. Hand it over before it leaves your sector.`,
      done: (g) => gone(g.sim, 'EWG2KL'), until: (g) => { const a = find(g, 'EWG2KL'); return !a || Math.hypot(a.p.x, a.p.y) > 18 || a.alt > 7000; },
    },
    {
      id: 'wrap', title: 'Release, climb, hand on',
      body: `Release into a gap, climb to FL100 when the climb-out is clear of arrivals, hand to Langen before the boundary. The exam is the morning's first departures.`,
    },
  ],
  exam: {
    title: 'The 06:00 departures', run: 2, limitS: 900,
    brief: 'Just after 06:00 local the curfew lifts and Tower asks for two releases in a row. CFG7HD is inbound from DOMUX. Release both, climb them to FL100 when clear, hand them to Langen. Handle CFG7HD too.',
    rule: '<b>Pass:</b> releases answered within 60 s, both departures with Langen inside your sector, no loss of separation. <b>Stars:</b> quick releases and handoffs.',
    scenario: sc('departures-exam', [A(2, 'CFG7HD', 'B752', 'DOMUX1A', 26), D(10, 'EWG2KL', 'A320', 'MEVEL4T'), D(60, 'DLH9PA', 'A321', 'MODRU2T')], { seed: 17, startUtc: '05:02' }),
    watch: (sim, m) => {
      m.relWait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.relWait[r.cs] = sim.t - r.t;
    },
    status: (sim) => `${sim.releases.filter((r) => r.state === 'pending').length} release request${sim.releases.filter((r) => r.state === 'pending').length === 1 ? '' : 's'} waiting · ${sim.departuresHandled} of 2 with ${sim.acc.say}`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'exit_unxfr', 'airspace', 'release_delay', 'mva'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.relWait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `Tower waited ${Math.round(slow[1])} s for a release for ${slow[0]}. Answer the intercom card within a minute.` };
      if (sim.departuresHandled < 2) return undefined;
      const waits = Object.values((m.relWait ?? {}) as Record<string, number>);
      const quick = waits.length >= 2 && waits.every((w) => w <= 20);
      return { pass: true, stars: quick && !sim.events.some((e) => e.kind === 'stca') ? 3 : quick ? 2 : 1, why: `Both departures with ${sim.acc.say}; releases answered in ${waits.map((w) => `${Math.round(w)} s`).join(' and ')}.` };
    },
    solution: (sim, once, say) => {
      for (const r of sim.releases) if (r.state === 'pending' && once('rel' + r.cs, sim.t - r.t > 4)) say(r.cs, [{ k: 'rel' }], 'Nothing on final: release it now.');
      const q = sim.find('CFG7HD');
      if (q && once('q', callingClear(sim, 'CFG7HD'))) { const s = leadOf(sim, 'CFG7HD'); say('CFG7HD', s?.items ?? [{ k: 'lvl', lvl: { fl: 100 } }], 'The arrival gets its transition; it comes in from the east, clear of the departures.'); }
      for (const cs of ['EWG2KL', 'DLH9PA']) {
        const a = sim.find(cs); if (!a || a.state !== 'assumed') continue;
        if (once('cl' + cs, callingClear(sim, cs))) say(cs, [{ k: 'lvl', lvl: { fl: 100 } }], 'Climb to the transfer level: the climb-out is clear.');
        if (once('acc' + cs, Math.hypot(a.p.x, a.p.y) > 18 || a.alt > 7000)) say(cs, [{ k: 'xfr', unit: sim.acc.id }], 'Hand it to Langen before the boundary.');
      }
      towerWhenEstablished(sim, once, say);
    },
  },
};

// ---- 6. Parallel runways
const L_PARALLEL: Lesson = {
  id: 'eddl-parallel', icao: 'EDDL', stage: 'procedures', title: 'Parallel runways', minutes: 8, comps: ['SEPC', 'CORD', 'SPP'],
  summary: 'The northern runway lands, the southern departs. Dependent finals: 2.5 NM between approaches inside 10 NM; departures roll between arrivals without waiting for them.',
  scenario: sc('parallel', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 16), A(240, 'TUI3LK', 'B738', 'PISAP1A', 22), D(150, 'DLH9PA', 'A321', 'MODRU2T')], { runway: '23R' }),
  steps: [
    {
      id: 'intro', title: 'North lands, south departs', run: 2,
      body: `Parallel operations: arrivals land on ${K('23R')}, departures roll on ${K('23L')}. The two finals are 0.3 NM apart, so the approaches are dependent: ${K('2.5 NM')} between alternating approaches inside 10 NM, unless the wake minimum is larger. Departures no longer wait for landings on the other runway. ${WHY('the 56 hours a week the northern runway may be used are the hours that make the morning and evening peaks work.')}`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      mark: { cs: 'EWG1AB' }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'first', title: 'EWG1AB: lead chip, BIKMU23 and the ILS 23R',
      body: `The approach clearance names 23R: the pilot sets the northern localizer, IDNW 109.30.`,
      cs: 'EWG1AB', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'app' && it.rwy === '23R'),
    },
    {
      id: 'second', title: 'TUI3LK from PISAP: its lead chip too', run: 2,
      body: `PISAP23 brings it round the north side onto the same final. The sequence tool keeps the gap.`,
      cs: 'TUI3LK', noAutoSelect: true, mark: { cs: 'TUI3LK' },
      el: (g) => (g.cs === 'TUI3LK' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'TUI3LK'), until: (g) => calling(g, 'TUI3LK'),
    },
    {
      id: 'release', title: 'Tower asks for DLH9PA on 23L: tap Release', run: 2,
      body: `Release it now. ${WHY('it rolls on 23L while EWG1AB lands on 23R; the runways are independent for a departure against a landing, and the SID turns it south-west, away from the downwind.')}`,
      cs: 'DLH9PA', el: (g) => g.root.querySelector('.icom [data-rel="DLH9PA"][data-v="rel"]') ?? g.root.querySelector('.icom [data-rel="DLH9PA"]'),
      done: (g) => g.sim.releases.some((r) => r.cs === 'DLH9PA' && r.state !== 'pending') || !!find(g, 'DLH9PA'),
      until: (g) => g.sim.releases.some((r) => r.cs === 'DLH9PA' && r.state === 'pending'),
    },
    {
      id: 'twr1', title: 'EWG1AB established: 160 to 4 · Tower', run: 2, mark: { cs: 'EWG1AB' }, el: sg('160'),
      onEnter: (g) => { if (find(g, 'EWG1AB')) g.select('EWG1AB', true); },
      body: `Hand it to Tower established; Tower works both runways. If DLH9PA calls before that, answer it first: ${K('Climb FL100')}, then ${K('Langen')} before it leaves your airspace.`,
      done: (g) => gone(g.sim, 'EWG1AB') || landed(g.sim, 'EWG1AB'), until: (g) => dueTower(g.sim, 'EWG1AB'),
    },
    {
      id: 'dep', title: 'DLH9PA calls: climb FL100, then Langen', run: 4, cs: 'DLH9PA',
      body: (g) => `When it calls passing 2,000 ft, ${K('Climb FL100')}; when the ${K(acc(g))} chip appears, hand it on. Skip ahead if you like.`,
      el: (g) => sg('Climb')(g) ?? sg(acc(g))(g),
      done: (g) => gone(g.sim, 'DLH9PA'), until: (g) => calling(g, 'DLH9PA') || (!!leadOf(g.sim, 'DLH9PA') && leadOf(g.sim, 'DLH9PA')!.items.some((i) => i.k === 'xfr')),
    },
    {
      id: 'twr2', title: 'TUI3LK to Tower when established', run: 4, cs: 'TUI3LK', el: sg('160'),
      body: `And the second arrival. Skip ahead if you like.`,
      done: (g) => gone(g.sim, 'TUI3LK') || landed(g.sim, 'TUI3LK'), until: (g) => dueTower(g.sim, 'TUI3LK'),
    },
    {
      id: 'wrap', title: 'Two runways, one sequence',
      body: `Arrivals on the north, departures on the south, 2.5 NM between approaches inside 10 NM. The exam mixes three arrivals with two departures.`,
    },
  ],
  exam: {
    title: 'North lands, south departs', run: 2, limitS: 2400,
    brief: 'Three arrivals for 23R from BIKMU, PISAP and HALME, and two departures on 23L. Land everyone, release both without waiting for the arrivals, hand the departures to Langen.',
    rule: '<b>Pass:</b> all three arrivals with Tower or landed, both departures with Langen, releases answered within a minute, no loss of separation. <b>Stars:</b> no conflict alerts and quick releases.',
    scenario: sc('parallel-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20, { callNow: true }), A(90, 'TUI3LK', 'B738', 'PISAP1A', 24), A(200, 'THY5MK', 'A332', 'HALME1A', 26), D(60, 'DLH9PA', 'A321', 'MODRU2T'), D(300, 'EWG2KL', 'A320', 'MEVEL4T')], { seed: 41, runway: '23R' }),
    watch: (sim, m) => {
      if (!m.par) { m.par = true; sim.depRunway = '23L'; }
      m.wait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.wait[r.cs] = Math.max(m.wait[r.cs] ?? 0, sim.t - r.t);
    },
    status: (sim) => `${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 3 arrivals · ${sim.departuresHandled} of 2 departures with ${sim.acc.say}`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'release_delay', 'goaround'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.wait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `Tower waited ${Math.round(slow[1])} s for a release for ${slow[0]}.` };
      const arrDone = ['EWG1AB', 'TUI3LK', 'THY5MK'].every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred');
      if (!arrDone || sim.departuresHandled < 2) return undefined;
      const quick = Object.values((m.wait ?? {}) as Record<string, number>).every((w) => w <= 20);
      const stca = sim.events.some((e) => e.kind === 'stca');
      return { pass: true, stars: !stca && quick ? 3 : !stca || quick ? 2 : 1, why: `Everyone handled${stca ? ', with a conflict alert' : ' with no conflict alerts'}.` };
    },
    solution: (sim, _once, say) => {
      autoControl(sim);
      for (const r of sim.releases) if (r.state === 'pending' && sim.t - r.t > 3) say(r.cs, [{ k: 'rel' }], 'Departures roll on 23L whatever lands on 23R: release it.');
    },
  },
};

// ---- 7. Runway 05
const L_RUNWAY05: Lesson = {
  id: 'eddl-runway05', icao: 'EDDL', stage: 'procedures', title: 'Runway 05', minutes: 8, comps: ['SPP', 'CORD'],
  summary: 'An easterly: the supervisor turns the airport round. The 05 transitions end at DIKMI, the downwind holds are DL524 and DL503, and arrivals already cleared are re-cleared.',
  scenario: sc('runway05', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 34), A(420, 'RYR8CD', 'B738', 'HALME1A', 26)], { runway: '23R', events: [{ t: 30, kind: 'runway', rwy: '05L', notice: 150 }] }),
  steps: [
    {
      id: 'notice', title: 'SUP: runway change to 05L', run: 2,
      body: `The wind is backing east. The supervisor announces the change on the intercom with two and a half minutes' notice: after it, arrivals not yet on the approach go via the 05 transitions and departures get the 05 SIDs. Runway 05L is the northern runway, so parallel operations continue the other way round: 05L lands, 05R departs. Which arrivals keep 23R?`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      ask: { options: ['All of them', 'Only those established on the ILS 23R', 'None'], correct: 1, why: 'An aircraft established on the localizer continues to the old runway. Everyone else is re-cleared, and the supervisor names them when the change happens.' },
      done: (g) => !!g.sim.rwyChange || !!g.sim.lastRwyChange,
    },
    {
      id: 'ewg', title: 'EWG1AB calls: a level only', run: 2,
      body: `Answer with a level, not the transition: ${K('Descend FL080')} or the ladder. ${WHY('a BIKMU23 clearance now is one you cancel in two minutes; a level costs nothing to keep. The 05 transition from BIKMU runs the other side of the field, so the miles are about the same.')}`,
      cs: 'EWG1AB', noAutoSelect: true, mark: { cs: 'EWG1AB' },
      el: (g) => (g.cs === 'EWG1AB' ? sg('Descend')(g) ?? g.root.querySelector('.halo [data-halo="lvl"]:not(.cleared)') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'lvl'), until: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'change', title: 'Runway 05L in use', run: 4,
      body: `Wait for the change: the ATIS letter steps on, the RWY tag changes, the final flips to the other end, and the supervisor names who needs re-clearing.`,
      done: (g) => !!g.sim.lastRwyChange, until: (g) => !!g.sim.lastRwyChange,
    },
    {
      id: 'reclear', title: 'Re-clear EWG1AB: its lead chip',
      body: (g) => { const s = leadOf(g.sim, 'EWG1AB'); return `The lead chip now reads ${K(s?.label ?? 'Runway 05L · BIKMU1A')}. ${WHY('the 05 structure: BIKMU05 runs north through RONAD, DL513 and IBIKO to the downwind points DL524 and DL530 and the FAF DIKMI at 3,000 ft. The holds for 05 are at DL524 and DL503, 4,000 ft to FL070.')}`; },
      cs: 'EWG1AB', el: '.sg.lead',
      onEnter: (g) => parallel(g),
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'star' || it.k === 'trans' || (it.k === 'app' && it.rwy === '05L')),
    },
    {
      id: 'ryr', title: 'RYR8CD from HALME: its lead chip for 05L', run: 2,
      body: `HALME05 runs south-west over BOMBA to DL524 and DIKMI. Clear it when it calls (a level first if the transition is not yet offered, then the transition).`,
      cs: 'RYR8CD', noAutoSelect: true, mark: { cs: 'RYR8CD' },
      el: (g) => (g.cs === 'RYR8CD' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'RYR8CD', (it) => it.k === 'trans' || it.k === 'star' || it.k === 'lvl'), until: (g) => calling(g, 'RYR8CD'),
    },
    {
      id: 'land', title: 'Bring both in on 05L', run: 4,
      body: `Keep taking the lead chips as they come: the transition and the ILS 05L, then Tower when established. Skip ahead if you like.`,
      done: (g) => ['EWG1AB', 'RYR8CD'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      mark: markDue(['EWG1AB', 'RYR8CD']),
      until: (g) => ['EWG1AB', 'RYR8CD'].some((cs) => dueTower(g.sim, cs) || (leadOf(g.sim, cs)?.items.some((i) => i.k === 'trans') ?? false)),
    },
    {
      id: 'wrap', title: 'The airport turned round',
      body: `Same fixes, the other transitions, the other holds, the other SIDs. The exam does it with the wind, unannounced.`,
    },
  ],
  exam: {
    title: 'Turn the airport round', run: 2, limitS: 2700,
    brief: 'Three arrivals and a departure. The supervisor calls a runway change to 05L with five minutes’ notice: parallel operations the other way round. Re-clear whoever needs it, release the departure for the right runway, land everyone.',
    rule: '<b>Pass:</b> all three arrivals with Tower or landed, the departure with Langen, every intercom request answered within a minute, no loss of separation. <b>Stars:</b> no conflict alert and no go-around.',
    scenario: sc('runway05-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 26, { callNow: true }), A(240, 'RYR8CD', 'B738', 'HALME1A', 26), A(420, 'TUI3LK', 'B738', 'PISAP1A', 24), D(420, 'DLH9PA', 'A321', 'MODRU2T')], { seed: 24, runway: '23R', events: [{ t: 30, kind: 'runway', rwy: '05L', notice: 300 }] }),
    watch: (sim, m) => {
      if (!m.par) { m.par = true; sim.depRunway = '23L'; }
      if (sim.lastRwyChange && !m.par2) { m.par2 = true; sim.depRunway = sim.runway === '05L' ? '05R' : sim.runway; }
      m.wait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.wait[r.cs] = Math.max(m.wait[r.cs] ?? 0, sim.t - r.t);
    },
    status: (sim) => `Runway ${sim.runway}${sim.rwyChange ? ` → ${sim.rwyChange.to} at ${sim.utc(sim.rwyChange.at).slice(0, 5)}` : ''} · ${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 3 arrivals · ${sim.departuresHandled} of 1 departure`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'coord_unanswered', 'release_delay'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.wait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `${slow[0]} waited ${Math.round(slow[1])} s for an answer.` };
      const arrDone = ['EWG1AB', 'RYR8CD', 'TUI3LK'].every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred');
      if (!arrDone || sim.departuresHandled < 1) return undefined;
      const stca = sim.events.some((e) => e.kind === 'stca'), ga = sim.events.some((e) => e.kind === 'goaround');
      return { pass: true, stars: !stca && !ga ? 3 : !stca || !ga ? 2 : 1, why: `Everyone handled through the change to ${sim.runway}${stca ? ', with a conflict alert' : ''}${ga ? ', with a go-around' : ''}.` };
    },
    solution: (sim, _once, say) => {
      autoControl(sim);
      for (const r of sim.releases) if (r.state === 'pending' && sim.t - r.t > 3) say(r.cs, [{ k: 'rel' }], 'Release it for the runway in use.');
    },
  },
};

// =====================================================================================
// JUDGEMENT
// =====================================================================================

// ---- 8. Sequencing onto 23R
const L_SEQUENCE: Lesson = {
  id: 'eddl-sequence', icao: 'EDDL', stage: 'judgement', title: 'Sequencing onto 23R', minutes: 9, comps: ['TRAF', 'SEPC', 'SITU'],
  summary: 'Three arrivals from three entry fixes onto one final: the transitions meet at REGNO. Who goes first, speed on the downwind, wake behind the heavy.',
  scenario: sc('sequence', [A(2, 'THY5MK', 'A332', 'HALME1A', 26), A(20, 'EWG1AB', 'A320', 'BIKMU1A', 22), A(70, 'CFG2PL', 'B752', 'PISAP1A', 24)], { runway: '23R' }),
  steps: [
    {
      id: 'intro', title: 'Three fixes, one final', run: 2,
      body: `THY5MK, an A330 (wake B), over HALME; EWG1AB, an A320 (D), over BIKMU; CFG2PL, a 757 (D), over PISAP. HALME23 and PISAP23 come down the north side, BIKMU23 the south side; all three meet at REGNO. The AMAN proposes an order from the track miles; you decide it. ${WHY('the A330 first: it is nearest, and the two behind it need 4 NM on final behind a B, which speed on the downwind gives you.')}`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      focus: { fix: 'REGNO', scale: 6 }, done: (g) => calling(g, 'THY5MK'),
    },
    {
      id: 'thy', title: 'THY5MK: lead chip',
      body: `Transition, 3,000 ft and the ILS 23R.`,
      cs: 'THY5MK', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'THY5MK', (it) => it.k === 'trans'),
    },
    {
      id: 'ewg', title: 'EWG1AB: lead chip when it calls', run: 2,
      body: (g) => { const s = leadOf(g.sim, 'EWG1AB'); return `${s ? `The chip reads ${K(s.label)}: ${s.why}` : 'Wait for its call.'} ${WHY('if the chip offers the hold instead, the gap at REGNO is not there yet; a speed on the downwind usually makes it.')}`; },
      cs: 'EWG1AB', noAutoSelect: true, mark: { cs: 'EWG1AB' },
      el: (g) => (g.cs === 'EWG1AB' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'EWG1AB'), until: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'cfg', title: 'CFG2PL: lead chip when it calls', run: 2,
      body: `The 757 is last. Its chip clears the transition when there is a slot behind EWG1AB, or holds it at PISAP when there is not.`,
      cs: 'CFG2PL', noAutoSelect: true, mark: { cs: 'CFG2PL' },
      el: (g) => (g.cs === 'CFG2PL' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'CFG2PL'), until: (g) => calling(g, 'CFG2PL'),
    },
    {
      id: 'gap', title: 'Watch the gap ruler, use speed', run: 4,
      body: (g) => { const fin = g.sim.aircraft.filter((a) => a.app?.locCap).sort((a, b) => g.sim.dthr(a) - g.sim.dthr(b)); return `${fin.length >= 2 ? `Gap on final: ${(g.sim.dthr(fin[1]) - g.sim.dthr(fin[0])).toFixed(1)} NM. ` : ''}Behind the A330 the A320 needs 4 NM; 180 kt on the follower holds a gap, 160 kt opens it. Hand each to Tower established (its chip). Skip ahead if you like.`; },
      done: (g) => ['THY5MK', 'EWG1AB', 'CFG2PL'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      mark: markDue(['THY5MK', 'EWG1AB', 'CFG2PL']),
      until: (g) => ['THY5MK', 'EWG1AB', 'CFG2PL'].some((cs) => dueTower(g.sim, cs)) || g.sim.aircraft.some((a) => isCalling(g.sim, a.cs) && a.mode === 'HOLD'),
    },
    {
      id: 'result', title: 'Result',
      body: (g) => { const s = g.sim.spacing; const wake = g.sim.events.some((e) => e.kind === 'wake'); return wake ? 'A follower got inside its wake minimum on final. Slow the follower on the downwind, before the base turn.' : s.length ? `Gaps at touchdown: ${s.map((x) => `${x.follower} ${x.gap.toFixed(1)} NM (min ${x.min})`).join(', ')}. Real units aim for the minimum plus half a mile.` : 'All three down.'; },
    },
  ],
  exam: {
    title: 'Four from three fixes', run: 2, limitS: 2700,
    brief: 'Four arrivals for 23R: from HALME, BIKMU, PISAP and BIKMU again. Build the sequence: transitions, speeds, holds where needed. Land everyone with the wake gaps intact.',
    rule: '<b>Pass:</b> all four with Tower or landed, no loss of separation, no wake infringement, no go-around. <b>Stars:</b> little holding and no conflict alert.',
    scenario: sc('sequence-exam', [A(2, 'THY5MK', 'A332', 'HALME1A', 24), A(30, 'EWG1AB', 'A320', 'BIKMU1A', 22), A(80, 'CFG2PL', 'B752', 'PISAP1A', 24), A(160, 'DLH4KT', 'A321', 'BIKMU1A', 30)], { seed: 52, runway: '23R' }),
    status: (sim) => `${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 4 done · ${sim.aircraft.filter((a) => a.mode === 'HOLD').length} holding`,
    judge: (sim) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'stack', 'goaround', 'mva'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const css = ['THY5MK', 'EWG1AB', 'CFG2PL', 'DLH4KT'];
      if (!css.every((cs) => landed(sim, cs) || (sim.find(cs)?.state === 'transferred' && sim.find(cs)?.app?.locCap))) return undefined;
      const holdMin = css.reduce((s, cs) => s + (sim.landings.find((l) => l.cs === cs)?.holdSec ?? sim.find(cs)?.holdSec ?? 0), 0) / 60;
      const stca = sim.events.some((e) => e.kind === 'stca');
      return { pass: true, stars: holdMin <= 3 && !stca ? 3 : holdMin <= 8 ? 2 : 1, why: `All four with Tower; ${holdMin.toFixed(1)} min of holding${stca ? ', one conflict alert' : ''}.` };
    },
    solution: (sim) => autoControl(sim),
  },
};

// ---- 9. Safety nets at Langen
const L_EMERGENCY: Lesson = {
  id: 'eddl-emergency', icao: 'EDDL', stage: 'judgement', title: 'Safety nets at Langen', minutes: 9, comps: ['NONR', 'COMM', 'SEPC'],
  summary: 'A wrong readback caught on the card, then a MAYDAY from the north-east: direct to the final, 23R, everyone else out of the way.',
  scenario: sc('emergency', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20), A(300, 'UAE57', 'B77L', 'HALME1A', 26, { emergency: { after: 50, type: 'engine' } }), A(330, 'TUI3LK', 'B738', 'PISAP1A', 24)], { runway: '23R' }),
  steps: [
    {
      id: 'wait', title: 'A readback goes wrong', run: 2,
      body: `EWG1AB from BIKMU. Clear it down when it calls, then listen: the pilot will read back the wrong level. The card under the bar and the top row of the queue both catch it.`,
      onEnter: (g) => { haloOn(g); parallel(g); g.sim.forceWrong.add('EWG1AB'); },
      mark: { cs: 'EWG1AB' }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'clear', title: 'Tap EWG1AB’s “Descend FL080” chip',
      body: `Clear it down as usual.`, cs: 'EWG1AB', el: sg('Descend'),
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'lvl'),
    },
    {
      id: 'wrong', title: 'Listen to the readback', run: 1, cs: 'EWG1AB',
      body: `The card turns amber with what the pilot said; the label shows an amber ≠ with the level it set.`,
      done: (g) => !!find(g, 'EWG1AB')?.wrong && !g.sim.readbackPending('EWG1AB'),
    },
    {
      id: 'fix', title: 'Tap “Say again” on the card',
      body: `Thirty seconds. Say the level again, nothing else. ${WHY('a wrong level set in the FMS is flown; in the 3,200 ft hills east of the Rhine that is how an MSAW starts.')}`,
      cs: 'EWG1AB', el: (g) => g.root.querySelector('.rb [data-a="rb-fix"]') ?? g.root.querySelector('.att-row[data-cs="EWG1AB"] .att-go') ?? g.root.querySelector('.sg'),
      done: (g) => g.sim.events.some((e) => e.kind === 'readback_caught' && e.cs === 'EWG1AB'),
    },
    {
      id: 'approach', title: 'Now its lead chip: transition and ILS', run: 1, cs: 'EWG1AB', el: '.sg.lead',
      body: `Send it on its way once the readback is clean.`,
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'app'),
      until: (g) => !find(g, 'EWG1AB')?.wrong && !g.sim.readbackPending('EWG1AB'),
    },
    {
      id: 'mayday', title: 'Wait for the next arrival', run: 4,
      body: `UAE57, a 777 from HALME, and TUI3LK from PISAP are next. The coach answers UAE57's check-in for you. Hand EWG1AB to Tower when it is established.`,
      done: (g) => { const u = find(g, 'UAE57'); if (u && !u.emergency && calling(g, 'UAE57') && !g.sim.readbackPending('UAE57') && u.txCount === 0) g.sim.issue({ cs: 'UAE57', items: [{ k: 'roger' }] }); return !!u?.emergency && calling(g, 'UAE57'); },
      until: (g) => !!find(g, 'UAE57')?.emergency || dueTower(g.sim, 'EWG1AB') || isCalling(g.sim, 'TUI3LK'),
    },
    {
      id: 'card', title: 'MAYDAY: tap the red card',
      body: `An engine has failed on the 777. The red card shows the ${G('MAYDAY')}, its distance and level. Tap it to select and centre it.`,
      cs: 'UAE57', noAutoSelect: true, el: '.emer-card .em', done: (g) => g.cs === 'UAE57',
    },
    {
      id: 'priority', title: 'Its lead chip: direct to the final', cs: 'UAE57', el: '.sg.lead',
      body: `Direct to the intermediate fix, 3,000 ft and the ILS 23R: the shortest way in. ${WHY('it comes from the north-east, 15 NM from the final; the HALME transition would take it 40 NM round the downwind. Everyone else gets a level or a hold until it is down, and Tower has the fire service out.')}`,
      done: (g, x) => sentTo(g, x, 'UAE57', (it) => it.k === 'app' || it.k === 'dct'),
    },
    {
      id: 'others', title: 'Keep TUI3LK out of its way', run: 2,
      body: `TUI3LK from PISAP: a level only for now (${K('Descend')} chip or the ladder), or the hold chip if offered. It gets its transition when the 777 is on the localizer.`,
      cs: 'TUI3LK', noAutoSelect: true, mark: { cs: 'TUI3LK' },
      el: (g) => (g.cs === 'TUI3LK' ? sg('Descend')(g) ?? sg('Hold')(g) ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'TUI3LK'), until: (g) => calling(g, 'TUI3LK'),
    },
    {
      id: 'land', title: 'UAE57 to Tower when established, then the rest', run: 4,
      body: `Hand the emergency to Tower established, then clear TUI3LK its transition and bring it in. Skip ahead if you like.`,
      done: (g) => ['UAE57', 'TUI3LK', 'EWG1AB'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      mark: markDue(['UAE57', 'TUI3LK', 'EWG1AB']),
      until: (g) => ['UAE57', 'TUI3LK', 'EWG1AB'].some((cs) => dueTower(g.sim, cs)) || (!!leadOf(g.sim, 'TUI3LK') && leadOf(g.sim, 'TUI3LK')!.items.some((i) => i.k === 'trans')),
    },
  ],
  exam: {
    title: 'The diversion', run: 1, limitS: 35 * 60,
    brief: 'Thirty-five minutes, four arrivals and a departure, and a 777 that declares an emergency on the way in. Land everyone, the emergency first, graded like a real session.',
    rule: '<b>Pass:</b> grade Pass or better: safety gate passed, every arrival landed, the departure handed on, no missed readbacks. <b>Stars:</b> Pass 1, Good 2, Rated 3.',
    scenario: sc('emergency-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 14), A(40, 'TUI3LK', 'B738', 'PISAP1A', 20), D(80, 'DLH9PA', 'A321', 'MODRU2T'), A(120, 'UAE57', 'B77L', 'HALME1A', 26, { emergency: { after: 120, type: 'engine' } }), A(150, 'THY5MK', 'A332', 'PISAP1A', 22)], { durationMin: 35, readbackErr: 0.08, seed: 2027, runway: '23R', pass: { allArrivalsHandled: true, minDeparturesHandled: 1, noMissedReadbacks: true } }),
    status: (sim) => `${sim.landings.length} of 4 landed · ${sim.departuresHandled} of 1 departure · ${mmss(sim.durationS - sim.t)} left`,
    judge: (sim) => {
      if (!sim.ended) return undefined;
      const r = assess(sim);
      const pass = r.grade !== 'fail';
      return { pass, stars: r.grade === 'rated' ? 3 : r.grade === 'good' ? 2 : pass ? 1 : 0, why: pass ? `Grade: ${GRADE_NAMES[r.grade]}.${r.gradeNotes[0] ? ` Next step up: ${r.gradeNotes[0]}.` : ''}` : `Not yet: ${r.gradeNotes[0] ?? 'safety gate'}.` };
    },
    solution: (sim, once, say) => {
      if (!(sim as any)._par) { (sim as any)._par = true; sim.depRunway = '23L'; }
      for (const a of sim.aircraft) if (a.wrong && !sim.readbackPending(a.cs) && once('neg' + a.cs + a.wrong.t, true)) { const s = suggest(sim, a)[0]; if (s?.label.startsWith('Negative')) say(a.cs, s.items, 'A wrong readback: say the level again before anything else.'); }
      // the emergency comes first: its lead chip (direct to the final), then Tower; everyone else by the primary chips
      const em = sim.aircraft.find((a) => a.emergency && a.state === 'assumed');
      if (em && !sim.readbackPending(em.cs)) {
        const s = suggest(sim, em)[0];
        if (s?.primary && !em.app && once('em' + em.cs, true)) say(em.cs, s.items, 'MAYDAY: the shortest way to the final, and everyone else makes room.');
      }
      autoControl(sim);
    },
  },
};

// ---- 10. The 06:00 rush
const L_RUSH: Lesson = {
  id: 'eddl-rush', icao: 'EDDL', stage: 'judgement', title: 'The 06:00 rush', minutes: 10, comps: ['WORK', 'TRAF', 'CORD'],
  summary: 'The night curfew ends at 06:00 local: the first wave lands and the first departures roll in the same ten minutes. Parallel runways, the queue, the holds, the centre.',
  scenario: sc('rush', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 22), A(40, 'CFG7HD', 'B752', 'HALME1A', 26), D(60, 'EWG2KL', 'A320', 'MEVEL4T'), A(90, 'UAE57', 'B77L', 'PISAP1A', 24), D(150, 'DLH9PA', 'A321', 'MODRU2T')], { runway: '23R', startUtc: '04:52' }),
  steps: [
    {
      id: 'intro', title: 'Six o’clock', run: 2,
      body: (g) => `Local time ${String(Math.floor(g.sim.localHour())).padStart(2, '0')}:${String(Math.round((g.sim.localHour() % 1) * 60)).padStart(2, '0')}. No scheduled landing before 06:00 and no take-off before 06:00 (AD 2.20): the night's arrivals have been holding at the entry fixes and Tower has a line of departures at the holding point. Parallel operations are on: 23R lands, 23L departs. For ten minutes everything happens at once. Work the queue from the top.`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'first', title: 'EWG1AB: lead chip',
      body: `The first of the wave, from BIKMU: transition, 3,000 ft and the ILS 23R.`,
      cs: 'EWG1AB', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'trans'),
    },
    {
      id: 'cfg', title: 'CFG7HD from HALME: its lead chip', run: 2,
      body: `A 757 from the north-east. Its chip clears HALME23 when there is a slot behind EWG1AB at REGNO, or holds it when there is not. Take whatever the lead chip offers.`,
      cs: 'CFG7HD', noAutoSelect: true, mark: { cs: 'CFG7HD' },
      el: (g) => (g.cs === 'CFG7HD' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'CFG7HD'), until: (g) => calling(g, 'CFG7HD'),
    },
    {
      id: 'release', title: 'Tower: release EWG2KL on 23L', run: 2,
      body: `${K('Release')}: departures on 23L roll between the landings on 23R.`,
      cs: 'EWG2KL', el: (g) => g.root.querySelector('.icom [data-rel="EWG2KL"][data-v="rel"]') ?? g.root.querySelector('.icom [data-rel="EWG2KL"]'),
      done: (g) => g.sim.releases.some((r) => r.cs === 'EWG2KL' && r.state !== 'pending') || !!find(g, 'EWG2KL'),
      until: (g) => g.sim.releases.some((r) => r.cs === 'EWG2KL' && r.state === 'pending'),
    },
    {
      id: 'wave', title: 'Work the queue', run: 4,
      body: (g) => { const w = g.sim.callers().filter((a) => g.sim.t >= (a.awaitingSince ?? 0)); return `${w.length ? `${w.length} waiting: ${w.map((a) => a.cs).join(', ')}. ` : 'Nobody waiting. '}UAE57 from PISAP, DLH9PA to release, departures to climb to FL100 and hand to Langen, arrivals to Tower established. NEXT, action, card, round again. Skip ahead if you like.`; },
      done: (g) => ['EWG1AB', 'CFG7HD', 'UAE57'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)) && g.sim.departuresHandled >= 2,
      until: (g) => g.sim.callers().some((a) => g.sim.t >= (a.awaitingSince ?? 0)) || g.sim.releases.some((r) => r.state === 'pending') || g.sim.aircraft.some((a) => dueTower(g.sim, a.cs)),
    },
    {
      id: 'wrap', title: 'The wave is over',
      body: `That is what the first ten minutes after the curfew look like. The exam is the full wave: five arrivals and three departures.`,
    },
  ],
  exam: {
    title: 'The first wave', run: 2, limitS: 40 * 60,
    brief: 'Forty minutes from 06:00 local: five arrivals from four entry fixes and three departures, parallel operations. Everyone lands, every departure reaches Langen, nobody waits on the intercom.',
    rule: '<b>Pass:</b> all five arrivals with Tower or landed, all three departures with Langen, releases answered within a minute, no loss of separation, no wake infringement. <b>Stars:</b> no conflict alert and little holding.',
    scenario: sc('rush-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20, { callNow: true }), A(60, 'CFG7HD', 'B752', 'HALME1A', 26), D(40, 'EWG2KL', 'A320', 'MEVEL4T'), A(150, 'UAE57', 'B77L', 'PISAP1A', 24), D(220, 'DLH9PA', 'A321', 'MODRU2T'), A(300, 'DLH4KT', 'A321', 'BIKMU1A', 30), A(480, 'TUI3LK', 'B738', 'PISAP1A', 24), D(560, 'KLM41X', 'E190', 'SONEB8T')], { seed: 61, runway: '23R', startUtc: '05:00', durationMin: 40 }),
    watch: (sim, m) => {
      if (!m.par) { m.par = true; sim.depRunway = '23L'; }
      m.wait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.wait[r.cs] = Math.max(m.wait[r.cs] ?? 0, sim.t - r.t);
    },
    status: (sim) => `${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 5 arrivals · ${sim.departuresHandled} of 3 departures · ${mmss(40 * 60 - sim.t)} left`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'release_delay', 'goaround'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.wait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `Tower waited ${Math.round(slow[1])} s for a release for ${slow[0]}.` };
      const css = ['EWG1AB', 'CFG7HD', 'UAE57', 'DLH4KT', 'TUI3LK'];
      if (!css.every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred') || sim.departuresHandled < 3) return undefined;
      const holdMin = css.reduce((s, cs) => s + (sim.landings.find((l) => l.cs === cs)?.holdSec ?? sim.find(cs)?.holdSec ?? 0), 0) / 60;
      const stca = sim.events.some((e) => e.kind === 'stca');
      return { pass: true, stars: !stca && holdMin <= 4 ? 3 : !stca || holdMin <= 8 ? 2 : 1, why: `The wave handled: ${holdMin.toFixed(1)} min of holding${stca ? ', one conflict alert' : ', no conflict alerts'}.` };
    },
    solution: (sim, _once, say) => {
      autoControl(sim);
      for (const r of sim.releases) if (r.state === 'pending' && sim.t - r.t > 3) say(r.cs, [{ k: 'rel' }], 'Departures roll on 23L between the landings on 23R: release it.');
    },
  },
};

export const EDDL_LESSONS: Lesson[] = [L_PICTURE, L_CONTACT, L_TRANSITIONS, L_STACK, L_DEPARTURES, L_PARALLEL, L_RUNWAY05, L_SEQUENCE, L_EMERGENCY, L_RUSH];
void D; void LVL; void flow; void alongTrack; void offCl; void ILS;
