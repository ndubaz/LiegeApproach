import type { Pack, Level } from '../pack/load';
import { Sim, type CmdEntry } from '../engine/sim';
import type { Aircraft, ReleaseReq, Scenario, Tx } from '../engine/types';
import { itemChip, levelText, mergeItem, sortItems, unitName, type Clearance, type Item } from '../engine/clearance';
import { parseShorthand, parseVoiceAlternatives } from '../engine/parser';
import { landingOrder } from '../engine/sequence';
import { createPtt, type PttController } from './ptt';
import { windComponents } from '../engine/weather';
import { assess, liveStats, seqChain, type Result } from '../engine/assess';
import { suggest, levelList, hdgItem, roundHdg, releaseAdvice, type Suggestion } from '../engine/suggest';
import { hints, type Hint } from '../engine/hints';
import { remainNm } from '../engine/autopilot';
import { norm360, dist, bearing } from '../geo';
import { Scope, type QuickOption, type RadialKey } from './scope';
import { SKIN_NAMES, type SkinName } from './skins';
import { Mic, Radio } from './audio';
import { glossaryFor } from './glossary';
import { LEVEL_FILTERS, levelFilterId, saveSettings, type Settings } from '../store';
import { Attention } from './commands/attention';
import { Halo } from './commands/halo';
import { Readback } from './commands/readback';
import { Staging } from './commands/staging';
import { Cmdline } from './commands/cmdline';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const p3 = (n: number) => String(Math.round(n) % 360 || 360).padStart(3, '0');
const mmss = (s: number) => `${s < 0 ? '−' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, '0')}`;
const lvlKey = (l: Level) => (l.fl !== undefined ? `F${l.fl}` : `A${l.ft}`);
const touchFirst = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };

type PickerKind = 'hdg' | 'lvl' | 'spd' | 'dct' | 'trans' | 'more' | 'app' | 'menu';

export interface GameOpts {
  replay?: { cmds: CmdEntry[]; until: number };
  onEnd(r: Result, sim: Sim): void;
  onQuit(): void;
  coach?: (g: Game) => { destroy(): void };
  /** called right after the Sim is created, before any replay fast-forward */
  onSim?: (sim: Sim) => void;
}

export class Game {
  sim: Sim;
  scope: Scope;
  root: HTMLElement;
  speed = 1;
  private acc = 0;
  private last = 0;
  private raf = 0;
  items: Item[] = [];
  cs?: string;
  private coach?: { destroy(): void };
  private panelTimer = 0;
  private radio: Radio;
  private mic: Mic;
  private ptt?: PttController;
  private corrTimer = 0;
  private lastSentCs?: string;
  private knownAlerts = new Set<string>();
  private endedShown = false;
  els: Record<string, HTMLElement> = {};
  private drawerTab: 'info' | 'aman' | 'strips' | 'comms' | 'coord' = 'strips';
  private commsStick = true;
  private voiceText = '';
  private armedSig = '';
  private typed?: { cs?: string; items: Item[]; errors: string[]; armed: boolean };
  private seenLandings = 0;
  private seenRel = new Set<string>();
  private hint?: Hint;
  private hintMuted = new Set<string>();
  private hintTimer = 0;
  private suggestSig = '';
  private barSig = '';
  /** fired after every transmission by the player (tutorial hooks) */
  onSent: ((cl: Clearance) => void)[] = [];
  private ro?: ResizeObserver;
  private destroyed = false;
  private sendArmed = '';
  /** Tutorial hook: checked before every transmission (radio and intercom). Return a message to block it; the message is shown as a toast. */
  onBeforeSend?: (cl: Clearance) => string | undefined;
  /** Tutorial hook: show supervisor hints even though the scenario is a tutorial (the coach turns this on for the lessons that teach the SUP line). */
  coachHints = false;
  // ---- 2.0 commands module (src/ui/commands): composed here, each owns one element ----
  /** who needs what next, with its one-tap action (the NEXT button and Tab walk it) */
  attention!: Attention;
  /** direct manipulation round the selected aircraft; `halo.enabled` is false in tutorial scenarios until a lesson turns it on */
  halo!: Halo;
  /** the last clearances until their readback comes; a wrong one carries its correction */
  readback!: Readback;
  /** clearances queued for several aircraft, sent in order */
  staging!: Staging;
  /** history and callsign hints for the typed line */
  cmdline!: Cmdline;
  /** the next-call chips on offer for the selected aircraft */
  suggestions: Suggestion[] = [];
  /** the glossary for this airport's pack (the centre's name, the stack fix, the reserved areas) */
  gloss: Record<string, string>;

  constructor(public pack: Pack, public sc: Scenario, public settings: Settings, mount: HTMLElement, radio: Radio, public opts: GameOpts) {
    this.radio = radio;
    this.gloss = glossaryFor(pack);
    this.radio.enabled = settings.voice;
    this.radio.rate = settings.speechRate;
    this.radio.engine = settings.voiceEngine ?? 'neural';
    // the radio voices download in the background on the first session (not on a data-saver connection)
    if (settings.voice && !(navigator as any).connection?.saveData) this.radio.loadVoices();
    this.mic = new Mic({ lang: settings.voiceLang ?? 'en-GB', radio: this.radio });
    this.sim = new Sim(pack, sc, { radarRefresh: settings.radarRefresh });
    opts.onSim?.(this.sim);
    if (opts.replay) {
      const { cmds, until } = opts.replay;
      let i = 0;
      while (this.sim.t < until && !this.sim.ended) {
        while (i < cmds.length && cmds[i].t === this.sim.t) this.sim.replay(cmds[i++]);
        this.sim.step();
      }
    }
    this.seenLandings = this.sim.landings.length;
    this.root = this.build();
    mount.replaceChildren(this.root);
    const canvas = this.root.querySelector('canvas')!;
    this.scope = new Scope(canvas, this.sim, settings, {
      select: (cs) => this.select(cs),
      item: (cs, it) => { this.select(cs); this.addItem(it); },
      field: (cs, f, at) => { this.select(cs); this.openPicker(f === 'lvl' ? 'lvl' : f === 'spd' ? 'spd' : f === 'hdg' ? 'hdg' : f === 'app' ? 'app' : 'more', at); },
      longPress: (cs) => { this.select(cs); this.openPicker('more'); },
      // a tap on empty scope closes an open picker first; with nothing open it drops the selection (and its halo)
      emptyTap: () => { if (this.pickerOpen()) this.closePicker(); else if (this.cs) this.select(undefined); },
      // the scope's own ladder and drag sends get the two-second undo too (only when the clearance went out)
      onQuick: (cs, it) => { const n = this.sim.cmdLog.length; this.quick(cs, [it]); if (this.sim.cmdLog.length > n) this.armUndo(cs, itemChip(it)); },
      stage: (cs, it) => { this.select(cs); this.addItem(it, false); },
      radial: (cs, key, at) => this.onRadial(cs, key, at),
      levelOptions: (cs) => this.levelOptions(cs),
      speedOptions: (cs) => this.speedOptions(cs),
      newCaller: () => { this.radio.ping(); this.interrupt(); },
      rangeChanged: (nm) => this.onRange(nm),
      replayDone: () => this.toast('Replay done', 1200),
    });
    this.applyScopeOpts();
    this.sim.onTx.push((tx) => this.onTx(tx));
    this.sim.onQueue.push((tx) => { if (this.speed === 1 && tx.from === 'PILOT') this.radio.prepare(tx.speech, tx.cs); });
    this.buildCommands();
    for (const tx of this.sim.log.slice(-12)) this.appendComms(tx);
    this.ro = new ResizeObserver(() => this.scope.resize());
    this.ro.observe(canvas);
    window.addEventListener('keydown', this.onKey);
    this.renderBar();
    this.renderPanels();
    this.renderLive();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    if (opts.replay) this.toast(`Replay from ${this.sim.utc().slice(0, 5)}Z. Your earlier commands ran up to here.`);
    else if (!opts.coach && sc.objective) this.toast(sc.objective, 5000);
    if (opts.coach) this.coach = opts.coach(this);
  }

  /** Tutorial hook: replace the sim with a fresh one for another scenario (lesson exams), keeping the screen and the coach. */
  loadScenario(sc: Scenario) {
    this.sc = sc;
    this.sim = new Sim(this.pack, sc, { radarRefresh: this.settings.radarRefresh });
    this.opts.onSim?.(this.sim);
    this.scope.sim = this.sim;
    this.scope.closeTransient();
    this.scope.clearRbls();
    this.sim.onTx.push((tx) => this.onTx(tx));
    this.readback.reset(); this.staging.reset(); this.attention.update();
    this.seenLandings = 0; this.seenRel.clear(); this.knownAlerts.clear(); this.icomSig = ''; this.endedShown = false;
    this.hint = undefined; this.renderHint();
    this.els.comms.innerHTML = '';
    this.els.ticker.innerHTML = '';
    this.closePicker();
    this.select(undefined);
    this.renderIcom(); this.renderPanels(); this.renderLive();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ro?.disconnect();
    this.ptt?.destroy();
    this.halo?.destroy(); this.attention?.destroy(); this.readback?.destroy(); this.staging?.destroy(); this.cmdline?.destroy();
    this.mic.abort();
    this.coach?.destroy();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.radio.cancel();
  }

