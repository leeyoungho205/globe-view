// 도시 5일 예보: Open-Meteo(무료·가입 없음)에서 실제 예보를 받아 옵니다.
// Open-Meteo는 여러 나라 기상청 모델(한국 KMA, 일본 JMA, 미국 GFS, 유럽 ECMWF 등)을 섞어 제공합니다.

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

// "UTC+9" 같은 표시 만들기 (offset은 시간 단위)
export function offsetLabel(offset) {
  const sign = offset >= 0 ? '+' : '−';
  const abs = Math.abs(offset);
  const hours = Math.floor(abs);
  const minutes = Math.round((abs - hours) * 60);
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

// 세계기상기구(WMO) 날씨 코드 → 아이콘 종류
// https://open-meteo.com/en/docs 의 "WMO Weather interpretation codes"
export function iconForCode(code) {
  if (code <= 1) return 'sun'; // 맑음, 대체로 맑음
  if (code === 2) return 'partly'; // 구름 조금
  if (code === 3 || code === 45 || code === 48) return 'cloud'; // 흐림, 안개
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'; // 눈
  return 'rain'; // 이슬비, 비, 소나기, 뇌우
}

// 같은 도시를 여러 번 열 때 다시 받지 않도록 30분 동안 기억합니다
const cache = new Map();
const KEEP_MS = 30 * 60000;

// 5일 예보 받기 → { days: [{ label, min, max, kind }], offset: UTC와의 시간 차 }
export async function loadForecast(place) {
  const key = place.path || `${place.lat},${place.lon}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.at < KEEP_MS) return saved.value;

  const params = new URLSearchParams({
    latitude: place.lat.toFixed(3),
    longitude: place.lon.toFixed(3),
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    timezone: 'auto',
    forecast_days: '5',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
    const data = await response.json();
    const { time, temperature_2m_max: max, temperature_2m_min: min, weather_code: code } = data.daily;
    const days = time.map((dateText, i) => {
      // "2026-11-13" 은 그 도시의 날짜이므로, 요일도 그 날짜로 계산합니다
      const [y, m, d] = dateText.split('-').map(Number);
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return {
        label: i === 0 ? '오늘' : WEEKDAYS[weekday],
        min: Math.round(min[i]),
        max: Math.round(max[i]),
        kind: iconForCode(code[i]),
      };
    });
    const value = { days, offset: data.utc_offset_seconds / 3600 };
    cache.set(key, { at: Date.now(), value });
    return value;
  } finally {
    clearTimeout(timer);
  }
}
