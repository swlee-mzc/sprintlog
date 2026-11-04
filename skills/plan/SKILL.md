---
name: plan
description: 이번 주부터 다음 주까지의 업무를 서브태스크 단위로 스프린트 근무일에 배치해 Jira 의 시작 날짜·기한으로 기록한다. 스프린트·주 시작, 주중 재계획, 아직 생성되지 않은 다음 스프린트 계획에 사용한다.
---

# sprintlog:plan

CLI 는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs`(아래 `sprintlog`). 날짜·배치·경고는 CLI 가 정한다. LLM 은 대상·순서·시간을 제안하고, CLI 가 만든 표를 바꾸지 않고 보여 준다.

## 0. 시작 점검

1. `sprintlog doctor` 가 `fail` 이면 `sprintlog:setup` 으로 보낸다.
2. 내 티켓의 스프린트 필드(`jira.fields.sprint`)를 조회한다. 스프린트 판별에 `openSprints()` 를 쓰지 않는다.
3. 모은 스프린트 값으로 `sprintlog sprint resolve` 를 실행한다.
   - `ended` → `sprintlog:close` 를 먼저 하도록 안내하고 멈춘다.
   - `multiple` → 목록을 보여 주고 고르게 한다.
   - `rule-mismatch` → 차이를 보여 주고 `sprint.anchor` 갱신을 제안한다.
4. 같은 스프린트 값으로 `sprintlog plan local apply-ready` 를 실행해, 생성된 스프린트의 로컬 계획이 있으면 6절로 먼저 반영한다.

## 1. 대상 수집

- 기간: 기본은 오늘~다음 주 금요일. 사용자가 범위를 말하면 따른다.
- 추적 스프린트(다음 스프린트가 범위에 걸치면 그것도)의 내 스토리·작업을 조회한다.
- 서브태스크는 스프린트 멤버로 잡히지 않을 수 있으므로 `parent in (...) AND assignee = currentUser()` 로 역조회한다.
- 서브태스크가 없는 큰 티켓은 프로필 `workflow.subtaskSkill` 로 분해하도록 안내한다. 이 스킬이 직접 만들지 않는다.

## 2. 초안 (LLM)

대상마다 순서와 시간을 정해 아래 JSON 으로만 낸다. 시간은 Original Estimate 가 있으면 그 값, 없으면 사용자에게 묻는다.

```json
[{ "key": "PROJ-2", "order": 1, "hours": 6, "reason": "선행 API 연동" }]
```

`sprintlog plan draft --in <파일>` 로 검증해 배치 입력(`items`)을 얻는다.

## 3. 배치 (CLI)

`sprintlog schedule` 에 `from`·`to`·`sprint`(현재 스프린트 기간)·`busy`(이미 일정이 잡힌 다른 티켓의 날짜별 시간)·`items` 를 넣는다. 사용자가 날짜를 직접 정한 항목은 `fixedStart`·`fixedDue` 로 넣는다.

- 하루 8시간 기준, 넘치면 최대 16시간. 그래도 넘치거나 사람이 정한 일정이 넘으면 경고만 하고 기록은 한다.
- 종료 코드 1 은 경고가 있다는 뜻이다. 막지 않는다.

## 4. 확인

배치 결과로 스냅샷을 만들고(`sprintlog snapshot save`, 아래 형식) `sprintlog week --md` 와 `sprintlog week --next --md` 출력을 그대로 보여 준다. 경고는 표 아래에 CLI 로그 그대로 붙인다. 사용자가 조정하면 3절부터 다시 한다.

## 5. 기록

- 승인된 항목만 쓴다. 필드는 `jira.fields.startDate` 와 `jira.fields.dueDate` 둘뿐이다. 실적 시각 필드(`startDatetime`·`endDatetime`)는 워크플로우 플러그인 몫이라 쓰지 않는다.
- 이미 값이 있는 필드는 바뀌는 것만 차이로 보여 주고 승인받은 뒤 쓴다.
- 기한은 지우고 다시 쓰지 말고 값을 갱신한다. 처음 기한이 이력에 남아 지연 판정의 기준이 된다.
- 스프린트가 아직 생성되지 않은 항목은 Jira 에 쓰지 않고 `sprintlog plan local save` 로 저장한다(`sprint` 는 `sprint resolve` 의 `next`).

## 6. 로컬 계획 반영

`apply-ready` 결과의 항목을 해당 스프린트에 배정하고(부모 티켓), 시작 날짜·기한을 쓴다. 쓴 키는 `sprintlog plan local mark-applied --sprint <이름> --keys <a,b>` 로 기록한다.

## 스냅샷 형식

```json
{ "sprint": { "name": "...", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }, "features": [/* sprintlog notation 의 features */], "hours": { "YYYY-MM-DD": 8 } }
```
`features` 는 `sprintlog notation` 출력의 `features` 를 그대로 쓴다. 이때 notation 에 `planned`(= `schedule` 출력의 `planned`)와 `"planMode": "override"` 를 넣어, 승인 전 새 일정이 Jira 의 기존 날짜보다 우선해 보이게 한다. `hours` 는 `schedule` 출력의 `days` 를 날짜→시간으로 바꾼 것이다.
