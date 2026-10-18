// The Düsseldorf curriculum: ten lessons on the Langen Radar arrival position (pickup and feeder in one).
// The basics reuse the mechanics the Liège course teaches (NEXT, the halo, chips, pickers) on Düsseldorf
// traffic; the procedures and judgement lessons are Düsseldorf's own: the entry fixes and their RNAV
// transitions with "expect ILS" and the shortcut off the downwind, the holds on the downwinds, the 5,000 ft
// transition altitude, departures that Tower launches without a release, the dependent parallels and their
// wake rule, runway 05, and the 06:00 departure wave when the night restriction ends. Facts:
// src/pack/eddl.ts and docs/REALISM-EDDL.md.
import type { Game } from '../game';
import type { Sim } from '../../engine/sim';
import type { Item } from '../../engine/clearance';
import { assess, GRADE_NAMES } from '../../engine/assess';
import { autoControl } from '../../engine/autopilot';
import { suggest } from '../../engine/suggest';
import { alongTrack, dist } from '../../geo';
import {
  A, D, G, K, WHY, LVL, flow, sg, halo, scFactory, type Lesson,
  find, isCalling, calling, sentTo, sentAny, staged, heardFrom, isLvl, gone, landed, fmtLvl, mmss, towerWhenEstablished, acc, dueTower, tlText, offCl,
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
      body: (g) => `This is the Düsseldorf arrival sector of Langen Radar on ${K('128.555')}. In the real room it is two positions, a pickup who takes the arrivals from the centre and a feeder who lines them up on the final; here you work both. Langen ACC hands you arrivals at four entry fixes, you work them down the published RNAV transitions to the final, and the departures that Düsseldorf Tower (${g.sim.twr.freq}) launches call you passing 2,000 ft. The clock is stopped: look around.`,
      onEnter: (g) => { for (let k = 0; k < 3; k++) g.sim.step(); g.scope.fit(); haloOn(g); },
    },
    {
      id: 'bikmu', title: 'Tap BIKMU',
      body: `The entry fixes are the corners of your picture: ${K('BIKMU')} south-west, ${K('DOMUX')} east, ${K('HALME')} north-east, ${K('PISAP')} north, and ${K('LMA')} west for the odd one. BIKMU is the busiest: everything from the south and west, and the Köln side. Find it and tap it. ${WHY('every BIKMU arrival crosses the field to the north downwind, over the departures: that crossing is where your eye goes first. There is no hold at BIKMU; when the sequence is full the arrivals hold on the downwind, at DL429 or DL409.')}`,
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
      body: (g) => `Germany uses a transition altitude of ${K('5,000 ft')}, higher than Belgium's. The transition level follows the QNH: ${K('FL060')} at 1014 hPa and above, FL070 from 977 to 1013, FL080 below. Today the QNH is ${g.sim.qnh}, so the transition level is ${K(tlText(g))}. Which is the lowest flight level you may use today?`,
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
      body: `One tap sends. ${WHY('the BIKMU23 transition crosses the field and comes back down the north downwind to REGNO, nearly 60 track miles. From FL100 it needs 7 × 3 plus 4 to slow down: 25 NM. It has miles in hand, so one step down now keeps it moving, and the transition with the next call tells the pilot where the rest of the descent goes.')}`,
      cs: 'EWG1AB', compact: true, el: halo('lvl', 'F080'),
      done: (g, x) => sentTo(g, x, 'EWG1AB', isLvl((ft) => ft < 10000, g.sim)),
    },
    {
      id: 'readback', title: 'Listen to the readback', run: 1,
      body: `The grey card under the bar holds what you said and turns green when the ${G('Readback')} matches. Your first answer opens with the callsign and ${K('Langen Radar')}, without "identified": the centre identified it before the transfer. No QNH yet: that comes with the first altitude, below the transition level.`,
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
      for (const cs of ['EWG1AB', 'CFG2PL', 'THY5MK']) if (callingClear(sim, cs) && sim.t - sim.find(cs)!.awaitingSince! >= 3 && once(cs, true)) { const a = sim.find(cs)!; const s = suggest(sim, a).find((x) => x.label.startsWith('Descend')); say(cs, s?.items ?? [{ k: 'lvl', lvl: sim.levelFor(sim.ftOf(a.cflSys ?? a.cleared) - 2000) }], 'Oldest caller first, with its next level down.'); }
    },
  },
};

// =====================================================================================
// PROCEDURES
// =====================================================================================

/** the chip with this label prefix, when it is the bright one */
const leadIs = (sim: Sim, cs: string, prefix: string) => !!leadOf(sim, cs)?.label.startsWith(prefix);

