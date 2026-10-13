import { describe, it, expect } from 'vitest';
import { parseShorthand, parseVoice, parseVoiceAlternatives, soundKey, type VoiceCtx } from '../src/engine/parser';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { telephony } from '../src/engine/clearance';
import { Mic, type RecLike } from '../src/ui/audio';

const pack = loadPack(EBLG);
const callsigns = ['QTR8125', 'QTR8152', 'CHG201', 'TAY4EK', 'FDX5071', 'ETH3721', 'DHK7', 'THY6043', 'CLX793', 'CKS231', 'AZG7311', 'BAF51', 'OOABC', 'CHG9598', 'QTR586'];
const ctx: VoiceCtx = {
  callsigns, runway: '22L', tl: 55,
  fixes: new Set(pack.fixes.keys()), transitions: new Set(pack.transitions.map((t) => t.name)), stars: new Set(pack.stars.map((s) => s.name)),
  tels: Object.fromEntries(callsigns.map((c) => [c, telephony(c)])),
};

// [what the recogniser wrote, expected shorthand]. Includes the slips Chrome and Safari make on radio speech.
const CORPUS: [string, string][] = [
  // headings
  ['Qatari eight one two five turn left heading two five zero', 'QTR8125 L250'],
  ['Qatar 8125 turn right heading 360', 'QTR8125 R360'],
  ['Qatari 8152 fly heading one eight zero', 'QTR8152 H180'],
  ['challenge two zero one turn left heading to 70', 'CHG201 L270'],
  ['Challenge 201 heading two fifty', 'CHG201 H250'],
  ['cutter eight one two five turn left heading zero four zero', 'QTR8125 L040'],
  ['Qatari 8125 turn right heading 0 9 0 descend 4000 feet', 'QTR8125 R090 A40'],
  ['Ethiopian three seven two one turn left heading three one zero', 'ETH3721 L310'],
  // levels
  ['Qatari eight one two five descend flight level seven zero', 'QTR8125 FL070'],
  ['Qatari 8125 descend to flight level 70', 'QTR8125 FL070'],
  ['Qatari 8125 descend FL 80', 'QTR8125 FL080'],
  ['Challenge two zero one descend altitude four thousand feet QNH one zero one three', 'CHG201 A40'],
  ['challenge 201 descend to 3000 ft QNH 1013', 'CHG201 A30'],
  ['Challenge 201 descend three thousand five hundred feet', 'CHG201 A35'],
  ['Fedex five zero seven one climb flight level one two zero', 'FDX5071 FL120'],
  ['FedEx 5071 climb to flight level niner zero', 'FDX5071 FL090'],
  ['fed ex 5 0 7 1 maintain flight level six zero', 'FDX5071 FL060'],
  ['Turkish six zero four three descend to four thousand', 'THY6043 A40'],
  ['Turkish 6043 descend to five thousand', 'THY6043 A50'],
  ['World Express seven descend altitude tree thousand feet', 'DHK7 A30'],
  ['Cargolux seven niner tree descend flight level fife zero', 'CLX793 FL050'],
  ['cargo lux 793 climb flight level one one zero', 'CLX793 FL110'],
  // speed
  ['Qatari 8125 reduce speed one eight zero knots', 'QTR8125 S180'],
  ['Qatari eight one two five reduce speed to one six zero knots until four miles', 'QTR8125 S160/4'],
  ['Qatari 8125 one six zero knots until 4 DME', 'QTR8125 S160/4'],
  ['Qatari 8125 speed two one zero', 'QTR8125 S210'],
  ['Quality four echo kilo reduce speed two twenty knots', 'TAY4EK S220'],
  ['Qatari 8125 reduce minimum clean speed', 'QTR8125 SMIN'],
  ['Qatari 8125 resume normal speed', 'QTR8125 SRES'],
  ['Qatari 8125 no speed restriction', 'QTR8125 SRES'],
  ['Challenge 201 reduce speed 180 knots until for miles', 'CHG201 S180/4'],
  // multi-part
  ['World Express seven turn left heading two five zero descend altitude four thousand feet reduce speed two one zero knots', 'DHK7 L250 A40 S210'],
  ['Qatari 8125 turn right heading 220 descend 3000 feet reduce speed 180 knots', 'QTR8125 R220 A30 S180'],
  ['Challenge 201 descend flight level 70 reduce speed 220 knots', 'CHG201 FL070 S220'],
  // direct and holds
  ['Qatari 8125 proceed direct ALHUV', 'QTR8125 DCT ALHUV'],
  ['Qatari 8125 direct al who\'ve', 'QTR8125 DCT ALHUV'],
  ['Qatari 8125 direct alpha lima hotel uniform victor', 'QTR8125 DCT ALHUV'],
  ['Challenge 201 proceed direct gilom descend flight level 60', 'CHG201 DCT GILOM FL060'],
  ['Ethiopian 3721 direct to Libva', 'ETH3721 DCT LIBVA'],
  ['Turkish 6043 hold at ALHUV', 'THY6043 HOLD ALHUV'],
  ['Turkish six zero four three hold over al huv as published', 'THY6043 HOLD ALHUV'],
  ['Qatari 8125 proceed direct Rudix', 'QTR8125 DCT RUDIX'],
  // approaches and procedures
  ['Qatari 8125 cleared ILS approach runway two two left', 'QTR8125 ILS22L'],
  ['Qatari 8125 cleared I L S approach runway 22 left', 'QTR8125 ILS22L'],
  ['Qatari eight one two five cleared eye L S two two left', 'QTR8125 ILS22L'],
  ['Challenge 201 cleared RNP approach runway two two right', 'CHG201 RNP22R'],
  ['Challenge 201 cleared visual approach runway zero four left', 'CHG201 VIS04L'],
  ['Qatari 8125 turn left heading 250 vectoring for ILS approach runway 22 left', 'QTR8125 L250'],
  ['Qatari 8125 cleared alpha lima hotel uniform victor one alpha transition', 'QTR8125 ALHUV1A'],
  ['Qatari 8125 cleared ALHUV one A transition', 'QTR8125 ALHUV1A'],
  ['Qatari 8125 cleared ALHUV 1B transition descend 3000 feet', 'QTR8125 ALHUV1B A30'],
  ['Ethiopian 3721 cleared kok seven delta arrival', 'ETH3721 STAR KOK7D'],
  ['Ethiopian 3721 cleared Koksy seven delta arrival', 'ETH3721 STAR KOK7D'],
  // transfers
  ['Qatari 8125 contact Tower one one eight decimal one three zero', 'QTR8125 TWR'],
  ['Qatari 8125 contact tower 118.13 good night', 'QTR8125 TWR'],
  ['Qatari 8125 contact one one eight decimal one three', 'QTR8125 TWR'],
  ['Fedex 5071 contact Brussels control one three one decimal one', 'FDX5071 BRU'],
  ['Fedex 5071 contact Maastricht one three two decimal seven five five', 'FDX5071 MUAC'],
  ['Belgian air force five one contact military', 'BAF51 MIL'],
  // short calls
  ['Qatari 8125 roger', 'QTR8125 R'],
  ['Qatari 8125 identified', 'QTR8125 R'],
  ['Qatari 8125 radar contact', 'QTR8125 R'],
  ['Qatari 8125 stand by', 'QTR8125 SB'],
  ['Qatari 8125 say again', 'QTR8125 SA'],
  ['Challenge 201 approved', 'CHG201 Y'],
  ['Challenge 201 unable', 'CHG201 N'],
  ['Qatari 8125 squawk four five two one', 'QTR8125 SQ4521'],
  ['Qatari 8125 resume own navigation', 'QTR8125 RON'],
  ['Qatari 8125 cancel approach clearance turn left heading 040 climb 3000 feet', 'QTR8125 BRK L040 A30'],
  ['Qatari 8125 information kilo now current QNH 1013', 'QTR8125 ATIS'],
  // releases (intercom)
  ['Challenge nine five nine eight released', 'CHG9598 REL'],
  ['Challenge 9598 released after Qatari five eight six', 'CHG9598 REL AFTER QTR586'],
  ['Challenge 9598 hold expect release in three minutes', 'CHG9598 RH3'],
  // corrections
  ['Qatari 8125 descend flight level 70 correction flight level 80', 'QTR8125 FL080'],
  ['Qatari 8125 correction turn right heading 270', 'QTR8125 CORR R270'],
  // callsign shapes and recogniser slips
  ['Tayaran four echo kilo descend flight level 70', 'TAY4EK FL070'],
  ['TNT 4 echo kilo turn left heading 180', 'TAY4EK L180'],
  ['Oscar Oscar alpha bravo charlie squawk 7000', 'OOABC SQ7000'],
  ['Connie two three one descend flight level eight zero', 'CKS231 FL080'],
  ['Silk West 7311 reduce speed 200 knots', 'AZG7311 S200'],
  ['Challenger two oh one descend flight level 60', 'CHG201 FL060'],
  ['Qatari 8 1 2 5 descend 4000', 'QTR8125 A40'],
  ['quote are eight one two five descend flight level seven zero', 'QTR8125 FL070'],
  ['Qatari eight one two five one six zero knots', 'QTR8125 S160'],
  ['Ethiopia 3721 turn right heading 1 2 0', 'ETH3721 R120'],
  ['Turkey 6043 climb flight level 1 4 0', 'THY6043 FL140'],
  ['world express 7 contact tower', 'DHK7 TWR'],
  // harder recogniser output
  ['Qatari 8125 descend flight level seventy', 'QTR8125 FL070'],
  ['Qatari 8125 turn left heading two five oh', 'QTR8125 L250'],
  ['Qatari 8125 decent flight level 70', 'QTR8125 FL070'],
  ['Qatari 8125 climb and maintain flight level 100', 'QTR8125 FL100'],
  ['Qatari 8125 climb flight level one hundred', 'QTR8125 FL100'],
  ['Qatari 8125 turn left heading 250 and descend to 4000 ft', 'QTR8125 L250 A40'],
  ['Qatari 8125 heading 2:50', 'QTR8125 H250'],
  ['Qatari 8125 contact tower 118 point 13', 'QTR8125 TWR'],
  ['Fedex 5071 descend altitude 3,000 feet', 'FDX5071 A30'],
  ['Qatari 8125 reduce speed one eight zero knots until five mile final', 'QTR8125 S180/5'],
  ['Qatari 8125 hold at Alhuv expect approach clearance at 2235', 'QTR8125 HOLD ALHUV'],
  ['Qatari 8125 turned left heading 250', 'QTR8125 L250'],
  ['QTR 8125 descend FL70', 'QTR8125 FL070'],
  ['Qatari 8125 turn right heading two two zero descend to altitude three thousand feet QNH one zero one two cleared ILS approach runway two two left', 'QTR8125 R220 A30 ILS22L'],
  ['Turkish 6043 expedite descent flight level 70', 'THY6043 FL070'],
  ['Qatari 8125 reduce speed one hundred eighty knots', 'QTR8125 S180'],
  ['Qatari 8125 dissent to flight level 60', 'QTR8125 FL060'],
  ['Qatari 8125 turn left heading too five zero', 'QTR8125 L250'],
  ['Qatari 8125 descend for thousand', 'QTR8125 A40'],
  ['Qatari 8125 squawk 4521', 'QTR8125 SQ4521'],
  ['Challenge 201 good evening identified descend flight level 70', 'CHG201 R FL070'],
  ['Challenge 201 continue present heading descend flight level 70', 'CHG201 FL070'],
  ['Qatari eight one to five turn left heading one niner zero', 'QTR8125 L190'],
];

