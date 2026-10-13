import type { Item } from './clearance';

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

export interface ParseCtx {
  callsigns: string[];
  selected?: string;
  runway: string;
  tl: number;          // transition level, FL
  fixes: Set<string>;
  transitions: Set<string>;
}

export interface ParseResult { cs?: string; items: Item[]; errors: string[] }

export function resolveCallsign(tok: string, callsigns: string[]): string | undefined {
  const t = tok.toUpperCase();
  const exact = callsigns.find((c) => c === t);
  if (exact) return exact;
  if (t.length < 2) return undefined;
  const pre = callsigns.filter((c) => c.startsWith(t));
  if (pre.length === 1) return pre[0];
  const numeric = /^\d+[A-Z]?$/.test(t) ? callsigns.filter((c) => c.replace(/^[A-Z]+/, '') === t) : [];
  if (numeric.length === 1) return numeric[0];
  return undefined;
}

export function parseShorthand(input: string, ctx: ParseCtx): ParseResult {
  const toks = input.toUpperCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const items: Item[] = [];
  const errors: string[] = [];
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
      if (f && ctx.fixes.has(f)) items.push({ k: 'dct', fix: f }); else errors.push(`Unknown fix ${f ?? ''}`);
    } else if (t.startsWith('>')) {
      const f = t.slice(1);
      if (ctx.fixes.has(f)) items.push({ k: 'dct', fix: f }); else errors.push(`Unknown fix ${f}`);
    } else if ((m = t.match(/^(ILS|RNP|VIS)(\d{2}[LRC]?)?$/))) {
      items.push({ k: 'app', app: m[1] as 'ILS' | 'RNP' | 'VIS', rwy: m[2] ?? ctx.runway });
    } else if (t === 'HOLD' || t === 'HLD') {
      const f = toks[i + 1];
      if (f && ctx.fixes.has(f)) { items.push({ k: 'hold', fix: f }); i++; } else items.push({ k: 'hold', fix: 'ALHUV' });
    } else if (ctx.transitions.has(t)) items.push({ k: 'trans', name: t });
    else if (t === 'RON' || t === 'OWN') items.push({ k: 'ron' });
    else if (t === 'TWR' || t === 'BRU' || t === 'MUAC' || t === 'BEEK' || t === 'MIL') items.push({ k: 'xfr', unit: t });
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
    return { cs, items: items.filter((x) => x.k !== 'hdg' && x.k !== 'lvl'), errors };
  }
  return { cs, items, errors };
}

function isCommand(t: string, ctx: ParseCtx) {
  return /^(H|HDG|L|R|D|C|A|F|FL|S)\d/.test(t) || ['SMIN', 'SRES', 'DCT', 'ILS', 'RNP', 'VIS', 'HOLD', 'RON', 'TWR', 'BRU', 'MUAC', 'BEEK', 'MIL', 'Y', 'N', 'BRK', 'ATIS', 'REL', 'RH', 'R', 'ROG', 'ROGER', 'SB', 'STBY', 'STANDBY'].includes(t) || ctx.transitions.has(t);
}

// ---------------- voice → shorthand ----------------
const NUM: Record<string, string> = {
  zero: '0', oh: '0', one: '1', won: '1', two: '2', too: '2', to: '2', three: '3', tree: '3', four: '4', for: '4', fower: '4',
  five: '5', fife: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9', niner: '9',
};

