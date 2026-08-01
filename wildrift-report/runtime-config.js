window.WR = window.WR || {};

// 공개 가능한 런타임 설정만 둡니다. Discord 봇 토큰과 OAuth 비밀키는
// 절대로 이 파일에 넣지 말고 Bridge의 .env에만 보관하세요.
WR.RUNTIME = Object.freeze({
  mode: "demo",
  bridgeUrl: "",
});
