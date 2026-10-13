import type { Sim } from './sim';
import type { Aircraft } from './types';
import type { Item } from './clearance';
import type { Level } from '../pack/load';
import { alongTrack, angDiff, bearing, crossTrack, dist, norm360 } from '../geo';

// Next-call suggestions: the one or two clearances an approach controller would
// most likely give this aircraft now, worked out from its phase and geometry.
// The game shows them as one-tap chips; the player still decides.

export interface Suggestion {
  /** short chip label, e.g. "ALHUV1A · 2500 · ILS 22L" */
  label: string;
  items: Item[];
  /** one plain-English line on why */
  why: string;
  /** primary = the most likely call */
  primary?: boolean;
  /** sim.validate warnings for this suggestion */
  warn?: string[];
  /** intercom answer (release / MIL) rather than a radio call */
  icom?: boolean;
}

const mag = (sim: Sim, trueHdg: number) => Math.round(norm360(trueHdg - sim.pack.meta.magVar) / 5) * 5 || 360;
const p3 = (n: number) => String(Math.round(n) % 360 || 360).padStart(3, '0');
export const turnDir = (fromMag: number, toMag: number): 'L' | 'R' => (norm360(toMag - fromMag) <= 180 ? 'R' : 'L');
export const hdgItem = (sim: Sim, ac: Aircraft, toMag: number): Item => ({ k: 'hdg', hdg: toMag, dir: turnDir(norm360(ac.hdg - sim.pack.meta.magVar), toMag) });
const lvlLabel = (l: Level) => (l.fl !== undefined ? `FL${String(l.fl).padStart(3, '0')}` : `${l.ft}`);

/** Valid levels for pickers and the ladder, highest first: flight levels from FL140 down to the transition level, then altitudes. */
export function levelList(sim: Sim, top = 140): Level[] {
  const out: Level[] = [];
  for (let fl = top; fl >= sim.tl; fl -= 10) out.push({ fl });
  for (const ft of [7000, 6000, 5000, 4500, 4000, 3500, 3000, 2500, 2000]) if (ft < sim.tl * 100 - 400) out.push({ ft });
  return out;
}

