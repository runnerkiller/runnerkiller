# 협곡 기록소

와일드 리프트 비정상 플레이 제보를 운영자 검수 후 공개하고, 인증된 이용자가
신뢰함/의심됨 평가를 남기는 모바일 우선 웹사이트다.

## 현재 배포 모드

첫 GitHub Pages 배포는 `runtime-config.js`의 `mode: "demo"`로 동작한다.
데모 데이터는 방문자의 브라우저에만 저장되므로 실제 서비스 데이터가 아니다.

- 관리자 데모 비밀번호: `admin`
- 관리자 → 테스트 도구 → 샘플 데이터 생성으로 주요 화면을 확인할 수 있다.
- 데모 계정: `demo_approved` / `demo1234`

Discord Bridge가 외부 HTTPS 주소에서 실행되면 `runtime-config.js`를 다음처럼 바꾼다.

```js
WR.RUNTIME = Object.freeze({
  mode: "discord",
  bridgeUrl: "https://내-bridge-주소.example.com",
});
```

이 파일에는 공개 주소만 넣는다. 봇 토큰, OAuth Client Secret, 세션 서명 키는
반드시 `bridge/.env`에만 보관한다.

## 구조

```text
index.html                 정적 사이트 진입점
runtime-config.js          demo/discord 모드 선택 (비밀정보 금지)
app.jsx                    브라우저 저장 기반 데모 앱
discord-app.jsx            Discord Bridge 운영 앱
components/                인증·제보·관리자·공용 UI
constants/                 색상·분류·기능 기본값
services/storage.js        데모 저장소
services/apiClient.js      Bridge HTTP 클라이언트
utils/security.js          입력 검사·이미지 압축·데모 해시
bridge/                    Node.js Discord 중계 서버 (Pages 배포에서 제외)
```

## 로컬 확인

프로젝트 루트에서 정적 HTTP 서버를 실행한다.

```bash
python3 -m http.server 8000 --directory wildrift-report
```

그 뒤 `http://localhost:8000`에 접속한다. `file://`로 직접 열면 브라우저의 파일
로딩 제한 때문에 동작이 달라질 수 있다.

Bridge 테스트:

```bash
cd wildrift-report/bridge
npm test
```

## 안전 관련 제한

- 제보는 사실로 확정된 내용이 아니며 실제 운영 전 법률 검토와 이의제기 절차가 필요하다.
- 게임 계정 인증은 Riot 공식 API가 아니라 스크린샷 육안 검수다.
- Discord는 소규모 초기 운영을 위한 저장소다. 검색량과 데이터가 커지면 정식 DB로 이전해야 한다.
- 데모 모드의 로그인과 관리자 비밀번호는 실제 보안 기능이 아니다. 운영 모드는 Discord OAuth와 역할 검사를 사용한다.

전체 Discord 설계는 [DISCORD_BACKEND_PLAN.md](./DISCORD_BACKEND_PLAN.md), 서버 설치는
[bridge/README.md](./bridge/README.md)를 참고한다.
