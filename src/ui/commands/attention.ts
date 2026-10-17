// The attention queue: who needs what next, across every aircraft, ordered by urgency, each row with its
// one-tap action. It is the strip bay's job (what is owed to whom) brought to the thumb, and it replaces the
// bare "CALLS 3" count. The Game owns the DOM element; this module fills it and answers taps.
import type { Sim } from '../../engine/sim';
import type { Aircraft } from '../../engine/types';
import type { Item } from '../../engine/clearance';
import { suggest, releaseAdvice, coordAdvice } from '../../engine/suggest';
import { hints } from '../../engine/hints';
import { levelText } from '../../engine/clearance';

export type AttentionKind = 'conflict' | 'wrong' | 'call' | 'release' | 'bru' | 'mil' | 'due';

export interface AttentionRow {
  key: string;
  kind: AttentionKind;
  /** the aircraft the row is about (a release names the departure on the ground) */
  cs: string;
  urgency: number;
  /** one plain line: what is wanted and why */
  reason: string;
  /** seconds this has been waiting (calls, releases, requests) */
  waitS?: number;
  /** the one-tap action, when there is a safe one */
  action?: { label: string; items: Item[]; why: string; icom?: boolean };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const vib = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* unsupported */ } };

/** The lead suggestion for an aircraft, when it is safe as it stands. */
function lead(sim: Sim, ac: Aircraft): AttentionRow['action'] | undefined {
  const s = suggest(sim, ac)[0];
  if (!s || !s.primary || s.warn?.length) return undefined;
  return { label: s.label, items: s.items, why: s.why, icom: s.icom };
}

