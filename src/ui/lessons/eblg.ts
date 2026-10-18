// The Liège curriculum: fifteen lessons in three stages, each a scripted scenario in the real sim with a
// coach that points at the control to use and says why, then an exam without the coach. Geometry
// (callsigns, STARs, spawn distances, the fixes the chips name) is Liège's; the mechanics are the kit's.
import type { Game } from '../game';
import type { Sim } from '../../engine/sim';
import { levelText, type Item } from '../../engine/clearance';
import { assess, GRADE_NAMES } from '../../engine/assess';
import { hints } from '../../engine/hints';
import { remainNm } from '../../engine/autopilot';
import { autoControl } from '../../engine/autopilot';
import { suggest } from '../../engine/suggest';
import { alongTrack, dist, norm360 } from '../../geo';
import { attentionRows } from '../commands/attention';
import {
  A, D, G, K, WHY, LVL, SPD, MORE, flow, sg, att, halo, scFactory, type Lesson, type StepCtx,
  find, isCalling, calling, sentTo, sentAny, staged, heardFrom, heardAny, pickerKind, magHdg, inRange, isLvl, isHdg, offCl, alongFinal,
  gone, landed, pastFix, fmtLvl, costly, mmss, towerWhenEstablished, acc, twr, freq, app, dueTower, type Once, type Say,
} from './kit';

const sc = scFactory({ icao: 'EBLG', metar: 'EBLG 121405Z 22006KT 9999 FEW040 15/07 Q1018 NOSIG', runway: '22L', startUtc: '14:05' });
const ILS: Item = { k: 'app', app: 'ILS', rwy: '22L' };
const TRANS = (name: string, ft = 3000): Item[] => [{ k: 'trans', name }, { k: 'lvl', lvl: { ft } }, ILS];
/** the lead suggestion's items for an aircraft, as the chip would send them */
const leadOf = (sim: Sim, cs: string) => { const a = sim.find(cs); const s = a && suggest(sim, a)[0]; return s?.primary ? s : undefined; };
const callingClear = (sim: Sim, cs: string) => isCalling(sim, cs) && !sim.readbackPending(cs);

// =====================================================================================
// BASICS
// =====================================================================================

