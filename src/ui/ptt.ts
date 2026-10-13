// Push-to-talk: one transmit state fed by a held key (Space by default), a USB foot pedal
// (a keyboard key such as F13 or a gamepad button) and a held on-screen button.
//
// The state machine (PttCore) is pure and clock-injected so it can be tested without a DOM;
// createPtt() is the browser adapter around it.

export type PttSource = 'key' | 'pedal' | 'pad' | 'pointer';
/** Why the transmission ended. 'cancel' = the finger slid off the button: the game should discard it. */
export type PttReason = 'release' | 'cancel' | 'blur' | 'hidden' | 'disabled';
export interface PttUp { reason: PttReason; heldMs: number }

export type PedalBinding =
  | { kind: 'key'; code: string }
  /** `pad` is the Gamepad.id to match; absent = any connected pad */
  | { kind: 'pad'; button: number; pad?: string };

export interface PttClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

/** The transmit state machine. Any held source keeps the transmitter keyed. */
export class PttCore {
  private held = new Set<PttSource>();
  private on = false;
  private since = 0;
  private upTimer: unknown;
  enabled = true;
  constructor(
    private cb: { onDown(): void; onUp(info: PttUp): void },
    private clock: PttClock,
    /** a release followed by a press within this window is contact bounce: the transmission continues */
    public debounceMs = 40,
  ) {}
  get active() { return this.on; }
  isHeld(src: PttSource) { return this.held.has(src); }
  press(src: PttSource) {
    if (!this.enabled) return;
    this.held.add(src);
    if (this.upTimer !== undefined) { this.clock.clearTimeout(this.upTimer); this.upTimer = undefined; }
    if (!this.on) { this.on = true; this.since = this.clock.now(); this.cb.onDown(); }
  }
  release(src: PttSource, reason: PttReason = 'release') {
    if (!this.held.delete(src)) return;
    if (this.held.size || !this.on) return;
    if (reason !== 'release' || this.debounceMs <= 0) this.finish(reason);
    else if (this.upTimer === undefined) this.upTimer = this.clock.setTimeout(() => this.finish('release'), this.debounceMs);
  }
  /** Drop every source at once (window blur, tab hidden, disabled). Never leaves the key stuck. */
  releaseAll(reason: PttReason) {
    this.held.clear();
    if (this.upTimer !== undefined) { this.clock.clearTimeout(this.upTimer); this.upTimer = undefined; }
    if (this.on) this.finish(reason);
  }
  private finish(reason: PttReason) {
    this.upTimer = undefined;
    if (!this.on || this.held.size) return;
    this.on = false;
    this.cb.onUp({ reason, heldMs: this.clock.now() - this.since });
  }
}

// ---------------- browser adapter ----------------

