// 실제 날씨 값(기온, 바람, 습도, 기압, 강수량)을 격자로 받아 오는 곳
// - Open-Meteo에 "격자 점 여러 개의 지금 값"을 한 번에 물어봅니다.
// - 확대 단계에 따라 격자 간격(도)을 바꾸고, 8×8 점씩 묶음(chunk)으로 받아 30분 동안 기억합니다.
// - 화면의 어느 위치든 주변 격자 4점의 값을 섞어서(쌍선형 보간) 부드럽게 알려 줍니다.

const CHUNK = 8; // 묶음 하나 = 8×8 격자 점
const KEEP_MS = 30 * 60000;
const MAX_PARALLEL = 3; // 한꺼번에 보내는 요청 수 (무료 서버를 배려)

// 지도 종류 → 받아 올 값 묶음
export const FIELD_GROUPS = {
  temperature: { vars: ['temperature_2m', 'apparent_temperature'] },
  humidity: { vars: ['relative_humidity_2m', 'dew_point_2m', 'wet_bulb_temperature_2m'] },
  wind: { vars: ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m'] },
  pressure: { vars: ['pressure_msl'] },
  precipitation: { vars: ['precipitation'] },
};

// 지도 종류(layer id) → [묶음 이름, 보여 줄 값을 꺼내는 함수]
export const LAYER_VALUE = {
  temperature: ['temperature', (v) => v.temperature_2m],
  'temperature-feel': ['temperature', (v) => v.apparent_temperature],
  humidity: ['humidity', (v) => v.relative_humidity_2m],
  'dew-point': ['humidity', (v) => v.dew_point_2m],
  'temperature-wet-bulb': ['humidity', (v) => v.wet_bulb_temperature_2m],
  'wind-speed': ['wind', (v) => Math.hypot(v.u, v.v)],
  'wind-gusts': ['wind', (v) => v.wind_gusts_10m],
  pressure: ['pressure', (v) => v.pressure_msl],
  precipitation: ['precipitation', (v) => v.precipitation],
};

// 확대 단계 → 격자 간격(도). 확대할수록 촘촘하게
export function gridStepFor(zoom) {
  if (zoom < 3) return 10;
  if (zoom < 4.5) return 5;
  if (zoom < 6) return 2.5;
  if (zoom < 7.5) return 1;
  return 0.5;
}

export class WeatherField {
  constructor(onUpdate) {
    this.onUpdate = onUpdate; // 새 값이 도착하면 부르는 함수 (지도 다시 그리기)
    this.points = new Map(); // "묶음|간격|i|j" → 값
    this.chunks = new Map(); // 묶음 키 → { at, status }
    this.queue = [];
    this.running = 0;
    this.failures = 0;
  }

  key(group, step, i, j) {
    return `${group}|${step}|${i}|${j}`;
  }

  // 화면 범위(위도·경도)에 필요한 묶음을 (없으면) 받아 오기 시작합니다
  ensure(group, step, bounds) {
    const now = Date.now();
    const nLon = Math.round(360 / step);
    const i0 = Math.floor((bounds.west + 180) / step) - 1;
    const i1 = Math.ceil((bounds.east + 180) / step) + 1;
    const j0 = Math.max(0, Math.floor((bounds.south + 90) / step) - 1);
    const j1 = Math.min(Math.round(180 / step), Math.ceil((bounds.north + 90) / step) + 1);
    const wanted = new Set();
    for (let i = i0; i <= i1; i++) {
      const wi = ((i % nLon) + nLon) % nLon;
      for (let j = j0; j <= j1; j++) wanted.add(`${group}|${step}|${Math.floor(wi / CHUNK)}|${Math.floor(j / CHUNK)}`);
    }
    // 화면이 바뀌었으면 (같은 종류의) 아직 보내지 않은 옛 요청은 버립니다
    this.queue = this.queue.filter((c) => !c.startsWith(`${group}|`) || wanted.has(c));
    for (const chunkKey of wanted) {
      const info = this.chunks.get(chunkKey);
      if (info && (info.status === 'loading' || now - info.at < (info.status === 'ok' ? KEEP_MS : 60000))) continue;
      if (!this.queue.includes(chunkKey)) this.queue.push(chunkKey);
    }
    this.pump();
  }

  pump() {
    while (this.running < MAX_PARALLEL && this.queue.length) {
      const chunkKey = this.queue.shift();
      this.running++;
      this.chunks.set(chunkKey, { at: Date.now(), status: 'loading' });
      this.fetchChunk(chunkKey)
        .then(() => {
          this.chunks.set(chunkKey, { at: Date.now(), status: 'ok' });
          this.failures = 0;
        })
        .catch(() => {
          this.chunks.set(chunkKey, { at: Date.now(), status: 'error' });
          this.failures++;
        })
        .finally(() => {
          this.running--;
          this.onUpdate?.();
          this.pump();
        });
    }
  }

  // 묶음 하나(최대 8×8 점) 받기
  async fetchChunk(chunkKey) {
    const [group, stepText, ciText, cjText] = chunkKey.split('|');
    const step = Number(stepText);
    const ci = Number(ciText);
    const cj = Number(cjText);
    const nLon = Math.round(360 / step);
    const nLat = Math.round(180 / step);
    const cells = [];
    for (let j = cj * CHUNK; j < (cj + 1) * CHUNK && j <= nLat; j++) {
      const lat = -90 + j * step;
      if (Math.abs(lat) > 85) continue; // 극지방은 메르카토르 지도에 안 보입니다
      for (let i = ci * CHUNK; i < (ci + 1) * CHUNK && i < nLon; i++) {
        cells.push({ i, j, lat, lon: -180 + i * step });
      }
    }
    if (!cells.length) return;
    const params = new URLSearchParams({
      latitude: cells.map((c) => c.lat.toFixed(2)).join(','),
      longitude: cells.map((c) => c.lon.toFixed(2)).join(','),
      current: FIELD_GROUPS[group].vars.join(','),
      timezone: 'GMT',
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
      let data = await response.json();
      if (!Array.isArray(data)) data = [data];
      data.forEach((item, n) => {
        const cell = cells[n];
        const value = { ...item.current };
        if (group === 'wind') {
          // 풍향은 "불어오는 쪽"이므로, 바람이 가는 방향의 동쪽(u)·북쪽(v) 성분으로 바꿉니다
          const rad = (value.wind_direction_10m * Math.PI) / 180;
          value.u = -value.wind_speed_10m * Math.sin(rad);
          value.v = -value.wind_speed_10m * Math.cos(rad);
        }
        if (cell) this.points.set(this.key(group, step, cell.i, cell.j), value);
      });
      this.time = data[0]?.current?.time; // 값의 기준 시각 (UTC)
    } finally {
      clearTimeout(timer);
    }
  }

  // 한 위치의 값 (주변 4점 보간). 아직 값이 없으면 null
  // pick: 값 객체에서 숫자 하나를 꺼내는 함수
  sample(group, step, lat, lon, pick) {
    const fi = (lon + 180) / step;
    const fj = (lat + 90) / step;
    const i = Math.floor(fi);
    const j = Math.floor(fj);
    const tx = fi - i;
    const ty = fj - j;
    const nLon = Math.round(360 / step);
    const wrap = (k) => ((k % nLon) + nLon) % nLon;
    const a = this.points.get(this.key(group, step, wrap(i), j));
    const b = this.points.get(this.key(group, step, wrap(i + 1), j));
    const c = this.points.get(this.key(group, step, wrap(i), j + 1));
    const d = this.points.get(this.key(group, step, wrap(i + 1), j + 1));
    if (!a || !b || !c || !d) return null;
    const va = pick(a);
    const vb = pick(b);
    const vc = pick(c);
    const vd = pick(d);
    if ([va, vb, vc, vd].some((v) => v == null || Number.isNaN(v))) return null;
    return (va * (1 - tx) + vb * tx) * (1 - ty) + (vc * (1 - tx) + vd * tx) * ty;
  }

  // 바람 (동쪽·북쪽 성분, km/h)
  wind(step, lat, lon) {
    const u = this.sample('wind', step, lat, lon, (v) => v.u);
    if (u == null) return null;
    return { u, v: this.sample('wind', step, lat, lon, (v) => v.v) };
  }
}
