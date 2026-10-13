import { alongTrack, angDiff, bearing, crossTrack, dist, move, norm360, pointInPolygon, type XY } from '../geo';
import { levelToFt, mvaAt, type Leg, type Level, type Pack, type Runway } from '../pack/load';
import { airtime, levelSpeech, levelText, mergeItem, phraseology, readback, releasePhrase, telephony, unitName, digits, type Clearance, type Ctx, type Item } from './clearance';
import { PERF, wakeMinNm, type Recat } from './perf';
import { distToThr, glideAlt, locWindowNm, startHold, stepAircraft, type PilotWorld } from './pilot';
import { Rng } from './rng';
import type { Aircraft, Comp, CoordReq, Estimate, LandingRecord, ReleaseReq, SafetyNet, Scenario, SimEvent, SpacingRecord, SpawnSpec, Storm, Tx } from './types';
import { bestTransition, landingOrder, nmIn, slotFor } from './sequence';
import { buildMetar, isLvp, parseMetar, selectRunway, transitionLevel, windComponents, type Weather } from './weather';
import type { Level as PackLevel } from '../pack/load';

/** A command-log entry: a clearance, or a correction / sequence change (op), replayable with Sim.replay. */
export interface CmdEntry { t: number; cl: Clearance; op?: 'correct' | 'seq'; seq?: string[] }
/** Seconds of notice the supervisor gives before a wind-driven runway change. */
export const RUNWAY_CHANGE_NOTICE_S = 600;
/** Seconds of notice before a TSA goes live. */
export const TSA_NOTICE_S = 300;
/** Ground speed assumed for Brussels' estimates on the STAR, NM per minute. */
const EST_NM_PER_MIN = 4.5;
const hhmmOf = (utc: string) => utc.slice(0, 5).replace(':', '');
const tsaSpoken = (name: string) => name.replace(/^TSA(\d)/, 'TSA $1');

export interface IssueResult { ok: boolean; warnings: string[]; blocked?: boolean }

const ATIS_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** What the crew declares, in the words the UI shows and the pilot says. */
export const EMERGENCY_TEXT: Record<'engine' | 'smoke' | 'radio', string> = { engine: 'Engine failure', smoke: 'Smoke in the cargo hold', radio: 'Radio failure' };
const EPS_VERT = 950;

export class Sim implements PilotWorld {
  t = 0;
  rng: Rng;
  weather: Weather;
  runway: string;
  atisIdx: number;
  qnh: number;
  tl: number;
  lvp: boolean;
  ilsOut = new Set<string>();
  tsaOn = new Set<string>();
  flows: { exitFix: string; mit: number }[] = [];
  aircraft: Aircraft[] = [];
  events: SimEvent[] = [];
  log: Tx[] = [];
  cmdLog: CmdEntry[] = [];
  landings: LandingRecord[] = [];
  /** Consecutive landings on the same runway, paired at the follower's touchdown. */
  spacing: SpacingRecord[] = [];
  /** Every aircraft that appeared, with its spawn time (assessment counts what was left unworked). */
  spawnLog: { cs: string; kind: Aircraft['kind']; t: number }[] = [];
  responseTimes: number[] = [];
  emergencies: { cs: string; type: string; t0: number; firstClrT?: number; landedT?: number }[] = [];
  storms: Storm[];
  atcAirtime = 0;
  pilotAirtime = 0;
  warningsSent = 0;
  clearancesSent = 0;
  arrivalsSpawned = 0;
  departuresSpawned = 0;
  departuresHandled = 0;
  ended = false;
  /** Why the session ended: 'complete' (traffic complete), 'time' (duration reached) or 'manual'. */
  endReason?: 'complete' | 'time' | 'manual';
  /** Departure release requests from Tower (pending, released, held, recently airborne). */
  releases: ReleaseReq[] = [];
  radarRefresh = 4;
  onTx: ((tx: Tx) => void)[] = [];
  /** Callsigns whose next level or heading readback will be wrong (tutorial). */
  forceWrong = new Set<string>();
  onEvent: ((e: SimEvent) => void)[] = [];
  /** Player-owned landing order (callsigns, first to land first). AMAN and suggestions follow it. Set with setSequence. */
  sequence: string[] = [];
  /** Brussels estimates for arrivals (expected ones first appear 2 to 4 minutes before the transfer). */
  estimates: Estimate[] = [];
  /** Coordination requests from Brussels (early transfers), answered with appr / deny on the callsign. */
  coordReqs: CoordReq[] = [];
  /** A runway change the supervisor has announced and not yet made. */
  rwyChange?: { to: string; at: number; reason: 'wind' | 'scheduled' };
  /** The last runway change: from, to, when. */
  lastRwyChange?: { from: string; to: string; t: number };
  /** TSAs announced by MIL and not yet active: name to activation time. */
  tsaPending = new Map<string, number>();

  private nextId = 1;
  private txId = 1;
  private busyUntil = 0;
  private queue: { tx: Omit<Tx, 'id' | 't0' | 't1'>; notBefore: number; onStart?: () => void; priority?: boolean }[] = [];
  private pending: { at: number; fn: () => void; seq: number }[] = [];
  private seq = 0;
  private spawnIdx = 0;
  private evIdx = 0;
  private runwayBusyUntil = -1;
  private ongoing = new Map<string, { kind: string; t0: number; worst: number; worst2: number; a: string; b?: string; extra?: any }>();
  private conflicts = new Map<string, { t: number; stca: boolean }>();
  private lastXfr = new Map<string, string>();
  private spawns: SpawnSpec[];
  private endAt?: number;
  private relSpecs = new Map<string, SpawnSpec>();
  private lastDepT = -999;
  private atisChangeT = -999;
  private prevAtis?: string;
  private stackSeen = new Set<string>();
  /** Last touchdown per runway, with the distance of each aircraft on that final at that moment. */
  private lastLanding = new Map<string, { cs: string; t: number; recat: Recat; behind: Map<string, number> }>();
  /** Separate random stream for coordination, so adding it does not change the traffic or the pilots. */
  private crng: Rng;
  private estPlan: { spec: SpawnSpec; at: number; early: boolean; revise?: number }[] = [];
  private coordId = 1;
  private tsaNoticed = new Set<number>();
  private nets: SafetyNet[] = [];
  private netSince = new Map<string, number>();
  private lastAtc = new Map<string, { t1: number; entry?: object; cfl?: PackLevel; hdg?: number; turnQuery?: Aircraft['turnQuery'] }>();

  constructor(public pack: Pack, public sc: Scenario, opts: { radarRefresh?: number } = {}) {
    this.rng = new Rng(sc.seed);
    this.weather = parseMetar(sc.metar);
    this.qnh = this.weather.qnh;
    this.tl = transitionLevel(this.qnh, pack.meta.transitionAltitude);
    this.lvp = isLvp(this.weather);
    this.runway = sc.runway ?? selectRunway(pack, this.weather);
    this.atisIdx = 10 + (sc.seed % 8);
    this.storms = (sc.storms ?? []).map((s) => ({ ...s, p: { ...s.p } }));
    this.spawns = sc.spawns.map((x) => ({ ...x })).sort((a, b) => a.t - b.t);
    if (opts.radarRefresh) this.radarRefresh = opts.radarRefresh;
    this.crng = new Rng(((sc.seed ^ 0x9e3779b9) >>> 0) || 7);
    this.planCoordination();
  }

  /** Whether Brussels coordinates on the intercom in this scenario. */
  get coordination() { return this.sc.coordination ?? !this.sc.tutorial; }

  /** Crew fatigue 0..1 from the UTC time: rises from 0300, full 0430 to 0600, gone by 0730. */
  fatigue(t = this.t): number {
    const [h, m] = this.sc.startUtc.split(':').map(Number);
    const hr = (((h * 3600 + m * 60 + t) / 3600) % 24 + 24) % 24;
    if (hr < 3 || hr >= 7.5) return 0;
    if (hr < 4.5) return (hr - 3) / 1.5;
    if (hr < 6) return 1;
    return 1 - (hr - 6) / 1.5;
  }

  // ---------------- public helpers ----------------
  get atis() { return ATIS_LETTERS[this.atisIdx % 26]; }
  get durationS() { return this.sc.durationMin * 60; }
  get rwy(): Runway { return this.pack.runways.get(this.runway)!; }
  utc(t = this.t): string {
    const [h, m] = this.sc.startUtc.split(':').map(Number);
    const s = h * 3600 + m * 60 + Math.floor(t);
    const hh = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60, ss = s % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  metar(): string { return this.weather.raw; }
  ftOf(l: Level) { return levelToFt(l, this.qnh); }
  levelFor(ft: number): Level {
    return ft >= this.tl * 100 ? { fl: Math.round(ft / 100) } : { ft: Math.round(ft / 100) * 100 };
  }
  find(cs: string) { return this.aircraft.find((a) => a.cs === cs && !a.remove); }
  holdFor(fix: string) {
    const h = this.pack.holds.find((x) => x.fix === fix);
    return h ? { inbound: h.inbound, turn: h.turn, spd: h.spd } : undefined;
  }
  runwayBusy() { return this.t < this.runwayBusyUntil; }
  mvaAt(p: XY) { return mvaAt(this.pack, p, pointInPolygon); }
  freqBusy() { return this.t < this.busyUntil; }
  /** A readback (or say-again) from this callsign is still to come. */
  readbackPending(cs: string) { return this.queue.some((q) => q.priority && q.tx.cs === cs); }
  callers(): Aircraft[] { return this.aircraft.filter((a) => a.awaitingSince !== undefined && !a.remove).sort((a, b) => a.awaitingSince! - b.awaitingSince!); }

  /** Transitions usable for a runway. */
  transitionsFor(rwy: string) { return this.pack.transitions.filter((t) => t.runways.includes(rwy)); }

  // ---------------- main loop ----------------
  step(dt = 1) {
    if (this.ended) return;
    this.t += dt;
    const t = this.t;

    // scheduled effects
    this.pending.sort((a, b) => a.at - b.at || a.seq - b.seq);
    while (this.pending.length && this.pending[0].at <= t) this.pending.shift()!.fn();

    // scenario events, notices, coordination and spawns
    this.tsaNotices();
    while (this.evIdx < this.sc.events.length && this.sc.events[this.evIdx].t <= t) this.runEvent(this.sc.events[this.evIdx++]);
    this.stepCoordination();
    while (this.spawnIdx < this.spawns.length && this.spawns[this.spawnIdx].t <= t) {
      const sp = this.spawns[this.spawnIdx++];
      if (!(sp as any)._done) this.spawn(sp);
    }

    // frequency
    this.pumpQueue();

    // aircraft
    for (const ac of this.aircraft) {
      if (ac.remove) continue;
      if (ac.checkInAt !== undefined && t >= ac.checkInAt) { ac.checkInAt = undefined; this.checkIn(ac); }
      stepAircraft(ac, this, dt);
      this.afterStep(ac);
    }
    if (t % this.radarRefresh === 0) {
      for (const ac of this.aircraft) {
        ac.history.push({ ...ac.p });
        if (ac.history.length > 7) ac.history.shift();
      }
    }
    // calls made during this second (check-ins, requests) can start at once
    this.pumpQueue();
    this.moveStorms(dt);
    this.monitor();
    this.aircraft = this.aircraft.filter((a) => !a.remove);
    this.stepReleases();
    if (this.sc.atisDrift && t % 1800 === 0) this.driftAtis();
    // traffic complete: supervisor announces the hand-over, the session ends 30 s later
    if (this.endAt === undefined && this.trafficComplete()) {
      this.endAt = t + 30;
      this.icom('SUP', 'Traffic complete. Hand-over in 30 s');
    }
    if (this.endAt !== undefined && t >= this.endAt) this.finish('complete');
    if (t >= this.durationS) this.finish('time');
  }

  /** No spawns left, nobody on frequency or coming, no release outstanding. */
  trafficComplete(): boolean {
    if (this.spawnIdx < this.spawns.length || this.t < 5) return false;
    if (this.releases.some((r) => r.state !== 'airborne')) return false;
    if (this.coordReqs.some((r) => r.state === 'pending')) return false;
    if (this.queue.length || this.freqBusy()) return false;
    return !this.aircraft.some((a) => !a.remove && (a.state === 'assumed' || a.state === 'inbound' || (a.state === 'transferred' && a.xfrUnit === 'TWR' && !a.landed)));
  }

  finish(reason: 'complete' | 'time' | 'manual' = 'manual') {
    if (this.ended) return;
    for (const [key] of this.ongoing) this.closeOngoing(key);
    this.ended = true;
    this.endReason = reason;
  }

  /** Intercom message from another unit (or from the player when from = 'ATC'). No RT airtime, never blocked. */
  icom(from: Tx['from'], text: string, cs = ''): Tx {
    return this.emitTx({ from, cs, text, speech: text, channel: 'icom' }, this.t);
  }

  // ---------------- departure release protocol ----------------
  private requestRelease(spec: SpawnSpec) {
    const sid = this.pack.sids.find((s) => s.name === spec.sid && s.runways.includes(this.runway)) ?? this.mapSid(spec.sid, this.runway) ?? this.rng.pick(this.pack.sids.filter((s) => s.runways.includes(this.runway) && !s.atcDiscretion));
    const perf = PERF[spec.type] ?? PERF.B738;
    const r: ReleaseReq = { cs: spec.cs, type: perf.type, wake: perf.wake, sid: sid.name, rwy: this.runway, t: this.t, state: 'pending' };
    this.releases.push(r);
    this.relSpecs.set(spec.cs, { ...spec, sid: sid.name });
    this.icom('TWR', `Approach, Tower, request release ${spec.cs}, ${sid.name}, runway ${this.runway}`, spec.cs);
  }

  /** Arrival on final for the runway in use within n NM of the threshold. */
  private arrivalWithin(nm: number): boolean {
    return this.aircraft.some((a) => !a.remove && !a.landed && a.app?.locCap && !a.lowPass && (() => { const d = distToThr(a.p, a.app!.rwy); return d > -0.5 && d < nm; })());
  }

  private afterSatisfied(after: string): boolean {
    if (this.landings.some((l) => l.cs === after)) return true;
    const rel = this.releases.find((r) => r.cs === after);
    if (rel) return rel.state === 'airborne' && this.t - (rel.tAirborne ?? 0) >= 60;
    const ac = this.find(after);
    if (!ac) return true; // unknown or gone: nothing to wait for
    if (ac.kind === 'dep') return true;
    return false;
  }

  private stepReleases() {
    const t = this.t;
    for (const r of this.releases) {
      if (r.state === 'pending' && !r.chased && t - r.t > 180) {
        r.chased = true;
        this.icom('TWR', `Approach, Tower, still waiting release for ${r.cs}`, r.cs);
        this.event({ kind: 'release_delay', cs: r.cs, comp: 'CORD', sev: 'minor', text: `${r.cs}: release request unanswered for 3 minutes`, cost: 10 });
      }
      if (r.state === 'held' && !r.chased && r.expectAt !== undefined && t > r.expectAt + 60) {
        r.chased = true;
        this.icom('TWR', `Approach, Tower, ${r.cs} is past the expected release time, request release`, r.cs);
        this.event({ kind: 'release_delay', cs: r.cs, comp: 'CORD', sev: 'minor', text: `${r.cs}: held past the expected release time`, cost: 10 });
      }
      if (r.state === 'released' && t - (r.tReleased ?? t) >= 30 && t - this.lastDepT >= 60 && !this.runwayBusy()) {
        const heavy = r.wake === 'H' || r.wake === 'J';
        if (this.arrivalWithin(heavy ? 6 : 5)) continue;
        // never into the face of an arrival still landing the other way after a runway change
        if (this.aircraft.some((a) => !a.remove && !a.landed && a.app?.locCap && a.app.rwy.id.slice(0, 2) !== r.rwy.slice(0, 2) && distToThr(a.p, a.app.rwy) < 25)) continue;
        if (r.after && !this.afterSatisfied(r.after)) continue;
        const spec = this.relSpecs.get(r.cs);
        if (!spec) continue;
        r.state = 'airborne';
        r.tAirborne = t;
        this.lastDepT = t;
        this.launchDeparture(spec, r);
      }
    }
    // forget departures airborne for more than two minutes
    this.releases = this.releases.filter((r) => r.state !== 'airborne' || t - (r.tAirborne ?? t) < 120);
  }

  private answerRelease(r: ReleaseReq, it: Extract<Item, { k: 'rel' | 'relhold' }>, items: Item[]) {
    const ph = releasePhrase(r.cs, it);
    this.icom('ATC', ph.text, r.cs);
    if (it.k === 'relhold') {
      r.state = 'held';
      r.expectAt = this.t + (it.mins ?? 3) * 60;
      r.chased = false;
      this.icom('TWR', `Holding ${r.cs}`, r.cs);
      return;
    }
    // heading / level given as separate items count as part of the release
    const hdg = it.hdg ?? (items.find((x) => x.k === 'hdg') as { hdg: number } | undefined)?.hdg;
    const lvl = it.lvl ?? (items.find((x) => x.k === 'lvl') as { lvl: Level } | undefined)?.lvl;
    if (r.state === 'pending') this.responseTimes.push(Math.max(0, this.t - r.t));
    r.state = 'released';
    r.after = it.after; r.hdg = hdg; r.lvl = lvl;
    r.tReleased = this.t;
    this.icom('TWR', `Released ${r.cs}${r.after ? ' after ' + r.after : ''}`, r.cs);
  }

  // ---------------- ATIS drift (free play) ----------------
  private driftAtis() {
    const dq = (this.rng.chance(0.5) ? 1 : -1) * this.rng.int(1, 2);
    const veer = this.rng.int(10, 20);
    this.prevAtis = this.atis;
    this.atisChangeT = this.t;
    this.setWeather({ ...this.weather, qnh: this.weather.qnh + dq, windDir: norm360(this.weather.windDir + veer) }, true);
    this.icom('SUP', `New ATIS: information ${this.atis} now current, QNH ${this.qnh}`);
  }

  // ---------------- Brussels coordination ----------------
  /** Plan estimates (2 to 4 min before each transfer), early-transfer requests and "unable lower" revisions. */
  private planCoordination() {
    if (!this.coordination) return;
    const rate = this.sc.earlyTransferRate ?? 0.1;
    for (const spec of this.spawns) {
      if (spec.kind !== 'arr' || spec.silent || spec.unfamiliar) continue;
      const lead = this.crng.int(120, 240);
      const at = Math.max(1, spec.t - lead);
      const early = spec.t - lead >= 60 && !spec.callNow && !spec.emergency && this.crng.chance(rate);
      let revise: number | undefined;
      const alone = !this.spawns.some((o) => o !== spec && o.kind === 'arr' && o.star === spec.star && Math.abs(o.t - spec.t) < 300);
      if (!early && alone && spec.level === undefined && spec.t - at >= 100 && this.crng.chance(0.08)) revise = spec.t - this.crng.int(40, 70);
      this.estPlan.push({ spec, at, early, revise });
    }
    this.estPlan.sort((a, b) => a.at - b.at);
  }

  /** The STAR an arrival flies on the runway in use: its own, or the matching X / D variant after a runway change. */
  private starForSpec(name?: string) {
    let st = this.pack.stars.find((s) => s.name === name);
    if (st && !st.runways.includes(this.runway)) st = this.mapStar(st.name, this.runway) ?? st;
    return st ?? this.pack.stars.find((s) => s.runways.includes(this.runway))!;
  }
  /** The STAR with the same entry for `rwy` (KOK7X for 22L, KOK7D for 04R), if there is one. */
  mapStar(name: string, rwy: string) {
    const base = name.slice(0, -1);
    return this.pack.stars.find((s) => s.name.slice(0, -1) === base && s.runways.includes(rwy));
  }
  /** The SID with the same exit fix for `rwy` (LNO9S on 22, LNO2R on 04). */
  mapSid(name: string | undefined, rwy: string) {
    const exit = this.pack.sids.find((s) => s.name === name)?.exitFix;
    return exit ? this.pack.sids.find((s) => s.exitFix === exit && s.runways.includes(rwy) && !s.atcDiscretion) : undefined;
  }

  /** Where an arrival is handed over: `spawnDist` track miles (plus `extraNm`) before the end of its STAR. */
  private arrivalStart(spec: SpawnSpec, extraNm = 0) {
    const star = this.starForSpec(spec.star);
    const legs = star.legs;
    const D = (spec.spawnDist ?? 42) + extraNm;
    const pts = legs.map((l) => l.p);
    let remaining = D;
    let pos: XY | undefined;
    let startIdx = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      const seg = dist(pts[i - 1], pts[i]);
      if (remaining <= seg) { pos = move(pts[i], bearing(pts[i], pts[i - 1]), remaining); startIdx = i; break; }
      remaining -= seg;
    }
    if (!pos) {
      const b = pts.length > 1 ? bearing(pts[1], pts[0]) : bearing({ x: 0, y: 0 }, pts[0]);
      pos = move(pts[0], b, remaining);
      startIdx = 0;
    }
    if (spec.unfamiliar) pos = move({ x: 0, y: 0 }, 300, D);
    const route = spec.unfamiliar ? [] : legs.slice(startIdx).map((l) => ({ ...l }));
    return { star, legs, pos, route };
  }

