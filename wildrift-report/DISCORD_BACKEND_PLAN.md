# Discord 저장소 전환 계획 및 구현 지시서

> 이 문서는 다음 개발 에이전트가 그대로 이어서 구현하기 위한 기준 문서다.  
> 대상 저장소: `runnerkiller/runnerkiller`  
> 대상 프로젝트: `wildrift-report/`

## 1. 결정된 방향

이 프로젝트는 초기 운영 비용을 0원으로 유지하기 위해 별도의 데이터베이스를 사용하지 않는다.

- GitHub Pages는 정적 프런트엔드만 제공한다.
- 모든 영구 데이터는 운영자의 비공개 Discord 서버(guild)에 저장한다.
- Discord 메시지, 스레드, 태그, 반응, 첨부파일을 데이터 레코드로 사용한다.
- 웹사이트와 Discord 사이에는 Discord API를 호출하는 작은 중계 프로그램(bridge)이 필요하다.
- 중계 프로그램은 영구 데이터를 저장하지 않는 무상태(stateless) 구조로 만든다.
- 중계 프로그램은 안 쓰는 Android 휴대폰의 Termux 또는 무료 실행 환경에서 돌릴 수 있어야 한다.
- 휴대폰/중계 프로그램이 꺼져도 Discord에 저장된 데이터는 사라지지 않는다. 다만 그동안 웹사이트의 읽기·쓰기 기능은 중단될 수 있다.
- 현재 `localStorage` 저장 방식은 개발 데모용으로만 남기고, Discord 모드에서는 공유 데이터의 원본으로 사용하지 않는다.

### 절대 지켜야 할 원칙

1. Discord 봇 토큰, OAuth client secret, 세션 서명 키를 GitHub Pages 코드나 공개 저장소에 넣지 않는다.
2. 브라우저가 Discord API를 직접 호출하게 만들지 않는다.
3. 영구 데이터의 단일 원본(source of truth)은 Discord다.
4. 중계 프로그램의 메모리 캐시는 성능 개선용일 뿐이며, 재시작 후 Discord 데이터만으로 상태를 복원할 수 있어야 한다.
5. Discord 메시지 ID(snowflake)를 기본 레코드 ID로 사용한다.
6. 모든 JSON 레코드에 `schemaVersion`, `type`, `createdAt`, `updatedAt`을 넣는다.
7. 관리자 판정, 삭제, 설정 변경은 모두 감사 로그로 남긴다.
8. 기존 UI를 한 번에 전부 다시 만들지 말고 저장소 계층부터 교체한다.

## 2. 목표 구조

```text
사용자 브라우저
  └─ GitHub Pages (React UI)
       └─ HTTPS JSON API
            └─ Discord Bridge (무상태)
                 └─ Discord Bot API
                      └─ 비공개 Discord 서버
                           ├─ 설정
                           ├─ 사용자/인증
                           ├─ 제보
                           ├─ 투표
                           ├─ 첨부파일
                           └─ 운영 로그
```

Discord 서버는 저장소 역할을 하고, Bridge는 다음 기능만 수행한다.

- 요청 검증
- Discord OAuth 로그인 처리
- 관리자 권한 확인
- 개인정보 필터링
- Discord 메시지 읽기·쓰기
- Discord 데이터를 웹사이트용 JSON으로 변환
- 메모리 캐시 및 Discord API 속도 제한 대응

Bridge에 SQLite, PostgreSQL, 파일 DB 등 별도 영구 저장소를 추가하지 않는다.

## 3. Discord 서버 채널 설계

운영자가 Discord에서 아래 채널을 만든 뒤 각 채널 ID를 환경변수로 전달한다.

| 채널 | 공개 범위 | 역할 |
|---|---|---|
| `wr-config` | 관리자만 | 기능 설정과 스키마 버전 |
| `wr-users` | 관리자만 | 사용자 프로필과 인증 상태 |
| `wr-verifications` | 관리자만 | 게임 계정 인증 요청 및 사진 |
| `wr-reports-pending` | 관리자만 | 검수 대기 제보 |
| `wr-reports-approved` | 관리자만 | 공개 승인된 제보의 원본 |
| `wr-reports-rejected` | 관리자만 | 반려된 제보 |
| `wr-votes` | 관리자만 | 사용자별 투표 이벤트 |
| `wr-audit-log` | 관리자만 | 관리자 조작 및 삭제 기록 |
| `wr-errors` | 관리자만 | Bridge 오류 알림 |

