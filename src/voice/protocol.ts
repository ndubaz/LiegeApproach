/** Messages between the main thread and the voice worker. */
export type ToWorker =
  | { type: 'load'; id: string; url: string; cfgUrl: string }
  | { type: 'synth'; req: number; model: string; sid?: number; text: string; espeak?: string; accent?: string; length?: number; noise?: number; noiseW?: number };

export type FromWorker =
  | { type: 'hello'; threads: number }
  | { type: 'progress'; id: string; loaded: number; total: number }
  | { type: 'ready'; id: string }
  | { type: 'error'; id: string; msg: string }
  | { type: 'audio'; req: number; pcm: Float32Array; sr: number; ms: number }
  | { type: 'fail'; req: number; msg: string };

/** The parts of a Piper .onnx.json the engine reads. */
export interface ModelConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  phoneme_id_map: Record<string, number[]>;
  speaker_id_map?: Record<string, number>;
}