  private makeEstimate(spec: SpawnSpec): Estimate | undefined {
    const g = this.arrivalStart(spec);
    const fix = g.route[0];
    if (!fix) return undefined;
    const tFix = spec.t + Math.round((dist(g.pos, fix.p) / EST_NM_PER_MIN) * 60);
    const perf = PERF[spec.type] ?? PERF.B738;
    return { cs: spec.cs, type: perf.type, star: g.star.name, fix: fix.fix, t: tFix, xfl: spec.level ?? g.star.handoffLevel, sentT: this.t, state: 'expected' };
  }
  /** "Liège, Brussels, estimate CLX7HK, KOK7X, MAK at 16, FL080" */
  estimateText(e: Estimate) { return `Liège, Brussels, estimate ${e.cs}, ${e.star}, ${e.fix} at ${this.utc(e.t).slice(3, 5)}, ${levelText(e.xfl)}`; }
  private earlyLevel(xfl: PackLevel): PackLevel {
    const fl = xfl.fl ?? Math.round((xfl.ft ?? 8000) / 100);
    return { fl: Math.min(120, Math.max(100, fl + 30)) };
  }

  private stepCoordination() {
    const t = this.t;
    while (this.estPlan.length && this.estPlan[0].at <= t) {
      const p = this.estPlan.shift()!;
      if ((p.spec as any)._done) continue;
      const est = this.makeEstimate(p.spec);
      if (!est) continue;
      this.estimates.push(est);
      if (p.early) {
        const lvl = this.earlyLevel(est.xfl);
        const text = `Liège, Brussels, request early transfer of ${est.cs}, he's level ${levelText(lvl)}, can you take him at ${levelText(lvl)}?`;
        this.coordReqs.push({ id: this.coordId++, from: 'BRU', kind: 'early', cs: est.cs, level: lvl, t, state: 'pending', expireT: p.spec.t, text });
        this.icom('BRU', text, est.cs);
      } else this.icom('BRU', this.estimateText(est), est.cs);
      if (p.revise !== undefined) {
        const spec = p.spec;
        this.schedule(Math.max(t + 30, p.revise), () => {
          if (est.state !== 'expected' || (spec as any)._done) return;
          const up: PackLevel = est.xfl.fl !== undefined ? { fl: est.xfl.fl + 10 } : { ft: (est.xfl.ft ?? 0) + 1000 };
          est.xfl = up; est.revised = true; spec.level = up;
          this.icom('BRU', `Liège, Brussels, ${est.cs} will be ${levelText(up)}, unable lower due traffic`, est.cs);
        });
      }
    }
    for (const r of this.coordReqs) {
      if (r.state !== 'pending') continue;
      if (!r.chased && t - r.t >= 60 && t < r.expireT) {
        r.chased = true;
        this.icom('BRU', `Liège, Brussels, still need an answer on ${r.cs}`, r.cs);
      }
      if (t >= r.expireT) {
        r.state = 'expired';
        const est = this.estimates.find((e) => e.cs === r.cs);
        this.event({ kind: 'coord_unanswered', cs: r.cs, comp: 'CORD', sev: 'minor', text: `${r.cs}: Brussels early-transfer request left unanswered`, cost: 10 });
        this.icom('BRU', `No answer, ${r.cs} comes as coordinated${est ? ', ' + levelText(est.xfl) : ''}`, r.cs);
      }
    }
  }

  /** Approve or refuse a Brussels request (intercom). Approve: the arrival is transferred now at the requested level. */
  private answerCoord(r: CoordReq, yes: boolean) {
    this.responseTimes.push(Math.max(0, this.t - r.t));
    this.event({ kind: 'coord_answered', cs: r.cs, comp: 'CORD', sev: 'good', text: `${r.cs}: Brussels request answered after ${Math.round(this.t - r.t)} s`, cost: 0 });
    const est = this.estimates.find((e) => e.cs === r.cs);
    if (!yes) {
      r.state = 'denied';
      const x = est ? levelText(est.xfl) : 'as coordinated';
      this.icom('ATC', `Negative, ${r.cs} at ${x} as coordinated`, r.cs);
      this.icom('BRU', `Copied, ${r.cs} at ${x}`, r.cs);
      return;
    }
    r.state = 'approved';
    this.icom('ATC', `Approved, ${r.cs} at ${levelText(r.level)}`, r.cs);
    this.icom('BRU', `${r.cs} transferring now at ${levelText(r.level)}`, r.cs);
    const spec = this.spawns.find((s) => s.cs === r.cs && s.kind === 'arr' && !(s as any)._done && s.t >= this.t);
    if (!spec) return;
    (spec as any)._done = true;
    // further out along the STAR by the miles it would have flown before the planned transfer, inside the radar cover
    let extra = ((spec.t - this.t) / 60) * EST_NM_PER_MIN;
    const far = (x: number) => { const p = this.arrivalStart(spec, x).pos; return Math.hypot(p.x, p.y) > this.pack.meta.sectorRadiusNm + 16; };
    while (extra > 0 && far(extra)) extra -= 2;
    if (est) { est.xfl = r.level; est.t -= Math.round(spec.t - this.t); }
    this.spawn({ ...spec, t: this.t, level: r.level, alt: this.ftOf(r.level), spawnDist: (spec.spawnDist ?? 42) + Math.max(0, extra) });
  }

  // ---------------- military notices ----------------
  /** MIL announces each TSA activation about 5 minutes ahead: "TSA 29A active from 0230, 4,500 ft to FL145". */
  private tsaNotices() {
    this.sc.events.forEach((e, i) => {
      if (e.kind !== 'tsa' || !e.on || this.tsaNoticed.has(i) || this.t < e.t - TSA_NOTICE_S) return;
      this.tsaNoticed.add(i);
      const tsa = this.pack.tsas.find((x) => x.name === e.name);
      const band = tsa ? `, ${levelText(tsa.floor)} to ${levelText(tsa.ceiling)}` : '';
      if (e.t > this.t) this.tsaPending.set(e.name, e.t);
      this.icom('MIL', `Liège, MIL, ${tsaSpoken(e.name)} active from ${hhmmOf(this.utc(Math.max(e.t, this.t)))}${band}`);
    });
  }
  /** Active or announced TSA that the path given by these items enters within its level band (ignores one the aircraft is already in). */
  tsaOnPath(ac: Aircraft, items: Item[]): string | undefined {
    const pts: XY[] = [];
    const mv = this.pack.meta.magVar;
    for (const it of items) {
      if (it.k === 'hdg') for (let d = 2; d <= 8; d += 2) pts.push(move(ac.p, norm360(it.hdg + mv), d));
      if (it.k === 'dct' && this.pack.fixes.has(it.fix)) {
        const f = this.fixP(it.fix), L = Math.min(20, dist(ac.p, f)), b = bearing(ac.p, f);
        for (let d = 2; d <= L; d += 2) pts.push(move(ac.p, b, d));
        pts.push(f);
      }
      if (it.k === 'star') {
        const st = this.pack.stars.find((s) => s.name === it.name);
        if (st) {
          let prev = ac.p;
          for (const l of this.starJoin(ac, st.legs)) {
            const n = Math.max(1, Math.ceil(dist(prev, l.p) / 2));
            for (let k = 1; k <= n; k++) pts.push({ x: prev.x + ((l.p.x - prev.x) * k) / n, y: prev.y + ((l.p.y - prev.y) * k) / n });
            prev = l.p;
          }
        }
      }
    }
    if (!pts.length) return undefined;
    const lv = (items.find((x) => x.k === 'lvl') as { lvl: PackLevel } | undefined)?.lvl ?? ac.cleared;
    const lo = Math.min(ac.alt, this.ftOf(lv)), hi = Math.max(ac.alt, this.ftOf(lv));
    for (const tsa of this.pack.tsas) {
      if (!this.tsaOn.has(tsa.name) && !this.tsaPending.has(tsa.name)) continue;
      if (hi < this.ftOf(tsa.floor) || lo > this.ftOf(tsa.ceiling)) continue;
      if (pointInPolygon(ac.p, tsa.poly)) continue;
      if (pts.some((p) => pointInPolygon(p, tsa.poly))) return tsa.name;
    }
    return undefined;
  }

  // ---------------- runway change ----------------
  /** Tailwind on the runway in use above 5 kt (gusts included): the supervisor gives 10 minutes' notice of a change. */
  private windCheck() {
    if (this.rwyChange || this.sc.events.slice(this.evIdx).some((e) => e.kind === 'runway')) return;
    const tail = this.tailwind();
    if (tail <= 5) return;
    const to = selectRunway(this.pack, this.weather);
    if (to === this.runway) return;
    this.announceRunwayChange(to, RUNWAY_CHANGE_NOTICE_S, 'wind', tail);
  }
  /** Tailwind component (kt, gusts included) on a runway (default: in use); 0 or less is a headwind. */
  tailwind(rwy = this.runway): number {
    const r = this.pack.runways.get(rwy);
    if (!r) return 0;
    return -windComponents(r.crs, this.weather.windDir, Math.max(this.weather.windKt, this.weather.gustKt ?? 0)).head;
  }
  private announceRunwayChange(to: string, notice: number, reason: 'wind' | 'scheduled', tail?: number) {
    const at = this.t + notice;
    this.rwyChange = { to, at, reason };
    const why = tail !== undefined ? `, tailwind ${tail} kt on ${this.runway}` : '';
    const series = to.startsWith('04') ? 'D' : 'X';
    this.icom('SUP', `Runway change to ${to} at ${hhmmOf(this.utc(at))}${why}. After the change, arrivals not yet on the approach go via the ${series} arrivals, departures get the ${to} SIDs.`);
    this.schedule(at, () => { if (this.rwyChange && this.rwyChange.at === at) this.changeRunway(to); });
  }
  /** Change the runway in use now. Aircraft established on the localizer continue to the old runway. */
  changeRunway(to: string) {
    const from = this.runway;
    this.rwyChange = undefined;
    if (to === from || !this.pack.runways.has(to)) return;
    this.runway = to; this.atisIdx++;
    this.lastRwyChange = { from, to, t: this.t };
    this.sys(`Runway change: ${to} in use, ATIS ${this.atis}`);
    const est = this.aircraft.filter((a) => !a.remove && !a.landed && a.kind === 'arr' && a.app?.locCap && a.app.rwy.id === from).map((a) => a.cs);
    const re = this.needReclear().map((a) => a.cs);
    this.icom('SUP', `Runway ${to} in use${est.length ? `. ${est.join(', ')} continue${est.length === 1 ? 's' : ''} to ${from}` : ''}${re.length ? `. Re-clear ${re.join(', ')} for ${to}` : ''}`);
    // Tower moves the departures waiting at the holding point onto the new SIDs
    const moved: string[] = [];
    for (const r of this.releases) {
      if (r.state === 'airborne') continue;
      const sid = this.mapSid(r.sid, to);
      r.rwy = to;
      if (sid && sid.name !== r.sid) {
        r.sid = sid.name;
        const spec = this.relSpecs.get(r.cs);
        if (spec) this.relSpecs.set(r.cs, { ...spec, sid: sid.name });
        moved.push(`${r.cs} ${sid.name}`);
      }
    }
    if (moved.length) this.icom('TWR', `Approach, Tower, runway ${to}: ${moved.join(', ')}`);
  }
  /** Arrivals still expecting the old runway (not established): they need a new STAR, transition or vectors. */
  needReclear(): Aircraft[] {
    // planned for the runway in use, or already for the one the supervisor has announced: fine
    const ok = new Set([this.runway.slice(0, 2), ...(this.rwyChange ? [this.rwyChange.to.slice(0, 2)] : [])]);
    return this.aircraft.filter((a) => {
      if (a.remove || a.landed || a.kind !== 'arr' || a.app?.locCap || a.state === 'unconcerned') return false;
      const r = a.app?.rwy.id ?? a.expectRwy;
      return !!r && !ok.has(r.slice(0, 2));
    });
  }
  /** The STAR legs from where the aircraft would join it: the closest leg, or the next one if it is already past it. */
  starJoin(ac: Aircraft, legs: Leg[]): Leg[] {
    let best = 0, bd = Infinity;
    legs.forEach((l, i) => { const d = dist(ac.p, l.p); if (d < bd) { bd = d; best = i; } });
    if (best < legs.length - 1 && dist(ac.p, legs[best + 1].p) < dist(legs[best].p, legs[best + 1].p)) best++;
    return legs.slice(best);
  }

