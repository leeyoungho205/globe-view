// "위성 사진처럼 보이는" 지구의 색을 계산하는 함수들
// 실제 위성 사진 대신, 위도/경도에 따라 바다·땅·구름 색을 직접 만들어 냅니다.
import { fbm, noise2, smoothstep } from './noise.js';

// 부드러운 상자 모양 영역: 상자 안이면 1, 밖이면 0, 경계는 부드럽게
function softBox(lat, lon, lat0, lat1, lon0, lon1, edge = 3) {
  return (
    smoothstep(-edge, edge, lat - lat0) *
    smoothstep(-edge, edge, lat1 - lat) *
    smoothstep(-edge, edge, lon - lon0) *
    smoothstep(-edge, edge, lon1 - lon)
  );
}

// 가우시안(종 모양) 덩어리
function blob(lat, lon, cLat, cLon, radius) {
  const dx = (lon - cLon) * Math.cos((cLat * Math.PI) / 180);
  const dy = lat - cLat;
  return Math.exp(-(dx * dx + dy * dy) / (radius * radius));
}

const mix = (a, b, t) => a + (b - a) * t;
function mixColor(base, color, t) {
  base[0] = mix(base[0], color[0], t);
  base[1] = mix(base[1], color[1], t);
  base[2] = mix(base[2], color[2], t);
}

// ── 바다 색 ────────────────────────────────────────────
export function oceanColor(lat, lon, out) {
  const n = fbm(lon * 0.35, lat * 0.35, 3);
  out[0] = 13 + n * 4;
  out[1] = 28 + n * 6;
  out[2] = 52 + n * 9;
  // 황해·보하이만: 흙탕물 때문에 살짝 밝고 탁한 색
  const turbid = softBox(lat, lon, 36.5, 41, 117.5, 122.5, 1) * 0.7;
  if (turbid > 0) mixColor(out, [92, 80, 86], turbid);
  const yellowSea = softBox(lat, lon, 31.5, 37, 119.5, 125.5, 1.5) * 0.45;
  if (yellowSea > 0) mixColor(out, [38, 58, 70], yellowSea);
  return out;
}

// ── 땅 색 ──────────────────────────────────────────────
export function landColor(lat, lon, out) {
  const n = fbm(lon * 0.9, lat * 0.9, 5);
  const fine = noise2(lon * 6, lat * 6);
  const absLat = Math.abs(lat);

  // 1) 위도에 따른 기본 색 (열대 → 초록, 온대 → 갈색, 극지 → 하얀색)
  out[0] = 70; out[1] = 98; out[2] = 52;
  mixColor(out, [112, 108, 78], smoothstep(22, 34, absLat));
  mixColor(out, [96, 98, 78], smoothstep(46, 54, absLat));
  mixColor(out, [205, 208, 214], smoothstep(56, 68, absLat) * (0.55 + n * 0.3));

  // 2) 지역별 특징 색
  // 몽골·화북 초원과 사막: 황갈색
  mixColor(out, [168, 148, 118], softBox(lat, lon, 38, 52, 88, 120, 3));
  // 고비 사막: 더 밝은 모래색
  mixColor(out, [184, 164, 132], softBox(lat, lon, 40, 45.5, 96, 112, 2) * 0.8);
  // 타클라마칸 사막
  mixColor(out, [192, 168, 124], softBox(lat, lon, 37, 41.5, 78, 89, 2));
  // 황토 고원·화북 평원: 회갈색
  mixColor(out, [138, 124, 96], softBox(lat, lon, 33, 40, 100, 119, 2.5) * 0.85);
  // 만주·러시아 극동: 갈색과 회색
  mixColor(out, [118, 108, 86], softBox(lat, lon, 40, 54, 120, 140, 3) * 0.8);
  // 티베트 고원: 짙은 갈색
  mixColor(out, [118, 102, 82], softBox(lat, lon, 28, 37, 78, 102, 2.5));
  // 중국 남부·동남아: 짙은 초록
  mixColor(out, [56, 88, 42], softBox(lat, lon, 8, 31, 96, 123, 3) * 0.95);
  // 한반도·일본: 가을빛이 섞인 초록
  mixColor(out, [92, 98, 64], softBox(lat, lon, 30, 45, 124, 146, 2) * 0.9);
  // 인도
  mixColor(out, [124, 116, 72], softBox(lat, lon, 8, 30, 68, 89, 3));
  // 아라비아·사하라 사막
  mixColor(out, [206, 174, 124], softBox(lat, lon, 14, 32, -16, 58, 4));
  // 오스트레일리아 내륙
  mixColor(out, [182, 122, 72], softBox(lat, lon, -34, -16, 116, 150, 4) * 0.9);
  // 북미 대평원 / 남미 아마존
  mixColor(out, [132, 120, 88], softBox(lat, lon, 30, 50, -112, -95, 4) * 0.7);
  mixColor(out, [48, 82, 38], softBox(lat, lon, -15, 5, -75, -45, 4));
  // 남극·그린란드: 얼음
  mixColor(out, [232, 236, 242], smoothstep(-62, -70, lat) + softBox(lat, lon, 60, 84, -60, -20, 3));

  // 3) 질감: 같은 색이라도 밝고 어두운 얼룩을 넣습니다
  const shade = 0.84 + n * 0.3 + fine * 0.07;
  out[0] *= shade;
  out[1] *= shade;
  out[2] *= shade;

  // 높은 산의 눈 (티베트 고원과 시베리아)
  const snowZone = softBox(lat, lon, 29, 39, 78, 100, 1.5) * 0.9 + smoothstep(50, 60, lat) * 0.6;
  if (snowZone > 0) {
    const snow = smoothstep(0.35, 0.75, n + fine * 0.4) * snowZone;
    if (snow > 0) mixColor(out, [222, 224, 230], snow);
  }
  return out;
}