/** Build the queue from the sim. Pure, so the engine tests can check the order. */
export function attentionRows(sim: Sim, max = 6): AttentionRow[] {
  const rows: AttentionRow[] = [];
  const add = (r: AttentionRow) => {
    const i = rows.findIndex((x) => x.cs === r.cs);
    if (i < 0) rows.push(r);
    else if (rows[i].urgency < r.urgency) rows[i] = { ...r, action: r.action ?? rows[i].action };
    else if (!rows[i].action && r.action) rows[i].action = r.action;
  };
  // 1. conflicts: STCA and loss of separation
  for (const a of sim.alerts()) {
    const ac = sim.find(a.a);
    add({ key: `stca:${a.a}:${a.b}`, kind: 'conflict', cs: a.a, urgency: 100, reason: `${a.kind === 'los' ? 'Separation lost' : 'Conflict'} with ${a.b}: turn or 1,000 ft now`, action: ac ? lead(sim, ac) : undefined });
  }
  for (const ac of sim.aircraft) {
    if (ac.remove || ac.state === 'unconcerned') continue;
    // 2. a wrong readback: the correction is the one-tap action
    if (ac.wrong && !sim.readbackPending(ac.cs)) {
      const it = ac.wrong.item;
      const right: Item | undefined = it.k === 'lvl' && ac.cflSys ? { k: 'lvl', lvl: ac.cflSys } : it.k === 'hdg' && ac.hdgSys !== undefined ? { k: 'hdg', hdg: Math.round((ac.hdgSys - sim.pack.meta.magVar + 360) % 360) || 360 } : undefined;
      const heard = it.k === 'lvl' ? levelText(it.lvl) : it.k === 'hdg' ? `heading ${String(it.hdg).padStart(3, '0')}` : it.k;
      add({ key: `wrong:${ac.cs}:${ac.wrong.t}`, kind: 'wrong', cs: ac.cs, urgency: 95, reason: `Read back ${heard}, wrong`, waitS: sim.t - ac.wrong.t,
        action: right ? { label: `Say again · ${right.k === 'lvl' ? levelText(right.lvl).replace(' ft', '') : 'H' + String(right.hdg).padStart(3, '0')}`, items: [right], why: 'Say it again, correctly.' } : undefined });
    }
    // 3. calls waiting (not while a readback is still to come)
    if (ac.awaitingSince !== undefined && sim.t >= ac.awaitingSince && ac.state === 'assumed' && !sim.readbackPending(ac.cs)) {
      const w = sim.t - ac.awaitingSince;
      const what = ac.emergency ? (ac.emergencyText ?? 'MAYDAY') : ac.request ? ac.request.text : ac.txCount === 0 ? 'Check-in' : ac.turnQuery ? 'Asks you to confirm the turn' : 'Calling';
      const act = lead(sim, ac) ?? { label: ac.txCount === 0 ? 'Identified' : 'Roger', items: [{ k: 'roger' } as Item], why: 'Answer the call.' };
      add({ key: `call:${ac.cs}`, kind: 'call', cs: ac.cs, urgency: (ac.emergency ? 90 : 50) + Math.min(40, w), reason: what, waitS: w, action: act });
    }
    // military crossing request on the intercom
    if (ac.request?.kind === 'milxing' && ac.state === 'inbound') {
      add({ key: `mil:${ac.cs}`, kind: 'mil', cs: ac.cs, urgency: 45 + Math.min(20, (sim.t - ac.request.t) / 5), reason: ac.request.text, waitS: sim.t - ac.request.t, action: { label: 'Approve', items: [{ k: 'appr' }], why: 'Approve the crossing.', icom: true } });
    }
  }
  // 4. Tower releases
  for (const r of sim.releases) {
    if (r.state !== 'pending' && r.state !== 'held') continue;
    const w = sim.t - r.t;
    const adv = releaseAdvice(sim, r.cs);
    const lab = adv.items[0]?.k === 'relhold' ? `Hold ${(adv.items[0] as any).mins ?? 3} min` : adv.items[0]?.k === 'rel' && (adv.items[0] as any).lvl ? `Release · ${levelText((adv.items[0] as any).lvl).replace(' ft', '')}` : 'Release';
    add({ key: `rel:${r.cs}`, kind: 'release', cs: r.cs, urgency: (r.state === 'held' ? 20 : 40) + Math.min(30, w / 6), reason: r.state === 'held' ? `Held on the ground, ${r.sid}` : `Tower asks: release ${r.type} ${r.sid}?`, waitS: r.state === 'held' ? undefined : w, action: { label: lab, items: adv.items, why: adv.why, icom: true } });
  }
  // 5. Brussels early-transfer requests
  for (const r of sim.coordReqs) {
    if (r.state !== 'pending') continue;
    const adv = coordAdvice(sim, r.cs);
    add({ key: `bru:${r.cs}`, kind: 'bru', cs: r.cs, urgency: 42 + Math.min(20, (sim.t - r.t) / 5), reason: `Brussels: take it early at ${levelText(r.level)}?`, waitS: sim.t - r.t, action: adv ? { label: adv.ok ? 'Approve' : 'As coordinated', items: adv.items, why: adv.why, icom: true } : undefined });
  }
  // 6. established on the localizer: the handoff to Tower is due
  for (const ac of sim.aircraft) {
    if (ac.remove || ac.kind !== 'arr' || ac.state !== 'assumed' || !ac.app?.locCap || ac.app.tooHigh || sim.readbackPending(ac.cs) || rows.some((r) => r.cs === ac.cs)) continue;
    const d = sim.dthr(ac);
    if (d > 14) continue;
    add({ key: `twr:${ac.cs}`, kind: 'due', cs: ac.cs, urgency: 36 + Math.min(12, (14 - d) * 1.5), reason: `Established, ${d.toFixed(0)} NM: hand to Tower`, action: lead(sim, ac) });
  }
  // 7. the next decision due: the supervisor's view, without the calls (already in)
  for (const h of hints(sim)) {
    if (!h.cs || /^(call|stca|rel):/.test(h.key)) continue;
    if (rows.some((r) => r.cs === h.cs)) continue;
    const ac = sim.find(h.cs);
    if (!ac || ac.state !== 'assumed' || sim.readbackPending(ac.cs)) continue;
    const short = h.text.replace(/^[A-Z0-9]+ /, '').replace(/\.\s.*$/, '');
    add({ key: h.key, kind: 'due', cs: h.cs, urgency: Math.min(44, h.urgency), reason: short.charAt(0).toUpperCase() + short.slice(1), action: lead(sim, ac) });
  }
  return rows.sort((a, b) => b.urgency - a.urgency).slice(0, max);
}

