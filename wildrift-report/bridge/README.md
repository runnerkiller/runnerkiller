# 협곡 기록소 Discord Bridge

웹사이트(GitHub Pages)와 비공개 Discord 서버 사이를 잇는 무상태 중계 서버다.
설계 배경과 전체 로드맵은 [`../DISCORD_BACKEND_PLAN.md`](../DISCORD_BACKEND_PLAN.md)에 있다.

> **다음에 이어서 작업할 에이전트는 [`HANDOFF.md`](./HANDOFF.md)를 먼저 읽어라.**
> 이 README는 "어떻게 설정하고 실행하는지"를 다루고, HANDOFF.md는
> "무엇을 왜 이렇게 만들었고 다음에 뭘 해야 하는지"를 다룬다.

## 지금 구현된 범위

계획서의 6단계 핵심 백엔드와 프런트엔드 연결용 API까지 구현했다.

| 기능                                     | 상태 |
| ---------------------------------------- | ---- |
| 환경변수 검증                            | 완료 |
| Discord REST 클라이언트 (429/5xx 재시도) | 완료 |
| `GET /health`                            | 완료 |
| 기능 설정 읽기·관리자 변경·감사 로그     | 완료 |
| 제보 입력 검증                           | 완료 |
| 제보 작성 + Discord 사진 첨부            | 완료 |
| 승인 제보 목록/상세 조회                 | 완료 |
| Discord OAuth 로그인·로그아웃·세션       | 완료 |
| Discord 역할 기반 관리자 판정            | 완료 |
| 제보 승인·반려·감사 로그                 | 완료 |
| 게임 계정 인증 제출·승인·거절            | 완료 |
| 사용자 조회·정지·해제                    | 완료 |
| 투표 저장소·중복 방지·신뢰도 집계        | 완료 |
| demo/discord 이중 모드 프런트엔드        | 완료 |

현재 `POST /api/reports`는 `wr-reports-pending` 채널에 제보 메시지와 사진을
저장한다. 관리자는 Discord 역할로 권한을 확인한 뒤 승인·반려할 수 있다.

## 필요한 것

- Node.js 20 이상
- 비공개 Discord 서버 (직접 만든 것, 관리자 권한 보유)

npm 의존성은 **하나도 없다.** Node에 내장된 `http`, `fetch`, `node:test`만 쓴다.
`npm install`을 실행할 필요도 없고, 오래된 안드로이드 폰의 Termux에서도 그대로 돌아간다.

## 1. Discord 애플리케이션과 봇 만들기

1. <https://discord.com/developers/applications> 에서 **New Application**을 누르고 이름을 정한다.
2. 좌측 **Bot** 탭 → **Reset Token** → 나온 토큰을 복사한다. 이 값이 `DISCORD_BOT_TOKEN`이다.
   - 토큰은 서버 전체를 조작할 수 있는 비밀번호다. 채팅, 스크린샷, 커밋 어디에도 남기지 않는다.
   - 실수로 노출했다면 같은 화면에서 **Reset Token**을 눌러 즉시 무효화한다.
3. **General Information** 탭의 `Application ID`가 `DISCORD_APPLICATION_ID`이자 `DISCORD_CLIENT_ID`다.
4. **OAuth2** 탭의 `Client Secret`이 `DISCORD_CLIENT_SECRET`이다. (3단계 로그인부터 필요)

### 봇 초대하기

**OAuth2 → URL Generator**에서:

- Scopes: `bot`
- Bot Permissions (1단계에 필요한 최소 권한):
  - View Channels
  - Read Message History

생성된 URL로 봇을 내 비공개 서버에 초대한다.

2단계 이후에는 다음 권한을 추가로 켠다: Send Messages, Embed Links, Attach Files,
Manage Messages, Create Public Threads, Send Messages in Threads.

### OAuth 리디렉션 주소

**OAuth2 → Redirects**에 아래 주소를 등록한다.

```text
{BRIDGE_PUBLIC_URL}/api/auth/discord/callback
```

예: `https://bridge.example.com/api/auth/discord/callback`

## 2. 채널 만들기

Discord 설정에서 **고급 → 개발자 모드**를 켜면 채널을 우클릭해 **ID 복사**를 할 수 있다.

계획서 3절의 채널을 만든다. 전부 **관리자만 볼 수 있는 비공개 채널**이어야 한다.

