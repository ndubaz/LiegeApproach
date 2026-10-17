import { TELEPHONY, UNITS, telephony, type Item, type UnitTable } from './clearance';

// Shorthand grammar (desktop command line, and the target of voice input):
//   [CALLSIGN] H250 | L250 | R250        heading (shortest / left / right)
//              D40 | C80 | A30 | FL080   descend / climb / altitude / flight level
//              S210 | S160/4 | SMIN | SRES
//              DCT LIBVA | >LIBVA
//              ILS | ILS22L | RNP22L | VIS22L
//              HOLD | HOLD ALHUV
//              ALHUV1A                    transition
//              RON                        resume own navigation
//              TWR | BRU | MUAC | BEEK | MIL   transfer
//              SQ4521                     squawk
//              Y | APPR  /  N | UNABLE    answer a request
//              R | ROG  /  SB | STBY      roger (identified) / standby: answer a call
//              BRK                        cancel approach clearance (break-off; add H040 A30)
//              ATIS                       "information X now current, QNH ..."
//              REL | REL AFTER QTR586 | REL/QTR586 | REL H250 A50   departure release (intercom)
//              RH | RH3 | REL HOLD [3]    hold the departure, expect release in n minutes
//              SA                         say again (ask the pilot to repeat)
//              CORR                       correction: this transmission corrects the last one (flag, not an item)
//              STAR KOK7D                 cleared via a STAR

export interface ParseCtx {
  callsigns: string[];
  selected?: string;
  runway: string;
  tl: number;          // transition level, FL
  fixes: Set<string>;
  transitions: Set<string>;
  /** STAR names, to check `STAR KOK7D` (any NAME9X accepted when absent). */
  stars?: Set<string>;
  /** The airport's stack fix, for a bare HOLD (ALHUV when absent). */
  holdFix?: string;
  /** The intercom units of the active pack (ids, callsigns, frequencies). Absent: the engine's active table (Liège until a Sim is built). */
  units?: UnitTable;
}

/** The unit table a parse context works with. */
const unitsOf = (ctx: ParseCtx): UnitTable => ctx.units ?? UNITS;
const plainWord = (w: string) => w.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const ROLE_ORDER = ['acc', 'tower', 'military', 'upper', 'neighbour', 'ground', 'supervisor'];
/**
 * The words that name each unit a controller hands traffic to, best unit first when a word fits several
 * (Langen Radar is the centre before it is the departure sector): its short name on the landline, the
 * callsign's words, its key label and its id.
 */
export function unitWords(units: UnitTable): [string, string][] {
  const out: [string, string][] = [];
  const list = Object.values(units).filter((u) => u.role !== 'supervisor').sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  for (const u of list) {
    const words = [u.say, ...u.callsign.split(/\s+/), u.label, u.id].map(plainWord).filter((w) => w.length >= 3 && !['approach', 'control', 'radar', 'centre', 'center'].includes(w));
    for (const w of words) if (!out.some(([x]) => x === w)) out.push([w, u.id]);
  }
  return out;
}
/** The unit id a typed token means: its id (TWR, BRU, ACC) or one of its words (LANGEN, TOWER, BRUSSELS). */
export function unitOfToken(tok: string, units: UnitTable): string | undefined {
  const t = tok.toUpperCase();
  if (units[t] && units[t].role !== 'supervisor') return t;
  const w = plainWord(tok);
  if (w.length < 3) return undefined;
  return unitWords(units).find(([x]) => x === w)?.[1];
}

/** Items the parser understands before the engine does. When `Item` gains these kinds, merge `ext` into `items`. */
export type ExtItem = { k: 'sayagain' } | { k: 'star'; name: string };
export type ParsedItem = Item | ExtItem;

export interface ParseResult {
  cs?: string;
  items: Item[];
  errors: string[];
  /** say again / STAR, in typed order (absent when none) */
  ext?: ExtItem[];
  /** CORR was given: this transmission corrects the previous one (absent when not) */
  correction?: boolean;
}

/**
 * Callsigns on frequency that a partial token could mean, best first. Tiers, in order: the whole callsign;
 * a prefix of it (QTR8 → QTR8125); the whole digit part (8125); the end of the callsign (4EK → TAY4EK, 201 → CHG201);
 * the start of the digit part (81 → QTR8125); anywhere in the digit part (12 → QTR8125). Within a tier the shorter
 * callsign wins. A token of one character matches nothing.
 */
export function matchCallsigns(tok: string, callsigns: string[]): string[] {
  const t = tok.toUpperCase().trim();
  if (t.length < 2 || !/^[A-Z0-9]+$/.test(t)) return [];
  const tail = (c: string) => c.replace(/^[A-Z]+/, '');
  const tiers: ((c: string) => boolean)[] = [
    (c) => c === t,
    (c) => c.startsWith(t),
    (c) => tail(c) === t,
    (c) => c.endsWith(t),
    (c) => tail(c).startsWith(t),
    (c) => tail(c).includes(t),
  ];
  const out: string[] = [];
  for (const f of tiers) for (const c of [...callsigns].sort((a, b) => a.length - b.length)) if (f(c) && !out.includes(c)) out.push(c);
  return out;
}

/** The one callsign a partial token means, or undefined when none or more than one fits at the best tier. */
export function resolveCallsign(tok: string, callsigns: string[]): string | undefined {
  const t = tok.toUpperCase();
  const exact = callsigns.find((c) => c === t);
  if (exact) return exact;
  if (t.length < 2) return undefined;
  const tail = (c: string) => c.replace(/^[A-Z]+/, '');
  const tiers: ((c: string) => boolean)[] = [(c) => c.startsWith(t), (c) => tail(c) === t, (c) => c.endsWith(t), (c) => tail(c).startsWith(t), (c) => tail(c).includes(t)];
  for (const f of tiers) {
    const m = callsigns.filter(f);
    if (m.length === 1) return m[0];
    if (m.length > 1) return undefined;
  }
  return undefined;
}

/**
 * The fix a typed token means: exact; the only fix starting with it (LIB → LIBVA); otherwise the one fix that sounds
 * close enough (GILO → GILOM, ALHUF → ALHUV) when it is clearly the best. Tokens shorter than two letters match nothing.
 */
export function resolveFix(tok: string, fixes: Set<string> | string[]): string | undefined {
  const all = fixes instanceof Set ? [...fixes] : fixes;
  const t = tok.toUpperCase();
  if (all.includes(t)) return t;
  if (t.length < 2 || !/^[A-Z][A-Z0-9]*$/.test(t)) return undefined;
  const pre = all.filter((f) => f.startsWith(t));
  if (pre.length === 1) return pre[0];
  if (pre.length > 1) return undefined;
  if (t.length < 3) return undefined;
  let best: { f: string; s: number } | undefined, second = 0;
  for (const f of all) {
    if (/^LG\d/.test(f)) continue; // waypoints like LG008 are never meant by a word
    const s = sim(t.toLowerCase(), f.toLowerCase());
    if (!best || s > best.s) { second = best?.s ?? 0; best = { f, s }; } else if (s > second) second = s;
  }
  return best && best.s >= 0.6 && best.s - second >= 0.1 ? best.f : undefined;
}

