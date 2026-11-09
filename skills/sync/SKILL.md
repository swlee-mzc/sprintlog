---
name: sync
description: 사용자와 확정한 주간 현황과 미배정을 로컬 Excel에 저장하고, 주간 로그만 Google 시트에 수동 또는 자동 전달한다.
---

# sprintlog:sync

CLI는 `node ${CLAUDE_PLUGIN_ROOT}/bin/sprintlog.mjs`(아래 sprintlog). [로컬 로그 계약](../../references/local-log.md)과 [표기 규칙](../../references/sheet-rules.md)을 읽는다.

## 1. 현재 상태와 근거

`local read --week <월요일>`로 설정 경로·기존 주차·unscheduled·revision을 먼저 확인한다. local 설정이나 Excel 처리 환경이 없으면 setup의 로컬 설정부터 완료한다. Google 인증 실패로 이 단계를 막지 않는다.

사용자가 Jira 현황 갱신을 요청한 경우 프로필의 계정·필드로 티켓과 담당 서브태스크·기한 이력·PR 근거를 수집해 `facts`와 `check`를 실행한다. 잘린 응답은 필요한 티켓만 추가 조회한다. 조치가 남으면 사용자와 대조하고 check로 정리하거나 현재 상태로 보고할지 확인한다. 미배정만 추가하는 요청에는 Jira 조회나 스프린트 종료 정리를 요구하지 않는다.

## 2. 대화로 확정

기존 주간 로그와 수동 항목을 포함해 변경표를 보여 준다. 보류·검토 중 항목을 빼지 않는다. CLI `notation`으로 표기 초안을 만들고, 사용자가 정한 보고 일정과 실제 완료 근거를 구분한다. 새 기능명은 승인 후 `labels set`으로 저장한다. `countScopes`로 누적 집계 대상을 고정하고 대상 티켓이 누락되면 다시 수집한다.

사용자가 확정하면 같은 범위를 다시 묻지 않고 3단계로 간다. 미확정 내용은 로컬 확정 데이터를 덮어쓰지 않는다. unscheduled는 별도로 확인하며 Jira·Google에 연결하지 않는다.

## 3. 1단계 — 로컬 Excel

확정한 notation과 미배정 변경을 `confirmed:true`, `local read`의 revision과 함께 `local sync`에 넣는다. 저장 결과의 주차·미배정·취소선을 확인하고 로컬 경로를 보고한다. 기존 항목과 다른 주차를 보존한다. 파일 수정 충돌은 다시 읽고 사용자 확정 내용과 대조한다.

## 4. 2단계 — Google 시트

요청 또는 기존 승인 범위에 Google 전달이 있으면 로컬 로그 계약의 전달 절차를 따른다. paste는 주간 전용 파일과 복사 범위·대상 위치를 안내한다. api/agent는 저장된 주간 로그로 요청을 만들고 반영 후 재조회해 `google-verified`를 확인한다.

권한 오류·사용자 붙여넣기 대기는 Google 미완료로만 보고한다. 로컬 성공을 되돌리지 않는다. 원본 Excel과 Google 작업본의 상태를 구별하며 unscheduled를 게시하지 않는다.

## 5. 마무리

Jira 기반 facts·notation을 갱신한 경우 확정된 features로 `snapshot save`도 실행한다. 로컬 완료와 Google 완료/대기를 따로 보고한다. 시트 댓글 답변이 요청되면 근거를 붙인 초안을 만들고, 별도 게시 권한 없이 댓글을 전송하지 않는다.
