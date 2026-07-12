import { Accuracy, getCurrentLocation, graniteEvent, getAnonymousKey, Storage, setClipboardText, Analytics, SafeAreaInsets } from '@apps-in-toss/web-framework';
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

// 화면2 - 동 단위: 강남구 내 동 체감온도 mock (강남구 평균 대비 비교수치 포함)
const MOCK_HS_AVERAGE_TEMP = 32.8; // 강남구 전체 평균 체감온도 (동 리스트 비교 기준값)
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
let currentMyDongName = MOCK_MY_DONG_NAME;            // 화면2 동 단위 탭에서 "우리 동네"로 강조 표시할 대상

// 화면1/3에서 실제로 표시할 체감온도. /api/weather 연동 성공 시 실데이터로 교체되고,
// 실패(로컬에서 vercel dev 없이 index.html만 열람 등) 시 MOCK 값을 그대로 사용한다.
let currentFeelsLike = MOCK_FEELS_LIKE_TEMP;
let currentActualTemp = MOCK_ACTUAL_TEMP;
let currentUpdatedLabel = MOCK_UPDATED_AT_LABEL;

// /api/ranking(전국 256개 시군구, 시간당 갱신) 연동 성공 시 교체되는 순위 관련 값들.
// 실패 시 MOCK 값을 그대로 사용한다.
let currentTotalRegions = MOCK_TOTAL_REGIONS;
let currentRankPercent = MOCK_RANK_PERCENT;
let currentCityRank = MOCK_CITY_RANK;
let currentCityRanking = MOCK_CITY_RANKING;

// /api/dong-ranking(내 시군구의 읍면동, 시간당 갱신) 연동 성공 시 교체되는 값들.
let currentHsAverageTemp = MOCK_HS_AVERAGE_TEMP;
let currentDongRanking = MOCK_DONG_RANKING;

