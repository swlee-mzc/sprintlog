import { addDays, mmdd, weekDays, workdays } from './core/time.mjs';

const max = (xs) => xs.filter(Boolean).sort().at(-1) ?? null;
const min = (xs) => xs.filter(Boolean).sort()[0] ?? null;

// 기능 = 내 서브태스크의 부모 스토리. 서브태스크 없이 내게 배정된 티켓은 그 자체가 기능이다.
// planMode: fill = 계획 날짜는 Jira 에 날짜가 없을 때만 쓴다(로컬 계획), override = 계획 날짜가 이긴다(재계획 미리보기).
export function features(subtasks, { labels = {}, planned = [], planMode = 'fill' } = {}) {
  const plan = new Map(planned.map((p) => [p.key, p]));
  const mine = subtasks
    .filter((s) => s.mine && !s.dropped)
    .map((s) => {
      const p = plan.get(s.key);
      if (!p) return s;
      if (planMode === 'override') return { ...s, startDate: p.startDate, dueDate: p.dueDate, originalDueDate: s.originalDueDate ?? p.dueDate };
      return { ...s, startDate: s.startDate ?? p.startDate, dueDate: s.dueDate ?? p.dueDate, originalDueDate: s.originalDueDate ?? p.dueDate };
    });
  const parentsWithMine = new Set(mine.filter((s) => s.subtask && s.parentKey).map((s) => s.parentKey));
  const groups = new Map();
  for (const s of mine) {
    if (!s.subtask && parentsWithMine.has(s.key)) continue;
    const key = s.subtask && s.parentKey ? s.parentKey : s.key;
    const summary = s.subtask && s.parentKey ? s.parentSummary ?? s.summary : s.summary;
    if (!groups.has(key)) groups.set(key, { key, summary, items: [] });
    groups.get(key).items.push(s);
  }
  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      summary: g.summary,
      label: labels[g.key] ?? null,
      start: min(g.items.map((i) => i.startDate ?? i.dueDate)),
      due: max(g.items.map((i) => i.dueDate)),
      originalDue: max(g.items.map((i) => i.originalDueDate ?? i.dueDate)),
      done: g.items.every((i) => i.done),
      items: g.items.map((i) => i.key),
    }))
    .sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999') || a.key.localeCompare(b.key));
}

export function entryFor(feature, date) {
  const { start, due, originalDue, done } = feature;
  const label = feature.label ?? feature.summary;
  if (!start || !due) return null;
  const delayed = originalDue && originalDue < due;
  if (delayed && date === originalDue) return { kind: 'delayed', text: `[완료-지연(${mmdd(due)})] ${label}`, strike: done, key: feature.key };
  if (date === due) return { kind: 'due', text: `[완료] ${label}`, strike: done, key: feature.key };
  if (date >= start && date < due) return { kind: 'progress', text: label, strike: false, key: feature.key };
  return null;
}

// 고정 문구는 문자열(모든 근무일) 또는 { text, from?, to? }(그 기간의 근무일). 완료 표기가 붙지 않는다.
export const fixedText = (line, date) =>
  typeof line === 'string' ? line : (!line.from || date >= line.from) && (!line.to || date <= line.to) ? line.text : null;

const fixedEntry = (text) => ({ kind: 'fixed', text, strike: false, key: null });

export function notation({ week, subtasks, labels = {}, planned = [], planMode = 'fill', fixedLines = [], holidays = [] }) {
  const days = weekDays(week);
  const open = new Set(workdays(days[0], days.at(-1), holidays));
  const list = features(subtasks, { labels, planned, planMode });
  const cells = {};
  for (const d of days) {
    cells[d] = open.has(d) ? list.map((f) => entryFor(f, d)).filter(Boolean) : null;
    if (open.has(d)) for (const line of fixedLines) {
      const text = fixedText(line, d);
      if (text) cells[d].push(fixedEntry(text));
    }
  }
  const nextFrom = addDays(days[0], 7);
  const nextTo = addDays(days[0], 11);
  const next = list
    .filter((f) => f.start && f.due && f.start <= nextTo && f.due >= nextFrom && !(f.done && f.due < nextFrom))
    .map((f) => {
      const label = f.label ?? f.summary;
      return { kind: f.due <= nextTo ? 'due' : 'progress', text: f.due <= nextTo ? `[완료] ${label}` : label, strike: false, key: f.key };
    });
  const nextOpen = workdays(nextFrom, nextTo, holidays);
  for (const line of fixedLines) {
    if (typeof line !== 'string' && nextOpen.some((d) => fixedText(line, d))) next.push(fixedEntry(line.text));
  }
  return {
    week: { days, next: { from: nextFrom, to: nextTo } },
    features: list,
    cells,
    next,
    missingLabels: list.filter((f) => !f.label).map((f) => ({ key: f.key, summary: f.summary })),
    unscheduled: list.filter((f) => !f.start || !f.due).map((f) => f.key),
  };
}
