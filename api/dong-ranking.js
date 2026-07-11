// GET /api/dong-ranking
// 화성시 읍/면/동(29개) 체감온도를 직접 병렬 조회해 순위/평균을 계산한다.
// 시군구(250개)와 달리 29개뿐이라 분당 요청 제한에 안전하게 걸리므로,
// /api/collect처럼 청크로 나눌 필요 없이 요청 하나로 끝낸다.
// CDN 캐시(s-maxage)로 시간당 1회 정도만 실제로 재수집되도록 한다.

import DONGS from '../data/hwaseong-dong.json';

export default async function handler(req, res) {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENWEATHERMAP_API_KEY가 설정되지 않았습니다.' });
  }

  const settled = await Promise.allSettled(
    DONGS.map(async (dong) => {
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

  const cityAverage =
    collected.reduce((sum, d) => sum + d.feelsLike, 0) / collected.length;

  const ranked = [...collected]
    .sort((a, b) => b.feelsLike - a.feelsLike)
    .map((d, i) => ({ ...d, rank: i + 1 }));

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  return res.status(200).json({
    updatedAt: new Date().toISOString(),
    cityAverage: Math.round(cityAverage * 10) / 10,
    totalDong: ranked.length,
    dong: ranked,
  });
}
