---
name: setup
description: sprintlog 의 전제(커넥터·프로필·워크플로우 플러그인)를 점검하고 개인 프로필을 만들거나 고친다. 처음 쓸 때, 커넥터 연결이 끊겼을 때, 시트 URL·스프린트 주기·이름이 바뀌었을 때 사용한다.
---

# sprintlog:setup

CLI 는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs` 로 부른다(아래 `sprintlog`). 판정·검증은 CLI 가 하고, 이 스킬은 커넥터 조회와 사용자 확인만 한다.

## 1. 전제 점검

1. `sprintlog doctor --json` 을 실행해 결과를 그대로 보여 준다. `fail` 이 있으면 해당 항목부터 해결한다.
2. 커넥터를 가벼운 조회로 확인한다. 도구가 없거나 실패하면 아래 안내를 하고 멈춘다.
   | 커넥터 | 확인 호출 | 없을 때 안내 |
   |---|---|---|
   | Atlassian | 현재 사용자 조회 | claude.ai 커넥터에서 Atlassian 을 연결한 뒤 Claude Code 를 다시 시작 |
   | Google Sheets | 대상 시트 `get_spreadsheet`(fields: `sheets.properties.title`) | claude.ai 커넥터에서 Google Sheets 를 추가하고, 조직 플랜이면 관리자 활성화가 필요 |
   | Google Drive | 대상 시트 메타데이터 조회 | claude.ai 커넥터에서 Google Drive 를 연결 |
3. 대상 시트가 xlsx 면(`Spreadsheet not found` 이고 Drive 메타데이터의 mimeType 이 xlsx) 형식을 `xlsx` 로 기록하고 4절의 반영 방식을 묻는다.

## 2. 조회해서 채우는 값

- `jira.cloudId`, `jira.accountId`, `jira.site`: Atlassian 현재 사용자·접근 가능 리소스 조회(`site` 는 리소스의 `url`, 시트의 티켓 링크에 쓴다).
- `jira.fields`: 내 티켓 하나를 이슈타입별 필드 메타데이터로 조회해 스프린트·시작 날짜·기한·실적 시각 필드 ID 를 찾는다. 하드코딩하지 않는다.
- `jira.reviewStatuses`: 프로젝트의 검토 단계 상태 이름.
- `workflow`: 팀 Jira 워크플로우 플러그인이 설치돼 있으면 이름, 설정 파일 경로, 서브태스크 분해 스킬 이름.
  - 설정 파일 경로는 그 플러그인의 **현재 개인 설정 파일**(프로젝트 키를 거기서 읽는다)을 넣는다. 플러그인이 레거시 설정 파일을 폴백으로만 남겼다면 레거시가 아니라 현재 파일을 고른다. 파일이 아직 없으면(플러그인 설정 전) 레거시 경로를 넣고, 플러그인 설정 후 `sprintlog config set workflow.configPath <경로>` 로 바꾼다.
  - 서브태스크 분해 스킬은 한 PR 로 안 들어가는 티켓을 쪼갤 때만 쓰인다. sprintlog 는 일정을 잡으려고 분해를 권하지 않는다.

## 3. 사용자에게 확인받는 값

- 스프린트 주기: 이름 패턴(`{n}` 포함), 길이(주), 기준 스프린트 번호·시작일, 종료 요일, 보드 ID.
- 시트: URL, 주차 탭 이름 규칙(`{M}`·`{N}`), 머리행 번호, 이름 열, 시트상의 내 이름, 차주 계획 열 머리.
- 하루 가용 시간(기본 8, 최대 16), 휴일, 고정 문구(완료 표기 없이 근무일마다 들어가는 줄. 기간이 있으면 `{ "text", "from", "to" }`).

## 4. 반영 방식 (대상이 xlsx 일 때)

| 값 | 동작 |
|---|---|
| `paste` | 내 Google Sheets 작업본(`sheet.workUrl`)에 쓴 뒤 복사·붙여넣기를 안내 |
| `agent` | 작업본에 쓴 뒤 에이전트가 화면 조작 도구로 붙여넣기. 붙여넣는 동안 그 브라우저를 사람이 쓰지 않아야 한다 |

작업본은 사용자가 원본에서 `파일 → Google Sheets로 저장` 으로 만들어 내 드라이브에 둔다.

## 5. 저장

1. 값을 `config/profile.example.json` 형식으로 모아 임시 파일에 쓰고 `sprintlog config init --in <파일>` 로 저장한다. 스키마 위반이면 CLI 가 거부한다.
2. 이후 변경은 `sprintlog config set <키> <값>` 으로 한다. 새 시트 파일이 생기면 `sprintlog config set sheet.url <URL>`.
3. 사용자가 원하면 플러그인 폴더에서 `pnpm link --global` 로 `sprintlog` 명령을 등록한다.
4. 커밋 전 유출 검사용 패턴(정규식, 한 줄에 하나)은 `${CLAUDE_CONFIG_DIR}/sprintlog/leak-patterns.txt` 에 둔다. 레포에 넣지 않는다.