  // ---------------- landing sequence, departures, corrections ----------------
  /** Set the player's landing order (arrival callsigns, first to land first). Logged for replay. */
  setSequence(order: string[]) {
    const seen = new Set<string>();
    this.sequence = order.filter((cs) => {
      if (seen.has(cs)) return false;
      seen.add(cs);
      const a = this.find(cs);
      return !!a && a.kind === 'arr' && !a.landed;
    });
    this.cmdLog.push({ t: this.t, cl: { cs: '', items: [] }, op: 'seq', seq: [...this.sequence] });
  }
  /** Replay one command-log entry (clearance, correction or sequence change). */
  replay(c: CmdEntry): boolean {
    if (c.op === 'correct') return this.correct(c.cl.cs);
    if (c.op === 'seq') { this.setSequence(c.seq ?? []); return true; }
    return this.issue(c.cl, { replay: true }).ok;
  }
  /**
   * The gap a departure could use: miles between the arrival landing just before the earliest time it could roll
   * and the next one ("Gap after QTR8125: 6.1 NM to TAY4EK"), or how far out the next arrival is then.
   */
  departureGap(cs: string): { after?: string; before?: string; nm: number | null; ok: boolean; text: string } {
    const rel = this.releases.find((r) => r.cs === cs && r.state !== 'airborne');
    const sinceRel = rel?.state === 'released' ? this.t - (rel.tReleased ?? this.t) : 0;
    const wait = Math.max(30 - sinceRel, this.runwayBusyUntil - this.t, 60 - (this.t - this.lastDepT), 0);
    const heavy = !!rel && (rel.wake === 'H' || rel.wake === 'J');
    const need = heavy ? 6 : 5;
    const occ = this.lvp ? 120 : 50;
    const order = landingOrder(this).filter((x) => !x.ac.lowPass);
    const nothing = (last: string) => ({ after: last, nm: null, ok: true, text: `After ${last}: nothing behind` });
    if (!order.length) return { nm: null, ok: true, text: 'No arrivals inbound' };
    // the first arrival it could still go in front of: one far enough out when it could roll
    let j = order.findIndex((x) => x.etaS > wait);
    if (j < 0) return nothing(order[order.length - 1].ac.cs);
    if (nmIn(order[j].ac, order[j].etaS - wait) < need) j++;
    if (j >= order.length) return nothing(order[order.length - 1].ac.cs);
    const nxt = order[j];
    if (j === 0) { const nm = nmIn(nxt.ac, nxt.etaS - wait); return { before: nxt.ac.cs, nm, ok: true, text: `Next arrival ${nxt.ac.cs}: ${nm.toFixed(1)} NM out` }; }
    const prev = order[j - 1];
    const nm = nmIn(nxt.ac, Math.max(0, nxt.etaS - prev.etaS));
    // the runway is busy for a while after the leader lands, and the next one must still be far enough out at the roll
    const ok = nmIn(nxt.ac, Math.max(0, nxt.etaS - prev.etaS - occ)) >= need;
    return { after: prev.ac.cs, before: nxt.ac.cs, nm, ok, text: `Gap after ${prev.ac.cs}: ${nm.toFixed(1)} NM to ${nxt.ac.cs}` };
  }
  /**
   * "CS, correction, disregard": within 3 s of the end of a transmission, cancel the last clearance to `cs`
   * if the pilot has not started the readback. Returns false (and says nothing) otherwise.
   */
  correct(cs: string): boolean {
    const L = this.lastAtc.get(cs);
    if (!L || !L.entry || this.t > L.t1 + 3) return false;
    const qi = this.queue.indexOf(L.entry as any);
    if (qi < 0) return false;
    this.queue.splice(qi, 1);
    this.lastAtc.delete(cs);
    this.cmdLog.push({ t: this.t, cl: { cs, items: [] }, op: 'correct' });
    const ac = this.find(cs);
    if (ac) { ac.cflSys = L.cfl; ac.hdgSys = L.hdg; ac.turnQuery = L.turnQuery; }
    const tel = ac?.tel ?? telephony(cs);
    const speech = `${tel}, correction, disregard`;
    const t0 = Math.max(this.t, this.busyUntil);
    this.busyUntil = t0 + airtime(speech) + 0.4;
    const tx = this.emitTx({ from: 'ATC', cs, text: `${cs}, correction, disregard`, speech }, t0);
    if (ac && !ac.radioFail) this.queueCall({ from: 'PILOT', cs, text: `Roger, ${cs}`, speech: `Roger, ${tel}` }, tx.t1 + this.crng.range(0.8, 1.6), undefined, true);
    this.event({ kind: 'correction', cs, comp: 'COMM', sev: 'info', text: `${cs}: last clearance cancelled ("correction, disregard")`, cost: 0 });
    return true;
  }

  // ---------------- safety nets ----------------
  /** Active safety-net alerts: STCA and loss of separation, Mode S SFL/CFL mismatch, MSAW and CLAM. Ids are stable while an alert lasts. */
  safetyNets(): SafetyNet[] { return this.nets; }
  private clamRef = new Map<string, { cfl: number; side: number }>();
  private updateNets(live: Aircraft[]) {
    const out: SafetyNet[] = [];
    const since = (id: string) => { if (!this.netSince.has(id)) this.netSince.set(id, this.t); return this.netSince.get(id)!; };
    const pair = (kind: 'STCA' | 'LOS', a: string, b: string) => {
      const A = this.find(a), B = this.find(b);
      if (!A || !B) return;
      const [x, y] = A.id < B.id ? [A, B] : [B, A];
      const id = `${kind}:${x.cs}|${y.cs}`;
      if (out.some((n) => n.id === id)) return;
      const va = this.vel(x), vb = this.vel(y);
      const rx = y.p.x - x.p.x, ry = y.p.y - x.p.y, vx = (vb.x - va.x) / 3600, vy = (vb.y - va.y) / 3600;
      const vv = vx * vx + vy * vy;
      const tc = vv > 1e-9 ? Math.min(600, Math.max(0, -(rx * vx + ry * vy) / vv)) : 0;
      out.push({ id, kind, a: x.cs, b: y.cs, nm: dist(x.p, y.p), vertFt: Math.abs(x.alt - y.alt), tCpa: Math.round(tc), cpaNm: Math.hypot(rx + vx * tc, ry + vy * tc), since: since(id) });
    };
    const losPairs = new Set<string>();
    for (const [, o] of this.ongoing) if (o.kind === 'los' && o.b) { pair('LOS', o.a, o.b); losPairs.add([o.a, o.b].sort().join('|')); }
    for (const [k, c] of this.conflicts) {
      if (!c.stca) continue;
      const [a, b] = k.slice(3).split('|');
      if (!losPairs.has([a, b].sort().join('|'))) pair('STCA', a, b);
    }
    for (const [, o] of this.ongoing) {
      if (o.kind !== 'mva') continue;
      const ac = this.find(o.a);
      if (ac) { const id = `MSAW:${ac.cs}`; out.push({ id, kind: 'MSAW', cs: ac.cs, alt: ac.alt, mva: o.extra, since: since(id) }); }
    }
    for (const a of live) {
      if (a.state !== 'assumed' || a.rules === 'VFR' || a.radioFail || !a.cflSys || a.lowPass) { this.clamRef.delete(a.cs); continue; }
      const pending = this.readbackPending(a.cs);
      const cflFt = this.ftOf(a.cflSys);
      if (!pending && (a.cleared.fl !== a.cflSys.fl || a.cleared.ft !== a.cflSys.ft)) {
        const id = `SFL:${a.cs}`;
        out.push({ id, kind: 'SFL', cs: a.cs, sfl: a.cleared, cfl: a.cflSys, since: since(id) });
      }
      // CLAM: through the cleared level by more than 300 ft, or off it by more than 300 ft after reaching it
      const dev = a.alt - cflFt;
      const side = Math.abs(dev) <= 300 ? 0 : Math.sign(dev);
      const ref = this.clamRef.get(a.cs);
      if (!ref || Math.abs(ref.cfl - cflFt) > 1 || pending) this.clamRef.set(a.cs, { cfl: cflFt, side });
      else if (ref.side !== 0 && side === 0) ref.side = 0;
      const r2 = this.clamRef.get(a.cs)!;
      if (!pending && !a.app?.gsCap && !a.app?.locCap && side !== 0 && (r2.side === 0 || side === -r2.side)) {
        const id = `CLAM:${a.cs}`;
        out.push({ id, kind: 'CLAM', cs: a.cs, alt: a.alt, cfl: a.cflSys, since: since(id) });
      }
    }
    for (const k of [...this.netSince.keys()]) if (!out.some((n) => n.id === k)) this.netSince.delete(k);
    this.nets = out;
  }

  // ---------------- spawning ----------------
  private base(spec: SpawnSpec, p: XY, alt: number, hdg: number): Aircraft {
    const perf = PERF[spec.type] ?? PERF.B738;
    const cleared = spec.level ?? this.levelFor(alt);
    return {
      id: this.nextId++, cs: spec.cs, tel: telephony(spec.cs), type: perf.type, perf, kind: spec.kind,
      rules: spec.rules ?? (spec.kind === 'vfr' || spec.kind === 'heli' ? 'VFR' : spec.kind === 'mil' ? 'OAT' : 'IFR'),
      formation: spec.formation ?? 1,
      p, alt, ias: spec.spd ?? (alt < 12000 ? Math.min(250, perf.vcruiseLow) : 280), hdg, vs: 0, gs: 250, trk: hdg,
      cleared, cflSys: cleared, tgtAlt: this.ftOf(cleared), mode: 'NAV', route: [], state: spec.silent ? 'unconcerned' : 'inbound',
      sqk: String(this.rng.int(4001, 4677)).replace(/[89]/g, '7'), label: { dx: 14, dy: -34 }, history: [{ ...p }],
      spawnT: this.t, flownNm: 0, baselineNm: 0, holdSec: 0, levelSegT: 0, levelOffs: 0, fuelKg: 0, lowSec: 0, txCount: 0, goArounds: 0,
      unfamiliar: spec.unfamiliar, recat: perf.recat,
    };
  }

  private legsFor(fixes: string[], alt?: number): Leg[] {
    return fixes.map((f) => ({ fix: f, p: this.fixP(f), min: alt ? { ft: alt } : undefined }));
  }
  fixP(id: string): XY {
    const f = this.pack.fixes.get(id);
    if (f) return f.p;
    throw new Error(`Unknown fix ${id}`);
  }

  private spawn(spec: SpawnSpec) {
    let ac: Aircraft;
    if (spec.kind === 'arr') {
      const g = this.arrivalStart(spec);
      const { star, legs } = g;
      let pos = g.pos;
      const route = g.route;
      const hdg = route.length ? bearing(pos, route[0].p) : bearing(pos, { x: 0, y: 0 });
      const handoff = spec.level ?? star.handoffLevel;
      const hft = this.ftOf(handoff);
      ac = this.base({ ...spec, level: handoff }, pos, spec.alt ?? hft + 1500, hdg);
      ac.route = route;
      ac.proc = spec.unfamiliar ? undefined : star.name;
      if (spec.unfamiliar) { ac.mode = 'HDG'; ac.hdgAssigned = hdg; }
      ac.expectRwy = this.runway;
      ac.vs = spec.alt !== undefined && Math.abs(spec.alt - hft) < 200 ? 0 : -1200;
      const est = this.estimates.find((e) => e.cs === spec.cs && e.state === 'expected');
      if (est) { est.state = 'handed'; ac.estimate = { fix: est.fix, t: est.t, xfl: est.xfl }; }
      // baseline: STAR to its end, shortest transition, IF to threshold
      const starNm = route.reduce((s, l, i) => s + dist(i === 0 ? pos! : route[i - 1].p, l.p), 0);
      const trans = this.transitionsFor(this.runway).filter((t) => !t.atcDiscretion);
      const tLen = (legs2: Leg[]) => legs2.reduce((s, l, i) => (i === 0 ? 0 : s + dist(legs2[i - 1].p, l.p)), 0);
      const best = trans.length ? Math.min(...trans.map((t) => tLen(t.legs))) : 15;
      const r = this.rwy;
      ac.baselineNm = starNm + best + distToThr(this.fixP(r.ifFix), r);
      ac.checkInAt = spec.callNow ? this.t : this.t + this.rng.int(10, 22);
      this.arrivalsSpawned++;
    } else if (spec.kind === 'dep') {
      if (!spec.released) { this.requestRelease(spec); return; }
      this.launchDeparture(spec);
      return;
    } else {
      const route = (spec.route ?? []).map((f) => ({ fix: f, p: this.fixP(f) }));
      const first = route[0]?.p ?? { x: 0, y: 0 };
      const from = spec.from ?? { brg: 270, dist: 10 };
      const p = move(first, from.brg, from.dist);
      const level = spec.level ?? { ft: 1500 };
      const altFt = spec.alt ?? this.ftOf(level);
      ac = this.base({ ...spec, level }, p, altFt, bearing(p, first));
      ac.route = route;
      if (spec.kind === 'cal') ac.lowPass = undefined;
      ac.checkInAt = spec.silent ? undefined : this.t + this.rng.int(4, 14);
      if (spec.kind === 'vfr' || spec.kind === 'heli') {
        // VFR traffic waits outside until its request is answered
        ac.mode = 'NAV';
        ac.route = [{ fix: route[0].fix, p: move(first, from.brg, 2) }];
        (ac as any)._plannedRoute = spec.route;
      }
    }
    (ac as any)._spec = spec;
    this.aircraft.push(ac);
    this.spawnLog.push({ cs: ac.cs, kind: ac.kind, t: this.t });
    if (spec.kind === 'mil' && ac.perf.fighter && !spec.silent) this.milCrossing(ac);
  }

  /** A departure gets airborne: it appears past the runway end and calls on RT. */
  private launchDeparture(spec: SpawnSpec, rel?: ReleaseReq) {
    const sid = this.pack.sids.find((s) => s.name === spec.sid && s.runways.includes(this.runway)) ?? this.mapSid(spec.sid, this.runway) ?? this.rng.pick(this.pack.sids.filter((s) => s.runways.includes(this.runway) && !s.atcDiscretion));
    const r = this.rwy;
    const lenNm = r.lengthM / 1852;
    const p = move(r.thr, r.crs, lenNm + 1.2);
    const level = rel?.lvl ?? sid.initialClimb;
    const ac = this.base({ ...spec, level, spd: spec.spd ?? (PERF[spec.type]?.vminFlap ?? 160) + 20 }, p, r.elevation + 1300, r.crs);
    ac.vs = 2000;
    ac.route = sid.legs.map((l) => ({ ...l }));
    ac.proc = sid.name;
    ac.exitFix = sid.exitFix;
    ac.xfl = { fl: 90 };
    if (rel?.hdg !== undefined) {
      ac.savedRoute = ac.route;
      ac.route = [];
      ac.mode = 'HDG';
      ac.hdgAssigned = norm360(rel.hdg + this.pack.meta.magVar);
      ac.hdgSys = ac.hdgAssigned;
    }
    ac.checkInAt = this.t + 4;
    this.departuresSpawned++;
    (ac as any)._spec = spec;
    this.aircraft.push(ac);
    this.spawnLog.push({ cs: ac.cs, kind: ac.kind, t: this.t });
  }

  /** Military fighters: MIL asks for the crossing on the intercom before the formation calls. */
  private milCrossing(ac: Aircraft) {
    const spec = (ac as any)._spec as SpawnSpec;
    const route = spec.route ?? [];
    const via = route.length ? route.join(', ') : 'the TMA';
    const step = (l: PackLevel, d: number): PackLevel => (l.fl !== undefined ? (l.fl + d / 100 >= this.tl ? { fl: l.fl + d / 100 } : { ft: (l.fl + d / 100) * 100 }) : this.levelFor(l.ft! + d));
    const lo = step(ac.cleared, -1000), hi = step(ac.cleared, 1000);
    const band: [PackLevel, PackLevel] = [lo, hi];
    const text = `Approach, MIL, request crossing for ${ac.cs}${ac.formation > 1 ? ' flight of ' + ac.formation : ''}, ${ac.type}, via ${via}, block ${levelText(lo)} to ${levelText(hi)}`;
    ac.request = { kind: 'milxing', text: `MIL crossing ${route.join('–')} ${levelText(lo)}–${levelText(hi)}`, speech: '', route, band, t: this.t };
    (ac as any)._milCheckIn = ac.checkInAt;
    ac.checkInAt = undefined;
    this.icom('MIL', text, ac.cs);
  }

