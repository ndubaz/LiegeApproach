// Per-type performance envelopes. Values are approximate, assembled from public
// manufacturer and type-rating figures, at typical operating weights in the
// terminal area. They are tuned for believable terminal behaviour, not for
// flight planning. EUROCONTROL BADA is deliberately not used (licensed data).

export type Recat = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type IcaoWake = 'J' | 'H' | 'M' | 'L';

export interface Perf {
  type: string;
  name: string;
  recat: Recat;
  wake: IcaoWake;
  vapp: number;       // final approach speed, kt IAS
  vminClean: number;  // minimum clean manoeuvring speed, kt IAS
  vminFlap: number;   // minimum with approach flap (for 160-180 kt on final)
  vcruiseLow: number; // normal speed below FL100 if unrestricted
  climbFpm: number;   // initial climb rate at low level
  descentFpm: number; // normal descent rate
  accel: number;      // kt/s level
  decel: number;      // kt/s level, clean
  fuelKgH: number;    // fuel flow at low altitude, kg/h
  heli?: boolean;
  fighter?: boolean;
  vfrCruise?: number;
}

const P = (p: Perf) => p;

export const PERF: Record<string, Perf> = {
  A124: P({ type: 'A124', name: 'An-124', recat: 'A', wake: 'H', vapp: 150, vminClean: 230, vminFlap: 175, vcruiseLow: 250, climbFpm: 1400, descentFpm: 1800, accel: 0.8, decel: 0.6, fuelKgH: 11000 }),
  B748: P({ type: 'B748', name: 'B747-8F', recat: 'B', wake: 'H', vapp: 160, vminClean: 230, vminFlap: 175, vcruiseLow: 250, climbFpm: 1800, descentFpm: 2000, accel: 1.0, decel: 0.6, fuelKgH: 9500 }),
  B744: P({ type: 'B744', name: 'B747-400F', recat: 'B', wake: 'H', vapp: 155, vminClean: 225, vminFlap: 170, vcruiseLow: 250, climbFpm: 1800, descentFpm: 2000, accel: 1.0, decel: 0.65, fuelKgH: 10000 }),
  B77L: P({ type: 'B77L', name: 'B777F', recat: 'B', wake: 'H', vapp: 150, vminClean: 215, vminFlap: 165, vcruiseLow: 250, climbFpm: 2200, descentFpm: 2000, accel: 1.1, decel: 0.7, fuelKgH: 7500 }),
  C17: P({ type: 'C17', name: 'C-17A', recat: 'B', wake: 'H', vapp: 130, vminClean: 200, vminFlap: 150, vcruiseLow: 250, climbFpm: 2500, descentFpm: 2500, accel: 1.2, decel: 0.9, fuelKgH: 8000 }),
  A332: P({ type: 'A332', name: 'A330-200F', recat: 'B', wake: 'H', vapp: 140, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2200, descentFpm: 2000, accel: 1.1, decel: 0.75, fuelKgH: 5800 }),
  MD11: P({ type: 'MD11', name: 'MD-11F', recat: 'C', wake: 'H', vapp: 160, vminClean: 225, vminFlap: 175, vcruiseLow: 250, climbFpm: 2000, descentFpm: 2000, accel: 1.0, decel: 0.6, fuelKgH: 7800 }),
  B763: P({ type: 'B763', name: 'B767-300F', recat: 'C', wake: 'H', vapp: 140, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2500, descentFpm: 2200, accel: 1.2, decel: 0.8, fuelKgH: 5000 }),
  A306: P({ type: 'A306', name: 'A300-600F', recat: 'C', wake: 'H', vapp: 140, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2200, descentFpm: 2000, accel: 1.1, decel: 0.75, fuelKgH: 5200 }),
  E3TF: P({ type: 'E3TF', name: 'E-3A Sentry', recat: 'C', wake: 'H', vapp: 145, vminClean: 230, vminFlap: 170, vcruiseLow: 250, climbFpm: 1500, descentFpm: 1800, accel: 0.8, decel: 0.6, fuelKgH: 6500 }),
  A400: P({ type: 'A400', name: 'A400M', recat: 'C', wake: 'H', vapp: 120, vminClean: 180, vminFlap: 140, vcruiseLow: 250, climbFpm: 2000, descentFpm: 2000, accel: 1.2, decel: 1.0, fuelKgH: 3800 }),
  B752: P({ type: 'B752', name: 'B757-200F', recat: 'C', wake: 'M', vapp: 135, vminClean: 200, vminFlap: 150, vcruiseLow: 250, climbFpm: 3000, descentFpm: 2300, accel: 1.4, decel: 0.9, fuelKgH: 3200 }),
  C30J: P({ type: 'C30J', name: 'C-130J', recat: 'D', wake: 'M', vapp: 120, vminClean: 160, vminFlap: 130, vcruiseLow: 220, climbFpm: 1800, descentFpm: 1800, accel: 1.0, decel: 1.0, fuelKgH: 2300 }),
  A321: P({ type: 'A321', name: 'A321', recat: 'D', wake: 'M', vapp: 140, vminClean: 210, vminFlap: 155, vcruiseLow: 250, climbFpm: 2800, descentFpm: 2300, accel: 1.5, decel: 1.0, fuelKgH: 2600 }),
  A320: P({ type: 'A320', name: 'A320', recat: 'D', wake: 'M', vapp: 135, vminClean: 200, vminFlap: 150, vcruiseLow: 250, climbFpm: 3000, descentFpm: 2300, accel: 1.5, decel: 1.0, fuelKgH: 2400 }),
  B738: P({ type: 'B738', name: 'B737-800', recat: 'D', wake: 'M', vapp: 145, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2800, descentFpm: 2300, accel: 1.5, decel: 1.0, fuelKgH: 2500 }),
  E190: P({ type: 'E190', name: 'E190', recat: 'E', wake: 'M', vapp: 130, vminClean: 190, vminFlap: 145, vcruiseLow: 250, climbFpm: 3000, descentFpm: 2300, accel: 1.6, decel: 1.1, fuelKgH: 2000 }),
  F35: P({ type: 'F35', name: 'F-35A', recat: 'E', wake: 'M', vapp: 150, vminClean: 220, vminFlap: 170, vcruiseLow: 300, climbFpm: 12000, descentFpm: 5000, accel: 4, decel: 3, fuelKgH: 3000, fighter: true }),
  F16: P({ type: 'F16', name: 'F-16AM', recat: 'E', wake: 'M', vapp: 145, vminClean: 220, vminFlap: 170, vcruiseLow: 300, climbFpm: 12000, descentFpm: 5000, accel: 4, decel: 3, fuelKgH: 3000, fighter: true }),
  C56X: P({ type: 'C56X', name: 'Citation XLS', recat: 'F', wake: 'M', vapp: 115, vminClean: 170, vminFlap: 130, vcruiseLow: 250, climbFpm: 3500, descentFpm: 2500, accel: 2, decel: 1.5, fuelKgH: 700 }),
  B350: P({ type: 'B350', name: 'King Air 350', recat: 'F', wake: 'L', vapp: 105, vminClean: 140, vminFlap: 120, vcruiseLow: 220, climbFpm: 2000, descentFpm: 1500, accel: 1.5, decel: 1.5, fuelKgH: 350 }),
  C172: P({ type: 'C172', name: 'Cessna 172', recat: 'F', wake: 'L', vapp: 65, vminClean: 80, vminFlap: 70, vcruiseLow: 105, climbFpm: 600, descentFpm: 500, accel: 0.8, decel: 0.8, fuelKgH: 30, vfrCruise: 105 }),
  PA28: P({ type: 'PA28', name: 'PA-28', recat: 'F', wake: 'L', vapp: 70, vminClean: 85, vminFlap: 75, vcruiseLow: 110, climbFpm: 650, descentFpm: 500, accel: 0.8, decel: 0.8, fuelKgH: 32, vfrCruise: 110 }),
  EC45: P({ type: 'EC45', name: 'H145', recat: 'F', wake: 'L', vapp: 70, vminClean: 60, vminFlap: 60, vcruiseLow: 120, climbFpm: 1200, descentFpm: 1000, accel: 1.5, decel: 1.5, fuelKgH: 200, heli: true, vfrCruise: 120 }),
  NH90: P({ type: 'NH90', name: 'NH90', recat: 'F', wake: 'M', vapp: 80, vminClean: 60, vminFlap: 60, vcruiseLow: 135, climbFpm: 1200, descentFpm: 1000, accel: 1.5, decel: 1.5, fuelKgH: 650, heli: true, vfrCruise: 135 }),
  // ---- 2.0: the passenger-hub fleet (RECAT-EU categories per EUROCONTROL's type list; speeds at typical landing weights) ----
  A388: P({ type: 'A388', name: 'A380-800', recat: 'A', wake: 'J', vapp: 140, vminClean: 220, vminFlap: 170, vcruiseLow: 250, climbFpm: 1800, descentFpm: 2000, accel: 0.9, decel: 0.6, fuelKgH: 12000 }),
  B77W: P({ type: 'B77W', name: 'B777-300ER', recat: 'B', wake: 'H', vapp: 150, vminClean: 220, vminFlap: 170, vcruiseLow: 250, climbFpm: 2200, descentFpm: 2000, accel: 1.1, decel: 0.7, fuelKgH: 7800 }),
  B789: P({ type: 'B789', name: 'B787-9', recat: 'B', wake: 'H', vapp: 145, vminClean: 215, vminFlap: 165, vcruiseLow: 250, climbFpm: 2500, descentFpm: 2200, accel: 1.2, decel: 0.75, fuelKgH: 5600 }),
  B788: P({ type: 'B788', name: 'B787-8', recat: 'B', wake: 'H', vapp: 140, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2600, descentFpm: 2200, accel: 1.2, decel: 0.75, fuelKgH: 5200 }),
  A359: P({ type: 'A359', name: 'A350-900', recat: 'B', wake: 'H', vapp: 140, vminClean: 215, vminFlap: 165, vcruiseLow: 250, climbFpm: 2500, descentFpm: 2200, accel: 1.2, decel: 0.75, fuelKgH: 5800 }),
  A333: P({ type: 'A333', name: 'A330-300', recat: 'B', wake: 'H', vapp: 140, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2200, descentFpm: 2000, accel: 1.1, decel: 0.75, fuelKgH: 5900 }),
  A339: P({ type: 'A339', name: 'A330-900', recat: 'B', wake: 'H', vapp: 140, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2300, descentFpm: 2000, accel: 1.1, decel: 0.75, fuelKgH: 5500 }),
  B764: P({ type: 'B764', name: 'B767-400ER', recat: 'C', wake: 'H', vapp: 145, vminClean: 215, vminFlap: 165, vcruiseLow: 250, climbFpm: 2400, descentFpm: 2200, accel: 1.2, decel: 0.8, fuelKgH: 5300 }),
  B753: P({ type: 'B753', name: 'B757-300', recat: 'C', wake: 'M', vapp: 140, vminClean: 205, vminFlap: 155, vcruiseLow: 250, climbFpm: 2800, descentFpm: 2300, accel: 1.3, decel: 0.9, fuelKgH: 3400 }),
  A21N: P({ type: 'A21N', name: 'A321neo', recat: 'D', wake: 'M', vapp: 140, vminClean: 210, vminFlap: 155, vcruiseLow: 250, climbFpm: 2800, descentFpm: 2300, accel: 1.5, decel: 1.0, fuelKgH: 2400 }),
  A20N: P({ type: 'A20N', name: 'A320neo', recat: 'D', wake: 'M', vapp: 135, vminClean: 200, vminFlap: 150, vcruiseLow: 250, climbFpm: 3000, descentFpm: 2300, accel: 1.5, decel: 1.0, fuelKgH: 2200 }),
  A319: P({ type: 'A319', name: 'A319', recat: 'D', wake: 'M', vapp: 130, vminClean: 195, vminFlap: 145, vcruiseLow: 250, climbFpm: 3000, descentFpm: 2300, accel: 1.5, decel: 1.0, fuelKgH: 2300 }),
  B38M: P({ type: 'B38M', name: 'B737 MAX 8', recat: 'D', wake: 'M', vapp: 145, vminClean: 210, vminFlap: 160, vcruiseLow: 250, climbFpm: 2800, descentFpm: 2300, accel: 1.5, decel: 1.0, fuelKgH: 2300 }),
  E195: P({ type: 'E195', name: 'E195', recat: 'E', wake: 'M', vapp: 135, vminClean: 195, vminFlap: 150, vcruiseLow: 250, climbFpm: 2900, descentFpm: 2300, accel: 1.6, decel: 1.1, fuelKgH: 2100 }),
  E290: P({ type: 'E290', name: 'E190-E2', recat: 'E', wake: 'M', vapp: 130, vminClean: 190, vminFlap: 145, vcruiseLow: 250, climbFpm: 3000, descentFpm: 2300, accel: 1.6, decel: 1.1, fuelKgH: 1900 }),
  CRJ9: P({ type: 'CRJ9', name: 'CRJ-900', recat: 'E', wake: 'M', vapp: 135, vminClean: 200, vminFlap: 150, vcruiseLow: 250, climbFpm: 3000, descentFpm: 2500, accel: 1.7, decel: 1.2, fuelKgH: 1600 }),
  AT76: P({ type: 'AT76', name: 'ATR 72-600', recat: 'E', wake: 'M', vapp: 115, vminClean: 170, vminFlap: 130, vcruiseLow: 230, climbFpm: 1500, descentFpm: 1500, accel: 1.2, decel: 1.2, fuelKgH: 650 }),
  DH8D: P({ type: 'DH8D', name: 'Dash 8 Q400', recat: 'E', wake: 'M', vapp: 120, vminClean: 180, vminFlap: 140, vcruiseLow: 250, climbFpm: 2000, descentFpm: 1800, accel: 1.3, decel: 1.2, fuelKgH: 800 }),
  B463: P({ type: 'B463', name: 'BAe 146-300', recat: 'E', wake: 'M', vapp: 120, vminClean: 180, vminFlap: 140, vcruiseLow: 250, climbFpm: 2200, descentFpm: 2500, accel: 1.4, decel: 1.3, fuelKgH: 1700 }),
  F2TH: P({ type: 'F2TH', name: 'Falcon 2000', recat: 'E', wake: 'M', vapp: 115, vminClean: 175, vminFlap: 135, vcruiseLow: 250, climbFpm: 3500, descentFpm: 2500, accel: 2, decel: 1.5, fuelKgH: 900 }),
  CL60: P({ type: 'CL60', name: 'Challenger 600', recat: 'E', wake: 'M', vapp: 125, vminClean: 180, vminFlap: 140, vcruiseLow: 250, climbFpm: 3500, descentFpm: 2500, accel: 2, decel: 1.5, fuelKgH: 1000 }),
  GLF6: P({ type: 'GLF6', name: 'Gulfstream G650', recat: 'E', wake: 'M', vapp: 125, vminClean: 185, vminFlap: 145, vcruiseLow: 250, climbFpm: 3500, descentFpm: 2500, accel: 2, decel: 1.5, fuelKgH: 1500 }),
};

