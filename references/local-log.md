# 로컬 스프린트 로그

## 저장과 조회

`local.workbookPath`의 Excel이 확정된 주간 로그와 미배정 업무의 정본이다. `sheet.tabName`(기본 `주간 로그`) 고정 탭의 헤더 `주차 | 월 | 화 | 수 | 목 | 금 | 차주 계획 | 이슈·요청` 아래에 주차당 한 행을 추가하고 `unscheduled` 탭에는 title·status·note를 보관한다. 새 Todo 파일을 별도 정본으로 만들지 않는다.

`local.recordsPath`는 기존 실행 기록(JSON)의 위치다. `local read`는 이 경로의 `unscheduled`와 Excel 목록을 함께 조회하며 같은 제목이면 Excel 값을 우선한다. 다음 확정 저장 때 기존 항목을 Excel에 보존한다. 기존 기록 파일은 수정하지 않는다. 없는 파일·빈 목록·JSON 오류를 구분한다.

```
sprintlog local read --week 2026-11-09
```

출력은 `revision`, `weeks`, `notation`, `unscheduled`, `status`, `legacyStatus`, 실제 설정 경로를 포함한다. `missing-workbook`은 빈 목록이라는 뜻이 아니다. 과거 기록의 미배정 항목도 확인한다. 다른 프로필의 디렉터리를 추측해 탐색하지 않는다.

연도별 구형 파일은 주간 로그(`notation`)를 포함한 첫 확정 저장 때 원본 옆에 `.pre-fixed.bak` 백업을 남기고 모든 주차를 새 고정 탭으로 옮긴다. 예를 들어 `sprint-log.xlsx.pre-fixed.bak`에 구형 탭·서식을 보존한다. 미배정만 저장할 때는 주간 탭 이관을 실행하지 않는다. 고정 탭의 기존 행은 값·글자 효과만 수정하고 높이·너비·배경·테두리·정렬을 유지한다. 새 행은 첫 본문 행의 서식·높이를 복사한다. Google과 Excel의 단위·글꼴 차이는 허용하되 주차·기본 열·표기·완료 판단은 동일하다. 배경·테두리·높이·너비를 두 파일 사이에 자동 복제하지 않는다. 양쪽의 본문 템플릿을 각각 준비하고 갱신 시 각 파일의 기존 서식을 유지한다. Google의 `headerRow`·`templateRow` 옵션과 달리 로컬은 1행 헤더·2행 본문 템플릿을 사용한다. Google 원본 현황표로의 복사는 사용자가 직접 수행한다.

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
- 사용자에게 날짜 이동·삭제를 포함한 최종 표를 승인받았으면 `local sync` 입력의 `replace:true`로 해당 주차의 명시된 셀을 대체한다. 휴일 null은 유지하며 다른 주차와 미배정은 건드리지 않는다. 승인 전에는 쓰지 않는다.
- 기본은 기존 주차를 갱신할 때 동일 key(없으면 text)의 줄을 대체하고, 입력에 없는 기존 줄은 유지한다. 휴가 등 null인 날짜는 건드리지 않는다. 제외·이동할 줄은 비교표에서 확인받고 위 `replace:true`로 반영한다.
- 완료 예정 태그만으로 취소선을 만들지 않는다. 실제 완료된 due/delayed 줄의 strike만 true다.
- unscheduled 항목에는 Jira 키나 일정 필드를 넣지 않는다. 로컬 보관 전용이다.
- 저장 실패 시 기존 파일을 보존한다. 남은 `.lock`은 다른 실행이 없는지 확인하고 원인을 조사한다. 잠금을 무시하고 덮어쓰지 않는다.

저장 후 반환된 주차·미배정 목록·완료 줄을 확인한다. 필요한 경우 `local read`로 다시 조회한다.

`notation.issues`는 선택 문자열로 이슈·요청 열에 저장한다. 생략하면 기존 값을 보존하고 빈 문자열은 명시적으로 비운다.

## Google 전달

`local delivery`는 파일과 전달 계획만 생성하며 Google 쓰기 API를 호출하지 않는다. Google 직접 반영은 [Google API 절차](google-api.md)의 `sheet sync`를 사용한다. 아래 delivery 파일 경로는 파일 전달용이다. agent 브라우저 붙여넣기를 사용하지 않는다.

로컬 동기화가 끝난 뒤 사용자 요청 또는 이미 승인된 전달 범위에서 진행한다.

```
sprintlog local delivery --week 2026-11-09
```

주간 전용 `weekly-delivery-YYYY-MM-DD.xlsx`를 만든다. `전달!B2:F2`가 월~금, G2가 차주 계획, H2가 이슈·요청이다. A열에는 주차를 둔다. 이 파일에는 unscheduled가 없다. 원본 sprint-log.xlsx 전체를 Google에 업로드하지 않는다.

- paste: 반환된 전달 파일의 `B2:H2` 범위를 안내한다. 원본 팀 현황표에 붙일 위치는 사용자가 확인한다. `pending-user-paste`이며 사용자의 붙여넣기 확인 전에는 Google 완료로 보고하지 않는다.
- api: `sheet sync --weeks <월요일,...> --apply`로 저장된 로컬 로그를 반영하고 `google-verified`를 확인한다.
