# 프로젝트 진행상황 보고서

작성일: 2026-08-02  
기준 브랜치: `main`  
기준 커밋: `16f228f`

## 1. 현재 결론

GitHub Pages와 Render Bridge의 배포 및 Discord 연결은 정상화되었다. 프런트엔드는 `discord` 모드로 전환되어 공개 제보 조회까지 실제 Bridge를 사용한다.

다만 Discord OAuth에 필요한 Render 환경변수 일부가 누락되어 로그인 기능은 아직 사용할 수 없다. 따라서 계정 인증, 투표, 로그인 기반 제보 제출, 관리자 기능을 포함한 전체 운영 흐름은 아직 완료되지 않았다.

## 2. 완료된 구현

- Discord 메시지와 첨부파일을 영구 데이터 저장소로 사용하는 무상태 Bridge
- 제보 입력 검증, 이미지 첨부, 대기·승인·반려 상태 관리
- 승인 제보 목록·상세 조회 API
- Discord OAuth 및 서명 세션 구조
- Discord 역할 기반 관리자 권한 확인
- 게임 계정 인증 요청과 관리자 승인·반려
- 사용자 정지와 감사 로그
- 사용자별 제보 투표 및 중복·동시 요청 방지
- Discord 기록을 이용한 Bridge 재시작 후 상태 복구
- 공개 기능 설정 조회와 관리자 기능 설정 변경
- 데모 모드와 Discord 운영 모드 프런트엔드
- Render 배포용 Blueprint와 GitHub Pages 배포 워크플로
- Render 배포 판정용 `/livez`와 실제 Discord 상태 확인용 `/health` 분리

## 3. 현재 실제 배포 확인

확인된 주소와 결과:

- GitHub Pages: `https://runnerkiller.github.io/runnerkiller/` — HTTP 200
- Render `/livez` — HTTP 200
- Render `/health` — Discord 연결 및 설정 로드 정상
- `/api/config` — HTTP 200
- `/api/reports` — HTTP 200, 현재 공개 제보 0건
- `/api/me` 및 Discord 로그인 시작 — `auth_not_configured`로 HTTP 503

Render 무료 플랜 특성상 유휴 후 첫 요청에는 콜드 스타트 지연이 발생할 수 있다.

## 4. 현재 미완료·차단 항목

Render 환경변수에 다음 값이 확인되지 않았다.

- `BRIDGE_PUBLIC_URL`: Discord OAuth 콜백 주소 구성에 필요
- `DEV_REPORTER_DISCORD_ID`: 개발 단계의 대체 제출자 설정

특히 `BRIDGE_PUBLIC_URL`이 없기 때문에 현재 로그인 흐름이 작동하지 않는다. 실제 운영을 위해서는 Discord Developer Portal의 OAuth Redirect URL과 Render 환경변수를 서로 일치시켜야 한다.

로그인 설정 후 다음 순서의 실제 종단 간 검증이 필요하다.

1. Discord 로그인
2. 게임 계정 인증 요청
3. 관리자 승인
4. 제보 제출
5. 관리자 승인
6. 공개 목록 반영
7. 투표
8. Bridge 재시작 후 데이터 복구 확인

## 5. 테스트 및 자동 배포

최신 `main`에서 Bridge 테스트를 직접 실행한 결과:

- 총 테스트: 178개
- 통과: 178개
- 실패: 0개

최근 GitHub Actions:

- GitHub Pages 배포: 성공
- Bridge 테스트 및 비밀정보 검사: 성공

저장소의 Pages 워크플로는 공개 프런트엔드 파일만 배포하며 Bridge 소스와 내부 문서는 배포 산출물에서 제외한다.

## 6. 보안 및 공개 상태

현재 확인된 안전장치:

- 실제 `.env` 파일은 추적되지 않음
- Discord 봇 토큰 형태의 문자열은 코드에 없음
- `.env.example`에는 실제 비밀값이 없음
- 브라우저는 Discord API를 직접 호출하지 않고 Bridge만 호출함
- CORS는 허용된 사이트 출처에만 적용됨

현재 저장소는 공개 상태이므로 소스와 설계 문서를 통해 GitHub Pages·Render·Discord 구조를 누구나 확인할 수 있다. 이 구조를 공개하고 싶지 않다면 향후 공개 프런트엔드 저장소와 비공개 Bridge 저장소를 분리해야 한다.

또한 공개 `/health` 응답에는 운영 진단 정보가 포함되어 있으므로, 공개 서비스 전환 후에는 외부 공개용 상태 응답과 관리자용 상세 진단 응답을 분리하는 것을 검토해야 한다.

## 7. 브랜치 상태

현재 `main`에는 Discord 모드 전환까지 반영되어 있다. 이전 단계별 작업 브랜치가 여러 개 남아 있으며, 일부는 `main`보다 뒤처져 있다. 열린 PR과 이슈는 없다.

## 8. 다음 우선순위

1. Render에 `BRIDGE_PUBLIC_URL`과 OAuth 관련 설정을 입력
2. Discord OAuth Redirect URL을 실제 Pages 주소와 일치시키기
3. 로그인부터 투표까지 종단 간 테스트
4. 문서의 오래된 `demo` 모드·Render 장애 조사 문구를 현재 상태에 맞게 갱신
5. 공개 저장소에서 내부 구현을 숨길 필요가 있으면 저장소·도메인 구조를 분리