| 채널                  | 환경변수                              | 필요 단계 |
| --------------------- | ------------------------------------- | --------- |
| `wr-config`           | `DISCORD_CONFIG_CHANNEL_ID`           | 1         |
| `wr-reports-pending`  | `DISCORD_REPORTS_PENDING_CHANNEL_ID`  | 2         |
| `wr-reports-approved` | `DISCORD_REPORTS_APPROVED_CHANNEL_ID` | 2         |
| `wr-reports-rejected` | `DISCORD_REPORTS_REJECTED_CHANNEL_ID` | 3         |
| `wr-audit-log`        | `DISCORD_AUDIT_LOG_CHANNEL_ID`        | 3         |
| `wr-users`            | `DISCORD_USERS_CHANNEL_ID`            | 4         |
| `wr-verifications`    | `DISCORD_VERIFICATIONS_CHANNEL_ID`    | 4         |
| `wr-votes`            | `DISCORD_VOTES_CHANNEL_ID`            | 5         |
| `wr-errors`           | `DISCORD_ERRORS_CHANNEL_ID`           | 6         |

**제보 API까지 사용하려면** `wr-config`, `wr-reports-pending`,
`wr-reports-approved`가 필요하다. **게임 계정 인증까지 사용하려면** `wr-users`,
`wr-verifications`, `wr-audit-log`도 필요하다. 나머지는 비워둬도 서버가 뜨고,
`/health`가 어느 단계에 무엇이 빠졌는지 알려준다.

서버 이름을 우클릭해 **ID 복사**하면 `DISCORD_GUILD_ID`다.

## 3. 설정 메시지 만들기

`wr-config` 채널에 아래 내용을 그대로 보낸다.

````text
협곡 기록소 설정입니다. 이 메시지를 수정하면 사이트 기능이 바뀝니다.
```json
{
  "schemaVersion": 1,
  "type": "config",
  "publicList": true,
  "reportSubmission": true,
  "evidenceUpload": true,
  "evidenceRequired": false,
  "authentication": true,
  "signup": true,
  "voting": true,
  "reporterIdentity": true,
  "maintenanceMode": false,
  "updatedAt": "2026-08-01T00:00:00.000Z",
  "updatedByDiscordId": null
}
```
````

보낸 뒤 그 메시지를 **고정(pin)** 하고, 우클릭 → **메시지 ID 복사**로 얻은 값을
`DISCORD_CONFIG_MESSAGE_ID`에 넣는다.

메시지 앞뒤에 설명을 적어도 된다. Bridge는 ` ```json ` 블록만 읽는다.

### 설정 값이 잘못되면

- 항목 하나가 `true`/`false`가 아니면 그 항목만 기본값으로 되돌리고 `/health`에 경고를 남긴다.
- JSON 전체가 깨지면 **기본값으로 되돌리지 않는다.** 관리자가 일부러 꺼둔 기능이
  오타 하나로 다시 켜지면 안 되기 때문이다. 이때는 마지막으로 성공한 값을
  `stale: true`로 표시해 계속 쓰고, `/health` 상태가 `error`가 된다.

## 4. 환경변수 채우기

```bash
cd wildrift-report/bridge
cp .env.example .env
```

`.env`를 열어 값을 채운다. 1단계에 반드시 필요한 값은 네 개다.

```dotenv
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_CONFIG_CHANNEL_ID=...
DISCORD_CONFIG_MESSAGE_ID=...
DISCORD_REPORTS_PENDING_CHANNEL_ID=...
DISCORD_REPORTS_APPROVED_CHANNEL_ID=...
DEV_REPORTER_DISCORD_ID=...
```

웹사이트를 붙일 때는 `PUBLIC_SITE_ORIGIN`도 채운다. 끝에 `/`를 붙이지 않는다.

```dotenv
PUBLIC_SITE_ORIGIN=https://runnerkiller.github.io
```

`.env`는 `.gitignore`에 들어 있다. **절대 커밋하지 않는다.**

`DEV_REPORTER_DISCORD_ID`는 Discord OAuth가 완성되기 전까지만 사용하는 개발용 제출자다.
Discord 개발자 모드에서 본인 계정을 길게 누르거나 우클릭해 **사용자 ID 복사**로 얻는다.
공개 운영 전에 3단계 OAuth 로그인으로 반드시 교체한다.

OAuth와 관리자 기능을 사용하려면 아래 값도 채운다.

```dotenv
BRIDGE_PUBLIC_URL=https://bridge.example.com
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_ADMIN_ROLE_ID=...
DISCORD_REPORTS_REJECTED_CHANNEL_ID=...
DISCORD_AUDIT_LOG_CHANNEL_ID=...
DISCORD_USERS_CHANNEL_ID=...
DISCORD_VERIFICATIONS_CHANNEL_ID=...
SESSION_SIGNING_SECRET=32자_이상의_임의_문자열
```

`DISCORD_ADMIN_ROLE_ID`는 관리자에게만 부여한 Discord 역할의 ID다. 관리자 역할 조회가
거부되면 Discord Developer Portal의 Bot 설정에서 Server Members Intent를 켰는지와
봇의 서버/채널 권한을 확인한다.

## 5. 실행

```bash
cd wildrift-report/bridge
npm start
```

또는 `node src/index.js`.

환경변수가 잘못되면 무엇이 잘못됐는지 전부 한 번에 알려주고 종료한다.

## 6. 상태 확인

```bash
curl http://localhost:8787/health
```

```json
{
  "status": "ok",
  "version": "0.6.0",
  "checkedAt": "2026-08-01T12:00:00.000Z",
  "uptimeSeconds": 12,
  "discord": {
    "connected": true,
    "botUserId": "...",
    "botUsername": "wr-bridge-bot",
    "latencyMs": 88
  },
  "config": {
    "loaded": true,
    "schemaVersion": 1,
    "updatedAt": "2026-08-01T00:00:00.000Z",
    "stale": false,
    "warnings": []
  },
  "setup": { "missingByStage": { "2": ["DISCORD_REPORTS_PENDING_CHANNEL_ID"] } }
}
```

| status     | HTTP | 뜻                                          |
| ---------- | ---- | ------------------------------------------- |
| `ok`       | 200  | Discord 연결과 설정 읽기 모두 정상          |
| `degraded` | 200  | 동작하지만 설정에 경고가 있거나 값이 오래됨 |
| `error`    | 503  | Discord에 못 붙거나 설정을 읽지 못함        |

### 자주 나오는 오류

| 증상                                     | 원인                                           |
| ---------------------------------------- | ---------------------------------------------- |
| `401: Unauthorized`                      | 봇 토큰이 틀렸거나 재발급 후 `.env`를 안 고침  |
| `Missing Access`                         | 봇을 서버에 초대하지 않았거나 채널 권한이 없음 |
| `Unknown Message`                        | `DISCORD_CONFIG_MESSAGE_ID`가 틀림             |
| `설정 메시지에서 JSON을 찾지 못했습니다` | 고정 메시지에 ` ```json ` 블록이 없음          |