export function parseShorthand(input: string, ctx: ParseCtx): ParseResult {
  const toks = input.toUpperCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const items: Item[] = [];
  const errors: string[] = [];
  const ext: ExtItem[] = [];
  let correction = false;
  let cs: string | undefined;
  let i = 0;
  if (toks.length) {
    const c = resolveCallsign(toks[0], ctx.callsigns);
    if (c && !isCommand(toks[0], ctx)) { cs = c; i = 1; }
  }
  const lvl = (n: number, forceFt = false): Item => {
    const ft = n * 100;
    return !forceFt && n >= ctx.tl ? { k: 'lvl', lvl: { fl: n } } : { k: 'lvl', lvl: { ft } };
  };
  for (; i < toks.length; i++) {
    const t = toks[i];
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(H|HDG|L|R)(\d{1,3})$/))) {
      const h = Number(m[2]);
      if (h < 1 || h > 360) { errors.push(`Bad heading ${t}`); continue; }
      items.push({ k: 'hdg', hdg: h, dir: m[1] === 'L' ? 'L' : m[1] === 'R' ? 'R' : undefined });
    } else if ((m = t.match(/^(D|C)(\d{2,3})$/))) {
      items.push(lvl(Number(m[2])));
    } else if ((m = t.match(/^A(\d{2,3})$/))) {
      items.push(lvl(Number(m[1]), true));
    } else if ((m = t.match(/^F(?:L)?(\d{2,3})$/))) {
      items.push({ k: 'lvl', lvl: { fl: Number(m[1]) } });
    } else if ((m = t.match(/^S(\d{3})(?:\/(\d{1,2}))?$/))) {
      items.push({ k: 'spd', spd: Number(m[1]), until: m[2] ? Number(m[2]) : undefined });
    } else if (t === 'SMIN') items.push({ k: 'spdmin' });
    else if (t === 'SRES') items.push({ k: 'spdres' });
    else if (t === 'DCT' || t === 'DIR') {
      const f = toks[++i];
      const fx = f ? resolveFix(f, ctx.fixes) : undefined;
      if (fx) items.push({ k: 'dct', fix: fx }); else errors.push(`Unknown fix ${f ?? ''}`);
    } else if (t.startsWith('>')) {
      const f = t.slice(1);
      const fx = resolveFix(f, ctx.fixes);
      if (fx) items.push({ k: 'dct', fix: fx }); else errors.push(`Unknown fix ${f}`);
    } else if ((m = t.match(/^(ILS|RNP|VIS)(\d{2}[LRC]?)?$/))) {
      items.push({ k: 'app', app: m[1] as 'ILS' | 'RNP' | 'VIS', rwy: m[2] ?? ctx.runway });
    } else if (t === 'HOLD' || t === 'HLD') {
      const f = toks[i + 1];
      const fx = f && !isCommand(f, ctx) && !/^\d/.test(f) ? resolveFix(f, ctx.fixes) : undefined;
      if (fx) { items.push({ k: 'hold', fix: fx }); i++; } else items.push({ k: 'hold', fix: ctx.holdFix ?? 'ALHUV' });
    } else if (ctx.transitions.has(t)) items.push({ k: 'trans', name: t });
    else if (t === 'RON' || t === 'OWN') items.push({ k: 'ron' });
    else if (unitOfToken(t, unitsOf(ctx))) items.push({ k: 'xfr', unit: unitOfToken(t, unitsOf(ctx))! });
    else if (t === 'BRK' || t === 'BREAK') items.push({ k: 'brk' });
    else if (t === 'ATIS') items.push({ k: 'atis' });
    else if ((m = t.match(/^REL(?:\/([A-Z0-9]+))?$/))) {
      if (toks[i + 1] === 'HOLD' || toks[i + 1] === 'HLD') {
        i++;
        const n = toks[i + 1] && /^\d{1,2}$/.test(toks[i + 1]) ? Number(toks[++i]) : undefined;
        items.push({ k: 'relhold', mins: n });
      } else {
        let after = m[1];
        if (toks[i + 1] === 'AFTER' && toks[i + 2]) { after = toks[i + 2]; i += 2; }
        if (after) after = resolveCallsign(after, ctx.callsigns) ?? after;
        items.push({ k: 'rel', after });
      }
    } else if ((m = t.match(/^RH(\d{1,2})?$/))) items.push({ k: 'relhold', mins: m[1] ? Number(m[1]) : undefined });
    else if ((m = t.match(/^SQ(?:K)?(\d{4})$/))) items.push({ k: 'sqk', code: m[1] });
    else if (t === 'Y' || t === 'APPR' || t === 'APPROVED') items.push({ k: 'appr' });
    else if (t === 'N' || t === 'UNABLE') items.push({ k: 'deny' });
    else if (t === 'R' || t === 'ROG' || t === 'ROGER') items.push({ k: 'roger' });
    else if (t === 'SB' || t === 'STBY' || t === 'STANDBY') items.push({ k: 'standby' });
    else if (t === 'SA' || t === 'SAYAGAIN') ext.push({ k: 'sayagain' });
    else if (t === 'CORR' || t === 'CORRECTION') correction = true;
    else if (t === 'STAR') {
      const n = toks[i + 1];
      if (n && (ctx.stars ? ctx.stars.has(n) : /^[A-Z]{2,5}\d[A-Z]$/.test(n))) { ext.push({ k: 'star', name: n }); i++; } else { errors.push(`Unknown STAR ${n ?? ''}`); if (n) i++; }
    } else if (ctx.stars?.has(t)) ext.push({ k: 'star', name: t });
    else if (ctx.fixes.has(t) && items.length && items[items.length - 1].k === 'hold') { /* handled */ }
    else errors.push(`Unknown: ${t}`);
  }
  // a release takes any heading / level given with it
  const rel = items.find((x) => x.k === 'rel') as Extract<Item, { k: 'rel' }> | undefined;
  if (rel) {
    for (const x of items) {
      if (x.k === 'hdg') rel.hdg = x.hdg;
      if (x.k === 'lvl') rel.lvl = x.lvl;
    }
    return done({ cs, items: items.filter((x) => x.k !== 'hdg' && x.k !== 'lvl'), errors });
  }
  return done({ cs, items, errors });
  function done(r: ParseResult): ParseResult {
    if (ext.length) r.ext = ext;
    if (correction) r.correction = true;
    return r;
  }
}

function isCommand(t: string, ctx: ParseCtx) {
  return /^(H|HDG|L|R|D|C|A|F|FL|S)\d/.test(t) || ['SMIN', 'SRES', 'DCT', 'ILS', 'RNP', 'VIS', 'HOLD', 'RON', 'Y', 'N', 'BRK', 'ATIS', 'REL', 'RH', 'R', 'ROG', 'ROGER', 'SB', 'STBY', 'STANDBY', 'SA', 'CORR', 'STAR'].includes(t) || !!unitOfToken(t, unitsOf(ctx)) || ctx.transitions.has(t) || !!ctx.stars?.has(t);
}


