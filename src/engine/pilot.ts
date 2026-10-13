import { alongTrack, angDiff, bearing, clamp, crossTrack, DEG, dist, move, norm360, type XY } from '../geo';
import { levelToFt, type Leg, type Runway } from '../pack/load';
import type { Aircraft } from './types';
import type { Weather } from './weather';
import { windAt } from './weather';

/** What the pilot model needs from the sim. */
export interface PilotWorld {
  t: number;
  weather: Weather;
  qnh: number;
  holdFor(fix: string): { inbound: number; turn: 'L' | 'R'; spd: number } | undefined;
  onRouteEnd(ac: Aircraft, last: Leg): void;
  onTouchdown(ac: Aircraft, rwy: Runway): void;
  goAround(ac: Aircraft, reason: string): void;
  /** Pilot is too high to capture the glide from above and asks for vectors. */
  onTooHigh(ac: Aircraft): void;
  /** Cleared for the ILS on a heading parallel to the final but outside the localizer: the pilot asks for vectors (once). */
  onCannotIntercept?(ac: Aircraft): void;
  runwayBusy(): boolean;
  lvp: boolean;
}

export const GS_FT_PER_NM = 318.4; // 3° glidepath
export const tas = (ias: number, alt: number) => ias * (1 + 0.017 * Math.max(0, alt) / 1000);

export function turnRate(ac: Aircraft): number {
  if (ac.perf.heli || ac.perf.fighter) return 3;
  return Math.min(3, 508 / Math.max(60, tas(ac.ias, ac.alt)));
}
export function turnRadius(ac: Aircraft): number {
  return tas(ac.ias, ac.alt) / (20 * Math.PI * turnRate(ac));
}

/** Half-width of the localizer capture window at `d` NM: about 1.5 NM at 10 NM, never less than 0.3 NM. */
export const locWindowNm = (d: number) => Math.max(0.3, d * 0.15);

export function distToThr(p: XY, rwy: Runway) { return -alongTrack(p, rwy.thr, rwy.crs); }
export function glideAlt(rwy: Runway, dthr: number) { return rwy.elevation + (rwy.tch ?? 50) + dthr * GS_FT_PER_NM; }

/** Heading (true) that makes good the desired track given the wind at altitude. */
function windCorrected(ac: Aircraft, trackTrue: number, w: Weather): number {
  const wa = windAt(w, ac.alt);
  const toward = (wa.dir + 180) * DEG;
  const wx = Math.sin(toward) * wa.kt, wy = Math.cos(toward) * wa.kt;
  const nx = Math.cos(trackTrue * DEG), ny = -Math.sin(trackTrue * DEG);
  const wp = wx * nx + wy * ny;
  const v = tas(ac.ias, ac.alt);
  const wca = Math.asin(clamp(wp / Math.max(v, 1), -0.9, 0.9)) / DEG;
  return norm360(trackTrue - wca);
}

/** Distance from the threshold of the stability gate (1,000 ft above the aerodrome on a 3° path). */
export const STABLE_GATE_NM = 3.1;
/** Deceleration on the localizer, kt per second (approach flap and gear help). */
export const finalDecel = (ac: Aircraft) => ac.perf.decel * 1.4;
/** Track miles a crew needs on the localizer to slow from `from` kt to within 15 kt of Vapp, plus a small margin. */
export function decelNm(ac: Aircraft, from: number): number {
  const dv = Math.max(0, from - (ac.perf.vapp + 15));
  return (dv / finalDecel(ac)) * ((from + ac.perf.vapp) / 2) / 3600 + 0.4;
}
/** Final approach fix distance for a runway (FAF position is not in the Runway record: use the 3° path from the FAF altitude). */
export const finalFixNm = (r: Runway) => Math.max(0, (r.fafAlt - r.elevation - (r.tch ?? 50)) / GS_FT_PER_NM);
/**
 * Extra distance an autopilot carries through the localizer before it is back on it, for an intercept angle (deg) and
 * true airspeed (kt): none up to about 35°, then growing with the angle and the speed (about 1 NM at 90° and 180 kt).
 */
export const locOvershootNm = (angDeg: number, tasKt: number) => (angDeg > 35 ? ((Math.min(angDeg, 135) - 35) / 55) * (tasKt / 180) : 0);

