import type { FromWorker, ToWorker } from './protocol';

// Main-thread side of the neural voices: starts the worker, downloads models on demand,
// and turns synthesis requests into promises of PCM audio.

export type ModelId = 'vctk' | 'l2' | 'de';
export interface ModelInfo { file: string; cfg: string; mb: number; label: string }
export const VOICE_MODELS: Record<ModelId, ModelInfo> = {
  vctk: { file: 'voices/vctk-medium-w8.onnx', cfg: 'voices/vctk-medium.json', mb: 20.4, label: 'British, Irish, Scottish, American, Canadian, Australian, South African, Indian' },
  l2: { file: 'voices/l2arctic-medium-w8.onnx', cfg: 'voices/l2arctic-medium.json', mb: 20.2, label: 'Arabic, Hindi, Mandarin, Korean, Spanish, Vietnamese' },
  de: { file: 'voices/de-thorsten-medium-w8.onnx', cfg: 'voices/de-thorsten-medium.json', mb: 20.0, label: 'German' },
};

export interface SynthRequest { model: ModelId; sid: number; text: string; espeak?: string; accent?: string; length?: number; noise?: number; noiseW?: number }
export interface SynthResult { pcm: Float32Array; sr: number; ms: number }
type State = 'off' | 'loading' | 'ready' | 'error';

export function neuralSupported(): boolean {
  return !__SINGLE__ && typeof Worker !== 'undefined' && typeof WebAssembly === 'object' && typeof BigInt64Array !== 'undefined';
}

export class NeuralVoices {
  private worker?: Worker;
  private starting = false;
  private queue: ToWorker[] = [];
  private reqId = 1;
  private pending = new Map<number, { ok: (r: SynthResult) => void; fail: (e: Error) => void }>();
  readonly ready = new Set<ModelId>();
  readonly failed = new Map<ModelId, string>();
  readonly progress = new Map<ModelId, { loaded: number; total: number }>();
  /** Last few synthesis times in ms, for the settings readout. */
  readonly timings: number[] = [];
  onChange?: () => void;

  get state(): State {
    if (!this.progress.size) return 'off';
    if (this.failed.size && !this.ready.size) return 'error';
    return this.ready.size && this.progress.size === this.ready.size + this.failed.size ? 'ready' : 'loading';
  }
  /** Fraction downloaded over the models asked for (0..1). */
  get fraction(): number {
    let l = 0, t = 0;
    for (const [id, p] of this.progress) { const mb = VOICE_MODELS[id].mb * 1e6; t += p.total || mb; l += this.ready.has(id) ? p.total || mb : p.loaded; }
    return t ? l / t : 0;
  }

  /** Start the worker (once) and download the models (each once). */
  load(ids: ModelId[]) {
    if (!neuralSupported()) return;
    if (!this.worker && !this.starting && !__SINGLE__) {
      // a dynamic import, so the single-file build (where __SINGLE__ is true) drops the worker and its 14 MB runtime
      this.starting = true;
      void import('./worker-factory').then(({ makeVoiceWorker }) => {
        const w = makeVoiceWorker();
        w.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
        w.onerror = () => { for (const id of this.progress.keys()) if (!this.ready.has(id)) this.failed.set(id, 'the voice engine failed to start'); this.onChange?.(); };
        this.worker = w;
        for (const m of this.queue.splice(0)) w.postMessage(m);
      }).catch(() => { for (const id of this.progress.keys()) this.failed.set(id, 'the voice engine failed to load'); this.onChange?.(); });
    }
    const base = import.meta.env.BASE_URL;
    for (const id of ids) {
      if (this.progress.has(id) && !this.failed.has(id)) continue;
      this.failed.delete(id);
      this.progress.set(id, { loaded: 0, total: 0 });
      const m = VOICE_MODELS[id];
      this.post({ type: 'load', id, url: base + m.file, cfgUrl: base + m.cfg });
    }
    this.onChange?.();
  }
  synth(r: SynthRequest): Promise<SynthResult> {
    if (!this.ready.has(r.model)) return Promise.reject(new Error('model not ready'));
    const req = this.reqId++;
    return new Promise((ok, fail) => {
      this.pending.set(req, { ok, fail });
      this.post({ type: 'synth', req, ...r });
    });
  }
  private post(m: ToWorker) { if (this.worker) this.worker.postMessage(m); else this.queue.push(m); }
  private onMessage(m: FromWorker) {
    switch (m.type) {
      case 'progress': this.progress.set(m.id as ModelId, { loaded: m.loaded, total: m.total }); break;
      case 'ready': this.ready.add(m.id as ModelId); { const p = this.progress.get(m.id as ModelId); if (p) p.loaded = p.total; } break;
      case 'error': this.failed.set(m.id as ModelId, m.msg); break;
      case 'audio': { const p = this.pending.get(m.req); this.pending.delete(m.req); this.timings.push(m.ms); if (this.timings.length > 8) this.timings.shift(); p?.ok({ pcm: m.pcm, sr: m.sr, ms: m.ms }); return; }
      case 'fail': { const p = this.pending.get(m.req); this.pending.delete(m.req); p?.fail(new Error(m.msg)); return; }
      default: return;
    }
    this.onChange?.();
  }
}
