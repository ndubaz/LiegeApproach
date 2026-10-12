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
  kind: 'climb' | 'crossing' | 'direct' | 'lowpass' | 'deviate' | 'approach' | 'vectors';
  text: string;
  speech: string;
  level?: Level;
  fix?: string;
  hdg?: number; // magnetic
  route?: string[];
  t: number;
}

export interface HoldState { fix: string; p: XY; inbound: number; turn: 'L' | 'R'; phase: 'entry' | 'turnOut' | 'outbound' | 'turnIn' | 'inbound'; tPhase: number }

export interface ApproachState { type: ApproachType; rwy: Runway; locCap: boolean; gsCap: boolean; capT?: number }

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
  cleared: Level;
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
  stable4?: boolean;
  exitFix?: string;
  stormInside?: boolean;
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
  from: 'ATC' | 'PILOT' | 'SYS';
  cs: string;
  text: string;
  speech: string;
  emergency?: boolean;
}

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
};

export type ScEvent =
  | { t: number; kind: 'tsa'; name: string; on: boolean }
  | { t: number; kind: 'wind'; dir: number; kt: number; gust?: number }
  | { t: number; kind: 'runway'; rwy: string }
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
}
