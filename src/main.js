import { Accuracy, getCurrentLocation, graniteEvent, getAnonymousKey, Storage, setClipboardText, Analytics, SafeAreaInsets, closeView, share as tossShare, saveBase64Data } from '@apps-in-toss/web-framework';
import html2canvas from 'html2canvas-pro';

// 앱인토스로 패키징되면 정적 자산이 Toss 도메인(apps.tossmini.com 등)에서 서빙되므로,
// 상대경로 fetch('/api/...')는 그 도메인에서 API를 찾게 되어 깨진다. API는 계속 이
// Vercel 배포에 남아있으므로 항상 절대 URL로 호출한다(API 쪽엔 CORS 허용을 열어둠).
const API_BASE = 'https://app-tau-ten-42.vercel.app';

// 브릿지가 없는 일반 브라우저에서도 조용히 무시되도록 감싼 로깅 헬퍼.
function trackScreen(params){ try{ Analytics.screen(params); }catch(err){} }
function trackClick(params){ try{ Analytics.click(params); }catch(err){} }

// 일부 환경(예: 브릿지가 없는 iOS Safari에서의 앱인토스 SDK 호출)은 실패 시
// reject 대신 Promise가 영영 끝나지 않는 방식으로 멈출 수 있다. 그러면 await가
// 하염없이 대기하며 이후 로직(동의 팝업 노출, 위치 fallback 등)이 통째로 멈춘다.
// 지정 시간 안에 안 끝나면 reject시켜 항상 다음 fallback으로 넘어가게 한다.
function withTimeout(promise, ms){
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Safe Area: CSS env()는 기본값일 뿐이고, 앱인토스 WebView에서 더 정확한 값을
// SafeAreaInsets로 받아 :root의 --toss-safe-* 커스텀 프로퍼티를 덮어쓴다.
// 실패(브라우저 단독 접속 등)해도 CSS의 env() 기본값으로 자연스럽게 동작한다.
function applySafeAreaInsets(insets){
  const root = document.documentElement.style;
  root.setProperty('--toss-safe-top', `${insets.top}px`);
  root.setProperty('--toss-safe-bottom', `${insets.bottom}px`);
}

function initSafeArea(){
  try{
    applySafeAreaInsets(SafeAreaInsets.get());
    SafeAreaInsets.subscribe({ onEvent: applySafeAreaInsets });
  }catch(err){
    console.warn('Safe Area 조회 실패(브라우저 환경 등):', err);
  }
}

/* ============================================================
   MOCK DATA
   - API 연동 전까지 사용하는 하드코딩 상수.
   - 실제 데이터 연동 시 이 블록만 fetch 결과로 교체하면 됨.
   - 네이밍 규칙: MOCK_* / 화면별 접두사(S1_, S2_, S3_) 없이
     공용으로 재사용 (동일 지표는 화면1/3에서 같은 값을 참조).
============================================================ */

// 공통 - 우리 동네(사용자 위치) 정보
// 실제 위치 API 연동 전까지 "강남구(역삼1동)"로 고정. 화면 문구는 MOCK_REGION_NAME을 쓰고
// /api/ranking·/api/dong-ranking 조회에는 실제 코드(MOCK_REGION_MATCH_NAME/MOCK_MY_CITY_CODE)를 쓴다.
const MOCK_REGION_NAME        = "강남구";              // 화면 표시용 (뱃지/후킹카피/공유카드)
const MOCK_REGION_MATCH_NAME  = "강남구";              // /api/ranking 응답에서 내 지역을 찾을 때 쓰는 실제 행정구역명
const MOCK_MY_CITY_CODE       = "11680";               // 강남구 시군구 코드 (/api/dong-ranking 조회용)
const MOCK_MY_DONG_NAME       = "역삼1동";             // 화면2 동 단위 탭에서 "우리 동네"로 강조 표시할 대상
const MOCK_COORD              = { lat: 37.500889, lon: 127.035491 }; // 역삼1동 좌표, 위치 연동 실패 시 폴백
const MOCK_FEELS_LIKE_TEMP    = 34;                     // 체감온도 (°C) - /api/weather 연동 실패 시 폴백
const MOCK_ACTUAL_TEMP        = 31;                     // 실제 기온 (°C) - 체감온도와 구분해서 보여주는 부가정보
const MOCK_HUMIDITY           = 65;                      // 습도 (%) - 불쾌지수 계산용, /api/weather 연동 실패 시 폴백
const MOCK_TOTAL_REGIONS      = 256;                    // 전국 시군구 총 개수 (2026-07 기준)
const MOCK_RANK_PERCENT       = 7;                       // 상위 % (더울수록 상위)
const MOCK_CITY_RANK          = 16;                      // 전국 체감온도 순위 (1위=가장 더움)
const MOCK_UPDATED_AT_LABEL   = "오늘 15:00 기준";
const MOCK_CHALLENGE_HASHTAG  = "#오늘체감온도챌린지 · 우리동네체감온도"; // 화면3 하단 워터마크 자리

// 화면2 - 시 단위: 전국 시군구 체감온도 mock 순위 (상위 3 + 강남구 인근 구간)
// isMe: true 인 항목이 강조 표시됨
const MOCK_CITY_RANKING = [
  { rank: 1,  name: "포항시 남구", temp: 37.2, isMe:false },
  { rank: 2,  name: "대구광역시 서구", temp: 36.8, isMe:false },
  { rank: 3,  name: "문경시", temp: 36.5, isMe:false },
  { rank: "...", name: null, temp: null, isMe:false }, // 구간 생략 표시
  { rank: 15, name: "안성시", temp: 34.3, isMe:false },
  { rank: 16, name: "강남구", temp: 34.0, isMe:true  },
  { rank: 17, name: "평택시", temp: 33.9, isMe:false }
];

// 화면2 - 동 단위: 강남구 내 동 체감온도 mock (전국 평균 대비 비교수치 포함)
const MOCK_NATIONWIDE_AVERAGE_TEMP = 32.8; // 전국 256개 시군구 평균 체감온도 (동 리스트 비교 기준값)
const MOCK_DONG_RANKING = [
  { rank: 1, name: "역삼1동", temp: 34.0, isMe:true  },
  { rank: 2, name: "논현1동", temp: 33.6, isMe:false },
  { rank: 3, name: "대치1동", temp: 33.2, isMe:false },
  { rank: 4, name: "삼성1동", temp: 32.9, isMe:false },
  { rank: 5, name: "청담동",  temp: 32.5, isMe:false },
  { rank: 6, name: "개포2동", temp: 32.0, isMe:false }
];

// 실제 위치(navigator.geolocation + /api/nearest-region) 연동 성공 시 교체되는 "내 위치" 상태.
// 실패/거부/미지원 시 MOCK 값(강남구/역삼1동)을 그대로 사용한다 - resolveMyLocation() 참고.
let currentCoord = { ...MOCK_COORD };
let currentRegionName = MOCK_REGION_NAME;             // 화면 표시용 지역명
let currentRegionMatchName = MOCK_REGION_MATCH_NAME;  // /api/ranking에서 내 지역을 찾을 때 쓰는 실제 행정구역명
let currentCityCode = MOCK_MY_CITY_CODE;              // /api/dong-ranking 조회용 시군구 코드
let currentMyDongName = MOCK_MY_DONG_NAME;            // 화면2 동 단위 탭에서 강조 표시할 대상(실위치일 땐 내 동네, 기본값일 땐 그 지역 1위 동)
// 위치 동의를 안 했거나 실패해서 resolveDefaultRegion()으로 대체됐는지 여부.
// true일 땐 강조 배지 문구를 "우리 동네"가 아니라 "지금 가장 핫한 동네/지역"으로 바꾼다 -
// 실제 사용자 위치가 아닌데 "우리 동네"라고 하면 오해를 준다는 피드백 반영.
let isUsingDefaultRegion = false;

// 화면1/3에서 실제로 표시할 체감온도. /api/weather 연동 성공 시 실데이터로 교체되고,
// 실패(로컬에서 vercel dev 없이 index.html만 열람 등) 시 MOCK 값을 그대로 사용한다.
let currentFeelsLike = MOCK_FEELS_LIKE_TEMP;
let currentActualTemp = MOCK_ACTUAL_TEMP;
let currentHumidity = MOCK_HUMIDITY;
let currentSimilarRegion = null; // { name, temp, diff } - 전국에서 체감온도가 가장 비슷한 지역 (F11)
let currentUpdatedLabel = MOCK_UPDATED_AT_LABEL;

// (2026-07-17 신규) 화면1 실시간 조회 / 화면2 시군구 배치수집 / 화면2 동 단위 온디맨드 캐싱이
// 서로 다른 시점의 스냅샷이라 체감온도 수치가 미묘하게 어긋나 보인다는 피드백 - 세 값을 실제로
// 완전히 동일 시점으로 통일하려면 시군구 256개를 매 사용자 요청마다 실시간 조회해야 해서
// OpenWeatherMap 무료 티어(월 100만 호출)를 감당 못 한다. 대신 화면2의 "오늘 15:00 기준"이
// 실제 데이터와 무관한 하드코딩 목업 문구였던 것부터 바로잡는다 - 각 패널이 실제로 몇 시
// 데이터를 보여주는 중인지 정직하게 표시하면, 수치가 조금씩 다른 이유도 사용자가 납득할 수 있다.
let currentRankingUpdatedLabel = MOCK_UPDATED_AT_LABEL;
let currentDongUpdatedLabel = MOCK_UPDATED_AT_LABEL;

function formatUpdatedAt(isoString, suffix){
  const d = new Date(isoString);
  if(Number.isNaN(d.getTime())) return null;
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} ${suffix}`;
}

// /api/ranking(전국 256개 시군구, 시간당 갱신) 연동 성공 시 교체되는 순위 관련 값들.
// 실패 시 MOCK 값을 그대로 사용한다.
let currentTotalRegions = MOCK_TOTAL_REGIONS;
let currentRankPercent = MOCK_RANK_PERCENT;
let currentCityRank = MOCK_CITY_RANK;
let currentCityRanking = MOCK_CITY_RANKING;

// /api/dong-ranking(내 시군구의 읍면동, 시간당 갱신) 연동 성공 시 교체되는 값.
let currentDongRanking = MOCK_DONG_RANKING;

// /api/ranking(전국 256개 시군구)의 체감온도 평균 - 동 단위 비교 기준을 "그 시 안의 평균"이
// 아니라 "전국 평균"으로 보여달라는 요청(2026-07-15)에 따라 loadRanking()에서 계산한다.
let currentNationwideAverageTemp = MOCK_NATIONWIDE_AVERAGE_TEMP;

/* ============================================================
   체감온도 구간 시스템 (디자인시스템 v1 공용 브래킷)
   - 30도↑ 약간 더움 / 33도↑ 더움 / 35도↑ 매우 더움 / 38도↑ 폭염 / 열대야(21~06시 & 25도↑)
   - (2026-07-17 갱신) "쾌적" 기준이 33도라 30도대 초반도 쾌적으로 뜨는 게 체감과
     안 맞는다는 피드백 반영 - 30도 구간에 warm(약간 더움)을 신설해 세분화.
   - 후킹카피 문구 선택, 뱃지·히어로·CTA·랭킹 막대 등의 "온도 색상"이
     모두 이 하나의 구간 판정 로직(getHeatBracketKey)을 공유한다.
============================================================ */
function isNightHour(date = new Date()){
  const h = date.getHours();
  return h >= 21 || h < 6;
}

function getHeatBracketKey(feelsLikeTemp, night = isNightHour()){
  if(night && feelsLikeTemp >= 25) return 'tropicalNight';
  if(feelsLikeTemp >= 38) return 'extreme';
  if(feelsLikeTemp >= 35) return 'veryHot';
  if(feelsLikeTemp >= 33) return 'hot';
  if(feelsLikeTemp >= 30) return 'warm';
  return 'cool';
}

// CSS :root의 --heat-* 변수와 1:1 대응 (뱃지 점·히어로 숫자·후킹카피 태그·CTA·랭킹 막대에만 사용,
// 탭/"우리 동네" 칩 등 UI 내비게이션은 브랜드 민트 고정 - 각 CSS 규칙에서 별도 처리)
const HEAT_BRACKET_COLOR_VAR = {
  cool: '--heat-cool',
  warm: '--heat-warm',
  hot: '--heat-hot',
  veryHot: '--heat-veryhot',
  extreme: '--heat-extreme',
  tropicalNight: '--heat-tropicalnight',
};

/* ============================================================
   불쾌지수 (F9, 2026-07-17) — 기상청 공식과 동일
   DI = 0.81*T + 0.01*H*(0.99*T-14.3) + 46.3 (T:기온°C, H:습도%)
   체감온도(바람 포함)와 산출 공식이 달라 같은 날씨에도 수치가 다르게 나올 수 있다 -
   색상 범례 시트에 별도 설명 문단을 둔 이유.
============================================================ */
function computeDiscomfortIndex(tempC, humidityPct){
  return 0.81 * tempC + 0.01 * humidityPct * (0.99 * tempC - 14.3) + 46.3;
}
function getDiscomfortLabel(di){
  if(di < 68) return '쾌적';
  if(di < 75) return '보통';
  if(di < 80) return '약간 높음';
  if(di < 83) return '높음';
  return '매우 높음';
}

// 해당 온도의 CSS 변수 참조 문자열(예: "var(--heat-hot)")을 반환 - 인라인 style에 바로 쓸 수 있음
function getHeatColorVarRef(feelsLikeTemp, night = isNightHour()){
  return `var(${HEAT_BRACKET_COLOR_VAR[getHeatBracketKey(feelsLikeTemp, night)]})`;
}

/* ============================================================
   후킹 카피 시스템 (F3): 체감온도 구간별 템플릿 조합형
   - 구간마다 문구 후보 여러 개 중 [지역명+반올림 온도]로 안정적으로 하나를 골라
     같은 조건에서는 새로고침해도 같은 문구가 나오되, 온도가 바뀌면 자동으로 갱신된다.
============================================================ */
const HOOK_COPY_TEMPLATES = {
  tropicalNight: [
    ["{region}, 에어컨 없이 자면", "찜질방 숙박 체험! 오늘 밤도 열대야예요"],
    ["{region}, 창문 열어도 후끈한 밤.", "선풍기 두 대는 기본 옵션인 열대야!"],
  ],
  extreme: [ // 38도 이상 - 폭염
    ["{region}, 계란 프라이 바로 되는", "폭염 날씨! 나가면 5분 만에 후회할지도"],
    ["{region}, 마스크 쓰면 사우나 체험판.", "야외활동은 잠시 미루는 게 좋겠어요"],
  ],
  veryHot: [ // 35도 이상 - 매우 더움
    ["{region}, 러닝하면 찜질방에서 뛰는", "느낌의 날씨! 그늘도 못 피하는 더위예요"],
    ["{region}, 에어컨 없인 못 버티는 날.", "아스팔트 위 계란 프라이도 머지않았어요"],
  ],
  hot: [ // 33도 이상 - 더움
    ["{region}, 오늘은 동남아 여행 갈 필요 없는", "동남아 그 자체. 러닝하면 찜질방에서 뛰는 날씨!"],
    ["{region}, 가만히 있어도 땀이 주르륵.", "아이스아메리카노는 선택 아닌 필수인 날씨!"],
  ],
  warm: [ // 30도 이상 - 약간 더움
    ["{region}, 그늘 밖은 슬슬 후끈한", "낌새예요. 반팔이 이제 정답인 날씨네요!"],
    ["{region}, 아직 폭염까진 아니지만", "이미 더위가 시작된 느낌이에요!"],
  ],
  cool: [ // 30도 미만 - 쾌적
    ["{region}, 오늘은 그럭저럭 견딜만한", "더위예요. 그래도 수분 보충은 잊지 마세요!"],
  ],
};

function pickTemplate(list, seedKey){
  let hash = 0;
  for(let i = 0; i < seedKey.length; i++) hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}

function getHookCopyLines(regionName, feelsLikeTemp){
  const bracket = getHeatBracketKey(feelsLikeTemp);
  const seedKey = `${regionName}-${Math.round(feelsLikeTemp)}-${bracket}`;
  const template = pickTemplate(HOOK_COPY_TEMPLATES[bracket], seedKey);
  return template.map(line => line.replace('{region}', regionName));
}

let currentHookCopyLines = getHookCopyLines(currentRegionName, MOCK_FEELS_LIKE_TEMP);

/* ============================================================
   RENDER
============================================================ */
function fmtTemp(t){ return t.toFixed(1).replace(/\.0$/, ""); }

// 한글 받침 유무에 따라 조사를 고른다 (예: "화성시" -> "는", "강남구" -> "는", "관악구" -> "는", "종로구" -> "는", "성남시"+은/는 -> "는")
function pickParticle(word, withBatchim, withoutBatchim){
  const lastChar = word ? word[word.length - 1] : '';
  const code = lastChar ? lastChar.charCodeAt(0) : 0;
  if(code >= 0xAC00 && code <= 0xD7A3){
    const hasBatchim = (code - 0xAC00) % 28 !== 0;
    return hasBatchim ? withBatchim : withoutBatchim;
  }
  return withoutBatchim;
}
// word 뒤에 알맞은 조사를 바로 붙여서 반환 (word와 조사 사이에 다른 글자가 없을 때만 사용)
function withParticle(word, withBatchim, withoutBatchim){
  return word + pickParticle(word, withBatchim, withoutBatchim);
}

function renderScreen1(){
  document.body.style.setProperty('--heat-color', getHeatColorVarRef(currentFeelsLike));
  document.getElementById('s1-rank-badge-text').textContent =
    `${currentRegionName}, 오늘 전국 ${currentTotalRegions}개 시군구 중 상위 ${currentRankPercent}%`;
  document.getElementById('s1-temp').textContent = fmtTemp(currentFeelsLike);
  document.getElementById('s1-sub').textContent = `기상청 동네예보 기준 · ${currentUpdatedLabel}`;
  document.getElementById('s1-actual-temp-value').textContent = fmtTemp(currentActualTemp);
  const discomfortIndex = computeDiscomfortIndex(currentActualTemp, currentHumidity);
  document.getElementById('s1-discomfort-value').textContent = Math.round(discomfortIndex);
  document.getElementById('s1-discomfort-label').textContent = getDiscomfortLabel(discomfortIndex);
  document.getElementById('s1-helper-region').textContent = currentRegionName;
  // (2026-07-17 수정) 템플릿 저자가 나눠둔 두 조각 사이에 무조건 <br/>를 넣었더니, 실제
  // 화면 폭에서 자연 줄바꿈까지 겹쳐 문장이 이상한 지점에서 끊겨 보이는 경우가 있었음 -
  // 공백으로 이어붙여 하나의 문장으로 두고, body 전역의 word-break:keep-all(단어 중간에서
  // 안 끊김) + overflow-wrap:break-word에 맡겨 화면 폭에 맞게 자연스럽게 흐르도록 함.
  document.getElementById('s1-hook-copy').innerHTML =
    currentHookCopyLines.map((line,i)=>{
      // 첫 줄의 지역명만 강조
      return i===0 ? line.replace(currentRegionName, `<span class="accent">${currentRegionName}</span>`) : line;
    }).join(' ');
  document.getElementById('use-my-location-btn').style.display = isUsingDefaultRegion ? 'inline-flex' : 'none';
}

function renderCityBarList(){
  document.getElementById('s2-rank-updated').textContent = currentRankingUpdatedLabel;
  const wrap = document.getElementById('city-bar-list');
  const maxTemp = Math.max(...currentCityRanking.filter(r=>r.temp!=null).map(r=>r.temp));
  wrap.innerHTML = currentCityRanking.map(r=>{
    if(r.rank === "...") return `<div class="rank-ellipsis">⋮</div>`;
    const pct = Math.max(8, Math.round((r.temp / maxTemp) * 100));
    return `
      <div class="bar-row ${r.isMe ? 'highlight':''}" style="--row-heat:${getHeatColorVarRef(r.temp)}">
        <div class="rank-no">${r.rank}</div>
        <div class="bar-main">
          <div class="bar-meta">
            <span class="bar-name-wrap">
              <span class="bar-name" title="${r.name}">${r.name}</span>
              ${r.isMe ? `<span class="me-chip">${isUsingDefaultRegion ? '지금 가장 핫한 지역' : '우리 동네'}</span>` : ''}
            </span>
            <span class="bar-temp">${fmtTemp(r.temp)}°</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }).join('');
}

