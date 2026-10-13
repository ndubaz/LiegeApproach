import type { Scenario, SpawnSpec } from './types';
import { durationFor, emergencyObjectives, hotStart } from './traffic';

// The challenge library: 21 scripted scenarios in four tiers.
// Times are seconds from the start. Callsigns are realistic in format; flights are fictional.

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
    desc: 'The wind backs to the north-east. At 04:11 the supervisor switches to runway 04R. Re-sequence everyone onto the 04 side without a bust.',
    objective: 'Land at least six; no go-arounds for tailwind or unstable approaches.',
    spawns: [
      A(5, 'FDX5203', 'MD11', 'KOK7X'), A(150, 'QTR8125', 'B77L', 'CIV7X'), A(300, 'TAY4EK', 'B763', 'LNO6X', { spawnDist: 30 }), A(450, 'CHG201', 'B744', 'NIK7X'),
      A(720, 'AZG7321', 'B748', 'KOK7D'), A(900, 'ETH3721', 'B77L', 'CIV7D'), A(1080, 'BCS5AB', 'A306', 'LNO6D'), A(1260, 'THY6411', 'A332', 'NIK7D'),
    ],
    events: [{ t: 560, kind: 'wind', dir: 40, kt: 12 }, { t: 660, kind: 'runway', rwy: '04R' }],
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

/** Challenges are hot-started (first aircraft calling at once) and end ~15 minutes after the last spawn. */
export const CHALLENGES: Scenario[] = LIBRARY.map((sc) => {
  const spawns = sc.spawns.map((x) => ({ ...x }));
  hotStart(spawns);
  const obj = emergencyObjectives(spawns).map((o) => {
    const m = sc.pass?.emergencyLandedWithinMin;
    if (!m) return o;
    const t0 = o.byT - (o.text.includes('15:00') ? 15 : 12) * 60;
    return { ...o, text: `Land ${o.cs} within ${m}:00`, byT: t0 + m * 60 };
  });
  return { ...sc, spawns, durationMin: durationFor(spawns), objectives: obj.length ? obj : sc.objectives };
});

/** Tier n+1 opens once every challenge in tier n is passed. */
export function unlockedTiers(passed: Set<string>, unlockAll = false): Set<number> {
  if (unlockAll) return new Set([1, 2, 3, 4]);
  const tiers = new Set([1]);
  for (let t = 1; t < 4; t++) {
    if (!tiers.has(t)) break;
    if (CHALLENGES.filter((c) => c.tier === t).every((c) => passed.has(c.id))) tiers.add(t + 1);
  }
  return tiers;
}

export const TIER_NAMES: Record<number, string> = { 1: 'Fundamentals', 2: 'Liège operations', 3: 'Abnormal', 4: 'Emergency' };
