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
    /** 2.0: controlled airspace over and around the TMA inside the sector (Liège: the Brussels CTA from 4,500 ft, class C). Default: none (class G). */
    upperClass?: { floor: LevelSpec; cls: string };
    /**
     * 2.0 gameplay: radar minimum between consecutive approaches to the two parallel runways of one strip pair inside
     * 10 NM, where the unit is approved for it (Düsseldorf AD 2.22: 2.5 NM diagonal). Wake minima always apply on top.
     */
    parallelApproachSepNm?: number;
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
  mapLines: { name: string; points: string[]; style: 'river' | 'border' | 'road' | 'rail' | 'coast' }[];
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
  /**
   * Runway configurations in preference order, for airports that land and depart on different runways at the same
   * time (Düsseldorf: 23L landing, 23R departures). `land` is `sim.runway`, `dep` is `sim.depRunway`. Without this
   * list the engine uses `preferredRunways` and one runway does both.
   */
  runwayConfigs?: RunwayConfigSpec[];

  // ---- 2.0 graphics: everything the scope draws that is not procedure data (all optional) ----
  /** Terrain for the video map: contour polylines (lat, lon pairs in decimal degrees), spot heights and region names. */
  terrain?: TerrainSpec;
  /** Towns with a size rank: 1 is drawn at every zoom with a larger label, 3 only when zoomed in. Replaces fixes of kind 'town' when present. */
  places?: PlaceSpec[];
  /** Other aerodromes in the area, drawn as small symbols with their ICAO code. */
  airports?: AirportSpec[];
  /** Night flight restriction as published (AD 2.20), local clock times "HH:MM"; the sim starves demand between them. */
  curfew?: { fromLocal: string; toLocal: string; note?: string };
  /** Segregated parallel operations (AD 2.22): which runway lands and which departs when both are in use, per direction. */
  parallelOps?: { arrivals: string; departures: string; note?: string }[];
  // ---- 2.0 gameplay (GAMEPLAY track); all optional ----
  /**
   * Departures stay with Tower until passing this altitude, then call the named unit (Düsseldorf: Langen Radar 121.355
   * passing 2,000 ft). The sim's player works that frequency for departures; the check-in names the unit's callsign.
   */
  depCheckIn?: { unitId: string; passingFt: number };
}

export interface TerrainSpec {
  contours: { pts: [number, number][]; closed?: boolean; label?: string }[];
  spots: { lat: number; lon: number; text: string }[];
  regions: { lat: number; lon: number; name: string }[];
}
export interface PlaceSpec { name: string; lat: string; lon: string; rank: 1 | 2 | 3 }
export interface AirportSpec { icao: string; lat: string; lon: string; name?: string; kind?: 'civil' | 'mil' | 'heli' | 'glider' }
/** One runway pair in use: the landing runway and the departure runway (the same id when one runway does both). */
export interface RunwayConfigSpec { land: string; dep: string; note?: string }

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
  /** how the unit names itself on the landline ("Liège, Brussels, estimate ..."; "Approach, Tower, ..."). Default: the first word of the callsign */
  say?: string;
}

export interface OperatorSpec {
  op: string; types: string[]; w: number; kind?: 'arr' | 'dep' | 'both'; telephony?: string;
  /** accent groups of this operator's crews when the engine's casting table has none (voice casting) */
  voices?: string[];
}
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
  // ---- 2.0 additions (ENGINE track); all optional, the engine derives defaults from the procedures when absent ----
  /**
   * Movements per hour over the UTC day as piecewise-linear curves (arrivals and departures), with the named phases of
   * the day. Preferred over `demand` when both are given (finer than hourly). `max` is the highest rate on each curve.
   */
  curve?: { arr: [number, number][]; dep: [number, number][]; max: { arr: number; dep: number }; phases: PhaseSpec[] };
  /** STAR families by weight: `base` is the STAR name without its runway letter (KOK7 for KOK7X / KOK7D). `wBank` applies in a bank phase. Default: every STAR of the runway, equal weight. */
  arrivals?: { base: string; w: number; wBank?: number }[];
  /** STAR families in a bank phase, in their own order and weights (the night bank at Liège comes mostly from the west and south-east). Default: `arrivals` with `wBank`. */
  arrivalsBank?: { base: string; w: number }[];
  /** SIDs by weight (any runway; the engine keeps those of the departure runway in use). Default: every non-discretionary SID, equal weight. */
  departures?: { name: string; w: number }[];
  /** General aviation, helicopter, military and other transient traffic the generator can add, with the free-play military level that brings each in. */
  patterns?: PatternSpec[];
  /** Free-play templates. Default: derived from the curve. */
  templates?: Partial<Record<'night' | 'day' | 'quiet' | 'shift', TemplateSpec>>;
  /** The reserved area the event deck activates, and the UTC hours it may be active (NOTAM). Default: none (the card becomes a military crossing). */
  reserved?: { name: string; hoursUtc: [number, number] };
  /** Where diversions come from (the big airport next door) and the true bearing they arrive from. */
  diversion?: { from: string; icao?: string; brg: number };
  /** Registration marks for GA callsigns: prefix plus random letters to this length (Belgium OO-xxx; Germany D-Exxx). Default: the first `gaPrefixes` entry, 5 letters. */
  registration?: { prefix: string; length: number };
  /** arrival STARs and their share of the inbound flow (replaces the engine's Liège STAR tables) */
  arrStars?: { name: string; w: number }[];
  /** departure SIDs per runway id and their share of the outbound flow */
  depSids?: Record<string, { name: string; w: number }[]>;
}

export interface PhaseSpec { from: number; to: number; phase: string; label: string; paxShare: number }
export interface TemplateSpec {
  title: string; arrPerHr: number; depPerHr: number; start: string; paxShare: number;
  /** 2.0 gameplay: one honest sentence for the briefing (a curfew template says what the night really brings). */
  note?: string;
}
/** A transient-traffic template. Callsign: fixed `cs`, or `csOp` + a number in `csNum`, or a registration (`csReg`). Several `types`: one is picked. */
export interface PatternSpec {
  kind: 'vfr' | 'heli' | 'mil' | 'ovf' | 'cal';
  cs?: string;
  csOp?: string;
  csNum?: [number, number];
  csReg?: boolean;
  types: string[];
  route: string[];
  from: { brg: number; dist: number };
  level: LevelSpec;
  spd?: number;
  formation?: number;
  request?: { kind: 'climb' | 'crossing' | 'direct' | 'lowpass'; level?: LevelSpec; fix?: string; route?: string[] };
  /** free-play military level (1 to 3) from which this pattern appears; omitted: deck cards only */
  at?: 1 | 2 | 3;
  /** event-deck cards this pattern can play ('hems', 'military'), with a weight among the tagged patterns */
  deck?: 'hems' | 'military';
  w?: number;
}
