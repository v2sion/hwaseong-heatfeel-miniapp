import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'heatfeel-ranking',
  brand: {
    displayName: '무더위 체감 랭킹',
    primaryColor: '#FF6B35',
    icon: 'https://app-tau-ten-42.vercel.app/logo.png', // 디자인 산출물의 final_app_icon_light.png
  },
  web: {
    host: 'localhost',
    port: 5173,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  // getCurrentLocation() 브릿지 호출(F1)에 필요한 권한 선언.
  permissions: [{ name: 'geolocation', access: 'access' }],
  // navigationBar: 설정하지 않음 - 화면 안에 커스텀 topbar(뒤로가기 버튼 포함, backEvent 연동됨)가
  // 이미 있으므로 네이티브 바를 겹쳐 띄우지 않는다. CLI 기본 템플릿도 이 필드를 생략한다.
  outdir: 'dist',
});
