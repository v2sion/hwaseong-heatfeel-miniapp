#!/usr/bin/env bash
# 방식 B 실행: master에서 분리한 작업 트리에서 OpenCode + 무료 Muse로 SPEC을 구현시키고,
# 결과(시간, 변경 범위, 테스트, 빌드)를 기록한다. QA는 이후 Claude가 QA 체크리스트로 따로 한다.
#
# 사전 조건
#   - opencode.ai 접속 가능 (클라우드 환경이면 네트워크 허용 도메인에 opencode.ai 추가)
#   - OPENCODE_API_KEY 환경 변수 (OpenCode Zen 키, 채팅이나 저장소에 넣지 말 것)
#   - 데이터 규칙: Contributor 무료 모델은 입력 코드가 학습에 쓰일 수 있다 (pilot/README.md 참고)
#
# 사용: pilot/run-b.sh [SPEC 경로] [모델]
set -euo pipefail

SPEC="${1:-pilot/SPEC-001-weather-timeout.md}"
MODEL="${2:-opencode/muse-spark-1.3-contributor-free}"
ROOT="$(git rev-parse --show-toplevel)"
ID="$(basename "$SPEC" .md | cut -d- -f1-2)"            # 예: SPEC-001
WT="${WT:-$ROOT/../pilot-b-$ID}"
OUT="$ROOT/pilot/results/$ID-B"
mkdir -p "$OUT"

: "${OPENCODE_API_KEY:?OPENCODE_API_KEY가 필요합니다}"
command -v opencode >/dev/null || { echo "opencode CLI가 필요합니다: npm i -g opencode-ai"; exit 1; }

# 키는 설정 파일에 값으로 쓰지 않고 환경 변수 참조로만 넘긴다
CFG="$(mktemp)"; trap 'rm -f "$CFG"' EXIT
cat > "$CFG" <<JSON
{ "provider": { "opencode": { "options": { "apiKey": "{env:OPENCODE_API_KEY}" } } } }
JSON

git -C "$ROOT" fetch -q origin master
git -C "$ROOT" worktree add -f -B "pilot/b-$ID" "$WT" origin/master >/dev/null

PROMPT="첨부한 SPEC 문서만 기준으로 구현해. 규칙:
- SPEC 5절 파일 목록 밖의 파일은 수정하지 마.
- 의존성 설치는 npm ci만 사용해 (락 파일 변경 금지).
- 모호한 점이 있으면 구현하지 말고 질문을 출력하고 멈춰.
- 끝나면 SPEC 10절 형식으로 완료 보고서를 출력해 (변경 파일, 요약, 실행 명령과 결과, 스펙과 다른 점)."

START=$(date +%s)
set +e
( cd "$WT" && OPENCODE_CONFIG="$CFG" opencode run --auto -m "$MODEL" "$PROMPT" -f "$ROOT/$SPEC" ) \
  > "$OUT/agent-output.txt" 2> "$OUT/agent-stderr.txt"
AGENT_EXIT=$?
set -e
END=$(date +%s)

{
  echo "# $ID 방식 B 실행 기록"
  echo "- 모델: $MODEL"
  echo "- 작업 트리 브랜치: pilot/b-$ID (기준 origin/master $(git -C "$ROOT" rev-parse --short origin/master))"
  echo "- 에이전트 종료 코드: $AGENT_EXIT"
  echo "- 에이전트 소요 시간: $((END-START))초 (한도 대기 포함, 대기 구간은 agent-stderr.txt 확인)"
  echo; echo "## 변경 범위 (git status / diff --stat)"
  echo '```'; git -C "$WT" status --short; git -C "$WT" diff --stat; echo '```'
  echo; echo "## 재실행 결과 (QA 전 참고용, QA는 별도 수행)"
  echo '```'
  ( cd "$WT" && npm ci --no-audit --no-fund >/dev/null 2>&1 && echo "npm ci: ok" || echo "npm ci: FAIL" )
  ( cd "$WT" && npm test 2>&1 | grep -E "^# (tests|pass|fail)" || echo "npm test: 실행 불가 또는 실패" )
  ( cd "$WT" && npm run build >/dev/null 2>&1 && echo "build: ok" || echo "build: FAIL" )
  echo '```'
} > "$OUT/run.md"

echo "완료: $OUT/run.md, 작업 트리: $WT"