## 7. 테스트

```bash
cd wildrift-report/bridge
npm test
```

모든 테스트는 Discord HTTP 호출을 모킹한다. 실제 네트워크로 나가지 않으므로
봇 토큰 없이도 돌아간다. GitHub Actions에서도 같은 명령이 자동 실행된다.

## 8. 제보 API

### 승인 제보 목록

```http
GET /api/reports?query=닉네임&category=troll&limit=30&cursor=DISCORD_MESSAGE_ID
```

`category`는 `hack`, `abuse`, `troll` 중 하나다. `cursor`에는 이전 응답의
`nextCursor`를 넣는다.

### 승인 제보 상세

```http
GET /api/reports/{DISCORD_MESSAGE_ID}
```

### 제보 제출

```http
POST /api/reports
Content-Type: application/json
```

```json
{
  "nickname": "협곡의파괴자",
  "category": "troll",
  "tags": ["고의 피딩"],
  "mode": "랭크",
  "occurredAt": "2026-08-01",
  "description": "한타 직전에 반복적으로 적진으로 들어가 사망했습니다.",
  "revealReporter": false,
  "evidence": ["data:image/jpeg;base64,..."]
}
```

- 설명은 15~800자다.
- 사진은 JPEG, PNG, WebP만 허용하며 최대 3장, 각 5MB다.
- 개인정보 의심 내용은 Bridge에서 다시 차단한다.
- 저장된 Discord 메시지 ID가 `reportId`다.
- 내부 `reporterDiscordId`는 공개 API 응답에서 제거한다.
- OAuth를 일부러 끈 개발 모드에서는 제출자를 `.env`의 `DEV_REPORTER_DISCORD_ID`로 기록할 수 있다.

`authentication` 기능 설정이 켜져 있으면 `DEV_REPORTER_DISCORD_ID` 대신 로그인 세션의
Discord 사용자 ID를 사용한다. 브라우저 요청에는 `credentials: "include"`가 필요하다.

## 9. Discord 로그인 API

```text
GET  /api/auth/discord?returnTo=/wildrift-report/
GET  /api/auth/discord/callback
GET  /api/me
POST /api/auth/logout
```

- 로그인 시작 시 변조 방지 state 쿠키를 만들고 Discord OAuth 화면으로 이동한다.
- 콜백에서 OAuth 코드를 교환하고 Discord 사용자 ID를 확인한다.
- 세션은 별도 DB에 저장하지 않는 HMAC 서명 쿠키다.
- 세션 쿠키는 `HttpOnly; Secure; SameSite=None`이며 기본 유효기간은 8시간이다.
- OAuth access token은 사용자 확인 후 버리고 Discord 메시지에 저장하지 않는다.
- `returnTo`는 사이트 내부 경로만 허용해 외부 사이트 리디렉션을 막는다.

