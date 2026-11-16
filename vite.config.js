import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 빌드 결과는 dist 폴더에 정적 파일로 만들어집니다.
// BASE_PATH: 배포 주소의 앞부분 (GitHub Pages는 '/저장소이름/', 그 밖에는 '/')
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
