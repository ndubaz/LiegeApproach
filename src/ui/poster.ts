// Canvas pieces for the debrief: the session poster (every track as a light trail over the video map)
// and the side-by-side ghost replay (your session against the expert's, on two small scopes).

import type { Pack } from '../pack/load';
import type { XY } from '../geo';
import { move, parseLatLon } from '../geo';
import { posAt, type Divergence, type TrackLine, type TrackLog } from '../engine/career';
import { SKIN, withAlpha, type Skin } from './skins';

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const SANS = '"IBM Plex Sans Condensed", "Arial Narrow", sans-serif';

export interface View { cx: number; cy: number; scale: number; w: number; h: number; ox?: number; oy?: number }
const toS = (v: View, p: XY) => ({ x: (v.ox ?? 0) + v.w / 2 + (p.x - v.cx) * v.scale, y: (v.oy ?? 0) + v.h / 2 - (p.y - v.cy) * v.scale });

/** Altitude colour: #6f8fa3 at FL100 and above, through to #ffffff on the ground. */
export function altColor(alt: number, a = 1): string {
  const k = Math.max(0, Math.min(1, (alt - 800) / 9200));
  const hi = [0x6f, 0x8f, 0xa3], lo = [0xff, 0xff, 0xff];
  const c = lo.map((l, i) => Math.round(l + (hi[i] - l) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** A view that frames every sampled point (within the 45 NM sector) with a margin. */
export function frame(logs: TrackLog[], w: number, h: number, minSpanNm = 30): View {
  let x0 = -12, x1 = 12, y0 = -12, y1 = 12;
  for (const l of logs) for (const ln of l.lines) for (const p of ln.pts) {
    if (Math.hypot(p.x, p.y) > 45) continue;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const spanX = Math.max(minSpanNm, x1 - x0 + 6), spanY = Math.max(minSpanNm, y1 - y0 + 6);
  const scale = Math.min(w / spanX, h / spanY);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale, w, h };
}

/** Fixes worth naming on a poster: the stack fix, the STAR entry fixes, navaids, and the IF and FAF of the runway in use. */
function keyFixes(pack: Pack, rw: { ifFix: string; faf: string }): Set<string> {
  const keys = new Set<string>([rw.ifFix, rw.faf]);
  if (pack.spec.stackFix) keys.add(pack.spec.stackFix);
  for (const st of pack.stars) if (st.legs[0]) keys.add(st.legs[0].fix);
  for (const [id, f] of pack.fixes) if (f.kind === 'vor' || f.kind === 'ndb') keys.add(id);
  return keys;
}

/**
 * The video map in the scope's visual language: terrain, rings, lines by weight, airspace, runways and the active
 * centreline, key fixes, places and other aerodromes. `S` is the skin (night by default: the poster is printed dark).
 */
export function drawVideoMap(ctx: CanvasRenderingContext2D, pack: Pack, v: View, rwyId = pack.preferredRunways[0], k = 1, S: Skin = SKIN.night) {
  const path = (pts: XY[], close = true) => { ctx.beginPath(); pts.forEach((p, i) => { const s = toS(v, p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); if (close) ctx.closePath(); };
  const inView = (s: XY) => s.x >= (v.ox ?? 0) && s.y >= (v.oy ?? 0) && s.x <= (v.ox ?? 0) + v.w && s.y <= (v.oy ?? 0) + v.h;
  const arp = toS(v, { x: 0, y: 0 });
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // terrain contours
  ctx.strokeStyle = S.contour; ctx.lineWidth = 0.8 * k;
  for (const c of pack.spec.terrain?.contours ?? []) {
    const pts = c.pts.map(([la, lo]) => pack.proj.toXY({ lat: la, lon: lo }));
    path(pts, !!c.closed); ctx.stroke();
  }
  // rings
  ctx.lineWidth = 1 * k;
  for (let r = 10; r <= 40; r += 10) { ctx.strokeStyle = r % 20 ? S.ring : S.ring10; ctx.beginPath(); ctx.arc(arp.x, arp.y, r * v.scale, 0, Math.PI * 2); ctx.stroke(); }
  // lines by weight
  const order: Record<string, number> = { road: 0, river: 1, rail: 2, border: 3, coast: 4 };
  for (const l of [...pack.mapLines].sort((a, b) => (order[a.style] ?? 0) - (order[b.style] ?? 0))) {
    if (l.style === 'border') { ctx.strokeStyle = S.border; ctx.setLineDash([10 * k, 4 * k, 2 * k, 4 * k]); ctx.lineWidth = 1 * k; }
    else if (l.style === 'road') { ctx.strokeStyle = S.road; ctx.setLineDash([]); ctx.lineWidth = 2 * k; }
    else if (l.style === 'rail') { ctx.strokeStyle = S.rail; ctx.setLineDash([6 * k, 3 * k]); ctx.lineWidth = 1 * k; }
    else { ctx.strokeStyle = l.style === 'coast' ? S.coast : S.river; ctx.setLineDash([]); ctx.lineWidth = 1.6 * k; }
    path(l.pts, false); ctx.stroke();
  }
  ctx.setLineDash([]);
  // airspace
  path(pack.tma.poly); ctx.fillStyle = withAlpha(S.tmaFill, 0.02); ctx.fill();
  ctx.strokeStyle = S.tma; ctx.lineWidth = 1 * k; ctx.setLineDash([7 * k, 6 * k]); ctx.stroke(); ctx.setLineDash([]);
  path(pack.ctr.poly); ctx.fillStyle = withAlpha(S.ctrFill, 0.04); ctx.fill();
  ctx.strokeStyle = S.ctr; ctx.lineWidth = 1.1 * k; ctx.stroke();
  for (const t of pack.tsas) { path(t.poly); ctx.strokeStyle = S.tsaOff; ctx.lineWidth = 1 * k; ctx.setLineDash([3 * k, 5 * k]); ctx.stroke(); }
  ctx.setLineDash([]);
  // runway, centreline with ticks
  const rw = pack.runways.get(rwyId) ?? [...pack.runways.values()][0];
  ctx.strokeStyle = S.centreline; ctx.setLineDash([5 * k, 5 * k]); ctx.lineWidth = 1 * k;
  { const a = toS(v, rw.thr), b = toS(v, move(rw.thr, rw.crs + 180, 18)); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.strokeStyle = S.tick;
  for (let d = 1; d <= 18; d++) {
    const c = move(rw.thr, rw.crs + 180, d), len = d % 5 === 0 ? 0.6 : 0.25;
    const p1 = toS(v, move(c, rw.crs + 90, len)), p2 = toS(v, move(c, rw.crs - 90, len));
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  }
  for (const st of pack.strips) {
    const A = toS(v, st.a), B = toS(v, st.b);
    ctx.strokeStyle = S.runway; ctx.globalAlpha = st.ends.includes(rwyId) ? 0.9 : 0.4;
    ctx.lineWidth = Math.max(2, 0.05 * v.scale) * (st.ends.includes(rwyId) ? 1 : 0.7);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // key fixes
  const keys = keyFixes(pack, rw);
  ctx.font = `500 ${10 * k}px ${MONO}`;
  for (const id of keys) {
    const f = pack.fixes.get(id);
    if (!f) continue;
    const s = toS(v, f.p);
    if (!inView(s)) continue;
    ctx.strokeStyle = S.fix; ctx.lineWidth = 1 * k;
    ctx.beginPath();
    if (f.kind === 'vor') { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const px = s.x + Math.cos(a) * 4.5 * k, py = s.y + Math.sin(a) * 4.5 * k; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); }
    else { ctx.moveTo(s.x, s.y - 4 * k); ctx.lineTo(s.x + 3.5 * k, s.y + 2.5 * k); ctx.lineTo(s.x - 3.5 * k, s.y + 2.5 * k); ctx.closePath(); }
    ctx.stroke();
    ctx.fillStyle = S.fixText; ctx.fillText(id, s.x + 6 * k, s.y + 3 * k);
  }
  // places by rank, then other aerodromes
  const places = pack.spec.places?.length ? pack.spec.places.map((p) => ({ p: pack.proj.toXY(parseLatLon(p.lat, p.lon)), name: p.name, rank: p.rank })) : [...pack.fixes.values()].filter((f) => f.kind === 'town').map((f) => ({ p: f.p, name: (f.note ?? f.id).replace(/\s*\(.*\)\s*$/, ''), rank: 2 as const }));
  for (const pl of places) {
    if (pl.rank === 3) continue;
    const s = toS(v, pl.p);
    if (!inView(s)) continue;
    ctx.fillStyle = pl.rank === 1 ? S.town1 : S.town2;
    const r = (pl.rank === 1 ? 2 : 1.5) * k;
    ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    ctx.font = `${pl.rank === 1 ? 500 : 400} ${(pl.rank === 1 ? 12 : 11) * k}px ${SANS}`;
    ctx.fillText(pl.name, s.x + 4 * k, s.y - 3 * k);
  }
  ctx.strokeStyle = S.airport; ctx.lineWidth = 1 * k; ctx.fillStyle = S.airportText; ctx.font = `500 ${9 * k}px ${MONO}`;
  for (const ap of pack.spec.airports ?? []) {
    const s = toS(v, pack.proj.toXY(parseLatLon(ap.lat, ap.lon)));
    if (!inView(s)) continue;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3.5 * k, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s.x - 5 * k, s.y); ctx.lineTo(s.x + 5 * k, s.y); ctx.stroke();
    ctx.fillText(ap.icao, s.x + 7 * k, s.y + 3 * k);
  }
}

function trail(ctx: CanvasRenderingContext2D, v: View, ln: TrackLine, k: number, alpha: number, t0 = -Infinity, t1 = Infinity) {
  const pts = ln.pts.filter((p) => p.t >= t0 && p.t <= t1);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 3) continue; // a gap in the samples
    const sa = toS(v, a), sb = toS(v, b);
    ctx.strokeStyle = altColor((a.alt + b.alt) / 2, alpha * (t1 === Infinity ? 1 : 0.25 + 0.75 * (b.t - t0) / Math.max(1, t1 - t0)));
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
  }
}

function spark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(255,235,225,0.95)'); g.addColorStop(0.25, 'rgba(255,81,72,0.75)'); g.addColorStop(1, 'rgba(255,81,72,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,120,100,0.75)'; ctx.lineWidth = Math.max(1, r / 14);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + (seed % 7) * 0.3, len = r * (1.1 + ((seed * (i + 3)) % 5) * 0.18);
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
}

export interface PosterMeta { title: string; kind: string; dateText: string; utcSpan: string; landed: number; departures: number; moves: number; runway: string; grade: string; rank?: string; seed: number }

/** Paint the session poster (portrait, print-friendly size) onto a canvas. */
export function renderPoster(canvas: HTMLCanvasElement, pack: Pack, tracks: TrackLog, meta: PosterMeta, size = { w: 1800, h: 2400 }) {
  canvas.width = size.w; canvas.height = size.h;
  const ctx = canvas.getContext('2d')!;
  const k = size.w / 1200;
  // paper: deep console blue with a soft glow at the airfield
  const bg = ctx.createLinearGradient(0, 0, 0, size.h);
  const S = SKIN.night;
  bg.addColorStop(0, S.bg1); bg.addColorStop(1, S.bg0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, size.w, size.h);
  const pad = 70 * k, mapH = size.h - 470 * k;
  const v: View = { ...frame([tracks], size.w - pad * 2, mapH - pad), ox: pad, oy: pad };
  const glowAt = toS(v, { x: 0, y: 0 });
  const glow = ctx.createRadialGradient(glowAt.x, glowAt.y, 0, glowAt.x, glowAt.y, 520 * k);
  glow.addColorStop(0, withAlpha(S.selFill, 0.06)); glow.addColorStop(1, withAlpha(S.selFill, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, size.w, mapH);
  ctx.save();
  ctx.beginPath(); ctx.rect(pad * 0.5, pad * 0.5, size.w - pad, mapH - pad * 0.2); ctx.clip();
  drawVideoMap(ctx, pack, v, meta.runway, k, S);
  // trails, additive so busy routes glow
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const ln of tracks.lines) { ctx.lineWidth = 1.5 * k; trail(ctx, v, ln, k, 0.42); }
  // landings: bright threads down the final into the runway
  for (const ln of tracks.lines) {
    if (ln.landedT === undefined) continue;
    const fin = ln.pts.filter((p) => p.t >= ln.landedT! - 240);
    for (const [w, a] of [[7 * k, 0.07], [3.2 * k, 0.22], [1.3 * k, 0.95]] as [number, number][]) {
      ctx.lineWidth = w; ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath(); fin.forEach((p, i) => { const s = toS(v, p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.stroke();
    }
  }
  tracks.sparks.forEach((s, i) => { const p = toS(v, s); spark(ctx, p.x, p.y, (s.kind === 'los' ? 26 : 16) * k, i + 3); });
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  // title block
  const y0 = mapH + 40 * k;
  ctx.strokeStyle = S.panelLine; ctx.lineWidth = 1 * k;
  ctx.beginPath(); ctx.moveTo(pad, y0); ctx.lineTo(size.w - pad, y0); ctx.stroke();
  ctx.fillStyle = S.select; ctx.font = `500 ${22 * k}px ${MONO}`;
  ctx.fillText(`${pack.meta.icao} APP  ${pack.meta.appFreq}  RWY ${meta.runway}`, pad, y0 + 50 * k);
  ctx.fillStyle = S.assumed; ctx.font = `600 ${92 * k}px ${SANS}`;
  ctx.fillText(pack.meta.appCallsign.toUpperCase(), pad - 4 * k, y0 + 150 * k);
  ctx.fillStyle = '#c9d4db'; ctx.font = `500 ${36 * k}px ${SANS}`;
  ctx.fillText(meta.title, pad, y0 + 205 * k);
  ctx.fillStyle = 'rgba(201,212,219,0.6)'; ctx.font = `400 ${21 * k}px ${MONO}`;
  ctx.fillText(`${meta.dateText} · ${meta.utcSpan} UTC · ${meta.kind}${meta.rank ? ' · ' + meta.rank : ''}`, pad, y0 + 250 * k);
  const stats: [string, string][] = [[String(meta.landed), 'landed'], [String(meta.departures), 'departed'], [String(tracks.lines.length), 'tracks'], [String(tracks.sparks.length), tracks.sparks.length === 1 ? 'alert' : 'alerts'], [meta.grade, 'grade']];
  const colW = (size.w - pad * 2) / stats.length;
  stats.forEach(([n, l], i) => {
    const x = pad + i * colW;
    ctx.fillStyle = i === 3 && tracks.sparks.length ? '#ff7a70' : '#eef3f6'; ctx.font = `500 ${(n.length > 4 ? 34 : 48) * k}px ${MONO}`; ctx.fillText(n, x, y0 + 335 * k);
    ctx.fillStyle = 'rgba(201,212,219,0.55)'; ctx.font = `500 ${17 * k}px ${SANS}`; ctx.fillText(l.toUpperCase(), x, y0 + 365 * k);
  });
  // legend: altitude ramp
  const lx = size.w - pad - 330 * k, ly = y0 + 42 * k;
  const ramp = ctx.createLinearGradient(lx, 0, lx + 200 * k, 0);
  ramp.addColorStop(0, altColor(0)); ramp.addColorStop(1, altColor(10000));
  ctx.fillStyle = ramp; ctx.fillRect(lx, ly, 200 * k, 4 * k);
  ctx.fillStyle = 'rgba(201,212,219,0.55)'; ctx.font = `400 ${15 * k}px ${MONO}`;
  ctx.fillText('LOW', lx, ly - 8 * k); ctx.fillText('FL100', lx + 150 * k, ly - 8 * k);
  ctx.fillStyle = '#ff7a70'; ctx.beginPath(); ctx.arc(lx + 250 * k, ly + 2 * k, 5 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(201,212,219,0.55)'; ctx.fillText('ALERT', lx + 262 * k, ly + 7 * k);
  ctx.fillStyle = 'rgba(201,212,219,0.3)'; ctx.font = `400 ${14 * k}px ${MONO}`;
  ctx.fillText(`seed ${meta.seed} · fictional flights · not a training device`, pad, size.h - 34 * k);
}

/** Save a canvas as a PNG file through a temporary <a download>. */
export function downloadCanvas(canvas: HTMLCanvasElement, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(false); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        resolve(true);
      }, 'image/png');
    } catch { resolve(false); }
  });
}

/** Save any text as a file (the save export). */
export function downloadText(text: string, name: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ===========================================================================
// Ghost replay: two mini-scopes on one clock

export interface GhostData {
  player: TrackLog;
  expert: TrackLog;
  div?: Divergence;
  startUtc: string;
  runway: string;
  playerGrade: string;
  expertGrade: string;
}

const utcAt = (start: string, t: number) => {
  const [h, m] = start.split(':').map(Number);
  const s = h * 3600 + m * 60 + Math.floor(t);
  return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export class GhostViewer {
  private t = 0;
  private playing = false;
  private raf = 0;
  private last = 0;
  private tEnd: number;
  private cans: HTMLCanvasElement[];
  private maps: HTMLCanvasElement[] = [];
  private view?: View;
  private ro?: ResizeObserver;
  private scrub: HTMLInputElement;
  private clock: HTMLElement;
  private playBtn: HTMLButtonElement;

  constructor(private host: HTMLElement, private pack: Pack, private d: GhostData) {
    this.tEnd = Math.max(d.player.t1, d.expert.t1, 60);
    const mark = d.div ? `<i class="gh-mark" style="left:${(d.div.t / this.tEnd) * 100}%" title="Where you parted ways"></i>` : '';
    host.innerHTML = `
      <div class="gh-scopes">
        <figure><figcaption><b>You</b><span class="mono">${d.playerGrade}</span></figcaption><canvas data-g="0"></canvas></figure>
        <figure><figcaption><b>Expert</b><span class="mono">${d.expertGrade}</span></figcaption><canvas data-g="1"></canvas></figure>
      </div>
      <div class="gh-bar">
        <button class="gh-play" data-g="play" aria-label="Play">▶</button>
        <div class="gh-track"><input type="range" min="0" max="${Math.round(this.tEnd)}" step="1" value="0" aria-label="Replay time">${mark}</div>
        <span class="gh-clock mono" data-g="clock"></span>
      </div>
      ${d.div ? `<button class="gh-div" data-g="jump"><span class="mono">${utcAt(d.startUtc, d.div.t).slice(0, 5)}</span>${escTxt(d.div.text)}</button>` : '<p class="gh-div none">You and the expert made the same calls at the same times. Nothing to show.</p>'}`;
    this.cans = [...host.querySelectorAll<HTMLCanvasElement>('canvas')];
    this.scrub = host.querySelector('input')!;
    this.clock = host.querySelector('[data-g="clock"]')!;
    this.playBtn = host.querySelector('[data-g="play"]')!;
    this.scrub.addEventListener('input', () => { this.t = Number(this.scrub.value); this.draw(); });
    this.playBtn.addEventListener('click', () => this.toggle());
    host.querySelector('[data-g="jump"]')?.addEventListener('click', () => { this.seek(Math.max(0, d.div!.t - 45)); if (!this.playing) this.toggle(); });
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
    this.layout();
    if (d.div) this.seek(Math.max(0, d.div.t - 45));
    else {
      // nothing to point at: open where traffic is on the scope
      const first = Math.min(...[d.player, d.expert].flatMap((l) => l.lines.map((x) => x.pts[0]?.t ?? Infinity)));
      this.seek(Number.isFinite(first) ? Math.min(this.tEnd, first + 60) : 0);
    }
  }
  seek(t: number) { this.t = Math.max(0, Math.min(this.tEnd, t)); this.scrub.value = String(Math.round(this.t)); this.draw(); }
  toggle() {
    this.playing = !this.playing;
    this.playBtn.textContent = this.playing ? '❚❚' : '▶';
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    if (this.playing) { if (this.t >= this.tEnd) this.t = 0; this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
    else cancelAnimationFrame(this.raf);
  }
  private loop = (now: number) => {
    if (!this.playing || !this.host.isConnected) { this.playing = false; return; }
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt * 16; // sixteen times real time
    if (this.t >= this.tEnd) { this.t = this.tEnd; this.toggle(); }
    this.scrub.value = String(Math.round(this.t));
    this.draw();
    if (this.playing) this.raf = requestAnimationFrame(this.loop);
  };
  destroy() { this.playing = false; cancelAnimationFrame(this.raf); this.ro?.disconnect(); }
  private layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cans[0].clientWidth, h = this.cans[0].clientHeight;
    if (!w || !h) return;
    for (const c of this.cans) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    this.view = frame([this.d.player, this.d.expert], w * dpr, h * dpr, 24);
    this.maps = this.cans.map(() => {
      const m = document.createElement('canvas');
      m.width = Math.round(w * dpr); m.height = Math.round(h * dpr);
      const ctx = m.getContext('2d')!;
      ctx.fillStyle = SKIN.night.bg0; ctx.fillRect(0, 0, m.width, m.height);
      drawVideoMap(ctx, this.pack, this.view!, this.d.runway, dpr * 0.85, SKIN.night);
      return m;
    });
    this.draw();
  }
  private draw() {
    if (!this.view) return;
    const v = this.view, t = this.t;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.clock.textContent = `${utcAt(this.d.startUtc, t).slice(0, 5)}Z`;
    [this.d.player, this.d.expert].forEach((log, i) => {
      const ctx = this.cans[i].getContext('2d')!;
      ctx.drawImage(this.maps[i], 0, 0);
      ctx.lineCap = 'round';
      const near = this.d.div && Math.abs(t - this.d.div.t) < 40;
      for (const ln of log.lines) {
        ctx.lineWidth = 1.6 * dpr;
        trail(ctx, v, ln, dpr, 0.8, t - 150, t);
        const p = posAt(ln, t);
        if (!p) continue;
        const s = toS(v, p);
        const hot = near && ln.cs === this.d.div!.cs;
        ctx.fillStyle = hot ? '#ffd36b' : ln.emer ? '#ff5148' : '#f2f6f8';
        ctx.fillRect(s.x - 2.5 * dpr, s.y - 2.5 * dpr, 5 * dpr, 5 * dpr);
        if (hot) { ctx.strokeStyle = 'rgba(255,211,107,0.9)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(s.x, s.y, 13 * dpr, 0, Math.PI * 2); ctx.stroke(); }
        ctx.font = `500 ${10 * dpr}px ${MONO}`;
        ctx.fillStyle = hot ? '#ffd36b' : 'rgba(220,230,236,0.75)';
        ctx.fillText(ln.cs, s.x + 6 * dpr, s.y - 5 * dpr);
        ctx.fillStyle = 'rgba(150,178,195,0.7)';
        ctx.fillText(String(Math.round(p.alt / 100)).padStart(3, '0'), s.x + 6 * dpr, s.y + 7 * dpr);
      }
      for (const sp of log.sparks) if (sp.t <= t && sp.t > t - 60) { const s = toS(v, sp); spark(ctx, s.x, s.y, 12 * dpr, 5); }
    });
  }
}
const escTxt = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
