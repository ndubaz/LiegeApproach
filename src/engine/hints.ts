import type { Sim } from './sim';
import { remainNm } from './autopilot';
import { alongTrack, angDiff, crossTrack, dist, norm360 } from '../geo';

// Training wheels: a supervisor at your shoulder. Every few seconds, pick the
// single most useful thing to look at, in plain words. Quiet when all is well.

export interface Hint { key: string; cs?: string; text: string; term?: string; urgency: number }

export function hints(sim: Sim): Hint[] {
  const out: Hint[] = [];
  const rw = sim.rwy;
  const crsMag = norm360(rw.crs - sim.pack.meta.magVar);
  for (const a of sim.alerts()) {
    if (a.kind === 'stca' || a.kind === 'los') out.push({ key: `stca:${a.a}:${a.b}`, cs: a.a, text: `${a.a} and ${a.b} are about to lose separation. Turn one or put 1,000 ft between them now.`, term: 'STCA', urgency: 100 });
  }
  for (const r of sim.releases) {
    const wait = sim.t - r.t;
    if (r.state === 'pending' && wait > 40) out.push({ key: `rel:${r.cs}`, cs: r.cs, text: `Tower has waited ${Math.round(wait)} s for a release for ${r.cs}. Release it, or tell Tower to hold it.`, term: 'Release', urgency: 40 + wait / 10 });
  }
  for (const ac of sim.aircraft) {
    if (ac.remove) continue;
    // a readback (or a say-again) is still to come: whatever was just said may already fix it
    if (sim.readbackPending(ac.cs)) continue;
    if (ac.awaitingSince !== undefined && sim.t >= ac.awaitingSince) {
      const w = sim.t - ac.awaitingSince;
      if (w > 15) out.push({ key: `call:${ac.cs}`, cs: ac.cs, text: `${ac.cs} has been calling for ${Math.round(w)} s. Answer it: a quick Roger (R) or Standby (SB) buys you time.`, urgency: 50 + w });
    }
    if (ac.state !== 'assumed' || ac.radioFail) continue;
    if (ac.kind === 'arr') {
      const d = sim.dthr(ac);
      if (ac.app?.locCap) {
        if (d < 9 && d > 4) out.push({ key: `twr:${ac.cs}`, cs: ac.cs, text: `${ac.cs} is established ${d.toFixed(0)} NM out. Hand it to Tower.`, urgency: 45 + (9 - d) * 5 });
        continue;
      }
      // descent planning: about 3 NM per 1,000 ft, plus a few miles to slow down
      // miles left before the intermediate fix, where it should be at the approach altitude
      const ifP = sim.pack.fixes.get(rw.ifFix)?.p;
      const finalNm = ifP ? dist(ifP, rw.thr) : 9;
      const togo = Math.max(0, remainNm(sim, ac) - finalNm);
      const need = (Math.max(0, ac.alt - rw.ifAlt) / 1000) * 3 + (ac.ias > 220 ? 4 : 2);
      if (ac.alt > rw.ifAlt + 1500 && togo < need && togo < 25) {
        out.push({ key: `high:${ac.cs}`, cs: ac.cs, text: `${ac.cs} needs about ${need.toFixed(0)} NM to get down but has about ${togo.toFixed(0)}. Descend it now, slow it, or give it more miles.`, term: 'Descent planning', urgency: 30 + (need - togo) * 3 });
      }
      if (ac.mode === 'HDG') {
        const xt = crossTrack(ac.p, rw.thr, rw.crs);
        const along = alongTrack(ac.p, rw.thr, norm360(rw.crs + 180));
        const curMag = norm360(ac.hdg - sim.pack.meta.magVar);
        const onDownwind = Math.abs(angDiff(curMag, norm360(crsMag + 180))) < 40;
        const onBase = Math.abs(Math.abs(angDiff(curMag, crsMag)) - 90) < 35;
        if (onDownwind && along > 11 && Math.abs(xt) > 3) out.push({ key: `base:${ac.cs}`, cs: ac.cs, text: `${ac.cs} is ${along.toFixed(0)} NM out on the downwind. Turn base now.`, urgency: 25 + along });
        if (onBase && Math.abs(xt) < 3 && !ac.app) out.push({ key: `int:${ac.cs}`, cs: ac.cs, text: `${ac.cs} is ${Math.abs(xt).toFixed(1)} NM from the centreline. Turn it 30° to the final course and clear the approach.`, term: 'ILS', urgency: 60 });
      }
      if (ac.mode === 'HOLD' && ac.efc !== undefined && sim.t > ac.efc - 30) out.push({ key: `efc:${ac.cs}`, cs: ac.cs, text: `${ac.cs} reaches its expected approach time. Release it from the hold or give a new time.`, term: 'EFC', urgency: 35 });
    } else if (ac.kind === 'dep') {
      const r0 = dist(ac.p, { x: 0, y: 0 });
      if (r0 > 26) out.push({ key: `bru:${ac.cs}`, cs: ac.cs, text: `${ac.cs} is ${r0.toFixed(0)} NM out. Hand it to Brussels before the 40 NM ring.`, urgency: 30 + r0 });
    }
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}
