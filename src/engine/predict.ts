import type { XY } from '../geo';
import type { Leg, Runway } from '../pack/load';
import { startHold, stepAircraft, type PilotWorld } from './pilot';
import type { Aircraft } from './types';
import type { Weather } from './weather';

/** One predicted sample of an aircraft's future, from the real pilot model. */
export interface PredPt {
  t: number;          // seconds from now
  p: XY;
  alt: number;        // ft
  hdg: number;        // true
  gs: number;         // kt
  locCap: boolean;
  /** Something happened in the second leading up to this point. */
  event?: 'leveloff' | 'loc' | 'gs';
}

/** What predict() needs from the sim. The Sim class satisfies it. */
export interface PredictWorld {
  t: number;
  weather: Weather;
  qnh: number;
  lvp: boolean;
  runway: string;
  pack: { holds: { fix: string }[]; stars: { name: string }[]; runways: Map<string, Runway> };
  holdFor(fix: string): { inbound: number; turn: 'L' | 'R'; spd: number } | undefined;
}

/**
 * Copy of an aircraft that the pilot model can step without touching the original.
 * Copies every field stepAircraft mutates (position, energy, route array, approach and hold state, counters).
 */
export function cloneForPredict(ac: Aircraft): Aircraft {
  const c: Aircraft = {
    ...ac,
    p: { ...ac.p },
    route: ac.route.slice(),
    savedRoute: ac.savedRoute?.slice(),
    app: ac.app ? { ...ac.app } : undefined,
    hold: ac.hold ? { ...ac.hold, p: { ...ac.hold.p } } : undefined,
    history: [],
    label: { ...ac.label },
  };
  return c;
}

/** Side-effect free world: no transmissions, no events, go-arounds and touchdowns just end the prediction. */
class StubWorld implements PilotWorld {
  t: number;
  weather: Weather;
  qnh: number;
  lvp: boolean;
  stopped = false;
  constructor(private w: PredictWorld) { this.t = w.t; this.weather = w.weather; this.qnh = w.qnh; this.lvp = w.lvp; }
  holdFor(fix: string) { return this.w.holdFor(fix); }
  runwayBusy() { return false; }
  goAround() { this.stopped = true; }
  onTouchdown() { this.stopped = true; }
  onTooHigh() { /* the pilot only asks for vectors; nothing to predict */ }
  /** Mirrors Sim.onRouteEnd without any radio calls. */
  onRouteEnd(ac: Aircraft, last: Leg) {
    if (last.fix === '__LOSTCOMM__') { ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg; return; }
    const holdAt = (ac as any)._holdAt as string | undefined;
    if (holdAt && holdAt === last.fix) { (ac as any)._holdAt = undefined; startHold(ac, this, last.fix, last.p); return; }
    if (ac.kind === 'arr') {
      if (ac.app) { ac.mode = 'HDG'; ac.hdgAssigned = ac.app.rwy.crs; return; }
      if (this.w.pack.holds.some((h) => h.fix === last.fix) && ac.proc && this.w.pack.stars.some((s) => s.name === ac.proc)) { startHold(ac, this, last.fix, last.p); return; }
      const r = this.w.pack.runways.get(ac.expectRwy ?? this.w.runway);
      ac.mode = 'HDG'; ac.hdgAssigned = r && last.fix === r.ifFix ? r.crs : ac.hdg;
      return;
    }
    if (ac.kind === 'vfr' || ac.kind === 'heli') { ac.mode = 'ORBIT'; return; }
    ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg;
  }
}

/**
 * Predict an aircraft's next `seconds` by stepping the real pilot model on a clone, one second at a time.
 * Returns a sample every `step` seconds (the first at t = step), plus extra samples at level-off,
 * localizer capture and glideslope capture. `mutate` lets a caller try a candidate clearance on the clone first.
 * `dt` is the integration step (1 s by default; 2.5 s halves the cost for display ghosts). It must divide `step`.
 */
export function predict(sim: PredictWorld, ac: Aircraft, seconds: number, step = 5, mutate?: (c: Aircraft) => void, dt = 1): PredPt[] {
  const c = cloneForPredict(ac);
  // the controller will hand it to Tower in time: do not predict a "no landing clearance" go-around
  if (c.state !== 'transferred') c.state = 'transferred';
  mutate?.(c);
  const world = new StubWorld(sim);
  const out: PredPt[] = [];
  const pt = (t: number, event?: PredPt['event']): PredPt => ({ t, p: { ...c.p }, alt: c.alt, hdg: c.hdg, gs: c.gs, locCap: !!c.app?.locCap, event });
  const n = Math.floor(seconds / dt);
  for (let i = 1; i <= n; i++) {
    const t = Math.round(i * dt * 1000) / 1000;
    const wasLoc = !!c.app?.locCap, wasGs = !!c.app?.gsCap;
    const wasOff = Math.abs(c.alt - c.tgtAlt) >= 50 && Math.abs(c.vs) > 100;
    world.t += dt;
    stepAircraft(c, world, dt);
    if (world.stopped) { out.push(pt(t)); break; }
    let ev: PredPt['event'];
    if (!wasLoc && c.app?.locCap) ev = 'loc';
    else if (!wasGs && c.app?.gsCap) ev = 'gs';
    else if (wasOff && Math.abs(c.alt - c.tgtAlt) < 50 && !c.app?.gsCap) ev = 'leveloff';
    if (ev) out.push(pt(t, ev));
    else if (Math.abs(t / step - Math.round(t / step)) < 1e-6) out.push(pt(t));
  }
  return out;
}

/** Position at time t (s) by linear interpolation of a prediction. */
export function predAt(pts: PredPt[], t: number, from: XY): XY {
  let prev: { t: number; p: XY } = { t: 0, p: from };
  for (const q of pts) {
    if (q.t >= t) {
      const k = q.t === prev.t ? 1 : (t - prev.t) / (q.t - prev.t);
      return { x: prev.p.x + (q.p.x - prev.p.x) * k, y: prev.p.y + (q.p.y - prev.p.y) * k };
    }
    prev = q;
  }
  return prev.p;
}