// ---- 3. The RNAV transitions
const L_TRANSITIONS: Lesson = {
  id: 'eddl-transitions', icao: 'EDDL', stage: 'procedures', title: 'The RNAV transitions', minutes: 8, comps: ['SPP', 'TRAF'],
  summary: 'BIKMU23 with FL060 and "expect ILS 23R": the transition is the longest way in. Off the downwind with "direct REGNO" and the approach clearance as soon as the sequence allows.',
  scenario: sc('transitions', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 18)], { runway: '23R' }),
  steps: [
    {
      id: 'wait', title: 'EWG1AB over BIKMU at FL100', run: 2,
      body: `The published ${G('Transition', 'transition')} ${K('BIKMU23')} runs BIKMU, DL426, DL429, DL430, REGNO: across the field to the north, up a downwind on the north side and back down to the 23R final, nearly 60 track miles. The chart calls it an "overlay to the radar vector pattern" and says ${K('on downwind expect vectors to final')}. ${WHY('the transition is the longest way the aircraft will fly, not the plan. It gives the crew a route for the FMS and a fallback if the radio fails; you shorten it as soon as the sequence lets you.')}`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      focus: { fix: 'DL429', scale: 7 }, mark: { cs: 'EWG1AB' }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'lead', title: 'Tap the lead chip: BIKMU23 · FL060 · expect ILS 23R',
      body: `Transition, ${K('FL060')} and ${K('expect ILS approach runway 23R')} in one call. ${WHY('the first leg crosses the field where every SID climbs to 5,000 ft: FL060 keeps your arrival 1,000 ft above them. "Expect" lets the crew brief the ILS now; the approach clearance itself comes later, when you know where it fits in the sequence.')}`,
      cs: 'EWG1AB', el: '.sg.lead',
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'trans') && sentTo(g, x, 'EWG1AB', (it) => it.k === 'expect'),
    },
    {
      id: 'speed', title: 'Do you need to say 220 kt?',
      body: `The chart says 220 kt from DL426. The pilot is at 250 kt. Do you need to assign the speed?`,
      ask: { options: ['Yes: assign 220 kt now', 'No: the published speed is part of the transition'], correct: 1, why: 'A published speed restriction stays with the procedure; the pilot flies it without being told. You assign a speed only when you want something different, and a speed of your own cancels the published one from then on.' },
    },
    {
      id: 'short', title: 'On the downwind: Direct REGNO · 3000 · ILS 23R', run: 4, cs: 'EWG1AB', el: sg('Direct REGNO'),
      body: (g) => { const a = find(g, 'EWG1AB'); return `${a ? `Now ${fmtLvl(g.sim, a.alt)}, next ${a.route[0]?.fix ?? 'the final'}. ` : ''}Nobody is ahead of it, so it need not fly out to DL430 and back. When the ${K('Direct REGNO')} chip turns bright, tap it: direct to the final approach fix, down to 3,000 ft, cleared for the ILS. ${WHY('from the downwind abeam DL429 the line to REGNO meets the final at about 20 degrees, an easy join; it saves some 12 track miles, three minutes. The chip waits until it meets the final at 40 degrees or less, with 3 NM for every 1,000 ft to lose.')}`; },
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'dct' && it.fix === 'REGNO'),
    },
    {
      id: 'watch', title: 'Watch it join the final', run: 4, cs: 'EWG1AB',
      body: (g) => { const a = find(g, 'EWG1AB'); return `${a ? `Now ${fmtLvl(g.sim, a.alt)}, ${Math.round(a.ias)} kt. ` : ''}Line 4 of the label reads ${K('LOC23R')} when it captures the localizer at REGNO. Skip ahead if you like.`; },
      done: (g) => !!find(g, 'EWG1AB')?.app?.locCap, until: (g) => !!find(g, 'EWG1AB')?.app?.locCap,
    },
    {
      id: 'twr', title: 'Established: 160 to 4 · Tower', run: 1, cs: 'EWG1AB', el: sg('160'),
      body: `Slow it to 160 kt until 4 NM and hand it to Düsseldorf Tower, 118.305, in one call. ${WHY('at 220 kt it would arrive at 4 NM too fast to be stable; 160 kt to 4 NM is what Tower expects on a dependent parallel final.')}`,
      done: (g) => gone(g.sim, 'EWG1AB') || landed(g.sim, 'EWG1AB'),
    },
    {
      id: 'wrap', title: 'Expect first, clear later',
      body: `On first contact: the transition, a level and "expect ILS". On the downwind: the shortcut when the sequence allows, or the descent and the approach clearance together before the base. The exam adds a second arrival from HALME, which joins the same downwind: only one of them can be first.`,
    },
  ],
  exam: {
    title: 'BIKMU and HALME', run: 2, limitS: 2100,
    brief: 'EWG1AB from BIKMU and RYR8CD from HALME, both for 23R on the north downwind. Clear each one its transition with a level and "expect ILS", take the first off the downwind early, keep the second behind it, and hand both to Tower established.',
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

// ---- 4. Holding on the downwind
const L_STACK: Lesson = {
  id: 'eddl-stack', icao: 'EDDL', stage: 'procedures', title: 'Holding on the downwind', minutes: 9, comps: ['SPP', 'TRAF'],
  summary: 'The holds are on the downwinds, not at the entry fixes: DL429 and DL409 for 23, DL524 and DL503 for 05, 4,000 ft to FL070. Two meet at DL426: the second holds at DL429 and leaves on the shortcut when the first is established.',
  scenario: sc('stack', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20), A(30, 'DLH4KT', 'A321', 'HALME1A', 20)], { runway: '23R' }),
  steps: [
    {
      id: 'wait', title: 'Where Düsseldorf holds', run: 2,
      body: `The transition charts publish no hold at the entry fixes (BIKMU, DOMUX, HALME, PISAP). The approach holds are on the downwinds: ${K('DL429')} on the north and ${K('DL409')} on the south downwind for runway 23, ${K('DL524')} and ${K('DL503')} for 05, all 4,000 ft to FL070 at 220 kt. When it is busier still, Langen ACC holds the arrivals before it hands them over, at NVO and ELDAR for BIKMU and DOMEG for HALME. ${WHY('a hold on the downwind keeps the aircraft on its own transition, close to the final: when the gap opens it is minutes from the localizer, not 30 miles.')}`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      focus: { fix: 'DL429', scale: 7 }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'first', title: 'EWG1AB: its lead chip',
      body: `Transition, FL060 and "expect ILS 23R" for the first one.`,
      cs: 'EWG1AB', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'trans'),
    },
    { id: 'second', title: 'DLH4KT from HALME will call', run: 2, body: 'HALME23 joins the same downwind at DL426.', mark: { cs: 'DLH4KT' }, done: (g) => calling(g, 'DLH4KT') },
    {
      id: 'merge', title: 'DLH4KT: its lead chip',
      body: (g) => { const s = leadOf(g.sim, 'DLH4KT'); return `The chip reads ${K(s?.label ?? 'HALME23 · FL070 · expect ILS 23R')}. ${WHY('the two transitions meet at DL426 within a few minutes of each other, so the chip keeps them 1,000 ft apart until one is behind the other on the downwind.')}`; },
      cs: 'DLH4KT', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'DLH4KT', (it) => it.k === 'trans'),
    },
    {
      id: 'where', title: 'Where does DLH4KT wait?',
      body: `It will reach the downwind a minute or two behind EWG1AB, too close for the final. Where do you hold it?`,
      ask: { options: ['At HALME', 'At DL429, on its own transition', 'At DUS'], correct: 1, why: 'DL429 is the published hold on the north downwind and lies on its transition: "hold at DL429 as published". HALME has no published hold, and DUS is the missed approach hold over the field, where the departures climb.' },
    },
    {
      id: 'hold', title: 'Tap HOLD in the halo, then transmit',
      body: `${K('HOLD')} in the halo stages a hold at ${K('DL429')}, the stack on its transition. It already has its own level, FL070, inside the hold's band, so transmit it as it is. The phrase carries an expected approach time (${G('EFC')}). It flies its transition to DL429 and holds there.`,
      cs: 'DLH4KT',
      el: (g) => (g.items.some((i) => i.k === 'hold') ? g.root.querySelector('[data-a="send"]') : g.root.querySelector('.halo [data-halo="more"][data-v="hold"]') ?? g.root.querySelector('[data-p="more"]')),
      done: (g, x) => sentTo(g, x, 'DLH4KT', (it) => it.k === 'hold' && it.fix === 'DL429'),
    },
    {
      id: 'short', title: 'EWG1AB: Direct REGNO when the chip is bright', run: 4, cs: 'EWG1AB', el: sg('Direct REGNO'),
      body: `The first one goes straight in: direct REGNO, 3,000 ft, cleared ILS 23R. Skip ahead if you like.`,
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'app'), until: (g) => leadIs(g.sim, 'EWG1AB', 'Direct') || leadIs(g.sim, 'EWG1AB', 'Descend'),
    },
    {
      id: 'gap', title: 'Wait until EWG1AB shows LOC23R', run: 4,
      body: `Release the holder only once the first is established, or they arrive at REGNO together. Skip ahead if you like.`,
      mark: { cs: 'EWG1AB' }, done: (g) => { const a = find(g, 'EWG1AB'); return !a || !!a.app?.locCap; }, until: (g) => { const a = find(g, 'EWG1AB'); return !a || !!a.app?.locCap; },
    },
    {
      id: 'release', title: 'Tap DLH4KT’s “Leave hold” chip', run: 1,
      body: `Out of the hold on the shortcut: direct REGNO, down to 3,000 ft and cleared for the ILS, in one call. ${WHY('from DL429 the line to REGNO meets the final at 20 degrees and gives it 13 NM to get down from the stack.')}`,
      cs: 'DLH4KT', el: sg('Leave hold'), done: (g, x) => sentTo(g, x, 'DLH4KT', (it) => it.k === 'app'),
      until: (g) => leadIs(g.sim, 'DLH4KT', 'Leave hold'),
    },
    {
      id: 'twr', title: 'Both to Tower when established', run: 4,
      body: `Hand each to Tower with its chip when line 4 reads LOC23R. Skip ahead if you like.`,
      done: (g) => ['EWG1AB', 'DLH4KT'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      until: (g) => ['EWG1AB', 'DLH4KT'].some((cs) => dueTower(g.sim, cs)),
    },
    {
      id: 'wrap', title: 'The hold is on the downwind',
      body: `Hold on the downwind of the transition the aircraft flies, 1,000 ft apart, lowest leaves first, on the shortcut when the gap is there. A hold at an entry fix is not published: if you need one, give the inbound track and the turns. The exam puts three into one gap.`,
    },
  ],
  exam: {
    title: 'Three into one', run: 2, limitS: 2400,
    brief: 'Three arrivals for the north downwind: two from BIKMU close together and one from PISAP. Get all three established on 23R and to Tower. Hold whoever has to wait at DL429, 1,000 ft apart.',
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
  summary: 'Tower launches on the SIDs without asking; the crew calls you passing 2,000 ft. Climb to the agreed level, hand on by the exit. A release only when it is needed: after a go-around, in fog, and for the southern exits while the Köln agreement is in force.',
  scenario: sc('departures', [A(1, 'CFG7HD', 'B752', 'DOMUX1A', 16), D(100, 'EWG2KL', 'A320', 'MEVEL4T'), A(620, 'KLC41X', 'E190', 'BIKMU1A', 30), D(300, 'DLH9PA', 'A321', 'COL6T')], { neighbourBusy: true }),
  steps: [
    {
      id: 'arr', title: 'No routine releases at Düsseldorf', run: 2,
      body: `Single runway today: 23L lands and departs. CFG7HD comes from DOMUX; when it calls, the coach clears it. Every Düsseldorf ${G('SID')} climbs to ${K('5,000 ft')} and says: remain with Tower until passing 2,000 ft, then contact Langen Radar 121.355. Tower launches on the SIDs into the gaps it sees on the final; it asks for your ${G('Release', 'release')} only after a ${G('Go-around', 'go-around')} (for five minutes), in low visibility, and, while Köln/Bonn is busy and its agreement is in force, for the southern exits off 23. Today the Köln agreement is in force.`,
      onEnter: (g) => haloOn(g),
      mark: { cs: 'CFG7HD' },
      done: (g) => { const c = find(g, 'CFG7HD'); if (c && isCalling(g.sim, 'CFG7HD') && !c.proc?.endsWith('23') && !g.sim.readbackPending('CFG7HD')) { const s = leadOf(g.sim, 'CFG7HD'); if (s) g.sim.issue({ cs: 'CFG7HD', items: s.items }); } return calling(g, 'EWG2KL'); },
    },
    {
      id: 'climb', title: 'EWG2KL calls: tap “Climb FL100”',
      body: (g) => `Nobody asked you for EWG2KL: Tower launched it on MEVEL4T and it calls you passing 2,000 ft. ${K('FL100')} is the agreed level for departures off runway 23 (FL080 off 05, where the SIDs cross the arrivals from the east). ${WHY('the climb is checked along the SID as it will be flown, turns included: MEVEL turns north, away from the arrivals, so there is nothing to wait for. A departure towards an arrival would stay at 5,000 ft until they had passed.')}`,
      cs: 'EWG2KL', el: sg('Climb'), done: (g, x) => sentTo(g, x, 'EWG2KL', (it) => it.k === 'lvl'),
    },
    {
      id: 'release', title: 'Tower asks for DLH9PA on COL6T: tap “After CFG7HD”', run: 2,
      body: `COL6T goes south across the BIKMU arrivals into the Köln sector, so with the Köln agreement in force Tower needs your release. CFG7HD is on its way to the same runway: ${K('After CFG7HD')}. ${WHY('on a single runway a departure that rolls in front of a landing aircraft forces the go-around; one that rolls after it has lost nothing.')}`,
      cs: 'DLH9PA', el: (g) => g.root.querySelector('.icom [data-rel="DLH9PA"][data-v^="after"]') ?? g.root.querySelector('.icom [data-rel="DLH9PA"]'),
      done: (g) => g.sim.releases.some((r) => r.cs === 'DLH9PA' && r.state !== 'pending') || !!find(g, 'DLH9PA'),
      until: (g) => g.sim.releases.some((r) => r.cs === 'DLH9PA' && r.state === 'pending'),
    },
    {
      id: 'bottrop', title: 'EWG2KL to Langen Radar Bottrop', run: 2, cs: 'EWG2KL', el: (g) => sg(acc(g))(g),
      body: (g) => `The ${K(acc(g))} chip appears once it is above 7,000 ft or 18 NM out. The sector that takes a departure depends on its exit: MEVEL and SONEB go to Bottrop (${g.sim.acc.freq}), the southern and western exits to Nörvenich, the eastern ones to Paderborn. The chip picks the right one; its text says which.`,
      done: (g) => gone(g.sim, 'EWG2KL'), until: (g) => { const a = find(g, 'EWG2KL'); return !a || Math.hypot(a.p.x, a.p.y) > 18 || a.alt > 7000; },
    },
    {
      id: 'cfg', title: 'CFG7HD to Tower when established', run: 2, cs: 'CFG7HD', el: sg('Tower'),
      body: `Hand CFG7HD to Tower with its chip once it shows LOC23L; DLH9PA rolls behind it. Skip ahead if you like.`,
      done: (g) => gone(g.sim, 'CFG7HD') || landed(g.sim, 'CFG7HD'), until: (g) => dueTower(g.sim, 'CFG7HD'),
    },
    {
      id: 'klc', title: 'KLC41X calls: answer it', run: 2,
      body: `A KLM Cityhopper Embraer ("City") from BIKMU. Its lead chip.`,
      cs: 'KLC41X', noAutoSelect: true, mark: { cs: 'KLC41X' },
      el: (g) => (g.cs === 'KLC41X' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'KLC41X'), until: (g) => calling(g, 'KLC41X'),
    },
    {
      id: 'dlh', title: 'DLH9PA: climb, then Nörvenich', run: 4, cs: 'DLH9PA',
      body: (g) => `When it calls passing 2,000 ft: its climb chip (or a roger while an arrival is in the way), then ${K(acc(g))} before the boundary: COL goes to Nörvenich. Skip ahead if you like.`,
      el: (g) => sg('Climb')(g) ?? sg(acc(g))(g),
      done: (g) => g.sim.departuresHandled >= 2, until: (g) => calling(g, 'DLH9PA'),
    },
    {
      id: 'wrap', title: 'Tower launches, you climb and hand on',
      body: `No release unless it is needed: after a go-around, in fog, or for the exits a neighbour's agreement covers. The departures call you passing 2,000 ft: climb them to the agreed level when the SID is clear of the arrivals, hand them on by their exit. The exam is the 06:00 opening with the Köln agreement in force.`,
    },
  ],
  exam: {
    title: 'The 06:00 departures', run: 2, limitS: 900,
    brief: 'Just after 06:00 local the curfew lifts. EWG2KL leaves on MEVEL4T, which needs no release; DLH9PA on KUMIK7T is a southern exit and the Köln agreement is in force, so Tower asks you. CFG7HD is inbound from DOMUX. Climb both departures when clear, hand them on, handle CFG7HD.',
    rule: '<b>Pass:</b> the release answered within 60 s, both departures handed on inside your sector, no loss of separation. <b>Stars:</b> a quick release and no conflict alert.',
    scenario: sc('departures-exam', [A(2, 'CFG7HD', 'B752', 'DOMUX1A', 26), D(10, 'EWG2KL', 'A320', 'MEVEL4T'), D(60, 'DLH9PA', 'A321', 'KUMIK7T')], { seed: 17, startUtc: '05:02', neighbourBusy: true }),
    watch: (sim, m) => {
      m.relWait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.relWait[r.cs] = sim.t - r.t;
    },
    status: (sim) => `${sim.releases.filter((r) => r.state === 'pending').length} release request${sim.releases.filter((r) => r.state === 'pending').length === 1 ? '' : 's'} waiting · ${sim.departuresHandled} of 2 handed on`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'exit_unxfr', 'airspace', 'release_delay', 'mva'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.relWait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `Tower waited ${Math.round(slow[1])} s for a release for ${slow[0]}. Answer the intercom card within a minute.` };
      if (sim.departuresHandled < 2) return undefined;
      const waits = Object.values((m.relWait ?? {}) as Record<string, number>);
      const quick = waits.every((w) => w <= 20);
      return { pass: true, stars: quick && !sim.events.some((e) => e.kind === 'stca') ? 3 : quick ? 2 : 1, why: `Both departures handed on${waits.length ? `; the release answered in ${waits.map((w) => `${Math.round(w)} s`).join(' and ')}` : ''}.` };
    },
    solution: (sim, once, say) => {
      for (const r of sim.releases) if (r.state === 'pending' && once('rel' + r.cs, sim.t - r.t > 4)) say(r.cs, [{ k: 'rel' }], 'A southern exit under the Köln agreement: release it, nothing is on final.');
      const q = sim.find('CFG7HD');
      if (q && once('q', callingClear(sim, 'CFG7HD'))) { const s = leadOf(sim, 'CFG7HD'); say('CFG7HD', s?.items ?? [{ k: 'lvl', lvl: { fl: 100 } }], 'The arrival gets its transition and "expect ILS": it comes in from the east.'); }
      for (const cs of ['EWG2KL', 'DLH9PA']) {
        const a = sim.find(cs); if (!a || a.state !== 'assumed' || sim.readbackPending(cs)) continue;
        const s = leadOf(sim, cs);
        if (s && s.items.some((i) => i.k === 'lvl') && once('cl' + cs, true)) say(cs, s.items, 'Climb to the agreed level: the SID is clear of the arrivals.');
        else if (s && s.items.some((i) => i.k === 'xfr') && once('acc' + cs, true)) say(cs, s.items, 'Hand it to the sector its exit belongs to, before the boundary.');
        else if (once('id' + cs, callingClear(sim, cs))) say(cs, [{ k: 'roger' }], 'Identified: the climb comes when the arrival is past.');
      }
      if (once('ackq', !!q && callingClear(sim, 'CFG7HD') && !!q.proc && q.proc.endsWith('23'))) say('CFG7HD', [{ k: 'roger' }]);
      const c = sim.find('CFG7HD');
      if (c && c.state === 'assumed' && !sim.readbackPending('CFG7HD') && !c.app?.locCap) { const s = leadOf(sim, 'CFG7HD'); if (s && s.items.some((i) => i.k === 'app') && once('app', true)) say('CFG7HD', s.items, 'On the downwind: the approach clearance with the descent.'); }
      towerWhenEstablished(sim, once, say);
    },
  },
};