describe('voice corpus', () => {
  it(`has at least 60 transcripts (${CORPUS.length})`, () => { expect(CORPUS.length).toBeGreaterThanOrEqual(60); });
  const misses: string[] = [];
  for (const [said, want] of CORPUS) {
    const r = parseVoice(said, ctx);
    if (r.shorthand !== want) misses.push(`${said} → ${r.shorthand} (want ${want}) [${r.heard}]`);
  }
  const acc = 1 - misses.length / CORPUS.length;
  it(`parses at least 90% exactly (${Math.round(acc * 1000) / 10}%)`, () => {
    if (misses.length) console.log('voice misses:\n' + misses.join('\n'));
    expect(acc).toBeGreaterThanOrEqual(0.9);
  });
  it('most exact parses are confident enough to send without asking', () => {
    const low = CORPUS.map(([s]) => parseVoice(s, ctx)).filter((r) => r.confidence < 0.75);
    if (low.length) console.log('low confidence:\n' + low.map((r) => `${r.heard} → ${r.shorthand} ${r.confidence} ${r.unsure.join('; ')}`).join('\n'));
    expect(low.length / CORPUS.length).toBeLessThan(0.2);
  });
  it('every exact parse is valid shorthand', () => {
    for (const [said, want] of CORPUS) {
      const r = parseVoice(said, ctx);
      if (r.shorthand === want) expect(r.parse.errors, said).toEqual([]);
    }
  });
});

