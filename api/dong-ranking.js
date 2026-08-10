// GET /api/dong-ranking?city=<시군구 코드>
// 요청받은 시/군구 안의 읍/면/동(최대 30개 내외) 체감온도를 직접 병렬 조회해 순위/평균을 계산한다.
// 전국 256개 시군구 x 평균 14개 동 = 3500여개를 매시간 전부 수집하면 OpenWeatherMap
// 무료 티어(월 100만 호출)를 초과하므로, 실제로 요청이 들어온 도시만 온디맨드로 계산하고
// Vercel Blob에 도시별로 캐싱한다(시간당 1회 정도만 재수집).

import { put, head } from '@vercel/blob';
import DONG_BY_CITY from '../data/dong-all.json';

// 도시별 Blob downloadUrl을 인스턴스 메모리에 캐싱 — 웜 인스턴스는 head()(Advanced Operation)
// 없이 저장된 URL로 직접 fetch한다. Vercel Blob Advanced Operations 절약 목적(2026-08-10).
const _cacheUrlByCity = new Map();

function cacheKey(cityCode) {
  return `dong-cache/${cityCode}.json`;
}

// (2026-07-25 재수정) 시 단위(/api/ranking)는 GitHub Actions가 매시 5분에 전국을
// 배치 수집(.github/workflows/collect-ranking.yml 참고)해서 항상 "정해진 시간 구간"의
// 스냅샷을 보여준다. 동 단위는 원래 "마지막 조회로부터 60분" 롤링 TTL이라, 같은 화면
// 안에서도 두 패널의 기준 시각이 서로 다른 임의의 시점으로 어긋나 보였음(정합성 피드백).
// API 호출량을 늘리지 않으면서(여전히 실제 요청 들어온 도시만 온디맨드) 시 단위와 같은
// 1시간 구간에 맞춰 갱신되도록, "마지막 갱신이 지금과 같은 1시간 구간인지"로 캐시 유효성을
// 판정하는 방식으로 바꾼다.
function bucketOf(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
}

async function readCached(cityCode) {
  try {
    let downloadUrl = _cacheUrlByCity.get(cityCode);
    if (!downloadUrl) {
      const meta = await head(cacheKey(cityCode));
      downloadUrl = meta.downloadUrl;
      _cacheUrlByCity.set(cityCode, downloadUrl);
    }
    const res = await fetch(`${downloadUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (bucketOf(new Date(data.updatedAt)) !== bucketOf(new Date())) return null;
    return data;
  } catch (err) {
    _cacheUrlByCity.delete(cityCode); // 오류 시 초기화해 다음 요청에서 재시도
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const cityCode = req.query.city;
  if (!cityCode) {
    return res.status(400).json({ error: 'city 쿼리 파라미터(시군구 코드)가 필요합니다.' });
  }

  const dongs = DONG_BY_CITY[cityCode];
  if (!dongs || dongs.length === 0) {
    return res.status(404).json({ error: `해당 시군구(${cityCode})의 동 단위 데이터가 없습니다.` });
  }

  const cached = await readCached(cityCode);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(cached);
  }

  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENWEATHERMAP_API_KEY가 설정되지 않았습니다.' });
  }

  const settled = await Promise.allSettled(
    dongs.map(async (dong) => {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${dong.lat}&lon=${dong.lon}&appid=${apiKey}&units=metric`;
      const upstream = await fetch(url);
      if (!upstream.ok) throw new Error(`upstream ${upstream.status} for ${dong.code}`);
      const data = await upstream.json();
      return { code: dong.code, name: dong.name, lat: dong.lat, lon: dong.lon, feelsLike: data.main?.feels_like };
    })
  );

  const collected = settled
    .filter((r) => r.status === 'fulfilled' && typeof r.value.feelsLike === 'number')
    .map((r) => r.value);

  if (collected.length === 0) {
    return res.status(502).json({ error: '동 단위 기상 데이터를 하나도 가져오지 못했습니다.' });
  }

  const cityAverage = collected.reduce((sum, d) => sum + d.feelsLike, 0) / collected.length;

  const ranked = [...collected]
    .sort((a, b) => b.feelsLike - a.feelsLike)
    .map((d, i) => ({ ...d, rank: i + 1 }));

  const result = {
    cityCode,
    updatedAt: new Date().toISOString(),
    cityAverage: Math.round(cityAverage * 10) / 10,
    totalDong: ranked.length,
    dong: ranked,
  };

  const putResult = await put(cacheKey(cityCode), JSON.stringify(result), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0,
  });
  // put() 반환 URL을 즉시 캐싱 — 다음 readCached에서 head() 없이 재사용.
  _cacheUrlByCity.set(cityCode, putResult.downloadUrl);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
  return res.status(200).json(result);
}
