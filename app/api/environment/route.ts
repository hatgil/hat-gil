type P = [number, number];
type Payload = { buildings: unknown[]; places: unknown[] };

const memoryCache = new Map<string, { expires: number; payload: Payload }>();

const safeCoordinate = (value: string | null): P | null => {
  if (!value) return null;
  const [lat, lon] = value.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 34 || lat > 36 || lon < 128 || lon > 130.5) return null;
  return [lat, lon];
};

const requestOverpass = async (query: string) => {
  const endpoints = ["https://overpass.osm.ch/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter"];
  const controllers: AbortController[] = [];
  const requestOne = async (endpoint: string) => {
    const controller = new AbortController();
    controllers.push(controller);
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(endpoint, {
        method: "POST", body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok) throw new Error("Overpass response failed");
      return await response.json() as { elements?: unknown[] };
    } catch (error) { throw error; }
    finally { clearTimeout(timeout); }
  };
  try {
    const result = await Promise.any(endpoints.map(requestOne));
    controllers.forEach(controller => controller.abort());
    return result;
  } catch {
    controllers.forEach(controller => controller.abort());
    return { elements: [] };
  }
};

const loadEnvironment = async (from: P, to: P): Promise<Payload> => {
  const middle: P = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const samples = [from, middle, to], ends = [from, to];
  const around = (points: P[], filter: string, radius: number) => points.map(point => `${filter}(around:${radius},${point[0]},${point[1]});`).join("");
  const buildingQuery = `[out:json][timeout:12];(${around(samples, 'way["building"]', 430)});out tags geom;`;
  const placeQuery = `[out:json][timeout:12];(${around(samples, 'nwr["name"]["amenity"]', 520)}${around(samples, 'nwr["name"]["tourism"]', 520)}${around(samples, 'nwr["name"]["leisure"]', 520)}${around(samples, 'nwr["name"]["shop"]', 520)}${around(ends, 'nwr["highway"="bus_stop"]', 1400)}${around(ends, 'nwr["railway"="station"]', 2600)}${around(ends, 'nwr["station"="subway"]', 2600)});out tags center;`;
  const [buildings, places] = await Promise.all([requestOverpass(buildingQuery), requestOverpass(placeQuery)]);
  return { buildings: buildings.elements || [], places: places.elements || [] };
};

export async function GET(request: Request) {
  const url = new URL(request.url), from = safeCoordinate(url.searchParams.get("from")), to = safeCoordinate(url.searchParams.get("to"));
  if (!from || !to) return Response.json({ error: "잘못된 좌표입니다." }, { status: 400 });
  const key = `${from.map(value => value.toFixed(4)).join(",")}:${to.map(value => value.toFixed(4)).join(",")}`;
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) return Response.json(cached.payload, { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400", "X-Data-Cache": "HIT" } });
  try {
    const payload = await loadEnvironment(from, to);
    memoryCache.set(key, { expires: Date.now() + 30 * 60 * 1000, payload });
    return Response.json(payload, { headers: { "Cache-Control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400", "X-Data-Cache": "MISS" } });
  } catch {
    return Response.json({ buildings: [], places: [] }, { status: 502 });
  }
}
