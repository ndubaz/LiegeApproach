import type { Level } from '../pack/load';

export type Unit = 'TWR' | 'BRU' | 'MUAC' | 'BEEK' | 'MIL';
export type ApproachType = 'ILS' | 'RNP' | 'VIS';

export type Item =
  | { k: 'hdg'; hdg: number; dir?: 'L' | 'R' }      // magnetic heading
  | { k: 'dct'; fix: string }
  | { k: 'lvl'; lvl: Level }
  | { k: 'spd'; spd: number; until?: number }
  | { k: 'spdmin' }
  | { k: 'spdres' }
  | { k: 'app'; app: ApproachType; rwy: string }
  | { k: 'hold'; fix: string }
  | { k: 'trans'; name: string }
  | { k: 'ron' }
  | { k: 'xfr'; unit: Unit }
  | { k: 'appr' }
  | { k: 'deny' }
  | { k: 'sqk'; code: string }
  | { k: 'brk' }                                    // cancel approach clearance (break-off)
  | { k: 'atis' }                                   // "information L now current, QNH 1016"
  | { k: 'rel'; after?: string; hdg?: number; lvl?: Level }   // departure release (intercom to Tower); hdg magnetic
  | { k: 'relhold'; mins?: number }                 // hold a departure, expect release in n minutes
  | { k: 'roger' }                                  // "CS, Liège Approach, identified" (first call) or "CS, roger": answers a call, no readback
  | { k: 'standby' };                               // "CS, standby": answers a call for now; the pilot calls again if nothing follows

export interface Clearance { cs: string; items: Item[] }

export const ITEM_ORDER: Item['k'][] = ['roger', 'standby', 'rel', 'relhold', 'atis', 'brk', 'hdg', 'dct', 'trans', 'ron', 'hold', 'lvl', 'spd', 'spdmin', 'spdres', 'app', 'sqk', 'appr', 'deny', 'xfr'];
export const sortItems = (items: Item[]) => [...items].sort((a, b) => ITEM_ORDER.indexOf(a.k) - ITEM_ORDER.indexOf(b.k));

/** Merge a new item into a list: one item per kind (approve/deny exclusive, spd variants exclusive). */
export function mergeItem(items: Item[], it: Item): Item[] {
  const group = (k: Item['k']) => (k === 'spd' || k === 'spdmin' || k === 'spdres' ? 'spd' : k === 'appr' || k === 'deny' ? 'ans' : k === 'rel' || k === 'relhold' ? 'rel' : k === 'roger' || k === 'standby' ? 'ack' : k === 'hdg' || k === 'dct' || k === 'trans' || k === 'ron' || k === 'hold' ? 'lat' : k);
  return sortItems([...items.filter((x) => group(x.k) !== group(it.k)), it]);
}

// ---------- Telephony ----------
export const TELEPHONY: Record<string, string> = {
  DHK: 'World Express', BCS: 'Eurotrans', QTR: 'Qatari', THY: 'Turkish', CLX: 'Cargolux', FDX: 'FedEx',
  ETH: 'Ethiopian', CHG: 'Challenge', TAY: 'Quality', JAF: 'Beauty', MSR: 'Egyptair', AZG: 'Silk West',
  CKS: 'Connie', UPS: 'UPS', ABR: 'Contract', SWT: 'Swift', GEC: 'Lufthansa Cargo', CAO: 'Air China Freight',
  ABB: 'Air Belgium', RYR: 'Ryanair', TRA: 'Transavia', BEL: 'Beeline',
  BAF: 'Belgian Air Force', NATO: 'NATO', RCH: 'Reach', ASCOT: 'Ascot', GAF: 'German Air Force', NAF: 'Netherlands Air Force',
  FCK: 'Flight Check', LIFE: 'Lifeliner',
};
const PHON: Record<string, string> = {
  A: 'Alfa', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett',
  K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango',
  U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
};
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
export const digits = (s: string | number) => String(s).split('').map((c) => (/\d/.test(c) ? DIG[Number(c)] : PHON[c.toUpperCase()] ?? c)).join(' ');

