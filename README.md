# sprintlog

Jira 스프린트에 다음 주까지의 업무 계획을 날짜 단위로 적고, 그 진행 기록을 사용자별 주간 로그에 동기화하는 로컬 실행 플러그인이다. Claude Code와 Codex의 설치·실행 범위는 [설치 안내](references/installation.md)를 따른다.
사용자와 대화해 확정한 주간 현황과 미배정 업무를 로컬 Excel에 보관하고, 주간 현황만 Google 시트에 전달한다. Jira는 등록된 업무의 상태·일정·실적 근거이며 미배정 목록과 연결하지 않는다.

플러그인은 두 층으로 나뉜다.

- **스킬**(비결정): 커넥터를 호출하고, 계획 초안·문구·댓글 답변 초안을 만든다.
- **CLI `sprintlog`**(결정): 날짜·스프린트 판정, 일정 배치, 시트 표기 판정, 셀 조립, 표·로그 출력을 맡는다. 같은 입력이면 같은 출력을 낸다.

## 전제

- 로컬 명령 실행과 파일 접근이 가능한 호스트, Node.js 24 이상, Python 3 및 openpyxl 3.1 이상(4 미만). 설치는 setup 스킬이 안내하는 전용 Python 환경을 사용한다.
- Jira 조회용 Atlassian 연결과 Google Sheets API 사용자 OAuth. Google 인증은 [API 안내](references/google-api.md)를 따른다.
- 팀의 Jira 워크플로우 플러그인(티켓 생성·분해, 착수·PR 시 실적 시각 기록)이 있으면 그 관례를 따른다. 어떤 플러그인을 쓰는지는 개인 프로필에서 지정한다.

## 스킬

| 스킬 | 시점 | 하는 일 |
|---|---|---|
| `sprintlog:setup` | 처음·설정 변경 시 | 전제 점검, 프로필 생성·검증, CLI 설치(선택) |
| `sprintlog:plan` | 주·스프린트 시작, 주중 재계획 | 이번 주~다음 주 업무를 내 티켓 단위(서브태스크가 있으면 서브태스크)로 날짜 배치하고 승인 후 Jira 에 기록 |
| `sprintlog:check` | 매일 또는 sync 전 | 계획 대비 점검(기한 초과·오늘 기한·검토 중 머지·부모 완료)으로 Jira 를 맞춘다. 시트는 건드리지 않는다 |
| `sprintlog:sync` | 원하는 시점(이삼일~주말) | 대화로 확정한 내용과 미배정을 로컬 Excel에 저장하고 주간 현황을 Google 시트에 전달한다. 점검 조치가 남아 있으면 check 로 안내한다 |
| `sprintlog:close` | 스프린트 종료일 경과 시 | 내 작업을 판정표대로 완료 전환·이월하고 추적 스프린트를 교체한다 |

계획과 sync 변경은 차이를 보여 주고 확정된 범위만 기록한다. `close` 실행을 요청받으면 그 범위에서 판정표의 근거가 있는 항목을 수행하며, 근거가 없는 항목은 "판정 불가"로 보고한다. 미리보기 요청은 기록하지 않는다.

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
2. `local sync`로 확정된 주간 현황과 미배정을 로컬 Excel에 저장한다. `주간 로그` 고정 탭에 주차당 한 행을 추가·갱신하며 실제 완료 줄에만 부분 취소선을 적용한다.
3. `sheet sync --weeks <월요일,...>`로 API 미리보기 후 `--apply`로 사용자별 고정 Google 탭에 반영·재검증한다. 원본 팀 현황표에는 사용자가 직접 복사한다.

`unscheduled` 탭은 로컬 전용이다. Jira 티켓·일정과 연결하거나 Google 주간 시트에 동기화하지 않는다. 기존 실행 기록의 unscheduled는 설정된 경로에서 찾아 첫 확정 저장 때 보존하며 기존 기록은 수정하지 않는다. 같은 제목은 Excel의 최신 내용을 우선한다.

Google 권한이 없어도 로컬 단계는 완료된다. 로컬 저장 완료와 Google 반영 완료/사용자 붙여넣기 대기는 구분해 보고한다. 입력 형식·충돌 처리·검증은 [로컬 로그 계약](references/local-log.md)을 따른다.

## 시트 반영 방식

| 값 | 대상 | 동작 |
|---|---|---|
| `api`(기본) | 사용자별 Google 고정 탭 | `sheet sync --apply`로 텍스트·완료 태그 굵게·실제 완료 취소선을 반영하고 재조회한다 |
| `paste` | 파일 전달 | `local delivery`로 주간 전용 파일을 만들고 복사 범위를 안내한다. 원본 팀 현황표에는 사용자가 직접 복사한다 |
| `agent` | 구형 프로필 호환 | 새 설정에는 사용하지 않는다. 자동 반영 명령은 `delivery` 값과 관계없이 Sheets API를 사용한다 |

