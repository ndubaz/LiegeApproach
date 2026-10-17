import { hashStr } from '../engine/rng';
import type { ModelId } from './neural';
import type { AccentLang } from './accent';
import { CAST_POOLS } from './cast-pools';
import type { Pack } from '../pack/load';

// Who speaks for each callsign. Each airline maps to the accent groups its crews plausibly
// have (a Qatar crew is as likely Indian or Arab as anything else; a FedEx crew American),
// each group to auditioned speakers, and the callsign hash picks one, so a flight keeps
// the same voice, rate and radio character for the whole shift.

export type Group = 'us' | 'uk' | 'ie' | 'scot' | 'in' | 'ar' | 'zh' | 'ko' | 'es' | 'vi' | 'sa' | 'au' | 'ca' | 'de' | 'fr' | 'nl';
export interface Speaker {
  model: ModelId;
  sid: number;
  /** corpus speaker name, for the credits and tests */
  name: string;
  group: Group;
  sex: 'm' | 'f';
  /** espeak voice used to phonemise the English text */
  espeak: string;
  /** substitute this language's sounds for English ones */
  accent?: AccentLang;
  /** speaking-rate correction for this speaker (Piper length scale) */
  length: number;
}

/** Airline (ICAO prefix) to accent groups, weighted by repetition. */
export const AIRLINE_GROUPS: Record<string, Group[]> = {
  FDX: ['us', 'us', 'us', 'ca'], UPS: ['us', 'us', 'us', 'ca'], CKS: ['us'], RCH: ['us'], GTI: ['us'], ABX: ['us'],
  QTR: ['in', 'in', 'ar', 'ar', 'uk', 'sa', 'es'], ETH: ['ar', 'in'], MSR: ['ar'], THY: ['ar', 'es', 'de'], AZG: ['ar', 'es', 'de'],
  CHG: ['ar', 'us', 'fr'], CAO: ['zh'], CSS: ['zh'], KAL: ['ko'], AAR: ['ko'], HVN: ['vi'],
  DHK: ['uk', 'uk', 'scot', 'ie', 'de'], ABR: ['ie', 'ie', 'uk'], RYR: ['ie', 'uk', 'es', 'de'], EZY: ['uk', 'scot'], ASCOT: ['uk'],
  BCS: ['de', 'de', 'uk', 'nl'], GEC: ['de'], GAF: ['de'], CLX: ['fr', 'de', 'nl', 'uk'], SWT: ['es'],
  TAY: ['fr', 'nl', 'fr', 'nl'], ABB: ['fr', 'nl'], BEL: ['nl', 'fr'], BAF: ['nl', 'fr'], JAF: ['nl', 'fr'], TRA: ['nl'], NAF: ['nl'],
  NATO: ['us', 'de', 'nl', 'uk'], FCK: ['de', 'uk'], LIFE: ['nl'], OO: ['fr', 'nl'],
};
/**
 * Other units on the intercom and the controller's own voice, by unit id. Filled from the pack's `units[].voices`
 * (Liège is French-speaking; Beek is Dutch) by `setCastingPack`; this is the Liège table until a pack is set.
 */
export let UNIT_GROUPS: Record<string, Group[]> = {
  TWR: ['fr'], BRU: ['nl', 'fr'], MIL: ['nl', 'fr'], BEEK: ['nl'], MUAC: ['de', 'nl', 'uk'], SUP: ['fr'], ATC: ['fr', 'nl'],
};
/** The unit voices of a pack: each unit's `voices`, the controller (ATC) with the tower's voices (the position is in the same room). */
export function unitGroupsOf(pack: Pack): Record<string, Group[]> {
  const out: Record<string, Group[]> = {};
  for (const u of pack.units) if (u.voices?.length) out[u.id] = u.voices as Group[];
  const twr = pack.units.find((u) => u.role === 'tower');
  out.ATC = (twr?.voices?.length ? twr.voices : ['uk']) as Group[];
  return out;
}
/** Cast the intercom units from this pack (the game calls it when a session starts). */
export function setCastingPack(pack: Pack) { UNIT_GROUPS = unitGroupsOf(pack); }
/** When a group has no voice in the loaded models, use these instead. Dutch, Flemish and French crews
 * speak with British voices: no usable Dutch or French voice model reads English yet (docs/VOICES.md). */
const FALLBACK: Record<Group, Group[]> = {
  us: ['ca', 'uk'], uk: ['scot', 'ie'], ie: ['uk'], scot: ['uk'], in: ['uk'], ar: ['in', 'es'], zh: ['ko', 'vi'], ko: ['zh'], es: ['ar'], vi: ['zh'],
  sa: ['uk'], au: ['uk'], ca: ['us'], de: ['uk'], fr: ['uk', 'ie'], nl: ['uk', 'ie'],
};

export function prefixOf(who: string): string {
  if (/^OO[A-Z]{3}$/.test(who)) return 'OO';
  return who.match(/^([A-Z]{2,5}?)(?=\d)/)?.[1] ?? who.match(/^[A-Z]+/)?.[0] ?? who;
}
export function groupsFor(who: string): Group[] {
  return UNIT_GROUPS[who] ?? AIRLINE_GROUPS[prefixOf(who)] ?? ['uk', 'us', 'de', 'nl', 'fr', 'in', 'es'];
}

export interface Cast { speaker: Speaker; length: number; drive: number }

/** The voice for a callsign or unit, from the speakers in the given models. Stable for a callsign. */
export function castFor(who: string, available: Set<ModelId>, pools: Speaker[] = CAST_POOLS): Cast | undefined {
  const usable = pools.filter((s) => available.has(s.model));
  if (!usable.length) return undefined;
  const h = hashStr(who);
  const wanted = groupsFor(who);
  let group = wanted[h % wanted.length];
  const has = (g: Group) => usable.some((s) => s.group === g);
  if (!has(group)) group = [...wanted, ...FALLBACK[group]].find(has) ?? usable[h % usable.length].group;
  // crews are mostly men; 1 in 6 flights gets a woman's voice where the group has one
  const inGroup = usable.filter((s) => s.group === group);
  const wantF = (h >>> 5) % 6 === 0 && who.length > 3;
  const bySex = inGroup.filter((s) => s.sex === (wantF ? 'f' : 'm'));
  const pick = (bySex.length ? bySex : inGroup)[(h >>> 8) % (bySex.length ? bySex : inGroup).length];
  // each pilot talks at their own pace (±8 %) and has their own audio chain
  const pace = 0.92 + ((h >>> 12) % 17) / 100;
  return { speaker: pick, length: pick.length * pace, drive: ((h >>> 16) % 100) / 100 };
}
