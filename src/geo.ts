// Geometry helpers. The sim works on a flat local plane in nautical miles
// centred on the airport reference point: x = east, y = north. Within ~120 NM
// the distortion of this equirectangular projection is well under 1%.

export interface LatLon { lat: number; lon: number }
export interface XY { x: number; y: number }

const R_NM = 3440.065;
export const DEG = Math.PI / 180;

/** Parse AIP DMS strings such as "503914.4N" / "0052813.5E". */
export function parseDms(s: string): number {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)([NSEW])$/);
  if (!m) throw new Error(`Bad DMS ${s}`);
  const body = m[1];
  const hemi = m[2];
  const isLat = hemi === 'N' || hemi === 'S';
  const degLen = isLat ? 2 : 3;
  const [intPart, frac = ''] = body.split('.');
  const d = Number(intPart.slice(0, degLen));
  const mi = Number(intPart.slice(degLen, degLen + 2) || '0');
  const se = Number((intPart.slice(degLen + 2) || '0') + (frac ? '.' + frac : ''));
  let v = d + mi / 60 + se / 3600;
  if (hemi === 'S' || hemi === 'W') v = -v;
  return v;
}

export function parseLatLon(lat: string, lon: string): LatLon {
  return { lat: parseDms(lat), lon: parseDms(lon) };
}

/** Great-circle destination from a point, true bearing (deg) and distance (NM). */
export function destination(p: LatLon, brgDeg: number, distNm: number): LatLon {
  const d = distNm / R_NM;
  const b = brgDeg * DEG;
  const la1 = p.lat * DEG;
  const lo1 = p.lon * DEG;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 / DEG, lon: lo2 / DEG };
}

export function gcDistance(a: LatLon, b: LatLon): number {
  const la1 = a.lat * DEG, la2 = b.lat * DEG;
  const dla = la2 - la1, dlo = (b.lon - a.lon) * DEG;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(h));
}

export class Projection {
  constructor(public origin: LatLon) {}
  toXY(p: LatLon): XY {
    const k = Math.cos(this.origin.lat * DEG);
    return { x: (p.lon - this.origin.lon) * 60 * k, y: (p.lat - this.origin.lat) * 60 };
  }
  toLatLon(p: XY): LatLon {
    const k = Math.cos(this.origin.lat * DEG);
    return { lat: this.origin.lat + p.y / 60, lon: this.origin.lon + p.x / (60 * k) };
  }
}

export const norm360 = (a: number) => ((a % 360) + 360) % 360;
/** Signed smallest difference b - a in (-180, 180]. */
export const angDiff = (a: number, b: number) => {
  let d = norm360(b - a);
  if (d > 180) d -= 360;
  return d;
};
export const dist = (a: XY, b: XY) => Math.hypot(b.x - a.x, b.y - a.y);
/** True bearing from a to b on the local plane. */
export const bearing = (a: XY, b: XY) => norm360(Math.atan2(b.x - a.x, b.y - a.y) / DEG);
export const move = (p: XY, brg: number, d: number): XY => ({ x: p.x + Math.sin(brg * DEG) * d, y: p.y + Math.cos(brg * DEG) * d });
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Signed cross-track distance (NM) of p from the line through a with true course crs. Positive = right of course. */
export function crossTrack(p: XY, a: XY, crs: number): number {
  const dx = p.x - a.x, dy = p.y - a.y;
  const ux = Math.sin(crs * DEG), uy = Math.cos(crs * DEG);
  return dx * uy - dy * ux;
}
/** Along-track distance of p from a along course crs. */
export function alongTrack(p: XY, a: XY, crs: number): number {
  const dx = p.x - a.x, dy = p.y - a.y;
  return dx * Math.sin(crs * DEG) + dy * Math.cos(crs * DEG);
}

export function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
