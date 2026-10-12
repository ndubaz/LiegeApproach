import type { Game } from './game';
import type { Scenario, SpawnSpec } from '../engine/types';
import type { Aircraft } from '../engine/types';
import { crossTrack, norm360 } from '../geo';

// Interactive tutorial: seven lessons that teach the Liège Approach position.
// Each lesson is a scripted scenario plus a coach that pauses the clock,
// points at the control or aircraft to use, and waits until you have done it.

export interface Step {
  title: string;
  body: string | ((g: Game) => string);
  /** sim speed while this step is open: 0 = paused for you to act */
  run?: 0 | 1 | 2 | 4;
  /** DOM control to highlight (selector inside the game) */
  el?: string;
  /** scope marker */
  mark?: { cs?: string; fix?: string; text?: string };
  focus?: { fix?: string; cs?: string; scale?: number };
  onEnter?(g: Game, ctx: StepCtx): void;
  /** finish automatically when true; otherwise the coach shows Next */
  done?(g: Game, ctx: StepCtx): boolean;
}
export interface StepCtx { cmdStart: number; logStart: number; t0: number }
export interface Lesson { id: string; title: string; summary: string; minutes: number; scenario: Scenario; steps: Step[] }

const METAR = 'EBLG 121405Z 22006KT 9999 FEW040 15/07 Q1018 NOSIG';
const sc = (id: string, spawns: SpawnSpec[], extra: Partial<Scenario> = {}): Scenario => ({
  id: `tut-${id}`, title: `Tutorial`, desc: '', seed: 4242, durationMin: 60, startUtc: '14:05', metar: METAR, runway: '22L', spawns, events: [], readbackErr: 0,
  noSayAgain: true, tutorial: true, ...extra,
});
const A = (t: number, cs: string, type: string, star: string, spawnDist: number): SpawnSpec => ({ t, kind: 'arr', cs, type, star, spawnDist });

// ---------- condition helpers ----------
const ac = (g: Game, cs: string) => g.sim.find(cs);
const calling = (g: Game, cs: string) => { const a = ac(g, cs); return !!a && a.awaitingSince !== undefined && g.sim.t >= a.awaitingSince; };
const sentTo = (g: Game, x: StepCtx, cs: string, pred: (k: string, it: any) => boolean = () => true) =>
  g.sim.cmdLog.slice(x.cmdStart).some((c) => c.cl.cs === cs && c.cl.items.some((it) => pred(it.k, it)));
const heardFrom = (g: Game, x: StepCtx, cs: string) => g.sim.log.slice(x.logStart).some((t) => t.from === 'PILOT' && t.cs === cs && !t.text.startsWith('Liège'));
const hdgMag = (g: Game, a?: Aircraft) => (a?.hdgSys === undefined ? undefined : norm360(a.hdgSys - g.sim.pack.meta.magVar));
const signedCl = (g: Game, a: Aircraft) => { const r = g.sim.pack.runways.get(g.sim.runway)!; return crossTrack(a.p, r.thr, r.crs); };
let entrySide = 0; // side of the centreline when the capture step opened
const offCl = (g: Game, cs: string) => { const a = ac(g, cs); return a ? Math.abs(signedCl(g, a)) : undefined; };
const inRange = (v: number | undefined, lo: number, hi: number) => v !== undefined && v >= lo && v <= hi;

