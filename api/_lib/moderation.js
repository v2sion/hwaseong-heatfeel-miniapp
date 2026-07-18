// 체감 코멘트(F5, 2026-07-18) 최소 금칙어 필터 - 1차 범위는 키워드 블록리스트로 시작(합의된 스펙).
// 실제 운영 중 우회 사례가 발견되면 이 목록을 계속 보강한다.
const BLOCKLIST = [
  '씨발', '시발', 'ㅅㅂ', '병신', 'ㅂㅅ', '개새끼', '개새', '좆', '지랄',
  '미친놈', '미친년', '죽어', '꺼져', '걸레', '창녀', '새끼',
  'fuck', 'shit', 'bitch',
];

export function containsBlockedWord(text) {
  const normalized = String(text).toLowerCase().replace(/\s+/g, '');
  return BLOCKLIST.some((word) => normalized.includes(word.toLowerCase()));
}
