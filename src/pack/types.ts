// Location pack schema. One pack = one airport/sector. The engine never
// hard-codes anything airport-specific; everything comes from here.

export type FixSpec =
  | { lat: string; lon: string; kind?: FixKind; note?: string }
  | { from: string; brg: number; dist: number; kind?: FixKind; note?: string };
export type FixKind = 'fix' | 'vor' | 'ndb' | 'vfr' | 'town' | 'map' | 'rwy';

export interface AltConstraint { min?: number; max?: number; at?: number }
/** Levels: numbers are feet; strings "F080" are flight levels. */
export type LevelSpec = number | string;

export interface LegSpec {
  fix: string;
  min?: LevelSpec;
  max?: LevelSpec;
  spd?: number; // max IAS
  flyover?: boolean;
}

export interface RunwaySpec {
  id: string;
  thr: { lat: string; lon: string };
  crsTrue: number;
  elevation: number;
  lengthM: number;
  ils?: { ident: string; freq: string; cat: string; gp?: string };
  rnp: boolean;
  if: { fix: string; alt: number };
  faf: { fix: string; alt: number };
  missed: string[]; // fixes after missed approach, ending at the hold fix
  contingency?: boolean;
  notes?: string;
  /** Glide path angle, degrees (AD 2.19). */
  gpDeg?: number;
  /** Threshold crossing height / RDH, ft (AD 2.19, IAC coding). */
  tch?: number;
  /** Missed approach: altitude at the holding fix (ft) and speed limit (KIAS) from the IAC coding. */
  missedAlt?: number;
  missedSpd?: number;
}

export interface ProcedureSpec {
  name: string;
  runways: string[];
  legs: LegSpec[];
  atcDiscretion?: boolean;
}

export interface StarSpec extends ProcedureSpec {
  /** Level the aircraft is cleared to when Brussels hands it over. */
  handoffLevel: LevelSpec;
}

export interface SidSpec extends ProcedureSpec {
  initialClimb: LevelSpec;
  exitFix: string;
}

export interface HoldSpec {
  fix: string;
  inboundTrue: number;
  turn: 'L' | 'R';
  minAlt: LevelSpec;
  maxAlt: LevelSpec;
  maxSpd: number;
  atcDiscretion?: boolean;
  /** Inbound track as published, magnetic (AD 2.22 holding table). */
  inboundMag?: number;
  /** Outbound leg, minutes. */
  legMin?: number;
}

export type PolySpec = Array<{ lat: string; lon: string } | { arcCentre: { lat: string; lon: string }; radius: number; to: { lat: string; lon: string }; dir: 'cw' | 'ccw' }>;

export interface AreaSpec {
  name: string;
  poly: PolySpec;
  floor: LevelSpec;
  ceiling: LevelSpec;
  approx?: boolean;
  note?: string;
  /** ICAO airspace class (A-G), where the area is controlled airspace. */
  cls?: string;
  /** Activation, as published. */
  hours?: string;
}

export interface MvaSpec { poly: PolySpec; alt: number }

