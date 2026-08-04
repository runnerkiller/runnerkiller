window.WR = window.WR || {};

// 공개 가능한 런타임 설정만 둡니다. Discord 봇 토큰과 OAuth 비밀키는
// 절대로 이 파일에 넣지 말고 Bridge의 .env에만 보관하세요.
//
// 사이트 제목·설명·공지와 기능 On/Off는 여기가 아니라 관리자 화면에서
// 바꿉니다 (원본은 Discord wr-config 채널의 고정 메시지).
WR.RUNTIME = Object.freeze({
  bridgeUrl: "https://wildrift-report-bridge.onrender.com",
});