/** RECAT-EU arrival wake separation minima, NM (leader → follower). Missing = radar minimum. */
const RECAT_NM: Record<string, number> = {
  AA: 3, AB: 4, AC: 5, AD: 5, AE: 6, AF: 8,
  BB: 3, BC: 4, BD: 4, BE: 5, BF: 7,
  CD: 3, CE: 4, CF: 6,
  DF: 5, EF: 4, FF: 3,
};
export function wakeMinNm(leader: Recat, follower: Recat, radarMin = 3): number {
  return Math.max(RECAT_NM[leader + follower] ?? 0, radarMin);
}

/**
 * RECAT-EU departure wake time minima, seconds (leader then follower, same runway or a parallel within 760 m).
 * Pairs not listed: the radar / runway minimum, taken as 60 s between successive departures.
 * EUROCONTROL RECAT-EU Ed. 1.1, departure separation table.
 */
export const DEP_S: Record<string, number> = {
  AB: 100, AC: 120, AD: 140, AE: 160, AF: 180,
  BD: 100, BE: 120, BF: 140,
  CD: 80, CE: 100, CF: 120,
  DF: 120, EF: 100, FF: 80,
};
/** Seconds needed between two departures: the RECAT-EU time minimum, never less than 60 s. */
export function depMinS(leader: Recat, follower: Recat): number {
  return Math.max(DEP_S[leader + follower] ?? 0, 60);
}
