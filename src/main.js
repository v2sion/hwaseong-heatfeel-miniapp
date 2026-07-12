import { Accuracy, getCurrentLocation } from '@apps-in-toss/web-framework';

/* ============================================================
   MOCK DATA
   - API 연동 전까지 사용하는 하드코딩 상수.
   - 실제 데이터 연동 시 이 블록만 fetch 결과로 교체하면 됨.
   - 네이밍 규칙: MOCK_* / 화면별 접두사(S1_, S2_, S3_) 없이
     공용으로 재사용 (동일 지표는 화면1/3에서 같은 값을 참조).
============================================================ */

// 공통 - 우리 동네(사용자 위치) 정보
// 실제 위치 API 연동 전까지 "화성시(동탄)"로 고정. 2026-02 화성시 4구 분리로 행정구역상
// 정식 명칭은 "화성시동탄구"이므로, 화면 문구는 친숙한 MOCK_REGION_NAME("화성시")을 쓰고
// /api/ranking·/api/dong-ranking 조회에는 실제 코드(MOCK_REGION_MATCH_NAME/MOCK_MY_CITY_CODE)를 쓴다.
const MOCK_REGION_NAME        = "화성시";              // 화면 표시용 (뱃지/후킹카피/공유카드)
const MOCK_REGION_MATCH_NAME  = "화성시동탄구";        // /api/ranking 응답에서 내 지역을 찾을 때 쓰는 실제 행정구역명
const MOCK_MY_CITY_CODE       = "41597";               // 화성시동탄구 시군구 코드 (/api/dong-ranking 조회용)
const MOCK_MY_DONG_NAME       = "동탄4동";             // 화면2 동 단위 탭에서 "우리 동네"로 강조 표시할 대상
const MOCK_COORD              = { lat: 37.2002, lon: 127.0730 }; // 동탄 좌표, 위치 연동 실패 시 폴백
const MOCK_FEELS_LIKE_TEMP    = 34;                     // 체감온도 (°C) - /api/weather 연동 실패 시 폴백
const MOCK_TOTAL_REGIONS      = 256;                    // 전국 시군구 총 개수 (2026-07 기준)
const MOCK_RANK_PERCENT       = 7;                       // 상위 % (더울수록 상위)
const MOCK_CITY_RANK          = 16;                      // 전국 체감온도 순위 (1위=가장 더움)
const MOCK_UPDATED_AT_LABEL   = "오늘 15:00 기준";
const MOCK_CHALLENGE_HASHTAG  = "#오늘체감온도챌린지 · 우리동네체감온도"; // 화면3 하단 워터마크 자리

// 화면2 - 시 단위: 전국 시군구 체감온도 mock 순위 (상위 3 + 화성시 인근 구간)
// isMe: true 인 항목이 강조 표시됨
const MOCK_CITY_RANKING = [
  { rank: 1,  name: "포항시 남구", temp: 37.2, isMe:false },
  { rank: 2,  name: "대구광역시 서구", temp: 36.8, isMe:false },
  { rank: 3,  name: "문경시", temp: 36.5, isMe:false },
  { rank: "...", name: null, temp: null, isMe:false }, // 구간 생략 표시
  { rank: 15, name: "안성시", temp: 34.3, isMe:false },
  { rank: 16, name: "화성시", temp: 34.0, isMe:true  },
  { rank: 17, name: "평택시", temp: 33.9, isMe:false }
];

// 화면2 - 동 단위: 화성시 내 동/읍/면 체감온도 mock (화성시 평균 대비 비교수치 포함)
const MOCK_HS_AVERAGE_TEMP = 32.8; // 화성시 전체 평균 체감온도 (동 리스트 비교 기준값)
const MOCK_DONG_RANKING = [
  { rank: 1, name: "동탄4동", temp: 34.0, isMe:true  },
  { rank: 2, name: "동탄2동", temp: 33.5, isMe:false },
  { rank: 3, name: "봉담읍",  temp: 33.2, isMe:false },
  { rank: 4, name: "향남읍",  temp: 32.9, isMe:false },
  { rank: 5, name: "남양읍",  temp: 32.5, isMe:false },
  { rank: 6, name: "서신면",  temp: 32.0, isMe:false }
];