describe('voice confidence and unsure', () => {
  it('is confident on a clean call', () => {
    const r = parseVoice('Qatari eight one two five descend flight level seven zero', ctx);
    expect(r.cs).toBe('QTR8125');
    expect(r.confidence).toBeGreaterThan(0.85);
    expect(r.unsure).toEqual([]);
  });
  it('flags two close callsigns', () => {
    const r = parseVoice('Qatari eight one five descend flight level seven zero', ctx);
    expect(r.confidence).toBeLessThan(0.75);
    expect(r.unsure.some((u) => u.startsWith('callsign'))).toBe(true);
  });
  it('says what it ignored', () => {
    const r = parseVoice('Qatari 8125 descend flight level 70 banana', ctx);
    expect(r.shorthand).toBe('QTR8125 FL070');
    expect(r.unsure.join(' ')).toContain('banana');
    expect(r.confidence).toBeLessThan(1);
  });
  it('flags a fuzzy fix', () => {
    const r = parseVoice('Qatari 8125 direct al hoof', ctx);
    expect(r.shorthand).toBe('QTR8125 DCT ALHUV');
    expect(r.unsure.some((u) => u.startsWith('fix'))).toBe(true);
  });
  it('uses the selected aircraft when no callsign is said', () => {
    const r = parseVoice('descend flight level seven zero', { ...ctx, selected: 'QTR8125' });
    expect(r.cs).toBeUndefined();
    expect(r.shorthand).toBe('FL070');
    expect(r.confidence).toBeGreaterThan(0.8);
    expect(parseVoice('descend flight level seven zero', ctx).unsure).toContain('callsign: none heard');
  });
  it('a callsign alone is a selection, not a confident order', () => {
    const r = parseVoice('Qatari 8125', ctx);
    expect(r.shorthand).toBe('QTR8125');
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });
  it('a callsign said last is still found', () => {
    expect(parseVoice('descend flight level 70 Qatari 8125', ctx).shorthand).toBe('QTR8125 FL070');
  });
  it('empty speech is zero confidence', () => {
    expect(parseVoice('', ctx)).toMatchObject({ shorthand: '', confidence: 0 });
  });
  it('picks the best alternative', () => {
    const r = parseVoiceAlternatives(['cut her ate one to five dissent flight level seven zero', 'Qatari 8125 descend flight level 70'], ctx);
    expect(r.shorthand).toBe('QTR8125 FL070');
  });
  it('to and for stay prepositions before numbers', () => {
    expect(parseVoice('Qatari 8125 descend to four thousand', ctx).shorthand).toBe('QTR8125 A40');
    expect(parseVoice('Qatari 8125 reduce speed to one eight zero knots', ctx).shorthand).toBe('QTR8125 S180');
  });
  it('sound key brings near spellings together', () => {
    expect(soundKey("alwhove")).toBe(soundKey('alhuv'));
    expect(soundKey('coxy')).toBe(soundKey('koksy'));
  });
});

