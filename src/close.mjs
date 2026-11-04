// 스프린트 종료 정리 판정표. 근거가 없으면 실행하지 않고 undetermined 로 둔다.
export function classify({ today, sprint, tickets, reviewStatuses = [] }) {
  const actions = tickets.map((t) => {
    const review = t.review ?? reviewStatuses.includes(t.status);
    const overdue = Boolean(t.dueDate && t.dueDate < today);
    const base = { key: t.key, status: t.status };
    if (t.category === 'done') {
      return (t.missingDoneFields ?? []).length
        ? { ...base, action: 'fill-done-fields', fields: t.missingDoneFields, redate: false }
        : { ...base, action: 'none', redate: false };
    }
    if (review) {
      if (!t.pr || t.pr.merged == null) return { ...base, action: 'undetermined', reason: 'no-pr-evidence', redate: false };
      if (t.pr.merged && t.pr.targetMatches !== false) return { ...base, action: 'transition-done', fields: t.missingDoneFields ?? [], redate: false };
      return { ...base, action: 'carry-over', reason: 'review-not-merged', redate: overdue };
    }
    if (t.category === 'indeterminate') return { ...base, action: 'carry-over', reason: 'in-progress', redate: true };
    return { ...base, action: 'carry-over', reason: 'not-started', redate: overdue };
  });
  const summary = {};
  for (const a of actions) summary[a.action] = (summary[a.action] ?? 0) + 1;
  return { today, sprint, actions, summary };
}
