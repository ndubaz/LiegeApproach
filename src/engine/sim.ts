import { alongTrack, angDiff, bearing, crossTrack, dist, move, norm360, pointInPolygon, type XY } from '../geo';
import { levelToFt, mvaAt, type Leg, type Level, type Pack, type Runway } from '../pack/load';
import { airtime, levelSpeech, levelText, mergeItem, phraseology, readback, releasePhrase, telephony, unitName, digits, type Clearance, type Ctx, type Item } from './clearance';
import { PERF, wakeMinNm } from './perf';
import { distToThr, glideAlt, startHold, stepAircraft, type PilotWorld } from './pilot';
import { Rng } from './rng';
import type { Aircraft, Comp, LandingRecord, ReleaseReq, Scenario, SimEvent, SpawnSpec, Storm, Tx } from './types';
import { buildMetar, isLvp, parseMetar, selectRunway, transitionLevel, type Weather } from './weather';

export interface IssueResult { ok: boolean; warnings: string[]; blocked?: boolean }

const ATIS_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
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
  cmdLog: { t: number; cl: Clearance }[] = [];
  landings: LandingRecord[] = [];
  spacing: { leader: string; follower: string; gap: number; min: number }[] = [];
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

  constructor(public pack: Pack, public sc: Scenario, opts: { radarRefresh?: number } = {}) {
    this.rng = new Rng(sc.seed);
    this.weather = parseMetar(sc.metar);
    this.qnh = this.weather.qnh;
    this.tl = transitionLevel(this.qnh, pack.meta.transitionAltitude);
    this.lvp = isLvp(this.weather);
    this.runway = sc.runway ?? selectRunway(pack, this.weather);
    this.atisIdx = 10 + (sc.seed % 8);
    this.storms = (sc.storms ?? []).map((s) => ({ ...s, p: { ...s.p } }));
    this.spawns = [...sc.spawns].sort((a, b) => a.t - b.t);
    if (opts.radarRefresh) this.radarRefresh = opts.radarRefresh;
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

    // scenario events and spawns
    while (this.evIdx < this.sc.events.length && this.sc.events[this.evIdx].t <= t) this.runEvent(this.sc.events[this.evIdx++]);
    while (this.spawnIdx < this.spawns.length && this.spawns[this.spawnIdx].t <= t) this.spawn(this.spawns[this.spawnIdx++]);

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
    const sid = this.pack.sids.find((s) => s.name === spec.sid && s.runways.includes(this.runway)) ?? this.rng.pick(this.pack.sids.filter((s) => s.runways.includes(this.runway) && !s.atcDiscretion));
    const perf = PERF[spec.type] ?? PERF.B738;
    const r: ReleaseReq = { cs: spec.cs, type: perf.type, wake: perf.wake, sid: sid.name, rwy: this.runway, t: this.t, state: 'pending' };
    this.releases.push(r);
    this.relSpecs.set(spec.cs, { ...spec, sid: sid.name });
    this.icom('TWR', `Approach, Tower, request release ${spec.cs}, ${sid.name}, runway ${this.runway}`, spec.cs);
  }

  /** Arrival on final for the runway in use within n NM of the threshold. */
  private arrivalWithin(nm: number): boolean {
    return this.aircraft.some((a) => !a.remove && !a.landed && a.app?.locCap && a.app.rwy.id === this.runway && !a.lowPass && (() => { const d = distToThr(a.p, a.app!.rwy); return d > -0.5 && d < nm; })());
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
      const star = this.pack.stars.find((s) => s.name === spec.star) ?? this.pack.stars.find((s) => s.runways.includes(this.runway))!;
      const legs = star.legs;
      const D = spec.spawnDist ?? 42;
      // walk back from the end of the STAR
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
      if (spec.unfamiliar) {
        pos = move({ x: 0, y: 0 }, 300, D);
      }
      const route = spec.unfamiliar ? [] : legs.slice(startIdx).map((l) => ({ ...l }));
      const hdg = route.length ? bearing(pos, route[0].p) : bearing(pos, { x: 0, y: 0 });
      const handoff = spec.level ?? star.handoffLevel;
      const hft = this.ftOf(handoff);
      ac = this.base({ ...spec, level: handoff }, pos, spec.alt ?? hft + 1500, hdg);
      ac.route = route;
      ac.proc = spec.unfamiliar ? undefined : star.name;
      if (spec.unfamiliar) { ac.mode = 'HDG'; ac.hdgAssigned = hdg; }
      ac.expectRwy = this.runway;
      ac.vs = -1200;
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
    if (spec.kind === 'mil' && ac.perf.fighter && !spec.silent) this.milCrossing(ac);
  }

  /** A departure gets airborne: it appears past the runway end and calls on RT. */
  private launchDeparture(spec: SpawnSpec, rel?: ReleaseReq) {
    const sid = this.pack.sids.find((s) => s.name === spec.sid && s.runways.includes(this.runway)) ?? this.rng.pick(this.pack.sids.filter((s) => s.runways.includes(this.runway) && !s.atcDiscretion));
    const r = this.rwy;
    const lenNm = r.lengthM / 1852;
    const p = move(r.thr, r.crs, lenNm + 1.2);
    const level = rel?.lvl ?? sid.initialClimb;
    const ac = this.base({ ...spec, level, spd: spec.spd ?? (PERF[spec.type]?.vminFlap ?? 160) + 20 }, p, r.elevation + 1300, r.crs);
    ac.vs = 2000;
    ac.route = sid.legs.map((l) => ({ ...l }));
    ac.proc = sid.name;
    ac.exitFix = sid.exitFix;
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
  }

  /** Military fighters: MIL asks for the crossing on the intercom before the formation calls. */
  private milCrossing(ac: Aircraft) {
    const spec = (ac as any)._spec as SpawnSpec;
    const route = spec.route ?? [];
    const via = route.length ? `${route[0]} to ${route[route.length - 1]}` : 'the TMA';
    const text = `Approach, MIL, request crossing for ${ac.cs}${ac.formation > 1 ? ' flight of ' + ac.formation : ''}, ${ac.type}, ${via}, ${levelText(ac.cleared)}`;
    ac.request = { kind: 'milxing', text: `MIL crossing ${route.join('–')} ${levelText(ac.cleared)}`, speech: '', route, t: this.t };
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
    if (tx.channel !== 'icom') { if (tx.from === 'ATC') this.atcAirtime += dur; else if (tx.from === 'PILOT') this.pilotAirtime += dur; }
    for (const f of this.onTx) f(full);
    return full;
  }
  private queueCall(tx: Omit<Tx, 'id' | 't0' | 't1'>, notBefore: number, onStart?: () => void, priority = false) {
    if (priority) this.queue.unshift({ tx, notBefore, onStart, priority }); else this.queue.push({ tx, notBefore, onStart });
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
        const trk = hdgItem ? norm360(hdgItem.hdg + this.pack.meta.magVar) : ac.trk;
        const d = distToThr(ac.p, r);
        const ang = Math.abs(angDiff(r.crs, trk));
        if (!ac.app?.locCap && (ac.mode === 'HDG' || hdgItem) && (ang > 45 || d < 6 || d > 28)) w.push('Poor intercept geometry');
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
      if (it.k === 'dct' && !this.pack.fixes.has(it.fix)) w.push(`Unknown fix ${it.fix}`);
      if (it.k === 'hdg') {
        const target = norm360(it.hdg + this.pack.meta.magVar);
        const look = move(ac.p, target, 6);
        for (const tsa of this.pack.tsas) {
          if (this.tsaOn.has(tsa.name) && pointInPolygon(look, tsa.poly) && ac.alt >= this.ftOf(tsa.floor) && ac.alt <= this.ftOf(tsa.ceiling)) w.push(`Heading into active ${tsa.name}`);
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

    const ctx = this.phraseCtx(target, cl);
    const ph = phraseology(cl, ctx);
    const t0 = Math.max(this.t, this.busyUntil);
    const dur = airtime(ph.speech);
    this.busyUntil = t0 + dur + 0.4;
    const tx = this.emitTx({ from: 'ATC', cs: cl.cs, text: ph.text, speech: ph.speech }, t0);
    target.txCount++;

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

    // The controller's input updates the system flight plan (label CFL, AHDG) regardless of what the pilot does.
    for (const it of cl.items) {
      if (it.k === 'lvl') target.cflSys = it.lvl;
      if (it.k === 'hdg') target.hdgSys = norm360(it.hdg + this.pack.meta.magVar);
      if (it.k === 'dct' || it.k === 'trans' || it.k === 'ron' || it.k === 'hold' || it.k === 'app') target.hdgSys = it.k === 'app' ? target.hdgSys : undefined;
    }
    // Occasionally a pilot misses the call entirely.
    if (!target.radioFail && !this.forceWrong.has(target.cs) && !this.sc.noSayAgain && this.rng.chance(target.unfamiliar ? 0.06 : 0.03)) {
      this.queueCall({ from: 'PILOT', cs: target.cs, text: `Say again for ${target.cs}`, speech: `Say again for ${target.tel}` }, tx.t1 + this.rng.range(1, 2), () => { target.awaitingSince = this.t + 2; }, true);
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
      const why = this.unableReason(ac, it);
      if (why) unable.push(it); else accepted.push(it);
    }
    // wrong readback (only when the right aircraft answers)
    let wrong: { idx: number; item: Item } | undefined;
    if (ac === target && !ac.radioFail) {
      const rate = this.sc.readbackErr * (ac.unfamiliar ? 3 : 1);
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
    if (unable.length) { rbText = `unable ${unableTxt}, ` + rbText; rbSpeech = `unable ${unableTxt}, ` + rbSpeech; }
    const delay = this.rng.range(0.8, 2.0);
    const applied = wrong ? accepted.map((it, i) => (i === wrong!.idx ? wrong!.item : it)) : accepted;
    this.queueCall({ from: 'PILOT', cs: ac.cs, text: rbText, speech: rbSpeech }, tx.t1 + delay, () => {
      this.apply(ac, applied, target);
      if (wrong) ac.wrong = { item: wrong.item, t: this.t, issuedT: t0 };
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
      qnhSay: !ac.qnhGiven && cl.items.some((i) => i.k === 'lvl' && i.lvl.ft !== undefined),
    };
    if (ac.kind === 'arr' && !ac.vecInfo && !ac.app && has('hdg') && !has('app')) ctx.vectorFor = { app: rwyUse.ils && !this.ilsOut.has(rwyUse.id) ? 'ILS' : 'RNP', rwy: rwyUse.id };
    const appIt = cl.items.find((i) => i.k === 'app') as { rwy: string } | undefined;
    if (appIt && !ac.app?.locCap && (ac.mode === 'HDG' || has('hdg'))) {
      const r = this.pack.runways.get(appIt.rwy);
      const d = r ? distToThr(ac.p, r) : -1;
      if (d >= 3 && d <= 30) ctx.posNm = d;
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
      ctx.req = { kind: r.kind, route, vfr, sqk, alt: vr?.alt ?? 1500 };
    }
    return ctx;
  }

  /** Expected approach clearance time for a new holder: 2.5 min per aircraft ahead in that hold. */
  efcFor(ac: Aircraft, fix: string): { t: number; say: string | null } {
    const ahead = this.aircraft.filter((o) => o !== ac && !o.remove && o.kind === 'arr' && ((o.mode === 'HOLD' && o.hold?.fix === fix) || (o as any)._holdAt === fix || ((o as any)._efcFix === fix && this.readbackPending(o.cs)))).length;
    if (ahead === 0) return { t: this.t + 300, say: null };
    const t = Math.ceil((this.t + ahead * 150) / 60) * 60;
    return { t, say: this.utc(t).slice(0, 5).replace(':', '') };
  }

  private answerMil(ac: Aircraft, yes: boolean) {
    const r = ac.request!;
    ac.request = undefined;
    this.responseTimes.push(Math.max(0, this.t - r.t));
    if (yes) {
      this.icom('ATC', `${ac.cs} crossing approved, ${levelText(ac.cleared)}, call me on 119.280`, ac.cs);
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
        case 'rel': case 'relhold': break;
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
      case 'climb': ac.cleared = r.level!; ac.tgtAlt = this.ftOf(r.level!); break;
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
        ac.cleared = { ft: 3000 }; ac.tgtAlt = 3000;
        break;
      }
      default: break;
    }
  }

  private onOutboundTransfer(ac: Aircraft) {
    if (ac.kind === 'dep') {
      this.departuresHandled++;
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
      ac.cleared = { ft: 3000 }; ac.tgtAlt = 3000;
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
      ac.cleared = { ft: 3000 }; ac.tgtAlt = 3000;
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
    ac.cleared = { ft: 3000 }; ac.tgtAlt = 3000;
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
    (this as any)._lowLanded = ((this as any)._lowLanded ?? 0) + ac.lowSec;
    this.runwayBusyUntil = this.t + (this.lvp ? 120 : 50);
    // spacing to the follower on the same final
    let follower: Aircraft | undefined, fd = Infinity;
    for (const o of this.aircraft) {
      if (o === ac || o.remove || !o.app?.locCap || o.app.rwy.id !== r.id) continue;
      const d = distToThr(o.p, r);
      if (d > 0 && d < fd) { fd = d; follower = o; }
    }
    if (follower && fd < 15) this.spacing.push({ leader: ac.cs, follower: follower.cs, gap: fd, min: wakeMinNm(ac.perf.recat, follower.perf.recat, 2.5) });
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
    this.emergencies.push({ cs: ac.cs, type, t0: this.t });
    this.event({ kind: 'emer', cs: ac.cs, comp: 'NONR', sev: 'info', text: `${ac.cs}: ${type === 'radio' ? 'radio failure (7600)' : 'MAYDAY (7700)'}`, cost: 0 });
    if (type === 'radio') {
      ac.sqk = '7600'; ac.radioFail = true; ac.lostCommT = this.t;
      if (ac.mode !== 'HDG') this.onRouteEnd(ac, { fix: '__LOSTCOMM__', p: ac.p });
      return;
    }
    ac.sqk = '7700';
    const rw = this.runway;
    const text = type === 'engine'
      ? `MAYDAY MAYDAY MAYDAY, Liège Approach, ${ac.cs}, engine failure, request immediate return runway ${rw}`
      : `MAYDAY MAYDAY MAYDAY, Liège Approach, ${ac.cs}, smoke in the cargo hold, request immediate descent and landing nearest runway`;
    const speech = type === 'engine'
      ? `Mayday mayday mayday, Liège Approach, ${ac.tel}, engine failure, request immediate return runway ${this.runwaySpeech(rw)}`
      : `Mayday mayday mayday, Liège Approach, ${ac.tel}, smoke in the cargo hold, request immediate descent and landing nearest runway`;
    if (type === 'engine') { const cap = Math.min(ac.tgtAlt, Math.max(3000, Math.round(ac.alt / 100) * 100)); ac.tgtAlt = cap; ac.cleared = this.levelFor(cap); }
    if (ac.kind === 'dep') { ac.kind = 'arr'; ac.expectRwy = rw; ac.baselineNm = ac.flownNm + 20; this.departuresSpawned--; this.arrivalsSpawned++; }
    this.queueCall({ from: 'PILOT', cs: ac.cs, text, speech, emergency: true }, this.t, () => { ac.awaitingSince = this.t + airtime(speech); }, true);
  }

  // ---------------- scenario events ----------------
  private runEvent(e: Scenario['events'][number]) {
    switch (e.kind) {
      case 'tsa':
        if (e.on) this.tsaOn.add(e.name); else this.tsaOn.delete(e.name);
        this.sys(`${e.name} ${e.on ? 'ACTIVE' : 'released'} (military)`);
        break;
      case 'wind':
        this.setWeather({ ...this.weather, windDir: e.dir, windKt: e.kt, gustKt: e.gust });
        break;
      case 'runway':
        this.runway = e.rwy; this.atisIdx++;
        this.sys(`Runway change: ${e.rwy} in use, ATIS ${this.atis}`);
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
            if (!c.stca) this.event({ kind: 'conflict_solved', cs: a.cs, cs2: b.cs, comp: 'SITU', sev: 'good', text: `Conflict ${a.cs} / ${b.cs} resolved before STCA`, cost: 0 });
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

export function similar(a: string, b: string) {
  if (a === b) return false;
  const pa = a.match(/^([A-Z]+)(\d+)/), pb = b.match(/^([A-Z]+)(\d+)/);
  if (!pa || !pb) return false;
  if (pa[1] === pb[1]) return pa[2].slice(0, 2) === pb[2].slice(0, 2) || pa[2].split('').sort().join('') === pb[2].split('').sort().join('');
  return pa[2] === pb[2] && pa[1].slice(0, 2) === pb[1].slice(0, 2);
}

export { mergeItem, unitName };
