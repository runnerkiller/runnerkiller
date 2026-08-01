# 작업 인수인계 — Discord Bridge 1단계

> 이 문서는 이전 에이전트(Claude)가 다음 에이전트에게 남긴다.
> 큰 그림은 [`../DISCORD_BACKEND_PLAN.md`](../DISCORD_BACKEND_PLAN.md)를 먼저 읽어라.
> 이 문서는 "그 계획 중 실제로 어디까지 됐고, 왜 그렇게 만들었는지"를 설명한다.

## 지금 상태

- 브랜치: `feat/discord-bridge-skeleton` (origin에 push됨, `main`은 건드리지 않음)
- PR: **아직 열지 않았음.** 사용자가 명시적으로 요청하지 않는 한 열지 않는다.
- GitHub Actions: `Bridge tests` 워크플로가 이 브랜치에서 **통과함**
  (https://github.com/runnerkiller/runnerkiller/actions/runs/30694519193 — test job, secret-scan job 모두 success)
- 로컬 환경에 Node.js가 설치되어 있지 않아서, 로컬에서 `npm test`를 돌릴 수 없었다.
  모든 검증은 GitHub Actions에서 이루어졌다. **다음 에이전트도 로컬에 Node가 없을 수 있으니
  먼저 `node --version`으로 확인하고, 없으면 CI 결과로 검증하는 흐름을 유지해라.**
- 계획서(`DISCORD_BACKEND_PLAN.md`) 16절이 정한 "다음 에이전트에게 주는 첫 작업" 7개 항목을
  전부 구현했다. **아직 Discord에 쓰기 요청을 하나도 안 보낸다 — 읽기 전용이다.**

## 계획서 대비 구현 매핑 (16절 체크리스트)

| 계획서 16절 항목 | 구현 위치 | 상태 |
|---|---|---|
| 1. 최신 main 기준 작업 브랜치 | `feat/discord-bridge-skeleton` | 완료 |
| 2. `bridge/` Node.js 프로젝트 골격 | `bridge/package.json`, `bridge/src/` | 완료 |
| 3. `.env.example`, `.gitignore`, `bridge/README.md` | 각각 존재 | 완료 |
| 4. Discord 연결 설정 검증 + `GET /health` | `src/config.js` + `src/health.js` + `src/server.js` | 완료 |
| 5. `configRepository.get()` | `src/repositories/configRepository.js` | 완료 |
| 6. 단위 테스트에서 Discord HTTP 호출 모킹 | `tests/helpers/mockDiscord.js` 사용, 실 네트워크 없음 | 완료 (테스트 75개) |
| 7. 실행·테스트 결과와 다음 단계 제한사항을 PR 설명에 기록 | 이 문서 + 커밋 메시지 | PR을 열 때 이 문서 내용을 요약해서 쓸 것 |

## 왜 이렇게 만들었나 (설계 결정)

### npm 의존성을 0개로 유지했다

사용자가 "돈 쓸 생각 없으니 되도록 유료 API 쓰지 말고 직접 구현하라"고 명시적으로 요청했다.
그래서 유료 서비스를 피하는 것을 넘어 **의존성 자체를 없앴다**:

- `express`/`fastify` 대신 Node 내장 `node:http`
- `discord.js` 대신 Node 내장 `fetch`로 Discord REST API v10을 직접 호출
- `dotenv` 대신 40줄짜리 자체 `.env` 파서 (`src/env.js`)
- `jest`/`vitest` 대신 Node 내장 `node:test` + `node:assert/strict`

`package.json`의 `dependencies`/`devDependencies`가 둘 다 빈 객체다. `npm install`이 필요 없다.
계획서 5절이 "안 쓰는 안드로이드 폰의 Termux에서 돌릴 수 있어야 한다"고 요구하는데,
의존성이 없으면 설치 실패 가능성 자체가 사라진다. **이 원칙을 다음 단계에서도 유지하는 것을
추천한다.** 정말 필요한 게 생기면(예: 이미지 리사이즈) 그때 가서 재검토해라.

### 환경변수를 "단계별 필수 여부"로 나눴다 (`src/config.js`의 `ENV_SPEC`)

계획서 5절은 환경변수 20개를 한꺼번에 나열하지만, 채널을 9개나 만들어야 하는 초기 설정에서
전부 한 번에 요구하면 사용자가 오류를 하나씩 고치다 지친다. 그래서 각 항목에 `stage`(몇 단계에서
필요한지)를 붙였다:

```js
{ key: "DISCORD_VOTES_CHANNEL_ID", stage: 5, kind: "snowflake", required: false },
```

1단계에 진짜 필수인 값은 4개뿐이다: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`,
`DISCORD_CONFIG_CHANNEL_ID`, `DISCORD_CONFIG_MESSAGE_ID`. 나머지는 비어 있어도 서버가 뜨고,
`/health` 응답의 `setup.missingByStage`에 "몇 단계에서 무엇이 필요한지"가 나온다.

**2단계 이후 작업자에게:** 새 환경변수가 필요하면 `ENV_SPEC`에 항목을 추가하고
`stage` 번호를 계획서 13절의 단계 번호와 맞춰라. `bridge/tests/config.test.js`의
"계획서 5절이 요구한 키를 모두 선언한다" 테스트와 `.env.example`도 같이 갱신해야 CI가 통과한다.

### 설정 메시지가 깨지면 기본값으로 되돌리지 않는다

`configRepository.js`에서 가장 중요한 판단이다. 두 가지 실패를 구분한다:

1. **항목 하나가 이상함** (예: `"voting": "yes"` — boolean이 아님) → 그 항목만 기본값으로
   되돌리고 `warnings`에 남긴다. `/health`가 `degraded`가 된다.
2. **JSON 전체가 깨짐** (오타, 메시지 삭제 등) → **예외를 던진다.** 캐시에 이전 값이 있으면
   `stale: true`를 붙여서 이전 값을 계속 쓴다.

2번을 "그냥 기본값 쓰기"로 처리하지 않은 이유: `DEFAULT_FEATURE_FLAGS`는 대부분 `true`다.
관리자가 `maintenanceMode: true`로 사이트를 점검 모드로 걸어뒀는데 설정 메시지가 실수로
깨지면, 기본값으로 되돌아가서 점검 모드가 조용히 풀려버린다. 이게 데이터 깨짐보다 더 위험한
실패라고 판단했다. 이 판단이 마음에 안 들면 바꿔도 되지만, 왜 이렇게 했는지는 알고 바꿔라.

### Discord 클라이언트의 재시도 정책

- `429` (rate limit): 응답 본문의 `retry_after`(초 단위)를 최우선으로 보고, 없으면
  `Retry-After` 헤더를 본다. 계획서 9절의 "429의 retry_after를 지키고 지수 백오프"를
  그대로 구현했다 — 정확히는 429는 서버가 알려준 시간을 지키고, 5xx/네트워크 오류만
  지수 백오프(`500ms, 1000ms, 2000ms...`)를 쓴다.
- `4xx` (401, 404 등): 재시도하지 않고 즉시 던진다. 설정이 틀렸을 가능성이 높은데
  재시도해봐야 똑같이 실패하고 시간만 버린다.
- `fetchImpl`과 `sleep`을 생성자 인자로 주입받는다. 테스트에서 실제 네트워크나 실제
  타이머를 쓰지 않기 위해서다. **2단계 이후에 새 Discord 클라이언트 메서드를 추가할 때도
  이 패턴을 따르면 테스트가 쉬워진다.** `tests/helpers/mockDiscord.js`의 `mockFetch()`를
  재사용해라.

### `/health`가 캐시를 쓰는 이유

감시 도구(uptime robot 같은 것)가 `/health`를 1분마다 찌를 수 있다. 매번 Discord에
왕복하면 요청 한도를 갉아먹는다. 그래서 5초 캐시를 뒀다. Discord 연결이 끊겼는데 설정도
못 읽으면 두 번째 Discord 호출(설정 읽기)은 아예 시도하지 않는다 — 실패가 뻔한 요청을
보내지 않는 것도 요청 한도 절약이다.

## 파일별 요약

```text
bridge/
├─ package.json          의존성 0개, "start"와 "test" 스크립트만 있음
├─ .env.example           값 없이 키만 (계획서 5절과 1:1 대응, config.test.js가 어긋남을 검사)
├─ README.md              사람이 읽는 설정 가이드 (Discord 앱 생성부터 /health 읽는 법까지)
├─ src/
│  ├─ env.js               .env 파일을 읽는 자체 파서 (dotenv 미사용)
│  ├─ config.js            환경변수 검증 + ENV_SPEC (단계별 필수 여부)
│  ├─ discordClient.js     fetch 기반 Discord REST 클라이언트, 429/5xx 재시도
│  ├─ health.js            /health 응답을 만드는 로직 (서버와 분리, 테스트하기 쉽게)
│  ├─ server.js            node:http 서버, 라우팅, CORS, 오류 응답 형식
│  ├─ index.js             진입점 — .env 로드 → config 검증 → 서버 시작
│  └─ repositories/
│     └─ configRepository.js   wr-config 고정 메시지를 읽고 파싱, 캐시, stale 처리
└─ tests/
   ├─ helpers/mockDiscord.js   가짜 fetch, 가짜 sleep, 설정 메시지 생성 헬퍼
   ├─ config.test.js           17개 — 환경변수 검증, .env 파서, .env.example 일치성
   ├─ discordClient.test.js    10개 — 재시도, 429, 5xx, 4xx, 네트워크 오류
   ├─ configRepository.test.js 28개 — JSON 파싱, 기본값 채우기, stale 처리, 캐시
   ├─ health.test.js           9개 — ok/degraded/error 판정, 캐시
   └─ server.test.js           11개 — HTTP 상태 코드, CORS, 오류 형식
                              합계 75개 테스트
```

## 실행/검증 방법

Discord 관련 설정(봇 생성, 채널 생성, 설정 메시지 작성)은 `bridge/README.md`에 이미
자세히 있으니 여기서 반복하지 않는다. 요약만:

```bash
cd wildrift-report/bridge
cp .env.example .env   # 값 채우기 — README.md 1~4절 참고
npm test                # 실 네트워크 없이 모킹된 테스트만 돈다. 토큰 없어도 통과해야 정상.
npm start                # 실제로 Discord에 붙어본다. 토큰/채널 ID가 맞아야 함.
curl http://localhost:8787/health
```

로컬에 Node가 없으면 `.github/workflows/bridge-tests.yml`이 push할 때마다 자동으로
`npm test`와 시크릿 스캔을 돌린다. 이 워크플로는 `wildrift-report/bridge/**` 경로가
바뀔 때만 트리거된다 — 프런트엔드만 고칠 때는 안 돈다.

## 다음 에이전트가 이어서 할 일 (계획서 13절 2단계)

계획서 원문을 그대로 따르되, 이번에 만든 패턴을 재사용해라:

1. **`reportRepository.js`를 `configRepository.js`와 같은 모양으로 만들어라.**
   - Discord 클라이언트는 이미 있다 (`discordClient.js`). `createMessage`, `editMessage`,
     `createThread` 같은 쓰기 메서드를 추가해야 한다 — 지금은 읽기 메서드(`getMessage` 등)만 있다.
   - 새 메서드를 추가할 때도 429/5xx 재시도 로직(`request()` 내부)을 재사용해라. 새로 만들지 마라.
2. **`POST /api/reports`를 `server.js`에 추가해라.** 지금 `server.js`는 `/health` 하나뿐인
   아주 단순한 라우터다. 경로가 늘어나면 `if (url.pathname === ...)` 체인이 지저분해질 텐데,
   이번 단계에서는 아직 프레임워크를 들여올 만큼 복잡하지 않다고 판단했다. 경로가 4~5개를
   넘어가면 그때 라우터 분리를 고려해라 (여전히 의존성 0개를 유지할 수 있는 선에서).
3. **닉네임/설명/카테고리 검증**은 프런트엔드의 `constants/app.js`에 있는
   `NICK_RE`, `PII_RULES`, `CATS`를 Bridge에도 그대로 옮겨 써라 (계획서 10절). 지금은
   Bridge에 검증 로직이 전혀 없다 — 아직 쓰기 API가 없기 때문이다.
4. **아직 로그인이 없으므로** 계획서 2단계 지침대로 "개발 전용 사용자 ID를 서버 환경변수로만
   임시 사용"해라. `reporterDiscordId`를 환경변수에서 읽어와 임시로 박아 넣는 식으로.
5. **테스트는 반드시 모킹으로 작성해라.** `tests/helpers/mockDiscord.js`의 `mockFetch()`가
   응답 배열을 순서대로 돌려주는 방식이라 여러 단계짜리 시나리오(예: 메시지 생성 →
   첨부파일 업로드 → 확인)도 표현할 수 있다.

## 알려진 이슈 / 아직 안 건드린 것

- **GitHub Pages 배포 범위 문제.** `.github/workflows/pages.yml`이 `wildrift-report/` 폴더
  전체를 Pages에 올린다. 이제 그 안에 `bridge/` 소스와 `README.md`도 있어서 웹사이트와 함께
  공개된다. 저장소 자체가 이미 공개라 민감정보 유출은 아니고(`.env`는 커밋 안 됨, CI가 차단),
  실제 토큰도 안 들어있지만, 서버 코드가 정적 사이트에 같이 배포되는 건 깔끔하지 않다.
  고칠 방법 후보: `pages.yml`의 `path`를 `wildrift-report`의 하위 폴더 중 프런트엔드만
  가리키게 바꾸거나, Pages 배포 전에 `bridge/`를 제외하는 스텝을 추가. **아직 안 건드렸다** —
  지금 잘 되는 배포를 건드리는 리스크가 있어서 사용자 확인 없이 손대지 않았다.
- **PR을 아직 안 열었다.** 사용자가 필요하면 요청할 것.
- **줄바꿈 경고.** 커밋할 때마다 "LF will be replaced by CRLF" 경고가 떴다. 이 Windows
  환경의 git 설정(`core.autocrlf`) 때문이며 기능에는 영향 없지만, `.gitattributes`가
  없어서 신경 쓰이면 추가를 고려해라.

## 커밋 목록 (dfa2669 = 계획서 문서가 merge된 시점의 main)

```
ca4b5ef Add .gitignore for secrets and node artifacts
3a14e0b Add bridge skeleton with env loading and config validation
31c0c46 Add zero-dependency Discord REST client
e8b4dd9 Add configRepository reading the pinned Discord config message
1aefff6 Add GET /health endpoint and HTTP server
6fb3499 Document Discord app setup and bridge operation
5926795 Run bridge tests and secret scan in CI
```

각 커밋 메시지 본문에 "무엇을, 왜"가 적혀 있다. `git log -p <hash>`로 각 커밋을 보면
디자인 결정과 코드가 같이 보인다.
