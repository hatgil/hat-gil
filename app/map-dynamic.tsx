"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

declare global { interface Window { L: any } }

type P = [number, number];
type K = "uv" | "wind" | "fog" | "crowd" | "facility" | "shade" | "temp";
type ProfileKey = "night" | "balanced" | "shadeWind";

const tools: [K, string, string][] = [
  ["uv", "☀", "자외선"], ["wind", "≋", "해풍·빌딩풍"], ["fog", "〰", "해무"],
  ["crowd", "♟", "밀집도"], ["facility", "⌂", "시설물"], ["shade", "▧", "건물 그늘"], ["temp", "♨", "온도"],
];

const known: Record<string, P> = {
  미포항: [35.1595, 129.1707], 청사포다릿돌전망대: [35.1607, 129.1907],
  해운대역: [35.1631, 129.1588], 달맞이길: [35.1642, 129.1788],
};

const profileForHour = (hour: number): { key: ProfileKey; title: string; detail: string; color: string } => {
  if (hour <= 6 || hour >= 20) return {
    key: "night", title: "야간 안전 경로", color: "#3159b8",
    detail: "조명이 밝고 통행이 안정적인 길을 우선해 안내합니다.",
  };
  if (hour >= 13 && hour <= 16) return {
    key: "shadeWind", title: "그늘·해풍 우선 경로", color: "#208d62",
    detail: "건물 그늘의 방향·범위와 해풍을 따라 더 시원한 길을 우선합니다.",
  };
  return {
    key: "balanced", title: "쾌적 균형 경로", color: "#00a4c4",
    detail: "그늘·바람·온도·밀집도를 고르게 반영한 길을 안내합니다.",
  };
};

const shadowVector = (hour: number) => {
  const daylight = hour >= 7 && hour <= 19;
  const daylightHour = Math.min(19, Math.max(7, hour));
  const sunAzimuth = 90 + (daylightHour - 7) / 12 * 180;
  const shadowBearing = (sunAzimuth + 180) % 360;
  const radians = shadowBearing * Math.PI / 180;
  const shadowMeters = daylight ? 65 + Math.abs(hour - 13) * 18 : 20;
  return {
    lat: Math.cos(radians) * shadowMeters / 111000,
    lon: Math.sin(radians) * shadowMeters / 91000,
    meters: shadowMeters,
  };
};

