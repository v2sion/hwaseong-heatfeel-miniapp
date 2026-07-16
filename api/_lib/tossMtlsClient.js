// 앱인토스 서버-서버 API(mTLS 필수: 스마트 발송/알림, 포인트 프로모션 등) 공용 클라이언트.
// 인증서/키는 Vercel 환경변수에 base64 문자열로 저장돼 있다(TOSS_MTLS_CERT_B64/TOSS_MTLS_KEY_B64) —
// PEM 원문을 그대로 넣으면 개행 처리가 플랫폼별로 깨지는 문제(01_개발_브리핑.md 참고)를 피하기 위함.
import https from 'node:https';

const TOSS_API_HOST = 'apps-in-toss-api.toss.im';

let cachedAgent = null;

function getTossMtlsAgent() {
  if (cachedAgent) return cachedAgent;

  const certB64 = process.env.TOSS_MTLS_CERT_B64;
  const keyB64 = process.env.TOSS_MTLS_KEY_B64;
  if (!certB64 || !keyB64) {
    throw new Error('TOSS_MTLS_CERT_B64 / TOSS_MTLS_KEY_B64 환경변수가 설정되지 않았습니다.');
  }

  cachedAgent = new https.Agent({
    cert: Buffer.from(certB64, 'base64').toString('utf8'),
    key: Buffer.from(keyB64, 'base64').toString('utf8'),
    keepAlive: true,
  });
  return cachedAgent;
}

// path 예: '/api-partner/v1/apps-in-toss/messenger/send-message'
export function tossApiRequest(path, { method = 'POST', headers = {}, body } = {}) {
  const agent = getTossMtlsAgent();
  const payload = body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: TOSS_API_HOST,
        path,
        method,
        agent,
        headers: {
          'content-type': 'application/json',
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
