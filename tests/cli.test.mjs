import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/sprintlog.mjs', import.meta.url).pathname;
const LOG_LINE = /^sprintlog [a-z -]+ [a-z-]+ (ok|warn|fail|skip)( [A-Za-z]+=("([^"\\]|\\.)*"|[^\s"]+))*$/;

function env() {
  const root = mkdtempSync(join(tmpdir(), 'sprintlog-test-'));
  return { root, vars: { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'config'), SPRINTLOG_CACHE_DIR: join(root, 'cache'), NO_COLOR: '1' } };
}

const run = (e, args, stdin) => spawnSync(process.execPath, [BIN, ...args], { env: e.vars, input: stdin === undefined ? undefined : JSON.stringify(stdin), encoding: 'utf8' });

const PROFILE = {
  jira: { cloudId: 'c', accountId: 'me-1', fields: { sprint: 'cf_sprint', startDate: 'cf_start', dueDate: 'duedate' } },
  sprint: { namePattern: 'S_{n}', lengthWeeks: 2, anchor: { n: 1, start: '2026-11-02' }, endWeekday: 'fri' },
  sheet: { url: 'https://docs.google.com/spreadsheets/d/abc123/edit', format: 'sheets', delivery: 'api', tabPattern: '{M}월 {N}주', headerRow: 3, nameColumn: 'B', memberName: '나' },
  capacity: { hoursPerDay: 8, maxHoursPerDay: 16 },
};

function withProfile() {
  const e = env();
  const file = join(e.root, 'p.json');
  writeFileSync(file, JSON.stringify(PROFILE));
  const r = run(e, ['config', 'init', '--in', file]);
  assert.equal(r.status, 0, r.stderr);
  return e;
}

test('프로필이 없으면 종료 코드 3', () => {
  const r = run(env(), ['schedule'], { from: '2026-11-09', to: '2026-11-13', items: [] });
  assert.equal(r.status, 3);
  assert.match(r.stderr.trim(), LOG_LINE);
});

test('config init 은 권한 600 으로 저장하고 스키마를 검증한다', () => {
  const e = withProfile();
  assert.equal(statSync(join(e.root, 'config', 'sprintlog', 'profile.json')).mode & 0o777, 0o600);
  assert.equal(run(e, ['config', 'set', 'capacity.hoursPerDay', '0']).status, 2);
  assert.equal(run(e, ['config', 'set', 'sheet.url', 'https://example.com/x']).status, 2);
  assert.equal(run(e, ['config', 'set', 'sheet.url', 'https://docs.google.com/spreadsheets/d/new456/edit']).status, 0);
  assert.equal(run(e, ['config', 'get', 'sheet.url']).stdout.trim(), 'https://docs.google.com/spreadsheets/d/new456/edit');
});

test('schedule: 정상 0, 경고 1, 입력 오류 2, 로그 형식과 실행 기록', () => {
  const e = withProfile();
  const ok = run(e, ['schedule'], { from: '2026-11-09', to: '2026-11-13', items: [{ key: 'P-1', hours: 4 }] });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).planned[0].dueDate, '2026-11-09');
  for (const line of ok.stderr.trim().split('\n')) assert.match(line, LOG_LINE);
  const warn = run(e, ['schedule'], { from: '2026-11-09', to: '2026-11-09', items: [{ key: 'P-1', hours: 30 }] });
  assert.equal(warn.status, 1);
  assert.equal(run(e, ['schedule'], { from: '11/9', to: '2026-11-13', items: [] }).status, 2);
  const runs = spawnSync('ls', [join(e.root, 'cache', 'runs')], { encoding: 'utf8' }).stdout.trim().split('\n');
  assert.ok(runs.length >= 2);
  const manifest = JSON.parse(readFileSync(join(e.root, 'cache', 'runs', runs[0], 'manifest.json'), 'utf8'));
  assert.equal(manifest.command, 'schedule');
});

test('labels set: 표기 기호가 들어간 LLM 기능명은 거부', () => {
  const e = withProfile();
  assert.equal(run(e, ['labels', 'set'], [{ key: 'PROJ-1', label: '[완료] 기능' }]).status, 2);
  assert.equal(run(e, ['labels', 'set'], [{ key: 'PROJ-1', label: '기능 A' }]).status, 0);
  assert.equal(run(e, ['config', 'get', 'labels.PROJ-1']).stdout.trim(), '기능 A');
});

