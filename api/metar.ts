// Vercel serverless function: current METAR for an ICAO code, from the
// NOAA Aviation Weather Center data API. Used by the "Live METAR" option.
export default async function handler(req: any, res: any) {
  const ids = String(req.query?.ids ?? 'EBLG').toUpperCase().replace(/[^A-Z0-9,]/g, '').slice(0, 20);
  try {
    const r = await fetch(`https://aviationweather.gov/api/data/metar?ids=${ids}&format=raw&taf=false`, { headers: { 'User-Agent': 'liege-approach-sim' } });
    const text = (await r.text()).trim().split('\n')[0] ?? '';
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    if (!r.ok || !text.startsWith(ids.split(',')[0])) return res.status(502).json({ error: 'no metar' });
    return res.status(200).json({ metar: text });
  } catch {
    return res.status(502).json({ error: 'upstream failed' });
  }
}
