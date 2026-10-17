// Staging for a rush: queue clearances for several aircraft and send them in order with one key each.
// Build a clearance, press Queue (or Q), select the next aircraft, build the next. Enter with an empty
// composer sends the first queued; 1 to 4 send a row; a tap on a row's Send sends it. A queued clearance
// is re-checked against the sim when it is sent (warnings show as usual).
import type { Sim } from '../../engine/sim';
import { itemChip, type Clearance, type Item } from '../../engine/clearance';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface StagingHost {
  sim: Sim;
  cs?: string;
  items: Item[];
  /** send a clearance through the bar's send path (vetoes, warnings, onSent) */
  sendClearance(cl: Clearance): boolean;
  clearComposer(): void;
  select(cs?: string, force?: boolean): void;
  toast(text: string, ms?: number): void;
}

export class Staging {
  queue: Clearance[] = [];
  private sig = '';
  constructor(private g: StagingHost, public el: HTMLElement) {
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-stq]') as HTMLElement | null;
      if (!b) return;
      const i = Number(b.dataset.i);
      if (b.dataset.stq === 'send') this.send(i);
      else if (b.dataset.stq === 'drop') { this.queue.splice(i, 1); this.render(); }
      else if (b.dataset.stq === 'edit') this.edit(i);
    });
  }
  /** Queue what is in the composer for the selected aircraft. */
  queueCurrent(): boolean {
    const g = this.g;
    if (!g.cs || !g.items.length) { g.toast('Build a clearance first, then queue it.', 2000); return false; }
    this.queue = this.queue.filter((q) => q.cs !== g.cs);
    this.queue.push({ cs: g.cs, items: [...g.items] });
    g.clearComposer();
    g.toast(`${g.cs} queued (${this.queue.length}). Enter sends the first.`, 1800);
    this.render();
    return true;
  }
  /** Send row i (the first by default). Returns false when nothing was queued or the send was blocked. */
  send(i = 0): boolean {
    const q = this.queue[i];
    if (!q) return false;
    if (!this.g.sim.find(q.cs) && !this.g.sim.releases.some((r) => r.cs === q.cs)) { this.queue.splice(i, 1); this.render(); return false; }
    const ok = this.g.sendClearance(q);
    if (ok) { this.queue.splice(i, 1); this.render(); }
    return ok;
  }
  /** Put a row back into the composer to change it. */
  edit(i: number) {
    const q = this.queue[i];
    if (!q) return;
    this.queue.splice(i, 1);
    this.g.select(q.cs, true);
    for (const it of q.items) this.g.items.push(it);
    this.render();
  }
  get length() { return this.queue.length; }
  update() { this.render(); }
  private render() {
    const sig = this.queue.map((q) => `${q.cs}:${q.items.map(itemChip).join(',')}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.hidden = !this.queue.length;
    this.el.innerHTML = this.queue.map((q, i) => `<div class="stq-row"><span class="stq-n mono">${i + 1}</span><button class="stq-edit" data-stq="edit" data-i="${i}" title="Edit"><b class="mono">${esc(q.cs)}</b><span>${esc(q.items.map(itemChip).join(' · '))}</span></button><button class="stq-send" data-stq="send" data-i="${i}">Send</button><button class="stq-x" data-stq="drop" data-i="${i}" aria-label="Drop">✕</button></div>`).join('');
  }
  reset() { this.queue = []; this.sig = ''; this.render(); }
  destroy() { /* nothing to release */ }
}
