import { hashStr } from '../engine/rng';

// Radio audio: pilot voices via the browser's speech synthesis, framed by a
// squelch burst and carrier click from WebAudio. Speech synthesis cannot be
// routed through WebAudio, so the "radio" sound comes from the framing noise.

export class Radio {
  private ctx?: AudioContext;
  private voices: SpeechSynthesisVoice[] = [];
  /** Pilot voices on/off (speech synthesis). */
  enabled = true;
  rate = 1.08;
  /** Sound effects (clicks, alerts, chimes) on/off. */
  sfx = true;
  /** Master volume for sound effects, 0..1. */
  volume = 1;

  constructor() {
    if (typeof speechSynthesis !== 'undefined') {
      const load = () => { this.voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en')); };
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }
  /** Must be called from a user gesture on iOS. */
  unlock() {
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (typeof speechSynthesis !== 'undefined') { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
    } catch { /* audio unavailable */ }
  }
  /** Output node for effects, or undefined when muted or audio is locked. */
  private out(gain: number): GainNode | undefined {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.volume <= 0) return undefined;
    const g = ctx.createGain(); g.gain.value = gain * this.volume; g.connect(ctx.destination);
    return g;
  }
  /** One soft enveloped tone. */
  private tone(f: number, t0: number, dur: number, peak: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx;
    const out = this.out(1);
    if (!ctx || !out) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    const s = ctx.currentTime + t0;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(peak, s + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
    o.connect(g).connect(out);
    o.start(s); o.stop(s + dur + 0.02);
  }
  private noise(dur: number, gain: number, f = 1800) {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || this.volume <= 0) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = gain * this.volume;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
  }
  click() { this.noise(0.03, 0.25, 2500); }
  squelch() { this.noise(0.16, 0.18, 1600); }
  /** Two carriers on frequency at once: a beating heterodyne under noise. */
  blocked() {
    const ctx = this.ctx;
    const g = this.out(0.04);
    if (!ctx || !g) return;
    for (const f of [1020, 1083]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(g); o.start(); o.stop(ctx.currentTime + 1.6); }
    this.noise(1.6, 0.14, 1400);
  }
  alert() {
    const ctx = this.ctx;
    const g = this.out(0.05);
    if (!ctx || !g) return;
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = 880;
    o.connect(g);
    o.start(); o.stop(ctx.currentTime + 0.12);
  }
  /** Soft rising two-tone: a well-spaced landing. */
  chime() {
    this.tone(784, 0, 0.55, 0.07);
    this.tone(1175, 0.14, 0.7, 0.06);
  }
  /** Subtle single blip: a new aircraft is calling. */
  ping() {
    this.tone(1568, 0, 0.18, 0.035);
  }
  /** Push-to-talk keyed: a faint carrier click. */
  pttDown() { this.noise(0.012, 0.08, 3200); }
  /** Push-to-talk released: the sharp unkey click of a real transmitter, with a hint of squelch tail. */
  pttUp() {
    this.noise(0.018, 0.3, 3400);
    this.tone(2600, 0, 0.03, 0.025, 'square');
    const ctx = this.ctx;
    if (ctx && this.sfx && this.volume > 0) setTimeout(() => this.noise(0.07, 0.07, 1500), 25);
  }
  /** Short two-note intercom buzz (coordination line from another unit). */
  intercom() {
    this.tone(440, 0, 0.13, 0.05, 'square');
    this.tone(554, 0.16, 0.13, 0.05, 'square');
  }
  speak(text: string, who: string, atc = false) {
    if (!this.enabled || typeof speechSynthesis === 'undefined' || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    const h = hashStr(who);
    if (this.voices.length) u.voice = atc ? this.voices[0] : this.voices[h % this.voices.length];
    u.rate = this.rate * (atc ? 1.05 : 0.95 + ((h >> 3) % 20) / 100);
    u.pitch = atc ? 1 : 0.8 + ((h >> 7) % 40) / 100;
    u.volume = 0.95;
    if (!atc) { u.onstart = () => this.click(); u.onend = () => this.squelch(); }
    speechSynthesis.speak(u);
  }
  cancel() { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }
}

// ---------------- speech recognition ----------------

export type MicLang = 'en-GB' | 'en-US';
/** unsupported: no Web Speech API; denied: microphone permission refused; no-mic: no input device; network: the recogniser service is unreachable */
export type MicError = 'unsupported' | 'denied' | 'no-mic' | 'network' | 'other';
export interface MicHandlers {
  /** live text while the key is held (finals so far plus the current guess) */
  onInterim?(text: string): void;
  /** once per transmission, after release; alternatives[0] === text. Not called after abort(). */
  onFinal(text: string, alternatives: string[]): void;
  onError?(code: MicError, message: string): void;
}
/** The subset of SpeechRecognition the Mic uses (a seam for tests). */
export interface RecLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
export interface MicOptions {
  lang?: MicLang;
  /** plays the transmitter clicks on key-down and key-up (respects its sfx and volume settings) */
  radio?: Pick<Radio, 'pttDown' | 'pttUp'>;
  /** test seam: make a recogniser (undefined = unsupported) */
  factory?: () => RecLike | undefined;
  /** ms to wait for the recogniser to finish after release before giving up and using what it has */
  finalizeMs?: number;
}

const MIC_MSG: Record<MicError, string> = {
  unsupported: 'Voice input is not supported in this browser. Use Chrome, Edge or Safari, or tap and type commands.',
  denied: 'Microphone permission was refused. Allow the microphone for this site to use voice.',
  'no-mic': 'No microphone found.',
  network: 'Voice recognition needs a network connection.',
  other: 'Voice recognition failed.',
};

/**
 * Push-to-talk speech recognition. begin() on key-down, end() on key-up (finalises and calls onFinal once),
 * abort() when the transmission is cancelled. Recognition stays continuous while the key is held: if the
 * browser ends a session on silence, it is restarted and the text so far is kept.
 */
export class Mic {
  readonly available: boolean;
  lang: MicLang;
  /** 'denied' after the browser refused the microphone; begin() then reports it at once */
  permission: 'unknown' | 'granted' | 'denied' = 'unknown';
  private factory: () => RecLike | undefined;
  private radio?: Pick<Radio, 'pttDown' | 'pttUp'>;
  private finalizeMs: number;
  private sess?: MicSession;

  constructor(opts: MicOptions = {}) {
    this.factory = opts.factory ?? (() => {
      const SR = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
      return SR ? (new SR() as RecLike) : undefined;
    });
    this.available = opts.factory ? true : typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
    this.lang = opts.lang ?? 'en-GB';
    this.radio = opts.radio;
    this.finalizeMs = opts.finalizeMs ?? 1500;
  }
  get listening() { return !!this.sess && !this.sess.released; }

  /** Key down: start listening. */
  begin(h: MicHandlers) {
    if (this.sess) this.sess.flush();   // a quick re-key: deliver the last transmission now
    this.radio?.pttDown();
    if (!this.available) { h.onError?.('unsupported', MIC_MSG.unsupported); return; }
    if (this.permission === 'denied') { h.onError?.('denied', MIC_MSG.denied); return; }
    const s = new MicSession(this, h, this.factory, this.lang, this.finalizeMs, () => { if (this.sess === s) this.sess = undefined; });
    this.sess = s;
    s.start();
  }
  /** Key up: stop, click, and finalise. */
  end() {
    this.radio?.pttUp();
    this.sess?.release();
  }
  /** Cancel: stop without delivering anything. */
  abort() {
    this.radio?.pttUp();
    this.sess?.cancel();
  }

  /** @deprecated v0.4 API: start listening, report text as it comes and once more with final=true. */
  start(onText: (t: string, final: boolean) => void, onErr: (e: string) => void) {
    this.begin({ onInterim: (t) => onText(t, false), onFinal: (t) => onText(t, true), onError: (_c, m) => onErr(m) });
  }
  /** @deprecated v0.4 API */
  stop() { this.end(); }

  /** @internal */ setPermission(p: 'granted' | 'denied') { this.permission = p; }
}

class MicSession {
  released = false;
  private done = false;
  private rec?: RecLike;
  /** final segments, each with its alternatives */
  private finals: string[][] = [];
  /** finals of the current recogniser, by result index (results are cumulative within one session) */
  private cur: string[][] = [];
  private interim = '';
  private timer?: ReturnType<typeof setTimeout>;
  private fatal = false;
  private restarts = 0;
  constructor(
    private mic: Mic, private h: MicHandlers, private factory: () => RecLike | undefined,
    private lang: string, private finalizeMs: number, private onClose: () => void,
  ) {}

  start() {
    const rec = this.factory();
    if (!rec) { this.fail('unsupported'); return; }
    this.rec = rec;
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.onresult = (e: any) => {
      if (rec !== this.rec || this.done) return;
      this.mic.setPermission('granted');
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {   // cumulative: re-read all, finals are keyed by index
        const r = e.results[i];
        if (r.isFinal) {
          const alts: string[] = [];
          for (let k = 0; k < (r.length ?? 1); k++) if (r[k]?.transcript) alts.push(String(r[k].transcript).trim());
          if (alts.length) this.cur[i] = alts;
        } else interim += r[0]?.transcript ?? '';
      }
      this.interim = interim.trim();
      this.h.onInterim?.(this.text());
    };
    rec.onerror = (e: any) => {
      if (rec !== this.rec || this.done) return;
      const err = String(e?.error ?? 'other');
      if (err === 'no-speech' || err === 'aborted') return;   // silence is not an error while the key is held
      const code: MicError = err === 'not-allowed' || err === 'service-not-allowed' ? 'denied' : err === 'audio-capture' ? 'no-mic' : err === 'network' ? 'network' : 'other';
      if (code === 'denied') this.mic.setPermission('denied');
      this.fatal = true;
      this.fail(code, code === 'other' ? `${MIC_MSG.other} (${err})` : undefined);
    };
    rec.onend = () => {
      if (rec !== this.rec || this.done) return;
      if (!this.released && !this.fatal && this.restarts < 20) {
        // the browser stopped on its own (silence, time limit): keep listening while the key is held
        this.finals.push(...this.cur.filter(Boolean));
        this.cur = [];
        if (this.interim) { this.finals.push([this.interim]); this.interim = ''; }
        this.restarts++;
        this.start();
        return;
      }
      this.finish();
    };
    try { rec.start(); } catch (e) { this.fatal = true; this.fail('other', `${MIC_MSG.other} (${String(e)})`); }
  }
  private segs() { return [...this.finals, ...this.cur.filter(Boolean)]; }
  private text(alt = 0) {
    return [...this.segs().map((a) => a[alt] ?? a[0]), this.interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }
  release() {
    if (this.released || this.done) return;
    this.released = true;
    try { this.rec?.stop(); } catch { /* already stopped */ }
    this.timer = setTimeout(() => { try { this.rec?.abort(); } catch { /* ignore */ } this.finish(); }, this.finalizeMs);
  }
  /** deliver now (a new transmission is starting) */
  flush() {
    if (this.done) return;
    if (!this.released) { this.released = true; }
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.finish();
  }
  cancel() {
    if (this.done) return;
    this.done = true;
    this.released = true;
    if (this.timer) clearTimeout(this.timer);
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.onClose();
  }
  private finish() {
    if (this.done) return;
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    const n = Math.max(1, ...this.segs().map((a) => a.length));
    const alts: string[] = [];
    for (let k = 0; k < n; k++) { const t = this.text(k); if (t && !alts.includes(t)) alts.push(t); }
    this.onClose();
    this.h.onFinal(alts[0] ?? '', alts);
  }
  private fail(code: MicError, msg?: string) {
    if (this.done) return;
    this.done = true;
    if (this.timer) clearTimeout(this.timer);
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.onClose();
    this.h.onError?.(code, msg ?? MIC_MSG[code]);
  }
}
