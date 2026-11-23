# 설치와 실행 환경

## 검증 범위

배포 ZIP은 `.claude-plugin/plugin.json`, 스킬, Node CLI, Python 스크립트를 포함한다. 로컬 MCP 서버, Node·Python 런타임, 사용자 프로필, Jira 연결, Google 인증은 포함하지 않는다.

| 실행 경로 | 확인한 범위 |
|---|---|
| 배포 패키지의 Node CLI | 패키지에서 CLI 실행 확인 |
| Codex 로컬 설치 | 마켓플레이스 설치·갱신과 설치된 CLI의 Google API 동기화 확인 |
| Claude Code 로컬 설치 | 마켓플레이스 설치·갱신 확인. 갱신 후 재시작 필요 |
| Claude·Codex 데스크톱 ZIP 업로드 | 업로드 후 전체 워크플로우 실행은 미검증. 아래 로컬 실행 전제 확인 필요 |

플러그인 파일을 인식하는 것만으로 로컬 프로그램과 인증이 준비되지는 않는다. 일반 채팅이나 격리된 실행 환경에서는 이 컴퓨터의 파일·실행 파일·ADC에 자동 접근한다고 가정하지 않는다. 업로드만으로 CLI 설치와 동일하게 동작한다고 안내하지 않는다.

공식 안내: [Claude 플러그인 사용](https://support.claude.com/en/articles/13837440-use-plugins-in-claude), [OpenAI 데스크톱 전용 플러그인](https://developers.openai.com/plugins/deploy/desktop-only), [OpenAI ZIP 인식 형식](https://developers.openai.com/plugins/deploy/submission-errors).

## 로컬 설치

Claude Code:

```sh
claude plugin marketplace add swlee-mzc/sprintlog
claude plugin install sprintlog@sprintlog
```

갱신:

```sh
claude plugin marketplace update sprintlog
claude plugin update sprintlog@sprintlog
```

Codex:

```sh
codex plugin marketplace add swlee-mzc/sprintlog
codex plugin add sprintlog@sprintlog
```

다른 Codex 홈을 쓰면 명령 앞에 `CODEX_HOME`을 지정한다. CLI가 출력한 설치 경로와 버전을 확인한다. 설치본은 직접 수정하지 않는다.

## 실행 전제와 프로필

- Node.js 24 이상과 Python 3, `openpyxl>=3.1,<4`가 필요하다. `local.python`에는 openpyxl이 설치된 Python을 지정한다.
- Jira 근거 조회·수정에는 해당 호스트의 Atlassian 도구 연결이 필요하다. ZIP은 이 연결을 생성하지 않는다.
- Google 자동 반영에는 대상 파일 편집 권한과 [Sheets API 사용자 인증](google-api.md)이 필요하다.
- 프로필은 `${CLAUDE_CONFIG_DIR}/sprintlog/profile.json`이다. 환경변수가 없으면 `~/.claude/sprintlog/profile.json`을 읽는다. `CODEX_HOME`은 설치 홈이며 sprintlog 프로필을 바꾸지 않는다. Codex에서도 기존 회사 프로필을 쓰려면 `CLAUDE_CONFIG_DIR`를 명시한다.
- `doctor`는 로컬 환경·프로필·스냅샷을 점검한다. Google OAuth 권한이나 원격 탭까지 검증하지 않으므로 API 연결은 저장된 주차로 `sheet sync` 미리보기를 실행해 확인한다.

스킬의 `${CLAUDE_PLUGIN_ROOT}`는 Claude Code의 설치 경로 표기다. 이 환경변수를 제공하지 않는 호스트에서는 설치 결과에 나온 실제 플러그인 경로로 바꿔 `node <설치 경로>/bin/sprintlog.mjs`를 실행한다. 전역 명령이 필요하면 플러그인 폴더에서 `pnpm link --global`로 등록할 수 있으나 필수는 아니다.

## 사용자별 Google 파일 준비

사용자 전용 Google Sheets 파일에 다음을 준비한다. CLI는 파일·탭·헤더를 자동 생성하지 않는다.

1. `sheet.tabName`의 고정 탭을 만든다. 기본 이름은 `주간 로그`다.
2. 헤더에 `주차 | 월 | 화 | 수 | 목 | 금 | 차주 계획 | 이슈·요청`을 각각 한 번씩 둔다. 기본 헤더는 1행이다.
3. 첫 본문 행을 빈 템플릿으로 준비해 높이·배경·테두리·정렬·글꼴을 정한다. 기본 템플릿은 2행이며 헤더보다 아래에 있어야 한다.
4. `플러그인 안내` 탭에는 공식 저장소·릴리즈·설치·인증·작성 규칙 링크를 둔다. 이 탭은 자동 생성·갱신 대상이 아니다.

[설정 예시](../config/profile.example.json)의 빈 계정·필드·경로 값을 채워 setup으로 저장한다. 새 설정은 `sheet.format=sheets`, `sheet.delivery=api`를 사용한다. `sheet.tabName`, `headerRow`, `templateRow`를 확인한다. 구형 `tabPattern`, `nameColumn`, `memberName`, `nextHeader`는 고정 탭의 대상 행·열을 선택하는 설정으로 사용하지 않는다.

원본 팀 현황표가 Office 파일이어도 변환할 필요는 없다. 자동 반영은 별도의 사용자 전용 Google 파일에 하고 원본에는 사용자가 직접 복사한다. 구형 `format=xlsx` 프로필은 `workUrl`의 Google 파일을 API 대상으로 쓰지만 새 설정에는 이 우회 경로를 사용하지 않는다.
