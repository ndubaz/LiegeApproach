import { Sim } from '../src/engine/sim';
import { releaseAdvice, suggest } from '../src/engine/suggest';
import type { Item } from '../src/engine/clearance';

/**
 * A player who only ever taps the primary suggestion chip, and answers Tower's release requests
 * (with the engine's release advice, or blindly every two minutes when `advice` is false).
 * Used to check that the suggestions themselves never lead into a loss of separation.
 */
export function chipBot(sim: Sim, advice = true) {
  const S = ((sim as any)._chip ??= { last: -99, per: new Map<string, { t: number; label: string }>(), lastRel: -999 });
  const pending = sim.releases.filter((r) => r.state === 'pending');
  if (pending.length && sim.t - S.lastRel >= 120) {
    const adv: { ok: boolean; items: Item[] } = advice ? releaseAdvice(sim, pending[0].cs) : { ok: !sim.aircraft.some((a) => a.app?.locCap && sim.dthr(a) < 6), items: [{ k: 'rel' }] };
    if (adv.ok) { sim.issue({ cs: pending[0].cs, items: adv.items }); S.lastRel = sim.t; }
  }
  for (const a of sim.aircraft) if (a.request?.kind === 'milxing' && a.state === 'inbound') sim.issue({ cs: a.cs, items: [{ k: 'appr' }] });
  if (sim.freqBusy() || sim.t - S.last < 4) return;
  const order = [...sim.callers(), ...sim.aircraft.filter((a) => a.awaitingSince === undefined)];
  for (const a of order) {
    if (a.remove || sim.readbackPending(a.cs)) continue;
    const prev = S.per.get(a.cs);
    // a wrong readback is corrected at once (the readback card), whatever was said to it just before
    if (prev && sim.t - prev.t < 20 && !a.wrong) continue;
    const s = suggest(sim, a).find((x) => x.primary);
    if (!s) continue;
    if (prev && prev.label === s.label && sim.t - prev.t < 60 && a.awaitingSince === undefined) continue;
    sim.issue({ cs: a.cs, items: s.items });
    S.per.set(a.cs, { t: sim.t, label: s.label });
    S.last = sim.t;
    return;
  }
}

/** Distinct loss-of-separation and wake pairs in a finished session. */
export function sepCounts(sim: Sim) {
  const d = (k: string) => new Set(sim.events.filter((e) => e.kind === k).map((e) => [e.cs, e.cs2].sort().join('|'))).size;
  return { los: d('los'), wake: d('wake'), ga: sim.events.filter((e) => e.kind === 'goaround').length, landed: sim.landings.length, arr: sim.arrivalsSpawned };
}
