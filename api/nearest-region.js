// GET /api/nearest-region?lat=<위도>&lon=<경도>
// 사용자 좌표에서 가장 가까운 시군구, 그리고 그 시군구 안에서 가장 가까운 동을 찾는다.
// (실제 행정동 폴리곤 포함 판정이 아니라 centroid 최근접 매칭 — 경계 근처에서는 오차가 있을 수 있음)

import SIGUNGU from '../data/sigungu.json';
import DONG_BY_CITY from '../data/dong-all.json';

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearest(list, lat, lon, getLat, getLon) {
  let best = null;
  let bestDist = Infinity;
  for (const item of list) {
    const d = haversineKm(lat, lon, getLat(item), getLon(item));
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return { item: best, distanceKm: bestDist };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'lat/lon 쿼리 파라미터가 올바르지 않습니다.' });
  }

  const cityResult = findNearest(SIGUNGU, lat, lon, (c) => c.lat, (c) => c.lon);
  if (!cityResult.item) {
    return res.status(404).json({ error: '가장 가까운 시군구를 찾지 못했습니다.' });
  }

  const cityCode = cityResult.item.code;
  const dongs = DONG_BY_CITY[cityCode] || [];
  let dongResult = { item: null, distanceKm: null };
  if (dongs.length > 0) {
    dongResult = findNearest(dongs, lat, lon, (d) => d.lat, (d) => d.lon);
  }

  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
  return res.status(200).json({
    city: {
      code: cityCode,
      nameKo: cityResult.item.nameKo,
      lat: cityResult.item.lat,
      lon: cityResult.item.lon,
      distanceKm: Math.round(cityResult.distanceKm * 10) / 10,
    },
    dong: dongResult.item
      ? {
          code: dongResult.item.code,
          name: dongResult.item.name,
          lat: dongResult.item.lat,
          lon: dongResult.item.lon,
          distanceKm: Math.round(dongResult.distanceKm * 10) / 10,
        }
      : null,
  });
}
