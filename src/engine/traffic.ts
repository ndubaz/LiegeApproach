import { Rng } from './rng';
import type { Scenario, SpawnSpec, Storm } from './types';
import { parseMetar, selectRunway } from './weather';
import type { Pack } from '../pack/load';

// Operators that fly freighters into Liège, with the types they typically use.
export const CARGO_OPS: { op: string; types: string[]; w: number }[] = [
  { op: 'FDX', types: ['B77L', 'MD11', 'B763'], w: 4 },
  { op: 'QTR', types: ['B77L', 'B748'], w: 4 },
  { op: 'THY', types: ['A332', 'B77L'], w: 3 },
  { op: 'ETH', types: ['B77L', 'B763'], w: 3 },
  { op: 'CHG', types: ['B748', 'B744'], w: 3 },
  { op: 'TAY', types: ['B744', 'B763', 'B738'], w: 4 },
  { op: 'MSR', types: ['A332'], w: 1 },
  { op: 'AZG', types: ['B748', 'B744'], w: 2 },
  { op: 'CAO', types: ['B77L'], w: 1 },
  { op: 'CKS', types: ['B744', 'B77L'], w: 2 },
  { op: 'CLX', types: ['B748', 'B744'], w: 2 },
  { op: 'DHK', types: ['B763', 'A306'], w: 2 },
  { op: 'BCS', types: ['A306', 'B752'], w: 2 },
];
export const PAX_OPS: { op: string; types: string[]; w: number }[] = [
  { op: 'JAF', types: ['B738'], w: 3 },
  { op: 'RYR', types: ['B738'], w: 2 },
  { op: 'BEL', types: ['A320', 'A321'], w: 2 },
  { op: 'TRA', types: ['B738'], w: 1 },
];

export const ARR_STAR_BASES = [
  { base: 'KOK7', w: 3 }, { base: 'CIV7', w: 3 }, { base: 'NIK7', w: 2 }, { base: 'LNO6', w: 3 }, { base: 'GESLO6', w: 2 },
];
export const starFor = (base: string, rwy: string) => base + (rwy.startsWith('22') ? 'X' : 'D');
export const DEP_SIDS: Record<string, { name: string; w: number }[]> = {
  '22': [{ name: 'LNO9S', w: 3 }, { name: 'CIV5S', w: 2 }, { name: 'BUB9S', w: 2 }],
  '04': [{ name: 'LNO2R', w: 3 }, { name: 'CIV6R', w: 2 }, { name: 'BUB1R', w: 2 }],
};
export const sidFor = (rng: Rng, rwy: string) => rng.weighted(DEP_SIDS[rwy.slice(0, 2)].map((s) => ({ w: s.w, v: s.name })));

export class CallsignPool {
  used = new Set<string>();
  constructor(private rng: Rng) {}
  make(op: string): string {
    for (let i = 0; i < 50; i++) {
      const n = this.rng.chance(0.5) ? this.rng.int(10, 999) : this.rng.int(1000, 9899);
      const suffix = this.rng.chance(0.25) ? String.fromCharCode(65 + this.rng.int(0, 25)) : '';
      const cs = `${op}${n}${suffix}`;
      if (!this.used.has(cs)) { this.used.add(cs); return cs; }
    }
    return `${op}${this.used.size + 100}`;
  }
  reg(): string {
    const L = 'ABCDEFGHIJKLMNOPRSTUVW';
    const cs = `OO${L[this.rng.int(0, L.length - 1)]}${L[this.rng.int(0, L.length - 1)]}${L[this.rng.int(0, L.length - 1)]}`;
    this.used.add(cs);
    return cs;
  }
}

export interface FreePlayOpts {
  template: 'night' | 'day' | 'quiet';
  durationMin: number;
  military: 0 | 1 | 2 | 3;
  weather: 'good' | 'windy-ne' | 'lvp' | 'storms' | 'live';
  liveMetar?: string;
  emergencies: boolean;
  difficulty: 1 | 2 | 3 | 4 | 5;
  seed?: number;
}

export const TEMPLATES = {
  night: { title: 'Night bank', arrPerHr: 18, depPerHr: 9, start: '01:40', paxShare: 0 },
  day: { title: 'Daytime mix', arrPerHr: 11, depPerHr: 9, start: '10:15', paxShare: 0.25 },
  quiet: { title: 'Quiet hour', arrPerHr: 6, depPerHr: 4, start: '15:30', paxShare: 0.2 },
};

export const WEATHER_PRESETS: Record<string, string> = {
  good: 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG',
  'windy-ne': 'EBLG 120140Z 04016G26KT 9999 SCT025 09/04 Q1004 NOSIG',
  lvp: 'EBLG 120140Z 21004KT 0300 R22L/0350 FG VV001 08/08 Q1022 NOSIG',
  storms: 'EBLG 120140Z 20012G22KT 8000 TSRA SCT030CB BKN060 21/17 Q1009 TEMPO TSRA',
};

