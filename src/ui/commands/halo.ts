// The command halo: direct manipulation around the selected aircraft, on the scope. A short ladder of
// levels on one side and speeds on the other, centred on the cleared values; a row of the fixes that make
// sense; the four words a controller says most. One tap sends, with a two-second undo that is the real
// "correction, disregard". A long press stages instead, for building a longer clearance. The heading drag
// on the aircraft itself is the scope's (unchanged); the halo only draws its affordance.
import type { Sim } from '../../engine/sim';
import type { Aircraft } from '../../engine/types';
import { itemChip, levelText, type Item } from '../../engine/clearance';
import type { QuickOption } from '../scope';
import { dist, norm360 } from '../../geo';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const vib = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };
const lvlKey = (l: { fl?: number; ft?: number }) => (l.fl !== undefined ? `F${String(l.fl).padStart(3, '0')}` : `A${l.ft}`);
/** The airport's stack fix: from the pack when the 2.0 field is set, Liège's ALHUV otherwise. */
export const stackFixOf = (sim: Sim): string => { const p = sim.pack as any; return (p.stackFix as string | undefined) ?? (p.meta?.stackFix as string | undefined) ?? 'ALHUV'; };

export interface HaloHost {
  sim: Sim;
  cs?: string;
  items: Item[];
  scope: { toS(p: { x: number; y: number }): { x: number; y: number }; plot(ac: Aircraft): { x: number; y: number }; w: number; h: number; scale: number; center: { x: number; y: number }; animateTo(s: number, c: { x: number; y: number }, dur?: number): void; canvas: HTMLCanvasElement; labels: Map<string, { x: number; y: number; w: number; h: number }> };
  levelOptions(cs: string): QuickOption[];
  speedOptions(cs: string): QuickOption[];
  /** send one item now (merged with anything staged) */
  quick(cs: string, items: Item[]): void;
  /** stage an item without sending */
  addItem(it: Item, maybeQuick?: boolean): void;
  toast(text: string, ms?: number): void;
  pickerOpen(): boolean;
}

