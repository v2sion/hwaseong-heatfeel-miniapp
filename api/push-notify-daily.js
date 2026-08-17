// GET /api/push-notify-daily  - Vercel Cron (vercel.json "0 23 * * *" = KST 08:00)
// F6-4(2026-08-01): 매일 아침 체감온도 알림을 구독한 유저 전원에게 기능성 푸시를 발송한다.
// push-consent/ Blob 목록을 순회하여 anonKey 단위로 Toss mTLS API를 호출한다.
// 주의: Toss 기능성 알림 send API(경로/body 형식)는 파트너 문서 기준으로 확인 후 수정할 것.
import { list } from '@vercel/blob';
import { tossApiRequest } from './_lib/tossMtlsClient.js';

const BLOB_PREFIX = 'push-consent/';
// agreementId 112117, stdConsentCode 'STD_52367_112117_PARTNER', subscriptionTemplateId 5030
const SUBSCRIPTION_CODE = 'STD_52367_112117_PARTNER';
const SEND_PATH = '/api-partner/v1/apps-in-toss/messenger/send-message';

const NOTIFY_TITLE = '☀️ 오늘 체감온도 순위';
const NOTIFY_BODY  = '지금 우리 동네가 전국 몇 위인지 확인해봐요!';

async function listAllSubscribers() {
  const keys = [];
  let cursor;
  do {
    const { blobs, cursor: next } = await list({
      prefix: BLOB_PREFIX,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    for (const b of blobs) {
      try {
        const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) continue;
        const data = await r.json();
        if (data.anonKey) keys.push(data.anonKey);
      } catch {
        // 개별 blob 읽기 실패 시 스킵 - 전체 발송 중단하지 않는다
      }
    }
    cursor = next;
  } while (cursor);
  return keys;
}

export default async function handler(req, res) {
  // Vercel Cron은 Authorization: Bearer <CRON_SECRET> 헤더를 자동으로 붙인다.
  // CRON_SECRET 환경변수가 설정된 경우에만 검증하고, 미설정 시 경고만 남긴다.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '');
    if (auth !== secret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  } else {
    console.warn('CRON_SECRET 미설정 - 인증 없이 실행됩니다.');
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  let subscribers;
  try {
    subscribers = await listAllSubscribers();
  } catch (err) {
    console.error('구독자 목록 조회 실패:', err);
    res.status(500).json({ error: 'list failed' });
    return;
  }

  if (subscribers.length === 0) {
    res.status(200).json({ sent: 0, message: '구독자 없음' });
    return;
  }

  let sent = 0;
  const errors = [];
  for (const anonKey of subscribers) {
    try {
      const result = await tossApiRequest(SEND_PATH, {
        method: 'POST',
        body: {
          subscriptionCode: SUBSCRIPTION_CODE,
          userKey: anonKey,
          message: { title: NOTIFY_TITLE, body: NOTIFY_BODY },
        },
      });
      if (result.statusCode >= 200 && result.statusCode < 300) {
        sent++;
      } else {
        errors.push({ anonKey: anonKey.slice(0, 8), status: result.statusCode });
      }
    } catch (err) {
      errors.push({ anonKey: anonKey.slice(0, 8), error: String(err.message) });
    }
  }

  console.log(`[push-notify-daily] 구독자 ${subscribers.length}명, 발송 성공 ${sent}건, 실패 ${errors.length}건`);
  res.status(200).json({ sent, total: subscribers.length, errors });
}
