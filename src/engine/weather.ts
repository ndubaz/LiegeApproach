import { angDiff, DEG } from '../geo';
import type { Pack } from '../pack/load';

export interface Weather {
  windDir: number;   // true, from
  windKt: number;
  gustKt?: number;
  visM: number;
  rvrM?: number;
  ceilingFt?: number;
  qnh: number;
  temp: number;
  dew: number;
  wx?: string;       // e.g. "FG", "TSRA"
  cb?: boolean;
  raw: string;
}

export function parseMetar(raw: string): Weather {
  const w: Weather = { windDir: 220, windKt: 8, visM: 9999, qnh: 1013, temp: 12, dew: 8, raw: raw.trim() };
  const tok = raw.trim().split(/\s+/);
  for (const t of tok) {
    let m;
    if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/))) {
      w.windDir = m[1] === 'VRB' ? w.windDir : Number(m[1]);
      w.windKt = Number(m[2]);
      if (m[3]) w.gustKt = Number(m[3]);
    } else if ((m = t.match(/^(\d{4})$/))) {
      w.visM = Number(m[1]);
    } else if (t === 'CAVOK') {
      w.visM = 9999;
    } else if ((m = t.match(/^R\d{2}[LRC]?\/[PM]?(\d{4})/))) {
      w.rvrM = Math.min(w.rvrM ?? 9999, Number(m[1]));
    } else if ((m = t.match(/^(BKN|OVC|VV)(\d{3})/))) {
      const c = Number(m[2]) * 100;
      if (w.ceilingFt === undefined || c < w.ceilingFt) w.ceilingFt = c;
      if (t.endsWith('CB')) w.cb = true;
    } else if ((m = t.match(/^(FEW|SCT)\d{3}CB$/))) {
      w.cb = true;
    } else if ((m = t.match(/^(M?\d{2})\/(M?\d{2})$/))) {
      w.temp = Number(m[1].replace('M', '-'));
      w.dew = Number(m[2].replace('M', '-'));
    } else if ((m = t.match(/^Q(\d{4})$/))) {
      w.qnh = Number(m[1]);
    } else if (/^[-+]?(FG|BR|RA|SN|TS|TSRA|DZ|SHRA|BCFG)$/.test(t)) {
      w.wx = t;
    }
  }
  return w;
}

export function buildMetar(icao: string, w: Omit<Weather, 'raw'>, dayHHMM: string, rwy = '22L'): string {
  const wind = `${String(Math.round(w.windDir / 10) * 10).padStart(3, '0')}${String(w.windKt).padStart(2, '0')}${w.gustKt ? 'G' + w.gustKt : ''}KT`;
  const vis = w.visM >= 9999 ? '9999' : String(w.visM).padStart(4, '0');
  const rvr = w.rvrM ? ` R${rwy}/${String(w.rvrM).padStart(4, '0')}` : '';
  const wx = w.wx ? ` ${w.wx}` : '';
  const cld = w.ceilingFt !== undefined ? ` ${w.ceilingFt < 300 && w.visM < 800 ? 'VV' : 'BKN'}${String(Math.round(w.ceilingFt / 100)).padStart(3, '0')}${w.cb ? 'CB' : ''}` : w.cb ? ' SCT030CB' : ' FEW035';
  const t = (v: number) => (v < 0 ? 'M' : '') + String(Math.abs(Math.round(v))).padStart(2, '0');
  return `${icao} ${dayHHMM}Z ${wind} ${vis}${rvr}${wx}${cld} ${t(w.temp)}/${t(w.dew)} Q${w.qnh} NOSIG`;
}

export function windComponents(rwyCrsTrue: number, windFrom: number, kt: number) {
  const a = angDiff(rwyCrsTrue, windFrom) * DEG;
  return { head: Math.round(kt * Math.cos(a)), cross: Math.round(kt * Math.sin(a)) };
}

