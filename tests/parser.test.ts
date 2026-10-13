import { describe, it, expect } from 'vitest';
import { parseShorthand, voiceToShorthand } from '../src/engine/parser';
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
describe('voice', () => {
  const tels = { DHK7: 'World Express seven', QTR8125: 'Qatari eight one two five' };
  it('turns phraseology into shorthand', () => {
    expect(voiceToShorthand('World Express seven turn left heading two five zero descend altitude four thousand feet reduce speed two one zero knots', tels, ['LIBVA']))
      .toBe('DHK7 L250 A40 S210');
    expect(voiceToShorthand('Qatari eight one two five descend to flight level six zero', tels, [])).toBe('QTR8125 FL060');
    expect(voiceToShorthand('Qatari 8125 cleared ILS approach runway two two left', tels, [])).toBe('QTR8125 ILS22L');
  });
});
