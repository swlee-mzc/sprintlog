import test from 'node:test';
import assert from 'node:assert/strict';
import { facts } from '../src/facts.mjs';
import { notation } from '../src/notation.mjs';
import { cells, cellText, colLetter, tabTitle } from '../src/cells.mjs';
import { classify } from '../src/close.mjs';
import { check } from '../src/check.mjs';
import { fit, renderWeek, width } from '../src/render.mjs';

const ME = 'me-1';
const FIELDS = { sprint: 'cf_sprint', startDate: 'cf_start', dueDate: 'duedate' };
const sub = (key, extra) => ({
  key,
  fields: {
    summary: `작업 ${key}`,
    issuetype: { subtask: true },
    parent: { key: 'PROJ-1', fields: { summary: '기능 A 전체' } },
    assignee: { accountId: ME },
    status: { name: '진행 중', statusCategory: { key: 'indeterminate' } },
    cf_start: '2026-11-09',
    duedate: '2026-11-11',
    ...extra,
  },
});

test('facts: 워크로그는 started 기준 KST 날짜, 남의 기록은 제외, 근거 없는 날 표시', () => {
  const issue = sub('PROJ-2', {
    worklog: {
      total: 3,
      worklogs: [
        { author: { accountId: ME }, started: '2026-11-09T15:30:00.000Z', created: '2026-11-12T01:00:00Z', timeSpentSeconds: 3600, comment: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '구현' }] }] } },
        { author: { accountId: 'other' }, started: '2026-11-11T01:00:00Z', timeSpentSeconds: 60 },
      ],
    },
    comment: { total: 1, comments: [{ author: { accountId: ME }, created: '2026-11-11T10:00:00.000+0900', body: '머지 완료' }] },
  });
  const out = facts({ me: ME, fields: FIELDS, from: '2026-11-09', to: '2026-11-13', responses: [{ issues: { nodes: [issue] } }] });
  assert.deepEqual(out.events.map((e) => [e.date, e.kind]), [['2026-11-10', 'worklog'], ['2026-11-11', 'comment']]);
  assert.deepEqual(out.noEvidenceDays, ['2026-11-09', '2026-11-12', '2026-11-13']);
  assert.ok(out.warnings.some((w) => w.code === 'worklog-truncated'));
});

test('facts: 처음 기한은 기한 변경 이력의 가장 이른 값', () => {
  const issue = {
    ...sub('PROJ-2', { duedate: '2026-11-13' }),
    changelog: {
      histories: [
        { created: '2026-11-11T09:00:00Z', author: { accountId: ME }, items: [{ field: 'duedate', from: '2026-11-11', to: '2026-11-13' }] },
        { created: '2026-11-05T09:00:00Z', author: { accountId: ME }, items: [{ field: 'duedate', from: null, to: '2026-11-11' }, { field: 'status', fromString: '할 일', toString: '진행 중' }] },
      ],
    },
  };
  const [s] = facts({ me: ME, fields: FIELDS, from: '2026-11-02', to: '2026-11-13', responses: [issue] }).subtasks;
  assert.equal(s.originalDueDate, '2026-11-11');
  assert.equal(s.dueDate, '2026-11-13');
});

const st = (key, extra = {}) => ({ key, summary: key, subtask: true, parentKey: 'PROJ-1', parentSummary: '기능 A 전체', mine: true, done: false, dropped: false, startDate: '2026-11-09', dueDate: '2026-11-11', originalDueDate: '2026-11-11', ...extra });

test('notation: 진행·완료 예정·고정 문구·차주 계획', () => {
  const out = notation({ week: '2026-11-09', subtasks: [st('PROJ-2')], labels: { 'PROJ-1': '기능 A' }, fixedLines: ['반복 업무'] });
  assert.deepEqual(out.cells['2026-11-09'].map((e) => e.text), ['기능 A', '반복 업무']);
  assert.deepEqual(out.cells['2026-11-11'][0], { kind: 'due', text: '[완료] 기능 A', strike: false, key: 'PROJ-1' });
  assert.deepEqual(out.cells['2026-11-12'].map((e) => e.text), ['반복 업무']);
  assert.deepEqual(out.next, []);
  const later = notation({ week: '2026-11-09', subtasks: [st('PROJ-2', { startDate: '2026-11-12', dueDate: '2026-11-17', originalDueDate: '2026-11-17' })], labels: { 'PROJ-1': '기능 A' } });
  assert.deepEqual(later.next.map((e) => e.text), ['[완료] 기능 A']);
});

