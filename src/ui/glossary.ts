// Every term the game uses, in plain English. Shared by the help page, the game screen and the tutorial.
// Keys are the term as it appears on screen; values are one or two plain sentences.
//
// 2.0: the entries that name an airport fact (the centre, the stack fix, the transition altitude, the reserved
// areas) are written from the pack by `glossaryFor(pack)`. `GLOSSARY` stays the Liège wording for the lessons.
import type { Pack } from '../pack/load';
import { unitByRole, unitTable } from '../engine/clearance';

/** What the glossary needs to know about an airport. */
export interface GlossaryFacts {
  name: string;
  /** the centre's short name on the landline ("Brussels", "Langen") */
  centre: string;
  stackFix: string;
  transitionAltitude: number;
  areasName: string;
  /** the departure transfer level to the centre, as text ("FL060") */
  depXfl: string;
  /** the wake categories most of this airport's traffic falls in */
  wakeNote: string;
  sectorNm: number;
}
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const LIEGE: GlossaryFacts = { name: 'Liège', centre: 'Brussels', stackFix: 'ALHUV', transitionAltitude: 4500, areasName: 'TSA', depXfl: 'FL060', wakeNote: 'Most Liège freighters are B or C.', sectorNm: 40 };

/** The glossary facts of a pack. */
export function glossaryFacts(pack: Pack): GlossaryFacts {
  const units = unitTable(pack);
  const acc = unitByRole(units, 'acc');
  const lvl = pack.depXfl as { fl?: number; ft?: number } | undefined;
  const depXfl = lvl?.fl !== undefined ? `FL${String(lvl.fl).padStart(3, '0')}` : lvl?.ft !== undefined ? `${thousands(lvl.ft)} ft` : LIEGE.depXfl;
  const pax = (pack.spec.traffic?.pax?.length ?? 0) > (pack.spec.traffic?.cargo?.length ?? 0);
  return {
    name: pack.meta.name, centre: acc?.say ?? 'the centre', stackFix: pack.stackFix, transitionAltitude: pack.meta.transitionAltitude,
    areasName: pack.reservedAreasName, depXfl,
    wakeNote: pax ? `Most ${pack.meta.name} traffic is category E (A320, B737), with B and C long-haul widebodies in between.` : `Most ${pack.meta.name} freighters are B or C.`,
    sectorNm: pack.meta.sectorRadiusNm,
  };
}

/** The glossary written for an airport. */
export function glossaryFor(pack?: Pack): Record<string, string> {
  return glossaryWith(pack ? glossaryFacts(pack) : LIEGE);
}

