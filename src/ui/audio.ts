import { hashStr } from '../engine/rng';

// Radio audio: pilot voices via the browser's speech synthesis, framed by a
// squelch burst and carrier click from WebAudio. Speech synthesis cannot be
// routed through WebAudio, so the "radio" sound comes from the framing noise.

export class Radio {
  private ctx?: AudioContext;
  private voices: SpeechSynthesisVoice[] = [];
  enabled = true;
  rate = 1.08;

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
  private noise(dur: number, gain: number, f = 1800) {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start();
  }
  click() { this.noise(0.03, 0.25, 2500); }
  squelch() { this.noise(0.16, 0.18, 1600); }
  /** Two carriers on frequency at once: a beating heterodyne under noise. */
  blocked() {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = ctx.createGain(); g.gain.value = 0.04; g.connect(ctx.destination);
    for (const f of [1020, 1083]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(g); o.start(); o.stop(ctx.currentTime + 1.6); }
    this.noise(1.6, 0.14, 1400);
  }
  alert() {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
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