// 실제 위치(navigator.geolocation + /api/nearest-region) 연동 성공 시 교체되는 "내 위치" 상태.
// 실패/거부/미지원 시 MOCK 값(화성시/동탄)을 그대로 사용한다 - resolveMyLocation() 참고.
let currentCoord = { ...MOCK_COORD };
let currentRegionName = MOCK_REGION_NAME;             // 화면 표시용 지역명
let currentRegionMatchName = MOCK_REGION_MATCH_NAME;  // /api/ranking에서 내 지역을 찾을 때 쓰는 실제 행정구역명
let currentCityCode = MOCK_MY_CITY_CODE;              // /api/dong-ranking 조회용 시군구 코드
let currentMyDongName = MOCK_MY_DONG_NAME;            // 화면2 동 단위 탭에서 "우리 동네"로 강조 표시할 대상

// 화면1/3에서 실제로 표시할 체감온도. /api/weather 연동 성공 시 실데이터로 교체되고,
// 실패(로컬에서 vercel dev 없이 index.html만 열람 등) 시 MOCK 값을 그대로 사용한다.
let currentFeelsLike = MOCK_FEELS_LIKE_TEMP;
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
    const url = `/api/weather?lat=${currentCoord.lat}&lon=${currentCoord.lon}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error(`weather ${res.status}`);
    const data = await res.json();
    if(typeof data.feelsLike !== 'number') throw new Error('invalid weather payload');

    currentFeelsLike = data.feelsLike;
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
    const res = await fetch('/api/ranking');
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
    const res = await fetch(`/api/dong-ranking?city=${currentCityCode}`);
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
function goToScreen(n){
  document.getElementById('screens').className = 'screens at-' + n;
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
   공유 기능: 이미지 저장 / 카카오톡 공유
============================================================ */

// 공유카드를 캡처해서 PNG로 다운로드. 서버/외부 API 없이 클라이언트에서 완결.
async function saveShareCardImage(){
  const card = document.querySelector('#screen-3 .share-card');
  if(!card || typeof html2canvas !== 'function'){
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

// 카카오 JS 키는 서버(/api/config)에서 받아온다 - 커밋된 코드에 하드코딩하지 않기 위함.
let kakaoReady = false;
async function initKakao(){
  try{
    const res = await fetch('/api/config');
    if(!res.ok) return;
    const { kakaoJsKey } = await res.json();
    if(!kakaoJsKey || typeof Kakao === 'undefined') return;
    Kakao.init(kakaoJsKey);
    kakaoReady = Kakao.isInitialized();
  }catch(err){
    console.warn('카카오 SDK 초기화 실패:', err);
  }
}

function shareToKakao(){
  if(!kakaoReady){
    showToast('카카오톡 공유 설정이 아직 준비되지 않았습니다');
    return;
  }
  Kakao.Share.sendDefault({
    objectType: 'feed',
    content: {
      title: `${currentRegionName} 체감온도 ${fmtTemp(currentFeelsLike)}° · 상위 ${currentRankPercent}%`,
      description: currentHookCopyLines.join(' '),
      imageUrl: `${location.origin}/logo.png`,
      link: { mobileWebUrl: location.href, webUrl: location.href },
    },
    buttons: [
      { title: '나도 확인하기', link: { mobileWebUrl: location.href, webUrl: location.href } },
    ],
  });
}

/* ============================================================
   F1: 실제 위치 연동
   - navigator.geolocation으로 좌표를 얻고, /api/nearest-region으로
     가장 가까운 시군구/동을 찾아 currentRegionName 등을 실데이터로 교체한다.
   - 위치 미지원/권한거부/타임아웃 등 실패 시 안내 토스트만 띄우고
     기존 MOCK 값(화성시/동탄)을 그대로 사용 - 비기능 요구사항의
     "위치 권한 거부 시 fallback" 처리.
============================================================ */
function getBrowserLocation(timeoutMs = 8000){
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
  const res = await getCurrentLocation({ accuracy: Accuracy.Balanced });
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

    const res = await fetch(`/api/nearest-region?lat=${coord.lat}&lon=${coord.lon}`);
    if(!res.ok) throw new Error('nearest-region lookup failed');
    const data = await res.json();
    if(!data.city) throw new Error('no matching city');

    currentRegionName = data.city.nameKo;
    currentRegionMatchName = data.city.nameKo;
    currentCityCode = data.city.code;
    currentMyDongName = data.dong ? data.dong.name : null;
  }catch(err){
    // 위치 미지원/권한거부/타임아웃 등 - 기본 지역(화성시/동탄)으로 계속 동작
    console.warn('위치 연동 실패, 기본 지역으로 표시:', err);
    showToast(`위치 정보를 사용할 수 없어 기본 지역(${MOCK_REGION_NAME})${pickParticle(MOCK_REGION_NAME, '을', '를')} 표시합니다`);
  }
}

async function initLocationAndData(){
  await resolveMyLocation();
  loadRealWeather();
  loadRanking();
  loadDongRanking();
}

// 위치 없이도 기본 지역(화성시/동탄) 기준으로 화면은 항상 뜬다 - 여기서는 데이터만 갱신
function loadDataWithoutLocation(){
  loadRealWeather();
  loadRanking();
  loadDongRanking();
}

/* ============================================================
   위치정보 최초 이용 고지 (정책 요구사항)
   - 브라우저 자체 권한 프롬프트보다 먼저, 왜 위치가 필요한지 앱이 직접 설명한다.
   - "최초 이용 시 고지"만 하면 되므로 localStorage에 선택을 기억해두고 재방문 시엔 생략.
============================================================ */
const LOCATION_CONSENT_KEY = 'heatfeel_location_consent_v1';

function getStoredConsent(){
  try{ return localStorage.getItem(LOCATION_CONSENT_KEY); }
  catch(err){ return null; } // 프라이빗 브라우징 등 localStorage 차단 환경 대비
}

function setStoredConsent(value){
  try{ localStorage.setItem(LOCATION_CONSENT_KEY, value); }
  catch(err){ /* 저장 실패해도 이번 세션 동작에는 지장 없음 */ }
}

function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// 최초 로딩(스켈레톤 표시) → mock/실데이터 중 먼저 준비되는 쪽으로 한 번에 리빌.
// 실데이터가 늦어도 최대 1.2초 후엔 mock 값 그대로 노출(무한 스켈레톤 방지), 이후 도착하는 값은 조용히 교체.
async function bootWithSkeleton(loaderFn){
  document.body.classList.add('is-loading');
  await Promise.race([loaderFn(), sleep(1200)]);
  document.body.classList.remove('is-loading');
}

function onConsentAllow(){
  setStoredConsent('allowed');
  document.getElementById('consent-overlay').classList.remove('show');
  bootWithSkeleton(initLocationAndData);
}

function onConsentSkip(){
  setStoredConsent('skipped');
  document.getElementById('consent-overlay').classList.remove('show');
  bootWithSkeleton(loadDataWithoutLocation);
}

function startLocationFlow(){
  const consent = getStoredConsent();
  if(consent === 'allowed'){
    bootWithSkeleton(initLocationAndData);
  }else if(consent === 'skipped'){
    bootWithSkeleton(loadDataWithoutLocation);
  }else{
    document.getElementById('consent-overlay').classList.add('show');
  }
}

renderAll();
startLocationFlow();
initKakao();

// ES 모듈은 top-level 선언이 전역(window)으로 노출되지 않는다.
// index.html의 onclick="..." 인라인 핸들러가 참조하는 함수들만 명시적으로 노출한다.
Object.assign(window, {
  goToScreen,
  switchRankTab,
  saveShareCardImage,
  shareToKakao,
  onConsentAllow,
  onConsentSkip,
  retryDataLoad,
});
