import { destination, parseLatLon, Projection, type LatLon, type XY, DEG } from '../geo';
import type { PackSpec, LevelSpec, PolySpec, FixKind, UnitSpec, RunwayConfigSpec } from './types';

export interface Level { ft?: number; fl?: number }
export const parseLevel = (s: LevelSpec | undefined): Level | undefined => {
  if (s === undefined) return undefined;
  if (typeof s === 'number') return { ft: s };
  const m = s.match(/^F(\d{2,3})$/);
  if (m) return { fl: Number(m[1]) };
  return { ft: Number(s) };
};
/** Convert a level to QNH altitude in feet. */
export const levelToFt = (l: Level, qnh: number) => (l.fl !== undefined ? l.fl * 100 + (qnh - 1013.25) * 27 : (l.ft as number));

export interface Fix { id: string; p: XY; ll: LatLon; kind: FixKind; note?: string }
export interface Leg { fix: string; p: XY; min?: Level; max?: Level; spd?: number }
export interface Procedure { name: string; runways: string[]; legs: Leg[]; atcDiscretion?: boolean }
export interface Star extends Procedure { handoffLevel: Level }
export interface Sid extends Procedure { initialClimb: Level; exitFix: string }
export interface Runway {
  id: string; thr: XY; crs: number; elevation: number; lengthM: number;
  ils?: { ident: string; freq: string; cat: string }; rnp: boolean;
  ifFix: string; ifAlt: number; faf: string; fafAlt: number; missed: string[];
  contingency: boolean; notes?: string;
  gpDeg?: number; tch?: number; missedAlt?: number; missedSpd?: number;
}
export interface Hold { fix: string; p: XY; inbound: number; turn: 'L' | 'R'; min: Level; max: Level; spd: number; atcDiscretion?: boolean }
export interface Area { name: string; poly: XY[]; floor: Level; ceiling: Level; approx?: boolean; note?: string; cls?: string; hours?: string }

export interface Pack {
  spec: PackSpec;
  proj: Projection;
  arp: XY;
  meta: PackSpec['meta'];
  sectorCeiling: Level;
  fixes: Map<string, Fix>;
  runways: Map<string, Runway>;
  strips: { ends: [string, string]; a: XY; b: XY }[];
  preferredRunways: string[];
  stars: Star[];
  transitions: Procedure[];
  sids: Sid[];
  holds: Hold[];
  ctr: Area;
  tma: Area;
  tsas: Area[];
  mva: { poly: XY[]; alt: number }[];
  vfrRoutes: { name: string; points: string[]; alt: number }[];
  mapLines: { name: string; pts: XY[]; style: string }[];
  /** All TMA sub-areas when the pack lists them. */
  tmaParts?: Area[];
  // ---- 2.0 ----
  /** Runway configurations in preference order (one entry per runway when the airport lands and departs on the same one). */
  runwayConfigs: RunwayConfigSpec[];
  /** The intercom units of this position (from the spec, or derived from the meta block when the spec has none). */
  units: UnitSpec[];
  /** Where the arrival stack forms: the spec's stackFix, else the first fix of the first transition. */
  stackFix: string;
  /** What the pack calls its military reserved areas ('TSA', 'ED-R'). */
  reservedAreasName: string;
  /** Winter UTC offset of the airport, hours. */
  utcOffsetWinter: number;
  /** Agreed departure transfer level to the centre. */
  depXfl: Level;
}

/** The intercom units: the spec's list, or a minimal set built from the meta block (Tower, the centre, a supervisor). */
export function unitsOf(spec: PackSpec): UnitSpec[] {
  if (spec.units?.length) return spec.units;
  const m = spec.meta;
  const acc = m.upstream[0];
  const out: UnitSpec[] = [
    { id: 'TWR', role: 'tower', callsign: m.twrCallsign, freq: m.twrFreq, label: 'TWR', source: 'pack meta', say: 'Tower' },
    { id: 'ACC', role: 'acc', callsign: acc?.callsign ?? 'Control', freq: acc?.freq ?? '', label: 'ACC', source: 'pack upstream list', say: (acc?.callsign ?? 'Control').split(' ')[0] },
  ];
  for (const u of m.upstream.slice(1)) out.push({ id: u.name.split(' ')[0].toUpperCase().slice(0, 5), role: 'neighbour', callsign: u.callsign, freq: u.freq, label: u.name.split(' ')[0], source: 'pack upstream list' });
  out.push({ id: 'SUP', role: 'supervisor', callsign: 'Supervisor', freq: '', label: 'supervisor', source: 'sim construct', say: 'Supervisor' });
  return out;
}