test('sheet target: 주차 탭과 읽을 범위', () => {
  const out = JSON.parse(run(withProfile(), ['sheet', 'target', '--week', '2026-11-11']).stdout);
  assert.equal(out.spreadsheetId, 'abc123');
  assert.equal(out.tab, '11월 2주');
  assert.equal(out.ranges.header, "'11월 2주'!A3:Z3");
});

test('plan local: 저장 → 스프린트 생성 감지 → 반영 기록', () => {
  const e = withProfile();
  // sprint 는 sprint resolve 의 next 를 그대로 넣는다(state·exists 포함), items 는 schedule 의 planned(fixed 포함).
  const plan = { sprint: { n: 2, name: 'S_2', start: '2026-11-16', end: '2026-11-27', id: null, state: null, exists: false }, items: [{ key: 'P-1', startDate: '2026-11-16', dueDate: '2026-11-17', hours: 8, fixed: false }] };
  assert.equal(run(e, ['plan', 'local', 'save'], plan).status, 0);
  assert.deepEqual(JSON.parse(run(e, ['plan', 'local', 'apply-ready'], { sprints: [] }).stdout), []);
  const ready = JSON.parse(run(e, ['plan', 'local', 'apply-ready'], { sprints: [{ id: 9, name: 'S_2', state: 'future' }] }).stdout);
  assert.equal(ready[0].sprint.id, 9);
  assert.equal(run(e, ['plan', 'local', 'mark-applied', '--sprint', 'S_2', '--keys', 'P-1']).status, 0);
  assert.deepEqual(JSON.parse(run(e, ['plan', 'local', 'apply-ready'], { sprints: [{ id: 9, name: 'S_2', state: 'future' }] }).stdout), []);
});

test('week: 스냅샷이 없으면 3, 있으면 표', () => {
  const e = withProfile();
  assert.equal(run(e, ['week']).status, 3);
  const snap = { syncedAt: new Date().toISOString(), sprint: { name: 'S_1', start: '2026-11-02', end: '2026-11-13' }, features: [{ key: 'P-1', summary: '기능', label: '기능 A', start: '2026-11-09', due: '2026-11-10', originalDue: '2026-11-10', done: false }] };
  assert.equal(run(e, ['snapshot', 'save'], snap).status, 0);
  const r = run(e, ['week', '2026-11-09', '--md']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('| 기능 A | ▶ 진행 | ◆ [완료] |'));
});

test('leak-check: 레포 밖 패턴으로 추적 예정 파일을 검사', () => {
  const e = withProfile();
  const repo = join(e.root, 'repo');
  mkdirSync(repo);
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'a.md'), 'hello\nsecret-corp.example 내부\n');
  assert.equal(run(e, ['leak-check', '--repo', repo]).status, 3);
  writeFileSync(join(e.root, 'config', 'sprintlog', 'leak-patterns.txt'), '# 주석\nsecret-corp\\.example\n');
  const r = run(e, ['leak-check', '--repo', repo, '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout).hits, [{ file: 'a.md', line: 2, pattern: 1 }]);
  assert.ok(!r.stderr.includes('secret-corp.example'));
});


test('local 명령: 설정 부재와 미확정 쓰기는 실패하고 새 파일은 확정 후 저장한다', () => {
  const e = withProfile();
  assert.equal(run(e, ['local', 'read']).status, 3);
  assert.equal(run(e, ['config', 'set', 'local', JSON.stringify({ workbookPath: join(e.root, 'log.xlsx'), recordsPath: join(e.root, 'records') })]).status, 0);
  const read = run(e, ['local', 'read']);
  assert.equal(read.status, 1);
  assert.equal(JSON.parse(read.stdout).legacyStatus, 'missing-records');
  assert.equal(run(e, ['local', 'sync'], { revision: null }).status, 3);
  assert.equal(run(e, ['local', 'sync'], { confirmed: true, revision: null, unscheduled: [{ title: '메모' }] }).status, 0);
  assert.equal(JSON.parse(run(e, ['local', 'read']).stdout).unscheduled[0].title, '메모');
});
