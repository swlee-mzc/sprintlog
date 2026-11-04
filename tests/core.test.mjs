import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDate, kstDate, weekOfMonth, workdays, weekDays } from '../src/core/time.mjs';
import { validate } from '../src/core/schema.mjs';
import { predict, resolve } from '../src/sprint.mjs';
import { schedule } from '../src/schedule.mjs';

test('KST 날짜: UTC 15시 이후는 다음 날', () => {
  assert.equal(kstDate('2026-10-19T14:59:00Z'), '2026-10-19');
  assert.equal(kstDate('2026-10-19T15:00:00Z'), '2026-10-20');
  assert.equal(kstDate('2026-10-20T08:30:00.000+0900'), '2026-10-20');
  assert.equal(kstDate('2026-10-20'), '2026-10-20');
});

test('주차: 월요일이 그 달의 몇 번째 월요일인지', () => {
  assert.deepEqual(weekOfMonth('2026-10-21'), { month: 10, week: 3 });
  assert.deepEqual(weekOfMonth('2026-10-26'), { month: 10, week: 4 });
  assert.deepEqual(weekOfMonth('2026-11-04'), { month: 11, week: 1 });
  assert.deepEqual(weekDays('2026-11-04'), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
  assert.deepEqual(workdays('2026-11-06', '2026-11-10', ['2026-11-09']), ['2026-11-06', '2026-11-10']);
});

test('날짜 검증: 존재하지 않는 날짜는 거부', () => {
  assert.equal(assertDate('2028-02-29'), '2028-02-29');
  assert.throws(() => assertDate('2026-02-30'));
  assert.throws(() => assertDate('2026-13-01'));
});

test('스키마: 필수·형식·허용되지 않은 키', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['d'], properties: { d: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } };
  assert.deepEqual(validate({ d: '2026-01-01' }, schema), []);
  assert.equal(validate({}, schema).length, 1);
  assert.equal(validate({ d: '1/1', x: 1 }, schema).length, 2);
});

const RULE = { namePattern: 'Team_Sprint_{n}', lengthWeeks: 2, anchor: { n: 27, start: '2026-11-02' }, endWeekday: 'fri' };

test('스프린트 예측: 기준점 앞뒤', () => {
  assert.deepEqual(predict(RULE, 28), { n: 28, name: 'Team_Sprint_28', start: '2026-11-16', end: '2026-11-27' });
  assert.deepEqual(predict(RULE, 26), { n: 26, name: 'Team_Sprint_26', start: '2026-10-19', end: '2026-10-30' });
});

const ACTIVE = { id: 7, name: 'Team_Sprint_27', state: 'active', startDate: '2026-11-01T21:00:37.251Z', endDate: '2026-11-13T12:00:00.000Z' };

test('스프린트 판정: 정상·종료·없음·다음 미생성', () => {
  const ok = resolve(RULE, { sprints: [ACTIVE, ACTIVE], today: '2026-11-04' });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.current.start, '2026-11-02');
  assert.equal(ok.current.end, '2026-11-13');
  assert.equal(ok.next.name, 'Team_Sprint_28');
  assert.equal(ok.next.exists, false);
  assert.equal(resolve(RULE, { sprints: [ACTIVE], today: '2026-11-16' }).status, 'ended');
  const none = resolve(RULE, { sprints: [], today: '2026-11-20' });
  assert.equal(none.status, 'none');
  assert.equal(none.current.name, 'Team_Sprint_28');
  const moved = resolve(RULE, { sprints: [{ ...ACTIVE, endDate: '2026-11-20T12:00:00Z' }], today: '2026-11-04' });
  assert.equal(moved.status, 'rule-mismatch');
  assert.equal(resolve(RULE, { sprints: [ACTIVE, { ...ACTIVE, id: 8, name: 'Other' }], today: '2026-11-04' }).status, 'multiple');
});

test('일정 배치: 8시간 기본, 넘치면 16시간, 그래도 넘치면 경고', () => {
  const base = { from: '2026-11-09', to: '2026-11-10', hoursPerDay: 8, maxHoursPerDay: 16 };
  const a = schedule({ ...base, items: [{ key: 'P-1', hours: 6 }, { key: 'P-2', hours: 6 }] });
  assert.equal(a.cap, 8);
  assert.deepEqual(a.planned.map((p) => [p.key, p.startDate, p.dueDate]), [['P-1', '2026-11-09', '2026-11-09'], ['P-2', '2026-11-09', '2026-11-10']]);
  assert.deepEqual(a.warnings, []);
  const b = schedule({ ...base, items: [{ key: 'P-1', hours: 20 }] });
  assert.equal(b.cap, 16);
  assert.equal(b.planned[0].dueDate, '2026-11-10');
  assert.ok(b.warnings.some((w) => w.code === 'extended-capacity'));
  const c = schedule({ ...base, items: [{ key: 'P-1', hours: 40 }] });
  assert.ok(c.warnings.some((w) => w.code === 'overflow'));
  assert.ok(c.warnings.some((w) => w.code === 'over-max'));
});

test('일정 배치: 사람이 정한 일정은 그대로, 초과는 경고만', () => {
  const r = schedule({ from: '2026-11-09', to: '2026-11-13', sprint: { start: '2026-11-02', end: '2026-11-11' }, items: [{ key: 'P-1', hours: 20, fixedStart: '2026-11-09', fixedDue: '2026-11-09' }, { key: 'P-2', hours: 4 }] });
  assert.deepEqual(r.planned[0], { key: 'P-1', startDate: '2026-11-09', dueDate: '2026-11-09', hours: 20, fixed: true });
  assert.equal(r.planned[1].startDate, '2026-11-10');
  assert.ok(r.warnings.some((w) => w.code === 'over-max' && w.date === '2026-11-09'));
});