export function loadPack(spec: PackSpec): Pack {
  const arpLL = parseLatLon(spec.meta.arp.lat, spec.meta.arp.lon);
  const proj = new Projection(arpLL);
  const lls = new Map<string, LatLon>();
  const resolve = (id: string, depth = 0): LatLon => {
    if (lls.has(id)) return lls.get(id)!;
    const f = spec.fixes[id];
    if (!f) throw new Error(`Unknown fix ${id}`);
    if (depth > 10) throw new Error(`Fix loop at ${id}`);
    const ll = 'lat' in f ? parseLatLon(f.lat, f.lon) : destination(resolve(f.from, depth + 1), f.brg, f.dist);
    lls.set(id, ll);
    return ll;
  };
  const fixes = new Map<string, Fix>();
  for (const id of Object.keys(spec.fixes)) {
    const ll = resolve(id);
    const f = spec.fixes[id];
    fixes.set(id, { id, ll, p: proj.toXY(ll), kind: f.kind ?? 'fix', note: f.note });
  }
  const fx = (id: string) => {
    const f = fixes.get(id);
    if (!f) throw new Error(`Unknown fix ${id}`);
    return f.p;
  };
  const legs = (ls: { fix: string; min?: LevelSpec; max?: LevelSpec; spd?: number }[]): Leg[] =>
    ls.map((l) => ({ fix: l.fix, p: fx(l.fix), min: parseLevel(l.min), max: parseLevel(l.max), spd: l.spd }));
  const poly = (ps: PolySpec): XY[] => {
    const out: XY[] = [];
    for (const item of ps) {
      if ('lat' in item) out.push(proj.toXY(parseLatLon(item.lat, item.lon)));
      else {
        const c = proj.toXY(parseLatLon(item.arcCentre.lat, item.arcCentre.lon));
        const start = out[out.length - 1];
        const end = proj.toXY(parseLatLon(item.to.lat, item.to.lon));
        let a0 = Math.atan2(start.x - c.x, start.y - c.y) / DEG;
        let a1 = Math.atan2(end.x - c.x, end.y - c.y) / DEG;
        if (item.dir === 'cw') { while (a1 <= a0) a1 += 360; } else { while (a1 >= a0) a1 -= 360; }
        const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 8));
        for (let i = 1; i < n; i++) {
          const a = (a0 + ((a1 - a0) * i) / n) * DEG;
          out.push({ x: c.x + Math.sin(a) * item.radius, y: c.y + Math.cos(a) * item.radius });
        }
        out.push(end);
      }
    }
    return out;
  };
  const area = (a: PackSpec['ctr']): Area => ({ name: a.name, poly: poly(a.poly), floor: parseLevel(a.floor)!, ceiling: parseLevel(a.ceiling)!, approx: a.approx, note: a.note, cls: a.cls, hours: a.hours });

  const runways = new Map<string, Runway>();
  for (const r of spec.runways) {
    runways.set(r.id, {
      id: r.id, thr: proj.toXY(parseLatLon(r.thr.lat, r.thr.lon)), crs: r.crsTrue, elevation: r.elevation, lengthM: r.lengthM,
      ils: r.ils, rnp: r.rnp, ifFix: r.if.fix, ifAlt: r.if.alt, faf: r.faf.fix, fafAlt: r.faf.alt, missed: r.missed,
      contingency: !!r.contingency, notes: r.notes,
      gpDeg: r.gpDeg, tch: r.tch, missedAlt: r.missedAlt, missedSpd: r.missedSpd,
    });
  }
  return {
    spec, proj, arp: { x: 0, y: 0 }, meta: spec.meta, sectorCeiling: parseLevel(spec.meta.sectorCeiling)!,
    fixes, runways, preferredRunways: spec.preferredRunways,
    strips: spec.strips.map((s) => ({ ends: s.ends, a: proj.toXY(parseLatLon(s.drawFrom.lat, s.drawFrom.lon)), b: proj.toXY(parseLatLon(s.drawTo.lat, s.drawTo.lon)) })),
    stars: spec.stars.map((s) => ({ name: s.name, runways: s.runways, legs: legs(s.legs), handoffLevel: parseLevel(s.handoffLevel)!, atcDiscretion: s.atcDiscretion })),
    transitions: spec.transitions.map((s) => ({ name: s.name, runways: s.runways, legs: legs(s.legs), atcDiscretion: s.atcDiscretion })),
    sids: spec.sids.map((s) => ({ name: s.name, runways: s.runways, legs: legs(s.legs), initialClimb: parseLevel(s.initialClimb)!, exitFix: s.exitFix, atcDiscretion: s.atcDiscretion })),
    holds: spec.holds.map((h) => ({ fix: h.fix, p: fx(h.fix), inbound: h.inboundTrue, turn: h.turn, min: parseLevel(h.minAlt)!, max: parseLevel(h.maxAlt)!, spd: h.maxSpd, atcDiscretion: h.atcDiscretion })),
    ctr: area(spec.ctr), tma: area(spec.tma), tsas: spec.tsas.map(area),
    mva: spec.mva.map((m) => ({ alt: m.alt, poly: poly(m.poly) })),
    vfrRoutes: spec.vfrRoutes,
    mapLines: spec.mapLines.map((l) => ({ name: l.name, style: l.style, pts: l.points.map(fx) })),
    tmaParts: spec.tmaParts?.map(area),
    runwayConfigs: spec.runwayConfigs?.length ? spec.runwayConfigs : spec.preferredRunways.map((r) => ({ land: r, dep: r })),
    units: unitsOf(spec),
    stackFix: spec.stackFix ?? spec.transitions[0]?.legs[0]?.fix ?? spec.stars[0]?.legs[spec.stars[0].legs.length - 1]?.fix ?? '',
    reservedAreasName: spec.reservedAreasName ?? 'TSA',
    utcOffsetWinter: spec.utcOffsetWinter ?? 1,
    depXfl: parseLevel(spec.depXfl ?? 'F090')!,
  };
}

/** Transition level from the published QNH table (ENR 1.7), or undefined when the pack has none. QNH is the whole-hPa value ATC passes. */
export function tlFromTable(meta: PackSpec['meta'], qnh: number): number | undefined {
  const row = meta.tlTable?.find((r) => qnh >= r.qnhMin && qnh <= r.qnhMax);
  if (row) return row.fl;
  if (!meta.tlTable?.length) return undefined;
  const lo = meta.tlTable.reduce((a, b) => (a.qnhMin < b.qnhMin ? a : b));
  const hi = meta.tlTable.reduce((a, b) => (a.qnhMax > b.qnhMax ? a : b));
  return qnh < lo.qnhMin ? lo.fl : hi.fl;
}

export function mvaAt(pack: Pack, p: XY, pointInPolygon: (p: XY, poly: XY[]) => boolean): number {
  for (const m of pack.mva) if (pointInPolygon(p, m.poly)) return m.alt;
  return 3000;
}
