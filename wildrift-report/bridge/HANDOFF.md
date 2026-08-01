# 작업 인수인계 — Discord Bridge 0.6.0

## 현재 상태

- 브랜치: `feat/discord-bridge-skeleton`
- Bridge 버전: `0.6.0`
- 영구 데이터 원본: 비공개 Discord 채널 메시지와 첨부파일
- npm 런타임 의존성: 0개, Node.js 20 이상
- 프런트엔드: `demo`/`discord` 이중 모드
- 실제 Discord 토큰을 사용한 통합 테스트만 남아 있다.

## 완료된 흐름

1. Discord 연결, 환경변수 검증, 설정 캐시와 `/health`
2. 제보 입력 검증, 사진 저장, 공개 목록과 상세
3. Discord OAuth, HMAC 세션 쿠키, Discord 역할 기반 관리자 권한
4. 제보 승인·반려, 게임 계정 인증, 사용자 정지, 감사 로그
5. 사용자·제보별 단일 투표, 동시 요청 잠금, 재시작 복원, 신뢰도 집계
6. 공개 기능 설정 조회, 관리자 기능 설정 변경, 설정 변경 감사 로그
7. Bridge API를 사용하는 운영용 프런트엔드와 브라우저 저장 기반 데모 프런트엔드

## 핵심 파일

```text
src/index.js                              저장소 조립과 서버 시작
src/server.js                             HTTP API, CORS, 권한·기능 검사
src/repositories/configRepository.js      고정 설정 메시지 읽기·변경
src/repositories/reportRepository.js      제보 저장·조회·판정
src/repositories/userRepository.js        게임 계정 상태·정지
src/repositories/verificationRepository.js 인증 요청·판정·복구
src/repositories/voteRepository.js        투표 중복 방지·집계·복원
tests/                                    Discord HTTP 모킹 단위/통합 테스트
../runtime-config.js                      프런트 demo/discord 전환
../discord-app.jsx                        운영용 UI
```

## 다음 작업자가 먼저 할 일

1. `npm test`를 실행해 모든 테스트가 통과하는지 확인한다.
2. `bridge/README.md` 1~6절에 따라 개인 Discord 서버와 `.env`를 만든다.
3. `npm start` 후 `/health`가 `ok`인지 확인한다.
4. 로컬 프런트를 `discord` 모드로 바꾸고 OAuth → 인증 → 승인 → 제보 → 승인 → 투표를 순서대로 시험한다.
5. 성공 후 안드로이드 Termux 자동 재시작과 HTTPS 터널 운영 절차를 문서화한다.

## 유지해야 할 안전 원칙

- 봇 토큰, OAuth Client Secret, 세션 서명 키는 `.env` 밖으로 내보내지 않는다.
- 브라우저에서 Discord API를 직접 호출하지 않는다.
- 관리자 API는 매 요청마다 Discord 역할을 다시 확인한다.
- 설정 JSON 전체가 깨지면 대부분 true인 기본값으로 조용히 되돌리지 않는다.
- Discord 메시지 작성 재시도 후 중복이 생겨도 논리 키 기준 집계는 하나만 반영한다.
- GitHub Pages 배포 산출물에는 `bridge/`와 문서를 포함하지 않는다.
