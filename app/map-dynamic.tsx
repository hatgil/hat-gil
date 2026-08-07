"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

declare global { interface Window { L: any } }

type P = [number, number];
type K = "uv" | "wind" | "fog" | "crowd" | "facility" | "shade" | "temp";
type ProfileKey = "night" | "balanced" | "shadeWind";
type HourWeather = {
  time: string;
  temperature: number;
  apparent: number;
  humidity: number;
  fog: number;
  windSpeed: number;
  windDirection: number;
  radiation: number;
  uv: number;
  visibility: number;
};
type WeatherData = {
  hours: HourWeather[];
  sunrise: string;
  sunset: string;
  source: string;
  sourceDetail: string;
  fetchedAt: string;
  isKma: boolean;
};
type Building = { id: string; name: string; polygon: P[]; height: number };
type Place = {
  id: string;
  name: string;
  category: string;
  road: string;
  point: P;
  image?: string;
  address?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  operator?: string;
  wheelchair?: string;
  description?: string;
  seed: number;
};
type EnvironmentData = { buildings: Building[]; places: Place[] };

const layerTools: [K, string, string][] = [
  ["uv", "☀", "자외선"], ["wind", "≋", "해풍·빌딩풍"], ["fog", "〰", "해무"],
  ["crowd", "♟", "밀집도"], ["facility", "⌂", "시설물"], ["shade", "▧", "건물 그늘"], ["temp", "♨", "온도"],
];

const known: Record<string, P> = {
  미포항: [35.1595, 129.1707], 청사포다릿돌전망대: [35.1607, 129.1907],
  해운대역: [35.1631, 129.1588], 달맞이길: [35.1642, 129.1788],
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const numeric = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const dateAfter = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateKey(date);
};
const formatDate = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  year: "numeric", month: "long", day: "numeric", weekday: "short",
}).format(new Date(`${value}T12:00:00`));
const formatClock = (value?: string) => value?.split("T")[1]?.slice(0, 5) || "--:--";
const kakaoRoadview = (point: P) => `https://map.kakao.com/link/roadview/${point[0]},${point[1]}`;
const distanceKm = (from: P, to: P) => {
  const lat = (from[0] + to[0]) / 2 * Math.PI / 180;
  const north = (to[0] - from[0]) * 111.32;
  const east = (to[1] - from[1]) * 111.32 * Math.cos(lat);
  return Math.hypot(north, east);
};
const routeDistanceKm = (points: P[]) => points.slice(1).reduce((total, point, index) => total + distanceKm(points[index], point), 0);

const profileForHour = (hour: number): { key: ProfileKey; title: string; detail: string; color: string } => {
  if (hour <= 6 || hour >= 20) return {
    key: "night", title: "야간 안전 경로", color: "#3159b8",
    detail: "조명이 밝고 통행이 안정적인 길을 우선해 안내합니다.",
  };
  if (hour >= 13 && hour <= 16) return {
    key: "shadeWind", title: "그늘·해풍 우선 경로", color: "#208d62",
    detail: "실제 건물 그늘의 방향·범위와 해풍을 따라 더 시원한 길을 우선합니다.",
  };
  return {
    key: "balanced", title: "쾌적 균형 경로", color: "#00a4c4",
    detail: "그늘·바람·온도·밀집도를 고르게 반영한 길을 안내합니다.",
  };
};

const solarPosition = (date: string, hour: number, lat: number, lon: number) => {
  const instant = new Date(`${date}T${String(hour).padStart(2, "0")}:30:00+09:00`);
  const julian = instant.getTime() / 86400000 + 2440587.5;
  const days = julian - 2451545;
  const meanLongitude = (280.46 + .9856474 * days) % 360;
  const meanAnomaly = (357.528 + .9856003 * days) * Math.PI / 180;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + .02 * Math.sin(2 * meanAnomaly)) * Math.PI / 180;
  const obliquity = (23.439 - .0000004 * days) * Math.PI / 180;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const gmst = (280.46061837 + 360.98564736629 * (julian - 2451545)) % 360;
  let hourAngle = (gmst + lon) * Math.PI / 180 - rightAscension;
  while (hourAngle > Math.PI) hourAngle -= Math.PI * 2;
  while (hourAngle < -Math.PI) hourAngle += Math.PI * 2;
  const latitude = lat * Math.PI / 180;
  const elevation = Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  const azimuth = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude));
  return { elevation: Math.max(0, elevation * 180 / Math.PI), azimuth: (azimuth * 180 / Math.PI + 180 + 360) % 360 };
};

const shadowFor = (height: number, sun: { elevation: number; azimuth: number }) => {
  if (sun.elevation <= 1) return { lat: 0, lon: 0, meters: 0 };
  const meters = clamp(height / Math.tan(sun.elevation * Math.PI / 180), 2, 140);
  const bearing = (sun.azimuth + 180) % 360;
  const radians = bearing * Math.PI / 180;
  return { lat: Math.cos(radians) * meters / 111000, lon: Math.sin(radians) * meters / 91000, meters };
};