## 10. 관리자 제보 API

```text
GET   /api/admin/reports?status=pending
PATCH /api/admin/reports/{PENDING_REPORT_ID}/status
```

판정 요청 본문:

```json
{ "status": "approved" }
```

또는 `rejected`를 사용한다. 처리 순서는 다음과 같다.

1. 대기 채널 원본 메시지와 첨부파일을 읽는다.
2. 승인 또는 반려 채널에 상태가 갱신된 새 메시지와 사진을 복제한다.
3. `wr-audit-log`에 관리자 ID와 변경 전후 상태를 기록한다.
4. 위 과정이 성공한 뒤 대기 채널 원본을 삭제한다.
5. 마지막 삭제만 실패하면 데이터 손실을 피하기 위해 성공 결과와 `cleanupPending: true`를 반환한다.

같은 판정 요청이 재시도되면 대상 채널의 최근 레코드에서 `originReportId`를 찾아 기존 결과를
재사용한다. 네트워크 오류 뒤 같은 제보가 중복 생성되는 가능성을 줄이기 위한 처리다.

## 11. 게임 계정 인증 API

로그인한 사용자는 다음 API로 게임 닉네임과 프로필 사진 한 장을 제출한다.

```http
POST /api/verifications
Content-Type: application/json
```

```json
{
  "gameNickname": "협곡의파괴자",
  "evidence": "data:image/jpeg;base64,..."
}
```

- JPEG, PNG, WebP만 허용하며 최대 5MB다.
- 인증 사진은 `wr-verifications`, 사용자 상태는 `wr-users`에 저장된다.
- 같은 사용자의 대기 요청이 이미 있으면 기존 요청을 재사용한다.
- 승인된 사용자와 정지된 사용자는 새 인증을 요청할 수 없다.
- `GET /api/me`의 `user.gameAccount`에서 닉네임, 인증 상태, 정지 상태를 확인한다.
- 본인용 응답에는 내부 Discord 사용자 ID와 인증 사진 URL을 넣지 않는다.

## 12. 관리자 인증·사용자 API

```text
GET   /api/admin/verifications?status=pending
PATCH /api/admin/verifications/{VERIFICATION_ID}/status
GET   /api/admin/users
PATCH /api/admin/users/{DISCORD_USER_ID}/ban
```

인증 판정 본문은 `{ "status": "approved" }` 또는 `rejected`, 정지 변경 본문은
`{ "banned": true }` 또는 `false`다. 인증 판정과 정지·해제는 모두 `wr-audit-log`에
기록된다. 인증 판정 도중 일부 단계가 실패하면 같은 요청을 재시도해 사용자 상태와 감사 로그를
복구할 수 있다.

## 13. 평가·기능 설정 API

```text
POST  /api/reports/{APPROVED_REPORT_ID}/votes
GET   /api/config
GET   /api/admin/config
PATCH /api/admin/config
```

평가 본문은 `{ "direction": "up" }` 또는 `down`이다. Discord 로그인이 되어 있고,
게임 계정 인증이 승인됐으며, 정지되지 않은 사용자만 평가할 수 있다. 같은 사용자와 제보의
논리 키는 한 번만 저장되고 Bridge 재시작 뒤에도 `wr-votes` 메시지로 복원된다.

관리자 설정 변경 본문은 `{ "voting": false }`처럼 필요한 boolean 항목만 보낸다.
Bridge가 `wr-config` 고정 메시지를 갱신하고 `wr-audit-log`에 변경 전후 값을 기록한다.

## 보안 규칙

계획서 1절의 원칙을 그대로 따른다.

1. 봇 토큰, client secret, 세션 서명 키를 저장소나 GitHub Pages 코드에 넣지 않는다.
2. 브라우저가 Discord API를 직접 부르지 않는다. 반드시 Bridge를 거친다.
3. 영구 데이터의 원본은 Discord다. Bridge는 메모리 캐시만 쓰고 DB를 두지 않는다.
4. CORS는 `PUBLIC_SITE_ORIGIN` 하나만 허용한다.

## 다음 단계

1. 실제 비공개 Discord 서버의 토큰과 채널 ID로 통합 테스트한다.
2. Bridge를 사용하지 않는 안드로이드 폰의 Termux에서 실행하고 공개 HTTPS 터널을 연결한다.
3. 프런트엔드 `runtime-config.js`를 `discord` 모드와 공개 Bridge URL로 바꾼다.
4. 소규모 비공개 사용자로 제보·승인·인증·투표 전체 흐름을 시험한다.
