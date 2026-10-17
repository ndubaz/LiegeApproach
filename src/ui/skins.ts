/**
 * Scope skins. Every colour the radar display uses lives here, one object per skin, with the same
 * information hierarchy in each:
 *   red     safety only (STCA, loss of separation, MSAW, emergencies)
 *   amber   act now (the next caller, a pilot deviation, weather ahead), one or two items at most
 *   cyan    your clearance, your selection, your tools
 *   white   assumed traffic (the brightest thing on the display)
 *   green   inbound, notified traffic
 *   grey    transferred and unconcerned traffic, then the map, dimmest of all
 *
 * The map is layered by weight: airspace outlines and the active centreline sit above procedures,
 * which sit above borders and rivers, which sit above motorways, towns and terrain. Each layer is
 * a step dimmer than the one above it so the eye lands on traffic first.
 *
 * `night` is the console default. `day` is for a tablet in daylight: a light ground with dark ink
 * and far stronger contrast than a dimmed night skin. `amber` is an homage to a single-phosphor CRT
 * (the 1980s Thomson-CSF and Plessey scopes): one hue for the map and the traffic, with brightness
 * carrying the hierarchy, and only safety red kept as a second colour.
 */
export interface Skin {
  // ground
  bg0: string; bg1: string;
  // terrain: contours, spot heights, region names
  contour: string; contourText: string; terrain: string;
  // range rings, rose, frame text
  ring: string; ring10: string; ringText: string; rose: string;
  // video map hierarchy
  border: string; road: string; roadText: string; river: string; rail: string; coast: string;
  town1: string; town2: string; town3: string; airport: string; airportText: string;
  // airspace
  ctr: string; ctrFill: string; tma: string; tmaFill: string; tmaPart: string;
  tsaOn: string; tsaFill: string; tsaOff: string; mva: string; mvaFill: string; mvaText: string;
  // runways, centrelines, fixes, procedures
  centreline: string; centreDim: string; runway: string; tick: string;
  fix: string; fixKey: string; fixText: string; proc: string; procText: string; sid: string; hold: string; holdText: string;
  // traffic
  assumed: string; notified: string; transferred: string; unconcerned: string; select: string; urgent: string; warn: string; assigned: string;
  tail: string; ghost: string; vector: string;
  // weather
  wx: [string, string, string]; wxLine: string; haze: string;
  // tools and overlays
  route: string; halo: string; ftdi: string; rbl: string; cursor: string; sweep: string;
  plate: string; plateSel: string; conflictFill: string; pillBg: string; pillText: string; gapOk: string; emerText: string; selFill: string;
  chip: string; chipLine: string; panel: string; panelLine: string; gsBand: string;
  /** Filtered-out traffic (outside the level filter). */
  filtered: string;
}

export type SkinName = 'night' | 'day' | 'amber';

const night: Skin = {
  bg0: '#0b1015', bg1: '#121a21',
  contour: 'rgba(140,150,112,0.16)', contourText: 'rgba(150,160,120,0.30)', terrain: 'rgba(150,160,120,',
  ring: 'rgba(150,178,195,0.07)', ring10: 'rgba(150,178,195,0.13)', ringText: 'rgba(150,178,195,0.45)', rose: 'rgba(150,178,195,0.2)',
  border: 'rgba(175,185,195,0.34)', road: 'rgba(150,160,170,0.13)', roadText: 'rgba(150,160,170,0.34)', river: 'rgba(86,140,178,0.36)', rail: 'rgba(160,160,160,0.16)', coast: 'rgba(86,140,178,0.5)',
  town1: 'rgba(175,195,210,0.5)', town2: 'rgba(160,180,195,0.36)', town3: 'rgba(150,170,185,0.24)', airport: 'rgba(170,190,205,0.5)', airportText: 'rgba(170,190,205,0.6)',
  ctr: 'rgba(125,180,210,0.46)', ctrFill: 'rgba(125,180,210,0.035)', tma: 'rgba(125,180,210,0.2)', tmaFill: 'rgba(125,180,210,0.018)', tmaPart: 'rgba(125,180,210,0.11)',
  tsaOn: 'rgba(242,184,75,0.62)', tsaFill: 'rgba(242,184,75,0.05)', tsaOff: 'rgba(242,184,75,0.17)', mva: 'rgba(150,200,150,0.32)', mvaFill: 'rgba(150,200,150,', mvaText: 'rgba(150,200,150,0.55)',
  centreline: 'rgba(205,220,230,0.45)', centreDim: 'rgba(205,220,230,0.14)', runway: '#dfe8ed', tick: 'rgba(205,220,230,0.5)',
  fix: 'rgba(165,190,205,0.5)', fixKey: 'rgba(200,220,232,0.85)', fixText: 'rgba(165,190,205,0.58)', proc: 'rgba(110,165,200,0.16)', procText: 'rgba(130,180,210,0.45)', sid: 'rgba(170,150,215,0.12)', hold: 'rgba(160,190,210,0.26)', holdText: 'rgba(160,190,210,0.5)',
  assumed: '#f2f6f8', notified: '#8fe0a2', transferred: '#7d92a2', unconcerned: '#56666f', select: '#56d2ea', urgent: '#ff5148', warn: '#ffb444', assigned: '#80d5e8',
  tail: 'rgba(242,246,248,', ghost: 'rgba(242,246,248,0.22)', vector: 'rgba(242,246,248,0.8)',
  wx: ['rgba(64,128,160,0.30)', 'rgba(200,164,62,0.40)', 'rgba(222,76,96,0.50)'], wxLine: 'rgba(210,180,100,0.55)', haze: 'rgba(190,200,210,',
  route: 'rgba(86,210,234,0.55)', halo: 'rgba(8,13,17,0.85)', ftdi: 'rgba(200,215,225,0.85)', rbl: '#e8d36a', cursor: 'rgba(150,178,195,0.7)', sweep: 'rgba(150,200,180,',
  plate: 'rgba(11,16,21,0.72)', plateSel: 'rgba(11,16,21,0.88)', conflictFill: 'rgba(255,81,72,0.10)', pillBg: '#3a1114', pillText: '#ffffff', gapOk: '#8fe0a2', emerText: '#0e161d', selFill: 'rgba(86,210,234,0.10)',
  chip: 'rgba(86,210,234,0.10)', chipLine: 'rgba(86,210,234,0.45)', panel: 'rgba(9,15,20,0.92)', panelLine: 'rgba(150,178,195,0.22)', gsBand: 'rgba(205,220,230,0.11)',
  filtered: '#3c474f',
};

