// GET  /api/comments?bracket=hot          - 해당 체감온도 브래킷의 최근 코멘트 목록
// POST /api/comments { anonKey, bracket, text } - 새 체감 코멘트 등록
// F5(2026-07-18): 체감 코멘트 버블. 각 코멘트를 독립된 blob 파일로 저장(공유 코드 발급 방식과
// 동일한 append-only 패턴) - 하나의 공유 파일을 여러 요청이 동시에 읽고-고쳐-쓰면 방금 쓴 값이
// 아직 안 보이는 read-after-write 불일치가 실제로 한 번 발목을 잡은 적이 있어서(랭킹 수집기),
// 그 패턴 자체를 피하려고 매 코멘트를 새 파일로 쓴다 - 동시 쓰기 충돌이 구조적으로 없다.
import { put, list, head } from '@vercel/blob';
import { containsBlockedWord } from './_lib/moderation.js';

const VALID_BRACKETS = ['cool', 'warm', 'hot', 'veryHot', 'extreme', 'tropicalNight'];
const MAX_TEXT_LEN = 30;
const LIST_LIMIT = 15;

function sanitizeKeyPart(str) {
  return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

// (2026-07-26 수정) 1일 1회 제한이 "한국 시간(KST, UTC+9) 자정 초기화"여야 하는데,
// Vercel 서버리스 함수는 기본적으로 UTC로 실행돼(TZ 환경변수 미설정) new Date()의 로컬
// getFullYear/Month/Date가 사실상 UTC 날짜를 반환하고 있었음 - 실제로는 KST 09시에
// 초기화되는 버그였다(KST 00~09시 사이엔 여전히 "어제 UTC 날짜"로 계산됨). UTC 시각에
// 9시간을 더한 뒤 UTC 접근자로 읽는 방식으로 서버 타임존과 무관하게 항상 KST 자정
// 기준으로 계산한다.
function todayStr() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

async function handleGet(req, res) {
  const bracket = VALID_BRACKETS.includes(req.query.bracket) ? req.query.bracket : null;
  if (!bracket) {
    res.status(400).json({ error: 'invalid bracket' });
    return;
  }
  try {
    const { blobs } = await list({ prefix: `comments/${bracket}/`, limit: LIST_LIMIT });
    // 파일명이 {13자리 ms 타임스탬프}-{id}.json이라 문자열 내림차순 정렬이 곧 최신순.
    const sorted = blobs.sort((a, b) => b.pathname.localeCompare(a.pathname)).slice(0, LIST_LIMIT);
    const items = await Promise.all(
      sorted.map(async (b) => {
        try {
          const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' });
          if (!r.ok) return null;
          const data = await r.json();
          return typeof data.text === 'string' ? data.text : null;
        } catch {
          return null;
        }
      })
    );
    // (2026-08-10) list()는 Advanced Operation으로 과금되므로 CDN 캐시를 5분으로 늘려
    // 동일 브래킷 반복 조회 시 함수 호출 자체를 줄인다.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    res.status(200).json({ comments: items.filter(Boolean) });
  } catch (err) {
    console.warn('comments list failed:', err);
    // 목록 조회 실패해도 버블 존이 그냥 비어 보일 뿐 화면이 죽지 않도록 빈 배열로 응답.
    res.status(200).json({ comments: [] });
  }
}

async function handlePost(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const bracket = VALID_BRACKETS.includes(body.bracket) ? body.bracket : null;
  const text = String(body.text || '').trim().slice(0, MAX_TEXT_LEN);
  const anonKey = sanitizeKeyPart(body.anonKey);

  if (!bracket) { res.status(400).json({ error: 'invalid bracket' }); return; }
  if (!text) { res.status(400).json({ error: 'empty text' }); return; }
  if (!anonKey) { res.status(400).json({ error: 'missing anonKey' }); return; }
  if (containsBlockedWord(text)) { res.status(400).json({ error: 'blocked_word' }); return; }

  // 1키 1일 1코멘트 제한(더위배틀과 동일 패턴) - 마커 blob 존재 여부로 판정.
  const rateLimitPath = `comments/_ratelimit/${anonKey}-${todayStr()}.json`;
  try {
    await head(rateLimitPath);
    res.status(429).json({ error: 'rate_limited' });
    return;
  } catch {
    // head 실패(404) = 아직 오늘 코멘트를 안 남김 = 정상 진행
  }

  try {
    const ts = Date.now();
    const id = Math.random().toString(36).slice(2, 8);
    await put(
      `comments/${bracket}/${ts}-${id}.json`,
      JSON.stringify({ text, createdAt: new Date(ts).toISOString() }),
      { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' }
    );
    await put(rateLimitPath, '1', {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'text/plain',
      cacheControlMaxAge: 90000, // 하루 + 여유
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.warn('comment write failed:', err);
    res.status(500).json({ error: 'write failed' });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 실기기(.ait로 패키징된 WebView)는 이 API와 다른 origin이라 POST 전에 브라우저가 보내는
  // CORS preflight(OPTIONS)를 반드시 성공시켜야 한다 - /api/shorten에서 이걸 놓쳐 실기기에서만
  // 재현되는 버그를 겪은 적이 있어(2026-07-17), 처음부터 넣어둔다.
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method === 'GET') { await handleGet(req, res); return; }
  if (req.method === 'POST') { await handlePost(req, res); return; }
  res.status(405).json({ error: 'method not allowed' });
}