// ── 구름 ───────────────────────────────────────────────
// 그 지점이 얼마나 구름에 덮이기 쉬운지 (0~1)
function cloudCoverage(lat, lon) {
  const absLat = Math.abs(lat);
  // 전 지구 기본값: 적도 수렴대와 중위도 폭풍 경로에 구름이 많음
  let cov =
    0.36 +
    0.22 * Math.exp(-(((lat - 6) / 8) ** 2)) +
    0.26 * Math.exp(-(((absLat - 52) / 11) ** 2)) -
    0.18 * Math.exp(-(((absLat - 24) / 7) ** 2));

  // 동아시아 주변은 원본 화면과 비슷하게 맞춥니다
  const eastAsia = softBox(lat, lon, 5, 60, 85, 175, 4);
  if (eastAsia > 0) {
    let local = 0.42;
    local = mix(local, 0.1, softBox(lat, lon, 25, 42, 106, 131, 2)); // 한반도·황해·중국 중부: 맑음
    local = mix(local, 0.12, softBox(lat, lon, 40, 51, 90, 118, 3)); // 몽골: 맑음
    local = mix(local, 0.3, softBox(lat, lon, 43, 52, 118, 133, 2)); // 만주: 옅은 줄무늬 구름
    local = mix(local, 0.62, softBox(lat, lon, 51, 62, 85, 135, 3)); // 시베리아: 구름 많음
    local = mix(local, 0.9, softBox(lat, lon, 17, 30.5, 93, 108.5, 2)); // 중국 남서부: 두꺼운 구름
    local = mix(local, 0.72, softBox(lat, lon, 17, 25.5, 108, 116, 1.5)); // 광둥·광시
    local = mix(local, 0.32, softBox(lat, lon, 21, 30, 117, 126, 1.5)); // 대만·동중국해
    local = mix(local, 0.5, softBox(lat, lon, 35, 46, 129, 140, 1.5)); // 동해 줄무늬 구름
    local = mix(local, 0.86, softBox(lat, lon, 31, 52, 141, 175, 2.5)); // 일본 동쪽 큰 구름덩이
    local = mix(local, 0.44, softBox(lat, lon, 12, 29, 124, 175, 2.5)); // 남쪽 바다: 뭉게구름
    cov = mix(cov, local, eastAsia);
    // 규슈 남쪽에서 북동쪽으로 뻗은 전선 구름띠
    const along = (lon - 134.4) * 0.87 + (lat - 32.5) * 0.49;
    const across = -(lon - 134.4) * 0.49 + (lat - 32.5) * 0.87;
    if (along > -3 && along < 40) cov += 0.45 * Math.exp(-((across / 3.2) ** 2)) * smoothstep(-3, 2, along);
  }
  // (예전에는 가짜 태풍 소용돌이를 그려 넣었지만, 이제 태풍은 실제 자료로만 보여 주므로 넣지 않습니다.
  //  이 구름은 위성 사진을 받을 수 없을 때만 쓰는 '예시 구름'입니다)
  return Math.min(1.1, cov);
}