const day: Skin = {
  bg0: '#cfd6da', bg1: '#dde3e6',
  contour: 'rgba(95,90,55,0.22)', contourText: 'rgba(95,90,55,0.5)', terrain: 'rgba(110,105,70,',
  ring: 'rgba(60,80,92,0.14)', ring10: 'rgba(60,80,92,0.28)', ringText: '#3f4f58', rose: 'rgba(60,80,92,0.4)',
  border: 'rgba(60,75,85,0.75)', road: 'rgba(90,105,115,0.34)', roadText: 'rgba(70,85,95,0.7)', river: 'rgba(36,96,140,0.6)', rail: 'rgba(80,80,80,0.3)', coast: 'rgba(36,96,140,0.8)',
  town1: '#2e3d46', town2: '#48585f', town3: '#6b7a83', airport: '#3a4a54', airportText: '#2e3d46',
  ctr: 'rgba(30,70,95,0.75)', ctrFill: 'rgba(30,70,95,0.05)', tma: 'rgba(30,70,95,0.4)', tmaFill: 'rgba(30,70,95,0.025)', tmaPart: 'rgba(30,70,95,0.22)',
  tsaOn: 'rgba(150,85,0,0.8)', tsaFill: 'rgba(150,85,0,0.07)', tsaOff: 'rgba(150,85,0,0.35)', mva: 'rgba(30,95,45,0.55)', mvaFill: 'rgba(30,95,45,', mvaText: 'rgba(30,95,45,0.85)',
  centreline: 'rgba(30,45,55,0.65)', centreDim: 'rgba(30,45,55,0.22)', runway: '#1f2d36', tick: 'rgba(30,45,55,0.7)',
  fix: '#5a6a73', fixKey: '#1f2d36', fixText: '#3f4f58', proc: 'rgba(30,85,130,0.26)', procText: 'rgba(30,75,115,0.7)', sid: 'rgba(95,65,150,0.26)', hold: 'rgba(30,45,55,0.36)', holdText: 'rgba(30,45,55,0.6)',
  assumed: '#07121a', notified: '#0f6a33', transferred: '#4f6775', unconcerned: '#7f8e96', select: '#005f78', urgent: '#c1001f', warn: '#8a4f00', assigned: '#005f78',
  tail: 'rgba(7,18,26,', ghost: 'rgba(7,18,26,0.22)', vector: 'rgba(7,18,26,0.85)',
  wx: ['rgba(50,120,165,0.30)', 'rgba(190,140,20,0.42)', 'rgba(193,0,31,0.40)'], wxLine: 'rgba(110,70,0,0.65)', haze: 'rgba(235,238,240,',
  route: 'rgba(0,95,120,0.65)', halo: 'rgba(232,236,238,0.9)', ftdi: '#1f2d36', rbl: '#5e4600', cursor: 'rgba(40,55,65,0.8)', sweep: 'rgba(40,90,70,',
  plate: 'rgba(230,235,238,0.78)', plateSel: 'rgba(236,240,242,0.94)', conflictFill: 'rgba(193,0,31,0.10)', pillBg: '#c1001f', pillText: '#ffffff', gapOk: '#0f6a33', emerText: '#ffffff', selFill: 'rgba(0,95,120,0.10)',
  chip: 'rgba(0,95,120,0.08)', chipLine: 'rgba(0,95,120,0.5)', panel: 'rgba(222,228,231,0.96)', panelLine: 'rgba(30,45,55,0.28)', gsBand: 'rgba(30,45,55,0.08)',
  filtered: '#9aa6ac',
};