// ---- 6. Parallel runways
const L_PARALLEL: Lesson = {
  id: 'eddl-parallel', icao: 'EDDL', stage: 'procedures', title: 'Parallel runways', minutes: 8, comps: ['SEPC', 'CORD', 'SPP'],
  summary: 'The northern runway lands, the southern departs. The runways are 500 m apart: 2.5 NM between alternating approaches inside 10 NM only when no wake minimum applies, and in fog they are one runway.',
  scenario: sc('parallel', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 16), A(240, 'TUI3LK', 'B738', 'PISAP1A', 22), D(150, 'DLH9PA', 'A321', 'MODRU2T')], { runway: '23R' }),
  steps: [
    {
      id: 'intro', title: 'North lands, south departs', run: 2,
      body: `Parallel operations: arrivals land on ${K('23R')}, departures roll on ${K('23L')}. The centrelines are only 500 m apart, closer than the 760 m that would make them independent, so the approaches are dependent: ${K('2.5 NM')} between alternating approaches to the two runways inside 10 NM, ${K('provided no wake separation applies')} (AD 2.22). Departures roll on 23L without waiting for the landings on 23R. ${WHY('the 56 hours a week the northern runway may be used are the hours that make the morning and evening peaks work.')}`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      mark: { cs: 'EWG1AB' }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'wake', title: 'A320 behind an A330, one on each runway',
      body: `An A330 (heavy) is 4 NM from the 23R threshold; an A320 follows it on the 23L final. What does the A320 need?`,
      ask: { options: ['2.5 NM: different runways', '5 NM: the wake minimum behind a heavy', '3 NM'], correct: 1, why: 'Runways closer than 760 m are one runway for wake turbulence: the A330\'s wake can drift onto the other final. Düsseldorf uses the ICAO categories, 5 NM for a medium behind a heavy. The 2.5 NM diagonal is only for pairs that need no wake separation.' },
    },
    {
      id: 'first', title: 'EWG1AB: lead chip, BIKMU23 and expect ILS 23R',
      body: `"Expect ILS approach runway 23R": the pilot sets the northern localizer, IDNW 109.30.`,
      cs: 'EWG1AB', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'expect' && it.rwy === '23R'),
    },
    {
      id: 'second', title: 'TUI3LK from PISAP: its lead chip too', run: 2,
      body: `PISAP23 brings it onto the same north downwind behind EWG1AB.`,
      cs: 'TUI3LK', noAutoSelect: true, mark: { cs: 'TUI3LK' },
      el: (g) => (g.cs === 'TUI3LK' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'TUI3LK'), until: (g) => calling(g, 'TUI3LK'),
    },
    {
      id: 'dep', title: 'DLH9PA calls: climb FL100', run: 2, cs: 'DLH9PA', el: sg('Climb'),
      body: `Tower launched it on 23L while EWG1AB was still on the downwind: no release, the runways are independent for a departure against a landing on the other one. It calls passing 2,000 ft. Its climb chip, or a roger while an arrival is in the way.`,
      done: (g, x) => sentTo(g, x, 'DLH9PA'), until: (g) => calling(g, 'DLH9PA'),
    },
    {
      id: 'ewg', title: 'EWG1AB: off the downwind', run: 4, cs: 'EWG1AB', el: '.sg.lead',
      body: `When its lead chip turns bright, tap it: the shortcut or the approach clearance with the descent.`,
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'app'), until: (g) => !!leadOf(g.sim, 'EWG1AB')?.items.some((i) => i.k === 'app'),
    },
    {
      id: 'twr1', title: 'EWG1AB established: 160 to 4 · Tower', run: 4, mark: { cs: 'EWG1AB' }, el: sg('160'),
      onEnter: (g) => { if (find(g, 'EWG1AB')) g.select('EWG1AB', true); },
      body: `Hand it to Tower established; Tower works both runways. Hand DLH9PA to ${'Nörvenich'} with its chip before it leaves your airspace.`,
      done: (g) => gone(g.sim, 'EWG1AB') || landed(g.sim, 'EWG1AB'), until: (g) => dueTower(g.sim, 'EWG1AB'),
    },
    {
      id: 'twr2', title: 'TUI3LK: its approach, then Tower', run: 4, cs: 'TUI3LK', el: '.sg.lead',
      body: `And the second arrival: its lead chips as they come. Skip ahead if you like.`,
      done: (g) => gone(g.sim, 'TUI3LK') || landed(g.sim, 'TUI3LK'), until: (g) => dueTower(g.sim, 'TUI3LK') || !!leadOf(g.sim, 'TUI3LK'),
    },
    {
      id: 'wrap', title: 'Two runways, one sequence',
      body: `Arrivals on the north, departures on the south, no releases for them. Between the two finals: 2.5 NM only when no wake minimum applies; in fog, 23L and 23R are one runway. The exam mixes three arrivals with two departures.`,
    },
  ],
  exam: {
    title: 'North lands, south departs', run: 2, limitS: 2400,
    brief: 'Three arrivals for 23R from BIKMU, PISAP and HALME, one of them a heavy A330, and two departures from 23L, which Tower launches on its own. Land everyone with the wake gaps intact, climb the departures and hand them on.',
    rule: '<b>Pass:</b> all three arrivals with Tower or landed, both departures handed on, no loss of separation, no wake infringement. <b>Stars:</b> no conflict alerts.',
    scenario: sc('parallel-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20, { callNow: true }), A(90, 'TUI3LK', 'B738', 'PISAP1A', 24), A(200, 'THY5MK', 'A332', 'HALME1A', 26), D(60, 'DLH9PA', 'A321', 'MODRU2T'), D(300, 'EWG2KL', 'A320', 'MEVEL4T')], { seed: 41, runway: '23R' }),
    status: (sim) => `${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 3 arrivals · ${sim.departuresHandled} of 2 departures handed on`,
    judge: (sim) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'release_delay', 'goaround'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const arrDone = ['EWG1AB', 'TUI3LK', 'THY5MK'].every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred');
      if (!arrDone || sim.departuresHandled < 2) return undefined;
      const stca = sim.events.some((e) => e.kind === 'stca');
      return { pass: true, stars: !stca ? 3 : 2, why: `Everyone handled${stca ? ', with a conflict alert' : ' with no conflict alerts'}.` };
    },
    solution: (sim) => autoControl(sim),
  },
};

