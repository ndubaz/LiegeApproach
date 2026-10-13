import type { Sim } from './sim';
import type { Aircraft, Comp, SimEvent } from './types';
import type { Item } from './clearance';
import { levelText } from './clearance';
import { PERF } from './perf';
import { bearing, dist } from '../geo';

export const COMP_NAMES: Record<Comp, string> = {
  SEPC: 'Separation', SITU: 'Situational awareness', TRAF: 'Traffic management', COMM: 'Communication',
  CORD: 'Coordination', WORK: 'Workload', NONR: 'Non-routine situations', SPP: 'Procedures',
};
/** Plain-English gloss of each competency, for players who do not know the ICAO names. */
export const COMP_PLAIN: Record<Comp, string> = {
  SEPC: 'Keeping aircraft apart', SITU: 'Seeing conflicts coming', TRAF: 'Keeping traffic flowing', COMM: 'Clear radio work',
  CORD: 'Handoffs and coordination', WORK: 'Keeping up with the frequency', NONR: 'Handling emergencies', SPP: 'Following procedures',
};
export const COMPS: Comp[] = ['SEPC', 'SITU', 'TRAF', 'COMM', 'CORD', 'WORK', 'NONR', 'SPP'];

export interface Metric { key: string; label: string; value: string; raw: number | null; good?: boolean }
export type Grade = 'fail' | 'pass' | 'good' | 'rated';
export const GRADE_NAMES: Record<Grade, string> = { fail: 'Not yet', pass: 'Pass', good: 'Good', rated: 'Rated' };

export type CostItem = SimEvent & {
  replayT: number;
  /** How many times this same cause happened (repeated alerts between the same pair count once). */
  count: number;
  /** Plain-English cause chain: the last instructions to the aircraft and why they led here. */
  why: string;
};

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
  costliest: CostItem[];
  pass?: { ok: boolean; reasons: { text: string; ok: boolean }[] };
  narrative: string[];
  suggested?: string;
  landed: number;
  arrivals: number;
  grade: Grade;
  /** What you would need for the next grade up (empty at 'rated'). */
  gradeNotes: string[];
  /** Longest run of consecutive landings each within +0.0 to +0.7 NM of the applicable minimum. */
  seqBest: number;
  objectives?: { cs: string; text: string; byT: number; met: boolean }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const clamp5 = (v: number) => Math.max(1, Math.min(5, Math.round(v)));