// F11: 체감온도가 가장 비슷한 지역 한 줄 안내 (내 지역이 아직 확정 안 됐으면 숨김)
function renderSimilarRegion(){
  const el = document.getElementById('similar-region-note');
  if(!el) return;
  if(!currentSimilarRegion){
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  // (2026-07-17 수정) 한 문장으로 이어붙이면 화면 폭에 따라 어중간한 지점에서 줄바꿈돼
  // 부자연스러웠음 - "~은" 뒤에서 의도적으로 끊어 항상 2줄로 보이게 함.
  el.innerHTML = `
    <span>체감온도가 가장 비슷한 곳은</span>
    <span>${currentSimilarRegion.name}이에요 (${fmtTemp(currentSimilarRegion.temp)}°, ${fmtTemp(currentSimilarRegion.diff)}° 차이)</span>
  `;
}

// /api/dong-ranking이 해당 도시에 동 데이터가 없다고(404) 응답했을 때 true - 예외처리 안내로 전환
let dongDataUnavailable = false;

function renderDongList(){
  const wrap = document.getElementById('dong-list');

  if(dongDataUnavailable){
    document.getElementById('hs-avg-temp-label').textContent = '-';
    document.getElementById('s2-dong-updated').textContent = '';
    wrap.innerHTML = `
      <div class="dong-empty-state">
        <div class="dong-empty-icon"></div>
        <div class="dong-empty-title">동 단위 데이터 준비중</div>
        <div class="dong-empty-desc">${withParticle(currentRegionName, '은', '는')} 아직 동 단위 비교를 제공하지 않아요.<br/>상위 행정구역(시/군/구) 기준으로 계속 이용해주세요.</div>
      </div>`;
    return;
  }

  document.getElementById('s2-dong-updated').textContent = currentDongUpdatedLabel;
  document.getElementById('hs-avg-temp-label').textContent = fmtTemp(currentNationwideAverageTemp);
  wrap.innerHTML = currentDongRanking.map(d=>{
    const diff = +(d.temp - currentNationwideAverageTemp).toFixed(1);
    const diffClass = diff >= 0 ? 'up' : 'down';
    const diffLabel = `${diff >= 0 ? '+' : ''}${diff}°`;
    return `
      <div class="dong-row ${d.isMe ? 'highlight':''}" style="--row-heat:${getHeatColorVarRef(d.temp)}">
        <div class="left">
          <div class="rank-chip">${d.rank}</div>
          <div>
            <div class="dong-name" title="${d.name}">${d.name}</div>
            ${d.isMe ? `<span class="dong-badge">${isUsingDefaultRegion ? '지금 가장 핫한 동네' : '우리 동네'}</span>` : ''}
          </div>
        </div>
        <div class="right">
          <div class="dong-temp">${fmtTemp(d.temp)}°</div>
          <div class="dong-diff ${diffClass}">${diffLabel} 전국 평균 대비</div>
        </div>
      </div>`;
  }).join('');
}

function renderScreen3(){
  document.getElementById('s3-date').textContent = currentUpdatedLabel;
  document.getElementById('s3-region-name').textContent = currentRegionName;
  document.getElementById('s3-rank-badge').textContent = `상위 ${currentRankPercent}%`;
  document.getElementById('s3-temp').textContent = fmtTemp(currentFeelsLike);
  document.getElementById('s3-rank-line').textContent =
    `전국 ${currentTotalRegions}개 시군구 중 ${currentCityRank}위`;
  document.getElementById('s3-hook-copy').innerHTML = currentHookCopyLines.join(' ');
  document.getElementById('s3-hashtag').textContent = MOCK_CHALLENGE_HASHTAG;
  document.getElementById('s3-watermark').textContent = MOCK_CHALLENGE_HASHTAG;
}

function renderAll(){
  renderScreen1();
  renderCityBarList();
  renderDongList();
  renderScreen3();
}

/* ============================================================
   데이터 로드 실패 안내 (예외처리)
   - API가 실패해도 화면은 mock/마지막으로 알려진 값을 그대로 유지해 크래시를 막되,
     "정보를 불러오지 못했어요" 배너 + 재시도 버튼으로 사용자에게 상황을 알린다.
   - 날씨/랭킹 중 하나라도 살아있으면(성공) 배너는 자동으로 사라진다.
============================================================ */
let weatherLoadFailed = false;
let rankingLoadFailed = false;

function updateDataErrorBanner(){
  const banner = document.getElementById('data-error-banner');
  if(!banner) return;
  banner.classList.toggle('show', weatherLoadFailed || rankingLoadFailed);
}

function retryDataLoad(){
  loadRealWeather();
  loadRanking();
  loadDongRanking();
}

/* ============================================================
   실데이터 연동
   - /api/weather: 내 좌표의 실시간 체감온도 (화면1/3 큰 숫자)
   - /api/ranking: 전국 256개 시군구 시간당 배치 결과 (화면1/2/3 순위·percentile)
   - 각각 실패해도 서로 독립적으로 mock/마지막 값 폴백.
============================================================ */
async function loadRealWeather(){
  try{
    const url = `${API_BASE}/api/weather?lat=${currentCoord.lat}&lon=${currentCoord.lon}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`weather ${res.status}`);
    const data = await res.json();
    if(typeof data.feelsLike !== 'number') throw new Error('invalid weather payload');

    currentFeelsLike = data.feelsLike;
    if(typeof data.temp === 'number') currentActualTemp = data.temp;
    if(typeof data.humidity === 'number') currentHumidity = data.humidity;
    currentUpdatedLabel = formatUpdatedAt(data.updatedAt, '기준 (실시간)') || currentUpdatedLabel;
    currentHookCopyLines = getHookCopyLines(currentRegionName, currentFeelsLike);
    weatherLoadFailed = false;

    renderScreen1();
    renderScreen3();
  }catch(err){
    // 네트워크 오류 등 - mock/마지막 값으로 계속 동작하되 배너로 안내
    console.warn('실시간 날씨 연동 실패, mock 값 사용:', err);
    weatherLoadFailed = true;
  }
  updateDataErrorBanner();
}

// 전국 256개 시군구 중 내 지역과 체감온도 차이가 가장 적은 지역을 찾는다 (F11, 새 API 없이
// 이미 캐싱된 /api/ranking 데이터로 계산). 나 자신은 제외.
function findSimilarRegion(regions, mine){
  let best = null;
  for(const r of regions){
    if(r.nameKo === mine.nameKo || typeof r.feelsLike !== 'number') continue;
    const diff = Math.abs(r.feelsLike - mine.feelsLike);
    if(!best || diff < best.diff){
      best = { name: r.nameKo, temp: r.feelsLike, diff };
    }
  }
  return best;
}

// 전체 랭킹에서 상위 3위 + (필요 시 생략 표시) + 내 지역 주변 구간만 뽑아 화면2 막대 리스트 형태로 변환
function buildCityRankingWindow(regions, meName){
  const toRow = (r) => ({ rank: r.rank, name: r.nameKo, temp: r.feelsLike, isMe: r.nameKo === meName });
  const meIndex = regions.findIndex(r => r.nameKo === meName);
  if(meIndex === -1) return regions.slice(0, 3).map(toRow);

  if(regions[meIndex].rank <= 4){
    return regions.slice(0, Math.max(4, meIndex + 1)).map(toRow);
  }

  const top3 = regions.slice(0, 3).map(toRow);
  const windowStart = Math.max(3, meIndex - 1);
  const windowEnd = Math.min(regions.length, meIndex + 2);
  const nearby = regions.slice(windowStart, windowEnd).map(toRow);
  return [...top3, { rank: '...', name: null, temp: null, isMe: false }, ...nearby];
}

async function loadRanking(){
  try{
    const res = await fetch(`${API_BASE}/api/ranking`);
    if(!res.ok) throw new Error(`ranking ${res.status}`);
    const data = await res.json();
    if(!Array.isArray(data.regions) || data.regions.length === 0) throw new Error('empty ranking payload');

    const mine = data.regions.find(r => r.nameKo === currentRegionMatchName);

    currentTotalRegions = data.totalRegions;
    currentRankingUpdatedLabel = formatUpdatedAt(data.updatedAt, '수집 기준') || currentRankingUpdatedLabel;
    currentCityRanking = buildCityRankingWindow(data.regions, currentRegionMatchName);
    if(mine){
      currentRankPercent = mine.percentile;
      currentCityRank = mine.rank;
      currentSimilarRegion = findSimilarRegion(data.regions, mine);
    }else{
      currentSimilarRegion = null;
    }
    const nationwideTemps = data.regions.map(r => r.feelsLike).filter(t => typeof t === 'number');
    if(nationwideTemps.length > 0){
      currentNationwideAverageTemp = Math.round((nationwideTemps.reduce((sum, t) => sum + t, 0) / nationwideTemps.length) * 10) / 10;
    }
    rankingLoadFailed = false;

    renderScreen1();
    renderCityBarList();
    renderSimilarRegion();
    renderScreen3();
    // loadDongRanking()과 병렬로 실행되므로, 동 단위 화면이 이미 먼저 렌더링됐더라도
    // 방금 계산한 전국 평균으로 다시 그려서 최신값을 반영한다.
    renderDongList();
  }catch(err){
    // 네트워크 오류 등 - mock/마지막 값으로 계속 동작하되 배너로 안내
    console.warn('전국 랭킹 연동 실패, mock 값 사용:', err);
    rankingLoadFailed = true;
  }
  updateDataErrorBanner();
}

async function loadDongRanking(){
  try{
    const res = await fetch(`${API_BASE}/api/dong-ranking?city=${currentCityCode}`);
    if(res.status === 404){
      // 해당 시군구는 동 단위 데이터셋 자체가 없는 경우 - API 실패가 아니라 별도 안내 상태
      dongDataUnavailable = true;
      renderDongList();
      return;
    }
    if(!res.ok) throw new Error(`dong-ranking ${res.status}`);
    const data = await res.json();
    if(!Array.isArray(data.dong) || data.dong.length === 0){
      dongDataUnavailable = true;
      renderDongList();
      return;
    }

    dongDataUnavailable = false;
    currentDongUpdatedLabel = formatUpdatedAt(data.updatedAt, '수집 기준') || currentDongUpdatedLabel;
    // 위치 동의를 안 한 상태(기본 지역 표시 중)라면 "내 동네"를 알 수 없으니, 대신 그 지역에서
    // 가장 더운 동(data.dong[0], rank 1)을 "지금 가장 핫한 동네"로 강조한다.
    if(isUsingDefaultRegion) currentMyDongName = data.dong[0]?.name ?? null;
    currentDongRanking = data.dong.map(d => ({
      rank: d.rank,
      name: d.name,
      temp: d.feelsLike,
      isMe: d.name === currentMyDongName,
    }));

    renderDongList();
  }catch(err){
    // 네트워크 오류 등 - mock 값으로 계속 동작
    console.warn('동 단위 랭킹 연동 실패, mock 값 사용:', err);
  }
}

/* ============================================================
   NAVIGATION / INTERACTION
============================================================ */
let currentScreenNum = 1;
function goToScreen(n){
  currentScreenNum = n;
  document.getElementById('screens').className = 'screens at-' + n;
  // 각 .screen은 자체 overflow-y:auto라 스크롤 위치를 따로 기억한다 - 이전에 스크롤해뒀던
  // 화면으로 다시 이동하면 중간부터 보이는 문제가 있어, 이동할 때마다 최상단으로 리셋한다.
  const targetScreen = document.getElementById('screen-' + n);
  if(targetScreen) targetScreen.scrollTop = 0;
  trackScreen({ log_name: 'screen_view', screen: n });
}

// 앱인토스 콘솔 "주요 기능"(intoss://{appName}/ranking 같은 딥링크)으로 들어왔을 때
// 홈(화면1)을 거치지 않고 해당 화면으로 바로 진입시킨다. vercel.json의 rewrite로
// /ranking 경로도 이 SPA의 index.html을 그대로 서빙하도록 되어 있어야 동작한다.
const DEEPLINK_ROUTE_TO_SCREEN = { '/ranking': 2 };
function applyDeepLinkRoute(){
  const screen = DEEPLINK_ROUTE_TO_SCREEN[window.location.pathname];
  if(screen) goToScreen(screen);
}

// 앱인토스 WebView의 하드웨어/제스처 뒤로가기를 화면 스택 이동으로 처리한다(상세→메인 등).
// (2026-07-15 수정) 루트 화면(1)에서는 "아무 것도 안 하면 기본 종료 동작에 맡겨진다"고
// 가정했으나, 실기기 QR 테스트에서 뒤로가기(<)/단말 뒤로가기 버튼이 화면1에서 완전히
// 무반응임을 확인함(우측 상단 X 버튼만 정상 종료) - 네이티브 셸이 backEvent 리스너가
// 등록된 이상 "소비 안 하면 자동 종료"를 대신 해주지 않는 구조였음. closeView()를 직접
// 호출해 X 버튼과 동일하게 명시적으로 닫아야 앱인토스 비게임 체크리스트의 "최초 화면에서
// 뒤로가기를 누르면 미니앱이 종료돼요" 요건을 충족한다.
// 브릿지가 없는 일반 브라우저(로컬/Vercel 단독 접속)에서는 등록 실패를 조용히 무시한다.
try{
  graniteEvent.addEventListener('backEvent', {
    onEvent: () => {
      if(currentScreenNum > 1){
        goToScreen(currentScreenNum - 1);
      }else{
        closeView().catch(err => console.warn('closeView 호출 실패:', err));
      }
    },
  });
}catch(err){
  // 앱인토스 비게임 출시 체크리스트: "토스 내비게이션 바의 뒤로가기 버튼과 미니앱에서
  // 자체 구현한 뒤로가기 버튼이 동시에 보이지 않아요" - 실제 토스 앱 안에서는 네이티브
  // 내비게이션 바(granite.config.ts의 navigationBar 기본값)가 이미 뒤로가기를 제공하므로
  // 화면 안의 커스텀 backbtn은 숨긴다. 브릿지가 없는 일반 브라우저(로컬/Vercel 단독
  // 접속, 심사 외 데모용)에서만 fallback으로 커스텀 backbtn을 노출한다.
  console.warn('backEvent 리스너 등록 실패(브라우저 환경):', err);
  document.body.classList.add('no-native-nav');
}

function switchRankTab(which){
  document.getElementById('tab-city').classList.toggle('active', which==='city');
  document.getElementById('tab-dong').classList.toggle('active', which==='dong');
  document.getElementById('panel-city').classList.toggle('active', which==='city');
  document.getElementById('panel-dong').classList.toggle('active', which==='dong');
}

let toastTimer;
function showToast(msg){
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> toast.classList.remove('show'), 1600);
}

/* ============================================================
   공유 기능: 이미지 저장 / 기본 공유하기
============================================================ */

// 공유카드를 캡처해서 PNG로 저장. 서버/외부 API 없이 클라이언트에서 완결.
// html2canvas(원본)는 oklch()/color-mix() 같은 최신 CSS 색상 함수를 못 읽어서
// "Attempting to parse an unsupported color function" 에러로 항상 실패했다 -
// 이 프로젝트 색상 시스템 전체가 oklch 기반이라 html2canvas-pro(포크, 최신 CSS 색상 함수 지원)로 교체.
//
// (2026-07-16 수정) 실기기 QR 테스트에서 "눌러도 아무 반응이 없다"는 버그 확인 - <a download>로
// 브라우저 다운로드를 트리거하는 방식은 앱인토스 RN WebView엔 다운로드 매니저가 연결돼 있지
// 않아 조용히 아무 일도 안 일어난다. saveBase64Data() 네이티브 브릿지로 기기에 직접 저장하고,
// 브릿지가 없는 일반 브라우저(로컬/Vercel 단독 접속 데모)에서만 기존 다운로드 링크로 폴백한다.
async function saveShareCardImage(){
  trackClick({ log_name: 'save_image' });
  const card = document.querySelector('#screen-3 .share-card');
  if(!card){
    showToast('이미지 저장 기능을 불러오지 못했습니다');
    return;
  }
  try{
    const canvas = await html2canvas(card, { backgroundColor: null, scale: 2 });
    const dataUrl = canvas.toDataURL('image/png');
    const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const fileName = `오늘체감온도_${currentRegionName}_${dateStr}.png`;

    try{
      const base64 = dataUrl.split(',')[1];
      await withTimeout(saveBase64Data({ data: base64, fileName, mimeType: 'image/png' }), 5000);
    }catch(bridgeErr){
      console.warn('saveBase64Data 브릿지 실패(브라우저 환경 등), 다운로드 링크로 대체:', bridgeErr);
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      link.click();
    }
    showToast('이미지가 저장되었습니다');
  }catch(err){
    console.warn('이미지 저장 실패:', err);
    showToast('이미지 저장에 실패했습니다');
  }
}

// (2026-07-17 신규, F4 OG 개인화) 공유 URL을 그냥 앱 홈(location.href)으로 보내면
// 카카오톡/문자 미리보기가 항상 똑같은 정적 og-image.png를 보여준다 - 공유하는 사람의 실제
// 온도/순위가 반영된 제목/설명이 뜨도록, 그 값들을 담은 /api/share 링크를 대신 공유한다.
// (2026-07-17 2차 개편) region/copy 등 한글 텍스트를 URL 쿼리에 그대로 실으면 인코딩 때문에
// 200~300자 넘는 링크가 돼 카카오톡에서 "이상한 링크"처럼 보이는 문제가 있었다 - /api/shorten이
// 이 값들을 Vercel Blob에 미리 저장해두고 짧은 id만 돌려주면, 그 id로 `/s/{id}` 짧은 링크를
// 만든다. /api/share가 id로 저장된 값을 다시 읽어 렌더링한다(og:image는 고정 이미지로 폐기 -
// 사용자별로 매번 새로 그리던 동적 이미지는 크롤러가 못 기다릴 만큼 느려서 오히려 미리보기가
// 안 뜨는 원인이었음). 발급 자체가 실패하면(네트워크 등) 기존 쿼리스트링 방식으로 폴백한다.
async function buildShareUrl(){
  const payload = {
    region: currentRegionName,
    temp: fmtTemp(currentFeelsLike),
    rank: String(currentRankPercent),
    copy: currentHookCopyLines.join(' '),
  };
  try{
    const res = await withTimeout(fetch(`${API_BASE}/api/shorten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }), 3000);
    if(res.ok){
      const data = await res.json();
      if(data.url) return data.url;
    }
  }catch(err){
    console.warn('짧은 공유 링크 발급 실패, 기존 방식으로 대체:', err);
  }
  const params = new URLSearchParams(payload);
  return `${API_BASE}/api/share?${params.toString()}`;
}