가능하면 제보 채널은 Forum 채널을 사용한다. Forum 사용이 어렵다면 일반 텍스트 채널과 제보별 스레드를 사용한다.

Discord 채널 자체는 외부에 공개하지 않는다. 일반 사용자는 GitHub Pages 웹사이트만 사용하고, Discord 계정은 OAuth 신원 확인에만 사용한다.

## 4. Discord 레코드 형식

Discord 메시지는 사람이 읽을 수 있는 Embed와 기계가 읽을 수 있는 JSON을 함께 가진다. JSON은 코드 블록 또는 Embed footer의 레코드 ID를 통해 식별한다. 메시지 길이 제한을 고려해 긴 설명은 별도 필드/스레드 메시지로 나눌 수 있다.

### 4.1 기능 설정

`wr-config`의 고정 메시지 하나를 설정 원본으로 사용한다.

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
  "reporterIdentity": false,
  "maintenanceMode": false,
  "updatedAt": "2026-08-01T00:00:00.000Z",
  "updatedByDiscordId": "DISCORD_USER_ID"
}
```

Bridge 환경변수에 `DISCORD_CONFIG_MESSAGE_ID`를 지정한다. 설정 변경 시 이 메시지를 수정하고 동시에 `wr-audit-log`에 이벤트를 추가한다.

### 4.2 사용자 프로필

기존 사이트 자체 아이디/비밀번호 방식은 폐기하고 Discord OAuth2 로그인을 사용한다. 비밀번호와 비밀번호 해시는 Discord에 저장하지 않는다.

```json
{
  "schemaVersion": 1,
  "type": "user",
  "discordUserId": "1234567890",
  "discordUsernameSnapshot": "example",
  "gameNickname": "협곡의파괴자",
  "verificationStatus": "pending",
  "banned": false,
  "createdAt": "2026-08-01T00:00:00.000Z",
  "updatedAt": "2026-08-01T00:00:00.000Z"
}
```

사용자 기본키는 `discordUserId`다. Discord 닉네임은 변경될 수 있으므로 권한과 중복 검사는 반드시 숫자 ID 기준으로 한다.

### 4.3 게임 계정 인증

`wr-verifications`에 사용자별 인증 요청 메시지를 만든다. 인증 사진은 해당 메시지의 Discord 첨부파일로 올린다.

```json
{
  "schemaVersion": 1,
  "type": "verification",
  "discordUserId": "1234567890",
  "gameNickname": "협곡의파괴자",
  "status": "pending",
  "reviewedByDiscordId": null,
  "reviewedAt": null,
  "createdAt": "2026-08-01T00:00:00.000Z",
  "updatedAt": "2026-08-01T00:00:00.000Z"
}
```

첨부파일 URL을 영구 기본키로 저장하지 않는다. 인증 메시지 ID와 첨부파일 ID를 기준으로 필요할 때 Discord API에서 최신 URL을 다시 조회한다.

### 4.4 제보

제보 메시지 ID가 `reportId`다. 검수 상태에 따라 채널을 이동하거나 상태 필드를 수정한다. 구현 단순성을 위해 첫 버전에서는 메시지를 채널 사이에 복제하고, 새 메시지에 이전 `reportId`를 `originReportId`로 기록해도 된다. 단, 외부 API에서는 하나의 안정적인 공개 ID를 반환해야 한다.

```json
{
  "schemaVersion": 1,
  "type": "report",
  "reportId": "DISCORD_MESSAGE_ID",
  "nickname": "신고대상닉네임",
  "nicknameNormalized": "신고대상닉네임",
  "category": "troll",
  "tags": ["고의 피딩"],
  "mode": "랭크",
  "occurredAt": "2026-08-01",
  "description": "관찰한 상황 설명",
  "status": "pending",
  "reporterDiscordId": "1234567890",
  "revealReporter": false,
  "evidenceCount": 1,
  "createdAt": "2026-08-01T00:00:00.000Z",
  "updatedAt": "2026-08-01T00:00:00.000Z",
  "reviewedByDiscordId": null,
  "reviewedAt": null
}
```

허용 상태는 `pending | approved | rejected | hidden | deleted`다. 영구 삭제 요청이 오더라도 먼저 `deleted` 감사 이벤트를 남긴 후 원본 메시지와 첨부파일을 삭제한다.

### 4.5 투표

사용자별 투표 중복을 막기 위해 `wr-votes`에 투표 이벤트 메시지를 저장한다. 레코드 기본키의 논리 조합은 `reportId + discordUserId`다.

```json
{
  "schemaVersion": 1,
  "type": "vote",
  "reportId": "DISCORD_MESSAGE_ID",
  "discordUserId": "1234567890",
  "direction": "up",
  "createdAt": "2026-08-01T00:00:00.000Z",
  "updatedAt": "2026-08-01T00:00:00.000Z"
}
```

첫 버전에서는 한 사용자가 한 제보에 한 번만 투표한다. 투표 변경/취소는 구현하지 않는다. Bridge는 메모리 인덱스로 중복을 빠르게 검사하되, 재시작 시 `wr-votes`를 읽어 인덱스를 복원한다.

## 5. Discord Bridge 요구사항

권장 기술은 Node.js 20 이상이다. 프레임워크는 Express, Fastify 또는 Hono 중 하나를 선택해도 된다. Discord 연결에는 공식 HTTP API 또는 널리 사용되는 Discord 라이브러리를 사용한다.

권장 폴더 구조:

```text
wildrift-report/
├─ bridge/
│  ├─ package.json
│  ├─ src/
│  │  ├─ server.js
│  │  ├─ config.js
│  │  ├─ discordClient.js
│  │  ├─ auth/
│  │  ├─ repositories/
│  │  │  ├─ configRepository.js
│  │  │  ├─ userRepository.js
│  │  │  ├─ verificationRepository.js
│  │  │  ├─ reportRepository.js
│  │  │  ├─ voteRepository.js
│  │  │  └─ auditRepository.js
│  │  ├─ routes/
│  │  ├─ validation/
│  │  └─ cache/
│  ├─ tests/
│  ├─ .env.example
│  └─ README.md
├─ components/
├─ services/
└─ DISCORD_BACKEND_PLAN.md
```

저장소 클래스는 Discord API 세부 구현을 감추고 다음과 같은 인터페이스를 제공한다.

```js
reportRepository.create(input, attachments)
reportRepository.listApproved(options)
reportRepository.getById(reportId)
reportRepository.updateStatus(reportId, decision)
voteRepository.create(reportId, discordUserId, direction)
userRepository.getByDiscordId(discordUserId)
configRepository.get()
configRepository.update(patch, adminDiscordId)
```

### 환경변수

`bridge/.env.example`에는 값 없이 아래 키만 작성한다.

```dotenv
PORT=
PUBLIC_SITE_ORIGIN=
BRIDGE_PUBLIC_URL=
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
DISCORD_ADMIN_ROLE_ID=
DISCORD_CONFIG_CHANNEL_ID=
DISCORD_CONFIG_MESSAGE_ID=
DISCORD_USERS_CHANNEL_ID=
DISCORD_VERIFICATIONS_CHANNEL_ID=
DISCORD_REPORTS_PENDING_CHANNEL_ID=
DISCORD_REPORTS_APPROVED_CHANNEL_ID=
DISCORD_REPORTS_REJECTED_CHANNEL_ID=
DISCORD_VOTES_CHANNEL_ID=
DISCORD_AUDIT_LOG_CHANNEL_ID=
DISCORD_ERRORS_CHANNEL_ID=
SESSION_SIGNING_SECRET=
```

실제 값이 들어간 `.env`는 반드시 `.gitignore`에 포함한다.

## 6. 웹 API 초안

모든 응답은 JSON이며 오류 응답은 `{ "error": { "code": "...", "message": "..." } }` 형식을 사용한다.

### 공개 API

- `GET /health`: Bridge와 Discord 연결 상태
- `GET /api/config`: 공개 가능한 기능 설정
- `GET /api/reports?query=&category=&cursor=`: 승인된 제보 목록
- `GET /api/reports/:reportId`: 승인된 제보 상세
- `GET /api/auth/discord`: Discord OAuth 시작
- `GET /api/auth/discord/callback`: OAuth 콜백
- `POST /api/auth/logout`: 로그아웃
- `GET /api/me`: 현재 사용자와 인증 상태
- `POST /api/reports`: 제보와 최대 3개 이미지 제출
- `POST /api/reports/:reportId/votes`: `up | down` 투표

### 관리자 API

- `GET /api/admin/reports?status=pending`
- `PATCH /api/admin/reports/:reportId/status`
- `DELETE /api/admin/reports/:reportId`
- `GET /api/admin/verifications?status=pending`
- `PATCH /api/admin/verifications/:verificationId/status`
- `PATCH /api/admin/users/:discordUserId/ban`
- `GET /api/admin/config`
- `PATCH /api/admin/config`

관리자 여부는 웹사이트의 하드코딩 비밀번호로 판단하지 않는다. Discord OAuth 사용자 ID와 `DISCORD_ADMIN_ROLE_ID` 또는 명시적인 관리자 ID 목록으로 확인한다.

## 7. 인증과 세션

- 로그인은 Discord OAuth2 Authorization Code 흐름을 사용한다.
- OAuth client secret은 Bridge에만 둔다.
- 로그인 완료 후 Bridge가 서명된 HttpOnly, Secure, SameSite 쿠키를 발급한다.
- 세션은 짧은 수명의 서명 토큰으로 만들어 Bridge 재시작 후에도 별도 DB 없이 검증 가능하게 한다.
- 장기 세션 갱신이 필요하면 Discord OAuth refresh token을 쿠키에 평문 저장하지 않는다. 초기 버전은 세션 만료 후 재로그인 방식으로 단순화한다.
- 관리자 API는 사용자 ID뿐 아니라 매 요청마다 관리자 권한을 검증한다.
- CORS는 `PUBLIC_SITE_ORIGIN` 하나만 허용한다.

## 8. 현재 프런트엔드 변경 방향

현재 `services/storage.js`의 `localStorage` 구현을 바로 삭제하지 않는다. 다음 인터페이스 계층을 추가한다.

```text
services/
├─ storage.js           기존 데모 저장소
├─ apiClient.js         Bridge HTTP 요청
└─ dataService.js       demo/discord 모드 선택
```

`dataService.js`가 제공할 기능:

```js
loadReports()
submitReport(input, files)
loadVotes()
vote(reportId, direction)
loadCurrentUser()
logout()
loadFeatureFlags()
adminDecideReport(reportId, status)
adminDecideVerification(id, status)
adminUpdateFeatureFlags(patch)
```

전환 후 상태 관리 원칙:

- 공유 제보, 투표, 사용자, 인증, 기능 설정은 API 응답만 사용한다.
- `localStorage`에는 UI 환경설정이나 개발 모드 선택만 저장할 수 있다.
- Discord 모드에서 `wr-reports`, `wr-votes`, `wr-accounts`를 원본으로 읽지 않는다.
- 기존 관리자 비밀번호 `admin`은 Discord 관리자 로그인이 완성되는 시점에 제거한다.
- 관리자 기능 스위치는 Discord의 config 메시지를 수정하도록 바꾼다.
- 이미지 압축은 브라우저에서 계속 수행하되, Bridge에서도 파일 형식과 크기를 다시 검증한다.

## 9. 데이터 조회와 성능

Discord는 일반 데이터베이스가 아니므로 모든 요청마다 전체 채널 기록을 다시 읽지 않는다.

- Bridge 시작 시 필요한 최근 메시지를 읽어 메모리 인덱스를 만든다.
- Discord gateway 이벤트 또는 API 작업 결과로 인덱스를 갱신한다.
- 목록 API는 메모리 인덱스에서 검색·정렬·페이지 처리한다.
- 캐시가 없어져도 Discord 메시지로 완전히 재구축할 수 있어야 한다.
- 쓰기 성공은 Discord 메시지 생성/수정 성공 이후에만 프런트엔드에 반환한다.
- Discord API 429 응답의 `retry_after`를 지키고 지수 백오프를 적용한다.
- 동시 투표는 reportId 단위 잠금 또는 직렬화 큐로 중복을 방지한다.
- 첨부파일의 Discord CDN URL을 영구 데이터로 간주하지 않고 요청 시 원본 메시지에서 다시 얻는다.
- 작은 커뮤니티를 전제로 먼저 구현하며, 채널 메시지가 커질 경우 보관 채널 분할 전략을 추가한다.

## 10. 입력 검증과 운영 규칙

기존 프런트엔드 검증만 신뢰하지 말고 Bridge에서 다시 검사한다.

- 닉네임: 기존 `NICK_RE`와 동일한 2~20자 정책
- 아이디 로그인은 제거하고 Discord ID 사용
- 설명: 최소 15자, 최대 길이 제한 추가
- 카테고리와 태그: 허용 목록 검사
- 발생 날짜: 올바른 날짜이며 미래 날짜가 아닌지 검사
- 이미지: 실제 MIME 확인, 허용 형식과 파일 크기 제한
- 개인정보: 기존 `PII_RULES`를 Bridge에도 구현
- 제보 제출 및 투표에 사용자별 속도 제한
- 정지된 사용자의 제출·투표 차단
- 공개 API에서는 reporterDiscordId, 관리자 ID 등 내부 식별자를 반환하지 않는다.
- 승인되지 않은 제보와 인증 사진은 공개 API에서 절대 반환하지 않는다.

## 11. 감사 로그

다음 작업마다 `wr-audit-log`에 별도 메시지를 만든다.

- 제보 승인/반려/숨김/삭제
- 인증 승인/거절
- 사용자 정지/해제
- 기능 설정 변경
- 관리자 데이터 수정
- 데이터 형식 마이그레이션

예시:

```json
{
  "schemaVersion": 1,
  "type": "audit",
  "action": "report.approved",
  "targetId": "DISCORD_MESSAGE_ID",
  "actorDiscordId": "ADMIN_DISCORD_ID",
  "before": { "status": "pending" },
  "after": { "status": "approved" },
  "createdAt": "2026-08-01T00:00:00.000Z"
}
```

## 12. 장애와 복구

- Discord 연결 실패 시 쓰기 API는 성공한 것처럼 응답하지 않는다.
- 읽기 캐시가 존재하면 응답에 `stale: true`를 표시해 제한적으로 제공할 수 있다.
- Bridge가 재시작되면 Discord 채널을 스캔해 인덱스를 복구한다.
- 잘못된 JSON 메시지는 건너뛰고 `wr-errors`에 메시지 ID와 오류를 기록한다.
- Discord 메시지를 운영자가 수동 수정할 가능성을 고려해 스키마 검증을 수행한다.
- 매일 또는 수동 명령으로 Discord 레코드를 JSON 파일로 내보내는 백업 명령을 나중에 추가한다. 백업은 복구용이며 실행 중인 DB로 사용하지 않는다.

## 13. 단계별 구현 순서

### 0단계: 현재 상태 보호

- 최신 `main`에서 새 작업 브랜치를 만든다.
- 현재 GitHub Pages 배포와 데모 기능이 계속 작동하는지 확인한다.
- 한 작업 단위마다 작은 커밋을 만든다.
- Discord 토큰이나 실제 채널 ID가 커밋되지 않았는지 검사한다.

### 1단계: Discord 개발 환경

- Discord Application과 Bot 생성 절차를 `bridge/README.md`에 작성한다.
- 필요한 Bot 권한과 OAuth redirect URI를 문서화한다.
- `bridge/` 기본 프로젝트와 `.env.example`을 만든다.
- `GET /health`가 Discord 연결 상태를 반환하게 한다.
- 설정 채널과 config 메시지를 자동 초기화하는 관리자 스크립트를 만든다.

### 2단계: 제보 읽기/쓰기

- `reportRepository`와 제보 검증을 구현한다.
- 이미지 첨부를 포함한 `POST /api/reports`를 구현한다.
- 승인된 목록/상세 조회 API를 구현한다.
- 기존 화면을 `apiClient`를 통해 목록 조회하도록 연결한다.
- 아직 로그인 기능이 없다면 개발 전용 사용자 ID를 서버 환경변수로만 임시 사용하고 공개 배포에서는 비활성화한다.

### 3단계: 관리자 검수

- Discord OAuth와 관리자 권한 확인을 구현한다.
- 검수 대기 목록과 승인/반려 API를 구현한다.
- 관리자 페이지의 하드코딩 비밀번호를 제거한다.
- 모든 판정을 감사 로그에 남긴다.

### 4단계: 사용자 인증

- Discord 로그인과 `/api/me`를 구현한다.
- 게임 닉네임 및 인증 사진 제출을 구현한다.
- 인증 승인/거절과 사용자 정지를 구현한다.
- 기존 사이트 자체 계정 기능을 제거하거나 Discord 로그인 안내로 교체한다.

### 5단계: 투표

- `voteRepository`와 중복 방지 인덱스를 구현한다.
- 승인된 사용자만 투표할 수 있게 한다.
- 목록 정렬에 신뢰도 점수를 반영한다.
- 동시 요청 테스트와 재시작 후 인덱스 복구 테스트를 수행한다.

### 6단계: 기능 설정과 운영 안정화

- 관리자 기능 스위치를 Discord config 메시지와 연결한다.
- 속도 제한, 오류 채널 알림, 캐시 재구축 명령을 추가한다.
- Termux 실행 및 자동 재시작 방법을 문서화한다.
- GitHub Pages의 API 주소 설정 방법을 문서화한다.
- 기존 데모 모드와 Discord 운영 모드를 명확히 구분한다.

## 14. 테스트 요구사항

최소한 다음 테스트를 자동화하거나 재현 가능한 수동 테스트 문서로 남긴다.

- Discord 연결 성공/실패 상태
- 설정 메시지 파싱과 기본값 처리
- 제보 생성, 사진 첨부, 승인, 반려, 숨김
- 승인되지 않은 제보가 공개 API에 나오지 않는지
- 개인정보 포함 설명 차단
- Discord 사용자 로그인과 로그아웃
- 일반 사용자의 관리자 API 접근 차단
- 인증 대기/승인/거절
- 정지 사용자 기능 차단
- 같은 사용자의 중복 투표 차단
- 서로 다른 사용자의 동시 투표
- Discord API 429 재시도
- Bridge 재시작 후 제보/투표/사용자 인덱스 복구
- 손상된 메시지 한 개가 전체 목록을 망가뜨리지 않는지
- Discord 장애 시 잘못된 성공 응답을 하지 않는지
- 모바일 화면에서 제출과 사진 첨부
- GitHub Pages에서 CORS 및 세션 쿠키 동작

## 15. 완료 조건

다음 조건을 모두 만족해야 Discord 저장소 전환 1차 완료로 본다.

- 서로 다른 두 브라우저에서 동일한 승인 제보 목록이 보인다.
- 제보와 사진이 Discord에만 영구 저장된다.
- Bridge의 로컬 파일과 메모리를 지운 뒤 재시작해도 상태가 복구된다.
- Discord 인증 사용자만 정책에 맞게 제출·투표할 수 있다.
- 관리자는 Discord 권한으로 로그인해 제보와 인증을 처리할 수 있다.
- 관리자 기능 설정이 모든 방문자에게 동일하게 적용된다.
- 공개 API에 비공개 제보, 인증 사진, 내부 Discord ID가 노출되지 않는다.
- 토큰과 secret이 GitHub 커밋 기록에 존재하지 않는다.
- GitHub Pages의 기존 화면이 모바일에서 정상 작동한다.
- 설치, Discord 채널 생성, 환경변수 설정, Termux 실행 방법이 문서화되어 있다.

## 16. 다음 에이전트에게 주는 첫 작업

다음 에이전트는 곧바로 전체 기능을 작성하지 말고 아래 순서로 첫 PR을 만든다.

1. 최신 `main` 기준 작업 브랜치를 만든다.
2. `bridge/` Node.js 프로젝트 골격을 만든다.
3. `.env.example`, `.gitignore`, `bridge/README.md`를 만든다.
4. Discord 연결 설정 검증과 `GET /health`만 구현한다.
5. Discord config 고정 메시지를 읽는 `configRepository.get()`을 구현한다.
6. 단위 테스트에서 Discord HTTP 호출을 모킹한다.
7. 실행·테스트 결과와 다음 단계 제한사항을 PR 설명에 기록한다.

첫 PR에서는 기존 React 화면, 계정, 제보, 투표 로직을 대규모로 수정하지 않는다. 연결 기반과 설정 읽기가 검증된 다음 제보 저장소를 단계적으로 교체한다.