const convexHull = (points: P[]) => {
  const sorted = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (sorted.length <= 3) return sorted;
  const cross = (o: P, a: P, b: P) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower: P[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: P[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
};

const routeWaypoints = (from: P, to: P, hour: number): P[] => {
  const profile = profileForHour(hour);
  const latSpan = to[0] - from[0], lonSpan = to[1] - from[1];
  const length = Math.max(.0001, Math.hypot(latSpan, lonSpan));
  const perpLat = -lonSpan / length, perpLon = latSpan / length;
  const sunlight = Math.max(0, Math.sin((hour - 7) / 12 * Math.PI));
  const crowdLoad = hour >= 17 && hour <= 19 ? 76 : hour >= 11 && hour <= 16 ? 55 : 28;
  const hourlyPulse = Math.sin((hour + 1) * Math.PI / 6);
  const profileBend = profile.key === "night" ? -.00315 : profile.key === "shadeWind" ? .00345 : .00115;
  const environmentBend = profile.key === "night"
    ? -(1 - crowdLoad / 100) * .00045 + hourlyPulse * .00022
    : profile.key === "shadeWind"
      ? sunlight * .00062 + hour * .000006 + hourlyPulse * .00016
      : (sunlight - .45) * .00038 - crowdLoad * .000002 + hourlyPulse * .0002;
  const bend = profileBend + environmentBend;
  const ratioShift = .035 * Math.sin(hour * Math.PI / 12);
  return [
    from,
    [from[0] + latSpan * (.34 + ratioShift) + perpLat * bend * .82, from[1] + lonSpan * (.34 + ratioShift) + perpLon * bend * .82],
    [from[0] + latSpan * (.68 - ratioShift) + perpLat * bend * 1.05, from[1] + lonSpan * (.68 - ratioShift) + perpLon * bend * 1.05],
    to,
  ];
};

const resampleRoute = (points: P[], count = 65): P[] => {
  if (points.length < 2) return points;
  const distances = [0];
  for (let index = 1; index < points.length; index++) distances.push(distances[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
  const total = distances[distances.length - 1];
  if (!total) return Array.from({ length: count }, () => points[0]);
  return Array.from({ length: count }, (_, index): P => {
    const target = total * index / (count - 1);
    let segment = 1;
    while (segment < distances.length - 1 && distances[segment] < target) segment++;
    const startDistance = distances[segment - 1], endDistance = distances[segment];
    const ratio = endDistance === startDistance ? 0 : (target - startDistance) / (endDistance - startDistance);
    return [points[segment - 1][0] + (points[segment][0] - points[segment - 1][0]) * ratio, points[segment - 1][1] + (points[segment][1] - points[segment - 1][1]) * ratio];
  });
};

const fetchWalkingRoute = async (from: P, to: P, hour: number, signal: AbortSignal): Promise<P[]> => {
  const request = async (points: P[]) => {
    const coordinates = points.map(point => `${point[1]},${point[0]}`).join(";");
    const response = await fetch(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson`, { signal });
    if (!response.ok) return null;
    const result = await response.json();
    const coordinatesOnFoot = result.routes?.[0]?.geometry?.coordinates;
    return coordinatesOnFoot ? resampleRoute(coordinatesOnFoot.map((point: number[]): P => [point[1], point[0]])) : null;
  };
  return await request(routeWaypoints(from, to, hour)) || await request([from, to]) || Promise.reject(new Error("보도 경로를 불러오지 못했습니다."));
};

const corridorPoints = (route: P[]) => {
  if (!route.length) return [] as { point: P; ring: number; seed: number }[];
  const step = Math.max(1, Math.floor(route.length / 12));
  const centers = route.filter((_, index) => index % step === 0).slice(0, 13);
  const offsets: [number, number, number][] = [
    [0, 0, 0], [.0025, 0, 280], [-.0025, 0, 280], [0, .0031, 280], [0, -.0031, 280],
    [.0031, .0036, 480], [.0031, -.0036, 480], [-.0031, .0036, 480], [-.0031, -.0036, 480],
  ];
  const unique = new Map<string, { point: P; ring: number; seed: number }>();
  centers.forEach((center, centerIndex) => offsets.forEach(([lat, lon, ring], offsetIndex) => {
    const point: P = [center[0] + lat, center[1] + lon];
    const key = `${point[0].toFixed(4)}:${point[1].toFixed(4)}`;
    if (!unique.has(key)) unique.set(key, { point, ring, seed: centerIndex * 9 + offsetIndex });
  }));
  return [...unique.values()];
};

const parseHeight = (tags: Record<string, string> = {}) => {
  const explicit = Number.parseFloat(tags.height || "");
  if (Number.isFinite(explicit)) return clamp(explicit, 3, 100);
  const levels = Number.parseFloat(tags["building:levels"] || "");
  return Number.isFinite(levels) ? clamp(levels * 3.2, 3, 100) : 10;
};

const placeCategory = (tags: Record<string, string> = {}) => {
  if (tags.amenity) return ({ toilets: "화장실", cafe: "카페", restaurant: "음식점", parking: "주차장", shelter: "쉼터" } as Record<string, string>)[tags.amenity] || "생활시설";
  if (tags.tourism) return ({ viewpoint: "전망대", attraction: "관광명소", hotel: "숙박시설" } as Record<string, string>)[tags.tourism] || "관광시설";
  if (tags.leisure) return "여가시설";
  if (tags.shop) return "상점";
  if (tags.highway) return "도로·보행로";
  return "주변 시설";
};

const commonsImage = (tags: Record<string, string> = {}) => {
  const direct = tags.image || "";
  if (/^https?:\/\//.test(direct) && /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(direct) && !/document|scan|pdf/i.test(direct)) return direct;
  const file = (tags.wikimedia_commons || "").replace(/^File:/, "");
  return /\.(?:jpe?g|png|webp)$/i.test(file) && !/document|scan|pdf/i.test(file)
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=640`
    : undefined;
};

const crowdScore = (place: Place, hour: number) => {
  const peak = hour >= 17 && hour <= 20 ? 24 : hour >= 11 && hour <= 16 ? 16 : hour <= 6 ? -18 : 4;
  const category = /관광|전망/.test(place.category) ? 18 : /카페|음식|상점/.test(place.category) ? 12 : /도로/.test(place.category) ? 6 : 2;
  return clamp(28 + peak + category + place.seed % 17, 8, 96);
};

const fetchEnvironmentFeatures = async (anchors: [P, P], signal: AbortSignal): Promise<EnvironmentData> => {
  const params = new URLSearchParams({ from: anchors[0].join(","), to: anchors[1].join(",") });
  const response = await fetch(`/api/environment?${params}`, { signal });
  if (!response.ok) throw new Error("주변 지도 데이터 연결에 실패했습니다.");
  const payload = await response.json();
  const buildingPayload: any = { elements: payload.buildings || [] };
  const placePayload: any = { elements: payload.places || [] };
  const buildings: Building[] = [], places: Place[] = [];
  const placeNames = new Set<string>();

  for (const element of buildingPayload.elements || []) {
    const tags = element.tags || {};
    if (!tags.building || !Array.isArray(element.geometry)) continue;
    const polygon = element.geometry.map((point: { lat: number; lon: number }): P => [point.lat, point.lon]);
    if (polygon.length >= 3) buildings.push({ id: String(element.id), name: tags.name || "이름 없는 건물", polygon, height: parseHeight(tags) });
  }

  for (const element of placePayload.elements || []) {
    const tags = element.tags || {};
    const lat = numeric(element.lat, numeric(element.center?.lat, NaN));
    const lon = numeric(element.lon, numeric(element.center?.lon, NaN));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!tags.name || placeNames.has(`${tags.name}:${tags.amenity || tags.tourism || tags.shop || ""}`)) continue;
    placeNames.add(`${tags.name}:${tags.amenity || tags.tourism || tags.shop || ""}`);
    places.push({
      id: String(element.id), name: tags.name, category: placeCategory(tags), road: tags["addr:street"] || "주변 보행 구간", point: [lat, lon],
      image: commonsImage(tags), address: [tags["addr:city"], tags["addr:district"], tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ") || undefined,
      openingHours: tags.opening_hours, phone: tags.phone || tags["contact:phone"], website: tags.website || tags["contact:website"],
      operator: tags.operator, wheelchair: tags.wheelchair, description: tags.description, seed: Number(element.id) % 97,
    });
  }
  if (!buildings.length && !places.length) throw new Error("주변 건물·시설 데이터가 없습니다.");
  return { buildings: buildings.slice(0, 420), places: places.slice(0, 160) };
};

const parseWeather = (payload: any, selectedDate: string, source: string, sourceDetail: string, isKma: boolean): WeatherData | null => {
  const hourly = payload?.hourly;
  if (!hourly?.time?.length) return null;
  const indexes = hourly.time.map((time: string, index: number) => time.startsWith(selectedDate) ? index : -1).filter((index: number) => index >= 0);
  const hasValues = indexes.some((index: number) => hourly.temperature_2m?.[index] != null);
  if (!hasValues) return null;
  const hours = indexes.map((index: number): HourWeather => {
    const humidity = numeric(hourly.relative_humidity_2m?.[index], 70);
    const lowCloud = numeric(hourly.cloud_cover_low?.[index], numeric(hourly.cloud_cover?.[index], 35));
    const visibility = numeric(hourly.visibility?.[index], 10000);
    const windSpeed = numeric(hourly.wind_speed_10m?.[index], 2.5);
    return {
      time: hourly.time[index], temperature: numeric(hourly.temperature_2m?.[index], 24), apparent: numeric(hourly.apparent_temperature?.[index], numeric(hourly.temperature_2m?.[index], 24)),
      humidity, fog: clamp(Math.round(humidity * .5 + lowCloud * .32 + (visibility < 4000 ? 18 : 0) - windSpeed * 1.8), 3, 100),
      windSpeed, windDirection: numeric(hourly.wind_direction_10m?.[index], 180), radiation: numeric(hourly.shortwave_radiation?.[index], 0),
      uv: numeric(hourly.uv_index?.[index], 0), visibility,
    };
  });
  const dayIndex = payload.daily?.time?.findIndex((time: string) => time === selectedDate) ?? -1;
  return {
    hours, sunrise: dayIndex >= 0 ? payload.daily.sunrise?.[dayIndex] : "", sunset: dayIndex >= 0 ? payload.daily.sunset?.[dayIndex] : "",
    source, sourceDetail, isKma, fetchedAt: new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date()),
  };
};

const fetchWeather = async (point: P, selectedDate: string, signal: AbortSignal): Promise<WeatherData> => {
  const fields = "temperature_2m,apparent_temperature,relative_humidity_2m,cloud_cover_low,wind_speed_10m,wind_direction_10m,shortwave_radiation,visibility,uv_index";
  const base = `https://api.open-meteo.com/v1/forecast?latitude=${point[0]}&longitude=${point[1]}&hourly=${fields}&daily=sunrise,sunset&timezone=Asia%2FSeoul&start_date=${selectedDate}&end_date=${selectedDate}&wind_speed_unit=ms`;
  try {
    const kmaPayload = await fetch(`${base}&models=kma_seamless`, { signal }).then(response => response.ok ? response.json() : null);
    const kma = parseWeather(kmaPayload, selectedDate, "기상청 KMA 예보모델", "KMA LDPS·GDPS 원자료를 시간별로 변환", true);
    if (kma) return kma;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  const fallbackPayload = await fetch(base, { signal }).then(response => {
    if (!response.ok) throw new Error("날씨 데이터를 불러오지 못했습니다.");
    return response.json();
  });
  const fallback = parseWeather(fallbackPayload, selectedDate, "보완 예보 데이터", "KMA 원본 갱신 지연 시 자동 보완 · 수치는 예보값", false);
  if (!fallback) throw new Error("선택한 날짜의 예보가 없습니다.");
  return fallback;
};

export default function DynamicMap() {
  const node = useRef<HTMLDivElement>(null), map = useRef<any>(), path = useRef<any>(), pathHalo = useRef<any>();
  const marks = useRef<any[]>([]), env = useRef<any[]>([]), animationFrame = useRef<number>();
  const routeCache = useRef<Map<string, P[]>>(new Map());
  const environmentCache = useRef<Map<string, EnvironmentData>>(new Map());
  const fitOnNextRoute = useRef(true);
  const [mapReady, setMapReady] = useState(false);
  const [start, setStart] = useState("미포항"), [end, setEnd] = useState("청사포 다릿돌전망대");
  const [anchors, setAnchors] = useState<[P, P]>([known.미포항, known.청사포다릿돌전망대]);
  const [route, setRoute] = useState<P[]>([]);
  const routeRef = useRef<P[]>(route);
  const [active, setActive] = useState<K[]>(["wind", "shade"]), [hour, setHour] = useState(new Date().getHours());
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [weather, setWeather] = useState<WeatherData | null>(null), [weatherLoading, setWeatherLoading] = useState(true);
  const [buildings, setBuildings] = useState<Building[]>([]), [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null), [facilityPhoto, setFacilityPhoto] = useState<string | null>(null), [densityPhoto, setDensityPhoto] = useState<string | null>(null);
  const [facilityOpen, setFacilityOpen] = useState(true), [searchOpen, setSearchOpen] = useState(true), [legendOpen, setLegendOpen] = useState(true);
  const [densityOpen, setDensityOpen] = useState(true);
  const [featureStatus, setFeatureStatus] = useState("실제 건물·시설 확인 중…");
  const [panel, setPanel] = useState(true), [status, setStatus] = useState("장소를 입력하고 경로 찾기를 누르세요."), [loading, setLoading] = useState(false);
  const [layersOpen, setLayersOpen] = useState(true), [routeCardOpen, setRouteCardOpen] = useState(true);
  const profile = profileForHour(hour);
  const live = weather?.hours[hour] || { time: `${selectedDate}T${String(hour).padStart(2, "0")}:00`, temperature: 24, apparent: 25, humidity: 70, fog: 35, windSpeed: 2.5, windDirection: 180, radiation: 0, uv: 0, visibility: 10000 };
  const seaWind = live.windSpeed;
  const buildingWind = live.windSpeed * 1.45;
  const crowd = hour >= 17 && hour <= 19 ? 76 : hour >= 11 && hour <= 16 ? 55 : 28;
  const routeMiddle = route[Math.floor(route.length / 2)] || anchors[0];
  const sun = solarPosition(selectedDate, hour, routeMiddle[0], routeMiddle[1]);
  const environmentPoints = useMemo(() => corridorPoints(route), [route]);
  const allLayersActive = active.length === layerTools.length;
  const selectedPlace = useMemo(() => places.find(place => place.id === selectedPlaceId) || null, [places, selectedPlaceId]);
  const selectedCrowd = selectedPlace ? crowdScore(selectedPlace, hour) : 0;
  const selectedFacility = useMemo(() => places.find(place => place.id === selectedFacilityId) || null, [places, selectedFacilityId]);
  const walkMinutes = Math.max(1, Math.round(routeDistanceKm(route) / 4.5 * 60));

  useEffect(() => {
    const init = () => {
      const L = window.L;
      if (!L || !node.current || map.current) return;
      map.current = L.map(node.current, { zoomControl: true, scrollWheelZoom: true, dragging: true, doubleClickZoom: true, touchZoom: true, preferCanvas: true }).setView([35.16, 129.18], 14);
      const windPane = map.current.createPane("windPane"); windPane.style.zIndex = "390"; windPane.style.pointerEvents = "none";
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map.current);
      setMapReady(true);
    };
    if (window.L) init();
    else {
      const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(css);
      const script = document.createElement("script"); script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; script.onload = init; document.head.appendChild(script);
    }
    return () => { if (animationFrame.current) window.cancelAnimationFrame(animationFrame.current); map.current?.remove(); map.current = undefined; };
  }, []);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    if (!pathHalo.current) pathHalo.current = window.L.polyline(routeRef.current, { color: "#ffffff", weight: 15, opacity: .92, interactive: false }).addTo(map.current);
    if (!path.current) path.current = window.L.polyline(routeRef.current, { color: profile.color, weight: 9, opacity: 1 }).addTo(map.current);
  }, [mapReady]);

  useEffect(() => { path.current?.setStyle({ color: profile.color }); }, [profile.color]);

  useEffect(() => {
    if (!mapReady || !map.current || !route.length || !fitOnNextRoute.current) return;
    const leftPadding = searchOpen || layersOpen || routeCardOpen ? 372 : 64;
    const rightPadding = panel || legendOpen || selectedPlace || selectedFacility ? 346 : 64;
    map.current.fitBounds(window.L.latLngBounds(route), { paddingTopLeft: [leftPadding, 80], paddingBottomRight: [rightPadding, 80] });
    fitOnNextRoute.current = false;
  }, [mapReady, route, searchOpen, layersOpen, routeCardOpen, panel, legendOpen, selectedPlace, selectedFacility]);

  useEffect(() => {
    if (!mapReady || !map.current) return;
    marks.current.forEach(marker => marker.remove());
    const L = window.L;
    marks.current = [
      L.marker(anchors[0]).addTo(map.current).bindPopup(`<b>출발</b><br>${start}<br><a href="${kakaoRoadview(anchors[0])}" target="_blank" rel="noreferrer">카카오 로드뷰 보기</a>`),
      L.marker(anchors[1]).addTo(map.current).bindPopup(`<b>도착</b><br>${end}<br><a href="${kakaoRoadview(anchors[1])}" target="_blank" rel="noreferrer">카카오 로드뷰 보기</a>`),
    ];
  }, [mapReady, anchors, start, end]);

  useEffect(() => {
    const controller = new AbortController();
    const key = `${anchors[0].join(",")}:${anchors[1].join(",")}:${hour}`;
    const applyWalkingRoute = (nextRoute: P[]) => {
      if (animationFrame.current) window.cancelAnimationFrame(animationFrame.current);
      const previousRoute = routeRef.current.length > 1 ? resampleRoute(routeRef.current, nextRoute.length) : nextRoute;
      const startedAt = performance.now();
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / 180), eased = progress * progress * (3 - 2 * progress);
        const currentRoute = nextRoute.map((point, index): P => [previousRoute[index][0] + (point[0] - previousRoute[index][0]) * eased, previousRoute[index][1] + (point[1] - previousRoute[index][1]) * eased]);
        routeRef.current = currentRoute; pathHalo.current?.setLatLngs(currentRoute); path.current?.setLatLngs(currentRoute);
        if (progress < 1) animationFrame.current = window.requestAnimationFrame(animate);
        else { routeRef.current = nextRoute; setRoute(nextRoute); }
      };
      animationFrame.current = window.requestAnimationFrame(animate);
      setStatus(`${String(hour).padStart(2, "0")}시 ${profile.title}를 보도 경로에 맞춰 표시했습니다.`);
    };
    const timer = window.setTimeout(async () => {
      const cached = routeCache.current.get(key);
      if (cached) return applyWalkingRoute(cached);
      setStatus(`${String(hour).padStart(2, "0")}시 보도 기반 ${profile.title}를 계산 중입니다…`);
      try {
        const nextRoute = await fetchWalkingRoute(anchors[0], anchors[1], hour, controller.signal);
        if (!controller.signal.aborted) { routeCache.current.set(key, nextRoute); applyWalkingRoute(nextRoute); }
      } catch (error) {
        if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "보도 경로 계산에 실패했습니다.");
      }
    }, 90);
    return () => { controller.abort(); window.clearTimeout(timer); if (animationFrame.current) window.cancelAnimationFrame(animationFrame.current); };
  }, [anchors, hour, profile.title]);

  useEffect(() => {
    const controller = new AbortController();
    const key = anchors.flat().map(value => value.toFixed(4)).join(":");
    const apply = (data: EnvironmentData, cached = false) => {
      setBuildings(data.buildings); setPlaces(data.places);
      setFeatureStatus(`${cached ? "즉시 불러옴 · " : ""}경로 500m 내 실제 건물 ${data.buildings.length}곳 · 시설 ${data.places.length}곳`);
    };
    let cached = environmentCache.current.get(key);
    if (!cached) {
      try {
        const stored = window.sessionStorage.getItem(`geuneulon-env-v2:${key}`) || window.localStorage.getItem(`geuneulon-env-v2:${key}`);
        if (stored) { cached = JSON.parse(stored) as EnvironmentData; environmentCache.current.set(key, cached); }
      } catch { /* 저장 공간을 사용할 수 없으면 메모리 캐시만 사용 */ }
    }
    if (cached) { apply(cached, true); return () => controller.abort(); }
    setBuildings([]); setPlaces([]);
    setFeatureStatus("경로 주변 500m의 실제 건물 외곽선·시설 데이터를 불러오는 중…");
    fetchEnvironmentFeatures(anchors, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      environmentCache.current.set(key, data);
      try {
        const serialized = JSON.stringify(data);
        window.sessionStorage.setItem(`geuneulon-env-v2:${key}`, serialized);
        window.localStorage.setItem(`geuneulon-env-v2:${key}`, serialized);
      } catch { /* 큰 지도 데이터는 메모리 캐시로 유지 */ }
      apply(data);
    }).catch(() => {
      if (!controller.signal.aborted) setFeatureStatus("지도 데이터 갱신이 지연됩니다. 기존 표시를 유지합니다.");
    });
    return () => controller.abort();
  }, [anchors]);

  useEffect(() => {
    const controller = new AbortController();
    setWeatherLoading(true);
    fetchWeather([(anchors[0][0] + anchors[1][0]) / 2, (anchors[0][1] + anchors[1][1]) / 2], selectedDate, controller.signal)
      .then(data => { if (!controller.signal.aborted) { setWeather(data); setWeatherLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) { setWeather(null); setWeatherLoading(false); } });
    return () => controller.abort();
  }, [anchors, selectedDate]);

  useEffect(() => {
    if (!selectedFacility) { setFacilityPhoto(null); return; }
    setFacilityPhoto(selectedFacility.image || null);
  }, [selectedFacility]);

  useEffect(() => {
    if (!selectedPlace) { setDensityPhoto(null); return; }
    setDensityPhoto(selectedPlace.image || null);
  }, [selectedPlace]);

  useEffect(() => {
    env.current.forEach(layer => layer.remove()); env.current = [];
    if (!mapReady || !map.current) return;
    const L = window.L, add = (layer: any) => env.current.push(layer.addTo(map.current));
    const generalPoints = environmentPoints.filter((_, index) => index % 4 === 0);
    const sparsePoints = environmentPoints.filter((_, index) => index % 7 === 0);
    const windPoints = environmentPoints.filter((_, index) => index % 11 === 0);

    if (active.length) route.filter((_, index) => index % Math.max(1, Math.floor(route.length / 3)) === 0).slice(0, 4)
      .forEach(point => add(L.circle(point, { radius: 500, color: "#287b8c", fillColor: "#dff4f2", fillOpacity: .035, opacity: .62, weight: 2, dashArray: "9 7", interactive: false })));

    if (active.includes("shade") && sun.elevation > 1) buildings.forEach(building => {
      const shadow = shadowFor(building.height, sun);
      const shifted = building.polygon.map((point): P => [point[0] + shadow.lat, point[1] + shadow.lon]);
      const hull = convexHull([...building.polygon, ...shifted]);
      add(L.polygon(hull, { color: "#42208e", fillColor: "#7148d7", fillOpacity: .34, weight: 2, dashArray: "6 3", interactive: false }));
      add(L.polygon(building.polygon, { color: "#4b2b78", fillColor: "#8a70b8", fillOpacity: .18, weight: 1, interactive: false }));
    });
    if (active.includes("fog")) sparsePoints.forEach(({ point, ring }) => add(L.circle(point, { radius: ring ? 220 : 185, color: "#087f9d", fillColor: "#9de3ec", fillOpacity: live.fog / 165 + .1, weight: 3, dashArray: "10 6", interactive: false })));
    if (active.includes("wind")) windPoints.forEach(({ point, seed }) => {
      const waves = (className: string, direction: number, speed: number, duration: number) => `<div class="windMotion ${className}" style="--dir:${direction}deg;--dur:${duration}s"><span>≋</span><span>≋</span><span>≋</span><small>${speed.toFixed(1)}m/s</small></div>`;
      add(L.marker([point[0] + .00045, point[1] - .00045], { pane: "windPane", interactive: false, icon: L.divIcon({ className: "windAnchor", html: waves("seaFlow", live.windDirection, seaWind, Math.max(.45, 1.8 - seaWind * .15)) }) }));
      add(L.marker([point[0] - .00045, point[1] + .00045], { pane: "windPane", interactive: false, icon: L.divIcon({ className: "windAnchor", html: waves("buildingFlow", (live.windDirection + 25 + seed % 55) % 360, buildingWind, Math.max(.28, 1.6 - buildingWind * .14)) }) }));
    });
    if (active.includes("uv")) generalPoints.forEach(({ point, ring }) => add(L.circle(point, { radius: ring ? 180 : 150, color: "#e37d00", fillColor: "#ffd438", fillOpacity: live.uv / 24 + .1, weight: 3, interactive: false })));
    if (active.includes("crowd")) places.slice(0, 60).forEach(place => {
      const score = crowdScore(place, hour);
      const marker = L.marker(place.point, { icon: L.divIcon({ className: "crowdMark", html: `<span style="--crowd-size:${18 + score / 4}px">♟</span><b>${score}%</b>` }) });
      marker.on("click", () => { setSelectedFacilityId(null); setSelectedPlaceId(place.id); setDensityOpen(true); }); add(marker);
    });
    if (active.includes("facility")) places.slice(0, 60).forEach(place => {
      const marker = L.marker(place.point, { icon: L.divIcon({ className: "facilityMark", html: "⌂" }) });
      marker.bindTooltip(`${place.name} · ${place.category}`, { direction: "top" });
      marker.on("click", () => { setSelectedPlaceId(null); setSelectedFacilityId(place.id); setFacilityOpen(true); }); add(marker);
    });
    if (active.includes("temp")) generalPoints.forEach(({ point, seed }) => add(L.marker(point, { interactive: false, icon: L.divIcon({ className: "tempMark", html: `${(live.temperature + seed % 3 - 1).toFixed(1)}°` }) })));
    pathHalo.current?.bringToFront(); path.current?.bringToFront();
  }, [active, hour, environmentPoints, buildings, places, live.fog, live.uv, live.temperature, live.windDirection, seaWind, buildingWind, sun.elevation, sun.azimuth, mapReady, route]);

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
    setLoading(true); setStatus("입력한 장소와 시간대의 최적 보행 경로를 계산 중입니다…"); setSelectedPlaceId(null); setSelectedFacilityId(null);
    try {
      const [from, to] = await Promise.all([locate(start), locate(end)]);
      if (!from || !to) throw Error("장소를 찾지 못했습니다.");
      fitOnNextRoute.current = true; setAnchors([from, to]);
    } catch (error) {
      setStatus(`${error instanceof Error ? error.message : "경로 계산 실패"} 장소명을 더 구체적으로 입력해 주세요.`);
    } finally { setLoading(false); }
  };

  const toggle = (kind: K) => {
    setActive(active.includes(kind) ? active.filter(value => value !== kind) : [...active, kind]);
    if (kind === "crowd" && active.includes(kind)) setSelectedPlaceId(null);
    if (kind === "facility" && active.includes(kind)) setSelectedFacilityId(null);
  };

  return <main>
    <header><div className="brandBlock"><b>그늘온</b><small>그늘On, 온 데 그늘을 켜다</small></div><span>실제 건물 그늘 · 환경 반경 500m</span></header>
    <div ref={node} id="map" />
    <section className="controls">
      {searchOpen ? <div className="searchCard">
        <button type="button" className="boxMinimize searchMinimize" aria-label="장소 검색 최소화" onClick={() => setSearchOpen(false)}>−</button>
        <form className="inputs" onSubmit={search}>
          <input aria-label="출발지" value={start} onChange={event => setStart(event.target.value)} placeholder="출발지" />
          <b>→</b>
          <input aria-label="도착지" value={end} onChange={event => setEnd(event.target.value)} placeholder="도착지" />
          <button disabled={loading}>{loading ? "계산 중…" : "경로 찾기"}</button>
        </form>
        <div className="transportSummary"><strong>AI 보행 최적 경로</strong><span>예상 이동 시간 약 {walkMinutes}분</span></div>
        <p className="routeStatus" aria-live="polite">{status}</p>
      </div> : <button type="button" className="boxRestore searchRestore" onClick={() => setSearchOpen(true)}>장소 검색 열기</button>}
      {layersOpen ? <div className="buttons layerButtons">
        <button type="button" className="boxMinimize" aria-label="환경 데이터 최소화" onClick={() => setLayersOpen(false)}>−</button>
        {layerTools.map(([kind, icon, name]) => <button type="button" key={kind} aria-pressed={active.includes(kind)} className={active.includes(kind) ? "on" : ""} onClick={() => toggle(kind)}><i>{icon}</i>{name}</button>)}
        <button type="button" aria-pressed={allLayersActive} className={`layerAll ${allLayersActive ? "on" : ""}`} onClick={() => setActive(allLayersActive ? [] : layerTools.map(([kind]) => kind))}>◎ 전체 레이어</button>
      </div> : <button type="button" className="boxRestore layerRestore" onClick={() => setLayersOpen(true)}>환경 데이터 열기</button>}
    </section>

    {panel ? <aside className="forecastPanel">
      <button type="button" className="panelClose" aria-label="시간대별 예측 최소화" onClick={() => setPanel(false)}>×</button>
      <div className="forecastHeading"><b>시간대별 예측</b><em className={weather?.isKma ? "connected" : "fallback"}>{weatherLoading ? "연결 중" : weather?.isKma ? "KMA 연결" : "보완 데이터"}</em></div>
      <label className="datePicker">예보 날짜<input aria-label="예보 날짜" type="date" min={dateAfter(0)} max={dateAfter(5)} value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></label>
      <input aria-label="예측 시간" type="range" min="0" max="23" value={hour} onInput={event => setHour(+event.currentTarget.value)} />
      <div className="forecastTime"><strong>{String(hour).padStart(2, "0")}:00</strong><span>{formatDate(selectedDate)}</span></div>
      <div className="sunTimes"><span>일출 {formatClock(weather?.sunrise)}</span><span>일몰 {formatClock(weather?.sunset)}</span><span>태양 고도 {sun.elevation.toFixed(0)}°</span></div>
      <div className="metrics detailed">
        <p><i className="yellow" /><b>자외선</b><strong>{live.uv.toFixed(1)} UV</strong></p>
        <p><i className="red" /><b>기온</b><strong>{live.temperature.toFixed(1)}℃</strong></p>
        <p><i className="coral" /><b>체감</b><strong>{live.apparent.toFixed(1)}℃</strong></p>
        <p><i className="cyan" /><b>습도·해무</b><strong>{live.humidity.toFixed(0)}% · {live.fog}%</strong></p>
        <p><i className="blue" /><b>풍속</b><strong>{live.windSpeed.toFixed(1)}m/s</strong></p>
        <p><i className="orange" /><b>풍향</b><strong>{live.windDirection.toFixed(0)}°</strong></p>
        <p><i className="purple" /><b>일사량</b><strong>{live.radiation.toFixed(0)}W/㎡</strong></p>
        <p><i className="green" /><b>가시거리</b><strong>{(live.visibility / 1000).toFixed(1)}km</strong></p>
      </div>
      <div className="weatherSource"><b>{weather?.source || "예보 연결 확인 중"}</b><span>{weather?.sourceDetail || "잠시만 기다려 주세요"}</span><small>{weather ? `${formatClock(live.time)} 예보 · ${weather.fetchedAt} 조회` : ""}</small></div>
    </aside> : <div className="forecastMini">
      <button type="button" onClick={() => setPanel(true)} aria-label="시간대별 예측 펼치기">시간 예측 펼치기</button>
      <div className="miniRangeLabels"><span>00시</span><strong>{String(hour).padStart(2, "0")}:00</strong><span>23시</span></div>
      <input aria-label="최소화된 시간 조절" type="range" min="0" max="23" value={hour} onInput={event => setHour(+event.currentTarget.value)} />
    </div>}

    {routeCardOpen ? <div className={`routeInfo ${profile.key}`}>
      <button type="button" className="boxMinimize routeBoxMinimize" aria-label="시간대별 경로 최소화" onClick={() => setRouteCardOpen(false)}>−</button>
      <b>{profile.title}</b><span>{profile.detail}</span>
      <small>{featureStatus}</small>
      <div className="profileSchedule" aria-label="시간대별 추천 경로 구간">
        <span className={profile.key === "night" ? "current" : ""}>00~06 야간 안전</span><span className={profile.key === "balanced" ? "current" : ""}>07~12 쾌적 균형</span><span className={profile.key === "shadeWind" ? "current" : ""}>13~16 그늘·해풍</span><span className={profile.key === "balanced" ? "current" : ""}>17~19 쾌적 균형</span><span className={profile.key === "night" ? "current" : ""}>20~23 야간 안전</span>
      </div>
    </div> : <button type="button" className="boxRestore routeInfoRestore" onClick={() => setRouteCardOpen(true)}>시간대별 경로 열기</button>}

    {selectedPlace && active.includes("crowd") && densityOpen && <section className="densityDetail" aria-label="시설별 밀집도 상세">
      <button type="button" className="boxMinimize detailMinimize" aria-label="밀집도 상세 최소화" onClick={() => setDensityOpen(false)}>−</button>
      {densityPhoto && <img src={densityPhoto} alt={`${selectedPlace.name} 공개 사진`} />}
      <div className="densityCopy">
        <small>밀집도 상세 · {String(hour).padStart(2, "0")}:00</small><h2>{selectedPlace.name}</h2>
        <p>{selectedPlace.category} · {selectedPlace.road}</p>
        <div className="densityBar"><span style={{ width: `${selectedCrowd}%` }} /></div>
        <strong>{selectedCrowd}% · {selectedCrowd >= 75 ? "매우 혼잡" : selectedCrowd >= 55 ? "혼잡" : selectedCrowd >= 35 ? "보통" : "여유"}</strong>
        <p className="densityNote">시설 유형·시간대·주변 보행로를 반영한 예상치입니다.</p>
      </div>
    </section>}
    {selectedPlace && active.includes("crowd") && !densityOpen && <button type="button" className="boxRestore densityRestore" onClick={() => setDensityOpen(true)}>밀집도 상세 열기</button>}

    {selectedFacility && active.includes("facility") && facilityOpen && <section className="facilityDetail" aria-label="시설물 정보 상세">
      <button type="button" className="boxMinimize detailMinimize" aria-label="시설물 정보 최소화" onClick={() => setFacilityOpen(false)}>−</button>
      {facilityPhoto && <img src={facilityPhoto} alt={`${selectedFacility.name} 공개 사진`} />}
      <div className="facilityCopy">
        <small>{selectedFacility.category}</small><h2>{selectedFacility.name}</h2>
        <dl>
          <div><dt>위치</dt><dd>{selectedFacility.address || selectedFacility.road}</dd></div>
          {selectedFacility.openingHours && <div><dt>운영시간</dt><dd>{selectedFacility.openingHours}</dd></div>}
          {selectedFacility.operator && <div><dt>운영기관</dt><dd>{selectedFacility.operator}</dd></div>}
          {selectedFacility.phone && <div><dt>전화</dt><dd>{selectedFacility.phone}</dd></div>}
          {selectedFacility.wheelchair && <div><dt>휠체어</dt><dd>{selectedFacility.wheelchair === "yes" ? "이용 가능" : selectedFacility.wheelchair === "no" ? "이용 어려움" : "일부 가능"}</dd></div>}
        </dl>
        {selectedFacility.description && <p>{selectedFacility.description}</p>}
        {selectedFacility.website && <a href={selectedFacility.website} target="_blank" rel="noreferrer">시설 공식 웹사이트 보기 →</a>}
        <em>시설 정보: OpenStreetMap · 사진: Wikimedia Commons 공개 자료</em>
      </div>
    </section>}
    {selectedFacility && active.includes("facility") && !facilityOpen && <button type="button" className="boxRestore facilityRestore" onClick={() => setFacilityOpen(true)}>시설물 정보 열기</button>}

    {legendOpen ? <div className="legend"><button type="button" className="boxMinimize legendMinimize" aria-label="지도 범례 최소화" onClick={() => setLegendOpen(false)}>−</button><b>검증된 환경 표시</b><span>보라색: 실제 건물에서 계산한 그늘</span><span><i className="blue" />해풍</span><span><i className="orange" />빌딩풍</span></div> : <button type="button" className="boxRestore legendRestore" onClick={() => setLegendOpen(true)}>지도 범례 열기</button>}
  </main>;
}
