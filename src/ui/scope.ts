import { alongTrack, angDiff, bearing, crossTrack, dist, move, norm360, pointInPolygon, type XY } from '../geo';
import type { Sim } from '../engine/sim';
import type { Aircraft } from '../engine/types';
import type { Item } from '../engine/clearance';
import { levelShort } from '../engine/clearance';
import { wakeMinNm } from '../engine/perf';
import { predict, type PredPt } from '../engine/predict';
import { Rng } from '../engine/rng';
import type { Level } from '../pack/load';
import type { Settings } from '../store';

/**
 * Every colour on the scope lives here so the display can be tuned to match a
 * real position. Colour budget: red = safety only; amber = act now (one or two
 * items at most); cyan = your clearance or selection; white = assumed;
 * green = inbound/notified; blue-grey = transferred; dim grey = unconcerned.
 */
export const SKIN = {
  night: {
    bg0: '#10171d', bg1: '#162028', terrain: 'rgba(150,160,120,', ring: 'rgba(150,178,195,0.06)', ring10: 'rgba(150,178,195,0.11)', ringText: 'rgba(150,178,195,0.42)',
    rose: 'rgba(150,178,195,0.18)', border: 'rgba(170,180,190,0.32)', road: 'rgba(150,160,170,0.12)', river: 'rgba(90,140,175,0.34)', town: 'rgba(160,180,195,0.34)',
    ctr: 'rgba(125,180,210,0.42)', tma: 'rgba(125,180,210,0.17)', centreline: 'rgba(205,220,230,0.42)', centreDim: 'rgba(205,220,230,0.14)', runway: '#dfe8ed',
    fix: 'rgba(165,190,205,0.5)', fixKey: 'rgba(200,220,232,0.85)', fixText: 'rgba(165,190,205,0.58)', proc: 'rgba(110,165,200,0.15)', procText: 'rgba(130,180,210,0.42)', sid: 'rgba(170,150,215,0.11)', hold: 'rgba(160,190,210,0.22)',
    assumed: '#f2f6f8', notified: '#8fe0a2', transferred: '#7d92a2', unconcerned: '#56666f', select: '#56d2ea', urgent: '#ff5148', warn: '#ffb444', assigned: '#80d5e8',
    tsaOn: 'rgba(242,184,75,0.6)', tsaFill: 'rgba(242,184,75,0.05)', tsaOff: 'rgba(242,184,75,0.16)', mva: 'rgba(150,200,150,0.32)', mvaFill: 'rgba(150,200,150,',
    wx: ['rgba(64,128,160,0.30)', 'rgba(200,164,62,0.38)', 'rgba(222,76,96,0.48)'], wxLine: 'rgba(210,180,100,0.55)', route: 'rgba(86,210,234,0.55)', halo: 'rgba(10,16,21,0.85)', ftdi: 'rgba(200,215,225,0.85)', rbl: '#e8d36a',
    plate: 'rgba(14,22,29,0.7)', plateSel: 'rgba(14,22,29,0.85)', contour: 'rgba(150,160,120,0.18)', contourText: 'rgba(160,170,130,0.32)',
    conflictFill: 'rgba(255,81,72,0.10)', pillBg: '#3a1114', pillText: '#ffffff', gapOk: '#8fe0a2', emerText: '#0e161d', selFill: 'rgba(86,210,234,0.10)',
    chip: 'rgba(86,210,234,0.10)', chipLine: 'rgba(86,210,234,0.45)', panel: 'rgba(9,15,20,0.9)', panelLine: 'rgba(150,178,195,0.22)', gsBand: 'rgba(205,220,230,0.11)',
  },
  day: {
    bg0: '#b1bcc1', bg1: '#bec8cd', terrain: 'rgba(110,105,70,', ring: 'rgba(107,122,131,0.16)', ring10: 'rgba(107,122,131,0.3)', ringText: '#56656e',
    rose: 'rgba(107,122,131,0.42)', border: 'rgba(90,104,113,0.7)', road: 'rgba(107,122,131,0.3)', river: 'rgba(52,106,148,0.55)', town: '#56656e',
    ctr: 'rgba(55,85,105,0.7)', tma: 'rgba(55,85,105,0.36)', centreline: 'rgba(52,67,76,0.6)', centreDim: 'rgba(52,67,76,0.22)', runway: '#34434c',
    fix: '#6b7a83', fixKey: '#34434c', fixText: '#56656e', proc: 'rgba(40,90,130,0.24)', procText: 'rgba(40,80,115,0.6)', sid: 'rgba(100,70,150,0.24)', hold: 'rgba(52,67,76,0.32)',
    assumed: '#0b1720', notified: '#16743a', transferred: '#56707f', unconcerned: '#7b8a93', select: '#006f8a', urgent: '#c8102e', warn: '#9a5a00', assigned: '#006f8a',
    tsaOn: 'rgba(154,90,0,0.75)', tsaFill: 'rgba(154,90,0,0.06)', tsaOff: 'rgba(154,90,0,0.32)', mva: 'rgba(40,100,50,0.5)', mvaFill: 'rgba(40,100,50,',
    wx: ['rgba(60,130,170,0.32)', 'rgba(196,146,30,0.42)', 'rgba(200,16,46,0.40)'], wxLine: 'rgba(120,80,0,0.6)', route: 'rgba(0,111,138,0.65)', halo: 'rgba(230,236,239,0.85)', ftdi: '#34434c', rbl: '#6e5200',
    plate: 'rgba(226,232,235,0.72)', plateSel: 'rgba(230,236,239,0.9)', contour: 'rgba(95,90,55,0.24)', contourText: 'rgba(95,90,55,0.5)',
    conflictFill: 'rgba(200,16,46,0.10)', pillBg: '#c8102e', pillText: '#ffffff', gapOk: '#16743a', emerText: '#ffffff', selFill: 'rgba(0,111,138,0.10)',
    chip: 'rgba(0,111,138,0.08)', chipLine: 'rgba(0,111,138,0.5)', panel: 'rgba(212,219,223,0.94)', panelLine: 'rgba(52,67,76,0.25)', gsBand: 'rgba(52,67,76,0.08)',
  },
};
type Skin = typeof SKIN.night;

export type Field = 'cs' | 'lvl' | 'spd' | 'hdg' | 'app';
export type RadialKey = 'HDG' | 'LVL' | 'SPD' | 'DCT' | 'ILS' | 'HOLD' | 'TWR' | 'MORE';
/** One rung of the level or speed ladder. Listed top to bottom as drawn (highest first). */
export interface QuickOption { label: string; item: Item; warn?: string }
interface LabelBox { x: number; y: number; w: number; h: number; lines: number; lh: number }
type Seg = { t: string; c?: 'urgent' | 'warn' | 'assigned' | 'dim'; b?: boolean };
type Anchor = { cs?: string; p?: XY };
type Rect = { x: number; y: number; w: number; h: number };
interface Chip extends Rect { f: Field; cap: string; val: string; assigned: boolean; warn?: boolean }

export interface ScopeEvents {
  /** Tap on a track, label, strip-equivalent or edge arrow. */
  select(cs: string | undefined): void;
  /** Legacy: a drag produced an item to add to the clearance being built. Used when onQuick/stage are not provided. */
  item(cs: string, item: Item): void;
  /** Tap (no slide) on a label field or armed-label chip: open the picker for it. */
  field(cs: string, f: Field, at: { x: number; y: number }): void;
  /** Long press on a track or label when no radial menu is wired. */
  longPress(cs: string): void;
  /** Tap on empty scope. */
  emptyTap?(): void;
  /** Direct manipulation finished: send this single item now (ladder release, wheel+click, heading drag lift). */
  onQuick?(cs: string, item: Item): void;
  /** Heading drag held still for 400 ms before lift: add the item to the clearance without sending. */
  stage?(cs: string, item: Item): void;
  /** A radial-menu sector was chosen. `at` is the sector's position on the canvas (CSS px). */
  radial?(cs: string, key: RadialKey, at: { x: number; y: number }): void;
  /** Valid levels for the ladder, highest first. Missing: the scope builds its own list. */
  levelOptions?(cs: string): QuickOption[];
  /** Valid speeds for the ladder, highest first; spdmin and spd-with-until items become detents. */
  speedOptions?(cs: string): QuickOption[];
  /** An aircraft started a new call (once per call). */
  newCaller?(cs: string): void;
}

