/** Kept in its own module so it is only bundled where neural voices can run. */
export const makeVoiceWorker = () => new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
