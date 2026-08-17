// GET  /api/push-consent?anonKey=...         - 현재 구독 상태 조회
// POST /api/push-consent { anonKey, action }  - 'subscribe' | 'unsubscribe'
// F6-4(2026-08-01): 기능성 알림 구독 동의 저장. Toss 플랫폼이 구독자 목록을 별도로
// 관리하지 않으므로, 우리 서버가 동의 내역을 보관했다가 push-notify-daily 크론에서
// 구독자별로 mTLS API를 호출할 때 이 목록을 참조한다.
import { put, head, del } from '@vercel/blob';

const BLOB_PREFIX = 'push-consent/';

function sanitizeKey(str) {
  return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

async function handleGet(req, res) {
  const anonKey = sanitizeKey(req.query.anonKey);
  if (!anonKey) { res.status(400).json({ error: 'missing anonKey' }); return; }

  try {
    await head(`${BLOB_PREFIX}${anonKey}.json`);
    res.status(200).json({ subscribed: true });
  } catch {
    res.status(200).json({ subscribed: false });
  }
}

async function handlePost(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const anonKey = sanitizeKey(body.anonKey);
  const action = body.action === 'unsubscribe' ? 'unsubscribe' : 'subscribe';

  if (!anonKey) { res.status(400).json({ error: 'missing anonKey' }); return; }

  const blobPath = `${BLOB_PREFIX}${anonKey}.json`;

  if (action === 'unsubscribe') {
    try {
      const meta = await head(blobPath);
      await del(meta.url);
    } catch {
      // 404면 이미 없는 것 - 정상 처리
    }
    res.status(200).json({ ok: true, subscribed: false });
    return;
  }

  // subscribe
  await put(
    blobPath,
    JSON.stringify({ anonKey, subscribedAt: new Date().toISOString() }),
    { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }
  );
  res.status(200).json({ ok: true, subscribed: true });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method === 'GET') { await handleGet(req, res); return; }
  if (req.method === 'POST') { await handlePost(req, res); return; }
  res.status(405).json({ error: 'method not allowed' });
}
