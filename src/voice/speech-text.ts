import { TELEPHONY, digits, telephony } from '../engine/clearance';
import type { Pack } from '../pack/load';

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
/** Place and unit names (Liège's; a pack's `fixSay` entries with lower-case letters replace them). */
const NAMES: [RegExp, string][] = [
  [/\bLi[eè]ge\b/gi, 'Leeyezh'],
  [/\bBeek\b/g, 'Bake'],
  [/\bMaastricht\b/g, 'Mah-strikt'],
  [/\bSteenokkerzeel\b/g, 'Stain-ocker-zail'],
  [/\bBierset\b/g, 'Beer-say'],
];
/** Pronunciation tables of the active pack: fixes (all caps keys) and names (mixed case keys), plus its telephony. */
let activePack: Pack | undefined;
/** The pack whose fix and place names `spokenText` uses by default (the game sets it when a session starts). */
export function setSpeechPack(pack: Pack | undefined) { activePack = pack; }
const strip = (w: string) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function tablesOf(pack?: Pack): { fixes: Record<string, string>; names: [RegExp, string][]; tel: Record<string, string> } {
  const say = pack?.spec.fixSay;
  if (!say) return { fixes: FIX_SAY, names: NAMES, tel: TELEPHONY };
  const fixes: Record<string, string> = {}, names: [RegExp, string][] = [];
  for (const [k, v] of Object.entries(say)) {
    if (/^[A-Z0-9]+$/.test(k)) fixes[k] = v;
    else names.push([new RegExp(`\\b(?:${k}|${strip(k)})\\b`, 'gi'), v]);
  }
  return { fixes, names, tel: pack.spec.traffic?.telephony ? { ...TELEPHONY, ...pack.spec.traffic.telephony } : TELEPHONY };
}
/** All-caps words that are said as words, not letters. */
const WORDS = new Set(['NATO', 'ATIS', 'ROGER', 'WILCO', 'MAYDAY', 'PAN', 'RADAR', 'TCAS', 'AMAN']);
const RWY_SIDE: Record<string, string> = { L: 'left', R: 'right', C: 'centre' };
const LETTER: Record<string, string> = Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => [c, digits(c)]));

const numWords = (n: string) => digits(n.replace(/^0+(?=\d)/, ''));

/** Text as a controller or pilot would say it, with the fix and place names of `pack` (default: the active pack, else Liège's). */
export function spokenText(input: string, pack: Pack | undefined = activePack): string {
  const T = tablesOf(pack);
  const fixSay = (f: string) => T.fixes[f] ?? (f.length <= 3 ? f.split('').join(' ') : f[0] + f.slice(1).toLowerCase());
  let s = input;
  for (const [re, to] of T.names) s = s.replace(re, to);
  // callsigns in code form (intercom): QTR8125 -> Qatari eight one two five
  s = s.replace(/\b([A-Z]{3,5})(\d[A-Z0-9]{0,4})\b/g, (m, p: string) => (T.tel[p] ? telephony(m, T.tel) : m));
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
  s = s.replace(/\b[A-Z]{5}\b/g, (w) => (T.fixes[w] ? T.fixes[w] : WORDS.has(w) ? w : w));
  s = s.replace(/\b[A-Z]{2,4}\b/g, (w) => (T.fixes[w] ? T.fixes[w] : WORDS.has(w) ? w : w.split('').join(' ')));
  // "niner" stays; tidy spacing and punctuation the phonemiser would read aloud
  return s.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
}