`local delivery`는 파일·차이표를 만들 뿐 Google에 전송하지 않는다. `sheet sync`도 기본은 미리보기이며 `--apply`가 있어야 쓴다.

기존 행을 갱신할 때는 텍스트·글자 효과만 수정한다. 높이·너비·배경·테두리·정렬·기본 글꼴은 유지한다. 새 주차 행에만 본문 템플릿의 서식·높이를 복사한다. Google에는 Jira 티켓·링크를 전달하지 않으며 로컬에는 유지한다. 완료 태그는 굵게 표시하고 실제 완료 줄은 취소선을 적용한다.

`플러그인 안내` 탭에는 공식 저장소·릴리즈·설치·API 인증·자동 반영 규칙을 둔다. 업무 데이터가 아니므로 `sheet sync`는 이 탭을 수정하지 않는다. 사용자별 파일은 `주간 로그`와 안내 탭으로 관리하고 원본 팀 현황표와 분리한다.

## CLI

```
sprintlog week [--next] [날짜]   주간 계획·현황 표
sprintlog sprint                 추적 스프린트 캘린더
sprintlog status | doctor | config
sprintlog leak-check             커밋 전 추적 파일 검사(패턴은 레포 밖)
```

스킬은 `sprint resolve`, `plan draft`, `schedule`, `facts`, `check`, `notation`, `sheet target`, `cells`, `close classify`, `labels set`, `plan local`, `snapshot save`, `local read|sync|delivery`, `sheet sync`를 호출한다.
전체 목록은 `sprintlog --help`.

## 설치

[설치와 실행 환경](references/installation.md)에 Claude Code·Codex 설치/갱신, 데스크톱 ZIP의 검증 범위, 사용자별 Google 파일 준비를 정리한다.

ZIP에는 런타임·프로필·Jira 연결·Google 인증이 포함되지 않는다. 데스크톱 앱에 업로드만 해서 전체 기능이 동일하게 실행된다고 보장하지 않는다.

처음 사용할 때는 [설정 예시](config/profile.example.json)를 채워 setup을 진행한다. Google 파일에 고정 탭·헤더·본문 템플릿을 먼저 만들고 [API 인증](references/google-api.md)을 완료한다. 원본 팀 현황표는 자동 반영 대상으로 지정하지 않는다.

## 개발

변경된 Excel 처리의 검증 환경에도 `requirements.txt`의 Python 의존성이 필요하다.

```
pnpm test
```
프로필·로컬 계획·스냅샷 및 스키마가 지정된 명령 입력은 JSON Schema로 검증한다. `local sync`는 확정 여부·revision·주차·항목 구조를 직접 검증한다. `facts`는 Jira 응답 원본을 해석한다.
모든 명령은 종료 코드(`0` 정상, `1` 조치 필요, `2` 입력 오류, `3` 전제 미충족)와
로그 형식(`sprintlog <명령> <단계> <ok|warn|fail|skip> key=value ...`, 표준 오류)을 지킨다.
`week`·`sprint`는 `--json`, `--md`, `--no-color`를 지원한다. 기계용 명령은 결과 JSON을 표준 출력에 쓴다.

## 로컬 상태

| 경로 | 내용 |
|---|---|
| `${CLAUDE_CONFIG_DIR}/sprintlog/profile.json` | 개인 프로필(권한 600), local 설정과 Google 전달 설정 |
| `local.workbookPath` | 확정된 주간 로그와 unscheduled의 로컬 Excel 정본 |
| `local.recordsPath` | 기존 실행 기록과 unscheduled 발견 경로. 원본 기록 보존 |
| `local.python` | openpyxl이 설치된 Python 실행 파일. 기본 python3 |
| `${CLAUDE_CONFIG_DIR}/sprintlog/plans/` | 미생성 스프린트의 로컬 계획 |
| `~/.cache/sprintlog/` | 조회용 스냅샷, 실행 기록 |

회사·팀 고유 값은 레포가 아니라 프로필에만 둔다: Jira 사이트·필드 ID, 스프린트 주기 규칙, 시트 URL(새 시트 파일이 생기면 갱신), 고정 탭·헤더·템플릿 설정, 워크플로우 플러그인, 고정 문구.
레포에는 `config/profile.example.json`의 빈 형식만 둔다. 프로필 홈과 `CODEX_HOME`의 관계는 [설치 안내](references/installation.md#실행-전제와-프로필)를 따른다.
