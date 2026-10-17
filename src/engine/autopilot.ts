import type { Sim } from './sim';
import type { Aircraft } from './types';
import { dist } from '../geo';
import { wakeMinNm } from './perf';
import { distToThr } from './pilot';

interface AutoState {
  queue: string[];     // arrivals waiting for an approach clearance, in landing order
  released: string[];  // arrivals cleared for the approach, in landing order
  lastRel: number;     // last departure release
  ga: Map<string, number>;
}
const stateOf = (sim: Sim): AutoState => ((sim as any)._autoSeq ??= { queue: [], released: [], lastRel: -999, ga: new Map() });

/** Track miles to touchdown along the cleared path (via the stack fix and the published transition if not yet on it). */
export function remainNm(sim: Sim, ac: Aircraft): number {
  const r = sim.rwy;
  if (ac.app?.locCap) return distToThr(ac.p, r);
  const sf = sim.stackFixOf(ac);
  const tr = sim.transitionsFrom(sf).find((t) => !t.atcDiscretion) ?? sim.transitionsFor(r.id).find((t) => !t.atcDiscretion);
  const trLen = tr ? tr.legs.reduce((s, l, i) => (i ? s + dist(tr.legs[i - 1].p, l.p) : 0), 0) + distToThr(tr.legs[tr.legs.length - 1].p, r) : 20;
  let p = ac.p, d = 0;
  for (const l of ac.route) { d += dist(p, l.p); p = l.p; }
  const last = ac.route[ac.route.length - 1];
  if (!last) {
    const alh = sim.pack.fixes.get(sf)?.p ?? r.thr;
    return dist(ac.p, alh) + trLen;
  }
  if (last.fix === r.ifFix) return d + distToThr(last.p, r);
  if (sim.stackFixes().includes(last.fix)) return d + trLen;
  return d + dist(p, r.thr) + 12;
}

