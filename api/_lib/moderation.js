// 체감 코멘트(F5, 2026-07-18) 최소 금칙어 필터 - 1차 범위는 키워드 블록리스트로 시작(합의된 스펙).
// 실제 운영 중 우회 사례가 발견되면 이 목록을 계속 보강한다.
const BLOCKLIST = [
  '씨발', '시발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새끼', '개새', '좆', '지랄',
  '미친놈', '미친년', '죽어', '꺼져', '걸레', '창녀', '새끼',
  'fuck', 'shit', 'bitch',
  // (2026-07-27 추가) 실제 등록된 코멘트 점검 중 "죽고싶다"가 통과된 걸 발견 - 자기 자신을
  // 향한 표현이라 기존 "죽어"(타인에게 하는 욕설) 패턴으론 안 걸러짐. "더워 죽겠다"류의
  // 흔한 과장 표현("죽겠다")은 의도적으로 넣지 않고, 원함/의지를 나타내는 "고싶" 구문만
  // 걸러서 일상적인 더위 하이퍼볼은 그대로 통과시킨다.
  '죽고싶', '자살', '살기싫',
];

export function containsBlockedWord(text) {
  const normalized = String(text).toLowerCase().replace(/\s+/g, '');
  return BLOCKLIST.some((word) => normalized.includes(word.toLowerCase()));
}
