// Readback tracking: after a send, the clearance stays on the console until the readback comes. Grey while
// it is due, green when it comes back right (then it fades), amber when it is wrong with the correction one
// tap away, and a repeat button when the pilot asks you to say again. A wrong readback the player did not
// send through the bar (a scripted one, or one that arrives while another aircraft is selected) still gets
// its card, so it is never missed because the eye was elsewhere.
import type { Sim } from '../../engine/sim';
import type { Tx } from '../../engine/types';
import { itemChip, levelText, sortItems, type Clearance, type Item } from '../../engine/clearance';

type State = 'pending' | 'ok' | 'wrong' | 'again' | 'missed';
export interface ReadbackCard {
  id: number;
  cs: string;
  items: Item[];
  /** the controller's words */
  text: string;
  t0: number;
  state: State;
  /** sim time the state last changed */
  tState: number;
  /** what the pilot read back wrongly, when state is wrong */
  heard?: string;
  /** the correction (the same kind of item, said again) */
  fix?: Item;
  /** the pilot's words (readback or say again) */
  reply?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const vib = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };
const isAck = (i: Item) => i.k === 'roger' || i.k === 'standby' || i.k === 'sayagain';
const isIcom = (i: Item) => i.k === 'rel' || i.k === 'relhold' || i.k === 'appr' || i.k === 'deny';

export interface ReadbackHost {
  sim: Sim;
  quick(cs: string, items: Item[]): void;
  select(cs?: string, force?: boolean): void;
  keepVisible(cs: string): void;
}

