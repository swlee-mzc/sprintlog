---
name: sync
description: Jira 현황과 개인 프로필을 기준으로 주간 현황 시트의 내 행(월~금, 차주 계획)을 갱신하고, 내게 달린 시트 댓글의 답변 초안을 만든다. 주간 보고 전이나 원하는 시점에 사용한다.
---

# sprintlog:sync

CLI 는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs`(아래 `sprintlog`). 표기(`[완료]`·지연·취소선·차주)와 셀 위치·취소선 위치는 CLI 가 정한다. LLM 은 기능명만 다듬고, 날짜·기호·취소선 여부를 정하지 않는다. 표기 규칙은 `references/sheet-rules.md`.

## 0. 시작 점검

`sprintlog:plan` 0절과 같다(doctor → sprint resolve → plan local apply-ready). `ended` 면 `sprintlog:close` 를 먼저 한다. 스프린트 종료 정리는 `close` 가, 주중 점검은 2절이 맡는다.

## 1. 수집

1. 대상 주를 정한다(기본: 오늘이 속한 주). `from`=월요일, `to`=금요일.
2. Jira 를 조회한다. fields 에 `summary`, `status`, `issuetype`, `parent`, `assignee`, `reporter`, `created`, `resolutiondate`, `worklog`, `comment` 와 프로필의 스프린트·시작 날짜·기한 필드를 넣는다.
   - 추적 스프린트의 내 티켓, 그 부모 역조회로 찾은 내 서브태스크, 다음 주에 일정이 걸친 내 티켓.
   - 그 주에 워크로그를 남긴 티켓(`worklogAuthor = currentUser() AND worklogDate >= from AND worklogDate <= to`).
   - 기한 이력이 필요한 티켓은 단건 조회에 `expand=changelog`.
3. 응답이 크면 파일로 저장된다. 그 경로를 그대로 쓰고, 작은 응답만 파일로 옮겨 적는다.
4. `sprintlog facts --from <월> --to <금> <응답 파일...>` 을 실행한다.
   - `noEvidenceDays` 는 "근거 없음 — 확인 필요"로 사용자에게 묻는다. 빈 날로 넘기지 않는다.
   - `worklog-truncated`·`comment-truncated` 는 해당 티켓을 단건으로 다시 조회한다.

## 2. 계획 대비 점검

시트를 만들기 전에 Jira 가 실제 진행과 맞는지 먼저 맞춘다. 판정은 CLI 가, 새 기한처럼 사람이 정할 값은 사용자가 정한다.

1. 내 티켓의 부모 스토리는 담당자 조건 없이 `parent in (...)` 로 서브태스크 전체를 조회해 facts 에 함께 넣는다. 남의 서브태스크가 남았는데 부모를 완료로 제안하지 않기 위해서다.
2. 검토 단계(`jira.reviewStatuses`) 티켓은 코멘트·개발 정보에서 PR 을 찾아 forge 에서 머지 여부를 확인한다. 머지면 `true`, 열려 있으면 `false`, PR 을 못 찾으면 넣지 않는다.
3. `sprintlog check` 에 `today`, `subtasks`(facts 출력), `merged`(`{ 키: true|false }`)를 넣는다.

| `action` | 할 일 |
|---|---|
| `transition-done` | 완료로 전환한다. 기한이 지났으면 기한을 실제 완료일로 갱신해 지연을 남긴다. 실적 종료 시각이 머지 시각과 다르면 맞춘다 |
| `transition-parent-done` | 서브태스크가 모두 끝났다. 부모를 완료로 전환한다. 바로 갈 수 없으면 `getTransitionsForJiraIssue` 로 거쳐야 할 단계를 찾는다 |
| `set-due` | 기한이 지났는데 끝나지 않았다. 새 기한을 묻고 값을 갱신한다(지우지 않는다) |
| `confirm-today` | 오늘이 기한이다. 끝났으면 완료, 아니면 새 기한을 묻는다 |
| `check-pr` | 검토 중인데 머지 근거가 없다. PR 을 묻거나 확인한 뒤 다시 실행한다 |

4. 조치를 차이 표(티켓·현재 → 변경)로 보여 주고 승인받은 뒤 쓴다. 완료 전환 때 비어 있는 Fix Version 이 있으면 함께 묻는다.
5. 쓴 티켓만 다시 조회해 facts 를 다시 만든다. 그다음 판정으로 간다.

## 3. 판정

1. `sprintlog notation` 에 `week`(월요일), `subtasks`(facts 출력), `planned`(`sprintlog plan local list` 의 반영 전 항목)를 넣는다.
2. `missingLabels` 가 있으면 기능명을 간단명료하게 제안해(티켓 키는 CLI 가 붙이므로 넣지 않는다) `[{ "key", "label" }]` JSON 으로만 내고 사용자 확인 후 `sprintlog labels set --in <파일>` 로 고정한다. 기능명에 `[완료`, `]`, `~~`, 줄바꿈을 넣지 않는다(CLI 가 거부한다). 그런 다음 notation 을 다시 실행한다.

## 4. 칸 조립

1. `sprintlog sheet target --week <월요일>` 으로 시트 ID·탭·읽을 범위를 얻는다.
2. Sheets 커넥터로 읽는다: `get_spreadsheet`(fields `sheets.properties.sheetId`, `sheets.properties.title`) 로 탭의 sheetId, `get_values` 로 `ranges.header`, `ranges.names`, 내 행 전체(A열부터). 내 행의 서식도 `get_spreadsheet`(`includeGridData`, 해당 행 범위, fields `sheets.data.rowData.values.textFormatRuns`)로 읽어 열 순서대로 `currentRuns` 에 넣는다. 넣지 않으면 CLI 는 서식을 확인할 수 없어 내용이 있는 칸을 모두 다시 쓴다.
3. `sprintlog cells` 에 `notation`, `sheet {sheetId, title}`, `header`, `names`, `current`, `currentRuns` 를 넣는다.
   - `error` 가 있으면(이름·열을 못 찾음) 쓰지 않고 멈춘다.
4. `cells` 출력의 바뀐 칸(before → after)을 표로 보여 주고 승인받는다.

## 5. 반영

| `sheet.delivery` | 동작 |
|---|---|
| `api` | `update_spreadsheet` 에 `requests` 를 그대로 보낸다. 다시 읽어 값·취소선이 맞는지 확인한다 |
| `paste` | 작업본에 `api` 와 같이 쓴 뒤, 작업본의 칸 범위와 대상 시트의 붙여넣을 위치(`cells` 의 a1)를 안내한다 |
| `agent` | 작업본에 쓴 뒤 화면 조작 도구로 작업본 칸 복사 → 대상 시트 붙여넣기. 시작 전에 대상 브라우저 창·탭이 맞는지 화면으로 확인하고, 다른 탭이 앞에 있으면 멈춘다. 끝나면 대상 시트를 다시 읽어 확인한다 |

## 6. 댓글

대상 시트의 댓글을 읽어(`get_spreadsheet` 의 `commentsIncluded`, 안 되면 Drive `read_file_content` 의 `includeComments`) 내 행·나를 향한 것만 고른다. 근거(티켓 상태·일정)를 붙인 답변 초안을 보여 준다. 답글 게시 도구가 없으면 게시는 사용자가 한다.

## 7. 마무리

notation 의 `features` 와 일정 시간으로 `sprintlog snapshot save` 를 실행해 `sprintlog week` 가 최신 상태를 보이게 한다.