const fmtFt = (ft: number) => `${Math.round(ft / 100) * 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const NEXT_FOR: Record<Comp, string> = {
  SEPC: 'cross-streams', SITU: 'fighters', TRAF: 'trombone', COMM: 'similar-callsigns',
  CORD: 'flow', WORK: 'night-bank', NONR: 'smoke', SPP: 'first-freighter',
};

// ---------------------------------------------------------------------------
// Event snapshots: aircraft state at the moment an event is raised (for cause chains).
interface Snap { alt: number; ias: number; glide: number; vapp: number; dthr: number; mva: number; mode: string; cleared: number; p: { x: number; y: number }; spd?: number }
interface Tracker { snaps: Map<string, Record<string, Snap>> }
const evKey = (e: SimEvent) => `${e.t}|${e.kind}|${e.cs ?? ''}|${e.cs2 ?? ''}`;
/** Start recording aircraft state when events fire. Idempotent; call once when the Sim is created (liveStats/seqChain also call it). */
export function track(sim: Sim): void {
  if ((sim as any)._gameTrack) return;
  const tr: Tracker = { snaps: new Map() };
  (sim as any)._gameTrack = tr;
  sim.onEvent.push((e) => {
    const rec: Record<string, Snap> = {};
    for (const cs of [e.cs, e.cs2]) {
      const ac = cs ? sim.aircraft.find((a) => a.cs === cs) : undefined;
      if (!ac) continue;
      let glide = NaN, dthr = NaN, mva = NaN;
      try { glide = sim.glide(ac); dthr = sim.dthr(ac); mva = sim.mvaAt(ac.p); } catch { /* geometry unavailable */ }
      rec[ac.cs] = { alt: ac.alt, ias: ac.ias, glide, vapp: ac.perf.vapp, dthr, mva, mode: ac.mode, cleared: sim.ftOf(ac.cleared), p: { ...ac.p }, spd: ac.spdAssigned };
    }
    if (Object.keys(rec).length) tr.snaps.set(evKey(e), rec);
  });
}
const snapOf = (sim: Sim, e: SimEvent, cs?: string): Snap | undefined => (cs ? ((sim as any)._gameTrack as Tracker | undefined)?.snaps.get(evKey(e))?.[cs] : undefined);

// ---------------------------------------------------------------------------
// Plain-English cause chains.
const hhmm = (sim: Sim, t: number) => sim.utc(t).slice(0, 5);
export function describeItem(it: Item): string {
  switch (it.k) {
    case 'hdg': return `heading ${String(it.hdg).padStart(3, '0')}${it.dir ? (it.dir === 'L' ? ' (left turn)' : ' (right turn)') : ''}`;
    case 'dct': return `direct ${it.fix}`;
    case 'lvl': return levelText(it.lvl);
    case 'spd': return `${it.spd} kt`;
    case 'spdmin': return 'minimum clean speed';
    case 'spdres': return 'normal speed';
    case 'app': return `${it.app === 'VIS' ? 'visual' : it.app} approach ${it.rwy}`;
    case 'hold': return `hold at ${it.fix}`;
    case 'eat': return 'a revised expected approach time';
    case 'trans': return `${it.name} transition`;
    case 'ron': return 'own navigation';
    case 'xfr': return it.unit === 'TWR' ? 'handoff to Tower' : 'handoff to the next sector';
    case 'appr': return 'approval of its request';
    case 'deny': return 'a refusal of its request';
    case 'sqk': return `squawk ${it.code}`;
    case 'roger': return 'roger';
    case 'standby': return 'standby';
    case 'star': return `${it.name} arrival`;
    case 'sayagain': return 'say again';
    default: return (it as any).k === 'rel' ? 'release for take-off' : String((it as any).k);
  }
}
const describeItems = (items: Item[]) => items.map(describeItem).join(', ');
const cmdsFor = (sim: Sim, cs: string, beforeT: number, n = 3) => sim.cmdLog.filter((c) => c.cl.cs === cs && c.t <= beforeT).slice(-n);
const chainText = (sim: Sim, cs: string, beforeT: number, n = 3) => {
  const cs3 = cmdsFor(sim, cs, beforeT, n);
  return cs3.length ? cs3.map((c) => `${describeItems(c.cl.items)} at ${hhmm(sim, c.t)}`).join('; ') : '';
};
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const where = (p: { x: number; y: number }) => {
  const d = Math.hypot(p.x, p.y);
  if (d < 2) return 'over the field';
  return `about ${Math.round(d)} NM ${COMPASS[Math.round(bearing({ x: 0, y: 0 }, p) / 45) % 8]} of the field`;
};
const lastWith = (sim: Sim, cs: string, beforeT: number, k: Item['k'], afterT = -1) => {
  for (let i = sim.cmdLog.length - 1; i >= 0; i--) {
    const c = sim.cmdLog[i];
    if (c.cl.cs !== cs || c.t > beforeT || c.t < afterT) continue;
    const it = c.cl.items.find((x) => x.k === k);
    if (it) return { t: c.t, it };
  }
  return undefined;
};

/** Plain-English explanation of why an event happened, built from the command log and rule-based reasoning. */
export function explain(sim: Sim, e: SimEvent): string {
  const cs = e.cs ?? '';
  const prior = chainText(sim, cs, e.t);
  const lastInstr = prior ? `Your last instructions to ${cs}: ${prior}.` : `You had given ${cs} no instructions.`;
  const s = snapOf(sim, e, cs);
  switch (e.kind) {
    case 'goaround': {
      if (/unstable/.test(e.text)) {
        const parts: string[] = [];
        const high = s && Number.isFinite(s.glide) ? s.alt - s.glide : undefined;
        const fast = s ? s.ias - s.vapp : undefined;
        const lvl = lastWith(sim, cs, e.t, 'lvl');
        const trans = lastWith(sim, cs, e.t, 'trans');
        const spd = lastWith(sim, cs, e.t, 'spd');
        if (lvl && trans && lvl.t > trans.t && (high === undefined || high > 300)) parts.push(`Your ${describeItem(lvl.it)} at ${hhmm(sim, lvl.t)} cancelled the ${(trans.it as any).name} level restrictions`);
        else if (lvl && high !== undefined && high > 300) parts.push(`Your ${describeItem(lvl.it)} at ${hhmm(sim, lvl.t)} left it high`);
        else if (!lvl && high !== undefined && high > 300) parts.push('You never gave it a lower level');
        if (fast !== undefined && fast > 25) parts.push(spd ? `your ${describeItem(spd.it)} at ${hhmm(sim, spd.t)} kept it fast` : 'nobody slowed it down');
        const gate: string[] = [];
        if (high !== undefined && high > 300) gate.push(`${fmtFt(high)} ft above the glidepath`);
        if (fast !== undefined && fast > 25) gate.push(`${Math.round(fast)} kt faster than its approach speed`);
        if (s && !gate.length) gate.push('not yet on the glidepath');
        const cause = parts.length ? parts.join('; ') + '.' : '';
        return `${cause}${cause ? ' ' : ''}At the 4 NM stability gate it was ${gate.length ? gate.join(' and ') : 'unstable'}, so the crew went around. Get it down to the intercept altitude and to about 180 kt before it joins the localizer. ${prior ? `Last instructions: ${prior}.` : ''}`.trim();
      }
      if (/no landing clearance/.test(e.text)) return `${cs} reached 2 NM still on your frequency, so Tower never cleared it to land. ${lastInstr} Hand arrivals to Tower once they are established on the localizer, around 8 to 12 NM out.`;
      if (/occupied/.test(e.text)) {
        const spds = sim.cmdLog.filter((c) => c.cl.cs === cs && c.t <= e.t && c.cl.items.some((i) => i.k === 'spd')).slice(-2);
        return `The runway was still occupied when ${cs} reached the threshold: it was too close behind the previous landing. ${spds.length ? `Speeds you gave it: ${spds.map((c) => `${describeItems(c.cl.items.filter((i) => i.k === 'spd'))} at ${hhmm(sim, c.t)}`).join(', ')}.` : 'You gave it no speed control.'} Build 3 NM plus wake spacing before the localizer and give 160 kt to 4 NM.`;
      }
      if (/Tower/.test(e.text)) {
        const next = sim.cmdLog.find((c) => c.cl.cs === cs && c.t >= e.t);
        return `Tower sent ${cs} around; that was not your call. What counts is the next minute: ${next ? `your first instruction after it was ${describeItems(next.cl.items)} at ${hhmm(sim, next.t)}` : 'you gave it no new instruction'}. Climb it on the missed approach, keep it clear of departures and slot it back into the sequence.`;
      }
      return `${cs} went around. ${lastInstr}`;
    }
    case 'los':
    case 'stca': {
      const a = cs, b = e.cs2 ?? '';
      const ca = cmdsFor(sim, a, e.t, 1)[0], cb = b ? cmdsFor(sim, b, e.t, 1)[0] : undefined;
      const recent = (c?: { t: number }) => !!c && e.t - c.t < 240;
      const m = e.text.match(/([\d.]+) NM, (\d+) ft/);
      const what = e.kind === 'los' ? (m ? `They closed to ${m[1]} NM ${Number(m[2]) < 100 ? 'at the same level' : `with only ${fmtFt(Number(m[2]))} ft between them`}.` : 'They lost separation.') : 'The conflict alert went off before you had fixed it.';
      let creator = '';
      const latest = [ca && { cs: a, other: b, c: ca }, cb && { cs: b, other: a, c: cb }].filter(Boolean).sort((x: any, y: any) => y.c.t - x.c.t)[0] as { cs: string; other: string; c: { t: number; cl: { items: Item[] } } } | undefined;
      if (latest && recent(latest.c)) {
        const its = latest.c.cl.items;
        const verb = its.some((i) => i.k === 'lvl') ? 'brought it within 1,000 ft of' : its.some((i) => i.k === 'hdg' || i.k === 'dct' || i.k === 'trans') ? 'turned it into the path of' : 'did not keep it clear of';
        creator = `Your instruction to ${latest.cs} at ${hhmm(sim, latest.c.t)} (${describeItems(its)}) ${verb} ${latest.other}.`;
      } else creator = `Neither aircraft had a new instruction from you in the 4 minutes before; both flew their routes into the same airspace.`;
      const other = latest && latest.cs === a ? cb : ca;
      const otherCs = latest && latest.cs === a ? b : a;
      const tail = other ? ` ${otherCs}'s last instruction was ${describeItems(other.cl.items)} at ${hhmm(sim, other.t)}.` : '';
      return `${creator} ${what}${tail} Keep 1,000 ft between them until they are 3 NM apart and not converging.`;
    }
    case 'wake': {
      const foll = cs, lead = e.cs2 ?? '';
      const spds = sim.cmdLog.filter((c) => c.cl.cs === foll && c.t <= e.t && c.cl.items.some((i) => i.k === 'spd' || i.k === 'spdmin' || i.k === 'spdres')).slice(-3);
      const min = e.text.match(/minimum ([\d.]+) NM/)?.[1];
      const sp = spds.length ? `You gave ${foll} ${spds.map((c) => `${describeItems(c.cl.items.filter((i) => i.k === 'spd' || i.k === 'spdmin' || i.k === 'spdres'))} at ${hhmm(sim, c.t)}`).join(', then ')}` : `You gave ${foll} no speed instructions`;
      return `${sp}, so it caught up with ${lead} on final and closed to ${e.value?.toFixed(1) ?? '?'} NM behind a heavier aircraft that needs ${min ?? 'more'} NM. Slow the leader later, the follower earlier, and set the gap before both are on the localizer.`;
    }
    case 'mva': {
      const lvl = lastWith(sim, cs, e.t, 'lvl');
      const mva = Number(e.text.match(/MVA (\d+)/)?.[1] ?? s?.mva ?? NaN);
      const at = s ? where(s.p) : '';
      const head = lvl ? `Your ${describeItem(lvl.it)} at ${hhmm(sim, lvl.t)} took ${cs} below the lowest safe altitude for vectoring` : `${cs} descended below the lowest safe altitude for vectoring`;
      return `${head}${Number.isFinite(mva) ? ` of ${fmtFt(mva)} ft` : ''}${at ? ` ${at}` : ''}, while it was flying on your headings. Below that level only a published procedure or the final approach keeps it clear of terrain. ${prior ? `Last instructions: ${prior}.` : ''}`.trim();
    }
    case 'unanswered': {
      const t0 = e.t - 25;
      const busy = sim.cmdLog.filter((c) => c.t >= t0 && c.t <= e.t && c.cl.cs !== cs);
      return `${cs} called at ${hhmm(sim, t0)} and waited 25 seconds. ${busy.length ? `In that time you talked to ${[...new Set(busy.map((c) => c.cl.cs))].join(', ')}` : 'You sent nothing in that time'}. A quick ROGER (type R) answers the call and buys you time to plan; STANDBY (SB) if you need longer.`;
    }
    case 'late_xfr': {
      const d = e.text.match(/\(([\d.]+) NM\)/)?.[1];
      return `You handed ${cs} to Tower at ${d ?? 'under 4'} NM. Tower needs it by 4 NM to give a landing clearance. ${prior ? `Before that: ${prior}.` : ''} Transfer as soon as it is established on the localizer.`.trim();
    }
    case 'readback_missed': return `${cs} read back something different from what you said, and you did not correct it within 30 seconds. Listen to every readback and re-issue the instruction if it is wrong. ${prior ? `Your instructions: ${prior}.` : ''}`.trim();
    case 'tsa': return `${cs} entered an active military area. ${lastInstr} Check the active areas before you turn or descend traffic near them.`;
    case 'cb': return `${cs} flew into a thunderstorm. ${lastInstr} Approve deviation requests quickly and vector around cells with a few miles to spare.`;
    case 'exit_unxfr': return `${cs} left your airspace still on your frequency. ${lastInstr} Hand departures and crossers to the next sector before they reach the boundary.`;
    case 'flow': return `${cs} went to Brussels too close behind ${e.cs2 ?? 'the previous departure'} on the same route. ${lastInstr} Use speed or a short heading to build the required gap before the handoff.`;
    case 'speed_limit': return `${cs} flew faster than 250 kt below FL100. ${lastInstr}`;
    case 'warning_sent': return `You sent an instruction to ${cs} even though the system warned you about it. ${lastInstr}`;
    case 'airspace': return `${cs} climbed above your airspace before you handed it on. ${lastInstr}`;
    case 'xfr_level': return `${cs} went to Brussels still cleared below the agreed level of FL090. ${lastInstr} Climb departures to the agreed level before the handoff, or coordinate a different one.`;
    case 'xfr_conflict': return `${cs} went to the next sector with a conflict still predicted. ${lastInstr} Solve the conflict first, or tell the next unit about it.`;
    case 'coord_unanswered': return `Brussels asked whether you could take ${cs} early and got no answer before its transfer. Answer every intercom request, even with Unable.`;
    case 'tsa_routed': return `${cs} was routed into a military area after MIL had announced it. ${lastInstr} Once a TSA is announced, route traffic around it or below its floor.`;
    default: return lastInstr;
  }
}