  // ---------------- comms ----------------
  private emitTx(tx: Omit<Tx, 'id' | 't0' | 't1'>, t0: number): Tx {
    const dur = airtime(tx.speech);
    const full: Tx = { ...tx, id: this.txId++, t0, t1: t0 + dur };
    this.log.push(full);
    if (this.log.length > 200) this.log.shift();
    if (tx.from === 'PILOT' && tx.cs && !tx.blocked && tx.channel !== 'icom') { const a = this.find(tx.cs); if (a) a.lastCall = { text: tx.text, speech: tx.speech, t: t0 }; }
    if (tx.channel !== 'icom') { if (tx.from === 'ATC') this.atcAirtime += dur; else if (tx.from === 'PILOT') this.pilotAirtime += dur; }
    for (const f of this.onTx) f(full);
    return full;
  }
  private queueCall(tx: Omit<Tx, 'id' | 't0' | 't1'>, notBefore: number, onStart?: () => void, priority = false): object {
    const entry = priority ? { tx, notBefore, onStart, priority } : { tx, notBefore, onStart };
    // readbacks go ahead of initial calls, but stay in the order the clearances were given
    if (priority) { let i = 0; while (i < this.queue.length && this.queue[i].priority) i++; this.queue.splice(i, 0, entry); }
    else this.queue.push(entry);
    return entry;
  }
  private lastBlocked = -999;
  private pumpQueue() {
    if (this.t < this.busyUntil) return;
    const due = this.queue.filter((q) => q.notBefore <= this.t && !q.priority);
    if (due.length >= 2 && !this.queue.some((q) => q.priority) && this.t - this.lastBlocked > 90 && this.rng.chance(0.35)) {
      // two stations transmit at once: the controller hears a heterodyne
      this.lastBlocked = this.t;
      const tx = this.emitTx({ from: 'PILOT', cs: '', text: '— blocked transmission —', speech: '', blocked: true }, this.t);
      this.busyUntil = tx.t1 + 2;
      for (const q of due.slice(0, 2)) q.notBefore = this.t + this.rng.range(3, 7);
      return;
    }
    // a pilot does not start a call while another is about to read back
    const readbackDue = this.queue.some((q) => q.priority && q.notBefore > this.t && q.notBefore - this.t < 4);
    const idx = this.queue.findIndex((q) => q.notBefore <= this.t && (q.priority || !readbackDue));
    if (idx < 0) return;
    const q = this.queue.splice(idx, 1)[0];
    const tx = this.emitTx(q.tx, this.t);
    this.busyUntil = tx.t1 + 0.6;
    q.onStart?.();
  }
  sys(text: string) {
    this.emitTx({ from: 'SYS', cs: '', text, speech: '' }, this.t);
  }
  private schedule(at: number, fn: () => void) { this.pending.push({ at, fn, seq: this.seq++ }); }

  private event(e: Omit<SimEvent, 't'> & { t?: number }) {
    const ev: SimEvent = { t: e.t ?? this.t, ...e } as SimEvent;
    this.events.push(ev);
    for (const f of this.onEvent) f(ev);
  }

  private levelPhrase(ac: Aircraft) {
    const l = this.levelFor(Math.round(ac.alt / 100) * 100);
    return { text: levelText(l), speech: levelSpeech(l) };
  }

  private checkIn(ac: Aircraft) {
    if (ac.state === 'unconcerned') return;
    const atis = this.atis;
    const cl = { text: levelText(ac.cleared), speech: levelSpeech(ac.cleared) };
    const now = this.levelPhrase(ac);
    let text = '', speech = '';
    const csT = ac.cs + (ac.formation > 1 ? ` flight of ${ac.formation}` : '');
    const csS = ac.tel + (ac.formation > 1 ? ` flight of ${digits(ac.formation)}` : '');
    const spec = (ac as any)._spec as SpawnSpec;
    const back = (ac as any)._returnCall as { text: string; speech: string } | undefined;
    if (back) {
      // handed back by Tower (go-around, too high for the glide)
      (ac as any)._returnCall = undefined;
      this.queueCall({ from: 'PILOT', cs: ac.cs, text: `Liège Approach, ${ac.cs}, ${back.text}`, speech: `Liège Approach, ${ac.tel}, ${back.speech}` }, this.t, () => {
        ac.state = 'assumed'; ac.xfrUnit = undefined;
        ac.awaitingSince = this.t + 3;
        ac.repeatedCall = false;
      });
      return;
    }
    switch (ac.kind) {
      case 'arr':
        if (ac.unfamiliar) {
          text = `Liège Approach, ${ac.cs}, diverting from Brussels, ${now.text}, request vectors ILS ${this.runway}, no ATIS`;
          speech = `Liège Approach, ${ac.tel}, diverting from Brussels, ${now.speech}, request vectors I L S runway ${this.runwaySpeech(this.runway)}, we don't have the ATIS`;
          ac.request = { kind: 'vectors', text: 'Vectors ILS', speech: '', t: this.t };
        } else {
          const desc = Math.abs(ac.alt - ac.tgtAlt) > 300 ? `${now.text} descending ${cl.text}` : `${cl.text}`;
          const descS = Math.abs(ac.alt - ac.tgtAlt) > 300 ? `${now.speech} descending ${cl.speech}` : cl.speech;
          let letter = atis;
          if (this.sc.atisDrift && this.prevAtis && this.t - this.atisChangeT < 900 && this.rng.chance(0.15)) {
            letter = this.prevAtis;
            ac.atisOld = letter; ac.atisOldT = this.t;
          }
          text = `Liège Approach, ${ac.cs}, ${desc}, ${ac.proc}, information ${letter}`;
          speech = `Liège Approach, ${ac.tel}, ${descS}, ${this.procSpeech(ac.proc!)}, information ${digits(letter)}`;
        }
        break;
      case 'dep':
        {
          const onHdg = ac.mode === 'HDG' && ac.hdgAssigned !== undefined;
          const h = onHdg ? String(Math.round(norm360(ac.hdgAssigned! - this.pack.meta.magVar)) || 360).padStart(3, '0') : '';
          text = `Liège Approach, ${ac.cs}, passing ${(Math.round(ac.alt / 100) * 100).toLocaleString('en-US')} ft climbing ${cl.text}, ${onHdg ? 'heading ' + h : ac.proc}`;
          speech = `Liège Approach, ${ac.tel}, passing ${digits(Math.floor(ac.alt / 1000))} thousand ${Math.round((ac.alt % 1000) / 100) % 10 ? digits(Math.round((ac.alt % 1000) / 100) % 10) + ' hundred' : ''} climbing ${cl.speech}, ${onHdg ? 'heading ' + digits(h) : this.procSpeech(ac.proc!)}`;
        }
        if (this.rng.chance(0.35)) {
          text += ', request higher'; speech += ', request higher';
          ac.request = { kind: 'climb', level: { fl: 90 }, text: 'Higher, FL090', speech: '', t: this.t };
        }
        break;
      default: {
        const req = spec.request;
        const reqT = this.requestText(ac, spec);
        text = `Liège Approach, ${csT}, ${ac.type}, ${now.text}, ${reqT.text}`;
        speech = `Liège Approach, ${csS}, ${now.speech}, ${reqT.speech}`;
        if (req) ac.request = { kind: req.kind, text: reqT.short, speech: reqT.speech, level: req.level, fix: req.fix, route: req.route, t: this.t };
      }
    }
    this.queueCall({ from: 'PILOT', cs: ac.cs, text, speech }, this.t, () => {
      if (ac.state === 'inbound') ac.state = 'assumed';
      ac.awaitingSince = this.t + airtime(speech);
      ac.repeatedCall = false;
    });
  }

  private requestText(ac: Aircraft, spec: SpawnSpec): { text: string; speech: string; short: string } {
    const r = spec.request;
    if (!r) return { text: 'with you', speech: 'with you', short: '' };
    switch (r.kind) {
      case 'climb': return { text: `request climb ${levelText(r.level!)}`, speech: `request climb ${levelSpeech(r.level!)}`, short: `Climb ${levelText(r.level!)}` };
      case 'direct': return { text: `request direct ${r.fix}${ac.kind === 'heli' ? ', HEMS priority' : ''}`, speech: `request direct ${r.fix}${ac.kind === 'heli' ? ', hems priority flight' : ''}`, short: `Direct ${r.fix}` };
      case 'crossing': return { text: `request zone crossing via ${r.route!.join(' – ')}`, speech: `request crossing via ${r.route!.join(' and ')}`, short: `Cross ${r.route!.join('–')}` };
      case 'lowpass': return { text: `flight inspection, request ILS ${this.runway} low approaches`, speech: `flight inspection, request I L S runway ${this.runwaySpeech(this.runway)} low approaches`, short: `Low passes ILS ${this.runway}` };
      default: return { text: 'request', speech: 'request', short: r.kind };
    }
  }
  runwaySpeech(r: string) { return r.replace(/(\d+)([LRC]?)/, (_m, n, l) => `${digits(n)}${l === 'L' ? ' left' : l === 'R' ? ' right' : ''}`); }
  procSpeech(p: string) { return p.replace(/^([A-Z]+)(\d)([A-Z])$/, (_m, a, d, l) => `${a.length <= 3 ? a.split('').join(' ') : a} ${digits(d)} ${digits(l)}`); }

  // ---------------- issuing clearances ----------------
  validate(cl: Clearance): string[] {
    const ac = this.find(cl.cs);
    if (!ac) return ['No such aircraft'];
    const w: string[] = [];
    if (ac.state === 'inbound') w.push('Not on your frequency yet');
    if (ac.state === 'transferred') w.push('Already transferred');
    if (ac.state === 'unconcerned') w.push('Not your traffic');
    const pf = ac.perf;
    const dthr = distToThr(ac.p, this.rwy);
    for (const it of cl.items) {
      if (it.k === 'lvl') {
        const ftv = this.ftOf(it.lvl);
        const mva = this.mvaAt(ac.p);
        const onFinal = ac.app?.locCap || cl.items.some((x) => x.k === 'app');
        if (ftv < mva - 1 && !onFinal && ac.rules !== 'VFR') w.push(`Below MVA ${mva}`);
        for (const o of this.aircraft) {
          if (o === ac || o.remove || o.state !== 'assumed' || o.rules === 'VFR') continue;
          if (Math.abs(this.ftOf(o.cleared) - ftv) < 500 && dist(o.p, ac.p) < 6 && Math.abs(o.alt - ftv) < 2000) { w.push(`Same level as ${o.cs}, ${dist(o.p, ac.p).toFixed(1)} NM`); break; }
        }
        if (it.lvl.fl !== undefined && it.lvl.fl < this.tl) w.push(`FL below transition level FL${String(this.tl).padStart(3, '0')}`);
        if (ac.cleared.fl === it.lvl.fl && ac.cleared.ft === it.lvl.ft && !ac.wrong && ac.awaitingSince === undefined) w.push(`Already cleared to ${levelText(it.lvl)}`);
      }
      if (it.k === 'spd') {
        const established = ac.app?.locCap || dthr < 15;
        if (it.spd < pf.vapp) w.push(`Below approach speed ${pf.vapp}`);
        else if (it.spd < pf.vminClean && !established) w.push(`Below min clean ${pf.vminClean}`);
        if (it.spd > 250 && ac.alt < 10000) w.push('Above 250 kt below FL100');
      }
      if (it.k === 'app') {
        const r = this.pack.runways.get(it.rwy);
        if (!r) { w.push('Unknown runway'); continue; }
        if (it.rwy !== this.runway) w.push(`Runway in use is ${this.runway}`);
        if (it.app === 'ILS' && !r.ils) w.push(`No ILS on ${it.rwy}`);
        if (it.app === 'ILS' && this.ilsOut.has(it.rwy)) w.push(`ILS ${it.rwy} out of service`);
        if (this.lvp && (it.app !== 'ILS' || r.ils?.cat !== 'III')) w.push('Below minima in LVP');
        const hdgItem = cl.items.find((x) => x.k === 'hdg') as { hdg: number } | undefined;
        const trk = hdgItem ? norm360(hdgItem.hdg + this.pack.meta.magVar) : ac.mode === 'HDG' && ac.hdgAssigned !== undefined ? ac.hdgAssigned : ac.trk;
        const d = distToThr(ac.p, r);
        const ang = Math.abs(angDiff(r.crs, trk));
        const xt = Math.abs(crossTrack(ac.p, r.thr, r.crs));
        if (!ac.app?.locCap && (ac.mode === 'HDG' || hdgItem)) {
          if (d < 6 || d > 28) w.push('Poor intercept geometry');
          else if (ang > 45) w.push(`Intercept angle ${Math.round(ang)}°, more than 45°`);
          else if (ang < 15 && xt > locWindowNm(d)) w.push(`Intercept angle ${Math.round(ang)}°, less than 15°`);
        }
      }
      if (it.k === 'xfr' && it.unit === 'TWR' && !(ac.app?.locCap)) w.push('Not established on final');
      if (it.k === 'xfr' && it.unit === 'MIL' && ac.kind !== 'mil') w.push('MIL only takes military traffic');
      if (it.k === 'hold') {
        const h = this.pack.holds.find((x) => x.fix === it.fix);
        const lv = (cl.items.find((x) => x.k === 'lvl') as { lvl: Level } | undefined)?.lvl ?? ac.cleared;
        if (h && this.ftOf(lv) > this.ftOf(h.max) + 50) w.push(`Above the ${h.fix} holding maximum ${levelText(h.max)}`);
        if (h && this.ftOf(lv) < this.ftOf(h.min) - 50) w.push(`Below the ${h.fix} holding minimum ${levelText(h.min)}`);
      }
      if (it.k === 'brk' && !ac.app) w.push('No approach clearance to cancel');
      if (it.k === 'star') {
        const st = this.pack.stars.find((x) => x.name === it.name);
        if (!st) w.push(`Unknown STAR ${it.name}`);
        else if (!st.runways.includes(this.runway)) w.push(`${it.name} is not for runway ${this.runway}`);
        if (ac.kind !== 'arr') w.push('STARs are for arrivals');
      }
      if (it.k === 'dct' && !this.pack.fixes.has(it.fix)) w.push(`Unknown fix ${it.fix}`);
      if (it.k === 'hdg') {
        const target = norm360(it.hdg + this.pack.meta.magVar);
        const turn = it.dir ? turnAmount(ac.hdg, target, it.dir) : 0;
        if (turn > 180.5) w.push(`${it.dir === 'L' ? 'Left' : 'Right'} turn of ${Math.round(turn / 5) * 5}°`);
        const look = move(ac.p, target, 6);
        for (const tsa of this.pack.tsas) {
          if (this.tsaOn.has(tsa.name) && pointInPolygon(look, tsa.poly) && ac.alt >= this.ftOf(tsa.floor) && ac.alt <= this.ftOf(tsa.ceiling)) w.push(`Heading into active ${tsa.name}`);
          else if (this.tsaPending.has(tsa.name) && pointInPolygon(look, tsa.poly) && ac.alt >= this.ftOf(tsa.floor) && ac.alt <= this.ftOf(tsa.ceiling)) w.push(`Heading into ${tsa.name}, active from ${hhmmOf(this.utc(this.tsaPending.get(tsa.name)!))}`);
        }
      }
    }
    return w;
  }