// 안드로이드/iOS 단말 기본 공유 시트(어떤 앱으로 공유할지 사용자가 고르는 OS 팝업).
// (2026-07-16 수정) 실기기 QR 테스트에서 "항상 텍스트 복사로만 진행된다"는 버그 확인 -
// 앱인토스 RN WebView엔 navigator.share가 아예 없어서(falsy) 매번 클립보드 폴백만 타고
// 있었다. 앱인토스 네이티브 공유 시트 브릿지(share())를 우선 사용하고, 브릿지가 없는
// 일반 브라우저에서만 navigator.share → 클립보드 복사 순으로 대체한다.
async function shareResult(){
  trackClick({ log_name: 'share_native' });
  const title = `${currentRegionName} 체감온도 ${fmtTemp(currentFeelsLike)}° · 상위 ${currentRankPercent}%`;
  const text = currentHookCopyLines.join(' ');
  const shareUrl = await buildShareUrl();
  const message = `${title}\n${text}\n${shareUrl}`;

  try{
    await withTimeout(tossShare({ message }), 5000);
    return;
  }catch(err){
    console.warn('네이티브 공유 시트 브릿지 실패(브라우저 환경 등), 다음 방식으로 대체:', err);
  }

  if(navigator.share){
    try{
      await navigator.share({ title, text, url: shareUrl });
      return;
    }catch(err){
      if(err.name === 'AbortError') return; // 사용자가 공유 시트에서 취소함 - 실패 아님
      console.warn('공유 시트 호출 실패, 클립보드 복사로 대체:', err);
    }
  }

  try{
    await withTimeout(setClipboardText(message), 1500);
  }catch(err){
    try{
      await navigator.clipboard.writeText(message);
    }catch(err2){
      showToast('공유하기에 실패했습니다');
      return;
    }
  }
  showToast('공유 링크가 복사되었습니다');
}

