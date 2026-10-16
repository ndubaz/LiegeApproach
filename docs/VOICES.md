# Radio voices

Pilots, Tower, Brussels and the other units speak with neural voices generated in the
browser, played through a simulated VHF radio. Nothing is sent to a server: the models
download once (about 60 MB) and run on the player's device.

## How it works

1. **Text.** `src/voice/speech-text.ts` turns the sim's transmissions into what a pilot
   or controller would say: callsign codes into telephony (QTR8125 → "Qatari eight one
   two five"), FL080 → "flight level eight zero", 22L → "two two left", procedure codes
   (KOK7X → "K O K seven X-ray"), five-letter fixes into the way crews say them (ALHUV →
   "Al-hoov"), and Liège into "Lee-yezh".
2. **Phonemes.** espeak-ng, compiled to WebAssembly (the Piper phonemizer), converts the
   text to IPA. Only the English data is shipped (1 MB of the original 18 MB).
3. **Accent.** German speakers use a German voice model driven by English phonemes.
   Piper models share one phoneme table, so this works without retraining. Sounds German
   lacks are swapped for the nearest native sound (`src/voice/accent.ts`): θ → s, w → v,
   æ → ɛ. That is how a real accent forms. The same trick was tried for Dutch, Flemish and
   French models and failed (below), so Belgian, Dutch and French crews speak with British
   and Irish voices for now.
4. **Speech.** onnxruntime-web runs the Piper VITS model in a Web Worker
   (`src/voice/tts.worker.ts`). Multi-threaded where the page is cross-origin isolated
   (`vercel.json` sends the headers), single-threaded otherwise.
5. **Radio.** `src/voice/radio-fx.ts` builds the sound in WebAudio: key-up click, speech
   band-limited to about 330–2,900 Hz, a presence peak, the aircraft's slightly
   overdriven audio, a compressor, carrier hiss whose level follows signal strength
   (distance and radio horizon), slow fading on weak signals, and the squelch tail when
   the carrier drops. The controller's own voice is cleaner; intercom lines sound like
   a telephone and sit slightly to the left.
6. **Timing.** The sim tells the radio when a pilot call is scheduled (`Sim.onQueue`),
   so readbacks are synthesized while the controller is still talking and start on
   time. Calls are split into phrases at commas; the first phrase plays while the rest
   are generated.

## Casting

`src/voice/casting.ts` maps each airline to the accents its crews plausibly have (a
Qatar crew is as likely Indian or Arab as British; FedEx American; ASL Ireland Irish;
ASL Belgium British or Irish until a Belgian voice exists), then picks a speaker by the callsign's hash, so a flight
keeps one voice, pace and radio character for the whole shift. One flight in six gets a
woman's voice where the accent group has one. Units: Tower and the supervisor are
Belgian, Beek is Dutch, Maastricht is German or Dutch.

Every speaker in `src/voice/cast-pools.ts` passed an intelligibility audition: four
real pilot transmissions synthesized at the speaker's final pace and transcribed by
Whisper (small.en, prompted with ATC vocabulary as a controller would be). Speakers the
recogniser could not follow were left out. Results are in the pool file.

The prompted audition overstates intelligibility: it let Whisper guess the structure of
a call. A second check without the prompt, on short phrases such as "Qatari eight one
two five", showed that the multi-speaker Dutch, German and French models (Multilingual
LibriSpeech) and the single-speaker Flemish and French ones loop or babble on English
phonemes, whatever the accent substitution. Only Thorsten (German) read them cleanly.
The VCTK and L2-ARCTIC voices passed both checks. That is why 2.0 ships three models,
not six, and why Walloon, Flemish and Dutch crews have no accent of their own yet.

## Model files

Each model's weights are stored as 8-bit integers with a per-channel scale
(weight-only quantization; the maths stays in 32-bit floating point). That cuts each
model from 63–77 MB to about 20 MB. Time-aligned spectral difference from the original
model: 0.7 dB, against about 3 dB between two runs of the original with normal
randomness. Recognition error was the same (29.2 % against 29.0 %).

Dynamic 8-bit quantization (integer maths) was tried and rejected: 4.4 dB difference
and four to eight times slower on CPU.

## Persistence and limits

- Models are kept in Cache Storage (`lgg-voices-v1`), per browser. Safari may clear
  storage for sites not added to the home screen after a few weeks without use; the
  game then downloads them again. Settings has "Remove download".
- The download starts with the first session unless the browser reports a data-saver
  connection. Until it finishes, the device's own voices stand in (novelty voices are
  filtered out and accents are matched where the device has them).
- The single-file preview build (the Claude artifact) does not include the neural
  voices; it uses the device's voices.

## Credits and licences

| Part | Source | Licence |
|---|---|---|
| British, Irish, Scottish, American, Indian voices | Piper `en_GB-vctk-medium`, trained on the CSTR VCTK Corpus (University of Edinburgh) | CC BY 4.0 |
| Arabic, Hindi, Mandarin, Korean, Spanish, Vietnamese accented voices | Piper `en_US-l2arctic-medium`, trained on L2-ARCTIC (Texas A&M) | CC BY-NC 4.0: **non-commercial use only** |
| German speaker | Piper `de_DE-thorsten-medium`, Thorsten Müller's voice dataset | CC0 1.0 |
| Phonemizer | espeak-ng via `@diffusionstudio/piper-wasm` 1.0.0 (source: github.com/diffusionstudio/piper-wasm and github.com/espeak-ng/espeak-ng) | GPL-3.0 (espeak-ng), MIT (wrapper) |
| Inference | onnxruntime-web 1.29.0 | MIT |
| Voice models | Piper by Michael Hansen (rhasspy/piper-voices) | MIT (code), dataset licences above |

If this project is ever sold or monetised, the L2-ARCTIC voices must be removed or
replaced.
