// 실제 위성 구름 사진 불러오기
// NASA GIBS가 누구나 쓸 수 있게 공개한 위성 사진을 타일로 받아,
// 밝은 부분(구름)만 남겨서 지구 사진 위에 겹칩니다.
//
// 지구 전체를 덮기 위해 세 대의 정지 위성 + 하루 한 번 찍는 극궤도 위성을 섞습니다.
//  - 히마와리(일본, 동경 140.7°): 아시아·오세아니아·서태평양
//  - GOES-East(미국, 서경 75.2°): 남북 아메리카·대서양
//  - GOES-West(미국, 서경 137.2°): 동태평양·하와이
//  - VIIRS(NOAA-20, 극궤도): 정지 위성이 잘 못 보는 유럽·아프리카·중동·극지방 (하루 1장)
// 정지 위성은 바로 아래에서 멀어질수록 비스듬히 보이므로, 그 정도에 따라 픽셀마다 비중을 정해 부드럽게 섞습니다.
import { TILE, xToLon, yToLat, landMask } from './tiles.js';

const BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

// 정지 위성 목록: 바로 아래 경도(subLon), 낮 사진(가시광선), 밤 사진(적외선)
export const GEO_SATELLITES = [
  {
    id: 'himawari',
    name: 'JMA/Himawari',
    subLon: 140.7,
    visible: { id: 'Himawari_AHI_Band3_Red_Visible_1km', maxLevel: 7 },
    infrared: { id: 'Himawari_AHI_Band13_Clean_Infrared', maxLevel: 6 },
  },
  {
    id: 'goes-east',
    name: 'NOAA/GOES-East',
    subLon: -75.2,
    visible: { id: 'GOES-East_ABI_Band2_Red_Visible_1km', maxLevel: 7 },
    infrared: { id: 'GOES-East_ABI_Band13_Clean_Infrared', maxLevel: 6 },
  },
  {
    id: 'goes-west',
    name: 'NOAA/GOES-West',
    subLon: -137.2,
    visible: { id: 'GOES-West_ABI_Band2_Red_Visible_1km', maxLevel: 7 },
    infrared: { id: 'GOES-West_ABI_Band13_Clean_Infrared', maxLevel: 6 },
  },
];
// 극궤도 위성의 하루치 모자이크 (가장 최근 날짜). 실시간은 아니지만 실제 구름입니다
const POLAR = { id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', maxLevel: 9, ext: 'jpeg' };

// 정지 위성 바로 아래에서 이 각도 안쪽은 그 위성만, 바깥쪽 끝(FAR)부터는 쓰지 않습니다
const NEAR_DEG = 64;
const FAR_DEG = 77;

const pad = (n) => String(n).padStart(2, '0');

// 2026-11-10T02:10:00Z 형식
export function timeKey(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}:00Z`;
}

// 해의 높이(도): 낮/밤에 따라 어떤 사진을 쓸지 고릅니다
export function sunElevation(lat, lon, date) {
  const day = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const hourAngle = (hours - 12) * 15 + lon;
  const toRad = Math.PI / 180;
  const sinElevation =
    Math.sin(lat * toRad) * Math.sin(declination * toRad) +
    Math.cos(lat * toRad) * Math.cos(declination * toRad) * Math.cos(hourAngle * toRad);
  return Math.asin(sinElevation) / toRad;
}

const smooth = (lo, hi, v) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

// 정지 위성이 이 위치를 얼마나 잘 보는지 (0 = 못 봄, 1 = 잘 봄)
function viewWeight(lat, lon, subLon) {
  const toRad = Math.PI / 180;
  const cosAngle = Math.cos(lat * toRad) * Math.cos((lon - subLon) * toRad);
  return smooth(Math.cos(FAR_DEG * toRad), Math.cos(NEAR_DEG * toRad), cosAngle);
}

// 이제는 지구 어디든 실제 구름 사진이 있습니다 (정지 위성 + 극궤도 위성)
export function hasRealClouds() {
  return true;
}

// 타일 그림 받기 (8초 안에 안 오면 포기). 사진의 실제 시각도 함께 돌려줍니다
export async function fetchBitmap(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`tile ${response.status}`);
    const actual = response.headers.get('layer-time-actual');
    const blob = await response.blob();
    return { bitmap: await createImageBitmap(blob), actual: actual ? new Date(actual) : null };
  } finally {
    clearTimeout(timer);
  }
}

// 받은 그림에서 (z, x, y) 부분을 잘라 256×256 픽셀 값으로
function bitmapToPixels(bitmap, z, x, y, level) {
  const factor = 2 ** (z - level);
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const sub = bitmap.width / factor;
  ctx.drawImage(bitmap, (x % factor) * sub, (y % factor) * sub, sub, sub, 0, 0, TILE, TILE);
  bitmap.close?.();
  return ctx.getImageData(0, 0, TILE, TILE).data;
}

// 정지 위성 사진 한 장(가시광선 또는 적외선)을 받아 픽셀 값으로 돌려줍니다
// 그 시각의 사진이 아직 없으면 10분, 20분 전 사진으로 대신합니다
async function loadSourcePixels(source, z, x, y, requested) {
  const level = Math.min(z, source.maxLevel);
  const factor = 2 ** (z - level);
  let result = null;
  for (let back = 0; back <= 2 && !result; back++) {
    const when = requested ? timeKey(new Date(requested.getTime() - back * 600000)) : 'default';
    const url = `${BASE}/${source.id}/default/${when}/GoogleMapsCompatible_Level${source.maxLevel}/${level}/${Math.floor(y / factor)}/${Math.floor(x / factor)}.png`;
    try {
      result = await fetchBitmap(url);
    } catch (error) {
      if (back === 2 || !requested) throw error;
    }
  }
  return { data: bitmapToPixels(result.bitmap, z, x, y, level), actual: result.actual };
}

// 극궤도 위성의 하루치 사진
async function loadPolarPixels(z, x, y) {
  const level = Math.min(z, POLAR.maxLevel);
  const factor = 2 ** (z - level);
  const url = `${BASE}/${POLAR.id}/default/default/GoogleMapsCompatible_Level${POLAR.maxLevel}/${level}/${Math.floor(y / factor)}/${Math.floor(x / factor)}.${POLAR.ext}`;
  const { bitmap } = await fetchBitmap(url);
  return bitmapToPixels(bitmap, z, x, y, level);
}

// 타일 위의 값(해의 높이, 위성별 비중)을 17×17 격자로 미리 계산해 두고, 픽셀마다 사이 값을 섞어 씁니다
// (타일이 아주 넓은 낮은 확대 단계에서도 정확하도록)
const GRID = 16;
function gridValues(z, x, y, fn) {
  const n = 2 ** z;
  const values = new Float32Array((GRID + 1) * (GRID + 1));
  for (let gy = 0; gy <= GRID; gy++) {
    const lat = yToLat((y + gy / GRID) / n);
    for (let gx = 0; gx <= GRID; gx++) {
      values[gy * (GRID + 1) + gx] = fn(lat, xToLon((x + gx / GRID) / n));
    }
  }
  return values;
}
function gridAt(values, px, py) {
  const fx = (px / TILE) * GRID;
  const fy = (py / TILE) * GRID;
  const gx = Math.min(GRID - 1, Math.floor(fx));
  const gy = Math.min(GRID - 1, Math.floor(fy));
  const tx = fx - gx;
  const ty = fy - gy;
  const r = GRID + 1;
  const a = values[gy * r + gx];
  const b = values[gy * r + gx + 1];
  const c = values[(gy + 1) * r + gx];
  const d = values[(gy + 1) * r + gx + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
const maxOf = (values) => values.reduce((m, v) => (v > m ? v : m), -Infinity);
const minOf = (values) => values.reduce((m, v) => (v < m ? v : m), Infinity);

// ── 사진 밝기 → 구름 (투명도, 밝기) ───────────────────
// 낮 사진: 밝을수록 구름. 해가 낮으면 사진이 어두워지므로 조금(최대 1.7배) 밝게 보정합니다.
// 예전에는 보정이 너무 세고(약 2배) 구름으로 치는 범위가 좁아서, 눈 덮인 산이 픽셀 모양 그대로
// 새하얀 네모로 찍혔습니다. 이제는 넓은 범위에서 천천히 진해지게 합니다.
function visibleCloud(r, g, b, elevation) {
  const gain = Math.min(1.7, 1 / Math.max(0.35, Math.sin((Math.max(elevation, 0) * Math.PI) / 180)) ** 0.5);
  const v = ((r + g + b) / 765) * gain;
  return { alpha: smooth(0.16, 0.78, v) ** 1.15, v };
}
// 밤 사진(적외선): 차가울수록(높은 구름) 밝게 보입니다. 11월 대륙의 차가운 땅이 0.55~0.7쯤이라
// 그보다 확실히 차가운 곳부터 구름으로 칩니다
function infraredCloud(r, g, b) {
  const v = Math.max(r, g, b) / 255;
  return { alpha: smooth(0.66, 0.9, v), v };
}

// 구름 타일 하나 만들기 → { canvas: 흰색 구름만 있는 투명 캔버스, time: 사진 시각 }
// requested가 null이면 '가장 최근 사진'(default)을 받습니다.
export async function loadCloudTile(z, x, y, requested, ratio) {
  const date = requested || new Date(Date.now() - 40 * 60000);
  const DAY = 14; // 해가 이보다 높으면 낮 사진만
  const NIGHT = -3; // 해가 이보다 낮으면 밤 사진만
  const elevation = gridValues(z, x, y, (lat, lon) => sunElevation(lat, lon, date));
  const anyDay = maxOf(elevation) > NIGHT;
  const anyNight = minOf(elevation) < DAY;

  // 1) 이 타일을 볼 수 있는 정지 위성만 골라 사진을 받습니다
  const geo = GEO_SATELLITES.map((sat) => ({ sat, weight: gridValues(z, x, y, (lat, lon) => viewWeight(lat, lon, sat.subLon)) }))
    .filter((g) => maxOf(g.weight) > 0);
  const geoCoversAll = geo.length && minOf(gridValues(z, x, y, (lat, lon) =>
    GEO_SATELLITES.reduce((sum, sat) => sum + viewWeight(lat, lon, sat.subLon), 0))) >= 1;
  const loads = geo.map(async (g) => {
    const [vis, ir] = await Promise.all([
      anyDay ? loadSourcePixels(g.sat.visible, z, x, y, requested).catch(() => null) : null,
      anyNight ? loadSourcePixels(g.sat.infrared, z, x, y, requested).catch(() => null) : null,
    ]);
    return { ...g, vis, ir };
  });
  // 2) 정지 위성이 다 덮지 못하는 곳은 극궤도 위성 사진으로 채웁니다
  const polarLoad = geoCoversAll ? Promise.resolve(null) : loadPolarPixels(z, x, y).catch(() => null);
  const [sources, polar] = await Promise.all([Promise.all(loads), polarLoad]);
  const usable = sources.filter((s) => s.vis || s.ir);
  if (!usable.length && !polar) throw new Error('no satellite picture');
  const actual = usable.map((s) => s.vis?.actual || s.ir?.actual).find(Boolean) || null;

  // 3) 픽셀마다 위성별 구름 값을 비중대로 섞습니다
  const size = TILE;
  const alphaMap = new Float32Array(size * size);
  const brightMap = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const p = py * size + px;
      const i = p * 4;
      const e = gridAt(elevation, px, py);
      const dayWeight = smooth(NIGHT, DAY, e);
      let sumW = 0;
      let sumA = 0;
      let sumV = 0;
      for (const s of usable) {
        const w = gridAt(s.weight, px, py);
        if (w <= 0) continue;
        let a = 0;
        let v = 0;
        let used = 0;
        // 낮 사진과 밤 사진을 해의 높이에 따라 섞기 (해가 뜨고 지는 곳에서 경계가 생기지 않게)
        const dw = s.ir ? (s.vis ? dayWeight : 0) : 1;
        if (s.vis && dw > 0 && s.vis.data[i + 3] > 0) {
          const c = visibleCloud(s.vis.data[i], s.vis.data[i + 1], s.vis.data[i + 2], e);
          a += c.alpha * dw;
          v += c.v * dw;
          used += dw;
        }
        if (s.ir && dw < 1 && s.ir.data[i + 3] > 0) {
          const c = infraredCloud(s.ir.data[i], s.ir.data[i + 1], s.ir.data[i + 2]);
          a += c.alpha * (1 - dw);
          v += c.v * (1 - dw);
          used += 1 - dw;
        }
        if (used <= 0) continue; // 이 위성 사진에 이 픽셀이 없으면 건너뜀
        sumW += w;
        sumA += (a / used) * w;
        sumV += (v / used) * w;
      }
      // 정지 위성의 비중이 모자라는 만큼 극궤도 사진으로 채웁니다
      if (polar && sumW < 1) {
        const r = polar[i];
        const g = polar[i + 1];
        const b = polar[i + 2];
        if (r + g + b > 0) {
          // 극궤도 사진은 이미 밝기 보정이 되어 있어 더 밝게 하지 않습니다 (해 높이 90°로 계산)
          const c = visibleCloud(r, g, b, 90);
          const w = 1 - sumW;
          sumW += w;
          sumA += c.alpha * w;
          sumV += c.v * w;
        }
      }
      if (sumW > 0) {
        alphaMap[p] = sumA / sumW;
        brightMap[p] = sumV / sumW;
      }
    }
  }

  // 4) 투명도를 이웃 픽셀과 살짝 섞어(3×3 평균) 계단 모양 가장자리를 부드럽게 합니다.
  //    타일 가장자리에서는 바깥 대신 가장자리 픽셀을 써서 옆 타일과 이음매가 생기지 않게 합니다
  const work = document.createElement('canvas');
  work.width = size;
  work.height = size;
  const ctx = work.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const at = (px, py) => alphaMap[Math.min(size - 1, Math.max(0, py)) * size + Math.min(size - 1, Math.max(0, px))];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let a = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += at(px + dx, py + dy) * (dx || dy ? 1 : 4);
      a /= 12;
      const p = py * size + px;
      // 밝기 차이를 넓게 남겨 두꺼운 구름의 질감(울퉁불퉁함)이 보이게 합니다
      const bright = 168 + Math.min(1, brightMap[p]) * 84;
      data[p * 4] = bright - 5;
      data[p * 4 + 1] = bright - 2;
      data[p * 4 + 2] = bright;
      data[p * 4 + 3] = a * 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  if (ratio === 1) return { canvas: work, time: actual };
  const out = document.createElement('canvas');
  out.width = size * ratio;
  out.height = size * ratio;
  const outCtx = out.getContext('2d');
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(work, 0, 0, out.width, out.height);
  return { canvas: out, time: actual };
}

// ── 구름 없는 지구 사진 (NASA Blue Marble) ─────────────────
// 땅과 바다의 실제 색을 보여 주는 바닥 사진입니다. 8단계까지 있으며, 더 확대하면 잘라서 늘립니다.
const BLUE_MARBLE = { id: 'BlueMarble_NextGeneration', maxLevel: 8 };

export async function loadBaseTile(z, x, y, ratio) {
  const level = Math.min(z, BLUE_MARBLE.maxLevel);
  const factor = 2 ** (z - level);
  const px = Math.floor(x / factor);
  const py = Math.floor(y / factor);
  const url = `${BASE}/${BLUE_MARBLE.id}/default/default/GoogleMapsCompatible_Level${BLUE_MARBLE.maxLevel}/${level}/${py}/${px}.jpeg`;
  const { bitmap } = await fetchBitmap(url);
  const size = TILE * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const sub = bitmap.width / factor;
  ctx.drawImage(bitmap, (x % factor) * sub, (y % factor) * sub, sub, sub, 0, 0, size, size);
  bitmap.close?.();
  seasonalTint(ctx, size, z, y);
  hazeGrade(ctx, size, z, y, landMask(z, x, y, ratio));
  return canvas;
}

// 블루 마블은 어둡고 진한 편이라, 실시간 위성 사진처럼 밝고 살짝 뿌연 색으로 바꿉니다.
// (어두운 부분을 밝게 + 채도를 조금 낮추고 + 대기의 푸른 빛을 더함)
const CURVE = new Uint8Array(256).map((_, i) => Math.round(255 * (i / 255) ** 0.62));
function hazeGrade(ctx, size, z, y, land) {
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  const n = 2 ** z;
  let rowHaze = 0;
  for (let i = 0; i < data.length; i += 4) {
    // 위도가 높을수록(11월의 북쪽) 햇빛이 비스듬해 더 뿌옇고 밝게 보입니다
    if (i % (size * 4) === 0) {
      const lat = Math.abs(yToLat((y + (i / 4 / size + 0.5) / size) / n));
      rowHaze = smooth(36, 54, lat) * 0.72;
    }
    let r = CURVE[data[i]];
    let g = CURVE[data[i + 1]];
    let b = CURVE[data[i + 2]];
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    r += (lum - r) * 0.55;
    g += (lum - g) * 0.55;
    b += (lum - b) * 0.55;
    const haze = 1 - lum / 255;
    // 바다는 뿌옇게 하지 않습니다.
    // 예전에는 픽셀 색(어둡고 푸른지)으로 바다를 짐작했는데, 사진의 압축 블록(8×8)마다 판정이 달라져
    // 해안과 만(灣)에 네모난 얼룩이 생겼습니다. 이제는 실제 해안선 데이터(land)로 바다를 정합니다
    const seaness = 1 - land[i / 4] / 255;
    const lift = rowHaze * haze * (1 - seaness);
    const seaHaze = 1 - 0.5 * seaness;
    data[i] = r + 12 * haze * seaHaze + (156 - r) * lift;
    data[i + 1] = g + 24 * haze * seaHaze + (158 - g) * lift;
    data[i + 2] = b + 30 * haze * seaHaze + (156 - b) * lift;
  }
  ctx.putImageData(image, 0, 0);
}

// 블루 마블은 여름 사진이라, 계절에 맞게 북쪽(남쪽) 숲과 들판을 갈색으로 바꿔 줍니다.
// (11월이면 북반구 위도 38° 위쪽이 가을·겨울 색)
function seasonalTint(ctx, size, z, y) {
  const month = new Date().getMonth(); // 0 = 1월
  const northWinter = [10, 11, 0, 1, 2].includes(month) ? 1 : [9, 3].includes(month) ? 0.5 : 0;
  const southWinter = [4, 5, 6, 7, 8].includes(month) ? 1 : [3, 9].includes(month) ? 0.5 : 0;
  const n = 2 ** z;
  const top = yToLat(y / n);
  const bottom = yToLat((y + 1) / n);
  const weightAt = (lat) =>
    lat > 0 ? northWinter * smooth(28, 42, lat) : southWinter * smooth(28, 42, -lat);
  if (weightAt(top) === 0 && weightAt(bottom) === 0) return;
  const image = ctx.getImageData(0, 0, size, size);
  const data = image.data;
  for (let row = 0; row < size; row++) {
    const lat = yToLat((y + (row + 0.5) / size) / n);
    const w = weightAt(lat) * 0.85;
    if (w <= 0) continue;
    for (let col = 0; col < size; col++) {
      const i = (row * size + col) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 초록빛이 강한 픽셀(식물)만 갈색 쪽으로
      const green = Math.max(0, g - Math.max(r, b)) / 40;
      if (green <= 0) continue;
      const t = Math.min(1, green) * w;
      const light = (r + g + b) / 3;
      data[i] = r + (light * 1.22 - r) * t;
      data[i + 1] = g + (light * 1.0 - g) * t;
      data[i + 2] = b + (light * 0.72 - b) * t;
    }
  }
  ctx.putImageData(image, 0, 0);
}
