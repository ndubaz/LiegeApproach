import type { Level } from '../pack/load';

export type Unit = 'TWR' | 'BRU' | 'MUAC' | 'BEEK';
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
  | { k: 'sqk'; code: string };

export interface Clearance { cs: string; items: Item[] }

export const ITEM_ORDER: Item['k'][] = ['hdg', 'dct', 'trans', 'ron', 'hold', 'lvl', 'spd', 'spdmin', 'spdres', 'app', 'sqk', 'appr', 'deny', 'xfr'];
export const sortItems = (items: Item[]) => [...items].sort((a, b) => ITEM_ORDER.indexOf(a.k) - ITEM_ORDER.indexOf(b.k));

/** Merge a new item into a list: one item per kind (approve/deny exclusive, spd variants exclusive). */
export function mergeItem(items: Item[], it: Item): Item[] {
  const group = (k: Item['k']) => (k === 'spd' || k === 'spdmin' || k === 'spdres' ? 'spd' : k === 'appr' || k === 'deny' ? 'ans' : k === 'hdg' || k === 'dct' || k === 'trans' || k === 'ron' || k === 'hold' ? 'lat' : k);
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

const UNIT_NAME: Record<Unit, { text: string; speech: string }> = {
  TWR: { text: 'Tower 118.130', speech: 'Tower one one eight decimal one three' },
  BRU: { text: 'Brussels Control 131.100', speech: 'Brussels Control one three one decimal one' },
  MUAC: { text: 'Maastricht 132.755', speech: 'Maastricht one three two decimal seven five five' },
  BEEK: { text: 'Beek Approach 123.980', speech: 'Beek Approach one two three decimal niner eight' },
};
export const unitName = (u: Unit) => UNIT_NAME[u];

export interface Ctx {
  /** current altitude ft and whether the new level is below it */
  alt: number;
  qnh: number;
  hdgMag: number;
  request?: string;
}

/** ATC phraseology for a clearance, as display text and as speech text. */
export function phraseology(cl: Clearance, ctx: Ctx): { text: string; speech: string } {
  const t: string[] = [];
  const s: string[] = [];
  for (const it of cl.items) {
    switch (it.k) {
      case 'hdg': {
        const h = String(Math.round(it.hdg) % 360 || 360).padStart(3, '0');
        const dir = it.dir === 'L' ? 'left ' : it.dir === 'R' ? 'right ' : '';
        if (dir) { t.push(`turn ${dir}heading ${h}`); s.push(`turn ${dir}heading ${digits(h)}`); } else { t.push(`fly heading ${h}`); s.push(`fly heading ${digits(h)}`); }
        break;
      }
      case 'dct': t.push(`proceed direct ${it.fix}`); s.push(`proceed direct ${it.fix}`); break;
      case 'trans': t.push(`cleared ${it.name} transition`); s.push(`cleared ${it.name.replace(/(\d)([A-Z])$/, (_m, d, l) => ` ${digits(d)} ${digits(l)}`)} transition`); break;
      case 'ron': t.push('resume own navigation'); s.push('resume own navigation'); break;
      case 'hold': t.push(`hold at ${it.fix} as published`); s.push(`hold at ${it.fix} as published`); break;
      case 'lvl': {
        const ft = it.lvl.fl !== undefined ? it.lvl.fl * 100 + (ctx.qnh - 1013.25) * 27 : it.lvl.ft!;
        const verb = ft < ctx.alt - 50 ? 'descend' : ft > ctx.alt + 50 ? 'climb' : 'maintain';
        t.push(`${verb} ${levelText(it.lvl)}`);
        s.push(`${verb} ${levelSpeech(it.lvl)}`);
        break;
      }
      case 'spd': t.push(`speed ${it.spd} kt${it.until ? ` until ${it.until} DME` : ''}`); s.push(`speed ${digits(it.spd)} knots${it.until ? ` until ${digits(it.until)} D M E` : ''}`); break;
      case 'spdmin': t.push('reduce minimum clean speed'); s.push('reduce minimum clean speed'); break;
      case 'spdres': t.push('resume normal speed'); s.push('resume normal speed'); break;
      case 'app': {
        const r = it.rwy.replace(/(\d+)([LRC]?)/, (_m, n, l) => `${digits(n)}${l ? ' ' + (l === 'L' ? 'left' : l === 'R' ? 'right' : 'center') : ''}`);
        const name = it.app === 'ILS' ? 'ILS' : it.app === 'RNP' ? 'RNP' : 'visual';
        t.push(`cleared ${name} approach runway ${it.rwy}`); s.push(`cleared ${name === 'ILS' ? 'I L S' : name === 'RNP' ? 'R N P' : 'visual'} approach runway ${r}`);
        break;
      }
      case 'sqk': t.push(`squawk ${it.code}`); s.push(`squawk ${digits(it.code)}`); break;
      case 'appr': t.push(ctx.request ? `approved` : 'approved'); s.push('approved'); break;
      case 'deny': t.push('unable, standby'); s.push('unable, standby'); break;
      case 'xfr': t.push(`contact ${UNIT_NAME[it.unit].text}`); s.push(`contact ${UNIT_NAME[it.unit].speech}`); break;
    }
  }
  return { text: `${cl.cs}, ${t.join(', ')}`, speech: `${telephony(cl.cs)}, ${s.join(', ')}` };
}

/** Pilot readback text. `wrong` optionally overrides one item with an erroneous value. */
export function readback(cs: string, items: Item[], ctx: Ctx, wrong?: { idx: number; item: Item }): { text: string; speech: string } {
  const its = items.map((it, i) => (wrong && wrong.idx === i ? wrong.item : it));
  const p = phraseology({ cs, items: its }, ctx);
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
    case 'xfr': return it.unit === 'TWR' ? 'TWR' : it.unit === 'BRU' ? 'BRU' : it.unit;
    case 'appr': return 'APPROVED';
    case 'deny': return 'UNABLE';
    case 'sqk': return `SQK ${it.code}`;
  }
}

/** Approximate airtime in seconds of a transmission. */
export const airtime = (speech: string) => 0.6 + speech.split(/\s+/).length * 0.3;
