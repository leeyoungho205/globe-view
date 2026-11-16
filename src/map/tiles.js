// 지도 조각(타일)을 그리는 함수들
// 지도는 256×256 픽셀 조각으로 나뉘어 있고, 필요한 조각만 그려서 저장(캐시)해 둡니다.
import { geoMercator, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import { oceanColor, landColor, cloudColor } from './earth.js';

export const TILE = 256;

// ── 좌표 변환 (웹 메르카토르) ─────────────────────────
export const lonToX = (lon) => (lon + 180) / 360;
export const latToY = (lat) => {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export const xToLon = (x) => x * 360 - 180;
export const yToLat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

// ── 나라 경계·해안선 데이터 ───────────────────────────
// 각 다각형/선마다 범위(bbox)를 미리 계산해서, 타일에 걸치는 것만 그립니다.
let landPolygons = [];
let borderLines = [];

function ringBounds(coords) {
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

export function setGeoData(landTopo, countryTopo) {
  const land = feature(landTopo, landTopo.objects.land);
  const geometries = land.type === 'FeatureCollection' ? land.features.map((f) => f.geometry) : [land.geometry];
  landPolygons = [];
  for (const geometry of geometries) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const poly of polys) landPolygons.push({ coords: poly, box: ringBounds(poly[0]) });
  }
  const borders = mesh(countryTopo, countryTopo.objects.countries, (a, b) => a !== b);
  borderLines = borders.coordinates.map((line) => ({ coords: line, box: ringBounds(line) }));
}

export const hasGeoData = () => landPolygons.length > 0;

// 타일 하나가 덮는 위도/경도 범위
function tileBounds(z, x, y, margin = 1) {
  const n = 2 ** z;
  return {
    minLon: xToLon(x / n) - margin,
    maxLon: xToLon((x + 1) / n) + margin,
    maxLat: yToLat(y / n) + margin,
    minLat: yToLat((y + 1) / n) - margin,
  };
}

const overlaps = (a, b) =>
  a.maxLon >= b.minLon && a.minLon <= b.maxLon && a.maxLat >= b.minLat && a.minLat <= b.maxLat;

// 타일 하나를 위한 메르카토르 투영(위도/경도 → 타일 안의 픽셀)
function tileProjection(z, x, y, ratio) {
  const ws = TILE * 2 ** z * ratio;
  const size = TILE * ratio;
  return geoMercator()
    .scale(ws / (2 * Math.PI))
    .translate([ws / 2 - x * size, ws / 2 - y * size])
    .clipExtent([[-4, -4], [size + 4, size + 4]])
    .precision(0);
}

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

// 격자 모양으로 점을 찍어 색을 계산한 작은 그림을 만듭니다 (step 픽셀마다 한 점)
function sampleField(z, x, y, step, colorAt) {
  const size = TILE / step;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const n = 2 ** z;
  const color = [0, 0, 0];
  let anyVisible = false;
  for (let row = 0; row < size; row++) {
    const lat = yToLat((y + (row + 0.5) / size) / n);
    for (let col = 0; col < size; col++) {
      const lon = xToLon((x + (col + 0.5) / size) / n);
      const alpha = colorAt(lat, lon, color);
      const i = (row * size + col) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = alpha * 255;
      if (alpha > 0) anyVisible = true;
    }
  }
  ctx.putImageData(image, 0, 0);
  return anyVisible ? canvas : null;
}

// 땅 모양 경로를 만들어 둡니다(잘라내기/선 긋기에 사용)
function traceLand(ctx, z, x, y, ratio) {
  const box = tileBounds(z, x, y);
  const coordinates = landPolygons.filter((p) => overlaps(p.box, box)).map((p) => p.coords);
  if (!coordinates.length) return false;
  const path = geoPath(tileProjection(z, x, y, ratio), ctx);
  ctx.beginPath();
  path({ type: 'MultiPolygon', coordinates });
  return true;
}

// 땅이면 255, 바다면 0인 지도 (해안선 데이터로 정확하게). 해안은 살짝 흐리게 해서 부드럽게 바뀝니다
export function landMask(z, x, y, ratio) {
  const size = TILE * ratio;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (traceLand(ctx, z, x, y, ratio)) {
    ctx.filter = `blur(${ratio}px)`;
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  const data = ctx.getImageData(0, 0, size, size).data;
  const mask = new Uint8ClampedArray(size * size);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3];
  return mask;
}

// ── 1) 바닥 타일: 바다 + 땅 ──────────────────────────
export function renderBaseTile(z, x, y, ratio, dimmed = false) {
  const size = TILE * ratio;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const step = z >= 7 ? 2 : 2;
  const ocean = sampleField(z, x, y, step, (lat, lon, out) => {
    oceanColor(lat, lon, out);
    return 1;
  });
  ctx.drawImage(ocean, 0, 0, size, size);
  ctx.save();
  if (traceLand(ctx, z, x, y, ratio)) {
    ctx.clip();
    const land = sampleField(z, x, y, step, (lat, lon, out) => {
      landColor(lat, lon, out);
      return 1;
    });
    ctx.drawImage(land, 0, 0, size, size);
  }
  ctx.restore();
  if (dimmed) {
    ctx.fillStyle = 'rgba(8, 12, 18, 0.55)';
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

// ── 2) 구름 타일 ──────────────────────────────────────
export function renderCloudTile(z, x, y, ratio) {
  const size = TILE * ratio;
  const field = sampleField(z, x, y, 2, (lat, lon, out) => cloudColor(lat, lon, out));
  const canvas = makeCanvas(size);
  if (field) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(field, 0, 0, size, size);
  }
  return canvas;
}

// ── 4) 선 타일: 해안선 + 나라 경계 ───────────────────
export function renderLineTile(z, x, y, ratio) {
  const size = TILE * ratio;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const width = (z <= 3 ? 0.8 : 1) * ratio;
  // 해안선
  if (traceLand(ctx, z, x, y, ratio)) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = width;
    ctx.stroke();
  }
  // 나라 경계
  const box = tileBounds(z, x, y);
  const lines = borderLines.filter((l) => overlaps(l.box, box)).map((l) => l.coords);
  if (lines.length) {
    const path = geoPath(tileProjection(z, x, y, ratio), ctx);
    ctx.beginPath();
    path({ type: 'MultiLineString', coordinates: lines });
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = width;
    ctx.stroke();
  }
  return canvas;
}