test('고정 문구: 기간을 주면 그 근무일에만 완료 표기 없이 들어가고, 다음 주에 걸치면 차주 계획에도 들어간다', () => {
  const qa = { text: 'QA 버그 수정', from: '2026-11-11', to: '2026-11-17' };
  const out = notation({ week: '2026-11-09', subtasks: [], fixedLines: ['반복', qa] });
  assert.deepEqual(out.cells['2026-11-10'].map((e) => e.text), ['반복']);
  assert.deepEqual(out.cells['2026-11-11'].map((e) => e.text), ['반복', 'QA 버그 수정']);
  assert.ok(out.cells['2026-11-13'].every((e) => e.kind === 'fixed'));
  assert.deepEqual(out.next, [{ kind: 'fixed', text: 'QA 버그 수정', strike: false, key: null }]);
  const md = renderWeek({ syncedAt: '2026-11-09T00:00:00Z', features: [], fixedLines: [{ text: '다음 주만', from: '2026-11-16' }] }, { week: '2026-11-09', format: 'md' });
  assert.ok(!md.includes('다음 주만'));
});

test('notation: 지연은 원래 예정일 칸에, 완료되면 지연 여부와 상관없이 취소선', () => {
  const s = st('PROJ-2', { dueDate: '2026-11-13', originalDueDate: '2026-11-11' });
  const open = notation({ week: '2026-11-09', subtasks: [s], labels: { 'PROJ-1': '기능 A' } });
  assert.deepEqual(open.cells['2026-11-11'][0], { kind: 'delayed', text: '[완료-지연(1113)] 기능 A', strike: false, key: 'PROJ-1' });
  assert.equal(open.cells['2026-11-13'][0].text, '[완료] 기능 A');
  const done = notation({ week: '2026-11-09', subtasks: [{ ...s, done: true }], labels: { 'PROJ-1': '기능 A' } });
  assert.equal(done.cells['2026-11-11'][0].strike, true);
  assert.equal(done.cells['2026-11-13'][0].strike, true);
});

test('notation: 완료는 내 서브태스크 기준, 남의 서브태스크는 무시', () => {
  const out = notation({ week: '2026-11-09', subtasks: [st('PROJ-2', { done: true }), st('PROJ-3', { mine: false, done: false, dueDate: '2026-11-13' })], labels: { 'PROJ-1': '기능 A' } });
  assert.equal(out.cells['2026-11-11'][0].strike, true);
  assert.deepEqual(out.cells['2026-11-13'], []);
});

test('notation: 재계획 미리보기(override)는 새 일정이 Jira 날짜보다 우선, 기본(fill)은 빈 날짜만 채움', () => {
  const planned = [{ key: 'PROJ-2', startDate: '2026-11-12', dueDate: '2026-11-13', hours: 4, fixed: false }];
  const fill = notation({ week: '2026-11-09', subtasks: [st('PROJ-2')], planned, labels: { 'PROJ-1': '기능 A' } });
  assert.equal(fill.cells['2026-11-11'][0].text, '[완료] 기능 A');
  const over = notation({ week: '2026-11-09', subtasks: [st('PROJ-2')], planned, planMode: 'override', labels: { 'PROJ-1': '기능 A' } });
  assert.equal(over.cells['2026-11-11'][0].text, '[완료-지연(1113)] 기능 A');
  assert.equal(over.cells['2026-11-13'][0].kind, 'due');
});