/* ============================================================
   체감온도 구간 시스템 (디자인시스템 v1 공용 브래킷)
   - 33도↑ 더움 / 35도↑ 매우 더움 / 38도↑ 폭염 / 열대야(21~06시 & 25도↑)
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
  return 'cool';
}

// CSS :root의 --heat-* 변수와 1:1 대응 (뱃지 점·히어로 숫자·후킹카피 태그·CTA·랭킹 막대에만 사용,
// 탭/"우리 동네" 칩 등 UI 내비게이션은 브랜드 민트 고정 - 각 CSS 규칙에서 별도 처리)
const HEAT_BRACKET_COLOR_VAR = {
  cool: '--heat-cool',
  hot: '--heat-hot',
  veryHot: '--heat-veryhot',
  extreme: '--heat-extreme',
  tropicalNight: '--heat-tropicalnight',
};

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
  cool: [ // 33도 미만 - 쾌적
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
  document.getElementById('s1-helper-region').textContent = currentRegionName;
  document.getElementById('s1-hook-copy').innerHTML =
    currentHookCopyLines.map((line,i)=>{
      // 첫 줄의 지역명만 강조
      return i===0 ? line.replace(currentRegionName, `<span class="accent">${currentRegionName}</span>`) : line;
    }).join('<br/>');
}

function renderCityBarList(){
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
              ${r.isMe ? '<span class="me-chip">우리 동네</span>' : ''}
            </span>
            <span class="bar-temp">${fmtTemp(r.temp)}°</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }).join('');
}

// /api/dong-ranking이 해당 도시에 동 데이터가 없다고(404) 응답했을 때 true - 예외처리 안내로 전환
let dongDataUnavailable = false;

function renderDongList(){
  document.getElementById('s2-dong-title-region').textContent = currentRegionName;
  const wrap = document.getElementById('dong-list');

  if(dongDataUnavailable){
    document.getElementById('hs-avg-temp-label').textContent = '-';
    wrap.innerHTML = `
      <div class="dong-empty-state">
        <div class="dong-empty-icon"></div>
        <div class="dong-empty-title">동 단위 데이터 준비중</div>
        <div class="dong-empty-desc">${withParticle(currentRegionName, '은', '는')} 아직 동 단위 비교를 제공하지 않아요.<br/>상위 행정구역(시/군/구) 기준으로 계속 이용해주세요.</div>
      </div>`;
    return;
  }

  document.getElementById('hs-avg-temp-label').textContent = fmtTemp(currentHsAverageTemp);
  wrap.innerHTML = currentDongRanking.map(d=>{
    const diff = +(d.temp - currentHsAverageTemp).toFixed(1);
    const diffClass = diff >= 0 ? 'up' : 'down';
    const diffLabel = `${diff >= 0 ? '+' : ''}${diff}°`;
    return `
      <div class="dong-row ${d.isMe ? 'highlight':''}" style="--row-heat:${getHeatColorVarRef(d.temp)}">
        <div class="left">
          <div class="rank-chip">${d.rank}</div>
          <div>
            <div class="dong-name" title="${d.name}">${d.name}</div>
            ${d.isMe ? '<span class="dong-badge">우리 동네</span>' : ''}
          </div>
        </div>
        <div class="right">
          <div class="dong-temp">${fmtTemp(d.temp)}°</div>
          <div class="dong-diff ${diffClass}">${diffLabel} 평균 대비</div>
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
  document.getElementById('s3-hook-copy').innerHTML = currentHookCopyLines.join('<br/>');
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
    const updated = new Date(data.updatedAt);
    currentUpdatedLabel = `${updated.getHours()}:${String(updated.getMinutes()).padStart(2,'0')} 기준 (실시간)`;
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
    currentCityRanking = buildCityRankingWindow(data.regions, currentRegionMatchName);
    if(mine){
      currentRankPercent = mine.percentile;
      currentCityRank = mine.rank;
    }
    rankingLoadFailed = false;

    renderScreen1();
    renderCityBarList();
    renderScreen3();
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
    currentHsAverageTemp = data.cityAverage;
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

// 앱인토스 WebView의 하드웨어/제스처 뒤로가기를 화면 스택 이동으로 처리한다(상세→메인 등).
// 루트 화면(1)에서는 아무 것도 하지 않아 기본 종료 동작에 맡긴다.
// 브릿지가 없는 일반 브라우저(로컬/Vercel 단독 접속)에서는 등록 실패를 조용히 무시한다.
try{
  graniteEvent.addEventListener('backEvent', {
    onEvent: () => {
      if(currentScreenNum > 1){
        goToScreen(currentScreenNum - 1);
      }
    },
  });
}catch(err){
  console.warn('backEvent 리스너 등록 실패(브라우저 환경):', err);
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

// 공유카드를 캡처해서 PNG로 다운로드. 서버/외부 API 없이 클라이언트에서 완결.
// html2canvas(원본)는 oklch()/color-mix() 같은 최신 CSS 색상 함수를 못 읽어서
// "Attempting to parse an unsupported color function" 에러로 항상 실패했다 -
// 이 프로젝트 색상 시스템 전체가 oklch 기반이라 html2canvas-pro(포크, 최신 CSS 색상 함수 지원)로 교체.
async function saveShareCardImage(){
  trackClick({ log_name: 'save_image' });
  const card = document.querySelector('#screen-3 .share-card');
  if(!card){
    showToast('이미지 저장 기능을 불러오지 못했습니다');
    return;
  }
  try{
    const canvas = await html2canvas(card, { backgroundColor: null, scale: 2 });
    const link = document.createElement('a');
    link.download = `오늘체감온도_${currentRegionName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('이미지가 저장되었습니다');
  }catch(err){
    console.warn('이미지 저장 실패:', err);
    showToast('이미지 저장에 실패했습니다');
  }
}

// 안드로이드/iOS 단말 기본 공유 시트(어떤 앱으로 공유할지 사용자가 고르는 OS 팝업).
// 지원하지 않는 환경(주로 데스크톱 브라우저)에서는 클립보드 복사로 대체한다.
async function shareResult(){
  trackClick({ log_name: 'share_native' });
  const title = `${currentRegionName} 체감온도 ${fmtTemp(currentFeelsLike)}° · 상위 ${currentRankPercent}%`;
  const text = currentHookCopyLines.join(' ');

  if(navigator.share){
    try{
      await navigator.share({ title, text, url: location.href });
      return;
    }catch(err){
      if(err.name === 'AbortError') return; // 사용자가 공유 시트에서 취소함 - 실패 아님
      console.warn('공유 시트 호출 실패, 클립보드 복사로 대체:', err);
    }
  }

  const clipboardText = `${title}\n${text}\n${location.href}`;
  try{
    await withTimeout(setClipboardText(clipboardText), 1500);
  }catch(err){
    try{
      await navigator.clipboard.writeText(clipboardText);
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
  }catch(err){
    // 위치 미지원/권한거부/타임아웃 등 - 기본 지역(강남구/역삼1동)으로 계속 동작
    console.warn('위치 연동 실패, 기본 지역으로 표시:', err);
    showToast(`위치 정보를 사용할 수 없어 기본 지역(${MOCK_REGION_NAME})${pickParticle(MOCK_REGION_NAME, '을', '를')} 표시합니다`);
  }
}

async function initLocationAndData(){
  await resolveMyLocation();
  // 셋 다 끝날 때까지 기다려야 스켈레톤이 실제 콘텐츠 준비 전에 너무 일찍 사라지지 않는다.
  // allSettled: 하나가 실패해도(예: 동 데이터 없음) 나머지 로딩을 막지 않음 - 각 함수 내부에서 개별 mock 폴백 처리.
  await Promise.allSettled([loadRealWeather(), loadRanking(), loadDongRanking()]);
}

// 위치 없이도 기본 지역(강남구/역삼1동) 기준으로 화면은 항상 뜬다 - 여기서는 데이터만 갱신
async function loadDataWithoutLocation(){
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

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// 위치 확인 중 보여줄 위트있는 진행 문구. 몇 초씩 걸릴 수 있는 GPS 대기 시간 동안
// "멈춘 게 아니라 실제로 찾고 있다"는 걸 알려주기 위해 주기적으로 문구를 바꿔준다.
const LOCATING_MESSAGES = [
  '지금 계신 동네의 열 추적을 진행하고 있어요',
  '더위 사냥꾼이 GPS로 동네를 뒤지는 중이에요',
  '체감온도 탐정, 위치를 추리하고 있어요',
];
let locatingMessageTimer = null;
let locatingTypeTimer = null;

// 문구를 한 번에 바꾸지 않고 한 글자씩 "타이핑되는" 느낌으로 채워 넣는다.
function typeMessage(el, text){
  clearInterval(locatingTypeTimer);
  el.textContent = '';
  let i = 0;
  locatingTypeTimer = setInterval(() => {
    i++;
    el.textContent = text.slice(0, i);
    if(i >= text.length) clearInterval(locatingTypeTimer);
  }, 45);
}

function startLocatingMessages(){
  const el = document.getElementById('location-progress-text');
  let i = 0;
  typeMessage(el, LOCATING_MESSAGES[0]);
  locatingMessageTimer = setInterval(() => {
    i = (i + 1) % LOCATING_MESSAGES.length;
    typeMessage(el, LOCATING_MESSAGES[i]);
  }, 2600);
}

function stopLocatingMessages(){
  clearInterval(locatingMessageTimer);
  clearInterval(locatingTypeTimer);
  locatingMessageTimer = null;
  locatingTypeTimer = null;
}

// 로딩 중엔 체감온도 숫자를 빠르게 무작위로 바꿔서 "계산 중"인 것처럼 보여준다.
let tempRollTimer = null;
function startTempRollAnimation(){
  const el = document.getElementById('s1-temp');
  tempRollTimer = setInterval(() => {
    el.textContent = Math.floor(20 + Math.random() * 20);
  }, 90);
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
startLocationFlow();
initUserKey();
initSafeArea();
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
});