export interface AttentionHost {
  sim: Sim;
  cs?: string;
  select(cs?: string, force?: boolean): void;
  keepVisible(cs: string): void;
  quick(cs: string, items: Item[]): void;
  sendIcom(cs: string, items: Item[]): void;
  /** offer the two-second undo for a radio clearance just sent */
  armUndo?(cs: string, label: string): void;
}

/** Renders the queue into `el` and answers its taps. Call `update()` about twice a second. */
export class Attention {
  rows: AttentionRow[] = [];
  private sig = '';
  private expanded = false;
  private expandTimer = 0;
  constructor(private g: AttentionHost, public el: HTMLElement) {
    el.addEventListener('click', (e) => this.onClick(e));
  }
  /** The row at the top of the queue (what Tab and the ☎ button go to first). */
  top(): AttentionRow | undefined { return this.rows[0]; }
  /** Next row after the selected aircraft, round the queue. */
  next(): AttentionRow | undefined {
    if (!this.rows.length) return undefined;
    const i = this.rows.findIndex((r) => r.cs === this.g.cs);
    return this.rows[(i + 1) % this.rows.length];
  }
  /** Show every row for a few seconds (phone: the bar shows only the top row otherwise). */
  reveal(ms = 4000) {
    this.expanded = true; this.el.classList.add('open');
    clearTimeout(this.expandTimer);
    this.expandTimer = window.setTimeout(() => { this.expanded = false; this.el.classList.remove('open'); }, ms);
  }
  update() {
    const rows = attentionRows(this.g.sim);
    this.rows = rows;
    const sig = rows.map((r) => `${r.key}|${r.action?.label ?? ''}|${r.reason}|${r.cs === this.g.cs}`).join('#');
    if (sig === this.sig) { this.tick(); return; }
    this.sig = sig;
    this.el.hidden = !rows.length;
    this.el.classList.toggle('two', window.innerWidth < 900 || window.innerWidth >= 1400);
    this.el.innerHTML = rows.map((r, i) => `<div class="att-row ${r.kind} ${r.cs === this.g.cs ? 'sel' : ''}" data-cs="${esc(r.cs)}" data-key="${esc(r.key)}" data-i="${i}">
        <button class="att-sel" data-att="sel" title="Select ${esc(r.cs)}"><b class="mono">${esc(r.cs)}</b><span class="att-why">${esc(r.reason)}</span>${r.waitS !== undefined ? `<span class="att-t mono ${r.waitS > 15 ? 'late' : ''}" data-w0="${(this.g.sim.t - r.waitS).toFixed(1)}">${mmss(r.waitS)}</span>` : ''}</button>
        ${r.action ? `<button class="att-go" data-att="go" title="${esc(r.action.why)}">${esc(r.action.label)}</button>` : ''}
      </div>`).join('') + (rows.length > 1 ? `<button class="att-more" data-att="more" aria-label="Show the whole queue">+${rows.length - 1}</button>` : '');
  }
  private tick() {
    const t = this.g.sim.t;
    this.el.querySelectorAll<HTMLElement>('[data-w0]').forEach((e) => { const w = t - Number(e.dataset.w0); e.textContent = mmss(w); e.classList.toggle('late', w > 15); });
  }
  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-att]') as HTMLElement | null;
    if (!b) return;
    const row = b.closest('.att-row') as HTMLElement | null;
    const r = row ? this.rows[Number(row.dataset.i)] : undefined;
    if (b.dataset.att === 'more') { if (this.expanded) { this.expanded = false; this.el.classList.remove('open'); clearTimeout(this.expandTimer); } else this.reveal(8000); return; }
    if (!r) return;
    if (b.dataset.att === 'sel') { this.g.select(r.cs, true); this.g.keepVisible(r.cs); return; }
    if (b.dataset.att === 'go' && r.action) {
      vib(8);
      if (r.action.icom) this.g.sendIcom(r.cs, r.action.items);
      else { this.g.quick(r.cs, r.action.items); this.g.armUndo?.(r.cs, r.action.label); }
    }
  }
  destroy() { clearTimeout(this.expandTimer); }
}