/** Autopilot controller (start-page demo and tests) that re-issues until the pilot actually complies (handles "say again"). */
export function autoControl(sim: Sim) {
  const S = stateOf(sim);
  const live = (cs: string) => sim.find(cs);
  S.queue = S.queue.filter((cs) => { const a = live(cs); return a && !a.app && a.state === 'assumed' && !S.released.includes(cs); });
  S.released = S.released.filter((cs) => !!live(cs));

  // departure releases (engine protocol: departures wait at the holding point for {k:'rel'})
  {
    const pending = sim.releases.filter((r) => r.state === 'pending').map((r) => r.cs);
    const finalBusy = sim.aircraft.some((a) => a.app?.locCap && distToThr(a.p, a.app.rwy) < 5);
    if (pending.length && !finalBusy && sim.t - S.lastRel >= 90) {
      const res = sim.issue({ cs: pending[0], items: [{ k: 'rel' }] });
      if (res.ok) S.lastRel = sim.t;
    }
  }

  // the centre's early-transfer requests: keep the agreed level (the demo does not take traffic early)
  for (const r of sim.coordReqs) if (r.state === 'pending' && sim.t - r.t >= 8) sim.issue({ cs: r.cs, items: [{ k: 'deny' }] });
  // after a runway change: arrivals still on the old runway's STAR get the matching one for the new runway
  if (sim.lastRwyChange) {
    for (const ac of sim.needReclear()) {
      if (ac.state !== 'assumed' || ac.radioFail || sim.readbackPending(ac.cs) || sim.freqBusy()) continue;
      const st = ac.proc ? sim.mapStar(ac.proc, sim.runway) : undefined;
      const onStar = !!st && ac.mode === 'NAV' && ac.route.some((l) => sim.stackFixes().includes(l.fix));
      if (onStar) { sim.issue({ cs: ac.cs, items: [{ k: 'star', name: st!.name }] }); S.released = S.released.filter((x) => x !== ac.cs); break; }
      if (ac.app && !ac.app.locCap) {
        // already released: the new runway's transition from the stack fix at its present level, in the same order
        const tr = sim.transitionsFrom(sim.stackFixOf(ac)).find((t) => !t.atcDiscretion) ?? sim.transitionsFor(sim.runway).find((t) => !t.atcDiscretion);
        if (tr) { sim.issue({ cs: ac.cs, items: [{ k: 'trans', name: tr.name }, { k: 'app', app: 'ILS', rwy: sim.runway }] }); break; }
      }
    }
  }
  for (const ac of sim.aircraft) {
    if (ac.request?.kind === 'milxing' && ac.state === 'inbound') { sim.issue({ cs: ac.cs, items: [{ k: 'appr' }] }); continue; } // engine: approve MIL crossings
    if (ac.state !== 'assumed' || ac.radioFail) continue;
    if (ac.kind === 'arr') {
      const prevGa = S.ga.get(ac.cs) ?? 0;
      if (ac.goArounds > prevGa) { S.ga.set(ac.cs, ac.goArounds); S.queue = [ac.cs, ...S.queue.filter((x) => x !== ac.cs)]; S.released = S.released.filter((x) => x !== ac.cs); }
      else if (!ac.app && !S.queue.includes(ac.cs) && !S.released.includes(ac.cs)) S.queue.push(ac.cs);
    }
  }

  // one transmission at a time, leaving room on the frequency for readbacks
  let sent = sim.freqBusy() || sim.t - ((sim as any)._autoLastTx ?? -99) < 4;
  for (const ac of sim.aircraft) {
    if (sent) break;
    if (ac.state !== 'assumed' || ac.radioFail) continue;
    const st = (ac as any)._auto ?? ((ac as any)._auto = { last: -99 });
    if (sim.t - st.last < 15 || sim.readbackPending(ac.cs)) continue;
    const send = (items: any[]) => { sim.issue({ cs: ac.cs, items }); st.last = sim.t; sent = true; (sim as any)._autoLastTx = sim.t; };
    if (ac.request && ac.kind !== 'arr') { send([{ k: 'appr' }]); continue; }
    if (ac.kind === 'arr') {
      const rw = sim.rwy;
      if (ac.request && ac.request.kind !== 'vectors') { send([{ k: 'appr' }]); continue; }
      if (ac.app?.locCap) { send([{ k: 'xfr', unit: sim.twr.id }]); continue; }
      const sf = sim.stackFixOf(ac);
      const alh = sim.pack.fixes.get(sf)?.p ?? rw.thr;
      const nearAlh = !ac.route.some((l) => l.fix === sf) || dist(ac.p, alh) < 12;
      if (ac.app) {
        // released: descend for the transition near ALHUV, then match the leader's speed if closing
        const i = S.released.indexOf(ac.cs);
        const leader = i > 0 ? live(S.released[i - 1]) : undefined;
        // the transition doubles back on itself: 1,000 ft above every released aircraft ahead not yet on the localizer
        const depth = S.released.slice(0, Math.max(0, i)).filter((x) => { const o = live(x); return o && (!o.app?.locCap || dist(o.p, ac.p) < 5); }).length;
        const want = rw.ifAlt + 1000 * depth;
        if ((nearAlh || depth > 0) && sim.ftOf(ac.cleared) > want + 50) { send([{ k: 'lvl', lvl: { ft: want } }, { k: 'app', app: 'ILS', rwy: rw.id }]); continue; }
        if (leader) {
          const need = wakeMinNm(leader.perf.recat, ac.perf.recat, 3) + 2.5;
          const gap = remainNm(sim, ac) - remainNm(sim, leader);
          const minSpd = distToThr(ac.p, rw) < 15 ? Math.max(ac.perf.vminFlap, 160) : ac.perf.vminClean;
          if (gap < need + 4) {
            const tgt = Math.max(minSpd, Math.round((leader.ias - (gap < need + 1 ? 25 : 5)) / 10) * 10);
            if (tgt < ac.ias - 5 && (ac.spdAssigned === undefined || Math.abs(ac.spdAssigned - tgt) >= 10)) { send([{ k: 'spd', spd: tgt }]); continue; }
          } else if (gap > need + 6 && ac.spdAssigned !== undefined) { send([{ k: 'spdres' }]); continue; }
        }
        if (ac.awaitingSince !== undefined) send([{ k: 'lvl', lvl: ac.cleared }]);
        continue;
      }
      const tr = sim.transitionsFrom(sf).find((t) => !t.atcDiscretion) ?? sim.transitionsFor(rw.id).find((t) => !t.atcDiscretion)!;
      const ahead = S.released.filter((x) => !live(x)?.app?.locCap).length;
      const relFt = Math.min(sim.ftOf(ac.cleared), nearAlh || ahead ? rw.ifAlt + 1000 * ahead : 4000);
      const approach: any[] = [{ k: 'trans', name: tr.name }, { k: 'lvl', lvl: sim.levelFor(relFt) }, { k: 'app', app: 'ILS', rwy: rw.id }];
      if (ac.spdAssigned !== undefined) approach.push({ k: 'spdres' });
      if (S.released.includes(ac.cs)) { send(approach); continue; } // not complied yet (say again or still reading back)
      const k = S.queue.indexOf(ac.cs);
      if (k === 0) {
        const leaderCs = S.released[S.released.length - 1];
        const leader = leaderCs ? live(leaderCs) : undefined;
        const need = leader ? wakeMinNm(leader.perf.recat, ac.perf.recat, 3) + 8 : 0;
        if (!leader || remainNm(sim, ac) - remainNm(sim, leader) >= need) {
          send(approach);
          S.released.push(ac.cs);
          S.queue.shift();
          continue;
        }
      }
      // waiting: a slot in the stack from 6,000 ft, 1,000 ft per place in the queue, only ever lower
      const slot = sim.levelFor(6000 + 1000 * Math.max(0, k));
      if (sim.ftOf(slot) < sim.ftOf(ac.cleared) - 50) {
        const items: any[] = [{ k: 'lvl', lvl: slot }];
        if (k > 0 && ac.spdAssigned === undefined && ac.mode !== 'HOLD') items.push({ k: 'spd', spd: Math.max(ac.perf.vminClean + 10, 210) });
        send(items); continue;
      }
      if (ac.mode === 'HDG' && !ac.route.length) { send([{ k: 'hold', fix: sf }, { k: 'lvl', lvl: ac.cleared }]); continue; }
      if (ac.awaitingSince !== undefined) send([{ k: 'lvl', lvl: ac.cleared }]);
      continue;
    }
    if (ac.kind === 'dep') {
      const conflict = sim.aircraft.some((o) => o !== ac && o.kind === 'arr' && !o.remove && dist(o.p, ac.p) < 12 && o.alt > ac.alt - 1000 && o.alt < 10000);
      const xfl = sim.depXfl;
      const atXfl = ac.cleared.fl === xfl.fl && ac.cleared.ft === xfl.ft;
      if (!atXfl && (ac.alt > 5000 || ac.awaitingSince !== undefined) && !conflict) send([{ k: 'lvl', lvl: xfl }]);
      else if (Math.hypot(ac.p.x, ac.p.y) > 20 && (atXfl || Math.hypot(ac.p.x, ac.p.y) > 30)) send([{ k: 'xfr', unit: sim.acc.id }]);
      else if (ac.awaitingSince !== undefined) send([{ k: 'lvl', lvl: ac.cleared }]);
    }
    if ((ac.kind === 'ovf' || ac.kind === 'mil' || ac.kind === 'vfr' || ac.kind === 'heli' || ac.kind === 'cal') && ac.awaitingSince !== undefined) send([{ k: 'appr' }]);
  }
}
