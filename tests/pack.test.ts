import { describe, it, expect } from 'vitest';
import { loadPack } from '../src/pack/load';
import { EBLG } from '../src/pack/eblg';
import { gcDistance, bearing } from '../src/geo';

const pack = loadPack(EBLG);
const ll = (id: string) => pack.fixes.get(id)!.ll;

describe('EBLG pack', () => {
  it('solved fixes agree with the AIP legs', () => {
    // GILOM, RUDIX, RITAX, GESLO, MAK and KOK are solved by least squares from every coded STAR leg
    // that touches them (tests/realism.test.ts checks all legs to 0.2 NM / 0.6°).
    // CIV7X codes CIV -> GILOM as 073.1°T, 37.5 NM
    expect(gcDistance(ll('CIV'), ll('GILOM'))).toBeCloseTo(37.5, 0);
    // CIV7D: CIV -> GSY 107.0°T 24.4 NM, both from AIP coordinates
    expect(gcDistance(ll('CIV'), ll('GSY'))).toBeCloseTo(24.4, 0);
    // GSY -> RUDIX 094.6°T 25.4 NM
    expect(gcDistance(ll('GSY'), ll('RUDIX'))).toBeCloseTo(25.4, 0);
    // GIREL -> RUDIX 300.4 19.6
    expect(gcDistance(ll('GIREL'), ll('RUDIX'))).toBeCloseTo(19.6, 0);
    // LNO -> GIREL 198.1 21.0 both AIP
    expect(gcDistance(ll('LNO'), ll('GIREL'))).toBeCloseTo(21.0, 0);
    // RITAX -> GIREL 316.0 14.7
    expect(gcDistance(ll('RITAX'), ll('GIREL'))).toBeCloseTo(14.7, 0);
    // NIK (ENR 2.1 arc centre) -> GSY 167.0 43.8
    expect(gcDistance(ll('NIK'), ll('GSY'))).toBeCloseTo(43.8, 1);
  });
  it('local projection bearings match AIP courses', () => {
    const p = (id: string) => pack.fixes.get(id)!.p;
    expect(bearing(p('ALHUV'), p('IPLAN'))).toBeCloseTo(345.2, 0);
    expect(bearing(p('LIBVA'), p('L22LF'))).toBeCloseTo(225.4, 0);
  });
  it('compiles procedures and airspace', () => {
    expect(pack.stars.length).toBe(10);
    expect(pack.transitions.length).toBe(8);
    expect(pack.sids.length).toBe(7);
    expect(pack.ctr.poly.length).toBeGreaterThan(10);
    expect(pack.tma.name).toBe('Liège TMA One');
    expect(pack.tmaParts!.length).toBe(5);
    expect(pack.tsas.map((t) => t.name)).toEqual(['TSA28A', 'TSA28B', 'TSA29A', 'TSA29B', 'TSA26B']);
  });
});
