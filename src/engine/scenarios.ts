import type { Scenario, SpawnSpec } from './types';
import { durationFor, emergencyObjectives, hotStart } from './traffic';

// The challenge library: 22 scripted scenarios in four tiers written for Liège (EBLG), and 12 for Düsseldorf (EDDL) below.
// Times are seconds from the start. Callsigns are realistic in format; flights are fictional.
// Each scenario carries its airport in `icao`; `challengesFor(icao)` gives the menu the right list.

const A = (t: number, cs: string, type: string, star: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t, kind: 'arr', cs, type, star, spawnDist: 40, ...x });
const D = (t: number, cs: string, type: string, sid: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t, kind: 'dep', cs, type, sid, ...x });

const GOOD22 = 'EBLG 120140Z 22008KT 9999 FEW035 12/07 Q1018 NOSIG';
const NIGHT22 = 'EBLG 120140Z 23010KT 9999 SCT030 10/06 Q1015 NOSIG';
const GOOD04 = 'EBLG 121010Z 05012KT 9999 FEW040 14/05 Q1024 NOSIG';

const LIBRARY: Scenario[] = [
  // ---------------- Tier 1: fundamentals ----------------
  {
    id: 'first-freighter', tier: 1, title: 'First freighter', seed: 101, durationMin: 20, startUtc: '02:05', metar: GOOD22, runway: '22L', readbackErr: 0,
    desc: 'One B747-400F on the KOK7X arrival. Vector it onto the ILS 22L, keep it above the MVA, and hand it to Tower in time.',
    objective: 'Land the freighter with no busts and a Tower handoff between 12 and 4 NM.',
    spawns: [A(5, 'CHG201', 'B744', 'KOK7X', { spawnDist: 34 })], events: [], pass: { minLanded: 1, minRatings: { CORD: 4 } },
  },
  {
    id: 'trombone', tier: 1, title: 'Trombone', seed: 102, durationMin: 30, startUtc: '02:20', metar: GOOD22, runway: '22L', readbackErr: 0,
    desc: 'Four freighters in trail on CIV7X, about a minute apart, handed over alternately at FL080 and FL090. Build a sequence with speed control and 3 NM on final, or more where wake demands it.',
    objective: 'Land all four with no wake infringements; final spacing within 1.5 NM of the minimum.',
    spawns: [A(5, 'QTR8125', 'B77L', 'CIV7X'), A(65, 'TAY4EK', 'B763', 'CIV7X', { level: { fl: 90 } }), A(145, 'ETH3721', 'B77L', 'CIV7X'), A(210, 'BCS5AB', 'A306', 'CIV7X', { level: { fl: 90 } })],
    events: [], pass: { minLanded: 4, minRatings: { TRAF: 3, SEPC: 4 } },
  },
  {
    id: 'first-release', tier: 1, title: 'First release', seed: 104, durationMin: 30, startUtc: '02:40', metar: GOOD22, runway: '22L', readbackErr: 0,
    desc: 'One runway, two arrivals and three departures. Departures wait at the holding point until you release them. Release each one into a gap: never with an arrival inside 5 NM, and two minutes behind a heavier departure on the same route.',
    objective: 'Land both arrivals and hand all three departures to Brussels with no loss of separation.',
    briefing: 'Quiet night. 2 inbound, 3 out. Runway 22L. Tower calls when a departure is ready; you decide when it rolls.',
    spawns: [
      A(5, 'TAY4EK', 'B763', 'KOK7X', { spawnDist: 34 }), A(420, 'QTR8125', 'B77L', 'CIV7X'),
      D(60, 'FDX5240', 'MD11', 'LNO9S'), D(200, 'CHG7302', 'B748', 'BUB9S'), D(560, 'ETH3730', 'B77L', 'LNO9S'),
    ],
    events: [], pass: { allArrivalsHandled: true, minDeparturesHandled: 3, minRatings: { SEPC: 4 } },
  },
  {
    id: 'cross-streams', tier: 1, title: 'Cross the streams', seed: 103, durationMin: 30, startUtc: '03:10', metar: GOOD22, runway: '22L', readbackErr: 0.02,
    desc: 'Arrivals descend to ALHUV, right over the 22L threshold, while departures climb out and turn back across them. Keep 1,000 ft or 3 NM everywhere.',
    objective: 'Handle every arrival and departure with no loss of separation.',
    spawns: [
      A(5, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 30 }), A(140, 'AZG7321', 'B748', 'KOK7X'), A(330, 'THY6411', 'A332', 'NIK7X'),
      D(90, 'CHG7302', 'B748', 'LNO9S'), D(260, 'TAY71K', 'B744', 'BUB9S'), D(420, 'QTR8217', 'B77L', 'CIV5S'), D(600, 'FDX5240', 'MD11', 'LNO9S'),
    ],
    events: [], pass: { allArrivalsHandled: true, minRatings: { SEPC: 4 } },
  },
  // ---------------- Tier 2: Liège operations ----------------
  {
    id: 'half-bank', tier: 2, title: 'Half bank', seed: 206, durationMin: 45, startUtc: '01:50', metar: NIGHT22, runway: '22L', readbackErr: 0.02,
    desc: 'Seven freighters in twenty-five minutes from the west, alternating between KOK7X and CIV7X. The two streams meet at ALHUV: decide who goes first well before they get there.',
    objective: 'Land at least six, no loss of separation, under 2 minutes holding per arrival on average.',
    briefing: 'Half bank. 7 inbound, none out. Runway 22L. Two streams from the west merge at ALHUV.',
    spawns: [
      A(5, 'QTR8125', 'B77L', 'KOK7X'), A(200, 'TAY4EK', 'B763', 'CIV7X'), A(420, 'CHG201', 'B748', 'KOK7X'), A(610, 'ETH3721', 'B77L', 'CIV7X'),
      A(840, 'BCS5AB', 'A306', 'KOK7X'), A(1050, 'FDX5203', 'MD11', 'CIV7X'), A(1260, 'CKS231', 'B744', 'KOK7X'),
    ],
    events: [], pass: { minLanded: 6, maxHoldMinPerArrival: 2, minRatings: { SEPC: 4, TRAF: 3 } },
  },
  {
    id: 'night-bank', tier: 2, title: 'Night bank', seed: 201, durationMin: 50, startUtc: '01:30', metar: NIGHT22, runway: '22L', readbackErr: 0.04,
    desc: 'Ten arrivals in twenty minutes: B747-8F, B777F, A330F and A300F mixed, plus two departures. RECAT-EU wake spacing decides the sequence.',
    objective: 'Land at least nine, no wake infringements, holding under 3 minutes per arrival on average.',
    briefing: 'Night bank. 10 inbound, 2 out. Runway 22L. Arrivals from all five STARs; the wave peaks around 01:40Z.',
    spawns: [
      A(5, 'QTR8125', 'B77L', 'KOK7X'), A(140, 'CHG201', 'B748', 'LNO6X', { spawnDist: 30 }), A(290, 'TAY4EK', 'B763', 'CIV7X'), A(410, 'ETH3721', 'B77L', 'GESLO6X'),
      A(540, 'BCS5AB', 'A306', 'NIK7X'), A(660, 'AZG7321', 'B748', 'KOK7X'), A(800, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 32 }), A(930, 'THY6411', 'A332', 'CIV7X'),
      A(1050, 'CKS231', 'B744', 'GESLO6X'), A(1180, 'CLX7HK', 'B748', 'KOK7X'),
      D(400, 'FDX5240', 'MD11', 'LNO9S'), D(1000, 'CHG7302', 'B748', 'BUB9S'),
    ],
    events: [], pass: { minLanded: 9, maxHoldMinPerArrival: 3, minRatings: { SEPC: 3 } },
  },
  {
    id: 'runway-change', tier: 2, title: 'Runway change', seed: 202, durationMin: 45, startUtc: '04:00', metar: 'EBLG 120400Z 24010KT 9999 FEW030 09/05 Q1012 NOSIG', runway: '22L', readbackErr: 0.03,
    desc: 'The wind backs to the north-east. At 04:01 the supervisor gives ten minutes of notice: runway 04R from 04:11. Re-sequence everyone onto the 04 side without a bust.',
    objective: 'Land at least six; no go-arounds for tailwind or unstable approaches.',
    spawns: [
      A(5, 'FDX5203', 'MD11', 'KOK7X'), A(150, 'QTR8125', 'B77L', 'CIV7X'), A(300, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }), A(450, 'CHG201', 'B744', 'NIK7X'),
      A(720, 'AZG7321', 'B748', 'KOK7D'), A(900, 'ETH3721', 'B77L', 'CIV7D'), A(1080, 'BCS5AB', 'A306', 'LNO6D'), A(1260, 'THY6411', 'A332', 'NIK7D'),
    ],
    events: [{ t: 60, kind: 'runway', rwy: '04R', notice: 600 }, { t: 560, kind: 'wind', dir: 40, kt: 12 }],
    pass: { minLanded: 6, minRatings: { TRAF: 3 } },
  },
  {
    id: 'hot-tsa', tier: 2, title: 'Hot TSA', seed: 203, durationMin: 40, startUtc: '10:10', metar: GOOD04, runway: '04R', readbackErr: 0.03,
    desc: 'Runway 04R, arrivals on the D-series STARs through GIREL and RUDIX. At 10:15 TSA29A goes live from 4,500 ft to FL145 over the Ardennes, right across the southern loop.',
    objective: 'Keep every aircraft out of the active TSA and land at least five.',
    spawns: [
      A(5, 'TAY4EK', 'B763', 'GESLO6D'), A(160, 'FDX5203', 'MD11', 'LNO6D'), A(320, 'QTR8125', 'B77L', 'CIV7D'), A(480, 'CHG201', 'B748', 'GESLO6D'),
      A(640, 'ETH3721', 'B77L', 'LNO6D'), A(820, 'BCS5AB', 'A306', 'KOK7D'), D(500, 'THY6420', 'A332', 'LNO2R'),
    ],
    events: [{ t: 300, kind: 'tsa', name: 'TSA29A', on: true }],
    pass: { minLanded: 5, noTsa: true },
  },
  {
    id: 'flow', tier: 2, title: 'Flow restriction', seed: 204, durationMin: 40, startUtc: '22:40', metar: GOOD22, runway: '22L', readbackErr: 0.03,
    desc: 'Brussels ACC imposes 10 NM in trail on all departures via LNO. Space them before transfer while working four arrivals.',
    objective: 'No flow violations, no losses of separation.',
    spawns: [
      D(60, 'FDX5240', 'MD11', 'LNO9S'), D(150, 'CHG7302', 'B748', 'LNO9S'), D(260, 'TAY71K', 'B744', 'LNO9S'), D(560, 'QTR8217', 'B77L', 'LNO9S'),
      D(660, 'ETH3730', 'B77L', 'LNO9S'), D(1000, 'CKS232', 'B744', 'LNO9S'),
      A(5, 'AZG7321', 'B748', 'KOK7X'), A(300, 'THY6411', 'A332', 'CIV7X'), A(700, 'BCS5AB', 'A306', 'NIK7X'), A(1100, 'CLX7HK', 'B748', 'KOK7X'),
    ],
    events: [{ t: 30, kind: 'flow', exitFix: 'LNO', mit: 10, text: 'Brussels ACC: 10 NM in trail on all departures via LNO until further notice' }],
    pass: { minRatings: { CORD: 4, SEPC: 4 } },
  },
  {
    id: 'brussels-fog', tier: 2, title: 'Brussels in fog', seed: 205, durationMin: 50, startUtc: '07:05', metar: 'EBLG 120705Z 20006KT 7000 BKN012 07/05 Q1026 NOSIG', runway: '22L', readbackErr: 0.04,
    desc: 'Fog closes Brussels. Eight passenger jets divert to you with no STAR, no ATIS, and crews who have never seen Liège. Three freighters are still inbound.',
    objective: 'Land at least eight of the eleven arrivals.',
    spawns: [
      A(5, 'BEL3EF', 'A320', 'KOK7X', { unfamiliar: true, spawnDist: 30 }), A(90, 'RYR83KM', 'B738', 'KOK7X', { unfamiliar: true, spawnDist: 34 }),
      A(200, 'TRA6421', 'B738', 'KOK7X', { unfamiliar: true, spawnDist: 32, level: { fl: 90 } }), A(300, 'BEL5RK', 'A321', 'KOK7X', { unfamiliar: true, spawnDist: 36 }),
      A(420, 'JAF4NT', 'B738', 'KOK7X', { unfamiliar: true, spawnDist: 30, level: { fl: 90 } }), A(560, 'RYR4VB', 'B738', 'KOK7X', { unfamiliar: true, spawnDist: 34 }),
      A(700, 'BEL7AF', 'A320', 'KOK7X', { unfamiliar: true, spawnDist: 32, level: { fl: 90 } }), A(860, 'TRA6533', 'B738', 'KOK7X', { unfamiliar: true, spawnDist: 30 }),
      A(120, 'QTR8125', 'B77L', 'LNO6X', { spawnDist: 30 }), A(480, 'TAY4EK', 'B763', 'CIV7X'), A(780, 'FDX5203', 'MD11', 'GESLO6X'),
    ],
    events: [{ t: 2, kind: 'note', text: 'Brussels (EBBR) closed: fog below CAT III minima. Diversions inbound from the north-west.' }],
    pass: { minLanded: 8 },
  },
  // ---------------- Tier 3: abnormal ----------------
  {
    id: 'lvp', tier: 3, title: 'Low visibility', seed: 301, durationMin: 50, startUtc: '05:20', metar: 'EBLG 120520Z 21004KT 0300 R22L/0350 FG VV001 08/08 Q1022 NOSIG', runway: '22L', readbackErr: 0.03,
    desc: 'RVR 350 m, low visibility procedures in force. Only the CAT III ILS on 22L works, and the ILS sensitive area stays protected until the previous aircraft has vacated. Spacing grows and the hold fills.',
    objective: 'No go-arounds for an occupied runway, at least six landings.',
    spawns: [
      A(5, 'CHG201', 'B748', 'KOK7X'), A(120, 'QTR8125', 'B77L', 'LNO6X', { spawnDist: 30 }), A(240, 'TAY4EK', 'B763', 'CIV7X'), A(360, 'ETH3721', 'B77L', 'NIK7X'),
      A(480, 'FDX5203', 'MD11', 'GESLO6X'), A(600, 'BCS5AB', 'A306', 'KOK7X'), A(720, 'AZG7321', 'B748', 'CIV7X'), A(840, 'CKS231', 'B744', 'LNO6X', { spawnDist: 30 }),
    ],
    events: [], pass: { minLanded: 6, minRatings: { SEPC: 4 } },
  },
  {
    id: 'ils-out', tier: 3, title: 'ILS 22L out', seed: 302, durationMin: 45, startUtc: '12:30', metar: 'EBLG 121230Z 22010KT 9999 BKN015 13/09 Q1011 NOSIG', runway: '22L', readbackErr: 0.03,
    desc: 'At 12:37 the 22L localizer fails. Switch to the RNP 22L approach, and re-vector anyone already established.',
    objective: 'Land at least five after the failure; no MVA busts while re-vectoring.',
    spawns: [
      A(5, 'FDX5203', 'MD11', 'KOK7X', { spawnDist: 30 }), A(140, 'QTR8125', 'B77L', 'CIV7X'), A(280, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }),
      A(420, 'CHG201', 'B744', 'NIK7X'), A(560, 'ETH3721', 'B77L', 'KOK7X'), A(700, 'BCS5AB', 'A306', 'GESLO6X'), A(840, 'THY6411', 'A332', 'CIV7X'),
    ],
    events: [{ t: 420, kind: 'ils', rwy: '22L', ok: false }],
    pass: { minLanded: 5, minRatings: { SEPC: 4 } },
  },
  {
    id: 'go-around', tier: 3, title: 'Go-around into departures', seed: 303, durationMin: 35, startUtc: '23:15', metar: GOOD22, runway: '22L', readbackErr: 0.03,
    desc: 'Tower sends an arrival around at 1 NM. It climbs to 3,000 ft toward ALHUV while a SID turns overhead and the next arrival is behind it.',
    objective: 'No loss of separation after the go-around; the aircraft lands on its second approach.',
    spawns: [
      A(5, 'AZG7321', 'B748', 'KOK7X', { spawnDist: 30, goAroundAt: 1 }), A(150, 'THY6411', 'A332', 'CIV7X'), A(320, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }),
      D(360, 'FDX5240', 'MD11', 'LNO9S'), D(480, 'CHG7302', 'B748', 'BUB9S'), A(520, 'QTR8125', 'B77L', 'NIK7X'),
    ],
    events: [], pass: { minLanded: 4, minRatings: { SEPC: 4 } },
  },
  {
    id: 'storms', tier: 3, title: 'Summer storms', seed: 304, durationMin: 45, startUtc: '16:40', metar: 'EBLG 121640Z 20012G22KT 8000 TSRA SCT030CB BKN060 24/18 Q1009 TEMPO TSRA', runway: '22L', readbackErr: 0.04,
    desc: 'Cells drift north-east across the western and southern arrivals. Pilots will ask to deviate. Keep the sequence intact while they do.',
    objective: 'Nobody flies into a cell; at least six landings.',
    spawns: [
      A(5, 'QTR8125', 'B77L', 'CIV7X'), A(150, 'CHG201', 'B748', 'KOK7X'), A(300, 'TAY4EK', 'B763', 'NIK7X'), A(450, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 30 }),
      A(600, 'ETH3721', 'B77L', 'CIV7X'), A(750, 'BCS5AB', 'A306', 'GESLO6X'), A(900, 'AZG7321', 'B748', 'KOK7X'),
    ],
    storms: [{ p: { x: -16, y: -6 }, r: 4, vx: 7, vy: 6 }, { p: { x: -28, y: 2 }, r: 3.5, vx: 8, vy: 5 }, { p: { x: -4, y: -18 }, r: 4.5, vx: 5, vy: 8 }],
    events: [], pass: { minLanded: 6, minRatings: { SEPC: 4 } },
  },
  {
    id: 'similar-callsigns', tier: 3, title: 'Similar callsigns', seed: 305, durationMin: 40, startUtc: '00:50', metar: NIGHT22, runway: '22L', readbackErr: 0.08, confusion: true,
    desc: 'CHG201 and CHG210, QTR8125 and QTR8152, THY6411 and THY6414, all on frequency together. Wrong readbacks and a pilot taking someone else\'s clearance are likely.',
    objective: 'Catch every wrong readback within 30 seconds.',
    spawns: [
      A(5, 'CHG201', 'B748', 'KOK7X'), A(60, 'CHG210', 'B744', 'CIV7X'), A(220, 'QTR8125', 'B77L', 'NIK7X'), A(280, 'QTR8152', 'B77L', 'LNO6X', { spawnDist: 30 }),
      A(460, 'THY6411', 'A332', 'GESLO6X'), A(520, 'THY6414', 'A332', 'KOK7X'),
    ],
    events: [], pass: { noMissedReadbacks: true, minLanded: 5 },
  },
  {
    id: 'fighters', tier: 3, title: 'Fighters through the stack', seed: 306, durationMin: 40, startUtc: '14:05', metar: 'EBLG 121405Z 22012KT 9999 SCT040 16/08 Q1016 NOSIG', runway: '22L', readbackErr: 0.03,
    desc: 'A pair of F-35s crosses the TMA eastbound at FL070 and wants FL150, right through your arrivals descending to ALHUV. Then a NATO E-3A climbs out of Geilenkirchen into the north-east corner.',
    objective: 'No loss of separation with military traffic; answer every request within 30 seconds.',
    spawns: [
      A(5, 'QTR8125', 'B77L', 'KOK7X'), A(150, 'TAY4EK', 'B763', 'CIV7X'), A(300, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 30 }), A(450, 'CHG201', 'B748', 'NIK7X'), A(650, 'ETH3721', 'B77L', 'KOK7X'),
      { t: 240, kind: 'mil', cs: 'BAF61', type: 'F35', formation: 2, route: ['GILOM', 'ALHUV', 'VERVIERS'], from: { brg: 282, dist: 18 }, level: { fl: 70 }, spd: 300, request: { kind: 'climb', level: { fl: 150 } } },
      { t: 600, kind: 'mil', cs: 'NATO03', type: 'E3TF', route: ['G_ETNG', 'ECHO', 'LNO', 'GIREL'], from: { brg: 30, dist: 3 }, level: { ft: 4000 }, request: { kind: 'climb', level: { fl: 150 } } },
      { t: 820, kind: 'vfr', cs: 'OOKLM', type: 'C172', route: ['ROMEO', 'FOXHE'], from: { brg: 300, dist: 7 }, level: { ft: 1500 }, request: { kind: 'crossing', route: ['ROMEO', 'FOXHE'] } },
    ],
    events: [], pass: { minRatings: { SEPC: 4, WORK: 3 } },
  },
  {
    id: 'night-bank-full', tier: 3, title: 'Night bank (full)', seed: 307, durationMin: 50, startUtc: '01:30', metar: NIGHT22, runway: '22L', readbackErr: 0.04,
    desc: 'Fourteen arrivals in forty minutes: B747-8F, B777F, A330F and A300F mixed, plus outbound departures. RECAT-EU wake spacing decides the sequence.',
    briefing: 'Full night bank. 14 inbound, 3 out. Runway 22L. Wave peaks around 01:45Z; departures push from 01:52Z.',
    objective: 'Land at least twelve, no wake infringements, holding under 3 minutes per arrival on average.',
    spawns: [
      A(5, 'QTR8125', 'B77L', 'KOK7X'), A(140, 'CHG201', 'B748', 'LNO6X', { spawnDist: 30 }), A(290, 'TAY4EK', 'B763', 'CIV7X'), A(410, 'ETH3721', 'B77L', 'GESLO6X'),
      A(540, 'BCS5AB', 'A306', 'NIK7X'), A(660, 'AZG7321', 'B748', 'KOK7X'), A(800, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 32 }), A(930, 'THY6411', 'A332', 'CIV7X'),
      A(1050, 'CKS231', 'B744', 'GESLO6X'), A(1180, 'CLX7HK', 'B748', 'KOK7X'), A(1320, 'DHK7', 'B763', 'NIK7X'), A(1440, 'QTR8152', 'B77L', 'LNO6X', { spawnDist: 30 }),
      A(1590, 'MSR555', 'A332', 'CIV7X'), A(1720, 'TAY71K', 'B744', 'KOK7X'),
      D(400, 'FDX5240', 'MD11', 'LNO9S'), D(1300, 'CHG7302', 'B748', 'BUB9S'), D(2000, 'ETH3730', 'B77L', 'CIV5S'),
    ],
    events: [], pass: { minLanded: 12, maxHoldMinPerArrival: 3, minRatings: { SEPC: 3 } },
  },
  {
    id: 'runway-change-night', tier: 3, title: 'Runway change at night', seed: 308, durationMin: 50, startUtc: '01:55', metar: 'EBLG 120155Z 19006KT 9999 SCT035 08/04 Q1011 NOSIG', runway: '22L', readbackErr: 0.03,
    desc: 'Night bank on 22L while the wind swings round to the north-east. Once the tailwind passes 5 kt the supervisor gives ten minutes of notice and the runway changes to 04R. Aircraft established on the 22L localizer land there; re-clear everyone else via the D arrivals, and keep the first 04R departures clear of the last 22L arrivals.',
    objective: 'Land at least seven, with no loss of separation through the change.',
    briefing: 'Night bank. 9 inbound, 3 out. Runway 22L, wind 190/06 and backing. Expect a change to 04R in the bank: Brussels sends new arrivals via the D arrivals once it is made.',
    spawns: [
      A(5, 'QTR8125', 'B77L', 'KOK7X'), A(130, 'CHG201', 'B748', 'CIV7X'), A(260, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }), A(400, 'ETH3721', 'B77L', 'NIK7X'),
      A(540, 'FDX5203', 'MD11', 'GESLO6X'), A(700, 'AZG7321', 'B748', 'KOK7X'), A(860, 'BCS5AB', 'A306', 'CIV7X'), A(1050, 'CKS231', 'B744', 'NIK7X'), A(1250, 'THY6411', 'A332', 'KOK7X'),
      D(350, 'FDX5240', 'MD11', 'LNO9S'), D(820, 'CHG7302', 'B748', 'BUB9S'), D(1150, 'TAY71K', 'B744', 'CIV5S'),
    ],
    events: [{ t: 300, kind: 'wind', dir: 30, kt: 12 }],
    pass: { minLanded: 7, minRatings: { SEPC: 4, CORD: 3 } },
  },
  // ---------------- Tier 4: emergency ----------------
  {
    id: 'engine-failure', tier: 4, title: 'Engine failure on departure', seed: 401, durationMin: 35, startUtc: '03:40', metar: NIGHT22, runway: '22L', readbackErr: 0.02,
    desc: 'A heavy B747-8F loses an engine passing 3,000 ft and wants to come straight back. Four arrivals are already in the sequence.',
    objective: 'Clear a path, give the emergency its first instruction within 20 seconds, and have it on the ground within 15 minutes.',
    spawns: [
      D(30, 'CHG7302', 'B748', 'LNO9S', { emergency: { after: 70, type: 'engine' } }),
      A(5, 'QTR8125', 'B77L', 'CIV7X', { spawnDist: 34 }), A(130, 'TAY4EK', 'B763', 'KOK7X'), A(260, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 30 }), A(400, 'ETH3721', 'B77L', 'NIK7X'),
    ],
    events: [], pass: { emergencyLandedWithinMin: 15, minRatings: { NONR: 3 } },
  },
  {
    id: 'smoke', tier: 4, title: 'Smoke in the hold', seed: 402, durationMin: 35, startUtc: '02:50', metar: NIGHT22, runway: '22L', readbackErr: 0.02,
    desc: 'A B777F at FL080 reports smoke in the cargo hold and wants the nearest runway now. It will descend fast and accept a tailwind.',
    objective: 'Emergency on the ground within 12 minutes, no loss of separation along the way.',
    spawns: [
      A(5, 'TAY4EK', 'B763', 'CIV7X', { spawnDist: 30 }), A(90, 'ETH3721', 'B77L', 'KOK7X', { emergency: { after: 70, type: 'smoke' } }),
      A(200, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 30 }), A(330, 'QTR8125', 'B77L', 'NIK7X'), A(460, 'CHG201', 'B748', 'GESLO6X'),
    ],
    events: [], pass: { emergencyLandedWithinMin: 12, minRatings: { NONR: 3, SEPC: 4 } },
  },
  {
    id: 'radio-failure', tier: 4, title: 'Radio failure', seed: 403, durationMin: 40, startUtc: '01:10', metar: NIGHT22, runway: '22L', readbackErr: 0.02,
    desc: 'An A330F squawks 7600. It will fly its last clearance, then rejoin ALHUV and fly the transition and ILS on its own. Predict its path and keep everyone else out of it.',
    objective: 'No loss of separation with the radio-failure aircraft; it lands.',
    spawns: [
      A(5, 'THY6411', 'A332', 'KOK7X', { emergency: { after: 150, type: 'radio' } }), A(110, 'QTR8125', 'B77L', 'CIV7X'), A(240, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }),
      A(380, 'CHG201', 'B748', 'NIK7X'), A(520, 'FDX5203', 'MD11', 'GESLO6X'), D(300, 'AZG7330', 'B748', 'BUB9S'),
    ],
    events: [], pass: { emergencyLandedWithinMin: 30, minRatings: { SEPC: 4 } },
  },
  {
    id: 'compound-night', tier: 4, title: 'Compound night', seed: 404, durationMin: 55, startUtc: '01:20', metar: NIGHT22, runway: '22L', readbackErr: 0.05, confusion: true,
    desc: 'A full night bank. Fog rolls in at 01:35 and LVP starts. Brussels slaps a flow on LNO departures. Then a freighter reports smoke.',
    objective: 'Pass the safety gate and land at least eight.',
    spawns: [
      A(5, 'QTR8125', 'B77L', 'KOK7X'), A(120, 'CHG201', 'B748', 'LNO6X', { spawnDist: 30 }), A(250, 'TAY4EK', 'B763', 'CIV7X'), A(380, 'ETH3721', 'B77L', 'GESLO6X'),
      A(510, 'BCS5AB', 'A306', 'NIK7X'), A(640, 'AZG7321', 'B748', 'KOK7X', { emergency: { after: 300, type: 'smoke' } }), A(780, 'FDX5203', 'MD11', 'LNO6X', { spawnDist: 30 }),
      A(910, 'THY6411', 'A332', 'CIV7X'), A(1040, 'CKS231', 'B744', 'GESLO6X'), A(1180, 'CLX7HK', 'B748', 'KOK7X'), A(1320, 'QTR8152', 'B77L', 'NIK7X'), A(1460, 'CHG210', 'B744', 'CIV7X'),
      D(200, 'FDX5240', 'MD11', 'LNO9S'), D(700, 'TAY71K', 'B744', 'LNO9S'), D(1100, 'ETH3730', 'B77L', 'LNO9S'),
    ],
    events: [{ t: 600, kind: 'flow', exitFix: 'LNO', mit: 10, text: 'Brussels ACC: 10 NM in trail on departures via LNO' }, { t: 900, kind: 'lvp', on: true, rvr: 400, vis: 450, ceiling: 100 }],
    pass: { minLanded: 8, emergencyLandedWithinMin: 15 },
  },
];

