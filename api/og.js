// GET /api/og?region=..&temp=..&rank=..&copy=..
// 공유 시 카카오톡/문자 등 링크 미리보기에 노출되는 이미지를 공유하는 사람의 실제
// 지역/온도/순위로 개인화해서 생성한다(F4, 2026-07-17). Edge Runtime + @vercel/og(Satori
// 기반) - 별도 배포/과금 없이 Vercel 기본 Edge Function으로 동작한다.
// JSX 대신 Satori가 기대하는 { type, props: { style, children } } 트리를 직접 구성한다 -
// 이 프로젝트 api/ 폴더는 plain .js(ESM)라 JSX 빌드 설정이 없다.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const HEAT_COLORS = {
  cool: '#049E88',
  warm: '#57A56E',
  hot: '#F2B33D',
  veryHot: '#E8804B',
  extreme: '#C23616',
};

function bracketOf(temp){
  if(temp >= 38) return 'extreme';
  if(temp >= 35) return 'veryHot';
  if(temp >= 33) return 'hot';
  if(temp >= 30) return 'warm';
  return 'cool';
}

function el(type, style, children){
  return { type, props: { style, children } };
}

let fontDataPromise;
function loadFont(){
  if(!fontDataPromise){
    fontDataPromise = fetch('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-Bold.otf')
      .then(res => res.arrayBuffer());
  }
  return fontDataPromise;
}

export default async function handler(req){
  const { searchParams } = new URL(req.url);
  const region = searchParams.get('region') || '전국';
  const temp = parseFloat(searchParams.get('temp'));
  const safeTemp = Number.isFinite(temp) ? temp : 33;
  const rank = searchParams.get('rank') || '10';
  const copy = searchParams.get('copy') || '오늘 체감온도를 확인해보세요';
  const color = HEAT_COLORS[bracketOf(safeTemp)];

  const fontData = await loadFont();

  return new ImageResponse(
    el('div', {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '64px',
      background: `linear-gradient(135deg, ${color}, #1a1a1a)`,
      fontFamily: 'Pretendard',
    }, [
      el('div', { display: 'flex', color: '#fff', fontSize: 32, opacity: 0.85 }, '무더위 체감 랭킹'),
      el('div', { display: 'flex', flexDirection: 'column', gap: 12 }, [
        el('div', { display: 'flex', color: '#fff', fontSize: 44 }, `${region} · 상위 ${rank}%`),
        el('div', { display: 'flex', color: '#fff', fontSize: 120, fontWeight: 700 }, `${safeTemp}°`),
        el('div', { display: 'flex', color: '#fff', fontSize: 30, opacity: 0.9, maxWidth: 900 }, copy),
      ]),
    ]),
    {
      width: 1200,
      height: 630,
      fonts: [{ name: 'Pretendard', data: fontData, style: 'normal', weight: 700 }],
    }
  );
}