/** Build a free-play scenario from options. */
export function freePlay(pack: Pack, o: FreePlayOpts): Scenario {
  const seed = o.seed ?? Math.floor(Math.random() * 1e9);
  const rng = new Rng(seed);
  const tpl = TEMPLATES[o.template];
  const metar = o.weather === 'live' && o.liveMetar ? o.liveMetar : WEATHER_PRESETS[o.weather === 'live' ? 'good' : o.weather];
  const rwy = selectRunway(pack, parseMetar(metar));
  const cs = new CallsignPool(rng);
  const spawns: SpawnSpec[] = [];
  const dur = o.durationMin * 60;
  const lastArr = dur - 14 * 60;
  const nArr = Math.max(1, Math.round((tpl.arrPerHr * o.durationMin) / 60));
  const nDep = Math.round((tpl.depPerHr * o.durationMin) / 60);
  let t = 5;
  const gap = Math.max(80, lastArr / nArr);
  for (let i = 0; i < nArr; i++) {
    const pax = rng.chance(tpl.paxShare);
    const op = rng.weighted((pax ? PAX_OPS : CARGO_OPS).map((x) => ({ w: x.w, v: x })));
    const base = rng.weighted(ARR_STAR_BASES.map((b) => ({ w: b.w, v: b.base })));
    spawns.push({ t: Math.round(t), kind: 'arr', cs: cs.make(op.op), type: rng.pick(op.types), star: starFor(base, rwy), spawnDist: rng.range(36, 46) });
    t += gap * rng.range(0.6, 1.4);
  }
  for (let i = 0; i < nDep; i++) {
    const op = rng.weighted(CARGO_OPS.map((x) => ({ w: x.w, v: x })));
    spawns.push({ t: Math.round(rng.range(60, dur - 300)), kind: 'dep', cs: cs.make(op.op), type: rng.pick(op.types), sid: sidFor(rng, rwy) });
  }
  // Military and transient traffic
  const extras: SpawnSpec[] = [];
  const at = () => Math.round(rng.range(120, dur - 600));
  if (o.military >= 1) {
    extras.push({ t: at(), kind: 'vfr', cs: cs.reg(), type: rng.pick(['C172', 'PA28']), route: ['ROMEO', 'FOXHE'], from: { brg: 300, dist: 7 }, level: { ft: 1500 }, request: { kind: 'crossing', route: ['ROMEO', 'FOXHE'] } });
    extras.push({ t: at(), kind: 'heli', cs: 'LIFE3', type: 'EC45', route: ['NOVEM', 'CHU'], from: { brg: 5, dist: 8 }, level: { ft: 1500 }, request: { kind: 'direct', fix: 'CHU' } });
  }
  if (o.military >= 2) {
    extras.push({ t: at(), kind: 'mil', cs: 'BAF' + rng.int(51, 79), type: 'F35', formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: { fl: 70 }, spd: 300, request: { kind: 'climb', level: { fl: 150 } } });
    extras.push({ t: at(), kind: 'mil', cs: 'NATO0' + rng.int(1, 9), type: 'E3TF', route: ['G_ETNG', 'ECHO', 'LNO', 'GIREL'], from: { brg: 30, dist: 3 }, level: { ft: 4000 }, request: { kind: 'climb', level: { fl: 150 } } });
    extras.push({ t: at(), kind: 'vfr', cs: cs.reg(), type: 'PA28', route: ['OSCAR', 'INDIA'], from: { brg: 150, dist: 7 }, level: { ft: 1500 }, request: { kind: 'crossing', route: ['OSCAR', 'INDIA'] } });
  }
  if (o.military >= 3) {
    extras.push({ t: at(), kind: 'ovf', cs: 'RCH' + rng.int(100, 899), type: 'C17', route: ['BUB', 'LG013', 'LNO'], from: { brg: 300, dist: 6 }, level: { fl: 90 }, request: { kind: 'direct', fix: 'LNO' } });
    extras.push({ t: at(), kind: 'cal', cs: 'FCK12', type: 'B350', route: ['NOVEM'], from: { brg: 0, dist: 10 }, level: { ft: 3000 }, request: { kind: 'lowpass' } });
    extras.push({ t: at(), kind: 'mil', cs: 'BAF7' + rng.int(10, 99), type: 'A400', route: ['ROMEO', 'ALHUV', 'SPA'], from: { brg: 300, dist: 10 }, level: { fl: 60 }, request: { kind: 'climb', level: { fl: 90 } } });
  }
  spawns.push(...extras);
  // Emergencies
  if (o.emergencies) {
    const arrivals = spawns.filter((s) => s.kind === 'arr');
    const deps = spawns.filter((s) => s.kind === 'dep');
    const pickType = rng.pick(['smoke', 'radio', 'engine'] as const);
    if (pickType === 'engine' && deps.length) rng.pick(deps).emergency = { after: rng.int(60, 150), type: 'engine' };
    else if (arrivals.length > 2) rng.pick(arrivals.slice(1, -1)).emergency = { after: rng.int(60, 240), type: pickType === 'engine' ? 'smoke' : pickType };
  }
  const events: Scenario['events'] = [];
  let storms: Storm[] | undefined;
  if (o.weather === 'storms') storms = [{ p: { x: -14, y: -10 }, r: 4, vx: 8, vy: 10 }, { p: { x: -22, y: 6 }, r: 3.5, vx: 9, vy: 6 }, { p: { x: 8, y: -20 }, r: 5, vx: 4, vy: 9 }];
  if (o.military >= 2) events.push({ t: Math.round(dur * 0.4), kind: 'tsa', name: 'TSA29A', on: true }, { t: Math.round(dur * 0.85), kind: 'tsa', name: 'TSA29A', on: false });
  events.sort((a, b) => a.t - b.t);
  return {
    id: 'free', title: `Free play · ${tpl.title}`, desc: 'Generated session', seed, durationMin: o.durationMin, startUtc: tpl.start, metar,
    runway: rwy, spawns, events, storms, readbackErr: [0, 0.02, 0.04, 0.06, 0.08, 0.1][o.difficulty], confusion: o.difficulty >= 4, freePlay: true,
  };
}