const mono = (px: number, wt = 400) => `${wt} ${px}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
const sans = (px: number, wt = 400) => `${wt} ${px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;
const RADIAL: RadialKey[] = ['HDG', 'LVL', 'SPD', 'DCT', 'ILS', 'HOLD', 'TWR', 'MORE'];
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inRect = (x: number, y: number, r: Rect, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const vib = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

/** Hand-drawn relief: approximate contours of the Condroz, Herve plateau and Ardennes (lat, lon), lightly jittered when drawn. */
const RELIEF: { pts: [number, number][]; closed?: boolean }[] = [
  { pts: [[50.86, 5.98], [50.76, 5.93], [50.69, 5.86], [50.62, 5.76], [50.57, 5.64], [50.53, 5.50], [50.49, 5.33], [50.45, 5.16], [50.40, 4.98], [50.35, 4.80], [50.30, 4.62]] },
  { pts: [[50.78, 6.14], [50.68, 6.06], [50.60, 5.97], [50.53, 5.84], [50.46, 5.66], [50.39, 5.46], [50.32, 5.26], [50.25, 5.06], [50.18, 4.88]] },
  { pts: [[50.68, 6.27], [50.59, 6.17], [50.51, 6.03], [50.43, 5.90], [50.35, 5.72], [50.27, 5.53], [50.19, 5.34], [50.10, 5.15]] },
  { pts: [[50.60, 6.36], [50.50, 6.26], [50.42, 6.12], [50.35, 5.99], [50.28, 5.84], [50.19, 5.70], [50.10, 5.52], [50.01, 5.35]] },
  { pts: [[50.535, 6.02], [50.555, 6.10], [50.535, 6.19], [50.48, 6.20], [50.455, 6.10], [50.48, 6.01]], closed: true },
  { pts: [[50.515, 6.06], [50.515, 6.12], [50.49, 6.14], [50.48, 6.08]], closed: true },
  { pts: [[50.29, 5.69], [50.28, 5.79], [50.22, 5.81], [50.19, 5.73], [50.23, 5.65]], closed: true },
  { pts: [[50.15, 5.93], [50.10, 6.04], [50.03, 6.02], [50.04, 5.90], [50.10, 5.86]], closed: true },
];
const SPOTS: { ll: [number, number]; t: string }[] = [
  { ll: [50.501, 6.093], t: '2277' }, { ll: [50.253, 5.729], t: '2139' }, { ll: [50.635, 5.92], t: '1050' },
];
const AREA_NAMES: { ll: [number, number]; t: string }[] = [
  { ll: [50.585, 6.10], t: 'H A U T E S   F A G N E S' }, { ll: [50.10, 6.22], t: 'A R D E N N E S' }, { ll: [50.38, 5.08], t: 'C O N D R O Z' },
];

export class Scope {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  center: XY = { x: 1, y: -1 };
  scale = 8; // px per NM
  selected?: string;
  rblMode = false;
  showProfile = false;
  /** Show the final-approach gap ruler beside the active centreline. */
  showRuler = true;
  /** Show 2-minute ghost predictions for assumed traffic. */
  showGhosts = true;
  marks: { cs?: string; fix?: string; text?: string }[] = [];
  /** Canvas areas (CSS px) covered by overlay controls; labels and pills keep out. The `.zoom` column next to the canvas is added automatically. */
  reserved: { x: number; y: number; w: number; h: number }[] = [];
  /** Hold fixes whose stack chip is expanded into individual labels. */
  expandedStacks = new Set<string>();
  private anim?: { s0: number; s1: number; c0: XY; c1: XY; t0: number; dur: number };
  labels = new Map<string, LabelBox>();
  private symbols = new Map<string, XY>();
  private pointers = new Map<number, { x: number; y: number }>();
  private drag?: { kind: 'pan' | 'hdg' | 'label' | 'pinch' | 'none' | 'rbl' | 'chip' | 'radial'; cs?: string; field?: Field; x0: number; y0: number; c0: XY; s0: number; d0?: number; moved: boolean; t0: number; lp?: number; a?: Anchor };
  private rblPreview?: { a: Anchor; b: XY };
  private userLabels = new Set<string>();
  rbls: { a: Anchor; b: Anchor }[] = [];
  private rblHits: { i: number; x: number; y: number }[] = [];
  private map = document.createElement('canvas');
  private mapKey = '';
  private wxTex = new Map<string, HTMLCanvasElement>();
  // prediction cache (per radar refresh)
  private pred = new Map<string, PredPt[]>();
  private predSel?: { cs: string; pts: PredPt[] };
  private predKey = '';
  private wxAhead = new Set<string>();
  // attention
  private callSeen = new Map<string, number>();
  private nextCs?: string;
  private pingAt = new Map<string, number>();
  // interaction state
  private touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  private hover?: { x: number; y: number };
  private chips: (Chip & { cs: string })[] = [];
  private edgeHits: { cs: string; x: number; y: number }[] = [];
  private stackHits: (Rect & { fix: string })[] = [];
  private radialMenu?: { cs: string; x: number; y: number; r0: number; r1: number; hover?: number };
  private ladder?: { cs: string; f: 'lvl' | 'spd'; opts: QuickOption[]; idx0: number; idx: number; box: Rect; y0: number; det: number[] };
  private staged?: { cs: string; f: 'lvl' | 'spd'; opts: QuickOption[]; idx: number; idx0: number };
  private hdg?: { cs: string; to: XY; item?: Item; text: string; sub: string; snap: 'hdg' | 'int' | 'dct' | 'none'; key: string; pts?: PredPt[]; lastMove: number; still: boolean; timer?: number; last: XY };
  private relief?: XY[][];

  constructor(public canvas: HTMLCanvasElement, public sim: Sim, public settings: Settings, public ev: ScopeEvents) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.fit();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.moveP(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hover = undefined; });
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.cancelDrag(); });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get skin(): Skin { return SKIN[this.settings.brightness]; }
  get fontPx() { return this.settings.labelSize === 'S' ? 11 : this.settings.labelSize === 'L' ? 14.5 : 12.5; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }
  fit(animate = false) {
    const half = this.w < 600 ? 31 : 26;
    const s1 = Math.min(this.w, this.h) / (2 * half), c1 = { x: 2, y: -1 };
    if (animate) this.animateTo(s1, c1); else { this.scale = s1; this.center = c1; }
  }
  animateTo(s1: number, c1: XY, dur = 260) { this.anim = { s0: this.scale, s1, c0: { ...this.center }, c1, t0: performance.now(), dur }; }
  /** Centre on a world point (used by the tutorial). */
  focus(p: XY, scale?: number) { this.animateTo(scale ?? this.scale, { ...p }, 500); }
  rangeNm() { return Math.round(Math.min(this.w, this.h) / this.scale / 2); }
  toS(p: XY) { return { x: this.w / 2 + (p.x - this.center.x) * this.scale, y: this.h / 2 - (p.y - this.center.y) * this.scale }; }
  toW(x: number, y: number): XY { return { x: this.center.x + (x - this.w / 2) / this.scale, y: this.center.y - (y - this.h / 2) / this.scale }; }
  zoomAt(x: number, y: number, f: number) {
    const before = this.toW(x, y);
    this.scale = Math.max(2.2, Math.min(60, this.scale * f));
    const after = this.toW(x, y);
    this.center = { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y };
  }
  zoom(f: number) { this.animateTo(Math.max(2.2, Math.min(60, this.scale * f)), { ...this.center }); }
  clearRbls() { this.rbls = []; }
  /** Close the radial menu, ladder and any staged wheel value. */
  closeTransient() { this.radialMenu = undefined; this.ladder = undefined; this.staged = undefined; }
  /** The aircraft CALLS would pick next (earliest awaitingSince), if any. */
  get nextCaller(): string | undefined { return this.nextCs; }
  /** Cached prediction for an aircraft (assumed traffic, plus the selected one at 4 min). */
  predictionFor(cs: string): PredPt[] | undefined { return this.predSel?.cs === cs ? this.predSel.pts : this.pred.get(cs); }

  /** Position shown on the scope: the last radar plot. */
  plot(ac: Aircraft): XY { return ac.history[ac.history.length - 1] ?? ac.p; }

  // ================= interaction =================
  private hitAircraft(x: number, y: number, r = 24): string | undefined {
    let best: string | undefined, bd = r;
    for (const [cs, s] of this.symbols) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = cs; } }
    return best;
  }
  private hitChip(x: number, y: number) { return this.chips.find((c) => inRect(x, y, c, 2)); }
  private hitLabel(x: number, y: number): { cs: string; f: Field } | undefined {
    for (const [cs, b] of [...this.labels].reverse()) {
      if (inRect(x, y, b, 3)) {
        const line = Math.floor((y - b.y) / b.lh);
        const f: Field = line <= 0 ? 'cs' : line === 1 ? 'lvl' : line === 2 ? 'spd' : line === 3 ? 'app' : 'cs';
        return { cs, f };
      }
    }
    return undefined;
  }
  private anchorAt(x: number, y: number): Anchor {
    const cs = this.hitAircraft(x, y);
    return cs ? { cs } : { p: this.toW(x, y) };
  }
  private anchorXY(a: Anchor): XY | undefined {
    if (a.cs) { const ac = this.sim.find(a.cs); return ac ? this.plot(ac) : undefined; }
    return a.p;
  }
  private cancelDrag() {
    if (this.drag?.lp) clearTimeout(this.drag.lp);
    if (this.hdg?.timer) clearTimeout(this.hdg.timer);
    this.drag = undefined; this.hdg = undefined; this.rblPreview = undefined; this.ladder = undefined;
  }
  private quick(cs: string, it: Item) {
    if (this.selected !== cs) this.ev.select(cs);
    (this.ev.onQuick ?? this.ev.item)(cs, it);
  }
  private openRadial(cs: string) {
    const s = this.symbols.get(cs);
    if (!s) return;
    if (this.selected !== cs) this.ev.select(cs);
    const r1 = this.touch ? 88 : 74, r0 = this.touch ? 30 : 24;
    const x = Math.max(r1 + 4, Math.min(this.w - r1 - 4, s.x)), y = Math.max(r1 + 4, Math.min(this.h - r1 - 4, s.y));
    this.radialMenu = { cs, x, y, r0, r1 };
    vib(10);
  }
  private radialSector(x: number, y: number): number | undefined {
    const m = this.radialMenu;
    if (!m) return undefined;
    const d = Math.hypot(x - m.x, y - m.y);
    if (d < m.r0 - 4 || d > m.r1 + 16) return undefined;
    const a = norm360(Math.atan2(x - m.x, -(y - m.y)) * 180 / Math.PI + 22.5);
    return Math.floor(a / 45) % 8;
  }
  private chooseRadial(i: number) {
    const m = this.radialMenu!;
    const a = (i * 45) * Math.PI / 180, rr = (m.r0 + m.r1) / 2;
    this.radialMenu = undefined;
    if (this.ev.radial) this.ev.radial(m.cs, RADIAL[i], { x: m.x + Math.sin(a) * rr, y: m.y - Math.cos(a) * rr });
    else this.ev.longPress(m.cs);
  }

  private down(e: PointerEvent) {
    this.anim = undefined;
    this.touch = e.pointerType !== 'mouse';
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ }
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.cancelDrag();
      this.drag = { kind: 'pinch', x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, c0: { ...this.center }, s0: this.scale, d0: Math.hypot(a.x - b.x, a.y - b.y), moved: true, t0: performance.now() };
      return;
    }
    const x = e.offsetX, y = e.offsetY;
    const base = { x0: x, y0: y, c0: { ...this.center }, s0: this.scale, moved: false, t0: performance.now() };
    // an open radial menu takes the next tap
    if (this.radialMenu) {
      const sec = this.radialSector(x, y);
      if (sec !== undefined) this.chooseRadial(sec); else this.radialMenu = undefined;
      this.drag = { kind: 'none', ...base };
      return;
    }
    const rh = this.rblHits.find((r) => Math.abs(r.x - x) < 46 && Math.abs(r.y - y) < 14);
    if (rh) { this.rbls.splice(rh.i, 1); this.drag = { kind: 'none', ...base }; return; }
    const eh = this.edgeHits.find((r) => Math.hypot(r.x - x, r.y - y) < 28);
    if (eh) {
      const ac = this.sim.find(eh.cs);
      this.ev.select(eh.cs);
      if (ac) this.animateTo(this.scale, { ...this.plot(ac) }, 420);
      this.drag = { kind: 'none', ...base };
      return;
    }
    const sh = this.stackHits.find((r) => inRect(x, y, r, 4));
    if (sh) {
      if (this.expandedStacks.has(sh.fix)) this.expandedStacks.delete(sh.fix); else this.expandedStacks.add(sh.fix);
      this.drag = { kind: 'none', ...base };
      return;
    }
    if (this.rblMode) { this.drag = { kind: 'rbl', a: this.anchorAt(x, y), ...base }; return; }
    const sym = this.hitAircraft(x, y);
    if (e.button === 2) {
      if (sym && this.ev.radial) { this.openRadial(sym); this.drag = { kind: 'radial', cs: sym, ...base }; }
      else this.drag = { kind: 'rbl', a: this.anchorAt(x, y), ...base };
      return;
    }
    const chip = this.hitChip(x, y);
    const lab = this.hitLabel(x, y);
    const symD = sym ? Math.hypot(this.symbols.get(sym)!.x - x, this.symbols.get(sym)!.y - y) : 99;
    if (chip && symD > 12) this.drag = { kind: 'chip', cs: chip.cs, field: chip.f, ...base };
    else if (sym && (!lab || symD < 16)) this.drag = { kind: 'hdg', cs: sym, ...base };
    else if (lab) this.drag = { kind: 'label', cs: lab.cs, field: lab.f, ...base };
    else this.drag = { kind: 'pan', ...base };
    const cs = this.drag.cs;
    if (cs && this.drag.kind !== 'chip') this.drag.lp = window.setTimeout(() => {
      if (this.drag && !this.drag.moved && this.drag.cs === cs) {
        this.drag.kind = 'none'; this.hdg = undefined;
        if (this.ev.radial) this.openRadial(cs); else this.ev.longPress(cs);
      }
    }, 520);
  }

  private moveP(e: PointerEvent) {
    const x = e.offsetX, y = e.offsetY;
    if (e.pointerType === 'mouse') {
      this.hover = { x, y };
      if (this.staged) { const b = this.labels.get(this.staged.cs); if (!b || !inRect(x, y, b, 40)) this.staged = undefined; }
    }
    if (this.radialMenu && (!this.drag || this.drag.kind === 'radial' || e.pointerType === 'mouse')) this.radialMenu.hover = this.radialSector(x, y);
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x, y });
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      this.scale = Math.max(2.2, Math.min(60, d.s0 * (dd / (d.d0 || dd))));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.center = { x: d.c0.x - (mx - d.x0) / this.scale, y: d.c0.y + (my - d.y0) / this.scale };
      return;
    }
    const thr = d.kind === 'chip' ? 6 : 9;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > thr) { d.moved = true; if (d.lp) clearTimeout(d.lp); }
    if (!d.moved) return;
    if (d.kind === 'pan') this.center = { x: d.c0.x - (x - d.x0) / this.scale, y: d.c0.y + (y - d.y0) / this.scale };
    else if (d.kind === 'rbl' && d.a) this.rblPreview = { a: d.a, b: this.toW(x, y) };
    else if (d.kind === 'label' && d.cs) {
      const ac = this.sim.find(d.cs);
      if (ac) { const s = this.toS(this.plot(ac)); ac.label = { dx: x - s.x - 10, dy: y - s.y - 10 }; this.userLabels.add(d.cs); }
    } else if (d.kind === 'chip' && d.cs && (d.field === 'lvl' || d.field === 'spd')) {
      if (!this.ladder) this.openLadder(d.cs, d.field, d.y0);
      if (this.ladder) this.slideLadder(y);
    } else if (d.kind === 'hdg' && d.cs) this.updateHdgDrag(d.cs, x, y);
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.pointers.delete(e.pointerId);
    if (d?.lp) clearTimeout(d.lp);
    if (!d) return;
    if (d.kind === 'pinch') { if (this.pointers.size === 0) this.drag = undefined; return; }
    this.drag = undefined;
    const x = e.offsetX, y = e.offsetY;
    if (d.kind === 'none') return;
    if (d.kind === 'radial') {
      const sec = this.radialSector(x, y);
      if (d.moved && sec !== undefined) this.chooseRadial(sec);
      return;
    }
    if (d.kind === 'rbl') {
      this.rblPreview = undefined;
      if (d.moved && d.a) { this.rbls.push({ a: d.a, b: this.anchorAt(x, y) }); if (this.rbls.length > 4) this.rbls.shift(); }
      return;
    }
    if (d.kind === 'pan' && !d.moved) { this.closeTransient(); this.ev.emptyTap?.(); return; }
    if (d.kind === 'chip' && d.cs) {
      const lad = this.ladder;
      this.ladder = undefined;
      if (lad) { if (lad.idx !== lad.idx0) { vib(8); this.quick(d.cs, lad.opts[lad.idx].item); } return; }
      if (d.moved) return;
      const st = this.staged;
      if (st && st.cs === d.cs && st.f === d.field && st.idx !== st.idx0) { this.staged = undefined; this.quick(d.cs, st.opts[st.idx].item); return; }
      if (this.selected !== d.cs) this.ev.select(d.cs);
      if (d.field && d.field !== 'cs') this.ev.field(d.cs, d.field, { x, y });
      return;
    }
    if (d.kind === 'hdg' && d.cs) {
      const hd = this.hdg;
      if (hd?.timer) clearTimeout(hd.timer);
      this.hdg = undefined;
      if (!d.moved) { this.ev.select(d.cs); return; }
      if (hd?.item) {
        vib(8);
        if (hd.still && this.ev.stage) { if (this.selected !== d.cs) this.ev.select(d.cs); this.ev.stage(d.cs, hd.item); }
        else if (this.ev.onQuick) this.quick(d.cs, hd.item);
        else { if (this.selected !== d.cs) this.ev.select(d.cs); this.ev.item(d.cs, hd.item); }
      }
      return;
    }
    if (d.kind === 'label' && d.cs && !d.moved) {
      if (this.selected !== d.cs) this.ev.select(d.cs);
      if (d.field && d.field !== 'cs') this.ev.field(d.cs, d.field, { x, y });
    }
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const chip = this.hitChip(e.offsetX, e.offsetY);
    if (chip && (chip.f === 'lvl' || chip.f === 'spd')) {
      const st = this.staged && this.staged.cs === chip.cs && this.staged.f === chip.f ? this.staged : this.makeStaged(chip.cs, chip.f);
      if (!st) return;
      const step = e.deltaY > 0 ? 1 : -1;
      st.idx = Math.max(0, Math.min(st.opts.length - 1, st.idx + step));
      this.staged = st;
      return;
    }
    this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015));
  }

  // ---------- level / speed ladders ----------
  private options(cs: string, f: 'lvl' | 'spd'): { opts: QuickOption[]; idx: number } | undefined {
    const ac = this.sim.find(cs);
    if (!ac) return undefined;
    const sim = this.sim;
    let opts = f === 'lvl' ? this.ev.levelOptions?.(cs) : this.ev.speedOptions?.(cs);
    if (!opts || !opts.length) opts = f === 'lvl' ? this.defaultLevels(ac) : this.defaultSpeeds(ac);
    let idx = 0, best = Infinity;
    opts.forEach((o, i) => {
      let d = Infinity;
      if (f === 'lvl' && o.item.k === 'lvl') d = Math.abs(sim.ftOf(o.item.lvl) - sim.ftOf(ac.cflSys ?? ac.cleared));
      if (f === 'spd' && o.item.k === 'spd' && !o.item.until) d = Math.abs(o.item.spd - (ac.spdAssigned ?? ac.ias));
      if (f === 'spd' && o.item.k === 'spdmin' && ac.spdMin) d = 0;
      if (d < best) { best = d; idx = i; }
    });
    return { opts, idx };
  }
  private defaultLevels(ac: Aircraft): QuickOption[] {
    const sim = this.sim, mva = sim.mvaAt(ac.p), out: QuickOption[] = [];
    const add = (lv: Level) => { const ft = sim.ftOf(lv); out.push({ label: lv.fl !== undefined ? `FL${String(lv.fl).padStart(3, '0')}` : `${lv.ft}`, item: { k: 'lvl', lvl: lv }, warn: ft < mva - 1 ? `MVA ${mva}` : undefined }); };
    for (let fl = 140; fl >= sim.tl; fl -= 10) add({ fl });
    for (const a of [5000, 4000, 3500, 3000, 2500, 2000]) if (a < sim.tl * 100) add({ ft: a });
    return out;
  }
  private defaultSpeeds(ac: Aircraft): QuickOption[] {
    const out: QuickOption[] = [];
    const lo = Math.max(140, Math.floor(ac.perf.vapp / 10) * 10 + 10);
    for (let v = 300; v >= lo; v -= 10) {
      if (v < ac.perf.vminClean && v + 10 >= ac.perf.vminClean) out.push({ label: `MIN CLEAN ${ac.perf.vminClean}`, item: { k: 'spdmin' } });
      if (v === 160) out.push({ label: '160 to 4 NM', item: { k: 'spd', spd: 160, until: 4 } });
      out.push({ label: String(v), item: { k: 'spd', spd: v } });
    }
    return out;
  }
  private isDetent(o: QuickOption, prev?: QuickOption) {
    if (o.item.k === 'spdmin' || (o.item.k === 'spd' && o.item.until)) return true;
    return !!o.warn && !prev?.warn;
  }
  private makeStaged(cs: string, f: 'lvl' | 'spd') {
    const r = this.options(cs, f);
    return r ? { cs, f, opts: r.opts, idx: r.idx, idx0: r.idx } : undefined;
  }
  private openLadder(cs: string, f: 'lvl' | 'spd', y0: number) {
    const r = this.options(cs, f);
    const lb = this.labels.get(cs);
    if (!r || !lb) return;
    const rowH = this.touch ? 26 : 20, rows = 9, bw = f === 'lvl' ? 92 : 128, bh = rows * rowH + 8;
    // beside the label, never over it
    const by = Math.max(30, Math.min(this.h - bh - 4, y0 - bh / 2));
    const fits = (x: number) => x >= 4 && x + bw <= this.w - 4 && !this.reservedRects().some((r) => overlap({ x, y: by, w: bw, h: bh }, r) > 0);
    const right = lb.x + lb.w + 10, left = lb.x - bw - 10;
    let bx = fits(right) ? right : fits(left) ? left : right + bw <= this.w - 4 ? right : left >= 4 ? left : Math.max(4, Math.min(this.w - bw - 4, right));
    const det: number[] = [];
    let acc = 0;
    r.opts.forEach((o, i) => { if (i > 0 && this.isDetent(o, r.opts[i - 1])) acc += 1; det.push(i + acc * 0.9); });
    this.ladder = { cs, f, opts: r.opts, idx0: r.idx, idx: r.idx, box: { x: bx, y: by, w: bw, h: bh }, y0, det };
    vib(6);
  }
  private slideLadder(y: number) {
    const L = this.ladder!;
    const rowH = this.touch ? 26 : 20;
    const pos = L.det[L.idx0] + (y - L.y0) / (rowH * 0.8);
    let best = L.idx, bd = Infinity;
    L.det.forEach((p, i) => { const d = Math.abs(p - pos); if (d < bd) { bd = d; best = i; } });
    if (best !== L.idx) {
      if (this.isDetent(L.opts[best], L.opts[best - 1]) || this.isDetent(L.opts[L.idx], L.opts[L.idx - 1])) vib(14); else vib(4);
      L.idx = best;
    }
  }

  // ---------- heading drag ----------
  private updateHdgDrag(cs: string, x: number, y: number) {
    const ac = this.sim.find(cs);
    if (!ac) return;
    const now = performance.now();
    const t = this.dragTarget(ac, x, y);
    const prev = this.hdg;
    const h = prev && prev.cs === cs ? prev : { cs, to: { x, y }, text: '', sub: '', snap: 'none' as const, key: '', lastMove: now, still: false, last: { x, y } };
    h.to = { x, y };
    if (Math.hypot(x - h.last.x, y - h.last.y) > 4) {
      h.last = { x, y }; h.lastMove = now;
      if (h.still) h.still = false;
      if (h.timer) clearTimeout(h.timer);
      h.timer = window.setTimeout(() => { if (this.hdg === h && h.item && this.ev.stage) { h.still = true; vib(12); } }, 400);
    }
    if ((t.snap === 'int' || t.snap === 'dct') && t.key !== h.key) vib(8);
    h.item = t.item; h.text = t.text; h.snap = t.snap; h.sub = t.sub;
    if (t.key !== h.key) {
      h.key = t.key;
      h.pts = t.item ? this.predictWith(ac, t.item, 120) : undefined;
    }
    this.hdg = h;
  }
  private predictWith(ac: Aircraft, it: Item, secs: number) {
    const sim = this.sim, mv = sim.pack.meta.magVar;
    return predict(sim, ac, secs, 5, (c) => {
      if (it.k === 'hdg') {
        c.mode = c.mode === 'LOC' ? 'HDG' : 'HDG';
        if (c.app?.locCap) c.app = undefined;
        c.hdgAssigned = norm360(it.hdg + mv); c.turnDir = it.dir; c.hold = undefined;
      } else if (it.k === 'dct') {
        const idx = c.route.findIndex((l) => l.fix === it.fix);
        c.route = idx >= 0 ? c.route.slice(idx) : [{ fix: it.fix, p: sim.fixP(it.fix) }];
        c.mode = 'NAV'; c.hold = undefined; c.turnDir = undefined;
        if (c.app?.locCap) c.app = undefined;
      }
    });
  }
  private dragTarget(ac: Aircraft, x: number, y: number): { item?: Item; text: string; sub: string; snap: 'hdg' | 'int' | 'dct' | 'none'; key: string } {
    const sim = this.sim, mv = sim.pack.meta.magVar;
    const from = this.toS(this.plot(ac));
    if (Math.hypot(x - from.x, y - from.y) < 22) return { text: 'CANCEL', sub: '', snap: 'none', key: 'none' };
    let best: { id: string; d: number } | undefined;
    for (const f of this.visibleFixes()) {
      // snap only to points a controller would send an IFR aircraft direct to
      if ((f.kind !== 'fix' && f.kind !== 'vor' && f.kind !== 'ndb') || /^LG0\d/.test(f.id)) continue;
      const s = this.toS(f.p);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < 24 && (!best || d < best.d)) best = { id: f.id, d };
    }
    if (best) return { item: { k: 'dct', fix: best.id }, text: `DCT ${best.id}`, sub: 'DCT FIX', snap: 'dct', key: 'dct' + best.id };
    const brgTrue = norm360(Math.atan2(x - from.x, -(y - from.y)) * 180 / Math.PI);
    const cur = norm360(ac.hdg - mv);
    const mk = (mag: number, snap: 'hdg' | 'int', sub: string) => {
      const m = Math.round(norm360(mag)) || 360;
      const diff = norm360(m - cur);
      const dir = diff < 0.5 || diff > 359.5 ? undefined : diff > 180 ? 'L' as const : 'R' as const;
      return { item: { k: 'hdg' as const, hdg: m, dir }, text: `${dir ?? 'H'}${String(m).padStart(3, '0')}`, sub, snap, key: `${snap}${m}${dir ?? ''}` };
    };
    // 30 degree intercept of the active final
    const rw = sim.rwy;
    const xte = crossTrack(ac.p, rw.thr, rw.crs);
    if (Math.abs(xte) > 0.4 && !ac.app?.locCap) {
      for (const cand of [rw.crs - 30, rw.crs + 30]) {
        const a = angDiff(rw.crs, cand);
        if (xte * a >= 0 || Math.abs(angDiff(brgTrue, cand)) > 9) continue;
        const ip = move(ac.p, cand, Math.abs(xte) * 2);
        const dI = -alongTrack(ip, rw.thr, rw.crs);
        if (dI > 3 && dI < 30) return mk(norm360(cand - mv), 'int', `INT 30° · ${dI.toFixed(0)} NM`);
      }
    }
    return mk(Math.round(norm360(brgTrue - mv) / 5) * 5, 'hdg', '');
  }

  visibleFixes() {
    const pack = this.sim.pack;
    const ids = new Set<string>(['ALHUV', 'LNO', 'GIREL', 'GSY', 'RUDIX', 'GILOM']);
    const rw = this.sim.runway;
    for (const t of pack.transitions) if (t.runways.includes(rw)) t.legs.forEach((l) => ids.add(l.fix));
    for (const s of pack.stars) if (s.runways.includes(rw)) s.legs.forEach((l) => ids.add(l.fix));
    for (const s of pack.sids) if (s.runways.includes(rw)) s.legs.forEach((l) => ids.add(l.fix));
    const r = pack.runways.get(rw)!;
    ids.add(r.faf);
    for (const [id, f] of pack.fixes) if (f.kind === 'vfr') ids.add(id);
    return [...ids].map((id) => pack.fixes.get(id)!).filter(Boolean);
  }

  // ================= static video map (cached) =================
  private path(ctx: CanvasRenderingContext2D, pts: XY[], close = true) {
    ctx.beginPath();
    pts.forEach((p, i) => { const s = this.toS(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
    if (close) ctx.closePath();
  }
  private ll(lat: number, lon: number): XY { return this.sim.pack.proj.toXY({ lat, lon }); }
  /** Relief polylines in NM, densified and jittered once so they read as hand-drawn contours. */
  private reliefLines(): XY[][] {
    if (this.relief) return this.relief;
    const rng = new Rng(4242);
    this.relief = RELIEF.map((c) => {
      const pts = c.pts.map(([la, lo]) => this.ll(la, lo));
      if (c.closed) pts.push(pts[0]);
      const out: XY[] = [];
      let ph = rng.next() * 6;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], L = dist(a, b), n = Math.max(2, Math.ceil(L / 0.6));
        const nx = -(b.y - a.y) / (L || 1), ny = (b.x - a.x) / (L || 1);
        for (let k = 0; k < n; k++) {
          const u = k / n;
          ph += 0.45 + rng.next() * 0.3;
          const j = Math.sin(ph) * 0.35 + Math.sin(ph * 2.7) * 0.15;
          out.push({ x: a.x + (b.x - a.x) * u + nx * j, y: a.y + (b.y - a.y) * u + ny * j });
        }
      }
      out.push(c.closed ? out[0] : pts[pts.length - 1]);
      return out;
    });
    return this.relief;
  }
  private smooth(ctx: CanvasRenderingContext2D, pts: XY[]) {
    const s = pts.map((p) => this.toS(p));
    ctx.beginPath();
    ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length - 1; i++) { const mx = (s[i].x + s[i + 1].x) / 2, my = (s[i].y + s[i + 1].y) / 2; ctx.quadraticCurveTo(s[i].x, s[i].y, mx, my); }
    ctx.lineTo(s[s.length - 1].x, s[s.length - 1].y);
  }
  private lvlTag(l: Level) { return l.fl !== undefined ? `FL${String(l.fl).padStart(3, '0')}` : l.ft === 0 ? 'GND' : `${l.ft} ft`; }

  private renderMap() {
    const sim = this.sim, pack = sim.pack, S = this.skin;
    const key = [this.w, this.h, this.dpr, this.center.x.toFixed(3), this.center.y.toFixed(3), this.scale.toFixed(3), sim.runway, [...sim.tsaOn].join(','), this.settings.showMva, this.settings.showProcedures, this.settings.brightness].join('|');
    if (key === this.mapKey) return;
    this.mapKey = key;
    const c = this.map;
    if (c.width !== this.canvas.width || c.height !== this.canvas.height) { c.width = this.canvas.width; c.height = this.canvas.height; }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const range = this.rangeNm();

    const g = ctx.createRadialGradient(this.w * 0.5, this.h * 0.46, 0, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.8);
    g.addColorStop(0, S.bg1); g.addColorStop(1, S.bg0);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);

    // relief: contour lines, spot heights and region names
    ctx.strokeStyle = S.contour; ctx.lineWidth = 0.8;
    for (const l of this.reliefLines()) { this.smooth(ctx, l); ctx.stroke(); }
    if (this.scale > 3.2) {
      ctx.fillStyle = S.contourText; ctx.font = mono(8.5);
      for (const sp of SPOTS) {
        const s = this.toS(this.ll(sp.ll[0], sp.ll[1]));
        ctx.beginPath(); ctx.moveTo(s.x, s.y - 3); ctx.lineTo(s.x + 3, s.y + 2); ctx.lineTo(s.x - 3, s.y + 2); ctx.closePath(); ctx.fill();
        ctx.fillText(sp.t, s.x + 5, s.y + 3);
      }
      ctx.font = sans(10, 600);
      for (const a of AREA_NAMES) { const s = this.toS(this.ll(a.ll[0], a.ll[1])); ctx.fillText(a.t, s.x - ctx.measureText(a.t).width / 2, s.y); }
    }
    if (this.settings.showMva) {
      for (const m of pack.mva) { this.path(ctx, m.poly); ctx.fillStyle = `${S.mvaFill}${m.alt >= 3500 ? 0.07 : m.alt >= 3000 ? 0.045 : 0.02})`; ctx.fill(); }
      ctx.strokeStyle = S.mva; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      for (const m of pack.mva) { this.path(ctx, m.poly); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = S.mva; ctx.font = mono(12, 600);
      for (const m of pack.mva) {
        const cpt = m.poly.reduce((a, p) => ({ x: a.x + p.x / m.poly.length, y: a.y + p.y / m.poly.length }), { x: 0, y: 0 });
        const s = this.toS(cpt); ctx.fillText(String(m.alt / 100), s.x - 8, s.y);
      }
    }

    // range rings every 5 NM; compass rose on the 25 NM ring unless zoomed far out
    const arp = this.toS({ x: 0, y: 0 });
    for (let r = 5; r <= 60; r += 5) {
      ctx.strokeStyle = r % 10 ? S.ring : S.ring10; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(arp.x, arp.y, r * this.scale, 0, Math.PI * 2); ctx.stroke();
      if (r % 10 === 0) { ctx.fillStyle = S.ringText; ctx.font = mono(10); ctx.fillText(String(r), arp.x + 3, arp.y - r * this.scale - 3); }
    }
    if (range <= 40) {
      const roseR = 25 * this.scale, mv = pack.meta.magVar;
      ctx.strokeStyle = S.rose; ctx.fillStyle = S.ringText; ctx.font = mono(10);
      for (let m = 0; m < 360; m += 5) {
        const a = (m + mv) * Math.PI / 180;
        const len = m % 30 === 0 ? 10 : m % 10 === 0 ? 6 : 3;
        const sx = Math.sin(a), sy = -Math.cos(a);
        ctx.beginPath(); ctx.moveTo(arp.x + sx * roseR, arp.y + sy * roseR); ctx.lineTo(arp.x + sx * (roseR - len), arp.y + sy * (roseR - len)); ctx.stroke();
        if (m % 30 === 0) { const t = String(m || 360).padStart(3, '0'); ctx.fillText(t, arp.x + sx * (roseR - 22) - 10, arp.y + sy * (roseR - 22) + 4); }
      }
    }

    // borders, motorways, river
    for (const l of pack.mapLines) {
      if (l.style === 'border') { ctx.strokeStyle = S.border; ctx.lineWidth = 1; ctx.setLineDash([10, 4, 2, 4]); }
      else if (l.style === 'road') { ctx.strokeStyle = S.road; ctx.lineWidth = 2.2; ctx.setLineDash([]); }
      else { ctx.strokeStyle = S.river; ctx.lineWidth = 1.6; ctx.setLineDash([]); }
      this.path(ctx, l.pts, false); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = sans(10.5, 600); ctx.fillStyle = S.road.replace(/0\.\d+\)$/, '0.32)');
    for (const l of pack.mapLines) if (l.style === 'road' && this.scale > 5) { const mid = l.pts[Math.floor(l.pts.length / 2)]; const s = this.toS(mid); ctx.fillText(l.name, s.x + 4, s.y + 12); }
    ctx.font = sans(11); ctx.fillStyle = S.town;
    for (const [, f] of pack.fixes) if (f.kind === 'town') { const s = this.toS(f.p); ctx.fillText(f.note ?? f.id, s.x + 4, s.y - 3); ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3); }

    // TMA and CTR
    ctx.strokeStyle = S.tma; ctx.lineWidth = 1; ctx.setLineDash([7, 6]); this.path(ctx, pack.tma.poly); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = S.ctr; ctx.lineWidth = 1.2; this.path(ctx, pack.ctr.poly); ctx.stroke();
    // TSAs, labelled at the centroid with their vertical limits
    for (const t of pack.tsas) {
      const on = sim.tsaOn.has(t.name);
      this.path(ctx, t.poly);
      if (on) { ctx.fillStyle = S.tsaFill; ctx.fill(); this.hatch(ctx, t.poly, S.tsaOn); }
      ctx.strokeStyle = on ? S.tsaOn : S.tsaOff; ctx.lineWidth = on ? 1.6 : 1; ctx.setLineDash(on ? [] : [3, 5]); ctx.stroke(); ctx.setLineDash([]);
      const cpt = t.poly.reduce((a, p) => ({ x: a.x + p.x / t.poly.length, y: a.y + p.y / t.poly.length }), { x: 0, y: 0 });
      const s = this.toS(cpt);
      ctx.fillStyle = on ? S.tsaOn : S.tsaOff;
      ctx.font = mono(10.5, on ? 600 : 500);
      const n = `${t.name}${on ? ' ACT' : ''}`;
      ctx.fillText(n, s.x - ctx.measureText(n).width / 2, s.y - 2);
      ctx.font = mono(9.5);
      const v = `${this.lvlTag(t.floor)}–${this.lvlTag(t.ceiling)}`;
      ctx.fillText(v, s.x - ctx.measureText(v).width / 2, s.y + 10);
    }

    // procedures and holds; names along the paths when zoomed in
    if (this.settings.showProcedures) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = S.proc;
      const arrs = [...pack.transitions, ...pack.stars].filter((t) => t.runways.includes(sim.runway));
      for (const t of arrs) { this.path(ctx, t.legs.map((l) => l.p), false); ctx.stroke(); }
      ctx.strokeStyle = S.sid; ctx.setLineDash([3, 4]);
      const sids = pack.sids.filter((t) => t.runways.includes(sim.runway));
      for (const t of sids) { this.path(ctx, t.legs.map((l) => l.p), false); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.strokeStyle = S.hold; ctx.lineWidth = 1.1;
      for (const h of pack.holds) this.racetrack(ctx, h.p, h.inbound, h.turn);
      if (range < 20) {
        ctx.font = mono(9.5, 500); ctx.fillStyle = S.procText;
        const used: Rect[] = [];
        for (const t of [...arrs, ...sids]) {
          let bi = -1, bl = 0;
          for (let i = 0; i < t.legs.length - 1; i++) { const L = dist(t.legs[i].p, t.legs[i + 1].p); if (L > bl) { bl = L; bi = i; } }
          if (bi < 0 || bl * this.scale < ctx.measureText(t.name).width + 30) continue;
          const a = this.toS(t.legs[bi].p), b = this.toS(t.legs[bi + 1].p);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const box = { x: mx - 40, y: my - 10, w: 80, h: 20 };
          if (used.some((u) => overlap(u, box) > 0)) continue;
          used.push(box);
          let ang = Math.atan2(b.y - a.y, b.x - a.x);
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
          ctx.fillText(t.name, -ctx.measureText(t.name).width / 2, -4);
          ctx.restore();
        }
      }
    }

    // extended centrelines: active runway with 1 NM ticks, the opposite end faint
    const rw = sim.rwy;
    const fin = (r: typeof rw, d: number) => this.toS(move(r.thr, r.crs + 180, d));
    for (const [, r] of pack.runways) {
      if (r.id === rw.id || r.contingency) continue;
      ctx.strokeStyle = S.centreDim; ctx.setLineDash([3, 6]); ctx.lineWidth = 1;
      const a = fin(r, 0), b = fin(r, 10); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = S.centreline; ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    { const a = fin(rw, 0), b = fin(rw, 18); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.font = mono(9.5); ctx.fillStyle = S.ringText;
    for (let d = 1; d <= 18; d++) {
      const cpt = move(rw.thr, rw.crs + 180, d);
      const len = d % 5 === 0 ? 0.6 : 0.25;
      const p1 = this.toS(move(cpt, rw.crs + 90, len)), p2 = this.toS(move(cpt, rw.crs - 90, len));
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      if (d % 5 === 0 && this.scale > 6 && !this.showRuler) { const lp = this.toS(move(cpt, rw.crs + 90, 1)); ctx.fillText(String(d), lp.x - 4, lp.y + 3); }
    }
    for (const st of pack.strips) {
      const active = st.ends.includes(sim.runway);
      const brg = bearing(st.a, st.b);
      const half = Math.max(active ? 1.7 : 1.2, (45 / 1852) * this.scale / 2);
      const n = { x: Math.cos(brg * Math.PI / 180), y: Math.sin(brg * Math.PI / 180) };
      const A = this.toS(st.a), B = this.toS(st.b);
      ctx.fillStyle = S.runway; ctx.globalAlpha = active ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(A.x + n.x * half, A.y + n.y * half); ctx.lineTo(B.x + n.x * half, B.y + n.y * half);
      ctx.lineTo(B.x - n.x * half, B.y - n.y * half); ctx.lineTo(A.x - n.x * half, A.y - n.y * half); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.font = mono(10.5, 600); ctx.fillStyle = S.fixText;
    const thrS = this.toS(move(rw.thr, rw.crs + 180, 0.6)); ctx.fillText(rw.id, thrS.x + 6, thrS.y + 12);

    const key2 = new Set(['ALHUV', rw.ifFix, rw.faf]);
    const showText = this.scale > 4;
    for (const f of this.visibleFixes()) {
      const s = this.toS(f.p);
      if (s.x < -30 || s.y < -30 || s.x > this.w + 30 || s.y > this.h + 30) continue;
      const k = key2.has(f.id);
      ctx.strokeStyle = k ? S.fixKey : S.fix; ctx.lineWidth = k ? 1.3 : 1;
      ctx.beginPath();
      if (f.kind === 'vor') { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const px = s.x + Math.cos(a) * 5.5, py = s.y + Math.sin(a) * 5.5; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); ctx.moveTo(s.x + 1, s.y); ctx.arc(s.x, s.y, 1, 0, Math.PI * 2); }
      else if (f.kind === 'vfr') { ctx.rect(s.x - 3, s.y - 3, 6, 6); }
      else { ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x + 4.5, s.y + 3.2); ctx.lineTo(s.x - 4.5, s.y + 3.2); ctx.closePath(); }
      ctx.stroke();
      if (showText || k) { ctx.fillStyle = k ? S.fixKey : S.fixText; ctx.font = mono(10, k ? 600 : 400); ctx.fillText(f.id, s.x + 7, s.y + 3.5); }
    }
  }

  /** Published holding pattern: inbound leg of one minute (~3.5 NM) into the fix. */
  private racetrack(ctx: CanvasRenderingContext2D, fix: XY, inbound: number, turn: 'L' | 'R') {
    const leg = 3.5, R = 1.3, side = turn === 'R' ? 1 : -1;
    const back = move(fix, inbound + 180, leg);
    const off = (p: XY) => move(p, inbound + 90 * side, 2 * R);
    const fixO = off(fix), backO = off(back);
    const S1 = this.toS(fix), S2 = this.toS(back), S3 = this.toS(backO), S4 = this.toS(fixO);
    const rr = R * this.scale;
    const c1 = this.toS(move(fix, inbound + 90 * side, R)), c2 = this.toS(move(back, inbound + 90 * side, R));
    ctx.beginPath();
    ctx.moveTo(S2.x, S2.y); ctx.lineTo(S1.x, S1.y);
    const a1 = Math.atan2(S1.y - c1.y, S1.x - c1.x), a1e = Math.atan2(S4.y - c1.y, S4.x - c1.x);
    ctx.arc(c1.x, c1.y, rr, a1, a1e, side < 0);
    ctx.lineTo(S3.x, S3.y);
    const a2 = Math.atan2(S3.y - c2.y, S3.x - c2.x), a2e = Math.atan2(S2.y - c2.y, S2.x - c2.x);
    ctx.arc(c2.x, c2.y, rr, a2, a2e, side < 0);
    ctx.stroke();
  }

  private hatch(ctx: CanvasRenderingContext2D, pts: XY[], color: string) {
    ctx.save();
    this.path(ctx, pts);
    ctx.clip();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.22; ctx.lineWidth = 1;
    const xs = pts.map((p) => this.toS(p));
    const minX = Math.min(...xs.map((s) => s.x)), maxX = Math.max(...xs.map((s) => s.x)), minY = Math.min(...xs.map((s) => s.y)), maxY = Math.max(...xs.map((s) => s.y));
    for (let x = minX - (maxY - minY); x < maxX; x += 11) { ctx.beginPath(); ctx.moveTo(x, maxY); ctx.lineTo(x + (maxY - minY), minY); ctx.stroke(); }
    ctx.restore();
  }

  // ================= weather radar returns =================
  /** Procedural precipitation texture: fractal noise inside a soft cell, banded into three intensities. */
  private wxTexture(i: number): HTMLCanvasElement {
    const tk = `${i}:${this.settings.brightness}`;
    const cached = this.wxTex.get(tk);
    if (cached) return cached;
    const N = 128;
    const rng = new Rng(9001 + i * 7919);
    const grid = (n: number) => Array.from({ length: (n + 1) * (n + 1) }, () => rng.next());
    const octs = [{ n: 4, g: grid(4), w: 0.55 }, { n: 8, g: grid(8), w: 0.3 }, { n: 16, g: grid(16), w: 0.15 }];
    const val = (o: { n: number; g: number[] }, u: number, v: number) => {
      const x = u * o.n, y = v * o.n, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const s = (t: number) => t * t * (3 - 2 * t);
      const at = (a: number, b: number) => o.g[Math.min(o.n, b) * (o.n + 1) + Math.min(o.n, a)];
      const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * s(fx);
      const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * s(fx);
      return top + (bot - top) * s(fy);
    };
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(N, N);
    const cols = this.skin.wx.map((s) => s.match(/[\d.]+/g)!.map(Number));
    const ex = 0.75 + rng.next() * 0.5;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const dx = (u - 0.5) * 2 * ex, dy = (v - 0.5) * 2 / ex;
      const fall = Math.max(0, 1 - (dx * dx + dy * dy));
      let n = 0; for (const o of octs) n += val(o, u, v) * o.w;
      const I = fall * (0.35 + n * 0.95);
      const lvl = I > 0.78 ? 2 : I > 0.55 ? 1 : I > 0.3 ? 0 : -1;
      const k = (y * N + x) * 4;
      if (lvl < 0) { img.data[k + 3] = 0; continue; }
      const col = cols[lvl];
      img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = Math.round(col[3] * 255);
    }
    cx.putImageData(img, 0, 0);
    this.wxTex.set(tk, c);
    return c;
  }
  private drawWeather() {
    const { ctx, sim } = this;
    const S = this.skin;
    ctx.imageSmoothingEnabled = true;
    sim.storms.forEach((st, i) => {
      const s = this.toS(st.p);
      const size = st.r * 2.6 * this.scale;
      // slow internal drift: the cell turns and breathes over minutes
      const rot = sim.t * 0.00035 * (i % 2 ? -1 : 1);
      const k = 1 + 0.025 * Math.sin(sim.t / 95 + i);
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(rot); ctx.scale(k, 1 / k);
      ctx.drawImage(this.wxTexture(i), -size / 2, -size / 2, size, size);
      ctx.restore();
      const v = Math.hypot(st.vx, st.vy);
      if (v < 2) return;
      const p10 = { x: st.p.x + (st.vx * 600) / 3600, y: st.p.y + (st.vy * 600) / 3600 };
      const e = this.toS(p10);
      ctx.strokeStyle = S.wxLine; ctx.lineWidth = 1; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(e.x, e.y, st.r * this.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      // motion arrow from the centre toward the +10 min position
      const ang = Math.atan2(e.y - s.y, e.x - s.x), L = Math.hypot(e.x - s.x, e.y - s.y);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y);
      ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - Math.cos(ang - 0.4) * 8, e.y - Math.sin(ang - 0.4) * 8);
      ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - Math.cos(ang + 0.4) * 8, e.y - Math.sin(ang + 0.4) * 8);
      ctx.stroke();
      if (L > 30) this.haloText(`+10 · ${Math.round(v)} kt`, e.x + st.r * this.scale * 0.72, e.y - st.r * this.scale * 0.72, mono(9.5, 500), S.wxLine);
    });
  }

  // ================= prediction cache =================
  /**
   * Refresh the prediction cache once per radar update (or after a clearance). The work is spread over a few
   * frames, at most five aircraft per frame, the selected one and the one just cleared first.
   */
  private refreshPredictions() {
    const sim = this.sim;
    const tick = `${Math.floor(sim.t / sim.radarRefresh)}|${sim.cmdLog.length}`;
    const key = `${tick}|${this.selected ?? ''}`;
    if (key !== this.predKey) {
      const tickChanged = !this.predKey.startsWith(tick + '|');
      this.predKey = key;
      if (tickChanged) {
        const live = sim.aircraft.filter((a) => a.state === 'assumed' && !a.landed && !a.remove);
        const ids = new Set(live.map((a) => a.cs));
        for (const cs of [...this.pred.keys()]) if (!ids.has(cs)) { this.pred.delete(cs); this.wxAhead.delete(cs); }
        const last = sim.cmdLog[sim.cmdLog.length - 1]?.cl.cs;
        const rank = (cs: string) => (cs === this.selected ? 0 : cs === last ? 1 : this.pred.has(cs) ? 3 : 2);
        this.predQueue = live.map((a) => a.cs).sort((a, b) => rank(a) - rank(b));
      }
      const sel = this.selected ? sim.find(this.selected) : undefined;
      this.predSel = sel && !sel.landed ? { cs: sel.cs, pts: predict(sim, sel, 240, 5, undefined, 2.5) } : undefined;
    }
    for (let n = 0; n < 5 && this.predQueue.length; n++) {
      const ac = sim.find(this.predQueue.shift()!);
      if (!ac || ac.state !== 'assumed' || ac.landed) continue;
      const pts = predict(sim, ac, 120, 5, undefined, 2.5);
      this.pred.set(ac.cs, pts);
      const hit = sim.storms.length > 0 && !ac.app?.locCap && ac.rules !== 'VFR' && pts.some((q) => sim.storms.some((st) => dist(q.p, { x: st.p.x + (st.vx * q.t) / 3600, y: st.p.y + (st.vy * q.t) / 3600 }) < st.r * 0.85));
      if (hit) this.wxAhead.add(ac.cs); else this.wxAhead.delete(ac.cs);
    }
  }
  private predQueue: string[] = [];

  // ================= dynamic layer =================
  draw(now: number) {
    const { ctx, sim } = this;
    const S = this.skin;
    if (this.anim) {
      const a = this.anim, k = Math.min(1, (performance.now() - a.t0) / a.dur), e = 1 - Math.pow(1 - k, 3);
      this.scale = a.s0 + (a.s1 - a.s0) * e;
      this.center = { x: a.c0.x + (a.c1.x - a.c0.x) * e, y: a.c0.y + (a.c1.y - a.c0.y) * e };
      if (k >= 1) this.anim = undefined;
    }
    if (this.radialMenu && !sim.find(this.radialMenu.cs)) this.radialMenu = undefined;
    if (this.staged && this.staged.cs !== this.selected) this.staged = undefined;
    this.renderMap();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.map, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    this.drawWeather();
    this.refreshPredictions();
    this.updateCallers(now);

    const obstacles: Rect[] = [];
    if (this.showProfile) obstacles.push({ x: 0, y: this.h - this.profileH() - 10, w: this.w, h: this.profileH() + 10 });
    const fp = this.fontPx;
    const lh = Math.round(fp * 1.2);
    ctx.font = mono(fp, 500);
    const cw = ctx.measureText('M').width;
    const alerts = sim.alerts();
    const alertSet = new Set(alerts.flatMap((a) => [a.a, a.b]));
    const flash = Math.floor(now / 500) % 2 === 0;

    // ---- track pass 1: classify and position
    type TR = { ac: Aircraft; s: XY; col: string; urgent: boolean; alerting: boolean; emer: boolean; sel: boolean; next: boolean; queue?: number; stacked: boolean; vEnd: XY };
    const callers = sim.callers().filter((a) => a.state === 'assumed' && sim.t >= (a.awaitingSince ?? 0));
    const qpos = new Map(callers.map((a, i) => [a.cs, i + 1]));
    const holdGroups = new Map<string, Aircraft[]>();
    for (const ac of sim.aircraft) if (ac.mode === 'HOLD' && ac.hold && !ac.landed) { const g = holdGroups.get(ac.hold.fix) ?? []; g.push(ac); holdGroups.set(ac.hold.fix, g); }
    const stackedFix = new Map<string, string>();
    for (const [fix, g] of holdGroups) if (g.length >= 3 && !this.expandedStacks.has(fix)) for (const a of g) stackedFix.set(a.cs, fix);
    const trs: TR[] = [];
    this.symbols.clear();
    const offscreen: TR[] = [];
    for (const ac of sim.aircraft) {
      const pos = this.plot(ac);
      const s = this.toS(pos);
      const emer = ac.emergency !== undefined || ac.sqk === '7700' || ac.sqk === '7600';
      const alerting = alertSet.has(ac.cs);
      const urgent = alerting || emer || sim.warningsFor(ac.cs).includes('MSAW') || this.clam(ac);
      let col = ac.state === 'assumed' ? S.assumed : ac.state === 'inbound' ? (flash ? S.notified : S.assumed) : ac.state === 'transferred' ? S.transferred : S.unconcerned;
      if (ac.state === 'inbound' && ac.awaitingSince === undefined) col = S.notified;
      if (urgent && (ac.state === 'assumed' || emer)) col = S.urgent;
      const sel = ac.cs === this.selected;
      const next = ac.cs === this.nextCs;
      const tr: TR = { ac, s, col, urgent, alerting, emer, sel, next, queue: !next ? qpos.get(ac.cs) : undefined, stacked: stackedFix.has(ac.cs) && !sel && !urgent && !next, vEnd: this.toS(move(pos, ac.trk, (ac.gs * this.settings.speedVectorMin) / 60)) };
      if (s.x < -40 || s.y < -40 || s.x > this.w + 40 || s.y > this.h + 40) { if (sel || emer || (qpos.has(ac.cs) && ac.state === 'assumed')) offscreen.push(tr); }
      if (s.x < -200 || s.y < -200 || s.x > this.w + 200 || s.y > this.h + 200) continue;
      this.symbols.set(ac.cs, s);
      trs.push(tr);
    }

    // ---- selected aircraft: planned route (faint) and 4-minute prediction
    const sel = this.selected ? sim.find(this.selected) : undefined;
    if (sel) {
      ctx.strokeStyle = S.route; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
      const pts = [this.plot(sel), ...sel.route.map((l) => l.p)];
      if (sel.mode === 'HOLD' && sel.hold) pts.push(sel.hold.p);
      if (sel.app && !sel.app.locCap) pts.push(move(sel.app.rwy.thr, sel.app.rwy.crs + 180, 10), sel.app.rwy.thr);
      if (pts.length > 1) { this.path(ctx, pts, false); ctx.stroke(); }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    this.drawFtdiChevrons();
    const rulerText = this.drawRuler();
    obstacles.push(...rulerText);

    // ---- ghosts
    if (this.showGhosts) for (const tr of trs) {
      const pts = this.pred.get(tr.ac.cs);
      if (!pts || tr.sel) continue;
      this.drawGhosts(tr.ac, pts, tr.col, 120, false, obstacles);
    }
    if (sel && this.predSel && !this.hdg) {
      const tr = trs.find((t) => t.sel);
      this.drawGhosts(sel, this.predSel.pts, S.select, 240, true, obstacles, tr?.s);
    }

    // ---- conflicts: separation bubbles and CPA
    const pills: { text: string; mid: XY; box?: Rect }[] = [];
    for (const al of alerts) {
      const A = sim.find(al.a), B = sim.find(al.b);
      if (!A || !B) continue;
      const pa = this.toS(this.plot(A)), pb = this.toS(this.plot(B));
      const r = 1.5 * this.scale;
      for (const p of [pa, pb]) {
        ctx.fillStyle = S.conflictFill; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = S.urgent; ctx.lineWidth = 1.5; ctx.setLineDash(al.kind === 'los' ? [] : [5, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
      const cpa = this.cpa(A, B);
      let mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      if (cpa && cpa.t > 0) {
        const ca = this.toS(cpa.pa), cb = this.toS(cpa.pb);
        ctx.strokeStyle = S.urgent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ca.x, ca.y); ctx.lineTo(cb.x, cb.y); ctx.stroke();
        ctx.lineWidth = 1.5;
        for (const c of [ca, cb]) { ctx.strokeRect(c.x - 3.5, c.y - 3.5, 7, 7); }
        ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(ca.x, ca.y); ctx.moveTo(pb.x, pb.y); ctx.lineTo(cb.x, cb.y); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
      }
      const d = cpa ? cpa.d : dist(A.p, B.p), v = cpa ? cpa.v : Math.abs(A.alt - B.alt), t = cpa ? cpa.t : 0;
      pills.push({ text: `${d.toFixed(1)} NM · ${Math.round(v / 100) * 100} ft · ${t > 0 ? fmtT(t) : 'now'}`, mid });
    }
    ctx.font = mono(11, 600);
    const cw11 = ctx.measureText('M').width;
    let pillsPlaced = false;
    const placePills = () => {
      if (pillsPlaced) return;
      pillsPlaced = true;
      for (const p of pills) {
        const w = p.text.length * cw11 + 14, h = 19;
        const cands = [[-w / 2, -h - 16], [-w / 2, 16], [18, -h / 2], [-w - 18, -h / 2], [18, -h - 12], [-w - 18, 12], [-w / 2, -h - 40], [-w / 2, 40], [-w / 2, -h - 64], [-w / 2, 64], [30, -h - 30], [-w - 30, 30]];
        const box = this.solve(p.mid, w, h, cands, obstacles, 4000, undefined, true);
        // weighted: labels pay five times more to sit under a conflict pill
        for (let k = 0; k < 5; k++) obstacles.push(box);
        p.box = box;
      }
    };

    // ---- RBLs under the tracks
    this.drawRbls();

    // ---- tracks: history, vector, symbol (emergencies last)
    trs.sort((a, b) => Number(a.emer) - Number(b.emer) || Number(a.sel) - Number(b.sel));
    for (const tr of trs) this.drawTrack(tr.ac, tr.s, tr.col, tr.vEnd, tr.emer, tr.sel, now);

    // ---- hold stack chips
    this.stackHits = [];
    for (const [fix, g] of holdGroups) {
      if (g.length < 3) continue;
      const f = sim.pack.fixes.get(fix);
      if (!f) continue;
      const s = this.toS(f.p);
      const expanded = this.expandedStacks.has(fix);
      const items = [...g].sort((a, b) => a.alt - b.alt).map((a) => `${levelShort(sim.levelFor(Math.round(a.alt / 100) * 100))} ${a.cs}`);
      ctx.font = mono(11, 500);
      const head = `${fix} ▸ ${expanded ? `${g.length} ▾` : ''}`;
      const one = expanded ? head : `${head}${items.join(' · ')}`;
      const multi = !expanded && ctx.measureText(one).width > this.w * 0.55;
      const listed = [...items].reverse();
      const rows = expanded ? [head] : multi ? [`${fix} ▸ ${g.length} in hold`, ...(listed.length > 6 ? [...listed.slice(0, 5), `+${listed.length - 5} more`] : listed)] : [one];
      const w = Math.max(...rows.map((r) => ctx.measureText(r).width)) + 14, h = rows.length * 15 + 7;
      const box = this.solve(s, w, h, [[12, -h - 10], [12, 10], [-w - 12, -h - 10], [-w - 12, 10], [-w / 2, 16], [-w / 2, -h - 16]], obstacles, 300);
      obstacles.push(box);
      this.stackHits.push({ ...box, fix });
      ctx.fillStyle = S.plateSel; ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = S.hold.replace(/[\d.]+\)$/, '0.7)'); ctx.lineWidth = 1; ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
      rows.forEach((r, i) => { ctx.fillStyle = i === 0 && multi ? S.ringText : S.assumed; ctx.font = mono(11, i === 0 ? 600 : 500); ctx.fillText(r, box.x + 7, box.y + 15 + i * 15); });
    }

    // ---- edge arrows for off-screen aircraft that need you (their text is a label obstacle)
    obstacles.push(...this.drawEdgeArrows(offscreen));

    // ---- labels: place by priority, then draw low priority first
    const prio = (t: TR) => (t.sel ? 0 : t.emer ? 1 : t.alerting ? 2 : t.next ? 3 : t.urgent ? 4 : t.ac.state === 'assumed' ? 5 : t.ac.state === 'inbound' ? 6 : 7);
    const onScreen = (t: TR) => t.s.x >= 0 && t.s.y >= 0 && t.s.x <= this.w && t.s.y <= this.h;
    const byPrio = [...trs].filter((t) => !t.stacked && onScreen(t)).sort((a, b) => prio(a) - prio(b));
    const prevLabels = this.labels;
    this.labels = new Map();
    this.chips = [];
    const placedLabels: { tr: TR; box: Rect; lines: Seg[][]; armed?: { chips: Chip[]; head: Seg[]; detail: Seg[]; hh: number } }[] = [];
    for (const tr of byPrio) {
      const ac = tr.ac;
      if (!tr.sel) placePills();
      let box: Rect;
      let lines: Seg[][] = [];
      let armed: { chips: Chip[]; head: Seg[]; detail: Seg[]; hh: number } | undefined;
      if (tr.sel) {
        armed = this.armedLayout(ac, cw, lh);
        const aw = Math.max(this.segW(armed.head, cw), this.segW(armed.detail, cw), ...armed.chips.map((c) => c.x + c.w)) + 8;
        const ah = armed.hh + Math.max(...armed.chips.map((c) => c.y + c.h)) + 4 + lh;
        box = this.placeLabel(tr, aw, ah, obstacles, prevLabels.get(ac.cs), true);
      } else {
        lines = this.labelLines(ac, false);
        if (this.wxAhead.has(ac.cs)) lines[0].push({ t: ' WX', c: 'warn', b: true });
        if ((this.scale < 4.6 || this.rangeNm() > 40) && !tr.urgent && !tr.next) lines = lines.slice(0, 2);
        const wch = Math.max(...lines.map((l) => this.segW(l, 1)));
        const bw = wch * cw + 6, bh = lines.length * lh + 4;
        // room for the queue number in front of the callsign
        const qw = tr.queue ? String(tr.queue).length * 6 + 10 : 0;
        box = this.placeLabel(tr, bw + qw, bh, obstacles, prevLabels.get(ac.cs), false);
        if (qw) { box = { ...box, x: box.x + qw, w: box.w - qw }; if (!this.userLabels.has(ac.cs)) ac.label = { dx: ac.label.dx + qw, dy: ac.label.dy }; }
      }
      obstacles.push(box);
      this.labels.set(ac.cs, { ...box, lines: armed ? 1 + armed.chips.length : lines.length, lh });
      placedLabels.push({ tr, box, lines, armed });
    }
    placePills();
    // FTDi texts through the solver
    for (const ft of this.ftdiTexts()) {
      ctx.font = mono(9.5, 500);
      const w = ctx.measureText(ft.text).width + 6, h = 13;
      const box = this.solve(ft.p, w, h, [[10, -6], [-w - 10, -6], [10, -h - 4], [10, 4], [-w - 10, 4], [-w - 10, -h - 4]], obstacles, 200);
      obstacles.push(box);
      this.haloText(ft.text, box.x + 3, box.y + 10, mono(9.5, 500), ft.col);
    }

    placedLabels.sort((a, b) => prio(b.tr) - prio(a.tr) || Number(a.tr.emer) - Number(b.tr.emer));
    for (const pl of placedLabels) this.drawLabel(pl.tr, pl.box, pl.lines, pl.armed, cw, lh, fp, now, flash);

    // ---- conflict pills on top
    for (const p of pills) {
      if (!p.box) continue;
      const b = p.box;
      ctx.fillStyle = S.pillBg; this.rrect(b.x, b.y, b.w, b.h, 9); ctx.fill();
      ctx.strokeStyle = S.urgent; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = S.pillText; ctx.font = mono(11, 600); ctx.fillText(p.text, b.x + 7, b.y + 13.5);
    }


    this.drawMarks(now);
    if (this.showProfile) this.drawProfile();
    this.drawHdgDrag();
    this.drawLadder();
    this.drawRadial();
    if (this.rblPreview) {
      const a = this.anchorXY(this.rblPreview.a);
      if (a) this.drawRbl(a, this.rblPreview.b, undefined, undefined);
    }

    // frame text and scale bar
    const head = this.w < 560 ? `APP ${sim.pack.meta.appFreq}  ${sim.runway}  ${sim.atis}  Q${sim.qnh}` : `${sim.pack.meta.appCallsign.toUpperCase()} ${sim.pack.meta.appFreq}  RWY ${sim.runway}  ATIS ${sim.atis}  QNH ${sim.qnh}  TL${String(sim.tl).padStart(3, '0')}`;
    this.haloText(head, 10, 18, mono(11), S.ringText);
    const rng = this.w < 560 ? `${this.rblMode ? 'RBL ' : ''}${this.rangeNm()} NM` : `${this.rblMode ? 'RBL  ' : ''}RANGE ${this.rangeNm()}  ${sim.radarRefresh}s`;
    ctx.font = mono(11);
    this.haloText(rng, this.w - ctx.measureText(rng).width - 10, 18, mono(11), this.rblMode ? S.rbl : S.ringText);
    const nm = this.scale > 14 ? 2 : this.scale > 6 ? 5 : 10;
    const by = this.showProfile ? this.h - this.profileH() - 22 : this.h - 12;
    ctx.strokeStyle = S.ringText; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, by); ctx.lineTo(10 + nm * this.scale, by); ctx.moveTo(10, by - 4); ctx.lineTo(10, by + 4); ctx.moveTo(10 + nm * this.scale, by - 4); ctx.lineTo(10 + nm * this.scale, by + 4); ctx.stroke();
    this.haloText(`${nm} NM`, 14 + nm * this.scale, by + 4, mono(11), S.ringText);
  }

  private segW(segs: Seg[], cw: number) { return segs.reduce((n, s) => n + s.t.length, 0) * cw; }
  private rrect(x: number, y: number, w: number, h: number, r: number) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /** Generic rectangle placement around a point, avoiding obstacles, symbols and the screen edge. */
  private solve(p: XY, w: number, h: number, cands: number[][], obstacles: Rect[], offPen: number, prev?: Rect, avoidSyms = false): Rect {
    let best: Rect = { x: p.x + cands[0][0], y: p.y + cands[0][1], w, h }, bs = Infinity;
    cands.forEach(([dx, dy], i) => {
      const b = { x: p.x + dx, y: p.y + dy, w, h };
      let sc = i * 3;
      for (const o of obstacles) sc += overlap(b, o);
      if (avoidSyms) for (const [, s] of this.symbols) if (inRect(s.x, s.y, b, 6)) sc += 400;
      sc += this.offCost(b, offPen);
      if (prev && Math.abs(prev.x - b.x) < 30 && Math.abs(prev.y - b.y) < 30) sc -= 80;
      if (sc < bs) { bs = sc; best = b; }
    });
    return best;
  }
  /** Cost of a box leaving the usable screen: a flat penalty plus the clipped area. Reserved areas (zoom buttons) count as clipped. */
  private offCost(b: Rect, pen: number) {
    const ix = Math.max(0, Math.min(b.x + b.w, this.w - 2) - Math.max(b.x, 2)), iy = Math.max(0, Math.min(b.y + b.h, this.h - 2) - Math.max(b.y, 24));
    const out = b.w * b.h - ix * iy;
    let c = out > 0.5 ? pen + out * 4 : 0;
    for (const r of this.reservedRects()) { const o = overlap(b, r); if (o > 0) c += pen / 2 + o * 4; }
    return c;
  }
  private resv: { t: number; r: Rect[] } = { t: -1e9, r: [] };
  /** Screen areas covered by controls over the canvas: `reserved` plus the game's zoom column if present. */
  private reservedRects(): Rect[] {
    const now = performance.now();
    if (now - this.resv.t > 1000) {
      const out = [...this.reserved];
      const z = this.canvas.parentElement?.querySelector('.zoom') as HTMLElement | null;
      if (z) {
        const c = this.canvas.getBoundingClientRect(), r = z.getBoundingClientRect();
        if (r.width > 0) out.push({ x: r.left - c.left - 4, y: r.top - c.top - 4, w: r.width + 8, h: r.height + 8 });
      }
      this.resv = { t: now, r: out };
    }
    return this.resv.r;
  }
  private placeLabel(tr: { ac: Aircraft; s: XY; sel: boolean; vEnd: XY }, bw: number, bh: number, obstacles: Rect[], prev: Rect | undefined, armed: boolean): Rect {
    const { ac, s } = tr;
    if (this.userLabels.has(ac.cs)) return { x: s.x + ac.label.dx, y: s.y + ac.label.dy, w: bw, h: bh };
    const ring1 = [[16, -bh - 8], [16, 8], [-bw - 16, -bh - 8], [-bw - 16, 8], [18, -bh / 2], [-bw - 18, -bh / 2], [-bw / 2, -bh - 18], [-bw / 2, 18]];
    const ring2 = [[40, -bh - 30], [40, 30], [-bw - 40, -bh - 30], [-bw - 40, 30], [50, -bh / 2], [-bw - 50, -bh / 2], [-bw / 2, -bh - 50], [-bw / 2, 50]];
    const vx = tr.vEnd.x - s.x, vy = tr.vEnd.y - s.y;
    let best = { dx: ring1[0][0], dy: ring1[0][1] }, bs = Infinity;
    const offPen = armed || tr.sel ? 3000 : 300;
    [...ring1, ...ring2].forEach(([dx, dy], i) => {
      const b = { x: s.x + dx, y: s.y + dy, w: bw, h: bh };
      let sc = (i % 8) * 3 + (i >= 8 ? 60 : 0);
      for (const o of obstacles) sc += overlap(b, o);
      for (const [, sy] of this.symbols) if ((sy.x !== s.x || sy.y !== s.y) && inRect(sy.x, sy.y, b, 8)) sc += 500;
      // keep clear of own speed vector and ghost path
      if ((dx + bw / 2 > 0 ? vx > 0 : vx < 0) && (dy + bh / 2 < 0 ? vy < 0 : vy > 0)) sc += 160;
      sc += this.offCost(b, offPen);
      if (this.showProfile && b.y + bh > this.h - this.profileH() - 10) sc += offPen / 2;
      if (prev && Math.abs(prev.x - b.x) < 24 && Math.abs(prev.y - b.y) < 24) sc -= 90;
      if (sc < bs) { bs = sc; best = { dx, dy }; }
    });
    ac.label = best;
    return { x: s.x + best.dx, y: s.y + best.dy, w: bw, h: bh };
  }

  private drawTrack(ac: Aircraft, s: XY, col: string, vEnd: XY, emer: boolean, sel: boolean, now: number) {
    const { ctx } = this;
    const S = this.skin;
    const pos = this.plot(ac);
    ctx.fillStyle = col;
    const hist = ac.history;
    for (let i = 0; i < hist.length - 1; i++) {
      const hs = this.toS(hist[i]); ctx.globalAlpha = 0.16 + (0.5 * (i + 1)) / (hist.length - 1);
      ctx.fillRect(hs.x - 1.2, hs.y - 1.2, 2.4, 2.4);
    }
    ctx.globalAlpha = 1;
    const vmin = this.settings.speedVectorMin;
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(vEnd.x, vEnd.y); ctx.stroke();
    for (let m = 1; m < vmin; m++) { const t = this.toS(move(pos, ac.trk, (ac.gs * m) / 60)); ctx.fillRect(t.x - 1.5, t.y - 1.5, 3, 3); }
    // symbol: shape by flight rules; heavy = thicker stroke; super (RECAT A) = filled
    const heavy = ac.perf.wake === 'H' || (ac.perf.wake as string) === 'J';
    const sup = ac.perf.recat === 'A' || (ac.perf.wake as string) === 'J';
    ctx.lineWidth = (ac.state === 'assumed' ? 1.6 : 1.2) + (heavy ? 0.9 : 0);
    ctx.beginPath();
    if (ac.rules === 'VFR') ctx.arc(s.x, s.y, 3.8, 0, Math.PI * 2);
    else if (ac.rules === 'OAT') { ctx.moveTo(s.x, s.y - 5.2); ctx.lineTo(s.x + 5.2, s.y); ctx.lineTo(s.x, s.y + 5.2); ctx.lineTo(s.x - 5.2, s.y); ctx.closePath(); }
    else ctx.rect(s.x - 3.8, s.y - 3.8, 7.6, 7.6);
    if (sup) ctx.fill();
    ctx.stroke();
    if (emer) {
      ctx.strokeStyle = S.urgent; ctx.lineWidth = 1.6;
      const k = (now % 1400) / 1400;
      ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x, s.y, 14 + k * 2, 0, Math.PI * 2); ctx.stroke();
    }
    if (sel) {
      ctx.strokeStyle = S.select; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(now / 300); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, 15 + 1.5 * Math.sin(now / 300), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // ping: a new call from the next caller
    const p0 = this.pingAt.get(ac.cs);
    if (p0 !== undefined) {
      const k = (now - p0) / 1200;
      if (k >= 1) this.pingAt.delete(ac.cs);
      else if (k >= 0) { ctx.strokeStyle = S.warn; ctx.globalAlpha = 0.9 * (1 - k); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(s.x, s.y, 8 + 22 * (1 - Math.pow(1 - k, 2)), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    }
  }

  private drawLabel(tr: { ac: Aircraft; s: XY; col: string; urgent: boolean; alerting: boolean; emer: boolean; sel: boolean; next: boolean; queue?: number }, box: Rect, lines: Seg[][], armed: { chips: Chip[]; head: Seg[]; detail: Seg[]; hh: number } | undefined, cw: number, lh: number, fp: number, now: number, flash: boolean) {
    const { ctx, sim } = this;
    const S = this.skin;
    const { ac, s, col } = tr;
    const lx = box.x, ly = box.y, bw = box.w, bh = box.h;
    // leader line from the symbol edge to the label edge
    const tx = Math.max(lx, Math.min(s.x, lx + bw)), ty = Math.max(ly, Math.min(s.y, ly + bh));
    const ang = Math.atan2(ty - s.y, tx - s.x);
    ctx.strokeStyle = tr.sel ? S.select : col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(s.x + Math.cos(ang) * 7, s.y + Math.sin(ang) * 7); ctx.lineTo(tx, ty); ctx.stroke(); ctx.globalAlpha = 1;
    // plate
    const emerPlate = tr.emer;
    ctx.fillStyle = emerPlate ? S.urgent : tr.sel ? S.plateSel : S.plate;
    ctx.fillRect(lx - 2, ly, bw, bh);
    if (tr.sel) { ctx.fillStyle = S.selFill; ctx.fillRect(lx - 2, ly, bw, bh); ctx.strokeStyle = S.select; ctx.lineWidth = 1; ctx.strokeRect(lx - 2.5, ly - 0.5, bw + 1, bh + 1); }
    if (tr.alerting && !emerPlate) { ctx.strokeStyle = S.urgent; ctx.lineWidth = 1.5; ctx.strokeRect(lx - 3, ly - 1, bw + 2, bh + 2); }
    const textCol = emerPlate ? S.emerText : col;
    const segCol = (seg: Seg) => (emerPlate ? S.emerText : seg.c === 'urgent' ? S.urgent : seg.c === 'warn' ? S.warn : seg.c === 'assigned' ? S.assigned : seg.c === 'dim' ? S.transferred : textCol);
    const drawSegs = (segs: Seg[], x: number, y: number) => {
      for (const seg of segs) { ctx.font = mono(fp, seg.b ? 600 : 500); ctx.fillStyle = segCol(seg); ctx.fillText(seg.t, x, y); x += seg.t.length * cw; }
    };
    const csW = (ac.cs.length + (ac.formation > 1 ? 2 : 0)) * cw;
    // the next caller: amber box around the callsign; other callers: queue number
    if (tr.next) {
      ctx.strokeStyle = S.warn; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.65 + 0.35 * Math.sin(now / 240);
      ctx.strokeRect(lx - 1.5, ly + 1, csW + 4, lh); ctx.globalAlpha = 1;
    } else if (tr.queue) {
      const qs = String(tr.queue), qw = qs.length * 6 + 6;
      ctx.fillStyle = S.plate; ctx.fillRect(lx - qw - 4, ly + 2, qw, lh - 2);
      ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.strokeRect(lx - qw - 3.5, ly + 2.5, qw - 1, lh - 3); ctx.globalAlpha = 1;
      ctx.fillStyle = col; ctx.font = mono(9.5, 600); ctx.fillText(qs, lx - qw - 1, ly + lh - 2);
    }
    if (!armed) {
      lines.forEach((segs, i) => drawSegs(segs, lx, ly + lh * (i + 1) - 2));
      void flash; void sim;
      return;
    }
    // armed label: header, field chips, detail line
    drawSegs(armed.head, lx, ly + lh - 2);
    const ox = lx, oy = ly + armed.hh;
    for (const c of armed.chips) {
      const st = this.staged && this.staged.cs === ac.cs && this.staged.f === c.f && this.staged.idx !== this.staged.idx0 ? this.staged : undefined;
      const lad = this.ladder && this.ladder.cs === ac.cs && this.ladder.f === c.f ? this.ladder : undefined;
      const x = ox + c.x, y = oy + c.y;
      this.chips.push({ ...c, x, y, cs: ac.cs });
      const live = st || lad;
      ctx.fillStyle = live ? S.selFill : S.chip; this.rrect(x, y, c.w, c.h, 4); ctx.fill();
      ctx.strokeStyle = live ? S.select : S.chipLine; ctx.lineWidth = live ? 1.5 : 1; ctx.stroke();
      const val = lad ? lad.opts[lad.idx].label : st ? st.opts[st.idx].label : c.val;
      if (this.touch) {
        ctx.font = mono(8.5, 500); ctx.fillStyle = S.transferred; ctx.fillText(c.cap, x + 6, y + 11);
        ctx.font = mono(13, 600); ctx.fillStyle = live ? S.select : c.warn ? S.warn : c.assigned ? S.assigned : col;
        ctx.fillText(val, x + 6, y + c.h - 9);
      } else {
        ctx.font = mono(8.5, 500); ctx.fillStyle = S.transferred; ctx.fillText(c.cap, x + 5, y + c.h / 2 + 3);
        const capW = ctx.measureText(c.cap).width;
        ctx.font = mono(12, 600); ctx.fillStyle = live ? S.select : c.warn ? S.warn : c.assigned ? S.assigned : col;
        ctx.fillText(val, x + 9 + capW, y + c.h / 2 + 4);
      }
    }
    drawSegs(armed.detail, lx, ly + bh - 4);
  }

  /** Header, chips (relative to the chip area) and detail line for the selected aircraft's armed label. */
  private armedLayout(ac: Aircraft, cw: number, lh: number) {
    const sim = this.sim;
    const base = this.labelLines(ac, false);
    const head: Seg[] = [...base[0]];
    const afl = levelShort(sim.levelFor(Math.round(ac.alt / 100) * 100));
    const trend = ac.vs > 300 ? '↑' : ac.vs < -300 ? '↓' : '';
    head.push({ t: `  ${afl}${trend}  ${String(Math.round(ac.gs / 10)).padStart(2, '0')}` });
    if (this.wxAhead.has(ac.cs)) head.push({ t: ' WX', c: 'warn', b: true });
    const cflL = ac.cflSys ?? ac.cleared;
    const sflOff = Math.abs(sim.ftOf(ac.cleared) - sim.ftOf(cflL)) > 60;
    const mv = sim.pack.meta.magVar;
    const hdgVal = ac.hdgSys !== undefined && !ac.app?.locCap ? `H${String(Math.round(norm360(ac.hdgSys - mv)) || 360).padStart(3, '0')}` : ac.mode === 'HOLD' ? `HLD ${ac.hold?.fix ?? ''}` : ac.route[0] ? `→${ac.route[0].fix}` : `H${String(Math.round(norm360(ac.hdg - mv)) || 360).padStart(3, '0')}`;
    const spdVal = ac.spdAssigned ? `S${ac.spdAssigned}${ac.spdUntil ? '/' + ac.spdUntil : ''}` : ac.spdMin ? 'SMIN' : `${Math.round(ac.ias)}`;
    const appVal = ac.app ? (ac.app.locCap ? `D${sim.dthr(ac).toFixed(1)}` : `${ac.app.type}${ac.app.rwy.id}`) : ac.kind === 'dep' && ac.exitFix ? ac.exitFix : '—';
    const defs: { f: Field; cap: string; val: string; assigned: boolean; warn?: boolean }[] = [
      { f: 'lvl', cap: 'CFL', val: levelShort(cflL) + (sflOff ? ` ≠${levelShort(ac.cleared)}` : ''), assigned: !!ac.cflSys, warn: sflOff },
      { f: 'spd', cap: ac.spdAssigned || ac.spdMin ? 'SPD' : 'IAS', val: spdVal, assigned: !!(ac.spdAssigned || ac.spdMin) },
      { f: 'hdg', cap: ac.hdgSys !== undefined && !ac.app?.locCap ? 'HDG' : ac.mode === 'HOLD' ? 'HOLD' : 'NAV', val: hdgVal, assigned: ac.hdgSys !== undefined },
      { f: 'app', cap: ac.app?.locCap ? (ac.app.type === 'ILS' ? 'LOC' : ac.app.type) : 'APP', val: appVal, assigned: !!ac.app },
    ];
    const touch = this.touch;
    const ch = touch ? 38 : 24, gap = touch ? 6 : 4;
    const cols = touch ? 2 : 4;
    const widths = defs.map((d) => touch ? Math.max(62, d.val.length * 8.2 + 14) : d.cap.length * 5.6 + d.val.length * 7.4 + 18);
    const colW = touch ? [Math.max(widths[0], widths[2]), Math.max(widths[1], widths[3])] : widths;
    const chips: Chip[] = defs.map((d, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = colW.slice(0, c).reduce((a, b) => a + b + gap, 0);
      return { ...d, x, y: r * (ch + gap), w: colW[c], h: ch };
    });
    const detail: Seg[] = [{ t: `${ac.type}/${ac.perf.recat} A${ac.sqk} ${ac.proc ?? ''}`.trim(), c: 'dim' }];
    void cw;
    return { chips, head, detail, hh: lh + 3 };
  }

  private drawGhosts(ac: Aircraft, pts: PredPt[], col: string, horizon: number, selected: boolean, obstacles: Rect[], from?: XY) {
    const { ctx, sim } = this;
    const S = this.skin;
    if (selected) {
      const s0 = from ?? this.toS(ac.p);
      ctx.strokeStyle = S.select; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s0.x, s0.y);
      for (const q of pts) { const s = this.toS(q.p); ctx.lineTo(s.x, s.y); }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = col;
    for (const q of pts) {
      if (q.t % 15 || q.t > horizon) continue;
      const s = this.toS(q.p);
      const k = q.t / horizon;
      ctx.globalAlpha = selected ? 0.75 - 0.5 * k : 0.45 - 0.37 * (q.t - 15) / (horizon - 15);
      const r = selected && q.t % 60 === 0 ? 2.4 : 1.6;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const q of pts) {
      if (q.t > horizon || !q.event) continue;
      const s = this.toS(q.p);
      if (q.event === 'leveloff') {
        const a = q.hdg * Math.PI / 180;
        const nx = Math.cos(a), ny = Math.sin(a); // perpendicular to the track on screen
        ctx.strokeStyle = col; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(s.x - nx * 5, s.y - ny * 5); ctx.lineTo(s.x + nx * 5, s.y + ny * 5); ctx.stroke();
        ctx.globalAlpha = 1;
        const t = levelShort(ac.cleared);
        ctx.font = mono(9, 500);
        const w = ctx.measureText(t).width;
        const tx = s.x + nx * 8 + (nx < 0 ? -w : 0), ty = s.y + ny * 8 + 3;
        this.haloText(t, tx, ty, mono(9, 500), col);
        obstacles.push({ x: tx, y: ty - 9, w, h: 11 });
      } else if (q.event === 'loc') {
        ctx.fillStyle = col; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x + 4, s.y); ctx.lineTo(s.x, s.y + 4); ctx.lineTo(s.x - 4, s.y); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    void sim;
  }

  /** Closest point of approach from the cached predictions (or straight lines when not available). */
  private cpa(A: Aircraft, B: Aircraft): { t: number; d: number; v: number; pa: XY; pb: XY } | undefined {
    const pa = this.pred.get(A.cs), pb = this.pred.get(B.cs);
    let best = { t: 0, d: dist(A.p, B.p), v: Math.abs(A.alt - B.alt), pa: A.p, pb: B.p };
    if (pa && pb) {
      const mb = new Map(pb.filter((q) => q.t % 5 === 0).map((q) => [q.t, q]));
      for (const q of pa) {
        if (q.t % 5) continue;
        const r = mb.get(q.t);
        if (!r) continue;
        const d = dist(q.p, r.p);
        if (d < best.d) best = { t: q.t, d, v: Math.abs(q.alt - r.alt), pa: q.p, pb: r.p };
      }
      return best;
    }
    const v = (a: Aircraft) => ({ x: Math.sin(a.trk * Math.PI / 180) * a.gs / 3600, y: Math.cos(a.trk * Math.PI / 180) * a.gs / 3600 });
    const va = v(A), vb = v(B);
    const dp = { x: B.p.x - A.p.x, y: B.p.y - A.p.y }, dv = { x: vb.x - va.x, y: vb.y - va.y };
    const vv = dv.x * dv.x + dv.y * dv.y;
    const tc = vv > 1e-12 ? Math.min(180, Math.max(0, -(dp.x * dv.x + dp.y * dv.y) / vv)) : 0;
    const qa = { x: A.p.x + va.x * tc, y: A.p.y + va.y * tc }, qb = { x: B.p.x + vb.x * tc, y: B.p.y + vb.y * tc };
    const alt = (a: Aircraft) => { const na = a.alt + (a.vs * tc) / 60; return a.vs > 0 ? Math.min(na, Math.max(a.alt, a.tgtAlt)) : a.vs < 0 ? Math.max(na, Math.min(a.alt, a.tgtAlt)) : a.alt; };
    best = { t: Math.round(tc), d: dist(qa, qb), v: Math.abs(alt(A) - alt(B)), pa: qa, pb: qb };
    return best;
  }

  private updateCallers(now: number) {
    const sim = this.sim;
    const callers = sim.callers().filter((a) => a.state === 'assumed' && sim.t >= (a.awaitingSince ?? 0));
    for (const a of callers) {
      if (this.callSeen.get(a.cs) !== a.awaitingSince) {
        this.callSeen.set(a.cs, a.awaitingSince!);
        this.ev.newCaller?.(a.cs);
        if (callers[0] === a) this.pingAt.set(a.cs, now);
      }
    }
    for (const cs of [...this.callSeen.keys()]) if (!callers.some((a) => a.cs === cs)) this.callSeen.delete(cs);
    const nx = callers[0]?.cs;
    if (nx && nx !== this.nextCs && !this.pingAt.has(nx)) this.pingAt.set(nx, now);
    this.nextCs = nx;
  }

  private drawEdgeArrows(list: { ac: Aircraft; s: XY; emer: boolean; sel: boolean; next: boolean }[]): Rect[] {
    const rects: Rect[] = [];
    const { ctx } = this;
    const S = this.skin;
    this.edgeHits = [];
    const cx = this.w / 2, cy = this.h / 2;
    const top = 30, pad = 14, bottom = this.showProfile ? this.profileH() + 16 : pad;
    const used: { x: number; y: number }[] = [];
    for (const t of list) {
      const dx = t.s.x - cx, dy = t.s.y - cy;
      const kx = dx > 0 ? (this.w - pad - cx) / dx : dx < 0 ? (pad - cx) / dx : Infinity;
      const ky = dy > 0 ? (this.h - bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
      const k = Math.min(kx, ky);
      const x = cx + dx * k, y = cy + dy * k;
      const a = Math.atan2(dy, dx);
      const col = t.emer ? S.urgent : t.next ? S.warn : t.sel ? S.select : S.assumed;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
      ctx.lineTo(x + Math.cos(a + 2.5) * 8, y + Math.sin(a + 2.5) * 8);
      ctx.lineTo(x + Math.cos(a - 2.5) * 8, y + Math.sin(a - 2.5) * 8);
      ctx.closePath(); ctx.fill();
      const d = dist(this.toW(cx, cy), this.plot(t.ac));
      const txt = `${t.ac.cs} ${d.toFixed(0)}`;
      ctx.font = mono(10.5, 600);
      const w = ctx.measureText(txt).width;
      // text sits inward of the arrow
      let tx = x - Math.cos(a) * (16 + w / 2) - w / 2, ty = y - Math.sin(a) * 16 + 4;
      tx = Math.max(4, Math.min(this.w - w - 4, tx)); ty = Math.max(top + 10, Math.min(this.h - bottom, ty));
      for (const u of used) if (Math.abs(u.x - tx) < w + 8 && Math.abs(u.y - ty) < 15) ty = u.y + (ty >= u.y ? 16 : -16);
      used.push({ x: tx, y: ty });
      ctx.fillStyle = t.emer ? S.urgent : S.plate; ctx.fillRect(tx - 3, ty - 11, w + 6, 15);
      ctx.fillStyle = t.emer ? S.emerText : col; ctx.fillText(txt, tx, ty);
      this.edgeHits.push({ cs: t.ac.cs, x: (x + tx + w / 2) / 2, y: (y + ty - 4) / 2 });
      rects.push({ x: tx - 3, y: ty - 11, w: w + 6, h: 15 }, { x: x - 10, y: y - 10, w: 20, h: 20 });
    }
    return rects;
  }

  private haloText(t: string, x: number, y: number, font: string, color: string) {
    const { ctx } = this;
    ctx.font = font;
    ctx.lineWidth = 3; ctx.strokeStyle = this.skin.halo; ctx.lineJoin = 'round';
    ctx.strokeText(t, x, y);
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  }

  // ================= final approach sequence =================
  private finalMin(lead: Aircraft, fol: Aircraft, leadD: number) {
    return Math.max(wakeMinNm(lead.perf.recat, fol.perf.recat, 2.5), leadD < 10 ? 2.5 : 3, this.sim.lvp ? 4 : 0);
  }
  private gapColour(gap: number, min: number) {
    const S = this.skin;
    return gap < min - 0.05 ? S.urgent : gap <= min + 1 ? S.gapOk : gap > min + 2 ? S.warn : S.ftdi;
  }
  /** Aircraft on or joining the active final, with an equivalent distance to the threshold. */
  private finalSequence(): { a: Aircraft; d: number; joining: boolean }[] {
    const sim = this.sim, rw = sim.rwy;
    const out: { a: Aircraft; d: number; joining: boolean }[] = [];
    for (const a of sim.aircraft) {
      if (a.landed || a.remove || !a.app || a.app.rwy.id !== rw.id) continue;
      const d = -alongTrack(a.p, rw.thr, rw.crs);
      if (a.app.locCap || (Math.abs(crossTrack(a.p, rw.thr, rw.crs)) < 1 && Math.abs(angDiff(a.trk, rw.crs)) < 30)) { if (d > 0 && d < 25) out.push({ a, d, joining: false }); continue; }
      const pts = this.pred.get(a.cs);
      const cap = pts?.find((q) => q.locCap);
      if (cap) {
        const dc = -alongTrack(cap.p, rw.thr, rw.crs);
        const eq = dc + (cap.t * Math.max(140, cap.gs)) / 3600;
        if (eq > 0 && eq < 25) out.push({ a, d: eq, joining: true });
      }
    }
    return out.sort((x, y) => x.d - y.d);
  }
  /** FTDi chevrons: where each established follower should be. */
  private drawFtdiChevrons() {
    const { ctx, sim } = this;
    const S = this.skin;
    const rw = sim.rwy;
    const seq = this.finalSequence().filter((x) => !x.joining);
    for (let i = 1; i < seq.length; i++) {
      const lead = seq[i - 1], fol = seq[i];
      const min = this.finalMin(lead.a, fol.a, lead.d);
      const tgt = lead.d + min;
      if (tgt > 25) continue;
      const short = fol.d < tgt - 0.05;
      const c = this.toS(move(rw.thr, rw.crs + 180, tgt));
      const a = (rw.crs * Math.PI) / 180;
      const fx = Math.sin(a), fy = -Math.cos(a);
      const nx = -fy, ny = fx;
      const w = 7, dpt = 6;
      ctx.strokeStyle = short ? S.urgent : S.ftdi; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x + nx * w - fx * dpt, c.y + ny * w - fy * dpt);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(c.x - nx * w - fx * dpt, c.y - ny * w - fy * dpt);
      ctx.stroke();
    }
  }
  private ftdiTexts(): { p: XY; text: string; col: string }[] {
    const sim = this.sim, S = this.skin, rw = sim.rwy;
    const seq = this.finalSequence().filter((x) => !x.joining);
    const out: { p: XY; text: string; col: string }[] = [];
    for (let i = 1; i < seq.length; i++) {
      const lead = seq[i - 1], fol = seq[i];
      const min = this.finalMin(lead.a, fol.a, lead.d);
      const tgt = lead.d + min;
      if (tgt > 25) continue;
      const short = fol.d < tgt - 0.05;
      if (short || fol.a.cs === this.selected) out.push({ p: this.toS(move(rw.thr, rw.crs + 180, tgt)), text: `${fol.a.cs} ${min.toFixed(1)}`, col: short ? S.urgent : S.ftdi });
    }
    return out;
  }
  /** Gap ruler beside the active centreline, 0 to 20 NM. Returns its text boxes as label obstacles. */
  private drawRuler(): Rect[] {
    if (!this.showRuler) return [];
    const { ctx, sim } = this;
    const S = this.skin;
    const rw = sim.rwy;
    const seq = this.finalSequence().filter((x) => x.d <= 20.5);
    const side = rw.id.endsWith('R') ? 1 : -1;
    const off = 1.2;
    const at = (d: number, o = off) => this.toS(move(move(rw.thr, rw.crs + 180, d), rw.crs + 90 * side, o));
    const a0 = at(0), a1 = at(20);
    if (Math.max(a0.x, a1.x) < 0 || Math.min(a0.x, a1.x) > this.w || Math.max(a0.y, a1.y) < 0 || Math.min(a0.y, a1.y) > this.h) return [];
    const boxes: Rect[] = [];
    // ladder spine and rungs
    ctx.strokeStyle = S.centreline; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y);
    const ux = (a1.x - a0.x) / 20, uy = (a1.y - a0.y) / 20, L = Math.hypot(ux, uy) || 1;
    const nx = -uy / L * side * (rw.crs > 180 ? 1 : 1), ny = ux / L * side;
    // outward normal: away from the centreline
    const cl = this.toS(move(rw.thr, rw.crs + 180, 10)), mid = at(10);
    const ox = mid.x - cl.x, oy = mid.y - cl.y, oL = Math.hypot(ox, oy) || 1;
    const onx = ox / oL, ony = oy / oL;
    void nx; void ny;
    for (let d = 0; d <= 20; d++) {
      const p = at(d), len = d % 5 === 0 ? 5 : 2.5;
      ctx.moveTo(p.x - onx * len, p.y - ony * len); ctx.lineTo(p.x + onx * len, p.y + ony * len);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    if (this.scale > 5) for (const d of [5, 10, 15, 20]) {
      const p = at(d);
      const t = String(d);
      ctx.font = mono(9);
      const w = ctx.measureText(t).width;
      const tx = p.x + onx * 9 - (onx < 0 ? w : 0), ty = p.y + ony * 9 + 3;
      ctx.fillStyle = S.ringText; ctx.fillText(t, tx, ty);
    }
    // aircraft ticks and gaps
    ctx.font = mono(9.5, 600);
    for (let i = 0; i < seq.length; i++) {
      const x = seq[i];
      const p = at(x.d);
      const col = x.a.cs === this.selected ? S.select : x.a.state === 'assumed' ? S.assumed : x.a.state === 'transferred' ? S.transferred : S.notified;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(x.joining ? [2, 2] : []);
      ctx.beginPath(); ctx.moveTo(p.x - onx * 6, p.y - ony * 6); ctx.lineTo(p.x + onx * 6, p.y + ony * 6); ctx.stroke(); ctx.setLineDash([]);
      if (i > 0) {
        const lead = seq[i - 1];
        const gap = x.d - lead.d;
        const min = this.finalMin(lead.a, x.a, lead.d);
        const gc = this.gapColour(gap, min);
        const q = at(lead.d);
        ctx.strokeStyle = gc; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(q.x + onx * 0, q.y + ony * 0); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.globalAlpha = 1;
        const segPx = Math.hypot(p.x - q.x, p.y - q.y);
        if (segPx > 20) {
          const m = at((x.d + lead.d) / 2);
          const t = gap.toFixed(1);
          const w = t.length * 6 + 6;
          const tx = m.x - onx * 8 - (onx > 0 ? w : 0), ty = m.y - ony * 8 + 4;
          ctx.fillStyle = S.plate; ctx.fillRect(tx - 1, ty - 10, w, 13);
          ctx.fillStyle = gc; ctx.font = mono(9.5, 600); ctx.fillText(t, tx + 2, ty);
          boxes.push({ x: tx - 1, y: ty - 10, w, h: 13 });
        }
      }
      const t = x.a.cs;
      ctx.font = mono(9.5, 600);
      const w = ctx.measureText(t).width;
      const tx = p.x + onx * 10 - (onx < 0 ? w : 0), ty = p.y + ony * 10 + 3.5;
      this.haloText(t, tx, ty, mono(9.5, 600), x.joining ? S.transferred : col);
      boxes.push({ x: tx - 1, y: ty - 10, w: w + 2, h: 13 });
    }
    return boxes;
  }

  private drawRbls() {
    this.rblHits = [];
    this.rbls.forEach((r, i) => {
      const a = this.anchorXY(r.a), b = this.anchorXY(r.b);
      if (!a || !b) return;
      const A = r.a.cs ? this.sim.find(r.a.cs) : undefined, B = r.b.cs ? this.sim.find(r.b.cs) : undefined;
      const mid = this.drawRbl(a, b, A, B);
      this.rblHits.push({ i, ...mid });
    });
  }
  private drawRbl(a: XY, b: XY, A?: Aircraft, B?: Aircraft) {
    const { ctx } = this;
    const S = this.skin;
    const sa = this.toS(a), sb = this.toS(b);
    ctx.strokeStyle = S.rbl; ctx.lineWidth = 1.2; ctx.setLineDash([8, 3]);
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke(); ctx.setLineDash([]);
    const brg = Math.round(norm360(bearing(a, b) - this.sim.pack.meta.magVar)) || 360;
    let text = `${String(brg).padStart(3, '0')}° ${dist(a, b).toFixed(1)}`;
    let col = S.rbl;
    if (A && B) {
      const c = this.cpa(A, B);
      if (c && c.t > 0 && c.t < 1200) {
        text += `  CPA ${c.d.toFixed(1)} ${fmtT(c.t)}`;
        if (c.d < 3 && c.v < 1000) col = S.urgent;
      }
    }
    const mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2 - 6;
    this.haloText(text, mx - text.length * 3.2, my, mono(11, 600), col);
    return { x: mx, y: my };
  }

  // ================= overlays =================
  private drawHdgDrag() {
    const h = this.hdg;
    if (!h) return;
    const { ctx } = this;
    const S = this.skin;
    const ac = this.sim.find(h.cs);
    const from = ac ? this.symbols.get(ac.cs) ?? this.toS(this.plot(ac)) : undefined;
    if (!from) return;
    // finger line, faint
    ctx.strokeStyle = S.select; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(h.to.x, h.to.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    // predicted turn and 2 minute ghost track
    if (h.pts && h.item) {
      ctx.strokeStyle = S.select; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(from.x, from.y);
      for (const q of h.pts) { const s = this.toS(q.p); ctx.lineTo(s.x, s.y); }
      ctx.stroke();
      ctx.fillStyle = S.select;
      for (const q of h.pts) {
        if (q.t % 15) continue;
        const s = this.toS(q.p);
        ctx.beginPath(); ctx.arc(s.x, s.y, q.t % 60 === 0 ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      }
      const loc = h.pts.find((q) => q.event === 'loc');
      if (loc) { const s = this.toS(loc.p); ctx.beginPath(); ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x + 5, s.y); ctx.lineTo(s.x, s.y + 5); ctx.lineTo(s.x - 5, s.y); ctx.closePath(); ctx.fill(); }
    }
    if (h.snap === 'dct' && h.item?.k === 'dct') {
      const f = this.sim.pack.fixes.get(h.item.fix);
      if (f) { const s = this.toS(f.p); ctx.strokeStyle = S.select; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(s.x, s.y, 12, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (h.snap === 'int') {
      const rw = this.sim.rwy;
      const a = this.toS(move(rw.thr, rw.crs + 180, 0)), b = this.toS(move(rw.thr, rw.crs + 180, 25));
      ctx.strokeStyle = S.select; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // readout bubble 60 px above the finger
    const main = h.item ? h.text : 'CANCEL';
    const sub = !h.item ? 'release on the symbol' : h.still ? 'STAGED · lift to add' : h.sub || (this.ev.stage ? 'lift to send · hold to stage' : 'lift to send');
    ctx.font = mono(16, 600);
    const tw = Math.max(ctx.measureText(main).width, sub.length * 6.2);
    const bw = tw + 22, bh = 42;
    const bx = Math.min(this.w - bw - 6, Math.max(6, h.to.x - bw / 2)), by = Math.max(28, h.to.y - 60 - bh / 2);
    ctx.fillStyle = S.panel; this.rrect(bx, by, bw, bh, 8); ctx.fill();
    ctx.strokeStyle = h.item ? S.select : S.transferred; ctx.lineWidth = h.still ? 2.2 : 1.2; ctx.stroke();
    ctx.fillStyle = h.item ? S.select : S.transferred; ctx.font = mono(16, 600); ctx.fillText(main, bx + 11, by + 19);
    ctx.font = mono(9.5, 500); ctx.fillStyle = h.snap === 'int' || h.snap === 'dct' || h.still ? S.select : S.ringText; ctx.fillText(sub, bx + 11, by + 34);
    if (h.item) { ctx.fillStyle = 'rgba(86,210,234,0.16)'; ctx.beginPath(); ctx.arc(h.to.x, h.to.y, 18, 0, Math.PI * 2); ctx.fill(); }
  }

  private drawLadder() {
    const L = this.ladder;
    if (!L) return;
    const { ctx } = this;
    const S = this.skin;
    const rowH = this.touch ? 26 : 20, rows = 9, half = Math.floor(rows / 2);
    const b = L.box;
    ctx.fillStyle = S.panel; this.rrect(b.x, b.y, b.w, b.h, 6); ctx.fill();
    ctx.strokeStyle = S.panelLine; ctx.lineWidth = 1; ctx.stroke();
    const start = Math.max(0, Math.min(L.opts.length - rows, L.idx - half));
    for (let r = 0; r < rows; r++) {
      const i = start + r;
      if (i >= L.opts.length) break;
      const o = L.opts[i];
      const y = b.y + 4 + r * rowH;
      if (i > 0 && this.isDetent(o, L.opts[i - 1])) {
        ctx.strokeStyle = o.warn ? S.urgent : S.warn; ctx.lineWidth = 1.5; ctx.setLineDash(o.warn ? [] : [3, 2]);
        ctx.beginPath(); ctx.moveTo(b.x + 4, y); ctx.lineTo(b.x + b.w - 4, y); ctx.stroke(); ctx.setLineDash([]);
        if (o.warn) { ctx.font = mono(8, 600); ctx.fillStyle = S.urgent; const t = o.warn.toUpperCase(); ctx.fillText(t, b.x + b.w - ctx.measureText(t).width - 5, y - 2); }
      }
      const on = i === L.idx, cur = i === L.idx0;
      if (on) { ctx.fillStyle = S.selFill; ctx.fillRect(b.x + 2, y + 1, b.w - 4, rowH - 2); ctx.strokeStyle = S.select; ctx.lineWidth = 1.5; ctx.strokeRect(b.x + 2.5, y + 1.5, b.w - 5, rowH - 3); }
      ctx.font = mono(on ? 13 : 12, on ? 600 : 500);
      ctx.fillStyle = on ? S.select : o.warn ? S.urgent : cur ? S.assumed : S.transferred;
      ctx.fillText(o.label, b.x + 8, y + rowH / 2 + 4.5);
      if (cur && !on) { ctx.font = mono(8, 500); ctx.fillStyle = S.ringText; ctx.fillText('NOW', b.x + b.w - 26, y + rowH / 2 + 3.5); }
    }
  }

  private drawRadial() {
    const m = this.radialMenu;
    if (!m) return;
    const { ctx } = this;
    const S = this.skin;
    ctx.fillStyle = S.panel;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r1, 0, Math.PI * 2); ctx.arc(m.x, m.y, m.r0, 0, Math.PI * 2, true); ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a0 = (i * 45 - 22.5 - 90) * Math.PI / 180, a1 = (i * 45 + 22.5 - 90) * Math.PI / 180;
      if (m.hover === i) {
        ctx.fillStyle = S.selFill; ctx.beginPath(); ctx.arc(m.x, m.y, m.r1, a0, a1); ctx.arc(m.x, m.y, m.r0, a1, a0, true); ctx.closePath(); ctx.fill(); ctx.fill();
      }
      ctx.strokeStyle = S.panelLine; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.x + Math.cos(a0) * m.r0, m.y + Math.sin(a0) * m.r0); ctx.lineTo(m.x + Math.cos(a0) * m.r1, m.y + Math.sin(a0) * m.r1); ctx.stroke();
      const am = (i * 45 - 90) * Math.PI / 180, rr = (m.r0 + m.r1) / 2 + 2;
      const t = RADIAL[i] === 'MORE' ? '⋯' : RADIAL[i];
      ctx.font = mono(this.touch ? 12.5 : 11.5, 600);
      ctx.fillStyle = m.hover === i ? S.select : S.assumed;
      ctx.fillText(t, m.x + Math.cos(am) * rr - ctx.measureText(t).width / 2, m.y + Math.sin(am) * rr + 4);
    }
    ctx.strokeStyle = S.select; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r1, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r0, 0, Math.PI * 2); ctx.stroke();
    ctx.font = mono(9.5, 600); ctx.fillStyle = S.select;
    const cs = m.cs; ctx.fillText(cs, m.x - ctx.measureText(cs).width / 2, m.y - m.r1 - 6);
  }

  // ================= tutorial marks =================
  private drawMarks(now: number) {
    const { ctx } = this;
    const S = this.skin;
    for (const m of this.marks) {
      let p: XY | undefined;
      if (m.cs) { const ac = this.sim.find(m.cs); if (ac) p = this.plot(ac); }
      if (m.fix) p = this.sim.pack.fixes.get(m.fix)?.p;
      if (!p) continue;
      const s = this.toS(p);
      const r = 20 + 5 * Math.sin(now / 220);
      ctx.strokeStyle = S.warn; ctx.lineWidth = 2; ctx.shadowColor = S.warn; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      if (m.text) this.haloText(m.text, s.x + r + 6, s.y - r * 0.6, sans(14, 600), S.warn);
    }
  }

  // ================= final monitor (vertical profile strip) =================
  private profileH() { return this.w < 560 ? 64 : 76; }
  /** Slim side view of the active final docked at the bottom of the scope: glidepath with a ±1 dot band, staggered labels, gaps. */
  private drawProfile() {
    const { ctx, sim } = this;
    const S = this.skin;
    const rw = sim.rwy;
    const H = this.profileH();
    const x0 = 8, W = this.w - 16 - 64, y0 = this.h - H - 8;
    if (W < 160) return;
    const maxD = this.w < 560 ? 12 : 16, maxA = rw.elevation + (this.w < 560 ? 4300 : 5300);
    ctx.fillStyle = S.panel; this.rrect(x0, y0, W, H, 6); ctx.fill();
    ctx.strokeStyle = S.panelLine; ctx.lineWidth = 1; ctx.stroke();
    const pl = x0 + 26, pr = x0 + W - 8, pt = y0 + 6, pb = y0 + H - 15;
    const X = (d: number) => pl + (d / maxD) * (pr - pl);
    const Y = (a: number) => pb - ((a - rw.elevation) / (maxA - rw.elevation)) * (pb - pt);
    ctx.font = mono(8.5); ctx.fillStyle = S.ringText;
    for (let a = 1000; a <= maxA - rw.elevation; a += 1000) {
      ctx.strokeStyle = S.ring; ctx.beginPath(); ctx.moveTo(pl, Y(rw.elevation + a)); ctx.lineTo(pr, Y(rw.elevation + a)); ctx.stroke();
      if (a % 2000 === 0) ctx.fillText(`${a / 1000}k`, x0 + 6, Y(rw.elevation + a) + 3);
    }
    // ±1 dot band (about ±0.35°) around the 3° glidepath
    const tan = (deg: number) => Math.tan(deg * Math.PI / 180) * 6076;
    ctx.fillStyle = S.gsBand;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(rw.elevation + 50));
    ctx.lineTo(X(maxD), Y(rw.elevation + 50 + maxD * tan(3.35)));
    ctx.lineTo(X(maxD), Y(rw.elevation + 50 + maxD * tan(2.65)));
    ctx.closePath(); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.rect(pl, pt, pr - pl, pb - pt); ctx.clip();
    ctx.strokeStyle = S.centreline; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(X(0), Y(rw.elevation + 50)); ctx.lineTo(X(maxD), Y(rw.elevation + 50 + maxD * 318.4)); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = S.ring10; ctx.beginPath(); ctx.moveTo(pl, pb); ctx.lineTo(pr, pb); ctx.stroke();
    const faf = sim.pack.fixes.get(rw.faf);
    if (faf) {
      const fd = -alongTrack(faf.p, rw.thr, rw.crs);
      ctx.strokeStyle = S.fixText; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(fd), pt); ctx.lineTo(X(fd), pb); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.font = mono(8.5); ctx.fillStyle = S.ringText;
    for (let d = 0; d <= maxD; d += 2) { ctx.fillText(String(d), X(d) - (d >= 10 ? 5 : 2.5), pb + 11); }
    ctx.font = mono(8.5, 600); ctx.fillText(rw.id, x0 + 4, pb + 11);
    // traffic
    const list: { a: Aircraft; d: number; x: number; y: number; c: string }[] = [];
    for (const ac of sim.aircraft) {
      const d = -alongTrack(ac.p, rw.thr, rw.crs);
      const xt = Math.abs(crossTrack(ac.p, rw.thr, rw.crs));
      if (d < 0 || d > maxD || xt > 4 || ac.alt > maxA || ac.landed) continue;
      const dev = ac.alt - (rw.elevation + 50 + d * 318.4);
      const band = d * (tan(3.35) - 318.4);
      const c = ac.cs === this.selected ? S.select : ac.app?.locCap ? (dev > band + 150 ? S.warn : dev < -band - 100 ? S.urgent : S.assumed) : S.transferred;
      list.push({ a: ac, d, x: X(d), y: Y(ac.alt), c });
    }
    list.sort((p, q) => p.d - q.d);
    const placed: Rect[] = [];
    ctx.font = mono(9.5, 600);
    for (const p of list) {
      ctx.fillStyle = p.c; ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
      const w = ctx.measureText(p.a.cs).width;
      const opts = [[4, -13], [4, 3], [-w - 4, -13], [-w - 4, 3], [4, -24], [-w - 4, -24]];
      let best: Rect | undefined;
      for (const [dx, dy] of opts) {
        const r = { x: p.x + dx, y: Math.max(y0 + 2, Math.min(pb - 11, p.y + dy)), w, h: 11 };
        if (r.x < pl - 20 || r.x + w > pr + 4) continue;
        if (!placed.some((q) => overlap(q, r) > 0)) { best = r; break; }
      }
      if (!best) continue;
      placed.push(best);
      ctx.fillStyle = p.c; ctx.fillText(p.a.cs, best.x, best.y + 9);
    }
    for (let i = 1; i < list.length; i++) {
      const lead = list[i - 1], fol = list[i];
      if (!lead.a.app?.locCap) continue;
      const gap = fol.d - lead.d;
      const min = this.finalMin(lead.a, fol.a, lead.d);
      const t = gap.toFixed(1);
      const mx = (lead.x + fol.x) / 2;
      const w = t.length * 5.6 + 6;
      if (fol.x - lead.x < w + 4) continue;
      ctx.fillStyle = S.panel; ctx.fillRect(mx - w / 2, pb + 2, w, 11);
      ctx.fillStyle = this.gapColour(gap, min); ctx.font = mono(9, 600); ctx.fillText(t, mx - w / 2 + 3, pb + 11);
    }
  }

  // ================= label content =================
  /** Cleared-level adherence: the aircraft has gone more than 300 ft through the system CFL. */
  clam(ac: Aircraft): boolean {
    if (ac.state !== 'assumed' || !ac.cflSys || ac.app?.gsCap) return false;
    const cfl = this.sim.ftOf(ac.cflSys);
    return (ac.vs < -200 && ac.alt < cfl - 300) || (ac.vs > 200 && ac.alt > cfl + 300);
  }

  labelLines(ac: Aircraft, extended = false): Seg[][] {
    const sim = this.sim;
    const afl = levelShort(sim.levelFor(Math.round(ac.alt / 100) * 100));
    const trend = ac.vs > 300 ? '↑' : ac.vs < -300 ? '↓' : ' ';
    const cflSys = ac.cflSys ?? ac.cleared;
    const cfl = levelShort(cflSys);
    const sflMismatch = Math.abs(sim.ftOf(ac.cleared) - sim.ftOf(cflSys)) > 60;
    const l1: Seg[] = [{ t: ac.cs + (ac.formation > 1 ? `×${ac.formation}` : ''), b: true }];
    if (ac.perf.wake === 'H' || (ac.perf.wake as string) === 'J') l1.push({ t: ` ${ac.perf.recat}`, c: 'dim' });
    if (ac.emergency || ac.sqk === '7700' || ac.sqk === '7600') l1.push({ t: ` ${ac.sqk}`, c: 'urgent', b: true });
    for (const w of sim.warningsFor(ac.cs)) l1.push({ t: ` ${w}`, c: 'urgent', b: true });
    if (this.clam(ac)) l1.push({ t: ' CLAM', c: 'urgent', b: true });
    if (ac.request && ac.state === 'assumed') l1.push({ t: ' REQ', b: true });
    if (ac.state === 'unconcerned' || ac.state === 'transferred') {
      return [l1, [{ t: afl + trend }, { t: ac.state === 'transferred' ? ` ${ac.xfrUnit ?? ''}` : '', c: 'dim' }]];
    }
    const l2: Seg[] = [{ t: afl + trend }];
    if (Math.abs(ac.alt - sim.ftOf(cflSys)) > 150 && !ac.app?.gsCap) l2.push({ t: cfl, c: ac.cflSys ? 'assigned' : undefined });
    if (sflMismatch) l2.push({ t: ` ≠${levelShort(ac.cleared)}`, c: 'warn', b: true });
    const gs = String(Math.round(ac.gs / 10)).padStart(2, '0');
    const l3: Seg[] = [{ t: `${gs} ` }];
    if (ac.spdAssigned) l3.push({ t: `S${ac.spdAssigned}${ac.spdUntil ? '/' + ac.spdUntil : ''} `, c: 'assigned' });
    else if (ac.spdMin) l3.push({ t: 'SMIN ', c: 'assigned' });
    if (ac.hdgSys !== undefined && !ac.app?.locCap) {
      const h = String(Math.round(norm360(ac.hdgSys - sim.pack.meta.magVar)) || 360).padStart(3, '0');
      const ramOff = ac.mode === 'HDG' && ac.hdgAssigned !== undefined && Math.abs(angDiff(ac.hdgAssigned, ac.hdgSys)) > 8;
      l3.push({ t: `H${h}`, c: ramOff ? 'warn' : 'assigned' });
    }
    if (l3.length === 1) l3[0] = { t: `${gs} ${ac.type}` };
    const l4: Seg[] = [];
    if (ac.app) {
      if (ac.app.locCap) l4.push({ t: `${ac.app.type === 'ILS' ? 'LOC' : ac.app.type}${ac.app.rwy.id} D${sim.dthr(ac).toFixed(1)}` });
      else l4.push({ t: `${ac.app.type[0]}${ac.app.rwy.id}`, c: 'assigned' });
    } else if (ac.mode === 'HOLD') l4.push({ t: `HLD ${ac.hold?.fix ?? ''}` });
    else if (ac.mode === 'NAV' && ac.route[0]) l4.push({ t: ac.route[0].fix });
    else if (ac.kind === 'dep' && ac.exitFix) l4.push({ t: ac.exitFix });
    if (ac.rules === 'VFR') l4.push({ t: `${l4.length ? ' ' : ''}VFR` });
    if (!l4.length) l4.push({ t: ac.proc ?? '' });
    const lines = [l1, l2, l3, l4];
    if (extended) lines.push([{ t: `${ac.type}/${ac.perf.recat} A${ac.sqk} ${ac.proc ?? ''}`, c: 'dim' }]);
    return lines;
  }
}

export { pointInPolygon };
