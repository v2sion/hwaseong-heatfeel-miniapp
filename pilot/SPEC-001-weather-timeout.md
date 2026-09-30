# SPEC: 날씨 프록시 API 타임아웃 및 업스트림 에러 정규화

> PM(Claude)이 작성 → 개발 에이전트(OpenCode/OMO)가 이 문서만 기준으로 구현 → QA(Claude)가 이 문서 기준으로 검증.
> 모호한 항목이 있으면 구현 전에 "질문" 섹션에 적고 멈출 것. 임의 해석 금지.

- 작업 ID: SPEC-001
- 작성일: 2026-09-30
- 대상 저장소/브랜치: `v2sion/hwaseong-heatfeel-miniapp` / 구현용 별도 브랜치(master에서 분기)
- 상태: Ready

## 1. 목표
`/api/weather`가 OpenWeatherMap 응답 지연 시 무한정 대기하지 않고, 업스트림의 인증·한도 오류가 클라이언트에 그대로 노출되지 않도록 한다.

## 2. 배경 / 이유
`api/weather.js`의 현재 동작(master 기준):
- `fetch(url)`에 타임아웃이 없다. 업스트림이 느리면 서버리스 함수가 플랫폼 제한 시간까지 붙잡힌다.
- `upstream.ok`가 아니면 `upstream.status`를 그대로 클라이언트에 반환한다. OpenWeatherMap이 401(키 오류)·429(한도 초과)를 주면 앱이 "우리 서버 인증 실패"처럼 보이는 상태 코드를 받는다.

## 3. 범위
### 포함 (In scope)
- [ ] 업스트림 fetch에 5초 타임아웃 적용, 초과 시 504 반환
- [ ] 업스트림 401/403/429/5xx는 클라이언트에 502로 통일
- [ ] 위 동작을 검증하는 Node 내장 테스트 추가 (fetch 모킹)

### 제외 (Non-goals) — 절대 건드리지 말 것
- `api/weather.js` 외 다른 `api/*.js` 수정
- 응답 JSON 필드(`regionName, feelsLike, temp, humidity, updatedAt`)와 `Cache-Control` 값 변경
- 좌표 반올림 등 캐시 키 최적화 (별도 SPEC 후보)
- `src/main.js`, `index.html`, `vercel.json`, 락 파일 수정
- 요청하지 않은 리팩터링, 포맷 변경, 주석 추가·삭제
- 새 의존성 추가

## 4. 수용 기준 (Acceptance Criteria)

| ID | 기준 (Given / When / Then) | 검증 방법 |
|---|---|---|
| AC-1 | 유효한 lat/lon이고 업스트림이 200이면, 기존과 동일한 JSON 필드와 `Cache-Control: s-maxage=3600, stale-while-revalidate=600`으로 200을 반환한다 | 테스트 |
| AC-2 | 업스트림 응답이 5초 안에 오지 않으면, 504와 `{ error }`를 반환하고 `Cache-Control`을 설정하지 않는다 | 테스트 (모킹된 fetch가 abort 신호에 reject) |
| AC-3 | 업스트림이 401, 403, 429, 500, 503 중 하나면, 클라이언트에는 502와 `{ error }`를 반환한다 | 테스트 |
| AC-4 | 업스트림이 404 등 위 목록 외 4xx면, 기존처럼 그 상태 코드를 그대로 반환한다 | 테스트 |
| AC-5 | 기존 동작 유지: API 키 없음 → 500, 좌표 범위 초과(예: lat=100) → 400, 좌표 미지정 → 기본 좌표(37.500889, 127.035491)로 호출, 네트워크 오류 → 502 | 테스트 |
| AC-6 | 응답 본문·에러 메시지에 API 키 문자열이 포함되지 않는다 | 테스트 |
| AC-7 | `npm run build`가 성공한다 | 빌드 |

## 5. 구조 / 설계
- 변경·추가할 파일 (이 목록 밖 파일 수정 금지):

| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `api/weather.js` | 수정 | 타임아웃, 상태 코드 정규화 |
| `scripts/weather.test.mjs` | 신규 | `node:test` 기반 테스트 |
| `package.json` | 수정 | `scripts`에 `"test": "node --test scripts/"` 한 줄만 추가 |

- 구현 힌트 (강제 아님, 스펙과 충돌하면 스펙이 우선):
  - `fetch(url, { signal: AbortSignal.timeout(5000) })`
  - 타임아웃 예외는 `err.name === 'TimeoutError'`(또는 `'AbortError'`)로 구분해 504, 그 외 예외는 기존대로 502
  - 502로 바꿀 상태: `[401, 403, 429].includes(s) || s >= 500`
- 의존성 추가: 없음 (테스트는 `node:test`, `node:assert`만 사용)
- 기존 패턴 참고 위치: `api/ranking.js`의 에러 처리와 한국어 에러 메시지 스타일

## 6. 제약
- 성능/호환성: 핸들러 시그니처 `export default async function handler(req, res)` 유지. Vercel Node 런타임 호환.
- 보안: `process.env.OPENWEATHERMAP_API_KEY`를 로그·응답에 출력하지 않는다. 테스트는 더미 키(`test-key`)만 사용한다.
- 코딩 규칙: 기존 들여쓰기·따옴표·한국어 주석 스타일 준수, 변경은 최소화한다.
- 테스트 주의: 저장소에 `"type": "module"`이 없다. `.mjs` 테스트에서 `api/weather.js`(ESM 문법) import가 Node 버전 때문에 실패하면, 임의로 설정을 바꾸지 말고 11절에 질문을 적고 멈출 것.

## 7. 테스트 요구
- 추가할 테스트: AC-1 ~ AC-6 각각에 대응하는 케이스 (`globalThis.fetch` 모킹, 가짜 `req`/`res` 객체 사용, 실제 네트워크 호출 금지)
- 타임아웃 테스트는 5초를 실제로 기다리지 말고, 모킹된 fetch가 전달받은 `signal`의 abort에 reject하도록 구성해 빠르게 끝낼 것
- 실행 명령:
  - 테스트: `npm test`
  - 린트: 없음 (이 저장소는 린터 미설정. 새로 추가하지 말 것)
  - 빌드: `npm run build`

## 8. 작업 분할 (병렬 작업 시)
| 태스크 | 담당 | 수정 파일 범위 | 의존 |
|---|---|---|---|
| T1 | 개발 에이전트 1명 | 위 5절 3개 파일 | - |

> 작은 작업이라 병렬화하지 않는다.

## 9. 완료 정의 (Definition of Done)
- [ ] AC-1 ~ AC-7 충족
- [ ] `npm test`, `npm run build` 통과 (실행 출력 첨부)
- [ ] `git diff --stat` 상 변경 파일이 5절 3개뿐
- [ ] 개발 완료 보고서 작성

## 10. 개발 완료 보고서 (개발 에이전트가 작성)
- 변경 파일 목록:
- 구현 요약:
- 실행한 명령과 결과:
- 스펙과 다르게 한 부분 / 미해결 사항:

## 11. 질문 / 결정 로그
| 날짜 | 질문 | 답변 | 결정자 |
|---|---|---|---|
