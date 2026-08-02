# 이 서비스는 어떻게 동작하는가

> 개발자가 아니어도 읽을 수 있게 쓴 문서다. 세부 구현은
> [DISCORD_BACKEND_PLAN.md](./DISCORD_BACKEND_PLAN.md)(설계),
> [bridge/README.md](./bridge/README.md)(설치),
> [bridge/HANDOFF.md](./bridge/HANDOFF.md)(다음 작업자용)를 참고한다.

## 왜 세 군데로 나뉘어 있는가

돈을 들이지 않고 운영하려면 유료 데이터베이스나 유료 서버를 쓸 수 없다. 그래서
**세 가지 무료 서비스를 이어 붙여서** 하나의 웹사이트처럼 동작하게 만들었다.

```text
① 사용자 브라우저
     │  (사이트를 본다)
     ▼
② GitHub Pages          ← 정적 파일만 올려두는 무료 호스팅
     │  (데이터가 필요하면 요청을 보낸다)
     ▼
③ Render                ← 24시간 켜져 있는 무료 서버 (중계 프로그램)
     │  (Discord에 읽고 쓴다)
     ▼
④ Discord (비공개 서버)   ← 실제 데이터가 저장되는 곳
```

각 부품이 하는 일과, 왜 그 부품이 필요한지 하나씩 설명한다.

## ① 사용자 브라우저

방문자가 `https://runnerkiller.github.io/runnerkiller/`에 접속하면 보는 화면이다.
React로 만든 웹앱이며, 별도 설치 없이 브라우저에서 바로 실행된다.

## ② GitHub Pages — 정적 파일 창고

GitHub Pages는 HTML/CSS/JS 파일을 **그대로 보여주기만** 하는 서비스다. 프로그램을
실행하거나 데이터를 저장하는 기능은 없다. 딱 정적인 웹페이지 호스팅만 한다.

- 비용: 0원 (공개 저장소는 무료)
- `main` 브랜치에 push할 때마다 자동으로 다시 배포된다
  (`.github/workflows/pages.yml`)
- 이 사이트는 두 가지 모드로 동작할 수 있다 (`runtime-config.js`에서 전환):
  - **`demo` 모드**: 데이터를 방문자 브라우저의 `localStorage`에만 저장한다.
    사람마다 다른 데이터를 본다. 지금 실제로 켜져 있는 모드다.
  - **`discord` 모드**: 아래 ③번(Render)에게 데이터를 물어본다. 모든 방문자가
    같은 데이터를 본다. 아직 전환 전이다.

**GitHub Pages는 Discord에 직접 연결할 수 없다.** 정적 파일만 서빙하는 서비스라
프로그램을 실행시킬 수 없기 때문이다. 그래서 ③번이 필요하다.

## ③ Render — 24시간 돌아가는 중계 서버 ("Bridge")

`wildrift-report/bridge/` 폴더에 있는 작은 Node.js 프로그램이다. 이 프로그램의
역할은 딱 하나, **웹사이트와 Discord 사이를 이어주는 것**이다.

- 비용: 0원 (Render 무료 웹 서비스 플랜)
- 이 프로그램 자체는 아무 데이터도 저장하지 않는다 (무상태·stateless). 저장은
  전부 Discord가 한다. Bridge가 재시작되거나 심지어 완전히 새로 만들어져도,
  Discord에 있는 데이터만 있으면 다시 정상 동작한다.
- 하는 일:
  1. 브라우저가 보낸 요청을 받는다 (예: "승인된 제보 목록 줘")
  2. Discord API를 통해 실제 데이터를 가져온다
  3. 브라우저가 쓰기 편한 JSON 형태로 바꿔서 돌려준다
  4. 반대로 글쓰기(제보 제출, 투표 등)도 Discord에 대신 기록해준다
  5. Discord OAuth 로그인, 개인정보 필터링, 관리자 권한 확인도 여기서 한다

**무료 플랜의 특징**: 15분간 아무 요청이 없으면 자동으로 잠들고, 다음 요청이
오면 다시 깨어나는 데 20~30초 정도 걸린다. 방문자가 뜸한 초기 단계에서는
감수할 만한 트레이드오프다.

**의존성이 0개다.** Express나 discord.js 같은 라이브러리를 쓰지 않고 Node.js에
이미 내장된 기능만으로 만들었다. `npm install` 없이 바로 실행된다.

## ④ Discord — 실제 데이터가 저장되는 곳

일반 데이터베이스(MySQL, PostgreSQL 같은 것) 대신 **비공개 Discord 서버**를
데이터 저장소로 쓴다.

- 비용: 0원 (Discord는 무료)
- Discord 서버 안에 채널 9개를 만들어서, 각 채널이 표(table) 하나처럼 동작한다:

| 채널 | 저장하는 것 |
|---|---|
| `wr-config` | 사이트 기능 켜고 끄는 스위치 (관리자가 수정하는 고정 메시지 하나) |
| `wr-reports-pending` | 검수 대기 중인 제보 |
| `wr-reports-approved` | 공개 승인된 제보 |
| `wr-reports-rejected` | 반려된 제보 |
| `wr-users` | 게임 닉네임, 인증 상태 |
| `wr-verifications` | 계정 인증 요청과 인증 사진 |
| `wr-votes` | 누가 어떤 제보에 투표했는지 |
| `wr-audit-log` | 관리자가 뭘 승인/반려/삭제했는지 기록 |
| `wr-errors` | Bridge에서 발생한 오류 알림 |

