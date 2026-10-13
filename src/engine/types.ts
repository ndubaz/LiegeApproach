import type { XY } from '../geo';
import type { Level, Leg, Runway } from '../pack/load';
import type { Perf } from './perf';
import type { ApproachType, Item, Unit } from './clearance';

export type Kind = 'arr' | 'dep' | 'ovf' | 'vfr' | 'mil' | 'heli' | 'cal';
export type Rules = 'IFR' | 'VFR' | 'OAT';
export type TrackState = 'inbound' | 'assumed' | 'transferred' | 'unconcerned';
export type LatMode = 'NAV' | 'HDG' | 'HOLD' | 'LOC' | 'ORBIT';
export type Comp = 'SEPC' | 'SITU' | 'TRAF' | 'COMM' | 'CORD' | 'WORK' | 'NONR' | 'SPP';

export interface Request {
  kind: 'climb' | 'crossing' | 'direct' | 'lowpass' | 'deviate' | 'approach' | 'vectors' | 'milxing';
  text: string;
  speech: string;
  level?: Level;
  fix?: string;
  hdg?: number; // magnetic
  route?: string[];
  t: number;
  /** MIL crossing: the level block the formation wants to cross in (lowest, highest). */
  band?: [Level, Level];
}

export interface HoldState { fix: string; p: XY; inbound: number; turn: 'L' | 'R'; phase: 'entry' | 'turnOut' | 'outbound' | 'turnIn' | 'inbound'; tPhase: number }

export interface ApproachState { type: ApproachType; rwy: Runway; locCap: boolean; gsCap: boolean; capT?: number; tooHigh?: boolean }

export interface Aircraft {
  id: number;
  cs: string;
  tel: string;
  type: string;
  perf: Perf;
  kind: Kind;
  rules: Rules;
  formation: number;
  // kinematics
  p: XY;
  alt: number;    // ft QNH
  ias: number;
  hdg: number;    // true
  vs: number;     // fpm
  gs: number;
  trk: number;
  // clearances
  cleared: Level;          // what the pilot is flying to (Mode S selected level)
  cflSys?: Level;          // what the controller cleared (system CFL)
  hdgSys?: number;         // heading the controller assigned (true)
  tgtAlt: number;
  spdAssigned?: number;
  spdUntil?: number;
  spdMin?: boolean;
  mode: LatMode;
  hdgAssigned?: number; // true
  turnDir?: 'L' | 'R';
  route: Leg[];
  savedRoute?: Leg[];
  proc?: string;        // STAR / SID / transition name
  hold?: HoldState;
  app?: ApproachState;
  expectRwy?: string;
  // ops state
  state: TrackState;
  xfrUnit?: Unit;
  sqk: string;
  emergency?: 'engine' | 'smoke' | 'radio';
  emergencyT?: number;
  radioFail?: boolean;
  lostCommT?: number;
  request?: Request;
  awaitingSince?: number;
  repeatedCall?: boolean;
  lowPass?: { rwy: string; passes: number; max: number };
  unfamiliar?: boolean;
  checkInAt?: number;
  label: { dx: number; dy: number };
  history: XY[];
  // bookkeeping for assessment
  spawnT: number;
  flownNm: number;
  baselineNm: number;
  holdSec: number;
  levelSegT: number;
  levelOffs: number;
  fuelKg: number;
  lowSec: number;  // time below 3,000 ft outside the final approach, within 15 NM
  txCount: number;
  wrong?: { item: Item; t: number; issuedT: number };
  twrXfrDist?: number;
  goArounds: number;
  landed?: boolean;
  remove?: boolean;
  /** Result of the stability gate at 1,000 ft above aerodrome level (about 3 NM). */
  stable4?: boolean;
  exitFix?: string;
  stormInside?: boolean;
  /** RECAT-EU wake category A–F, for the label. */
  recat: string;
  /** Expected approach clearance time (sim seconds) given with a hold instruction. */
  efc?: number;
  efcCalled?: boolean;
  /** The controller has passed the QNH to this aircraft. */
  qnhGiven?: boolean;
  /** The controller has said "vectoring for ... approach". */
  vecInfo?: boolean;
  /** Pilot has asked for lower because the hold maximum is below its level. */
  holdMaxCalled?: boolean;
  /** ATIS letter the pilot reported if it was out of date, and when. */
  atisOld?: string;
  atisOldT?: number;
  /** Seconds of free frequency since the pilot's last unanswered call. */
  waitFree?: number;
  /** Plain-English nature of the emergency, as the crew declared it (e.g. "Smoke in the cargo hold"), for the UI. */
  emergencyText?: string;
  /** The crew queried a turn of more than 200° ("confirm left turn heading 130?") and is waiting for the controller to confirm it. */
  turnQuery?: { hdg: number; dir: 'L' | 'R'; t: number };
  /** The controller said "standby" at this time; the pilot calls again about 45 s later if nothing follows. */
  standbyT?: number;
  /** Brussels' estimate for this arrival: transfer fix, sim time at the fix, agreed transfer level (XFL). */
  estimate?: { fix: string; t: number; xfl: Level };
  /** Agreed level for the transfer to the next unit (departures: FL090 per the letter of agreement). */
  xfl?: Level;
  /** The pilot's last call on the frequency (what "say again" makes them repeat). */
  lastCall?: { text: string; speech: string; t: number };
}

