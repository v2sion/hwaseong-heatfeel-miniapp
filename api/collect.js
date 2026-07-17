// POST/GET /api/collect?chunk=0&total=5
// 전국 시군구(250개) 체감온도를 OpenWeatherMap에서 나눠 수집해 Vercel Blob에 캐싱한다.
// GitHub Actions가 30분마다 chunk=0..total-1을 순서대로, 각 호출 사이 딜레이를 두고 호출한다.
// (분당 60회 제한 때문에 한 번의 요청으로 250개를 다 모으지 않고, 조각으로 나눠 여러 번 호출하는 구조)
// CRON_SECRET으로 보호되어 있어 외부에서 무단으로 대량 호출할 수 없다.

import { put, head } from '@vercel/blob';
import REGIONS from '../data/sigungu.json';

const PARTIAL_KEY = 'ranking/partial.json';
const LATEST_KEY = 'ranking/latest.json';

async function readBlobJson(pathname) {
  // 방금 쓴 blob을 곧바로 다시 읽어야 하므로(청크 간 이어붙이기) CDN/fetch 캐시를 반드시 우회한다.
  const meta = await head(pathname);
  const res = await fetch(`${meta.downloadUrl}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
  return res.json();
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENWEATHERMAP_API_KEY가 설정되지 않았습니다.' });
  }

  const total = Math.min(20, Math.max(1, parseInt(req.query.total, 10) || 5));
  const chunk = Math.max(0, parseInt(req.query.chunk, 10) || 0);
  const chunkSize = Math.ceil(REGIONS.length / total);
  const start = chunk * chunkSize;
  const slice = REGIONS.slice(start, start + chunkSize);

  if (slice.length === 0) {
    return res.status(200).json({ chunk, total, skipped: true, reason: 'empty slice' });
  }

  // chunk 0은 새 수집 라운드의 시작 → 이전 partial을 무시하고 새로 시작
  let partial = { startedAt: new Date().toISOString(), results: {} };
  if (chunk > 0) {
    try {
      partial = await readBlobJson(PARTIAL_KEY);
    } catch (err) {
      // 이전 partial을 못 읽으면(수집 라운드가 꼬였거나 최초 실행) 이번 청크만으로 새로 시작
    }
  }

  const settled = await Promise.allSettled(
    slice.map(async (region) => {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${region.lat}&lon=${region.lon}&appid=${apiKey}&units=metric`;
      const upstream = await fetch(url);
      if (!upstream.ok) throw new Error(`upstream ${upstream.status} for ${region.code}`);
      const data = await upstream.json();
      return {
        code: region.code,
        nameKo: region.nameKo,
        lat: region.lat,
        lon: region.lon,
        feelsLike: data.main?.feels_like,
        temp: data.main?.temp,
      };
    })
  );

  let succeeded = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled' && typeof result.value.feelsLike === 'number') {
      partial.results[result.value.code] = result.value;
      succeeded += 1;
    }
  }

  const isLastChunk = chunk >= total - 1;

  if (!isLastChunk) {
    await put(PARTIAL_KEY, JSON.stringify(partial), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 0,
    });
    return res.status(200).json({
      chunk,
      total,
      fetchedThisChunk: succeeded,
      collectedSoFar: Object.keys(partial.results).length,
      done: false,
    });
  }

  // 마지막 청크: 전체 결과로 순위 + percentile 계산 후 최종본 저장
  const list = Object.values(partial.results).sort((a, b) => b.feelsLike - a.feelsLike);
  const totalCount = list.length;
  const ranked = list.map((r, i) => ({
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

  return res.status(200).json({
    chunk,
    total,
    fetchedThisChunk: succeeded,
    collectedSoFar: totalCount,
    done: true,
  });
}
