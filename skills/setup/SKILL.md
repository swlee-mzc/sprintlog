---
name: setup
description: sprintlog 의 전제(로컬 실행 환경·Jira 연결·Google API·프로필)를 점검하고 개인 프로필을 만들거나 고친다. 처음 쓸 때, 외부 연결이 끊겼을 때, 시트 URL·스프린트 주기·고정 탭이 바뀌었을 때 사용한다.
---

# sprintlog:setup

CLI 는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs` 로 부른다(아래 `sprintlog`). 판정·검증은 CLI가 하고 스킬은 연결 설정과 사용자 확인을 맡는다. 호스트별 설치 경로·프로필 홈·데스크톱 실행 범위는 [설치 안내](../../references/installation.md)를 따른다.

## 0. 로컬 설정

[로컬 로그 계약](../../references/local-log.md)을 읽는다. 설정에 `local.workbookPath`(개인 sprint-log.xlsx 절대 경로), `local.recordsPath`(기존 실행 기록 디렉터리), `local.python`(기본 python3)을 명시한다. 미배정 정본은 Excel의 unscheduled 탭이고 기존 기록은 조회·보존 대상으로 남긴다. 기존 unscheduled를 찾기 전에 새 Todo 저장소를 만들지 않는다.

Python 3와 openpyxl>=3.1이 필요하다. 기존 Python에 설치돼 있으면 사용한다. 없으면 `${CLAUDE_CONFIG_DIR}/sprintlog/python`에 `python3 -m venv`로 전용 환경을 만들고 그 환경의 Python으로 `-m pip install -r ${CLAUDE_PLUGIN_ROOT}/requirements.txt`를 실행한다. `local.python`을 그 실행 파일의 절대 경로로 저장한다. 설치된 플러그인 소스나 시스템 Python 패키지를 직접 수정하지 않는다.

설정 후 `local read`로 경로·기존 미배정·파일 상태를 확인한다. 없는 workbook은 첫 확정 저장 때 만들며 자동으로 빈 목록이라고 단정하지 않는다. 로컬 단계는 Google 연결 없이 완료할 수 있다.

## 1. 전제 점검

1. `sprintlog doctor --json` 을 실행해 결과를 그대로 보여 준다. `fail` 이 있으면 해당 항목부터 해결한다.
2. 외부 연결을 가벼운 조회로 확인한다. `doctor`는 Google OAuth·원격 탭을 점검하지 않는다. 도구가 없거나 실패하면 해당 외부 작업만 보류한다. 로컬 조회·확정·Excel 저장은 계속한다.
   | 커넥터 | 확인 호출 | 없을 때 안내 |
   |---|---|---|
   | Atlassian | 현재 사용자 조회 | claude.ai 커넥터에서 Atlassian 을 연결한 뒤 Claude Code 를 다시 시작 |
   | Google Sheets API | [API 인증 절차](../../references/google-api.md)의 사용자 OAuth·Sheets scope·파일 편집 권한 확인. 확정 로컬 주차가 있으면 `sheet sync --week <월요일>` dry-run | Sheets scope로 사용자 재승인. Google 커넥터 설치는 CLI API 사용의 전제가 아님 |
3. [사용자별 Google 파일 준비](../../references/installation.md#사용자별-google-파일-준비)에 따라 고정 탭·헤더·빈 본문 템플릿을 확인한다. CLI는 이들을 자동 생성하지 않는다. 원본이 Office 파일이어도 원본 변환이나 Google Drive 연결을 필수로 요구하지 않는다. 원본과 별도의 사용자 전용 Google 파일을 자동 반영 대상으로 쓴다.

## 2. 조회해서 채우는 값

- `jira.cloudId`, `jira.accountId`, `jira.site`: Atlassian 현재 사용자·접근 가능 리소스 조회(`site` 는 리소스의 `url`, 로컬 티켓 참조에 쓴다. Google에는 링크를 전달하지 않는다).
- `jira.fields`: 내 티켓 하나를 이슈타입별 필드 메타데이터로 조회해 스프린트·시작 날짜·기한·실적 시각 필드 ID 를 찾는다. 하드코딩하지 않는다.
- `jira.reviewStatuses`: 프로젝트의 검토 단계 상태 이름.
- `workflow`: 팀 Jira 워크플로우 플러그인이 설치돼 있으면 이름, 설정 파일 경로, 서브태스크 분해 스킬 이름.
  - 설정 파일 경로는 그 플러그인의 **현재 개인 설정 파일**(프로젝트 키를 거기서 읽는다)을 넣는다. 플러그인이 레거시 설정 파일을 폴백으로만 남겼다면 레거시가 아니라 현재 파일을 고른다. 파일이 아직 없으면(플러그인 설정 전) 레거시 경로를 넣고, 플러그인 설정 후 `sprintlog config set workflow.configPath <경로>` 로 바꾼다.
  - 서브태스크 분해 스킬은 한 PR 로 안 들어가는 티켓을 쪼갤 때만 쓰인다. sprintlog 는 일정을 잡으려고 분해를 권하지 않는다.

## 3. 사용자에게 확인받는 값

- 스프린트 주기: 이름 패턴(`{n}` 포함), 길이(주), 기준 스프린트 번호·시작일, 종료 요일, 보드 ID.
- 시트: 사용자별 Google 파일 URL, 고정 `tabName`(기본 `주간 로그`), `headerRow`(기본 1), `templateRow`(기본 2). 헤더는 `주차 | 월 | 화 | 수 | 목 | 금 | 차주 계획 | 이슈·요청`이다. 원본 팀 현황표에는 자동 반영하지 않고 사용자가 직접 복사한다.
- 하루 가용 시간(기본 8, 최대 16), 휴일, 고정 문구(완료 표기 없이 근무일마다 들어가는 줄. 기간이 있으면 `{ "text", "from", "to" }`).

## 4. Google 2단계 전달 방식

| 값 | 동작 |
|---|---|
| `paste` | 명시적 파일 전달 요청에 사용. 주간 전용 Excel만 만들며 원본 현황표에는 사용자가 직접 복사 |
| `api` | 기본. [Google API 인증·반영](../../references/google-api.md)으로 값·굵게·취소선·링크 재조회 |
| `agent` | 구형 프로필 호환값. 새 설정은 api로 저장하며 브라우저 쓰기는 사용하지 않는다 |

`sheet sync`는 `delivery` 값과 관계없이 Sheets API로 실행되며 기본은 미리보기다. `local delivery`는 API를 호출하지 않는다. 신규 프로필의 `format`은 `sheets`로 둔다. 구형 `xlsx`·`workUrl` 설정의 의미는 설치 안내를 따른다.

## 5. 저장

1. 값을 `config/profile.example.json` 형식으로 모아 임시 파일에 쓰고 `sprintlog config init --in <파일>` 로 저장한다. 스키마 위반이면 CLI 가 거부한다.
2. 이후 변경은 `sprintlog config set <키> <값>` 으로 한다. 새 시트 파일이 생기면 `sprintlog config set sheet.url <URL>`.
3. 사용자가 원하면 플러그인 폴더에서 `pnpm link --global` 로 `sprintlog` 명령을 등록한다.
4. 커밋 전 유출 검사용 패턴(정규식, 한 줄에 하나)은 `${CLAUDE_CONFIG_DIR}/sprintlog/leak-patterns.txt` 에 둔다. 레포에 넣지 않는다.