export class Readback {
  cards: ReadbackCard[] = [];
  private nextId = 1;
  private sig = '';
  private lastTx = new Map<string, Tx>();
  constructor(private g: ReadbackHost, public el: HTMLElement) {
    el.addEventListener('click', (e) => this.onClick(e));
  }
  /** Call from Game.onSent (and for intercom answers). */
  sent(cl: Clearance) {
    const sim = this.g.sim;
    const items = sortItems(cl.items);
    const text = sim.previewPhrase({ cs: cl.cs, items })?.text ?? `${cl.cs} ${items.map(itemChip).join(' ')}`;
    // one card per aircraft: a new send replaces the old one
    this.cards = this.cards.filter((c) => c.cs !== cl.cs);
    const noRb = items.every(isAck) || items.some(isIcom) || !sim.find(cl.cs) || !!sim.find(cl.cs)?.radioFail;
    this.cards.push({ id: this.nextId++, cs: cl.cs, items, text, t0: sim.t, state: noRb ? 'ok' : 'pending', tState: sim.t });
    while (this.cards.length > 3) this.cards.shift();
    this.sig = '';
    this.update();
  }
  /** Pilot transmissions, to show the readback words. */
  onTx(tx: Tx) { if (tx.from === 'PILOT' && tx.cs) this.lastTx.set(tx.cs, tx); }
  /** The card for an aircraft, if any. */
  cardFor(cs: string) { return this.cards.find((c) => c.cs === cs); }
  update() {
    const sim = this.g.sim;
    for (const c of this.cards) {
      const ac = sim.find(c.cs);
      if (!ac) { if (c.state === 'pending') { c.state = 'ok'; c.tState = sim.t; } continue; }
      if (c.state === 'pending' && !sim.readbackPending(c.cs)) {
        const last = this.lastTx.get(c.cs);
        c.reply = last && last.t0 >= c.t0 ? last.text : undefined;
        if (ac.wrong && ac.wrong.issuedT >= c.t0 - 0.5) this.markWrong(c, ac.wrong.item, c.items);
        else if (ac.awaitingSince !== undefined && c.reply && /^say again/i.test(c.reply)) { c.state = 'again'; c.tState = sim.t; vib([20, 30, 20]); }
        else if (c.reply) { c.state = 'ok'; c.tState = sim.t; vib(15); }
      }
      if (c.state === 'wrong' && !ac.wrong) { c.state = sim.events.some((e) => e.kind === 'readback_missed' && e.cs === c.cs && e.t >= c.tState) ? 'missed' : 'ok'; c.tState = sim.t; }
    }
    // a wrong readback with no card of its own (sent outside the bar, or an older card already replaced)
    for (const ac of sim.aircraft) {
      if (!ac.wrong || sim.readbackPending(ac.cs) || this.cards.some((c) => c.cs === ac.cs && c.state === 'wrong')) continue;
      const kind = ac.wrong.item.k;
      const right: Item | undefined = kind === 'lvl' && ac.cflSys ? { k: 'lvl', lvl: ac.cflSys } : kind === 'hdg' && ac.hdgSys !== undefined ? { k: 'hdg', hdg: Math.round((ac.hdgSys - sim.pack.meta.magVar + 360) % 360) || 360 } : undefined;
      this.cards = this.cards.filter((c) => c.cs !== ac.cs);
      const c: ReadbackCard = { id: this.nextId++, cs: ac.cs, items: right ? [right] : [], text: right ? itemChip(right) : '', t0: ac.wrong.issuedT, state: 'pending', tState: sim.t, reply: this.lastTx.get(ac.cs)?.text };
      this.markWrong(c, ac.wrong.item, right ? [right] : []);
      this.cards.push(c);
      while (this.cards.length > 3) this.cards.shift();
    }
    // finished cards leave after a moment; wrong ones stay until fixed
    this.cards = this.cards.filter((c) => c.state === 'pending' || c.state === 'wrong' || c.state === 'again' || sim.t - c.tState < (c.state === 'missed' ? 8 : 4));
    this.render();
  }
  private markWrong(c: ReadbackCard, bad: Item, sent: Item[]) {
    c.state = 'wrong'; c.tState = this.g.sim.t;
    c.heard = bad.k === 'lvl' ? levelText(bad.lvl) : bad.k === 'hdg' ? `heading ${String(bad.hdg).padStart(3, '0')}` : itemChip(bad);
    c.fix = sent.find((i) => i.k === bad.k);
    vib([30, 40, 30]);
  }
  private render() {
    const sim = this.g.sim;
    const sig = this.cards.map((c) => `${c.id}:${c.state}:${c.reply ?? ''}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.hidden = !this.cards.length;
    this.el.innerHTML = this.cards.map((c) => {
      const fixLab = c.fix ? (c.fix.k === 'lvl' ? levelText(c.fix.lvl).replace(' ft', '') : c.fix.k === 'hdg' ? `H${String(c.fix.hdg).padStart(3, '0')}` : itemChip(c.fix)) : '';
      const st = c.state === 'pending' ? 'Readback due' : c.state === 'ok' ? 'Read back' : c.state === 'wrong' ? `Wrong: read back ${c.heard}` : c.state === 'again' ? 'Pilot asks you to say again' : 'Missed: the wrong readback stood';
      const btn = c.state === 'wrong' && c.fix ? `<button data-a="rb-fix" data-id="${c.id}" class="rb-b">Say again · ${esc(fixLab)}</button>`
        : c.state === 'again' ? `<button data-a="rb-again" data-id="${c.id}" class="rb-b">Repeat</button>` : '';
      return `<div class="rb-card ${c.state}" data-cs="${esc(c.cs)}" data-id="${c.id}"><button class="rb-sel" data-a="rb-sel" data-id="${c.id}"><b class="mono">${esc(c.cs)}</b><span class="rb-st">${esc(st)}</span><span class="rb-txt">${esc(c.text.replace(/^[A-Z0-9]+, /, ''))}</span></button>${btn}</div>`;
    }).join('');
    void sim;
  }
  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!b) return;
    const c = this.cards.find((x) => x.id === Number(b.dataset.id));
    if (!c) return;
    if (b.dataset.a === 'rb-sel') { this.g.select(c.cs, true); this.g.keepVisible(c.cs); return; }
    if (b.dataset.a === 'rb-fix' && c.fix) { vib(8); this.g.quick(c.cs, [c.fix]); return; }
    if (b.dataset.a === 'rb-again') { vib(8); this.g.quick(c.cs, c.items); }
  }
  /** Tutorial hook: forget everything (a fresh scenario). */
  reset() { this.cards = []; this.lastTx.clear(); this.sig = ''; this.el.hidden = true; this.el.innerHTML = ''; }
  destroy() { /* nothing to release */ }
}