메시지 하나하나가 데이터 한 줄이다. 예를 들어 제보 하나를 제출하면
`wr-reports-pending` 채널에 그 내용이 담긴 메시지가 하나 생긴다. 관리자가
승인하면 그 내용이 `wr-reports-approved`로 옮겨진다.

**왜 진짜 데이터베이스를 안 쓰는가**: 진짜 DB(PostgreSQL 등)를 무료로 24시간
운영하려면 결국 어딘가에 서버를 띄워야 하고, 데이터 양이 늘면 비용이 발생하기
쉽다. Discord는 이미 무료로 무제한에 가깝게 메시지를 저장해주고, 관리자가
Discord 앱에서 데이터를 직접 눈으로 확인하거나 수동으로 고칠 수도 있다는
장점이 있다. 대신 트래픽이 아주 커지면 정식 DB로 옮겨야 한다 (README의
"안전 관련 제한" 참고).

## 실제로 요청 하나가 어떻게 처리되는가

예: 누군가 사이트에서 "명단" 탭을 열어 공개된 제보 목록을 볼 때.

```text
1. 브라우저: GET https://<Render 주소>/api/reports 요청을 Bridge로 보낸다
2. Bridge:   Discord API에게 "wr-reports-approved 채널의 최근 메시지들 줘" 요청
3. Discord:  메시지 목록을 Bridge에게 돌려준다
4. Bridge:   Discord 메시지를 웹사이트가 이해하는 JSON으로 변환
             (내부 Discord ID 같은 건 여기서 제거한다)
5. Bridge:   그 JSON을 브라우저에게 돌려준다
6. 브라우저: 받은 목록을 화면에 그린다
```

제보를 새로 "제출"하거나 "투표"할 때도 방향만 반대일 뿐 같은 경로를 거친다:
브라우저 → Bridge → Discord (쓰기) → Bridge → 브라우저 (성공/실패 응답).

## 지금 배포 상태

| 부품 | 상태 | 주소 |
|---|---|---|
| GitHub Pages | 배포됨, 정상 접속 확인 | https://runnerkiller.github.io/runnerkiller/ |
| Render (Bridge) | 배포됨, 서버는 켜져 있음 | (Render 대시보드에서 확인) |
| Discord 서버·채널 | 생성 완료, 설정 메시지 등록·고정 완료 | (비공개) |
| 사이트 ↔ Bridge 연결 | **아직 안 함** — `runtime-config.js`가 여전히 `demo` 모드 | - |

**현재 알려진 문제 (조사 중)**: Render의 공개 주소로 `/health`를 호출하면
120초를 기다려도 응답이 단 한 바이트도 안 온다. TCP 연결 자체는 0.05초 만에
성공하므로 Render 인프라까지는 도달하지만, 그 뒤로 어떤 응답도 오지 않는다.

가장 유력한 원인: `render.yaml`의 `healthCheckPath`가 원래 `/health`로
지정되어 있었는데, Render는 **이 경로로 배포 성공 여부 자체를 판단한다**.
Discord 응답이 느릴 때 `/health`가 오래 걸리거나 멈추면, Render가 "이 배포는
살아있지 않다"고 판단해 트래픽을 아예 연결해주지 않았을 수 있다 — 그러면
Bridge 코드를 아무리 고쳐도 외부에서는 계속 무응답으로 보인다.

이 가설에 따라 다음을 고쳤다 (커밋 예정, 아직 배포 결과 확인 전):

- `GET /livez` 경로를 새로 만들었다. Discord를 전혀 부르지 않고 즉시
  `{ "status": "ok" }`를 돌려준다. `render.yaml`의 `healthCheckPath`를
  `/health` 대신 이 경로로 바꿨다.
- `GET /health`는 사람이 실제 상태를 확인할 때 쓰는 용도로 남겨두되, 내부에서
  무슨 일이 있어도 8초 안에는 응답하도록 강제 타임아웃을 걸었다.
- Discord로 보내는 요청마다 시도 횟수와 걸린 시간을 로그로 남기게 했다.

이 문제가 해결되기 전까지는 사이트를 `discord` 모드로 전환하지 않는다.

## 다음 남은 일

1. `/livez` 분리 배포 후 외부에서 응답이 오는지 확인 (Render가 이 배포를
   "살아있다"고 판단하는지)
2. 응답이 오면 `/health`도 정상 범위(길어도 몇 초) 안에 도는지 확인
3. Bridge가 Discord와 실제로 통신되는지 (`/health`의 `discord.connected`가
   `true`인지) 확인
4. `runtime-config.js`를 `discord` 모드로 전환, Render 주소 입력
5. 실제로 제보를 하나 제출해보고 Discord 채널에 메시지가 생기는지, 사이트
   목록에도 뜨는지 끝까지 확인
