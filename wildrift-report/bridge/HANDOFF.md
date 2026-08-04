# 작업 인수인계 — Discord Bridge

## 현재 상태

- 브랜치: `main`이 실제 운영 중인 코드다. 기능별 브랜치는 작업 끝나면 main에
  합치고 지운다.
- 영구 데이터 원본: 비공개 Discord 채널 메시지와 첨부파일
- npm 런타임 의존성: 0개, Node.js 20 이상
- 프런트엔드: **Bridge 전용.** 브라우저에 데이터를 저장하는 데모 모드는
  코드에서 완전히 제거했다 (`app.jsx`, `components/Admin.jsx`,
  `components/Auth.jsx`, `services/storage.js` 삭제됨). `discord-app.jsx`
  하나가 진입점이다.
- 실제로 배포해서 끝까지 확인했다: GitHub Pages(정적 사이트) + Render(Bridge)
  + Discord(저장소) 세 부품이 실제로 붙어 있고, `/health`가 `status: ok`다.

## 완료된 흐름

1. Discord 연결, 환경변수 검증, 설정 캐시, `/health`(사람이 보는 상태 확인),
   `/livez`(호스팅의 배포 성공 판정용, Discord를 안 부르고 즉시 응답)
2. 제보 입력 검증, 사진 저장, 공개 목록과 상세
3. Discord OAuth, HMAC 세션 쿠키, Discord 역할 기반 관리자 권한
4. 제보 승인·반려, 게임 계정 인증, 사용자 정지, 감사 로그
5. 사용자·제보별 단일 투표, 동시 요청 잠금, 재시작 복원, 신뢰도 집계
6. 공개 기능 설정 조회, 관리자 기능 설정 변경, 설정 변경 감사 로그
7. 사이트 이름·한 줄 설명·공지 문구를 관리자 화면에서 직접 수정 (`siteTitle`,
   `siteTagline`, `noticeText` — `configRepository.js`의 `SITE_TEXT_DEFAULTS`)
8. 실 서비스 배포와 종단 검증 (Render 무료 플랜, GitHub Pages 무료 호스팅)

## 실제로 겪었던 배포 사고와 원인 (다음에 비슷한 증상 보이면 여기부터 봐라)

**증상: Render에 배포했는데 `/health`·`/livez` 전부 몇 분씩 무응답.**
원인은 두 가지가 겹쳐 있었다.

1. `src/index.js`에서 `server.listen(port, callback)`처럼 호스트를 안
   정해주면 Node가 컨테이너 내부망에서 항상 도달 가능하지 않은 주소에
   바인딩할 수 있다. `server.listen(port, "0.0.0.0", callback)`으로 고쳤다.
2. `render.yaml`의 `healthCheckPath`가 원래 `/health`였는데, Render는
   **이 경로로 배포 성공 여부 자체를 판단한다.** `/health`가 Discord 응답을
   기다리다 느려지면 Render가 "배포 실패"로 오판해 트래픽을 아예 안 붙여준다.
   그래서 Discord를 전혀 안 부르고 즉시 응답하는 `/livez`를 따로 만들고
   `healthCheckPath`를 그쪽으로 바꿨다. `/health`에는 그래도 8초 강제
   타임아웃을 걸어뒀다 (Promise.race, 타이머는 반드시 clearTimeout 하거나
   `.catch(() => {})`로 처리되지 않은 거부를 막을 것).

**증상: Discord 연결은 되는데 설정 메시지 파싱이 계속 "JSON을 못 찾았다"고
실패.** Discord 개발자 포털의 **Bot → Message Content Intent** 토글을
켰다고 착각했는데, 실제로는 **"변경 사항 저장" 버튼을 안 눌러서** 저장이
안 된 상태였다. 저장 안 하면 Discord REST API가 봇이 안 쓴 메시지의
`content`를 항상 빈 문자열로 돌려준다. 토글 화면만 보고 판단하지 말고,
저장 확인 메시지("봇을 성공적으로 업데이트했어요!")까지 봐야 한다.

