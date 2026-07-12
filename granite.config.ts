import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'heatfeel-ranking',
  brand: {
    displayName: '무더위 체감 랭킹',
    primaryColor: '#FF6B35',
    icon: null, // TODO: 앱 아이콘 이미지 경로로 교체
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  permissions: [],
  outdir: 'dist',
});