export function speedTarget(ac: Aircraft, world: PilotWorld): number {
  const pf = ac.perf;
  if (ac.kind === 'vfr' || ac.kind === 'heli') return pf.vfrCruise ?? pf.vcruiseLow;
  // one engine out: no more than 200 kt, until the localizer where it slows like everyone else
  if (ac.emergency === 'engine' && !ac.app?.locCap) return Math.min(ac.spdAssigned ?? 200, 200);
  const app = ac.app;
  if (app && app.locCap) {
    const d = distToThr(ac.p, app.rwy);
    if (d <= 4.5) return pf.vapp;
    if (ac.spdAssigned) {
      // An open speed restriction ends at the final approach fix (about 6 NM); "until 4 NM" holds it to 4 NM.
      // Either way the crew slows early enough to be stable at the 1,000 ft gate, whatever they were told.
      const fafNm = Math.max(6, finalFixNm(app.rwy));
      const release = Math.max(ac.spdUntil ?? fafNm, STABLE_GATE_NM + decelNm(ac, ac.spdAssigned));
      if (d > release) return ac.spdAssigned;
      return pf.vapp;
    }
    // without a speed instruction the crew never speeds up on the localizer: 180 kt by 12 NM, 160 kt by 7 NM, or slower if already slower
    if (d <= 7) return Math.max(pf.vapp, Math.min(ac.ias, 160));
    if (d <= 12) return Math.max(pf.vapp, Math.min(ac.ias, 180));
    return Math.max(pf.vapp, Math.min(ac.ias, Math.max(pf.vminFlap, 210)));
  }
  if (ac.spdMin) return pf.vminClean;
  if (ac.spdAssigned) return ac.spdAssigned;
  // slow to 250 kt before passing FL100 (pilots plan the deceleration ahead)
  let v = ac.alt < 11500 || ac.vs < -500 && ac.tgtAlt < 10000 ? Math.min(250, pf.vcruiseLow) : 280;
  if (pf.fighter) v = ac.alt < 10000 ? 300 : 350;
  if (ac.kind === 'dep' && ac.alt < 3000) v = pf.vminFlap + 40;
  const leg = ac.route[0];
  if (ac.mode === 'NAV' && leg?.spd) v = Math.min(v, leg.spd);
  if (ac.mode === 'HOLD' && ac.hold) v = Math.min(v, world.holdFor(ac.hold.fix)?.spd ?? 230);
  if (ac.kind === 'arr' && ac.app) {
    const d = distToThr(ac.p, ac.app.rwy);
    if (d < 12) v = Math.min(v, Math.max(pf.vminClean, 200));
    else if (d < 20) v = Math.min(v, Math.max(pf.vminClean, 220));
  }
  return v;
}

/** ICAO Doc 8168 holding entry from the heading over the fix: direct, teardrop (offset) or parallel. */
export function holdEntry(hdg: number, inbound: number, turn: 'L' | 'R'): 'direct' | 'teardrop' | 'parallel' {
  const d = angDiff(inbound, hdg) * (turn === 'L' ? -1 : 1); // heading relative to the inbound course, mirrored for left-hand holds
  return d >= -70 && d <= 110 ? 'direct' : d > 110 ? 'teardrop' : 'parallel';
}
function startHold(ac: Aircraft, world: PilotWorld, fix: string, p: XY) {
  const h = world.holdFor(fix);
  const inbound = h?.inbound ?? bearing(ac.p, p);
  ac.mode = 'HOLD';
  const turn = h?.turn ?? 'R';
  const entry = dist(ac.p, p) < 1 ? holdEntry(ac.hdg, inbound, turn) : undefined;
  ac.hold = { fix, p, inbound, turn, phase: entry ? (entry === 'direct' ? 'turnOut' : entry) : 'entry', tPhase: world.t, entry };
  ac.route = [];
}
export { startHold };