function glossaryWith(f: GlossaryFacts): Record<string, string> {
  const areas = f.areasName === 'TSA' ? 'TSA' : f.areasName;
  return {
  NM: 'Nautical mile, 1.852 km. All distances on the radar are in nautical miles.',
  kt: 'Knots: nautical miles per hour. Speeds you assign are indicated airspeed; the label shows ground speed in tens of knots.',
  ft: 'Feet. Altitudes below the transition level are in feet above sea level on the local QNH.',
  FL: 'Flight level: altitude on the standard pressure setting 1013 hPa, in hundreds of feet. FL080 is about 8,000 ft.',
  QNH: 'The local air pressure setting. With it set, the altimeter shows height above sea level. Pass it to every arrival on first contact.',
  'Transition altitude': `At ${f.name} ${thousands(f.transitionAltitude)} ft. Climbing through it, pilots switch to the standard setting and fly flight levels.`,
  'Transition level': 'The lowest flight level you can use, at least 1,000 ft above the transition altitude. It changes with the QNH; the briefing and ATIS give it.',
  ATIS: 'Automatic Terminal Information Service: the recorded broadcast with runway, wind, visibility and QNH, identified by a letter. Pilots report the letter they have.',
  METAR: 'The coded weather report the ATIS is built from. The briefing decodes it for you.',
  STAR: `Standard arrival route: the published path from the airways to the terminal area. At ${f.name} the arrivals gather at ${f.stackFix}.`,
  SID: `Standard instrument departure: the published climb-out from the runway to the airways. ${f.name} SIDs stop at ${f.depXfl} until you climb them.`,
  Transition: `An RNAV route from the end of the STAR to the intermediate fix (from ${f.stackFix} here). It carries its own level and speed restrictions.`,
  IF: 'Intermediate fix: where the transition ends and the aircraft lines up with the final approach.',
  FAF: 'Final approach fix: where the final descent on the glidepath starts.',
  ILS: 'Instrument landing system: a radio beam for direction (localizer) and descent (glidepath) down to the runway.',
  LOC: 'Localizer: the part of the ILS that gives the runway centreline. An aircraft is "established" once it has captured it.',
  GS: 'Glidepath (glideslope): the part of the ILS that gives the 3 degree descent. It must be joined from below.',
  RNP: 'Satellite approach used when the ILS is out. Flown like the ILS, without a ground beam.',
  MVA: 'Minimum vectoring altitude: the lowest level you may assign to an aircraft on your headings. Below it only a published procedure keeps it clear of terrain.',
  TMA: 'Terminal control area: the controlled airspace around the airport where you work arrivals and departures.',
  CTR: 'Control zone: the airspace from the ground up around the runway, belonging to Tower.',
  [areas]: areas === 'TSA' ? 'Temporary segregated area: military airspace. When active, keep every civil aircraft out of it.' : `${areas}: restricted military airspace. When active, keep every civil aircraft out of it.`,
  'RECAT-EU': `The European wake categories, A (heaviest, An-124) to F (light). ${f.wakeNote} The label shows the category after the callsign.`,
  'Wake minima': 'Extra spacing on final behind a heavier aircraft, set by the two RECAT-EU categories. Never less than the 3 NM radar minimum.',
  STCA: 'Short-term conflict alert: the system predicts two aircraft will lose separation within about two minutes and flashes them red.',
  LoS: 'Loss of separation: two aircraft closer than 3 NM and 1,000 ft at the same time.',
  MSAW: 'Minimum safe altitude warning: an aircraft is below or about to go below the MVA.',
  CLAM: 'Cleared level adherence monitor: the aircraft has flown more than 300 ft through the level you cleared.',
  'Mode S SFL': 'Selected flight level downlinked from the cockpit. If it differs from what you cleared, the label shows it with a ≠ sign: the pilot misheard.',
  FTDi: 'Final target distance indicator: a mark on the final ahead of each follower showing where the leader must be for minimum spacing.',
  CPA: 'Closest point of approach: how near two aircraft will get, and when, if nothing changes.',
  RBL: 'Range and bearing line: a measuring tool. Tap RBL, then two points or aircraft, for distance and bearing.',
  EFC: 'Expected approach time (EAT), called expected further clearance (EFC) when the aircraft will not make an approach from the hold: when a holding aircraft can expect to leave. Give it with every hold, and revise it when it moves by five minutes or more.',
  Release: 'Tower asks on the intercom before a departure takes off. You release it when there is a gap: no arrival inside 5 NM and enough spacing behind the last departure.',
  Intercom: `The landline to Tower, ${f.centre}, military control and your supervisor. It does not use the radio frequency.`,
  'Go-around': 'An aborted landing. The aircraft climbs straight ahead on the missed approach and needs a new sequence slot.',
  'Stable approach gate': 'At about 4 NM the aircraft must be on the glidepath, within about 300 ft, and near its approach speed. If not, the crew goes around.',
  Handoff: `Transferring an aircraft to the next unit: arrivals to Tower once established, departures to ${f.centre} before they leave your ${f.sectorNm} NM sector.`,
  Readback: 'The pilot repeats your instruction. Listen to every one; a wrong readback must be corrected within 30 seconds.',
  Squawk: 'The four-digit transponder code. 7700 is an emergency, 7600 a radio failure.',
  MAYDAY: 'Distress call. The aircraft gets priority over everything else, a direct route and a runway as soon as it wants one.',
  'Continuous descent': 'An arrival that descends without levelling off. Quieter and cheaper; it counts toward the Rated grade.',
  AMAN: 'Arrival manager: the timeline of arrivals by time to the runway, to help you build the sequence.',
  Sequence: 'The landing order you build on final. A chain is a run of landings each within 0.7 NM of the minimum spacing.',
  Vectors: 'Headings you give to steer an aircraft off its route, usually to fit it into the sequence.',
  'Track miles': 'The distance an aircraft still has to fly to the runway. Vectors add or remove track miles.',
  LVP: 'Low visibility procedures: in fog, only the CAT III ILS is used and spacing grows to protect the ILS signal.',
  RVR: 'Runway visual range: how far a pilot can see along the runway, in metres.',
  Strip: `An electronic flight strip: one card per flight with its type, route, cleared level and what you last told it. The strip bay sorts them by state: offered by ${f.centre}, landing sequence, hold, departures, other, transferred.`,
  'Safety nets': 'The automatic alarms on the position: STCA for converging aircraft, MSAW for an aircraft too low, CLAM for one that passes its cleared level, and the Mode S check that the pilot set the level you cleared.',
  Estimate: `${f.centre} tells you on the intercom when an arrival will reach your boundary and at what level, a few minutes before it hands it over.`,
  'Push to talk': 'Hold a key, pedal or button to transmit, speak, and let go. Only one voice can use the frequency at a time.',
  Correction: 'Said straight after a wrong transmission: "correction, disregard". It only works before the pilot starts the readback.',
  Flow: `A restriction from ${f.centre}, such as 10 NM in trail, that departures must meet before you hand them on.`,
  // ---- the 2.0 console ----
  'Attention queue': 'The NEXT button and the rows above the composer: who needs what next, most urgent first, each with its one-tap action. Tab walks it.',
  Halo: 'The ring of controls round the selected aircraft on the radar: a level ladder on one side, speeds on the other, the fixes that make sense, and ILS, HOLD and the handoff keys. One tap sends; a long press stages.',
  Staging: 'Building a clearance without sending it: long-press a chip or a halo rung, or press Q to queue the staged clearance and build the next one for another aircraft.',
  'Readback card': 'The card above the composer after a send: grey while the readback is due, green when it came back right, amber when it was wrong with the correction one tap away.',
  'Command line': 'The typed line: digits pick the aircraft (81 for QTR8125), fix names can be short (>lib), Enter sends, up and down recall earlier clearances.',
  Skin: 'The colour set of the radar display: night (the console default), day (light ground for a tablet in sunlight) or amber (a one-phosphor CRT look). Change it in Settings or under MORE.',
  };
}