// ---------------------------------------------------------------------------
const pairKey = (e: SimEvent) => (['los', 'stca', 'wake', 'conflict_solved', 'flow'].includes(e.kind) ? `${e.kind}:${[e.cs, e.cs2].sort().join('|')}` : `${e.kind}:${e.cs ?? e.text}`);
/** Collapse repeated events with the same cause (same kind, same aircraft or pair): keeps the costliest, with a count. */
export function collapse(events: SimEvent[]): (SimEvent & { count: number })[] {
  const m = new Map<string, SimEvent & { count: number }>();
  for (const e of events) {
    const k = pairKey(e);
    const o = m.get(k);
    if (!o) m.set(k, { ...e, count: 1 });
    else { o.count++; if (e.cost > o.cost) m.set(k, { ...e, count: o.count }); }
  }
  return [...m.values()];
}
const distinct = (evs: SimEvent[]) => new Set(evs.map(pairKey)).size;

// ---------------------------------------------------------------------------
// Live helpers for the UI (cheap enough to call every second).
/** Consecutive tight landings: each within +0.0 to +0.7 NM of its minimum. A gap over +1.5 NM, a go-around or a loss of separation breaks the chain. */
export function seqChain(sim: Sim): { current: number; best: number; lastGap?: { gap: number; min: number } } {
  track(sim);
  type Ev = { t: number; kind: 'land' | 'break'; gap?: { gap: number; min: number } };
  const sp = new Map(sim.spacing.map((s) => [s.leader, s]));
  const tl: Ev[] = [];
  for (const l of sim.landings) {
    const s = sp.get(l.cs);
    tl.push({ t: l.t, kind: 'land', gap: s ? { gap: s.gap, min: s.min } : undefined });
  }
  for (const e of sim.events) if (e.kind === 'goaround' || e.kind === 'los') tl.push({ t: e.t, kind: 'break' });
  tl.sort((a, b) => a.t - b.t || (a.kind === 'break' ? -1 : 1));
  let current = 0, best = 0;
  let lastGap: { gap: number; min: number } | undefined;
  for (const x of tl) {
    if (x.kind === 'break') { current = 0; continue; }
    if (x.gap) lastGap = x.gap;
    const ex = x.gap ? x.gap.gap - x.gap.min : Infinity;
    if (ex >= -0.05 && ex <= 0.7) { current++; best = Math.max(best, current); }
    else if (ex > 1.5 || ex < -0.05) current = 0;
  }
  return { current, best, lastGap };
}

