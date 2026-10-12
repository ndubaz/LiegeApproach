import type { Sim } from './sim';
import type { Comp, SimEvent } from './types';
import { PERF } from './perf';

export const COMP_NAMES: Record<Comp, string> = {
  SEPC: 'Separation', SITU: 'Situational awareness', TRAF: 'Traffic management', COMM: 'Communication',
  CORD: 'Coordination', WORK: 'Workload', NONR: 'Non-routine situations', SPP: 'Procedures',
};
export const COMPS: Comp[] = ['SEPC', 'SITU', 'TRAF', 'COMM', 'CORD', 'WORK', 'NONR', 'SPP'];

export interface Metric { key: string; label: string; value: string; raw: number | null; good?: boolean }

export interface Result {
  id: string;
  scenarioId: string;
  title: string;
  date: string;
  durationMin: number;
  seed: number;
  gate: { pass: boolean; lines: { text: string; bad: boolean }[] };
  ratings: Record<Comp, number | null>;
  evidence: Record<Comp, string>;
  metrics: Metric[];
  costliest: (SimEvent & { replayT: number })[];
  pass?: { ok: boolean; reasons: { text: string; ok: boolean }[] };
  narrative: string[];
  suggested?: string;
  landed: number;
  arrivals: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp5 = (v: number) => Math.max(1, Math.min(5, Math.round(v)));

const NEXT_FOR: Record<Comp, string> = {
  SEPC: 'cross-streams', SITU: 'fighters', TRAF: 'trombone', COMM: 'similar-callsigns',
  CORD: 'flow', WORK: 'night-bank', NONR: 'smoke', SPP: 'first-freighter',
};

export function assess(sim: Sim): Result {
  const ev = sim.events;
  const count = (k: string, sev?: string) => ev.filter((e) => e.kind === k && (!sev || e.sev === sev)).length;
  const hours = Math.max(sim.t, 60) / 3600;

  // ---- Safety gate
  const los = ev.filter((e) => e.kind === 'los');
  const losBad = los.filter((e) => e.sev === 'major' || e.sev === 'serious');
  const wake = ev.filter((e) => e.kind === 'wake');
  const mva = ev.filter((e) => e.kind === 'mva');
  const mvaBad = mva.filter((e) => e.sev === 'major');
  const cb = ev.filter((e) => e.kind === 'cb');
  const gateFail = losBad.length > 0 || mvaBad.length > 0;
  const gate = {
    pass: !gateFail,
    lines: [
      { text: `Losses of separation: ${los.length}${los.length ? ` (${losBad.length} beyond 10% of the minimum)` : ''}`, bad: losBad.length > 0 },
      { text: `Wake infringements: ${wake.length}${wake.length ? ` (closest ${Math.min(...wake.map((w) => w.value ?? 9)).toFixed(1)} NM)` : ''}`, bad: wake.some((w) => w.sev === 'major') },
      { text: `Below minimum vectoring altitude: ${mva.length}`, bad: mvaBad.length > 0 },
      ...(cb.length ? [{ text: `Thunderstorm penetrations: ${cb.length}`, bad: true }] : []),
    ],
  };

  // ---- Metrics
  const landings = sim.landings.filter((l) => !l.emergency);
  const extra = landings.map((l) => l.flownNm - l.baselineNm);
  const extraMed = median(extra);
  const holdTotalMin = (sim.landings.reduce((s, l) => s + l.holdSec, 0) + sim.aircraft.reduce((s, a) => s + (a.kind === 'arr' ? a.holdSec : 0), 0)) / 60;
  const arrivalsCount = Math.max(sim.arrivalsSpawned, 1);
  const spacingExcess = sim.spacing.map((s) => s.gap - s.min);
  const spacingMed = median(spacingExcess);
  const cdo = sim.landings.length ? sim.landings.filter((l) => l.levelOffs === 0).length / sim.landings.length : null;
  const fuelExtra = landings.reduce((s, l) => {
    const pf = PERF[l.type];
    return s + Math.max(0, l.flownNm - l.baselineNm) * ((pf?.fuelKgH ?? 4000) / 230);
  }, 0) + sim.landings.reduce((s, l) => s + (l.holdSec / 3600) * (PERF[l.type]?.fuelKgH ?? 4000) * 0.15, 0);
  const occ = (sim.atcAirtime + sim.pilotAirtime) / Math.max(sim.t, 1);
  const respMed = median(sim.responseTimes);
  const handled = new Set(sim.cmdLog.map((c) => c.cl.cs)).size || 1;
  const txPer = sim.clearancesSent / handled;
  const allLow = [...sim.aircraft].reduce((s, a) => s + a.lowSec, 0) + ((sim as any)._lowLanded ?? 0);
  const demandPerHr = sim.arrivalsSpawned / hours;
  const rate = sim.landings.length / hours;

  const metrics: Metric[] = [
    { key: 'rate', label: `Landings per hour (demand ${demandPerHr.toFixed(0)})`, value: rate.toFixed(0), raw: rate },
    { key: 'landed', label: 'Arrivals landed', value: `${sim.landings.length} of ${sim.arrivalsSpawned}`, raw: sim.landings.length },
    { key: 'spacing', label: 'Final spacing above minimum, median', value: spacingMed === null ? '—' : `${spacingMed.toFixed(1)} NM`, raw: spacingMed },
    { key: 'extra', label: 'Track miles vs published procedure', value: extraMed === null ? '—' : `${extraMed >= 0 ? '+' : ''}${extraMed.toFixed(1)} NM`, raw: extraMed },
    { key: 'hold', label: 'Holding, all aircraft', value: `${holdTotalMin.toFixed(0)} min`, raw: holdTotalMin },
    { key: 'cdo', label: 'Continuous descents', value: cdo === null ? '—' : `${Math.round(cdo * 100)}%`, raw: cdo },
    { key: 'fuel', label: 'Fuel above procedure baseline', value: `${(fuelExtra / 1000).toFixed(1)} t (${((fuelExtra * 3.16) / 1000).toFixed(1)} t CO₂)`, raw: fuelExtra },
    { key: 'occ', label: 'Frequency occupancy', value: `${Math.round(occ * 100)}%`, raw: occ },
    { key: 'resp', label: 'Response to pilot calls, median', value: respMed === null ? '—' : `${respMed.toFixed(1)} s`, raw: respMed },
    { key: 'tx', label: 'Transmissions per aircraft', value: txPer.toFixed(1), raw: txPer },
    { key: 'noise', label: 'Time below 3,000 ft off the final', value: `${(allLow / 60).toFixed(1)} min`, raw: allLow },
  ];

  // ---- Ratings
  const ratings = {} as Record<Comp, number | null>;
  const evidence = {} as Record<Comp, string>;
  {
    let r = 5;
    if (los.some((e) => e.sev === 'serious')) r = 1;
    else if (losBad.length) r = 2;
    else if (los.length) r = 3;
    if (wake.some((w) => w.sev === 'major')) r = Math.min(r, 3);
    r -= wake.filter((w) => w.sev === 'minor').length * 0.5;
    if (mvaBad.length) r = Math.min(r, 2);
    r -= mva.filter((m) => m.sev === 'minor').length;
    r -= cb.length;
    if (count('stca') > 3) r -= 1;
    ratings.SEPC = clamp5(r);
    evidence.SEPC = `${los.length} LoS, ${wake.length} wake, ${mva.length} MVA, ${count('stca')} STCA`;
  }
  {
    const solved = count('conflict_solved'), stca = count('stca');
    let r: number | null = solved + stca === 0 ? (sim.clearancesSent ? 5 : null) : (() => { const q = solved / (solved + stca); return q >= 0.9 ? 5 : q >= 0.75 ? 4 : q >= 0.5 ? 3 : q >= 0.25 ? 2 : 1; })();
    if (r !== null) { r -= count('exit_unxfr'); r -= Math.max(0, count('unanswered') - 1) * 0.5; }
    ratings.SITU = r === null ? null : clamp5(r);
    evidence.SITU = `${solved} conflicts fixed before STCA, ${stca} caught by STCA`;
  }
  {
    if (!sim.arrivalsSpawned) ratings.TRAF = null;
    else {
      let r = 5;
      const eligible = Math.max(1, sim.arrivalsSpawned - sim.aircraft.filter((a) => a.kind === 'arr' && sim.t - a.spawnT < 900).length);
      const ratio = sim.landings.length / eligible;
      if (ratio < 0.9) r -= 1;
      if (ratio < 0.7) r -= 1;
      const holdPer = holdTotalMin / arrivalsCount;
      if (holdPer > 3) r -= 1;
      if (holdPer > 6) r -= 1;
      if (spacingMed !== null && spacingMed > 1.5) r -= 1;
      if (extraMed !== null && extraMed > 8) r -= 1;
      r -= ev.filter((e) => e.kind === 'goaround' && e.comp === 'TRAF').length;
      ratings.TRAF = clamp5(r);
    }
    evidence.TRAF = `${sim.landings.length}/${sim.arrivalsSpawned} landed, spacing ${spacingMed === null ? 'n/a' : '+' + spacingMed.toFixed(1) + ' NM'}, ${holdTotalMin.toFixed(0)} min holding`;
  }
  {
    if (!sim.clearancesSent) ratings.COMM = null;
    else {
      let r = 5;
      if (txPer > 7) r -= 1;
      if (txPer > 10) r -= 1;
      r -= count('readback_missed');
      if (occ > 0.7) r -= 1;
      ratings.COMM = clamp5(r);
    }
    evidence.COMM = `${txPer.toFixed(1)} transmissions/aircraft, ${count('readback_missed')} wrong readbacks missed, ${count('readback_caught')} caught`;
  }
  {
    let r = 5;
    r -= count('late_xfr') * 0.5;
    r -= count('exit_unxfr');
    r -= count('tsa');
    r -= count('flow');
    r -= count('airspace') * 0.5;
    r -= ev.filter((e) => e.kind === 'goaround' && e.comp === 'CORD').length;
    ratings.CORD = sim.clearancesSent ? clamp5(r) : null;
    evidence.CORD = `${count('late_xfr')} late handoffs, ${count('exit_unxfr')} missed, ${count('tsa')} TSA, ${count('flow')} flow`;
  }
  {
    if (respMed === null) ratings.WORK = null;
    else {
      let r = respMed <= 4 ? 5 : respMed <= 7 ? 4 : respMed <= 12 ? 3 : respMed <= 20 ? 2 : 1;
      r -= Math.max(0, count('unanswered') - 1) * 0.5;
      ratings.WORK = clamp5(r);
    }
    evidence.WORK = `median response ${respMed?.toFixed(1) ?? '—'} s, ${count('unanswered')} unanswered calls`;
  }
  {
    if (!sim.emergencies.length) { ratings.NONR = null; evidence.NONR = 'no emergencies this session'; }
    else {
      let r = 5;
      const notes: string[] = [];
      for (const e of sim.emergencies) {
        const first = e.firstClrT !== undefined ? e.firstClrT - e.t0 : undefined;
        if (e.type !== 'radio') {
          if (first === undefined || first > 20) r -= 1;
          if (first === undefined || first > 45) r -= 1;
        }
        if (e.landedT === undefined) r -= sim.ended ? 2 : 0;
        else if ((e.landedT - e.t0) / 60 > 15) r -= 1;
        if (los.some((l) => l.cs === e.cs || l.cs2 === e.cs)) r = Math.min(r, 1);
        notes.push(`${e.cs}: first instruction ${first === undefined ? '—' : first.toFixed(0) + ' s'}, ${e.landedT ? 'landed after ' + ((e.landedT - e.t0) / 60).toFixed(1) + ' min' : 'not landed'}`);
      }
      ratings.NONR = clamp5(r);
      evidence.NONR = notes.join('; ');
    }
  }
  {
    let r = 5;
    r -= count('speed_limit');
    const wr = sim.clearancesSent ? sim.warningsSent / sim.clearancesSent : 0;
    if (wr > 0.1) r -= 1;
    if (wr > 0.25) r -= 1;
    ratings.SPP = sim.clearancesSent ? clamp5(r) : null;
    evidence.SPP = `${sim.warningsSent} clearances sent past a warning, ${count('speed_limit')} speed-limit breaches`;
  }

  // ---- Costliest decisions
  const costliest = ev.filter((e) => e.cost > 0).sort((a, b) => b.cost - a.cost || a.t - b.t).slice(0, 3).map((e) => ({ ...e, replayT: Math.max(0, e.t - 60) }));

  // ---- Pass criteria
  let pass: Result['pass'];
  const pc = sim.sc.pass;
  if (pc) {
    const reasons: { text: string; ok: boolean }[] = [{ text: 'Safety gate passed', ok: gate.pass }];
    if (pc.minLanded !== undefined) reasons.push({ text: `At least ${pc.minLanded} landed (${sim.landings.length})`, ok: sim.landings.length >= pc.minLanded });
    if (pc.allArrivalsHandled) reasons.push({ text: 'Every arrival landed', ok: sim.landings.length >= sim.arrivalsSpawned });
    if (pc.maxHoldMinPerArrival !== undefined) reasons.push({ text: `Holding under ${pc.maxHoldMinPerArrival} min per arrival`, ok: holdTotalMin / arrivalsCount <= pc.maxHoldMinPerArrival });
    if (pc.noMissedReadbacks) reasons.push({ text: 'No missed wrong readbacks', ok: count('readback_missed') === 0 });
    if (pc.noTsa) reasons.push({ text: 'No TSA infringements', ok: count('tsa') === 0 });
    if (pc.emergencyLandedWithinMin !== undefined) {
      const ok = sim.emergencies.length > 0 && sim.emergencies.every((e) => e.landedT !== undefined && (e.landedT - e.t0) / 60 <= pc.emergencyLandedWithinMin!);
      reasons.push({ text: `Emergency landed within ${pc.emergencyLandedWithinMin} min`, ok });
    }
    for (const [c, v] of Object.entries(pc.minRatings ?? {})) {
      const r = ratings[c as Comp];
      reasons.push({ text: `${COMP_NAMES[c as Comp]} rated ${v} or better (${r ?? '—'})`, ok: r !== null && r >= (v as number) });
    }
    pass = { ok: reasons.every((x) => x.ok), reasons };
  }

  // ---- Narrative (instructor-style, generated from the numbers)
  const rated = COMPS.filter((c) => ratings[c] !== null) as Comp[];
  const weakest = [...rated].sort((a, b) => (ratings[a]! - ratings[b]!) || COMPS.indexOf(a) - COMPS.indexOf(b))[0];
  const strongest = [...rated].sort((a, b) => (ratings[b]! - ratings[a]!) || COMPS.indexOf(a) - COMPS.indexOf(b))[0];
  const narrative: string[] = [];
  narrative.push(gate.pass ? 'You passed the safety gate: no loss of separation beyond the tolerance and no MVA bust.' : `You failed the safety gate. ${losBad.length ? `${losBad[0].text}.` : mvaBad.length ? `${mvaBad[0].text}.` : ''} On a real check ride the session would stop there.`);
  if (strongest && weakest && strongest !== weakest) narrative.push(`Strongest area: ${COMP_NAMES[strongest].toLowerCase()} (${evidence[strongest]}). Weakest: ${COMP_NAMES[weakest].toLowerCase()} (${evidence[weakest]}).`);
  if (costliest[0]) narrative.push(`Your costliest moment came at ${sim.utc(costliest[0].t).slice(0, 5)}: ${costliest[0].text}. Replay from a minute before it and try a different decision.`);
  if (spacingMed !== null && spacingMed > 1.2) narrative.push(`Final spacing ran ${spacingMed.toFixed(1)} NM above the minimum on average. Tighter speed control earlier (210 kt on base, 180 kt at intercept) would buy back landing slots.`);
  if (respMed !== null && respMed > 8) narrative.push(`Pilots waited a median ${respMed.toFixed(0)} seconds for an answer. Acknowledge a check-in first, then plan.`);

  const suggested = weakest ? NEXT_FOR[weakest] : undefined;
  return {
    id: `${Date.now()}`, scenarioId: sim.sc.id, title: sim.sc.title, date: new Date().toISOString(), durationMin: Math.round(sim.t / 60), seed: sim.sc.seed,
    gate, ratings, evidence, metrics, costliest, pass, narrative, suggested, landed: sim.landings.length, arrivals: sim.arrivalsSpawned,
  };
}