디버깅에 결정적이었던 것: `ConfigParseError`에 `contentPreview`(실제 받은
content 앞부분)를 담아 `/health` 응답에 노출해뒀다. 대시보드 로그를 못 보는
환경에서 원인을 바로 알 수 있었다 — 앞으로도 이런 종류의 원인 불명 문제는
외부에서 관찰 가능한 응답에 진단 정보를 심는 쪽이 로그 접근보다 빠를 때가
많다.

## 핵심 파일

```text
src/index.js                              저장소 조립과 서버 시작 (0.0.0.0 바인딩 주의)
src/server.js                             HTTP API, CORS, 권한·기능 검사, /livez와 /health
src/repositories/configRepository.js      고정 설정 메시지 읽기·변경, 사이트 문구 검증
src/repositories/reportRepository.js      제보 저장·조회·판정
src/repositories/userRepository.js        게임 계정 상태·정지
src/repositories/verificationRepository.js 인증 요청·판정·복구
src/repositories/voteRepository.js        투표 중복 방지·집계·복원
tests/                                    Discord HTTP 모킹 단위/통합 테스트
render.yaml                               Render 배포 설정, healthCheckPath는 /livez
../runtime-config.js                      Bridge 주소만 담는 공개 설정 (비밀정보 금지)
../discord-app.jsx                        진입점 + 방문자 화면 + 관리자 화면 전부
```

## 로컬에 Node가 없을 때

이 저장소는 여러 세션에서 Windows PC에 Node.js가 설치되어 있지 않은 채로
작업됐다. `npm test`를 로컬에서 못 돌리면:

- 코드를 커밋하고 브랜치를 push하면 `.github/workflows/bridge-tests.yml`이
  자동으로 테스트를 돌린다. 브랜치 이름이 `main`, `feat/**`, `fix/**` 패턴에
  안 맞으면 CI가 안 트리거되니 이름을 맞춰라.
- 실제 배포 동작은 curl로 직접 두드려 확인했다 (`/livez`, `/health`,
  `/api/config`, `/api/reports`). Render 대시보드 접근 권한이 없는 세션에서도
  이 방법으로 배포 실패를 진단하고 고쳤다.

## 다음 작업자가 먼저 할 일

1. CI에서 테스트가 통과하는지 확인한다 (로컬에 Node 없으면 위 방법대로).
2. `bridge/README.md` 1~6절에 따라 개인 Discord 서버와 `.env`(또는 Render
   환경변수)를 만든다.
3. 배포 후 `/livez`와 `/health`가 각각 빠르게 `ok`를 주는지 확인한다.
4. 게임 계정 인증 승인 흐름을 실제 트래픽으로 한 번 더 검증한다 (아직
   충분히 시험 안 됨).

## 유지해야 할 안전 원칙

- 봇 토큰, OAuth Client Secret, 세션 서명 키는 `.env`/호스팅 환경변수 밖으로
  내보내지 않는다. 채팅이나 로그에도 남기지 않는다.
- 브라우저에서 Discord API를 직접 호출하지 않는다.
- 관리자 API는 매 요청마다 Discord 역할을 다시 확인한다.
- 설정 JSON 전체가 깨지면 대부분 true인 기본값으로 조용히 되돌리지 않는다.
- Discord 메시지 작성 재시도 후 중복이 생겨도 논리 키 기준 집계는 하나만 반영한다.
- GitHub Pages 배포 산출물에는 `bridge/`와 문서를 포함하지 않는다
  (`.github/workflows/pages.yml`이 프런트엔드 파일만 골라 복사한다).
- 배포 판정용 헬스체크(`/livez`)와 실제 상태 확인용(`/health`)을 절대
  같은 경로로 합치지 않는다 — 위 사고 사례 참고.