const isHolding = (a: Aircraft) => a.mode === 'HOLD';
/** Running numbers for the HUD: landings, movements, delay so far, fuel being burnt on delay right now, and aircraft holding. */
export function liveStats(sim: Sim): { landed: number; moves: number; delayMin: number; fuelBurnKgPerMin: number; holding: number } {
  track(sim);
  const landed = sim.landings.length;
  const moves = landed + sim.departuresHandled;
  // delay: extra track miles flown (holding included) at ~210 kt
  let extraNm = sim.landings.reduce((s, l) => s + Math.max(0, l.flownNm - l.baselineNm), 0);
  let burn = 0, holding = 0;
  for (const a of sim.aircraft) {
    if (a.remove || a.landed) continue;
    const kgMin = (a.perf.fuelKgH * Math.max(1, a.formation)) / 60;
    if (a.kind === 'arr') {
      const v = Math.max(140, Math.min(a.gs, 260));
      const remain = (sim.eta(a) / 60) * v;
      extraNm += Math.max(0, a.flownNm + remain - a.baselineNm);
    }
    if (a.state !== 'assumed') continue;
    if (isHolding(a)) { holding++; burn += kgMin; continue; }
    if (a.kind === 'arr' && a.mode === 'HDG' && !a.app?.locCap) {
      const r = sim.rwy;
      const target = a.route[0]?.p ?? r.thr;
      const off = Math.abs(((a.trk - bearing(a.p, target) + 540) % 360) - 180);
      burn += kgMin * Math.min(1, Math.max(0, 1 - Math.cos((off * Math.PI) / 180)));
    }
  }
  return { landed, moves, delayMin: extraNm / 3.5, fuelBurnKgPerMin: Math.round(burn), holding };
}