// ---------------------------------------------------------------------------
// Düsseldorf (EDDL): twelve challenges in four tiers for the Langen Radar pickup position. Arrivals take about
// 22 minutes from the handover at the sector edge round the RNAV transition to touchdown, so the spawns run
// 2 to 3 minutes apart for a rush. Flights are fictional; callsigns follow the operators based at or serving DUS.
const AD = (t: number, cs: string, type: string, star: string, x: Partial<SpawnSpec> = {}): SpawnSpec => ({ t, kind: 'arr', cs, type, star, spawnDist: 38, ...x });
const GOOD23 = 'EDDL 120550Z 23008KT 9999 FEW035 12/07 Q1018 NOSIG';
const SUMMER23 = 'EDDL 120850Z 25010KT 9999 SCT040 24/14 Q1016 NOSIG';
const NIGHT23 = 'EDDL 120030Z 24005KT 9999 SCT040 09/06 Q1015 NOSIG';

const DUS_LIBRARY: Scenario[] = [
  // ---------------- Tier 1: fundamentals at Düsseldorf ----------------
  {
    id: 'dus-super', tier: 1, title: 'Super behind a medium', seed: 601, durationMin: 40, startUtc: '12:10', metar: GOOD23, runway: '23L', readbackErr: 0.02, icao: 'EDDL',
    desc: 'An Emirates A380 arrives via DOMUX two minutes behind a Eurowings A320 and two minutes ahead of a Condor A321 via BIKMU. The super needs 3 NM behind the medium; the A321 behind the super needs 7 NM (ICAO wake categories, which Düsseldorf uses). Set the gaps on the two downwinds before they merge on final 23L.',
    objective: 'Land all three with no wake infringement and no loss of separation.',
    briefing: 'Midday, runway 23L. 3 inbound, 1 out. The A380 lands in the middle: build the gap for the Condor behind it on the downwind, not on final.',
    spawns: [AD(5, 'EWG2EK', 'A320', 'BIKMU1A', { spawnDist: 32 }), AD(130, 'UAE55', 'A388', 'DOMUX1A'), AD(250, 'CFG1414', 'A321', 'BIKMU1A'), D(700, 'DLH7PK', 'A20N', 'MEVEL4T')],
    events: [], pass: { minLanded: 3, minRatings: { SEPC: 4 } },
  },
  {
    id: 'dus-quiet-night', tier: 1, title: 'Late evening, medical diversion', seed: 602, durationMin: 35, startUtc: '22:20', metar: NIGHT23, runway: '23L', readbackErr: 0, icao: 'EDDL',
    desc: 'After 23:00 local the field is shut to scheduled landings: delayed ones until 23:30, aircraft of the home-based carriers until midnight. At 23:20 two late Eurowings are still coming home, and a Köln/Bonn diversion with a sick passenger needs the ground inside 15 minutes. No departures: take-offs stopped at 22:00.',
    objective: 'Land both Eurowings before midnight local and the diversion within 15 minutes.',
    briefing: 'Night flight restriction: no take-offs after 22:00 local, no scheduled landings after 23:00 (delayed ones until 23:30, home-based Eurowings until midnight). 3 inbound, one a medical diversion from Köln/Bonn, none out. Runway 23L. Tower is on a reduced crew: keep the calls short.',
    spawns: [AD(5, 'EWG1795', 'A321', 'BIKMU1A', { spawnDist: 30 }), AD(200, 'EWG9KP', 'A320', 'DOMUX1A', { spawnDist: 32 }), AD(420, 'AUA1LW', 'A320', 'DOMUX1A', { unfamiliar: true, spawnDist: 30 })],
    events: [{ t: 400, kind: 'note', text: 'Langen Radar, Köln sector: AUA1LW diverting from Köln/Bonn with a medical emergency on board, requests priority landing' }],
    objectives: [{ cs: 'EWG9KP', text: 'Land EWG9KP before 00:00 local', byT: 40 * 60 }, { cs: 'AUA1LW', text: 'Land AUA1LW within 15:00', byT: 420 + 15 * 60 }],
    pass: { minLanded: 3, minRatings: { SEPC: 4 } },
  },
  {
    id: 'dus-koeln', tier: 1, title: 'The Köln/Bonn interface', seed: 603, durationMin: 45, startUtc: '09:05', metar: GOOD23, runway: '23L', readbackErr: 0.02, icao: 'EDDL',
    desc: 'Köln/Bonn is busy, and its agreement is in force: every departure off 23 to the south (COL, KUMIK, DODEN, NUDGO, NVO, GMH) needs your release, because it climbs out across the BIKMU arrivals into the Köln sector. Köln also asks for 10 NM in trail via COL, hands over the arrivals from Nörvenich into BIKMU, and sends you a diversion from its own field.',
    objective: 'No flow violations on the COL departures, every release answered, every arrival landed, no loss of separation.',
    briefing: 'Mid-morning, runway 23L. The Köln agreement is in force: Tower asks your release for the southern departures. 5 inbound (one Köln/Bonn diversion), 4 out, three of them via COL. Köln wants 10 NM in trail on those.',
    spawns: [
      AD(5, 'EWG7LX', 'A319', 'BIKMU1A', { spawnDist: 32 }), AD(200, 'THY1899', 'A333', 'BIKMU1A'), AD(380, 'KLC1853', 'E190', 'PISAP1A'), AD(560, 'EWG1EH', 'A320', 'DOMUX1A'),
      AD(700, 'AFR1506', 'A320', 'BIKMU1A', { unfamiliar: true, spawnDist: 30 }),
      D(90, 'EWG3DT', 'A320', 'COL6T'), D(230, 'SXS2EP', 'B738', 'COL6T'), D(420, 'DLH4YC', 'A21N', 'MEVEL4T'), D(640, 'CFG2217', 'B753', 'COL6T'),
    ],
    events: [{ t: 30, kind: 'flow', exitFix: 'COL', mit: 10, text: 'Langen Radar, Köln sector: 10 NM in trail on all departures via COL until further notice' }, { t: 680, kind: 'note', text: 'Langen Radar, Köln sector: AFR1506 diverting from Köln/Bonn, a passenger taken ill, requests priority' }],
    neighbourBusy: true,
    pass: { allArrivalsHandled: true, minRatings: { CORD: 4, SEPC: 4 } },
  },
  // ---------------- Tier 2: Düsseldorf operations ----------------
  {
    id: 'dus-morning-rush', tier: 2, title: 'Morning rush', seed: 604, durationMin: 55, startUtc: '04:50', metar: GOOD23, runway: '23L', readbackErr: 0.03, icao: 'EDDL',
    desc: 'The field opens at 06:00 local: no take-off before it. The based fleet leaves first, a departure every two minutes from the opening minute, and the first arrivals of the day come in behind them. Single-runway operation: Tower launches each departure into a gap on final 23L, so keep the arrivals spaced to leave it one.',
    objective: 'Land at least eight, hand on at least five departures, holding under 3 minutes per arrival on average.',
    briefing: 'Opening wave, single runway 23L, departures first. 9 inbound, 7 out from 06:00 local. Arrivals from BIKMU and PISAP share the north downwind; DOMUX comes in on the south downwind.',
    spawns: [
      AD(240, 'EWG1KL', 'A320', 'BIKMU1A', { spawnDist: 30 }), AD(380, 'CFG1012', 'A333', 'PISAP1A'), AD(520, 'DLH2WT', 'A21N', 'DOMUX1A'), AD(660, 'TUI3EA', 'B738', 'BIKMU1A'),
      AD(800, 'EWG5DH', 'A319', 'HALME1A'), AD(940, 'RYR8SJ', 'B738', 'PISAP1A'), AD(1080, 'PGT1083', 'A321', 'DOMUX1A'), AD(1220, 'EJU31MF', 'A320', 'BIKMU1A'), AD(1360, 'AUA183', 'A320', 'PISAP1A'),
      D(610, 'EWG8766', 'A320', 'MODRU2T'), D(730, 'CFG3192', 'B753', 'SONEB8T'), D(850, 'DLH1VL', 'A20N', 'KUMIK7T'), D(970, 'EWG2TP', 'A21N', 'NETEX6T'), D(1090, 'TUI5110', 'B38M', 'COL6T'), D(1210, 'SXS6KA', 'B738', 'DODEN1T'), D(1330, 'EWG9MJ', 'A319', 'MEVEL4T'),
    ],
    events: [], pass: { minLanded: 8, minDeparturesHandled: 5, maxHoldMinPerArrival: 3, minRatings: { SEPC: 3 } },
  },
  {
    id: 'dus-holiday-wave', tier: 2, title: 'Holiday wave', seed: 605, durationMin: 55, startUtc: '08:50', metar: SUMMER23, runway: '23L', readbackErr: 0.03, icao: 'EDDL',
    desc: 'A summer Saturday. Condor, TUI, SunExpress and Pegasus bring ten holiday jets home from the south and east in half an hour, B757-300 and A330-300 among the narrow-bodies, while the next rotation pushes out. One runway for everything.',
    objective: 'Land at least nine, no wake infringements, holding under 3 minutes per arrival on average.',
    briefing: 'Summer Saturday, runway 23L. 10 inbound, 6 out. Mixed fleet: watch the wake behind the A330 and the B757.',
    spawns: [
      AD(5, 'CFG2104', 'B753', 'BIKMU1A', { spawnDist: 30 }), AD(140, 'SXS1DL', 'B738', 'DOMUX1A'), AD(280, 'TUI4KD', 'B738', 'PISAP1A'), AD(420, 'CFG1708', 'A333', 'BIKMU1A'),
      AD(560, 'PGT1021', 'A321', 'DOMUX1A'), AD(700, 'THY1517', 'A321', 'HALME1A'), AD(840, 'CAI2318', 'B738', 'BIKMU1A'), AD(980, 'AEE816', 'A320', 'PISAP1A'),
      AD(1120, 'CFG2310', 'A339', 'DOMUX1A'), AD(1260, 'EWG6RU', 'A320', 'BIKMU1A'),
      D(400, 'CFG2103', 'B753', 'SONEB8T'), D(640, 'TUI4KC', 'B738', 'DODEN1T'), D(880, 'SXS1DK', 'B738', 'KUMIK7T'), D(1120, 'EWG4LF', 'A320', 'MODRU2T'), D(1360, 'PGT1022', 'A321', 'GMH1T'), D(1600, 'CFG1709', 'A333', 'COL6T'),
    ],
    events: [], pass: { minLanded: 9, maxHoldMinPerArrival: 3, minRatings: { SEPC: 3 } },
  },
  {
    id: 'dus-runway-change', tier: 2, title: 'Runway change on both downwinds', seed: 606, durationMin: 55, startUtc: '06:30', metar: 'EDDL 120630Z 24006KT 9999 FEW030 08/05 Q1024 NOSIG', runway: '23L', readbackErr: 0.03, icao: 'EDDL',
    desc: 'The wind backs to the east. At 06:31 the supervisor gives ten minutes of notice: runway 05R from 06:41. Traffic is on both 23 downwinds, north-east and south-east. Those established on 23L land; everyone else turns round for the 05 transitions, which run the other way along the same downwinds.',
    objective: 'Land at least six; no go-arounds for tailwind or an unstable approach, no loss of separation through the change.',
    briefing: 'Runway 23L, wind 240/06 and backing. Expect a change to 05R inside the first ten minutes. 8 inbound on both downwinds, 3 out.',
    spawns: [
      AD(5, 'EWG2HJ', 'A320', 'BIKMU1A', { spawnDist: 28 }), AD(130, 'DLH9DW', 'A320', 'DOMUX1A', { spawnDist: 30 }), AD(270, 'TUI6NC', 'B738', 'PISAP1A'), AD(420, 'CFG1890', 'A321', 'DOMUX1A'),
      AD(600, 'EJU49KR', 'A320', 'BIKMU1A'), AD(780, 'KLM1857', 'B738', 'HALME1A'), AD(960, 'EWG7PZ', 'A21N', 'DOMUX1A'), AD(1140, 'BAW937', 'A320', 'PISAP1A'),
      D(500, 'EWG3NB', 'A320', 'KUMIK7T'), D(900, 'CFG1891', 'A321', 'SONEB8T'), D(1300, 'DLH8ML', 'A319', 'MODRU2T'),
    ],
    events: [{ t: 60, kind: 'runway', rwy: '05R', notice: 600 }, { t: 560, kind: 'wind', dir: 70, kt: 12 }],
    pass: { minLanded: 6, minRatings: { TRAF: 3, SEPC: 4 } },
  },
  {
    id: 'dus-parallel', tier: 2, title: 'Northern runway open, go-around', seed: 607, durationMin: 50, startUtc: '15:05', metar: GOOD23, runway: '23R', readbackErr: 0.03, icao: 'EDDL',
    desc: 'Both runways are open: arrivals land 23R, departures roll from 23L next to them. Tower sends one arrival around at 1 NM; its missed approach turns right over the field to the DUS holding at 4,000 ft, right where the departures climb out, and for five minutes Tower asks your release for every departure. All arrivals use 23R: 3 NM between them on the final (2.5 NM is only for alternating approaches to the two runways, and never behind a heavier aircraft).',
    objective: 'Land at least six, the go-around on its second approach, with no loss of separation.',
    briefing: 'Afternoon, segregated parallel operations: arrivals 23R, departures 23L. 7 inbound, 5 out. The missed approach goes to DUS at 4,000 ft, through the departure climb.',
    spawns: [
      AD(5, 'EWG8ZA', 'A320', 'BIKMU1A', { spawnDist: 30 }), AD(170, 'CFG1552', 'B753', 'PISAP1A', { goAroundAt: 1 }), AD(340, 'DLH3UF', 'A20N', 'DOMUX1A'), AD(510, 'SWR924', 'E190', 'BIKMU1A'),
      AD(680, 'THY1595', 'B738', 'DOMUX1A'), AD(850, 'EWG4EP', 'A319', 'HALME1A'), AD(1020, 'RYR2BC', 'B738', 'BIKMU1A'),
      D(300, 'EWG6YE', 'A321', 'MODRU2T'), D(560, 'DLH2PH', 'A320', 'MEVEL4T'), D(820, 'TUI2LE', 'B738', 'COL6T'), D(1080, 'EWG1QA', 'A320', 'NETEX6T'), D(1340, 'CFG2219', 'A333', 'DODEN1T'),
    ],
    events: [], pass: { minLanded: 6, minRatings: { SEPC: 4 } },
  },
  // ---------------- Tier 3: abnormal ----------------
  {
    id: 'dus-fog', tier: 3, title: 'Fog morning', seed: 608, durationMin: 55, startUtc: '05:50', metar: 'EDDL 120550Z 21003KT 0300 R23L/0350 FG VV001 04/04 Q1024 NOSIG', runway: '23L', readbackErr: 0.03, icao: 'EDDL',
    desc: 'RVR 350 m at the opening: low visibility procedures. Runway 23L is CAT III, and the localizer sensitive area stays protected until the previous aircraft has vacated, so Tower needs the runway two minutes per landing and asks your release for every departure. Seven arrivals in the first wave, two departures.',
    objective: 'No go-arounds for an occupied runway, at least five landings.',
    briefing: 'Fog, LVP in force, CAT III on 23L only. 7 inbound, 2 out. Build the spacing early: the runway is blocked for two minutes after every landing.',
    spawns: [
      AD(5, 'EWG2KY', 'A320', 'BIKMU1A', { spawnDist: 30 }), AD(180, 'CFG1020', 'A333', 'PISAP1A'), AD(360, 'DLH4CE', 'A321', 'DOMUX1A'), AD(540, 'TUI2WB', 'B738', 'BIKMU1A'),
      AD(720, 'EJU62PJ', 'A320', 'HALME1A'), AD(900, 'AUA161', 'E190', 'DOMUX1A'), AD(1080, 'EWG9HX', 'A319', 'PISAP1A'),
      D(700, 'EWG3HF', 'A320', 'MODRU2T'), D(1200, 'DLH9KF', 'A20N', 'SONEB8T'),
    ],
    events: [], pass: { minLanded: 5, minRatings: { SEPC: 4 } },
  },
  {
    id: 'dus-storms', tier: 3, title: 'Thunderstorm line over the Rhine', seed: 609, durationMin: 50, startUtc: '16:40', metar: 'EDDL 121640Z 22012G24KT 8000 TSRA SCT030CB BKN060 26/19 Q1008 TEMPO TSRA', runway: '23L', readbackErr: 0.04, icao: 'EDDL',
    desc: 'A line of cells sits along the Rhine, south to north through the field, and drifts east across both downwinds and the final. Crews will ask to deviate; the finals get cut. Keep the sequence alive while they do.',
    objective: 'Nobody flies into a cell; at least five landings.',
    briefing: 'Late afternoon, runway 23L. 7 inbound, 3 out. Thunderstorms along the Rhine moving east at about 10 kt: expect deviation requests on both downwinds.',
    spawns: [
      AD(5, 'EWG6WN', 'A320', 'BIKMU1A', { spawnDist: 30 }), AD(150, 'DLH6XR', 'A321', 'DOMUX1A'), AD(300, 'CFG2152', 'B753', 'PISAP1A'), AD(450, 'TUI8DG', 'B38M', 'BIKMU1A'),
      AD(600, 'SXS8VR', 'B738', 'DOMUX1A'), AD(760, 'EWG1MD', 'A21N', 'HALME1A'), AD(920, 'WZZ2816', 'A321', 'PISAP1A'),
      D(420, 'EWG5SR', 'A320', 'KUMIK7T'), D(780, 'CFG2153', 'B753', 'MODRU2T'), D(1140, 'DLH2DK', 'A319', 'MEVEL4T'),
    ],
    storms: [{ p: { x: -12, y: -16 }, r: 4, vx: 9, vy: 2 }, { p: { x: -11, y: -2 }, r: 4.5, vx: 10, vy: 1 }, { p: { x: -9, y: 12 }, r: 4, vx: 9, vy: 3 }],
    events: [], pass: { minLanded: 5, minRatings: { SEPC: 4 } },
  },
  {
    id: 'dus-north-closure', tier: 3, title: 'Northern runway closes mid-shift', seed: 610, durationMin: 55, startUtc: '07:10', metar: GOOD23, runway: '23R', readbackErr: 0.03, icao: 'EDDL',
    desc: 'Parallel operations until 07:30: arrivals on 23R, departures on 23L. Then the northern runway closes for the day and everything goes back onto 23L, arrivals and departures together. Approaches already cleared for 23R continue; everyone else needs a gap on 23L.',
    objective: 'Land at least seven, hand on at least five departures, no loss of separation through the closure.',
    briefing: 'Morning, arrivals 23R and departures 23L until the northern runway closes at 07:30. 9 inbound, 7 out. After the closure every departure needs its own gap on final.',
    spawns: [
      AD(5, 'EWG1TB', 'A320', 'BIKMU1A', { spawnDist: 30 }), AD(150, 'CFG1218', 'A333', 'DOMUX1A'), AD(300, 'DLH5FP', 'A20N', 'PISAP1A'), AD(450, 'TUI3GE', 'B738', 'BIKMU1A'),
      AD(600, 'RYR7KT', 'B738', 'HALME1A'), AD(760, 'EWG3VU', 'A319', 'DOMUX1A'), AD(920, 'ETD17', 'B789', 'BIKMU1A'), AD(1080, 'EJU81CV', 'A320', 'PISAP1A'), AD(1240, 'EWG2GN', 'A21N', 'DOMUX1A'),
      D(200, 'EWG4AX', 'A320', 'MODRU2T'), D(440, 'DLH1EB', 'A321', 'SONEB8T'), D(680, 'CFG1217', 'A333', 'DODEN1T'), D(920, 'TUI3GF', 'B738', 'COL6T'), D(1160, 'EWG6HM', 'A319', 'MEVEL4T'), D(1400, 'SXS3RL', 'B738', 'KUMIK7T'), D(1640, 'EWG8CD', 'A320', 'NETEX6T'),
    ],
    events: [{ t: 600, kind: 'parallel', on: false, notice: 600 }],
    pass: { minLanded: 7, minDeparturesHandled: 5, minRatings: { SEPC: 4 } },
  },
  // ---------------- Tier 4: emergency and the full hour ----------------
  {
    id: 'dus-emergency-return', tier: 4, title: 'Emergency return', seed: 611, durationMin: 40, startUtc: '10:40', metar: GOOD23, runway: '23L', readbackErr: 0.02, icao: 'EDDL',
    desc: 'A Condor B757-300 loses an engine passing 3,000 ft on the MODRU departure and wants to come straight back to 23L. Four arrivals are already on the transitions.',
    objective: 'First instruction to the emergency within 20 seconds, on the ground within 15 minutes, no loss of separation.',
    briefing: 'Late morning, runway 23L. 4 inbound, 2 out. Tower reports the Condor rolling at 10:41.',
    spawns: [
      D(30, 'CFG2175', 'B753', 'MODRU2T', { emergency: { after: 70, type: 'engine' } }),
      AD(5, 'EWG7VE', 'A320', 'BIKMU1A', { spawnDist: 30 }), AD(140, 'DLH5RW', 'A321', 'DOMUX1A'), AD(280, 'TUI6BU', 'B738', 'PISAP1A'), AD(420, 'EWG2LK', 'A319', 'BIKMU1A'),
      D(600, 'DLH3TQ', 'A20N', 'MEVEL4T'),
    ],
    events: [], pass: { emergencyLandedWithinMin: 15, minRatings: { NONR: 3, SEPC: 4 } },
  },
  {
    id: 'dus-full-hour', tier: 4, title: 'The full hour', seed: 612, durationMin: 70, startUtc: '15:50', metar: SUMMER23, runway: '23L', readbackErr: 0.04, confusion: true, icao: 'EDDL',
    desc: 'The evening wave, start to finish: eighteen arrivals and fourteen departures in an hour on one runway, then the northern runway opens at 17:15 local and the arrivals move to 23R. The ATIS changes once. Similar callsigns are on frequency together.',
    objective: 'Land at least fifteen, hand on at least ten departures, pass the safety gate.',
    briefing: 'Evening wave, runway 23L for everything until the northern runway opens at 17:15 local. 18 inbound, 14 out. Expect the ATIS to change once.',
    spawns: [
      AD(5, 'EWG1AB', 'A320', 'BIKMU1A', { spawnDist: 30 }), AD(140, 'CFG1310', 'A333', 'DOMUX1A'), AD(280, 'DLH4KA', 'A20N', 'PISAP1A'), AD(420, 'TUI7RE', 'B738', 'BIKMU1A'),
      AD(560, 'EWG1BA', 'A319', 'HALME1A'), AD(700, 'SXS4KL', 'B738', 'DOMUX1A'), AD(840, 'UAE57', 'B77W', 'BIKMU1A'), AD(980, 'EJU73QX', 'A320', 'PISAP1A'),
      AD(1120, 'EWG5GH', 'A21N', 'DOMUX1A'), AD(1260, 'KLC1859', 'E190', 'HALME1A'), AD(1400, 'CFG2316', 'B753', 'BIKMU1A'), AD(1540, 'DLH4AK', 'A321', 'PISAP1A'),
      AD(1680, 'PGT1053', 'A321', 'DOMUX1A'), AD(1820, 'EWG9NE', 'A320', 'BIKMU1A'), AD(1960, 'BAW941', 'A320', 'HALME1A'), AD(2100, 'TUI7ER', 'B38M', 'DOMUX1A'),
      AD(2240, 'EWG3QV', 'A320', 'PISAP1A'), AD(2380, 'AUA187', 'A320', 'BIKMU1A'),
      D(240, 'EWG2DF', 'A320', 'MODRU2T'), D(440, 'DLH6WA', 'A321', 'SONEB8T'), D(640, 'CFG1311', 'A333', 'KUMIK7T'), D(840, 'TUI7RF', 'B738', 'COL6T'), D(1040, 'EWG2FD', 'A319', 'MEVEL4T'),
      D(1240, 'SXS4KM', 'B738', 'DODEN1T'), D(1440, 'EWG7HK', 'A21N', 'NETEX6T'), D(1640, 'DLH6AW', 'A20N', 'GMH1T'), D(1840, 'CFG2317', 'B753', 'NUDGO6T'), D(2040, 'EWG4JS', 'A320', 'MODRU2T'),
      D(2240, 'EJU73XQ', 'A320', 'KUMIK7T'), D(2440, 'TUI8CL', 'B738', 'SONEB8T'), D(2640, 'EWG1NQ', 'A319', 'COL6T'), D(2840, 'DLH9UV', 'A321', 'MEVEL4T'),
    ],
    events: [{ t: 1200, kind: 'parallel', on: true, notice: 600 }, { t: 1500, kind: 'wind', dir: 250, kt: 11 }],
    pass: { minLanded: 15, minDeparturesHandled: 10 },
  },
];