export function telephony(cs: string): string {
  if (/^OO[A-Z]{3}$/.test(cs)) return `${PHON.O} ${PHON.O} ${cs.slice(2).split('').map((c) => PHON[c]).join(' ')}`;
  const m = cs.match(/^([A-Z]+?)(\d[A-Z0-9]*)$/);
  if (m && TELEPHONY[m[1]]) return `${TELEPHONY[m[1]]} ${digits(m[2])}`;
  const m2 = cs.match(/^([A-Z]{3,5})(\d+[A-Z]*)$/);
  if (m2 && TELEPHONY[m2[1]]) return `${TELEPHONY[m2[1]]} ${digits(m2[2])}`;
  return digits(cs);
}

// ---------- Levels ----------
export function levelText(l: Level): string {
  if (l.fl !== undefined) return `FL${String(l.fl).padStart(3, '0')}`;
  return `${l.ft!.toLocaleString('en-US')} ft`;
}
export function levelSpeech(l: Level): string {
  if (l.fl !== undefined) return `flight level ${digits(String(l.fl).padStart(3, '0').replace(/^0/, ''))}`;
  const ft = l.ft!;
  const th = Math.floor(ft / 1000), hu = Math.round((ft % 1000) / 100);
  return `altitude ${th ? digits(th) + ' thousand' : ''}${hu ? ' ' + digits(hu) + ' hundred' : ''} feet`.replace(/\s+/g, ' ');
}
export const levelShort = (l: Level) => (l.fl !== undefined ? String(l.fl).padStart(3, '0') : 'A' + String(Math.round(l.ft! / 100)).padStart(2, '0'));

/** Frequency in words: all six digits, unless the last two are zero ("one three one decimal one"). */
export function freqSpeech(f: string): string {
  const [a, b = ''] = f.split('.');
  const dec = b.padEnd(3, '0');
  const said = dec.endsWith('00') ? dec.slice(0, 1) : dec;
  return `${digits(a)} decimal ${digits(said)}`;
}
const U = (name: string, freq: string) => ({ text: `${name} ${freq}`, speech: `${name} ${freqSpeech(freq)}` });
const UNIT_NAME: Record<Unit, { text: string; speech: string }> = {
  TWR: U('Tower', '118.130'),
  BRU: U('Brussels Control', '131.100'),
  MUAC: U('Maastricht', '132.755'),
  BEEK: U('Beek Approach', '123.980'),
  // Military unit name and frequency are a sim construct (approximate).
  MIL: U('Military', '129.100'),
};
export const unitName = (u: Unit) => UNIT_NAME[u];

export interface Ctx {
  /** current altitude ft and whether the new level is below it */
  alt: number;
  qnh: number;
  hdgMag: number;
  request?: string;
  /** current IAS, for reduce / increase / maintain */
  ias?: number;
  /** say the QNH after the first altitude (first altitude clearance below the transition level) */
  qnhSay?: boolean;
  /** append "vectoring for <app> approach runway <rwy>" after the first heading */
  vectorFor?: { app: ApproachType; rwy: string };
  /** approach clearance on vectors: distance from touchdown to prefix */
  posNm?: number;
  /** hold: expected approach clearance time "HHMM", or null for "no delay expected" */
  efc?: string | null;
  /** the request being answered (for approve / unable phraseology) */
  req?: { kind: string; route?: string[]; vfr?: boolean; sqk?: string; alt?: number; fix?: string; level?: Level };
  /** current ATIS letter (for the 'atis' item) */
  atis?: string;
  /** force the level verb (readback errors keep the controller's verb) */
  lvlVerb?: 'descend' | 'climb' | 'maintain';
  /** level the pilot is already cleared to (re-stating it says "maintain", never "climb" or "descend") */
  cleared?: Level;
  /** the aircraft has not been spoken to yet: "roger" becomes "Liège Approach, identified" */
  firstCall?: boolean;
}