export const LESSONS: Lesson[] = [
  {
    id: 'sector', title: 'The Liège sector', minutes: 4,
    summary: 'Runways, ALHUV, the arrival funnel, departures, terrain and airspace.',
    scenario: sc('sector', []),
    steps: [
      { title: 'You are Liège Approach', body: 'You work 119.280 for everything within about 40 NM of Liège and below FL095: arrivals from Brussels Control, departures from Liège Tower, and transit traffic. Tower owns the control zone below 2,500 ft. You own the sky around it.' },
      { title: 'Runway 22L', body: 'Runway 22L is in use today. The dashed line is its extended centreline, with a tick every nautical mile and numbers at 5, 10 and 15. The final approach fix L22LF sits 5.8 NM out at 2,500 ft. Runway 04R/22L is the long CAT III runway; 04L/22R is a contingency runway.', focus: { fix: 'L22LF', scale: 14 }, mark: { fix: 'L22LF', text: 'L22LF · FAF · 2,500 ft' } },
      { title: 'Everything funnels to ALHUV', body: 'Every arrival route (STAR) ends at ALHUV, about half a mile from the 22L threshold. If you give an arrival nothing else, it will hold here: left turns, 3,000 ft to FL050. Keep that in mind, because departures climb out right through this spot.', focus: { fix: 'ALHUV', scale: 12 }, mark: { fix: 'ALHUV', text: 'ALHUV · hold 3,000–FL050' } },
      { title: 'Transitions to final', body: 'From ALHUV, the RNAV transitions ALHUV1A and ALHUV1B swing north and east to LIBVA, the intermediate fix on the 22L final at 2,500 ft and 200 kt. Clearing a transition plus the ILS is the low-workload way to get an arrival onto final. Vectors are shorter.', focus: { fix: 'LIBVA', scale: 9 }, mark: { fix: 'LIBVA', text: 'LIBVA · IF · 2,500 ft' } },
      { title: 'Departures', body: 'Departures off 22L turn right and west via LG001 and LG002, climbing to FL060 at first. Those for LNO loop back south. Climb them once they are clear of your arrivals, and hand them to Brussels before they leave the 40 NM ring.', focus: { fix: 'LG002', scale: 7 }, mark: { fix: 'LG001', text: 'LG001 · first SID point' } },
      { title: 'Terrain', body: 'The amber-green tint shows higher ground. The overlay now shows minimum vectoring altitudes: 2,500 ft over the flat north-west, 3,000 and 3,500 ft over the Ardennes to the south-east. Never vector an aircraft below the number for the area it is in. These values are approximate until the real chart is coded.', onEnter: (g) => { g.settings.showMva = true; g.scope.fit(true); } },
      { title: 'Airspace', body: 'The solid line is the Class D control zone (Tower). The dashed box is the TMA. The amber outlines are military areas (TSAs); when one goes active it fills with hatching, and nobody of yours may enter it. That is the sector. Next lesson: your first aircraft.', onEnter: (g) => { g.settings.showMva = false; } },
    ],
  },
  {
    id: 'contact', title: 'First contact', minutes: 4,
    summary: 'A freighter calls. Select it, read its label, give it a descent, check the readback.',
    scenario: sc('contact', [A(2, 'QTR8125', 'B77L', 'KOK7X', 30)]),
    steps: [
      { title: 'Traffic is coming', body: 'A Qatar Cargo 777 is inbound on the KOK7X arrival from the west. The clock is running. Brussels has handed it to you; its label flashes green until the pilot calls.', run: 2, focus: { cs: 'QTR8125' }, done: (g) => calling(g, 'QTR8125') },
      { title: 'The pilot is calling', body: 'QTR8125 just checked in. A pilot waiting for you gets a flashing box round its callsign, and CALLS counts everyone waiting. Tap CALLS, or tap the aircraft.', el: '[data-e="callers"]', mark: { cs: 'QTR8125' }, done: (g) => g.cs === 'QTR8125' },
      { title: 'Read the label', body: 'Line 1: callsign, and H for heavy wake. Line 2: actual level, the trend arrow, and your cleared level when the two differ. Line 3: ground speed in tens of knots. Line 4: the next fix on its route. The bar at the bottom shows the selected aircraft.', mark: { cs: 'QTR8125' } },
      { title: 'Give it a descent', body: 'Tap LVL (or the second line of the label) and choose FL060. The choice appears as a chip in the bar, with the exact phrasing underneath.', el: '[data-p="lvl"]', done: (g) => g.cs === 'QTR8125' && g.items.some((i) => i.k === 'lvl') },
      { title: 'Check, then transmit', body: 'Read the phrase in the bar. Amber text would warn you of a problem, such as below minimum vectoring altitude. If it reads right, tap TRANSMIT.', el: '[data-a="send"]', done: (g, x) => sentTo(g, x, 'QTR8125', (k) => k === 'lvl') },
      { title: 'Listen for the readback', body: 'The pilot reads back your clearance. Always check it: level, heading, callsign. The comms log keeps every transmission.', run: 1, done: (g, x) => heardFrom(g, x, 'QTR8125') },
      { title: 'Readback correct', body: (g) => `QTR8125 is descending. Its label now shows the cleared level, and the strip shows it in large type. That is the whole loop: select, compose, check, transmit, hear back. Next lesson: vectors to the ILS.` },
    ],
  },
  {
    id: 'vectors', title: 'Vectors to the ILS', minutes: 8,
    summary: 'Downwind, base, a 30° intercept and the ILS clearance, then hand-off to Tower.',
    scenario: sc('vectors', [A(2, 'CHG201', 'B744', 'KOK7X', 13)]),
    steps: [
      { title: 'A 747 from the west', body: 'CHG201 is on the KOK7X arrival. Instead of letting it fly to ALHUV and hold, you will vector it: a downwind north of the field, a base turn, and a 30° intercept onto the 22L localizer.', run: 2, focus: { cs: 'CHG201' }, done: (g) => calling(g, 'CHG201') },
      { title: 'Select CHG201', body: 'Tap CALLS or the aircraft.', el: '[data-e="callers"]', mark: { cs: 'CHG201' }, done: (g) => g.cs === 'CHG201' },
      { title: 'Downwind: left heading 045', body: 'Drag from the aircraft symbol toward the north-east until the bubble reads L045, then let go. (Or tap HDG.) Downwind runs parallel to final, in the opposite direction to landing, about 6 to 8 NM off the centreline. Add FL060 with LVL and transmit both together.', mark: { cs: 'CHG201', text: 'drag from here' }, el: '[data-a="send"]', done: (g, x) => sentTo(g, x, 'CHG201', (k, it) => k === 'hdg' && inRange(it.hdg, 20, 70)) },
      { title: 'Down to 3,000 ft and 210 kt', body: 'North-west of the field the minimum vectoring altitude is 2,500 ft, so 3,000 ft is safe. Clear 3,000 ft and speed 210 kt in one call.', run: 1, el: '[data-p="lvl"]', done: (g, x) => sentTo(g, x, 'CHG201', (k, it) => k === 'lvl' && (it.lvl.ft ?? 99999) <= 4000) && sentTo(g, x, 'CHG201', (k) => k === 'spd') },
      { title: 'Fly the downwind', body: (g) => { const a = ac(g, 'CHG201'); const d = a ? g.sim.dthr(a) : 0; return `Let it run. Turn base when it is about 11 NM from the threshold, measured along the final: abeam the 10 mark on the centreline. ${a && d > 0 ? `Now ${d.toFixed(1)} NM.` : 'It is still short of the threshold.'}`; }, run: 4, mark: { fix: 'L22LF' }, done: (g) => { const a = ac(g, 'CHG201'); return !!a && g.sim.dthr(a) > 11; } },
      { title: 'Base turn: right heading 135', body: 'Turn right heading 135, perpendicular to final.', mark: { cs: 'CHG201' }, done: (g, x) => sentTo(g, x, 'CHG201', (k, it) => k === 'hdg' && inRange(it.hdg, 100, 170)) },
      { title: 'Intercept and clear the ILS', body: (g) => { const xt = offCl(g, 'CHG201'); return `Wait until it is about 2 NM from the centreline (now ${xt === undefined ? '—' : xt.toFixed(1)} NM). Then turn it right heading 195, 30° to the final course, and tap ILS 22L, both in one call: “turn right heading 195, cleared ILS approach runway 22L”. Too early and it intercepts late; too late and it flies through.`; }, run: 1, el: '[data-a="app"]', done: (g) => { const a = ac(g, 'CHG201'); return !!a?.app && inRange(hdgMag(g, a), 160, 215); } },
      { title: 'Localizer captured', body: (g) => { const a = ac(g, 'CHG201'); const xt = offCl(g, 'CHG201') ?? 0; return a && !a.app?.locCap && xt > 1 && Math.sign(signedCl(g, a)) !== entrySide ? 'It flew through the localizer. Turn it back towards the centreline with a heading of about 250, keep the ILS clearance, and it will capture from the other side.' : 'Wait for line 4 of the label to change to LOC22L with the distance to the threshold. From then on the aircraft follows the localizer and the glidepath by itself. Tap VP on the right to see the side view against the 3° slope.'; }, run: 2, el: '[data-z="vp"]', onEnter: (g) => { const a = ac(g, 'CHG201'); entrySide = a ? Math.sign(signedCl(g, a)) : 0; }, done: (g) => !!ac(g, 'CHG201')?.app?.locCap },
      { title: 'Slow it and hand it to Tower', body: 'Established, 8 to 12 NM out: give speed 160 kt and tap TWR, in one call. Leave it at 210 and it reaches 4 NM too fast to be stable and goes around. Tower clears it to land; pilots without a landing clearance go around at 2 NM.', el: '[data-a="twr"]', done: (g) => ac(g, 'CHG201')?.state === 'transferred' || g.sim.landings.length > 0 },
      { title: 'Landed', body: 'Let it land.', run: 4, done: (g) => g.sim.landings.length > 0 },
      { title: 'Nicely done', body: 'Downwind, base, 30° intercept, ILS, Tower. Vectoring like this is shorter than the transitions, and it is how you build a tight sequence. Next lesson: transitions and the hold.' },
    ],
  },
  {
    id: 'transitions', title: 'Transitions and the hold', minutes: 7,
    summary: 'Clear ALHUV1A with the ILS in one call, hold a second arrival, then release it.',
    scenario: sc('transitions', [A(2, 'AZG7321', 'B748', 'CIV7X', 24), A(25, 'QTR8152', 'B77L', 'LNO6X', 20)]),
    steps: [
      { title: 'Two arrivals', body: 'AZG7321 (747-8F) comes from the west on CIV7X, QTR8152 (777F) from the south-east on LNO6X. They will reach ALHUV about the same time. One goes first; the other holds.', run: 2, done: (g) => calling(g, 'AZG7321') },
      { title: 'Select AZG7321', body: 'Select the 747.', el: '[data-e="callers"]', mark: { cs: 'AZG7321' }, done: (g) => g.cs === 'AZG7321' },
      { title: 'Build the clearance', body: 'Tap TRANS and choose ALHUV1A. Tap LVL and choose 3,000 ft. Tap ILS 22L. Three chips, one call: the aircraft will fly the transition to LIBVA and join the ILS by itself.', el: '[data-p="trans"]', done: (g) => g.cs === 'AZG7321' && ['trans', 'lvl', 'app'].every((k) => g.items.some((i) => i.k === k)) },
      { title: 'Transmit', body: 'Check the phrase and transmit.', el: '[data-a="send"]', done: (g, x) => sentTo(g, x, 'AZG7321', (k) => k === 'trans') && sentTo(g, x, 'AZG7321', (k) => k === 'app') },
      { title: 'The second arrival', body: 'QTR8152 will call any moment. It is too close behind to follow straight in. Select it once it calls.', run: 1, mark: { cs: 'QTR8152' }, done: (g) => g.cs === 'QTR8152' && calling(g, 'QTR8152') },
      { title: 'Hold at ALHUV', body: 'Tap HOLD (hold at ALHUV as published) and transmit. Keep it at FL070 for now; the stack is left turns, 3,000 ft to FL050, so you will bring it down inside the hold.', el: '[data-a="hold"]', done: (g, x) => sentTo(g, x, 'QTR8152', (k) => k === 'hold') },
      { title: 'Into the stack', body: 'Clear QTR8152 to 5,000 ft, the top of the hold. Why not FL050? With today’s QNH of 1018 the transition level is FL055, so anything below it is given as an altitude in feet. The bar would warn you.', el: '[data-p="lvl"]', done: (g, x) => sentTo(g, x, 'QTR8152', (k, it) => k === 'lvl' && (it.lvl.fl ?? (it.lvl.ft ?? 0) / 100) <= 50) },
      { title: 'Wait for a gap', body: 'Let AZG7321 fly its transition. Both transitions meet at LIBVA, so release the holding aircraft only once AZG7321 is established on the localizer: line 4 of its label reads LOC22L. Release it earlier and the two arrive at LIBVA together.', run: 4, done: (g) => { const a = ac(g, 'AZG7321'); return !a || !!a.app?.locCap; } },
      { title: 'Release from the hold', body: 'Clear QTR8152 for ALHUV1B (the eastern transition), 3,000 ft and the ILS 22L.', mark: { cs: 'QTR8152' }, done: (g, x) => sentTo(g, x, 'QTR8152', (k) => k === 'trans') && !!ac(g, 'QTR8152')?.app },
      { title: 'Hand AZG7321 to Tower', body: 'AZG7321 is established. Select it and tap TWR.', run: 2, done: (g) => ac(g, 'AZG7321')?.state === 'transferred' || g.sim.landings.some((l) => l.cs === 'AZG7321') },
      { title: 'That is the funnel', body: 'Transitions are cheap on radio time and predictable. The hold is your buffer when the sequence is full. Next lesson: speed control and wake spacing.' },
    ],
  },
  {
    id: 'spacing', title: 'Speed and wake spacing', minutes: 7,
    summary: 'A 747-8F followed by a 767: RECAT-EU spacing, speed control and the FTDi chevron.',
    scenario: sc('spacing', [A(2, 'CLX7HK', 'B748', 'KOK7X', 20), A(40, 'TAY4EK', 'B763', 'KOK7X', 21)]),
    steps: [
      { title: 'Heavy followed by heavy', body: 'CLX7HK is a 747-8F (RECAT-EU category B). TAY4EK is a 767 (category C). Behind a B, a C needs 4 NM on final, not 3. They fly the same arrival, the 767 about a minute behind. Let the 747 check in.', run: 2, done: (g) => calling(g, 'CLX7HK') },
      { title: 'The leader is cleared', body: 'To save time, CLX7HK has been cleared for ALHUV1A, 3,000 ft and the ILS. Read its readback in the comms log. TAY4EK will call next.', run: 2, onEnter: (g) => {
        g.sim.issue({ cs: 'CLX7HK', items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }] });
      }, done: (g) => calling(g, 'TAY4EK') },
      { title: 'The follower is cleared', body: 'TAY4EK gets the same clearance. Both now fly the same path to the same runway. Spacing is down to you.', onEnter: (g) => {
        g.sim.issue({ cs: 'TAY4EK', items: [{ k: 'trans', name: 'ALHUV1A' }, { k: 'lvl', lvl: { ft: 3000 } }, { k: 'app', app: 'ILS', rwy: '22L' }] });
      } },
      { title: 'Watch the chevron', body: 'Turn on VP for the side view. When both are near final, a white chevron appears on the centreline: that is where TAY4EK should be, 4 NM behind CLX7HK. It turns red if TAY4EK gets inside it.', run: 4, el: '[data-z="vp"]', done: (g) => { const a = ac(g, 'CLX7HK'), b = ac(g, 'TAY4EK'); return !!a && !!b && (a.app?.locCap ?? false) && g.sim.dthr(b) < 16; } },
      { title: 'Control the gap with speed', body: (g) => { const a = ac(g, 'CLX7HK'), b = ac(g, 'TAY4EK'); const gap = a && b ? (g.sim.dthr(b) - g.sim.dthr(a)).toFixed(1) : '—'; return `The gap along final is ${gap} NM and it will shrink: the 747 slows down first, and the 767 catches up. Left alone, TAY4EK ends up inside 4 NM. Pick its speed with SPD. 180 kt holds the gap near 4.5 NM. 160 kt opens it wider than needed. 200 kt or more closes it. Give TAY4EK a speed now.`; }, mark: { cs: 'TAY4EK' }, el: '[data-p="spd"]', done: (g, x) => sentTo(g, x, 'TAY4EK', (k) => k === 'spd' || k === 'spdmin') },
      { title: 'Let them land', body: 'Hand each one to Tower once it shows LOC22L, and watch the chevron.', run: 4, done: (g) => g.sim.landings.length >= 2 },
      { title: 'Result', body: (g) => { const s = g.sim.spacing.find((x) => x.leader === 'CLX7HK'); const w = g.sim.events.some((e) => e.kind === 'wake' && e.cs === 'TAY4EK'); if (w) return 'TAY4EK got inside 4 NM on final: a wake infringement. Restart and try 180 kt at the speed step. Real approach units aim for the minimum plus about half a mile.'; return s ? `TAY4EK was ${s.gap.toFixed(1)} NM behind at touchdown against a ${s.min} NM minimum${s.gap < s.min ? ': too close, a wake infringement' : s.gap - s.min > 1.5 ? ': safe, but you gave away a landing slot' : ': well judged'}. Real approach units aim for the minimum plus about half a mile.` : 'Both are down. Real approach units aim for the minimum plus about half a mile.'; } },
    ],
  },
  {
    id: 'departures', title: 'Departures', minutes: 6,
    summary: 'Climb a departure through an arrival safely, measure with RBL, hand it to Brussels.',
    scenario: sc('departures', [A(1, 'FDX5203', 'MD11', 'GESLO6X', 16), { t: 25, kind: 'dep', cs: 'CHG7302', type: 'B748', sid: 'LNO9S' }]),
    steps: [
      { title: 'One up, one down', body: 'FDX5203 is descending towards ALHUV from the south-east, out of FL090. CHG7302 is about to depart 22L on LNO9S, initial climb FL060. Their paths cross near the field.', run: 2, done: (g) => calling(g, 'CHG7302') },
      { title: 'Take the departure', body: 'Select CHG7302. It is climbing to FL060, below the arrival. Answer it, so it is not left waiting: for now, just re-confirm FL060 with LVL.', el: '[data-e="callers"]', done: (g, x) => sentTo(g, x, 'CHG7302') },
      { title: 'Measure with RBL', body: 'Tap RBL, then drag from one aircraft to the other. The line shows bearing, distance and CPA, the closest point of approach on present tracks. Red means they will pass within 3 NM and 1,000 ft.', el: '[data-z="rbl"]', done: (g) => g.scope.rbls.length > 0 },
      { title: 'Arrival down first', body: 'Turn RBL off. Get the arrival below the departure’s next level: select FDX5203 and clear it to 4,000 ft.', run: 1, mark: { cs: 'FDX5203' }, done: (g, x) => sentTo(g, x, 'FDX5203', (k, it) => k === 'lvl' && (it.lvl.ft ?? 99999) <= 5000) },
      { title: 'Now climb the departure', body: 'When FDX5203 is passing 5,000 ft or clearly separated laterally, climb CHG7302 to FL090, the top of your airspace.', run: 1, done: (g, x) => sentTo(g, x, 'CHG7302', (k, it) => k === 'lvl' && it.lvl.fl === 90) },
      { title: 'Hand it to Brussels', body: 'Before it reaches the 40 NM ring, tap BRU and transmit. Brussels Control takes it higher.', run: 2, el: '[data-a="bru"]', done: (g) => ac(g, 'CHG7302')?.state === 'transferred' || !ac(g, 'CHG7302') },
      { title: 'Clean', body: 'Separate vertically first, then climb when it is safe, and transfer before the boundary. Next lesson: the safety nets.' },
    ],
  },
  {
    id: 'safety', title: 'Safety nets', minutes: 5,
    summary: 'Catch a wrong readback with Mode S, and know what CLAM and STCA mean.',
    scenario: sc('safety', [A(2, 'ETH3721', 'B77L', 'KOK7X', 26)]),
    steps: [
      { title: 'Readbacks go wrong', body: 'Pilots sometimes read back, and set, the wrong level. Liège requires Mode S, which shows you the level the pilot actually selected. This pilot is going to get it wrong.', run: 2, done: (g) => calling(g, 'ETH3721') },
      { title: 'Clear a descent', body: 'Select ETH3721 and clear it to FL060.', onEnter: (g) => g.sim.forceWrong.add('ETH3721'), mark: { cs: 'ETH3721' }, done: (g, x) => sentTo(g, x, 'ETH3721', (k) => k === 'lvl') },
      { title: 'Listen carefully', body: 'Listen to the readback.', run: 1, done: (g, x) => heardFrom(g, x, 'ETH3721') },
      { title: 'Spot it', body: 'Did you hear it? The pilot read back the wrong level and set it. The label now shows an amber ≠ field with the selected level, and the strip CFL turns amber. If it descends 300 ft through the level you cleared, CLAM flashes red.', mark: { cs: 'ETH3721', text: 'look at line 2' } },
      { title: 'Correct it', body: 'Re-issue the same level you meant: select ETH3721, LVL, the right level, transmit. Correcting within 30 seconds counts as a catch in your assessment.', done: (g) => g.sim.events.some((e) => e.kind === 'readback_caught' && e.cs === 'ETH3721') },
      { title: 'The other alarms', body: 'STCA (short-term conflict alert): two labels turn red with a glowing line and the distance between them. Act at once, with a turn or a level. MSAW: an aircraft is below the minimum vectoring altitude. REQ: a pilot is asking for something; Approve or Unable appear in the bar. You have finished the tutorial. Try the Tier 1 challenges next.' },
    ],
  },
];