// ---- 7. Runway 05
const L_RUNWAY05: Lesson = {
  id: 'eddl-runway05', icao: 'EDDL', stage: 'procedures', title: 'Runway 05', minutes: 9, comps: ['SPP', 'CORD'],
  summary: 'An easterly: the supervisor turns the airport round with ten minutes of notice. The 05 transitions end at DIKMI and NATOS, the holds are DL524 and DL503, the departures stop at FL080.',
  scenario: sc('runway05', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 34), A(700, 'RYR8CD', 'B738', 'HALME1A', 26)], { runway: '23R', events: [{ t: 30, kind: 'runway', rwy: '05L', notice: 600 }] }),
  steps: [
    {
      id: 'notice', title: 'SUP: runway change to 05L', run: 2,
      body: `The wind is backing east. A change of direction is coordinated with Tower, Langen ACC and Köln at least ten minutes ahead, and the supervisor announces it on the intercom: after it, arrivals not yet on the approach go via the 05 transitions and departures get the 05 SIDs. Runway 05L is the northern runway, so parallel operations continue the other way round: 05L lands, 05R departs. Which arrivals keep 23R?`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      ask: { options: ['All of them', 'Only those established on the ILS 23R', 'None'], correct: 1, why: 'An aircraft established on the localizer continues to the old runway. Everyone else is re-cleared, and the supervisor names them when the change happens.' },
      done: (g) => !!g.sim.rwyChange || !!g.sim.lastRwyChange,
    },
    {
      id: 'ewg', title: 'EWG1AB calls: a level only', run: 2,
      body: `Answer with a level, not the transition: ${K('Descend FL080')} or the ladder. ${WHY('a BIKMU23 clearance now is one you cancel in ten minutes; a level costs nothing to keep. The 05 transition from BIKMU runs up the west side of the field, about the same miles.')}`,
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
      id: 'reclear', title: 'EWG1AB: its lead chip for 05L', run: 2,
      body: (g) => { const s = leadOf(g.sim, 'EWG1AB'); return `The lead chip now reads ${K(s?.label ?? 'BIKMU05 · expect ILS 05L')}. ${WHY('BIKMU05 runs north through RONAD, DL513 and IBIKO onto the west downwind, GAPNU, DL524, DL530, to the FAF DIKMI at 3,000 ft. The holds for 05 are DL524 on that downwind and DL503 on the south-east one.')}`; },
      cs: 'EWG1AB', el: '.sg.lead',
      onEnter: (g) => parallel(g),
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'trans' || (it.k === 'expect' && it.rwy === '05L')),
      until: (g) => !!leadOf(g.sim, 'EWG1AB'),
    },
    {
      id: 'ryr', title: 'RYR8CD from HALME: its lead chip for 05L', run: 2,
      body: `HALME05 runs south-west over BOMBA to the west downwind and DIKMI. Clear it when it calls.`,
      cs: 'RYR8CD', noAutoSelect: true, mark: { cs: 'RYR8CD' },
      el: (g) => (g.cs === 'RYR8CD' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'RYR8CD', (it) => it.k === 'trans' || it.k === 'lvl'), until: (g) => calling(g, 'RYR8CD'),
    },
    {
      id: 'land', title: 'Bring both in on 05L', run: 4,
      body: `Keep taking the lead chips as they come: the shortcut or the approach on the downwind, then Tower when established. Skip ahead if you like.`,
      done: (g) => ['EWG1AB', 'RYR8CD'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      until: (g) => ['EWG1AB', 'RYR8CD'].some((cs) => dueTower(g.sim, cs) || !!leadOf(g.sim, cs)),
    },
    {
      id: 'wrap', title: 'The airport turned round',
      body: `Same entry fixes, the other transitions, the other holds, the other SIDs and FL080 for the departures off 05. The exam does it with three arrivals and a departure.`,
    },
  ],
  exam: {
    title: 'Turn the airport round', run: 2, limitS: 3000,
    brief: 'Three arrivals and a departure. The supervisor calls a runway change to 05L with ten minutes’ notice: parallel operations the other way round. Re-clear whoever needs it, land everyone, climb the departure to FL080 and hand it on.',
    rule: '<b>Pass:</b> all three arrivals with Tower or landed, the departure handed on, every intercom request answered within a minute, no loss of separation. <b>Stars:</b> no conflict alert and no go-around.',
    scenario: sc('runway05-exam', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 26, { callNow: true }), A(240, 'RYR8CD', 'B738', 'HALME1A', 26), A(480, 'TUI3LK', 'B738', 'PISAP1A', 24), D(700, 'DLH9PA', 'A321', 'MODRU2T')], { seed: 24, runway: '23R', events: [{ t: 30, kind: 'runway', rwy: '05L', notice: 600 }] }),
    watch: (sim, m) => {
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
    solution: (sim) => autoControl(sim),
  },
};

