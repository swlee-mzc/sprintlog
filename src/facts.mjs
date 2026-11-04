import { kstDate, kstTime, workdays } from './core/time.mjs';

export function plainText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body.replace(/\s+/g, ' ').trim();
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (typeof n.text === 'string') out.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  })(body);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

// 검색 응답({issues:{nodes}}), 단건 응답, 배열 어느 모양이든 이슈 목록으로 편다.
export function issuesOf(response) {
  if (Array.isArray(response)) return response.flatMap(issuesOf);
  if (response?.issues?.nodes) return response.issues.nodes;
  if (Array.isArray(response?.issues)) return response.issues;
  if (response?.key && response?.fields) return [response];
  return [];
}

function mergeIssues(responses) {
  const byKey = new Map();
  for (const issue of responses.flatMap(issuesOf)) {
    const prev = byKey.get(issue.key);
    byKey.set(issue.key, prev ? { ...prev, ...issue, fields: { ...prev.fields, ...issue.fields }, changelog: issue.changelog ?? prev.changelog } : issue);
  }
  return [...byKey.values()];
}

// 처음 잡은 기한: 기한 변경 이력의 가장 이른 값. 이력이 없으면 현재 기한.
function originalDue(issue, dueField) {
  const changes = (issue.changelog?.histories ?? [])
    .flatMap((h) => (h.items ?? []).filter((it) => it.field === dueField || it.fieldId === dueField).map((it) => ({ at: h.created, from: it.from, to: it.to })))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (!changes.length) return { date: issue.fields[dueField] ?? null, source: issue.changelog ? 'changelog' : 'none' };
  const first = changes[0];
  const value = first.from || first.to;
  return { date: value ? value.slice(0, 10) : null, source: 'changelog' };
}

export function facts({ me, fields, from, to, holidays = [], responses }) {
  const issues = mergeIssues(responses);
  const warnings = [];
  const events = [];
  const subtasks = [];
  const inWindow = (date) => date >= from && date <= to;
  const push = (e) => inWindow(e.date) && events.push(e);

  for (const issue of issues) {
    const f = issue.fields ?? {};
    const status = f.status ?? {};
    const category = status.statusCategory?.key ?? null;
    const due = originalDue(issue, fields.dueDate);
    subtasks.push({
      key: issue.key,
      summary: f.summary ?? '',
      subtask: Boolean(f.issuetype?.subtask),
      parentKey: f.parent?.key ?? null,
      parentSummary: f.parent?.fields?.summary ?? null,
      mine: f.assignee?.accountId === me,
      status: status.name ?? null,
      category,
      done: category === 'done',
      dropped: /drop/i.test(status.name ?? ''),
      doneDate: f.resolutiondate ? kstDate(f.resolutiondate) : null,
      startDate: f[fields.startDate] ? kstDate(f[fields.startDate]) : null,
      dueDate: f[fields.dueDate] ? kstDate(f[fields.dueDate]) : null,
      originalDueDate: due.date,
      dueHistory: due.source,
      sprints: (f[fields.sprint] ?? []).map((s) => ({ id: s.id, name: s.name, state: s.state, startDate: s.startDate ?? null, endDate: s.endDate ?? null })),
    });

    const wl = f.worklog;
    if (wl && wl.total > (wl.worklogs ?? []).length) warnings.push({ code: 'worklog-truncated', key: issue.key, total: wl.total });
    for (const w of wl?.worklogs ?? []) {
      if (w.author?.accountId !== me) continue;
      push({ date: kstDate(w.started), time: kstTime(w.started), key: issue.key, kind: 'worklog', minutes: Math.round((w.timeSpentSeconds ?? 0) / 60), text: plainText(w.comment) });
    }
    const cm = f.comment;
    if (cm && cm.total > (cm.comments ?? []).length) warnings.push({ code: 'comment-truncated', key: issue.key, total: cm.total });
    for (const c of cm?.comments ?? []) {
      if (c.author?.accountId !== me) continue;
      push({ date: kstDate(c.created), time: kstTime(c.created), key: issue.key, kind: 'comment', text: plainText(c.body) });
    }
    for (const h of issue.changelog?.histories ?? []) {
      if (h.author?.accountId !== me) continue;
      for (const it of h.items ?? []) {
        if (it.field === 'status') push({ date: kstDate(h.created), time: kstTime(h.created), key: issue.key, kind: 'status', text: `${it.fromString} → ${it.toString}` });
      }
    }
    if (f.assignee?.accountId === me && f.resolutiondate) push({ date: kstDate(f.resolutiondate), time: kstTime(f.resolutiondate), key: issue.key, kind: 'resolved', text: status.name ?? '' });
    if (f.reporter?.accountId === me && f.created) push({ date: kstDate(f.created), time: kstTime(f.created), key: issue.key, kind: 'created', text: f.summary ?? '' });
  }

  events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.key.localeCompare(b.key));
  const days = workdays(from, to, holidays).map((date) => ({ date, events: events.filter((e) => e.date === date).length }));
  return {
    window: { from, to },
    subtasks: subtasks.sort((a, b) => a.key.localeCompare(b.key)),
    events,
    days,
    noEvidenceDays: days.filter((d) => d.events === 0).map((d) => d.date),
    warnings,
  };
}
