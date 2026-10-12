import { bearing, dist, move, norm360, type XY } from '../geo';
import type { Sim } from '../engine/sim';
import type { Aircraft } from '../engine/types';
import type { Item } from '../engine/clearance';
import { levelShort } from '../engine/clearance';
import type { Settings } from '../store';

/** Every colour on the scope lives here so the display can be tuned to match the real one. */
export const SKIN = {
  night: {
    bg0: '#0e161d', bg1: '#15212b', ring: 'rgba(150,180,200,0.09)', ringText: 'rgba(150,180,200,0.32)',
    map: 'rgba(150,178,195,0.30)', mapDim: 'rgba(150,178,195,0.13)', river: 'rgba(95,140,170,0.28)', town: 'rgba(150,175,190,0.30)',
    ctr: 'rgba(125,175,205,0.40)', tma: 'rgba(125,175,205,0.16)', centreline: 'rgba(205,220,230,0.38)', runway: '#e9f1f4',
    fix: 'rgba(170,192,205,0.55)', fixText: 'rgba(170,192,205,0.55)', proc: 'rgba(110,165,200,0.17)', sid: 'rgba(160,140,200,0.12)',
    assumed: '#e9f1f4', inbound: '#f2c14e', transferred: '#7f97a8', unconcerned: '#56697a', select: '#4fd1e8', alert: '#ff5a52',
    tsaOn: 'rgba(242,184,75,0.55)', tsaFill: 'rgba(242,184,75,0.07)', tsaOff: 'rgba(242,184,75,0.12)', mva: 'rgba(140,190,140,0.22)',
    storm: 'rgba(235,90,70,', route: 'rgba(79,209,232,0.55)', text: '#c9d6de',
  },
  day: {
    bg0: '#1b2833', bg1: '#24343f', ring: 'rgba(170,200,220,0.12)', ringText: 'rgba(170,200,220,0.42)',
    map: 'rgba(175,200,215,0.40)', mapDim: 'rgba(175,200,215,0.18)', river: 'rgba(120,170,200,0.40)', town: 'rgba(180,200,215,0.42)',
    ctr: 'rgba(150,200,225,0.50)', tma: 'rgba(150,200,225,0.22)', centreline: 'rgba(225,235,240,0.5)', runway: '#ffffff',
    fix: 'rgba(195,215,225,0.7)', fixText: 'rgba(195,215,225,0.7)', proc: 'rgba(130,185,215,0.24)', sid: 'rgba(180,160,220,0.18)',
    assumed: '#ffffff', inbound: '#ffd166', transferred: '#9db3c2', unconcerned: '#71889a', select: '#5fe0f5', alert: '#ff6b63',
    tsaOn: 'rgba(255,200,90,0.65)', tsaFill: 'rgba(255,200,90,0.09)', tsaOff: 'rgba(255,200,90,0.16)', mva: 'rgba(160,210,160,0.3)',
    storm: 'rgba(255,110,90,', route: 'rgba(95,224,245,0.65)', text: '#e3edf2',
  },
};

type Field = 'cs' | 'lvl' | 'spd' | 'app';
interface LabelBox { x: number; y: number; w: number; h: number; lines: number; lh: number }

export interface ScopeEvents {
  select(cs: string | undefined): void;
  item(cs: string, item: Item): void;
  field(cs: string, f: Field, at: { x: number; y: number }): void;
  longPress(cs: string): void;
  emptyTap?(): void;
}

export class Scope {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  center: XY = { x: 1, y: -1 };
  scale = 8; // px per NM
  selected?: string;
  private labels = new Map<string, LabelBox>();
  private symbols = new Map<string, XY>();
  private pointers = new Map<number, { x: number; y: number }>();
  private drag?: { kind: 'pan' | 'hdg' | 'label' | 'pinch' | 'none'; cs?: string; field?: Field; x0: number; y0: number; c0: XY; s0: number; d0?: number; moved: boolean; t0: number; lp?: number };
  private hdgPreview?: { from: XY; to: { x: number; y: number }; text: string };
  private userLabels = new Set<string>();