// ---- 1. The picture
const L_SCOPE: Lesson = {
  id: 'scope', icao: 'EBLG', stage: 'basics', title: 'The picture', minutes: 6, comps: ['SITU'],
  summary: 'What a controller looks at, and in what order. Zoom, the runway and the high ground, a label. Miles, levels, altitudes and QNH.',
  scenario: sc('scope', [A(1, 'QTR8125', 'B77L', 'KOK7X', 26), A(1, 'FDX5203', 'MD11', 'GESLO6X', 20)]),
  steps: [
    {
      id: 'intro', title: 'You are Liège Approach',
      body: (g) => `You work the radar for ${g.sim.pack.meta.name}: everything within about 40 ${G('NM')} and below ${G('FL', 'FL095')}. ${acc(g)} hands you arrivals, Tower hands you departures, and you hand them on. This lesson is a tour by doing. The clock is stopped, so take your time.`,
      onEnter: (g) => { for (let k = 0; k < 3; k++) g.sim.step(); g.scope.fit(); },
    },
    {
      id: 'scan', title: 'Where your eyes go',
      body: `A controller does not stare at the whole screen. The scan runs in a loop: ${K('NEXT')} at the top, who needs you and for how long they have waited; the ticker above the bar, what was last said; then every label once, is each one doing what you cleared; then the final, is the sequence holding together. Round again, every ten seconds or so. Everything in this course hangs on that loop. Which of these should you look at first when you sit down?`,
      ask: { options: ['The weather panel', 'NEXT: who is waiting for an answer', 'The map'], correct: 1, why: 'A pilot waiting is a pilot who may do the wrong thing in the meantime, and the next call is queueing behind. Answer first, then plan.' },
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
      body: `Runway 22L is in use. The dashed line running north-east from it is the final approach, with a tick every mile. Beside it, the gap ruler counts the miles. L22LF, 5.8 NM out, is where arrivals start down the 3° glidepath from 2,500 ft (the ${G('FAF')}). ${WHY('you plan every arrival backwards from that point: 2,500 ft there, 3,000 ft at LIBVA before it, and the miles it needs to get down.')}`,
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
const L_CONTACT: Lesson = {
  id: 'contact', icao: 'EBLG', stage: 'basics', title: 'First contact', minutes: 6, comps: ['COMM', 'WORK'],
  summary: 'Answer a pilot with a suggestion chip, then with the level grid. Readbacks and "how do you read".',
  scenario: sc('contact', [A(2, 'QTR8125', 'B77L', 'KOK7X', 26), A(45, 'AZG7321', 'B748', 'CIV7X', 30), A(100, 'ETH3721', 'B77L', 'NIK7X', 34)]),
  steps: [
    {
      id: 'wait', title: 'Traffic is coming', run: 2,
      body: (g) => `${acc(g)} has handed you QTR8125, a 777 freighter from the west. Its label flashes until the pilot calls you on ${freq(g)}.`,
      focus: { cs: 'QTR8125' }, mark: { cs: 'QTR8125' }, done: (g) => calling(g, 'QTR8125'),
    },
    {
      id: 'select', title: 'Answer it: tap NEXT (top bar)',
      body: `QTR8125 is calling. ${K('NEXT')} is the queue of who needs you; tap it and it selects the one who has waited longest. You can also tap the aircraft. ${WHY('in the real room the ear keeps that queue. Here the button does, so your eyes can stay on the picture.')}`,
      el: '[data-e="callers"]', cs: 'QTR8125', noAutoSelect: true, done: (g) => g.cs === 'QTR8125',
    },
    {
      id: 'chip', title: 'Tap the “Descend FL060” chip',
      body: `The bar now offers the calls a controller would most likely make. The bright one is the usual choice; here you only want it lower for now. One tap transmits. (Press and hold a chip instead to put it in the bar and edit it first.) ${WHY('FL060 is the lowest flight level above the transition level today, so the descent keeps going without a level-off and the pilot still flies on standard pressure.')}`,
      cs: 'QTR8125', el: sg('Descend'), done: (g, x) => sentTo(g, x, 'QTR8125', (it) => it.k === 'lvl'),
    },
    {
      id: 'readback', title: 'Listen to the readback', run: 1,
      body: `The pilot repeats your clearance: the ${G('Readback')}. It includes the ${G('QNH')}, because you gave the first altitude. Check level, callsign and numbers every time. The grey card under the bar is your memory of what you said; it turns green when the readback matches.`,
      cs: 'QTR8125', done: (g, x) => heardFrom(g, x, 'QTR8125'),
    },
    {
      id: 'next', title: 'Another arrival', run: 2,
      body: `QTR8125 is descending. Its label shows the cleared level after the arrow. AZG7321, a 747, will call next.`,
      mark: { cs: 'AZG7321' }, done: (g) => calling(g, 'AZG7321'),
    },
    {
      id: 'grid', title: 'Tap LVL, then FL070',
      body: `This time pick the level yourself. ${K('LVL')} opens the level grid: flight levels at the top, altitudes in feet below the transition level. The current and cleared levels are marked, and a red line shows the ${G('MVA')}. Choose ${K('FL070')}. ${WHY('a 747 at 30 NM has miles in hand; one step at a time keeps it above the departures climbing out to FL060.')}`,
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
      body: `Select it with ${K('NEXT')} and answer with a chip or the grid. Any descent will do.`,
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
      if (late || sim.events.some((e) => e.kind === 'unanswered')) return { pass: false, stars: 0, why: `${late?.[0] ?? 'A pilot'} waited more than 20 s. Use NEXT to jump to the next caller.` };
      if (sim.events.some((e) => e.kind === 'warning_sent')) return { pass: false, stars: 0, why: 'You transmitted a clearance with a warning showing. Read the amber text before you send.' };
      const done = css.every((cs) => { const a = sim.find(cs); return !!a && a.cflSys !== undefined && sim.ftOf(a.cflSys) < a.alt - 600 && sentAny(sim, 0, cs) && !isCalling(sim, cs) && !sim.readbackPending(cs); });
      if (!done) return undefined;
      const worst = Math.max(...css.map((cs) => (m.waits?.[cs] ?? 0)));
      return { pass: true, stars: worst <= 8 ? 3 : worst <= 14 ? 2 : 1, why: `All three answered; the longest wait was ${Math.round(worst)} s.` };
    },
    solution: (sim, once, say) => {
      for (const cs of ['QTR8125', 'AZG7321', 'FDX5203']) if (callingClear(sim, cs) && sim.t - sim.find(cs)!.awaitingSince! >= 3 && once(cs, true)) { const s = suggest(sim, sim.find(cs)!).find((x) => x.label.startsWith('Descend'))!; say(cs, s.items, 'Answer the oldest call first, with the next level down.'); }
    },
  },
};

// ---- 3. Turns
const L_TURNS: Lesson = {
  id: 'turns', icao: 'EBLG', stage: 'basics', title: 'Turns', minutes: 6, comps: ['SPP', 'COMM'],
  summary: 'The heading dial and the heading drag. Magnetic headings, left and right. Exam: fly through two gates.',
  scenario: sc('turns', [A(2, 'CHG201', 'B744', 'KOK7X', 30)]),
  steps: [
    {
      id: 'intro', title: 'Headings',
      body: `A heading is the direction the nose points, in degrees from magnetic north: 360 north, 090 east, 180 south, 270 west. The ring of numbers round the airport, 25 NM out, is a compass rose. Pilots always turn the short way unless you say otherwise.`,
    },
    { id: 'wait', title: 'CHG201 will call', run: 2, body: 'A 747 from the west. Wait for its call.', focus: { cs: 'CHG201' }, mark: { cs: 'CHG201' }, done: (g) => calling(g, 'CHG201') },
    { id: 'select', title: 'Select CHG201 (NEXT)', body: `Tap ${K('NEXT')} or the aircraft.`, el: '[data-e="callers"]', cs: 'CHG201', noAutoSelect: true, done: (g) => g.cs === 'CHG201' },
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
      body: `Airliners turn at about 3° a second, so a 45° turn takes 15 seconds and a mile or more of sky. The heading you gave shows as ${K('H060')} on line 3 of the label. ${WHY('that mile is why you give a turn a mile before you need it, never on the point itself.')}`, cs: 'CHG201',
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
    solution: (sim, once, say) => {
      const a = sim.find('CHG201'); if (!a) return;
      const g1 = sim.pack.fixes.get('LG008')!.p;
      if (once('h1', callingClear(sim, 'CHG201'))) say('CHG201', [{ k: 'hdg', hdg: 65, dir: 'L' }], 'Aim at gate 1 from here: heading 065 points straight at it.');
      if (once('h2', dist(a.p, g1) < 0.9)) say('CHG201', [{ k: 'hdg', hdg: 200, dir: 'R' }], 'Turn before the gate, not over it: a 747 needs a mile to come round.');
    },
  },
};

// ---- 4. The command halo
const L_HALO: Lesson = {
  id: 'halo', icao: 'EBLG', stage: 'basics', title: 'The command halo', minutes: 6, comps: ['WORK', 'COMM'],
  summary: 'Levels, speeds, fixes and the four words round the aircraft itself. One tap sends, Undo takes it back, a long press stages.',
  scenario: sc('halo', [A(2, 'QTR8125', 'B77L', 'KOK7X', 26), A(70, 'ETH3721', 'B77L', 'NIK7X', 34)]),
  steps: [
    {
      id: 'intro', title: 'Where the real controller clicks', run: 2,
      body: `In the real room the mouse lives on the radar label: click the level field, pick the value, done. Here that is the ${K('halo')}: when an aircraft is selected, a ladder of levels opens on one side, speeds on the other, the fixes that make sense below, and the four words you say most. From now on it is switched on. Wait for QTR8125 to call.`,
      onEnter: (g) => { g.halo.enabled = true; },
      focus: { cs: 'QTR8125' }, mark: { cs: 'QTR8125' }, done: (g) => calling(g, 'QTR8125'),
    },
    {
      id: 'select', title: 'Tap NEXT: the halo opens round QTR8125',
      body: `Select it and look at the scope, not the bar: the ladders sit on the aircraft.`,
      el: '[data-e="callers"]', cs: 'QTR8125', noAutoSelect: true, done: (g) => g.cs === 'QTR8125',
    },
    {
      id: 'rung', title: 'Tap FL070 on the level ladder',
      body: `The level ladder shows five rungs round the cleared level, the cleared one marked. One tap sends; no TRANSMIT. ${WHY('one step down keeps the descent going; the full descent comes with the transition, which also tells the pilot where the miles are.')}`,
      cs: 'QTR8125', compact: true, el: halo('lvl', 'F070'),
      done: (g, x) => sentTo(g, x, 'QTR8125', isLvl((ft) => ft < 8000 && ft > 5500, g.sim)),
    },
    {
      id: 'undo', title: 'Tap 210 on the speed ladder, then Undo',
      body: `Send ${K('210')} from the speed ladder, then tap ${K('Undo')} within two seconds. The pilot hears “correction, disregard” and the old speed stands. ${WHY('a controller who says the wrong thing corrects it at once, before the pilot has read it back. After the readback it is too late: give the right clearance instead.')}`,
      cs: 'QTR8125', compact: true, el: (g) => g.root.querySelector('.undo:not([hidden]) [data-a="undo"]') ?? g.root.querySelector('.halo [data-halo="spd"][data-v="S210"]') ?? g.root.querySelector('.halo [data-halo="spd"]'),
      done: (g, x) => sentTo(g, x, 'QTR8125', (it) => it.k === 'spd') && g.sim.cmdLog.slice(x.cmdStart).some((c) => c.op === 'correct'),
    },
    {
      id: 'stage', title: 'Press and hold 220 to stage it, then TRANSMIT',
      body: `A long press on any rung puts it in the bar instead of sending, so you can build a longer clearance: a level and a speed in one call, say. Hold ${K('220')} for half a second, then tap ${K('TRANSMIT')}. ${WHY('fewer transmissions, fewer readbacks to check, and the pilot hears the whole plan at once.')}`,
      cs: 'QTR8125', compact: true, el: (g) => (g.items.some((i) => i.k === 'spd') ? g.root.querySelector('[data-a="send"]') : g.root.querySelector('.halo [data-halo="spd"][data-v="S220"]') ?? g.root.querySelector('.halo [data-halo="spd"]')),
      done: (g, x) => sentTo(g, x, 'QTR8125', (it) => it.k === 'spd' && it.spd === 220),
    },
    {
      id: 'words', title: 'ILS, HOLD, TWR, BRU',
      body: `Under the ladders: ${K('ILS')} clears the approach, ${K('HOLD')} stages a hold at the stack fix (a hold nearly always comes with a level, so the next rung completes it), ${K('TWR')} hands to Tower, and for a departure ${K('BRU')} hands to the centre. Which word for an arrival whose label reads LOC22L, 10 NM out?`,
      ask: { options: ['ILS', 'TWR', 'HOLD'], correct: 1, why: 'LOC22L means it is established on the localizer. From there it belongs to Tower; without the handoff it has no landing clearance.' },
    },
    {
      id: 'eth', title: 'ETH3721 calls: answer it from the halo', run: 2,
      body: `Select it with ${K('NEXT')} and send it a level from the ladder. Any descent.`,
      cs: 'ETH3721', noAutoSelect: true, mark: { cs: 'ETH3721' }, el: (g) => (g.cs === 'ETH3721' ? g.root.querySelector('.halo [data-halo="lvl"]:not(.cleared)') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'ETH3721', (it) => it.k === 'lvl'),
    },
    {
      id: 'wrap', title: 'Two taps per clearance',
      body: `Select, rung. Undo within two seconds, long press to stage. The exam measures how fast you answer: each caller wants a level and a speed.`,
    },
  ],
  exam: {
    title: 'Quick hands', run: 1, limitS: 240,
    brief: 'Three arrivals call within half a minute. Give each one a descent and a speed. Use the halo, the ladders, the chips or the pickers: the clock is what counts.',
    rule: '<b>Pass:</b> every caller has a level and a speed within 20 s of its call. <b>Stars:</b> within 10 s.',
    scenario: sc('halo-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 24, { callNow: true }), A(10, 'AZG7321', 'B748', 'CIV7X', 28), A(18, 'FDX5203', 'MD11', 'GESLO6X', 22)], { seed: 78 }),
    watch: (sim, m) => {
      m.call ??= {} as Record<string, number>; m.lvl ??= {} as Record<string, number>; m.spd ??= {} as Record<string, number>;
      for (const a of sim.aircraft) {
        if (a.awaitingSince !== undefined && m.call[a.cs] === undefined && sim.t >= a.awaitingSince) m.call[a.cs] = a.awaitingSince;
        if (m.call[a.cs] === undefined) continue;
        if (m.lvl[a.cs] === undefined && sentAny(sim, 0, a.cs, (i) => i.k === 'lvl')) m.lvl[a.cs] = sim.t - m.call[a.cs];
        if (m.spd[a.cs] === undefined && sentAny(sim, 0, a.cs, (i) => i.k === 'spd' || i.k === 'spdmin')) m.spd[a.cs] = sim.t - m.call[a.cs];
      }
    },
    status: (sim, m) => ['QTR8125', 'AZG7321', 'FDX5203'].map((cs) => `${cs} ${m.lvl?.[cs] !== undefined ? 'L' : '·'}${m.spd?.[cs] !== undefined ? 'S' : '·'}${m.call?.[cs] !== undefined && (m.lvl?.[cs] === undefined || m.spd?.[cs] === undefined) ? ` ${Math.round(sim.t - m.call[cs])} s` : ''}`).join(' · '),
    judge: (sim, m) => {
      const css = ['QTR8125', 'AZG7321', 'FDX5203'];
      for (const cs of css) if (m.call?.[cs] !== undefined && (m.lvl?.[cs] === undefined || m.spd?.[cs] === undefined) && sim.t - m.call[cs] > 20) return { pass: false, stars: 0, why: `${cs} waited more than 20 s for its ${m.lvl?.[cs] === undefined ? 'level' : 'speed'}. Select, rung: two taps.` };
      if (sim.events.some((e) => e.kind === 'warning_sent')) return { pass: false, stars: 0, why: 'You transmitted a clearance with a warning showing.' };
      if (!css.every((cs) => m.lvl?.[cs] !== undefined && m.spd?.[cs] !== undefined)) return undefined;
      const worst = Math.max(...css.map((cs) => Math.max(m.lvl[cs], m.spd[cs])));
      return { pass: true, stars: worst <= 10 ? 3 : worst <= 15 ? 2 : 1, why: `All three have a level and a speed; the slowest answer took ${Math.round(worst)} s.` };
    },
    solution: (sim, once, say) => {
      for (const cs of ['QTR8125', 'AZG7321', 'FDX5203']) if (callingClear(sim, cs) && once(cs, true)) { const s = suggest(sim, sim.find(cs)!).find((x) => x.label.startsWith('Descend'))!; say(cs, [...s.items, { k: 'spd', spd: 220 }], 'Level and speed in one call: the pilot gets the plan, you get one readback.'); }
    },
  },
};

// ---- 5. The attention queue and readback cards
const L_QUEUE: Lesson = {
  id: 'queue', icao: 'EBLG', stage: 'basics', title: 'The attention queue', minutes: 7, comps: ['WORK', 'COMM', 'SITU'],
  summary: 'NEXT is a queue of who needs what, oldest first, each row with its one-tap action. Readback cards catch a wrong readback wherever you are looking.',
  scenario: sc('queue', [A(2, 'QTR8125', 'B77L', 'KOK7X', 24, { callNow: true }), A(8, 'AZG7321', 'B748', 'CIV7X', 36), A(60, 'FDX5203', 'MD11', 'GESLO6X', 30)], { seed: 12 }),
  steps: [
    {
      id: 'intro', title: 'Who needs you, in order', run: 2,
      body: `In the real room the strip bay tells you what you owe to whom: a strip with nothing written since the pilot called is the one your eye goes back to. Here that is the queue behind ${K('NEXT')}: conflicts first, then a wrong readback, then calls waiting (oldest first, with the timer), Tower asking for a release, and aircraft due a handoff. Each row carries its one-tap action. Two arrivals are about to call.`,
      done: (g) => isCalling(g.sim, 'QTR8125') && isCalling(g.sim, 'AZG7321'),
    },
    {
      id: 'next', title: 'Tap NEXT: it selects the oldest caller',
      body: `Two are waiting. ${K('NEXT')} picks QTR8125, who called first, and opens the queue so you can see the rest. ${WHY('answer in the order they called. The second pilot can hear the first being answered and knows the frequency is alive.')}`,
      el: '[data-e="callers"]', cs: 'QTR8125', noAutoSelect: true, done: (g) => g.cs === 'QTR8125',
    },
    {
      id: 'go', title: 'Tap the action on its row',
      body: (g) => { const r = attentionRows(g.sim).find((x) => x.cs === 'QTR8125'); return `The row for QTR8125 carries the lead suggestion and its reason${r?.action ? `: ${K(r.action.label)}, because ${r.action.why.charAt(0).toLowerCase()}${r.action.why.slice(1)}` : ''} One tap sends. (The row for AZG7321 waits underneath with its own timer.)`; },
      cs: 'QTR8125', el: (g) => g.root.querySelector('.att-row[data-cs="QTR8125"] .att-go') ?? g.root.querySelector('.att-row .att-go') ?? g.root.querySelector('.sg'),
      done: (g, x) => sentTo(g, x, 'QTR8125'),
    },
    {
      id: 'card', title: 'Watch the readback card', run: 1,
      body: `Under the bar a grey card holds what you just said: “readback due”. When the pilot reads it back right it turns green and fades. Wrong, and it turns amber with the correction one tap away. ${WHY('the card is the ear of a controller who is looking elsewhere. You will be.')}`,
      cs: 'QTR8125', done: (g, x) => heardFrom(g, x, 'QTR8125') && !g.sim.readbackPending('QTR8125'),
    },
    {
      id: 'next2', title: 'NEXT again: AZG7321, then its action',
      body: (g) => { const r = attentionRows(g.sim).find((x) => x.cs === 'AZG7321'); return `AZG7321 has been waiting. ${K('NEXT')} selects it; tap its row's action${r?.action ? ` (${K(r.action.label)})` : ''}. Then listen to the readback.`; },
      cs: 'AZG7321', noAutoSelect: true, onEnter: (g) => g.sim.forceWrong.add('AZG7321'),
      el: (g) => (g.cs === 'AZG7321' ? g.root.querySelector('.att-row[data-cs="AZG7321"] .att-go') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'AZG7321'),
    },
    {
      id: 'wrong', title: 'The pilot reads back the wrong level', run: 1,
      body: `Listen. The card turns amber: “Wrong: read back …”, and the queue puts AZG7321 at the top, above every call, because a wrong level flown is a level bust waiting to happen.`,
      cs: 'AZG7321', done: (g) => !!find(g, 'AZG7321')?.wrong && !g.sim.readbackPending('AZG7321'),
    },
    {
      id: 'fix', title: 'Tap “Say again” on the card',
      body: `The card offers the correction: the level you cleared, said again. Tap it. You have 30 seconds from the wrong readback; after that the slip is logged against you. ${WHY('“negative, descend FL060” is the whole correction. Do not explain, do not apologise, say the number again.')}`,
      cs: 'AZG7321', el: (g) => g.root.querySelector('.rb [data-a="rb-fix"]') ?? g.root.querySelector('.att-row[data-cs="AZG7321"] .att-go') ?? g.root.querySelector('.sg'),
      done: (g) => g.sim.events.some((e) => e.kind === 'readback_caught' && e.cs === 'AZG7321'),
    },
    {
      id: 'third', title: 'FDX5203 is calling: NEXT, action', run: 2,
      body: `A third arrival. Its timer on the row turns amber after 15 seconds; do not let it. ${K('NEXT')}, then the action.`,
      cs: 'FDX5203', noAutoSelect: true, mark: { cs: 'FDX5203' },
      el: (g) => (g.cs === 'FDX5203' ? g.root.querySelector('.att-row[data-cs="FDX5203"] .att-go') ?? g.root.querySelector('.sg') : g.root.querySelector('[data-e="callers"]')),
      done: (g, x) => sentTo(g, x, 'FDX5203'),
    },
    {
      id: 'wrap', title: 'The queue is your strip bay',
      body: `NEXT, action, card. When the queue is empty you have time to plan; when it is not, work it from the top. The exam is a busy minute with one wrong readback hidden in it.`,
    },
  ],
  exam: {
    title: 'A busy minute', run: 1, limitS: 300,
    brief: 'Four arrivals call within 40 seconds and one of them will read back the wrong level. Answer everyone, and catch the wrong readback.',
    rule: '<b>Pass:</b> every call answered within 20 s, the wrong readback corrected within 30 s. <b>Stars:</b> every call within 10 s.',
    scenario: sc('queue-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 24, { callNow: true }), A(10, 'AZG7321', 'B748', 'CIV7X', 28), A(22, 'FDX5203', 'MD11', 'GESLO6X', 22), A(34, 'ETH3721', 'B77L', 'NIK7X', 30)], { seed: 81 }),
    watch: (sim, m) => {
      if (!m.forced) { m.forced = true; sim.forceWrong.add('FDX5203'); }
      m.waits ??= {} as Record<string, number>;
      for (const a of sim.aircraft) if (isCalling(sim, a.cs)) m.waits[a.cs] = Math.max(m.waits[a.cs] ?? 0, sim.t - a.awaitingSince!);
    },
    status: (sim, m) => { const w = sim.callers().filter((a) => sim.t >= (a.awaitingSince ?? 0)); const wrong = sim.aircraft.find((a) => a.wrong); return `${w.length ? `${w.length} waiting` : 'Nobody waiting'}${wrong ? ` · ${wrong.cs} wrong readback` : ''} · longest wait ${Math.round(Math.max(0, ...Object.values((m.waits ?? {}) as Record<string, number>)))} s`; },
    judge: (sim, m) => {
      const css = ['QTR8125', 'AZG7321', 'FDX5203', 'ETH3721'];
      const late = Object.entries((m.waits ?? {}) as Record<string, number>).find(([, w]) => w > 20);
      if (late || sim.events.some((e) => e.kind === 'unanswered')) return { pass: false, stars: 0, why: `${late?.[0] ?? 'A pilot'} waited more than 20 s. Work the queue from the top.` };
      if (sim.events.some((e) => e.kind === 'readback_missed')) return { pass: false, stars: 0, why: 'A wrong readback stood for 30 s. The amber card and the top row of the queue both pointed at it.' };
      const caught = sim.events.some((e) => e.kind === 'readback_caught');
      const done = css.every((cs) => sentAny(sim, 0, cs) && !isCalling(sim, cs) && !sim.readbackPending(cs)) && caught && !sim.aircraft.some((a) => a.wrong);
      if (!done) return undefined;
      const worst = Math.max(...css.map((cs) => (m.waits?.[cs] ?? 0)));
      return { pass: true, stars: worst <= 10 ? 3 : worst <= 15 ? 2 : 1, why: `Everyone answered, the wrong readback caught; the longest wait was ${Math.round(worst)} s.` };
    },
    solution: (sim, once, say) => {
      for (const a of sim.aircraft) if (a.wrong && !sim.readbackPending(a.cs) && once('neg' + a.cs + a.wrong.t, true)) { const s = suggest(sim, a)[0]; say(a.cs, s.items, 'The wrong readback comes first: say the level again.'); return; }
      for (const cs of ['QTR8125', 'AZG7321', 'FDX5203', 'ETH3721']) if (callingClear(sim, cs) && once(cs, true)) { const s = suggest(sim, sim.find(cs)!).find((x) => x.label.startsWith('Descend'))!; say(cs, s.items, 'Oldest caller first, with its next level.'); return; }
    },
  },
};

// ---- 6. Command line and staging
const L_CMDLINE: Lesson = {
  id: 'cmdline', icao: 'EBLG', stage: 'basics', title: 'Command line and staging', minutes: 7, comps: ['WORK', 'COMM'],
  summary: 'Type a clearance in the shorthand pilots hear: digits pick the aircraft, fixes are fuzzy. Queue clearances for a rush and send them with one key each.',
  scenario: sc('cmdline', [A(1, 'QTR8125', 'B77L', 'KOK7X', 26, { callNow: true }), A(30, 'TAY4EK', 'B763', 'LNO6X', 24), A(60, 'CHG201', 'B744', 'KOK7X', 34)], { seed: 13 }),
  steps: [
    {
      id: 'open', title: 'Open the command line: tap ⌨',
      body: `Keyboard players never leave the keys: a clearance is a short line of shorthand, the same grammar the voice recogniser uses. On a phone the ${K('⌨')} button opens it. ${WHY('the words preview as you type, so you check the clearance before it goes out, the way you check a chip.')}`,
      onEnter: (g) => { while (g.sim.t < 4) g.sim.step(); },
      el: '[data-a="kbd"]', done: (g) => !!g.root.classList?.contains('kbd'),
    },
    {
      id: 'type', title: 'Type 81 D60, then Enter',
      body: `Digits pick the aircraft: ${K('81')} is QTR8125, the only callsign on frequency with 81 in it. ${K('D60')} is “descend FL060”. The matched callsign shows in the preview chip; Enter sends.`,
      cs: 'QTR8125', el: '[data-e="cmd"]', done: (g, x) => sentTo(g, x, 'QTR8125', isLvl((ft) => ft <= 6500, g.sim)),
    },
    {
      id: 'wait', title: 'TAY4EK will call', run: 2, body: 'A 767 from the south-east.', mark: { cs: 'TAY4EK' }, done: (g) => calling(g, 'TAY4EK'),
    },
    {
      id: 'two', title: 'Type 4ek D70 S210, Enter',
      body: `Two items in one line: level and speed. ${K('4ek')} is enough for TAY4EK. Fix names are fuzzy too: ${K('>lib')} or ${K('dct lib')} would be “direct LIBVA”. ${WHY('210 kt now, because a 767 that is still fast at 20 NM cannot slow down and descend at the same time; take the speed off early.')}`,
      cs: 'TAY4EK', el: '[data-e="cmd"]', done: (g, x) => sentTo(g, x, 'TAY4EK', (it) => it.k === 'lvl') && sentTo(g, x, 'TAY4EK', (it) => it.k === 'spd'),
    },
    {
      id: 'wait2', title: 'CHG201 will call', run: 2, body: 'A 747 from the west. In a rush three call at once; staging is how you keep up.', mark: { cs: 'CHG201' }, done: (g) => calling(g, 'CHG201'),
    },
    {
      id: 'stage1', title: 'CHG201: LVL → FL070, then Q instead of TRANSMIT',
      body: `Build the clearance as usual, then tap ${K('Q')} (queue) instead of TRANSMIT. It waits in a row under the bar and the composer is free for the next aircraft.`,
      cs: 'CHG201', el: (g) => (g.items.some((i) => i.k === 'lvl') ? g.root.querySelector('[data-a="queue"]') : flow(LVL('F70'))(g)),
      done: (g) => g.staging.queue.some((q) => q.cs === 'CHG201'),
    },
    {
      id: 'stage2', title: 'Now QTR8125: SPD → 220, then Q',
      body: `Select QTR8125 (tap it or type ${K('81')} and Enter), ${K('SPD')} → ${K('220')}, ${K('Q')}. Two rows queued.`,
      cs: 'QTR8125', noAutoSelect: true,
      el: (g) => (g.cs !== 'QTR8125' ? g.root.querySelector('[data-e="cmd"]') : g.items.some((i) => i.k === 'spd') ? g.root.querySelector('[data-a="queue"]') : flow(SPD('S220'))(g)),
      done: (g) => g.staging.queue.some((q) => q.cs === 'QTR8125') && g.staging.queue.some((q) => q.cs === 'CHG201'),
    },
    {
      id: 'send', title: 'Send both: Enter, or Send on each row',
      body: `Enter with an empty composer sends the first row; the keys ${K('1')} to ${K('4')} send a row by number; ${K('Send')} on the row does the same by touch. Each one is re-checked against the sim as it goes out, so a warning still shows.`,
      el: '.stq [data-stq="send"]',
      done: (g, x) => sentTo(g, x, 'CHG201', (it) => it.k === 'lvl') && sentTo(g, x, 'QTR8125', (it) => it.k === 'spd'),
    },
    {
      id: 'history', title: 'Repeat a line',
      body: `You typed ${K('201 H250')} a minute ago and want to send it again. Which key recalls it?`,
      ask: { options: ['↑ (up arrow)', 'Tab', 'Escape'], correct: 0, why: 'Up and down walk the last thirty lines you sent, to edit or repeat. Tab walks the callers; Escape clears the line.' },
    },
    {
      id: 'wrap', title: 'Shorthand you can say',
      body: `Everything you type you can also say on push to talk, and the other way round. The exam is four check-ins in forty seconds; type, tap, or stage, whichever is fastest for you.`,
    },
  ],
  exam: {
    title: 'Four check-ins', run: 1, limitS: 300,
    brief: 'Four arrivals call within forty seconds. Answer each with a descent. Type it, tap it or stage it: the clock is the judge.',
    rule: '<b>Pass:</b> every call answered with a descent within 20 s. <b>Stars:</b> every call within 8 s.',
    scenario: sc('cmdline-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 24, { callNow: true }), A(10, 'AZG7321', 'B748', 'CIV7X', 28), A(22, 'FDX5203', 'MD11', 'GESLO6X', 22), A(34, 'ETH3721', 'B77L', 'NIK7X', 30)], { seed: 82 }),
    watch: (sim, m) => {
      m.waits ??= {} as Record<string, number>;
      for (const a of sim.aircraft) if (isCalling(sim, a.cs)) m.waits[a.cs] = Math.max(m.waits[a.cs] ?? 0, sim.t - a.awaitingSince!);
    },
    status: (sim) => { const w = sim.callers().filter((a) => sim.t >= (a.awaitingSince ?? 0)); return w.length ? `${w.length} waiting: ${w.map((a) => `${a.cs} ${Math.round(sim.t - a.awaitingSince!)} s`).join(', ')}` : 'Nobody waiting'; },
    judge: (sim, m) => {
      const css = ['QTR8125', 'AZG7321', 'FDX5203', 'ETH3721'];
      const late = Object.entries((m.waits ?? {}) as Record<string, number>).find(([, w]) => w > 20);
      if (late || sim.events.some((e) => e.kind === 'unanswered')) return { pass: false, stars: 0, why: `${late?.[0] ?? 'A pilot'} waited more than 20 s. Stage the next clearance while the first reads back.` };
      if (sim.events.some((e) => e.kind === 'warning_sent')) return { pass: false, stars: 0, why: 'You transmitted a clearance with a warning showing.' };
      const done = css.every((cs) => { const a = sim.find(cs); return !!a && a.cflSys !== undefined && sim.ftOf(a.cflSys) < a.alt - 600 && !isCalling(sim, cs) && !sim.readbackPending(cs); });
      if (!done) return undefined;
      const worst = Math.max(...css.map((cs) => (m.waits?.[cs] ?? 0)));
      return { pass: true, stars: worst <= 8 ? 3 : worst <= 14 ? 2 : 1, why: `All four answered; the longest wait was ${Math.round(worst)} s.` };
    },
    solution: (sim, once, say) => {
      for (const cs of ['QTR8125', 'AZG7321', 'FDX5203', 'ETH3721']) if (callingClear(sim, cs) && once(cs, true)) { const s = suggest(sim, sim.find(cs)!).find((x) => x.label.startsWith('Descend'))!; say(cs, s.items, 'Oldest caller first; the next level is enough for now.'); return; }
    },
  },
};

// =====================================================================================
// PROCEDURES
// =====================================================================================

// ---- 7. Descent planning
const L_DESCENT: Lesson = {
  id: 'descent', icao: 'EBLG', stage: 'procedures', title: 'Descent planning', minutes: 7, comps: ['TRAF', 'SPP'],
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
      body: `Start it down gently. Each step down should come before it levels off, so the descent never stops. ${WHY('a level-off at FL070 costs fuel and noise, and a pilot who has levelled off needs a mile or two to get the descent going again.')}`,
      cs: 'TAY4EK', el: sg('Descend'), done: (g, x) => sentTo(g, x, 'TAY4EK', (it) => it.k === 'lvl'),
    },
    {
      id: 'tick', title: 'The level-off tick', run: 2, cs: 'TAY4EK',
      body: `Look ahead of TAY4EK: the dotted ghost line shows where it will be over the next two minutes, and the small tick with a level on it marks where it will level off. Before it reaches that tick, give the next level.`,
      done: (g, x) => g.sim.t - x.t0 > 30,
    },
    {
      id: 'rest', title: 'Tap the ALHUV1B chip: the rest in one call',
      body: `The bright chip clears the transition, 3,000 ft and the ILS in one call. ${WHY('3,000 ft, because the transition starts down at 3,000 ft at LIBVA and the ILS captures the glidepath from below; any higher and it meets the beam from above, which it cannot do. From here the aircraft flies to the final by itself.')}`,
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
      done: (g) => hints(g.sim)[0]?.key === 'high:QTR8152',
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
    solution: (sim, once, say) => {
      const a = sim.find('QTR8152'); if (!a) return;
      if (once('c', callingClear(sim, 'QTR8152'))) say('QTR8152', [{ k: 'trans', name: 'ALHUV1B' }, { k: 'lvl', lvl: { fl: 60 } }, ILS], 'Transition and ILS at once, with a first step down: the pilot knows the miles and starts the descent.');
      if (once('d', !!a.app && a.alt < 6600)) say('QTR8152', [{ k: 'lvl', lvl: { ft: 2500 } }, { k: 'spd', spd: 210 }], 'Before it levels at FL060: the rest of the descent, and 210 kt so it is slow by the time it reaches the final.');
      towerWhenEstablished(sim, once, say);
    },
  },
};

// ---- 8. Transitions, the hold and the expected approach time
const L_TRANSITIONS: Lesson = {
  id: 'transitions', icao: 'EBLG', stage: 'procedures', title: 'Transitions and the hold', minutes: 8, comps: ['SPP', 'TRAF'],
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
      body: `A ${G('Transition')} is a published path from ALHUV round to LIBVA on the final. This chip clears the transition, 3,000 ft and the ILS in one call. The aircraft does the rest by itself. ${WHY('AZG7321 goes first because it is the heavier of the two and closer; the 777 behind it would need 4 NM anyway.')}`,
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
      body: `Clear QTR8152 to ${K('5,000')} ft, the top of the stack. ${WHY('the lowest in the stack leaves first, so the one that arrived first goes to the bottom and newcomers stack 1,000 ft above.')}`, cs: 'QTR8152', el: flow(LVL('A5000')),
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
    solution: (sim) => autoControl(sim),
  },
};

// ---- 9. Departures and releases
const L_DEPARTURES: Lesson = {
  id: 'departures', icao: 'EBLG', stage: 'procedures', title: 'Departures and releases', minutes: 8, comps: ['CORD', 'SEPC'],
  summary: 'Tower asks for a release on the intercom: Release, After an arrival, or Hold. Climb clear of arrivals, hand to the centre.',
  scenario: sc('departures', [A(1, 'FDX5203', 'MD11', 'GESLO6X', 14), D(150, 'CHG7302', 'B748', 'LNO9S'), A(240, 'AZG7321', 'B748', 'CIV7X', 34)]),
  steps: [
    {
      id: 'arr', title: 'FDX5203 is on its way in', run: 2,
      body: `FDX5203, an MD-11, comes from the south-east. When it calls, the coach clears it for ALHUV1B, 3,000 ft and the ILS. Departures today climb out west on LNO9S, to FL060 at first.`,
      mark: { cs: 'FDX5203' },
      done: (g) => { if (isCalling(g.sim, 'FDX5203') && !find(g, 'FDX5203')?.app && !g.sim.readbackPending('FDX5203')) g.sim.issue({ cs: 'FDX5203', items: TRANS('ALHUV1B') }); return g.sim.releases.some((r) => r.cs === 'CHG7302'); },
    },
    {
      id: 'card', title: 'Tower asks: tap “After FDX5203”',
      body: `A purple card: Tower, on the ${G('Intercom')}, wants to launch CHG7302. You decide when. ${K('Release')} lets it go as soon as the runway is free. ${K('After FDX5203')} lets it go once that arrival has landed. ${K('Hold 3 min')} keeps it on the ground. FDX5203 is on its way to the runway, so: after FDX5203. ${WHY('a 747 that rolls in front of a landing MD-11 forces the go-around; a 747 that rolls behind it loses nothing.')}`,
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
      body: (g) => { const z = find(g, 'AZG7321'); return `${z ? `AZG7321 is inbound from the west at ${fmtLvl(g.sim, z.alt)}, right where CHG7302 climbs out. ` : ''}Do not climb CHG7302 above it yet. Answer with ${K('LVL')} → ${K('FL060')}: “maintain FL060”. ${WHY('1,000 ft under the arrival is separation; the climb through its level is not, until they have passed.')}`; },
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
      id: 'bru', title: 'Before the 40 NM ring: hand it to the centre', run: 2, cs: 'CHG7302', el: (g) => sg(acc(g))(g),
      body: (g) => `Hand it to ${accLongName(g)} before it leaves your sector. The ${K(acc(g))} chip appears once it is above 7,000 ft or 18 NM out.`,
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
    brief: 'Tower will ask for two releases. QTR8125 is inbound from the west at FL080 on your climb-out path. Release both departures, climb them to FL090 when clear, and hand them to the centre. Handle QTR8125 too.',
    rule: '<b>Pass:</b> releases answered within 60 s, both departures with the centre inside your sector, no loss of separation. <b>Stars:</b> quick releases and handoffs.',
    scenario: sc('departures-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 30), D(10, 'CHG7302', 'B748', 'LNO9S'), D(60, 'BCS7', 'B752', 'CIV5S')], { seed: 17 }),
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
      const q = sim.find('QTR8125');
      if (q && once('q', callingClear(sim, 'QTR8125'))) say('QTR8125', [{ k: 'lvl', lvl: { fl: 80 } }], 'Keep the arrival at FL080, above the SIDs, until the departures are clear of it.');
      for (const cs of ['CHG7302', 'BCS7']) {
        const a = sim.find(cs); if (!a || a.state !== 'assumed') continue;
        if (once('ans' + cs, callingClear(sim, cs))) say(cs, [{ k: 'lvl', lvl: { fl: 60 } }], 'Maintain FL060: the arrival is still ahead and above.');
        const clear = !q || q.state !== 'assumed' || dist(a.p, q.p) > 8 && alongTrack(q.p, a.p, a.trk) < 0 || Math.abs(a.p.x - q.p.x) > 15;
        if (once('cl' + cs, clear && a.alt > 4000 && sentAny(sim, 0, cs))) say(cs, [{ k: 'lvl', lvl: { fl: 90 } }], 'Passed and clear: climb it to the top of the sector.');
        if (once('bru' + cs, Math.hypot(a.p.x, a.p.y) > 20)) say(cs, [{ k: 'xfr', unit: sim.acc.id }], 'Hand it to the centre before the boundary.');
      }
    },
  },
};
const accLongName = (g: Game) => g.sim.acc.callsign;

// ---- 10. Coordination and the runway change
const L_RUNWAY: Lesson = {
  id: 'runway', icao: 'EBLG', stage: 'procedures', title: 'The centre and the runway change', minutes: 8, comps: ['CORD', 'SPP'],
  summary: 'Estimates and early transfers from the centre on the intercom, the supervisor announces a runway change, and you re-clear the arrivals for 04R.',
  scenario: sc('runway', [A(330, 'CLX7HK', 'B748', 'KOK7X', 30), A(380, 'TAY4EK', 'B763', 'LNO6X', 26)], { coordination: true, earlyTransferRate: 1, events: [{ t: 300, kind: 'runway', rwy: '04R', notice: 150 }] }),
  steps: [
    {
      id: 'est', title: 'The centre passes an estimate', run: 2,
      body: (g) => `Before ${acc(g)} hands an arrival over, it tells you on the ${G('Intercom')} when the aircraft will reach your boundary and at what level: an ${G('Estimate', 'estimate')}. It appears as a green strip under “Offered by ${acc(g)}”, so you can plan before the pilot calls. ${WHY('the estimate is your first look at the sequence. Two estimates a minute apart on different routes are a sequence problem you can solve before either calls.')}`,
      done: (g) => g.sim.estimates.length > 0, until: (g) => g.sim.estimates.length > 0,
    },
    {
      id: 'early', title: 'The centre asks for an early transfer: tap Approve', run: 2,
      body: (g) => `${acc(g)} would like to hand one over early, maintaining a level. The card on the scope gives you a minute to answer. ${K('Approve')} takes it; ${K('As coordinated')} keeps the agreed transfer. ${WHY('say yes when the level it will keep sits above your departures and clear of your other arrivals; it is one less aircraft the centre has to hold.')}`,
      // the card on the scope, or on a phone (where the coach sits over the card) the same answer in the queue bar
      el: (g) => { const b = g.root.querySelector<HTMLElement>('.icom [data-v="bruok"]'); const q = g.root.querySelector<HTMLElement>('.att-row.bru .att-go'); return window.innerWidth < 700 && q ? q : b ?? q; },
      done: (g) => g.sim.coordReqs.some((r) => r.state !== 'pending') || (g.sim.coordReqs.length === 0 && g.sim.t > 320),
      until: (g) => g.sim.coordReqs.some((r) => r.state === 'pending'),
    },
    {
      id: 'notice', title: 'SUP: runway change in two and a half minutes', run: 2,
      body: `The supervisor has announced it on the intercom: the wind has backed and 04R is the runway from the change time. Arrivals not yet on the approach go via the D arrivals and the 04R transitions; departures get the R SIDs. Which arrivals keep 22L?`,
      ask: { options: ['All of them: a change applies at once', 'Only those already established on the ILS 22L', 'None: everyone is re-cleared'], correct: 1, why: 'An aircraft established on the localizer continues to the old runway. Everyone else is yours to re-clear, and the supervisor lists them on the intercom when the change happens.' },
      done: (g) => !!g.sim.rwyChange || !!g.sim.lastRwyChange,
    },
    {
      id: 'calls', title: 'Let both check in', run: 2,
      body: `CLX7HK comes from the west and TAY4EK from the south-east. Answer each with a level only: ${K('Descend FL070')} or the ladder. Do not clear a transition yet. ${WHY('a transition for 22L cleared now is a transition you will cancel in a minute. A level costs nothing to keep.')}`,
      el: (g) => (g.cs ? sg('Descend')(g) : g.root.querySelector('[data-e="callers"]')),
      done: (g) => ['CLX7HK', 'TAY4EK'].every((cs) => sentAny(g.sim, 0, cs, (it) => it.k === 'lvl')),
      until: (g) => ['CLX7HK', 'TAY4EK'].some((cs) => isCalling(g.sim, cs)),
    },
    {
      id: 'change', title: 'Runway 04R in use', run: 4,
      body: `Wait for the change. The ATIS letter steps on, the RWY tag in the top bar changes, the final on the scope flips to the other end, and the supervisor names who needs re-clearing.`,
      done: (g) => !!g.sim.lastRwyChange, until: (g) => !!g.sim.lastRwyChange,
    },
    {
      id: 'reclear', title: 'Re-clear CLX7HK: its lead chip for 04R',
      body: (g) => { const s = leadOf(g.sim, 'CLX7HK'); return `The lead chip now reads ${K(s?.label ?? 'Runway 04R')}: the 04R arrival or transition, and the ILS 04R. ${WHY('the D arrivals still end at ALHUV; the 04R transitions run from there to the 04R final. The approach clearance names the new runway so the pilot sets the new localizer.')}`; },
      cs: 'CLX7HK', el: '.sg.lead',
      done: (g, x) => sentTo(g, x, 'CLX7HK', (it) => it.k === 'star' || it.k === 'trans' || (it.k === 'app' && it.rwy === '04R')),
    },
    {
      id: 'reclear2', title: 'And TAY4EK', run: 1,
      body: `The same for TAY4EK: its lead chip.`,
      cs: 'TAY4EK', el: '.sg.lead',
      done: (g, x) => sentTo(g, x, 'TAY4EK', (it) => it.k === 'star' || it.k === 'trans' || (it.k === 'app' && it.rwy === '04R')),
    },
    {
      id: 'land', title: 'Bring them in on 04R', run: 4,
      body: `Keep clearing the lead chips as they come (transition and ILS, then Tower when established). Skip ahead if you like.`,
      done: (g) => ['CLX7HK', 'TAY4EK'].every((cs) => gone(g.sim, cs) || landed(g.sim, cs)),
      until: (g) => ['CLX7HK', 'TAY4EK'].some((cs) => dueTower(g.sim, cs) || (leadOf(g.sim, cs)?.items.some((i) => i.k === 'trans') ?? false)),
    },
    {
      id: 'wrap', title: 'The centre is your partner',
      body: `Estimates let you plan, early transfers are a favour you return, and a runway change is a list of re-clearances the supervisor reads out. Next: the exam, with the wind doing it to you unannounced.`,
    },
  ],
  exam: {
    title: 'Wind shift', run: 2, limitS: 1500,
    brief: 'Three arrivals and a departure. The wind backs during the session and the supervisor calls a runway change to 04R with ten minutes’ notice. Answer the centre, re-clear whoever needs it, release the departure for the right runway, land everyone.',
    rule: '<b>Pass:</b> all three arrivals with Tower or landed, the departure with the centre, every intercom request answered within a minute, no loss of separation. <b>Stars:</b> no conflict alerts and no go-around.',
    scenario: sc('runway-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 26, { callNow: true }), A(150, 'ETH3721', 'B77L', 'NIK7X', 36), A(300, 'AZG7321', 'B748', 'CIV7X', 40), D(420, 'CHG7302', 'B748', 'LNO9S')], { seed: 24, coordination: true, earlyTransferRate: 1, events: [{ t: 90, kind: 'wind', dir: 40, kt: 12 }] }),
    watch: (sim, m) => {
      m.wait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.wait[r.cs] = Math.max(m.wait[r.cs] ?? 0, sim.t - r.t);
      for (const r of sim.coordReqs) if (r.state === 'pending') m.wait[sim.acc.say + ' ' + r.cs] = Math.max(m.wait[sim.acc.say + ' ' + r.cs] ?? 0, sim.t - r.t);
    },
    status: (sim) => `Runway ${sim.runway}${sim.rwyChange ? ` → ${sim.rwyChange.to} at ${sim.utc(sim.rwyChange.at).slice(0, 5)}` : ''} · ${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 3 arrivals done · ${sim.departuresHandled} of 1 departure`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'coord_unanswered', 'release_delay'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.wait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `${slow[0]} waited ${Math.round(slow[1])} s for an answer. Answer the intercom within a minute.` };
      const arrDone = ['QTR8125', 'ETH3721', 'AZG7321'].every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred');
      if (!arrDone || sim.departuresHandled < 1) return undefined;
      const stca = sim.events.some((e) => e.kind === 'stca'), ga = sim.events.some((e) => e.kind === 'goaround');
      return { pass: true, stars: !stca && !ga ? 3 : !stca || !ga ? 2 : 1, why: `Everyone handled through the change to ${sim.runway}${stca ? ', with a conflict alert' : ''}${ga ? ', with a go-around' : ''}.` };
    },
    solution: (sim, _once, say) => {
      autoControl(sim);
      for (const r of sim.coordReqs) if (r.state === 'pending') say(r.cs, [{ k: 'appr' }], 'Take it early: the level it keeps is clear of everything.');
      for (const r of sim.releases) if (r.state === 'pending' && sim.t - r.t > 3) say(r.cs, [{ k: 'rel' }], 'Release it for the runway in use.');
    },
  },
};

// =====================================================================================
// JUDGEMENT
// =====================================================================================

// ---- 11. Vectors to the ILS
const L_VECTORS: Lesson = {
  id: 'vectors', icao: 'EBLG', stage: 'judgement', title: 'Vectors to the ILS', minutes: 8, comps: ['TRAF', 'SPP'],
  summary: 'Downwind, base, a 30° intercept and the approach clearance, slow to 160, Tower. Exam from the other side.',
  scenario: sc('vectors', [A(2, 'CHG201', 'B744', 'KOK7X', 13)]),
  steps: [
    {
      id: 'wait', title: 'CHG201: a 747 from the west', run: 2,
      body: `Instead of letting it fly to ALHUV, you will vector it: a downwind north of the field, a base turn, and a 30° turn onto the final. The ${G('ILS')} then takes it down to the runway. ${WHY('vectors are shorter than the published transition and they are how you build a tight sequence: every mile of downwind is a knob you can turn.')}`,
      focus: { cs: 'CHG201' }, mark: { cs: 'CHG201' }, done: (g) => calling(g, 'CHG201'),
    },
    {
      id: 'downwind', title: 'Drag from CHG201 to L045 (downwind)',
      body: `Press on the aircraft and drag out to the north-east until the bubble reads ${K('L045')}, then lift. (Or ${K('HDG')} and the dial.) The downwind runs parallel to the final, the opposite way, 6 to 8 NM to the side. ${WHY('6 to 8 NM, because the base leg and the 30° intercept need that much room to line up without overshooting.')}`,
      cs: 'CHG201', compact: true, mark: { cs: 'CHG201', text: 'drag from here' }, focus: { cs: 'CHG201', scale: 11 },
      done: (g, x) => sentTo(g, x, 'CHG201', isHdg(20, 70)),
    },
    {
      id: 'down', title: 'LVL 3,000, SPD 210, TRANSMIT', run: 1,
      body: `North-west of the field the ${G('MVA')} is 2,500 ft, so 3,000 ft is safe. Tap ${K('LVL')} → ${K('3,000')}, ${K('SPD')} → ${K('210')}, then ${K('TRANSMIT')}: both in one call. ${WHY('3,000 ft is the platform the ILS captures from, and 210 kt is slow enough to turn tightly and fast enough to keep the sequence moving.')}`,
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
      body: (g) => { const a = find(g, 'CHG201'); const xt = a ? Math.abs(offCl(g.sim, a)) : 0; return `Wait until it is about 2 NM from the centreline (now ${xt.toFixed(1)} NM). Then tap the chip ${K('R195 · ILS 22L')}: a 30° intercept and the approach clearance in one call. Too early and it joins late; too late and it flies through. ${WHY('30° is what the localizer receiver captures cleanly; 90° and it flies through the beam before the autopilot can turn.')}`; },
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
    solution: (sim, once, say) => {
      const a = sim.find('DHK7'); if (!a) return;
      const al = alongFinal(sim, a), xt = Math.abs(offCl(sim, a));
      if (once('dw', callingClear(sim, 'DHK7'))) say('DHK7', [{ k: 'hdg', hdg: 45, dir: 'R' }, { k: 'lvl', lvl: { ft: 4000 } }], 'Downwind on the south-east side, 4,000 ft: above the 3,500 ft high ground there.');
      if (once('lo', sim.t > 60)) say('DHK7', [{ k: 'lvl', lvl: { ft: 3000 } }, { k: 'spd', spd: 210 }], 'Over the flat ground now: down to the 3,000 ft platform and 210 kt for the turns.');
      if (once('base', sim.t > 60 && al > 12)) say('DHK7', [{ k: 'hdg', hdg: 315, dir: 'L' }], '12 NM out along the final: base, perpendicular to it.');
      if (once('icpt', sim.t > 80 && a.hdgSys !== undefined && norm360(a.hdgSys - 2) > 300 && xt < 2.3)) say('DHK7', [{ k: 'hdg', hdg: 255, dir: 'L' }, ILS], '2 NM from the centreline: 30° intercept and the approach clearance together.');
      towerWhenEstablished(sim, once, say);
    },
  },
};

// ---- 12. Separation
const L_SEPARATION: Lesson = {
  id: 'separation', icao: 'EBLG', stage: 'judgement', title: 'Separation', minutes: 7, comps: ['SEPC', 'SITU'],
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
      body: `The coach answered both for you: stay at FL080. Each aircraft drags a dotted ghost line: where it will be in the next two minutes. Both ghosts end at GILOM, at the same level. ${WHY('two ghosts that meet at the same level are a conflict in two minutes. A controller who reads ghosts never hears the alarm.')}`,
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
      body: `Act at once. The quickest cure is a level: 1,000 ft takes about half a minute. Send ETH3721 down to FL060 with its chip. (A turn of 30° or more also works, if it is early enough.) ${WHY('the one that descends is the one behind in the sequence, so the level change is also the next thing it needed anyway.')}`,
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
      const past = (cs: string, fix: string) => { const a = sim.find(cs); return !a || a.mode !== 'NAV' || pastFix(a, fix); };
      const pairs = [['CLX7HK', 'ETH3721', 'GILOM'], ['FDX5203', 'TAY4EK', 'LNO']] as const;
      const clear = pairs.every(([a, b, f]) => past(a, f) && past(b, f) && !sim.alerts().some((x) => [a, b].includes(x.a as never) || [a, b].includes(x.b as never)));
      if (!clear) return undefined;
      m.clearT ??= sim.t;
      if (sim.t - m.clearT < 45) return undefined;
      const n = new Set(sim.events.filter((e) => e.kind === 'stca').map((e) => `${e.cs}${e.cs2}`)).size;
      return { pass: true, stars: n === 0 ? 3 : n === 1 ? 2 : 1, why: n === 0 ? 'Both pairs separated before any alarm.' : `Separated, with ${n} STCA alarm${n > 1 ? 's' : ''}. Act when the ghosts meet, before the alarm.` };
    },
    solution: (sim, once, say) => {
      if (once('p1', callingClear(sim, 'ETH3721'))) say('ETH3721', [{ k: 'lvl', lvl: { fl: 60 } }], 'Its ghost meets CLX7HK at GILOM at the same level: 2,000 ft under, on the first call.');
      if (once('p2', callingClear(sim, 'TAY4EK'))) say('TAY4EK', [{ k: 'lvl', lvl: { fl: 60 } }], 'Same at LNO: TAY4EK goes under FDX5203 before they get close.');
      for (const cs of ['CLX7HK', 'FDX5203']) if (once(cs, callingClear(sim, cs))) say(cs, [{ k: 'lvl', lvl: { fl: 80 } }], 'The leader keeps FL080 so the vertical gap is 2,000 ft.');
    },
  },
};

// ---- 13. Wake spacing with speed
const L_SPACING: Lesson = {
  id: 'spacing', icao: 'EBLG', stage: 'judgement', title: 'Wake spacing with speed', minutes: 8, comps: ['TRAF', 'SEPC'],
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
      onEnter: (g) => { g.sim.issue({ cs: 'CLX7HK', items: TRANS('ALHUV1A') }); },
      done: (g) => calling(g, 'TAY4EK'),
    },
    {
      id: 'follow', title: 'The follower is cleared too',
      body: `TAY4EK gets the same clearance. Both now fly the same path to the same runway. The spacing is up to you, with speed.`,
      onEnter: (g) => { g.sim.issue({ cs: 'TAY4EK', items: TRANS('ALHUV1A') }); },
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
        return `TAY4EK is about ${gap} NM behind CLX7HK along the route, and the gap will shrink: the 747 slows first and the 767 catches up. Left alone, TAY4EK ends up inside 4 NM. 180 kt holds the gap near 4.4 NM; 160 kt opens it wider than needed; 200 kt or more closes it. Tap ${K('SPD')} → ${K('180')} and transmit, or slide up and down on the speed chip of its label. ${WHY('the gap you want is the minimum plus about half a mile: the minimum is the law, the half mile is the margin for the pilot who slows a little late.')}`;
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
        if (a && isCalling(sim, cs) && !a.app && !sim.readbackPending(cs)) sim.issue({ cs, items: TRANS('ALHUV1A') });
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
    solution: (sim, once, say) => {
      const c = sim.find('CLX7HK'), t = sim.find('TAY4EK'), d = sim.find('DHK7');
      if (t && once('t', !!c?.app?.locCap && sim.dthr(t) < 16)) say('TAY4EK', [{ k: 'spd', spd: 180 }], 'The 747 is established and slowing: 180 kt on the 767 holds the gap near 4.4 NM.');
      if (d && once('d', !!t?.app?.locCap && sim.dthr(d) < 16)) say('DHK7', [{ k: 'spd', spd: 180 }], 'Same for the 757 behind the 767: 180 kt keeps it just outside 3 NM.');
      towerWhenEstablished(sim, once, say);
    },
  },
};

// ---- 14. Safety nets and emergencies, and the checkride
const L_SAFETY: Lesson = {
  id: 'safety', icao: 'EBLG', stage: 'judgement', title: 'Safety nets and emergencies', minutes: 10, comps: ['NONR', 'COMM', 'SEPC'],
  summary: 'Catch a wrong readback with Mode S, the alarms, a MAYDAY. Then the checkride.',
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
      body: `An emergency comes first. Its lead chip clears it direct to LIBVA, 3,000 ft and the ILS: the shortest way in. In a real emergency you would also ask what help the crew needs, and keep others out of its way. ${WHY('a 747 on three engines flies fine; what it cannot do is wait. Everything else gets a level or a hold until it is down.')}`,
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
    title: 'Checkride', run: 1, limitS: 20 * 60,
    brief: 'Twenty minutes at most, four arrivals and two departures, graded like a real session. Two of the arrivals converge at the same level in the east. Every arrival must land and both departures must reach the centre.',
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
    solution: (sim, once, say) => {
      for (const a of sim.aircraft) if (a.wrong && !sim.readbackPending(a.cs) && once('neg' + a.cs + a.wrong.t, true)) { const s = suggest(sim, a)[0]; if (s?.label.startsWith('Negative')) say(a.cs, s.items, 'A wrong readback: say the level again before anything else.'); }
      autoControl(sim);
    },
  },
};

// ---- 15. The full position
const L_POSITION: Lesson = {
  id: 'position', icao: 'EBLG', stage: 'judgement', title: 'The full position', minutes: 8, comps: ['CORD', 'WORK', 'SITU'],
  summary: 'The whole console: strip bay, landing order, estimates from the centre, push-to-talk, the correction window and the safety-net list. Then half a shift.',
  scenario: sc('position', [A(150, 'CLX7HK', 'B748', 'KOK7X', 26), A(200, 'TAY4EK', 'B763', 'LNO6X', 22)], { coordination: true, earlyTransferRate: 0 }),
  steps: [
    {
      id: 'tour', title: 'Your working position',
      body: (g) => `On a wide screen the whole position is in front of you: the ${G('Strip', 'strip bay')} on the left, the radar in the middle, and on the right the ${G('AMAN')} landing ladder, coordination with Tower, ${acc(g)} and the military, the ${G('Safety nets', 'safety-net list')}, and the weather. On an iPad the right-hand panels sit under tabs; on a phone, under the ▤ button.`,
    },
    {
      id: 'est', title: 'The centre passes an estimate', run: 2,
      body: (g) => `Before ${acc(g)} hands an arrival over, it tells you on the ${G('Intercom')} when the aircraft will reach your boundary and at what level: an estimate. It appears as a green strip under “Offered by ${acc(g)}”, so you can plan before the pilot calls.`,
      done: (g) => g.sim.estimates.length > 0, until: (g) => g.sim.estimates.length > 0,
    },
    {
      id: 'calls', title: 'Let both check in', run: 2,
      body: `CLX7HK comes from the west and TAY4EK from the south-east. The coach clears both for their transitions when they call.`,
      done: (g) => {
        for (const [cs, tr] of [['CLX7HK', 'ALHUV1A'], ['TAY4EK', 'ALHUV1B']] as const) if (isCalling(g.sim, cs) && !find(g, cs)?.app && !g.sim.readbackPending(cs)) g.sim.issue({ cs, items: TRANS(tr) });
        return !!find(g, 'CLX7HK')?.app && !!find(g, 'TAY4EK')?.app;
      },
    },
    {
      id: 'seq', title: 'Drag a strip to change the landing order',
      body: `The AMAN guessed an order from the times alone. You decide it. In the landing sequence bay, press the coloured tab on the left of a strip and drag it above or below the other one. The ladder on the right, the gap ruler and the suggestions all follow your order. On a phone, open the strips with ▤. ${WHY('the order is a decision, not a measurement: the heavy goes first when the gaps work out, the one with the shorter route goes first when they do not.')}`,
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
    title: 'Half a shift', run: 2, limitS: 30 * 60,
    brief: 'Thirty minutes: five arrivals and two departures, with the centre coordinating. The centre will ask to transfer one early: answer it. Release the departures into gaps. Land everyone with no loss of separation.',
    rule: '<b>Pass:</b> all five arrivals with Tower or landed, both departures with the centre, the centre and Tower answered within a minute, no loss of separation. <b>Stars:</b> no conflict alerts and quick answers.',
    scenario: sc('position-exam', [A(2, 'QTR8125', 'B77L', 'KOK7X', 24, { callNow: true }), A(120, 'ETH3721', 'B77L', 'LNO6X', 26), A(260, 'AZG7321', 'B748', 'CIV7X', 30), D(200, 'CHG7302', 'B748', 'LNO9S'), A(520, 'FDX5203', 'MD11', 'KOK7X', 30), A(700, 'TAY4EK', 'B763', 'GESLO6X', 30), D(760, 'BCS7', 'B752', 'CIV5S')], { seed: 23, coordination: true, earlyTransferRate: 1, durationMin: 30 }),
    watch: (sim, m) => {
      m.wait ??= {} as Record<string, number>;
      for (const r of sim.releases) if (r.state === 'pending') m.wait[r.cs] = Math.max(m.wait[r.cs] ?? 0, sim.t - r.t);
      for (const r of sim.coordReqs) if (r.state === 'pending') m.wait[sim.acc.say + ' ' + r.cs] = Math.max(m.wait[sim.acc.say + ' ' + r.cs] ?? 0, sim.t - r.t);
    },
    status: (sim) => `${sim.landings.length + sim.aircraft.filter((a) => a.kind === 'arr' && a.state === 'transferred').length} of 5 arrivals done · ${sim.departuresHandled} of 2 departures with ${sim.acc.say} · ${mmss(30 * 60 - sim.t)} left`,
    judge: (sim, m) => {
      const bad = sim.events.find((e) => ['los', 'wake', 'mva', 'exit_unxfr', 'coord_unanswered', 'release_delay'].includes(e.kind));
      if (bad) return { pass: false, stars: 0, why: bad.text };
      const slow = Object.entries((m.wait ?? {}) as Record<string, number>).find(([, w]) => w > 60);
      if (slow) return { pass: false, stars: 0, why: `${slow[0]} waited ${Math.round(slow[1])} s for an answer. Answer the intercom within a minute.` };
      const arrDone = ['QTR8125', 'ETH3721', 'AZG7321', 'FDX5203', 'TAY4EK'].every((cs) => landed(sim, cs) || sim.find(cs)?.state === 'transferred');
      if (!arrDone || sim.departuresHandled < 2) return undefined;
      const quick = Object.values((m.wait ?? {}) as Record<string, number>).every((w) => w <= 20);
      const stca = sim.events.some((e) => e.kind === 'stca');
      return { pass: true, stars: !stca && quick ? 3 : !stca || quick ? 2 : 1, why: `Everyone handled${stca ? ', with a conflict alert on the way' : ' with no conflict alerts'}.` };
    },
    solution: (sim, _once, say) => {
      autoControl(sim);
      for (const r of sim.coordReqs) if (r.state === 'pending') say(r.cs, [{ k: 'appr' }], 'Take it early: nothing of yours is at that level on its route.');
      for (const r of sim.releases) if (r.state === 'pending' && sim.t - r.t > 3) say(r.cs, [{ k: 'rel' }], 'Release it: the final is clear for the next few minutes.');
    },
  },
};

export const EBLG_LESSONS: Lesson[] = [L_SCOPE, L_CONTACT, L_TURNS, L_HALO, L_QUEUE, L_CMDLINE, L_DESCENT, L_TRANSITIONS, L_DEPARTURES, L_RUNWAY, L_VECTORS, L_SEPARATION, L_SPACING, L_SAFETY, L_POSITION];
// keep the type imports honest for the kit's consumers
void (null as unknown as StepCtx); void (null as unknown as Once); void (null as unknown as Say); void twr; void app; void att; void heardAny;
