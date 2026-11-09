# sprintlog

Jira 스프린트에 다음 주까지의 업무 계획을 날짜 단위로 적고, 그 진행 기록을 주간 현황 시트에 동기화하는 Claude Code 플러그인이다.
사용자와 대화해 확정한 주간 현황과 미배정 업무를 로컬 Excel에 보관하고, 주간 현황만 Google 시트에 전달한다. Jira는 등록된 업무의 상태·일정·실적 근거이며 미배정 목록과 연결하지 않는다.

플러그인은 두 층으로 나뉜다.

- **스킬**(비결정): 커넥터를 호출하고, 계획 초안·문구·댓글 답변 초안을 만든다.
- **CLI `sprintlog`**(결정): 날짜·스프린트 판정, 일정 배치, 시트 표기 판정, 셀 조립, 표·로그 출력을 맡는다. 같은 입력이면 같은 출력을 낸다.

## 전제

- Claude Code와 Node 24, Python 3 및 openpyxl 3.1 이상(4 미만). 설치는 setup 스킬이 안내하는 전용 Python 환경을 사용한다.
- claude.ai 커넥터: Atlassian, Google Sheets, Google Drive.
- 팀의 Jira 워크플로우 플러그인(티켓 생성·분해, 착수·PR 시 실적 시각 기록)이 있으면 그 관례를 따른다. 어떤 플러그인을 쓰는지는 개인 프로필에서 지정한다.

## 스킬

| 스킬 | 시점 | 하는 일 |
|---|---|---|
| `sprintlog:setup` | 처음·설정 변경 시 | 전제 점검, 프로필 생성·검증, CLI 설치(선택) |
| `sprintlog:plan` | 주·스프린트 시작, 주중 재계획 | 이번 주~다음 주 업무를 내 티켓 단위(서브태스크가 있으면 서브태스크)로 날짜 배치하고 승인 후 Jira 에 기록 |
| `sprintlog:check` | 매일 또는 sync 전 | 계획 대비 점검(기한 초과·오늘 기한·검토 중 머지·부모 완료)으로 Jira 를 맞춘다. 시트는 건드리지 않는다 |
| `sprintlog:sync` | 원하는 시점(이삼일~주말) | 대화로 확정한 내용과 미배정을 로컬 Excel에 저장하고 주간 현황을 Google 시트에 전달한다. 점검 조치가 남아 있으면 check 로 안내한다 |
| `sprintlog:close` | 스프린트 종료일 경과 시 | 내 작업을 판정표대로 완료 전환·이월하고 추적 스프린트를 교체한다 |

Jira 쓰기와 시트 반영은 차이를 보여 주고 승인을 받은 뒤에만 한다. `close` 는 판정표의 근거가 있는 항목만 실행하고, 근거가 없는 항목은 "판정 불가"로 보고한다.

## 계획 규칙

- 계획 필드는 시작 날짜와 기한이다. 실적 시각 필드는 워크플로우 플러그인이 쓰므로 건드리지 않는다.
- 하루 8시간 기준으로 배치하고, 넘치면 하루 최대 16시간까지 늘린다. 그래도 넘치거나 사람이 정한 일정이 이를 넘으면 기록은 하되 경고한다.
- 기한은 값을 갱신하는 방식으로 바꿔, 처음 잡은 기한을 이력에 남긴다. 지연 판정의 기준이다.
- 아직 생성되지 않은 스프린트의 계획은 로컬에 저장해 두고, 스프린트가 생기면 Jira 에 반영한다.
- 스프린트에 올린 티켓은 백로그면 할 일 단계로 바꾸고, 담당자가 비어 있으면 나로 채운다.

## 시트 표기 규칙

| 표기 | 조건 |
|---|---|
| `기능명` | 그날이 내 작업의 계획 기간에 들어감 |
| `[완료] 기능명` | 그 기능에서 내 작업 기한 중 가장 늦은 날(완료 예정) |
| `[완료-지연(MMDD)] 기능명` | 원래 예정일 칸. 새 예정일 칸에는 `[완료] 기능명` |
| 취소선 | 그 기능의 내 작업이 모두 완료됨 |
| 차주 계획 | 다음 주에 계획 기간이 걸친 기능 |

완료는 기능 전체가 아니라 내 담당 작업 기준이다. 작업은 내 서브태스크이고, 서브태스크 없이 내게 배정된 티켓은 그 자체가 작업이자 기능이다.

## 로컬 로그와 2단계 전달

