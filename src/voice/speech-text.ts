import { TELEPHONY, digits, telephony } from '../engine/clearance';

// Text for the voice engines. The sim's `speech` strings are already worded for pilots
// ("flight level eight zero"); intercom lines still carry codes ("FDX5240 FL080 22L").
// This turns both into what a controller or pilot would actually say, and respells the
// names a text-to-speech front end would otherwise misread (Liège, five-letter fixes).

/** Five-letter fixes as crews say them. Hard g is written "gh" so it is not read as "j". */
export const FIX_SAY: Record<string, string> = {
  ALHUV: 'Al-hoov', GILOM: 'Ghee-lom', GESLO: 'Guess-low', RUDIX: 'Roo-dix', RITAX: 'Ree-tax', IPLAN: 'Ee-plan',
  RERTI: 'Rare-tee', OLPUN: 'Ol-pun', GIKLI: 'Ghee-klee', LIBVA: 'Lib-vah', LAVTO: 'Lav-toe', LITPO: 'Lit-poe',
  OSTAT: 'Oh-stat', NEPIV: 'Neh-piv', EVSEN: 'Ev-sen', MAPUP: 'Mah-pup', TUTSO: 'Toot-so', ABLAZ: 'Ab-laz',
  PIZVE: 'Piz-veh', KAQZI: 'Kak-zee', GIREL: 'Ghee-rel', FOXHE: 'Fox-hay', WISKY: 'Whisky', NOVEM: 'November',
  SIERA: 'Sierra', NAMUR: 'Nah-moor', ROMEO: 'Romeo', INDIA: 'India', OSCAR: 'Oscar',
};
/** Place and unit names. */
const NAMES: [RegExp, string][] = [
  [/\bLi[eè]ge\b/gi, 'Leeyezh'],
  [/\bBeek\b/g, 'Bake'],
  [/\bMaastricht\b/g, 'Mah-strikt'],
  [/\bSteenokkerzeel\b/g, 'Stain-ocker-zail'],
  [/\bBierset\b/g, 'Beer-say'],
];
/** All-caps words that are said as words, not letters. */
const WORDS = new Set(['NATO', 'ATIS', 'ROGER', 'WILCO', 'MAYDAY', 'PAN', 'RADAR', 'TCAS', 'AMAN']);
const RWY_SIDE: Record<string, string> = { L: 'left', R: 'right', C: 'centre' };
const LETTER: Record<string, string> = Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => [c, digits(c)]));

const fixSay = (f: string) => FIX_SAY[f] ?? (f.length <= 3 ? f.split('').join(' ') : f[0] + f.slice(1).toLowerCase());
const numWords = (n: string) => digits(n.replace(/^0+(?=\d)/, ''));

export function spokenText(input: string): string {
  let s = input;
  for (const [re, to] of NAMES) s = s.replace(re, to);
  // callsigns in code form (intercom): QTR8125 -> Qatari eight one two five
  s = s.replace(/\b([A-Z]{3,5})(\d[A-Z0-9]{0,4})\b/g, (m, p: string) => (TELEPHONY[p] ? telephony(m) : m));
  // flight levels and runways
  s = s.replace(/\bFL\s?(\d{2,3})\b/g, (_m, n: string) => `flight level ${numWords(n)}`);
  s = s.replace(/\b(?:RWY|runway)\s*(\d{2})([LRC])?\b/gi, (_m, n: string, side?: string) => `runway ${digits(n)}${side ? ' ' + RWY_SIDE[side.toUpperCase()] : ''}`);
  s = s.replace(/\b(\d{2})([LRC])\b/g, (_m, n: string, side: string) => `${digits(n)} ${RWY_SIDE[side]}`);
  // procedures: KOK7X, LNO9S, ALHUV1A
  s = s.replace(/\b([A-Z]{3,5})(\d)([A-Z])\b/g, (_m, f: string, d: string, l: string) => `${fixSay(f)} ${digits(d)} ${LETTER[l]}`);
  // frequencies and long numbers digit by digit; "at 38" (minutes past) as digits
  s = s.replace(/\b(\d{3})\.(\d{1,3})\b/g, (_m, a: string, b: string) => `${digits(a)} decimal ${digits(b.replace(/0+$/, '') || '0')}`);
  s = s.replace(/\bat (\d{2})\b/g, (_m, n: string) => `at ${digits(n)}`);
  s = s.replace(/\b\d{3,}\b/g, (n) => digits(n));
  // five-letter fixes as words, short codes as letters
  s = s.replace(/\b[A-Z]{5}\b/g, (w) => (FIX_SAY[w] ? FIX_SAY[w] : WORDS.has(w) ? w : w));
  s = s.replace(/\b[A-Z]{2,4}\b/g, (w) => (WORDS.has(w) ? w : w.split('').join(' ')));
  // "niner" stays; tidy spacing and punctuation the phonemiser would read aloud
  return s.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
}