const optimizedRoute = async (from: P, to: P, hour: number): Promise<P[]> => {
  const profile = profileForHour(hour), shadow = shadowVector(hour);
  const latSpan = to[0] - from[0], lonSpan = to[1] - from[1];
  const length = Math.max(.0001, Math.hypot(latSpan, lonSpan));
  const perpLat = -lonSpan / length, perpLon = latSpan / length;
  const sunlight = Math.max(0, Math.sin((hour - 7) / 12 * Math.PI));
  const seaBreeze = 2.1 + hour * .13;
  const crowdLoad = hour >= 17 && hour <= 19 ? 76 : hour >= 11 && hour <= 16 ? 55 : 28;
  const hourlyPulse = Math.sin((hour + 1) * Math.PI / 6);
  const profileBend = profile.key === "night" ? -.00315 : profile.key === "shadeWind" ? .00345 : .00115;
  const environmentBend = profile.key === "night"
    ? -(1 - crowdLoad / 100) * .00045 + hourlyPulse * .00022
    : profile.key === "shadeWind"
      ? sunlight * .00062 + (seaBreeze - 2.1) * .00005 + hourlyPulse * .00016
      : (sunlight - .45) * .00038 - crowdLoad * .000002 + hourlyPulse * .0002;
  const bend = profileBend + environmentBend;
  const shadeWeight = profile.key === "shadeWind" ? 1.8 : profile.key === "balanced" ? .35 : 0;
  const ratioShift = .035 * Math.sin(hour * Math.PI / 12);
  const via1: P = [
    from[0] + latSpan * (.34 + ratioShift) + perpLat * bend * .82 + shadow.lat * shadeWeight,
    from[1] + lonSpan * (.34 + ratioShift) + perpLon * bend * .82 + shadow.lon * shadeWeight,
  ];
  const via2: P = [
    from[0] + latSpan * (.68 - ratioShift) + perpLat * bend * 1.05 + shadow.lat * shadeWeight * .72,
    from[1] + lonSpan * (.68 - ratioShift) + perpLon * bend * 1.05 + shadow.lon * shadeWeight * .72,
  ];

  try {
    const coordinates = [from, via1, via2, to].map(p => `${p[1]},${p[0]}`).join(";");
    const result = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson`).then(r => r.json());
    if (result.routes?.[0]?.geometry?.coordinates) {
      return result.routes[0].geometry.coordinates.map((point: number[]): P => [point[1], point[0]]);
    }
  } catch { /* 직선 보간 경로로 안전하게 대체 */ }
  return [from, via1, via2, to];
};

const corridorPoints = (route: P[]) => {
  if (!route.length) return [] as { point: P; ring: number; seed: number }[];
  const step = Math.max(1, Math.floor(route.length / 12));
  const centers = route.filter((_, index) => index % step === 0).slice(0, 13);
  if (route.length > 1 && centers[centers.length - 1] !== route[route.length - 1]) centers.push(route[route.length - 1]);
  const offsets: [number, number, number][] = [
    [0, 0, 0], [.0045, 0, 500], [-.0045, 0, 500], [0, .0055, 500], [0, -.0055, 500],
    [.0058, .0064, 850], [.0058, -.0064, 850], [-.0058, .0064, 850], [-.0058, -.0064, 850],
    [.0081, 0, 900], [-.0081, 0, 900], [0, .0098, 900], [0, -.0098, 900],
  ];
  const unique = new Map<string, { point: P; ring: number; seed: number }>();
  centers.forEach((center, centerIndex) => offsets.forEach(([lat, lon, ring], offsetIndex) => {
    const point: P = [center[0] + lat, center[1] + lon];
    const key = `${point[0].toFixed(4)}:${point[1].toFixed(4)}`;
    if (!unique.has(key)) unique.set(key, { point, ring, seed: centerIndex * 13 + offsetIndex });
  }));
  return [...unique.values()];
};

export default function DynamicMap() {
  const node = useRef<HTMLDivElement>(null), map = useRef<any>(), path = useRef<any>();
  const marks = useRef<any[]>([]), env = useRef<any[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [start, setStart] = useState("미포항"), [end, setEnd] = useState("청사포 다릿돌전망대");
  const [anchors, setAnchors] = useState<[P, P]>([known.미포항, known.청사포다릿돌전망대]);
  const [route, setRoute] = useState<P[]>([known.미포항, known.청사포다릿돌전망대]);
  const [active, setActive] = useState<K[]>(["wind", "shade"]), [hour, setHour] = useState(14);
  const [panel, setPanel] = useState(true), [status, setStatus] = useState("장소를 입력하고 경로 찾기를 누르세요."), [loading, setLoading] = useState(false);
  const profile = profileForHour(hour);
  const uv = Math.max(0, 8 - Math.abs(hour - 13) * 2);
  const temp = Math.round(23 + 7 * Math.sin((hour - 7) / 24 * Math.PI * 2));
  const fog = Math.max(12, Math.round(72 - 3 * hour + 18 * Math.cos(hour / 3)));
  const crowd = hour >= 17 && hour <= 19 ? 76 : hour >= 11 && hour <= 16 ? 55 : 28;
  const shadow = shadowVector(hour);
  const environmentPoints = useMemo(() => corridorPoints(route), [route]);

  useEffect(() => {
    const init = () => {
      const L = window.L;
      if (!L || !node.current || map.current) return;
      map.current = L.map(node.current).setView([35.16, 129.18], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map.current);
      setMapReady(true);
    };
    if (window.L) init();
    else {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
      const script = document.createElement("script"); script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; script.onload = init; document.head.appendChild(script);
    }
    return () => { map.current?.remove(); map.current = undefined; };
  }, []);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    if (path.current) path.current.remove();
    path.current = window.L.polyline(route, { color: profile.color, weight: 9, opacity: .96 }).addTo(map.current);
    const visiblePoints = active.length && environmentPoints.length ? environmentPoints.map(item => item.point) : route;
    map.current.fitBounds(window.L.latLngBounds(visiblePoints), { padding: [55, 55] });
  }, [mapReady, route, profile.color, environmentPoints, active.length]);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    marks.current.forEach(marker => marker.remove());
    const L = window.L;
    marks.current = [
      L.marker(anchors[0]).addTo(map.current).bindPopup(`출발: ${start}`),
      L.marker(anchors[1]).addTo(map.current).bindPopup(`도착: ${end}`),
    ];
  }, [mapReady, anchors]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const nextRoute = await optimizedRoute(anchors[0], anchors[1], hour);
      if (cancelled) return;
      setRoute(nextRoute);
      setStatus(`${String(hour).padStart(2, "0")}시 ${profile.title}로 환경값을 반영해 다시 계산했습니다.`);
      setLoading(false);
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [anchors, hour, profile.title]);

  useEffect(() => {
    env.current.forEach(layer => layer.remove()); env.current = [];
    if (!mapReady || !map.current) return;
    const L = window.L, add = (layer: any) => env.current.push(layer.addTo(map.current));
    const buildingPoints = environmentPoints.filter((_, index) => index % 2 === 0);
    const generalPoints = environmentPoints.filter((_, index) => index % 4 === 0);
    const sparsePoints = environmentPoints.filter((_, index) => index % 7 === 0);

    if (active.length) {
      route.filter((_, index) => index % Math.max(1, Math.floor(route.length / 3)) === 0).slice(0, 4)
        .forEach(point => add(L.circle(point, { radius: 1000, color: "#5d8d99", fillColor: "#dff4f2", fillOpacity: .025, opacity: .28, weight: 1, dashArray: "6 8", interactive: false })));
    }
    if (active.includes("shade")) buildingPoints.forEach(({ point }, index) => {
      const width = .00018 + index % 3 * .00004;
      add(L.polygon([
        [point[0] - width, point[1] - width], [point[0] + width, point[1] + width],
        [point[0] + shadow.lat + width, point[1] + shadow.lon + width], [point[0] + shadow.lat - width, point[1] + shadow.lon - width],
      ], { color: "#42208e", fillColor: "#7148d7", fillOpacity: hour >= 7 && hour <= 19 ? .48 : .2, weight: 2, dashArray: "5 3" }));
    });
    if (active.includes("fog")) sparsePoints.forEach(({ point, ring }) => add(L.circle(point, { radius: ring ? 155 : 125, color: "#087f9d", fillColor: "#9de3ec", fillOpacity: fog / 150 + .14, weight: 3, dashArray: "10 6" })));
    if (active.includes("wind")) generalPoints.forEach(({ point, seed }) => {
      const sea = 2.1 + hour * .13, building = 4.3 + seed % 3 + hour * .08;
      const waves = (className: string, direction: number, speed: number, duration: number) => `<div class="windMotion ${className}" style="--dir:${direction}deg;--dur:${duration}s"><span>≋</span><span>≋</span><span>≋</span><small>${speed.toFixed(1)}m/s</small></div>`;
      add(L.marker([point[0] + .00045, point[1] - .00045], { icon: L.divIcon({ className: "windAnchor", html: waves("seaFlow", (110 + hour * 13) % 360, sea, Math.max(.45, 1.8 - sea * .15)) }) }));
      add(L.marker([point[0] - .00045, point[1] + .00045], { icon: L.divIcon({ className: "windAnchor", html: waves("buildingFlow", (35 + hour * 17 + seed * 19) % 360, building, Math.max(.28, 1.6 - building * .14)) }) }));
    });
    if (active.includes("uv")) generalPoints.forEach(({ point, ring }) => add(L.circle(point, { radius: ring ? 120 : 100, color: "#e37d00", fillColor: "#ffd438", fillOpacity: uv / 20 + .12, weight: 3 })));
    if (active.includes("crowd")) generalPoints.forEach(({ point, seed }) => add(L.marker(point, { icon: L.divIcon({ className: "crowdMark", html: `♟<b style="font-size:${18 + crowd / 5 + seed % 5}px">♟</b>` }) })));
    if (active.includes("facility")) sparsePoints.forEach(({ point, seed }) => add(L.marker(point, { icon: L.divIcon({ className: "facilityMark", html: ["WC", "쉼", "편", "P"][seed % 4] }) })));
    if (active.includes("temp")) generalPoints.forEach(({ point, seed }) => add(L.marker(point, { icon: L.divIcon({ className: "tempMark", html: `${temp + seed % 3 - 1}°` }) })));
    path.current?.bringToFront();
  }, [active, hour, environmentPoints, fog, crowd, temp, uv, shadow.lat, shadow.lon, mapReady, route]);

  const locate = async (name: string): Promise<P | null> => {
    const key = name.replaceAll(" ", "");
    if (known[key]) return known[key];
    const results = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&q=${encodeURIComponent(name + ", 부산")}`).then(response => response.json());
    return results[0] ? [+results[0].lat, +results[0].lon] : null;
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!start.trim() || !end.trim()) return setStatus("두 장소를 모두 입력해 주세요.");
    if (/바다|해상|동해/.test(end)) return setStatus("도착지는 육지 장소로 입력해 주세요.");
    setLoading(true); setStatus("입력한 장소와 시간대의 최적 보행 경로를 계산 중입니다…");
    try {
      const [from, to] = await Promise.all([locate(start), locate(end)]);
      if (!from || !to) throw Error("장소를 찾지 못했습니다.");
      setAnchors([from, to]);
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : "경로 계산 실패"} 장소명을 더 구체적으로 입력해 주세요.`);
      setLoading(false);
    }
  };

  const toggle = (kind: K) => setActive(active.includes(kind) ? active.filter(value => value !== kind) : [...active, kind]);

  return <main>
    <header><b>〰 바닷길</b><span>입력 장소 기반 경로</span></header>
    <div ref={node} id="map" />
    <section className="controls">
      <form className="inputs" onSubmit={search}>
        <input aria-label="출발지" value={start} onChange={event => setStart(event.target.value)} placeholder="출발지" />
        <b>→</b>
        <input aria-label="도착지" value={end} onChange={event => setEnd(event.target.value)} placeholder="도착지" />
        <button disabled={loading}>{loading ? "계산 중…" : "경로 찾기"}</button>
      </form>
      <div className="buttons">{tools.map(([kind, icon, name]) => <button type="button" key={kind} className={active.includes(kind) ? "on" : ""} onClick={() => toggle(kind)}><i>{icon}</i>{name}</button>)}</div>
      <p className="routeStatus">{status}</p>
    </section>
    {panel ? <aside>
      <button className="panelClose" aria-label="시간대별 예측 최소화" onClick={() => setPanel(false)}>×</button>
      <b>시간대별 예측</b>
      <input aria-label="예측 시간" type="range" min="0" max="23" value={hour} onChange={event => setHour(+event.target.value)} />
      <strong>{String(hour).padStart(2, "0")}:00</strong><span>태양 고도 {hour >= 7 && hour <= 19 ? Math.max(4, 63 - Math.abs(hour - 12) * 9) : 0}°</span>
      <div className="metrics"><p><i className="yellow" />UV {uv}</p><p><i className="blue" />해풍 {(2.1 + hour * .13).toFixed(1)}</p><p><i className="orange" />빌딩풍 {(4.3 + hour * .08).toFixed(1)}</p><p><i className="cyan" />해무 {fog}%</p><p><i className="pink" />밀집도 {crowd}%</p><p><i className="red" />온도 {temp}°</p></div>
    </aside> : <button className="panelOpen" onClick={() => setPanel(true)}>시간대별 예측 열기</button>}
    <div className={`routeInfo ${profile.key}`}>
      <b>{profile.title}</b><span>{profile.detail}</span>
      <small>출발·도착 고정 · 환경 레이어는 경로 주변 500m~1km까지 함께 갱신</small>
    </div>
    <div className="legend"><b>환경 표시 범위</b><span>점선 영역: 경로 주변 최대 1km</span><span><i className="blue" />해풍</span><span><i className="orange" />빌딩풍</span></div>
  </main>;
}
