import { describe, it, expect } from 'vitest';
import { matchCallsigns, parseShorthand, parseVoice, resolveCallsign, resolveFix, voiceToShorthand } from '../src/engine/parser';
import { unitTable } from '../src/engine/clearance';
import { loadPackById } from '../src/pack/index';
const ctx = { callsigns: ['DHK7', 'QTR8125', 'QTR8152', 'CHG201'], runway: '22L', tl: 55, fixes: new Set(['LIBVA', 'ALHUV', 'GIKLI']), transitions: new Set(['ALHUV1A']) };
describe('shorthand', () => {
  it('parses a three-part clearance', () => {
    const r = parseShorthand('DHK7 L250 D40 S210', ctx);
    expect(r.cs).toBe('DHK7');
    expect(r.items).toEqual([{ k: 'hdg', hdg: 250, dir: 'L' }, { k: 'lvl', lvl: { ft: 4000 } }, { k: 'spd', spd: 210, until: undefined }]);
  });
  it('uses flight levels above the transition level', () => {
    expect(parseShorthand('C80', ctx).items).toEqual([{ k: 'lvl', lvl: { fl: 80 } }]);
    expect(parseShorthand('A60', ctx).items).toEqual([{ k: 'lvl', lvl: { ft: 6000 } }]);
  });
  it('handles approach, direct, transfer and partial callsigns', () => {
    const r = parseShorthand('chg ALHUV1A ILS TWR', ctx);
    expect(r.cs).toBe('CHG201');
    expect(r.items.map((i) => i.k)).toEqual(['trans', 'app', 'xfr']);
    expect(parseShorthand('8125 DCT LIBVA', ctx).cs).toBe('QTR8125');
  });
  it('reports unknown tokens', () => { expect(parseShorthand('DHK7 ZZZ', ctx).errors.length).toBe(1); });
  it('parses departure releases', () => {
    const c = { ...ctx, callsigns: [...ctx.callsigns, 'CHG9598', 'QTR586'] };
    expect(parseShorthand('CHG9598 REL', c)).toEqual({ cs: 'CHG9598', items: [{ k: 'rel', after: undefined }], errors: [] });
    expect(parseShorthand('CHG9598 REL AFTER QTR586', c).items).toEqual([{ k: 'rel', after: 'QTR586' }]);
    expect(parseShorthand('CHG9598 REL/QTR586', c).items).toEqual([{ k: 'rel', after: 'QTR586' }]);
    expect(parseShorthand('CHG9598 REL H250 A50', c).items).toEqual([{ k: 'rel', after: undefined, hdg: 250, lvl: { ft: 5000 } }]);
    expect(parseShorthand('CHG9598 RH', c).items).toEqual([{ k: 'relhold', mins: undefined }]);
    expect(parseShorthand('CHG9598 RH3', c).items).toEqual([{ k: 'relhold', mins: 3 }]);
    expect(parseShorthand('CHG9598 REL HOLD 5', c).items).toEqual([{ k: 'relhold', mins: 5 }]);
  });
  it('parses break-off, ATIS and MIL transfer', () => {
    expect(parseShorthand('DHK7 BRK L040 A30', ctx).items).toEqual([{ k: 'brk' }, { k: 'hdg', hdg: 40, dir: 'L' }, { k: 'lvl', lvl: { ft: 3000 } }]);
    expect(parseShorthand('DHK7 ATIS', ctx).items).toEqual([{ k: 'atis' }]);
    expect(parseShorthand('DHK7 MIL', ctx).items).toEqual([{ k: 'xfr', unit: 'MIL' }]);
  });
});
describe('command line (2.0): fuzzy callsigns and fixes', () => {
  const css = ['DHK7', 'QTR8125', 'QTR8152', 'CHG201', 'TAY4EK', 'AZG7321', 'CLX7HK'];
  it('digits pick the aircraft when they fit one callsign', () => {
    expect(resolveCallsign('812', css)).toBe('QTR8125');
    expect(resolveCallsign('12', css)).toBe('QTR8125');
    expect(resolveCallsign('8152', css)).toBe('QTR8152');
    expect(resolveCallsign('201', css)).toBe('CHG201');
    expect(resolveCallsign('4ek', css)).toBe('TAY4EK');
    expect(resolveCallsign('7hk', css)).toBe('CLX7HK');
    expect(resolveCallsign('21', css)).toBe('AZG7321');
    expect(resolveCallsign('dhk', css)).toBe('DHK7');
  });
  it('refuses an ambiguous token rather than guessing', () => {
    expect(resolveCallsign('qtr', css)).toBeUndefined();
    expect(resolveCallsign('81', css)).toBeUndefined(); // 8125 and 8152 both start with 81
    expect(resolveCallsign('7', css)).toBeUndefined();  // one character
    expect(resolveCallsign('zz', css)).toBeUndefined();
  });
  it('ranks candidates for the live preview, best first', () => {
    expect(matchCallsigns('qtr', css)).toEqual(['QTR8125', 'QTR8152']);
    expect(matchCallsigns('81', css)).toEqual(['QTR8125', 'QTR8152']);
    expect(matchCallsigns('7', css)).toEqual([]);
    expect(matchCallsigns('7hk', css)[0]).toBe('CLX7HK');
  });
  it('fixes: exact, unique prefix, then the closest sound', () => {
    const fixes = new Set(['LIBVA', 'ALHUV', 'GIKLI', 'GILOM', 'GIREL', 'LNO', 'LG008']);
    expect(resolveFix('LIBVA', fixes)).toBe('LIBVA');
    expect(resolveFix('lib', fixes)).toBe('LIBVA');
    expect(resolveFix('gilo', fixes)).toBe('GILOM');
    expect(resolveFix('alhuf', fixes)).toBe('ALHUV');
    expect(resolveFix('gi', fixes)).toBeUndefined();   // GIKLI, GILOM, GIREL
    expect(resolveFix('l', fixes)).toBeUndefined();
    expect(resolveFix('zzzzz', fixes)).toBeUndefined();
  });
  it('the grammar is unchanged: digits-first callsign, fuzzy DCT and HOLD fixes, holdFix from the pack', () => {
    const c = { ...ctx, callsigns: css.filter((x) => x !== 'QTR8152'), fixes: new Set(['LIBVA', 'ALHUV', 'GIKLI', 'GILOM', 'GIREL']) };
    expect(parseShorthand('81 d70', c)).toEqual({ cs: 'QTR8125', items: [{ k: 'lvl', lvl: { fl: 70 } }], errors: [] });
    expect(parseShorthand('4ek s180', c)).toEqual({ cs: 'TAY4EK', items: [{ k: 'spd', spd: 180, until: undefined }], errors: [] });
    expect(parseShorthand('81 >lib', c).items).toEqual([{ k: 'dct', fix: 'LIBVA' }]);
    expect(parseShorthand('81 dct gilo', c).items).toEqual([{ k: 'dct', fix: 'GILOM' }]);
    const c2 = { ...c, callsigns: css };
    expect(parseShorthand('8152 hold gir a50', c2).items).toEqual([{ k: 'hold', fix: 'GIREL' }, { k: 'lvl', lvl: { ft: 5000 } }]);
    expect(parseShorthand('8152 hold a50', c2).items).toEqual([{ k: 'hold', fix: 'ALHUV' }, { k: 'lvl', lvl: { ft: 5000 } }]);
    expect(parseShorthand('8152 hold', { ...c2, holdFix: 'GIREL' }).items).toEqual([{ k: 'hold', fix: 'GIREL' }]);
    expect(parseShorthand('81 >zzz', c).errors).toEqual(['Unknown fix ZZZ']);
    // a command word is never taken for a callsign
    expect(parseShorthand('ILS', c).cs).toBeUndefined();
    expect(parseShorthand('S180', c).items).toEqual([{ k: 'spd', spd: 180, until: undefined }]);
  });
});
describe('voice', () => {
  const tels = { DHK7: 'World Express seven', QTR8125: 'Qatari eight one two five' };
  it('turns phraseology into shorthand', () => {
    expect(voiceToShorthand('World Express seven turn left heading two five zero descend altitude four thousand feet reduce speed two one zero knots', tels, ['LIBVA']))
      .toBe('DHK7 L250 A40 S210');
    expect(voiceToShorthand('Qatari eight one two five descend to flight level six zero', tels, [])).toBe('QTR8125 FL060');
    expect(voiceToShorthand('Qatari 8125 cleared ILS approach runway two two left', tels, [])).toBe('QTR8125 ILS22L');
  });
});
describe('a Düsseldorf context (2.0): units and the hold fix come from the pack', () => {
  const eddl = loadPackById('EDDL');
  const dus = { callsigns: ['ETD398', 'EWG12AB', 'DLH4KM'], runway: '23L', tl: 70, fixes: new Set(['BIKMU', 'DOMUX', 'HALME']), transitions: new Set<string>(), holdFix: 'BIKMU', units: unitTable(eddl) };
  it('ETD398 LANGEN hands the aircraft to the centre (ACC)', () => {
    expect(parseShorthand('ETD398 LANGEN', dus)).toEqual({ cs: 'ETD398', items: [{ k: 'xfr', unit: 'ACC' }], errors: [] });
    expect(parseShorthand('ETD398 ACC', dus).items).toEqual([{ k: 'xfr', unit: 'ACC' }]);
    expect(parseShorthand('ETD398 TOWER', dus).items).toEqual([{ k: 'xfr', unit: 'TWR' }]);
    expect(parseShorthand('ETD398 FRISBEE', dus).items).toEqual([{ k: 'xfr', unit: 'MIL' }]);
    expect(parseShorthand('ETD398 BRU', dus).errors).toEqual(['Unknown: BRU']);
  });
  it('a bare HOLD goes to BIKMU, and the voice path names the same fix', () => {
    expect(parseShorthand('ETD398 hold', dus).items).toEqual([{ k: 'hold', fix: 'BIKMU' }]);
    const v = parseVoice('Etihad three nine eight hold', { ...dus, tels: { ETD398: 'Etihad three nine eight' } });
    expect(v.shorthand).toBe('ETD398 HOLD');
    expect(v.unsure).toContain('hold: no fix heard, using BIKMU');
    expect(v.parse.items).toEqual([{ k: 'hold', fix: 'BIKMU' }]);
    const x = parseVoice('Etihad three nine eight contact Langen Radar one one nine decimal one one zero', { ...dus, tels: { ETD398: 'Etihad three nine eight' } });
    expect(x.shorthand).toBe('ETD398 ACC');
  });
});

describe('expect approach shorthand', () => {
  it('EXP ILS 23R, EXP 23R and EXP alone', () => {
    expect(parseShorthand('EXP ILS 23R', ctx).items).toEqual([{ k: 'expect', app: 'ILS', rwy: '23R' }]);
    expect(parseShorthand('EXP 23R', ctx).items).toEqual([{ k: 'expect', app: 'ILS', rwy: '23R' }]);
    expect(parseShorthand('EXP ILS23R D60', ctx).items).toEqual([{ k: 'expect', app: 'ILS', rwy: '23R' }, { k: 'lvl', lvl: { fl: 60 } }]);
    expect(parseShorthand('EXP', ctx).items).toEqual([{ k: 'expect', app: 'ILS', rwy: '22L' }]);
  });
});