export const rwySpeech = (rwy: string) => rwy.replace(/(\d+)([LRC]?)/, (_m, n, l) => `${digits(n)}${l ? ' ' + (l === 'L' ? 'left' : l === 'R' ? 'right' : 'center') : ''}`);
const appName = (a: ApproachType) => (a === 'ILS' ? { t: 'ILS', s: 'I L S' } : a === 'RNP' ? { t: 'RNP', s: 'R N P' } : { t: 'visual', s: 'visual' });
const levelFt = (l: Level, qnh: number) => (l.fl !== undefined ? l.fl * 100 + (qnh - 1013.25) * 27 : l.ft!);
const sameLevel = (a: Level, b: Level) => a.fl === b.fl && a.ft === b.ft;
export function levelVerb(l: Level, alt: number, qnh: number): 'descend' | 'climb' | 'maintain' {
  const ft = levelFt(l, qnh);
  return ft < alt - 50 ? 'descend' : ft > alt + 50 ? 'climb' : 'maintain';
}
const qnhSpeech = (q: number) => `Q N H ${digits(q)}`;

/** ATC phraseology for a clearance, as display text and as speech text. */
export function phraseology(cl: Clearance, ctx: Ctx): { text: string; speech: string } {
  const t: string[] = [];
  const s: string[] = [];
  let qnhDone = !ctx.qnhSay;
  let vecDone = !ctx.vectorFor;
  const hasApp = cl.items.some((i) => i.k === 'app');
  if (ctx.posNm !== undefined && hasApp) { t.push(`${Math.round(ctx.posNm)} miles from touchdown`); s.push(`${digits(Math.round(ctx.posNm))} miles from touchdown`); }
  for (const it of cl.items) {
    switch (it.k) {
      case 'brk': t.push('cancel approach clearance'); s.push('cancel approach clearance'); break;
      case 'hdg': {
        const h = String(Math.round(it.hdg) % 360 || 360).padStart(3, '0');
        const dir = it.dir === 'L' ? 'left ' : it.dir === 'R' ? 'right ' : '';
        if (dir) { t.push(`turn ${dir}heading ${h}`); s.push(`turn ${dir}heading ${digits(h)}`); } else { t.push(`fly heading ${h}`); s.push(`fly heading ${digits(h)}`); }
        if (!vecDone && !hasApp) {
          vecDone = true;
          const a = appName(ctx.vectorFor!.app);
          t.push(`vectoring for ${a.t} approach runway ${ctx.vectorFor!.rwy}`);
          s.push(`vectoring for ${a.s} approach runway ${rwySpeech(ctx.vectorFor!.rwy)}`);
        }
        break;
      }
      case 'dct': t.push(`proceed direct ${it.fix}`); s.push(`proceed direct ${it.fix}`); break;
      case 'trans': t.push(`cleared ${it.name} transition`); s.push(`cleared ${it.name.replace(/(\d)([A-Z])$/, (_m, d, l) => ` ${digits(d)} ${digits(l)}`)} transition`); break;
      case 'ron': t.push('resume own navigation'); s.push('resume own navigation'); break;
      case 'hold':
        t.push(`hold at ${it.fix} as published`); s.push(`hold at ${it.fix} as published`);
        if (ctx.efc === null) { t.push('no delay expected'); s.push('no delay expected'); }
        else if (ctx.efc) { t.push(`expect approach clearance at ${ctx.efc}`); s.push(`expect approach clearance at ${digits(ctx.efc)}`); }
        break;
      case 'roger':
        if (ctx.firstCall) { t.push('Liège Approach, identified'); s.push('Liège Approach, identified'); } else { t.push('roger'); s.push('roger'); }
        break;
      case 'standby': t.push('standby'); s.push('standby'); break;
      case 'lvl': {
        const same = !!ctx.cleared && sameLevel(ctx.cleared, it.lvl) && Math.abs(levelFt(it.lvl, ctx.qnh) - ctx.alt) < 400;
        const verb = ctx.lvlVerb ?? (same ? 'maintain' : levelVerb(it.lvl, ctx.alt, ctx.qnh));
        t.push(`${verb} ${levelText(it.lvl)}`);
        s.push(`${verb} ${levelSpeech(it.lvl)}`);
        if (!qnhDone && it.lvl.ft !== undefined) { qnhDone = true; t.push(`QNH ${ctx.qnh}`); s.push(qnhSpeech(ctx.qnh)); }
        break;
      }
      case 'spd': {
        const verb = ctx.ias === undefined ? 'speed' : it.spd < ctx.ias - 3 ? 'reduce speed' : it.spd > ctx.ias + 3 ? 'increase speed' : 'maintain';
        t.push(`${verb} ${it.spd} kt${it.until ? ` until ${it.until} DME` : ''}`);
        s.push(`${verb} ${digits(it.spd)} knots${it.until ? ` until ${digits(it.until)} D M E` : ''}`);
        break;
      }
      case 'spdmin': t.push('reduce to minimum clean speed'); s.push('reduce to minimum clean speed'); break;
      case 'spdres': t.push('resume normal speed'); s.push('resume normal speed'); break;
      case 'app': {
        const a = appName(it.app);
        t.push(`cleared ${a.t} approach runway ${it.rwy}`); s.push(`cleared ${a.s} approach runway ${rwySpeech(it.rwy)}`);
        break;
      }
      case 'sqk': t.push(`squawk ${it.code}`); s.push(`squawk ${digits(it.code)}`); break;
      case 'atis': t.push(`information ${ctx.atis ?? ''} now current, QNH ${ctx.qnh}`); s.push(`information ${digits(ctx.atis ?? '')} now current, ${qnhSpeech(ctx.qnh)}`); break;
      case 'appr': {
        const r = ctx.req;
        if (r?.kind === 'crossing' && r.vfr && r.route?.length) {
          const last = r.route[r.route.length - 1];
          const alt = r.alt ?? 1500;
          t.push(`cleared to cross the control zone via ${r.route.join(', ')}, VFR, altitude ${alt.toLocaleString('en-US')} ft or below${r.sqk ? `, squawk ${r.sqk}` : ''}, QNH ${ctx.qnh}, report ${last}`);
          s.push(`cleared to cross the control zone via ${r.route.join(', ')}, V F R, ${levelSpeech({ ft: alt })} or below${r.sqk ? `, squawk ${digits(r.sqk)}` : ''}, ${qnhSpeech(ctx.qnh)}, report ${last}`);
        } else if (r?.kind === 'direct' && r.fix) { t.push(`proceed direct ${r.fix}`); s.push(`proceed direct ${r.fix}`); }
        else if (r?.kind === 'climb' && r.level) {
          const verb = levelVerb(r.level, ctx.alt, ctx.qnh);
          t.push(`${verb} ${levelText(r.level)}`); s.push(`${verb} ${levelSpeech(r.level)}`);
        } else { t.push('approved'); s.push('approved'); }
        break;
      }
      case 'deny': {
        const r = ctx.req;
        const x = r?.kind === 'crossing' && r.vfr ? 'remain outside the control zone, expect 5 minutes delay' : r ? 'unable, due traffic' : 'unable, standby';
        t.push(x); s.push(x);
        break;
      }
      case 'xfr': t.push(`contact ${UNIT_NAME[it.unit].text}`); s.push(`contact ${UNIT_NAME[it.unit].speech}`); break;
      case 'rel': case 'relhold': {
        const r = releasePhrase(cl.cs, it);
        t.push(r.text); s.push(r.speech);
        break;
      }
    }
  }
  return { text: `${cl.cs}, ${t.join(', ')}`, speech: `${telephony(cl.cs)}, ${s.join(', ')}` };
}