/** The STAR-to-final transition whose first leg points most nearly at the aircraft. */
export function bestTransition(sim: Sim, ac: Aircraft) {
  const trs = sim.transitionsFor(sim.runway).filter((t) => !t.atcDiscretion);
  const alh = sim.pack.fixes.get('ALHUV')?.p ?? sim.rwy.thr;
  const brgAc = bearing(alh, ac.p);
  let best = trs[0], bd = 999;
  for (const t of trs) {
    const leg = t.legs[1] ?? t.legs[0];
    const d = Math.abs(angDiff(bearing(alh, leg.p), brgAc));
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

export function suggest(sim: Sim, ac: Aircraft): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (s: Suggestion) => { if (out.length < 4 && !out.some((o) => o.label === s.label)) out.push(s); };
  const rw = sim.pack.runways.get(ac.expectRwy ?? sim.runway) ?? sim.rwy;
  const crsMag = mag(sim, rw.crs);
  const curMag = norm360(ac.hdg - sim.pack.meta.magVar);
  const ifLvl = sim.levelFor(rw.ifAlt);
  const ils: Item = { k: 'app', app: rw.ils && !sim.ilsOut.has(rw.id) ? 'ILS' : 'RNP', rwy: rw.id };
  const appName = `${(ils as any).app} ${rw.id}`;

  // 1. wrong readback: say it again, correctly
  if (ac.wrong) {
    if (ac.wrong.item.k === 'lvl' && ac.cflSys) add({ label: `Negative · ${lvlLabel(ac.cflSys)}`, items: [{ k: 'lvl', lvl: ac.cflSys }], why: `The pilot read back ${lvlLabel((ac.wrong.item as any).lvl)}. Say the level again.`, primary: true });
    else if (ac.wrong.item.k === 'hdg' && ac.hdgSys !== undefined) { const h = mag(sim, ac.hdgSys); add({ label: `Negative · H${p3(h)}`, items: [hdgItem(sim, ac, h)], why: 'The pilot read back the wrong heading. Say it again.', primary: true }); }
  }
  // 2. requests
  const rq = ac.request;
  if (rq && ac.state === 'assumed') {
    if (rq.kind === 'climb' && rq.level) add({ label: `Climb ${lvlLabel(rq.level)}`, items: [{ k: 'lvl', lvl: rq.level }], why: rq.text, primary: true });
    else if (rq.kind === 'direct' && rq.fix) add({ label: `Direct ${rq.fix}`, items: [{ k: 'dct', fix: rq.fix }], why: rq.text, primary: true });
    else if (rq.kind === 'vectors') {
      const away = norm360(crsMag + 180);
      add({ label: `Break off · H${p3(away)} · 3000`, items: [{ k: 'brk' }, hdgItem(sim, ac, away), { k: 'lvl', lvl: sim.levelFor(3000) }], why: 'Too high for the glide. Take it off the approach and bring it round again.', primary: true });
    } else add({ label: 'Approve', items: [{ k: 'appr' }], why: rq.text, primary: true });
    add({ label: 'Unable', items: [{ k: 'deny' }], why: 'Refuse the request.' });
  }
  if (ac.atisOld) add({ label: `ATIS ${sim.atis} current`, items: [{ k: 'atis' }], why: 'The pilot has an old ATIS. Give the current letter and QNH.' });
  if (ac.state !== 'assumed' || ac.radioFail) return finish(sim, ac, out);

  if (ac.kind === 'arr') {
    const d = sim.dthr(ac);
    const xt = crossTrack(ac.p, rw.thr, rw.crs);
    const along = alongTrack(ac.p, rw.thr, norm360(rw.crs + 180));
    if (ac.app?.locCap) {
      if (ac.app.tooHigh) return finish(sim, ac, out);
      add({ label: 'Tower', items: [{ k: 'xfr', unit: 'TWR' }], why: 'Established on the localizer. Hand it to Tower.', primary: d < 14 });
      if (ac.ias > 175 && d > 5) add({ label: '160 to 4 · Tower', items: [{ k: 'spd', spd: 160, until: 4 }, { k: 'xfr', unit: 'TWR' }], why: 'Slow it for a stable approach and hand it over in one call.' });
      return finish(sim, ac, out);
    }
    if (ac.mode === 'HOLD') {
      const tr = bestTransition(sim, ac);
      add({ label: `Leave hold · ${tr?.name ?? ''} · ${lvlLabel(ifLvl)} · ${appName}`, items: [...(tr ? [{ k: 'trans', name: tr.name } as Item] : []), { k: 'lvl', lvl: ifLvl }, ils], why: 'Release it from the hold onto the transition and the approach.', primary: true });
      const hold = sim.pack.holds.find((h) => h.fix === ac.hold?.fix);
      if (hold && ac.tgtAlt > sim.ftOf(hold.max) + 50) { const top = sim.levelFor(hold.max.fl !== undefined ? hold.max.fl * 100 : hold.max.ft ?? 5000); add({ label: `Descend ${lvlLabel(top)}`, items: [{ k: 'lvl', lvl: top }], why: 'Bring it down to the top of the hold.' }); }
      return finish(sim, ac, out);
    }
    if (ac.app && !ac.app.locCap) {
      if (ac.mode === 'HDG' && Math.abs(xt) > 0.6 && Math.abs(angDiff(curMag, crsMag)) > 50) {
        const h = norm360(crsMag - 30 * Math.sign(xt));
        add({ label: `Intercept ${turnDir(curMag, h)}${p3(h)}`, items: [hdgItem(sim, ac, h)], why: '30° to the final course so the localizer captures cleanly.', primary: Math.abs(xt) < 3 });
      }
      if (ac.ias > 200 && d < 18) add({ label: 'Speed 180', items: [{ k: 'spd', spd: 180 }], why: 'Slow it before the localizer.' });
      return finish(sim, ac, out);
    }
    if (ac.mode === 'HDG') {
      const s = Math.sign(xt) || 1;
      const intercept = norm360(crsMag - 30 * s);
      const towards = Math.sin(((ac.hdg - rw.crs) * Math.PI) / 180) * s < 0; // closing the centreline
      if (Math.abs(xt) < 4.5 && along > 6 && (towards || Math.abs(angDiff(curMag, crsMag)) < 100)) {
        const items: Item[] = [hdgItem(sim, ac, intercept), ils];
        if (ac.tgtAlt > rw.ifAlt + 300) items.splice(1, 0, { k: 'lvl', lvl: ifLvl });
        add({ label: `${turnDir(curMag, intercept)}${p3(intercept)} · ${appName}`, items, why: `${Math.abs(xt).toFixed(1)} NM from the centreline. 30° intercept and approach clearance.`, primary: Math.abs(xt) < 3 });
      }
      const downwind = norm360(crsMag + 180);
      if (along > 10 && Math.abs(angDiff(curMag, downwind)) < 40 && Math.abs(xt) > 3) {
        const base = norm360(crsMag - 90 * s);
        add({ label: `Base ${turnDir(curMag, base)}${p3(base)}`, items: [hdgItem(sim, ac, base)], why: `${along.toFixed(0)} NM out along the final. Turn base.`, primary: along > 11 });
      }
      if (along < 6 && Math.abs(xt) > 2 && Math.abs(angDiff(curMag, downwind)) > 40) add({ label: `Downwind ${turnDir(curMag, downwind)}${p3(downwind)}`, items: [hdgItem(sim, ac, downwind)], why: 'Too close in to turn onto final. Take it out on a downwind.' });
    }
    // on a STAR: the low-workload transition, or a hold when the sequence is full
    if (ac.mode === 'NAV' && !ac.app) {
      const tr = bestTransition(sim, ac);
      const ahead = sim.aircraft.filter((o) => o !== ac && o.kind === 'arr' && o.state !== 'unconcerned' && (o.app || o.mode === 'HOLD') && sim.dthr(o) < d + 4).length;
      if (tr) add({ label: `${tr.name} · ${lvlLabel(ifLvl)} · ${appName}`, items: [{ k: 'trans', name: tr.name }, { k: 'lvl', lvl: ifLvl }, ils], why: 'Transition, approach altitude and the approach in one call: it flies to final by itself.', primary: ahead < 2 });
      if (ahead >= 2) add({ label: 'Hold ALHUV', items: [{ k: 'hold', fix: 'ALHUV' }], why: `${ahead} ahead of it. Hold until there is a gap.`, primary: true });
      const cl = sim.ftOf(ac.cleared);
      const step = levelList(sim).find((l) => sim.ftOf(l) <= cl - 1900 && sim.ftOf(l) >= sim.mvaAt(ac.p) + 500);
      if (step && d < 30) add({ label: `Descend ${lvlLabel(step)}`, items: [{ k: 'lvl', lvl: step }], why: 'Keep it coming down: about 3 NM per 1,000 ft.' });
    }
    if (ac.mode === 'HDG' && ac.tgtAlt > rw.ifAlt + 300) {
      const mva = sim.mvaAt(ac.p);
      const lv = levelList(sim).find((l) => sim.ftOf(l) <= ac.tgtAlt - 900 && sim.ftOf(l) >= Math.max(mva, rw.ifAlt));
      if (lv) add({ label: `Descend ${lvlLabel(lv)}`, items: [{ k: 'lvl', lvl: lv }], why: `Minimum vectoring altitude here is ${mva} ft.` });
    }
    if (ac.ias > 230 && d < 25 && !ac.spdAssigned) add({ label: 'Speed 210', items: [{ k: 'spd', spd: 210 }], why: 'Slow it to make the sequence work.' });
  } else if (ac.kind === 'dep' || ac.kind === 'mil' || ac.kind === 'ovf') {
    const cl = sim.ftOf(ac.cleared);
    if (ac.kind === 'dep' && cl < sim.ftOf({ fl: 90 }) - 50) add({ label: 'Climb FL090', items: [{ k: 'lvl', lvl: { fl: 90 } }], why: 'Top of your airspace. Check nothing is above it first.', primary: ac.alt > 3000 });
    const r0 = dist(ac.p, { x: 0, y: 0 });
    if (r0 > 18 || ac.alt > 7000) add({ label: 'Brussels', items: [{ k: 'xfr', unit: ac.kind === 'mil' ? 'MIL' : 'BRU' }], why: 'Hand it on before it leaves the 40 NM ring.', primary: r0 > 25 });
  }
  return finish(sim, ac, out);
}

function finish(sim: Sim, ac: Aircraft, out: Suggestion[]) {
  for (const s of out) s.warn = s.items.some((i) => i.k === 'appr' || i.k === 'deny' || i.k === 'brk') ? [] : sim.validate({ cs: ac.cs, items: s.items });
  // the primary first
  out.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  return out;
}
