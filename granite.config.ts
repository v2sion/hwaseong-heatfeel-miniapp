import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'mudeowerank',
  brand: {
    displayName: '무더위 체감 랭킹',
    primaryColor: '#FF6B35',
    icon: 'https://app-tau-ten-42.vercel.app/logo.png', // 디자인 산출물의 final_app_icon_light.png
  },
  web: {
    host: 'localhost',
    // 포트는 앱마다 고유값으로 고정. vite.config.js(strictPort)와 .claude/launch.json이
    // 같은 값을 쓰므로 셋 중 하나만 바꾸지 말 것.
    port: 5174,
    commands: {
      dev: 'vite',
      build: 'vite build',
    },
  },
  // getCurrentLocation() 브릿지 호출(F1)에 필요한 권한 선언.
  permissions: [{ name: 'geolocation', access: 'access' }],
  // navigationBar: 설정하지 않음. 주의 - "생략 = 네이티브 바 안 뜸"이 아니다. web-framework의
  // defineConfig가 { withBackButton:true, withHomeButton:false, withTitle:true,
  // transparentBackground:false }를 기본값으로 deep-merge하므로, 생략해도 네이티브 바(뒤로가기+
  // 앱 이름/로고)는 항상 노출된다. 화면 안 커스텀 topbar의 뒤로가기 버튼과 중복되지 않도록
  // main.js에서 브릿지 감지 시 body.no-native-nav를 빼서 .backbtn을 숨김(index.html CSS 참고) -
  // 앱인토스 비게임 출시 체크리스트 "뒤로가기 버튼 중복 노출 금지" 대응.
  outdir: 'dist',
});
