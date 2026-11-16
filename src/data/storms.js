// 열대 저기압(태풍·허리케인·사이클론) 실제 데이터
// GDACS(유엔·EU 공동 재난 경보 시스템)가 공개하는 진행 중인 열대 저기압 정보를 받아 옵니다.
// 브라우저에서 바로 받을 수 있도록 허용(CORS)된 무료 주소입니다.
const GDACS_URL = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP?eventtype=TC';

// 등급 기호 → 화면에 보여 줄 정보
// TD: 열대 저압부, TS: 열대 폭풍, HU: 태풍(허리케인)급
export const STAGES = {
  TD: { label: '열대 저압부', color: '#5ebaff' },
  TS: { label: '열대 폭풍', color: '#ffd60a' },
  HU: { label: '태풍', color: '#ff8a00' },
};

// 바다(분지)에 따라 같은 폭풍도 부르는 이름이 다릅니다
function basinWord(lat, lon) {
  if (lat >= 0 && lon >= 100) return '태풍'; // 북서태평양
  if (lat >= 0 && lon <= -20) return '허리케인'; // 대서양, 북동·중앙 태평양
  return '사이클론'; // 북인도양, 남반구
}

// 폴리곤 고리의 가운데 (경로 위의 점은 작은 원 모양 폴리곤으로 옵니다)
function ringCenter(ring) {
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return { lat: lat / ring.length, lon: lon / ring.length };
}

// "06/11 06:00 UTC" → Date (연도는 폭풍이 시작된 해를 씁니다)
function parsePointTime(label, year) {
  const m = /(\d{2})\/(\d{2}) (\d{2}):(\d{2})/.exec(label || '');
  if (!m) return null;
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), Number(m[3]), Number(m[4])));
}

// "maximum wind speed of 176 km/h" → 176
function maxWindOf(props) {
  const m = /([\d.]+)\s*km\/h/.exec(props.severitydata?.severitytext || '');
  return m ? Math.round(Number(m[1])) : null;
}

// 경로를 경도 180°를 넘을 때 끊기지 않게 이어 붙입니다 (예: 179° → -179° 를 181°로)
function unwrap(points) {
  for (let i = 1; i < points.length; i++) {
    while (points[i].lon - points[i - 1].lon > 180) points[i].lon -= 360;
    while (points[i].lon - points[i - 1].lon < -180) points[i].lon += 360;
  }
  return points;
}

// GDACS의 GeoJSON 조각들을 폭풍 하나의 정보로 묶습니다
function buildStorm(features) {
  const head = features[0].properties;
  const year = Number((head.fromdate || '').slice(0, 4)) || new Date().getUTCFullYear();
  const updated = new Date(`${head.todate}Z`);

  // 1) 경로 위의 점 (시간 순)
  const points = features
    .filter((f) => f.properties.Class?.startsWith('Point_Polygon_Point_'))
    .map((f) => ({
      index: Number(f.properties.Class.split('_').pop()),
      time: parsePointTime(f.properties.polygonlabel, year),
      ...ringCenter(f.geometry.coordinates[0]),
    }))
    .sort((a, b) => a.index - b.index);
  if (!points.length) return null;
  unwrap(points);

  // 2) 점과 점 사이 선분의 등급 (Line_Line_i 는 i번째 점 → i+1번째 점)
  const stageOf = {};
  for (const f of features) {
    if (f.properties.Class?.startsWith('Line_Line_')) {
      stageOf[Number(f.properties.Class.split('_').pop())] = f.properties.polygonlabel;
    }
  }
  points.forEach((p, i) => {
    p.stage = stageOf[i] || stageOf[i - 1] || 'TD';
    p.color = (STAGES[p.stage] || STAGES.TD).color;
  });

  // 3) 지금 위치 = 마지막 관측 시각 이전의 가장 마지막 점
  let now = 0;
  points.forEach((p, i) => {
    if (p.time && p.time <= updated) now = i;
  });
  const position = points[now];
  const stage = stageOf[now - 1] || position.stage;

  // 4) 예상 진로의 불확실성 범위 (회색 원뿔)
  const coneFeature = features.find((f) => f.properties.Class === 'Poly_Cones');
  let cone = [];
  if (coneFeature) {
    const g = coneFeature.geometry;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    cone = polys.map((poly) => {
      const ring = poly[0].map(([lon, lat]) => ({ lat, lon }));
      // 원뿔도 폭풍 위치 근처에서 끊기지 않게
      ring.unshift({ lat: position.lat, lon: position.lon });
      unwrap(ring).shift();
      return ring;
    });
  }

  const maxWind = maxWindOf(head);
  const word = basinWord(position.lat, ((position.lon + 540) % 360) - 180);
  // 아이콘 크기·색을 정하는 강도 단계 (CSS의 rank 클래스)
  const rank = stage === 'TD' ? 0 : stage === 'TS' ? 1 : maxWind >= 178 ? 3 : 2;
  const name = (head.eventname || head.name || '').replace(/-\d+$/, '');

  return {
    id: `gdacs-${head.eventid}`,
    name: `${stage === 'HU' ? word : STAGES[stage]?.label || '열대 저기압'} ${name}`,
    kind: stage === 'TD' ? 'depression' : 'cyclone',
    rank,
    south: position.lat < 0,
    category: STAGES[stage]?.label === '태풍' ? word : STAGES[stage]?.label || stage,
    wind: maxWind ? `${maxWind} km/h` : '—',
    alert: head.alertlevel,
    updated,
    report: head.url?.report,
    position: { lat: position.lat, lon: position.lon },
    past: points.slice(0, now + 1),
    forecast: points.slice(now + 1),
    cone,
  };
}

// 진행 중인 열대 저기압 목록 받기. 실패하면 오류를 던집니다
export async function loadStorms() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(GDACS_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`GDACS ${response.status}`);
    const data = await response.json();
    // 같은 폭풍(eventid)끼리 묶기. 지금 진행 중(iscurrent)인 것만
    const groups = new Map();
    for (const f of data.features || []) {
      const p = f.properties || {};
      if (p.eventtype !== 'TC' || String(p.iscurrent) !== 'true') continue;
      if (!groups.has(p.eventid)) groups.set(p.eventid, []);
      groups.get(p.eventid).push(f);
    }
    return [...groups.values()].map(buildStorm).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}
