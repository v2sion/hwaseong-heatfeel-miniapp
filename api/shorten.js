// POST /api/shorten  { region, temp, rank, copy }
// 공유 링크에 담을 개인화 데이터(지역/온도/순위/카피)를 URL 쿼리스트링에 그대로 싣지 않고
// Vercel Blob에 짧은 코드로 저장해두기 위한 발급 엔드포인트(F4, 2026-07-17 2차 개편).
// 기존엔 이 값들을 그대로 URL에 넣어 카카오톡 등에 공유하면 한글 인코딩 때문에
// 200~300자 넘는 링크가 됐던 문제 - /api/share가 id로 이 값을 다시 읽어 렌더링한다.

import { put } from '@vercel/blob';
import crypto from 'crypto';

const MAX_LEN = 120; // 어뷰징/과대 payload 방지용 문자열 길이 제한

function clamp(value, fallback) {
  const str = String(value ?? fallback);
  return str.slice(0, MAX_LEN);
}

function randomId() {
  return crypto.randomBytes(4).toString('hex'); // 8자, 약 43억 조합
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 실기기(.ait로 패키징된 WebView)는 이 API와 다른 origin에서 로드되므로, JSON
  // POST 전에 브라우저가 보내는 CORS preflight(OPTIONS)를 반드시 성공시켜야 한다 -
  // 이걸 놓쳐서 POST 자체가 브라우저 단에서 막히고 있었음(2026-07-17 3차 수정).
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const payload = {
    region: clamp(body.region, '전국'),
    temp: clamp(body.temp, '33'),
    rank: clamp(body.rank, '10'),
    copy: clamp(body.copy, '오늘 체감온도를 확인해보세요'),
  };

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = randomId();
    try {
      await put(`share/${id}.json`, JSON.stringify(payload), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: false, // 같은 id가 이미 있으면(=충돌) 실패시키고 재시도
        contentType: 'application/json',
        cacheControlMaxAge: 86400,
      });
      res.status(200).json({ id, url: `https://app-tau-ten-42.vercel.app/s/${id}` });
      return;
    } catch (err) {
      lastErr = err;
    }
  }

  console.warn('짧은 공유 링크 발급 실패:', lastErr);
  res.status(500).json({ error: 'shorten failed' });
}
