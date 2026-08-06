"use client";
import { useEffect, useRef, useState } from "react";

declare global { interface Window { L: any } }
type Kind = "uv" | "wind" | "fog" | "crowd" | "facility" | "shade" | "temp";

const buttons: [Kind, string, string][] = [
  ["uv", "☀", "자외선"], ["wind", "≋", "해풍·빌딩풍"], ["fog", "〰", "해무"],
  ["crowd", "♟", "밀집도"], ["facility", "⌂", "시설물"], ["shade", "▧", "건물 그늘"], ["temp", "♨", "온도"],
];
const routes = {
  night: [[35.1595,129.1707],[35.1601,129.176],[35.1615,129.182],[35.1607,129.1907]],
  day: [[35.1595,129.1707],[35.1614,129.175],[35.1622,129.182],[35.1607,129.1907]],
  cool: [[35.1595,129.1707],[35.1589,129.177],[35.1593,129.184],[35.1607,129.1907]],
};
const buildings = Array.from({ length: 28 }, (_, i): [number, number] => [35.1565 + (i % 7) * .00135, 129.169 + Math.floor(i / 7) * .0055 + (i % 2) * .001]);

export default function MapApp() {
  const mapNode = useRef<HTMLDivElement>(null), map = useRef<any>(), items = useRef<any[]>([]), path = useRef<any>();
  const [active, setActive] = useState<Kind[]>(["wind", "shade"]), [hour, setHour] = useState(14), [panelOpen, setPanelOpen] = useState(true);
  const route = hour < 6 || hour >= 20 ? routes.night : hour >= 11 && hour <= 16 ? routes.cool : routes.day;
  const uv = Math.max(0, 8 - Math.abs(hour - 13) * 2), temp = Math.round(23 + 7 * Math.sin((hour - 7) / 24 * Math.PI * 2));
  const fog = Math.max(12, Math.round(72 - 3 * hour + 18 * Math.cos(hour / 3))), crowd = hour >= 17 && hour <= 21 ? 76 : hour >= 11 && hour <= 16 ? 55 : 28;

  useEffect(() => {
    const init = () => { const L = window.L; if (!L || !mapNode.current) return; map.current = L.map(mapNode.current).setView([35.160, 129.180], 14); L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map.current); };
    if (window.L) init(); else { const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"; document.head.appendChild(c); const s = document.createElement("script"); s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"; s.onload = init; document.head.appendChild(s); }
  }, []);

  useEffect(() => {
    items.current.forEach(x => x.remove()); items.current = []; if (!map.current) return;
    const L = window.L, add = (x: any) => items.current.push(x.addTo(map.current));
    if (path.current) path.current.remove(); path.current = L.polyline(route, { color: "#00a4c4", weight: 9, opacity: .95 }).addTo(map.current);
    const rad = ((hour / 24) * 360 - 90) * Math.PI / 180, shadow = .00045 + Math.abs(hour - 12) * .00016;
    if (active.includes("shade")) buildings.forEach((p, i) => { const n = Math.sin(rad) * shadow, e = -Math.cos(rad) * shadow, w = .0002 + (i % 3) * .00005; add(L.polygon([[p[0]-w,p[1]-w],[p[0]+w,p[1]+w],[p[0]+n+w,p[1]+e+w],[p[0]+n-w,p[1]+e-w]], { color: "#42208e", fillColor: "#7148d7", fillOpacity: .48, weight: 2, dashArray: "5 3" })); });
    if (active.includes("fog")) buildings.filter((_, i) => i % 3 === 0).forEach(p => add(L.circle(p, { radius: 115, color: "#087f9d", fillColor: "#9de3ec", fillOpacity: fog / 130 + .18, weight: 3, dashArray: "10 6" })));
    if (active.includes("wind")) buildings.filter((_, i) => i % 4 === 0).forEach((p, i) => {
      const seaSpeed = 2.1 + hour * .13, buildingSpeed = 4.3 + (i % 3) + hour * .08, seaDir = (110 + hour * 13) % 360, buildingDir = (35 + hour * 17 + i * 19) % 360;
      const waves = (kind: string, dir: number, speed: number, duration: number) => `<div class="windMotion ${kind}" style="--dir:${dir}deg;--dur:${duration}s"><span>≋</span><span>≋</span><span>≋</span><small>${speed.toFixed(1)}m/s</small></div>`;
      add(L.marker([p[0]+.0007,p[1]-.0007], { icon: L.divIcon({ className: "windAnchor", html: waves("seaFlow", seaDir, seaSpeed, Math.max(.45, 1.8-seaSpeed*.15)) }) }));
      add(L.marker([p[0]-.0007,p[1]+.0007], { icon: L.divIcon({ className: "windAnchor", html: waves("buildingFlow", buildingDir, buildingSpeed, Math.max(.28, 1.6-buildingSpeed*.14)) }) }));
    });
    if (active.includes("uv")) buildings.filter((_, i) => i % 5 === 0).forEach(p => add(L.circle(p, { radius: 95, color: "#e37d00", fillColor: "#ffd438", fillOpacity: uv / 20 + .12, weight: 3 })));
    if (active.includes("crowd")) buildings.filter((_, i) => i % 4 === 1).forEach((p, i) => add(L.marker(p, { icon: L.divIcon({ className: "crowdMark", html: `♟<b style="font-size:${18+crowd/5+i}px">♟</b>` }) })));
    if (active.includes("facility")) buildings.filter((_, i) => i % 6 === 2).forEach((p, i) => add(L.marker(p, { icon: L.divIcon({ className: "facilityMark", html: ["WC","쉼","편","P"][i%4] }) })));
    if (active.includes("temp")) buildings.filter((_, i) => i % 4 === 2).forEach((p, i) => add(L.marker(p, { icon: L.divIcon({ className: "tempMark", html: `${temp+(i%3)-1}°` }) })));
  }, [active, hour]);

  const toggle = (x: Kind) => setActive(active.includes(x) ? active.filter(v => v !== x) : [...active, x]);
  return <main>
    <header><b>〰 바닷길</b><span>24시간 환경 예측</span></header><div ref={mapNode} id="map" />
    <section className="controls"><div className="inputs"><input defaultValue="미포항" /><b>→</b><input defaultValue="청사포 다릿돌전망대" /><button>AI 최적 경로</button></div><div className="buttons">{buttons.map(([k, icon, name]) => <button key={k} className={active.includes(k) ? "on" : ""} onClick={() => toggle(k)}><i>{icon}</i>{name}</button>)}</div></section>
    {panelOpen ? <aside><button className="panelClose" aria-label="시간대별 예측 최소화" onClick={() => setPanelOpen(false)}>×</button><b>시간대별 예측</b><input type="range" min="0" max="23" value={hour} onChange={e => setHour(+e.target.value)} /><strong>{String(hour).padStart(2,"0")}:00</strong><span>태양 고도 {hour>=6&&hour<=19 ? Math.max(4,63-Math.abs(hour-12)*9) : 0}°</span><div className="metrics"><p><i className="yellow"/>UV {uv}</p><p><i className="blue"/>해풍 {(2.1+hour*.13).toFixed(1)}m/s</p><p><i className="orange"/>빌딩풍 {(4.3+hour*.08).toFixed(1)}m/s</p><p><i className="cyan"/>해무 {fog}%</p><p><i className="pink"/>밀집도 {crowd}%</p><p><i className="red"/>온도 {temp}°</p></div></aside> : <button className="panelOpen" onClick={() => setPanelOpen(true)}>시간대별 예측 열기</button>}
    <div className="routeInfo"><b>{hour<6||hour>=20 ? "야간 안전 경로" : hour>=11&&hour<=16 ? "그늘·해풍 우선 경로" : "쾌적 균형 경로"}</b><span>{hour}시 환경값을 반영해 추천 경로가 변경되었습니다.</span></div>
    <div className="legend"><b>바람 색상</b><span><i className="blue"/>해풍</span><span><i className="orange"/>빌딩풍</span></div>
  </main>;
}