/** AIP rule: crosswind incl. gusts ≤ 15 kt, tailwind incl. gusts ≤ 5 kt. */
export function selectRunway(pack: Pack, w: Weather, current?: string): string {
  const kt = Math.max(w.windKt, w.gustKt ?? 0);
  const ok = (id: string) => {
    const r = pack.runways.get(id)!;
    const c = windComponents(r.crs, w.windDir, kt);
    return c.head >= -5 && Math.abs(c.cross) <= 15;
  };
  // the landing runways in preference order (the pack's configurations, else its preferred list)
  const prefs = pack.runwayConfigs?.length ? pack.runwayConfigs.map((c) => c.land) : pack.preferredRunways;
  if (current && ok(current) && prefs.includes(current)) return current;
  for (const id of prefs) if (ok(id)) return id;
  // Nothing within limits: take the one with most headwind
  return [...prefs].sort((a, b) => windComponents(pack.runways.get(b)!.crs, w.windDir, kt).head - windComponents(pack.runways.get(a)!.crs, w.windDir, kt).head)[0];
}

/** Lowest flight level giving at least 1,000 ft above the transition altitude. */
export function transitionLevel(qnh: number, ta: number): number {
  for (let fl = 50; fl <= 100; fl += 5) {
    if (fl * 100 + (qnh - 1013.25) * 27 >= ta + 1000) return fl;
  }
  return 100;
}

export const isLvp = (w: Weather) => (w.rvrM !== undefined && w.rvrM < 550) || (w.ceilingFt !== undefined && w.ceilingFt < 200) || w.visM < 800;
export const isImc = (w: Weather) => w.visM < 5000 || (w.ceilingFt !== undefined && w.ceilingFt < 1500);

/** Wind at altitude: surface wind veers ~20° and strengthens with height. */
export function windAt(w: Weather, alt: number) {
  const f = Math.min(1, Math.max(0, (alt - 650) / 3000));
  return { dir: w.windDir + 20 * f, kt: w.windKt * (0.85 + 0.55 * f) };
}

/**
 * The runway configuration in use for this wind: the first preferred pair whose landing runway is within the AIP
 * limits, else the one with most headwind. `forced` (a scenario's runway) picks the pair with that landing runway.
 */
export function selectConfig(pack: Pack, w: Weather, forced?: string): { land: string; dep: string } {
  const cfgs = pack.runwayConfigs.length ? pack.runwayConfigs : pack.preferredRunways.map((r) => ({ land: r, dep: r }));
  if (forced) return cfgs.find((c) => c.land === forced) ?? { land: forced, dep: forced };
  const land = selectRunway(pack, w);
  return cfgs.find((c) => c.land === land) ?? { land, dep: land };
}

/** European daylight saving time: from the last Sunday of March, 01:00 UTC, to the last Sunday of October, 01:00 UTC. `date` is yyyy-mm-dd. */
export function isDst(date: string): boolean {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const y = Number(m[1]);
  const lastSunday = (month: number) => { const d = new Date(Date.UTC(y, month + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
  const t = Date.UTC(y, Number(m[2]) - 1, Number(m[3]), 12);
  return t >= Date.UTC(y, 2, lastSunday(2), 1) && t < Date.UTC(y, 9, lastSunday(9), 1);
}

/** A METAR for a pack and a weather kind, with the wind set for its first preferred runway (the strings Liège free play has always used). */
export function presetMetar(pack: Pack, kind: 'good' | 'windy-ne' | 'lvp' | 'storms', hhmm = '0140'): string {
  const land = pack.runwayConfigs[0]?.land ?? pack.preferredRunways[0];
  const r = pack.runways.get(land)!;
  const mag = Math.round(((r.crs - pack.meta.magVar + 360) % 360) / 10) * 10;
  const dir = (off: number) => String(((mag + off + 360) % 360) || 360).padStart(3, '0');
  const icao = pack.meta.icao;
  switch (kind) {
    case 'good': return `${icao} 12${hhmm}Z ${dir(0)}08KT 9999 FEW035 12/07 Q1018 NOSIG`;
    case 'windy-ne': return `${icao} 12${hhmm}Z ${dir(180)}16G26KT 9999 SCT025 09/04 Q1004 NOSIG`;
    case 'lvp': return `${icao} 12${hhmm}Z ${dir(-10)}04KT 0300 R${land}/0350 FG VV001 08/08 Q1022 NOSIG`;
    case 'storms': return `${icao} 12${hhmm}Z ${dir(-20)}12G22KT 8000 TSRA SCT030CB BKN060 21/17 Q1009 TEMPO TSRA`;
  }
}
