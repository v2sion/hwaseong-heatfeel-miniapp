// POST /api/collect?chunk=0&total=5
// 전국 시군구(256개) 체감온도 중 한 조각(chunk)만 OpenWeatherMap에서 수집해 결과를 그대로
// 응답 본문(JSON)으로 돌려준다. Vercel Blob에는 전혀 쓰지 않는다 - GitHub Actions가 청크
// 5개의 응답을 직접 누적했다가 /api/collect-finalize에 한 번만 넘겨서 최종 저장한다.
// (분당 60회 제한 때문에 한 번의 요청으로 256개를 다 모으지 않고, 조각으로 나눠 여러 번 호출하는 구조)
// CRON_SECRET으로 보호되어 있어 외부에서 무단으로 대량 호출할 수 없다.
//
// (2026-07-26 3차 개편 배경) 이전엔 청크마다 Vercel Blob에 partial 파일을 썼다(청크마다
// put() 1회 + 마지막 청크가 list()+put()으로 합치는 구조, 라운드당 Advanced Operations
// 6~7회). 그 이전엔 한 파일을 여러 청크가 읽고-고쳐서-다시 쓰다가 Blob의 read-after-write
// 전파 지연으로 데이터가 통째로 유실되는 버그도 겪었다. 배치 주기를 30분으로 줄이며 Vercel
// Blob 무료 한도(Advanced Operations 월 2,000회)의 75%를 소진했다는 알림을 받은 게 발단 -
// 한도를 넘기면 Blob 저장소 자체가 최대 30일간 막혀 랭킹·동단위·공유링크 기능이 전부 죽는다.
// 청크 결과를 Blob이 아니라 이 함수를 호출하는 GitHub Actions 러너의 메모리에서 누적하도록
// 바꿔, 라운드당 Blob 쓰기를 최종 1회로 줄인다(collect-finalize.js 참고).
import REGIONS from '../data/sigungu.json';

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
    return res.status(200).json({ chunk, total, results: [] });
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

  const results = settled
    .filter((r) => r.status === 'fulfilled' && typeof r.value.feelsLike === 'number')
    .map((r) => r.value);

  return res.status(200).json({ chunk, total, fetchedThisChunk: results.length, results });
}