/** Convert a recognised transcript into shorthand. `tels` maps callsign → telephony words. */
export function voiceToShorthand(transcript: string, tels: Record<string, string>, fixes: string[]): string {
  const raw = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const isNumWord = (w?: string) => !!w && (/^\d+$/.test(w) || (Object.prototype.hasOwnProperty.call(NUM, w) && !['to', 'too', 'for', 'oh', 'won', 'ate'].includes(w)));
  const mapped = raw.map((w, i) => {
    if (/^\d+$/.test(w)) return w;
    if (!Object.prototype.hasOwnProperty.call(NUM, w)) return w;
    // ambiguous homophones only count as digits next to other digits
    if (['to', 'too', 'for', 'oh', 'won', 'ate'].includes(w) && !isNumWord(raw[i - 1]) && !isNumWord(raw[i + 1])) return w;
    return NUM[w];
  });
  const merged: string[] = [];
  for (const w of mapped) {
    if (/^\d+$/.test(w) && merged.length && /^\d+$/.test(merged[merged.length - 1]) && merged[merged.length - 1].length < 4) merged[merged.length - 1] += w;
    else merged.push(w);
  }
  const s = ' ' + merged.join(' ') + ' ';
  const out: string[] = [];
  // callsign: best telephony match
  let best = '', bestScore = 0;
  for (const [cs, tel] of Object.entries(tels)) {
    const words = tel.toLowerCase().split(/\s+/);
    const airline = words.filter((w) => !Object.prototype.hasOwnProperty.call(NUM, w)).join(' ');
    const num = cs.replace(/^[A-Z]+/, '').toLowerCase();
    let score = 0;
    if (airline && s.includes(' ' + airline + ' ')) score += 2;
    if (num && new RegExp(`\\b${num}\\b`, 'i').test(s)) score += 2;
    if (score > bestScore) { bestScore = score; best = cs; }
  }
  if (bestScore >= 2) out.push(best);
  let m: RegExpMatchArray | null;
  if ((m = s.match(/turn (left|right) heading (\d{1,3})/))) out.push((m[1] === 'left' ? 'L' : 'R') + m[2].padStart(3, '0'));
  else if ((m = s.match(/heading (\d{1,3})/))) out.push('H' + m[1].padStart(3, '0'));
  if ((m = s.match(/flight level (\d{2,3})/))) out.push('FL' + m[1].padStart(3, '0'));
  else if ((m = s.match(/(?:descend|climb|maintain)(?: to)?(?: altitude)? (\d{1,2}) thousand(?: (\d) hundred)?/))) out.push('A' + (Number(m[1]) * 10 + (m[2] ? Number(m[2]) : 0)));
  if ((m = s.match(/speed (\d{3})(?: knots)?(?: until (\d{1,2}))?/))) out.push('S' + m[1] + (m[2] ? '/' + m[2] : ''));
  if (/minimum clean/.test(s)) out.push('SMIN');
  if (/resume normal speed/.test(s)) out.push('SRES');
  if ((m = s.match(/(ils|i l s|rnp|r n p|visual) approach runway (\d{2})\s*(left|right)?/))) {
    const t = m[1].replace(/\s/g, '').startsWith('ils') ? 'ILS' : m[1].startsWith('r') ? 'RNP' : 'VIS';
    out.push(t + m[2] + (m[3] === 'left' ? 'L' : m[3] === 'right' ? 'R' : ''));
  } else if (/cleared (ils|i l s) approach/.test(s)) out.push('ILS');
  if ((m = s.match(/direct ([a-z ]{3,12}?)(?= (?:descend|climb|speed|cleared|maintain|$)|\s*$)/))) {
    const raw = m[1].replace(/\s/g, '').toUpperCase();
    const f = fixes.find((x) => x === raw) ?? fixes.find((x) => x.startsWith(raw.slice(0, 4)));
    if (f) out.push('DCT', f);
  }
  if ((m = s.match(/hold(?: at)? ([a-z]{4,6})/))) { const f = fixes.find((x) => x === m![1].toUpperCase()); out.push('HOLD', f ?? 'ALHUV'); }
  if (/contact tower|tower one one eight/.test(s)) out.push('TWR');
  if (/contact brussels/.test(s)) out.push('BRU');
  if (/\bapproved\b/.test(s)) out.push('Y');
  if (/\bunable\b/.test(s)) out.push('N');
  if (/resume own navigation/.test(s)) out.push('RON');
  if (/cancel approach clearance/.test(s)) out.splice(bestScore >= 2 ? 1 : 0, 0, 'BRK');
  if (/now current/.test(s)) out.push('ATIS');
  if (/\broger\b|\bidentified\b/.test(s)) out.push('R');
  if (/\bstand ?by\b/.test(s)) out.push('SB');
  return out.join(' ');
}