test('notation: 기능명이 없으면 요약으로 쓰고 누락을 보고, 휴일은 비움', () => {
  const out = notation({ week: '2026-11-09', subtasks: [st('PROJ-2')], holidays: ['2026-11-10'], fixedLines: ['반복'] });
  assert.equal(out.cells['2026-11-09'][0].text, '기능 A 전체');
  assert.deepEqual(out.missingLabels, [{ key: 'PROJ-1', summary: '기능 A 전체' }]);
  assert.equal(out.cells['2026-11-10'], null);
});

test('cells: 줄 단위 취소선 위치는 UTF-16 기준', () => {
  const { text, runs } = cellText([{ text: '[완료] 기능 A', strike: true }, { text: '반복', strike: false }], '- ');
  assert.equal(text, '- [완료] 기능 A\n- 반복');
  assert.deepEqual(runs, [{ startIndex: 0, format: { strikethrough: true } }, { startIndex: 12, format: { strikethrough: false } }]);
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(27), 'AB');
  assert.equal(tabTitle('{M}월 {N}주', '2026-11-11'), '11월 2주');
});

test('cells: 티켓 키를 괄호로 붙여 링크를 걸고, 휴일 칸은 건드리지 않는다', () => {
  const { text, runs } = cellText([{ text: '[완료] 기능 A', strike: true, key: 'P-1' }, { text: '반복', strike: false, key: null }], '- ', 'https://jira.example/');
  assert.equal(text, '- [완료] 기능 A (P-1)\n- 반복');
  assert.deepEqual(runs, [
    { startIndex: 0, format: { strikethrough: true } },
    { startIndex: 13, format: { strikethrough: true, link: { uri: 'https://jira.example/browse/P-1' } } },
    { startIndex: 16, format: { strikethrough: true } },
    { startIndex: 18, format: { strikethrough: false } },
  ]);
  const n = notation({ week: '2026-11-09', subtasks: [st('PROJ-2')], labels: { 'PROJ-1': '기능 A' }, holidays: ['2026-11-10'] });
  const header = ['', '팀원', '월 11/9', '화 11/10', '수 11/11', '목 11/12', '금 11/13', '차주 계획'];
  const current = ['', '나', '- 기능 A', '휴가', '', '', '', ''];
  const currentRuns = ['', '', [], [], [], [], [], []];
  const out = cells({ notation: n, sheet: { sheetId: 5, title: 't' }, profile: { memberName: '나', ticketBase: 'https://jira.example' }, header, names: ['', '나'], current, currentRuns });
  assert.ok(!out.cells.some((c) => c.a1 === 'D2'));
  assert.equal(out.cells.find((c) => c.a1 === 'C2').after, '- 기능 A (PROJ-1)');
  assert.ok(out.cells.find((c) => c.a1 === 'C2').changed);
});

test('cells: 이름 행과 날짜·차주 열을 찾아 바뀐 칸만 요청', () => {
  const n = notation({ week: '2026-11-09', subtasks: [st('PROJ-2', { done: true })], labels: { 'PROJ-1': '기능 A' } });
  const header = ['', '팀원', '월 11/9', '화 11/10', '수 11/11', '목 11/12', '금 11/13', '차주 계획'];
  const names = ['', '', '팀원', '다른 사람', '나'];
  const current = ['', '나', '- 기능 A', '', '', '', '', ''];
  const currentRuns = ['', '', [], [], [{ startIndex: 0, format: { strikethrough: false } }], [], [], []];
  const out = cells({ notation: n, sheet: { sheetId: 5, title: '11월 2주' }, profile: { memberName: '나' }, header, names, current, currentRuns });
  assert.equal(out.row, 5);
  assert.equal(out.columns['2026-11-11'], 'E');
  assert.deepEqual(out.cells.filter((c) => c.changed).map((c) => c.a1), ['D5', 'E5']);
  assert.deepEqual(out.requests[1].updateCells.start, { sheetId: 5, rowIndex: 4, columnIndex: 4 });
  const unknown = cells({ notation: n, sheet: { sheetId: 5, title: '11월 2주' }, profile: { memberName: '나' }, header, names, current });
  assert.deepEqual(unknown.cells.filter((c) => c.changed).map((c) => c.a1), ['C5', 'D5', 'E5']);
  const stale = ['', '', [{ startIndex: 0, format: { strikethrough: true } }], [], [], [], [], []];
  assert.ok(cells({ notation: n, sheet: { sheetId: 5, title: 't' }, profile: { memberName: '나' }, header, names, current, currentRuns: stale }).cells.find((c) => c.a1 === 'C5').changed);
  assert.equal(cells({ notation: n, sheet: { sheetId: 5, title: 't' }, profile: { memberName: '없음' }, header, names }).error, 'member-not-found');
  assert.equal(cells({ notation: n, sheet: { sheetId: 5, title: 't' }, profile: { memberName: '나' }, header: header.slice(0, 4), names }).error, 'columns-not-found');
});