  /** Issue a clearance at the current sim time. Deterministic given seed + command log. */
  issue(cl: Clearance, opts: { replay?: boolean } = {}): IssueResult {
    // departure release: answered to Tower on the intercom
    const relIt = cl.items.find((i) => i.k === 'rel' || i.k === 'relhold') as Extract<Item, { k: 'rel' | 'relhold' }> | undefined;
    if (relIt) {
      const r = this.releases.find((x) => x.cs === cl.cs && x.state !== 'airborne');
      if (!r) return { ok: false, warnings: [`No release request for ${cl.cs}`] };
      this.cmdLog.push({ t: this.t, cl: JSON.parse(JSON.stringify(cl)) });
      this.answerRelease(r, relIt, cl.items);
      return { ok: true, warnings: [] };
    }
    // Brussels coordination request (early transfer): answered on the intercom
    const creq = this.coordReqs.find((r) => r.cs === cl.cs && r.state === 'pending');
    if (creq && cl.items.length && cl.items.every((i) => i.k === 'appr' || i.k === 'deny')) {
      this.cmdLog.push({ t: this.t, cl: JSON.parse(JSON.stringify(cl)) });
      this.answerCoord(creq, cl.items[0].k === 'appr');
      return { ok: true, warnings: [] };
    }
    const target = this.find(cl.cs);
    if (!target || !cl.items.length) return { ok: false, warnings: ['Nothing to send'] };
    // military crossing request: answered to MIL on the intercom
    if (target.request?.kind === 'milxing' && target.state === 'inbound' && cl.items.every((i) => i.k === 'appr' || i.k === 'deny')) {
      this.cmdLog.push({ t: this.t, cl: JSON.parse(JSON.stringify(cl)) });
      this.answerMil(target, cl.items[0].k === 'appr');
      return { ok: true, warnings: [] };
    }
    const warnings = this.validate(cl);
    this.cmdLog.push({ t: this.t, cl: JSON.parse(JSON.stringify(cl)) });
    this.clearancesSent++;
    if (warnings.length) { this.warningsSent++; this.event({ kind: 'warning_sent', cs: cl.cs, comp: 'SPP', sev: 'minor', text: `${cl.cs}: sent with "${warnings[0]}"`, cost: 6 }); }
    // routing traffic into a military area after MIL has announced it is a coordination error
    if (target.state === 'assumed' && target.kind !== 'mil') {
      const into = this.tsaOnPath(target, cl.items);
      if (into) this.event({ kind: 'tsa_routed', cs: cl.cs, comp: 'CORD', sev: 'minor', text: `${cl.cs}: routed into ${tsaSpoken(into)} after the military notice`, cost: 15 });
    }

    const ctx = this.phraseCtx(target, cl);
    const ph = phraseology(cl, ctx);
    const t0 = Math.max(this.t, this.busyUntil);
    const dur = airtime(ph.speech);
    this.busyUntil = t0 + dur + 0.4;
    const tx = this.emitTx({ from: 'ATC', cs: cl.cs, text: ph.text, speech: ph.speech }, t0);
    const undo: { t1: number; entry?: object; cfl?: PackLevel; hdg?: number; turnQuery?: Aircraft['turnQuery'] } = { t1: tx.t1, cfl: target.cflSys, hdg: target.hdgSys, turnQuery: target.turnQuery };
    this.lastAtc.set(cl.cs, undo);
    const wasCalling = target.awaitingSince !== undefined;
    target.txCount++;
    (target as any)._lastAtcT = t0;
    const isAck = (i: Item) => i.k === 'roger' || i.k === 'standby';
    if (cl.items.some((i) => i.k === 'standby')) target.standbyT = t0;

    // response time to a waiting caller
    if (target.awaitingSince !== undefined) {
      this.responseTimes.push(Math.max(0, t0 - target.awaitingSince));
      target.awaitingSince = undefined;
    }
    // catching a wrong readback: re-issuing the same kind of item
    if (target.wrong && cl.items.some((i) => i.k === target.wrong!.item.k)) {
      this.event({ kind: 'readback_caught', cs: target.cs, comp: 'COMM', sev: 'good', text: `${target.cs}: wrong readback caught`, cost: 0 });
      target.wrong = undefined;
    }
    // catching a callsign confusion: talking to the aircraft that took the wrong call
    const confused = (target as any)._confusedT as number | undefined;
    if (confused !== undefined) {
      this.event({ kind: 'readback_caught', cs: target.cs, comp: 'COMM', sev: 'good', text: `${target.cs}: callsign confusion caught`, cost: 0 });
      (target as any)._confusedT = undefined;
    }
    // emergency response time
    const em = this.emergencies.find((e) => e.cs === target.cs && e.firstClrT === undefined);
    if (em) em.firstClrT = t0;

    if (target.radioFail) return { ok: true, warnings };
    // "say again": the pilot repeats the last call (a readback is repeated as a readback)
    if (cl.items.some((i) => i.k === 'sayagain') && cl.items.every((i) => i.k === 'sayagain' || isAck(i))) {
      const last = target.lastCall;
      if (last) {
        const again = last.text.startsWith('Say again') ? { text: `${target.cs}, go ahead`, speech: `${target.tel}, go ahead` } : last;
        undo.entry = this.queueCall({ from: 'PILOT', cs: target.cs, text: again.text, speech: again.speech }, tx.t1 + this.crng.range(0.8, 1.8) * (1 + 0.35 * this.fatigue()), () => {
          if (wasCalling) target.awaitingSince = this.t + airtime(again.speech);
        }, true);
      }
      return { ok: true, warnings };
    }
    // "roger" and "standby" need no readback: nothing more happens unless other instructions came with them
    if (cl.items.every(isAck)) return { ok: true, warnings };

    // The controller's input updates the system flight plan (label CFL, AHDG) regardless of what the pilot does.
    for (const it of cl.items) {
      if (it.k === 'lvl') target.cflSys = it.lvl;
      if (it.k === 'hdg') target.hdgSys = norm360(it.hdg + this.pack.meta.magVar);
      if (it.k === 'dct' || it.k === 'trans' || it.k === 'ron' || it.k === 'hold' || it.k === 'app') target.hdgSys = it.k === 'app' ? target.hdgSys : undefined;
    }
    // Occasionally a pilot misses the call entirely (more often when the crew is tired).
    const fat = this.fatigue();
    if (!target.radioFail && !this.forceWrong.has(target.cs) && !this.sc.noSayAgain && this.rng.chance((target.unfamiliar ? 0.06 : 0.03) * (1 + fat))) {
      undo.entry = this.queueCall({ from: 'PILOT', cs: target.cs, text: `Say again for ${target.cs}`, speech: `Say again for ${target.tel}` }, tx.t1 + this.rng.range(1, 2), () => { target.awaitingSince = this.t + 2; }, true);
      return { ok: true, warnings };
    }

    // what the controller said is now known to the crew
    if (ctx.qnhSay) target.qnhGiven = true;
    if (ctx.vectorFor) target.vecInfo = true;
    const holdIt = cl.items.find((i) => i.k === 'hold');
    if (holdIt) { target.efc = ctx.efc ? (ctx as any)._efcT : undefined; (target as any)._efcFix = (holdIt as { fix: string }).fix; target.efcCalled = false; target.holdMaxCalled = false; }

    // Who actually answers? Similar callsigns cause confusion.
    let ac = target;
    if (this.sc.confusion) {
      const twin = this.aircraft.find((o) => o !== target && !o.remove && o.state === 'assumed' && similar(o.cs, target.cs));
      if (twin && this.rng.chance(0.22)) {
        ac = twin;
        (twin as any)._confusedT = this.t;
        (twin as any)._confusedFor = target.cs;
      }
    }

    // pilot checks: unable items
    const unable: Item[] = [];
    const accepted: Item[] = [];
    for (const it of cl.items) {
      if (isAck(it)) continue;
      const why = this.unableReason(ac, it);
      if (why) unable.push(it); else accepted.push(it);
    }
    // A turn of more than 200° is queried once ("confirm left turn heading 130?"); said again, it is flown.
    let query: { text: string; speech: string } | undefined;
    const qi = accepted.findIndex((i) => i.k === 'hdg' && !!i.dir && turnAmount(ac.hdg, norm360(i.hdg + this.pack.meta.magVar), i.dir) > 200);
    if (qi >= 0 && ac === target) {
      const h = accepted[qi] as Extract<Item, { k: 'hdg' }>;
      const q = ac.turnQuery;
      if (q && q.hdg === h.hdg && q.dir === h.dir) ac.turnQuery = undefined;
      else {
        accepted.splice(qi, 1);
        ac.turnQuery = { hdg: h.hdg, dir: h.dir!, t: this.t };
        const hh = String(Math.round(h.hdg) % 360 || 360).padStart(3, '0');
        const side = h.dir === 'L' ? 'left' : 'right';
        query = { text: `confirm ${side} turn heading ${hh}?`, speech: `confirm ${side} turn heading ${digits(hh)}?` };
      }
    } else if (ac.turnQuery && accepted.some((i) => i.k === 'hdg' || i.k === 'dct' || i.k === 'trans' || i.k === 'hold')) ac.turnQuery = undefined;
    // wrong readback (only when the right aircraft answers)
    let wrong: { idx: number; item: Item } | undefined;
    if (ac === target && !ac.radioFail) {
      const rate = this.sc.readbackErr * (ac.unfamiliar ? 3 : 1) * (1 + fat);
      const idx = accepted.findIndex((i) => i.k === 'lvl' || i.k === 'hdg');
      if (idx >= 0 && (this.forceWrong.delete(ac.cs) || this.rng.chance(rate))) {
        const it = accepted[idx];
        let bad: Item = it;
        if (it.k === 'lvl') {
          bad = it.lvl.fl !== undefined ? { k: 'lvl', lvl: { fl: it.lvl.fl + (this.rng.chance(0.5) ? 10 : -10) } } : { k: 'lvl', lvl: { ft: it.lvl.ft! + (this.rng.chance(0.5) ? 1000 : -1000) } };
        } else if (it.k === 'hdg') {
          bad = { ...it, hdg: norm360(it.hdg + (this.rng.chance(0.5) ? 20 : -20)) || 360 };
        }
        wrong = { idx, item: bad };
      }
    }
    const rb = readback(ac.cs, accepted, { ...ctx, alt: ac.alt, vectorFor: undefined }, wrong);
    const unableTxt = unable.map((u) => this.unableReason(ac, u)!).join(', ');
    let rbText = accepted.length ? rb.text : `${ac.cs}`;
    let rbSpeech = accepted.length ? rb.speech : ac.tel;
    if (query) {
      rbText = accepted.length ? `${rb.text.slice(0, -(ac.cs.length + 2))}, ${query.text.replace(/\?$/, '')}, ${ac.cs}?` : `${ac.cs}, ${query.text}`;
      rbSpeech = accepted.length ? `${rb.speech.slice(0, -(ac.tel.length + 2))}, ${query.speech.replace(/\?$/, '')}, ${ac.tel}?` : `${ac.tel}, ${query.speech}`;
    }
    if (unable.length) { rbText = `unable ${unableTxt}, ` + rbText; rbSpeech = `unable ${unableTxt}, ` + rbSpeech; }
    const delay = this.rng.range(0.8, 2.0) * (1 + 0.35 * fat);
    const applied = wrong ? accepted.map((it, i) => (i === wrong!.idx ? wrong!.item : it)) : accepted;
    undo.entry = this.queueCall({ from: 'PILOT', cs: ac.cs, text: rbText, speech: rbSpeech }, tx.t1 + delay, () => {
      this.apply(ac, applied, target);
      if (wrong) ac.wrong = { item: wrong.item, t: this.t, issuedT: t0 };
      if (query) ac.awaitingSince = this.t + airtime(rbSpeech);
    }, true);
    return { ok: true, warnings };
  }

  /** Context for the controller's phraseology: QNH, speed verbs, vectoring, position, EFC, request answers. */
  /** What the controller would say for this clearance, without sending it (for the composer preview). */
  previewPhrase(cl: Clearance): { text: string; speech: string } | undefined {
    const rel = cl.items.find((i) => i.k === 'rel' || i.k === 'relhold');
    if (rel) return releasePhrase(cl.cs, rel as Extract<Item, { k: 'rel' | 'relhold' }>);
    const ac = this.find(cl.cs);
    return ac && cl.items.length ? phraseology(cl, this.phraseCtx(ac, cl)) : undefined;
  }
  private phraseCtx(ac: Aircraft, cl: Clearance): Ctx {
    const has = (k: Item['k']) => cl.items.some((i) => i.k === k);
    const rwyUse = this.pack.runways.get(ac.expectRwy ?? this.runway) ?? this.rwy;
    const ctx: Ctx = {
      alt: ac.alt, qnh: this.qnh, hdgMag: norm360(ac.hdg - this.pack.meta.magVar), request: ac.request?.text, ias: ac.ias, atis: this.atis,
      cleared: ac.cleared, firstCall: ac.txCount === 0,
      qnhSay: !ac.qnhGiven && cl.items.some((i) => i.k === 'lvl' && i.lvl.ft !== undefined),
    };
    if (ac.kind === 'arr' && !ac.vecInfo && !ac.app && has('hdg') && !has('app')) ctx.vectorFor = { app: rwyUse.ils && !this.ilsOut.has(rwyUse.id) ? 'ILS' : 'RNP', rwy: rwyUse.id };
    const appIt = cl.items.find((i) => i.k === 'app') as { rwy: string } | undefined;
    if (appIt && !ac.app?.locCap && (ac.mode === 'HDG' || has('hdg'))) {
      const r = this.pack.runways.get(appIt.rwy);
      const d = r ? distToThr(ac.p, r) : -1;
      if (d >= 3 && d <= 30) ctx.posNm = d;
    }
    const starIt = cl.items.find((i) => i.k === 'star') as { name: string } | undefined;
    if (starIt) {
      const st = this.pack.stars.find((x) => x.name === starIt.name);
      const nr = st ? (st.runways.includes(this.runway) ? this.runway : st.runways[0]) : undefined;
      const cur = ac.app?.rwy.id ?? ac.expectRwy;
      if (nr && cur && cur !== nr && nr === this.runway) { const r = this.pack.runways.get(nr); ctx.starChange = { rwy: nr, app: r?.ils && !this.ilsOut.has(nr) ? 'ILS' : 'RNP' }; }
    }
    const holdIt = cl.items.find((i) => i.k === 'hold') as { fix: string } | undefined;
    if (holdIt) {
      const e = this.efcFor(ac, holdIt.fix);
      ctx.efc = e.say;
      (ctx as any)._efcT = e.t;
    }
    if (ac.request) {
      const r = ac.request;
      const vfr = ac.rules === 'VFR';
      const route = r.route ?? ((ac as any)._plannedRoute as string[] | undefined);
      let sqk: string | undefined;
      if (r.kind === 'crossing' && vfr && has('appr')) sqk = (ac as any)._xsqk ?? ((ac as any)._xsqk = `70${ac.id % 8}${(ac.id * 3 + 1) % 8}`);
      const vr = route ? this.pack.vfrRoutes.find((v) => v.points.join() === route.join()) : undefined;
      ctx.req = { kind: r.kind, route, vfr, sqk, alt: vr?.alt ?? 1500, fix: r.fix, level: r.level };
    }
    return ctx;
  }