// ---------------------------------------------------------------------------
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
  const stcaN = distinct(ev.filter((e) => e.kind === 'stca'));
  const losN = distinct(los);
  const gateFail = losBad.length > 0 || mvaBad.length > 0;
  const gate = {
    pass: !gateFail,
    lines: [
      { text: `Losses of separation: ${losN}${los.length ? ` (${distinct(losBad)} beyond 10% of the minimum)` : ''}`, bad: losBad.length > 0 },
      { text: `Wake infringements: ${distinct(wake)}${wake.length ? ` (closest ${Math.min(...wake.map((w) => w.value ?? 9)).toFixed(1)} NM)` : ''}`, bad: wake.some((w) => w.sev === 'major') },
      { text: `Below the minimum vectoring altitude: ${distinct(mva)}`, bad: mvaBad.length > 0 },
      ...(cb.length ? [{ text: `Thunderstorm penetrations: ${cb.length}`, bad: true }] : []),
    ],
  };

  // ---- Metrics
  const landings = sim.landings.filter((l) => !l.emergency);
  const extra = landings.map((l) => l.flownNm - l.baselineNm);
  const extraMed = median(extra);
  const airborneArr = sim.aircraft.filter((a) => a.kind === 'arr' && !a.landed && !a.remove);
  const holdTotalMin = (sim.landings.reduce((s, l) => s + l.holdSec, 0) + sim.aircraft.reduce((s, a) => s + (a.kind === 'arr' ? a.holdSec : 0), 0)) / 60;
  const arrivalsCount = Math.max(sim.arrivalsSpawned, 1);
  const holdPer = holdTotalMin / arrivalsCount;
  const spacingExcess = sim.spacing.map((s) => s.gap - s.min);
  const spacingMed = median(spacingExcess);
  const cdo = sim.landings.length ? sim.landings.filter((l) => l.levelOffs === 0).length / sim.landings.length : null;
  const fuelPerNm = (type: string) => (PERF[type]?.fuelKgH ?? 4000) / 230;
  const fuelExtra = landings.reduce((s, l) => s + Math.max(0, l.flownNm - l.baselineNm) * fuelPerNm(l.type), 0)
    + sim.landings.reduce((s, l) => s + (l.holdSec / 3600) * (PERF[l.type]?.fuelKgH ?? 4000) * 0.15, 0)
    // aircraft still airborne: miles flown plus miles still to go, against the same baseline
    + airborneArr.reduce((s, a) => {
      const v = Math.max(140, Math.min(a.gs, 260));
      const remain = (sim.eta(a) / 60) * v;
      return s + Math.max(0, a.flownNm + remain - a.baselineNm) * fuelPerNm(a.type) + (a.holdSec / 3600) * a.perf.fuelKgH * 0.15;
    }, 0);
  const occ = (sim.atcAirtime + sim.pilotAirtime) / Math.max(sim.t, 1);
  const respMed = median(sim.responseTimes);
  const handled = new Set(sim.cmdLog.filter((c) => !(c as any).op && c.cl.cs).map((c) => c.cl.cs)).size || 1;
  const txPer = sim.clearancesSent / handled;
  const allLow = [...sim.aircraft].reduce((s, a) => s + a.lowSec, 0) + ((sim as any)._lowLanded ?? 0);
  const demandPerHr = sim.arrivalsSpawned / hours;
  const rate = sim.landings.length / hours;
  const unanswered = count('unanswered');

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

  // ---- Ratings (null = no evidence this session; the UI shows n/a)
  const ratings = {} as Record<Comp, number | null>;
  const evidence = {} as Record<Comp, string>;
  {
    const any = sim.clearancesSent > 0 || los.length + wake.length + mva.length + cb.length + stcaN > 0;
    let r = 5;
    if (los.some((e) => e.sev === 'serious')) r = 1;
    else if (losBad.length) r = 2;
    else if (los.length) r = 3;
    if (wake.some((w) => w.sev === 'major')) r = Math.min(r, 3);
    r -= distinct(wake.filter((w) => w.sev === 'minor')) * 0.5;
    if (mvaBad.length) r = Math.min(r, 2);
    r -= distinct(mva.filter((m) => m.sev === 'minor'));
    r -= cb.length;
    if (stcaN > 3) r -= 1;
    ratings.SEPC = any ? clamp5(r) : null;
    evidence.SEPC = `${losN} losses of separation, ${distinct(wake)} wake, ${distinct(mva)} below safe altitude, ${stcaN} conflict alerts`;
  }
  {
    const solved = count('conflict_solved');
    let r: number | null = solved + stcaN === 0 ? null : (() => { const q = solved / (solved + stcaN); return q >= 0.9 ? 5 : q >= 0.75 ? 4 : q >= 0.5 ? 3 : q >= 0.25 ? 2 : 1; })();
    if (r === null && count('exit_unxfr')) r = 5;
    if (r !== null) { r -= count('exit_unxfr'); r -= unanswered * 0.5; }
    ratings.SITU = r === null ? null : clamp5(r);
    evidence.SITU = `${solved} conflicts fixed before the alert, ${stcaN} caught by the alert`;
  }
  {
    if (!sim.arrivalsSpawned) ratings.TRAF = null;
    else {
      let r = 5;
      // every arrival that appeared before the end and is still airborne counts as not handled
      const ratio = sim.landings.length / Math.max(1, sim.arrivalsSpawned);
      if (ratio < 0.9) r -= 1;
      if (ratio < 0.7) r -= 1;
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
    evidence.COMM = `${txPer.toFixed(1)} transmissions per aircraft, ${count('readback_missed')} wrong readbacks missed, ${count('readback_caught')} caught`;
  }
  {
    const xfrs = sim.cmdLog.filter((c) => c.cl.items.some((i) => i.k === 'xfr')).length;
    const cordEv = ev.filter((e) => e.comp === 'CORD' && e.cost > 0).length;
    const answered = count('coord_answered');
    let r = 5;
    r -= count('late_xfr') * 0.5;
    r -= count('exit_unxfr');
    r -= count('tsa');
    r -= count('flow');
    r -= count('airspace') * 0.5;
    r -= count('coord_unanswered');
    r -= count('xfr_level') * 0.5;
    r -= count('xfr_conflict');
    r -= count('tsa_routed') * 0.5;
    r -= ev.filter((e) => e.kind === 'goaround' && e.comp === 'CORD').length;
    ratings.CORD = xfrs + cordEv + answered > 0 ? clamp5(r) : null;
    const extra = [
      answered + count('coord_unanswered') ? `${answered} Brussels requests answered, ${count('coord_unanswered')} not` : '',
      count('xfr_level') ? `${count('xfr_level')} below the agreed level` : '',
      count('xfr_conflict') ? `${count('xfr_conflict')} in conflict` : '',
      count('tsa_routed') ? `${count('tsa_routed')} routed into an announced TSA` : '',
    ].filter(Boolean);
    evidence.CORD = `${xfrs} handoffs, ${count('late_xfr')} late, ${count('exit_unxfr')} missed, ${count('tsa')} military area, ${count('flow')} flow${extra.length ? ', ' + extra.join(', ') : ''}`;
  }
  {
    if (respMed === null) ratings.WORK = unanswered > 0 ? 1 : null;
    else {
      let r = respMed <= 4 ? 5 : respMed <= 7 ? 4 : respMed <= 12 ? 3 : respMed <= 20 ? 2 : 1;
      r -= unanswered; // each call left hanging for 25 s costs a full point
      ratings.WORK = clamp5(r);
    }
    evidence.WORK = `median response ${respMed?.toFixed(1) ?? '—'} s, ${unanswered} unanswered calls`;
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
    evidence.SPP = `${sim.warningsSent} instructions sent past a warning, ${count('speed_limit')} speed-limit breaches`;
  }

  // ---- Costliest decisions: one entry per cause, top 3, each with a cause chain
  const costliest: CostItem[] = collapse(ev.filter((e) => e.cost > 0))
    .sort((a, b) => b.cost - a.cost || a.t - b.t).slice(0, 3)
    .map((e) => ({ ...e, replayT: Math.max(0, e.t - 60), why: explain(sim, e) }));

  // ---- Pass criteria
  let pass: Result['pass'];
  const pc = sim.sc.pass;
  if (pc) {
    const reasons: { text: string; ok: boolean }[] = [{ text: 'Safety gate passed', ok: gate.pass }];
    if (pc.minLanded !== undefined) reasons.push({ text: `At least ${pc.minLanded} landed (${sim.landings.length})`, ok: sim.landings.length >= pc.minLanded });
    if (pc.allArrivalsHandled) reasons.push({ text: 'Every arrival landed', ok: sim.landings.length >= sim.arrivalsSpawned });
    if (pc.minDeparturesHandled !== undefined) reasons.push({ text: `At least ${pc.minDeparturesHandled} departures handed on (${sim.departuresHandled})`, ok: sim.departuresHandled >= pc.minDeparturesHandled });
    if (pc.maxHoldMinPerArrival !== undefined) reasons.push({ text: `Holding under ${pc.maxHoldMinPerArrival} min per arrival`, ok: holdPer <= pc.maxHoldMinPerArrival });
    if (pc.noMissedReadbacks) reasons.push({ text: 'No missed wrong readbacks', ok: count('readback_missed') === 0 });
    if (pc.noTsa) reasons.push({ text: 'No military area infringements', ok: count('tsa') === 0 });
    if (pc.emergencyLandedWithinMin !== undefined) {
      const ok = sim.emergencies.length > 0 && sim.emergencies.every((e) => e.landedT !== undefined && (e.landedT - e.t0) / 60 <= pc.emergencyLandedWithinMin!);
      reasons.push({ text: `Emergency landed within ${pc.emergencyLandedWithinMin} min`, ok });
    }
    for (const [c, v] of Object.entries(pc.minRatings ?? {})) {
      const r = ratings[c as Comp];
      reasons.push({ text: `${COMP_NAMES[c as Comp]} (${COMP_PLAIN[c as Comp].toLowerCase()}) rated ${v} or better (${r ?? 'n/a'})`, ok: r !== null && r >= (v as number) });
    }
    pass = { ok: reasons.every((x) => x.ok), reasons };
  }

  // ---- Grade
  // Work done: ending early or leaving traffic unworked can never grade above a fail.
  const moves = sim.landings.length + sim.departuresHandled;
  const oldArr = (sim.spawnLog.length ? sim.spawnLog : sim.landings.map((l) => ({ cs: l.cs, kind: 'arr' as const, t: l.spawnT })))
    .filter((x) => x.kind === 'arr' && x.t < sim.t - 900).map((x) => x.cs);
  const landedSet = new Set(sim.landings.map((l) => l.cs));
  const oldLanded = oldArr.filter((cs) => landedSet.has(cs)).length;
  const workNotes: string[] = [];
  if (moves === 0) workNotes.push('No traffic worked');
  else if (!pc && oldArr.length && oldLanded / oldArr.length < 0.6) workNotes.push(`Land at least 60% of the arrivals that had time to land (you landed ${oldLanded} of ${oldArr.length})`);
  if (pass && workNotes.length) { pass.reasons.push({ text: workNotes[0], ok: false }); pass.ok = false; }
  const passed = (pass ? pass.ok : gate.pass) && !workNotes.length;
  const goodNeeds: string[] = [];
  if (spacingMed !== null && spacingMed > 1.0) goodNeeds.push(`Median landing spacing within 1.0 NM of the minimum (yours +${spacingMed.toFixed(1)} NM)`);
  else if (spacingMed === null && sim.arrivalsSpawned >= 2) goodNeeds.push('Show your landing spacing: land arrivals one behind the other (no pairs this session)');
  if (holdPer > 1) goodNeeds.push(`Holding under 1 minute per arrival on average (yours ${holdPer.toFixed(1)})`);
  const ratedNeeds: string[] = [];
  if (stcaN > 0) ratedNeeds.push(`No conflict alerts at all (you had ${stcaN})`);
  if (respMed !== null && respMed > 5) ratedNeeds.push(`Answer pilots within 5 seconds on median (yours ${respMed.toFixed(1)} s)`);
  else if (respMed === null) ratedNeeds.push('Answer pilot calls (none answered this session)');
  if (cdo !== null && cdo < 0.6) ratedNeeds.push(`At least 60% continuous descents (yours ${Math.round(cdo * 100)}%)`);
  else if (cdo === null && sim.arrivalsSpawned > 0) ratedNeeds.push('Show continuous descents: land an arrival (none landed)');
  let grade: Grade, gradeNotes: string[];
  if (workNotes.length) { grade = 'fail'; gradeNotes = workNotes; }
  else if (!passed) { grade = 'fail'; gradeNotes = pass ? pass.reasons.filter((x) => !x.ok).map((x) => (x.text === 'Safety gate passed' ? 'Pass the safety gate' : x.text)) : ['Pass the safety gate: no loss of separation beyond the tolerance and nobody below the minimum vectoring altitude']; }
  else if (goodNeeds.length) { grade = 'pass'; gradeNotes = goodNeeds; }
  else if (ratedNeeds.length) { grade = 'good'; gradeNotes = ratedNeeds; }
  else { grade = 'rated'; gradeNotes = []; }
  const seqBest = seqChain(sim).best;

  // ---- Objectives (timed)
  const objectives = sim.sc.objectives?.map((o) => {
    const l = sim.landings.find((x) => x.cs === o.cs);
    return { ...o, met: !!l && l.t <= o.byT };
  });

  // ---- Narrative (instructor-style, generated from the numbers)
  const rated = COMPS.filter((c) => ratings[c] !== null) as Comp[];
  const weakest = [...rated].sort((a, b) => (ratings[a]! - ratings[b]!) || COMPS.indexOf(a) - COMPS.indexOf(b))[0];
  const strongest = [...rated].sort((a, b) => (ratings[b]! - ratings[a]!) || COMPS.indexOf(a) - COMPS.indexOf(b))[0];
  const narrative: string[] = [];
  narrative.push(gate.pass ? 'You passed the safety gate: nobody got dangerously close and nobody went below the minimum vectoring altitude.' : `You failed the safety gate. ${losBad.length ? `${losBad[0].text}.` : mvaBad.length ? `${mvaBad[0].text}.` : ''} On a real check ride the session would stop there.`);
  if (strongest && weakest && strongest !== weakest) narrative.push(`Strongest area: ${COMP_PLAIN[strongest].toLowerCase()} (${evidence[strongest]}). Weakest: ${COMP_PLAIN[weakest].toLowerCase()} (${evidence[weakest]}).`);
  if (costliest[0]) narrative.push(`Your costliest moment came at ${sim.utc(costliest[0].t).slice(0, 5)}. ${costliest[0].why} Replay from a minute before it and try a different decision.`);
  if (spacingMed !== null && spacingMed > 1.2) narrative.push(`Final spacing ran ${spacingMed.toFixed(1)} NM above the minimum on average. Tighter speed control earlier (210 kt on base, 180 kt at intercept) would buy back landing slots.`);
  if (respMed !== null && respMed > 8) narrative.push(`Pilots waited a median ${respMed.toFixed(0)} seconds for an answer. Acknowledge a check-in first, then plan.`);
  if (unanswered && respMed === null) narrative.push(`${unanswered} pilot call${unanswered > 1 ? 's' : ''} went unanswered and you answered none. Every call needs a reply, even a short one.`);
  if (seqBest >= 3) narrative.push(`Best run: ${seqBest} landings in a row right on the minimum spacing.`);

  const suggested = weakest ? NEXT_FOR[weakest] : undefined;
  return {
    id: `${Date.now()}`, scenarioId: sim.sc.id, title: sim.sc.title, date: new Date().toISOString(), durationMin: Math.round(sim.t / 60), seed: sim.sc.seed,
    gate, ratings, evidence, metrics, costliest, pass, narrative, suggested, landed: sim.landings.length, arrivals: sim.arrivalsSpawned,
    grade, gradeNotes, seqBest, objectives,
  };
}
