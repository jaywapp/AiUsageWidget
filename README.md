# AI Usage Dashboard

현재 PC의 AI 토큰 사용량(Claude Code + Codex CLI)을 실시간으로 보여주는 로컬 대시보드.

![지원 항목] 일간/주간/월간/월별 사용량 · 도구별(Claude/Codex)·모델별 사용량 · 플랜 대비 잔여 사용량

## 실행

```powershell
cd D:\workspace\repositories\apps\ai-usage-dashboard
node server.js
# → http://localhost:4789
```

의존성 없음 (Node 18+ 내장 모듈만 사용, 프론트엔드 Chart.js는 CDN).

## 데이터 소스

| 소스 | 경로 | 내용 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | assistant 메시지의 `message.usage` (입력/출력/캐시 토큰), 모델명 |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | `token_count` 이벤트 (누적치→델타 환산), `rate_limits` (플랜·5h/주간 사용률), `turn_context.model` |
| Claude 플랜 | `~/.claude/.credentials.json` | `subscriptionType` (로컬에서만 읽음, 외부 전송 없음) |

## 화면 구성

- **KPI 카드**: 오늘 / 이번 주 / 이번 달 / 누적 토큰 + API 환산 비용
- **플랜 현황**:
  - Codex — CLI가 기록한 공식 사용률(5시간/주간 한도, 리셋 시각) 그대로 표시
  - Claude — 공식 한도가 로그에 없어 *과거 관측 최대 사용량* 대비 추정 게이지로 표시 (`config.json`에서 한도 직접 지정 가능)
- **기간별 차트**: 일별 30일 / 주별 12주 / 월별 12개월, 토큰·비용 전환, Claude/Codex 스택
- **모델별**: 비용 비중 도넛 + 입력/출력/캐시/비용 상세 테이블
- **실시간**: 로그 디렉터리 감시(fs.watch) → SSE로 화면 자동 갱신 (2초 디바운스, 60초 폴백 폴링)

## 데스크톱 위젯 (WPF)

`widget/AiUsageWidget` — C#/.NET 9 WPF 네이티브 위젯 (232×178, 항상 위, 드래그 이동).

- **트레이 아이콘 상주**: 더블클릭 = 표시/숨기기, 우클릭 = 메뉴(설정/대시보드 열기/종료)
- **닫아도 안 꺼짐**: X/Alt+F4 → 트레이로 숨김. 종료는 트레이 메뉴에서만
- **서버 자동 기동**: 대시보드 서버가 죽어 있으면 위젯이 자동으로 재기동
- **크기 조절**: 우하단 ◢ 그립 드래그, 또는 설정 창(위젯 우클릭/트레이 메뉴)에서 너비·높이·갱신 주기 수치 입력. 내용은 Viewbox로 비율 스케일링
- **설정 저장**: 크기/위치/갱신 주기 → `%APPDATA%\AiUsageWidget\settings.json` (재시작 시 복원)
- 단일 인스턴스(Mutex)

```powershell
cd widget\AiUsageWidget
dotnet build -c Release
# 실행: widget.cmd (루트) 또는 bin\Release\net9.0-windows\AiUsageWidget.exe
```

윈도우 시작 시 자동 실행: `shell:startup`에 `AI 사용량 위젯.lnk` (등록되어 있음).

## 설정 (config.json)

```jsonc
{
  "port": 4789,
  "feedbackEndpoint": null,  // 릴리스 빌드에서 Vercel 제보 함수 URL 주입
  "claudePlan": {
    "name": null,             // 표시용 플랜명 (null이면 credentials에서 자동 감지)
    "limit5hTokens": null,    // 5시간 한도 토큰 수 직접 지정 (null이면 관측 최대치 추정)
    "limit7dTokens": null     // 주간 한도
  },
  "pricingOverrides": {       // 모델명 부분 일치 → $/MTok
    "gpt-5.5": { "input": 1.25, "output": 10, "cacheRead": 0.125 }
  }
}
```

## 제보

WPF 위젯의 설정 창에서 **제보**를 선택하면 제목·내용·선택 연락처를 프로젝트 GitHub Issues로 보낼 수 있습니다. 전송 전에 앱 버전과 Windows 플랫폼 정보가 표시되며 로그, 로컬 경로, 계정 정보는 첨부하지 않습니다.

클라이언트는 `config.json`의 `feedbackEndpoint`에 설정된 HTTPS 중계 함수만 호출합니다. 중계 함수는 대상 저장소를 `jaywapp/AiUsageWidget`으로 고정하고 제목에 `[제보]`를 붙이며 `제보` 라벨을 강제합니다. 입력 길이 제한, 허니팟, 작업 증명, 요청 속도 제한, 허용 Origin 검사를 적용합니다.

### Vercel 제보 중계 배포

Vercel에는 로컬 대시보드가 아니라 `api/feedback.js` 함수만 배포합니다. 다음 설정이 필요합니다.

- GitHub Actions Secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- GitHub Actions Variable: `FEEDBACK_ENDPOINT` — 프로덕션 HTTPS URL이며 `/api/feedback`으로 끝나야 함
- Vercel 서버 환경 변수: `GITHUB_ISSUES_TOKEN` — 이 저장소의 Issues 쓰기만 허용하는 최소 권한 토큰
- 선택 Vercel 환경 변수: `ALLOWED_ORIGINS` — 브라우저 호출을 허용할 Origin의 쉼표 구분 목록
- 저장소의 `제보` 라벨은 최초 배포 전에 생성

Vercel Git Integration이 활성화되어 있으면 GitHub Actions와 같은 `main` 커밋을 중복 배포하지 않도록 Git Integration의 프로덕션 자동 배포를 비활성화해야 합니다.

### 대시보드가 로컬 전용인 이유

대시보드 서버는 사용자 PC의 `~/.claude/projects`, `~/.codex/sessions`, `~/.claude/.credentials.json`을 직접 읽습니다. Vercel 런타임은 이 로컬 파일에 접근할 수 없으므로 대시보드 자체를 호스팅하면 핵심 기능이 동작하지 않습니다. 원격 대시보드가 필요하면 별도의 로컬 수집기, 인증, 원격 저장소 설계를 먼저 결정해야 합니다.

## 메모

- 비용은 **API 종량제 환산 참고치**입니다 (구독 플랜 실청구액 아님).
- Claude 항목은 `message.id + requestId`로 전역 중복 제거(같은 응답이 여러 줄/파일에 기록되는 케이스 대응).
- 파일별 mtime/size 증분 캐시 — 초기 스캔 후에는 변경 파일만 재파싱.

## 테스트

```powershell
npm test
```