  constructor(public canvas: HTMLCanvasElement, public sim: Sim, public settings: Settings, public ev: ScopeEvents) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.fit();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.moveP(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.drag = undefined; this.hdgPreview = undefined; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get skin() { return SKIN[this.settings.brightness]; }
  get fontPx() { return this.settings.labelSize === 'S' ? 11 : this.settings.labelSize === 'L' ? 14.5 : 12.5; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }
  fit() {
    const half = 26;
    this.scale = Math.min(this.w, this.h) / (2 * half);
    this.center = { x: 2, y: -1 };
  }
  rangeNm() { return Math.round(Math.min(this.w, this.h) / this.scale / 2); }
  toS(p: XY) { return { x: this.w / 2 + (p.x - this.center.x) * this.scale, y: this.h / 2 - (p.y - this.center.y) * this.scale }; }
  toW(x: number, y: number): XY { return { x: this.center.x + (x - this.w / 2) / this.scale, y: this.center.y - (y - this.h / 2) / this.scale }; }
  zoomAt(x: number, y: number, f: number) {
    const before = this.toW(x, y);
    this.scale = Math.max(2.2, Math.min(60, this.scale * f));
    const after = this.toW(x, y);
    this.center = { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y };
  }
  zoom(f: number) { this.zoomAt(this.w / 2, this.h / 2, f); }

  /** Position shown on the scope: the last radar plot. */
  plot(ac: Aircraft): XY { return ac.history[ac.history.length - 1] ?? ac.p; }

  // ---------------- interaction ----------------
  private hitAircraft(x: number, y: number): string | undefined {
    let best: string | undefined, bd = 24;
    for (const [cs, s] of this.symbols) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = cs; } }
    return best;
  }
  private hitLabel(x: number, y: number): { cs: string; f: Field } | undefined {
    for (const [cs, b] of this.labels) {
      if (x >= b.x - 3 && x <= b.x + b.w + 3 && y >= b.y - 3 && y <= b.y + b.h + 3) {
        const line = Math.floor((y - b.y) / b.lh);
        const f: Field = line <= 0 ? 'cs' : line === 1 ? 'lvl' : line === 2 ? 'spd' : 'app';
        return { cs, f };
      }
    }
    return undefined;
  }
  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, c0: { ...this.center }, s0: this.scale, d0: Math.hypot(a.x - b.x, a.y - b.y), moved: true, t0: performance.now() };
      this.hdgPreview = undefined;
      return;
    }
    const x = e.offsetX, y = e.offsetY;
    const lab = this.hitLabel(x, y);
    const sym = this.hitAircraft(x, y);
    const base = { x0: x, y0: y, c0: { ...this.center }, s0: this.scale, moved: false, t0: performance.now() };
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

  // ---------------- drawing ----------------
  draw(now: number) {
    const { ctx, sim } = this;
    const S = this.skin;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // background
    const g = ctx.createRadialGradient(this.w * 0.5, this.h * 0.45, 0, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, S.bg1); g.addColorStop(1, S.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const mono = (px: number, wt = 400) => `${wt} ${px}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;

    // range rings around the ARP
    const arp = this.toS({ x: 0, y: 0 });
    ctx.strokeStyle = S.ring; ctx.lineWidth = 1;
    ctx.font = mono(10);
    ctx.fillStyle = S.ringText;
    for (let r = 10; r <= 60; r += 10) {
      ctx.beginPath(); ctx.arc(arp.x, arp.y, r * this.scale, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(String(r), arp.x + 3, arp.y - r * this.scale + 11);
    }

    const pack = sim.pack;
    const poly = (pts: XY[], close = true) => { ctx.beginPath(); pts.forEach((p, i) => { const s = this.toS(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); if (close) ctx.closePath(); };

    // MVA
    if (this.settings.showMva) {
      ctx.strokeStyle = S.mva; ctx.setLineDash([2, 4]);
      for (const m of pack.mva) { poly(m.poly); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.fillStyle = S.mva; ctx.font = mono(11, 500);
      for (const m of pack.mva) {
        const c = m.poly.reduce((a, p) => ({ x: a.x + p.x / m.poly.length, y: a.y + p.y / m.poly.length }), { x: 0, y: 0 });
        const s = this.toS(c); ctx.fillText(String(m.alt / 100), s.x, s.y);
      }
    }
    // TMA and CTR
    ctx.strokeStyle = S.tma; ctx.setLineDash([6, 6]); poly(pack.tma.poly); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = S.ctr; ctx.lineWidth = 1.1; poly(pack.ctr.poly); ctx.stroke();
    // TSAs
    for (const t of pack.tsas) {
      const on = sim.tsaOn.has(t.name);
      poly(t.poly);
      if (on) { ctx.fillStyle = S.tsaFill; ctx.fill(); this.hatch(t.poly, S.tsaOn); }
      ctx.strokeStyle = on ? S.tsaOn : S.tsaOff; ctx.lineWidth = on ? 1.5 : 1; ctx.setLineDash(on ? [] : [3, 5]); ctx.stroke(); ctx.setLineDash([]);
      const s = this.toS(t.poly[0]);
      ctx.fillStyle = on ? S.tsaOn : S.tsaOff; ctx.font = mono(10.5, on ? 600 : 400);
      ctx.fillText(`${t.name}${on ? ' ACT' : ''}`, s.x + 4, s.y + 13);
    }
    // river and towns
    ctx.strokeStyle = S.river; ctx.lineWidth = 1.4;
    for (const l of pack.mapLines) { poly(l.pts, false); ctx.stroke(); }
    ctx.font = `400 10.5px "IBM Plex Sans Condensed", sans-serif`; ctx.fillStyle = S.town;
    for (const [, f] of pack.fixes) if (f.kind === 'town') { const s = this.toS(f.p); ctx.fillText(f.note ?? f.id, s.x + 3, s.y - 3); ctx.fillRect(s.x - 1, s.y - 1, 2, 2); }

    // procedures
    if (this.settings.showProcedures) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = S.proc;
      for (const t of [...pack.transitions, ...pack.stars]) if (t.runways.includes(sim.runway)) { poly(t.legs.map((l) => l.p), false); ctx.stroke(); }
      ctx.strokeStyle = S.sid;
      for (const t of pack.sids) if (t.runways.includes(sim.runway)) { poly(t.legs.map((l) => l.p), false); ctx.stroke(); }
    }

    // extended centreline of the active runway
    const rw = sim.rwy;
    ctx.strokeStyle = S.centreline; ctx.lineWidth = 1;
    const fin = (d: number) => this.toS(move(rw.thr, rw.crs + 180, d));
    ctx.setLineDash([4, 5]); ctx.beginPath(); const a0 = fin(0), a1 = fin(16); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.stroke(); ctx.setLineDash([]);
    for (let d = 1; d <= 15; d++) {
      const c = move(rw.thr, rw.crs + 180, d);
      const len = (d % 5 === 0 ? 0.55 : 0.25);
      const p1 = this.toS(move(c, rw.crs + 90, len)), p2 = this.toS(move(c, rw.crs - 90, len));
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
    // runways
    for (const s of pack.strips) {
      const p1 = this.toS(s.a), p2 = this.toS(s.b);
      const active = s.ends.includes(sim.runway);
      ctx.strokeStyle = S.runway; ctx.globalAlpha = active ? 1 : 0.55; ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = mono(10.5); ctx.fillStyle = S.fixText;
    const thrS = this.toS(rw.thr); ctx.fillText(rw.id, thrS.x + 6, thrS.y + 12);

    // fixes
    const fixes = this.visibleFixes();
    const showText = this.scale > 4;
    for (const f of fixes) {
      const s = this.toS(f.p);
      if (s.x < -20 || s.y < -20 || s.x > this.w + 20 || s.y > this.h + 20) continue;
      ctx.strokeStyle = S.fix; ctx.lineWidth = 1;
      ctx.beginPath();
      if (f.kind === 'vor') { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const px = s.x + Math.cos(a) * 5, py = s.y + Math.sin(a) * 5; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }
      else if (f.kind === 'vfr') { ctx.rect(s.x - 3, s.y - 3, 6, 6); }
      else { ctx.moveTo(s.x, s.y - 4.5); ctx.lineTo(s.x + 4, s.y + 3); ctx.lineTo(s.x - 4, s.y + 3); ctx.closePath(); }
      ctx.stroke();
      if (showText || f.id === 'ALHUV') { ctx.fillStyle = S.fixText; ctx.font = mono(10); ctx.fillText(f.id, s.x + 6, s.y + 3.5); }
    }

    // storms
    for (const st of sim.storms) {
      const s = this.toS(st.p);
      const rr = st.r * this.scale;
      const gr = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, rr * 1.25);
      gr.addColorStop(0, S.storm + '0.42)'); gr.addColorStop(0.65, S.storm + '0.22)'); gr.addColorStop(1, S.storm + '0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(s.x, s.y, rr * 1.25, 0, Math.PI * 2); ctx.fill();
    }

    // selected aircraft route
    const sel = this.selected ? sim.find(this.selected) : undefined;
    if (sel) {
      ctx.strokeStyle = S.route; ctx.lineWidth = 1.2; ctx.setLineDash([2, 4]);
      const pts = [this.plot(sel), ...sel.route.map((l) => l.p)];
      if (sel.mode === 'HOLD' && sel.hold) pts.push(sel.hold.p);
      if (pts.length > 1) { poly(pts, false); ctx.stroke(); }
      ctx.setLineDash([]);
    }

    // aircraft
    this.symbols.clear();
    const prevLabels = this.labels;
    this.labels = new Map();
    const alerts = sim.alerts();
    const alertSet = new Set(alerts.flatMap((a) => [a.a, a.b]));
    const flash = Math.floor(now / 500) % 2 === 0;
    const fp = this.fontPx;
    const lh = Math.round(fp * 1.18);
    ctx.font = mono(fp, 500);
    const cw = ctx.measureText('M').width;
    const placed: LabelBox[] = [];

    // alert lines
    for (const al of alerts) {
      const A = sim.find(al.a), B = sim.find(al.b);
      if (!A || !B) continue;
      const pa = this.toS(this.plot(A)), pb = this.toS(this.plot(B));
      ctx.strokeStyle = S.alert; ctx.lineWidth = al.kind === 'los' ? 2 : 1.2; ctx.setLineDash(al.kind === 'los' ? [] : [5, 4]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = mono(fp - 1, 600); ctx.fillStyle = S.alert;
      ctx.fillText(`${dist(A.p, B.p).toFixed(1)}`, (pa.x + pb.x) / 2 + 4, (pa.y + pb.y) / 2 - 4);
    }

    const order = [...sim.aircraft].sort((a, b) => (a.cs === this.selected ? 1 : 0) - (b.cs === this.selected ? 1 : 0));
    for (const ac of order) {
      const pos = this.plot(ac);
      const s = this.toS(pos);
      if (s.x < -200 || s.y < -200 || s.x > this.w + 200 || s.y > this.h + 200) continue;
      this.symbols.set(ac.cs, s);
      const alert = alertSet.has(ac.cs) || ac.emergency !== undefined || sim.warningsFor(ac.cs).length > 0;
      let col = ac.state === 'assumed' ? S.assumed : ac.state === 'inbound' ? S.inbound : ac.state === 'transferred' ? S.transferred : S.unconcerned;
      if (ac.state === 'inbound' && !flash) col = S.transferred;
      if (alert && (ac.state === 'assumed' || ac.emergency)) col = S.alert;
      // history
      ctx.fillStyle = col;
      ac.history.slice(0, -1).forEach((h, i, arr) => {
        const hs = this.toS(h); ctx.globalAlpha = 0.15 + (0.55 * (i + 1)) / arr.length;
        ctx.beginPath(); ctx.arc(hs.x, hs.y, 1.5, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      // speed vector
      const vmin = this.settings.speedVectorMin;
      const vEnd = this.toS(move(pos, ac.trk, (ac.gs * vmin) / 60));
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(vEnd.x, vEnd.y); ctx.stroke();
      // symbol
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ac.rules === 'VFR') ctx.arc(s.x, s.y, 3.6, 0, Math.PI * 2);
      else if (ac.rules === 'OAT') { ctx.moveTo(s.x, s.y - 5); ctx.lineTo(s.x + 5, s.y); ctx.lineTo(s.x, s.y + 5); ctx.lineTo(s.x - 5, s.y); ctx.closePath(); }
      else ctx.rect(s.x - 3.6, s.y - 3.6, 7.2, 7.2);
      ctx.stroke();
      if (ac.cs === this.selected) {
        ctx.strokeStyle = S.select; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI * 2); ctx.stroke();
      }

      // label content
      const lines = this.labelLines(ac);
      const wch = Math.max(...lines.map((l) => l.reduce((n, seg) => n + seg.t.length, 0)));
      const bw = wch * cw + 6, bh = lines.length * lh + 4;
      let lx = s.x + ac.label.dx, ly = s.y + ac.label.dy;
      if (!this.userLabels.has(ac.cs)) {
        const cands = [[14, -bh - 6], [14, 8], [-bw - 14, -bh - 6], [-bw - 14, 8], [14, -bh / 2], [-bw - 14, -bh / 2]];
        const prev = prevLabels.get(ac.cs);
        const scored = cands.map(([dx, dy], i) => {
          const bx = s.x + dx, by = s.y + dy;
          let ov = 0;
          for (const p of placed) ov += Math.max(0, Math.min(bx + bw, p.x + p.w) - Math.max(bx, p.x)) * Math.max(0, Math.min(by + bh, p.y + p.h) - Math.max(by, p.y));
          for (const [, sy] of this.symbols) if (sy.x > bx - 6 && sy.x < bx + bw + 6 && sy.y > by - 6 && sy.y < by + bh + 6 && (sy.x !== s.x || sy.y !== s.y)) ov += 400;
          if (bx < 0 || by < 0 || bx + bw > this.w || by + bh > this.h) ov += 200;
          const sticky = prev && Math.abs(prev.x - bx) < 30 && Math.abs(prev.y - by) < 30 ? -60 : 0;
          return { dx, dy, score: ov + i * 2 + sticky };
        }).sort((a, b) => a.score - b.score);
        ac.label = { dx: scored[0].dx, dy: scored[0].dy };
        lx = s.x + ac.label.dx; ly = s.y + ac.label.dy;
      }
      const box: LabelBox = { x: lx, y: ly, w: bw, h: bh, lines: lines.length, lh };
      placed.push(box);
      this.labels.set(ac.cs, box);
      // leader
      const lxC = Math.max(lx, Math.min(s.x, lx + bw)), lyC = Math.max(ly, Math.min(s.y, ly + bh));
      ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(lxC, lyC); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = this.settings.brightness === 'night' ? 'rgba(10,17,23,0.62)' : 'rgba(20,32,41,0.62)';
      ctx.fillRect(lx - 2, ly - 1, bw + 2, bh);
      if (ac.cs === this.selected) {
        ctx.fillStyle = 'rgba(79,209,232,0.10)'; ctx.fillRect(lx - 2, ly - 1, bw + 2, bh);
        ctx.strokeStyle = S.select; ctx.lineWidth = 1; ctx.strokeRect(lx - 2, ly - 1, bw + 2, bh);
      }
      // awaiting call indicator
      if (ac.awaitingSince !== undefined && sim.t >= ac.awaitingSince && ac.state === 'assumed') {
        const age = sim.t - ac.awaitingSince;
        ctx.strokeStyle = age > 15 ? S.inbound : col; ctx.globalAlpha = flash ? 1 : 0.35; ctx.lineWidth = 1.2;
        ctx.strokeRect(lx - 1, ly, (ac.cs.length + 0.4) * cw + 2, lh); ctx.globalAlpha = 1;
      }
      lines.forEach((segs, i) => {
        let x = lx + 1;
        for (const seg of segs) {
          ctx.font = mono(fp, seg.b ? 600 : 500);
          ctx.fillStyle = seg.c === 'alert' ? S.alert : seg.c === 'amber' ? S.inbound : seg.c === 'sel' ? S.select : seg.c === 'dim' ? S.transferred : col;
          ctx.fillText(seg.t, x, ly + lh * (i + 1) - 2);
          x += seg.t.length * cw;
        }
      });
    }

    // heading drag preview
    if (this.hdgPreview && this.hdgPreview.text) {
      const { from, to, text } = this.hdgPreview;
      ctx.strokeStyle = S.select; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(79,209,232,0.18)'; ctx.beginPath(); ctx.arc(to.x, to.y, 16, 0, Math.PI * 2); ctx.fill();
      ctx.font = mono(15, 600);
      const tw = ctx.measureText(text).width;
      const bx = Math.min(this.w - tw - 16, Math.max(8, to.x - tw / 2 - 8)), by = Math.max(8, to.y - 54);
      ctx.fillStyle = 'rgba(10,20,26,0.88)'; ctx.fillRect(bx, by, tw + 16, 26);
      ctx.strokeStyle = S.select; ctx.lineWidth = 1.2; ctx.strokeRect(bx, by, tw + 16, 26);
      ctx.fillStyle = S.select; ctx.fillText(text, bx + 8, by + 18);
    }

    // frame text and scale bar
    ctx.font = mono(11); ctx.fillStyle = S.ringText;
    ctx.fillText(`${pack.meta.appCallsign.toUpperCase()} ${pack.meta.appFreq} · RWY ${sim.runway} · ATIS ${sim.atis}`, 10, 18);
    const rng = `RANGE ${this.rangeNm()}`;
    ctx.fillText(rng, this.w - ctx.measureText(rng).width - 10, 18);
    const nm = this.scale > 14 ? 2 : this.scale > 6 ? 5 : 10;
    ctx.strokeStyle = S.ringText; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(10, this.h - 12); ctx.lineTo(10 + nm * this.scale, this.h - 12); ctx.moveTo(10, this.h - 16); ctx.lineTo(10, this.h - 8); ctx.moveTo(10 + nm * this.scale, this.h - 16); ctx.lineTo(10 + nm * this.scale, this.h - 8); ctx.stroke();
    ctx.fillText(`${nm} NM`, 14 + nm * this.scale, this.h - 8);
  }

  private hatch(pts: XY[], color: string) {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath(); pts.forEach((p, i) => { const s = this.toS(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
    const xs = pts.map((p) => this.toS(p));
    const minX = Math.min(...xs.map((s) => s.x)), maxX = Math.max(...xs.map((s) => s.x)), minY = Math.min(...xs.map((s) => s.y)), maxY = Math.max(...xs.map((s) => s.y));
    for (let x = minX - (maxY - minY); x < maxX; x += 12) { ctx.beginPath(); ctx.moveTo(x, maxY); ctx.lineTo(x + (maxY - minY), minY); ctx.stroke(); }
    ctx.restore();
  }

  labelLines(ac: Aircraft): { t: string; c?: 'alert' | 'amber' | 'sel' | 'dim'; b?: boolean }[][] {
    const sim = this.sim;
    const afl = sim.levelFor(Math.round(ac.alt / 100) * 100);
    const aflS = levelShort(afl);
    const trend = ac.vs > 300 ? '↑' : ac.vs < -300 ? '↓' : ' ';
    const cflS = levelShort(ac.cleared);
    const l1: { t: string; c?: any; b?: boolean }[] = [{ t: ac.cs + (ac.formation > 1 ? `x${ac.formation}` : ''), b: true }];
    if (ac.emergency) l1.push({ t: ` ${ac.sqk}`, c: 'alert', b: true });
    const warn = sim.warningsFor(ac.cs);
    if (warn.length) l1.push({ t: ` ${warn[0]}`, c: 'alert', b: true });
    if (ac.request && ac.state === 'assumed') l1.push({ t: ' REQ', c: 'amber', b: true });
    if (ac.state === 'unconcerned' || ac.state === 'transferred') {
      return [l1, [{ t: aflS + trend }]];
    }
    const levelLine = [{ t: aflS + trend }, { t: Math.abs(ac.alt - ac.tgtAlt) > 150 || ac.mode !== 'LOC' ? cflS : '' }];
    const gs = String(Math.round(ac.gs / 10) * 10).padStart(3, '0');
    const spd: { t: string; c?: any }[] = [{ t: `${gs} ${ac.type}${ac.perf.wake}` }];
    if (ac.spdAssigned) spd.push({ t: ` S${ac.spdAssigned}`, c: 'sel' });
    else if (ac.spdMin) spd.push({ t: ' SMIN', c: 'sel' });
    const l4: { t: string; c?: any }[] = [];
    if (ac.app) l4.push({ t: ac.app.locCap ? `${ac.app.type === 'ILS' ? 'LOC' : 'APP'}${ac.app.rwy.id}` : `${ac.app.type[0]}${ac.app.rwy.id}`, c: ac.app.locCap ? undefined : 'sel' });
    if (ac.mode === 'HDG' && ac.hdgAssigned !== undefined) l4.push({ t: `${l4.length ? ' ' : ''}H${String(Math.round(norm360(ac.hdgAssigned - sim.pack.meta.magVar)) || 360).padStart(3, '0')}`, c: 'sel' });
    else if (ac.mode === 'HOLD') l4.push({ t: `${l4.length ? ' ' : ''}HLD`, c: 'amber' });
    else if (ac.mode === 'NAV' && ac.route[0] && !ac.app?.locCap) l4.push({ t: `${l4.length ? ' ' : ''}${ac.route[0].fix.slice(0, 5)}` });
    if (ac.kind === 'dep' && ac.exitFix && !l4.length) l4.push({ t: ac.exitFix });
    if (ac.rules === 'VFR' && !l4.length) l4.push({ t: 'VFR' });
    return [l1, levelLine, spd, l4.length ? l4 : [{ t: ac.proc ?? '' }]];
  }
}
