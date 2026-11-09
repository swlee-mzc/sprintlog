import { addDays, mmdd, weekDays, workdays, weekdayIndex } from './core/time.mjs';

const max = (xs) => xs.filter(Boolean).sort().at(-1) ?? null;
const min = (xs) => xs.filter(Boolean).sort()[0] ?? null;

// 기능 = 내 서브태스크의 부모 스토리. 서브태스크 없이 내게 배정된 티켓은 그 자체가 기능이다.
// planMode: fill = 계획 날짜는 Jira 에 날짜가 없을 때만 쓴다(로컬 계획), override = 계획 날짜가 이긴다(재계획 미리보기).
// from 이 있으면 그 전에 끝난 서브태스크는 기능의 기간 계산에서 뺀다(완료 판정에는 남긴다).
export function features(subtasks, { labels = {}, planned = [], planMode = 'fill', from = null, countScopes = {} } = {}) {
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
    .map((g) => {
      const scope = countScopes[g.key];
      if (scope) {
        if (scope.some((key) => !g.items.some((i) => i.key === key))) throw new Error(`집계 대상 티켓 누락: ${g.key}`);
        g.items = g.items.filter((i) => scope.includes(i.key));
        if (!g.items.length) throw new Error(`집계 대상이 비어 있음: ${g.key}`);
      }
      const current = g.items.filter((i) => !(from && i.done && i.dueDate && i.dueDate < from));
      const span = current.length ? current : g.items;
      return {
        key: g.key,
        summary: g.summary,
        label: labels[g.key] ?? null,
        start: min(span.map((i) => i.startDate ?? i.dueDate)),
        due: max(span.map((i) => i.dueDate)),
        originalDue: max(span.map((i) => i.originalDueDate ?? i.dueDate)),
        done: g.items.every((i) => i.done),
        items: g.items.map((i) => i.key),
        ...(g.items.every((i) => i.done && i.doneDate) ? { doneDate: max(g.items.map((i) => i.doneDate)) } : {}),
        ...(scope ? { completed: g.items.filter((i) => i.done).length, total: g.items.length } : {}),
      };
    })
    .sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999') || a.key.localeCompare(b.key));
}

export const reportDate = (date) => {
  const day = weekdayIndex(date);
  return day === 6 ? addDays(date, -1) : day === 0 ? addDays(date, -2) : date;
};

const featureLabel = (feature) => (feature.label ?? feature.summary) + (feature.total ? ` (${feature.completed}/${feature.total})` : '');

export function entryFor(feature, date) {
  const { start, originalDue, done } = feature;
  const due = done && feature.doneDate ? reportDate(feature.doneDate) : feature.due;
  const label = featureLabel(feature);
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

export function notation({ week, subtasks, labels = {}, planned = [], planMode = 'fill', fixedLines = [], holidays = [], countScopes = {} }) {
  const days = weekDays(week);
  const open = new Set(workdays(days[0], days.at(-1), holidays));
  const list = features(subtasks, { labels, planned, planMode, from: days[0], countScopes });
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
    .filter((f) => f.start && f.due && f.start <= nextTo && (f.done && f.doneDate ? reportDate(f.doneDate) : f.due) >= nextFrom)
    .map((f) => {
      const label = featureLabel(f);
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
