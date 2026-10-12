import type { Sim } from './sim';

/** Autopilot controller (start-page demo and tests) that re-issues until the pilot actually complies (handles "say again"). */
export function autoControl(sim: Sim) {
  for (const ac of sim.aircraft) {
    if (ac.state !== 'assumed' || ac.radioFail) continue;
    const st = (ac as any)._auto ?? ((ac as any)._auto = { last: -99 });
    if (sim.t - st.last < 15) continue;
    const send = (items: any[]) => { sim.issue({ cs: ac.cs, items }); st.last = sim.t; };
    if (ac.request) { send([{ k: 'appr' }]); continue; }
    if (ac.kind === 'arr') {
      const rw = sim.rwy;
      if (!ac.app && (ac.route.some((l) => l.fix === 'ALHUV') || ac.mode === 'HOLD' || ac.mode === 'HDG')) {
        const tr = sim.transitionsFor(rw.id).find((t) => !t.atcDiscretion)!;
        send([{ k: 'trans', name: tr.name }, { k: 'lvl', lvl: { ft: rw.ifAlt } }, { k: 'app', app: 'ILS', rwy: rw.id }]);
      } else if (ac.app?.locCap) send([{ k: 'xfr', unit: 'TWR' }]);
      else if (ac.awaitingSince !== undefined) send([{ k: 'lvl', lvl: ac.cleared }]);
    }
    if (ac.kind === 'dep') {
      if (ac.cleared.fl !== 90 && (ac.alt > 5000 || ac.awaitingSince !== undefined)) send([{ k: 'lvl', lvl: { fl: 90 } }]);
      else if (Math.hypot(ac.p.x, ac.p.y) > 20) send([{ k: 'xfr', unit: 'BRU' }]);
      else if (ac.awaitingSince !== undefined) send([{ k: 'lvl', lvl: { fl: 90 } }]);
    }
    if ((ac.kind === 'ovf' || ac.kind === 'mil' || ac.kind === 'vfr' || ac.kind === 'heli' || ac.kind === 'cal') && ac.awaitingSince !== undefined) send([{ k: 'appr' }]);
  }
}