// =====================================================================================
// JUDGEMENT
// =====================================================================================

// ---- 8. Sequencing onto 23R
const L_SEQUENCE: Lesson = {
  id: 'eddl-sequence', icao: 'EDDL', stage: 'judgement', title: 'Sequencing onto 23R', minutes: 10, comps: ['TRAF', 'SEPC', 'SITU'],
  summary: 'Three arrivals for one final: HALME23, BIKMU23 and PISAP23 all use the north downwind. Who goes first, who takes the shortcut, who stays on the downwind, and 5 NM behind the heavy.',
  scenario: sc('sequence', [A(2, 'THY5MK', 'A332', 'HALME1A', 26), A(20, 'EWG1AB', 'A320', 'BIKMU1A', 22), A(70, 'CFG2PL', 'B752', 'PISAP1A', 24)], { runway: '23R' }),
  steps: [
    {
      id: 'intro', title: 'Three fixes, one downwind', run: 2,
      body: `THY5MK, an A330 (heavy), over HALME; EWG1AB, an A320 (medium), over BIKMU; CFG2PL, a 757 (medium), over PISAP. HALME23, PISAP23 and BIKMU23 all meet at DL426 and use the ${K('north downwind')} (DL426, DL429, DL430); only DOMUX23 has the south one. The AMAN proposes an order from the track miles; you decide it. ${WHY('the A330 first: it is nearest. Düsseldorf uses the ICAO wake categories, so a medium behind a heavy needs 5 NM on final: the A320 and the 757 stay on the downwind until the gap is there, and speed on the downwind sets it.')}`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      focus: { fix: 'DL429', scale: 6 }, done: (g) => calling(g, 'THY5MK'),
    },
    {
      id: 'thy', title: 'THY5MK: lead chip',
      body: `HALME23, a level and "expect ILS 23R".`,
      cs: 'THY5MK', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'THY5MK', (it) => it.k === 'trans'),
    },
    {
      id: 'ewg', title: 'EWG1AB: lead chip when it calls', run: 2,
      body: (g) => { const s = leadOf(g.sim, 'EWG1AB'); return `${s ? `The chip reads ${K(s.label)}: ${s.why}` : 'Wait for its call.'} ${WHY('it will meet THY5MK at DL426, so it gets its own level 1,000 ft apart until one is behind the other.')}`; },
      cs: 'EWG1AB', noAutoSelect: true, mark: { cs: 'EWG1AB' },
      el: (g) => (g.cs === 'EWG1AB' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'EWG1AB'), until: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'cfg', title: 'CFG2PL: lead chip when it calls', run: 2,
      body: `The 757 is last. Its chip clears the transition with a level and "expect ILS"; it will follow the other two down the same downwind.`,
      cs: 'CFG2PL', noAutoSelect: true, mark: { cs: 'CFG2PL' },
      el: (g) => (g.cs === 'CFG2PL' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'CFG2PL'), until: (g) => calling(g, 'CFG2PL'),
    },
    {
      id: 'gap', title: 'Work the downwind: shortcut, speed, approach', run: 4,
      body: (g) => { const fin = g.sim.aircraft.filter((a) => a.app?.locCap).sort((a, b) => g.sim.dthr(a) - g.sim.dthr(b)); return `${fin.length >= 2 ? `Gap on final: ${(g.sim.dthr(fin[1]) - g.sim.dthr(fin[0])).toFixed(1)} NM. ` : ''}The first gets the shortcut; the others get a speed on the downwind, or a hold at DL429, and the approach clearance with the descent when their turn comes. Hand each to Tower established. Skip ahead if you like.`; },
      done: (g) => ['THY5MK', 'EWG1AB', 'CFG2PL'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      until: (g) => ['THY5MK', 'EWG1AB', 'CFG2PL'].some((cs) => dueTower(g.sim, cs) || !!leadOf(g.sim, cs)),
    },
    {
      id: 'result', title: 'Result',
      body: (g) => { const s = g.sim.spacing; const wake = g.sim.events.some((e) => e.kind === 'wake'); return wake ? 'A follower got inside its wake minimum on final. Slow it on the downwind, before the base.' : s.length ? `Gaps at touchdown: ${s.map((x) => `${x.follower} ${x.gap.toFixed(1)} NM (min ${x.min})`).join(', ')}. Real units aim for the minimum plus half a mile.` : 'All three down.'; },
    },
  ],
  exam: {
    title: 'Four from three fixes', run: 2, limitS: 2700,
    brief: 'Four arrivals for 23R: from HALME, BIKMU, PISAP and BIKMU again, the first a heavy. Build the sequence: transitions with "expect ILS", the shortcut for the first, speed or the downwind hold for the others. Land everyone with the wake gaps intact.',
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
  summary: 'A wrong readback caught on the card, then a MAYDAY from the north-east: direct to the final of 23L, the longer runway, and everyone else out of the way.',
  scenario: sc('emergency', [A(2, 'EWG1AB', 'A320', 'BIKMU1A', 20), A(300, 'UAE57', 'B77L', 'HALME1A', 26, { emergency: { after: 50, type: 'engine' } }), A(330, 'TUI3LK', 'B738', 'PISAP1A', 24)], { runway: '23R' }),
  steps: [
    {
      id: 'wait', title: 'A readback goes wrong', run: 2,
      body: `EWG1AB from BIKMU. Clear it when it calls, then listen: the pilot will read back the wrong level. The card under the bar and the top row of the queue both catch it.`,
      onEnter: (g) => { haloOn(g); parallel(g); g.sim.forceWrong.add('EWG1AB'); },
      mark: { cs: 'EWG1AB' }, done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'clear', title: 'Tap EWG1AB’s lead chip',
      body: `Its transition, FL060 and "expect ILS 23R", as usual.`, cs: 'EWG1AB', el: '.sg.lead',
      done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'lvl'),
    },
    {
      id: 'wrong', title: 'Listen to the readback', run: 1, cs: 'EWG1AB',
      body: `The card turns amber with what the pilot said; the label shows an amber ≠ with the level it set.`,
      done: (g) => !!find(g, 'EWG1AB')?.wrong && !g.sim.readbackPending('EWG1AB'),
    },
    {
      id: 'fix', title: 'Tap “Say again” on the card',
      body: `Thirty seconds. Say the level again, nothing else. ${WHY('a wrong level set in the FMS is flown; over the field, where the SIDs stop at 5,000 ft, that is how a loss of separation with a departure starts.')}`,
      cs: 'EWG1AB', el: (g) => g.root.querySelector('.rb [data-a="rb-fix"]') ?? g.root.querySelector('.att-row[data-cs="EWG1AB"] .att-go') ?? g.root.querySelector('.sg'),
      done: (g) => g.sim.events.some((e) => e.kind === 'readback_caught' && e.cs === 'EWG1AB'),
    },
    {
      id: 'mayday', title: 'Wait for the next arrival', run: 4,
      body: `UAE57, a 777 from HALME, and TUI3LK from PISAP are next. The coach answers UAE57's check-in for you. Take EWG1AB's lead chips as they come.`,
      done: (g) => { const u = find(g, 'UAE57'); if (u && !u.emergency && calling(g, 'UAE57') && !g.sim.readbackPending('UAE57') && u.txCount === 0) g.sim.issue({ cs: 'UAE57', items: [{ k: 'roger' }] }); return !!u?.emergency && calling(g, 'UAE57'); },
      until: (g) => !!find(g, 'UAE57')?.emergency || dueTower(g.sim, 'EWG1AB') || isCalling(g.sim, 'TUI3LK') || !!leadOf(g.sim, 'EWG1AB'),
    },
    {
      id: 'card', title: 'MAYDAY: tap the red card',
      body: `An engine has failed on the 777. The red card shows the ${G('MAYDAY')}, its distance and level. Tap it to select and centre it.`,
      cs: 'UAE57', noAutoSelect: true, el: '.emer-card .em', done: (g) => g.cs === 'UAE57',
    },
    {
      id: 'priority', title: 'Its lead chip: direct to the 23L final', cs: 'UAE57', el: '.sg.lead',
      body: `Direct to the intermediate fix, 3,000 ft and the ILS ${K('23L')}: the shortest way in, to the longer runway. ${WHY('23L is 3,000 m against 2,700 m on 23R, and a heavy with one engine out lands faster and longer. Tower stops the 23L departures; everyone else gets a level or a hold until it is down, and Tower has the fire service out.')}`,
      done: (g, x) => sentTo(g, x, 'UAE57', (it) => (it.k === 'app' && it.rwy === '23L') || it.k === 'dct'),
    },
    {
      id: 'others', title: 'Keep TUI3LK out of its way', run: 2,
      body: `TUI3LK from PISAP: its transition, a level and "expect ILS"; it stays on the north downwind while the 777 comes in.`,
      cs: 'TUI3LK', noAutoSelect: true, mark: { cs: 'TUI3LK' },
      el: (g) => (g.cs === 'TUI3LK' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'TUI3LK'), until: (g) => calling(g, 'TUI3LK'),
    },
    {
      id: 'land', title: 'UAE57 to Tower when established, then the rest', run: 4,
      body: `Hand the emergency to Tower established, then bring EWG1AB and TUI3LK in with their lead chips. Skip ahead if you like.`,
      done: (g) => ['UAE57', 'TUI3LK', 'EWG1AB'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      until: (g) => ['UAE57', 'TUI3LK', 'EWG1AB'].some((cs) => dueTower(g.sim, cs) || !!leadOf(g.sim, cs)),
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
      // the emergency comes first: its lead chip (direct to the 23L final), everyone else by the primary chips
      const em = sim.aircraft.find((a) => a.emergency && a.state === 'assumed');
      if (em && !sim.readbackPending(em.cs) && !sim.freqBusy()) {
        const s = suggest(sim, em)[0];
        if (s?.primary && !em.app && once('em' + em.cs, true)) { say(em.cs, s.items, 'MAYDAY: the shortest way to the final of the longer runway, and everyone else makes room.'); return; }
      }
      autoControl(sim);
    },
  },
};

// ---- 10. The 06:00 rush
const L_RUSH: Lesson = {
  id: 'eddl-rush', icao: 'EDDL', stage: 'judgement', title: 'The 06:00 rush', minutes: 10, comps: ['WORK', 'TRAF', 'CORD'],
  summary: 'The night restriction ends at 06:00 local and the based fleet leaves first: a departure every two minutes from 23L, the first arrivals of the day on 23R behind them. Climb, hand on, sequence, all at once.',
  scenario: sc('rush', [A(200, 'EWG1AB', 'A320', 'BIKMU1A', 22), D(500, 'EWG2KL', 'A320', 'MEVEL4T'), A(260, 'CFG7HD', 'B752', 'HALME1A', 26), D(620, 'DLH9PA', 'A321', 'MODRU2T'), A(400, 'UAE57', 'B77L', 'PISAP1A', 24)], { runway: '23R', startUtc: '04:52' }),
  steps: [
    {
      id: 'intro', title: 'Six o’clock', run: 2,
      body: (g) => `Local time ${String(Math.floor(g.sim.localHour())).padStart(2, '0')}:${String(Math.round((g.sim.localHour() % 1) * 60)).padStart(2, '0')}. No take-off before 06:00 local (AD 2.20): the based Eurowings and Condor fleet is lined up at the holding point and leaves first, about twenty departures in the first hour. The first arrivals of the day come in behind them; nobody has been holding overnight, landings were shut from 23:00. Parallel operations: 23R lands, 23L departs, and Tower launches without asking you.`,
      onEnter: (g) => { haloOn(g); parallel(g); },
      done: (g) => calling(g, 'EWG1AB'),
    },
    {
      id: 'first', title: 'EWG1AB: lead chip',
      body: `The first arrival of the day, from BIKMU: its transition, a level and "expect ILS 23R".`,
      cs: 'EWG1AB', el: '.sg.lead', done: (g, x) => sentTo(g, x, 'EWG1AB', (it) => it.k === 'trans'),
    },
    {
      id: 'cfg', title: 'CFG7HD from HALME: its lead chip', run: 2,
      body: `A 757 from the north-east onto the same downwind: its own level until it is in trail.`,
      cs: 'CFG7HD', noAutoSelect: true, mark: { cs: 'CFG7HD' },
      el: (g) => (g.cs === 'CFG7HD' ? g.root.querySelector('.sg.lead') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'CFG7HD'), until: (g) => calling(g, 'CFG7HD'),
    },
    {
      id: 'dep', title: 'EWG2KL calls passing 2,000 ft: climb it', run: 2, cs: 'EWG2KL', el: sg('Climb'),
      body: `06:00: Tower has launched the first departure on MEVEL4T. Its climb chip, or a roger while an arrival is in the way. ${WHY('the departures stop at 5,000 ft, the arrivals cross the field at FL060: that 1,000 ft is what lets both flows run at once.')}`,
      done: (g, x) => sentTo(g, x, 'EWG2KL'), until: (g) => calling(g, 'EWG2KL'),
    },
    {
      id: 'wave', title: 'Work the queue', run: 4,
      body: (g) => { const w = g.sim.callers().filter((a) => g.sim.t >= (a.awaitingSince ?? 0)); return `${w.length ? `${w.length} waiting: ${w.map((a) => a.cs).join(', ')}. ` : 'Nobody waiting. '}UAE57 from PISAP, DLH9PA airborne next, departures to climb and hand on by their exit, arrivals off the downwind and to Tower established. NEXT, action, card, round again. Skip ahead if you like.`; },
      done: (g) => ['EWG1AB', 'CFG7HD', 'UAE57'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)) && g.sim.departuresHandled >= 2,
      until: (g) => g.sim.callers().some((a) => g.sim.t >= (a.awaitingSince ?? 0)) || g.sim.aircraft.some((a) => dueTower(g.sim, a.cs)),
    },
    {
      id: 'wrap', title: 'The wave is over',
      body: `That is the first half hour after the night restriction: departures first, arrivals behind them. The exam is the full wave: five arrivals and three departures.`,
    },
  ],
  exam: {
    title: 'The first wave', run: 2, limitS: 40 * 60,
    brief: 'Forty minutes from 06:00 local: three departures leave first from 23L, five arrivals from four entry fixes land on 23R. Everyone lands, every departure is handed on, nobody loses separation.',
    rule: '<b>Pass:</b> all five arrivals with Tower or landed, all three departures handed on, no loss of separation, no wake infringement. <b>Stars:</b> no conflict alert and little holding.',
    scenario: sc('rush-exam', [D(480, 'EWG2KL', 'A320', 'MEVEL4T'), D(600, 'DLH9PA', 'A321', 'MODRU2T'), D(720, 'KLC41X', 'E190', 'SONEB8T'), A(200, 'EWG1AB', 'A320', 'BIKMU1A', 20, { callNow: true }), A(300, 'CFG7HD', 'B752', 'HALME1A', 26), A(420, 'UAE57', 'B77L', 'PISAP1A', 24), A(560, 'DLH4KT', 'A321', 'BIKMU1A', 30), A(700, 'TUI3LK', 'B738', 'PISAP1A', 24)], { seed: 61, runway: '23R', startUtc: '04:52', durationMin: 40 }),
    status: (sim) => `${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 5 arrivals · ${sim.departuresHandled} of 3 departures · ${mmss(40 * 60 - sim.t)} left`,
    judge: (sim) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'release_delay', 'goaround'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const css = ['EWG1AB', 'CFG7HD', 'UAE57', 'DLH4KT', 'TUI3LK'];
      if (!css.every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred') || sim.departuresHandled < 3) return undefined;
      const holdMin = css.reduce((s, cs) => s + (sim.landings.find((l) => l.cs === cs)?.holdSec ?? sim.find(cs)?.holdSec ?? 0), 0) / 60;
      const stca = sim.events.some((e) => e.kind === 'stca');
      return { pass: true, stars: !stca && holdMin <= 4 ? 3 : !stca || holdMin <= 8 ? 2 : 1, why: `The wave handled: ${holdMin.toFixed(1)} min of holding${stca ? ', one conflict alert' : ', no conflict alerts'}.` };
    },
    solution: (sim) => autoControl(sim),
  },
};

export const EDDL_LESSONS: Lesson[] = [L_PICTURE, L_CONTACT, L_TRANSITIONS, L_STACK, L_DEPARTURES, L_PARALLEL, L_RUNWAY05, L_SEQUENCE, L_EMERGENCY, L_RUSH];
void D; void LVL; void flow; void alongTrack; void offCl; void ILS; void TRANS; void staged; void sentAny; void heardFrom; void isLvl; void tlText; void mmss;