export class Halo {
  el: HTMLElement;
  /** Off in tutorial scenarios unless the coach turns it on; on everywhere else. */
  enabled = true;
  private sig = '';
  private lp = 0;
  private lpDone = false;
  private undoEl: HTMLElement;
  private undoTimer = 0;
  private undoCs?: string;
  private pannedFor?: string;
  /** when the halo last appeared or moved to another aircraft: the tap that selected it must not also press a rung */
  private shownAt = 0;
  private shownFor?: string;
  constructor(private g: HaloHost, host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'halo';
    this.el.dataset.e = 'halo';
    this.el.hidden = true;
    host.appendChild(this.el);
    this.undoEl = document.createElement('div');
    this.undoEl.className = 'undo';
    this.undoEl.dataset.e = 'undo';
    this.undoEl.hidden = true;
    host.appendChild(this.undoEl);
    this.undoEl.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-a="undo"]')) this.undo(); });
    // tap sends; a long press (480 ms) stages instead
    this.el.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-halo]');
      if (!b || performance.now() - this.shownAt < 400) return;
      this.lpDone = false;
      clearTimeout(this.lp);
      this.lp = window.setTimeout(() => { this.lpDone = true; vib(12); this.act(b, true); }, 480);
    });
    const cancel = () => clearTimeout(this.lp);
    this.el.addEventListener('pointerup', cancel);
    this.el.addEventListener('pointercancel', cancel);
    this.el.addEventListener('pointerleave', cancel);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-halo]');
      if (!b || performance.now() - this.shownAt < 400) return;
      if (this.lpDone) { this.lpDone = false; return; }
      this.act(b, false);
    });
  }

  private act(b: HTMLElement, stage: boolean) {
    const cs = this.g.cs;
    if (!cs) return;
    const it = this.itemOf(b);
    if (!it) return;
    const staged = this.g.items.length > 0;
    // a hold nearly always comes with a level: stage it, the next rung completes the clearance
    if (stage || (it.k === 'hold' && !staged)) {
      this.g.addItem(it, false);
      this.g.toast(it.k === 'hold' ? 'Hold staged. Pick a level, or transmit.' : `${itemChip(it)} staged. Add to it, or transmit.`, 2200);
      return;
    }
    vib(8);
    this.g.quick(cs, [it]);
    this.showUndo(cs, it);
  }
  private itemOf(b: HTMLElement): Item | undefined {
    const k = b.dataset.halo, v = b.dataset.v ?? '';
    const sim = this.g.sim;
    let m: RegExpMatchArray | null;
    if (k === 'lvl') { if ((m = v.match(/^F(\d+)$/))) return { k: 'lvl', lvl: { fl: Number(m[1]) } }; if ((m = v.match(/^A(\d+)$/))) return { k: 'lvl', lvl: { ft: Number(m[1]) } }; }
    if (k === 'spd') { if (v === 'MIN') return { k: 'spdmin' }; if ((m = v.match(/^S(\d+)(?:\/(\d+))?$/))) return { k: 'spd', spd: Number(m[1]), until: m[2] ? Number(m[2]) : undefined }; }
    if (k === 'fix') return { k: 'dct', fix: v };
    if (k === 'more') {
      if (v === 'ils') return { k: 'app', app: sim.rwy.ils && !sim.ilsOut.has(sim.runway) ? 'ILS' : 'RNP', rwy: sim.runway };
      if (v === 'hold') return { k: 'hold', fix: this.holdFix() };
      if (v === 'twr') return { k: 'xfr', unit: 'TWR' };
      if (v === 'bru') return { k: 'xfr', unit: 'BRU' };
      if (v === 'mil') return { k: 'xfr', unit: 'MIL' };
    }
    return undefined;
  }
  private holdFix() { return stackFixOf(this.g.sim); }

  // ---------- undo: the real correction, within its window ----------
  private showUndo(cs: string, it: Item) { this.armUndo(cs, itemChip(it)); }
  /** Offer a two-second undo (the real correction) for a clearance just sent to `cs`. */
  armUndo(cs: string, label: string) {
    this.undoCs = cs;
    this.undoEl.innerHTML = `<span class="mono">${esc(cs)}</span> <span>${esc(label)} sent</span><button data-a="undo" class="undo-b">Undo</button>`;
    this.undoEl.hidden = false;
    clearTimeout(this.undoTimer);
    this.undoTimer = window.setTimeout(() => { this.undoEl.hidden = true; this.undoCs = undefined; }, 2000);
  }
  /** Take back the last halo send (also on Backspace). Returns false when the window has passed. */
  undo(): boolean {
    const cs = this.undoCs;
    this.undoEl.hidden = true; this.undoCs = undefined; clearTimeout(this.undoTimer);
    if (!cs) return false;
    const ok = this.g.sim.correct(cs);
    this.g.toast(ok ? `${cs}: correction, disregard.` : 'Too late: the pilot is already reading back. Give the right clearance instead.', 2200);
    return ok;
  }

  // ---------- layout: follow the aircraft every frame ----------
  update() {
    const g = this.g;
    const ac = g.cs ? g.sim.find(g.cs) : undefined;
    const show = this.enabled && !!ac && (ac.state === 'assumed') && !ac.radioFail && !g.pickerOpen();
    if (!show) { if (!this.el.hidden) { this.el.hidden = true; this.sig = ''; } return; }
    const sim = g.sim;
    if (this.el.hidden || this.shownFor !== ac!.cs) { this.shownAt = performance.now(); this.shownFor = ac!.cs; }
    const sig = [ac!.cs, lvlKey(ac!.cflSys ?? ac!.cleared), ac!.spdAssigned ?? '', ac!.spdMin ? 1 : 0, ac!.app ? 1 : 0, ac!.mode, g.items.map(itemChip).join(','), sim.runway, Math.round(ac!.ias / 10)].join('|');
    if (sig !== this.sig) { this.sig = sig; this.render(ac!); }
    const s = g.scope.toS(g.scope.plot(ac!));
    const W = g.scope.w, H = g.scope.h;
    // keep the halo inside the scope, clear of the zoom column on the right
    // a short scope (phone with the queue open): ladders only, so the halo still fits
    const short = H < 380;
    this.el.classList.toggle('short', short);
    const x = Math.max(124, Math.min(W - 172, s.x)), y = Math.max(short ? 184 : 186, Math.min(short ? H - 44 : H - 188, s.y));
    const off = Math.hypot(x - s.x, y - s.y);
    // an aircraft near the edge: bring it to where the halo can sit on it, once per selection, so no rung ever covers a track
    if (off > 4 && this.pannedFor !== ac!.cs) {
      this.pannedFor = ac!.cs;
      const sc = g.scope.scale, c = g.scope.center;
      g.scope.animateTo(sc, { x: c.x + (s.x - x) / sc, y: c.y - (s.y - y) / sc }, 320);
    }
    if (off <= 4) this.pannedFor = ac!.cs;
    this.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    this.el.classList.toggle('off-ac', off > 4);
    // stay off the aircraft's own label: it carries the scope's chips and the player reads it
    const lab = g.scope.labels.get(ac!.cs);
    const lvlEl = this.el.querySelector<HTMLElement>('.halo-lvl'), spdEl = this.el.querySelector<HTMLElement>('.halo-spd');
    let left = -116, right = 58, up = false;
    if (lab) {
      const lx0 = lab.x - x, lx1 = lab.x + lab.w - x, ly0 = lab.y - y, ly1 = lab.y + lab.h - y;
      const bandHit = ly1 > -110 && ly0 < 110; // the label sits in the ladders' height band
      if (bandHit && lx1 < 0) left = Math.min(left, lx0 - 62);
      if (bandHit && lx0 > 0) right = Math.max(right, lx1 + 6);
      up = (ly0 + ly1) / 2 > 12 && lx0 < 118 && lx1 > -118; // label below the aircraft: the fix rows go above
    }
    if (x + left < 4) left = 4 - x;
    if (x + right + 58 > W - 52) right = W - 52 - 58 - x;
    if (lvlEl) lvlEl.style.left = `${left}px`;
    if (spdEl) spdEl.style.left = `${right}px`;
    this.el.classList.toggle('up', up && y > 150);
    const hdg = norm360(ac!.hdg - sim.pack.meta.magVar);
    (this.el.querySelector('.halo-ring') as HTMLElement | null)?.style.setProperty('--hdg', `${hdg.toFixed(0)}deg`);
    this.el.hidden = false;
  }
  private render(ac: Aircraft) {
    const g = this.g, sim = g.sim;
    const stagedLvl = g.items.find((i) => i.k === 'lvl') as { lvl: { fl?: number; ft?: number } } | undefined;
    const stagedSpd = g.items.find((i) => i.k === 'spd' || i.k === 'spdmin') as Item | undefined;
    // levels: five rungs round the cleared level (two above, two below), highest first
    const lv = g.levelOptions(ac.cs);
    const clrFt = sim.ftOf(ac.cflSys ?? ac.cleared);
    let ci = lv.findIndex((o) => o.item.k === 'lvl' && Math.abs(sim.ftOf(o.item.lvl) - clrFt) < 60);
    if (ci < 0) ci = lv.findIndex((o) => o.item.k === 'lvl' && sim.ftOf(o.item.lvl) < clrFt);
    if (ci < 0) ci = 0;
    const above = ac.kind === 'dep' ? 3 : 1;
    const lo = Math.max(0, Math.min(ci - above, lv.length - 5)), lvRows = lv.slice(lo, lo + 5);
    const lvlHtml = lvRows.map((o) => {
      const it = o.item as { k: 'lvl'; lvl: { fl?: number; ft?: number } };
      const ft = sim.ftOf(it.lvl), key = lvlKey(it.lvl);
      const cls = `${Math.abs(ft - clrFt) < 60 ? 'cleared' : ''} ${o.warn ? 'below' : ''} ${stagedLvl && lvlKey(stagedLvl.lvl) === key ? 'staged' : ''}`;
      return `<button class="hl ${cls}" data-halo="lvl" data-v="${key}" title="${esc(o.warn ?? levelText(it.lvl))}">${esc(o.label)}</button>`;
    }).join('');
    // speeds: 160/4 at the top when it applies, then five round the assigned or present speed, MIN at the bottom
    // the speeds a controller says: 250 clean, 220 and 210 into the sequence, 180 and 160 on the approach. Five rungs:
    // "160 to 4 NM" takes the place of 160 once it is close in, and minimum clean speed takes the place of 250 once it is slow.
    const est = !!ac.app?.locCap || (ac.kind === 'arr' && sim.dthr(ac) < 18);
    const spd = (v: number) => g.speedOptions(ac.cs).find((o) => o.item.k === 'spd' && !o.item.until && o.item.spd === v);
    const spdHtml = [250, 220, 210, 180, 160].map((v) => {
      if (v === 250 && (ac.spdAssigned ?? ac.ias) < 240) return `<button class="hl det ${ac.spdMin || stagedSpd?.k === 'spdmin' ? 'cleared' : ''}" data-halo="spd" data-v="MIN" title="Minimum clean speed ${ac.perf.vminClean}">MIN</button>`;
      if (v === 160 && est) return `<button class="hl det ${stagedSpd?.k === 'spd' && (stagedSpd as any).until ? 'staged' : ''}" data-halo="spd" data-v="S160/4" title="160 knots until 4 NM">160·4</button>`;
      const o = spd(v);
      const cls = `${ac.spdAssigned === v ? 'cleared' : ''} ${o?.warn || !o ? 'below' : ''} ${stagedSpd?.k === 'spd' && (stagedSpd as any).spd === v && !(stagedSpd as any).until ? 'staged' : ''}`;
      return `<button class="hl ${cls}" data-halo="spd" data-v="S${v}" title="${esc(o?.warn ?? `${v} kt`)}">${v}</button>`;
    }).join('');
    // fixes: on its route first, then the final approach fix and the stack, nearest first; never the LG0xx waypoints
    const seen = new Set<string>();
    const fixes: { id: string; d: number }[] = [];
    const push = (id?: string) => { if (id && sim.pack.fixes.has(id) && !seen.has(id) && !/^LG0/.test(id)) { seen.add(id); fixes.push({ id, d: dist(ac.p, sim.fixP(id)) }); } };
    for (const l of ac.route) push(l.fix);
    push(sim.rwy.ifFix); push(this.holdFix());
    for (const h of sim.pack.holds) push(h.fix);
    const fixHtml = fixes.filter((f) => f.d > 1).slice(0, 4).map((f) => `<button class="hf ${ac.route[0]?.fix === f.id ? 'next' : ''}" data-halo="fix" data-v="${esc(f.id)}" title="Direct ${esc(f.id)}, ${f.d.toFixed(0)} NM">${esc(f.id)}</button>`).join('');
    const dep = ac.kind === 'dep' || ac.kind === 'mil' || ac.kind === 'ovf';
    const moreHtml = dep
      ? `<button class="hm" data-halo="more" data-v="${ac.kind === 'mil' ? 'mil' : 'bru'}">${ac.kind === 'mil' ? 'MIL' : 'BRU'}</button>`
      : `<button class="hm ${ac.app ? 'cleared' : ''}" data-halo="more" data-v="ils">${sim.rwy.ils && !sim.ilsOut.has(sim.runway) ? 'ILS' : 'RNP'}</button><button class="hm ${ac.mode === 'HOLD' ? 'cleared' : ''} ${g.items.some((i) => i.k === 'hold') ? 'staged' : ''}" data-halo="more" data-v="hold">HOLD</button><button class="hm" data-halo="more" data-v="twr">TWR</button>`;
    this.el.innerHTML = `<div class="halo-ring" aria-hidden="true"><i></i></div><div class="halo-lvl">${lvlHtml}</div><div class="halo-spd">${spdHtml}</div><div class="halo-fix">${fixHtml}</div><div class="halo-more">${moreHtml}</div>`;
  }
  destroy() { clearTimeout(this.lp); clearTimeout(this.undoTimer); this.el.remove(); this.undoEl.remove(); }
}
