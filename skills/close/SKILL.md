---
name: close
description: 추적 스프린트의 종료일이 지났을 때 내 티켓을 판정표대로 완료 전환·이월하고 남은 기한을 다시 배치한 뒤 추적 스프린트를 교체한다. 다른 스킬이 스프린트 종료를 알렸을 때 사용한다.
---

# sprintlog:close

CLI 는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs`(아래 `sprintlog`). 조치는 `sprintlog close classify` 판정표가 정한다. 판정표대로 실행하고 결과를 보고한다. 항목마다 사용자 확인을 받지 않는다. 판정 근거가 없는 항목은 실행하지 않는다.

## 1. 대상

- `sprintlog sprint resolve` 의 `current` 가 대상 스프린트다(`ended`, 또는 Jira 에서 이미 닫힘).
- 그 스프린트의 내 티켓과 부모 역조회로 찾은 내 서브태스크를 조회한다(상태, 상태 범주, 기한, Fix Version 등 완료 필수값).

## 2. 근거 수집

- 검토 단계(`jira.reviewStatuses`) 티켓은 연결된 PR 을 찾는다. Jira 의 개발 정보·원격 링크에서 PR 주소를 얻고, 그 forge 의 API 로 상태와 머지 대상 브랜치를 확인한다.
  - 머지됨 → `pr.merged: true`, 대상 브랜치가 티켓의 릴리스와 다르면 `targetMatches: false`.
  - 열림·닫힘 → `pr.merged: false`.
  - PR 이 없거나 조회 실패 → `pr: null`.
- 완료 상태 티켓은 비어 있는 완료 필수값을 `missingDoneFields` 로 넣는다.

## 3. 판정

`sprintlog close classify` 에 `today`, `sprint`, `tickets` 를 넣는다. 사용자가 미리 보기만 원하면 판정표만 보여 주고 끝낸다(classify 는 판정만 하고 Jira 를 바꾸지 않는다).

| action | 실행 |
|---|---|
| `none` | 없음 |
| `fill-done-fields` | 비어 있는 완료 필수값 보완 |
| `transition-done` | 완료로 전환(필수값 포함) |
| `carry-over` | 다음 스프린트로 이월. 부모 티켓의 스프린트를 바꾸고 서브태스크는 따라가게 둔다. `redate: true` 면 4절로 기한 재배치 |
| `undetermined` | 실행하지 않고 보고 |

- 다음 스프린트가 아직 없으면 이월 대상은 `sprintlog plan local save` 로 저장하고, 생성되면 `sprintlog:plan` 이 반영한다.
- 스프린트 자체를 만들거나 닫지 않는다. 다른 사람의 티켓은 건드리지 않는다. Jira 가 이미 옮긴 티켓은 다시 옮기지 않는다.

## 4. 기한 재배치

`redate` 항목의 남은 서브태스크를 `sprintlog:plan` 3절과 같은 방식으로 다음 스프린트 기간에 배치한다. 기한은 값 갱신으로 바꾼다.

## 5. 마무리

1. 판정표, 실행 결과, `undetermined` 사유를 CLI 출력 그대로 보고한다.
2. `sprintlog config set sprint.trackedId <다음 스프린트 ID>` 로 추적 스프린트를 바꾼다(아직 없으면 그대로 두고 안내).
3. 계획 대비 완료·이월 건수를 시트 이슈 칸에 쓸지 묻는다. 쓰면 `sprintlog:sync` 로 넘긴다.
