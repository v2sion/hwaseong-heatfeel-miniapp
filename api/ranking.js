// GET /api/ranking
// /api/collect가 미리 모아둔 전국 랭킹 캐시(Vercel Blob)를 그대로 읽어 반환한다.
// OpenWeatherMap을 직접 호출하지 않으므로 트래픽이 몰려도 빠르고 API 호출량에 영향 없다.

import { head } from '@vercel/blob';

const LATEST_KEY = 'ranking/latest.json';

export default async function handler(req, res) {
  try {
    const meta = await head(LATEST_KEY);
    const upstream = await fetch(`${meta.downloadUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!upstream.ok) throw new Error(`blob fetch failed: ${upstream.status}`);
    const data = await upstream.json();

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(404).json({ error: '아직 수집된 랭킹 데이터가 없습니다. /api/collect가 최소 한 번 완료되어야 합니다.' });
  }
}
