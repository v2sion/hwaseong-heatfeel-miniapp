// POST /api/collect-finalize  { regions: [{code, nameKo, lat, lon, feelsLike, temp}, ...] }
// GitHub Actions가 /api/collect 청크 5개의 응답을 러너 메모리에서 직접 누적한 뒤, 그 합본을
// 여기로 딱 한 번만 보내 순위/percentile을 계산하고 Vercel Blob(ranking/latest.json)에
// 딱 1번만 쓴다. 라운드당 Blob Advanced Operations(put/list/copy)를 1회로 최소화하기 위한
// 구조 - 배경은 collect.js 헤더 주석 참고.
// CRON_SECRET으로 보호되어 있어 외부에서 무단으로 호출할 수 없다.
import { put } from '@vercel/blob';

const LATEST_KEY = 'ranking/latest.json';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const regions = Array.isArray(body?.regions) ? body.regions : [];
  const valid = regions.filter((r) => r && typeof r.feelsLike === 'number' && r.code);

  if (valid.length === 0) {
    return res.status(400).json({ error: '유효한 지역 데이터가 없습니다.' });
  }

  // 청크 경계에서 같은 지역 코드가 중복 전달돼도 안전하도록 코드 기준으로 한 번 더 정리
  const byCode = {};
  for (const r of valid) byCode[r.code] = r;
  const rankedList = Object.values(byCode).sort((a, b) => b.feelsLike - a.feelsLike);
  const totalCount = rankedList.length;
  const ranked = rankedList.map((r, i) => ({
    ...r,
    rank: i + 1,
    percentile: Math.max(1, Math.round(((i + 1) / totalCount) * 100)),
  }));

  const finalResult = {
    updatedAt: new Date().toISOString(),
    totalRegions: totalCount,
    regions: ranked,
  };

  await put(LATEST_KEY, JSON.stringify(finalResult), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });

  return res.status(200).json({ totalRegions: totalCount, done: true });
}
