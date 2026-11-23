import test from 'node:test';
import assert from 'node:assert/strict';
import { syncSheets } from '../src/google.mjs';
import { WEEKLY_HEADERS } from '../src/weekly-sheet.mjs';
import { weekDays } from '../src/core/time.mjs';
const value = (s) => ({ userEnteredValue: { stringValue: s }, userEnteredFormat: { backgroundColor: { red: 0.9 }, textFormat: { fontFamily: 'Calibri', fontSize: 11 } } });
const profile = { sheet: { url: 'https://docs.google.com/spreadsheets/d/test-id/edit?gid=WRONG', format: 'sheets', tabName: '개인 로그', headerRow: 1, templateRow: 2, bullet: '- ' } };
function fixture({ duplicate = false, mismatch = false, conflict = false, missingTab = false, unseeded = false, timeout = false, full = false } = {}) {
  const row = [value('2026-11-16\n11/16 ~ 11/20')];
  const rowData = [{ values: WEEKLY_HEADERS.map(value) }, { values: row }];
  const heights = [{ pixelSize: 29 }, { pixelSize: 95 }];
  if (unseeded) row[0] = {};
  if (duplicate) rowData.push({ values: [value('2026-11-16')] });
  if (full) for (let i = 2; i < 10; i++) rowData.push({ values: [value(new Date(Date.UTC(2026, 0, 5 + (i - 2) * 7)).toISOString().slice(0, 10))] });
  let posts = 0, reads = 0;
  const posted = [];
  const properties = { sheetId: 77, title: '개인 로그', gridProperties: { rowCount: 10, columnCount: 8 } };
  const fetchImpl = async (url, options) => {
    assert.match(options.headers.Authorization, /^Bearer test$/);
    const parsed = new URL(url);
    if (options.method === 'POST') {
      posts++;
      if (timeout) throw Error('network timeout');
      for (const r of JSON.parse(options.body).requests) {
        posted.push(r);
        assert.equal(/P-1|jira.example|updateSheetProperties|deleteSheet/.test(JSON.stringify(r)), false);
        if (r.appendDimension) {
          assert.equal(r.appendDimension.dimension, 'ROWS');
          properties.gridProperties.rowCount += r.appendDimension.length;
          continue;
        }
        if (r.copyPaste) {
          assert.ok(r.copyPaste.destination.startRowIndex >= 2);
          continue;
        }
        if (r.updateDimensionProperties) {
          const { range, properties: p } = r.updateDimensionProperties;
          assert.ok(range.startIndex >= 2, 'existing row height must never change');
          heights[range.startIndex] = { pixelSize: p.pixelSize };
          continue;
        }
        const u = r.updateCells;
        assert.equal(u.start.sheetId, 77);
        assert.ok(u.start.rowIndex >= 1);
        assert.equal(u.rows[0].values[0].userEnteredFormat, undefined);
        assert.match(u.fields, /^(userEnteredValue,textFormatRuns|userEnteredValue)$/);
        if (u.fields.includes('textFormatRuns')) assert.notEqual(u.start.columnIndex, 5, 'holiday cell');
        if (!mismatch) {
          rowData[u.start.rowIndex] ??= { values: [] };
          const old = rowData[u.start.rowIndex].values[u.start.columnIndex] ?? {};
          rowData[u.start.rowIndex].values[u.start.columnIndex] = { ...old, ...u.rows[0].values[0] };
        }
      }
      return { ok: true, json: async () => ({}) };
    }
    if (!parsed.searchParams.has('ranges')) return { ok: true, json: async () => ({ sheets: missingTab ? [] : [{ properties }] }) };
    assert.ok(parsed.searchParams.get('ranges').startsWith("'개인 로그'!"), 'never access original weekly tabs');
    reads++;
    if (conflict && reads === 2) row.push(value('concurrent edit'));
    return { ok: true, json: async () => structuredClone({ sheets: [{ properties, data: [{ startRow: 0, startColumn: 0, rowData, rowMetadata: heights }] }] }) };
  };
  const read = (_, week) => {
    const days = weekDays(week);
    return { revision: 'r1', notation: { week: { days }, cells: Object.fromEntries(days.map((d, i) => [d, i === 4 ? null : [{ text: i === 0 ? '[완료] 업무 😀' : '업무', key: 'P-1', strike: i === 0 }]])), next: [], issues: '자료 리뷰 후 일정 산정' } };
  };
  return { dependencies: { fetchImpl, token: 'test', read }, posts: () => posts, row, rowData, heights, posted };
}

test('fixed API: own week, no Jira, bold + strike, only text updates and idempotent verification', async () => {
  const f = fixture();
  const options = { weeks: ['2026-11-16'], apply: true };
  const out = await syncSheets(profile, options, f.dependencies);
  assert.equal(out.stage, 'google-verified');
  assert.equal(f.posts(), 1);
  assert.ok(f.rowData[1].values[1].textFormatRuns.some((r) => r.format.bold && r.format.strikethrough));
  assert.equal(f.heights[1].pixelSize, 95);
  assert.ok(f.posted.every((r) => r.updateCells));
  assert.equal((await syncSheets(profile, options, f.dependencies)).changed, 0);
  assert.equal(f.posts(), 1);
});
test('fixed API: multiple new weeks allocate different rows and copy template height only on append', async () => {
  const f = fixture();
  const out = await syncSheets(profile, { weeks: ['2026-11-30', '2026-11-23', '2026-11-16'], apply: true }, f.dependencies);
  assert.equal(out.stage, 'google-verified');
  assert.deepEqual(out.weeks.map((w) => w.row), [2, 3, 4]);
  assert.equal(f.posts(), 1);
  assert.equal(f.heights[2].pixelSize, 95);
  assert.equal(f.heights[3].pixelSize, 95);
  assert.equal(f.rowData[2].values[0].userEnteredValue.stringValue.split('\n')[0], '2026-11-23');
});
test('fixed API: preview and invalid/duplicate/concurrently edited targets never write', async () => {
  const f = fixture();
  assert.equal((await syncSheets(profile, { weeks: ['2026-11-16'] }, f.dependencies)).stage, 'google-preview');
  assert.equal(f.posts(), 0);
  for (const condition of [{ duplicate: true }, { missingTab: true }, { conflict: true }]) {
    const f = fixture(condition);
    await assert.rejects(syncSheets(profile, { weeks: ['2026-11-16'], apply: true }, f.dependencies));
    assert.equal(f.posts(), 0);
  }
});
test('fixed API: empty styled first row is initialized without altering its format or height', async () => {
  const f = fixture({ unseeded: true });
  await syncSheets(profile, { weeks: ['2026-11-16'], apply: true }, f.dependencies);
  assert.ok(f.posted.every((r) => r.updateCells));
  assert.equal(f.heights[1].pixelSize, 95);
});
test('fixed API: failed verification or uncertain writes are never retried', async () => {
  for (const condition of [{ mismatch: true }, { timeout: true }]) {
    const f = fixture(condition);
    await assert.rejects(syncSheets(profile, { weeks: ['2026-11-16'], apply: true }, f.dependencies));
    assert.equal(f.posts(), 1);
  }
});


test('fixed API: append beyond grid capacity extends only required rows before initializing templates', async () => {
  const f = fixture({ full: true });
  const out = await syncSheets(profile, { weeks: ['2026-11-23'], apply: true }, f.dependencies);
  assert.equal(out.weeks[0].row, 11);
  assert.equal(f.posted[0].appendDimension.length, 1);
});
