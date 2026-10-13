import type { Sim } from './sim';
import { remainNm } from './autopilot';
import { alongTrack, angDiff, crossTrack, dist, norm360 } from '../geo';
import { levelText } from './clearance';

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
  for (const n of sim.safetyNets()) {
    if (n.kind === 'SFL' && sim.t - n.since >= 3) out.push({ key: `sfl:${n.cs}`, cs: n.cs, text: `${n.cs} has ${levelText(n.sfl)} selected, but you cleared ${levelText(n.cfl)}. Say the level again.`, term: 'Readback', urgency: 75 });
    if (n.kind === 'CLAM') out.push({ key: `clam:${n.cs}`, cs: n.cs, text: `${n.cs} is off its cleared level ${levelText(n.cfl)}. Check what it is doing and say the level again.`, urgency: 80 });
  }
  for (const r of sim.coordReqs) {
    if (r.state === 'pending' && sim.t - r.t > 20) out.push({ key: `bru:${r.cs}`, cs: r.cs, text: `Brussels is waiting: can you take ${r.cs} early at ${levelText(r.level)}? Approve it, or Unable to keep the agreed level.`, term: 'Intercom', urgency: 42 + (sim.t - r.t) / 10 });
  }
  if (sim.rwyChange) out.push({ key: `rwychg:${sim.rwyChange.to}`, text: `Runway change to ${sim.rwyChange.to} at ${sim.utc(sim.rwyChange.at).slice(0, 5)}. Decide which arrival lands last on ${sim.runway} and plan the others for ${sim.rwyChange.to}.`, urgency: 22 });
  for (const ac of sim.needReclear()) {
    if (ac.state !== 'assumed' || ac.radioFail || sim.readbackPending(ac.cs)) continue;
    const st = ac.proc ? sim.mapStar(ac.proc, sim.runway) : undefined;
    out.push({ key: `reclear:${ac.cs}`, cs: ac.cs, text: st ? `${ac.cs} is still on the ${ac.proc} for the old runway. Re-clear it: runway ${sim.runway}, ${st.name} arrival.` : `${ac.cs} is still planned for the old runway. Give it a transition and approach for ${sim.runway}.`, term: 'STAR', urgency: 48 });
  }
  for (const [name, at] of sim.tsaPending) out.push({ key: `tsa:${name}`, text: `${name} goes active at ${sim.utc(at).slice(0, 5)}. Keep traffic out of it from now on.`, term: 'TSA', urgency: 18 });
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
