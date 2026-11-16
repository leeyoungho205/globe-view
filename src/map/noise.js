// 2D 그라디언트 노이즈 (펄린 노이즈와 비슷한 방식)
// 구름, 땅의 질감, 예보 지도처럼 "자연스럽게 불규칙한" 무늬를 만들 때 사용합니다.

const perm = new Uint8Array(512);
const gradX = new Float32Array(256);
const gradY = new Float32Array(256);

// 항상 같은 결과가 나오도록 고정된 씨앗(seed)으로 섞습니다.
(() => {
  let seed = 1337;
  const nextRandom = () => {
    seed = (seed * 16807) % 2147483647;
    return seed;
  };
  const table = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = nextRandom() % (i + 1);
    [table[i], table[j]] = [table[j], table[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = table[i & 255];
  for (let i = 0; i < 256; i++) {
    const angle = (nextRandom() / 2147483647) * Math.PI * 2;
    gradX[i] = Math.cos(angle);
    gradY[i] = Math.sin(angle);
  }
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// 한 겹짜리 노이즈: 대략 -0.7 ~ 0.7 사이 값
export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const X = xi & 255;
  const Y = yi & 255;
  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];
  const d00 = gradX[aa] * xf + gradY[aa] * yf;
  const d10 = gradX[ba] * (xf - 1) + gradY[ba] * yf;
  const d01 = gradX[ab] * xf + gradY[ab] * (yf - 1);
  const d11 = gradX[bb] * (xf - 1) + gradY[bb] * (yf - 1);
  const u = fade(xf);
  const v = fade(yf);
  const top = d00 + u * (d10 - d00);
  const bottom = d01 + u * (d11 - d01);
  return top + v * (bottom - top);
}

// 여러 겹을 겹친 노이즈(fBm): 큰 덩어리 + 잔무늬. 대략 -1 ~ 1 사이
export function fbm(x, y, octaves = 5, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq + i * 17.3, y * freq - i * 9.1);
    norm += amp;
    amp *= gain;
    freq *= 2.03;
  }
  return (sum / norm) * 1.6;
}

// 0~1 사이로 부드럽게 바꿔 주는 함수
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
