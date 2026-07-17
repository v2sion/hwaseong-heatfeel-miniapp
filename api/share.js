// GET /s/:id  (rewrite → /api/share?id=:id)  또는 구버전 호환 /api/share?region=..&temp=..&rank=..&copy=..
// 카카오톡/문자 등에 공유될 때 실제로 열리는 링크(F4). 이 SPA는 정적 index.html이라
// URL에 따라 메타태그를 바꿀 수 없어서, 링크 미리보기 크롤러 전용 HTML을 여기서 직접
// 서버 렌더링한다. 실제 사람이 이 링크를 열면 즉시 앱 홈으로 리다이렉트된다(크롤러는
// 리다이렉트를 따라가지 않고 메타태그만 읽는다).
//
// (2026-07-17 2차 개편) 개인화 데이터(지역/온도/순위/카피)를 URL 쿼리에 그대로 실으면
// 한글 인코딩 때문에 200~300자 넘는 링크가 돼 카카오톡에서 "이상한 링크"처럼 보이는
// 문제가 있었다 → /api/shorten이 미리 Vercel Blob에 저장해둔 데이터를 id로 조회하는
// 방식으로 교체, 실제 공유 링크는 짧은 `/s/{id}` 형태가 된다(쿼리 방식은 구버전 링크
// 호환용으로만 남김). og:image도 사용자마다 새로 그리던 동적 이미지(/api/og, Satori로
// 매 요청 폰트를 원격에서 받아와 콜드스타트 3초+)를 폐기하고, 고정된 대표 이미지
// (og-image.png)로 교체했다 - 카카오톡 크롤러가 느린 이미지 응답을 기다려주지 않아
// 미리보기에 이미지가 아예 안 뜨던 문제의 원인이었음.
import { head } from '@vercel/blob';

const APP_ORIGIN = 'https://app-tau-ten-42.vercel.app';
const OG_IMAGE_URL = `${APP_ORIGIN}/og-image.png`;

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function readSharePayload(id){
  if(!id) return null;
  try{
    const meta = await head(`share/${id}.json`);
    const res = await fetch(`${meta.downloadUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if(!res.ok) return null;
    return await res.json();
  }catch(err){
    return null; // 만료/오타 id 등 - 아래에서 기본값으로 폴백
  }
}

export default async function handler(req, res){
  const stored = await readSharePayload(req.query.id);

  const region = String(stored?.region || req.query.region || '전국');
  const temp = String(stored?.temp || req.query.temp || '33');
  const rank = String(stored?.rank || req.query.rank || '10');
  const copy = String(stored?.copy || req.query.copy || '오늘 체감온도를 확인해보세요');

  const title = `${region} 체감온도 ${temp}° · 상위 ${rank}%`;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  res.status(200).send(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(copy)}" />
<meta property="og:image" content="${OG_IMAGE_URL}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta http-equiv="refresh" content="0; url=${APP_ORIGIN}/" />
<script>location.replace(${JSON.stringify(APP_ORIGIN + '/')});</script>
</head>
<body>
<p>무더위 체감 랭킹으로 이동 중이에요...</p>
</body>
</html>`);
}