describe('shorthand additions', () => {
  it('SA is say again', () => {
    const r = parseShorthand('QTR8125 SA', ctx);
    expect(r.errors).toEqual([]);
    expect(r.items).toEqual([]);
    expect(r.ext).toEqual([{ k: 'sayagain' }]);
  });
  it('CORR is a flag, not an item', () => {
    const r = parseShorthand('QTR8125 CORR FL080', ctx);
    expect(r.correction).toBe(true);
    expect(r.items).toEqual([{ k: 'lvl', lvl: { fl: 80 } }]);
    expect(parseShorthand('QTR8125 FL080', ctx).correction).toBeUndefined();
  });
  it('STAR names a STAR', () => {
    expect(parseShorthand('ETH3721 STAR KOK7D', ctx).ext).toEqual([{ k: 'star', name: 'KOK7D' }]);
    expect(parseShorthand('ETH3721 KOK7D', ctx).ext).toEqual([{ k: 'star', name: 'KOK7D' }]);
    expect(parseShorthand('ETH3721 STAR ZZZ9Z', ctx).errors.length).toBe(1);
    const noStars = { ...ctx, stars: undefined };
    expect(parseShorthand('ETH3721 STAR KOK7D', noStars).ext).toEqual([{ k: 'star', name: 'KOK7D' }]);
  });
  it('old results keep their shape', () => {
    expect(parseShorthand('QTR8125 L250', ctx)).toEqual({ cs: 'QTR8125', items: [{ k: 'hdg', hdg: 250, dir: 'L' }], errors: [] });
  });
});

