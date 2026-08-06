# 사이트·Discord 오류 점검 및 수정 기록

작성일: 2026-08-06  
기준 커밋: `3b280a1`  
원칙: 기존 파일은 수정하지 않고 새 파일만 추가

## 추가한 파일

| 파일 | 목적 |
|---|---|
| `wildrift-report/bridge/src/render-runtime-env.js` | Render가 공식 제공하는 외부 URL로 누락된 `BRIDGE_PUBLIC_URL`을 안전하게 보완 |
| `wildrift-report/bridge/tests/render-runtime-env.test.js` | 자동 보완의 정상·예외·보안 조건을 검증 |
| `scripts/check-live-service.mjs` | Pages, Bridge, Discord 연결, 공개 API, OAuth를 한 번에 읽기 전용 점검 |
| `FIX_REPORT_2026-08-06.md` | 원인·수정·적용법·검증 결과 기록 |

## 실제 사이트에서 확인한 상태

- 새 Pages 주소 `https://runnerkiller.github.io/rift-archive/`는 정상 렌더링된다.
- 명단, 제보하기, 로그인 화면이 표시된다.
- Bridge `/livez`는 HTTP 200이다.
- Bridge `/health`는 `status: ok`, Discord 연결 성공, 설정 메시지 로드 성공이다.
- `/api/config`와 `/api/reports`는 HTTP 200이다.
- 공개 제보는 현재 0건이다.
- `/api/me`와 Discord OAuth 시작 API는 HTTP 503 `auth_not_configured`를 반환한다.
- 브라우저 콘솔에는 Tailwind CDN과 브라우저 Babel을 운영 환경에서 사용한다는 경고가 있지만 현재 화면 렌더링을 중단시키는 오류는 없다.

## Discord 로그인 장애의 원인

Bridge는 다음 값이 모두 있어야 OAuth 서비스를 만든다.

- Discord Client ID와 Client Secret
- Discord 서버 ID와 관리자 역할 ID
- 세션 서명 키
- 공개 사이트 Origin
- Bridge 공개 URL

실서비스 `/health` 결과에서 3단계 누락 값으로 `BRIDGE_PUBLIC_URL`이 확인됐다. 이 값이 없어서 Bridge의 `authService`가 생성되지 않고 로그인 API가 `auth_not_configured`를 반환한다.

`DEV_REPORTER_DISCORD_ID`도 누락으로 표시되지만, 이것은 OAuth 완성 전 개발 모드용 대체 제출자이므로 실제 OAuth 운영에는 필요하지 않다.

## 추가한 수정의 동작

Render는 모든 웹 서비스에 `RENDER_EXTERNAL_URL`과 `RENDER_EXTERNAL_HOSTNAME`을 자동으로 제공한다. 새 `render-runtime-env.js`는 다음 조건에서만 `BRIDGE_PUBLIC_URL`을 보완한다.

1. 기존 `BRIDGE_PUBLIC_URL`이 비어 있다.
2. `RENDER=true`인 실제 Render 환경이다.
3. 후보 주소가 HTTPS이며 경로·쿼리·인증정보·포트가 없다.
4. 호스트가 `*.onrender.com` 형식이다.

관리자가 나중에 자체 도메인으로 `BRIDGE_PUBLIC_URL`을 직접 설정하면 그 값을 절대 덮어쓰지 않는다.

## Render 적용 방법

새 파일이 `main`에 병합된 후 Render 서비스의 Environment에 다음 비밀정보가 아닌 런타임 옵션을 추가한다.

```text
NODE_OPTIONS=--import=./src/render-runtime-env.js
```

저장할 때 **Save and deploy**를 선택한다. 기존 `render.yaml`, `src/index.js`, 환경변수 파일은 수정할 필요가 없다.

대안으로 `BRIDGE_PUBLIC_URL=https://wildrift-report-bridge.onrender.com`을 직접 등록해도 되지만, 새 초기화 파일을 사용하면 Render 서비스 주소를 코드에 고정하지 않고 공식 런타임 값에서 가져온다.

Discord Developer Portal의 Redirect URL은 다음과 일치해야 한다.

```text
https://wildrift-report-bridge.onrender.com/api/auth/discord/callback
```

## 검증 명령

Bridge 전체 테스트:

```bash
cd wildrift-report/bridge
npm test
```

실서비스 읽기 전용 점검:

```bash
node scripts/check-live-service.mjs
```

OAuth 수정 완료 기준:

- `/api/auth/discord?returnTo=/rift-archive/`가 HTTP 302로 Discord에 이동
- 로그인 후 `/api/me`가 HTTP 200
- 인증 요청 → 관리자 승인 → 제보 → 승인 → 투표 순서가 완료

## 수정하지 않은 항목

- 기존 프런트엔드·Bridge·워크플로·Render Blueprint 파일
- Discord 채널 메시지와 권한
- 기존 브랜치와 PR

운영 CDN 경고 제거는 React·Tailwind·Babel 사전 빌드 전환이 필요한 별도 개선 사항이며, 이번 Discord 로그인 장애와 직접 관련이 없어 범위에서 제외했다.
