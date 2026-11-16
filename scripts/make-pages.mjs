// 빌드가 끝난 뒤, 도시마다 /places/나라/도시/index.html 페이지를 만들어 줍니다.
// (정적 서버에서도 도시 주소로 바로 들어갈 수 있도록)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cities } from '../src/data/places.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(join(root, 'index.html'), 'utf8');

for (const city of cities) {
  const folder = join(root, city.path);
  mkdirSync(folder, { recursive: true });
  const page = html.replace(/<title>[^<]*<\/title>/, `<title>${city.name} 날씨 | Globe View</title>`);
  writeFileSync(join(folder, 'index.html'), page);
}
// 없는 주소로 들어왔을 때도 지도를 보여 줍니다
writeFileSync(join(root, '404.html'), html);
console.log(`도시 페이지 ${cities.length}개를 만들었습니다.`);