// ---------------- Mic (speech recognition wrapper) with a fake recogniser ----------------

class FakeRec implements RecLike {
  lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
  onresult: ((e: any) => void) | null = null; onerror: ((e: any) => void) | null = null; onend: (() => void) | null = null;
  started = 0; stopped = 0; aborted = 0;
  start() { this.started++; }
  stop() { this.stopped++; }
  abort() { this.aborted++; }
  say(parts: { t: string[]; final: boolean }[]) {
    const results = parts.map((p) => Object.assign(p.t.map((transcript) => ({ transcript })), { isFinal: p.final }));
    this.onresult?.({ resultIndex: 0, results });
  }
}
function micRig() {
  const recs: FakeRec[] = [];
  const clicks: string[] = [];
  const mic = new Mic({ factory: () => { const r = new FakeRec(); recs.push(r); return r; }, radio: { pttDown: () => clicks.push('down'), pttUp: () => clicks.push('up') }, finalizeMs: 20 });
  const got: { interim: string[]; final?: [string, string[]]; err?: [string, string] } = { interim: [] };
  const h = { onInterim: (t: string) => got.interim.push(t), onFinal: (t: string, a: string[]) => { got.final = [t, a]; }, onError: (c: string, m: string) => { got.err = [c, m]; } };
  return { mic, recs, clicks, got, h };
}