// =====================================================================
// Voice: Web Speech API transcript → shorthand, with confidence
// =====================================================================

export interface VoiceCtx extends ParseCtx {
  /** callsign → telephony as the sim speaks it (defaults to telephony(cs)) */
  tels?: Record<string, string>;
}

export interface VoiceResult {
  /** shorthand for parseShorthand, callsign first when one was heard */
  shorthand: string;
  /** callsign heard (nearest on frequency); undefined when none was said */
  cs?: string;
  /** 0..1 for the callsign match (0 when none heard) */
  csConfidence: number;
  /** 0..1 overall; below about 0.75 the UI should ask before sending */
  confidence: number;
  /** plain-English notes on what was guessed or ignored, for the confirm prompt */
  unsure: string[];
  /** the transmission began with "correction": it corrects the previous one */
  correction: boolean;
  /** parseShorthand(shorthand) */
  parse: ParseResult;
  /** normalised words the grammar saw (debugging) */
  heard: string;
}

// ---------- words ----------
const DIGIT_W: Record<string, string> = {
  zero: '0', xero: '0', zeero: '0', one: '1', two: '2', three: '3', tree: '3', four: '4', fower: '4', five: '5', fife: '5',
  six: '6', seven: '7', eight: '8', nine: '9', niner: '9', nina: '9', ninah: '9',
};
/** homophones that are digits only next to other numbers */
const AMBIG_W: Record<string, string> = { oh: '0', o: '0', won: '1', to: '2', too: '2', free: '3', for: '4', fore: '4', ate: '8' };
const TEEN_W: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS_W: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** words after which "to" / "for" are prepositions, not digits */
const PREP_BEFORE = new Set(['descend', 'climb', 'maintain', 'reduce', 'increase', 'speed', 'down', 'up', 'level', 'altitude', 'squawk', 'contact', 'hold', 'expect', 'in', 'until', 'released', 'release', 'direct', 'cleared', 'standby', 'monitor', 'back', 'turn', 'continue', 'approach', 'vectoring', 'vectors']);
const UNIT_AFTER = new Set(['thousand', 'hundred', 'knots', 'miles', 'mile', 'dme', 'feet', 'minutes', 'minute']);
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const PHONETIC: Record<string, string> = {
  alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', charly: 'C', delta: 'D', echo: 'E', eko: 'E', foxtrot: 'F', golf: 'G', hotel: 'H',
  india: 'I', juliet: 'J', juliett: 'J', kilo: 'K', keelo: 'K', lima: 'L', leema: 'L', mike: 'M', november: 'N', oscar: 'O',
  papa: 'P', quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', whisky: 'W',
  xray: 'X', yankee: 'Y', zulu: 'Z',
};

/** Spoken names for operators beyond clearance.ts TELEPHONY, including common recogniser slips. */
const OP_ALIASES: Record<string, string[]> = {
  QTR: ['qatari', 'qatar', 'cutter', 'qatar airways', 'katari'],
  TAY: ['quality', 'tayaran', 'tnt', 'asl'],
  FDX: ['fedex', 'federal express', 'fedx'],
  ETH: ['ethiopian', 'ethiopia'],
  CHG: ['challenge', 'challenger', 'challenged'],
  DHK: ['world express', 'dhl'],
  THY: ['turkish', 'turkey', 'turkeys'],
  CLX: ['cargolux', 'cargo lux', 'cargo looks'],
  CKS: ['connie', 'kalitta', 'conny'],
  AZG: ['silk west', 'silkwest', 'silk way', 'silkway'],
  CAO: ['air china freight', 'air china'],
  MSR: ['egyptair', 'egypt air'],
  BCS: ['eurotrans', 'euro trans'],
  JAF: ['beauty'],
  RYR: ['ryanair', 'ryan air'],
  GEC: ['lufthansa cargo', 'lufthansa'],
  BAF: ['belgian air force', 'belgian'],
  LIFE: ['lifeliner', 'life liner'],
  FCK: ['flight check'],
  RCH: ['reach'],
};
/** Navaid and fix names as people say them. */
const FIX_ALIASES: Record<string, string[]> = {
  KOK: ['koksy', 'coxy', 'cock see'], CIV: ['chievres', 'sheave', 'chiever'], NIK: ['nicky', 'nikki', 'nick'],
  BUB: ['brussels'], GSY: ['gosselies'], MAK: ['mackel'], GESLO: ['guess low'],
};
/** Unit frequencies by id, from a unit table (units without a frequency are left out). */
const unitFreqs = (units: UnitTable): Record<string, string> => Object.fromEntries(Object.values(units).filter((u) => u.freq).map((u) => [u.id, u.freq]));

const KEYWORDS = new Set([
  'turn', 'heading', 'fly', 'fl', 'descend', 'climb', 'maintain', 'reduce', 'increase', 'speed', 'knots', 'direct', 'hold', 'cleared',
  'contact', 'monitor', 'squawk', 'roger', 'identified', 'standby', 'sayagain', 'approved', 'unable', 'ron', 'brk', 'nowcurrent',
  'information', 'released', 'release', 'corr', 'sres', 'minclean', 'expect', 'vectoring', 'vectors', 'altitude', 'qnh', 'ils', 'rnp',
  'visual', 'runway', 'expedite', 'continue', 'report', 'until', 'feet', 'transition', 'arrival', 'after', 'left', 'right', 'when', 'expectrelease',
]);
const FILLER = new Set(['and', 'the', 'a', 'an', 'please', 'then', 'now', 'good', 'evening', 'morning', 'afternoon', 'night', 'day', 'hello',
  'liege', 'approach', 'radar', 'heavy', 'super', 'thanks', 'thank', 'you', 'is', 'of', 'at', 'on', 'uh', 'um', 'er', 'erm', 'ah', 'okay', 'ok',
  'your', 'its', 'it', 'as', 'published', 'with', 'me', 'that', 'this', 'so', 'yes', 'no', 'also', 'like', 'just', 'go', 'ahead', 'over', 'to', 'for',
  'miles', 'mile', 'dme', 'final', 'knots', 'feet', 'via', 'in', 'minutes', 'minute', 'from', 'touchdown', 'out', 'present', 'position']);

// ---------- similarity ----------
function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const simRaw = (a: string, b: string) => (a.length || b.length ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1);
/** A rough sound key so "al who've" meets ALHUV and "coxy" meets "koksy". */
export function soundKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '')
    .replace(/who/g, 'hu').replace(/wh/g, 'w').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/x/g, 'ks').replace(/z/g, 's').replace(/ee|ea|ie|ey|y/g, 'i').replace(/oo|ou|ew|ue/g, 'u')
    .replace(/(?!^)h/g, '').replace(/(.)\1+/g, '$1').replace(/^(..+)e$/, '$1');
}
const sim = (a: string, b: string) => Math.max(simRaw(a, b), simRaw(soundKey(a), soundKey(b)));