const amber: Skin = {
  bg0: '#0d0802', bg1: '#140c03',
  contour: 'rgba(255,176,0,0.08)', contourText: 'rgba(255,176,0,0.2)', terrain: 'rgba(255,176,0,',
  ring: 'rgba(255,176,0,0.07)', ring10: 'rgba(255,176,0,0.13)', ringText: 'rgba(255,176,0,0.45)', rose: 'rgba(255,176,0,0.2)',
  border: 'rgba(255,176,0,0.3)', road: 'rgba(255,176,0,0.1)', roadText: 'rgba(255,176,0,0.28)', river: 'rgba(255,176,0,0.2)', rail: 'rgba(255,176,0,0.12)', coast: 'rgba(255,176,0,0.3)',
  town1: 'rgba(255,190,60,0.5)', town2: 'rgba(255,190,60,0.36)', town3: 'rgba(255,190,60,0.24)', airport: 'rgba(255,190,60,0.5)', airportText: 'rgba(255,190,60,0.55)',
  ctr: 'rgba(255,176,0,0.45)', ctrFill: 'rgba(255,176,0,0.03)', tma: 'rgba(255,176,0,0.2)', tmaFill: 'rgba(255,176,0,0.015)', tmaPart: 'rgba(255,176,0,0.11)',
  tsaOn: 'rgba(255,214,120,0.7)', tsaFill: 'rgba(255,214,120,0.05)', tsaOff: 'rgba(255,214,120,0.18)', mva: 'rgba(255,176,0,0.28)', mvaFill: 'rgba(255,176,0,', mvaText: 'rgba(255,176,0,0.5)',
  centreline: 'rgba(255,200,90,0.5)', centreDim: 'rgba(255,200,90,0.14)', runway: '#ffd27a', tick: 'rgba(255,200,90,0.55)',
  fix: 'rgba(255,176,0,0.45)', fixKey: 'rgba(255,214,120,0.85)', fixText: 'rgba(255,176,0,0.55)', proc: 'rgba(255,176,0,0.14)', procText: 'rgba(255,176,0,0.42)', sid: 'rgba(255,176,0,0.1)', hold: 'rgba(255,176,0,0.26)', holdText: 'rgba(255,176,0,0.5)',
  assumed: '#ffcf5c', notified: '#d9a640', transferred: '#9a7430', unconcerned: '#5c4620', select: '#fff3cc', urgent: '#ff4a3a', warn: '#ffe9a0', assigned: '#ffe3a0',
  tail: 'rgba(255,207,92,', ghost: 'rgba(255,207,92,0.22)', vector: 'rgba(255,207,92,0.8)',
  wx: ['rgba(255,176,0,0.12)', 'rgba(255,176,0,0.26)', 'rgba(255,120,40,0.45)'], wxLine: 'rgba(255,200,90,0.5)', haze: 'rgba(255,200,120,',
  route: 'rgba(255,243,204,0.55)', halo: 'rgba(13,8,2,0.88)', ftdi: 'rgba(255,220,140,0.85)', rbl: '#ffe9a0', cursor: 'rgba(255,176,0,0.7)', sweep: 'rgba(255,190,60,',
  plate: 'rgba(13,8,2,0.74)', plateSel: 'rgba(13,8,2,0.9)', conflictFill: 'rgba(255,74,58,0.12)', pillBg: '#3a0e08', pillText: '#ffe9d6', gapOk: '#d9a640', emerText: '#140c03', selFill: 'rgba(255,243,204,0.08)',
  chip: 'rgba(255,243,204,0.07)', chipLine: 'rgba(255,243,204,0.4)', panel: 'rgba(13,8,2,0.94)', panelLine: 'rgba(255,176,0,0.25)', gsBand: 'rgba(255,200,90,0.1)',
  filtered: '#3f2e12',
};

export const SKIN: Record<SkinName, Skin> = { night, day, amber };

export const SKIN_NAMES: { id: SkinName; label: string; blurb: string }[] = [
  { id: 'night', label: 'Night', blurb: 'The console default: dark ground, white traffic.' },
  { id: 'day', label: 'Day', blurb: 'Light ground and dark ink for a tablet in daylight.' },
  { id: 'amber', label: 'Amber', blurb: 'One-phosphor CRT look. Brightness carries the hierarchy; red stays for safety.' },
];

/** Resolve a skin by name, falling back to night for anything unknown (older saved settings). */
export const skinFor = (name: string | undefined): Skin => SKIN[(name ?? 'night') as SkinName] ?? night;

/** Replace the alpha of an `rgba(r,g,b,a)` string. Hex and named colours come back unchanged. */
export const withAlpha = (c: string, a: number) => (c.startsWith('rgba(') ? c.replace(/[\d.]+\)$/, `${a})`) : c);
