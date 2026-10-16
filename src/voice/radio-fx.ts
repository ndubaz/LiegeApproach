// VHF AM radio sound for synthesized speech (WebAudio).
//
// What a controller hears on 119.280: the squelch opens with a click when the aircraft
// keys its transmitter, speech arrives band-limited to roughly 300–3,000 Hz, slightly
// overdriven and compressed by the aircraft's audio chain, over a hiss whose level
// depends on signal strength (distance and height), with some fading on weak signals,
// and a short burst of noise (the squelch tail) when the carrier drops.
// The controller's own voice (sidetone) is cleaner; intercom lines sound like a phone.
//
// A transmission is opened, fed one or more phrases as they come out of the synthesizer,
// and closed; the carrier (hiss) stays up between phrases like a pilot pausing mid-call.

export type FxKind = 'rt' | 'atc' | 'icom';
export interface FxProfile {
  kind: FxKind;
  /** 0 (barely readable) to 1 (strong and close) */
  signal: number;
  /** extra drive of the aircraft's audio chain, 0..1 (cast per pilot) */
  drive: number;
  /** stereo position, -1 left .. 1 right */
  pan?: number;
}

let noiseBuf: AudioBuffer | undefined;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = ctx.sampleRate * 2;
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  // pink-ish noise (Paul Kellet's economy filter): radio hiss is not white
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  return (noiseBuf = b);
}
function shaper(ctx: BaseAudioContext, k: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  ws.curve = c; ws.oversample = '2x';
  return ws;
}
const biquad = (ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.707, gain = 0) => {
  const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain; return b;
};

/** Speech level after normalising: every voice sits at the same loudness into the radio chain. */
function toBuffer(ctx: BaseAudioContext, pcm: Float32Array, sr: number): AudioBuffer {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > peak) peak = a; }
  const g = peak > 0 ? 0.85 / peak : 1;
  const buf = ctx.createBuffer(1, Math.max(1, pcm.length), sr);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] * g;
  return buf;
}

export class Transmission {
  /** context time the next phrase can start */
  cursor: number;
  end: number;
  closed = false;
  private nodes: AudioScheduledSourceNode[] = [];
  private out: GainNode;
  private voiceIn: AudioNode;
  private hissGain?: GainNode;
  private hissLevel = 0;

  constructor(private ctx: BaseAudioContext, dest: AudioNode, private p: FxProfile, volume = 1, when = ctx.currentTime) {
    this.out = ctx.createGain(); this.out.gain.value = volume;
    let tail: AudioNode = this.out;
    if (p.pan && 'createStereoPanner' in ctx) { const sp = (ctx as AudioContext).createStereoPanner(); sp.pan.value = p.pan; this.out.connect(sp); tail = sp; }
    tail.connect(dest);

    // the voice path: band limit, presence peak, the aircraft's overdriven audio, compressor
    const band = p.kind === 'atc' ? [220, 3800] : p.kind === 'icom' ? [320, 3300] : [330, 2900];
    const hp1 = biquad(ctx, 'highpass', band[0]), hp2 = biquad(ctx, 'highpass', band[0]);
    const lp1 = biquad(ctx, 'lowpass', band[1]), lp2 = biquad(ctx, 'lowpass', band[1]);
    const presence = biquad(ctx, 'peaking', p.kind === 'icom' ? 1400 : 1800, 1, p.kind === 'atc' ? 2 : 5);
    const drive = p.kind === 'rt' ? 1.6 + p.drive * 2.4 + (1 - p.signal) * 0.8 : p.kind === 'icom' ? 1.3 : 1.1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.12;
    const voice = ctx.createGain(); voice.gain.value = p.kind === 'rt' ? 0.9 : 0.8;
    hp1.connect(hp2).connect(presence).connect(shaper(ctx, drive)).connect(lp1).connect(lp2).connect(comp).connect(voice);
    this.voiceIn = hp1;
    // weak signals fade: a slow, irregular wobble on the voice level
    if (p.kind === 'rt' && p.signal < 0.6) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7 + Math.random() * 1.6;
      const depth = ctx.createGain(); depth.gain.value = (0.6 - p.signal) * 0.5;
      const base = ctx.createGain(); base.gain.value = 1 - depth.gain.value;
      voice.connect(base); lfo.connect(depth).connect(base.gain); base.connect(this.out);
      lfo.start(when); this.nodes.push(lfo);
    } else voice.connect(this.out);

    const pre = p.kind === 'rt' ? 0.09 : 0.02;
    this.cursor = this.end = when + pre;
    if (p.kind === 'rt') {
      // carrier hiss under the voice, louder on a weak signal; the squelch opens with a burst
      const hiss = ctx.createBufferSource(); hiss.buffer = noise(ctx); hiss.loop = true;
      const hg = ctx.createGain();
      this.hissLevel = 0.012 + (1 - p.signal) * 0.07;
      hg.gain.setValueAtTime(0, when);
      hg.gain.linearRampToValueAtTime(this.hissLevel * 2.2, when + 0.012);
      hg.gain.linearRampToValueAtTime(this.hissLevel, when + 0.07);
      hiss.connect(biquad(ctx, 'bandpass', 1700, 0.6)).connect(hg).connect(this.out);
      hiss.start(when, Math.random()); this.nodes.push(hiss); this.hissGain = hg;
      // key-up click
      const click = ctx.createBufferSource(); click.buffer = noise(ctx);
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.35, when); cg.gain.exponentialRampToValueAtTime(0.001, when + 0.025);
      click.connect(biquad(ctx, 'highpass', 2200)).connect(cg).connect(this.out);
      click.start(when, Math.random(), 0.03); this.nodes.push(click);
    }
  }
  /** Queue one phrase right after the previous one (or now, if the synthesizer fell behind). */
  add(pcm: Float32Array, sr: number, gap = 0.06) {
    if (this.closed) return;
    const buf = toBuffer(this.ctx, pcm, sr);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const t = Math.max(this.cursor, this.ctx.currentTime + 0.01);
    src.connect(this.voiceIn); src.start(t); this.nodes.push(src);
    this.cursor = t + buf.duration + gap;
    this.end = t + buf.duration;
  }
  /** Unkey after the last phrase: squelch tail, then silence. Returns the context time it is all over. */
  close(): number {
    if (this.closed) return this.end;
    this.closed = true;
    const t1 = Math.max(this.end, this.ctx.currentTime);
    if (this.hissGain) {
      const g = this.hissGain.gain, peak = this.hissLevel * 5 + 0.05;
      g.setValueAtTime(this.hissLevel, t1);
      g.linearRampToValueAtTime(peak, t1 + 0.02);
      g.setValueAtTime(peak, t1 + 0.1);
      g.linearRampToValueAtTime(0, t1 + 0.16);
    }
    const done = t1 + (this.p.kind === 'rt' ? 0.2 : 0.02);
    for (const n of this.nodes) { try { n.stop(Math.max(done, (n as any).__end ?? 0)); } catch { /* one-shot already scheduled */ } }
    this.end = done;
    return done;
  }
  stop() {
    this.closed = true;
    for (const n of this.nodes) { try { n.stop(); } catch { /* not started */ } }
    try { this.out.disconnect(); } catch { /* gone */ }
  }
}

/** Split a call into phrases at commas, so the first can play while the rest are synthesized. */
export function phrases(text: string, min = 18): string[] {
  const parts = text.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && (out[out.length - 1].length < min || p.length < 8)) out[out.length - 1] += ', ' + p;
    else out.push(p);
  }
  return out.length ? out : [text];
}