/** The Liège glossary (the lessons are written against it). */
export const GLOSSARY: Record<string, string> = glossaryWith(LIEGE);

/** Glossary entries in display order, grouped. */
export const GLOSSARY_GROUPS: { title: string; terms: string[] }[] = [
  { title: 'Units and levels', terms: ['NM', 'kt', 'ft', 'FL', 'QNH', 'Transition altitude', 'Transition level', 'ATIS', 'METAR', 'RVR', 'LVP'] },
  { title: 'Routes and approaches', terms: ['STAR', 'SID', 'Transition', 'IF', 'FAF', 'ILS', 'LOC', 'GS', 'RNP', 'Stable approach gate', 'Go-around', 'Continuous descent'] },
  { title: 'Airspace', terms: ['TMA', 'CTR', 'TSA', 'ED-R', 'MVA', 'Flow'] },
  { title: 'Spacing and wake', terms: ['RECAT-EU', 'Wake minima', 'Sequence', 'Vectors', 'Track miles', 'FTDi', 'AMAN', 'EFC'] },
  { title: 'Safety nets and tools', terms: ['STCA', 'LoS', 'MSAW', 'CLAM', 'Mode S SFL', 'CPA', 'RBL'] },
  { title: 'Working the position', terms: ['Readback', 'Handoff', 'Release', 'Intercom', 'Estimate', 'Strip', 'Safety nets', 'Push to talk', 'Correction', 'Squawk', 'MAYDAY'] },
  { title: 'The console', terms: ['Attention queue', 'Halo', 'Staging', 'Readback card', 'Command line', 'Skin'] },
];
