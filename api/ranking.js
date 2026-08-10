// GET /api/ranking
// /api/collect가 미리 모아둔 전국 랭킹 캐시(Vercel Blob)를 그대로 읽어 반환한다.
// OpenWeatherMap을 직접 호출하지 않으므로 트래픽이 몰려도 빠르고 API 호출량에 영향 없다.

import { head } from '@vercel/blob';

const LATEST_KEY = 'ranking/latest.json';

// 웜 인스턴스 내 URL 재사용 — 콜드스타트 시에만 head()(Advanced Operation)를 1회 호출하고
// 이후 동일 인스턴스로 들어오는 요청은 저장된 URL로 직접 fetch한다.
// Vercel Blob Advanced Operations 절약 목적(2026-08-10).
let _downloadUrl = null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (!_downloadUrl) {
      const meta = await head(LATEST_KEY);
      _downloadUrl = meta.downloadUrl;
    }
    const upstream = await fetch(`${_downloadUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!upstream.ok) throw new Error(`blob fetch failed: ${upstream.status}`);
    const data = await upstream.json();

    // 크론이 1시간 간격이므로 CDN 캐시도 1시간으로 맞춤 — 대부분의 요청이 함수 호출 없이 처리됨.
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=120');
    return res.status(200).json(data);
  } catch (err) {
    _downloadUrl = null; // 오류 시 초기화해 다음 요청에서 재시도
    return res.status(404).json({ error: '아직 수집된 랭킹 데이터가 없습니다. /api/collect가 최소 한 번 완료되어야 합니다.' });
  }
}
