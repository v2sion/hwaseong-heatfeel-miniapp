# 파일럿: Claude(PM·QA) + OpenCode/OMO(개발)

| 단계 | 담당 | 산출물 |
|---|---|---|
| 1. 기획·구조 | Claude Code | `pilot/SPEC-NNN-*.md` |
| 2. 개발 | OpenCode (+OMO) | 코드 변경 + 스펙 10절 완료 보고서 |
| 3. 검증 | Claude Code | `pilot/QA-NNN.md` |

## 규칙
- 개발 에이전트는 **SPEC 5절의 파일 목록만** 수정한다. 모호하면 11절에 질문을 적고 멈춘다.
- QA는 개발 에이전트 보고를 믿지 않고 **직접 재실행**한 결과로 판정한다.
- 같은 SPEC이 QA에서 **2회 연속 반려**되면 Claude가 직접 구현한다.
- 작업마다 QA 문서 8절(파일럿 측정)을 기록한다. 같은 종류 작업 5~10개를 "Claude 단독"과 "Claude+OpenCode"로 나눠 비교한다.

## 주의 (계정 안전)
- **Claude 구독(Pro/Max)을 OpenCode에 연결하지 않는다.** 서드파티 도구에서 구독 사용은 약관상 제한되며 계정 정지 사례가 보고됐다(최신 약관 직접 확인).
- OpenCode 쪽은 다른 제공자의 API 키 또는 Anthropic Console API 키(종량제)를 쓰고, 키마다 **월 사용 한도**를 설정한다.
- API 키는 저장소에 커밋하지 않는다(`.env`는 `.gitignore` 대상).

## 파일
- `templates/SPEC.md`, `templates/QA_CHECKLIST.md`: 빈 템플릿
- `SPEC-001-weather-timeout.md`, `QA-001.md`: 이 저장소용으로 채운 예시(아직 구현 전)