/** Intercom phraseology for a departure release (Approach to Tower). */
export function releasePhrase(cs: string, it: Extract<Item, { k: 'rel' | 'relhold' }>): { text: string; speech: string } {
  if (it.k === 'relhold') {
    const x = it.mins ? `hold ${cs}, expect release in ${it.mins} minute${it.mins === 1 ? '' : 's'}` : `hold ${cs}, expect further release`;
    return { text: x, speech: x };
  }
  const parts = [`${cs} released`];
  if (it.after) parts[0] += ` after ${it.after}`;
  if (it.hdg !== undefined) parts.push(`heading ${String(Math.round(it.hdg) % 360 || 360).padStart(3, '0')}`);
  if (it.lvl) parts.push(`climb ${levelText(it.lvl)}`);
  const text = parts.join(', ');
  return { text, speech: text };
}

/** Pilot readback text. `wrong` optionally overrides one item with an erroneous value. */
export function readback(cs: string, items: Item[], ctx: Ctx, wrong?: { idx: number; item: Item }): { text: string; speech: string } {
  // a refusal is acknowledged, not read back ("unable, standby" is the controller's line, never the pilot's)
  const its = items.map((it, i) => (wrong && wrong.idx === i ? wrong.item : it)).map((it): Item => (it.k === 'deny' ? { k: 'roger' } : it)).filter((it) => it.k !== 'standby');
  if (!its.length) return { text: `roger, ${cs}`, speech: `roger, ${telephony(cs)}` };
  // a wrong level is read back with the controller's verb ("descend 5,000 ft" stays "descend")
  const orig = wrong ? items[wrong.idx] : undefined;
  const c2: Ctx = orig?.k === 'lvl' ? { ...ctx, lvlVerb: levelVerb(orig.lvl, ctx.alt, ctx.qnh) } : ctx;
  const p = phraseology({ cs, items: its }, { ...c2, posNm: undefined, firstCall: false });
  // Pilots read back with the callsign at the end and drop "proceed"/"fly" filler.
  const body = (x: string, csx: string) => x.slice(csx.length + 2).replace(/^fly /, '').replace(/, fly /g, ', ').replace(/proceed direct/g, 'direct').replace(/contact /, '');
  return { text: `${body(p.text, cs)}, ${cs}`, speech: `${body(p.speech, telephony(cs))}, ${telephony(cs)}` };
}

