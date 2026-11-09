import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readLocal, syncLocal, deliverLocal } from '../src/local.mjs';
import { notation } from '../src/notation.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sprintlog-local-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const profile = { local: { workbookPath: join(root, 'sprint-log.xlsx'), recordsPath: join(root, 'records') }, sheet: { delivery: 'paste', url: 'https://docs.google.com/spreadsheets/d/example' }, jira: { site: 'https://jira.example' } };
  mkdirSync(profile.local.recordsPath);
  writeFileSync(join(profile.local.recordsPath, 'old.json'), JSON.stringify({ unscheduled: [{ title: 'Bridge', reason: '설계 대기' }, { title: '지표', reason: '기획 대기' }] }));
  return profile;
}
const entry = (text, strike = false, key = null) => ({ text, strike, key, kind: text.startsWith('[완료]') ? 'due' : 'progress' });
const week = (date = '2026-11-02') => notation({ week: date, subtasks: [] });
const save = (p, input = {}) => syncLocal(p, { confirmed: true, revision: readLocal(p).revision, ...input });

test('기존 미배정 발견 → 확정 후 Excel 보관, 중복·Jira 연결 금지', (t) => {
  const p = fixture(t);
  const before = readLocal(p);
  assert.equal(before.status, 'missing-workbook');
  assert.deepEqual(before.unscheduled.map((i) => i.title), ['Bridge', '지표']);
  assert.throws(() => syncLocal(p, { revision: null }), /확정/);
  assert.ok(!existsSync(p.local.workbookPath));
  const out = save(p, { unscheduled: [{ title: '분석', note: '=SUM(A1:A2)' }] });
  assert.equal(out.unscheduled.length, 3);
  assert.equal(save(p).unscheduled.length, 3);
  assert.throws(() => save(p, { unscheduled: [{ title: '메모', jiraKey: 'P-1' }] }), /title/);
  assert.equal(readLocal(p).unscheduled[2].note, '=SUM(A1:A2)');
  const r = spawnSync('python3', ['-c', 'import openpyxl,sys; w=openpyxl.load_workbook(sys.argv[1]); assert w["unscheduled"]["C7"].data_type == "s"', p.local.workbookPath], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('주별 추가·갱신: 다른 주차·휴가·완료 취소선·기존 수동 항목 보존', (t) => {
  const p = fixture(t);
  const one = week();
  one.cells['2026-11-02'] = [entry('휴가')];
  one.cells['2026-11-06'] = [entry('[완료] 하네스 🐾', true, 'P-1'), entry('보류 업무', false, 'P-2')];
  save(p, { notation: one });
  const two = week('2026-11-09');
  two.cells['2026-11-09'] = [entry('[완료] 입력 (0/9)', false, 'P-3')];
  save(p, { notation: two });
  save(p, { notation: one });
  const read = readLocal(p, '2026-11-06');
  assert.deepEqual(read.weeks, ['2026-11-02', '2026-11-09']);
  assert.equal(read.notation.cells['2026-11-06'][0].strike, true);
  assert.equal(read.notation.cells['2026-11-06'][1].strike, false);
  const partial = week();
  partial.cells['2026-11-02'] = null;
  save(p, { notation: partial });
  assert.equal(readLocal(p, '2026-11-02').notation.cells['2026-11-02'][0].text, '휴가');
  assert.equal(readLocal(p, '2026-11-02').notation.cells['2026-11-06'].length, 2);
});

test('로컬 저장 실패·오래된 revision·깨진 기록은 기존 파일을 보존', (t) => {
  const p = fixture(t);
  const saved = save(p, { notation: week() });
  const bytes = readFileSync(p.local.workbookPath);
  save(p, { unscheduled: [{ title: '변경' }] });
  assert.throws(() => syncLocal(p, { confirmed: true, revision: saved.revision }), /변경/);
  const latest = readFileSync(p.local.workbookPath);
  const bad = week(); bad.cells['2026-11-02'] = [entry('진행', true)];
  assert.throws(() => save(p, { notation: bad }), /취소선/);
  assert.deepEqual(readFileSync(p.local.workbookPath), latest);
  writeFileSync(join(p.local.recordsPath, 'bad.json'), '{');
  assert.throws(() => readLocal(p), /기존 기록/);
  assert.deepEqual(readFileSync(p.local.workbookPath), latest);
  assert.ok(bytes.length > 0);
  assert.throws(() => readLocal({ ...p, local: undefined }), /local 설정 없음/);
});

test('Google 전달: 주간 전용 파일·미배정 격리·수동 대기·읽기 검증', (t) => {
  const p = fixture(t);
  p.sheet.bullet = '• ';
  const n = week(); n.cells['2026-11-06'] = [entry('[완료] 하네스', true, 'P-1')];
  save(p, { notation: n });
  const out = deliverLocal(p, '2026-11-02');
  assert.equal(out.stage, 'pending-user-paste');
  assert.equal(out.unscheduled, undefined);
  assert.ok(!JSON.stringify(out).includes('Bridge'));
  const r = spawnSync('python3', ['-c', 'import openpyxl,sys; w=openpyxl.load_workbook(sys.argv[1],rich_text=True); assert w.sheetnames == ["전달"]; assert "Bridge" not in str(list(w.active.values)); assert any(getattr(getattr(r,"font",None),"strike",False) for r in w.active["E2"].value)', out.file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const target = { sheet: { sheetId: 1, title: '주간' }, header: ['이름', '11/2', '11/3', '11/4', '11/5', '11/6', '차주 계획'], names: ['나'], current: [] };
  p.sheet.memberName = '나';p.sheet.delivery = 'api';
  const first = deliverLocal(p, '2026-11-02', target);
  assert.equal(first.stage, 'pending-api');
  const current = ['나', ...first.cells.map((c) => c.after)];
  const currentRuns = [[], ...first.cells.map((c) => c.runs)];
  assert.equal(deliverLocal(p, '2026-11-02', { ...target, current, currentRuns }).stage, 'google-verified');
  assert.equal(deliverLocal(p, '2026-11-02', { ...target, current }).stage, 'pending-api');
});

test('Excel 저장 중 오류와 동시 실행 잠금은 원본 데이터를 손상시키지 않는다', (t) => {
  const p = fixture(t);
  save(p, { notation: week() });
  const before = readFileSync(p.local.workbookPath);
  const n = week();
  n.cells['2026-11-02'] = [entry('가'.repeat(20000)), entry('나'.repeat(20000))];
  assert.throws(() => save(p, { notation: n }), /최대 글자/);
  assert.deepEqual(readFileSync(p.local.workbookPath), before);
  writeFileSync(p.local.workbookPath + '.lock', '');
  assert.throws(() => save(p), /잠금/);
  assert.deepEqual(readFileSync(p.local.workbookPath), before);
});
