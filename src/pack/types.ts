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
  ils?: { ident: string; freq: string; cat: string };
  rnp: boolean;
  if: { fix: string; alt: number };
  faf: { fix: string; alt: number };
  missed: string[]; // fixes after missed approach, ending at the hold fix
  contingency?: boolean;
  notes?: string;
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
}

export type PolySpec = Array<{ lat: string; lon: string } | { arcCentre: { lat: string; lon: string }; radius: number; to: { lat: string; lon: string }; dir: 'cw' | 'ccw' }>;

export interface AreaSpec {
  name: string;
  poly: PolySpec;
  floor: LevelSpec;
  ceiling: LevelSpec;
  approx?: boolean;
  note?: string;
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
}
