import { addDays, kstDate, weekdayIndex } from './core/time.mjs';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const sprintName = (rule, n) => rule.namePattern.replace('{n}', String(n));

export function sprintNumber(rule, name) {
  const [pre, post] = rule.namePattern.split('{n}');
  const m = new RegExp(`^${escapeRe(pre)}(\\d+)${escapeRe(post)}$`).exec(name ?? '');
  return m ? Number(m[1]) : null;
}

export function predict(rule, n) {
  const start = addDays(rule.anchor.start, (n - rule.anchor.n) * 7 * rule.lengthWeeks);
  let end = addDays(start, 7 * rule.lengthWeeks - 1);
  const target = WEEKDAY_KEYS.indexOf(rule.endWeekday);
  while (weekdayIndex(end) !== target) end = addDays(end, -1);
  return { n, name: sprintName(rule, n), start, end };
}

export function predictAt(rule, date) {
  const span = 7 * rule.lengthWeeks;
  const days = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${rule.anchor.start}T00:00:00Z`)) / 86400000);
  return predict(rule, rule.anchor.n + Math.floor(days / span));
}

const normalize = (rule, s) => ({
  id: s.id,
  name: s.name,
  n: sprintNumber(rule, s.name),
  state: s.state,
  start: s.startDate ? kstDate(s.startDate) : null,
  end: s.endDate ? kstDate(s.endDate) : null,
});

// 입력: Jira 스프린트 필드 값 목록(티켓들에서 모은 것). 출력: 현재·다음 스프린트와 판정.
export function resolve(rule, { sprints = [], today }) {
  const seen = new Map();
  for (const s of sprints) if (s?.id != null && !seen.has(s.id)) seen.set(s.id, normalize(rule, s));
  const all = [...seen.values()];
  const active = all.filter((s) => s.state === 'active');
  const mismatches = all
    .filter((s) => s.n != null && s.start && s.end)
    .map((s) => ({ s, p: predict(rule, s.n) }))
    .filter(({ s, p }) => s.start !== p.start || s.end !== p.end)
    .map(({ s, p }) => ({ name: s.name, jira: { start: s.start, end: s.end }, predicted: { start: p.start, end: p.end } }));

  let status = 'ok';
  let current = null;
  if (active.length > 1) status = 'multiple';
  else if (active.length === 1) {
    current = { ...active[0], source: 'jira' };
    if (current.end && today > current.end) status = 'ended';
    else if (mismatches.some((m) => m.name === current.name)) status = 'rule-mismatch';
  } else {
    current = { ...predictAt(rule, today), state: null, id: null, source: 'predicted' };
    status = 'none';
  }

  let next = null;
  if (current) {
    const n = current.n ?? sprintNumber(rule, current.name);
    if (n != null) {
      const p = predict(rule, n + 1);
      const real = all.find((s) => s.n === n + 1);
      next = real ? { ...p, ...real, start: real.start ?? p.start, end: real.end ?? p.end, exists: true } : { ...p, id: null, state: null, exists: false };
    }
  }
  return { status, today, current, next, active, mismatches };
}