1. `local read`로 설정된 경로의 기존 Excel과 실행 기록을 조회하고 사용자와 변경 내용을 확정한다.
2. `local sync`로 확정된 주간 현황과 미배정을 로컬 Excel에 저장한다. 연도 탭 아래에 주별로 추가·갱신하며 실제 완료 줄에만 부분 취소선을 적용한다.
3. `local delivery`로 주간 전용 전달 파일을 만들고, 사용자가 복사·붙여넣기하거나 API/화면 자동화로 Google 시트에 반영한다. 원본 Excel 전체는 업로드하지 않는다.

`unscheduled` 탭은 로컬 전용이다. Jira 티켓·일정과 연결하거나 Google 주간 시트에 동기화하지 않는다. 기존 실행 기록의 unscheduled는 설정된 경로에서 찾아 첫 확정 저장 때 보존하며 기존 기록은 수정하지 않는다. 같은 제목은 Excel의 최신 내용을 우선한다.

Google 권한이 없어도 로컬 단계는 완료된다. 로컬 저장 완료와 Google 반영 완료/사용자 붙여넣기 대기는 구분해 보고한다. 입력 형식·충돌 처리·검증은 [로컬 로그 계약](references/local-log.md)을 따른다.

## 시트 반영 방식

| 값 | 대상 | 동작 |
|---|---|---|
| `api`(기본) | Google Sheets | 확정된 로컬 주간 로그로 값·부분 취소선을 쓰고 재조회한다 |
| `paste` | 수동 전달 | 주간 전용 로컬 Excel의 복사 범위와 대상 위치를 안내한다 |
| `agent` | 화면 자동화 | 주간 전용 전달 파일 또는 작업본에서 대상 창을 확인하고 붙여넣은 뒤 검증한다 |

## CLI

```
sprintlog week [--next] [날짜]   주간 계획·현황 표
sprintlog sprint                 추적 스프린트 캘린더
sprintlog status | doctor | config
sprintlog leak-check             커밋 전 추적 파일 검사(패턴은 레포 밖)
```

스킬은 `sprint resolve`, `plan draft`, `schedule`, `facts`, `check`, `notation`, `sheet target`, `cells`, `close classify`, `labels set`, `plan local`, `snapshot save`, `local read|sync|delivery`를 호출한다.
전체 목록은 `sprintlog --help`.

## 설치

```
claude plugin marketplace add swlee-mzc/sprintlog
claude plugin install sprintlog@sprintlog
```

터미널 명령 `sprintlog`(선택): 플러그인 폴더에서 `pnpm link --global`. 스킬은 설치 여부와 상관없이 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs` 로 부른다.

## 개발

변경된 Excel 처리의 검증 환경에도 `requirements.txt`의 Python 의존성이 필요하다.

```
pnpm test
```
JSON 입력과 저장 파일(프로필·로컬 계획·스냅샷)은 JSON Schema 로 검증한다(`facts` 는 Jira 응답 원본을 해석해 읽는다).
모든 명령은 종료 코드(`0` 정상, `1` 조치 필요, `2` 입력 오류, `3` 전제 미충족)와
로그 형식(`sprintlog <명령> <단계> <ok|warn|fail|skip> key=value ...`, 표준 오류)을 지킨다.
조회 명령은 `--json`, `--md`, `--no-color` 를 지원한다.

## 로컬 상태

| 경로 | 내용 |
|---|---|
| `${CLAUDE_CONFIG_DIR}/sprintlog/profile.json` | 개인 프로필(권한 600), local 설정과 Google 전달 설정 |
| `local.workbookPath` | 확정된 주간 로그와 unscheduled의 로컬 Excel 정본 |
| `local.recordsPath` | 기존 실행 기록과 unscheduled 발견 경로. 원본 기록 보존 |
| `local.python` | openpyxl이 설치된 Python 실행 파일. 기본 python3 |
| `${CLAUDE_CONFIG_DIR}/sprintlog/plans/` | 미생성 스프린트의 로컬 계획 |
| `~/.cache/sprintlog/` | 조회용 스냅샷, 실행 기록 |

회사·팀 고유 값은 레포가 아니라 프로필에만 둔다: Jira 사이트·필드 ID, 스프린트 주기 규칙, 시트 URL(새 시트 파일이 생기면 갱신), 시트상의 이름, 워크플로우 플러그인, 고정 문구.
레포에는 `config/profile.example.json` 의 빈 형식만 둔다.
