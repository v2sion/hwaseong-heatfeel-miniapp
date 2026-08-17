import { defineConfig } from 'vite';

// outDir을 dist/web으로 고정한다. 앱인토스 CLI(ait build)가 granite.config.ts의
// web.commands.build 실행 결과를 <outdir>/web/index.html 위치에서 찾기 때문에,
// Vercel 배포와 앱인토스 패키징이 같은 빌드 산출물을 공유하도록 맞춘 것.
// (vercel.json의 outputDirectory도 dist/web으로 함께 맞춰야 한다.)
// dev 포트는 미니앱마다 고유값으로 고정한다(무더위 체감 랭킹=5174). strictPort로
// 못 박아서, 포트가 이미 점유돼 있으면 조용히 다른 포트로 옮겨가지 않고 즉시 실패하게 한다.
// (.claude/launch.json이 선언한 포트와 실제 포트가 어긋나면 미리보기 접속이 실패함)
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist/web',
  },
});
