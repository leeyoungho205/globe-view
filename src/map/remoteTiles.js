// 인터넷에서 받아 오는 실제 관측 타일
// - 레이더(비·눈): RainViewer 무료 API. 10분 간격, 최근 약 2시간. 확대 7단계까지만 있어서 그 위는 늘려서 씁니다.
// - 고온 지점(산불 등): NASA GIBS의 VIIRS 위성 열 이상 지점. 하루 단위 자료입니다.
import { TILE } from './tiles.js';
import { fetchBitmap } from './satellite.js';

// 받은 그림에서 (z, x, y) 타일 부분만 잘라 캔버스로 만듭니다
// level: 실제로 받은 그림의 확대 단계 (z보다 작으면 일부를 잘라 늘림)
function cropToTile(bitmap, z, x, y, level, ratio) {
  const factor = 2 ** (z - level);
  const size = TILE * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const sub = bitmap.width / factor;
  ctx.drawImage(bitmap, (x % factor) * sub, (y % factor) * sub, sub, sub, 0, 0, size, size);
  bitmap.close?.();
  return canvas;
}

// ── 레이더 ─────────────────────────────────────────
const RADAR_MAX_LEVEL = 7;
const RADAR_COLOR = 2; // RainViewer 색 구성표 2번 (Universal Blue)

// 레이더 사진 목록 → [{ time: Date, url: 타일 주소 앞부분 }]
export async function loadRadarFrames() {
  const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
  if (!response.ok) throw new Error(`RainViewer ${response.status}`);
  const data = await response.json();
  return (data.radar?.past || []).map((frame) => ({
    time: new Date(frame.time * 1000),
    url: `${data.host}${frame.path}`,
  }));
}

// 원하는 시각에 가장 가까운 레이더 사진 (20분 넘게 차이 나면 없음)
export function pickRadarFrame(frames, date) {
  if (!frames.length) return null;
  if (!date) return frames[frames.length - 1];
  let best = null;
  for (const frame of frames) {
    if (!best || Math.abs(frame.time - date) < Math.abs(best.time - date)) best = frame;
  }
  return Math.abs(best.time - date) <= 20 * 60000 ? best : null;
}

export async function loadRadarTile(frame, z, x, y, ratio) {
  const level = Math.min(z, RADAR_MAX_LEVEL);
  const factor = 2 ** (z - level);
  const url = `${frame.url}/256/${level}/${Math.floor(x / factor)}/${Math.floor(y / factor)}/${RADAR_COLOR}/1_1.png`;
  const { bitmap } = await fetchBitmap(url);
  return cropToTile(bitmap, z, x, y, level, ratio);
}

// ── 고온 지점 (VIIRS 열 이상) ──────────────────────
const FIRE_LAYERS = 'VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_NOAA21_Thermal_Anomalies_375m_All';
const HALF = 20037508.342789244; // 메르카토르 지도 절반 폭(미터)

export async function loadFireTile(z, x, y, ratio) {
  // 타일 범위를 메르카토르 미터 좌표로 바꿔서 WMS로 그림을 요청합니다
  const span = (2 * HALF) / 2 ** z;
  const minX = -HALF + x * span;
  const maxY = HALF - y * span;
  const size = TILE * ratio;
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: FIRE_LAYERS,
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: [minX, maxY - span, minX + span, maxY].map((v) => v.toFixed(2)).join(','),
    WIDTH: String(size),
    HEIGHT: String(size),
    FORMAT: 'image/png',
    TRANSPARENT: 'true',
  });
  const { bitmap } = await fetchBitmap(`https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?${params}`);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, size, size);
  bitmap.close?.();
  return canvas;
}
