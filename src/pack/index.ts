import type { PackSpec } from './types';
import { loadPack, type Pack } from './load';
import { EBLG } from './eblg';

// The location packs the game can run. Each entry is a factory so a pack's data is only built when it is asked for.
// The lead adds Düsseldorf here: EDDL: () => EDDL.

export const PACKS: Record<string, () => PackSpec> = {
  EBLG: () => EBLG,
};
export const DEFAULT_PACK = 'EBLG';

const cache = new Map<string, Pack>();
/** The compiled pack for an ICAO id, cached. Unknown ids fall back to the default pack. */
export function loadPackById(id: string): Pack {
  const key = PACKS[id] ? id : DEFAULT_PACK;
  let p = cache.get(key);
  if (!p) { p = loadPack(PACKS[key]()); cache.set(key, p); }
  return p;
}
/** The airports on offer, for the menu: id, name and the approach callsign. */
export function airportList(): { icao: string; name: string; callsign: string; country?: string }[] {
  return Object.keys(PACKS).map((id) => { const s = PACKS[id](); return { icao: s.meta.icao, name: s.meta.name, callsign: s.meta.appCallsign, country: s.country }; });
}