// 구름의 "두께" (0이면 맑음, 1 이상이면 아주 두꺼운 구름)
function cloudThickness(lat, lon) {
  const cov = cloudCoverage(lat, lon);
  if (cov < 0.04) return 0;
  // 큰 구름 덩어리 + 줄무늬 구름 + 작은 뭉게구름(남쪽 바다)
  const popcorn = softBox(lat, lon, 12, 30, 124, 175, 2);
  const broad = fbm(lon * 0.3 + 3.1, lat * 0.3 - 7.7, 7, 0.55);
  let n = broad * 0.5 + 0.5;
  const streakWeight = softBox(lat, lon, 34, 52, 118, 141, 2) * 0.65;
  if (streakWeight > 0.01) {
    const streak = fbm(lon * 0.16 + lat * 0.22, lat * 1.3 - lon * 0.25, 5, 0.55);
    n = mix(n, streak * 0.5 + 0.5, streakWeight);
  }
  if (popcorn > 0.01) {
    // 뭉게구름: 작은 덩어리가 띄엄띄엄 (어두운 틈이 많음)
    const cells = fbm(lon * 1.3, lat * 1.3, 4, 0.5) * 0.5 + 0.5;
    n = mix(n, cells * 0.85 + n * 0.15, popcorn * 0.8);
  }
  return (n + cov - 0.95) * 3;
}

// 구름의 진하기(0~1)
export function cloudAlpha(lat, lon) {
  const t = cloudThickness(lat, lon);
  if (t <= 0) return 0;
  return Math.min(1, t * 1.3) ** 0.9;
}

// 구름 색과 진하기: 얇은 구름은 회색빛으로 투명하게, 두꺼운 구름은 밝은 흰색으로
export function cloudColor(lat, lon, out) {
  const t = cloudThickness(lat, lon);
  if (t <= 0) return 0;
  const alpha = Math.min(1, t * 1.3) ** 0.9;
  const thick = Math.min(1, t / 3);
  const texture = noise2(lon * 4.2, lat * 4.2) * 12 + fbm(lon * 1.1 - 5, lat * 1.1 + 3, 4) * 22;
  const bright = Math.min(255, 176 + 72 * Math.sqrt(thick) + texture);
  out[0] = bright - 6;
  out[1] = bright - 3;
  out[2] = bright;
  return alpha;
}

// ── 예보 지도용 값 (기온, 바람, 강수량 등) ─────────────
const ramps = {
  temperature: [
    [-40, [120, 40, 160]], [-20, [60, 70, 200]], [-5, [60, 160, 230]], [5, [70, 200, 170]],
    [15, [140, 210, 80]], [22, [240, 210, 60]], [30, [245, 130, 40]], [40, [200, 40, 50]],
  ],
  wind: [
    [0, [40, 60, 140]], [10, [40, 130, 190]], [20, [60, 190, 150]], [35, [200, 210, 70]],
    [55, [240, 120, 40]], [80, [200, 40, 120]],
  ],
  humidity: [
    [0, [150, 100, 50]], [40, [190, 170, 90]], [60, [110, 190, 120]], [80, [60, 150, 200]], [100, [40, 70, 180]],
  ],
  pressure: [
    [980, [140, 40, 160]], [995, [60, 100, 210]], [1005, [70, 180, 200]], [1015, [140, 200, 110]],
    [1025, [230, 190, 80]], [1035, [220, 100, 60]],
  ],
  precipitation: [
    [0, [0, 0, 0]], [0.2, [60, 140, 230]], [0.4, [40, 200, 120]], [0.6, [240, 220, 60]],
    [0.8, [245, 120, 40]], [1, [220, 40, 80]],
  ],
};

export function rampColor(name, value, out) {
  const stops = ramps[name];
  if (value <= stops[0][0]) return copy(out, stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i][0]) {
      const t = (value - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      const a = stops[i - 1][1];
      const b = stops[i][1];
      out[0] = mix(a[0], b[0], t);
      out[1] = mix(a[1], b[1], t);
      out[2] = mix(a[2], b[2], t);
      return out;
    }
  }
  return copy(out, stops[stops.length - 1][1]);
}
function copy(out, c) {
  out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}