// ---------- tokens ----------
interface Tok { w: string; n?: string; v?: number; mag?: boolean; used?: boolean }
const isNum = (t?: Tok): t is Tok & { n: string; v: number } => !!t && t.n !== undefined;

function normalise(text: string): string {
  let s = ' ' + text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() + ' ';
  s = s.replace(/[’']/g, '').replace(/(\d),(\d{3})/g, '$1$2').replace(/(\d):(\d{2})/g, '$1$2').replace(/(\d)\.(\d)/g, '$1 decimal $2');
  s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ');
  const R: [RegExp, string][] = [
    [/^ (liege|luttich|langen|dusseldorf) (approach|radar|arrival) /, ' '], [/ (stand by|standby) /g, ' standby '], [/ say (again|that again)( your last)?/g, ' sayagain'],
    [/ flight ?levels? /g, ' fl '], [/ f l /g, ' fl '], [/ q n h /g, ' qnh '], [/ (eye|i) (l|el|ell) (s|ess) /g, ' ils '],
    [/ (i ls|iles|i less|ials|eyelash|eyeless) /g, ' ils '], [/ (r n p|rnav|our np|r and p|are np) /g, ' rnp '], [/ minimum clean( speed)?/g, ' minclean'],
    [/ (resume normal speed|no speed restrictions?|speed your discretion|high speed approved)/g, ' sres'],
    [/ (resume own navigation|resume own nav|own navigation)/g, ' ron'], [/ cancel (your )?(the )?approach clearance/g, ' brk'], [/ break off( the)?( approach)?/g, ' brk'],
    [/ now current/g, ' nowcurrent'], [/ d m e /g, ' dme '], [/ radar contact/g, ' identified'], [/ fed ex /g, ' fedex '], [/ x ray /g, ' xray '],
    [/ (proceed|route|routing|fly) direct( to)? /g, ' direct '], [/ direct to /g, ' direct '], [/ (k t s|kts|kt|knot|nots|notes) /g, ' knots '], [/ (ft|foot) /g, ' feet '],
    [/ (correction|correct shun) /g, ' corr '], [/ (holding|enter the hold|enter hold)( at| over)? /g, ' hold '], [/ hold (at|over) /g, ' hold '],
    [/ expect(ing)? (further )?release/g, ' expectrelease'], [/ (until|till) /g, ' until '], [/ (nautical miles|track miles|nm) /g, ' miles '],
    [/ (point|decimal|dismal|desmal) /g, ' decimal '], [/ (centre|center) /g, ' centre '], [/ (maastrict|mastricht|maastrich|mastrich) /g, ' maastricht '],
    [/ (bake|beak|bec) approach/g, ' beek approach'], [/ (roger that|copy that|rodger) /g, ' roger '], [/ (stop|stopping) climb at /g, ' maintain '],
    [/ (descending|descent|decent|dissent|the scent|descends) /g, ' descend '], [/ turned /g, ' turn '], [/ climbing /g, ' climb '], [/ go ahead /g, ' '], [/ (squawking|squak|squark) /g, ' squawk '],
    [/ (one|1) (alpha|a) /g, ' 1 a '],
  ];
  for (let k = 0; k < 2; k++) for (const [re, r] of R) s = s.replace(re, r);
  return s.replace(/\s+/g, ' ').trim();
}

type NumKind = 'd' | 'teen' | 'tens' | 'mag' | 'dec' | 'raw' | 'w';
function tokenise(words: string[]): Tok[] {
  const kind: NumKind[] = words.map((w) => (/^\d+$/.test(w) ? 'raw' : has(DIGIT_W, w) ? 'd' : has(TEEN_W, w) ? 'teen' : has(TENS_W, w) ? 'tens' : w === 'thousand' || w === 'hundred' ? 'mag' : w === 'decimal' ? 'dec' : 'w'));
  const numeric = (j: number) => j >= 0 && j < words.length && kind[j] !== 'w' && kind[j] !== 'dec';
  // homophones ("to", "for", "oh") count as digits only between numbers, never as a preposition before one
  for (let j = 0; j < words.length; j++) {
    if (kind[j] !== 'w' || !has(AMBIG_W, words[j])) continue;
    const prevNum = numeric(j - 1) && kind[j - 1] !== 'mag';
    const next = words[j + 1];
    const nextNum = numeric(j + 1) || (!!next && has(AMBIG_W, next) && numeric(j + 2));
    if (prevNum && (nextNum || words[j] === 'oh' || words[j] === 'o' || (kind[j - 1] === 'd' && !UNIT_AFTER.has(next ?? '') && words[j] !== 'for'))) kind[j] = 'd';
    else if (next && UNIT_AFTER.has(next) && words[j] !== 'to' && !prevNum) kind[j] = 'd';
    else if (nextNum && !prevNum && !PREP_BEFORE.has(words[j - 1] ?? '') && words[j] !== 'o' && words[j] !== 'oh') kind[j] = 'd';
  }
  const toks: Tok[] = [];
  let j = 0;
  while (j < words.length) {
    if (kind[j] === 'w' || kind[j] === 'dec') { toks.push({ w: words[j] }); j++; continue; }
    const start = j;
    let digits = '', cur = '', dec = '';
    let total = 0, mag = false, inDec = false;
    const push = (d: string) => { if (inDec) dec += d; else { digits += d; cur += d; } };
    while (j < words.length) {
      const w = words[j], k = kind[j];
      if (k === 'raw') push(w);
      else if (k === 'd') push(DIGIT_W[w] ?? AMBIG_W[w]);
      else if (k === 'teen') push(String(TEEN_W[w]));
      else if (k === 'tens') {
        const nx = words[j + 1];
        const u = nx && kind[j + 1] === 'd' ? (DIGIT_W[nx] ?? AMBIG_W[nx]) : undefined;
        if (u && u !== '0') { push(String(TENS_W[w] / 10) + u); j++; } else push(String(TENS_W[w]));
      } else if (k === 'mag') {
        if (inDec) break;
        mag = true;
        total += Number(cur || '1') * (w === 'thousand' ? 1000 : 100); cur = '';
      } else if (k === 'dec') {
        if (inDec || !digits || !numeric(j + 1)) break;
        inDec = true;
      } else break;
      j++;
    }
    const wsrc = words.slice(start, j).join(' ');
    if (mag) { total += Number(cur || '0'); toks.push({ w: wsrc, n: String(total), v: total, mag: true }); }
    else if (dec) toks.push({ w: wsrc, n: `${digits}.${dec}`, v: Number(`${digits}.${dec}`) });
    else toks.push({ w: wsrc, n: digits, v: Number(digits) });
  }
  return toks;
}

// ---------- callsigns ----------
function splitCs(cs: string): { op: string; suf: string } {
  if (/^OO[A-Z]{3}$/.test(cs)) return { op: '', suf: cs };
  const m = cs.match(/^([A-Z]+?)(\d[A-Z0-9]*)$/);
  return m ? { op: m[1], suf: m[2] } : { op: '', suf: cs };
}
function airlineNames(cs: string, tels?: Record<string, string>): string[] {
  const { op } = splitCs(cs);
  const out = new Set<string>();
  const tel = tels?.[cs] ?? telephony(cs);
  const words = tel.toLowerCase().split(/[\s-]+/).filter((w) => !has(DIGIT_W, w) && !has(PHONETIC, w) && !/\d/.test(w));
  if (words.length) out.add(words.join(''));
  if (op && TELEPHONY[op]) out.add(TELEPHONY[op].toLowerCase().replace(/\s/g, ''));
  for (const a of OP_ALIASES[op] ?? []) out.add(a.replace(/\s/g, ''));
  return [...out];
}

interface CsMatch { cs: string; conf: number; second?: string; rest?: string; used: number[]; said: string }
/** Nearest callsign on frequency for a run of tokens. */
function matchCallsign(toks: Tok[], idx: number[], cands: string[], tels?: Record<string, string>): CsMatch | undefined {
  if (!cands.length || !idx.length) return undefined;
  const air: string[] = [];
  let suf = '';
  const sufIdx: number[] = [];
  const airIdx: number[] = [];
  for (const i of idx) {
    const t = toks[i];
    if (isNum(t)) { if (t.n.includes('.') || t.mag) continue; suf += t.n; sufIdx.push(i); }
    else if (has(PHONETIC, t.w)) { suf += PHONETIC[t.w]; sufIdx.push(i); }
    else if (suf && /^[a-z]$/.test(t.w)) { suf += t.w.toUpperCase(); sufIdx.push(i); }
    else if (!FILLER.has(t.w) && !KEYWORDS.has(t.w) && !suf) { air.push(t.w); airIdx.push(i); }
  }
  if (!air.length && !suf) return undefined;
  const scored = cands.map((cs) => {
    const { op, suf: cs2 } = splitCs(cs);
    let a = -1;
    let airUsed = 0;
    if (air.length && op) {
      const names = airlineNames(cs, tels);
      for (let s = 0; s < air.length; s++) for (let e = s + 1; e <= Math.min(air.length, s + 3); e++) {
        const said = air.slice(s, e).join('');
        for (const nm of names) {
          const v = sim(said, nm) - (air.length - (e - s)) * 0.03;
          if (v > a) { a = v; airUsed = e - s; }
        }
      }
    }
    let sx = -1, rest: string | undefined;
    if (suf) {
      sx = simRaw(suf, cs2);
      if (suf.length > cs2.length && suf.startsWith(cs2) && /^\d+$/.test(suf.slice(cs2.length))) { sx = 1; rest = suf.slice(cs2.length); }
    }
    const score = a >= 0 && sx >= 0 ? 0.35 * a + 0.65 * sx : sx >= 0 ? (air.length ? 0.55 * sx : 0.92 * sx) : a >= 0 ? 0.62 * a : 0;
    return { cs, score, rest, airUsed };
  }).sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (best.score < 0.5) return undefined;
  const second = scored[1];
  const margin = second ? best.score - second.score : 1;
  const conf = Math.max(0, Math.min(1, best.score * (margin >= 0.15 ? 1 : 0.6 + margin * 2.6)));
  const used = [...airIdx, ...sufIdx];
  return { cs: best.cs, conf, second: second && margin < 0.08 ? second.cs : undefined, rest: best.rest, used, said: used.sort((x, y) => x - y).map((x) => toks[x].w).join(' ') };
}

// ---------- fixes and procedures ----------
interface Hit { name: string; conf: number; next: number; said: string }
function spelled(toks: Tok[], i: number): { s: string; next: number } {
  let s = '';
  let j = i;
  for (; j < toks.length; j++) {
    const t = toks[j];
    if (t.used) break;
    if (isNum(t) && !t.mag && !t.n.includes('.')) s += t.n;
    else if (has(PHONETIC, t.w)) s += PHONETIC[t.w];
    else if (/^[a-z]$/.test(t.w) && /\d$/.test(s)) s += t.w.toUpperCase();
    else break;
  }
  return { s, next: j };
}
function readFix(toks: Tok[], i: number, fixes: string[]): Hit | undefined {
  while (toks[i] && !isNum(toks[i]) && ['to', 'at', 'over', 'the', 'via'].includes(toks[i].w)) i++;
  if (!toks[i] || toks[i].used) return undefined;
  const sp = spelled(toks, i);
  if (sp.s.length >= 2 && sp.next - i >= 2 && fixes.includes(sp.s)) return { name: sp.s, conf: 1, next: sp.next, said: sp.s };
  let best: Hit | undefined;
  for (let n = 1; n <= 3; n++) {
    const span = toks.slice(i, i + n);
    if (span.length < n || span.some((t) => isNum(t) || t.used || KEYWORDS.has(t.w) || (n > 1 && FILLER.has(t.w)))) break;
    const said = span.map((t) => t.w).join('');
    for (const f of fixes) {
      if (/[_\d]/.test(f)) continue;
      const names = [f.toLowerCase(), ...(FIX_ALIASES[f] ?? []).map((a) => a.replace(/\s/g, ''))];
      let s = Math.max(...names.map((nm) => sim(said, nm)));
      if (n > 1) s -= 0.03 * (n - 1);
      if (!best || s > best.conf) best = { name: f, conf: s, next: i + n, said: span.map((t) => t.w).join(' ') };
    }
  }
  return best && best.conf >= 0.6 ? best : undefined;
}
/** A transition or STAR name: spelled ("alpha lima hotel uniform victor one alpha") or said ("ALHUV one A", "Koksy seven delta"). */
function readProc(toks: Tok[], i: number, procs: string[]): Hit | undefined {
  if (!procs.length || !toks[i] || toks[i].used) return undefined;
  const sp = spelled(toks, i);
  if (sp.s.length >= 4 && procs.includes(sp.s)) return { name: sp.s, conf: 1, next: sp.next, said: sp.s };
  const bases = [...new Set(procs.map((p) => p.match(/^([A-Z]+)\d[A-Z]$/)?.[1]).filter((b): b is string => !!b))];
  // the base fix may itself be spelled ("lima november oscar six delta"): take the letters before the digit
  let f: Hit | undefined;
  const lettersOnly = sp.s.match(/^[A-Z]+/)?.[0];
  if (lettersOnly && sp.next - i >= 2 && bases.includes(lettersOnly)) {
    let k = i; let got = '';
    while (got.length < lettersOnly.length) { got += PHONETIC[toks[k].w]; k++; }
    f = { name: lettersOnly, conf: 1, next: k, said: lettersOnly };
  } else f = readFix(toks, i, bases);
  if (!f) return undefined;
  const d = toks[f.next];
  if (!isNum(d) || d.mag || d.n.length !== 1) return undefined;
  const l = toks[f.next + 1];
  const letter = l && !isNum(l) ? (has(PHONETIC, l.w) ? PHONETIC[l.w] : /^[a-z]$/.test(l.w) ? l.w.toUpperCase() : '') : '';
  if (!letter) return undefined;
  const name = f.name + d.n + letter;
  if (!procs.includes(name)) return undefined;
  return { name, conf: f.conf, next: f.next + 2, said: `${f.said} ${d.w} ${l.w}` };
}

// ---------- the grammar ----------
type Grp = 'lat' | 'lvl' | 'spd' | 'app' | 'xfr' | 'ack' | 'ans' | 'rel' | 'sqk' | 'misc';
interface Out { sh: string; grp: Grp; conf: number }

/**
 * Parse a speech transcript into shorthand. Fuzzy on callsigns (nearest on frequency), fixes and
 * procedure names; it reports what it guessed in `unsure` so the UI can confirm before sending.
 */
export function parseVoice(text: string, ctx: VoiceCtx): VoiceResult {
  const heard = normalise(text);
  const toks = tokenise(heard ? heard.split(' ') : []);
  const unsure: string[] = [];
  const out: Out[] = [];
  const fixes = [...ctx.fixes];
  const procs = [...ctx.transitions, ...(ctx.stars ?? [])];
  const units = unitsOf(ctx);
  const UNIT_WORDS = unitWords(units), UNIT_FREQ = unitFreqs(units);
  const holdFix = ctx.holdFix ?? 'ALHUV';
  let correction = false;
  let corrPending = false;
  const emit = (sh: string, grp: Grp, conf = 1) => {
    if (corrPending) {
      corrPending = false;
      let k = -1;
      for (let x = out.length - 1; x >= 0; x--) if (out[x].grp === grp) { k = x; break; }
      if (k < 0) k = out.length - 1;
      out.splice(k, 1);
    }
    out.push({ sh, grp, conf });
  };
  const at = (i: number) => toks[i];
  const word = (i: number) => (toks[i] && !isNum(toks[i]) ? toks[i].w : '');
  const use = (a: number, b: number) => { for (let x = a; x < b; x++) if (toks[x]) toks[x].used = true; };
  const skip = (i: number, words: string[]) => { while (toks[i] && !isNum(toks[i]) && words.includes(toks[i].w)) i++; return i; };
  const said = (a: number, b: number) => toks.slice(a, b).map((x) => x.w).join(' ');

  // ---- callsign: the words before the first instruction ----
  let first = toks.findIndex((t) => !isNum(t) && KEYWORDS.has(t.w));
  if (first < 0) first = toks.length;
  let cs: string | undefined;
  let csConf = 0;
  const csTry = (idx: number[]) => {
    const m = matchCallsign(toks, idx, ctx.callsigns, ctx.tels);
    if (!m) return false;
    cs = m.cs; csConf = m.conf;
    for (const x of m.used) toks[x].used = true;
    if (m.rest) {
      const last = Math.max(...m.used.filter((x) => isNum(toks[x])));
      toks.splice(last + 1, 0, { w: m.rest, n: m.rest, v: Number(m.rest) });
    }
    if (m.second) unsure.push(`callsign: ${m.cs} or ${m.second}?`);
    else if (m.conf < 0.75) unsure.push(`callsign: heard "${m.said}", guessing ${m.cs}`);
    return true;
  };
  csTry([...Array(first).keys()]);

  const level = (i: number, verb: boolean): { sh: string; next: number; conf: number } | undefined => {
    i = skip(i, ['to', 'and', 'maintain', 'altitude', 'down', 'up', 'level']);
    if (word(i) === 'fl') {
      const n = at(i + 1);
      if (isNum(n) && (!n.mag || n.v % 10 === 0) && n.v >= 10 && n.v <= 600) return { sh: 'FL' + String(n.v).padStart(3, '0'), next: i + 2, conf: 1 };
      if (isNum(n) && !n.mag && n.v >= 1 && n.v < 10) return { sh: 'FL' + String(n.v * 10).padStart(3, '0'), next: i + 2, conf: 0.5 };
      return undefined;
    }
    const n = at(i);
    if (!isNum(n) || n.n.includes('.')) return undefined;
    const feet = word(i + 1) === 'feet';
    const next = feet ? i + 2 : i + 1;
    if (word(next) === 'knots') return undefined;
    if ((n.mag || feet || n.n.length >= 4) && n.v >= 500 && n.v <= 20000 && n.v % 100 === 0) return { sh: 'A' + String(n.v / 100).padStart(2, '0'), next, conf: 1 };
    if (verb && !n.mag && n.v >= 20 && n.v <= 450 && n.n.length >= 2) return { sh: 'FL' + String(n.v).padStart(3, '0'), next, conf: 0.6 };
    return undefined;
  };
  const speedAt = (i: number): { v: number; next: number } | undefined => {
    i = skip(i, ['to', 'speed']);
    const n = at(i);
    if (!isNum(n) || n.n.includes('.') || n.v < 100 || n.v > 400) return undefined;
    return { v: n.v, next: word(i + 1) === 'knots' ? i + 2 : i + 1 };
  };
  const untilAt = (i: number): { nm: number; next: number } | undefined => {
    if (word(i) !== 'until') return undefined;
    let j = skip(i + 1, ['the', 'a']);
    const n = at(j);
    if (!isNum(n) || n.v < 1 || n.v > 30) return undefined;
    j++;
    while (['miles', 'mile', 'dme', 'final', 'from', 'touchdown', 'out', 'on'].includes(word(j))) j++;
    return { nm: n.v, next: j };
  };
  const runwayAt = (i: number): { rwy: string; next: number } | undefined => {
    i = skip(i, ['runway', 'for']);
    const n = at(i);
    if (!isNum(n) || n.mag || n.n.length !== 2) return undefined;
    const side = word(i + 1);
    const s = side === 'left' || side === 'l' ? 'L' : side === 'right' || side === 'r' ? 'R' : side === 'centre' || side === 'c' ? 'C' : '';
    return { rwy: n.n + s, next: s ? i + 2 : i + 1 };
  };
  const approachAt = (i: number): { sh: string; next: number } | undefined => {
    const w = word(i);
    const a = w === 'ils' ? 'ILS' : w === 'rnp' ? 'RNP' : w === 'visual' ? 'VIS' : '';
    if (!a) return undefined;
    let j = skip(i + 1, ['approach']);
    const r = runwayAt(j);
    if (r) j = r.next;
    if (word(j) === 'approach') j++;
    return { sh: a + (r ? r.rwy : ''), next: j };
  };
  const procHit = (p: Hit, j: number) => {
    const star = !!ctx.stars?.has(p.name) && !ctx.transitions.has(p.name);
    emit(star ? 'STAR ' + p.name : p.name, star ? 'misc' : 'lat', p.conf);
    if (p.conf < 0.85) unsure.push(`procedure: heard "${p.said}", using ${p.name}`);
    return ['transition', 'arrival'].includes(word(j)) ? j + 1 : j;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.used) continue;
    const w = isNum(t) ? '' : t.w;
    let r: { sh: string; next: number; conf: number } | undefined;
    let m: Hit | undefined;
    const take = (a: number, b: number) => { use(a, b); i = b - 1; };

    if (w === 'corr') { t.used = true; if (out.length) corrPending = true; else correction = true; continue; }
    // heading
    if (w === 'turn' || ((w === 'left' || w === 'right') && word(i + 1) === 'heading') || w === 'heading' || (w === 'fly' && word(i + 1) === 'heading')) {
      let j = w === 'turn' ? i + 1 : i;
      let dir = '';
      if (word(j) === 'left' || word(j) === 'right') { dir = word(j) === 'left' ? 'L' : 'R'; j++; }
      j = skip(j, ['fly', 'heading', 'onto', 'on', 'to']);
      const n = at(j);
      if (isNum(n) && !n.mag && !n.n.includes('.')) {
        let v = n.v, conf = 1;
        if (n.n.length > 3) { v = Number(n.n.slice(0, 3)); conf = 0.5; unsure.push(`heading: heard ${n.n}, using ${n.n.slice(0, 3)}`); }
        if (v >= 1 && v <= 360) { emit((dir || 'H') + String(v).padStart(3, '0'), 'lat', conf); take(i, j + 1); continue; }
        unsure.push(`heading: ${n.n} is not a heading`);
        take(i, j + 1); continue;
      }
      unsure.push('heading: no number heard'); take(i, Math.max(i + 1, j)); continue;
    }
    if ((w === 'continue' || w === 'maintain') && (word(i + 1) === 'present' || word(i + 1) === 'current') && word(i + 2) === 'heading') {
      unsure.push('present heading: pick a heading'); take(i, i + 3); continue;
    }
    // levels
    if (['descend', 'climb', 'maintain', 'expedite'].includes(w) || w === 'fl' || w === 'altitude') {
      const verb = w !== 'fl';
      let j = w === 'fl' || w === 'altitude' ? i : i + 1;
      if (w === 'expedite') j = skip(j, ['descent', 'descend', 'climb']);
      if ((r = level(j, verb))) {
        emit(r.sh, 'lvl', r.conf);
        if (r.conf < 1) unsure.push(`level: "${said(i, r.next)}" read as ${r.sh}`);
        take(i, r.next); continue;
      }
      if (w !== 'maintain') { if (w !== 'altitude') unsure.push(`level: no level heard after "${w}"`); t.used = true; continue; }
    }
    // speed
    if (['reduce', 'increase', 'speed', 'maintain'].includes(w)) {
      const j = skip(i + 1, ['speed', 'to']);
      if (word(j) === 'minclean') { emit('SMIN', 'spd'); take(i, j + 1); continue; }
      const s = speedAt(j);
      if (s) {
        const u = untilAt(s.next);
        emit('S' + s.v + (u ? '/' + u.nm : ''), 'spd');
        take(i, u ? u.next : s.next); continue;
      }
      if (w !== 'maintain') unsure.push(`speed: no speed heard after "${w}"`);
      t.used = true; continue;
    }
    if (isNum(t) && !t.n.includes('.')) {
      // a bare number with a unit: "one six zero knots", "four thousand", "3000 feet"
      if (word(i + 1) === 'knots' && t.v >= 100 && t.v <= 400) {
        const u = untilAt(i + 2);
        emit('S' + t.v + (u ? '/' + u.nm : ''), 'spd'); take(i, u ? u.next : i + 2); continue;
      }
      if ((r = level(i, false))) { emit(r.sh, 'lvl', r.conf); take(i, r.next); continue; }
    }
    if (w === 'until') {
      const last = out[out.length - 1];
      const u = untilAt(i);
      if (u && last && last.grp === 'spd' && /^S\d{3}$/.test(last.sh)) { last.sh += '/' + u.nm; take(i, u.next); continue; }
    }
    if (w === 'minclean') { emit('SMIN', 'spd'); t.used = true; continue; }
    if (w === 'sres') { emit('SRES', 'spd'); t.used = true; continue; }
    // direct
    if (w === 'direct') {
      if ((m = readFix(toks, i + 1, fixes))) {
        emit('DCT ' + m.name, 'lat', m.conf);
        if (m.conf < 0.85) unsure.push(`fix: heard "${m.said}", using ${m.name}`);
        take(i, m.next);
      } else { unsure.push('direct: fix not recognised'); t.used = true; }
      continue;
    }
    // hold (or hold a departure on the intercom)
    if (w === 'hold') {
      const look = toks.slice(i + 1, i + 7).map((x) => x.w);
      if (look.includes('expectrelease') || look.includes('release')) {
        let j = i + 1;
        let mins: number | undefined;
        for (; j < Math.min(toks.length, i + 9); j++) {
          const n = at(j);
          if (isNum(n) && n.v <= 30 && (word(j + 1).startsWith('minute') || word(j - 1) === 'in')) { mins = n.v; j += word(j + 1).startsWith('minute') ? 2 : 1; break; }
          if (KEYWORDS.has(word(j)) && !['release', 'expectrelease'].includes(word(j))) break;
        }
        emit('RH' + (mins ?? ''), 'rel');
        take(i, j); continue;
      }
      if ((m = readFix(toks, i + 1, fixes))) {
        emit('HOLD ' + m.name, 'lat', m.conf);
        if (m.conf < 0.85) unsure.push(`hold fix: heard "${m.said}", using ${m.name}`);
        take(i, m.next);
      } else { emit('HOLD', 'lat', 0.8); unsure.push(`hold: no fix heard, using ${holdFix}`); t.used = true; }
      continue;
    }
    if (w === 'expectrelease') { t.used = true; continue; }
    // approach clearances and procedures
    if (w === 'cleared') {
      const j = skip(i + 1, ['for', 'the', 'to', 'via']);
      const a = approachAt(j);
      if (a) { emit(a.sh, 'app'); take(i, a.next); continue; }
      const p = readProc(toks, j, procs);
      if (p) { take(i, procHit(p, p.next)); continue; }
      t.used = true; continue;
    }
    if (w === 'ils' || w === 'rnp' || w === 'visual') {
      const a = approachAt(i)!;
      const back = [word(i - 1), word(i - 2), word(i - 3)];
      if (back.some((x) => ['expect', 'vectoring', 'vectors', 'for'].includes(x))) { take(i, a.next); continue; }
      if (w === 'visual' && word(i + 1) !== 'approach') { t.used = true; continue; }
      const cleared = back.includes('cleared') || word(a.next) === 'cleared';
      emit(a.sh, 'app', cleared ? 1 : 0.85);
      if (!cleared) unsure.push(`approach: "cleared" not heard, read as ${a.sh}`);
      take(i, a.next); continue;
    }
    if (w === 'expect' || w === 'vectoring' || w === 'vectors') {
      // "expect approach clearance at 2235", "expect onward clearance in 10 minutes": information, not an order
      let j = skip(i + 1, ['approach', 'further', 'onward']);
      if (word(j) === 'clearance') {
        j = skip(j + 1, ['at', 'in', 'time']);
        if (isNum(at(j))) j++;
        j = skip(j, ['minutes', 'minute']);
        take(i, j); continue;
      }
      t.used = true; continue;
    }
    // transfer
    if (w === 'contact' || w === 'monitor' || (w === 'tower' && isNum(at(i + 1)))) {
      let j = w === 'tower' ? i : i + 1;
      let unit: string | undefined;
      let uConf = 1;
      const uw = word(j);
      if (uw) {
        let best = 0;
        for (const [name, u] of UNIT_WORDS) { const s = sim(uw, name); if (s > best) { best = s; unit = u; } }
        if (best < 0.6) unit = undefined; else { uConf = best; j++; }
        if (['approach', 'control', 'radar'].includes(word(j))) j++;
      }
      const f = at(j);
      let freq: string | undefined;
      if (isNum(f)) { freq = f.n; j++; }
      const trim = (x: string) => x.replace(/\./, '').replace(/0+$/, '');
      const fUnit = freq ? Object.keys(UNIT_FREQ).find((u) => trim(UNIT_FREQ[u]) === trim(freq!)) : undefined;
      if (!unit && fUnit) unit = fUnit;
      if (unit && freq && fUnit !== unit) unsure.push(`frequency: ${freq} is not ${unit}`);
      if (unit) { emit(unit, 'xfr', uConf < 0.85 ? 0.8 : 1); if (uConf < 0.85) unsure.push(`unit: heard "${uw}", using ${unit}`); }
      else unsure.push('contact: unit not recognised');
      take(i, Math.max(j, i + 1)); continue;
    }
    if (w === 'squawk') {
      const n = at(i + 1);
      if (isNum(n) && /^[0-7]{4}$/.test(n.n)) { emit('SQ' + n.n, 'sqk'); take(i, i + 2); }
      else if (word(i + 1) === 'ident') take(i, i + 2);
      else { unsure.push('squawk: code not heard'); t.used = true; }
      continue;
    }
    if (w === 'qnh') { take(i, isNum(at(i + 1)) ? i + 2 : i + 1); continue; }
    if (w === 'runway') { const rw = runwayAt(i); take(i, rw ? rw.next : i + 1); continue; }
    if (w === 'roger' || w === 'identified') { emit('R', 'ack'); t.used = true; continue; }
    if (w === 'standby') { emit('SB', 'ack'); t.used = true; continue; }
    if (w === 'sayagain') { emit('SA', 'misc'); t.used = true; continue; }
    if (w === 'approved') { emit('Y', 'ans'); t.used = true; continue; }
    if (w === 'unable') { emit('N', 'ans'); t.used = true; continue; }
    if (w === 'ron') { emit('RON', 'lat'); t.used = true; continue; }
    if (w === 'brk') { emit('BRK', 'misc'); t.used = true; continue; }
    if (w === 'information') { take(i, has(PHONETIC, word(i + 1)) ? i + 2 : i + 1); continue; }
    if (w === 'nowcurrent') { emit('ATIS', 'misc'); t.used = true; continue; }
    if (w === 'released' || w === 'release') {
      let j = i + 1;
      let after = '';
      if (word(j) === 'after') {
        j++;
        const idx: number[] = [];
        while (toks[j] && !KEYWORDS.has(word(j)) && idx.length < 8) idx.push(j++);
        const mm = matchCallsign(toks, idx, ctx.callsigns.filter((c) => c !== cs), ctx.tels);
        if (mm) { after = mm.cs; if (mm.conf < 0.75 || mm.second) unsure.push(`release after: guessing ${mm.cs}`); }
        else unsure.push('release after: traffic not recognised');
      }
      emit('REL' + (after ? ' AFTER ' + after : ''), 'rel');
      take(i, j); continue;
    }
    if (w === 'transition' || w === 'arrival') { t.used = true; continue; }
    // a procedure said without "cleared" ("ALHUV one A transition")
    if (!KEYWORDS.has(w) && !FILLER.has(w)) {
      const p = readProc(toks, i, procs);
      if (p && (p.conf >= 0.85 || ['transition', 'arrival'].includes(word(p.next)))) { take(i, procHit(p, p.next)); continue; }
    }
  }
  if (corrPending) unsure.push('correction: nothing followed it');

  // callsign said at the end ("..., Qatari 8125") or not at all
  if (!cs) {
    const rest = toks.map((_, k) => k).filter((k) => !toks[k].used && (isNum(toks[k]) || !FILLER.has(toks[k].w)));
    csTry(rest);
  }
  const ignored = toks.filter((x) => !x.used && (isNum(x) || (!FILLER.has(x.w) && !KEYWORDS.has(x.w)))).map((x) => x.w);
  if (ignored.length) unsure.push(`ignored: "${ignored.join(' ')}"`);
  if (!cs && !ctx.selected && out.length) unsure.push('callsign: none heard');

  const shorthand = [...(cs ? [cs] : []), ...(correction ? ['CORR'] : []), ...out.map((o) => o.sh)].join(' ');
  const parse = parseShorthand(shorthand, ctx);
  if (parse.errors.length) unsure.push(...parse.errors);
  let conf = cs ? csConf : ctx.selected ? 0.9 : out.length ? 0.4 : 0;
  for (const o of out) conf *= o.conf;
  conf *= Math.max(0.6, Math.pow(0.9, ignored.length));
  if (parse.errors.length) conf *= 0.5;
  if (!out.length && !correction) conf = cs ? Math.min(conf, 0.5) : 0;
  return { shorthand, cs, csConfidence: Math.round(csConf * 100) / 100, confidence: Math.round(conf * 100) / 100, unsure, correction, parse, heard };
}

/** Pick the best of the recogniser's alternatives (highest confidence, first wins ties). */
export function parseVoiceAlternatives(alts: string[], ctx: VoiceCtx): VoiceResult {
  const rs = alts.filter((a) => a.trim()).map((a) => parseVoice(a, ctx));
  if (!rs.length) return parseVoice('', ctx);
  return rs.reduce((b, r) => (r.confidence > b.confidence + 0.02 ? r : b));
}

/**
 * Transcript → shorthand (kept for game.ts). `tels` maps callsign → telephony.
 * Prefer parseVoice, which also says how sure it is.
 */
export function voiceToShorthand(transcript: string, tels: Record<string, string>, fixes: string[], extra: Partial<VoiceCtx> = {}): string {
  return parseVoice(transcript, { callsigns: Object.keys(tels), runway: '', tl: 55, fixes: new Set(fixes), transitions: new Set(), ...extra, tels }).shorthand;
}