  /**
   * Expected approach clearance time for a new holder: when the sequence has a slot for it, plus 2.5 min per
   * aircraft already holding at that fix. "No delay expected" only when nobody else holds there and a slot is free now.
   */
  efcFor(ac: Aircraft, fix: string): { t: number; say: string | null } {
    const ahead = this.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && ((o.mode === 'HOLD' && o.hold?.fix === fix) || (o as any)._holdAt === fix || ((o as any)._efcFix === fix && this.readbackPending(o.cs)))).length;
    let wait = 0;
    if (ac.kind === 'arr') {
      try { wait = slotFor(this, ac, bestTransition(this, ac)).waitS; } catch { wait = 0; }
    }
    if (ahead === 0 && wait < 60) return { t: this.t + 300, say: null };
    const t = Math.ceil((this.t + Math.max(wait, ahead * 150, 120)) / 60) * 60;
    return { t, say: this.utc(t).slice(0, 5).replace(':', '') };
  }

  private answerMil(ac: Aircraft, yes: boolean) {
    const r = ac.request!;
    ac.request = undefined;
    this.responseTimes.push(Math.max(0, this.t - r.t));
    if (yes) {
      const b = r.band;
      this.icom('ATC', `${ac.cs} crossing approved${r.route?.length ? ' via ' + r.route.join(', ') : ''}, ${b ? `block ${levelText(b[0])} to ${levelText(b[1])}` : levelText(ac.cleared)}, call me on 119.280`, ac.cs);
      this.icom('MIL', `Approved, ${ac.cs} will call you`, ac.cs);
      ac.checkInAt = this.t + this.rng.int(15, 40);
    } else {
      this.icom('ATC', `${ac.cs} unable, due traffic, remain outside the TMA`, ac.cs);
      this.icom('MIL', `Copied, ${ac.cs} remains outside`, ac.cs);
      ac.state = 'unconcerned';
      ac.mode = 'HDG'; ac.hdgAssigned = norm360(ac.hdg + 180);
      this.schedule(this.t + 300, () => { ac.remove = true; });
    }
  }

  private unableReason(ac: Aircraft, it: Item): string | undefined {
    const pf = ac.perf;
    if (it.k === 'spd') {
      const established = ac.app?.locCap || distToThr(ac.p, this.rwy) < 15;
      if (it.spd < pf.vapp) return `speed ${it.spd}`;
      if (it.spd < pf.vminClean && !established) return `${it.spd} knots, minimum clean ${pf.vminClean}`;
    }
    if (it.k === 'app') {
      const r = this.pack.runways.get(it.rwy);
      if (!r) return 'approach, say again runway';
      if (it.app === 'ILS' && (!r.ils || this.ilsOut.has(it.rwy))) return `ILS ${it.rwy}, localizer not available`;
      if (this.lvp && (it.app !== 'ILS' || r.ils?.cat !== 'III')) return 'approach, below minima';
      if (it.app === 'VIS' && (this.weather.visM < 5000 || (this.weather.ceilingFt ?? 9999) < 2500)) return 'visual, not in sight';
    }
    if (it.k === 'dct' && !this.pack.fixes.has(it.fix)) return `direct ${it.fix}, not in database`;
    if (it.k === 'trans' && !this.pack.transitions.find((t) => t.name === it.name)) return `${it.name}, not in database`;
    if (it.k === 'hold' && !this.pack.fixes.has(it.fix)) return `hold ${it.fix}`;
    if (it.k === 'star' && !this.pack.stars.some((s) => s.name === it.name)) return `${it.name}, not in database`;
    return undefined;
  }

  /** Apply accepted items to the aircraft that read back. */
  private apply(ac: Aircraft, items: Item[], intended: Aircraft) {
    const mv = this.pack.meta.magVar;
    const hasApp = items.some((i) => i.k === 'app');
    for (const it of items) {
      switch (it.k) {
        case 'hdg':
          if (ac.mode === 'NAV' && ac.route.length) ac.savedRoute = ac.route.map((l) => ({ ...l }));
          ac.mode = ac.mode === 'LOC' && hasApp ? 'LOC' : 'HDG';
          if (ac.mode === 'HDG' && ac.app?.locCap && !hasApp) ac.app = undefined;
          ac.hdgAssigned = norm360(it.hdg + mv);
          ac.turnDir = it.dir;
          ac.hold = undefined;
          if (ac.app && !hasApp && !ac.app.locCap) { /* keep armed approach */ }
          break;
        case 'dct': {
          const idx = ac.route.findIndex((l) => l.fix === it.fix);
          if (idx >= 0) ac.route = ac.route.slice(idx);
          else {
            const sIdx = ac.savedRoute?.findIndex((l) => l.fix === it.fix) ?? -1;
            ac.route = sIdx >= 0 ? ac.savedRoute!.slice(sIdx) : [{ fix: it.fix, p: this.fixP(it.fix) }];
          }
          ac.mode = 'NAV'; ac.hold = undefined; ac.turnDir = undefined;
          if (ac.app?.locCap) ac.app = undefined;
          break;
        }
        case 'trans': {
          const tr = this.pack.transitions.find((t) => t.name === it.name)!;
          const legs = tr.legs.map((l) => ({ ...l }));
          const alhIdx = ac.route.findIndex((l) => l.fix === legs[0].fix);
          ac.route = alhIdx >= 0 ? [...ac.route.slice(0, alhIdx), ...legs] : legs.slice(dist(ac.p, legs[0].p) < 2 ? 1 : 0);
          ac.proc = tr.name; ac.mode = 'NAV'; ac.hold = undefined; ac.turnDir = undefined;
          ac.expectRwy = tr.runways[0];
          break;
        }
        case 'star': {
          const st = this.pack.stars.find((x) => x.name === it.name)!;
          ac.route = this.starJoin(ac, st.legs).map((l) => ({ ...l }));
          ac.proc = st.name; ac.mode = 'NAV'; ac.hold = undefined; ac.turnDir = undefined; ac.savedRoute = undefined;
          (ac as any)._holdAt = undefined;
          ac.expectRwy = st.runways.includes(this.runway) ? this.runway : st.runways[0];
          if (ac.app && !ac.app.locCap) ac.app = undefined;
          break;
        }
        case 'ron':
          if (ac.savedRoute?.length) {
            // rejoin at the first saved fix that is ahead of the aircraft
            let best = 0, bestD = Infinity;
            ac.savedRoute.forEach((l, i) => { const d = dist(ac.p, l.p) + i * 0.01; if (d < bestD) { bestD = d; best = i; } });
            ac.route = ac.savedRoute.slice(best);
            ac.mode = 'NAV'; ac.hold = undefined;
          }
          break;
        case 'hold':
          ac.route = [{ fix: it.fix, p: this.fixP(it.fix) }];
          ac.mode = 'NAV';
          (ac as any)._holdAt = it.fix;
          break;
        case 'lvl':
          ac.cleared = it.lvl;
          ac.tgtAlt = this.ftOf(it.lvl);
          break;
        case 'spd': ac.spdAssigned = it.spd; ac.spdUntil = it.until; ac.spdMin = false; break;
        case 'spdmin': ac.spdMin = true; ac.spdAssigned = undefined; ac.spdUntil = undefined; break;
        case 'spdres': ac.spdMin = false; ac.spdAssigned = undefined; ac.spdUntil = undefined; break;
        case 'app': {
          const r = this.pack.runways.get(it.rwy)!;
          ac.app = { type: it.app, rwy: r, locCap: false, gsCap: false };
          ac.expectRwy = it.rwy;
          if (ac.mode === 'HOLD') { ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg; ac.hold = undefined; }
          if (ac.request?.kind === 'vectors' || ac.request?.kind === 'approach') ac.request = undefined;
          break;
        }
        case 'sqk': ac.sqk = it.code; break;
        case 'brk':
          if (ac.app) { ac.app = undefined; ac.stable4 = undefined; }
          if (ac.mode === 'LOC') { ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg; }
          if (ac.request?.kind === 'vectors') ac.request = undefined;
          break;
        case 'atis':
          if (ac.atisOld) { this.event({ kind: 'atis_corrected', cs: ac.cs, comp: 'COMM', sev: 'good', text: `${ac.cs}: old ATIS corrected`, cost: 0 }); ac.atisOld = undefined; }
          break;
        case 'rel': case 'relhold': case 'sayagain': break;
        case 'appr': this.answerRequest(ac, true); break;
        case 'deny': this.answerRequest(ac, false); break;
        case 'xfr':
          ac.state = 'transferred'; ac.xfrUnit = it.unit; ac.awaitingSince = undefined; ac.request = undefined;
          if (it.unit === 'TWR' && ac.app) ac.twrXfrDist = distToThr(ac.p, ac.app.rwy);
          if (it.unit === 'TWR' && ac.app && ac.twrXfrDist! < 4) this.event({ kind: 'late_xfr', cs: ac.cs, comp: 'CORD', sev: 'minor', text: `${ac.cs}: transferred to Tower late (${ac.twrXfrDist!.toFixed(1)} NM)`, cost: 12 });
          if (it.unit !== 'TWR') this.onOutboundTransfer(ac);
          break;
      }
    }
    // Implicit request answers
    if (ac.request) {
      if (ac.request.kind === 'climb' && items.some((i) => i.k === 'lvl')) ac.request = undefined;
      else if (ac.request.kind === 'vectors' && items.some((i) => i.k === 'hdg' || i.k === 'dct')) ac.request = undefined;
      else if (ac.request.kind === 'deviate' && items.some((i) => i.k === 'hdg')) ac.request = undefined;
      else if (ac.request.kind === 'direct' && items.some((i) => i.k === 'dct')) ac.request = undefined;
    }
  }

  private answerRequest(ac: Aircraft, yes: boolean) {
    const r = ac.request;
    if (!r) return;
    ac.request = undefined;
    if (!yes) {
      if (r.kind === 'crossing') { ac.mode = 'ORBIT'; this.schedule(this.t + (ac.rules === 'VFR' ? 300 : 150), () => { if (!ac.remove && ac.mode === 'ORBIT') { ac.request = { ...r, t: this.t }; this.queueCall({ from: 'PILOT', cs: ac.cs, text: `${ac.cs}, still waiting, request crossing`, speech: `${ac.tel}, still waiting, request crossing` }, this.t, () => { ac.awaitingSince = this.t + 3; }); } }); }
      return;
    }
    switch (r.kind) {
      case 'climb': ac.cleared = r.level!; ac.cflSys = r.level!; ac.tgtAlt = this.ftOf(r.level!); break;
      case 'direct': this.apply(ac, [{ k: 'dct', fix: r.fix! }], ac); break;
      case 'crossing': {
        const pts = r.route ?? ((ac as any)._plannedRoute as string[]);
        ac.route = pts.map((f) => ({ fix: f, p: this.fixP(f) }));
        ac.mode = 'NAV';
        if ((ac as any)._xsqk) ac.sqk = (ac as any)._xsqk;
        break;
      }
      case 'deviate': ac.mode = 'HDG'; ac.hdgAssigned = norm360(r.hdg! + this.pack.meta.magVar); break;
      case 'lowpass': {
        const rw = this.rwy;
        ac.lowPass = { rwy: rw.id, passes: 0, max: 3 };
        ac.app = { type: 'ILS', rwy: rw, locCap: false, gsCap: false };
        const p13 = move(rw.thr, rw.crs + 180, 13);
        ac.route = [{ fix: 'FINAL13', p: p13 }];
        ac.mode = 'NAV';
        ac.cleared = ac.cflSys = { ft: 3000 }; ac.tgtAlt = 3000;
        break;
      }
      default: break;
    }
  }

  private onOutboundTransfer(ac: Aircraft) {
    if (ac.kind === 'dep') {
      this.departuresHandled++;
      const xfl = ac.xfl ?? { fl: 90 };
      const cfl = ac.cflSys ?? ac.cleared;
      if (this.ftOf(cfl) < this.ftOf(xfl) - 50) this.event({ kind: 'xfr_level', cs: ac.cs, comp: 'CORD', sev: 'minor', text: `${ac.cs}: transferred cleared to ${levelText(cfl)}, agreed level ${levelText(xfl)}`, cost: 15 });
      const inConflict = [...this.conflicts.keys()].some((k) => k.slice(3).split('|').includes(ac.cs)) || [...this.ongoing.values()].some((o) => o.kind === 'los' && (o.a === ac.cs || o.b === ac.cs));
      if (inConflict) this.event({ kind: 'xfr_conflict', cs: ac.cs, comp: 'CORD', sev: 'major', text: `${ac.cs}: transferred to the next sector in conflict`, cost: 30 });
      const flow = this.flows.find((f) => f.exitFix === ac.exitFix);
      const prevCs = this.lastXfr.get(ac.exitFix ?? '');
      if (flow && prevCs) {
        const prev = this.find(prevCs);
        if (prev && dist(prev.p, ac.p) < flow.mit - 0.5) this.event({ kind: 'flow', cs: ac.cs, cs2: prevCs, comp: 'CORD', sev: 'minor', text: `${ac.cs}: ${dist(prev.p, ac.p).toFixed(1)} NM behind ${prevCs}, flow requires ${flow.mit} NM`, cost: 15 });
      }
      this.lastXfr.set(ac.exitFix ?? '', ac.cs);
      this.schedule(this.t + 25, () => { if (!ac.remove) { ac.cleared = { fl: 150 }; ac.tgtAlt = this.ftOf({ fl: 150 }); ac.spdAssigned = undefined; } });
    }
    if (ac.kind === 'mil') {
      // MIL (or the next unit) gives the requested climb
      const want = ((ac as any)._spec as SpawnSpec | undefined)?.request?.level;
      if (want) this.schedule(this.t + 20, () => { if (!ac.remove) { ac.cleared = want; ac.tgtAlt = this.ftOf(want); } });
    }
  }

  // ---------------- pilot world callbacks ----------------
  onRouteEnd(ac: Aircraft, last: Leg) {
    if (last.fix === '__LOSTCOMM__') {
      const tr = this.transitionsFor(this.runway).find((t) => !t.atcDiscretion)!;
      const alh = this.fixP('ALHUV');
      ac.route = dist(ac.p, alh) > 3 ? [{ fix: 'ALHUV', p: alh }, ...tr.legs.slice(1).map((l) => ({ ...l }))] : tr.legs.slice(1).map((l) => ({ ...l }));
      ac.mode = 'NAV';
      ac.app = { type: 'ILS', rwy: this.rwy, locCap: false, gsCap: false };
      ac.cleared = ac.cflSys = { ft: 3000 }; ac.tgtAlt = 3000;
      return;
    }
    const holdAt = (ac as any)._holdAt as string | undefined;
    if (holdAt && holdAt === last.fix) { (ac as any)._holdAt = undefined; startHold(ac, this, last.fix, last.p); return; }
    if (ac.kind === 'cal' && ac.lowPass && last.fix === 'FINAL13') { ac.mode = 'HDG'; ac.hdgAssigned = ac.app!.rwy.crs; return; }
    if (ac.kind === 'arr') {
      if (ac.app) { ac.mode = 'HDG'; ac.hdgAssigned = ac.app.rwy.crs; return; }
      if (this.pack.holds.some((h) => h.fix === last.fix) && ac.proc && this.pack.stars.some((s) => s.name === ac.proc)) {
        startHold(ac, this, last.fix, last.p);
        if (ac.state === 'assumed' && !ac.radioFail) this.pilotSays(ac, `${ac.cs}, entering hold at ${last.fix}, request onward clearance`, `${ac.tel}, entering the hold at ${last.fix}, request onward clearance`);
        return;
      }
      const r = this.pack.runways.get(ac.expectRwy ?? this.runway);
      ac.mode = 'HDG'; ac.hdgAssigned = r && last.fix === r.ifFix ? r.crs : ac.hdg;
      if (ac.state === 'assumed' && !ac.radioFail) this.pilotSays(ac, `${ac.cs}, ${last.fix}, request approach clearance`, `${ac.tel}, ${last.fix}, request approach clearance`);
      return;
    }
    if (ac.kind === 'vfr' || ac.kind === 'heli') {
      const planned = (ac as any)._plannedRoute as string[] | undefined;
      if (ac.request) { ac.mode = 'ORBIT'; return; }
      if (planned && last.fix === planned[planned.length - 1]) {
        if (ac.state === 'assumed') this.pilotSays(ac, `${ac.cs}, leaving the zone, switching to en-route`, `${ac.tel}, leaving the zone, switching`, false);
        ac.state = 'unconcerned';
        ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg;
        this.schedule(this.t + 240, () => { ac.remove = true; });
        return;
      }
      ac.mode = 'ORBIT';
      return;
    }
    ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg;
  }

  private pilotSays(ac: Aircraft, text: string, speech: string, awaits = true) {
    this.queueCall({ from: 'PILOT', cs: ac.cs, text, speech }, this.t, () => { if (awaits) ac.awaitingSince = this.t + airtime(speech); });
  }

  goAround(ac: Aircraft, reason: string) {
    const r = ac.app!.rwy;
    if (reason === 'lowpass') {
      ac.lowPass!.passes++;
      const up = move(r.thr, r.crs, 5), dw = move(up, r.crs - 90, 5), dw2 = move(dw, r.crs + 180, 15);
      ac.app = { type: 'ILS', rwy: r, locCap: false, gsCap: false };
      ac.cleared = ac.cflSys = { ft: 3000 }; ac.tgtAlt = 3000;
      ac.stable4 = undefined;
      if (ac.lowPass!.passes >= ac.lowPass!.max) {
        ac.app = undefined; ac.lowPass = undefined;
        ac.route = [{ fix: 'UP', p: up }, { fix: 'LNO', p: this.fixP('LNO') }];
        ac.mode = 'NAV';
        this.pilotSays(ac, `${ac.cs}, inspection complete, request climb FL080 and transfer`, `${ac.tel}, inspection complete, request climb flight level eight zero`);
        ac.request = { kind: 'climb', level: { fl: 80 }, text: 'Climb FL080', speech: '', t: this.t };
        ac.kind = 'ovf';
      } else {
        ac.route = [{ fix: 'UP', p: up }, { fix: 'DW', p: dw }, { fix: 'DW2', p: dw2 }, { fix: 'FINAL13', p: move(r.thr, r.crs + 180, 13) }];
        ac.mode = 'NAV';
      }
      return;
    }
    ac.goArounds++;
    const withTwr = ac.state === 'transferred' && ac.xfrUnit === 'TWR';
    const missed = r.missed.map((f) => ({ fix: f, p: this.fixP(f), min: { ft: 3000 } }));
    ac.route = missed;
    ac.mode = 'NAV';
    (ac as any)._holdAt = r.missed[r.missed.length - 1];
    ac.app = undefined;
    ac.cleared = ac.cflSys = { ft: 3000 }; ac.tgtAlt = 3000;
    ac.spdAssigned = undefined; ac.spdUntil = undefined; ac.stable4 = undefined;
    const why: Record<string, string> = { unstable: 'unstable approach', noclearance: 'no landing clearance', occupied: 'runway occupied', forced: 'instructed by Tower' };
    const cost = reason === 'unstable' ? 35 : reason === 'noclearance' ? 40 : reason === 'forced' ? 0 : 30;
    const comp: Comp = reason === 'unstable' ? 'TRAF' : reason === 'noclearance' ? 'CORD' : reason === 'forced' ? 'NONR' : 'SEPC';
    this.event({ kind: 'goaround', cs: ac.cs, comp, sev: reason === 'forced' ? 'info' : 'major', text: `${ac.cs}: go-around, ${why[reason] ?? reason}`, cost });
    if (withTwr && !ac.radioFail) {
      // Tower tells Approach on the intercom; the crew calls on 119.280 once they are settled in the climb
      this.icom('TWR', `Approach, Tower, ${ac.cs} going around, ${reason === 'forced' ? 'runway occupied' : why[reason] ?? reason}, climbing 3,000 ft on the missed approach`, ac.cs);
      ac.state = 'inbound';
      (ac as any)._returnCall = { text: 'going around, climbing 3,000 ft', speech: 'going around, climbing altitude three thousand feet' };
      ac.checkInAt = this.t + this.rng.int(20, 40);
      return;
    }
    ac.state = 'assumed';
    if (!ac.radioFail) this.pilotSays(ac, `Liège Approach, ${ac.cs}, going around, ${why[reason]}, climbing 3,000 ft`, `Liège Approach, ${ac.tel}, going around, ${why[reason]}, climbing altitude three thousand feet`);
  }

  onCannotIntercept(ac: Aircraft) {
    if (ac.radioFail || ac.lowPass || ac.state !== 'assumed' || ac.request) return;
    const text = 'unable to intercept the localizer on this heading, request vectors';
    ac.request = { kind: 'vectors', text: 'Vectors, cannot intercept', speech: '', t: this.t };
    this.pilotSays(ac, `${ac.cs}, ${text}`, `${ac.tel}, ${text}`);
  }

  onTooHigh(ac: Aircraft) {
    if (ac.radioFail || ac.lowPass) return;
    const text = 'too high, unable to capture the glide, request vectors';
    const req = { kind: 'vectors' as const, text: 'Vectors, too high for the glide', speech: '', t: this.t };
    if (ac.state === 'transferred' && ac.xfrUnit === 'TWR') {
      this.icom('TWR', `Approach, Tower, ${ac.cs} too high for the glide, wants vectors, sending back to you`, ac.cs);
      ac.state = 'inbound';
      (ac as any)._returnCall = { text, speech: text };
      ac.checkInAt = this.t + this.rng.int(8, 15);
      ac.request = req;
    } else if (ac.state === 'assumed') {
      this.pilotSays(ac, `${ac.cs}, ${text}`, `${ac.tel}, ${text}`);
      ac.request = req;
    }
  }

  onTouchdown(ac: Aircraft, r: Runway) {
    ac.landed = true; ac.remove = true;
    if (this.sequence.includes(ac.cs)) this.sequence = this.sequence.filter((x) => x !== ac.cs);
    (this as any)._lowLanded = ((this as any)._lowLanded ?? 0) + ac.lowSec;
    this.runwayBusyUntil = this.t + (this.lvp ? 120 : 50);
    // Spacing pairs consecutive landings on this runway: this aircraft's distance out when the previous one touched down.
    const prev = this.lastLanding.get(r.id);
    if (prev && prev.cs !== ac.cs) {
      const gap = prev.behind.get(ac.cs) ?? (((this.t - prev.t) * ac.perf.vapp) / 3600);
      if (gap < 15) this.spacing.push({ leader: prev.cs, follower: ac.cs, gap, min: wakeMinNm(prev.recat, ac.perf.recat, 2.5), t: this.t, rwy: r.id });
    }
    const behind = new Map<string, number>();
    for (const o of this.aircraft) {
      if (o === ac || o.remove || !o.app?.locCap || o.app.rwy.id !== r.id || o.lowPass) continue;
      const d = distToThr(o.p, r);
      if (d > 0) behind.set(o.cs, d);
    }
    this.lastLanding.set(r.id, { cs: ac.cs, t: this.t, recat: ac.perf.recat, behind });
    const em = this.emergencies.find((e) => e.cs === ac.cs);
    if (em) em.landedT = this.t;
    this.landings.push({ cs: ac.cs, type: ac.type, t: this.t, spawnT: ac.spawnT, flownNm: ac.flownNm, baselineNm: ac.baselineNm, holdSec: ac.holdSec, levelOffs: ac.levelOffs, fuelKg: ac.fuelKg, emergency: ac.emergency, goArounds: ac.goArounds });
    this.event({ kind: 'landed', cs: ac.cs, comp: 'TRAF', sev: 'info', text: `${ac.cs} landed ${r.id}`, cost: 0 });
    if (ac.emergency) this.event({ kind: 'emer_landed', cs: ac.cs, comp: 'NONR', sev: 'good', text: `${ac.cs}: emergency aircraft landed`, cost: 0 });
  }

  // ---------------- per-aircraft checks ----------------
  private afterStep(ac: Aircraft) {
    const t = this.t;
    const spec = (ac as any)._spec as SpawnSpec | undefined;
    // emergencies
    if (spec?.emergency && !ac.emergency && t - ac.spawnT >= spec.emergency.after && ac.state === 'assumed') this.declareEmergency(ac, spec.emergency.type);
    // freighter crews like shortcuts: an occasional request for direct ALHUV while still on the STAR
    if (ac.kind === 'arr' && ac.state === 'assumed' && !ac.request && !ac.app && !ac.radioFail && !(ac as any)._askedDct && ac.mode === 'NAV' && ac.route.length > 1 && ac.route[ac.route.length - 1].fix === 'ALHUV' && t - ac.spawnT > 70 && ac.awaitingSince === undefined) {
      if (this.rng.chance(0.004)) {
        (ac as any)._askedDct = true;
        this.queueCall({ from: 'PILOT', cs: ac.cs, text: `${ac.cs}, request direct ALHUV`, speech: `${ac.tel}, request direct ALHUV` }, t, () => {
          if (ac.app || ac.route[ac.route.length - 1]?.fix !== 'ALHUV') return;
          ac.request = { kind: 'direct', fix: 'ALHUV', text: 'Direct ALHUV', speech: '', t: this.t };
          ac.awaitingSince = this.t + 3;
        });
      }
    }
    // tower-initiated go-around (scenario)
    if (spec?.goAroundAt && ac.app?.locCap && !(ac as any)._gaDone && distToThr(ac.p, ac.app.rwy) < spec.goAroundAt) { (ac as any)._gaDone = true; this.goAround(ac, 'forced'); return; }
    // wrong readback not caught within 30 s
    if (ac.wrong && t - ac.wrong.t > 30) {
      this.event({ kind: 'readback_missed', cs: ac.cs, comp: 'COMM', sev: 'major', text: `${ac.cs}: wrong readback missed (${ac.wrong.item.k === 'lvl' ? levelText((ac.wrong.item as any).lvl) : 'heading ' + (ac.wrong.item as any).hdg})`, cost: 40 });
      ac.wrong = undefined;
    }
    const conf = (ac as any)._confusedT as number | undefined;
    if (conf !== undefined && t - conf > 30) {
      this.event({ kind: 'readback_missed', cs: ac.cs, comp: 'COMM', sev: 'major', text: `${ac.cs}: took a clearance meant for ${(ac as any)._confusedFor}, not caught`, cost: 45 });
      (ac as any)._confusedT = undefined;
    }
    // unanswered calls: the pilot repeats after 25 s of free frequency (not wall time)
    if (ac.awaitingSince === undefined) ac.waitFree = 0;
    else if (t >= ac.awaitingSince && !this.freqBusy() && !this.queue.some((q) => q.notBefore <= t)) ac.waitFree = (ac.waitFree ?? 0) + 1;
    if (ac.awaitingSince !== undefined && (ac.waitFree ?? 0) > 25 && !ac.repeatedCall && ac.state === 'assumed') {
      ac.repeatedCall = true;
      this.event({ kind: 'unanswered', cs: ac.cs, comp: 'WORK', sev: 'minor', text: `${ac.cs}: call unanswered for 25 s`, cost: 10 });
      this.queueCall({ from: 'PILOT', cs: ac.cs, text: `Liège Approach, ${ac.cs}, how do you read?`, speech: `Liège Approach, ${ac.tel}, how do you read?` }, t);
    }
    // "standby" with nothing after it: the pilot calls again about 45 s later
    if (ac.standbyT !== undefined && t - ac.standbyT >= 45) {
      const spoken = ((ac as any)._lastAtcT ?? -1) > ac.standbyT;
      if (!spoken && ac.state === 'assumed' && !ac.radioFail && ac.awaitingSince === undefined && !this.readbackPending(ac.cs)) {
        const rq = ac.request?.text;
        this.pilotSays(ac, `Liège Approach, ${ac.cs}, standing by${rq ? `, ${rq.toLowerCase()}` : ''}`, `Liège Approach, ${ac.tel}, standing by${rq && ac.request?.speech ? `, ${ac.request.speech}` : ''}`);
      }
      ac.standbyT = undefined;
    }
    // holding discipline: published maximum, EFC
    if (ac.mode === 'HOLD' && ac.hold && ac.state === 'assumed' && !ac.radioFail) {
      const h = this.pack.holds.find((x) => x.fix === ac.hold!.fix);
      if (h && !ac.holdMaxCalled && this.ftOf(ac.cleared) > this.ftOf(h.max) + 50) {
        ac.holdMaxCalled = true;
        this.pilotSays(ac, `${ac.cs}, request lower, maximum holding altitude ${levelText(h.max)}`, `${ac.tel}, request lower, maximum holding ${levelSpeech(h.max)}`);
      }
      if (ac.efc !== undefined && t >= ac.efc && !ac.efcCalled && ac.awaitingSince === undefined) {
        ac.efcCalled = true;
        this.pilotSays(ac, `${ac.cs}, EFC time, request onward clearance`, `${ac.tel}, E F C time, request onward clearance`);
      }
    }
    if (ac.efc !== undefined && ac.mode !== 'HOLD' && !(ac as any)._holdAt && !this.readbackPending(ac.cs)) ac.efc = undefined;
    // old ATIS not corrected
    if (ac.atisOld && ac.atisOldT !== undefined && t - ac.atisOldT > 90) {
      this.event({ kind: 'atis_missed', cs: ac.cs, comp: 'COMM', sev: 'minor', text: `${ac.cs}: reported information ${ac.atisOld}, not corrected`, cost: 8 });
      ac.atisOld = undefined;
    }
    // MIL waiting for an answer to a crossing request
    if (ac.request?.kind === 'milxing' && ac.state === 'inbound' && t - ac.request.t === 120) {
      this.icom('MIL', `Approach, MIL, still waiting on the crossing for ${ac.cs}`, ac.cs);
      this.event({ kind: 'mil_delay', cs: ac.cs, comp: 'CORD', sev: 'minor', text: `${ac.cs}: MIL crossing request unanswered for 2 minutes`, cost: 10 });
    }
    // speed limit below FL100
    if (ac.state === 'assumed' && ac.kind !== 'mil' && ac.alt < 9800 && ac.ias > 262 && !(ac as any)._spdEv) {
      (ac as any)._spdHi = ((ac as any)._spdHi ?? 0) + 1;
      if ((ac as any)._spdHi > 20) { (ac as any)._spdEv = true; this.event({ kind: 'speed_limit', cs: ac.cs, comp: 'SPP', sev: 'minor', text: `${ac.cs}: above 250 kt below FL100`, cost: 8 }); }
    }
    // sector exit / removal
    const r = Math.hypot(ac.p.x, ac.p.y);
    const R = this.pack.meta.sectorRadiusNm;
    if (r < R) (ac as any)._wasInside = true;
    if (r > R + 2 && (ac as any)._wasInside && ac.state === 'assumed' && (ac.kind === 'dep' || ac.kind === 'ovf' || ac.kind === 'mil' || ac.kind === 'cal')) {
      this.event({ kind: 'exit_unxfr', cs: ac.cs, comp: 'CORD', sev: 'major', text: `${ac.cs}: left the sector without a transfer`, cost: 30 });
      ac.state = 'transferred';
      if (ac.kind === 'dep') this.departuresHandled++;
    }
    if (ac.state === 'assumed' && ac.kind === 'dep' && ac.alt > this.ftOf(this.pack.sectorCeiling) + 300 && !(ac as any)._ceilEv) {
      (ac as any)._ceilEv = true;
      this.event({ kind: 'airspace', cs: ac.cs, comp: 'CORD', sev: 'minor', text: `${ac.cs}: climbed above the sector ceiling before transfer`, cost: 10 });
    }
    if ((ac.state === 'transferred' || ac.state === 'unconcerned') && (r > R + 8 || ac.alt > 14000)) ac.remove = true;
    if (r > R + 25) ac.remove = true;
  }

  private declareEmergency(ac: Aircraft, type: 'engine' | 'smoke' | 'radio') {
    ac.emergency = type;
    ac.emergencyT = this.t;
    ac.emergencyText = EMERGENCY_TEXT[type];
    this.emergencies.push({ cs: ac.cs, type, t0: this.t });
    this.event({ kind: 'emer', cs: ac.cs, comp: 'NONR', sev: 'info', text: `${ac.cs}: ${type === 'radio' ? 'radio failure (7600)' : `MAYDAY (7700), ${ac.emergencyText!.toLowerCase()}`}`, cost: 0 });
    if (type === 'radio') {
      ac.sqk = '7600'; ac.radioFail = true; ac.lostCommT = this.t;
      if (ac.mode !== 'HDG') this.onRouteEnd(ac, { fix: '__LOSTCOMM__', p: ac.p });
      return;
    }
    ac.sqk = '7700';
    const rw = this.runway;
    const what = (ac.emergencyText ?? '').toLowerCase();
    const text = type === 'engine'
      ? `MAYDAY MAYDAY MAYDAY, Liège Approach, ${ac.cs}, ${what}, request immediate return runway ${rw}`
      : `MAYDAY MAYDAY MAYDAY, Liège Approach, ${ac.cs}, ${what}, request immediate descent and landing nearest runway`;
    const speech = type === 'engine'
      ? `Mayday mayday mayday, Liège Approach, ${ac.tel}, ${what}, request immediate return runway ${this.runwaySpeech(rw)}`
      : `Mayday mayday mayday, Liège Approach, ${ac.tel}, ${what}, request immediate descent and landing nearest runway`;
    if (type === 'engine') { const cap = Math.min(ac.tgtAlt, Math.max(3000, Math.round(ac.alt / 100) * 100)); ac.tgtAlt = cap; ac.cleared = ac.cflSys = this.levelFor(cap); }
    if (ac.kind === 'dep') { ac.kind = 'arr'; ac.expectRwy = rw; ac.baselineNm = ac.flownNm + 20; this.departuresSpawned--; this.arrivalsSpawned++; }
    this.queueCall({ from: 'PILOT', cs: ac.cs, text, speech, emergency: true }, this.t, () => { ac.awaitingSince = this.t + airtime(speech); }, true);
  }

  // ---------------- scenario events ----------------
  private runEvent(e: Scenario['events'][number]) {
    switch (e.kind) {
      case 'tsa':
        if (e.on) this.tsaOn.add(e.name); else this.tsaOn.delete(e.name);
        this.tsaPending.delete(e.name);
        this.sys(`${e.name} ${e.on ? 'ACTIVE' : 'released'} (military)`);
        if (!e.on) this.icom('MIL', `Liège, MIL, ${tsaSpoken(e.name)} released`);
        break;
      case 'wind':
        this.setWeather({ ...this.weather, windDir: e.dir, windKt: e.kt, gustKt: e.gust });
        break;
      case 'runway':
        if (e.notice) { if (!this.rwyChange) this.announceRunwayChange(e.rwy, e.notice, 'scheduled', this.tailwind() > 0 ? this.tailwind() : undefined); }
        else this.changeRunway(e.rwy);
        break;
      case 'ils':
        if (!e.ok) {
          this.ilsOut.add(e.rwy);
          this.sys(`ILS ${e.rwy} OUT OF SERVICE`);
          for (const ac of this.aircraft) {
            if (ac.app?.type === 'ILS' && ac.app.rwy.id === e.rwy && !ac.lowPass) {
              const d = distToThr(ac.p, ac.app.rwy);
              if (ac.app.locCap && d < 6) this.goAround(ac, 'unstable');
              else {
                ac.app = undefined; if (ac.mode === 'LOC') { ac.mode = 'HDG'; ac.hdgAssigned = ac.hdg; }
                if (ac.state === 'assumed') this.pilotSays(ac, `${ac.cs}, localizer unreliable, request vectors`, `${ac.tel}, localizer unreliable, request vectors`);
              }
            }
          }
        } else { this.ilsOut.delete(e.rwy); this.sys(`ILS ${e.rwy} back in service`); }
        this.atisIdx++;
        break;
      case 'lvp':
        this.setWeather({ ...this.weather, visM: e.vis ?? (e.on ? 400 : 6000), rvrM: e.on ? e.rvr ?? 350 : undefined, ceilingFt: e.on ? e.ceiling ?? 100 : 1500, wx: e.on ? 'FG' : undefined });
        break;
      case 'flow':
        this.flows.push({ exitFix: e.exitFix, mit: e.mit });
        this.sys(e.text);
        break;
      case 'note':
        this.sys(e.text);
        break;
    }
  }

  setWeather(w: Omit<Weather, 'raw'> & { raw?: string }, quiet = false) {
    const hh = this.utc().slice(0, 5).replace(':', '');
    const raw = buildMetar(this.pack.meta.icao, w, '12' + hh);
    this.weather = { ...w, raw };
    this.qnh = w.qnh;
    this.tl = transitionLevel(this.qnh, this.pack.meta.transitionAltitude);
    const was = this.lvp;
    this.lvp = isLvp(this.weather);
    this.atisIdx++;
    if (!quiet) this.sys(`New weather, ATIS ${this.atis}: ${raw}`);
    if (this.lvp !== was) this.sys(this.lvp ? 'LOW VISIBILITY PROCEDURES IN FORCE' : 'Low visibility procedures cancelled');
    this.windCheck();
  }

  private moveStorms(dt: number) {
    for (const s of this.storms) { s.p.x += (s.vx * dt) / 3600; s.p.y += (s.vy * dt) / 3600; }
    if (!this.storms.length) return;
    for (const ac of this.aircraft) {
      if (ac.remove || ac.state !== 'assumed' || ac.rules === 'VFR' || ac.alt < 1500 || ac.app?.locCap || ac.radioFail) continue;
      const inside = this.storms.some((s) => dist(ac.p, s.p) < s.r);
      if (inside && !ac.stormInside) this.event({ kind: 'cb', cs: ac.cs, comp: 'SEPC', sev: 'major', text: `${ac.cs}: flew into a thunderstorm cell`, cost: 35 });
      ac.stormInside = inside;
      if (!inside && !ac.request) {
        const ahead = [3, 6, 9].map((d) => move(ac.p, ac.trk, d));
        const cell = this.storms.find((s) => ahead.some((a) => dist(a, s.p) < s.r));
        if (cell && this.t - ((ac as any)._devT ?? -999) > 120) {
          (ac as any)._devT = this.t;
          const side = crossTrack(cell.p, ac.p, ac.trk) > 0 ? -1 : 1;
          const hdgMag = Math.round(norm360(ac.hdg - this.pack.meta.magVar + side * 30) / 5) * 5 || 360;
          ac.request = { kind: 'deviate', hdg: hdgMag, text: `Deviate HDG ${String(hdgMag).padStart(3, '0')}`, speech: '', t: this.t };
          this.pilotSays(ac, `${ac.cs}, weather ahead, request heading ${String(hdgMag).padStart(3, '0')} to avoid`, `${ac.tel}, weather ahead, request heading ${digits(String(hdgMag).padStart(3, '0'))} to avoid`);
        }
      }
    }
  }

  // ---------------- monitoring ----------------
  private key(a: Aircraft, b: Aircraft) { return a.id < b.id ? `${a.cs}|${b.cs}` : `${b.cs}|${a.cs}`; }

  private openOrUpdate(key: string, kind: string, a: string, b: string | undefined, worst: number, worst2 = 0, extra?: any) {
    const o = this.ongoing.get(key);
    if (!o) this.ongoing.set(key, { kind, t0: this.t, worst, worst2, a, b, extra });
    else { o.worst = Math.min(o.worst, worst); o.worst2 = Math.min(o.worst2, worst2); }
  }
  private closeOngoing(key: string) {
    const o = this.ongoing.get(key);
    if (!o) return;
    this.ongoing.delete(key);
    const dur = this.t - o.t0;
    switch (o.kind) {
      case 'los': {
        const lat = o.worst, vert = o.worst2, min = o.extra as number;
        const ratio = lat / min;
        const sev = lat < 1.5 && vert < 500 ? 'serious' : ratio < 0.9 ? 'major' : 'minor';
        this.event({ t: o.t0, kind: 'los', cs: o.a, cs2: o.b, comp: 'SEPC', sev, value: lat, text: `Loss of separation ${o.a} / ${o.b}: ${lat.toFixed(1)} NM, ${Math.round(vert)} ft`, cost: sev === 'serious' ? 150 : sev === 'major' ? 100 : 45 });
        break;
      }
      case 'wake':
        this.event({ t: o.t0, kind: 'wake', cs: o.a, cs2: o.b, comp: 'SEPC', sev: o.extra - o.worst > 0.7 ? 'major' : 'minor', value: o.worst, text: `Wake: ${o.a} ${o.worst.toFixed(1)} NM behind ${o.b}, minimum ${o.extra} NM`, cost: o.extra - o.worst > 0.7 ? 45 : 25 });
        break;
      case 'mva':
        if (dur >= 5) this.event({ t: o.t0, kind: 'mva', cs: o.a, comp: 'SEPC', sev: o.extra - o.worst > 300 ? 'major' : 'minor', value: o.worst, text: `${o.a}: below MVA ${o.extra} ft (${Math.round(o.worst)} ft) for ${dur} s`, cost: o.extra - o.worst > 300 ? 70 : 35 });
        break;
      case 'tsa':
        this.event({ t: o.t0, kind: 'tsa', cs: o.a, comp: 'CORD', sev: 'major', text: `${o.a}: entered active ${o.extra} for ${dur} s`, cost: 40 });
        break;
    }
  }

  private monitor() {
    const t = this.t;
    const live = this.aircraft.filter((a) => !a.remove && !a.landed);
    const seen = new Set<string>();
    const sepOf = (a: Aircraft) => a.rules !== 'VFR';
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (!sepOf(a) || !sepOf(b)) continue;
        if (a.state === 'unconcerned' && b.state === 'unconcerned') continue;
        const near = (x: Aircraft) => Math.hypot(x.p.x, x.p.y) < 4 && x.alt < 1500 && !x.app?.locCap;
        if (near(a) || near(b)) continue;
        const k = this.key(a, b);
        const lat = dist(a.p, b.p);
        const vert = Math.abs(a.alt - b.alt);
        const sameFinal = a.app?.locCap && b.app?.locCap && a.app.rwy.id === b.app.rwy.id && Math.min(distToThr(a.p, a.app.rwy), distToThr(b.p, b.app.rwy)) < 10;
        const latMin = sameFinal ? 2.5 : 3;
        if (lat < latMin - 0.02 && vert < EPS_VERT) { seen.add('los:' + k); this.openOrUpdate('los:' + k, 'los', a.cs, b.cs, lat, vert, latMin); }
        // prediction (MTCD-like 120 s) and STCA (60 s)
        if (lat < 25 && !sameFinal) {
          const pred = this.predict(a, b, 120);
          const pk = 'cf:' + k;
          if (pred.tMin !== undefined) {
            if (!this.conflicts.has(pk)) this.conflicts.set(pk, { t, stca: false });
            const c = this.conflicts.get(pk)!;
            if (pred.tMin <= 60 && !c.stca && !(lat < latMin && vert < EPS_VERT)) {
              c.stca = true;
              this.event({ kind: 'stca', cs: a.cs, cs2: b.cs, comp: 'SITU', sev: 'minor', text: `STCA ${a.cs} / ${b.cs}`, cost: 15 });
            }
          } else if (this.conflicts.has(pk)) {
            const c = this.conflicts.get(pk)!;
            this.conflicts.delete(pk);
            // credit only a conflict the player actually solved: an instruction to either aircraft after it was predicted
            const solvedByPlayer = this.cmdLog.some((x) => (x.cl.cs === a.cs || x.cl.cs === b.cs) && x.t >= c.t - 10 && x.cl.items.some((i) => i.k === 'hdg' || i.k === 'lvl' || i.k === 'spd' || i.k === 'dct' || i.k === 'hold' || i.k === 'spdmin'));
            if (!c.stca && solvedByPlayer) this.event({ kind: 'conflict_solved', cs: a.cs, cs2: b.cs, comp: 'SITU', sev: 'good', text: `Conflict ${a.cs} / ${b.cs} resolved before STCA`, cost: 0 });
          }
        }
        // wake on a common final
        if (a.app?.locCap && b.app?.locCap && a.app.rwy.id === b.app.rwy.id) {
          const da = distToThr(a.p, a.app.rwy), db = distToThr(b.p, b.app.rwy);
          const [lead, foll] = da < db ? [a, b] : [b, a];
          const gap = Math.abs(db - da);
          const min = wakeMinNm(lead.perf.recat, foll.perf.recat, 2.5);
          if (min > (sameFinal ? 2.5 : 3) && gap < min - 0.05 && Math.max(da, db) < 12) {
            const wk = 'wk:' + k;
            seen.add(wk);
            this.openOrUpdate(wk, 'wake', foll.cs, lead.cs, gap, 0, min);
          }
        }
      }
      // MVA on vectors
      if (a.rules !== 'VFR' && a.state === 'assumed' && !a.app?.locCap && (a.mode === 'HDG' || a.mode === 'ORBIT') && Math.hypot(a.p.x, a.p.y) > 3) {
        const mva = this.mvaAt(a.p);
        if (a.alt < mva - 60) { seen.add('mva:' + a.cs); this.openOrUpdate('mva:' + a.cs, 'mva', a.cs, undefined, a.alt, 0, mva); }
      }
      // TSA
      if (a.kind !== 'mil' && a.state === 'assumed') {
        for (const tsa of this.pack.tsas) {
          if (!this.tsaOn.has(tsa.name)) continue;
          if (pointInPolygon(a.p, tsa.poly) && a.alt >= this.ftOf(tsa.floor) && a.alt <= this.ftOf(tsa.ceiling)) { seen.add('tsa:' + a.cs + tsa.name); this.openOrUpdate('tsa:' + a.cs + tsa.name, 'tsa', a.cs, undefined, 0, 0, tsa.name); }
        }
      }
    }
    // holding stack: two aircraft in the same hold less than 1,000 ft apart
    const holding = live.filter((a) => a.mode === 'HOLD' && a.hold && a.hold.phase !== 'entry');
    for (let i = 0; i < holding.length; i++) {
      for (let j = i + 1; j < holding.length; j++) {
        const a = holding[i], b = holding[j];
        if (a.hold!.fix !== b.hold!.fix || Math.abs(a.alt - b.alt) >= EPS_VERT || dist(a.p, b.p) > 8) continue;
        const k = 'stack:' + this.key(a, b);
        if (this.stackSeen.has(k)) continue;
        this.stackSeen.add(k);
        this.event({ kind: 'stack', cs: a.cs, cs2: b.cs, comp: 'SEPC', sev: 'major', value: Math.abs(a.alt - b.alt), text: `Holding stack ${a.hold!.fix}: ${a.cs} / ${b.cs} only ${Math.round(Math.abs(a.alt - b.alt))} ft apart`, cost: 100 });
      }
    }
    for (const k of [...this.ongoing.keys()]) if (!seen.has(k)) this.closeOngoing(k);
    this.updateNets(live);
    // drop stale predicted conflicts for aircraft that are gone
    for (const k of [...this.conflicts.keys()]) {
      const [x, y] = k.slice(3).split('|');
      if (!this.find(x) || !this.find(y)) this.conflicts.delete(k);
    }
  }

  /** Linear prediction with level-off at cleared levels. Returns first time separation is lost. */
  predict(a: Aircraft, b: Aircraft, horizon: number): { tMin?: number } {
    const va = this.vel(a), vb = this.vel(b);
    for (let s = 5; s <= horizon; s += 5) {
      const pa = { x: a.p.x + (va.x * s) / 3600, y: a.p.y + (va.y * s) / 3600 };
      const pb = { x: b.p.x + (vb.x * s) / 3600, y: b.p.y + (vb.y * s) / 3600 };
      const aa = this.altAt(a, s), ab = this.altAt(b, s);
      if (dist(pa, pb) < 3 && Math.abs(aa - ab) < EPS_VERT) return { tMin: s };
    }
    return {};
  }
  private vel(a: Aircraft) { return { x: Math.sin((a.trk * Math.PI) / 180) * a.gs, y: Math.cos((a.trk * Math.PI) / 180) * a.gs }; }
  private altAt(a: Aircraft, s: number) {
    const target = a.app?.gsCap ? a.app.rwy.elevation : a.tgtAlt;
    const na = a.alt + (a.vs * s) / 60;
    return a.vs > 0 ? Math.min(na, Math.max(a.alt, target)) : a.vs < 0 ? Math.max(na, Math.min(a.alt, target)) : a.alt;
  }

  // ---------------- views for the UI ----------------
  /** Active STCA and loss-of-separation pairs, for the scope. */
  alerts(): { a: string; b: string; kind: 'stca' | 'los' }[] {
    const out: { a: string; b: string; kind: 'stca' | 'los' }[] = [];
    for (const [k, c] of this.conflicts) if (c.stca) { const [a, b] = k.slice(3).split('|'); out.push({ a, b, kind: 'stca' }); }
    for (const [k, o] of this.ongoing) if (o.kind === 'los') out.push({ a: o.a, b: o.b!, kind: 'los' });
    return out;
  }
  /** Active minimum-vectoring-altitude busts and TSA infringements, by callsign. */
  warningsFor(cs: string): string[] {
    const w: string[] = [];
    for (const [k, o] of this.ongoing) { if (o.a === cs && o.kind === 'mva') w.push('MSAW'); if (o.a === cs && o.kind === 'tsa') w.push('TSA'); }
    return w;
  }
  dthr(ac: Aircraft) { return distToThr(ac.p, ac.app?.rwy ?? this.pack.runways.get(ac.expectRwy ?? this.runway)!); }
  glide(ac: Aircraft) { const r = ac.app?.rwy ?? this.rwy; return glideAlt(r, distToThr(ac.p, r)); }
  /** Estimated minutes to touchdown along a plausible path. */
  eta(ac: Aircraft): number {
    const r = this.pack.runways.get(ac.expectRwy ?? this.runway) ?? this.rwy;
    let d: number;
    if (ac.app?.locCap) d = distToThr(ac.p, r);
    else if (ac.mode === 'NAV' && ac.route.length) {
      d = dist(ac.p, ac.route[0].p) + ac.route.slice(1).reduce((s, l, i) => s + dist(ac.route[i].p, l.p), 0);
      const end = ac.route[ac.route.length - 1];
      d += end.fix === r.ifFix ? distToThr(end.p, r) : dist(end.p, r.thr) + 14;
    } else {
      const dd = dist(ac.p, r.thr);
      const along = alongTrack(ac.p, r.thr, r.crs + 180);
      d = along > 8 ? dd + 2 : dd + 16;
    }
    const v = Math.max(140, Math.min(ac.gs, 260));
    return (d / v) * 60;
  }
}

/** Degrees turned from `from` to `to` (both true) going in direction `dir`. */
export const turnAmount = (from: number, to: number, dir: 'L' | 'R') => (dir === 'R' ? norm360(to - from) : norm360(from - to));

export function similar(a: string, b: string) {
  if (a === b) return false;
  const pa = a.match(/^([A-Z]+)(\d+)/), pb = b.match(/^([A-Z]+)(\d+)/);
  if (!pa || !pb) return false;
  if (pa[1] === pb[1]) return pa[2].slice(0, 2) === pb[2].slice(0, 2) || pa[2].split('').sort().join('') === pb[2].split('').sort().join('');
  return pa[2] === pb[2] && pa[1].slice(0, 2) === pb[1].slice(0, 2);
}

export { mergeItem, unitName };