  // ---------------- DOM ----------------
  private build(): HTMLElement {
    const root = h('div', `game ${this.settings.leftHanded ? 'lefty' : ''} ${this.settings.brightness}`);
    const meta = this.pack.meta, sim = this.sim;
    const freq = esc(meta.appFreq);
    const sample = this.sampleCallsign();
    root.innerHTML = `
      <header class="topbar">
        <button class="tb-btn" data-a="menu" aria-label="Menu">☰</button>
        <div class="clock mono" data-e="clock">--:--:--Z</div>
        <div class="tag" data-e="atis">ATIS -</div>
        <div class="tag" data-e="rwy">RWY --</div>
        <div class="tag warn" data-e="lvp" hidden>LVP</div>
        <div class="tag tb-wide" data-e="tqnh">QNH</div><div class="tag tb-wide" data-e="ttl">TL</div><div class="tag tb-wide" data-e="twind">WIND</div><div class="tag tb-wide warn" data-e="ttsa" hidden></div><div class="tag tb-wide" data-e="trange" title="Range shown, NM, and the ring step">RNG</div>
        <div class="tx" data-e="tx" title="${esc(meta.appCallsign)} ${freq}"><span></span>${freq}</div>
        <div class="stats mono" data-e="stats" title="Landed · sequence chain · delay"></div>
        <div class="grow"></div>
        <button class="tb-btn callers" data-a="next" data-e="callers" title="Who needs you next (Tab)">NEXT</button>
        <div class="speed" data-e="speed">
          <button data-s="0" aria-label="Pause">❚❚</button><button data-s="1" class="on">1×</button><button data-s="2">2×</button><button data-s="4">4×</button><button data-s="8" class="skip" title="Fast forward. Drops back to 1× when anyone calls.">8×</button>
        </div>
        <button class="tb-btn drawer-btn" data-a="drawer" aria-label="Panels">▤</button>
      </header>
      <main class="stage">
        <section class="scope-wrap">
          <canvas class="scope" aria-label="Radar display"></canvas>
          <div class="zoom"><span class="presets"><button data-z="r20" class="rbl">20</button><button data-z="r40" class="rbl">40</button><button data-z="r60" class="rbl">60</button></span><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="fit" aria-label="Reset view">◎</button><button data-z="rbl" class="rbl" aria-label="Range and bearing line">RBL</button><button data-z="vp" class="rbl" aria-label="Final approach monitor">VP</button></div>
          <div class="emer-card" data-e="emer" hidden></div>
          <div class="feed" data-e="feed" aria-live="polite"></div>
          <div class="toast" data-e="toast" hidden></div>
          <div class="icom" data-e="icom" aria-live="polite"></div>
        </section>
        <aside class="side" data-e="side">
          <nav class="tabs" data-e="tabs"><button data-t="strips" class="on">Strips</button><button data-t="aman">AMAN</button><button data-t="coord">Coord</button><button data-t="comms">Comms</button><button data-t="info">Info</button></nav>
          <section class="panel info" data-p="info"><h3>Information</h3><div data-e="info"></div></section>
          <div class="mid">
            <section class="panel aman" data-p="aman"><h3>AMAN <span data-e="amanRwy"></span> <small>TTL min</small></h3><div class="aman-body" data-e="aman"></div></section>
            <section class="panel strips" data-p="strips"><h3>Strips</h3><div class="strip-list" data-e="strips"></div></section>
          </div>
          <section class="panel coord" data-p="coord"><h3>Coordination <small>intercom</small></h3><div data-e="coord"></div></section>
          <section class="panel comms" data-p="comms"><h3>Comms <span class="dim">${freq} · intercom</span></h3><div class="comms-log" data-e="comms"></div></section>
        </aside>
      </main>
      <footer class="bar" data-e="bar">
        <div class="ticker mono" data-e="ticker"></div>
        <div class="att" data-e="att" hidden></div>
        <div class="hint" data-e="hint" hidden></div>
        <div class="bar-head">
          <div class="who" data-e="who"></div>
          <div class="req" data-e="req"></div>
          <button class="kbd-btn" data-a="kbd" aria-label="Type a command">⌨</button>
          <button class="q-btn" data-a="queue" data-e="queueBtn" title="Queue this clearance and build the next (Q)" aria-label="Queue for later">Q</button>
          <button class="mic" data-a="mic" data-e="mic" aria-label="Push to talk">🎙</button>
          <button class="x" data-a="clear" aria-label="Clear">✕</button>
        </div>
        <div class="sugg" data-e="sugg"></div>
        <div class="rb" data-e="rb" hidden></div>
        <div class="bar-mid" data-e="mid"><div class="chips" data-e="chips"></div><div class="phrase" data-e="phrase"></div></div>
        <div class="stq" data-e="stq" hidden></div>
        <div class="bar-grid" data-e="grid">
          <button data-p="hdg">HDG</button><button data-p="lvl">LVL</button><button data-p="spd">SPD</button><button data-p="dct">DCT</button><button data-a="app" data-e="appBtn" class="wide-only">ILS</button>
          <button data-p="trans" class="wide-only">TRANS</button><button data-a="hold" class="wide-only">HOLD</button><button data-a="twr" class="wide-only" title="${esc(unitName(sim.twr.id, sim.units).text)}">${esc(sim.twr.id)}</button><button data-a="bru" class="wide-only" title="${esc(unitName(sim.acc.id, sim.units).text)}">${esc(sim.acc.id)}</button><button data-p="more">MORE</button>
          <button class="send" data-a="send" data-e="send">TRANSMIT</button>
        </div>
        <div class="mon" data-e="mon">
          <button class="send big" data-a="send">TRANSMIT</button>
          <button class="corr" data-a="corr" data-e="corr" hidden>CORRECTION · disregard</button>
          <div class="rx"><span class="led" data-e="rxled"></span><span class="mono">${freq}</span><span class="vu" data-e="vu"><i></i><i></i><i></i><i></i><i></i></span><span class="ptt-k mono" data-e="pttk"></span></div>
          <div class="last mono" data-e="last"></div>
        </div>
        <form class="cmd" data-e="cmdForm"><input data-e="cmd" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Type: ${esc(sample)} L250 D40 S210 ILS · ${esc(sample)} REL · Tab next caller · ↑↓ level ←→ heading"></form>
      </footer>
      <div class="picker" data-e="picker" hidden></div>
    `;
    root.querySelectorAll<HTMLElement>('[data-e]').forEach((e) => (this.els[e.dataset.e!] = e));
    root.addEventListener('click', (e) => this.onClick(e));
    this.els.comms.addEventListener('scroll', () => { const c = this.els.comms; this.commsStick = c.scrollTop + c.clientHeight >= c.scrollHeight - 30; });
    const form = this.els.cmdForm as HTMLFormElement;
    form.addEventListener('submit', (e) => { e.preventDefault(); this.submitCmd(); });
    this.els.cmd.addEventListener('input', () => this.previewCmd());
    if (!this.mic.available) this.els.mic.classList.add('off');
    this.ptt = createPtt({
      target: this.els.mic,
      key: this.settings.pttKey ?? 'Space',
      pedal: this.settings.pedal ?? null,
      onDown: () => this.voiceDown(),
      onUp: (i) => (i?.reason === 'cancel' ? this.voiceCancel() : this.voiceUp()),
    });
    this.els.pttk.textContent = this.settings.pttKey ? `PTT ${this.settings.pttKey === 'Space' ? 'SPACE' : this.settings.pttKey.replace('Backquote', '`').replace('ControlRight', 'R-CTRL')}` : '';
    // long-press on a suggestion stages it for editing instead of sending
    let lp = 0;
    this.els.sugg.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sg]') as HTMLElement | null;
      if (!b) return;
      lp = window.setTimeout(() => { lp = -1; b.dataset.staged = '1'; this.stageSuggestion(Number(b.dataset.sg)); }, 480);
    });
    const cancel = () => { if (lp > 0) clearTimeout(lp); };
    this.els.sugg.addEventListener('pointerup', cancel);
    this.els.sugg.addEventListener('pointerleave', cancel);
    return root;
  }

  /** Compose the 2.0 commands module round the bar and the scope. */
  private buildCommands() {
    const host = this.root.querySelector<HTMLElement>('.scope-wrap')!;
    this.halo = new Halo(this, host);
    this.halo.enabled = !this.sc.tutorial;
    this.attention = new Attention(this, this.els.att);
    this.readback = new Readback(this, this.els.rb);
    this.staging = new Staging(this, this.els.stq);
    this.cmdline = new Cmdline(this, this.els.cmd as HTMLInputElement);
    this.onSent.push((cl) => this.readback.sent(cl));
  }
  /** Enter: transmit what is staged; else the first queued clearance; else accept the attention row's action for the selected aircraft (Tab, Enter). */
  enter() {
    if (this.items.length) { this.send(); return; }
    if (this.staging.length) { this.staging.send(0); return; }
    const row = this.cs ? this.attention.rows.find((r) => r.cs === this.cs) : undefined;
    if (row?.action) {
      if (row.action.icom) this.sendIcom(row.cs, row.action.items); else { this.quick(row.cs, row.action.items); this.armUndo(row.cs, row.action.label); }
      return;
    }
    this.send();
  }
  /** True while a picker sheet is open (the halo steps aside). */
  pickerOpen() { return !this.els.picker.hidden; }
  /** Drop whatever is staged or typed for the selected aircraft. */
  clearComposer() { this.items = []; this.voiceText = ''; this.typed = undefined; this.armedSig = ''; (this.els.cmd as HTMLInputElement).value = ''; this.renderBar(); }
  /** Send a whole clearance through the bar's path (tutorial veto, warnings, readback card). Returns true when it went out. */
  sendClearance(cl: Clearance): boolean {
    if (this.sim.isIntercomAnswer(cl) || cl.items.some((i) => i.k === 'rel' || i.k === 'relhold')) { this.sendIcom(cl.cs, cl.items); return true; }
    if (!this.sim.find(cl.cs)) return false;
    const before = this.sim.cmdLog.length;
    this.select(cl.cs, true);
    this.items = [];
    for (const it of cl.items) this.items = mergeItem(this.items, it);
    this.send(true);
    return this.sim.cmdLog.length > before;
  }
  /** Answer Tower, Brussels or the military on the intercom with these items (release, hold, approve, unable). */
  sendIcom(cs: string, items: Item[]) {
    const veto = this.onBeforeSend?.({ cs, items });
    if (veto) { this.toast(veto); return; }
    const r = this.sim.issue({ cs, items });
    if (!r.ok) { this.toast(r.warnings.join('; ')); return; }
    for (const f of this.onSent) f({ cs, items });
    this.icomSig = ''; this.coordSig = '';
    this.renderIcom(); this.renderPanels(); this.renderBar();
  }
  /** Two-second undo for a clearance just sent (Backspace, or the Undo button on the scope). */
  armUndo(cs: string, label: string) { this.halo.armUndo(cs, label); }
  /** The airport's stack fix (ALHUV at Liège, BIKMU at Düsseldorf); for the selected arrival, the stack it is heading for. */
  stackFix() { const ac = this.cs ? this.sim.find(this.cs) : undefined; return ac && ac.kind === 'arr' ? this.sim.stackFixOf(ac) : this.sim.stackFix; }
  /** The fixes a controller names most: the stacks, the IF and FAF of the runway in use, the STAR and transition entry fixes. */
  keyFixes(): string[] {
    const sim = this.sim, rw = sim.rwy;
    const out = new Set<string>([...sim.stackFixes(), rw.ifFix, rw.faf]);
    for (const t of sim.pack.transitions) if (t.runways.includes(sim.runway) && t.legs[0]) out.add(t.legs[0].fix);
    for (const st of sim.pack.stars) { if (st.legs[0]) out.add(st.legs[0].fix); const last = st.legs[st.legs.length - 1]; if (last) out.add(last.fix); }
    return [...out].filter((f) => sim.pack.fixes.has(f));
  }
  /** Published holds that are not the stack: the extra places to park an aircraft. */
  otherHolds(): string[] {
    const stacks = this.sim.stackFixes();
    return [...new Set(this.sim.pack.holds.map((h) => h.fix))].filter((f) => !stacks.includes(f) && this.sim.pack.fixes.has(f));
  }
  /** A callsign of the kind this airport sees, for the typed-line hint. */
  private sampleCallsign() {
    const t = this.pack.spec.traffic;
    const op = (t?.cargo?.[0] ?? t?.pax?.[0])?.op ?? 'QTR';
    return `${op}${String(100 + (this.sc.seed % 900))}`;
  }
  /** The console and scope skin: the class on the root (CSS tokens) and the scope's own colours. */
  setSkin(name: SkinName) {
    this.settings.brightness = name;
    for (const n of SKIN_NAMES) this.root.classList.toggle(n.id, n.id === name);
    this.scope.opts.skin = name;
    this.scope.resize();
  }
  /** Mirror the saved scope options onto the scope (at game start and after every change). */
  applyScopeOpts() {
    const s = this.settings, o = this.scope.opts;
    o.skin = (SKIN_NAMES.some((n) => n.id === s.brightness) ? s.brightness : 'night') as SkinName;
    o.ringStep = s.ringStep ?? 5;
    o.levelFilter = s.levelFilter ?? undefined;
    o.sweep = !!s.sweep;
    o.trailLen = Math.max(0, Math.min(7, s.trailLen ?? 5));
    o.smooth = s.smooth !== false;
    this.scope.resize();
    this.onRange(this.rangeNm());
  }
  private rangeNm() { return Math.round(Math.min(this.scope.w, this.scope.h) / (2 * this.scope.scale)); }
  /** The range tag and the zoom presets follow the scope's range. */
  private onRange(nm: number) {
    if (this.els.trange) this.els.trange.textContent = `RNG ${nm} · ${this.scope.opts.ringStep}`;
    this.root.querySelectorAll<HTMLElement>('[data-z^="r"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.z!.slice(1)) === nm));
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('button, .strip, [data-pick]') as HTMLElement | null;
    if (!t) { const el = e.target as HTMLElement; if (!el.closest('.picker') && el.tagName !== 'CANVAS') this.closePicker(); return; }
    this.radio.unlock();
    if (t.dataset.pick !== undefined) { this.onPick(t.dataset.pick); return; }
    if (t.dataset.sg !== undefined) { if (t.dataset.staged) { delete t.dataset.staged; return; } this.sendSuggestion(Number(t.dataset.sg)); return; }
    if (t.dataset.rel !== undefined) { this.answerIcom(t.dataset.rel, t.dataset.v ?? ''); return; }
    if (t.dataset.gloss) { this.explain(t.dataset.gloss); return; }
    if (t.classList.contains('strip') || t.classList.contains('net')) { this.select(t.dataset.cs, true); if (t.dataset.cs) this.keepVisible(t.dataset.cs); return; }
    if (t.dataset.relsel) { const inp = this.els.cmd as HTMLInputElement; inp.value = `${t.dataset.relsel} `; this.root.classList.add('kbd'); inp.focus(); this.previewCmd(); this.toast(`${t.dataset.relsel}: type REL, REL AFTER callsign, RH3 or a release heading, then Enter.`, 3200); return; }
    if (t.dataset.ikey) { const u = t.dataset.ikey; const m = [...this.sim.log].reverse().find((x) => x.channel === 'icom' && (x.from === u || (u === 'TWR' && x.from === 'ATC' && /released|hold/i.test(x.text)))); this.toast(m ? `${u}: ${m.text}` : `${u}: nothing pending.`, 4500); return; }
    const a = t.dataset.a, p = t.dataset.p, s = t.dataset.s, z = t.dataset.z, tab = t.dataset.t;
    if (s !== undefined) { this.setSpeed(Number(s)); return; }
    if (z) {
      if (/^r\d+$/.test(z)) { const nm = Number(z.slice(1)); this.scope.animateTo(Math.min(this.scope.w, this.scope.h) / (2 * nm), { x: 2, y: -1 }); return; }
      if (z === 'in') this.scope.zoom(1.35);
      else if (z === 'out') this.scope.zoom(1 / 1.35);
      else if (z === 'vp') { this.scope.showProfile = !this.scope.showProfile; t.classList.toggle('on', this.scope.showProfile); }
      else if (z === 'rbl') { this.scope.rblMode = !this.scope.rblMode; t.classList.toggle('on', this.scope.rblMode); this.toast(this.scope.rblMode ? 'RBL: drag between two points or aircraft. Tap a readout to delete it.' : 'RBL off'); }
      else this.scope.fit(true);
      return;
    }
    if (tab) { this.drawerTab = tab as any; this.root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === tab)); this.root.dataset.tab = tab; return; }
    if (p) { this.openPicker(p as PickerKind); return; }
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    switch (a) {
      case 'menu': this.openPicker('menu'); break;
      case 'next': this.nextCaller(); break;
      case 'drawer': this.root.classList.toggle('drawer-open'); break;
      case 'clear': this.clearComposer(); break;
      case 'queue': this.staging.queueCurrent(); break;
      case 'send': this.send(); break;
      case 'roger': if (ac) this.quick(ac.cs, [{ k: 'roger' }]); break;
      case 'sayagain': if (ac) this.quick(ac.cs, [{ k: 'sayagain' }]); break;
      case 'corr': if (this.lastSentCs) { const ok = this.sim.correct(this.lastSentCs); this.toast(ok ? `${this.lastSentCs}: correction, disregard.` : 'Too late: the pilot is already reading back. Give the right clearance instead.'); this.els.corr.hidden = true; } break;
      case 'stby': if (ac) this.quick(ac.cs, [{ k: 'standby' }]); break;
      case 'kbd': { const on = this.root.classList.toggle('kbd'); if (on) (this.els.cmd as HTMLInputElement).focus(); break; }
      case 'app': if (ac) this.addItem({ k: 'app', app: 'ILS', rwy: this.sim.runway }); else this.toast('Select an aircraft first'); break;
      case 'hold': if (ac) this.addItem({ k: 'hold', fix: this.stackFix() }); else this.toast('Select an aircraft first'); break;
      case 'twr': if (ac) this.addItem({ k: 'xfr', unit: this.sim.twr.id }); else this.toast('Select an aircraft first'); break;
      case 'bru': if (ac) this.addItem({ k: 'xfr', unit: this.sim.acc.id }); else this.toast('Select an aircraft first'); break;
      case 'chip': { const i = Number(t.dataset.i); this.items.splice(i, 1); this.renderBar(); break; }
      case 'hint-go': if (this.hint?.cs) { this.select(this.hint.cs, true); this.scope.focus(this.sim.find(this.hint.cs)?.p ?? this.scope.center); } break;
      case 'hint-x': if (this.hint) { this.hintMuted.add(this.hint.key); this.hint = undefined; this.renderHint(); } break;
      case 'emer-go': { const cs = t.dataset.cs; if (cs) { this.select(cs, true); const p = this.sim.find(cs)?.p; if (p) this.scope.focus(p); } break; }
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const inInput = (e.target as HTMLElement).tagName === 'INPUT';
    if (e.key === 'Tab') { e.preventDefault(); this.nextCaller(); return; }
    if (e.key === 'Escape') {
      // Escape steps back: an open picker, then a composed clearance, then the selection
      if (this.pickerOpen()) this.closePicker();
      else if (this.items.length || (this.els.cmd as HTMLInputElement).value) this.clearComposer();
      else if (this.cs) this.select(undefined);
      this.scope.closeTransient();
      return;
    }
    if (inInput) return;
    if (e.key === ' ') { if (this.settings.pttKey === 'Space' && !e.shiftKey) return; e.preventDefault(); this.setSpeed(this.speed ? 0 : 1); return; }
    if (e.key === 'Enter') { this.enter(); return; }
    if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey) { if (this.halo.undo()) e.preventDefault(); return; }
    if ((e.key === 'q' || e.key === 'Q') && !e.metaKey && !e.ctrlKey && !e.altKey && this.items.length) { e.preventDefault(); this.staging.queueCurrent(); return; }
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    if (ac && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const list = levelList(this.sim);
      const cur = this.items.find((i) => i.k === 'lvl') as { lvl: Level } | undefined;
      const ref = this.sim.ftOf(cur?.lvl ?? ac.cflSys ?? ac.cleared);
      const sorted = [...list].sort((a, b) => this.sim.ftOf(a) - this.sim.ftOf(b));
      const next = e.key === 'ArrowUp' ? sorted.find((l) => this.sim.ftOf(l) > ref + 50) : [...sorted].reverse().find((l) => this.sim.ftOf(l) < ref - 50);
      if (next) this.addItem({ k: 'lvl', lvl: next }, false);
      return;
    }
    if (ac && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const cur = this.items.find((i) => i.k === 'hdg') as { hdg: number } | undefined;
      const base = cur?.hdg ?? Math.round(norm360(ac.hdg - this.sim.pack.meta.magVar) / 5) * 5;
      const nh = norm360(base + (e.key === 'ArrowRight' ? 5 : -5)) || 360;
      this.addItem(hdgItem(this.sim, ac, nh), false);
      return;
    }
    if (/^[1-4]$/.test(e.key) && this.suggestions.length && !e.metaKey && !e.ctrlKey && !this.items.length && (this.els.cmd as HTMLInputElement).value === '' && e.altKey) { this.sendSuggestion(Number(e.key) - 1); return; }
    if (/^[a-z0-9]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) (this.els.cmd as HTMLInputElement).focus();
  };

  // ---------------- selection and clearance building ----------------
  /** Select an aircraft. Staged items for another aircraft are dropped (they are visible, so this is never a surprise). */
  select(cs?: string, _force = false) {
    const changed = cs !== this.cs;
    this.cs = cs;
    this.scope.selected = cs;
    if (changed) { this.items = []; this.typed = undefined; }
    this.voiceText = '';
    this.closePicker();
    this.suggestSig = '';
    this.renderBar();
    this.renderPanels();
  }
  addItem(it: Item, maybeQuick = true) {
    if (!this.cs) return;
    this.items = mergeItem(this.items, it);
    this.voiceText = '';
    this.closePicker();
    if (maybeQuick && this.settings.quickMode) this.send();
    else this.renderBar();
  }
  /** Send these items at once (merged with anything staged for the same aircraft). */
  quick(cs: string, items: Item[]) {
    if (this.cs !== cs) this.select(cs);
    for (const it of items) this.items = mergeItem(this.items, it);
    this.send();
  }
  /** Tab and the NEXT button: walk the attention queue (who needs what next), the oldest caller first. */
  private nextCaller() {
    this.attention.update();
    const row = this.attention.next();
    if (!row) { this.toast('Nobody needs you right now'); return; }
    if (this.sim.find(row.cs)) { this.select(row.cs, true); this.keepVisible(row.cs); }
    else {
      // a release or a request about an aircraft not on the scope: point at its card instead of dropping the player nowhere
      this.select(undefined);
      const card = [...this.root.querySelectorAll<HTMLElement>(`[data-rel="${CSS.escape(row.cs)}"]`)].map((b) => b.closest<HTMLElement>('.ic-card')).find((c) => c && c.getClientRects().length);
      if (card) { card.scrollIntoView({ block: 'nearest' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
    }
    this.attention.reveal();
  }
  waiting() { return this.sim.callers().filter((a) => a.state === 'assumed' && this.sim.t >= (a.awaitingSince ?? 0)); }
  private send(confirmed = false) {
    if (!this.cs || !this.items.length) return;
    const cl: Clearance = { cs: this.cs, items: sortItems(this.items) };
    const veto = this.onBeforeSend?.(cl); // tutorial hook
    if (veto) { this.toast(veto); return; }
    const warns = this.sim.validate(cl);
    if (this.settings.trainingWheels && warns.length) { this.toast(`Blocked: ${warns.join('; ')}`); return; }
    const sig = JSON.stringify(cl);
    if (warns.length && !confirmed && this.sendArmed !== sig) { this.sendArmed = sig; this.toast(`${warns[0]}. Transmit again to send anyway.`, 2600); this.sends().forEach((b) => b.classList.add('armed')); return; }
    this.sendArmed = ''; this.sends().forEach((b) => b.classList.remove('armed'));
    const r = this.sim.issue(cl);
    if (r.ok) {
      this.lastSentCs = cl.cs; this.els.corr.hidden = false; clearTimeout(this.corrTimer); this.corrTimer = window.setTimeout(() => (this.els.corr.hidden = true), 3000);
      this.items = []; this.typed = undefined; this.suggestSig = '';
      this.renderBar(); this.renderIcom(); this.renderPanels();
      for (const f of this.onSent) f(cl);
    } else if (r.warnings.length) this.toast(r.warnings.join('; '));
  }
  private sendSuggestion(i: number) {
    const s = this.suggestions[i];
    if (!s || !this.cs) return;
    this.items = [];
    this.quick(this.cs, s.items);
  }
  private stageSuggestion(i: number) {
    const s = this.suggestions[i];
    if (!s || !this.cs) return;
    this.items = [];
    for (const it of s.items) this.items = mergeItem(this.items, it);
    this.renderBar();
    this.toast('Staged. Edit it, then transmit.', 1800);
  }

  // ---------------- typed commands with live preview ----------------
  parseCtx() {
    return {
      callsigns: [...this.sim.aircraft.filter((a) => !a.remove).map((a) => a.cs), ...this.sim.releases.filter((r) => r.state !== 'airborne').map((r) => r.cs), ...this.sim.coordReqs.filter((r) => r.state === 'pending').map((r) => r.cs)], selected: this.cs, runway: this.sim.runway, tl: this.sim.tl,
      fixes: new Set([...this.sim.pack.fixes.keys()]), transitions: new Set(this.sim.pack.transitions.map((t) => t.name)),
      stars: new Set(this.sim.pack.stars.map((t) => t.name)), holdFix: this.stackFix(), units: this.sim.units,
    };
  }
  previewCmd() {
    const txt = (this.els.cmd as HTMLInputElement).value.trim();
    if (!txt) { this.typed = undefined; this.renderBar(); return; }
    const res = parseShorthand(txt, this.parseCtx());
    this.typed = { cs: res.cs ?? this.cs, items: res.items, errors: res.errors, armed: false };
    if (res.cs && res.cs !== this.cs && this.sim.find(res.cs)) { this.cs = res.cs; this.scope.selected = res.cs; this.items = []; }
    this.renderBar();
  }
  submitCmd() {
    const inp = this.els.cmd as HTMLInputElement;
    const txt = inp.value.trim();
    if (!txt) { this.enter(); return; }
    const res = parseShorthand(txt, this.parseCtx());
    if (res.errors.length) { this.toast(res.errors.join('; ')); return; }
    const cs = res.cs ?? this.cs;
    if (!cs) { this.toast('Select an aircraft or start with a callsign'); return; }
    if (res.correction) { const ok = this.sim.correct(cs); this.toast(ok ? `${cs}: correction, disregard.` : 'Too late to correct: give the right clearance instead.'); inp.value = ''; this.typed = undefined; this.renderBar(); return; }
    res.items.push(...((res.ext ?? []) as Item[]));
    if (!res.items.length) { this.select(cs, true); inp.value = ''; this.typed = undefined; this.keepVisible(cs); return; }
    const isRel = !!this.sim.isIntercomAnswer({ cs, items: res.items }) || res.items.some((i) => i.k === 'rel' || i.k === 'relhold');
    const warns = isRel ? [] : this.sim.validate({ cs, items: res.items });
    const sig = JSON.stringify([cs, res.items]);
    if (warns.length && this.armedSig !== sig) {
      this.armedSig = sig;
      this.typed = { cs, items: res.items, errors: [], armed: true };
      this.renderBar();
      this.toast(`${warns[0]}. Press Enter again to send anyway.`, 2500);
      return;
    }
    inp.value = '';
    this.typed = undefined;
    this.armedSig = '';
    this.cmdline.remember(txt);
    if (isRel) {
      const rq = this.sim.releases.find((r) => r.cs === cs && r.state !== 'airborne');
      const plain = res.items.length === 1 && res.items[0].k === 'rel' && !(res.items[0] as any).after && (res.items[0] as any).hdg === undefined && !(res.items[0] as any).lvl;
      if (rq?.state === 'released' && plain) { this.toast(`${cs} is already released${rq.after ? ` after ${rq.after}` : ''}. Tower launches when the runway is free.`); return; }
      const veto = this.onBeforeSend?.({ cs, items: res.items });
      if (veto) { this.toast(veto); return; }
      const r = this.sim.issue({ cs, items: res.items });
      if (!r.ok) this.toast(r.warnings.join('; ')); else for (const f of this.onSent) f({ cs, items: res.items });
      this.icomSig = ''; this.coordSig = ''; this.renderIcom(); this.renderBar(); return;
    }
    if (cs !== this.cs) this.select(cs, true);
    this.items = [];
    for (const it of res.items) this.items = mergeItem(this.items, it);
    this.send(true);
  }
  // ---------------- push-to-talk voice ----------------
  private voiceDown() {
    this.radio.unlock();
    this.els.mic.classList.add('live');
    this.els.rxled.classList.add('tx');
    if (!this.mic.available) return;
    this.voiceText = '';
    this.mic.begin({
      onInterim: (t) => { this.voiceText = t; this.renderBar(); },
      onFinal: (t, alts) => this.voiceFinal(t, alts),
      onError: (_c, msg) => { this.els.mic.classList.remove('live'); this.toast(msg); },
    });
  }
  private voiceUp() { this.els.mic.classList.remove('live'); this.els.rxled.classList.remove('tx'); if (this.mic.available) this.mic.end(); else this.toast('Speech recognition is not available in this browser. Type or tap instead.'); }
  private voiceCancel() { this.els.mic.classList.remove('live'); this.els.rxled.classList.remove('tx'); this.mic.abort(); this.voiceText = ''; this.renderBar(); }
  private voiceFinal(text: string, alts: string[]) {
    if (!text) { this.voiceText = ''; this.renderBar(); this.toast('Nothing heard. Hold the key, speak, then release.', 2200); return; }
    const tels: Record<string, string> = {};
    for (const a of this.sim.aircraft) tels[a.cs] = a.tel;
    const v = parseVoiceAlternatives(alts.length ? alts : [text], { ...this.parseCtx(), tels });
    this.voiceText = `“${text}”`;
    const inp = this.els.cmd as HTMLInputElement;
    inp.value = v.shorthand;
    this.root.classList.add('kbd');
    this.previewCmd();
    if (v.confidence >= 0.75 && !v.unsure.length && (v.parse.items.length || v.parse.ext?.length || v.correction)) this.submitCmd();
    else this.toast(v.unsure.length ? `Check: ${v.unsure.join('; ')}. Enter to send.` : 'Check it, then Enter to send.', 3200);
  }

  // ---------------- options shared by pickers and the scope ladder ----------------
  levelOptions(cs: string): QuickOption[] {
    const ac = this.sim.find(cs);
    if (!ac) return [];
    const mva = this.sim.mvaAt(ac.p);
    return levelList(this.sim).map((lvl) => {
      const ft = this.sim.ftOf(lvl);
      return { label: levelText(lvl).replace(' ft', ''), item: { k: 'lvl', lvl } as Item, warn: ft < mva - 1 ? `MVA ${mva}` : undefined };
    });
  }
  speedOptions(cs: string): QuickOption[] {
    const ac = this.sim.find(cs);
    if (!ac) return [];
    const est = !!ac.app?.locCap || remainNm(this.sim, ac) < 15;
    const rows: { v: number; o: QuickOption }[] = [];
    for (let v = 300; v >= Math.max(140, Math.floor(ac.perf.vapp / 10) * 10 + 10); v -= 10) rows.push({ v, o: { label: String(v), item: { k: 'spd', spd: v }, warn: v < ac.perf.vminClean && !est ? 'below min clean' : undefined } });
    // detents sit where their speed is, so the ladder stays in order
    rows.push({ v: ac.perf.vminClean - 0.5, o: { label: 'MIN CLN', item: { k: 'spdmin' } } });
    rows.push({ v: 159.5, o: { label: '160/4', item: { k: 'spd', spd: 160, until: 4 } } });
    return rows.sort((a, b) => b.v - a.v).map((r) => r.o);
  }
  private onRadial(cs: string, key: RadialKey, at: { x: number; y: number }) {
    this.select(cs);
    const ac = this.sim.find(cs);
    if (!ac) return;
    switch (key) {
      case 'HDG': this.openPicker('hdg', at); break;
      case 'LVL': this.openPicker('lvl', at); break;
      case 'SPD': this.openPicker('spd', at); break;
      case 'DCT': this.openPicker('dct', at); break;
      case 'ILS': this.addItem({ k: 'app', app: 'ILS', rwy: this.sim.runway }); break;
      case 'HOLD': this.addItem({ k: 'hold', fix: this.stackFix() }); break;
      case 'TWR': this.addItem({ k: 'xfr', unit: ac.kind === 'dep' ? this.sim.acc.id : this.sim.twr.id }); break;
      default: this.openPicker('more', at);
    }
  }

  // ---------------- pickers ----------------
  private openPicker(kind: PickerKind, at?: { x: number; y: number }) {
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    if (kind !== 'menu' && !ac) { this.toast('Select an aircraft first'); return; }
    const pk = this.els.picker;
    const sim = this.sim;
    const rows: string[] = [];
    const opt = (key: string, label: string, cls = '', note = '') => rows.push(`<button data-pick="${esc(key)}" class="${cls}"><span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</button>`);
    let title = '';
    let grid = '';
    const staged = (k: Item['k']) => this.items.find((i) => i.k === k);
    switch (kind) {
      case 'lvl': {
        title = `Level · ${ac!.cs}`;
        grid = 'g3';
        const mva = sim.mvaAt(ac!.p);
        const clr = sim.ftOf(ac!.cflSys ?? ac!.cleared), cur = ac!.alt;
        const st = staged('lvl') as { lvl: Level } | undefined;
        let mvaDrawn = false;
        for (const lv of levelList(sim)) {
          const ft = sim.ftOf(lv);
          if (!mvaDrawn && ft < mva - 1) { rows.push(`<div class="mva-line">MVA ${mva} ft below this line</div>`); mvaDrawn = true; }
          const isClr = Math.abs(ft - clr) < 60, isCur = Math.abs(ft - cur) < 450, isSt = st && lvlKey(st.lvl) === lvlKey(lv);
          opt(lvlKey(lv), levelText(lv).replace(' ft', ''), `${isClr ? 'cleared' : ''} ${isCur ? 'current' : ''} ${isSt ? 'staged' : ''} ${ft < mva - 1 ? 'below' : ''} ${lv.fl === undefined ? 'alt' : ''}`, isClr ? 'cleared' : isCur ? 'now' : '');
        }
        if (!mvaDrawn) rows.push(`<div class="mva-line soft">MVA here ${mva} ft</div>`);
        break;
      }
      case 'spd': {
        title = `Speed · ${ac!.cs} · ${ac!.type} · now ${Math.round(ac!.ias)} kt`;
        grid = 'g4';
        rows.push('<div class="span">');
        opt('SU160/4', '160 to 4 NM', 'special'); opt('SU180/6', '180 to 6 NM', 'special'); opt('SMIN', `Min clean ${ac!.perf.vminClean}`, 'special'); opt('SRES', 'Own speed', 'special');
        rows.push('</div>');
        for (const o of this.speedOptions(ac!.cs)) {
          if (o.item.k !== 'spd' || o.item.until) continue;
          const v = o.item.spd;
          opt(`S${v}`, String(v), `${Math.abs(v - ac!.ias) < 6 ? 'current' : ''} ${ac!.spdAssigned === v ? 'cleared' : ''} ${o.warn ? 'below' : ''}`, Math.abs(v - ac!.ias) < 6 ? 'now' : '');
        }
        break;
      }
      case 'hdg': {
        const curMag = norm360(ac!.hdg - sim.pack.meta.magVar);
        title = `Heading · ${ac!.cs} · now ${p3(curMag)}`;
        grid = 'compass';
        const rw = sim.rwy, crsMag = norm360(rw.crs - sim.pack.meta.magVar);
        const ticks: string[] = [];
        for (let hd = 5; hd <= 360; hd += 5) {
          const a = (hd * Math.PI) / 180, maj = hd % 30 === 0, mid = hd % 10 === 0;
          const r1 = maj ? 39 : mid ? 42 : 44, r2 = 47;
          ticks.push(`<line x1="${50 + Math.sin(a) * r1}" y1="${50 - Math.cos(a) * r1}" x2="${50 + Math.sin(a) * r2}" y2="${50 - Math.cos(a) * r2}" class="${maj ? 'maj' : mid ? 'mid' : ''}"/>`);
          if (maj) ticks.push(`<text x="${50 + Math.sin(a) * 32}" y="${50 - Math.cos(a) * 32 + 2.2}">${p3(hd)}</text>`);
        }
        const mk = (hd: number, cls: string, lab: string) => { const a = (hd * Math.PI) / 180; return `<circle cx="${50 + Math.sin(a) * 47}" cy="${50 - Math.cos(a) * 47}" r="2.4" class="${cls}"/><text class="mk ${cls}" x="${50 + Math.sin(a) * 23}" y="${50 - Math.cos(a) * 23 + 1.6}">${lab}</text>`; };
        const ca = (curMag * Math.PI) / 180;
        rows.push(`<div class="rose" data-cur="${curMag}"><svg viewBox="0 0 100 100" aria-hidden="true">${ticks.join('')}${mk(crsMag, 'fin', 'FINAL')}${mk(norm360(crsMag + 180), 'dnw', 'DNWD')}<line class="now" x1="50" y1="50" x2="${50 + Math.sin(ca) * 46}" y2="${50 - Math.cos(ca) * 46}"/><line class="pick" x1="50" y1="50" x2="50" y2="50"/></svg><div class="rose-c"><b>${p3(curMag)}</b><small>present · drag or tap the ring</small></div></div>`);
        rows.push('<div class="span fine-h">');
        const c5 = roundHdg(curMag, 5);
        for (const dd of [-20, -10, -5, 5, 10, 20]) { const t = norm360(c5 + dd) || 360; opt(`${dd < 0 ? 'L' : 'R'}${Math.round(t)}`, `${dd < 0 ? 'L' : 'R'}${p3(t)}`, 'special', `${dd > 0 ? '+' : ''}${dd}°`); }
        opt(`H${Math.round(curMag / 5) * 5 || 360}`, 'Fly present heading', 'special');
        rows.push('</div>');
        break;
      }
      case 'dct': {
        title = `Direct · ${ac!.cs}`;
        const onRoute = ac!.route.map((l) => l.fix).filter((f) => sim.pack.fixes.has(f));
        if (onRoute.length) {
          rows.push('<div class="sub">On its route</div>');
          for (const f of onRoute.slice(0, 6)) { const p = sim.pack.fixes.get(f)!.p; opt(`DCT ${f}`, f, 'special', `${p3(norm360(bearing(ac!.p, p) - sim.pack.meta.magVar))}° ${dist(ac!.p, p).toFixed(0)} NM`); }
        }
        rows.push('<div class="sub">Nearby</div>');
        const key = this.keyFixes();
        const fx = this.scope.visibleFixes().filter((f) => (f.kind !== 'vfr' || ac!.rules === 'VFR') && !onRoute.includes(f.id) && (key.includes(f.id) || f.kind !== 'fix' || !/^[A-Z]{2}\d{3}$/.test(f.id)))
          .map((f) => ({ f, d: dist(ac!.p, f.p) })).filter((x) => x.d > 1.5 && x.d < 50).sort((a, b) => a.d - b.d).slice(0, 14);
        for (const { f, d } of fx) opt(`DCT ${f.id}`, f.id, '', `${p3(norm360(bearing(ac!.p, f.p) - sim.pack.meta.magVar))}° ${d.toFixed(0)} NM`);
        break;
      }
      case 'trans': {
        title = `Transition · runway ${sim.runway}`;
        for (const t of sim.transitionsFor(sim.runway)) opt(`T ${t.name}`, t.name, '', `${t.legs.map((l) => l.fix).slice(1).join(' ')}${t.atcDiscretion ? ' · ATC discretion' : ''}`);
        break;
      }
      case 'app': case 'more': {
        title = kind === 'app' ? `Approach · ${ac!.cs}` : `More · ${ac!.cs}`;
        if (kind === 'more') {
          grid = 'g3';
          rows.push('<div class="sub span">Common</div>');
          opt(`T ${(this.sim.transitionsFor(sim.runway)[0]?.name) ?? ''}`, 'TRANS…', 'special');
          opt(`ILS ${sim.runway}`, `ILS ${sim.runway}`, 'special'); opt(`HOLD ${this.stackFix()}`, `Hold ${this.stackFix()}`, 'special');
          for (const u of [sim.twr, sim.acc, sim.mil]) opt(`X${u.id}`, unitName(u.id, sim.units).text, 'special');
          rows.push('<div class="sub span">Other</div>');
        }
        for (const [id, r] of sim.pack.runways) {
          if (r.ils) opt(`ILS ${id}`, `ILS ${id}`, id === sim.runway ? 'special' : '', `CAT ${r.ils.cat}${sim.ilsOut.has(id) ? ' · OUT' : ''}${id === sim.runway ? ' · in use' : ''}`);
        }
        opt(`RNP ${sim.runway}`, `RNP ${sim.runway}`); opt(`VIS ${sim.runway}`, `Visual ${sim.runway}`);
        if (kind === 'more') {
          opt('RON', 'Own navigation');
          for (const f of this.otherHolds().slice(0, 3)) opt(`HOLD ${f}`, `Hold ${f}`);
          opt('SMIN', 'Min clean speed'); opt('SRES', 'Own speed'); opt('BRK', 'Cancel approach'); opt('ATIS', 'ATIS current');
          for (const u of Object.values(sim.units)) if (![sim.twr.id, sim.acc.id, sim.mil.id, sim.sup.id].includes(u.id)) opt(`X${u.id}`, u.label === u.id ? unitName(u.id, sim.units).text : `${u.id} · ${u.label}`);
          opt('SQ7000', 'Squawk 7000');
        }
        break;
      }
      case 'menu': {
        title = 'Session';
        opt('#pause', this.speed ? 'Pause' : 'Resume');
        if (!this.sc.tutorial) opt('#end', 'End session and debrief');
        opt('#help', 'Glossary: what does that mean?');
        opt('#hints', `Supervisor hints ${this.settings.hints ? 'on' : 'off'}`);
        opt('#ghost', `Future tracks ${this.scope.showGhosts ? 'on' : 'off'}`);
        opt('#ruler', `Final gap ruler ${this.scope.showRuler ? 'on' : 'off'}`);
        opt('#mva', `${this.settings.showMva ? 'Hide' : 'Show'} MVA overlay`);
        opt('#rbl', 'Clear measuring lines');
        opt('#proc', `${this.settings.showProcedures ? 'Hide' : 'Show'} procedures`);
        opt('#vec', `Speed vector ${this.settings.speedVectorMin} min (change)`);
        opt('#voice', `Pilot voices ${this.radio.enabled ? 'on' : 'off'}`);
        rows.push('<div class="sub">Scope</div>');
        opt('#bright', `Skin: ${SKIN_NAMES.find((n) => n.id === this.settings.brightness)?.label.toLowerCase() ?? 'night'} (change)`);
        opt('#rings', `Range rings every ${this.scope.opts.ringStep} NM (change)`);
        opt('#lfilt', `Level filter: ${LEVEL_FILTERS.find((f) => f.id === levelFilterId(this.settings.levelFilter))?.label.toLowerCase() ?? 'off'} (change)`);
        opt('#sweep', `Sweep line ${this.settings.sweep ? 'on' : 'off'}`);
        opt('#trail', `History dots: ${this.settings.trailLen} plots (change)`);
        opt('#smooth', `Smooth motion ${this.settings.smooth !== false ? 'on' : 'off'}`);
        if (this.cs && this.sim.find(this.cs)) opt('#replay', `Replay ${this.cs}'s last minute`);
        opt('#quit', 'Quit without debrief');
        break;
      }
    }
    pk.innerHTML = `<div class="pk-head"><b>${esc(title)}</b><button data-pick="#close" aria-label="Close">✕</button></div><div class="pk-body ${grid}">${rows.join('')}</div>`;
    pk.hidden = false;
    pk.dataset.kind = kind;
    this.placePicker(at);
    if (kind === 'hdg') this.bindRose(norm360(ac!.hdg - sim.pack.meta.magVar));
    const cur = pk.querySelector('.staged, .cleared, .current');
    if (cur && kind !== 'hdg') cur.scrollIntoView({ block: 'center' });
  }
  /** Put the picker where it does not hide the aircraft it is about. */
  private placePicker(at?: { x: number; y: number }) {
    const pk = this.els.picker;
    const wide = window.innerWidth >= 900;
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    pk.style.left = ''; pk.style.top = ''; pk.style.right = ''; pk.style.bottom = '';
    if (wide && ac) {
      const r = this.scope.canvas.getBoundingClientRect();
      const s = this.scope.toS(ac.p);
      const pw = pk.dataset.kind === 'hdg' ? 330 : 270;
      const ax = r.left + (at?.x ?? s.x), ay = r.top + (at?.y ?? s.y);
      const leftSide = r.left + s.x > r.left + r.width / 2;
      const x = leftSide ? Math.max(r.left + 8, r.left + s.x - pw - 70) : Math.min(r.right - pw - 60, r.left + s.x + 70);
      pk.style.left = `${x}px`;
      pk.style.top = `${Math.max(56, Math.min(ay - 160, window.innerHeight - 520))}px`;
      pk.classList.add('floating');
      void ax;
    } else {
      pk.classList.remove('floating');
      pk.style.bottom = `${this.els.bar.offsetHeight + 6}px`;
      if (ac) {
        // phone: the picker is a bottom sheet; keep the aircraft in the strip of scope still visible above it
        requestAnimationFrame(() => {
          const sr = this.scope.canvas.getBoundingClientRect(), pr = pk.getBoundingClientRect();
          const freeBottom = Math.min(sr.bottom, pr.top) - sr.top;
          const s = this.scope.toS(ac.p);
          if (s.y > freeBottom - 40 || s.y < 30 || s.x < 20 || s.x > sr.width - 20) {
            const wantY = Math.max(60, freeBottom * 0.45);
            this.scope.animateTo(this.scope.scale, { x: ac.p.x, y: ac.p.y + (wantY - this.scope.h / 2) / this.scope.scale });
          }
        });
      }
    }
  }
  /** Heading dial: press anywhere on the rose, drag to the heading, lift to choose (5° steps). */
  private bindRose(curMag: number) {
    const rose = this.els.picker.querySelector<HTMLElement>('.rose');
    if (!rose) return;
    const out = rose.querySelector('.rose-c b')!, sub = rose.querySelector('.rose-c small')!, pick = rose.querySelector<SVGLineElement>('line.pick')!;
    let hd = 0, down = false;
    const at = (e: PointerEvent) => {
      const r = rose.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      hd = Math.round(norm360((Math.atan2(dx, -dy) * 180) / Math.PI) / 5) * 5 % 360 || 360;
      const dir = norm360(hd - curMag) <= 180 ? 'R' : 'L';
      out.textContent = `${dir}${p3(hd)}`;
      sub.textContent = `turn ${dir === 'R' ? 'right' : 'left'} ${Math.round(Math.min(norm360(hd - curMag), 360 - norm360(hd - curMag)))}°`;
      const a = (hd * Math.PI) / 180;
      pick.setAttribute('x2', String(50 + Math.sin(a) * 46)); pick.setAttribute('y2', String(50 - Math.cos(a) * 46));
      rose.classList.add('live');
      return dir;
    };
    rose.addEventListener('pointerdown', (e) => { down = true; rose.setPointerCapture(e.pointerId); at(e); e.preventDefault(); });
    rose.addEventListener('pointermove', (e) => { if (down) at(e); });
    rose.addEventListener('pointerup', (e) => { if (!down) return; down = false; const dir = at(e); this.onPick(`${dir}${hd}`); });
  }
  private closePicker() { this.els.picker.hidden = true; }
  /** Pan so a selected aircraft is on screen. */
  keepVisible(cs: string) {
    const ac = this.sim.find(cs);
    if (!ac) return;
    const s = this.scope.toS(ac.p);
    if (s.x < 30 || s.y < 30 || s.x > this.scope.w - 30 || s.y > this.scope.h - 30) this.scope.focus(ac.p);
  }

  private onPick(key: string) {
    if (key.startsWith('#')) {
      this.closePicker();
      switch (key) {
        case '#pause': this.setSpeed(this.speed ? 0 : 1); break;
        case '#end': this.endSession(); break;
        case '#quit': this.destroy(); this.opts.onQuit(); break;
        case '#help': this.explain(); break;
        case '#hints': this.settings.hints = !this.settings.hints; this.hint = undefined; this.renderHint(); break;
        case '#ghost': this.scope.showGhosts = !this.scope.showGhosts; break;
        case '#ruler': this.scope.showRuler = !this.scope.showRuler; break;
        case '#mva': this.settings.showMva = !this.settings.showMva; break;
        case '#rbl': this.scope.clearRbls(); break;
        case '#proc': this.settings.showProcedures = !this.settings.showProcedures; break;
        case '#vec': this.settings.speedVectorMin = (this.settings.speedVectorMin % 3 + 1) as 1 | 2 | 3; break;
        case '#voice': this.radio.enabled = !this.radio.enabled; if (!this.radio.enabled) this.radio.cancel(); break;
        case '#bright': { const i = SKIN_NAMES.findIndex((n) => n.id === this.settings.brightness); this.setSkin(SKIN_NAMES[(i + 1) % SKIN_NAMES.length].id); break; }
        case '#rings': this.scope.cycleRingStep(); this.settings.ringStep = this.scope.opts.ringStep; this.onRange(this.rangeNm()); break;
        case '#lfilt': { const i = LEVEL_FILTERS.findIndex((f) => f.id === levelFilterId(this.settings.levelFilter)); this.settings.levelFilter = LEVEL_FILTERS[(i + 1) % LEVEL_FILTERS.length].band; this.applyScopeOpts(); break; }
        case '#sweep': this.settings.sweep = !this.settings.sweep; this.applyScopeOpts(); break;
        case '#trail': this.settings.trailLen = [0, 3, 5, 7][([0, 3, 5, 7].indexOf(this.settings.trailLen ?? 5) + 1) % 4]; this.applyScopeOpts(); break;
        case '#smooth': this.settings.smooth = this.settings.smooth === false; this.applyScopeOpts(); break;
        case '#replay': if (this.cs) { this.scope.startReplay(this.cs); this.toast(`${this.cs}: the last minute, replayed in four seconds.`, 2500); } break;
      }
      if (/^#(hints|mva|proc|vec|bright|rings|lfilt|sweep|trail|smooth)$/.test(key)) saveSettings(this.settings);
      return;
    }
    let it: Item | undefined;
    let m: RegExpMatchArray | null;
    if ((m = key.match(/^F(\d+)$/))) it = { k: 'lvl', lvl: { fl: Number(m[1]) } };
    else if ((m = key.match(/^A(\d+)$/))) it = { k: 'lvl', lvl: { ft: Number(m[1]) } };
    else if ((m = key.match(/^SU(\d+)\/(\d+)$/))) it = { k: 'spd', spd: Number(m[1]), until: Number(m[2]) };
    else if ((m = key.match(/^S(\d+)$/))) it = { k: 'spd', spd: Number(m[1]) };
    else if (key === 'SMIN') it = { k: 'spdmin' };
    else if (key === 'SRES') it = { k: 'spdres' };
    else if ((m = key.match(/^([HLR])(\d+)$/))) it = { k: 'hdg', hdg: Number(m[2]) % 360 || 360, dir: m[1] === 'H' ? undefined : (m[1] as 'L' | 'R') };
    else if ((m = key.match(/^DCT (\w+)$/))) it = { k: 'dct', fix: m[1] };
    else if (key === 'T ' || key.startsWith('T ')) { if (key === 'T ' || key.endsWith('…')) { this.openPicker('trans'); return; } it = { k: 'trans', name: key.slice(2) }; }
    else if ((m = key.match(/^(ILS|RNP|VIS) (\w+)$/))) it = { k: 'app', app: m[1] as any, rwy: m[2] };
    else if (key === 'RON') it = { k: 'ron' };
    else if (key === 'BRK') it = { k: 'brk' };
    else if (key === 'ATIS') it = { k: 'atis' };
    else if ((m = key.match(/^HOLD (\w+)$/))) it = { k: 'hold', fix: m[1] };
    else if ((m = key.match(/^X([A-Z]+)$/)) && this.sim.units[m[1]]) it = { k: 'xfr', unit: m[1] };
    else if ((m = key.match(/^SQ(\d{4})$/))) it = { k: 'sqk', code: m[1] };
    if (key.startsWith('T ') && this.els.picker.dataset.kind === 'more') { this.openPicker('trans'); return; }
    if (it) this.addItem(it);
  }

  // ---------------- loop ----------------
  private loop = (now: number) => {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.speed > 0 && !this.sim.ended) {
      this.acc += dt * this.speed;
      while (this.acc >= 1) { this.acc -= 1; this.sim.step(); }
    }
    this.scope.draw(now);
    this.halo.update();
    this.panelTimer += dt;
    if (this.panelTimer > 0.5) {
      this.panelTimer = 0;
      this.renderIcom(); this.renderPanels(); this.renderBarLive(); this.checkAlerts(); this.renderLive(); this.checkLandings();
      this.attention.update(); this.readback.update(); this.staging.update();
      this.hintTimer += 1;
      if (this.hintTimer >= 4) { this.hintTimer = 0; this.updateHint(); }
    }
    if (this.sim.ended && !this.endedShown && !this.sc.tutorial) { this.endedShown = true; this.endSession(); return; }
    this.raf = requestAnimationFrame(this.loop);
  };
  setSpeed(s: number) {
    this.speed = s;
    if (s !== 1) this.radio.cancel();
    this.els.speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.s) === s));
  }
  /** Fast forward drops back to normal speed when something needs you. */
  private interrupt() { if (this.speed >= 8) this.setSpeed(1); }
  endSession() {
    this.sim.finish();
    this.endedShown = true;
    cancelAnimationFrame(this.raf);
    this.radio.cancel();
    const r = assess(this.sim);
    if (this.opts.replay) r.title += ' (replay)';
    this.destroy();
    this.opts.onEnd(r, this.sim);
  }
  private checkAlerts() {
    const now = new Set(this.sim.alerts().map((a) => a.a + a.b));
    for (const k of now) if (!this.knownAlerts.has(k)) { this.radio.alert(); this.interrupt(); break; }
    this.knownAlerts = now;
  }
  private checkLandings() {
    const L = this.sim.landings;
    while (this.seenLandings < L.length) {
      const l = L[this.seenLandings++];
      const sp = [...this.sim.spacing].reverse().find((s) => s.follower === l.cs);
      let txt = `${l.cs} landed`, cls = 'ok';
      if (sp) {
        const over = sp.gap - sp.min;
        txt += ` · ${sp.gap.toFixed(1)} NM behind ${sp.leader} (min ${sp.min})`;
        if (over < 0) cls = 'bad';
        else if (over <= 0.7) { cls = 'great'; this.radio.chime(); txt += ' · tight'; }
        else if (over > 2) cls = 'wide';
      }
      if (l.goArounds) txt += ` · ${l.goArounds} go-around${l.goArounds > 1 ? 's' : ''}`;
      this.feed(txt, cls);
    }
  }
  private feed(text: string, cls = '') {
    const f = h('div', `feed-item ${cls}`, `<span class="mono">▼</span> ${esc(text)}`);
    this.els.feed.prepend(f);
    while (this.els.feed.children.length > 3) this.els.feed.lastChild!.remove();
    window.setTimeout(() => f.classList.add('out'), 4200);
    window.setTimeout(() => f.remove(), 4800);
  }

  // ---------------- comms ----------------
  private onTx(tx: Tx) {
    this.appendComms(tx);
    this.readback?.onTx(tx);
    if (tx.channel !== 'icom') {
      this.els.last.innerHTML = `<b>${esc(tx.from === 'ATC' ? 'YOU' : tx.cs)}</b> ${esc(tx.text)}`;
      const led = this.els.rxled; const cls = tx.from === 'ATC' ? 'tx' : 'rx';
      led.classList.add(cls); this.els.vu.classList.add('on');
      window.setTimeout(() => { led.classList.remove(cls); this.els.vu.classList.remove('on'); }, Math.max(500, ((tx.t1 - tx.t0) * 1000) / Math.max(1, this.speed)));
    }
    const icom = tx.channel === 'icom';
    const who = tx.from === 'ATC' ? 'YOU' : tx.from === 'SYS' ? 'SYS' : icom ? tx.from : tx.cs;
    this.els.ticker.innerHTML = `<b>${esc(who)}</b> ${esc(tx.text)}`;
    this.els.ticker.className = `ticker mono ${tx.from.toLowerCase()} ${icom ? 'ic' : ''} ${tx.emergency ? 'emer' : ''}`;
    if (tx.blocked) { this.radio.blocked(); }
    else if (icom) {
      if (tx.from !== 'ATC') {
        this.radio.intercom(); this.interrupt();
        if (this.speed === 1 && this.settings.speakIcom !== false) this.radio.speak(tx.speech || tx.text, tx.from, { kind: 'icom' });
      }
    }
    else if (this.speed === 1) {
      if (tx.from === 'PILOT') this.radio.speak(tx.speech, tx.cs, { kind: 'rt', signal: this.signalOf(tx.cs) });
      else if (tx.from === 'ATC' && this.settings.speakAtc) this.radio.speak(tx.speech, 'ATC', { kind: 'atc' });
    }
    if (tx.emergency) this.interrupt();
    if (tx.from === 'SYS') { this.toast(tx.text); this.interrupt(); }
    if (!icom) {
      const light = this.els.tx;
      light.classList.add('busy');
      window.setTimeout(() => light.classList.remove('busy'), Math.max(600, ((tx.t1 - tx.t0) * 1000) / Math.max(1, this.speed)));
    }
  }
  /** Received signal strength, 0..1: falls off with distance and below the radio horizon. */
  private signalOf(cs: string): number {
    const a = this.sim.find(cs);
    if (!a) return 0.8;
    const d = Math.hypot(a.p.x, a.p.y);
    const horizon = 1.23 * (Math.sqrt(Math.max(a.alt, 100)) + Math.sqrt(150)); // NM, aircraft and antenna heights in ft
    const s = 1 - d / 75 - Math.max(0, d / horizon - 0.7) * 1.2;
    return Math.max(0.1, Math.min(1, s));
  }
  private appendComms(tx: Tx) {
    const c = this.els.comms;
    const icom = tx.channel === 'icom';
    const row = h('div', `msg ${tx.from.toLowerCase()} ${icom ? 'ic' : ''} ${tx.emergency ? 'emer' : ''}`);
    const who = tx.from === 'ATC' ? (icom ? 'APP ⇄' : 'APP') : tx.from === 'SYS' ? 'SYS' : icom ? `${tx.from} ⇄` : tx.cs;
    row.innerHTML = `<span class="t">${this.sim.utc(tx.t0).slice(0, 5)}</span><span class="w">${esc(who)}</span><span class="mt">${esc(tx.text)}</span>`;
    if (tx.cs && this.sim.find(tx.cs)) { row.dataset.cs = tx.cs; row.classList.add('strip-link'); row.addEventListener('click', () => this.select(tx.cs, true)); }
    c.appendChild(row);
    while (c.children.length > 160) c.firstChild!.remove();
    if (this.commsStick) c.scrollTop = c.scrollHeight;
  }

  private toastTimer = 0;
  toast(text: string, ms = 3500) {
    const t = this.els.toast;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), ms);
  }
  /** Glossary sheet. With a term: that term; without: the searchable list. */
  explain(term?: string) {
    const pk = this.els.picker;
    const GLOSSARY = this.gloss;
    const terms = Object.keys(GLOSSARY).sort();
    const body = term && GLOSSARY[term]
      ? `<div class="gl-one"><b>${esc(term)}</b><p>${esc(GLOSSARY[term])}</p></div>`
      : `<input class="gl-q mono" placeholder="Search terms" aria-label="Search glossary"><div class="gl-list">${terms.map((k) => `<div class="gl-row" data-k="${esc(k.toLowerCase())} ${esc(GLOSSARY[k].toLowerCase())}"><b>${esc(k)}</b><span>${esc(GLOSSARY[k])}</span></div>`).join('')}</div>`;
    pk.innerHTML = `<div class="pk-head"><b>Glossary</b><button data-pick="#close" aria-label="Close">✕</button></div><div class="pk-body gloss">${body}</div>`;
    pk.hidden = false;
    pk.dataset.kind = 'gloss';
    pk.classList.remove('floating');
    pk.style.left = ''; pk.style.top = ''; pk.style.bottom = `${this.els.bar.offsetHeight + 6}px`;
    const q = pk.querySelector<HTMLInputElement>('.gl-q');
    q?.addEventListener('input', () => { const v = q.value.toLowerCase(); pk.querySelectorAll<HTMLElement>('.gl-row').forEach((r) => (r.hidden = !!v && !r.dataset.k!.includes(v))); });
  }

  // ---------------- supervisor hints ----------------
  private updateHint() {
    if (!(this.coachHints || (this.settings.hints && !this.sc.tutorial))) { if (this.hint) { this.hint = undefined; this.renderHint(); } return; }
    const list = hints(this.sim).filter((x) => !this.hintMuted.has(x.key));
    const top = list[0];
    if (top?.key !== this.hint?.key || top?.text !== this.hint?.text) {
      if (top && top.key !== this.hint?.key && top.urgency >= 45) this.interrupt();
      this.hint = top; this.renderHint();
    }
  }
  private renderHint() {
    const el = this.els.hint;
    const x = this.hint;
    el.hidden = !x;
    if (!x) return;
    el.className = `hint ${x.key.startsWith('stca') ? 'urgent' : ''}`;
    el.innerHTML = `<span class="hint-who">SUP</span><span class="hint-t">${esc(x.text)}</span>${x.term && this.gloss[x.term] ? `<button data-gloss="${esc(x.term)}" class="hint-why">why?</button>` : ''}${x.cs ? `<button data-a="hint-go" class="hint-go">${esc(x.cs)}</button>` : ''}<button data-a="hint-x" class="hint-x" aria-label="Dismiss">✕</button>`;
  }

  // ---------------- intercom: release requests and military coordination ----------------
  private icomSig = '';
  private renderIcom() {
    const sim = this.sim;
    const rel = sim.releases.filter((r) => r.state === 'pending' || r.state === 'held' || (r.state === 'released' && sim.t - (r.tReleased ?? sim.t) < 90));
    const mil = sim.aircraft.filter((a) => a.request?.kind === 'milxing' && a.state === 'inbound');
    for (const r of rel) if (r.state === 'pending' && !this.seenRel.has(r.cs)) { this.seenRel.add(r.cs); }
    const sig = rel.map((r) => `${r.cs}:${r.state}:${r.after ?? ''}:${sim.departureGap(r.cs).after ?? ''}:${r.expectAt ?? ''}`).join('|') + '#' + mil.map((m) => m.cs).join('|') + '#' + this.icomArrival();
    if (sig === this.icomSig) { this.tickTimers(); return; }
    this.icomSig = sig;
    const card = (r: ReleaseReq) => {
      const wait = sim.t - r.t;
      const gap = sim.departureGap(r.cs);
      const after = gap.after ?? this.icomArrival();
      const head = `<div class="ic-h"><span class="ic-from">TWR ⇄</span><b class="mono">${esc(r.cs)}</b><span class="mono dim">${esc(r.type)} · ${esc(r.sid)} · ${esc(r.rwy)}</span><span class="ic-t mono ${wait > 120 ? 'warn' : ''}" data-t0="${r.t}">${mmss(wait)}</span></div>`;
      if (r.state === 'released') return `<div class="ic-card done">${head}<div class="ic-s">Released${r.after ? ` after ${esc(r.after)}` : ''}. Tower will launch when the runway is free.</div></div>`;
      if (r.state === 'held') return `<div class="ic-card held">${head}<div class="ic-s">Holding on the ground${r.expectAt ? `, expect ${sim.utc(r.expectAt).slice(0, 5)}Z` : ''}.</div><div class="ic-b"><button data-rel="${esc(r.cs)}" data-v="rel" class="ok">Release</button>${after ? `<button data-rel="${esc(r.cs)}" data-v="after:${esc(after)}">After ${esc(after)}</button>` : ''}</div></div>`;
      const adv = releaseAdvice(sim, r.cs);
      return `<div class="ic-card">${head}<div class="ic-s">Request release. <span class="${adv.ok ? 'ok' : 'warn'}" data-adv="${esc(r.cs)}">${esc(adv.why)}</span></div><div class="ic-b"><button data-rel="${esc(r.cs)}" data-v="rel" class="ok">Release</button>${after ? `<button data-rel="${esc(r.cs)}" data-v="after:${esc(after)}">After ${esc(after)}</button>` : ''}<button data-rel="${esc(r.cs)}" data-v="hold">Hold 3 min</button></div></div>`;
    };
    const milCard = (a: Aircraft) => `<div class="ic-card mil"><div class="ic-h"><span class="ic-from">${esc(a.request!.unit ? sim.units[a.request!.unit]?.id ?? sim.mil.id : sim.mil.id)} ⇄</span><b class="mono">${esc(a.cs)}${a.formation > 1 ? ` ×${a.formation}` : ''}</b><span class="mono dim">${esc(a.type)}</span></div><div class="ic-s">${esc(a.request!.text)}</div><div class="ic-b"><button data-rel="${esc(a.cs)}" data-v="milok" class="ok">Approve</button><button data-rel="${esc(a.cs)}" data-v="milno">Unable</button></div></div>`;
    this.icomHtml = rel.map(card).join('') + mil.map(milCard).join('');
    this.els.icom.innerHTML = this.icomHtml;
  }
  /** The arrival a departure would most naturally go after: the next one on or joining final. */
  private icomArrival(): string {
    const arr = this.sim.aircraft.filter((a) => a.kind === 'arr' && !a.remove && a.app && this.sim.dthr(a) < 14).sort((a, b) => this.sim.dthr(a) - this.sim.dthr(b));
    return arr[0]?.cs ?? '';
  }
  private answerIcom(cs: string, v: string) {
    let items: Item[];
    if (v === 'rel') items = [{ k: 'rel' }];
    else if (v.startsWith('after:')) items = [{ k: 'rel', after: v.slice(6) }];
    else if (v === 'hold') items = [{ k: 'relhold', mins: 3 }];
    else if (v === 'milok' || v === 'bruok') items = [{ k: 'appr' }];
    else items = [{ k: 'deny' }];
    const veto = this.onBeforeSend?.({ cs, items }); // tutorial hook
    if (veto) { this.toast(veto); return; }
    const r = this.sim.issue({ cs, items });
    if (!r.ok) this.toast(r.warnings.join('; '));
    else for (const f of this.onSent) f({ cs, items });
    this.icomSig = ''; this.coordSig = '';
    this.renderIcom(); this.renderPanels();
  }

  // ---------------- live stats, emergencies, objectives ----------------
  private renderLive() {
    const sim = this.sim;
    const st = liveStats(sim), sq = seqChain(sim);
    const narrow = window.innerWidth < 600;
    this.els.stats.innerHTML = narrow
      ? `<span title="Landed">▼${st.landed}</span>${sq.current >= 2 ? `<span class="seq">×${sq.current}</span>` : ''}`
      : `<span title="Landed">▼ ${st.landed}</span><span class="seq ${sq.current >= 2 ? 'on' : ''}" title="Tight landings in a row (best ${sq.best})">SEQ ×${sq.current}</span><span class="${st.delayMin > 10 ? 'warn' : ''}" title="Delay you have added: holding and extra miles">+${Math.round(st.delayMin)} min</span>${st.holding ? `<span class="warn" title="Aircraft holding">HLD ${st.holding}</span>` : ''}`;
    // emergencies and objectives
    const emer = sim.aircraft.filter((a) => a.emergency && !a.remove);
    const objs = (sim.sc.objectives ?? []).filter((o) => !sim.landings.some((l) => l.cs === o.cs) && sim.t < o.byT + 600);
    const cards: string[] = [];
    for (const a of emer) {
      const ob = objs.find((o) => o.cs === a.cs);
      const left = ob ? ob.byT - sim.t : undefined;
      const what = a.emergencyText ?? (a.emergency === 'engine' ? 'Engine failure' : a.emergency === 'smoke' ? 'Smoke' : a.emergency === 'radio' ? 'Radio failure 7600' : String(a.emergency));
      cards.push(`<button class="em" data-a="emer-go" data-cs="${esc(a.cs)}"><span class="em-k">${a.emergency === 'radio' ? 'NORDO' : 'MAYDAY'}</span><b class="mono">${esc(a.cs)}</b><span class="em-w">${esc(what)}</span><span class="em-n mono">${remainNm(sim, a).toFixed(0)} NM · ${Math.round(a.alt / 100) * 100} ft</span>${left !== undefined ? `<span class="em-t mono ${left < 120 ? 'bad' : ''}">${mmss(left)}</span>` : ''}</button>`);
    }
    for (const o of objs) if (!emer.some((a) => a.cs === o.cs) && sim.find(o.cs)) cards.push(`<button class="em obj" data-a="emer-go" data-cs="${esc(o.cs)}"><span class="em-k">TASK</span><span>${esc(o.text)}</span><span class="em-t mono">${mmss(o.byT - sim.t)}</span></button>`);
    this.els.emer.hidden = !cards.length;
    if (cards.length) this.els.emer.innerHTML = cards.join('');
  }

  // ---------------- bar ----------------
  private sends() { return this.root.querySelectorAll<HTMLButtonElement>('[data-a="send"]'); }
  private renderBar() {
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    const { who, chips, phrase, send, req, sugg, mid } = this.els;
    if (this.cs && !ac) { this.cs = undefined; this.scope.selected = undefined; this.items = []; }
    this.els.appBtn.textContent = `ILS ${this.sim.runway}`;
    this.barSig = this.sigOf(ac);
    if (!ac) {
      const c = this.waiting();
      const touch = touchFirst();
      who.innerHTML = `<div class="cs mono dim">— — —</div><div class="meta">${c.length ? `${c.length} waiting · tap ☎${touch ? '' : ' or press Tab'}` : 'Tap an aircraft, its label, its strip or a row above'}</div>`;
      req.innerHTML = '';
      sugg.innerHTML = c.length ? c.slice(0, 4).map((a) => `<button class="sg caller" data-cs-pick="${esc(a.cs)}"><b class="mono">${esc(a.cs)}</b><small>${Math.round(this.sim.t - a.awaitingSince!)} s</small></button>`).join('') : '';
      sugg.querySelectorAll<HTMLElement>('[data-cs-pick]').forEach((b) => b.addEventListener('click', () => { this.select(b.dataset.csPick, true); this.keepVisible(b.dataset.csPick!); }));
      this.suggestions = [];
      const typedPh = this.typed?.cs && this.typed.items.length ? this.sim.previewPhrase({ cs: this.typed.cs, items: sortItems(this.typed.items) })?.text : undefined;
      chips.innerHTML = this.typedChips();
      phrase.innerHTML = typedPh ? esc(typedPh) : esc(this.voiceText);
      mid.classList.toggle('empty', !chips.innerHTML && !phrase.textContent);
      this.sends().forEach((b) => (b.disabled = true));
      return;
    }
    const proc = ac.proc ?? (ac.rules === 'VFR' ? 'VFR' : ac.kind.toUpperCase());
    who.innerHTML = `<div class="cs mono">${esc(ac.cs)}</div><div class="meta"><span class="rc">${ac.recat ?? ac.perf.recat}</span> ${esc(ac.type)} · ${esc(proc)} · <span data-e2="state">${this.stateText(ac)}</span></div>`;
    const calling = ac.awaitingSince !== undefined && this.sim.t >= ac.awaitingSince && ac.state === 'assumed';
    req.innerHTML = ac.request && ac.state === 'assumed' ? `<div class="req-text"><b>REQ</b> ${esc(ac.request.text)}</div>` : ac.wrong ? `<div class="req-text bad"><b>READBACK</b> wrong, check it</div>` : '';
    if (calling && !ac.request) req.innerHTML += `<button data-a="roger" class="ok" title="Answer without a clearance">Roger</button><button data-a="stby" title="They will call again">Standby</button><button data-a="sayagain" title="Ask the pilot to repeat">Say again</button>`;
    // suggestions
    this.suggestions = this.items.length || this.typed ? [] : suggest(this.sim, ac);
    this.suggestSig = this.suggestions.map((s) => s.label).join('|');
    sugg.innerHTML = this.suggestions.map((s, i) => `<button class="sg ${s.primary ? 'lead' : ''} ${s.warn?.length ? 'warned' : ''}" data-sg="${i}" title="${esc(s.why + (s.warn?.length ? ` · ⚠ ${s.warn.join('; ')}` : ''))}"><span class="mono">${esc(s.label)}</span>${s.primary ? `<small>${esc(s.why)}</small>` : ''}</button>`).join('');
    // staged clearance (or typed preview)
    const items = this.typed && this.typed.items.length ? this.typed.items : this.items;
    chips.innerHTML = this.typed ? this.typedChips() : this.items.map((it, i) => `<button class="chip mono" data-a="chip" data-i="${i}" title="Remove">${esc(itemChip(it))} <i>×</i></button>`).join('');
    const isRel = items.some((i) => i.k === 'rel' || i.k === 'relhold');
    const tcs = this.typed?.cs ?? ac.cs;
    const warn = items.length && !isRel ? this.sim.validate({ cs: tcs, items }) : [];
    const ph = items.length ? this.sim.previewPhrase({ cs: tcs, items: sortItems(items) })?.text ?? '' : this.voiceText;
    phrase.innerHTML = `${esc(ph)}${warn.length ? `<span class="warn">⚠ ${esc(warn.join(' · '))}</span>` : ''}${this.typed?.errors.length ? `<span class="warn">${esc(this.typed.errors.join(' · '))}</span>` : ''}`;
    mid.classList.toggle('empty', !items.length && !this.voiceText && !this.typed);
    const blocked = this.settings.trainingWheels && warn.length > 0;
    this.sends().forEach((b) => { b.disabled = !this.items.length || blocked; b.classList.toggle('warned', warn.length > 0); });
    (this.els.queueBtn as HTMLButtonElement).disabled = !this.items.length;
    this.halo?.update();
  }
  private typedChips() {
    if (!this.typed) return '';
    const t = this.typed;
    return `${t.cs ? `<span class="chip cs mono">${esc(t.cs)}</span>` : ''}${t.items.map((it) => `<span class="chip mono typed">${esc(itemChip(it))}</span>`).join('')}${t.armed ? '<span class="chip warn mono">⏎ again to send</span>' : t.items.length ? '<span class="chip ghost mono">⏎ send</span>' : ''}`;
  }
  private sigOf(ac?: Aircraft) {
    if (!ac) return `none:${this.waiting().map((a) => a.cs).join(',')}`;
    return [ac.cs, ac.state, ac.mode, ac.request?.t ?? '', ac.awaitingSince ?? '', ac.wrong?.t ?? '', ac.app?.locCap ?? '', ac.atisOld ?? '', this.items.length].join(':');
  }
  private renderBarLive() {
    const ac = this.cs ? this.sim.find(this.cs) : undefined;
    if (this.cs && !ac) { this.renderBar(); return; }
    // rebuild when what we offer could have changed; otherwise just tick the state text
    const sig = this.sigOf(ac);
    const sg = ac && !this.items.length && !this.typed ? suggest(this.sim, ac).map((s) => s.label).join('|') : this.suggestSig;
    if (sig !== this.barSig || sg !== this.suggestSig) { this.renderBar(); return; }
    const st = this.els.who.querySelector('[data-e2="state"]');
    if (ac && st) st.textContent = this.stateText(ac);
    if (!ac) {
      const c = this.waiting();
      this.els.sugg.querySelectorAll<HTMLElement>('[data-cs-pick]').forEach((b) => { const a = c.find((x) => x.cs === b.dataset.csPick); const s = b.querySelector('small'); if (a && s) s.textContent = `${Math.round(this.sim.t - a.awaitingSince!)} s`; });
    }
  }
  private stateText(ac: Aircraft) {
    if (ac.awaitingSince !== undefined && this.sim.t >= ac.awaitingSince) return `calling ${Math.round(this.sim.t - ac.awaitingSince)} s`;
    if (ac.state === 'inbound') return 'handoff offered';
    if (ac.state === 'transferred') return `with ${ac.xfrUnit === this.sim.twr.id ? 'Tower' : (this.sim.units[ac.xfrUnit ?? '']?.say ?? ac.xfrUnit)}`;
    if (ac.radioFail) return 'NORDO 7600';
    const now = levelText(this.sim.levelFor(Math.round(ac.alt / 100) * 100));
    const to = levelText(ac.cflSys ?? ac.cleared);
    const d = ac.kind === 'arr' ? ` · ${remainNm(this.sim, ac).toFixed(0)} NM to go` : '';
    return `${now}${now === to ? '' : ` → ${to}`} · ${Math.round(ac.ias)} kt${d}`;
  }

  // ---------------- panels ----------------
  private renderPanels() {
    const sim = this.sim;
    this.els.clock.textContent = `${sim.utc()}Z`;
    this.els.atis.textContent = `ATIS ${sim.atis}`; this.els.atis.title = sim.atisText();
    this.els.rwy.textContent = `RWY ${sim.runway}`;
    this.els.lvp.hidden = !sim.lvp;
    this.els.tqnh.textContent = `QNH ${sim.qnh}`; this.els.ttl.textContent = `TL FL${String(sim.tl).padStart(3, '0')}`;
    this.els.twind.textContent = `WIND ${String(Math.round(((sim.weather.windDir - sim.pack.meta.magVar + 360) % 360) / 10) * 10).padStart(3, '0')}/${sim.weather.windKt}`;
    const tsa = [...sim.tsaOn][0] ?? [...sim.tsaPending.keys()][0]; this.els.ttsa.hidden = !tsa; if (tsa) { this.els.ttsa.textContent = `${tsa} ${sim.tsaOn.has(tsa) ? 'ACTIVE' : 'SOON'}`; this.els.ttsa.title = `${sim.areasName} ${tsa}`; }
    const callers = this.waiting();
    const n = this.attention?.rows.length ?? callers.length;
    this.els.callers.textContent = window.innerWidth < 600 ? `☎ ${n}` : `NEXT ${n || ''}`.trim();
    this.els.callers.classList.toggle('hot', n > 0);
    this.els.callers.classList.toggle('urgent', callers.some((a) => sim.t - a.awaitingSince! > 15 || a.emergency) || (this.attention?.rows[0]?.urgency ?? 0) >= 90);
    if (this.root.classList.contains('drawer-open') || window.innerWidth >= 900) {
      this.renderCoord();
      this.renderInfo();
      this.renderAman();
      this.renderStrips();
    }
  }
  private renderInfo() {
    const sim = this.sim, w = sim.weather, rw = sim.rwy;
    const c = windComponents(rw.crs, w.windDir, Math.max(w.windKt, w.gustKt ?? 0));
    const remain = Math.max(0, sim.durationS - sim.t);
    const tsas = [...sim.tsaOn];
    const arr = sim.aircraft.filter((a) => a.kind === 'arr').length;
    const wd = (w.windDir - sim.pack.meta.magVar + 360) % 360;
    this.els.info.innerHTML = `
      <div class="metar mono">${esc(w.raw)}</div>
      <div class="info-grid">
        <div class="dial"><svg viewBox="-30 -30 60 60" aria-label="Wind ${Math.round(wd)} degrees ${w.windKt} knots"><circle r="26" class="ring"/><line x1="0" y1="-26" x2="0" y2="26" class="rwy" transform="rotate(${rw.crs})"/><g transform="rotate(${w.windDir})"><line x1="0" y1="-26" x2="0" y2="-8" class="arrow"/><path d="M0 -6 L-4 -13 L4 -13 Z" class="arrowhead"/></g></svg></div>
        <dl>
          <dt>Wind</dt><dd class="mono">${String(Math.round(wd / 10) * 10).padStart(3, '0')}/${w.windKt}${w.gustKt ? 'G' + w.gustKt : ''}</dd>
          <dt>${c.head >= 0 ? 'Head' : 'Tail'}/X</dt><dd class="mono ${c.head < -5 || Math.abs(c.cross) > 15 ? 'bad' : ''}">${Math.abs(c.head)}/${Math.abs(c.cross)}</dd>
          <dt>QNH · TL</dt><dd class="mono">${w.qnh} · FL${String(sim.tl).padStart(3, '0')}</dd>
          <dt>Runway</dt><dd class="mono">${sim.runway}${sim.ilsOut.has(sim.runway) ? ' <span class="bad">ILS U/S</span>' : ''}</dd>
          ${sim.lvp ? `<dt>LVP</dt><dd class="bad">in force</dd>` : ''}
          ${tsas.length ? `<dt>${esc(sim.areasName)}</dt><dd class="warn">${esc(tsas.join(', '))} active</dd>` : ''}
          ${sim.flows.length ? `<dt>Flow</dt><dd class="warn">${sim.flows.map((f) => `${f.exitFix} ${f.mit} NM MIT`).join(', ')}</dd>` : ''}
          <dt>Traffic</dt><dd class="mono">${sim.landings.length} landed · ${arr} inbound · ${sim.releases.filter((r) => r.state === 'pending').length} to release</dd>
          <dt>Left</dt><dd class="mono">${Math.floor(remain / 60)}:${String(Math.floor(remain % 60)).padStart(2, '0')}</dd>
        </dl>
      </div>
      ${this.sc.briefing ? `<div class="brief-mini">${esc(this.sc.briefing)}</div>` : ''}`;
  }
  private renderAman() {
    const sim = this.sim;
    this.els.amanRwy.textContent = sim.runway;
    const order = landingOrder(sim);
    const span = 30;
    const items: string[] = [];
    for (let m = 0; m <= span; m += 5) items.push(`<div class="tick" style="top:${(m / span) * 100}%"><span>${sim.utc(sim.t + m * 60).slice(0, 5)}</span></div>`);
    const hpx = Math.max(80, this.els.aman.clientHeight || 400);
    let prevEta = -1e9, prev: Aircraft | undefined, lastTop = -100;
    for (const x of order) {
      let eta = x.etaS / 60;
      let adv = 0;
      if (prev) {
        const need = (Math.max(sim.wakeMin(prev, x.ac, sim.finalMinNm), sim.lvp ? 5 : sim.finalMinNm) / 150) * 60 + 0.15;
        adv = Math.max(0, prevEta + need - eta);
        eta = Math.max(eta, prevEta + need);
      }
      prev = x.ac; prevEta = eta;
      if (eta > span) continue;
      const topPx = Math.max((eta / span) * hpx, lastTop + 26);
      lastTop = topPx;
      const st = x.ac.state === 'transferred' ? 'xfr' : x.ac.state === 'inbound' ? 'inb' : x.ac.mode === 'HOLD' ? 'hold' : '';
      const tail = x.ac.state === 'transferred' ? 'TWR' : x.ac.app?.locCap ? 'LOC' : adv >= 0.5 ? `<em>−${adv.toFixed(adv >= 2 ? 0 : 1)}</em>` : sim.utc(sim.t + eta * 60).slice(0, 5).replace(':', '');
      items.push(`<button class="aman-item strip ${x.ac.cs === this.cs ? 'sel' : ''} ${x.ac.emergency ? 'emer' : ''} ${st} ${x.sequenced ? 'seqd' : ''}" data-cs="${x.ac.cs}" style="top:${(topPx / hpx) * 100}%"><b>${x.ac.cs}</b><i>${x.ac.recat ?? x.ac.perf.recat}</i><span>${tail}</span></button>`);
    }
    for (const r of sim.releases.filter((r) => r.state === 'pending' || r.state === 'released')) {
      const g = sim.departureGap(r.cs);
      if (!g.after) continue;
      const a = order.findIndex((x) => x.ac.cs === g.after);
      if (a < 0) continue;
      items.push(`<div class="aman-gap" style="top:${Math.min(96, ((order[a].etaS / 60 + 0.8) / span) * 100)}%">${esc(r.cs)} ↑ ${g.nm !== null ? g.nm.toFixed(1) + ' NM' : ''}</div>`);
    }
    this.els.aman.innerHTML = `<div class="aman-line"></div>${items.join('')}`;
  }

  // ---------------- strip bay ----------------
  private stripHtml(a: Aircraft, extra = '') {
    const sim = this.sim;
    const hdg = a.hdgSys !== undefined && a.mode !== 'LOC' ? `H${p3(norm360(a.hdgSys - sim.pack.meta.magVar))}` : a.mode === 'HOLD' ? `HLD ${a.hold?.fix ?? ''}` : a.mode === 'LOC' ? 'LOC' : a.route[0] ? `→${a.route[0].fix}` : '';
    const spd = a.spdAssigned ? `S${a.spdAssigned}` : a.spdMin ? 'SMIN' : '';
    const app = a.app ? (a.app.locCap ? `${a.app.type} ${a.app.rwy.id} D${sim.dthr(a).toFixed(1)}` : `${a.app.type} ${a.app.rwy.id}`) : a.kind === 'dep' ? `→ ${a.exitFix ?? ''}` : a.rules === 'VFR' ? 'VFR' : '';
    const waiting = a.awaitingSince !== undefined && sim.t >= a.awaitingSince;
    const cfl = levelText(a.cflSys ?? a.cleared).replace(' ft', '').replace(',', '');
    const sflOff = a.cflSys && Math.abs(sim.ftOf(a.cleared) - sim.ftOf(a.cflSys)) > 60;
    const efc = a.mode === 'HOLD' && a.efc !== undefined ? ` · EAT ${sim.utc(a.efc).slice(0, 5).replace(':', '')}` : '';
    return `<button class="strip ${a.kind} ${a.cs === this.cs ? 'sel' : ''} ${a.state} ${a.emergency ? 'emer' : ''} ${waiting ? 'calling' : ''}" data-cs="${a.cs}" ${extra}>
        <span class="bay mono">${a.recat ?? a.perf.recat}</span>
        <span class="f id"><b class="mono">${a.cs}${a.formation > 1 ? `×${a.formation}` : ''}</b><i class="mono">${a.type}</i></span>
        <span class="f rt"><i class="mono">${esc(a.proc ?? a.rules)}${efc}</i><i class="mono">${a.expectRwy ?? (a.kind === 'dep' ? sim.runway : '')}</i></span>
        <span class="f cfl mono ${sflOff ? 'off' : ''}">${cfl}</span>
        <span class="f vx"><i class="mono">${hdg}</i><i class="mono">${spd}</i></span>
        <span class="f ap mono">${esc(app)}</span>
        ${waiting ? `<span class="s-wait mono" data-w0="${a.awaitingSince}">${mmss(sim.t - a.awaitingSince!)}</span>` : ''}
        ${a.request ? `<span class="s-req">REQ ${esc(a.request.text)}</span>` : ''}${a.emergency ? `<span class="s-req emer">${a.sqk} ${esc(a.emergencyText ?? a.emergency.toUpperCase())}</span>` : ''}
      </button>`;
  }
  private stripSig = '';
  private renderStrips() {
    const sim = this.sim;
    const live = sim.aircraft.filter((a) => !a.remove && a.state !== 'unconcerned');
    const order = landingOrder(sim);
    const seq = order.map((x) => x.ac).filter((a) => a.state === 'assumed' && a.mode !== 'HOLD');
    const hold = live.filter((a) => a.state === 'assumed' && a.mode === 'HOLD');
    const offered = live.filter((a) => a.state === 'inbound');
    const est = sim.estimates.filter((e) => e.state === 'expected');
    const deps = live.filter((a) => a.kind === 'dep' && a.state === 'assumed');
    const pend = sim.releases.filter((r) => r.state === 'pending' || r.state === 'held');
    const other = live.filter((a) => a.state === 'assumed' && a.kind !== 'arr' && a.kind !== 'dep');
    const xfr = live.filter((a) => a.state === 'transferred').slice(-4);
    const sig = JSON.stringify([seq.map((a) => a.cs), sim.sequence, this.cs, Math.floor(sim.t / 2)]);
    if (sig === this.stripSig && !this.dragging) { this.els.strips.querySelectorAll<HTMLElement>('.s-wait[data-w0]').forEach((e) => { const w = sim.t - Number(e.dataset.w0); e.textContent = mmss(w); e.classList.toggle('late', w > 15); }); return; }
    if (this.dragging) return;
    this.stripSig = sig;
    const bay = (title: string, n: number | string, body: string, cls = '') => body ? `<div class="bayh ${cls}"><span>${title}</span><b class="mono">${n}</b></div>${body}` : '';
    this.els.strips.innerHTML =
      bay(`Offered by ${esc(sim.acc.say)}`, offered.length + est.length,
        est.map((e) => `<div class="strip-pend est mono"><span class="bay">E</span><b>${esc(e.cs)}</b><i>${esc(e.type)} ${esc(e.star)} · ${esc(e.fix)} ${sim.utc(e.t).slice(3, 5)}</i><em>${esc(levelText(e.xfl).replace(' ft', ''))}${e.revised ? ' rev' : ''}</em></div>`).join('') + offered.map((a) => this.stripHtml(a)).join(''), 'offered') +
      bay('Landing sequence <small>drag to reorder</small>', seq.length, `<div class="seq" data-e2="seq">${seq.map((a) => this.stripHtml(a, 'data-seq="1"')).join('')}</div>`, 'seqh') +
      bay(`Hold ${esc(hold[0]?.hold?.fix ?? sim.stackFix)}`, hold.length, hold.sort((a, b) => a.tgtAlt - b.tgtAlt).map((a) => this.stripHtml(a)).join(''), 'holdh') +
      bay('Departures', deps.length + pend.length, pend.map((r) => `<button class="strip-pend mono" data-relsel="${esc(r.cs)}"><span class="bay">⏸</span><b>${esc(r.cs)}</b><i>${esc(r.type)} ${esc(r.sid)}</i><em>${r.state === 'held' ? 'held' : 'release?'}</em></button>`).join('') + deps.map((a) => this.stripHtml(a)).join(''), 'deph') +
      bay('Other traffic', other.length, other.map((a) => this.stripHtml(a)).join('')) +
      bay('Transferred', xfr.length, xfr.map((a) => this.stripHtml(a)).join(''), 'xfrh') ||
      '<div class="empty">No traffic yet</div>';
    this.bindSeqDrag();
  }
  private dragging = false;
  /** Drag a strip in the landing sequence (by its bay tab or a long press) to change the order. */
  private bindSeqDrag() {
    const box = this.els.strips.querySelector<HTMLElement>('[data-e2="seq"]');
    if (!box) return;
    box.querySelectorAll<HTMLElement>('.strip').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        if (!(e.target as HTMLElement).closest('.bay')) return;
        e.preventDefault(); e.stopPropagation();
        this.dragging = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
        const y0 = e.clientY;
        const move = (ev: PointerEvent) => { el.style.transform = `translateY(${ev.clientY - y0}px)`; };
        const up = (ev: PointerEvent) => {
          el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
          el.classList.remove('dragging'); el.style.transform = '';
          const sibs = [...box.querySelectorAll<HTMLElement>('.strip')].filter((x) => x !== el);
          let idx = sibs.findIndex((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
          if (idx < 0) idx = sibs.length;
          const order = sibs.map((x) => x.dataset.cs!);
          order.splice(idx, 0, el.dataset.cs!);
          this.sim.setSequence(order);
          this.dragging = false; this.stripSig = '';
          this.toast(`Landing order: ${order.slice(0, 5).join(', ')}${order.length > 5 ? '…' : ''}`, 2200);
          this.renderStrips(); this.renderAman();
        };
        el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
    });
  }

  // ---------------- coordination panel: releases, Brussels, military, safety nets ----------------
  private coordSig = '';
  private renderCoord() {
    const sim = this.sim;
    const nets = sim.safetyNets();
    const reqs = sim.coordReqs.filter((r) => r.state === 'pending');
    const lastBy = (from: string) => { for (let i = sim.log.length - 1; i >= 0 && i > sim.log.length - 40; i--) { const t = sim.log[i]; if (t.channel === 'icom' && t.from === from) return sim.t - t.t0; } return 1e9; };
    const lit = {
      [sim.twr.id]: sim.releases.some((r) => r.state === 'pending') || sim.aircraft.some((a) => a.request?.kind === 'milxing' && a.request.unit === sim.twr.id && a.state === 'inbound') || lastBy(sim.twr.id) < 20,
      [sim.acc.id]: reqs.length > 0 || lastBy(sim.acc.id) < 20,
      [sim.mil.id]: sim.aircraft.some((a) => a.request?.kind === 'milxing' && (a.request.unit ?? sim.mil.id) === sim.mil.id && a.state === 'inbound') || sim.tsaPending.size > 0 || lastBy(sim.mil.id) < 20,
      [sim.sup.id]: lastBy(sim.sup.id) < 30,
    } as Record<string, boolean>;
    const sig = JSON.stringify([this.icomSig, reqs.map((r) => r.id), lit]);
    const netSig = JSON.stringify([nets.map((n) => n.id), [...sim.tsaPending.keys()], Math.floor(sim.t / 2)]);
    if (sig === this.coordSig && netSig === this.netSig) { this.tickTimers(); return; }
    const topOnly = sig !== this.coordSig;
    this.coordSig = sig; this.netSig = netSig;
    const key = (u: string, sub: string) => `<button class="ikey ${lit[u] ? 'lit' : ''}" data-ikey="${u}"><b>${u}</b><small>${sub}</small></button>`;
    const brus = reqs.map((r) => `<div class="ic-card bru"><div class="ic-h"><span class="ic-from">${sim.acc.id} ⇄</span><b class="mono">${esc(r.cs)}</b><span class="ic-t mono" data-tx="${r.expireT}">${mmss(r.expireT - sim.t)}</span></div><div class="ic-s">Early transfer at ${esc(levelText(r.level))}?</div><div class="ic-b"><button data-rel="${esc(r.cs)}" data-v="bruok" class="ok">Approve</button><button data-rel="${esc(r.cs)}" data-v="bruno">As coordinated</button></div></div>`).join('');
    const tsas = [...sim.tsaPending].map(([n, t]) => `<div class="net mil"><span>${esc(sim.areasName)}</span><b>${esc(n)}</b><em>live ${sim.utc(t).slice(0, 5)}Z</em></div>`).join('');
    const netRows = nets.map((n) => {
      if (n.kind === 'STCA' || n.kind === 'LOS') return `<button class="net red" data-cs="${n.a}"><span>${n.kind}</span><b>${n.a} / ${n.b}</b><em>${n.nm.toFixed(1)} NM ${Math.round(n.vertFt / 100) * 100} ft${n.kind === 'STCA' ? ` · ${mmss(n.tCpa)}` : ''}</em></button>`;
      if (n.kind === 'SFL') return `<button class="net amb" data-cs="${n.cs}"><span>MODE S</span><b>${n.cs}</b><em>sel ${esc(levelText(n.sfl).replace(' ft', ''))} ≠ ${esc(levelText(n.cfl).replace(' ft', ''))}</em></button>`;
      if (n.kind === 'MSAW') return `<button class="net red" data-cs="${n.cs}"><span>MSAW</span><b>${n.cs}</b><em>${Math.round(n.alt / 100) * 100} ft &lt; ${n.mva}</em></button>`;
      if (n.kind !== 'CLAM') return '';
      return `<button class="net amb" data-cs="${n.cs}"><span>CLAM</span><b>${n.cs}</b><em>${Math.round(n.alt / 100) * 100} ft vs ${esc(levelText(n.cfl))}</em></button>`;
    }).join('');
    const netsHtml = `<div class="nets-h">Safety nets <b class="mono ${nets.length ? 'bad' : ''}">${nets.length || 'clear'}</b></div>${netRows}${tsas}`;
    const netsEl = this.els.coord.querySelector<HTMLElement>('.nets');
    if (!topOnly && netsEl) { netsEl.innerHTML = netsHtml; return; }
    this.els.coord.innerHTML = `
      <div class="ikeys">${Object.values(sim.units).map((u) => key(u.id, u.role === 'tower' || u.role === 'neighbour' ? u.freq : u.label)).join('')}</div>
      ${this.icomHtml || brus ? `<div class="coord-cards">${this.icomHtml}${brus}</div>` : '<div class="empty">No coordination waiting.</div>'}
      <div class="nets">${netsHtml}</div>`;
  }
  private netSig = '';
  /** Update countdowns and release advice in place, so buttons are not rebuilt under the player's finger. */
  private tickTimers() {
    const sim = this.sim;
    for (const root of [this.els.icom, this.els.coord]) {
      root.querySelectorAll<HTMLElement>('[data-t0]').forEach((e) => { const w = sim.t - Number(e.dataset.t0); e.textContent = mmss(w); e.classList.toggle('warn', w > 120); });
      root.querySelectorAll<HTMLElement>('[data-tx]').forEach((e) => { e.textContent = mmss(Math.max(0, Number(e.dataset.tx) - sim.t)); });
      root.querySelectorAll<HTMLElement>('[data-adv]').forEach((e) => { const a = releaseAdvice(sim, e.dataset.adv!); if (e.textContent !== a.why) e.textContent = a.why; e.className = a.ok ? 'ok' : 'warn'; });
    }
  }
  private icomHtml = '';
}
