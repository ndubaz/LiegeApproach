import { alongTrack, angDiff, bearing, crossTrack, dist, move, norm360, pointInPolygon, type XY } from '../geo';
import type { Sim } from '../engine/sim';
import type { Aircraft } from '../engine/types';
import type { Item } from '../engine/clearance';
import { levelShort } from '../engine/clearance';
import { wakeMinNm } from '../engine/perf';
import { Rng } from '../engine/rng';
import type { Settings } from '../store';

/**
 * Every colour on the scope lives here so the display can be tuned to match a
 * real position. Track-state colours follow common EUROCONTROL practice:
 * assumed = white, notified/inbound = green, transferred (redundant) = blue-grey,
 * unconcerned = dim grey, urgency = red, warning = amber.
 */
export const SKIN = {
  night: {
    bg0: '#121a20', bg1: '#18222a', terrain: 'rgba(150,160,120,', ring: 'rgba(150,178,195,0.07)', ring10: 'rgba(150,178,195,0.12)', ringText: 'rgba(150,178,195,0.34)',
    rose: 'rgba(150,178,195,0.20)', border: 'rgba(170,180,190,0.34)', road: 'rgba(150,160,170,0.13)', river: 'rgba(90,140,175,0.36)', town: 'rgba(160,180,195,0.34)',
    ctr: 'rgba(125,180,210,0.42)', tma: 'rgba(125,180,210,0.17)', centreline: 'rgba(205,220,230,0.42)', centreDim: 'rgba(205,220,230,0.14)', runway: '#dfe8ed',
    fix: 'rgba(165,190,205,0.55)', fixKey: 'rgba(200,220,232,0.85)', fixText: 'rgba(165,190,205,0.6)', proc: 'rgba(110,165,200,0.15)', sid: 'rgba(170,150,215,0.11)', hold: 'rgba(160,190,210,0.22)',
    assumed: '#f2f6f8', notified: '#8fe0a2', transferred: '#7d92a2', unconcerned: '#5b6c79', select: '#56d2ea', urgent: '#ff5148', warn: '#ffb444', assigned: '#80d5e8',
    tsaOn: 'rgba(242,184,75,0.6)', tsaFill: 'rgba(242,184,75,0.06)', tsaOff: 'rgba(242,184,75,0.13)', mva: 'rgba(150,200,150,0.30)',
    wx: ['rgba(64,128,160,0.30)', 'rgba(200,164,62,0.38)', 'rgba(222,76,96,0.48)'], route: 'rgba(86,210,234,0.6)', halo: 'rgba(10,16,21,0.85)', ftdi: 'rgba(200,215,225,0.85)', rbl: '#e8d36a',
  },
  day: {
    bg0: '#1e2b35', bg1: '#263641', terrain: 'rgba(170,180,135,', ring: 'rgba(170,200,220,0.10)', ring10: 'rgba(170,200,220,0.16)', ringText: 'rgba(180,205,222,0.45)',
    rose: 'rgba(170,200,220,0.28)', border: 'rgba(195,205,215,0.45)', road: 'rgba(175,185,195,0.2)', river: 'rgba(120,175,210,0.45)', town: 'rgba(185,205,218,0.45)',
    ctr: 'rgba(150,205,230,0.55)', tma: 'rgba(150,205,230,0.24)', centreline: 'rgba(230,240,245,0.55)', centreDim: 'rgba(230,240,245,0.2)', runway: '#ffffff',
    fix: 'rgba(195,215,228,0.7)', fixKey: 'rgba(230,240,248,0.95)', fixText: 'rgba(195,215,228,0.75)', proc: 'rgba(130,190,220,0.22)', sid: 'rgba(190,170,230,0.17)', hold: 'rgba(185,210,228,0.3)',
    assumed: '#ffffff', notified: '#a6f0b7', transferred: '#9cb2c2', unconcerned: '#71879a', select: '#66e0f5', urgent: '#ff6158', warn: '#ffc258', assigned: '#95e2f2',
    tsaOn: 'rgba(255,200,90,0.7)', tsaFill: 'rgba(255,200,90,0.08)', tsaOff: 'rgba(255,200,90,0.18)', mva: 'rgba(170,215,170,0.38)',
    wx: ['rgba(80,145,180,0.34)', 'rgba(215,178,72,0.42)', 'rgba(235,90,110,0.52)'], route: 'rgba(102,224,245,0.7)', halo: 'rgba(16,26,33,0.85)', ftdi: 'rgba(230,240,245,0.9)', rbl: '#f2df78',
  },
};
type Skin = typeof SKIN.night;

type Field = 'cs' | 'lvl' | 'spd' | 'app';
interface LabelBox { x: number; y: number; w: number; h: number; lines: number; lh: number }
type Seg = { t: string; c?: 'urgent' | 'warn' | 'assigned' | 'dim'; b?: boolean };
type Anchor = { cs?: string; p?: XY };

