---
name: check
description: 계획과 실제 진행을 대조해 Jira 를 맞춘다(기한 초과, 오늘 기한, 검토 중 PR 머지, 하위 작업이 모두 끝난 부모). 매일 또는 시트 동기화 전에 사용한다. 시트는 건드리지 않는다.
---

# sprintlog:check

CLI 는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs`(아래 `sprintlog`). 판정은 CLI 가 하고, 새 기한처럼 사람이 정할 값은 사용자가 정한다. 쓰는 대상은 Jira 뿐이고 시트 반영은 `sprintlog:sync` 가 한다.

## 로컬 맥락

작업 전에 `sprintlog local read`로 설정된 Excel과 기존 실행 기록의 unscheduled를 확인한다. 저장 위치는 setup과 [로컬 로그 계약](../../references/local-log.md)을 따른다. 미배정은 로컬 보관 전용이며 Jira·Google 대상에 넣지 않는다. 사용자와 확정한 로컬 변경은 sync의 1단계로 저장하고 Google 전달은 별도로 진행한다.

## 0. 시작 점검

`sprintlog:plan` 0절과 같다. `ended` 면 `sprintlog:close` 를 먼저 한다. 스프린트 종료 정리는 `close` 가, 주중 점검은 이 스킬이 맡는다.

## 1. 수집

`sprintlog:sync` 1절과 같이 facts 를 만든다(기본: 오늘이 속한 주). 아래를 더한다.

- 내 티켓의 부모 스토리는 담당자 조건 없이 `parent in (...)` 로 서브태스크 전체를 조회해 facts 에 함께 넣는다. 남의 서브태스크가 남았는데 부모를 완료로 제안하지 않기 위해서다.
- 검토 단계(`jira.reviewStatuses`) 티켓은 코멘트·개발 정보에서 PR 을 찾아 forge 에서 머지 여부를 확인한다. 복수 릴리스 적용 PR과 티켓의 잔여 수용기준을 함께 확인한다. 승인된 완료 범위의 PR이 모두 머지됐고 잔여 조건도 충족됐을 때만 `true`, 필요한 PR이 열려 있으면 `false`, 근거가 부족하면 넣지 않는다. PR 하나의 머지만으로 전체 완료라고 판단하지 않는다.

## 2. 판정

`sprintlog check` 에 `today`, `subtasks`(facts 출력), `merged`(`{ 키: true|false }`)를 넣는다.

| `action` | 할 일 |
|---|---|
| `transition-done` | 완료로 전환한다. 기한이 지났으면 기한을 실제 완료일로 갱신해 지연을 남긴다. 실적 종료 시각이 머지 시각과 다르면 맞춘다 |
| `transition-parent-done` | 서브태스크가 모두 끝났다. 부모를 완료로 전환한다. 바로 갈 수 없으면 `getTransitionsForJiraIssue` 로 거쳐야 할 단계를 찾는다 |
| `set-due` | 기한이 지났는데 끝나지 않았다. 새 기한을 묻고 값을 갱신한다(지우지 않는다) |
| `confirm-today` | 오늘이 기한이다. 끝났으면 완료, 아니면 새 기한을 묻는다 |
| `check-pr` | 검토 중인데 머지 근거가 없다. PR 을 묻거나 확인한 뒤 다시 실행한다 |

## 3. 기록

1. 조치를 차이 표(티켓·현재 → 변경)로 보여 주고 승인받은 뒤 쓴다. 완료 전환 때 비어 있는 Fix Version 이 있으면 함께 묻는다.
2. 쓴 티켓만 다시 조회해 facts 를 다시 만든다. `sprintlog check` 를 다시 실행해 조치가 0건인지 확인한다.
3. 시트에 반영하려면 `sprintlog:sync` 를 이어서 실행한다.