/** Departure release request from Tower (coordinated on intercom). */
export interface ReleaseReq {
  cs: string;
  type: string;
  wake: string;
  sid: string;
  rwy: string;
  t: number;
  state: 'pending' | 'released' | 'held' | 'airborne';
  /** Released after this aircraft (arrival lands / departure gets airborne). */
  after?: string;
  /** Magnetic heading on release instead of the SID. */
  hdg?: number;
  lvl?: Level;
  /** Sim time Tower was told to expect a release (held). */
  expectAt?: number;
  chased?: boolean;
  tReleased?: number;
  tAirborne?: number;
}

export interface SimEvent {
  t: number;
  kind: string;
  cs?: string;
  cs2?: string;
  comp: Comp;
  sev: 'info' | 'minor' | 'major' | 'serious' | 'good';
  text: string;
  cost: number;
  value?: number;
}

export interface Tx {
  id: number;
  t0: number;
  t1: number;
  /** ATC = the player; TWR/BRU/MIL/SUP are other units on the intercom. */
  from: 'ATC' | 'PILOT' | 'SYS' | 'TWR' | 'BRU' | 'MIL' | 'SUP';
  cs: string;
  text: string;
  speech: string;
  emergency?: boolean;
  blocked?: boolean;
  /** 'rt' (default) is 119.280; 'icom' is the intercom: no airtime, never blocked. */
  channel?: 'rt' | 'icom';
}

/** One pair of consecutive landings on the same runway: the follower's distance from the threshold when the leader touched down. */
export interface SpacingRecord { leader: string; follower: string; gap: number; min: number; t?: number; rwy?: string }

export interface LandingRecord {
  cs: string; type: string; t: number; spawnT: number; flownNm: number; baselineNm: number; holdSec: number;
  levelOffs: number; fuelKg: number; gapNm?: number; minGapNm?: number; emergency?: string; goArounds: number;
}

export interface Storm { p: XY; r: number; vx: number; vy: number }

export type SpawnSpec = {
  t: number;
  kind: Kind;
  cs: string;
  type: string;
  star?: string;
  sid?: string;
  route?: string[];         // fix ids for ovf / vfr / mil / heli
  from?: { brg: number; dist: number }; // spawn offset from the first route fix
  level?: Level;            // initial level (cleared)
  alt?: number;             // initial altitude if different from cleared
  spd?: number;
  rules?: Rules;
  formation?: number;
  request?: { kind: Request['kind']; level?: Level; fix?: string; route?: string[]; delay?: number };
  emergency?: { after: number; type: 'engine' | 'smoke' | 'radio' };
  lowPass?: { passes: number };
  unfamiliar?: boolean;
  spawnDist?: number;       // arrivals: track miles before the STAR end
  silent?: boolean;         // never calls (unconcerned traffic)
  goAroundAt?: number;      // forced go-around (tower) at this distance from threshold
  released?: true;          // departures: skip the release protocol and appear airborne
  callNow?: boolean;        // arrivals: call at once on spawn (hot start)
};