interface Listenable { addEventListener(t: string, f: (e: any) => void, o?: any): void; removeEventListener(t: string, f: (e: any) => void, o?: any): void }
export interface GamepadLike { id: string; index: number; connected?: boolean; buttons: readonly { pressed: boolean; value?: number }[] }
export interface PttEnv extends PttClock {
  win: Listenable;
  doc: Listenable & { visibilityState?: string };
  getGamepads?: () => readonly (GamepadLike | null)[];
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

export interface PttOptions {
  onDown(): void;
  /** `info.reason === 'cancel'` means the player slid off the on-screen button: discard what was said */
  onUp(info?: PttUp): void;
  /** the on-screen push-to-talk button (held with pointer capture) */
  target: HTMLElement;
  /** KeyboardEvent.code for the desk key, default 'Space'; '' turns the key off */
  key?: string;
  /** foot pedal binding (from learnPedal or the settings screen) */
  pedal?: PedalBinding | null;
  /** release debounce in ms (pedal contact bounce), default 40 */
  debounceMs?: number;
  /** gamepad poll interval in ms, default 30 */
  pollMs?: number;
  /** how far (px) a held finger may slide off the button before the transmission is cancelled, default 48 */
  slopPx?: number;
  /** test seam: event sources, clock and gamepads */
  env?: PttEnv;
}

export interface PttController {
  readonly active: boolean;
  setKey(code: string): void;
  setPedal(b: PedalBinding | null): void;
  readonly pedal: PedalBinding | null;
  /** Wait for the next key press or gamepad button and return it as a binding (null on timeout or Escape). */
  learnPedal(timeoutMs?: number): Promise<PedalBinding | null>;
  setEnabled(on: boolean): void;
  /** Force the transmitter off (for example when a modal opens). */
  release(reason?: PttReason): void;
  destroy(): void;
}

/** Keys that USB foot pedals and pedal adapters commonly send. */
export const PEDAL_KEY_CODES = ['F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24', 'ScrollLock', 'Pause', 'Insert', 'PageDown', 'PageUp', 'MediaPlayPause', 'AudioVolumeMute', 'NumLock', 'ContextMenu'];

export function describeBinding(b: PedalBinding | null | undefined): string {
  if (!b) return 'None';
  if (b.kind === 'key') return b.code === 'Space' ? 'Space bar' : b.code.replace(/^Key/, '').replace(/^Digit/, '');
  return `Button ${b.button + 1}${b.pad ? ` on ${b.pad.replace(/\s*\(.*$/, '').slice(0, 32)}` : ''}`;
}

export interface PedalCandidate { binding: PedalBinding; label: string; pressed?: boolean }
/**
 * What a pedal could be: every button of each connected gamepad (pressed ones first, so
 * "hold your pedal and tap Detect" works) followed by the keys pedals usually send.
 */
export function listPedalCandidates(env?: Pick<PttEnv, 'getGamepads'>): PedalCandidate[] {
  const pads = (env?.getGamepads ?? defaultGamepads)() ?? [];
  const out: PedalCandidate[] = [];
  for (const p of pads) {
    if (!p) continue;
    p.buttons.forEach((b, i) => out.push({ binding: { kind: 'pad', button: i, pad: p.id }, label: describeBinding({ kind: 'pad', button: i, pad: p.id }), pressed: b.pressed }));
  }
  out.sort((a, b) => Number(!!b.pressed) - Number(!!a.pressed));
  for (const code of PEDAL_KEY_CODES) out.push({ binding: { kind: 'key', code }, label: describeBinding({ kind: 'key', code }) });
  return out;
}

function defaultGamepads(): readonly (GamepadLike | null)[] {
  try { return typeof navigator !== 'undefined' && navigator.getGamepads ? (navigator.getGamepads() as unknown as (GamepadLike | null)[]) : []; } catch { return []; }
}
function defaultEnv(): PttEnv {
  return {
    win: window, doc: document, getGamepads: defaultGamepads,
    now: () => performance.now(),
    setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (h) => window.clearTimeout(h as number),
    setInterval: (f, ms) => window.setInterval(f, ms), clearInterval: (h) => window.clearInterval(h as number),
  };
}

/** True when the key press belongs to a text field (Space must type a space there). */
export function isTypingTarget(t: any): boolean {
  if (!t || typeof t !== 'object') return false;
  if (t.isContentEditable) return true;
  const tag = String(t.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image'].includes(String(t.type ?? 'text').toLowerCase());
  return false;
}

const CAPTURE = { capture: true };

export function createPtt(opts: PttOptions): PttController {
  const env = opts.env ?? defaultEnv();
  const core = new PttCore({ onDown: () => opts.onDown(), onUp: (i) => opts.onUp(i) }, env, opts.debounceMs ?? 40);
  let key = opts.key ?? 'Space';
  let pedal: PedalBinding | null = opts.pedal ?? null;
  const slop = opts.slopPx ?? 48;
  let pointerId: number | undefined;
  let captured = false;
  let learning: ((b: PedalBinding | null) => void) | undefined;
  let learnBase: boolean[][] = [];
  let poll: unknown;
  let padDown = false;
  const target = opts.target;

  const onKeyDown = (e: any) => {
    if (learning) {
      e.preventDefault?.();
      if (e.repeat) return;
      const done = learning; learning = undefined; stopPollIfIdle();
      done(e.code === 'Escape' ? null : { kind: 'key', code: e.code });
      return;
    }
    const isPedal = pedal?.kind === 'key' && e.code === pedal.code;
    const isKey = !!key && e.code === key && !isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!isPedal && !isKey) return;
    e.preventDefault?.();
    if (e.repeat) return;                       // auto-repeat is not a new press
    core.press(isPedal ? 'pedal' : 'key');
  };
  const onKeyUp = (e: any) => {
    if (pedal?.kind === 'key' && e.code === pedal.code && core.isHeld('pedal')) { e.preventDefault?.(); core.release('pedal'); }
    if (key && e.code === key && core.isHeld('key')) { e.preventDefault?.(); core.release('key'); }
  };
  const onBlur = () => core.releaseAll('blur');
  const onVis = () => { if (env.doc.visibilityState === 'hidden') core.releaseAll('hidden'); };

  const onPointerDown = (e: any) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault?.();
    pointerId = e.pointerId;
    captured = false;
    try { target.setPointerCapture?.(e.pointerId); captured = true; } catch { /* capture unsupported */ }
    core.press('pointer');
  };
  const mine = (e: any) => pointerId !== undefined && (e.pointerId === undefined || e.pointerId === pointerId);
  const endPointer = (reason: PttReason) => { pointerId = undefined; captured = false; core.release('pointer', reason); };
  const onPointerUp = (e: any) => { if (mine(e)) endPointer('release'); };
  const onPointerCancel = (e: any) => { if (mine(e)) endPointer('cancel'); };
  const onLostCapture = (e: any) => { if (mine(e)) endPointer('release'); };
  const onPointerLeave = (e: any) => { if (mine(e) && !captured) endPointer('cancel'); };
  const onPointerMove = (e: any) => {
    if (!mine(e) || !captured || typeof target.getBoundingClientRect !== 'function') return;
    const r = target.getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    if (x < r.left - slop || x > r.right + slop || y < r.top - slop || y > r.bottom + slop) {
      try { target.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
      endPointer('cancel');
    }
  };
  const noMenu = (e: any) => e.preventDefault?.();

  // ---- gamepad polling (only while a pad binding exists or we are learning) ----
  const pads = () => { try { return (env.getGamepads?.() ?? []).filter((p): p is GamepadLike => !!p); } catch { return []; } };
  const tick = () => {
    const list = pads();
    if (learning) {
      for (const p of list) {
        const base = learnBase[p.index] ?? [];
        const i = p.buttons.findIndex((b, k) => b.pressed && !base[k]);
        if (i >= 0) { const done = learning; learning = undefined; stopPollIfIdle(); done({ kind: 'pad', button: i, pad: p.id }); return; }
      }
      return;
    }
    if (pedal?.kind !== 'pad') return;
    const b = pedal;
    const down = list.some((p) => (!b.pad || p.id === b.pad) && !!p.buttons[b.button]?.pressed);
    if (down && !padDown) { padDown = true; core.press('pad'); }
    else if (!down && padDown) { padDown = false; core.release('pad'); }
  };
  const startPoll = () => { if (poll === undefined) poll = env.setInterval(tick, opts.pollMs ?? 30); };
  const stopPollIfIdle = () => {
    if (poll !== undefined && !learning && pedal?.kind !== 'pad') { env.clearInterval(poll); poll = undefined; }
  };
  const onPadConnected = () => { if (pedal?.kind === 'pad' || learning) startPoll(); };
  const onPadDisconnected = () => { if (padDown && !pads().some((p) => pedal?.kind === 'pad' && (!pedal.pad || p.id === pedal.pad))) { padDown = false; core.release('pad'); } };

  const on: [Listenable, string, (e: any) => void, any?][] = [
    [env.win, 'keydown', onKeyDown, CAPTURE], [env.win, 'keyup', onKeyUp, CAPTURE], [env.win, 'blur', onBlur], [env.win, 'pagehide', onBlur],
    [env.doc, 'visibilitychange', onVis],
    [env.win, 'gamepadconnected', onPadConnected], [env.win, 'gamepaddisconnected', onPadDisconnected],
    [target, 'pointerdown', onPointerDown], [target, 'pointerup', onPointerUp], [target, 'pointercancel', onPointerCancel],
    [target, 'lostpointercapture', onLostCapture], [target, 'pointerleave', onPointerLeave], [target, 'pointermove', onPointerMove],
    [target, 'contextmenu', noMenu],
  ];
  for (const [t, ev, f, o] of on) t.addEventListener(ev, f, o);
  if (pedal?.kind === 'pad') startPoll();

  return {
    get active() { return core.active; },
    get pedal() { return pedal; },
    setKey(code: string) { if (core.isHeld('key')) core.release('key'); key = code; },
    setPedal(b: PedalBinding | null) {
      if (core.isHeld('pedal')) core.release('pedal');
      if (padDown) { padDown = false; core.release('pad'); }
      pedal = b;
      if (b?.kind === 'pad') startPoll(); else stopPollIfIdle();
    },
    learnPedal(timeoutMs = 10000) {
      if (learning) learning(null);
      core.releaseAll('disabled');
      learnBase = [];
      for (const p of pads()) learnBase[p.index] = p.buttons.map((b) => b.pressed);
      return new Promise<PedalBinding | null>((resolve) => {
        const h = env.setTimeout(() => { if (learning === finish) { learning = undefined; stopPollIfIdle(); resolve(null); } }, timeoutMs);
        const finish = (b: PedalBinding | null) => { env.clearTimeout(h); resolve(b); };
        learning = finish;
        startPoll();
      });
    },
    setEnabled(v: boolean) { core.enabled = v; if (!v) core.releaseAll('disabled'); },
    release(reason: PttReason = 'disabled') { core.releaseAll(reason); },
    destroy() {
      core.releaseAll('disabled');
      for (const [t, ev, f, o] of on) t.removeEventListener(ev, f, o);
      if (poll !== undefined) { env.clearInterval(poll); poll = undefined; }
      if (learning) { const l = learning; learning = undefined; l(null); }
    },
  };
}
