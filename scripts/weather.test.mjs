import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/weather.js';

const realFetch = globalThis.fetch;
process.env.OPENWEATHERMAP_API_KEY = 'test-key';

function mockRes() {
  return {
    code: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function upstream(status, body = {}) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

async function call(query, fetchImpl) {
  globalThis.fetch = fetchImpl;
  try {
    const res = mockRes();
    await handler({ query }, res);
    return res;
  } finally {
    globalThis.fetch = realFetch;
  }
}

const OK_BODY = { name: 'Gangnam', main: { feels_like: 31.2, temp: 29.5, humidity: 70 } };

test('AC-1 정상 응답은 기존 필드와 캐시 헤더를 유지한다', async () => {
  const res = await call({ lat: '37.5', lon: '127.03' }, upstream(200, OK_BODY));
  assert.equal(res.code, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['feelsLike', 'humidity', 'regionName', 'temp', 'updatedAt']);
  assert.equal(res.body.regionName, 'Gangnam');
  assert.equal(res.headers['Cache-Control'], 's-maxage=3600, stale-while-revalidate=600');
});

test('AC-2 업스트림 지연 시 504, 5초 타임아웃 요청, 캐시 헤더 없음', async () => {
  const realTimeout = AbortSignal.timeout;
  let requestedMs;
  // 5초를 실제로 기다리지 않도록 timeout 신호를 즉시 만료시킨다
  AbortSignal.timeout = (ms) => {
    requestedMs = ms;
    return AbortSignal.abort(new DOMException('timed out', 'TimeoutError'));
  };
  try {
    const hang = (url, opts) => new Promise((_, reject) => {
      if (opts?.signal?.aborted) reject(opts.signal.reason);
      // signal이 없거나 abort되지 않으면 영원히 대기 -> 테스트가 타임아웃으로 실패한다
    });
    const res = await call({}, hang);
    assert.equal(requestedMs, 5000);
    assert.equal(res.code, 504);
    assert.ok(res.body.error);
    assert.equal(res.headers['Cache-Control'], undefined);
  } finally {
    AbortSignal.timeout = realTimeout;
  }
});

for (const s of [401, 403, 429, 500, 503]) {
  test(`AC-3 업스트림 ${s} -> 502`, async () => {
    const res = await call({}, upstream(s));
    assert.equal(res.code, 502);
    assert.ok(res.body.error);
  });
}

test('AC-4 업스트림 404 등 그 외 4xx는 상태 코드 유지', async () => {
  assert.equal((await call({}, upstream(404))).code, 404);
  assert.equal((await call({}, upstream(400))).code, 400);
  assert.equal((await call({}, upstream(499))).code, 499);
});

test('AC-5 기존 동작 유지: 키 없음, 범위 초과, 기본 좌표, 네트워크 오류', async () => {
  const saved = process.env.OPENWEATHERMAP_API_KEY;
  delete process.env.OPENWEATHERMAP_API_KEY;
  assert.equal((await call({}, upstream(200, OK_BODY))).code, 500);
  process.env.OPENWEATHERMAP_API_KEY = saved;

  assert.equal((await call({ lat: '100', lon: '127' }, upstream(200, OK_BODY))).code, 400);

  let calledUrl;
  await call({}, async (url) => { calledUrl = url; return { ok: true, status: 200, json: async () => OK_BODY }; });
  assert.match(calledUrl, /lat=37\.500889&lon=127\.035491/);

  const net = await call({}, async () => { throw new TypeError('fetch failed'); });
  assert.equal(net.code, 502);
});

test('AC-6 응답과 에러 본문에 API 키가 포함되지 않는다', async () => {
  const cases = [upstream(200, OK_BODY), upstream(401), upstream(404), async () => { throw new TypeError('x'); }];
  for (const f of cases) {
    const res = await call({}, f);
    assert.ok(!JSON.stringify(res.body).includes('test-key'));
  }
});