export function itemChip(it: Item): string {
  switch (it.k) {
    case 'hdg': return `${it.dir ?? 'H'}${String(Math.round(it.hdg) % 360 || 360).padStart(3, '0')}`;
    case 'dct': return `DCT ${it.fix}`;
    case 'lvl': return it.lvl.fl !== undefined ? `FL${String(it.lvl.fl).padStart(3, '0')}` : String(it.lvl.ft);
    case 'spd': return `${it.spd}${it.until ? '/' + it.until : ''}`;
    case 'spdmin': return 'MIN CLN';
    case 'spdres': return 'SPD RES';
    case 'app': return `${it.app} ${it.rwy}`;
    case 'hold': return `HOLD ${it.fix}`;
    case 'trans': return it.name;
    case 'ron': return 'OWN NAV';
    case 'xfr': return it.unit;
    case 'appr': return 'APPROVED';
    case 'deny': return 'UNABLE';
    case 'sqk': return `SQK ${it.code}`;
    case 'brk': return 'BRK OFF';
    case 'atis': return 'ATIS';
    case 'rel': return `REL${it.after ? ' /' + it.after : ''}${it.hdg !== undefined ? ' H' + String(it.hdg).padStart(3, '0') : ''}${it.lvl ? ' ' + (it.lvl.fl !== undefined ? 'FL' + String(it.lvl.fl).padStart(3, '0') : it.lvl.ft) : ''}`;
    case 'relhold': return `REL HOLD${it.mins ? ' ' + it.mins + ' MIN' : ''}`;
    case 'roger': return 'ROGER';
    case 'standby': return 'STBY';
  }
}

/** Approximate airtime in seconds of a transmission. */
export const airtime = (speech: string) => 0.6 + speech.split(/\s+/).length * 0.3;