/** Challenges are hot-started (first aircraft calling at once) and end ~15 minutes after the last spawn. */
export const CHALLENGES: Scenario[] = [...LIBRARY, ...DUS_LIBRARY].map((sc) => {
  const spawns = sc.spawns.map((x) => ({ ...x }));
  hotStart(spawns);
  const obj = emergencyObjectives(spawns).map((o) => {
    const m = sc.pass?.emergencyLandedWithinMin;
    if (!m) return o;
    const t0 = o.byT - (o.text.includes('15:00') ? 15 : 12) * 60;
    return { ...o, text: `Land ${o.cs} within ${m}:00`, byT: t0 + m * 60 };
  });
  return { ...sc, icao: sc.icao ?? 'EBLG', spawns, durationMin: durationFor(spawns), objectives: obj.length ? obj : sc.objectives };
});
/** The challenges written for an airport (Liège and Düsseldorf). */
export const challengesFor = (icao: string) => CHALLENGES.filter((c) => (c.icao ?? 'EBLG') === icao);

/** Tier n+1 opens once every challenge in tier n is passed (per airport: pass its challenge list). */
export function unlockedTiers(passed: Set<string>, unlockAll = false, list: Scenario[] = CHALLENGES): Set<number> {
  if (unlockAll) return new Set([1, 2, 3, 4]);
  const tiers = new Set([1]);
  for (let t = 1; t < 4; t++) {
    if (!tiers.has(t)) break;
    const inTier = list.filter((c) => c.tier === t);
    if (inTier.length && inTier.every((c) => passed.has(c.id))) tiers.add(t + 1);
  }
  return tiers;
}

export const TIER_NAMES: Record<number, string> = { 1: 'Fundamentals', 2: 'Liège operations', 3: 'Abnormal', 4: 'Emergency' };
/** Tier names per airport (tier 2 is the airport's own operations). */
export const tierName = (tier: number, icao = 'EBLG') => (tier === 2 ? (icao === 'EDDL' ? 'Düsseldorf operations' : TIER_NAMES[2]) : TIER_NAMES[tier] ?? `Tier ${tier}`);
