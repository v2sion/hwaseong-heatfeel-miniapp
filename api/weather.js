// GET /api/weather?lat=..&lon=..
// OpenWeatherMap Classic Weather API 프록시. API 키를 클라이언트에 노출하지 않기 위해 서버에서만 호출한다.
const DEFAULT_COORD = { lat: 37.500889, lon: 127.035491 }; // 강남구 역삼1동

export default async function handler(req, res) {
  // 앱인토스로 패키징되면 프론트엔드가 Toss 도메인(apps.tossmini.com 등)에서 서빙되어
  // 이 API를 크로스 오리진으로 호출한다. 공개 날씨 데이터라 광범위 허용도 안전하다.
  res.setHeader('Access-Control-Allow-Origin', '*');
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENWEATHERMAP_API_KEY가 설정되지 않았습니다.' });
  }

  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const useLat = Number.isFinite(lat) ? lat : DEFAULT_COORD.lat;
  const useLon = Number.isFinite(lon) ? lon : DEFAULT_COORD.lon;

  if (Math.abs(useLat) > 90 || Math.abs(useLon) > 180) {
    return res.status(400).json({ error: '좌표 범위가 올바르지 않습니다.' });
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${useLat}&lon=${useLon}&appid=${apiKey}&units=metric&lang=kr`;
    const upstream = await fetch(url);

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: '기상 데이터 조회에 실패했습니다.' });
    }

    const data = await upstream.json();

    // 시간당 1회 정도만 오리진을 재조회하도록 CDN 캐시 지시 (요청마다 OpenWeatherMap 직접 호출 방지)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json({
      regionName: data.name,
      feelsLike: data.main?.feels_like,
      temp: data.main?.temp,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({ error: '기상 서버 연결에 실패했습니다.' });
  }
}
