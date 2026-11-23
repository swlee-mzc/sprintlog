# Google Sheets API 반영

Google 반영은 Sheets API v4로 수행한다. 브라우저 키 입력·클립보드·내부 웹 엔드포인트를 쓰지 않는다. URL의 gid를 대상 탭으로 고정하지 않는다.

## 인증

CLI는 `SPRINTLOG_GOOGLE_ACCESS_TOKEN` 환경변수를 우선 사용한다. 없으면 `GOOGLE_APPLICATION_CREDENTIALS`가 가리키는 사용자 OAuth ADC 또는 `~/.config/gcloud/application_default_credentials.json`의 authorized_user ADC를 갱신한다. 토큰·refresh token·client secret을 대화·명령 인자·실행 기록·레포에 쓰지 않는다. 지원 scope는 `https://www.googleapis.com/auth/spreadsheets`이며 대상 파일의 편집 권한과 Sheets API 활성화가 필요하다.

사용자 OAuth가 없거나 Sheets scope가 부족하면 Google Cloud에서 Desktop OAuth 클라이언트를 준비하고 사용자가 다음 로그인으로 승인한다. 클라이언트 파일과 ADC는 레포 밖에 둔다.

```sh
gcloud auth application-default login --client-id-file=/absolute/private/oauth-client.json --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/spreadsheets
```

gcloud ADC 로그인은 Sheets scope와 함께 cloud-platform scope도 요구한다. 기존 ADC의 권한을 조용히 바꾸지 않는다. 로그인은 사용자 동의가 필요하다. API 인증 실패 시 로컬 저장 결과는 유지하고 Google 반영 미완료로 보고한다.

## 미리보기와 반영

`<cli>`는 설치된 `node <plugin-root>/bin/sprintlog.mjs`다. 로컬 프로필을 찾는 홈은 `CLAUDE_CONFIG_DIR`로 명시한다.

```sh
<cli> sheet sync --weeks 2026-11-16,2026-11-23
<cli> sheet sync --weeks 2026-11-16,2026-11-23 --apply
```

명령은 확정된 로컬 Excel만 읽고 `sheet.tabName`(기본 `주간 로그`)인 사용자별 고정 탭만 갱신한다. URL gid·주차별 원본 탭·팀원 행은 대상 선택에 사용하지 않는다. `sheet.headerRow`(기본 1)에서 `주차 | 월 | 화 | 수 | 목 | 금 | 차주 계획 | 이슈·요청` 열을 찾고 주차 열의 첫 줄 ISO 월요일로 행을 선택한다. 여러 주차는 전부 사전 확인한 뒤 하나의 batchUpdate로 쓴다. 동일 주차가 중복되면 쓰지 않는다.

기존 주차는 값과 `textFormatRuns`만 변경한다. 행 높이·열 너비·배경·테두리·정렬·기본 글꼴은 쓰기 필드에 포함하지 않는다. 없는 주차는 마지막 내용 행 아래에 추가하고 `sheet.templateRow`(기본 헤더 다음 행)에서 새 행의 기본 서식과 높이만 복사한다. 템플릿이 있는 첫 본문 행에 처음 기록하는 경우에도 해당 행의 기존 서식·높이는 유지한다. 누적 행이 시트 크기를 초과할 때만 필요한 빈 행을 추가한다.

기본은 알 수 없는 기존 줄을 보존한다. 사용자가 최종 표로 해당 주차를 대체하고 이전 줄의 이동·삭제까지 승인한 경우에만 `--replace`를 미리보기와 반영 양쪽에 동일하게 붙인다. `notation.issues` 생략은 기존 이슈 요청을 보존하고 빈 문자열은 명시적으로 비운다.

CLI는 로컬 티켓 정보를 Google 텍스트·링크에서 제외하며 완료 태그 굵게·실제 완료 취소선을 `textFormatRuns`로 함께 보낸다. 승인한 글자 효과는 텍스트 런으로만 적용한다. 기존 셀의 기본 서식은 변경하지 않는다. 저장 직전 대상 행과 로컬 revision을 다시 확인하고 변경됐으면 중단한다. API는 비교 후 쓰기의 원자적 잠금을 제공하지 않으므로 같은 행의 동시 편집을 피한다.

반영 후 동일 API로 값·굵게·취소선·링크를 재조회하고 차이 0건일 때만 `google-verified`다. 응답 유실·검증 실패는 자동 재전송하지 않는다. 동일 주차를 dry-run으로 확인해 필요한 수정만 판단한다. 두 주차 중 한 주만 성공한 상태를 전체 완료로 보고하지 않는다.