/* ============================================================
   F1: 실제 위치 연동
   - navigator.geolocation으로 좌표를 얻고, /api/nearest-region으로
     가장 가까운 시군구/동을 찾아 currentRegionName 등을 실데이터로 교체한다.
   - 위치 미지원/권한거부/타임아웃 등 실패 시 안내 토스트만 띄우고
     기존 MOCK 값(강남구/역삼1동)을 그대로 사용 - 비기능 요구사항의
     "위치 권한 거부 시 fallback" 처리.
============================================================ */
// 8초는 실외 GPS 콜드스타트엔 짧을 때가 많아(특히 실내/첫 요청) 12초로 넉넉하게 잡는다.
function getBrowserLocation(timeoutMs = 12000){
  return new Promise((resolve, reject) => {
    if(!navigator.geolocation){
      reject(new Error('geolocation unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => reject(err),
      { timeout: timeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function getTossLocation(){
  const res = await withTimeout(getCurrentLocation({ accuracy: Accuracy.Balanced }), 8000);
  return { lat: res.coords.latitude, lon: res.coords.longitude };
}

// 앱인토스 WebView 안에서는 네이티브 브릿지(getCurrentLocation)를 우선 사용하고,
// 브릿지가 없는 일반 브라우저(Vercel 배포본 단독 접속 등)에서는 브라우저 geolocation으로 대체한다.
async function getDeviceLocation(){
  try{
    return await getTossLocation();
  }catch(err){
    return await getBrowserLocation();
  }
}

// 위치를 못 쓸 때의 기본값 - 특정 지역(강남구 등)으로 고정하면 범용성이 떨어져서,
// 대신 "지금 이 순간 전국에서 체감온도가 가장 높은 지역"을 매시간 갱신되는 랭킹에서 그대로
// 가져와 기본값으로 쓴다. currentMyDongName은 null로 둬서(내가 아는 내 동네가 아니므로)
// 동 단위 탭에 "우리 동네" 강조가 뜨지 않게 한다.
async function resolveDefaultRegion(){
  try{
    const res = await fetch(`${API_BASE}/api/ranking`);
    if(!res.ok) throw new Error(`ranking ${res.status}`);
    const data = await res.json();
    if(!Array.isArray(data.regions) || data.regions.length === 0) throw new Error('empty ranking payload');

    const hottest = data.regions[0]; // regions는 체감온도 내림차순 정렬 - 0번이 전국 1위(가장 더움)
    currentRegionName = hottest.nameKo;
    currentRegionMatchName = hottest.nameKo;
    currentCityCode = hottest.code;
    currentCoord = { lat: hottest.lat, lon: hottest.lon };
    currentMyDongName = null; // 동 랭킹이 아직 안 왔으니 일단 비워두고, loadDongRanking()에서 1위 동으로 채운다
    isUsingDefaultRegion = true;
  }catch(err){
    // 랭킹 데이터까지 못 가져오면(전면 장애 등) 마지막 안전망으로 MOCK 상수(강남구)를 그대로 둔다
    console.warn('실시간 최고 체감온도 지역 조회 실패, mock 지역으로 계속 진행:', err);
  }
}

async function resolveMyLocation(){
  try{
    const coord = await getDeviceLocation();
    currentCoord = coord;

    const res = await fetch(`${API_BASE}/api/nearest-region?lat=${coord.lat}&lon=${coord.lon}`);
    if(!res.ok) throw new Error('nearest-region lookup failed');
    const data = await res.json();
    if(!data.city) throw new Error('no matching city');

    currentRegionName = data.city.nameKo;
    currentRegionMatchName = data.city.nameKo;
    currentCityCode = data.city.code;
    currentMyDongName = data.dong ? data.dong.name : null;
    isUsingDefaultRegion = false;
  }catch(err){
    // 위치 미지원/권한거부/타임아웃 등 - 지금 가장 더운 지역을 기본값으로 대신 보여준다
    console.warn('위치 연동 실패, 실시간 최고 체감온도 지역으로 대체:', err);
    await resolveDefaultRegion();
    showToast(`위치 정보를 사용할 수 없어 지금 가장 더운 지역(${currentRegionName})${pickParticle(currentRegionName, '을', '를')} 표시합니다`);
  }
}

async function initLocationAndData(){
  await resolveMyLocation();
  // 셋 다 끝날 때까지 기다려야 스켈레톤이 실제 콘텐츠 준비 전에 너무 일찍 사라지지 않는다.
  // allSettled: 하나가 실패해도(예: 동 데이터 없음) 나머지 로딩을 막지 않음 - 각 함수 내부에서 개별 mock 폴백 처리.
  await Promise.allSettled([loadRealWeather(), loadRanking(), loadDongRanking()]);
}

// 위치를 안 쓰기로 한 경우에도 화면은 항상 뜬다 - 이때는 지금 가장 더운 지역을 기본값으로 보여준다
async function loadDataWithoutLocation(){
  await resolveDefaultRegion();
  await Promise.allSettled([loadRealWeather(), loadRanking(), loadDongRanking()]);
}

/* ============================================================
   위치정보 최초 이용 고지 (정책 요구사항)
   - 브라우저 자체 권한 프롬프트보다 먼저, 왜 위치가 필요한지 앱이 직접 설명한다.
   - "최초 이용 시 고지"만 하면 되므로 localStorage에 선택을 기억해두고 재방문 시엔 생략.
============================================================ */
const LOCATION_CONSENT_KEY = 'heatfeel_location_consent_v1';

// 앱인토스 WebView에서는 네이티브 Storage(비동기)를 우선 쓰고, 브릿지가 없는 일반
// 브라우저(로컬/Vercel 단독 접속)에서는 localStorage로 대체한다.
async function getStoredConsent(){
  try{ return await withTimeout(Storage.getItem(LOCATION_CONSENT_KEY), 1500); }
  catch(err){
    try{ return localStorage.getItem(LOCATION_CONSENT_KEY); }
    catch(err2){ return null; } // 프라이빗 브라우징 등 저장소 차단 환경 대비
  }
}

async function setStoredConsent(value){
  try{ await withTimeout(Storage.setItem(LOCATION_CONSENT_KEY, value), 1500); }
  catch(err){
    try{ localStorage.setItem(LOCATION_CONSENT_KEY, value); }
    catch(err2){ /* 저장 실패해도 이번 세션 동작에는 지장 없음 */ }
  }
}

/* ============================================================
   업데이트 알림 창구 (2026-07-16 도입)
   - "무엇이 바뀌었는지" 정색한 공지 대신 화면1 상단에 가볍게 훑고 지나가는 배지로 보여준다.
   - 배포마다 CHANGELOG 맨 앞에 새 항목을 추가한다(버전 키는 배포일 기준). 사용자가 닫으면
     그 버전을 Storage에 기록해두고, 그 버전 이하로는 다시 안 뜬다 - 최초 고지 동의 패턴과 동일.
============================================================ */
const CHANGELOG = [
  {
    // (2026-07-17) 최종 배포(콘솔 검토·정식 실배포) 전까지는 그 사이의 모든 변경이 실제
    // 유저에게는 "한 번도 안 본" 상태이므로, 여러 커밋에 걸친 내용이라도 하나의 버전
    // 항목으로 누적해서 담는다 - 그래야 최종 배포 시점에 이전 항목이 통째로 묻히지 않고
    // 전부 안내된다. 최종 배포가 확인되면 그 다음부터 새 버전 항목을 시작할 것.
    version: '2026-07-17',
    summary: '체감온도 구간을 더 촘촘하게 나눴어요',
    detail: [
      '30도부터 "약간 더움"으로 표시해 체감과 더 가깝게 맞췄어요',
      '체감온도 옆에 불쾌지수도 함께 보여드려요',
      '순위 화면에 우리 동네와 체감온도가 가장 비슷한 지역을 알려드려요',
      '공유 링크가 더 짧고 깔끔해지고, 미리보기 이미지도 더 안정적으로 떠요',
      '시/동 순위 화면에 실제 몇 시 기준 데이터인지 정확히 표시해요',
      '체감 코멘트 줄바꿈이 더 자연스러워졌어요',
      '실기기에서 "이미지 저장"이 반응 없던 문제를 고쳤어요',
      '"공유하기"가 텍스트 복사 대신 진짜 공유창으로 떠요',
    ],
  },
  {
    version: '2026-07-16',
    summary: '전국 평균 대비로 더 정확해졌어요',
    detail: [
      '동 단위 순위, 이제 전국 평균 체감온도 기준으로 비교해요',
      '화면 전환·종료 버튼 동작을 다듬었어요',
    ],
  },
];
const UPDATE_NOTE_SEEN_KEY = 'heatfeel_update_note_seen_v1';

async function getSeenUpdateVersion(){
  try{ return await withTimeout(Storage.getItem(UPDATE_NOTE_SEEN_KEY), 1500); }
  catch(err){
    try{ return localStorage.getItem(UPDATE_NOTE_SEEN_KEY); }
    catch(err2){ return null; }
  }
}

async function setSeenUpdateVersion(value){
  try{ await withTimeout(Storage.setItem(UPDATE_NOTE_SEEN_KEY, value), 1500); }
  catch(err){
    try{ localStorage.setItem(UPDATE_NOTE_SEEN_KEY, value); }
    catch(err2){ /* 저장 실패해도 이번 세션 동작에는 지장 없음 */ }
  }
}

async function initUpdateNote(){
  const latest = CHANGELOG[0];
  if(!latest) return;
  const seenVersion = await getSeenUpdateVersion();
  if(seenVersion === latest.version) return;

  document.getElementById('update-note-summary').textContent = latest.summary;
  document.getElementById('update-note-detail').innerHTML = latest.detail.map(d => `<li>${d}</li>`).join('');
  document.getElementById('update-note').style.display = 'flex';
}

function toggleUpdateNoteExpand(){
  const detailEl = document.getElementById('update-note-detail');
  detailEl.style.display = detailEl.style.display === 'block' ? 'none' : 'block';
}

async function dismissUpdateNote(event){
  if(event) event.stopPropagation();
  document.getElementById('update-note').style.display = 'none';
  await setSeenUpdateVersion(CHANGELOG[0].version);
}

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// 위치 확인 중 보여줄 위트있는 진행 문구. 몇 초씩 걸릴 수 있는 GPS 대기 시간 동안
// "멈춘 게 아니라 실제로 찾고 있다"는 걸 알려주기 위해 주기적으로 문구를 바꿔준다.
const LOCATING_MESSAGES = [
  '지금 계신 동네의 열 추적을 진행하고 있어요',
  '더위 사냥꾼이 GPS로 동네를 뒤지는 중이에요',
  '체감온도 탐정, 위치를 추리하고 있어요',
];
let locatingMessageTimer = null;
let locatingFadeTimer = null;

// 타이핑 대신 블러+페이드로 부드럽게 디졸브시키며 문구를 바꾼다 (CSS의 .fade-out 참고).
function showMessageDissolve(el, text){
  clearTimeout(locatingFadeTimer);
  el.classList.add('fade-out');
  locatingFadeTimer = setTimeout(() => {
    el.textContent = text;
    el.classList.remove('fade-out');
  }, 400);
}

function startLocatingMessages(){
  const el = document.getElementById('location-progress-text');
  let i = 0;
  el.textContent = LOCATING_MESSAGES[0];
  locatingMessageTimer = setInterval(() => {
    i = (i + 1) % LOCATING_MESSAGES.length;
    showMessageDissolve(el, LOCATING_MESSAGES[i]);
  }, 3200);
}

function stopLocatingMessages(){
  clearInterval(locatingMessageTimer);
  clearTimeout(locatingFadeTimer);
  locatingMessageTimer = null;
  locatingFadeTimer = null;
}

// 로딩 중엔 체감온도 숫자를 빠르게 무작위로 바꿔서 "계산 중"인 것처럼 보여준다.
let tempRollTimer = null;
function startTempRollAnimation(){
  const el = document.getElementById('s1-temp');
  // 뒷자리는 0.8초마다 랜덤하게 바뀐다 - 자릿수 전체가 빠르게 돌면 산만해서(사용자
  // 피드백) 훨씬 차분한 속도/폭으로 조정. 앞자리는 (2026-07-17 수정) "3"으로 고정돼
  // 있었는데 30도 미만인 날도 많아 2/3을 번갈아 보여주도록 변경.
  tempRollTimer = setInterval(() => {
    const tens = Math.random() < 0.5 ? '2' : '3';
    el.textContent = tens + Math.floor(Math.random() * 10);
  }, 800);
}
function stopTempRollAnimation(){
  clearInterval(tempRollTimer);
  tempRollTimer = null;
}

// 최초 로딩(스켈레톤 표시) → 실데이터가 준비될 때까지 유지한다(강남구 등 mock 값이
// "최종 상태"처럼 잠깐 보였다가 실제 위치로 바뀌는 걸 사용자가 놓치는 문제를 막기 위함).
// maxWaitMs는 네트워크가 완전히 멈췄을 때를 대비한 안전장치일 뿐, 평소엔 거의 발동하지 않는다.
// locating:true면 rank-badge 대신 위치 확인 중 문구를 보여준다(위치 동의 경로에서만 사용).
async function bootWithSkeleton(loaderFn, { locating = false, maxWaitMs = 20000 } = {}){
  document.body.classList.add('is-loading');
  startTempRollAnimation();
  if(locating){
    document.body.classList.add('is-locating');
    startLocatingMessages();
  }
  await Promise.race([loaderFn(), sleep(maxWaitMs)]);
  stopTempRollAnimation();
  // (2026-07-17 수정) loaderFn은 날씨/랭킹/동 데이터를 병렬로 기다리는데, 그중 날씨가 먼저
  // 끝나 실제 온도를 렌더링해도 롤링 애니메이션은 나머지가 끝날 때까지 계속 돌고 있어서 그
  // 사이 타이밍에 따라 무작위 숫자가 실제 온도 위에 그대로 남을 수 있었다(육안 확인 - 앞자리를
  // "3" 고정에서 "2/3" 교차로 바꾸니 선선한 날에 엉뚱한 숫자가 남는 문제로 드러남). 애니메이션을
  // 멈춘 직후 한 번 더 그려서 항상 최종 실제값으로 확정한다.
  renderScreen1();
  document.body.classList.remove('is-loading');
  if(locating){
    document.body.classList.remove('is-locating');
    stopLocatingMessages();
  }
}

// 체감온도 색상 안내 모달 - 색만으로 구분하기 어려운 사용자를 위해 구간별 온도 기준을 텍스트로 보여준다.
function openBracketInfo(){
  trackClick({ log_name: 'bracket_info_open' });
  document.getElementById('bracket-info-overlay').classList.add('show');
}

function closeBracketInfo(){
  document.getElementById('bracket-info-overlay').classList.remove('show');
}

// 위치 동의를 건너뛰었다가 마음이 바뀐 사용자를 위한 재동의 창구 - 기존 최초 고지 모달을 그대로 재사용한다.
function openLocationConsent(){
  trackClick({ log_name: 'location_consent_reopen' });
  document.getElementById('consent-overlay').classList.add('show');
}

function onConsentAllow(){
  trackClick({ log_name: 'location_consent_allow' });
  setStoredConsent('allowed');
  document.getElementById('consent-overlay').classList.remove('show');
  bootWithSkeleton(initLocationAndData, { locating: true });
}

function onConsentSkip(){
  trackClick({ log_name: 'location_consent_skip' });
  setStoredConsent('skipped');
  document.getElementById('consent-overlay').classList.remove('show');
  bootWithSkeleton(loadDataWithoutLocation);
}

async function startLocationFlow(){
  const consent = await getStoredConsent();
  if(consent === 'allowed'){
    bootWithSkeleton(initLocationAndData, { locating: true });
  }else if(consent === 'skipped'){
    bootWithSkeleton(loadDataWithoutLocation);
  }else{
    document.getElementById('consent-overlay').classList.add('show');
  }
}

// 사용자 식별키(익명 해시) - 로그인 없이 사용자를 구분하기 위한 최소 요건.
// 계정/개인화 기능이 없는 앱이라 지금은 저장만 해두고(향후 어뷰징 방지 등에 활용 가능),
// 실패해도(구버전 앱, 브라우저 단독 접속 등) 화면 동작에는 영향을 주지 않는다.
/* ============================================================
   F8: "무더위 배틀" 크로스 프로모션 배너 (2026-07-17)
   - 더위배틀 문서(F7)에 예약된 "역방향 배너" 자리. 더위배틀이 아직 개발 중이라
     실제 앱이 콘솔에 없는 상태 - 딥링크 대상이 존재해야 배너를 켠다.
   - 더위배틀 출시가 확인되면 이 플래그만 true로 바꾸면 된다.
============================================================ */
const HEATBATTLE_LIVE = false;
function initHeatBattleBanner(){
  const el = document.getElementById('heatbattle-banner');
  if(el) el.style.display = HEATBATTLE_LIVE ? 'flex' : 'none';
}
function openHeatBattle(){
  trackClick({ log_name: 'cross_promo_heatbattle' });
  // 오늘 확인된 intoss://{appName} 패턴을 형제 앱에도 그대로 적용 (F7 딥링크 근거)
  location.href = 'intoss://mudeowebattle';
}

let currentUserKey = null;
async function initUserKey(){
  try{
    const result = await getAnonymousKey();
    if(result && result !== 'ERROR') currentUserKey = result.hash;
  }catch(err){
    console.warn('사용자 식별키 조회 실패(브라우저 환경 등):', err);
  }
}

renderAll();
applyDeepLinkRoute();
startLocationFlow();
initUserKey();
initUpdateNote();
initSafeArea();
initHeatBattleBanner();
trackScreen({ log_name: 'screen_view', screen: currentScreenNum });

// ES 모듈은 top-level 선언이 전역(window)으로 노출되지 않는다.
// index.html의 onclick="..." 인라인 핸들러가 참조하는 함수들만 명시적으로 노출한다.
Object.assign(window, {
  goToScreen,
  switchRankTab,
  saveShareCardImage,
  shareResult,
  onConsentAllow,
  onConsentSkip,
  retryDataLoad,
  openBracketInfo,
  closeBracketInfo,
  openLocationConsent,
  toggleUpdateNoteExpand,
  dismissUpdateNote,
  openHeatBattle,
});
