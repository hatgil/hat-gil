const safePoint = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const lat = Number(value[0]), lon = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 34 || lat > 36 || lon < 128 || lon > 130.5) return null;
  return [lat, lon];
};

const requestOverpass = async (query: string) => {
  const endpoints = ["https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass-api.de/api/interpreter"];
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(endpoint, {
        method: "POST", body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "GeuneulOn/1.0" },
        signal: controller.signal,
      });
      if (response.ok) return await response.json() as { elements?: unknown[] };
    } catch { /* 다음 공식 미러로 재시도 */ }
    finally { clearTimeout(timeout); }
  }
  return { elements: [] };
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as { samples?: unknown[]; ends?: unknown[] };
    const samples = (body.samples || []).map(safePoint).filter(Boolean).slice(0, 3) as [number, number][];
    const ends = (body.ends || []).map(safePoint).filter(Boolean).slice(0, 2) as [number, number][];
    if (!samples.length || !ends.length) return Response.json({ error: "잘못된 좌표입니다." }, { status: 400 });
    const around = (points: [number, number][], filter: string, radius: number) => points.map(point => `${filter}(around:${radius},${point[0]},${point[1]});`).join("");
    const buildingQuery = `[out:json][timeout:18];(${around(samples, 'way["building"]', 430)});out tags geom;`;
    const placeQuery = `[out:json][timeout:18];(${around(samples, 'nwr["name"]["amenity"]', 520)}${around(samples, 'nwr["name"]["tourism"]', 520)}${around(samples, 'nwr["name"]["leisure"]', 520)}${around(samples, 'nwr["name"]["shop"]', 520)}${around(ends, 'nwr["highway"="bus_stop"]', 1400)}${around(ends, 'nwr["railway"="station"]', 2600)}${around(ends, 'nwr["station"="subway"]', 2600)});out tags center;`;
    const [buildings, places] = await Promise.all([requestOverpass(buildingQuery), requestOverpass(placeQuery)]);
    return Response.json({ buildings: buildings.elements || [], places: places.elements || [] }, { headers: { "Cache-Control": "public, max-age=180, s-maxage=600" } });
  } catch {
    return Response.json({ buildings: [], places: [] }, { status: 502 });
  }
}
