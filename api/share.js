// GET /api/share?region=..&temp=..&rank=..&copy=..
// 카카오톡/문자 등에 공유될 때 실제로 열리는 링크(F4, 2026-07-17). 이 SPA는 정적 index.html이라
// URL 쿼리에 따라 메타태그를 바꿀 수 없어서, 링크 미리보기 크롤러 전용 HTML을 여기서 직접
// 서버 렌더링한다. og:image는 /api/og(동적 이미지 생성)를 가리킨다. 실제 사람이 이 링크를
// 열면 즉시 앱 홈으로 리다이렉트된다(크롤러는 리다이렉트를 따라가지 않고 메타태그만 읽는다).
const APP_ORIGIN = 'https://app-tau-ten-42.vercel.app';

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default async function handler(req, res){
  const region = String(req.query.region || '전국');
  const temp = String(req.query.temp || '33');
  const rank = String(req.query.rank || '10');
  const copy = String(req.query.copy || '오늘 체감온도를 확인해보세요');

  const ogImageUrl = `${APP_ORIGIN}/api/og?${new URLSearchParams({ region, temp, rank, copy })}`;
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
<meta property="og:image" content="${ogImageUrl}" />
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
