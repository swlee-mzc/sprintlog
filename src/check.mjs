// 주중 계획 대비 점검. facts 의 subtasks 와 PR 머지 근거로 Jira 에 할 조치를 정한다.
// 새 기한처럼 사람이 정할 값은 정하지 않고 ask 로 남긴다.
export function check({ today, subtasks, merged = {}, reviewStatuses = [] }) {
  const open = (s) => !s.done && !s.dropped;
  const isReview = (s) => reviewStatuses.includes(s.status);
  const actions = [];
  const willBeDone = new Set();

  for (const s of subtasks.filter((x) => x.mine && open(x))) {
    const base = { key: s.key, status: s.status, dueDate: s.dueDate };
    if (isReview(s)) {
      if (merged[s.key] === true) {
        actions.push({ ...base, action: 'transition-done', reason: 'review-merged' });
        willBeDone.add(s.key);
        continue;
      }
      if (merged[s.key] == null) {
        actions.push({ ...base, action: 'check-pr', reason: 'no-pr-evidence' });
        continue;
      }
    }
    if (s.dueDate && s.dueDate < today) actions.push({ ...base, action: 'set-due', reason: isReview(s) ? 'review-not-merged-overdue' : 'overdue', ask: 'newDueDate' });
    else if (s.dueDate === today) actions.push({ ...base, action: 'confirm-today', reason: 'due-today', ask: 'doneOrNewDueDate' });
  }

  const children = new Map();
  for (const s of subtasks.filter((x) => x.subtask && x.parentKey && !x.dropped)) {
    if (!children.has(s.parentKey)) children.set(s.parentKey, []);
    children.get(s.parentKey).push(s);
  }
  for (const p of subtasks.filter((x) => x.mine && !x.subtask && open(x) && children.has(x.key))) {
    if (children.get(p.key).every((c) => c.done || willBeDone.has(c.key))) {
      actions.push({ key: p.key, status: p.status, dueDate: p.dueDate, action: 'transition-parent-done', reason: 'all-subtasks-done' });
    }
  }

  const summary = {};
  for (const a of actions) summary[a.action] = (summary[a.action] ?? 0) + 1;
  return { today, actions, summary };
}