test('close: 검토 중은 머지 근거로 완료 전환, 근거 없으면 판정 불가', () => {
  const r = classify({
    today: '2026-11-16',
    sprint: { name: 'S' },
    reviewStatuses: ['Review'],
    tickets: [
      { key: 'A', status: 'Review', category: 'indeterminate', pr: { merged: true } },
      { key: 'B', status: 'Review', category: 'indeterminate', pr: null },
      { key: 'C', status: 'Review', category: 'indeterminate', pr: { merged: false }, dueDate: '2026-11-13' },
      { key: 'D', status: '진행 중', category: 'indeterminate' },
      { key: 'E', status: '할 일', category: 'new' },
      { key: 'F', status: '완료', category: 'done', missingDoneFields: ['fixVersions'] },
    ],
  });
  assert.deepEqual(r.actions.map((a) => [a.key, a.action, a.redate]), [
    ['A', 'transition-done', false],
    ['B', 'undetermined', false],
    ['C', 'carry-over', true],
    ['D', 'carry-over', true],
    ['E', 'carry-over', false],
    ['F', 'fill-done-fields', false],
  ]);
});

test('render: 한글 두 칸 폭, 색을 끄면 제어 문자 없음, md 는 취소선 표기', () => {
  assert.equal(width('기능 A'), 6);
  assert.equal(width(fit('아주 긴 기능 이름입니다', 10)), 10);
  const snap = {
    syncedAt: '2026-11-11T05:00:00.000Z',
    sprint: { name: 'S', start: '2026-11-02', end: '2026-11-13' },
    features: [{ key: 'PROJ-1', summary: '기능 A 전체', label: '기능 A', start: '2026-11-09', due: '2026-11-11', originalDue: '2026-11-11', done: true }],
    fixedLines: ['반복'],
    hours: { '2026-11-09': 8, '2026-11-10': 17 },
    capacity: { hoursPerDay: 8, maxHoursPerDay: 16 },
  };
  const tty = renderWeek(snap, { week: '2026-11-09', today: '2026-11-11', color: false });
  assert.ok(!tty.includes('\x1b['));
  assert.ok(tty.includes('✓ [완료]') && tty.includes('17h ⚠'));
  const md = renderWeek(snap, { week: '2026-11-09', today: '2026-11-11', format: 'md' });
  assert.ok(md.includes('~~✓ [완료]~~'));
  assert.ok(renderWeek(snap, { week: '2026-11-09', today: '2026-11-11', color: true }).includes('\x1b[32;9m'));
});