/** Advance one aircraft by dt seconds. */
export function stepAircraft(ac: Aircraft, world: PilotWorld, dt: number) {
  const pf = ac.perf;
  const w = world.weather;
  let desired = ac.hdg;
  let forceDir: 'L' | 'R' | undefined;

  // ---- Lost communications: after 60 s on a vector, rejoin and approach
  if (ac.radioFail && ac.lostCommT !== undefined && world.t - ac.lostCommT === 60 && ac.mode === 'HDG') {
    world.onRouteEnd(ac, { fix: '__LOSTCOMM__', p: ac.p });
  }

  // ---- Approach capture
  const app = ac.app;
  if (app && !app.locCap && (ac.mode === 'HDG' || (ac.mode === 'NAV' && ac.route.length === 0))) {
    const r = app.rwy;
    const d = distToThr(ac.p, r);
    const xte = crossTrack(ac.p, r.thr, r.crs);
    const a = angDiff(r.crs, ac.trk);
    if (d > 0.8 && d < 30 && Math.abs(a) < 135 && Math.abs(xte) < Math.max(1, d * Math.tan(35 * DEG))) {
      // the capture turn starts late at steep intercepts: the aircraft goes through the centreline before it settles
      const lead = Math.max(0.15, turnRadius(ac) * (1 - Math.cos(Math.abs(a) * DEG)) + 0.12 - locOvershootNm(Math.abs(a), tas(ac.ias, ac.alt)));
      const converging = xte * a <= 0 || Math.abs(xte) < 0.15;
      // Nearly parallel (within 10°) and inside the localizer's full-scale deflection: the autopilot arms and
      // captures, converging on the centreline, even from an offset or a slightly diverging heading.
      const parallelIn = Math.abs(a) <= 10 && Math.abs(xte) <= locWindowNm(d);
      if ((converging && Math.abs(xte) <= lead) || parallelIn) {
        ac.mode = 'LOC';
        app.locCap = true;
        app.capT = world.t;
        ac.turnDir = undefined;
      }
    }
    // Parallel to the final but outside the localizer, and not closing it: the crew says so, once.
    if (!app.locCap && ac.mode === 'HDG' && !(ac as any)._noIntercept && d > 3 && d < 30 && Math.abs(a) <= 10 && Math.abs(xte) > locWindowNm(d) && Math.abs(xte) < 6
      && ac.hdgAssigned !== undefined && Math.abs(angDiff(ac.hdg, ac.hdgAssigned)) < 3 && !(xte * a < 0 && Math.abs(a) >= 3)) {
      (ac as any)._noIntercept = true;
      world.onCannotIntercept?.(ac);
    }
  }

  // ---- Lateral
  switch (ac.mode) {
    case 'HDG':
      desired = ac.hdgAssigned ?? ac.hdg;
      forceDir = ac.turnDir;
      break;
    case 'ORBIT':
      desired = norm360(ac.hdg - turnRate(ac) * dt * 1.5);
      forceDir = 'L';
      break;
    case 'NAV': {
      const leg = ac.route[0];
      if (!leg) { ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg; break; }
      const brg = bearing(ac.p, leg.p);
      const d = dist(ac.p, leg.p);
      const next = ac.route[1];
      let antic = 0.25 + (ac.gs * dt) / 3600;
      if (next) {
        const turn = Math.abs(angDiff(brg, bearing(leg.p, next.p)));
        antic = Math.max(antic, Math.min(4, turnRadius(ac) * Math.tan((Math.min(turn, 150) / 2) * DEG)));
      }
      if (d <= antic) {
        const passed = ac.route.shift()!;
        if (ac.route.length === 0) world.onRouteEnd(ac, passed);
      }
      const tgt = ac.route[0];
      desired = tgt ? windCorrected(ac, bearing(ac.p, tgt.p), w) : ac.hdg;
      break;
    }
    case 'HOLD': {
      const h = ac.hold!;
      const outbound = norm360(h.inbound + 180);
      const dirSign = h.turn === 'L' ? -1 : 1;
      switch (h.phase) {
        case 'entry':
          desired = windCorrected(ac, bearing(ac.p, h.p), w);
          if (dist(ac.p, h.p) < 0.6) {
            // ICAO Doc 8168 entry sectors, from the heading over the fix relative to the inbound course
            h.entry = holdEntry(ac.hdg, h.inbound, h.turn);
            h.phase = h.entry === 'direct' ? 'turnOut' : h.entry; h.tPhase = world.t;
          }
          break;
        case 'teardrop':
          // outbound on a track 30° into the holding side for one minute, then turn in
          desired = norm360(outbound - dirSign * 30);
          if (world.t - h.tPhase >= 60) { h.phase = 'turnIn'; h.tPhase = world.t; }
          break;
        case 'parallel':
          // parallel to the inbound course on the non-holding side for one minute
          desired = outbound; forceDir = h.turn === 'L' ? 'R' : 'L';
          if (Math.abs(angDiff(ac.hdg, outbound)) < 5) forceDir = undefined;
          if (world.t - h.tPhase >= 75) { h.phase = 'parTurn'; h.tPhase = world.t; }
          break;
        case 'parTurn':
          // turn towards the holding side, through more than 180°, back to the fix
          forceDir = h.turn === 'L' ? 'R' : 'L';
          desired = norm360(ac.hdg - dirSign * 90);
          if (Math.abs(angDiff(ac.hdg, bearing(ac.p, h.p))) < 30) { h.phase = 'inbound'; h.tPhase = world.t; }
          break;
        case 'turnOut':
          desired = outbound; forceDir = h.turn;
          if (Math.abs(angDiff(ac.hdg, outbound)) < 5) { h.phase = 'outbound'; h.tPhase = world.t; }
          else desired = norm360(ac.hdg + dirSign * 90);
          break;
        case 'outbound':
          desired = outbound;
          if (world.t - h.tPhase >= 60) { h.phase = 'turnIn'; h.tPhase = world.t; }
          break;
        case 'turnIn':
          forceDir = h.turn;
          desired = norm360(ac.hdg + dirSign * 90);
          if (Math.abs(angDiff(ac.hdg, h.inbound)) < 25) { h.phase = 'inbound'; h.tPhase = world.t; }
          break;
        case 'inbound':
          desired = windCorrected(ac, bearing(ac.p, h.p), w);
          if (dist(ac.p, h.p) < 0.4 || alongTrack(ac.p, h.p, h.inbound) > 0) { h.phase = 'turnOut'; h.tPhase = world.t; }
          break;
      }
      break;
    }
    case 'LOC': {
      const r = app!.rwy;
      const xte = crossTrack(ac.p, r.thr, r.crs);
      desired = windCorrected(ac, norm360(r.crs - clamp(xte * 45, -25, 25)), w);
      break;
    }
  }

  // ---- Turn
  let diff = angDiff(ac.hdg, desired);
  if (forceDir && Math.abs(diff) > 3) {
    if (forceDir === 'L' && diff > 0) diff -= 360;
    if (forceDir === 'R' && diff < 0) diff += 360;
  } else if (ac.mode === 'HDG' && Math.abs(diff) <= 3) ac.turnDir = undefined;
  const maxTurn = turnRate(ac) * dt;
  ac.hdg = norm360(ac.hdg + clamp(diff, -maxTurn, maxTurn));

  // ---- Vertical
  let tgtAlt = ac.tgtAlt;
  let fromAbove = false;
  if (app?.locCap) {
    const d = distToThr(ac.p, app.rwy);
    const g = glideAlt(app.rwy, d);
    if (!app.gsCap && !app.tooHigh && ac.alt >= g - 60 && ac.alt <= g + 250) app.gsCap = true;
    if (app.gsCap) tgtAlt = g;
    else if (!app.tooHigh && !ac.lowPass && ac.alt > g + 250) {
      const high = ac.alt - g;
      if (high > 1000 && d <= 10 && d > 2) {
        // too high to make it: stay on the localizer at the cleared level and ask for vectors
        app.tooHigh = true;
        world.onTooHigh(ac);
      } else if (high <= 1100) {
        // capture the glide from above (cleared for the approach): descend through the cleared level
        tgtAlt = Math.min(tgtAlt, g - 1000);
        fromAbove = true;
      }
    }
  }
  const dAlt = tgtAlt - ac.alt;
  let vsTgt = 0;
  if (Math.abs(dAlt) > 5) {
    if (dAlt > 0) {
      let rate = pf.climbFpm * Math.max(0.35, 1 - ac.alt / 45000);
      if (ac.emergency === 'engine') rate *= 0.35;
      vsTgt = Math.min(rate, dAlt * 1.2 + 150);
    } else {
      let rate = pf.descentFpm * (ac.emergency === 'smoke' ? 1.8 : 1);
      if (fromAbove) rate = 1500;
      if (app?.gsCap) rate = Math.max(rate, ac.gs * 6);
      const decelerating = ac.ias - speedTarget(ac, world) > 8;
      if (decelerating && !app?.gsCap && !fromAbove) rate *= 0.6;
      vsTgt = -Math.min(rate, -dAlt * 1.2 + 150);
    }
  }
  if (app?.gsCap) {
    // stay on the path: compute the rate needed over the next second
    const d1 = distToThr(ac.p, app.rwy) - (ac.gs * dt) / 3600;
    const g1 = glideAlt(app.rwy, Math.max(0, d1));
    if (ac.alt - g1 < 60) vsTgt = ((g1 - ac.alt) / dt) * 60;
  }
  const vsAcc = 600 * dt;
  ac.vs += clamp(vsTgt - ac.vs, -vsAcc, vsAcc);
  ac.alt += (ac.vs * dt) / 60;
  if ((dAlt > 0 && ac.alt > tgtAlt && !app?.gsCap) || (dAlt < 0 && ac.alt < tgtAlt && !app?.gsCap)) { ac.alt = tgtAlt; ac.vs = 0; }

  // ---- Speed
  const sT = speedTarget(ac, world);
  const dv = sT - ac.ias;
  const desc = ac.vs < -1000;
  // descending clean halves the deceleration; on the localizer the crew uses flap and gear instead
  const rate = dv > 0 ? pf.accel : app?.locCap ? finalDecel(ac) : pf.decel * (desc ? 0.5 : 1);
  ac.ias += clamp(dv, -rate * dt, rate * dt);

  // ---- Position
  const v = tas(ac.ias, ac.alt);
  const wa = windAt(w, ac.alt);
  const toward = (wa.dir + 180) * DEG;
  const vx = Math.sin(ac.hdg * DEG) * v + Math.sin(toward) * wa.kt;
  const vy = Math.cos(ac.hdg * DEG) * v + Math.cos(toward) * wa.kt;
  ac.gs = Math.hypot(vx, vy);
  ac.trk = norm360(Math.atan2(vx, vy) / DEG);
  ac.p = { x: ac.p.x + (vx * dt) / 3600, y: ac.p.y + (vy * dt) / 3600 };

  // ---- Approach gates and touchdown
  if (app?.locCap) {
    const r = app.rwy;
    const d = distToThr(ac.p, r);
    const g = glideAlt(r, Math.max(0, d));
    // stability gate at 1,000 ft above aerodrome level (about 3 NM on a 3° path):
    // on the localizer and glidepath within one dot, speed no more than Vapp + 20
    if ((d <= 3.1 || ac.alt - r.elevation <= 1000) && ac.stable4 === undefined) {
      const xte = Math.abs(crossTrack(ac.p, r.thr, r.crs));
      const onLoc = xte <= Math.max(0.05, d * Math.tan(0.6 * DEG));
      const onGs = app.gsCap || Math.abs(ac.alt - g) <= Math.max(120, d * 45);
      ac.stable4 = onLoc && onGs && ac.ias <= pf.vapp + 20;
      if (!ac.stable4 && !ac.lowPass) { world.goAround(ac, 'unstable'); return; }
    }
    if (ac.lowPass) {
      if (d < 0.6) { world.goAround(ac, 'lowpass'); return; }
    } else {
      if (d <= 2 && ac.kind === 'arr' && ac.state !== 'transferred' && !ac.radioFail) { world.goAround(ac, 'noclearance'); return; }
      if (d <= 0.3 && world.runwayBusy()) { world.goAround(ac, 'occupied'); return; }
      if (d <= 0.05 || (d < 0.4 && ac.alt - r.elevation < 60)) { world.onTouchdown(ac, r); return; }
    }
  }

  // ---- Bookkeeping
  ac.flownNm += (ac.gs * dt) / 3600;
  ac.fuelKg += (pf.fuelKgH * dt * Math.max(1, ac.formation)) / 3600;
  if (ac.mode === 'HOLD') ac.holdSec += dt;
  if (ac.kind === 'arr') {
    const level = Math.abs(ac.vs) < 150;
    // the published level segment from the IF (LIBVA) to the FAF is not a level-off
    const rw = app?.rwy;
    const intermediate = !!rw && ac.alt <= Math.max(rw.ifAlt, rw.fafAlt) + 600 && (app!.locCap || ac.route.some((l) => l.fix === rw.ifFix));
    const relevant = ac.alt < 9500 && ac.alt > 2000 && !app?.gsCap && ac.mode !== 'HOLD' && !intermediate;
    if (level && relevant) {
      ac.levelSegT += dt;
      if (ac.levelSegT === 90) ac.levelOffs++;
    } else if (!level || intermediate) ac.levelSegT = 0;
    if (ac.alt < 3000 && Math.hypot(ac.p.x, ac.p.y) < 15 && !app?.locCap) ac.lowSec += dt;
  }
}

/** Resolve a level to feet with the current QNH. */
export const ft = (l: { ft?: number; fl?: number }, qnh: number) => levelToFt(l, qnh);
export { move };
