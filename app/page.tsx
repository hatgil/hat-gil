"use client";

import { useState } from "react";

const routes = [
  { name: "달맞이 고개 바람길", time: "36분", distance: "2.4km", score: 94, cool: "그늘 68% · 체감 27°", note: "해풍이 시원하게 불어요", points: "16,70 29,58 39,61 53,42 68,45 82,27" },
  { name: "청사포 해안 산책길", time: "28분", distance: "1.8km", score: 82, cool: "그늘 42% · 체감 29°", note: "탁 트인 바다 풍경", points: "16,70 29,78 42,72 54,79 68,67 84,70" },
  { name: "미포 조용한 골목길", time: "31분", distance: "2.1km", score: 76, cool: "그늘 55% · 체감 28°", note: "사람이 비교적 적어요", points: "16,70 28,49 43,51 55,58 67,52 82,54" },
];
const goals = ["가장 시원한 길", "가장 아름다운 풍경", "가장 조용한 길", "가족 산책", "운동 코스"];

export default function Home() {
  const [goal, setGoal] = useState(goals[0]);
  const [layer, setLayer] = useState<"sun" | "wind" | "crowd" | null>("sun");
  const [range, setRange] = useState(1);
  const [selected, setSelected] = useState(0);
  const r = routes[selected];
  return <main className="app-shell">
    <header><div className="brand"><span>〰</span><div><b>바닷길</b><small>BUSAN COAST WALK</small></div></div><div className="weather"><span>☀</span><b>29°</b><small>해운대 · 맑음</small></div></header>
    <section className="intro"><div><p>오늘, 어떤 걸음이 필요하세요?</p><h1>바다와 날씨를 읽는<br/><em>부산 산책 경로</em></h1></div><div className="range"><b>해안 반경 <strong>{range}km</strong></b><input aria-label="해안 반경" type="range" min="1" max="5" value={range} onChange={e=>setRange(+e.target.value)}/><span>1km <i/> 5km</span></div></section>
    <section className="goal-bar"><span>산책 목적</span>{goals.map(g=><button className={goal===g?"active":""} onClick={()=>{setGoal(g);setSelected(g==="가장 아름다운 풍경"?1:g==="가장 조용한 길"?2:0)}} key={g}>{g}</button>)}</section>
    <section className="content">
      <div className="map-panel">
        <div className="map-head"><div><b>해운대 해안</b><span>미포항 ↔ 청사포</span></div><span className="live">● 실시간 환경 분석</span></div>
        <div className="map" aria-label="부산 해안 지도">
          <div className="sea-label">동해</div><div className="coast">해운대 해수욕장<br/><small>미포항</small></div><div className="blocks">▦　▤<br/>　▦　▥<br/>▥　　▦</div>
          {routes.map((x,i)=><svg key={x.name} className={`route route-${i} ${i===selected?"chosen":""}`} viewBox="0 0 100 100" preserveAspectRatio="none" onClick={()=>setSelected(i)}><polyline points={x.points} /></svg>)}
          <div className="pin start">출발</div><div className="pin end">도착</div>
          {layer==="sun"&&<div className="shade"><span>☀</span><b>현재 그늘 구역</b><small>건물 그림자 · 68%</small></div>}
          {layer==="wind"&&<div className="wind-layer"><i>➜</i><i>➜</i><i>➜</i><b>동남풍 4.2m/s</b></div>}
          {layer==="crowd"&&<div className="crowd-layer"><i/><i/><i/><b>혼잡도 낮음</b></div>}
          <div className="legend"><i className="blue"/>추천 <i className="orange"/>다른 경로</div>
        </div>
        <div className="layers"><button className={layer==="sun"?"on":""} onClick={()=>setLayer(layer==="sun"?null:"sun")}><span>☀</span>햇빛·그늘</button><button className={layer==="wind"?"on":""} onClick={()=>setLayer(layer==="wind"?null:"wind")}><span>≋</span>바람</button><button className={layer==="crowd"?"on":""} onClick={()=>setLayer(layer==="crowd"?null:"crowd")}><span>♟</span>혼잡도</button></div>
      </div>
      <aside><div className="recommend"><p>AI 맞춤 추천</p><h2>{r.name}</h2><div className="score"><b>{r.score}</b><span>쾌적 점수<br/><small>100점 만점</small></span></div><div className="stats"><span><b>{r.distance}</b>거리</span><span><b>{r.time}</b>예상 시간</span><span><b>낮음</b>혼잡도</span></div><div className="tip">✦ {r.note}<br/><small>{r.cool}</small></div><button className="start-btn">이 경로로 산책 시작</button></div><div className="route-list"><h3>비교 경로 <small>3개</small></h3>{routes.map((x,i)=><button onClick={()=>setSelected(i)} className={selected===i?"selected":""} key={x.name}><i>{i+1}</i><span><b>{x.name}</b><small>{x.distance} · {x.time} · {x.cool}</small></span><strong>{x.score}</strong></button>)}</div></aside>
    </section>
    <footer><span>☀ 그늘은 현재 시각의 태양 위치와 주변 건물을 반영한 예측값입니다.</span><span>데이터 기준: 기상청 · 공공데이터포털 · 도로 정보</span></footer>
  </main>;
}
