// 숫자·시간·좌표를 보기 좋게 바꾸는 도우미 함수들

// 36.39 → "36° 23′ 북"
export function formatDegrees(value, positive, negative) {
  const abs = Math.abs(value);
  let degrees = Math.floor(abs);
  let minutes = Math.round((abs - degrees) * 60);
  if (minutes === 60) {
    degrees += 1;
    minutes = 0;
  }
  return `${degrees}° ${minutes}′ ${value >= 0 ? positive : negative}`;
}

export function formatLat(lat, decimal = false) {
  if (decimal) return `${lat.toFixed(4)}°`;
  return formatDegrees(lat, '북', '남');
}

export function formatLon(lon, decimal = false) {
  if (decimal) return `${lon.toFixed(4)}°`;
  return formatDegrees(lon, '동', '서');
}

// 축척 막대: 50~110px 정도가 되는 "딱 떨어지는 거리"를 고릅니다
export function scaleBar(metersPerPixel, miles = false) {
  const unit = miles ? 1609.344 : 1000;
  const smallUnit = miles ? 0.3048 : 1; // 피트 / 미터
  const maxPx = 110;
  const maxDistance = metersPerPixel * maxPx;
  const nice = (value) => {
    const p = 10 ** Math.floor(Math.log10(value));
    const d = value / p;
    return (d >= 5 ? 5 : d >= 2 ? 2 : 1) * p;
  };
  if (maxDistance >= unit) {
    const value = nice(maxDistance / unit);
    return { width: Math.round((value * unit) / metersPerPixel), label: `${value} ${miles ? 'mi' : 'km'}` };
  }
  const value = nice(maxDistance / smallUnit);
  return { width: Math.round((value * smallUnit) / metersPerPixel), label: `${value} ${miles ? 'ft' : 'm'}` };
}

// 가장 최근 위성 사진 시각: 지금을 10분 단위로 내림하고 10분 뺀 시각
export function latestImageTime(now = new Date()) {
  const t = new Date(now.getTime() - 10 * 60000);
  t.setSeconds(0, 0);
  t.setMinutes(Math.floor(t.getMinutes() / 10) * 10);
  return t;
}

// 시계 표시용 조각들
export function clockParts(date, { utc = false, hour12 = false } = {}) {
  const month = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  let hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  let ampm = '';
  if (hour12) {
    ampm = hour < 12 ? '오전' : '오후';
    hour = hour % 12 || 12;
  }
  return {
    month: `${month + 1}월`,
    day: `${day}일`,
    hour: String(hour).padStart(2, '0'),
    minute: String(minute).padStart(2, '0'),
    ampm,
  };
}

// 두 지점 사이 거리 (km) — 지구를 공 모양으로 보고 계산
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 여러 점으로 이루어진 다각형의 넓이 (km², 대략값)
export function areaKm2(points) {
  if (points.length < 3) return 0;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += toRad(b.lon - a.lon) * (2 + Math.sin(toRad(a.lat)) + Math.sin(toRad(b.lat)));
  }
  return Math.abs((sum * R * R) / 2);
}

export const formatNumber = (n) => Math.round(n).toLocaleString('ko-KR');