// ---------------- the coach overlay ----------------
const KEY = 'lgg.tutorial';
export const tutorialDone = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { return new Set(); } };
const markDone = (id: string) => { try { const s = tutorialDone(); s.add(id); localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* storage unavailable */ } };

export function coachFor(lesson: Lesson, nav: { next?: () => void; exit: () => void; restart: () => void }) {
  return (g: Game) => {
    const host = g.root.querySelector('.scope-wrap')!;
    const card = document.createElement('section');
    card.className = 'coach';
    card.setAttribute('aria-live', 'polite');
    host.appendChild(card);
    let i = -1;
    let ctx: StepCtx = { cmdStart: 0, logStart: 0, t0: 0 };
    let hl: Element | null = null;
    let timer = 0;
    let collapsed = false;

    const go = (n: number) => {
      hl?.classList.remove('coach-hl');
      i = n;
      const st = lesson.steps[i];
      ctx = { cmdStart: g.sim.cmdLog.length, logStart: g.sim.log.length, t0: g.sim.t };
      st.onEnter?.(g, ctx);
      g.setSpeed(st.run ?? 0);
      g.scope.marks = st.mark ? [st.mark] : [];
      hl = st.el ? g.root.querySelector(st.el) : null;
      hl?.classList.add('coach-hl');
      render();
      if (st.focus) {
        const p = st.focus.fix ? g.sim.pack.fixes.get(st.focus.fix)?.p : st.focus.cs ? g.sim.find(st.focus.cs)?.p : undefined;
        if (p) {
          // centre the point in the part of the scope the card leaves open
          const sc = st.focus.scale ?? g.scope.scale, W = host.clientWidth, H = host.clientHeight;
          const r = card.getBoundingClientRect(), hr = host.getBoundingClientRect();
          const beside = r.right - hr.left < W * 0.6; // card sits at the left (wide screens)
          const sx = beside ? (r.right - hr.left + W) / 2 : W / 2;
          const sy = beside ? H / 2 : r.bottom - hr.top + (H - (r.bottom - hr.top)) * 0.58;
          g.scope.focus({ x: p.x - (sx - W / 2) / sc, y: p.y + (sy - H / 2) / sc }, st.focus.scale);
        }
      }
    };
    const render = () => {
      const st = lesson.steps[i];
      const last = i === lesson.steps.length - 1;
      const body = typeof st.body === 'function' ? st.body(g) : st.body;
      const waiting = !!st.done && !last;
      card.classList.toggle('collapsed', collapsed);
      card.innerHTML = `
        <header><span class="coach-lesson">${lesson.title}</span><span class="coach-step">${i + 1} / ${lesson.steps.length}</span>
          <button class="coach-min" data-c="min" aria-label="${collapsed ? 'Expand' : 'Minimise'}">${collapsed ? '▾' : '▴'}</button></header>
        <div class="coach-bar"><i style="width:${((i + 1) / lesson.steps.length) * 100}%"></i></div>
        <h4>${st.title}</h4>
        <p>${body}</p>
        <footer>
          <button data-c="exit">Exit</button><button data-c="restart">Restart</button>
          <span class="grow"></span>
          ${waiting ? `<span class="coach-wait">${(st.run ?? 0) > 0 ? 'Clock running…' : 'Your move'}</span><button data-c="skip" class="ghost">Skip</button>`
            : last ? (nav.next ? '<button data-c="nextLesson" class="go">Next lesson</button>' : '<button data-c="exit" class="go">Finish</button>') : '<button data-c="next" class="go">Next</button>'}
        </footer>`;
    };
    card.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-c]') as HTMLElement | null;
      if (!b) return;
      e.stopPropagation();
      const c = b.dataset.c;
      if (c === 'next' || c === 'skip') { if (i < lesson.steps.length - 1) go(i + 1); }
      else if (c === 'nextLesson') { markDone(lesson.id); nav.next?.(); }
      else if (c === 'exit') { if (i === lesson.steps.length - 1) markDone(lesson.id); nav.exit(); }
      else if (c === 'restart') nav.restart();
      else if (c === 'min') { collapsed = !collapsed; render(); }
    });
    timer = window.setInterval(() => {
      const st = lesson.steps[i];
      if (st?.done && st.done(g, ctx)) { if (i < lesson.steps.length - 1) go(i + 1); }
      else if (st && typeof st.body === 'function') { const p = card.querySelector('p'); if (p) p.innerHTML = st.body(g); }
      if (i === lesson.steps.length - 1) markDone(lesson.id);
    }, 300);
    go(0);
    return { destroy() { clearInterval(timer); hl?.classList.remove('coach-hl'); g.scope.marks = []; card.remove(); } };
  };
}
