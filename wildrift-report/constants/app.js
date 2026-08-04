window.WR = window.WR || {};
(function () {
  WR.C = {
    bg: "#0E1622",
    surface: "#16202E",
    surfaceHi: "#1D2938",
    line: "#26344A",
    text: "#E6EDF5",
    muted: "#7E8FA3",
    gold: "#C8A96B",
    hack: "#7B6CF6",
    abuse: "#2E9E8F",
    troll: "#D9564A",
    danger: "#E4574C",
  };

  WR.CATS = {
    hack: { label: "맵핵", color: WR.C.hack, tags: [] },
    abuse: {
      label: "어뷰징",
      color: WR.C.abuse,
      tags: ["대리", "부계정", "승부조작", "랭크 판매"],
    },
    troll: {
      label: "고의 트롤",
      color: WR.C.troll,
      tags: ["고의 피딩", "잠수 / AFK", "아군 방해", "채팅 도배"],
    },
  };

  WR.CAT_KEYS = Object.keys(WR.CATS);
  WR.MODES = ["랭크", "전설 랭크"];
  WR.PII_RULES = [
    { label: "전화번호", re: /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/ },
    { label: "주민등록번호", re: /\d{6}[-\s]?[1-4]\d{6}/ },
    { label: "이메일", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
    {
      label: "카카오톡 정보",
      re: /(open\.kakao|오픈\s?채팅|카톡\s?(아이디|id))/i,
    },
    { label: "SNS 계정", re: /(instagram\.com|facebook\.com|tiktok\.com)/i },
    { label: "실명 언급", re: /(본명|실명|진짜\s?이름)/ },
    {
      label: "신상 정보",
      re: /(사는\s?곳|거주지|다니는\s?(학교|회사)|재학\s?중|고등학교|중학교|직장)/,
    },
  ];
  WR.NICK_RE = /^[가-힣ㄱ-ㅎa-zA-Z0-9 _.\-]{2,20}$/;
  // Bridge가 설정을 못 줄 때만 쓰는 대비값이다. 진짜 설정은 Discord의
  // wr-config 고정 메시지가 원본이며 관리자 화면에서 고친다.
  WR.DEFAULT_FEATURE_FLAGS = {
    publicList: true,
    reportSubmission: true,
    evidenceUpload: true,
    evidenceRequired: false,
    authentication: true,
    signup: true,
    voting: true,
    reporterIdentity: true,
    maintenanceMode: false,
  };
  WR.DEFAULT_SITE_TEXT = {
    siteTitle: "협곡 기록소",
    siteTagline: "와일드 리프트 비정상 플레이 제보 · 승인 후 공개",
    noticeText: "",
  };
})();
