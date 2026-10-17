// Video-map data for Liège that is not procedure data: terrain, ranked places and the other
// aerodromes in the area. Everything here is approximate (drawn from topographic maps, not the AIP)
// and only the scope reads it. Positions are to the nearest minute or so.
import type { AirportSpec, PlaceSpec, TerrainSpec } from './types';

/** Hand-drawn relief: approximate contours of the Condroz, the Herve plateau and the Ardennes (lat, lon). */
export const EBLG_TERRAIN: TerrainSpec = {
  contours: [
    { pts: [[50.86, 5.98], [50.76, 5.93], [50.69, 5.86], [50.62, 5.76], [50.57, 5.64], [50.53, 5.50], [50.49, 5.33], [50.45, 5.16], [50.40, 4.98], [50.35, 4.80], [50.30, 4.62]] },
    { pts: [[50.78, 6.14], [50.68, 6.06], [50.60, 5.97], [50.53, 5.84], [50.46, 5.66], [50.39, 5.46], [50.32, 5.26], [50.25, 5.06], [50.18, 4.88]] },
    { pts: [[50.68, 6.27], [50.59, 6.17], [50.51, 6.03], [50.43, 5.90], [50.35, 5.72], [50.27, 5.53], [50.19, 5.34], [50.10, 5.15]] },
    { pts: [[50.60, 6.36], [50.50, 6.26], [50.42, 6.12], [50.35, 5.99], [50.28, 5.84], [50.19, 5.70], [50.10, 5.52], [50.01, 5.35]] },
    { pts: [[50.535, 6.02], [50.555, 6.10], [50.535, 6.19], [50.48, 6.20], [50.455, 6.10], [50.48, 6.01]], closed: true },
    { pts: [[50.515, 6.06], [50.515, 6.12], [50.49, 6.14], [50.48, 6.08]], closed: true },
    { pts: [[50.29, 5.69], [50.28, 5.79], [50.22, 5.81], [50.19, 5.73], [50.23, 5.65]], closed: true },
    { pts: [[50.15, 5.93], [50.10, 6.04], [50.03, 6.02], [50.04, 5.90], [50.10, 5.86]], closed: true },
  ],
  spots: [
    { lat: 50.501, lon: 6.093, text: '2277' }, { lat: 50.253, lon: 5.729, text: '2139' }, { lat: 50.635, lon: 5.92, text: '1050' },
  ],
  regions: [
    { lat: 50.585, lon: 6.10, name: 'Hautes Fagnes' }, { lat: 50.10, lon: 6.22, name: 'Ardennes' }, { lat: 50.38, lon: 5.08, name: 'Condroz' },
  ],
};

/** Towns by size. Rank 1 is always labelled, rank 2 from about 40 NM range, rank 3 only when zoomed in. */
export const EBLG_PLACES: PlaceSpec[] = [
  { name: 'Liège', lat: '503845N', lon: '0053425E', rank: 1 },
  { name: 'Maastricht', lat: '505100N', lon: '0054100E', rank: 1 },
  { name: 'Namur', lat: '502800N', lon: '0045200E', rank: 1 },
  { name: 'Aachen', lat: '504631N', lon: '0060502E', rank: 1 },
  { name: 'Hasselt', lat: '505600N', lon: '0052000E', rank: 2 },
  { name: 'Huy', lat: '503112N', lon: '0051424E', rank: 2 },
  { name: 'Verviers', lat: '503500N', lon: '0055200E', rank: 2 },
  { name: 'Tongeren', lat: '504650N', lon: '0052750E', rank: 2 },
  { name: 'Spa', lat: '502930N', lon: '0055150E', rank: 2 },
  { name: 'Genk', lat: '505800N', lon: '0053000E', rank: 2 },
  { name: 'Sint-Truiden', lat: '504900N', lon: '0051100E', rank: 2 },
  { name: 'Eupen', lat: '503743N', lon: '0060214E', rank: 2 },
  { name: 'Marche-en-Famenne', lat: '501337N', lon: '0052040E', rank: 2 },
  { name: 'Seraing', lat: '503600N', lon: '0053000E', rank: 3 },
  { name: 'Visé', lat: '504406N', lon: '0054145E', rank: 3 },
  { name: 'Herve', lat: '503825N', lon: '0054740E', rank: 3 },
  { name: 'Waremme', lat: '504140N', lon: '0051520E', rank: 3 },
  { name: 'Malmedy', lat: '502531N', lon: '0060142E', rank: 3 },
  { name: 'Andenne', lat: '502924N', lon: '0050600E', rank: 3 },
  { name: 'Ciney', lat: '501740N', lon: '0050600E', rank: 3 },
  { name: 'Valkenburg', lat: '505200N', lon: '0054950E', rank: 3 },
];

/** Other aerodromes the position sees on the scope. */
export const EBLG_AIRPORTS: AirportSpec[] = [
  { icao: 'EBCI', name: 'Charleroi', lat: '502732N', lon: '0042709E' },
  { icao: 'EBBR', name: 'Brussels', lat: '505405N', lon: '0042904E' },
  { icao: 'EBBE', name: 'Beauvechain', lat: '504531N', lon: '0044606E', kind: 'mil' },
  { icao: 'EBFS', name: 'Florennes', lat: '501436N', lon: '0043845E', kind: 'mil' },
  { icao: 'EBBL', name: 'Kleine-Brogel', lat: '511006N', lon: '0052812E', kind: 'mil' },
  { icao: 'EBSP', name: 'Spa La Sauvenière', lat: '502857N', lon: '0055437E' },
  { icao: 'EBSH', name: 'Saint-Hubert', lat: '500209N', lon: '0052415E' },
  { icao: 'EBNM', name: 'Namur Temploux', lat: '502917N', lon: '0044608E' },
  { icao: 'EHBK', name: 'Maastricht Aachen', lat: '505442N', lon: '0054613E' },
  { icao: 'ETNG', name: 'Geilenkirchen', lat: '505740N', lon: '0060233E', kind: 'mil' },
  { icao: 'EDKA', name: 'Aachen-Merzbrück', lat: '504923N', lon: '0061111E' },
  { icao: 'ELLX', name: 'Luxembourg', lat: '493724N', lon: '0061216E' },
  { icao: 'EBBX', name: 'Jehonville', lat: '495331N', lon: '0051326E', kind: 'mil' },
  { icao: 'EBVE', name: 'Verviers Theux', lat: '503718N', lon: '0055432E', kind: 'glider' },
];
