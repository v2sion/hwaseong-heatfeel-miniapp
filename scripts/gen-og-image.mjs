// 일회성 스크립트: 카카오톡 등에 쓰일 고정 대표 OG 이미지를 1200x630(랜드스케이프, 카카오 권장 비율에 근접)으로
// 생성해 public/og-image.png로 저장한다. 예전 /api/og(사용자별 동적 생성, 폐기됨)와 같은 렌더링 방식을
// 딱 한 번만 로컬에서 실행 - 런타임에는 이 정적 파일만 서빙된다.
import { ImageResponse } from '@vercel/og';
import { writeFile } from 'fs/promises';

function el(type, style, children){
  return { type, props: { style, children } };
}

async function main(){
  const fontData = await fetch('https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/static/Pretendard-Bold.otf')
    .then(res => res.arrayBuffer());

  const image = new ImageResponse(
    el('div', {
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '64px',
      background: 'linear-gradient(135deg, #F2B33D, #1a1a1a)',
      fontFamily: 'Pretendard',
    }, [
      el('div', { display: 'flex', color: '#fff', fontSize: 32, opacity: 0.85 }, '무더위 체감 랭킹'),
      el('div', { display: 'flex', flexDirection: 'column', gap: 16 }, [
        el('div', { display: 'flex', color: '#fff', fontSize: 64, fontWeight: 700, lineHeight: 1.3 }, '우리 동네는 전국 몇 등으로 더울까?'),
        el('div', { display: 'flex', color: '#fff', fontSize: 28, opacity: 0.9 }, '#오늘체감온도챌린지 · 전국 256개 시군구 비교'),
      ]),
    ]),
    {
      width: 1200,
      height: 630,
      fonts: [{ name: 'Pretendard', data: fontData, style: 'normal', weight: 700 }],
    }
  );

  const buffer = Buffer.from(await image.arrayBuffer());
  await writeFile('public/og-image.png', buffer);
  console.log('wrote public/og-image.png', buffer.length, 'bytes');
}

main();