export interface PackSpec {
  meta: {
    icao: string;
    name: string;
    arp: { lat: string; lon: string };
    elevation: number;
    magVar: number; // east positive
    transitionAltitude: number;
    appCallsign: string;
    appFreq: string;
    twrCallsign: string;
    twrFreq: string;
    atisFreq: string;
    sectorRadiusNm: number;
    sectorCeiling: LevelSpec;
    airac: string;
    upstream: { name: string; callsign: string; freq: string }[];
    sources: string[];
    approximations: string[];
    /** Transition level by QNH band (ENR 1.7). qnhMin..qnhMax inclusive, hPa. */
    tlTable?: { qnhMin: number; qnhMax: number; fl: number }[];
    /** Ground frequency (AD 2.18). */
    gndFreq?: string;
    /** SSR codes the unit assigns itself (ENR 1.6 code allocation). */
    squawkBlock?: [string, string];
    /** Effective date of the AIRAC cycle the data was checked against. */
    effective?: string;
    /** SID initial climb when QNH is at or below qnhMax (AD 2.22: FL070 when QNH 995 hPa or below). */
    initialClimbLowQnh?: { qnhMax: number; level: LevelSpec };
    /** 2.5 NM on the same final approach is approved at this unit (ICAO Doc 4444 8.7.4.4). */
    reducedFinalSep?: boolean;
  };
  fixes: Record<string, FixSpec>;
  runways: RunwaySpec[];
  /** Runway pairs sharing one strip, opposite directions. */
  strips: { ends: [string, string]; drawFrom: { lat: string; lon: string }; drawTo: { lat: string; lon: string } }[];
  /** Only one runway may be in use (AIP: no simultaneous use). */
  preferredRunways: string[];
  stars: StarSpec[];
  transitions: ProcedureSpec[];
  sids: SidSpec[];
  holds: HoldSpec[];
  ctr: AreaSpec;
  tma: AreaSpec;
  tsas: AreaSpec[];
  mva: MvaSpec[];
  vfrRoutes: { name: string; points: string[]; alt: number }[];
  mapLines: { name: string; points: string[]; style: 'river' | 'border' | 'road' }[];
  /** All published sub-areas of the TMA (ENR 2.1); `tma` is the H24 core used for drawing. */
  tmaParts?: AreaSpec[];

  // ---- 2.0: everything the engine used to assume about Liège lives here (optional: Liège defaults apply) ----
  /** Where the arrival stack forms and the approach transitions start (Liège: ALHUV). */
  stackFix?: string;
  /** The intercom units of this position. `role` drives behaviour; `id` is what clearances, strips and keys use. */
  units?: UnitSpec[];
  /** Operators flying here, by period, for traffic generation (replaces the Liège cargo tables). */
  traffic?: TrafficSpec;
  /** How crews say five-letter fixes and local names (voice engine). */
  fixSay?: Record<string, string>;
  /** Local time offset from UTC in winter, hours (DST adds one). Default 1. */
  utcOffsetWinter?: number;
  /** Departure transfer level to the centre (letter of agreement). Default F090. */
  depXfl?: LevelSpec;
  /** Military and other reserved areas the position coordinates with (names as in the AIP; drawn like TSAs). */
  reservedAreasName?: string;
  /** Places and towns for the video map and the briefing (lat/lon via fixes of kind 'town'). */
  country?: 'BE' | 'DE' | 'NL' | 'FR';
}

export interface UnitSpec {
  /** short id used everywhere: TWR, ACC, MIL, plus neighbours */
  id: string;
  role: 'tower' | 'acc' | 'military' | 'neighbour' | 'upper' | 'supervisor' | 'ground';
  callsign: string;
  freq: string;
  /** how the intercom key is labelled (e.g. 'Langen', 'Rhein') */
  label: string;
  /** the AIP paragraph or document the callsign and frequency come from; 'sim construct' if invented */
  source: string;
  /** which accent groups the people at this unit have (voice casting) */
  voices?: string[];
}

export interface OperatorSpec { op: string; types: string[]; w: number; kind?: 'arr' | 'dep' | 'both'; telephony?: string }
export interface TrafficSpec {
  /** operators and the fleet they fly here, with weights, by period of the day */
  cargo: OperatorSpec[];
  pax: OperatorSpec[];
  /** the night-bank operators (Liège: the express hub wave); empty when the airport has no bank */
  bank: OperatorSpec[];
  /** telephony designators for operators not in the engine's table */
  telephony?: Record<string, string>;
  /** hourly demand: movements per hour and the share that is passenger traffic, 24 entries starting at 00:00 local */
  demand?: { perHour: number; paxShare: number }[];
  /** general aviation, VFR and helicopter callsign patterns (ICAO registration prefixes) */
  gaPrefixes?: string[];
  /** military callsigns that cross or use the field */
  military?: OperatorSpec[];
}
