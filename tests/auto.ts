import type { Sim } from '../src/engine/sim';

/** A simple procedural controller: transition + ILS for arrivals, climb and transfer departures. */
export function autoControl(sim: Sim) {
  for (const ac of sim.aircraft) {
    if (ac.state !== 'assumed' || ac.radioFail) continue;
    const done = (ac as any)._auto ?? ((ac as any)._auto = {});
    if (ac.kind === 'arr') {
      if (!done.cleared && (ac.route.some((l) => l.fix === 'ALHUV') || ac.mode === 'HOLD' || ac.mode === 'HDG')) {
        const rw = sim.rwy;
        const tr = sim.transitionsFor(rw.id).find((t) => !t.atcDiscretion)!;
        sim.issue({ cs: ac.cs, items: [{ k: 'trans', name: tr.name }, { k: 'lvl', lvl: { ft: rw.ifAlt } }, { k: 'app', app: 'ILS', rwy: rw.id }] });
        done.cleared = true;
      } else if (ac.app?.locCap && !done.twr) {
        sim.issue({ cs: ac.cs, items: [{ k: 'xfr', unit: 'TWR' }] });
        done.twr = true;
      }
    }
    if (ac.kind === 'dep') {
      if (!done.climb && (ac.alt > 5000 || ac.awaitingSince !== undefined)) { sim.issue({ cs: ac.cs, items: [{ k: 'lvl', lvl: { fl: 90 } }] }); done.climb = true; }
      if (!done.xfr && Math.hypot(ac.p.x, ac.p.y) > 20) { sim.issue({ cs: ac.cs, items: [{ k: 'xfr', unit: 'BRU' }] }); done.xfr = true; }
    }
    if (ac.request && !done.req) { sim.issue({ cs: ac.cs, items: [{ k: 'appr' }] }); done.req = true; }
  }
}

