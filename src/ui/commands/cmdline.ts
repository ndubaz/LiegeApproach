// The command line for keyboard players. Digits pick the aircraft (81 → QTR8125), fix names are fuzzy
// (>lib → LIBVA), the phrase previews as you type, up and down recall the last clearances to edit or repeat,
// Enter sends, Escape clears. Tab (next caller) is the Game's. The grammar is parser.ts, the same as voice.
import { matchCallsigns, parseShorthand, type ParseCtx } from '../../engine/parser';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface CmdlineHost {
  parseCtx(): ParseCtx;
  /** the Game's live preview of the typed text (chips and phrase in the composer) */
  previewCmd(): void;
  submitCmd(): void;
  clearComposer(): void;
}

export class Cmdline {
  history: string[] = [];
  private hi = -1;
  private draft = '';
  hint: HTMLElement;
  constructor(private g: CmdlineHost, public input: HTMLInputElement) {
    this.hint = document.createElement('div');
    this.hint.className = 'cmd-hint mono';
    this.hint.dataset.e = 'cmdHint';
    this.hint.hidden = true;
    input.insertAdjacentElement('afterend', this.hint);
    input.addEventListener('keydown', (e) => this.onKey(e));
    input.addEventListener('input', () => this.onInput());
    this.hint.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-cs]') as HTMLElement | null;
      if (!b) return;
      // complete the callsign token and keep typing
      const rest = input.value.replace(/^\S+\s?/, '');
      input.value = `${b.dataset.cs} ${rest}`;
      input.focus();
      this.g.previewCmd(); this.onInput();
    });
  }
  /** Remember a sent line (called by the Game after a successful submit). */
  remember(line: string) {
    const l = line.trim();
    if (!l) return;
    this.history = this.history.filter((h) => h !== l);
    this.history.push(l);
    while (this.history.length > 30) this.history.shift();
    this.hi = -1; this.draft = '';
    this.hint.hidden = true;
  }
  private onInput() {
    this.hi = -1;
    const txt = this.input.value.trim();
    if (!txt) { this.hint.hidden = true; return; }
    const ctx = this.g.parseCtx();
    const first = txt.split(/\s+/)[0];
    const r = parseShorthand(txt, ctx);
    const cands = r.cs ? [] : matchCallsigns(first, ctx.callsigns).slice(0, 4);
    if (!r.cs && cands.length > 1) {
      this.hint.innerHTML = `<span class="dim">${esc(first.toUpperCase())}:</span> ${cands.map((c) => `<button data-cs="${esc(c)}">${esc(c)}</button>`).join('')}`;
      this.hint.hidden = false;
    } else if (r.errors.length) {
      this.hint.innerHTML = `<span class="warn">${esc(r.errors.join(' · '))}</span>`;
      this.hint.hidden = false;
    } else this.hint.hidden = true;
  }
  private onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!this.history.length) return;
      e.preventDefault();
      if (this.hi < 0) this.draft = this.input.value;
      const n = this.history.length;
      if (e.key === 'ArrowUp') this.hi = this.hi < 0 ? n - 1 : Math.max(0, this.hi - 1);
      else this.hi = this.hi < 0 ? -1 : this.hi + 1 >= n ? -1 : this.hi + 1;
      this.input.value = this.hi < 0 ? this.draft : this.history[this.hi];
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
      this.g.previewCmd();
      this.hint.hidden = true;
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); this.input.value = ''; this.hi = -1; this.hint.hidden = true; this.g.clearComposer(); return; }
  }
  destroy() { this.hint.remove(); }
}
