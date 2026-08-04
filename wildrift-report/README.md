# 협곡 기록소

와일드 리프트 비정상 플레이 제보를 운영자 검수 후 공개하고, 인증된 이용자가
신뢰함/의심됨 평가를 남기는 모바일 우선 웹사이트다.

전체 시스템이 어떻게 맞물려 동작하는지는 [ARCHITECTURE.md](./ARCHITECTURE.md)에 정리했다.

## 운영 방식

사이트는 Discord Bridge(`bridge/`)를 통해서만 동작한다. 로그인은 Discord OAuth,
관리자 권한은 Discord 서버 역할로 확인한다. 브라우저에 데이터를 저장하는
데모 모드나 하드코딩된 관리자 비밀번호는 없다.

`runtime-config.js`에 Bridge 주소만 넣는다.

```js
WR.RUNTIME = Object.freeze({
  bridgeUrl: "https://내-bridge-주소.example.com",
});
```

이 파일에는 공개 주소만 넣는다. 봇 토큰, OAuth Client Secret, 세션 서명 키는
반드시 `bridge/.env`에만 보관한다.

## 사이트 문구·기능 설정

사이트 이름, 한 줄 설명, 공지 문구, 기능 On/Off는 관리자로 로그인한 뒤
"관리자 → 사이트 설정 / 기능 설정" 화면에서 바꾼다. 코드를 고치거나
다시 배포할 필요가 없다 — 저장하면 Discord의 `wr-config` 고정 메시지가
바뀌고 방문자 화면에 바로 반영된다.

## 구조

```text
index.html                 정적 사이트 진입점
runtime-config.js          Bridge 주소 설정 (비밀정보 금지)
discord-app.jsx            운영 앱 (진입점 겸 관리자 화면)
components/                제보·공용 UI
constants/                 색상·분류·기본값
services/apiClient.js      Bridge HTTP 클라이언트
utils/security.js          입력 검사·이미지 압축
bridge/                    Node.js Discord 중계 서버 (Pages 배포에서 제외)
```

## 로컬 확인

프로젝트 루트에서 정적 HTTP 서버를 실행한다.

```bash
python3 -m http.server 8000 --directory wildrift-report
```

그 뒤 `http://localhost:8000`에 접속한다. `file://`로 직접 열면 브라우저의 파일
로딩 제한 때문에 동작이 달라질 수 있다. Bridge가 로컬에서 켜져 있어야
데이터가 뜬다 (`bridge/README.md` 참고).

Bridge 테스트:

```bash
cd wildrift-report/bridge
npm test
```

## 안전 관련 제한

- 제보는 사실로 확정된 내용이 아니며 실제 운영 전 법률 검토와 이의제기 절차가 필요하다.
- 게임 계정 인증은 Riot 공식 API가 아니라 스크린샷 육안 검수다.
- Discord는 소규모 초기 운영을 위한 저장소다. 검색량과 데이터가 커지면 정식 DB로 이전해야 한다.

전체 Discord 설계는 [DISCORD_BACKEND_PLAN.md](./DISCORD_BACKEND_PLAN.md), 서버 설치는
[bridge/README.md](./bridge/README.md)를 참고한다.