test('check: 기한 초과·오늘 기한·검토 중 머지·근거 없음·부모 완료', () => {
  const t = (key, extra) => ({ key, mine: true, done: false, dropped: false, subtask: true, parentKey: 'S-1', status: '진행 중', dueDate: '2026-11-05', ...extra });
  const subtasks = [
    { key: 'S-1', mine: true, done: false, subtask: false, parentKey: null, status: '진행 중', dueDate: '2026-11-13' },
    t('S-2', { done: true }),
    t('S-3', { status: '검토 중', dueDate: '2026-10-29' }),
    t('T-1', { subtask: false, parentKey: null, dueDate: '2026-11-03' }),
    t('T-2', { subtask: false, parentKey: null, dueDate: '2026-11-04' }),
    t('T-3', { subtask: false, parentKey: null, status: '검토 중' }),
    t('X-1', { mine: false, subtask: false, parentKey: null, dueDate: '2026-11-01' }),
  ];
  const out = check({ today: '2026-11-04', subtasks, merged: { 'S-3': true }, reviewStatuses: ['검토 중'] });
  assert.deepEqual(out.actions.map((a) => [a.key, a.action]), [
    ['S-3', 'transition-done'],
    ['T-1', 'set-due'],
    ['T-2', 'confirm-today'],
    ['T-3', 'check-pr'],
    ['S-1', 'transition-parent-done'],
  ]);
  const notMerged = check({ today: '2026-11-04', subtasks, merged: { 'S-3': false, 'T-3': false }, reviewStatuses: ['검토 중'] });
  assert.deepEqual(notMerged.actions.find((a) => a.key === 'S-3'), { key: 'S-3', status: '검토 중', dueDate: '2026-10-29', action: 'set-due', reason: 'review-not-merged-overdue', ask: 'newDueDate' });
  assert.ok(!notMerged.actions.some((a) => a.key === 'S-1' || a.key === 'T-3'));
});

test('notation: 그 주 전에 끝난 서브태스크는 기능 기간에서 빠진다', () => {
  const out = notation({ week: '2026-11-02', subtasks: [st('PROJ-2', { done: true, startDate: '2026-10-26', dueDate: '2026-10-30', originalDueDate: '2026-10-30' }), st('PROJ-3', { startDate: '2026-11-06', dueDate: '2026-11-06', originalDueDate: '2026-11-06' })], labels: { 'PROJ-1': '기능 A' } });
  assert.equal(out.features[0].start, '2026-11-06');
  assert.deepEqual(out.cells['2026-11-04'], []);
  assert.equal(out.cells['2026-11-06'][0].text, '[완료] 기능 A');
  assert.equal(out.features[0].done, false);
});


test('notation: 주말 실제 완료는 금요일 보고, 실제 완료일과 누적 집계 범위 보존', () => {
  const out = notation({ week: '2026-11-02', subtasks: [
    st('PROJ-2', { startDate: '2026-11-05', dueDate: '2026-11-09', originalDueDate: '2026-11-06', done: true, doneDate: '2026-11-07' }),
    st('PROJ-3', { startDate: '2026-11-05', dueDate: '2026-11-09', originalDueDate: '2026-11-06', done: true, doneDate: '2026-11-08' }),
    st('PROJ-4', { dueDate: '2026-10-30', done: true }),
  ], labels: { 'PROJ-1': '기능' }, countScopes: { 'PROJ-1': ['PROJ-2', 'PROJ-3'] } });
  assert.equal(out.cells['2026-11-05'][0].strike, false);
  assert.equal(out.cells['2026-11-06'][0].text, '[완료] 기능 (2/2)');
  assert.equal(out.cells['2026-11-06'][0].strike, true);
  assert.equal(out.features[0].doneDate, '2026-11-08');
  assert.equal(out.features[0].due, '2026-11-09');
  assert.deepEqual(out.next, []);
  assert.throws(() => notation({ week: '2026-11-02', subtasks: [st('PROJ-2')], countScopes: { 'PROJ-1': ['PROJ-9'] } }), /누락/);
});

test('cells: 보류·수동·미등록 기존 줄을 삭제하지 않는다', () => {
  const n = notation({ week: '2026-11-09', subtasks: [] });
  const out = cells({ notation: n, sheet: { sheetId: 1, title: '주간' }, profile: { memberName: '나' }, header: ['11/9','11/10','11/11','11/12','11/13','차주 계획'], names: ['나'], current: ['- 보류 작업', '', '', '', '', '- 기존 차주 계획'], currentRuns: [[], [], [], [], [], []] });
  assert.equal(out.requests.length, 0);
  assert.equal(out.cells[0].after, '- 보류 작업');
  assert.equal(out.cells[5].after, '- 기존 차주 계획');
});