export interface ScopeEvents {
  select(cs: string | undefined): void;
  item(cs: string, item: Item): void;
  field(cs: string, f: Field, at: { x: number; y: number }): void;
  longPress(cs: string): void;
  emptyTap?(): void;
}

const mono = (px: number, wt = 400) => `${wt} ${px}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
const sans = (px: number, wt = 400) => `${wt} ${px}px "IBM Plex Sans Condensed", "Arial Narrow", sans-serif`;

export class Scope {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  center: XY = { x: 1, y: -1 };
  scale = 8; // px per NM
  selected?: string;
  rblMode = false;
  showProfile = false;
  marks: { cs?: string; fix?: string; text?: string }[] = [];
  private anim?: { s0: number; s1: number; c0: XY; c1: XY; t0: number; dur: number };
  labels = new Map<string, LabelBox>();
  private symbols = new Map<string, XY>();
  private pointers = new Map<number, { x: number; y: number }>();
  private drag?: { kind: 'pan' | 'hdg' | 'label' | 'pinch' | 'none' | 'rbl'; cs?: string; field?: Field; x0: number; y0: number; c0: XY; s0: number; d0?: number; moved: boolean; t0: number; lp?: number; a?: Anchor };
  private hdgPreview?: { from: XY; to: { x: number; y: number }; text: string };
  private rblPreview?: { a: Anchor; b: XY };
  private userLabels = new Set<string>();
  rbls: { a: Anchor; b: Anchor }[] = [];
  private rblHits: { i: number; x: number; y: number }[] = [];
  private map = document.createElement('canvas');
  private mapKey = '';
  private wxTex = new Map<string, HTMLCanvasElement>();

  constructor(public canvas: HTMLCanvasElement, public sim: Sim, public settings: Settings, public ev: ScopeEvents) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.fit();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.moveP(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.drag = undefined; this.hdgPreview = undefined; this.rblPreview = undefined; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
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
    const half = 26;
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

  /** Position shown on the scope: the last radar plot. */
  plot(ac: Aircraft): XY { return ac.history[ac.history.length - 1] ?? ac.p; }

  // ================= interaction =================
  private hitAircraft(x: number, y: number): string | undefined {
    let best: string | undefined, bd = 24;
    for (const [cs, s] of this.symbols) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = cs; } }
    return best;
  }
  private hitLabel(x: number, y: number): { cs: string; f: Field } | undefined {
    for (const [cs, b] of [...this.labels].reverse()) {
      if (x >= b.x - 3 && x <= b.x + b.w + 3 && y >= b.y - 3 && y <= b.y + b.h + 3) {
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
  private down(e: PointerEvent) {
    this.anim = undefined;
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, c0: { ...this.center }, s0: this.scale, d0: Math.hypot(a.x - b.x, a.y - b.y), moved: true, t0: performance.now() };
      this.hdgPreview = undefined; this.rblPreview = undefined;
      return;
    }
    const x = e.offsetX, y = e.offsetY;
    const base = { x0: x, y0: y, c0: { ...this.center }, s0: this.scale, moved: false, t0: performance.now() };
    // tapping an RBL readout removes it
    const hit = this.rblHits.find((r) => Math.abs(r.x - x) < 46 && Math.abs(r.y - y) < 14);
    if (hit) { this.rbls.splice(hit.i, 1); this.drag = { kind: 'none', ...base }; return; }
    if (this.rblMode || e.button === 2) { this.drag = { kind: 'rbl', a: this.anchorAt(x, y), ...base }; return; }
    const lab = this.hitLabel(x, y);
    const sym = this.hitAircraft(x, y);
    if (sym && (!lab || Math.hypot((this.symbols.get(sym)!.x - x), (this.symbols.get(sym)!.y - y)) < 16)) this.drag = { kind: 'hdg', cs: sym, ...base };
    else if (lab) this.drag = { kind: 'label', cs: lab.cs, field: lab.f, ...base };
    else this.drag = { kind: 'pan', ...base };
    const cs = this.drag.cs;
    if (cs) this.drag.lp = window.setTimeout(() => { if (this.drag && !this.drag.moved && this.drag.cs === cs) { this.drag.kind = 'none'; this.ev.longPress(cs); } }, 550);
  }
  private moveP(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    const d = this.drag;
    if (!d) return;
    const x = e.offsetX, y = e.offsetY;
    if (d.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      this.scale = Math.max(2.2, Math.min(60, d.s0 * (dd / (d.d0 || dd))));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.center = { x: d.c0.x - (mx - d.x0) / this.scale, y: d.c0.y + (my - d.y0) / this.scale };
      return;
    }
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > 9) { d.moved = true; if (d.lp) clearTimeout(d.lp); }
    if (!d.moved) return;
    if (d.kind === 'pan') this.center = { x: d.c0.x - (x - d.x0) / this.scale, y: d.c0.y + (y - d.y0) / this.scale };
    else if (d.kind === 'rbl' && d.a) this.rblPreview = { a: d.a, b: this.toW(x, y) };
    else if (d.kind === 'label' && d.cs) {
      const ac = this.sim.find(d.cs);
      if (ac) { const s = this.toS(this.plot(ac)); ac.label = { dx: x - s.x - 10, dy: y - s.y - 10 }; this.userLabels.add(d.cs); }
    } else if (d.kind === 'hdg' && d.cs) {
      const ac = this.sim.find(d.cs);
      if (!ac) return;
      const from = this.toS(this.plot(ac));
      this.hdgPreview = { from, to: { x, y }, text: this.dragText(ac, x, y) };
    }
  }
  private dragTarget(ac: Aircraft, x: number, y: number): Item | undefined {
    const from = this.toS(this.plot(ac));
    if (Math.hypot(x - from.x, y - from.y) < 22) return undefined;
    for (const f of this.visibleFixes()) {
      const s = this.toS(f.p);
      if (Math.hypot(s.x - x, s.y - y) < 16) return { k: 'dct', fix: f.id };
    }
    const brgTrue = norm360(Math.atan2(x - from.x, -(y - from.y)) * 180 / Math.PI);
    const mag = Math.round(norm360(brgTrue - this.sim.pack.meta.magVar) / 5) * 5 || 360;
    const cur = norm360(ac.hdg - this.sim.pack.meta.magVar);
    const diff = norm360(mag - cur);
    return { k: 'hdg', hdg: mag, dir: diff === 0 ? undefined : diff > 180 ? 'L' : 'R' };
  }
  private dragText(ac: Aircraft, x: number, y: number) {
    const it = this.dragTarget(ac, x, y);
    if (!it) return '';
    if (it.k === 'dct') return `DCT ${it.fix}`;
    if (it.k === 'hdg') return `${it.dir ?? 'H'}${String(it.hdg).padStart(3, '0')}`;
    return '';
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
    if (d.kind === 'rbl') {
      this.rblPreview = undefined;
      if (d.moved && d.a) { this.rbls.push({ a: d.a, b: this.anchorAt(x, y) }); if (this.rbls.length > 4) this.rbls.shift(); }
      return;
    }
    if (d.kind === 'pan' && !d.moved) { this.ev.emptyTap?.(); return; }
    if (d.kind === 'hdg' && d.cs) {
      const ac = this.sim.find(d.cs);
      this.hdgPreview = undefined;
      if (!d.moved) { this.ev.select(d.cs); return; }
      if (ac) {
        if (this.selected !== d.cs) this.ev.select(d.cs);
        const it = this.dragTarget(ac, x, y);
        if (it) this.ev.item(d.cs, it);
      }
      return;
    }
    if (d.kind === 'label' && d.cs && !d.moved) {
      if (this.selected !== d.cs) this.ev.select(d.cs);
      if (d.field && d.field !== 'cs') this.ev.field(d.cs, d.field, { x, y });
    }
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

  private renderMap() {
    const sim = this.sim, pack = sim.pack, S = this.skin;
    const key = [this.w, this.h, this.dpr, this.center.x.toFixed(3), this.center.y.toFixed(3), this.scale.toFixed(3), sim.runway, [...sim.tsaOn].join(','), this.settings.showMva, this.settings.showProcedures, this.settings.brightness].join('|');
    if (key === this.mapKey) return;
    this.mapKey = key;
    const c = this.map;
    c.width = this.canvas.width; c.height = this.canvas.height;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // ground: a flat console grey-blue with a faint vignette
    const g = ctx.createRadialGradient(this.w * 0.5, this.h * 0.46, 0, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.8);
    g.addColorStop(0, S.bg1); g.addColorStop(1, S.bg0);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);

    // high ground: tint the higher MVA areas (Ardennes) so terrain reads at a glance
    pack.mva.forEach((m) => {
      const a = m.alt >= 3500 ? 0.07 : m.alt >= 3000 ? 0.035 : 0;
      if (!a) return;
      this.path(ctx, m.poly); ctx.fillStyle = `${S.terrain}${a})`; ctx.fill();
    });
    if (this.settings.showMva) {
      ctx.strokeStyle = S.mva; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      for (const m of pack.mva) { this.path(ctx, m.poly); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = S.mva; ctx.font = mono(12, 600);
      for (const m of pack.mva) {
        const cpt = m.poly.reduce((a, p) => ({ x: a.x + p.x / m.poly.length, y: a.y + p.y / m.poly.length }), { x: 0, y: 0 });
        const s = this.toS(cpt); ctx.fillText(String(m.alt / 100), s.x - 8, s.y);
      }
    }

    // range rings every 5 NM, every 10 NM stronger, with a compass rose on the 25 NM ring
    const arp = this.toS({ x: 0, y: 0 });
    for (let r = 5; r <= 60; r += 5) {
      ctx.strokeStyle = r % 10 ? S.ring : S.ring10; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(arp.x, arp.y, r * this.scale, 0, Math.PI * 2); ctx.stroke();
      if (r % 10 === 0) { ctx.fillStyle = S.ringText; ctx.font = mono(10); ctx.fillText(String(r), arp.x + 3, arp.y - r * this.scale - 3); }
    }
    const roseR = 25 * this.scale, mv = pack.meta.magVar;
    ctx.strokeStyle = S.rose; ctx.fillStyle = S.ringText; ctx.font = mono(10);
    for (let m = 0; m < 360; m += 5) {
      const a = (m + mv) * Math.PI / 180;
      const len = m % 30 === 0 ? 10 : m % 10 === 0 ? 6 : 3;
      const sx = Math.sin(a), sy = -Math.cos(a);
      ctx.beginPath(); ctx.moveTo(arp.x + sx * roseR, arp.y + sy * roseR); ctx.lineTo(arp.x + sx * (roseR - len), arp.y + sy * (roseR - len)); ctx.stroke();
      if (m % 30 === 0) { const t = String(m || 360).padStart(3, '0'); ctx.fillText(t, arp.x + sx * (roseR - 22) - 10, arp.y + sy * (roseR - 22) + 4); }
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
    // TSAs
    for (const t of pack.tsas) {
      const on = sim.tsaOn.has(t.name);
      this.path(ctx, t.poly);
      if (on) { ctx.fillStyle = S.tsaFill; ctx.fill(); this.hatch(ctx, t.poly, S.tsaOn); }
      ctx.strokeStyle = on ? S.tsaOn : S.tsaOff; ctx.lineWidth = on ? 1.6 : 1; ctx.setLineDash(on ? [] : [3, 5]); ctx.stroke(); ctx.setLineDash([]);
      const s = this.toS(t.poly[0]);
      ctx.fillStyle = on ? S.tsaOn : S.tsaOff; ctx.font = mono(10.5, on ? 600 : 400);
      ctx.fillText(`${t.name}${on ? ' ACT' : ''}  ${t.note?.split(',')[1]?.trim() ?? ''}`, s.x + 5, s.y + 14);
    }

    // procedures and holds
    if (this.settings.showProcedures) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = S.proc;
      for (const t of [...pack.transitions, ...pack.stars]) if (t.runways.includes(sim.runway)) { this.path(ctx, t.legs.map((l) => l.p), false); ctx.stroke(); }
      ctx.strokeStyle = S.sid; ctx.setLineDash([3, 4]);
      for (const t of pack.sids) if (t.runways.includes(sim.runway)) { this.path(ctx, t.legs.map((l) => l.p), false); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.strokeStyle = S.hold; ctx.lineWidth = 1.1;
      for (const h of pack.holds) this.racetrack(ctx, h.p, h.inbound, h.turn);
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
      if (d % 5 === 0 && this.scale > 6) { const lp = this.toS(move(cpt, rw.crs + 90, 1)); ctx.fillText(String(d), lp.x - 4, lp.y + 3); }
    }
    // runways as true-width strips with threshold bars
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

    // fixes: key approach fixes brighter
    const r = sim.rwy;
    const key2 = new Set(['ALHUV', r.ifFix, r.faf]);
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
    this.renderMap();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.map, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // weather
    ctx.imageSmoothingEnabled = true;
    sim.storms.forEach((st, i) => {
      const s = this.toS(st.p);
      const size = st.r * 2.6 * this.scale;
      ctx.drawImage(this.wxTexture(i), s.x - size / 2, s.y - size / 2, size, size);
    });

    // selected aircraft route preview
    const sel = this.selected ? sim.find(this.selected) : undefined;
    if (sel) {
      ctx.strokeStyle = S.route; ctx.lineWidth = 1.3; ctx.setLineDash([2, 5]);
      const pts = [this.plot(sel), ...sel.route.map((l) => l.p)];
      if (sel.mode === 'HOLD' && sel.hold) pts.push(sel.hold.p);
      if (sel.app && !sel.app.locCap) pts.push(move(sel.app.rwy.thr, sel.app.rwy.crs + 180, 10), sel.app.rwy.thr);
      if (pts.length > 1) { this.path(ctx, pts, false); ctx.stroke(); }
      ctx.setLineDash([]);
    }

    this.drawFtdi();
    this.drawRbls();

    // alerts between pairs
    const alerts = sim.alerts();
    const alertSet = new Set(alerts.flatMap((a) => [a.a, a.b]));
    for (const al of alerts) {
      const A = sim.find(al.a), B = sim.find(al.b);
      if (!A || !B) continue;
      const pa = this.toS(this.plot(A)), pb = this.toS(this.plot(B));
      ctx.strokeStyle = S.urgent; ctx.lineWidth = al.kind === 'los' ? 2 : 1.3; ctx.setLineDash(al.kind === 'los' ? [] : [6, 4]);
      ctx.shadowColor = S.urgent; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      this.haloText(`${dist(A.p, B.p).toFixed(1)}`, (pa.x + pb.x) / 2 + 5, (pa.y + pb.y) / 2 - 5, mono(this.fontPx - 1, 600), S.urgent);
    }

    // tracks and labels
    this.symbols.clear();
    const prevLabels = this.labels;
    this.labels = new Map();
    const flash = Math.floor(now / 500) % 2 === 0;
    const fp = this.fontPx;
    const lh = Math.round(fp * 1.2);
    ctx.font = mono(fp, 500);
    const cw = ctx.measureText('M').width;
    const placed: LabelBox[] = [];
    const order = [...sim.aircraft].sort((a, b) => (a.cs === this.selected ? 1 : 0) - (b.cs === this.selected ? 1 : 0) || (a.state === 'assumed' ? 1 : 0) - (b.state === 'assumed' ? 1 : 0));
    for (const ac of order) {
      const pos = this.plot(ac);
      const s = this.toS(pos);
      if (s.x < -200 || s.y < -200 || s.x > this.w + 200 || s.y > this.h + 200) continue;
      this.symbols.set(ac.cs, s);
      const urgent = alertSet.has(ac.cs) || ac.emergency !== undefined || sim.warningsFor(ac.cs).includes('MSAW') || this.clam(ac);
      let col = ac.state === 'assumed' ? S.assumed : ac.state === 'inbound' ? (flash ? S.notified : S.assumed) : ac.state === 'transferred' ? S.transferred : S.unconcerned;
      if (urgent && (ac.state === 'assumed' || ac.emergency)) col = S.urgent;

      // history plots
      ctx.fillStyle = col;
      ac.history.slice(0, -1).forEach((h, i, arr) => {
        const hs = this.toS(h); ctx.globalAlpha = 0.18 + (0.5 * (i + 1)) / arr.length;
        ctx.fillRect(hs.x - 1.2, hs.y - 1.2, 2.4, 2.4);
      });
      ctx.globalAlpha = 1;
      // speed vector with minute marks
      const vmin = this.settings.speedVectorMin;
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      const vEnd = this.toS(move(pos, ac.trk, (ac.gs * vmin) / 60));
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(vEnd.x, vEnd.y); ctx.stroke();
      for (let m = 1; m < vmin; m++) { const t = this.toS(move(pos, ac.trk, (ac.gs * m) / 60)); ctx.fillRect(t.x - 1.5, t.y - 1.5, 3, 3); }
      // symbol by surveillance/flight rules
      ctx.lineWidth = ac.state === 'assumed' ? 1.7 : 1.3;
      ctx.beginPath();
      if (ac.rules === 'VFR') ctx.arc(s.x, s.y, 3.8, 0, Math.PI * 2);
      else if (ac.rules === 'OAT') { ctx.moveTo(s.x, s.y - 5.2); ctx.lineTo(s.x + 5.2, s.y); ctx.lineTo(s.x, s.y + 5.2); ctx.lineTo(s.x - 5.2, s.y); ctx.closePath(); }
      else ctx.rect(s.x - 3.8, s.y - 3.8, 7.6, 7.6);
      ctx.stroke();
      if (ac.emergency && flash) { ctx.strokeStyle = S.urgent; ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.stroke(); }
      if (ac.cs === this.selected) {
        ctx.strokeStyle = S.select; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now / 260); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.x, s.y, 15 + 2 * Math.sin(now / 260), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // label
      let lines = this.labelLines(ac, ac.cs === this.selected);
      // zoomed out: minimised labels (callsign and level) for everything not selected or alerting
      if (this.scale < 4.6 && ac.cs !== this.selected && !urgent && ac.awaitingSince === undefined) lines = lines.slice(0, 2);
      const wch = Math.max(...lines.map((l) => l.reduce((n, seg) => n + seg.t.length, 0)));
      const bw = wch * cw + 4, bh = lines.length * lh + 3;
      let lx = s.x + ac.label.dx, ly = s.y + ac.label.dy;
      if (!this.userLabels.has(ac.cs)) {
        const cands = [[16, -bh - 8], [16, 8], [-bw - 16, -bh - 8], [-bw - 16, 8], [18, -bh / 2], [-bw - 18, -bh / 2], [-bw / 2, -bh - 18], [-bw / 2, 18]];
        const prev = prevLabels.get(ac.cs);
        const scored = cands.map(([dx, dy], i) => {
          const bx = s.x + dx, by = s.y + dy;
          let ov = 0;
          for (const p of placed) ov += Math.max(0, Math.min(bx + bw, p.x + p.w) - Math.max(bx, p.x)) * Math.max(0, Math.min(by + bh, p.y + p.h) - Math.max(by, p.y));
          for (const [, sy] of this.symbols) if (sy.x > bx - 8 && sy.x < bx + bw + 8 && sy.y > by - 8 && sy.y < by + bh + 8 && (sy.x !== s.x || sy.y !== s.y)) ov += 500;
          // keep clear of the speed vector
          const vx = vEnd.x - s.x, vy = vEnd.y - s.y;
          if ((dx > 0 ? vx > 0 : vx < 0) && (dy < 0 ? vy < 0 : vy > 0)) ov += 120;
          if (bx < 0 || by < 0 || bx + bw > this.w || by + bh > this.h) ov += 300;
          const sticky = prev && Math.abs(prev.x - bx) < 30 && Math.abs(prev.y - by) < 30 ? -80 : 0;
          return { dx, dy, score: ov + i * 3 + sticky };
        }).sort((a, b) => a.score - b.score);
        ac.label = { dx: scored[0].dx, dy: scored[0].dy };
        lx = s.x + ac.label.dx; ly = s.y + ac.label.dy;
      }
      const box: LabelBox = { x: lx, y: ly, w: bw, h: bh, lines: lines.length, lh };
      placed.push(box);
      this.labels.set(ac.cs, box);
      // leader line from the symbol edge to the label edge
      const tx = Math.max(lx, Math.min(s.x, lx + bw)), ty = Math.max(ly, Math.min(s.y, ly + bh));
      const ang = Math.atan2(ty - s.y, tx - s.x);
      ctx.strokeStyle = col; ctx.globalAlpha = 0.75; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x + Math.cos(ang) * 6, s.y + Math.sin(ang) * 6); ctx.lineTo(tx, ty); ctx.stroke(); ctx.globalAlpha = 1;
      if (ac.cs === this.selected) {
        ctx.fillStyle = 'rgba(86,210,234,0.10)'; ctx.fillRect(lx - 3, ly - 1, bw + 4, bh + 1);
        ctx.strokeStyle = S.select; ctx.lineWidth = 1; ctx.strokeRect(lx - 3, ly - 1, bw + 4, bh + 1);
      }
      // pilot waiting for a reply: box around the callsign
      if (ac.awaitingSince !== undefined && sim.t >= ac.awaitingSince && ac.state === 'assumed') {
        const age = sim.t - ac.awaitingSince;
        ctx.strokeStyle = age > 15 ? S.warn : col; ctx.globalAlpha = flash ? 1 : 0.35; ctx.lineWidth = 1.3;
        ctx.strokeRect(lx - 2, ly, (ac.cs.length + (ac.formation > 1 ? 2 : 0) + 0.3) * cw + 3, lh); ctx.globalAlpha = 1;
      }
      lines.forEach((segs, i) => {
        let x = lx;
        for (const seg of segs) {
          const c = seg.c === 'urgent' ? S.urgent : seg.c === 'warn' ? S.warn : seg.c === 'assigned' ? S.assigned : seg.c === 'dim' ? S.transferred : col;
          this.haloText(seg.t, x, ly + lh * (i + 1) - 3, mono(fp, seg.b ? 600 : 500), c);
          x += seg.t.length * cw;
        }
      });
    }

    this.drawMarks(now);
    if (this.showProfile) this.drawProfile();

    // heading drag preview
    if (this.hdgPreview && this.hdgPreview.text) {
      const { from, to, text } = this.hdgPreview;
      ctx.strokeStyle = S.select; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(86,210,234,0.18)'; ctx.beginPath(); ctx.arc(to.x, to.y, 16, 0, Math.PI * 2); ctx.fill();
      ctx.font = mono(15, 600);
      const tw = ctx.measureText(text).width;
      const bx = Math.min(this.w - tw - 16, Math.max(8, to.x - tw / 2 - 8)), by = Math.max(8, to.y - 54);
      ctx.fillStyle = 'rgba(10,18,24,0.9)'; ctx.fillRect(bx, by, tw + 16, 26);
      ctx.strokeStyle = S.select; ctx.lineWidth = 1.2; ctx.strokeRect(bx, by, tw + 16, 26);
      ctx.fillStyle = S.select; ctx.fillText(text, bx + 8, by + 18);
    }
    if (this.rblPreview) {
      const a = this.anchorXY(this.rblPreview.a);
      if (a) this.drawRbl(a, this.rblPreview.b, undefined, undefined);
    }

    // frame text and scale bar
    ctx.font = mono(11);
    const head = this.w < 560 ? `APP ${sim.pack.meta.appFreq}  ${sim.runway}  ${sim.atis}  Q${sim.qnh}` : `${sim.pack.meta.appCallsign.toUpperCase()} ${sim.pack.meta.appFreq}  RWY ${sim.runway}  ATIS ${sim.atis}  QNH ${sim.qnh}  TL${String(sim.tl).padStart(3, '0')}`;
    this.haloText(head, 10, 18, mono(11), S.ringText);
    const rng = this.w < 560 ? `${this.rblMode ? 'RBL ' : ''}${this.rangeNm()} NM` : `${this.rblMode ? 'RBL  ' : ''}RANGE ${this.rangeNm()}  ${sim.radarRefresh}s`;
    ctx.font = mono(11);
    this.haloText(rng, this.w - ctx.measureText(rng).width - 10, 18, mono(11), this.rblMode ? S.rbl : S.ringText);
    const nm = this.scale > 14 ? 2 : this.scale > 6 ? 5 : 10;
    ctx.strokeStyle = S.ringText; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, this.h - 12); ctx.lineTo(10 + nm * this.scale, this.h - 12); ctx.moveTo(10, this.h - 16); ctx.lineTo(10, this.h - 8); ctx.moveTo(10 + nm * this.scale, this.h - 16); ctx.lineTo(10 + nm * this.scale, this.h - 8); ctx.stroke();
    this.haloText(`${nm} NM`, 14 + nm * this.scale, this.h - 8, mono(11), S.ringText);
  }

  private haloText(t: string, x: number, y: number, font: string, color: string) {
    const { ctx } = this;
    ctx.font = font;
    ctx.lineWidth = 3; ctx.strokeStyle = this.skin.halo; ctx.lineJoin = 'round';
    ctx.strokeText(t, x, y);
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  }

  /** Final approach target distance indicators (FTDi): where each follower should be, given the leader and wake pair. */
  private drawFtdi() {
    const { ctx, sim } = this;
    const S = this.skin;
    const rw = sim.rwy;
    const seq = sim.aircraft.filter((a) => a.app && a.app.rwy.id === rw.id && !a.landed && (a.app.locCap || Math.abs(crossTrack(a.p, rw.thr, rw.crs)) < 3))
      .map((a) => ({ a, d: -alongTrack(a.p, rw.thr, rw.crs) })).filter((x) => x.d > 0 && x.d < 25).sort((x, y) => x.d - y.d);
    for (let i = 1; i < seq.length; i++) {
      const lead = seq[i - 1], fol = seq[i];
      const min = Math.max(wakeMinNm(lead.a.perf.recat, fol.a.perf.recat, 2.5), lead.d < 10 ? 2.5 : 3, sim.lvp ? 4 : 0);
      const tgt = lead.d + min;
      if (tgt > 25) continue;
      const short = fol.d < tgt - 0.05;
      const c = this.toS(move(rw.thr, rw.crs + 180, tgt));
      const a = (rw.crs * Math.PI) / 180;
      const fx = Math.sin(a), fy = -Math.cos(a); // toward the threshold on screen
      const nx = -fy, ny = fx;
      const w = 7, dpt = 6;
      ctx.strokeStyle = short ? S.urgent : S.ftdi; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x + nx * w - fx * dpt, c.y + ny * w - fy * dpt);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(c.x - nx * w - fx * dpt, c.y - ny * w - fy * dpt);
      ctx.stroke();
      if (short || fol.a.cs === this.selected) this.haloText(`${fol.a.cs} ${min.toFixed(1)}`, c.x + nx * 11 + 2, c.y + ny * 11 + 4, mono(9.5, 500), short ? S.urgent : S.ftdi);
    }
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
      // closest point of approach on present tracks
      const va = { x: Math.sin(A.trk * Math.PI / 180) * A.gs, y: Math.cos(A.trk * Math.PI / 180) * A.gs };
      const vb = { x: Math.sin(B.trk * Math.PI / 180) * B.gs, y: Math.cos(B.trk * Math.PI / 180) * B.gs };
      const dp = { x: B.p.x - A.p.x, y: B.p.y - A.p.y }, dv = { x: (vb.x - va.x) / 3600, y: (vb.y - va.y) / 3600 };
      const vv = dv.x * dv.x + dv.y * dv.y;
      const tc = vv > 1e-9 ? Math.max(0, -(dp.x * dv.x + dp.y * dv.y) / vv) : 0;
      const dmin = Math.hypot(dp.x + dv.x * tc, dp.y + dv.y * tc);
      if (tc > 0 && tc < 1200) {
        text += `  CPA ${dmin.toFixed(1)} ${Math.floor(tc / 60)}:${String(Math.round(tc % 60)).padStart(2, '0')}`;
        if (dmin < 3 && Math.abs(A.alt - B.alt) < 1000) col = S.urgent;
      }
    }
    const mx = (sa.x + sb.x) / 2, my = (sa.y + sb.y) / 2 - 6;
    this.haloText(text, mx - text.length * 3.2, my, mono(11, 600), col);
    return { x: mx, y: my };
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

  // ================= final monitor (training aid) =================
  /** Side view of the last 15 NM of the active final against the 3° glidepath. */
  private drawProfile() {
    const { ctx, sim } = this;
    const S = this.skin;
    const rw = sim.rwy;
    const W = Math.min(380, this.w * 0.62), H = 128;
    const x0 = 10, y0 = this.h - H - 30;
    const maxD = 15, maxA = 6000;
    ctx.fillStyle = 'rgba(8,14,19,0.82)'; ctx.fillRect(x0, y0, W, H);
    ctx.strokeStyle = S.ring10; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, W - 1, H - 1);
    const pl = x0 + 34, pr = x0 + W - 10, pt = y0 + 20, pb = y0 + H - 18;
    const X = (d: number) => pl + (d / maxD) * (pr - pl);
    const Y = (a: number) => pb - ((a - rw.elevation) / (maxA - rw.elevation)) * (pb - pt);
    ctx.font = mono(9.5); ctx.fillStyle = S.ringText;
    for (let a = 1000; a <= maxA; a += 1000) { ctx.strokeStyle = S.ring; ctx.beginPath(); ctx.moveTo(pl, Y(a)); ctx.lineTo(pr, Y(a)); ctx.stroke(); ctx.fillText(String(a / 1000) + 'k', x0 + 6, Y(a) + 3); }
    for (let d = 0; d <= maxD; d += 5) { ctx.fillText(String(d), X(d) - 3, pb + 12); }
    // glidepath and FAF
    ctx.strokeStyle = S.centreline; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(0), Y(rw.elevation + 50)); ctx.lineTo(X(maxD), Y(rw.elevation + 50 + maxD * 318.4)); ctx.stroke();
    const faf = sim.pack.fixes.get(rw.faf);
    if (faf) {
      const fd = -alongTrack(faf.p, rw.thr, rw.crs);
      ctx.strokeStyle = S.fixKey; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(X(fd), pt); ctx.lineTo(X(fd), pb); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = S.fixKey; ctx.fillText(rw.faf, X(fd) + 3, pt + 8);
    }
    this.haloText(`FINAL ${rw.id}  3.0°  training aid`, x0 + 8, y0 + 13, mono(10, 600), S.ringText);
    for (const ac of sim.aircraft) {
      const d = -alongTrack(ac.p, rw.thr, rw.crs);
      const xt = Math.abs(crossTrack(ac.p, rw.thr, rw.crs));
      if (d < 0 || d > maxD || xt > 4 || ac.alt > maxA) continue;
      const dev = ac.alt - (rw.elevation + 50 + d * 318.4);
      const c = ac.app?.locCap ? (dev > 300 ? S.warn : dev < -200 ? S.urgent : S.assumed) : S.transferred;
      const px = X(d), py = Y(ac.alt);
      ctx.fillStyle = c; ctx.fillRect(px - 3, py - 3, 6, 6);
      this.haloText(ac.cs, px + 5, py - 5, mono(10, 600), c);
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
    if (ac.perf.wake === 'H' || ac.perf.wake === 'J') l1.push({ t: ` ${ac.perf.wake}`, c: 'warn' });
    if (ac.emergency) l1.push({ t: ` ${ac.sqk}`, c: 'urgent', b: true });
    for (const w of sim.warningsFor(ac.cs)) l1.push({ t: ` ${w}`, c: 'urgent', b: true });
    if (this.clam(ac)) l1.push({ t: ' CLAM', c: 'urgent', b: true });
    if (ac.request && ac.state === 'assumed') l1.push({ t: ' REQ', c: 'warn', b: true });
    if (ac.state === 'unconcerned' || ac.state === 'transferred') {
      return [l1, [{ t: afl + trend }, { t: ac.state === 'transferred' ? ` ${ac.xfrUnit ?? ''}` : '', c: 'dim' }]];
    }
    const l2: Seg[] = [{ t: afl + trend }];
    if (Math.abs(ac.alt - sim.ftOf(cflSys)) > 150 && !ac.app?.gsCap) l2.push({ t: cfl });
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
    } else if (ac.mode === 'HOLD') l4.push({ t: `HLD ${ac.hold?.fix ?? ''}`, c: 'warn' });
    else if (ac.mode === 'NAV' && ac.route[0]) l4.push({ t: ac.route[ac.route.length - 1].fix === ac.route[0].fix ? ac.route[0].fix : `${ac.route[0].fix}` });
    else if (ac.kind === 'dep' && ac.exitFix) l4.push({ t: ac.exitFix });
    if (ac.rules === 'VFR') l4.push({ t: `${l4.length ? ' ' : ''}VFR` });
    if (!l4.length) l4.push({ t: ac.proc ?? '' });
    const lines = [l1, l2, l3, l4];
    if (extended) lines.push([{ t: `${ac.type}/${ac.perf.recat} A${ac.sqk} ${ac.proc ?? ''}`, c: 'dim' }]);
    return lines;
  }
}

export { pointInPolygon };
