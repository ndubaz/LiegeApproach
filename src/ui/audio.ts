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

/** Push-to-talk speech recognition, where the browser supports it. */
export class Mic {
  private rec: any;
  available: boolean;
  constructor() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.available = !!SR;
    if (SR) {
      this.rec = new SR();
      this.rec.lang = 'en-GB';
      this.rec.interimResults = true;
      this.rec.maxAlternatives = 1;
      this.rec.continuous = true;
    }
  }
  start(onText: (t: string, final: boolean) => void, onErr: (e: string) => void) {
    if (!this.rec) return onErr('Speech recognition is not available in this browser');
    let finalText = '';
    this.rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' ';
        else interim += e.results[i][0].transcript;
      }
      onText((finalText + interim).trim(), false);
    };
    this.rec.onerror = (e: any) => onErr(e.error === 'not-allowed' ? 'Microphone permission denied' : `Voice error: ${e.error}`);
    this.rec.onend = () => onText(finalText.trim(), true);
    try { this.rec.start(); } catch (e) { onErr(String(e)); }
  }
  stop() { try { this.rec?.stop(); } catch { /* ignore */ } }
}