export type ScEvent =
  | { t: number; kind: 'tsa'; name: string; on: boolean }
  | { t: number; kind: 'wind'; dir: number; kt: number; gust?: number }
  /** Runway change. With `notice` (seconds) the supervisor announces it first and it happens that much later. */
  | { t: number; kind: 'runway'; rwy: string; notice?: number }
  | { t: number; kind: 'ils'; rwy: string; ok: boolean }
  | { t: number; kind: 'lvp'; on: boolean; rvr?: number; vis?: number; ceiling?: number }
  | { t: number; kind: 'flow'; exitFix: string; mit: number; text: string }
  | { t: number; kind: 'note'; text: string };

export interface PassCriteria {
  minLanded?: number;
  allArrivalsHandled?: boolean;
  emergencyLandedWithinMin?: number;
  maxHoldMinPerArrival?: number;
  minRatings?: Partial<Record<Comp, number>>;
  noMissedReadbacks?: boolean;
  noTsa?: boolean;
  minDeparturesHandled?: number;
}

export interface Scenario {
  id: string;
  title: string;
  tier?: 1 | 2 | 3 | 4;
  desc: string;
  objective?: string;
  seed: number;
  durationMin: number;
  startUtc: string;   // "HH:MM"
  metar: string;
  runway?: string;
  spawns: SpawnSpec[];
  events: ScEvent[];
  storms?: Storm[];
  readbackErr: number;
  confusion?: boolean;
  pass?: PassCriteria;
  freePlay?: boolean;
  noSayAgain?: boolean;
  tutorial?: boolean;
  /** Free play: new ATIS every 30 min with QNH and wind drift. */
  atisDrift?: boolean;
  briefing?: string;   // one-paragraph shift briefing shown before the session
  objectives?: { cs: string; text: string; byT: number }[]; // timed objectives (emergencies), byT in sim seconds
  /** Brussels estimates and coordination requests on the intercom. Default: on, except in tutorial scenarios. */
  coordination?: boolean;
  /** Probability that Brussels asks for an early transfer of an arrival (default 0.1). */
  earlyTransferRate?: number;
}

/** Brussels' estimate for an arrival, sent on the intercom 2 to 4 minutes before the transfer. */
export interface Estimate {
  cs: string;
  type: string;
  star: string;
  /** first STAR fix ahead of the aircraft at the transfer */
  fix: string;
  /** sim time over the fix */
  t: number;
  /** agreed transfer level */
  xfl: Level;
  /** sim time the estimate was passed */
  sentT: number;
  /** 'expected' until the aircraft is handed over */
  state: 'expected' | 'handed';
  /** Brussels could not make the agreed level: the level it will come at instead */
  revised?: boolean;
}

/** A coordination request from another unit, answered on the intercom with Approve / Unable (`appr` / `deny`). */
export interface CoordReq {
  id: number;
  from: 'BRU';
  kind: 'early';
  cs: string;
  /** the level Brussels asks you to take the aircraft at */
  level: Level;
  t: number;
  state: 'pending' | 'approved' | 'denied' | 'expired';
  /** the request lapses (treated as unable) at this sim time */
  expireT: number;
  text: string;
  chased?: boolean;
}

/** One entry in the safety-nets list. `id` is stable for as long as the alert lasts; `since` is when it started. */
export type SafetyNet =
  | { id: string; kind: 'STCA' | 'LOS'; a: string; b: string; nm: number; vertFt: number; tCpa: number; cpaNm: number; since: number }
  | { id: string; kind: 'SFL'; cs: string; sfl: Level; cfl: Level; since: number }
  | { id: string; kind: 'MSAW'; cs: string; alt: number; mva: number; since: number }
  | { id: string; kind: 'CLAM'; cs: string; alt: number; cfl: Level; since: number };
