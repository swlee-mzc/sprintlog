---
name: sync
description: Jira 현황과 개인 프로필을 기준으로 주간 현황 시트의 내 행(월~금, 차주 계획)을 갱신하고, 내게 달린 시트 댓글의 답변 초안을 만든다. 주간 보고 전이나 원하는 시점에 사용한다.
---

# sprintlog:sync

CLI 는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs`(아래 `sprintlog`). 표기(`[완료]`·지연·취소선·차주)와 셀 위치·취소선 위치는 CLI 가 정한다. LLM 은 기능명만 다듬고, 날짜·기호·취소선 여부를 정하지 않는다. 표기 규칙은 `references/sheet-rules.md`.

## 0. 시작 점검

`sprintlog:plan` 0절과 같다(doctor → sprint resolve → plan local apply-ready). `ended` 면 `sprintlog:close` 를 먼저 한다.

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

## 2. 판정

1. `sprintlog notation` 에 `week`(월요일), `subtasks`(facts 출력), `planned`(`sprintlog plan local list` 의 반영 전 항목)를 넣는다.
2. `missingLabels` 가 있으면 기능명을 간단명료하게 제안해(티켓 키는 CLI 가 붙이므로 넣지 않는다) `[{ "key", "label" }]` JSON 으로만 내고 사용자 확인 후 `sprintlog labels set --in <파일>` 로 고정한다. 기능명에 `[완료`, `]`, `~~`, 줄바꿈을 넣지 않는다(CLI 가 거부한다). 그런 다음 notation 을 다시 실행한다.

## 3. 칸 조립

1. `sprintlog sheet target --week <월요일>` 으로 시트 ID·탭·읽을 범위를 얻는다.
2. Sheets 커넥터로 읽는다: `get_spreadsheet`(fields `sheets.properties.sheetId`, `sheets.properties.title`) 로 탭의 sheetId, `get_values` 로 `ranges.header`, `ranges.names`, 내 행 전체(A열부터). 내 행의 서식도 `get_spreadsheet`(`includeGridData`, 해당 행 범위, fields `sheets.data.rowData.values.textFormatRuns`)로 읽어 열 순서대로 `currentRuns` 에 넣는다. 넣지 않으면 CLI 는 서식을 확인할 수 없어 내용이 있는 칸을 모두 다시 쓴다.
3. `sprintlog cells` 에 `notation`, `sheet {sheetId, title}`, `header`, `names`, `current`, `currentRuns` 를 넣는다.
   - `error` 가 있으면(이름·열을 못 찾음) 쓰지 않고 멈춘다.
4. `cells` 출력의 바뀐 칸(before → after)을 표로 보여 주고 승인받는다.

## 4. 반영

| `sheet.delivery` | 동작 |
|---|---|
| `api` | `update_spreadsheet` 에 `requests` 를 그대로 보낸다. 다시 읽어 값·취소선이 맞는지 확인한다 |
| `paste` | 작업본에 `api` 와 같이 쓴 뒤, 작업본의 칸 범위와 대상 시트의 붙여넣을 위치(`cells` 의 a1)를 안내한다 |
| `agent` | 작업본에 쓴 뒤 화면 조작 도구로 작업본 칸 복사 → 대상 시트 붙여넣기. 시작 전에 대상 브라우저 창·탭이 맞는지 화면으로 확인하고, 다른 탭이 앞에 있으면 멈춘다. 끝나면 대상 시트를 다시 읽어 확인한다 |

## 5. 댓글

대상 시트의 댓글을 읽어(`get_spreadsheet` 의 `commentsIncluded`, 안 되면 Drive `read_file_content` 의 `includeComments`) 내 행·나를 향한 것만 고른다. 근거(티켓 상태·일정)를 붙인 답변 초안을 보여 준다. 답글 게시 도구가 없으면 게시는 사용자가 한다.

## 6. 마무리

notation 의 `features` 와 일정 시간으로 `sprintlog snapshot save` 를 실행해 `sprintlog week` 가 최신 상태를 보이게 한다.
