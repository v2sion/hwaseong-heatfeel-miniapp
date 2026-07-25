// POST/GET /api/collect?chunk=0&total=5
// 전국 시군구(250개) 체감온도를 OpenWeatherMap에서 나눠 수집해 Vercel Blob에 캐싱한다.
// GitHub Actions가 30분마다 chunk=0..total-1을 순서대로, 각 호출 사이 딜레이를 두고 호출한다.
// (분당 60회 제한 때문에 한 번의 요청으로 250개를 다 모으지 않고, 조각으로 나눠 여러 번 호출하는 구조)
// CRON_SECRET으로 보호되어 있어 외부에서 무단으로 대량 호출할 수 없다.

// (2026-07-26 재수정) 예전엔 청크마다 공유 파일(ranking/partial.json)을 읽고-고쳐서-다시
// 쓰는 구조였는데, 실기기 QA로 실측한 결과 청크 3->4로 넘어가며 256개 중 104개가 통째로
// 유실되는 사례를 실제로 확인함(청크4가 partial.json을 읽었을 때 청크3가 방금 쓴 값이 아직
// 안 보이는 Vercel Blob read-after-write 지연이 원인 - comments.js 헤더 주석에 "랭킹
// 수집기에서 실제로 겪었던 문제"로 이미 기록돼 있던 바로 그 이슈가 원인 코드는 안 고쳐진 채
// 남아있었음). comments.js와 동일한 append-only 패턴으로 전환 - 청크마다 자기 몫만 독립된
// 파일에 쓰고 다른 청크의 파일을 읽어서 합치지 않으므로(각자 쓰기만 함) 읽기 경쟁 자체가
// 없다. 마지막 청크만 그동안 쌓인 모든 청크 파일을 모아 최종본을 만든다 - 이때도 자기 몫은
// 방금 쓴 blob을 다시 읽지 않고 메모리에 있는 값을 그대로 쓰고, 다른 청크(최소 65초 전에
// 쓰여 전파 지연 걱정이 없음)만 다시 읽는다.

import { put, list } from '@vercel/blob';
import REGIONS from '../data/sigungu.json';

const LATEST_KEY = 'ranking/latest.json';
const CHUNK_PREFIX = 'ranking/partial-chunk/';

function chunkKey(chunk) {
  return `${CHUNK_PREFIX}${chunk}.json`;
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

  const results = {};
  let succeeded = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled' && typeof result.value.feelsLike === 'number') {
      results[result.value.code] = result.value;
      succeeded += 1;
    }
  }

  // 이번 청크 몫을 독립된 파일에 저장 - 다른 청크의 파일은 절대 읽지 않는다(쓰기 전용).
  await put(chunkKey(chunk), JSON.stringify({ chunk, results }), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });

  const isLastChunk = chunk >= total - 1;

  if (!isLastChunk) {
    return res.status(200).json({
      chunk,
      total,
      fetchedThisChunk: succeeded,
      done: false,
    });
  }

  // 마지막 청크: 자기 몫(results)은 방금 계산한 메모리 값을 그대로 쓰고, 나머지 청크
  // 파일만 목록 조회 + 조회해서 합친다.
  const merged = { ...results };
  try {
    const { blobs } = await list({ prefix: CHUNK_PREFIX, limit: total + 5 });
    await Promise.all(
      blobs
        .filter((b) => b.pathname !== chunkKey(chunk))
        .map(async (b) => {
          try {
            const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' });
            if (!r.ok) return;
            const part = await r.json();
            Object.assign(merged, part.results);
          } catch (err) {
            // 청크 파일 하나를 못 읽어도 나머지로 계속 진행 - 완전 실패보다 부분 결과가 낫다
          }
        })
    );
  } catch (err) {
    // list() 자체가 실패해도 최소한 마지막 청크 몫으로는 최종본을 갱신한다
  }

  const rankedList = Object.values(merged).sort((a, b) => b.feelsLike - a.feelsLike);
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

  return res.status(200).json({
    chunk,
    total,
    fetchedThisChunk: succeeded,
    collectedSoFar: totalCount,
    done: true,
  });
}
