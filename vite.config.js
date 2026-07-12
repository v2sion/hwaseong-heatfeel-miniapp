import { defineConfig } from 'vite';

// outDir을 dist/web으로 고정한다. 앱인토스 CLI(ait build)가 granite.config.ts의
// web.commands.build 실행 결과를 <outdir>/web/index.html 위치에서 찾기 때문에,
// Vercel 배포와 앱인토스 패키징이 같은 빌드 산출물을 공유하도록 맞춘 것.
// (vercel.json의 outputDirectory도 dist/web으로 함께 맞춰야 한다.)
export default defineConfig({
  build: {
    outDir: 'dist/web',
  },
});