describe('Mic', () => {
  it('streams interim text and finalises once on release, with a click each way', () => {
    const r = micRig();
    r.mic.lang = 'en-US';
    r.mic.begin(r.h);
    expect(r.recs[0]).toMatchObject({ lang: 'en-US', continuous: true, interimResults: true, started: 1 });
    r.recs[0].say([{ t: ['Qatari eight'], final: false }]);
    r.recs[0].say([{ t: ['Qatari 8125', 'cutter 8125'], final: true }, { t: ['descend'], final: false }]);
    expect(r.got.interim).toEqual(['Qatari eight', 'Qatari 8125 descend']);
    expect(r.mic.listening).toBe(true);
    r.mic.end();
    expect(r.recs[0].stopped).toBe(1);
    r.recs[0].say([{ t: ['Qatari 8125', 'cutter 8125'], final: true }, { t: ['descend flight level 70'], final: true }]);
    r.recs[0].onend!();
    expect(r.got.final).toEqual(['Qatari 8125 descend flight level 70', ['Qatari 8125 descend flight level 70', 'cutter 8125 descend flight level 70']]);
    expect(r.clicks).toEqual(['down', 'up']);
    expect(r.mic.listening).toBe(false);
  });
  it('keeps listening when the browser ends a session while the key is held', () => {
    const r = micRig();
    r.mic.begin(r.h);
    r.recs[0].say([{ t: ['Qatari 8125'], final: true }]);
    r.recs[0].onerror!({ error: 'no-speech' });
    r.recs[0].onend!();
    expect(r.recs.length).toBe(2);
    expect(r.got.final).toBeUndefined();
    r.recs[1].say([{ t: ['descend flight level 70'], final: false }]);
    r.mic.end();
    r.recs[1].onend!();
    expect(r.got.final?.[0]).toBe('Qatari 8125 descend flight level 70');
  });
  it('gives up waiting for the recogniser and uses what it has', async () => {
    const r = micRig();
    r.mic.begin(r.h);
    r.recs[0].say([{ t: ['Qatari 8125 roger'], final: false }]);
    r.mic.end();
    await new Promise((res) => setTimeout(res, 40));
    expect(r.got.final?.[0]).toBe('Qatari 8125 roger');
    expect(r.recs[0].aborted).toBe(1);
  });
  it('abort delivers nothing', () => {
    const r = micRig();
    r.mic.begin(r.h);
    r.recs[0].say([{ t: ['Qatari'], final: true }]);
    r.mic.abort();
    r.recs[0].onend?.();
    expect(r.got.final).toBeUndefined();
    expect(r.recs[0].aborted).toBe(1);
  });
  it('reports a refused microphone once and remembers it', () => {
    const r = micRig();
    r.mic.begin(r.h);
    r.recs[0].onerror!({ error: 'not-allowed' });
    expect(r.got.err?.[0]).toBe('denied');
    expect(r.mic.permission).toBe('denied');
    r.got.err = undefined;
    r.mic.begin(r.h);
    expect(r.got.err?.[0]).toBe('denied');
    expect(r.recs.length).toBe(1);
  });
  it('reports no support', () => {
    const got: string[] = [];
    const mic = new Mic({ factory: () => undefined });
    mic.begin({ onFinal: () => got.push('final'), onError: (c) => got.push(c) });
    expect(got).toEqual(['unsupported']);
  });
  it('a quick re-key delivers the previous transmission first', () => {
    const r = micRig();
    const finals: string[] = [];
    r.mic.begin({ onFinal: (t) => finals.push(t) });
    r.recs[0].say([{ t: ['Qatari 8125 roger'], final: true }]);
    r.mic.end();
    r.mic.begin({ onFinal: (t) => finals.push(t) });
    expect(finals).toEqual(['Qatari 8125 roger']);
    r.recs[0].onend?.();
    expect(finals).toEqual(['Qatari 8125 roger']);
  });
  it('the legacy start/stop API still works', () => {
    const r = micRig();
    const seen: [string, boolean][] = [];
    r.mic.start((t, f) => seen.push([t, f]), () => {});
    r.recs[0].say([{ t: ['Qatari 8125'], final: true }]);
    r.mic.stop();
    r.recs[0].onend!();
    expect(seen).toEqual([['Qatari 8125', false], ['Qatari 8125', true]]);
  });
});
