# 로컬 스프린트 로그

## 저장과 조회

`local.workbookPath`의 Excel이 확정된 주간 로그와 미배정 업무의 정본이다. 연도 탭에 주간 머리행·내용행을 아래로 추가하고 `unscheduled` 탭에는 title·status·note를 보관한다. 새 Todo 파일을 별도 정본으로 만들지 않는다.

`local.recordsPath`는 기존 실행 기록(JSON)의 위치다. `local read`는 이 경로의 `unscheduled`와 Excel 목록을 함께 조회하며 같은 제목이면 Excel 값을 우선한다. 다음 확정 저장 때 기존 항목을 Excel에 보존한다. 기존 기록 파일은 수정하지 않는다. 없는 파일·빈 목록·JSON 오류를 구분한다.

```
sprintlog local read --week 2026-11-09
```

출력은 `revision`, `weeks`, `notation`, `unscheduled`, `status`, `legacyStatus`, 실제 설정 경로를 포함한다. `missing-workbook`은 빈 목록이라는 뜻이 아니다. 과거 기록의 미배정 항목도 확인한다. 다른 프로필의 디렉터리를 추측해 탐색하지 않는다.

## 확정과 로컬 동기화

사용자와 내용이 확정된 뒤 다음 입력으로 `local sync --in <파일>`을 호출한다. 확정 전 제안은 파일에 저장하지 않는다. 기존 `local read`의 revision을 그대로 넣고 새 파일일 때만 null을 쓴다. 동시 수정으로 revision이 바뀌면 다시 읽고 변경분을 대조한다.

```json
{
  "confirmed": true,
  "revision": "local read가 반환한 값",
  "notation": {
    "week": {"days": ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]},
    "cells": {
      "2026-11-09": [{"kind":"due","text":"[완료] 입력 개선 (0/9)","strike":false,"key":"DEMO-10"}],
      "2026-11-10": [], "2026-11-11": [], "2026-11-12": [], "2026-11-13": []
    },
    "next": []
  },
  "unscheduled": [{"title":"기획 대기 업무","status":"미배정","note":"내용과 일정 미확정"}]
}
```

- notation은 `sprintlog notation` 출력 또는 사용자가 대화에서 확정한 동일 형태다. 사용자만 정할 수 있는 보고 일정 수정은 확정 입력에 반영한다.
- notation과 unscheduled는 각각 생략 가능하다. 미배정 추가만 할 때 일정이나 Jira 조회를 요구하지 않는다.
- 기존 주차를 갱신할 때 동일 key(없으면 text)의 줄을 대체하고, 입력에 없는 기존 줄은 유지한다. 휴가 등 null인 날짜는 건드리지 않는다. 잘못된 기존 줄을 지우는 변경은 사용자와 별도로 확인한 뒤 해당 파일에서 수행한다.
- 완료 예정 태그만으로 취소선을 만들지 않는다. 실제 완료된 due/delayed 줄의 strike만 true다.
- unscheduled 항목에는 Jira 키나 일정 필드를 넣지 않는다. 로컬 보관 전용이다.
- 저장 실패 시 기존 파일을 보존한다. 남은 `.lock`은 다른 실행이 없는지 확인하고 원인을 조사한다. 잠금을 무시하고 덮어쓰지 않는다.

저장 후 반환된 주차·미배정 목록·완료 줄을 확인한다. 필요한 경우 `local read`로 다시 조회한다.

## Google 전달

로컬 동기화가 끝난 뒤 사용자 요청 또는 이미 승인된 전달 범위에서 진행한다.

```
sprintlog local delivery --week 2026-11-09
```

주간 전용 `weekly-delivery-YYYY-MM-DD.xlsx`를 만든다. `전달!A2:E2`가 월~금, F2가 차주 계획이다. 이 파일에는 unscheduled가 없다. 원본 sprint-log.xlsx 전체를 Google에 업로드하지 않는다.

- paste: 전달 파일의 셀을 대상 시트에서 확인한 개인 행·날짜 열에 일반 붙여넣기하도록 안내한다. `pending-user-paste`이며 사용자의 붙여넣기 확인 전에는 Google 완료로 보고하지 않는다.
- api/agent: `sheet target`과 커넥터로 대상 파일·탭·개인 행·날짜 열·현재 값·부분 취소선을 읽는다. 화면 자동화는 대상 창을 확인한다.
- 읽은 값을 cells-input 형식으로 모아 `local delivery --week <월요일> --in <파일>`로 전달한다. `notation`은 cells-input 스키마 호환용으로 `{}`를 넣어도 된다. CLI는 그 값을 사용하지 않고 저장된 Excel에서 가져온다.
- `requests`를 커넥터에 그대로 반영한다. 다른 사람의 행과 대상 밖 셀은 변경하지 않는다. 동일한 대상의 값과 runs를 다시 읽어 재실행했을 때 `google-verified`이고 requests가 0건이어야 자동 반영 완료다.
- Google 권한·인증·탭 문제는 2단계에만 적용한다. 로컬 완료 경로와 Google의 미완료 사유를 따로 보고한다.
