import { describe, expect, it } from 'vitest';
import { spokenText } from '../src/voice/speech-text';
import { accentPhonemes, phonemeIds } from '../src/voice/accent';
import { castFor, groupsFor, prefixOf, type Speaker } from '../src/voice/casting';
import { CAST_POOLS } from '../src/voice/cast-pools';
import { phrases } from '../src/voice/radio-fx';
import { VOICE_MODELS } from '../src/voice/neural';
import fs from 'fs';

describe('spoken text', () => {
  it('says intercom codes the way a controller does', () => {
    expect(spokenText('Liège, Brussels, estimate QTR8125, KOK7X, ALHUV at 38, FL080')).toBe(
      'Leeyezh, Brussels, estimate Qatari eight one two five, K O K seven X-ray, Al-hoov at three eight, flight level eight zero');
    expect(spokenText('Approach, Tower, request release FDX5240, LNO9S, runway 22L')).toBe(
      'Approach, Tower, request release FedEx five two four zero, L N O niner Sierra, runway two two left');
    expect(spokenText('Beek Approach 123.980')).toBe('Bake Approach one two three decimal niner eight');
  });
  it('leaves pilot speech alone apart from names', () => {
    const s = 'Liège Approach, Qatari eight one two five, flight level niner five descending flight level eight zero, K O K seven X-ray, information Lima';
    expect(spokenText(s)).toBe(s.replace('Liège', 'Leeyezh'));
    expect(spokenText('Challenge two zero one, request direct ALHUV')).toBe('Challenge two zero one, request direct Al-hoov');
    expect(spokenText('cleared ALHUV one Alfa transition, Q N H one zero one five')).toBe('cleared Al-hoov one Alfa transition, Q N H one zero one five');
  });
  it('spells short codes and keeps words that are said as words', () => {
    expect(spokenText('ATIS information Lima, ILS, NATO')).toBe('ATIS information Lima, I L S, NATO');
  });
});

describe('accent transfer', () => {
  it('swaps English-only sounds for the native ones', () => {
    // "the weather": ð ə w ɛ ð ɚ
    expect(accentPhonemes(['ð', 'ə', ' ', 'w', 'ɛ', 'ð', 'ɚ'], 'de').join('')).toBe('zə vɛzə');
    expect(accentPhonemes(['ð', 'ə', ' ', 'w', 'ɛ', 'ð', 'ɚ'], 'nl').join('')).toBe('də ʋɛdər');
    expect(accentPhonemes(['h', 'ə', 'l', 'o', 'ʊ'], 'fr').join('')).toBe('əlo');
    expect(accentPhonemes(['e', 'ɪ', 't'], 'de').join('')).toBe('eːt');
    expect(accentPhonemes(['ɡ', 'ɒ', 'l', 'f'], 'nl').join('')).toBe('ɣɔlf');
    expect(accentPhonemes(['a', 'b'])).toEqual(['a', 'b']);
  });
  it('builds Piper ids with pads and drops unknown symbols', () => {
    const map = { '^': [1], '_': [0], '$': [2], a: [14], b: [15] };
    expect(phonemeIds(['a', '?', 'b'], map)).toEqual([1, 0, 14, 0, 15, 0, 2]);
  });
});

describe('phrase streaming', () => {
  it('splits a call at commas without leaving tiny pieces', () => {
    expect(phrases('Leeyezh Approach, Qatari eight one two five, flight level niner five descending flight level eight zero, information Lima'))
      .toEqual(['Leeyezh Approach, Qatari eight one two five', 'flight level niner five descending flight level eight zero', 'information Lima']);
    expect(phrases('Roger, BCS5AB')).toEqual(['Roger, BCS5AB']);
    expect(phrases('Say again')).toEqual(['Say again']);
  });
});

describe('casting', () => {
  const all = new Set(Object.keys(VOICE_MODELS) as (keyof typeof VOICE_MODELS)[]);
  it('reads the airline from the callsign', () => {
    expect(prefixOf('QTR8125')).toBe('QTR');
    expect(prefixOf('TAY4EK')).toBe('TAY');
    expect(prefixOf('OOKLM')).toBe('OO');
    expect(prefixOf('NATO01')).toBe('NATO');
    expect(groupsFor('FDX5240')).toContain('us');
    expect(groupsFor('TWR')).toEqual(['fr']);
  });
  it('gives a flight the same voice every time, and different flights different voices', () => {
    if (!CAST_POOLS.length) return;
    expect(castFor('QTR8125', all)).toEqual(castFor('QTR8125', all));
    const voices = new Set(['QTR8125', 'QTR1', 'QTR77', 'QTR8001', 'QTR912', 'QTR3', 'QTR44'].map((cs) => castFor(cs, all)!.speaker.name));
    expect(voices.size).toBeGreaterThan(2);
  });
  it('casts by airline where the models have the accent', () => {
    if (!CAST_POOLS.length) return;
    for (const cs of ['FDX5240', 'UPS12', 'CKS220']) expect(['us', 'ca']).toContain(castFor(cs, all)!.speaker.group);
    for (const cs of ['ABR3JW', 'ABR9']) expect(['ie', 'uk']).toContain(castFor(cs, all)!.speaker.group);
  });
  it('falls back to what is loaded', () => {
    if (!CAST_POOLS.length) return;
    const only = new Set(['vctk'] as const);
    for (const cs of ['QTR8125', 'BCS5AB', 'CAO101', 'TWR']) expect(castFor(cs, only as any)!.speaker.model).toBe('vctk');
    expect(castFor('QTR1', new Set())).toBeUndefined();
  });
  it('only casts speakers that exist in the shipped model configs', () => {
    const maps: Record<string, Record<string, number>> = {};
    for (const [id, m] of Object.entries(VOICE_MODELS)) {
      const p = `public/${m.cfg}`;
      if (fs.existsSync(p)) maps[id] = JSON.parse(fs.readFileSync(p, 'utf8')).speaker_id_map;
    }
    for (const s of CAST_POOLS as Speaker[]) {
      expect(maps[s.model], `${s.model} config`).toBeTruthy();
      if (Object.keys(maps[s.model] ?? {}).length) expect(maps[s.model][s.name], `${s.name} in ${s.model}`).toBe(s.sid); else expect(s.sid).toBe(0);
    }
  });
});
