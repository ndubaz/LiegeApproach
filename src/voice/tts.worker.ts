/// <reference lib="webworker" />
// Neural pilot voices, off the main thread: espeak-ng phonemes (WebAssembly) feed a Piper
// VITS model run by onnxruntime-web. Models are downloaded once and kept in Cache Storage.
import * as ort from 'onnxruntime-web/wasm';
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import createPhonemize from './vendor/piper_phonemize.js';
import phonWasm from './vendor/piper_phonemize.wasm?url';
import phonData from './vendor/piper_phonemize.data?url';
import { accentPhonemes, phonemeIds, type AccentLang } from './accent';
import type { ToWorker, FromWorker, ModelConfig } from './protocol';

declare const self: DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => self.postMessage(m, transfer);

ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm } as any;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
ort.env.logLevel = 'error';

const CACHE = 'lgg-voices-v1';
const models = new Map<string, { cfg: ModelConfig; session: ort.InferenceSession }>();
const loading = new Map<string, Promise<void>>();

async function fetchCached(url: string, onProgress: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  let cache: Cache | undefined;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return await hit.arrayBuffer(); } catch { cache = undefined; }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0, lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.length;
    if (loaded - lastPost > 400_000) { lastPost = loaded; onProgress(loaded, total); }
  }
  const buf = new Uint8Array(loaded);
  let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  onProgress(loaded, total || loaded);
  try { await cache?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* quota: keep it in memory only */ }
  return buf.buffer;
}

function loadModel(id: string, url: string, cfgUrl: string) {
  if (models.has(id)) return Promise.resolve();
  let p = loading.get(id);
  if (p) return p;
  p = (async () => {
    const cfg = (await (await fetch(cfgUrl)).json()) as ModelConfig;
    const bytes = await fetchCached(url, (loaded, total) => post({ type: 'progress', id, loaded, total }));
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    models.set(id, { cfg, session });
    post({ type: 'ready', id });
  })().catch((e) => { loading.delete(id); post({ type: 'error', id, msg: String(e?.message ?? e) }); });
  loading.set(id, p);
  return p;
}

// espeak-ng keeps state between calls and slowly leaks, so the module is rebuilt every 40 phrases.
let phon: any, phonUses = 0, phonOut = '';
async function phonemize(text: string, voice: string): Promise<string[]> {
  if (!phon || phonUses >= 40) {
    phonUses = 0;
    phon = await createPhonemize({
      print: (d: string) => { phonOut = d; },
      printErr: () => {},
      locateFile: (u: string) => (u.endsWith('.wasm') ? phonWasm : u.endsWith('.data') ? phonData : u),
    });
  }
  phonUses++;
  phonOut = '';
  try { phon.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']); }
  catch { phon = undefined; throw new Error('phonemizer failed'); }
  if (!phonOut) { phon = undefined; throw new Error('phonemizer returned nothing'); }
  return JSON.parse(phonOut).phonemes as string[];
}

let chain = Promise.resolve();
self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'load') { void loadModel(m.id, m.url, m.cfgUrl); return; }
  if (m.type === 'synth') {
    // one synthesis at a time keeps latency predictable on phones
    chain = chain.then(async () => {
      try {
        const t0 = performance.now();
        await loading.get(m.model);
        const md = models.get(m.model);
        if (!md) throw new Error(`voice model ${m.model} not loaded`);
        const ph = accentPhonemes(await phonemize(m.text, m.espeak ?? md.cfg.espeak.voice), m.accent as AccentLang | undefined);
        const ids = phonemeIds(ph, md.cfg.phoneme_id_map);
        const inf = md.cfg.inference;
        const feeds: Record<string, ort.Tensor> = {
          input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
          input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
          scales: new ort.Tensor('float32', Float32Array.from([m.noise ?? inf.noise_scale, m.length ?? inf.length_scale, m.noiseW ?? inf.noise_w]), [3]),
        };
        if (md.session.inputNames.includes('sid')) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(m.sid ?? 0)]), [1]);
        const out = await md.session.run(feeds);
        const pcm = new Float32Array((out[md.session.outputNames[0]].data as Float32Array));
        post({ type: 'audio', req: m.req, pcm, sr: md.cfg.audio.sample_rate, ms: performance.now() - t0 }, [pcm.buffer]);
      } catch (err: any) {
        post({ type: 'fail', req: m.req, msg: String(err?.message ?? err) });
      }
    });
  }
};
post({ type: 'hello', threads: ort.env.wasm.numThreads as number });
