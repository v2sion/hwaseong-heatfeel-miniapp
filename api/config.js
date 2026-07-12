// GET /api/config
// 클라이언트에 필요한 공개 설정값을 내려준다. 카카오 JS 키는 도메인 화이트리스트로 보호되는
// "공개" 키라 클라이언트 노출이 원래 정상이지만, 커밋된 코드에 하드코딩하지 않고
// Vercel 환경변수로 관리하기 위해 이 엔드포인트를 거친다.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  return res.status(200).json({
    kakaoJsKey: process.env.KAKAO_JS_KEY || null,
  });
}
