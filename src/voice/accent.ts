// Accent transfer: English phonemes spoken by a Dutch, German or French voice model.
// Piper models share one phoneme table, so English phonemes can drive a model trained
// on another language. Sounds that language never has are swapped for the nearest
// native sound, which is exactly how a real accent forms (θ -> s, w -> v, dropped h).

export type AccentLang = 'de' | 'fr' | 'nl';

const SUB: Record<AccentLang, Record<string, string[]>> = {
  de: { θ: ['s'], ð: ['z'], w: ['v'], æ: ['ɛ'], ʌ: ['a'], ɚ: ['ə'], ɹ: ['r'], ɾ: ['t'], ᵻ: ['ɪ'], ɐ: ['a'], ɒ: ['ɔ'] },
  fr: { θ: ['s'], ð: ['z'], h: [], ɹ: ['ʁ'], ɾ: ['t'], æ: ['a'], ʌ: ['œ'], ɚ: ['œ', 'ʁ'], ɜ: ['œ'], ɐ: ['a'], ɪ: ['i'], ʊ: ['u'], ᵻ: ['i'], ɒ: ['ɔ'] },
  nl: { θ: ['t'], ð: ['d'], w: ['ʋ'], ɹ: ['r'], ɾ: ['t'], æ: ['ɛ'], ʌ: ['ɑ'], ɚ: ['ə', 'r'], ɜ: ['ø'], ɐ: ['ɑ'], ɒ: ['ɔ'], ᵻ: ['ɪ'], ɡ: ['ɣ'] },
};
const DIPH: Record<AccentLang, [string, string, string[]][]> = {
  de: [['e', 'ɪ', ['e', 'ː']], ['o', 'ʊ', ['o', 'ː']]],
  fr: [['e', 'ɪ', ['e']], ['o', 'ʊ', ['o']], ['a', 'ɪ', ['a', 'j']], ['ɔ', 'ɪ', ['ɔ', 'j']], ['a', 'ʊ', ['a', 'u']]],
  nl: [['e', 'ɪ', ['e', 'ː']], ['o', 'ʊ', ['o', 'ː']]],
};

export function accentPhonemes(ph: string[], lang?: AccentLang): string[] {
  if (!lang) return ph;
  const sub = SUB[lang], diph = DIPH[lang];
  const out: string[] = [];
  for (let i = 0; i < ph.length; i++) {
    const d = diph.find(([a, b]) => ph[i] === a && ph[i + 1] === b);
    if (d) { out.push(...d[2]); i++; continue; }
    out.push(...(sub[ph[i]] ?? [ph[i]]));
  }
  return out;
}

/** Piper input ids: BOS, then each phoneme followed by the pad id, then EOS. Unknown symbols are dropped. */
export function phonemeIds(ph: string[], map: Record<string, number[]>): number[] {
  const pad = map['_']?.[0] ?? 0;
  const ids = [map['^']?.[0] ?? 1, pad];
  for (const p of ph) { const id = map[p]; if (id) ids.push(id[0], pad); }
  ids.push(map['$']?.[0] ?? 2);
  return ids;
}
