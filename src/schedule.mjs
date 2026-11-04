import { workdays } from './core/time.mjs';

const round = (h) => Math.round(h * 100) / 100;

// 사람이 정한 일정(fixedStart·fixedDue)은 그대로 두고, 나머지를 순서대로 근무일에 채운다.
export function schedule({ from, to, holidays = [], hoursPerDay = 8, maxHoursPerDay = 16, sprint = null, busy = {}, items }) {
  const days = workdays(from, to, holidays);
  if (!days.length) throw new Error(`계획 기간에 근무일이 없음: ${from}~${to}`);
  const load = Object.fromEntries(days.map((d) => [d, busy[d] ?? 0]));
  const warnings = [];
  const planned = [];

  for (const it of items.filter((i) => i.fixedStart && i.fixedDue)) {
    const span = workdays(it.fixedStart, it.fixedDue, holidays);
    if (!span.length) warnings.push({ code: 'fixed-no-workday', key: it.key });
    for (const d of span) if (d in load) load[d] += it.hours / span.length;
    if (it.fixedStart < from || it.fixedDue > to) warnings.push({ code: 'fixed-outside-window', key: it.key });
    if (sprint && (it.fixedStart < sprint.start || it.fixedDue > sprint.end)) warnings.push({ code: 'outside-sprint', key: it.key });
    planned.push({ key: it.key, startDate: it.fixedStart, dueDate: it.fixedDue, hours: it.hours, fixed: true });
  }

  const auto = items.filter((i) => !(i.fixedStart && i.fixedDue));
  const demand = auto.reduce((s, i) => s + i.hours, 0);
  const free = (cap) => days.reduce((s, d) => s + Math.max(0, cap - load[d]), 0);
  const cap = demand <= free(hoursPerDay) ? hoursPerDay : maxHoursPerDay;
  if (cap > hoursPerDay) warnings.push({ code: 'extended-capacity', hours: cap });

  let i = 0;
  for (const it of auto) {
    while (i < days.length && load[days[i]] >= cap) i++;
    if (i >= days.length) {
      const last = days.at(-1);
      load[last] += it.hours;
      planned.push({ key: it.key, startDate: last, dueDate: last, hours: it.hours, fixed: false });
      warnings.push({ code: 'overflow', key: it.key });
      continue;
    }
    const startDate = days[i];
    let left = it.hours;
    while (left > 0 && i < days.length) {
      const take = Math.min(left, Math.max(0, cap - load[days[i]]));
      load[days[i]] += take;
      left = round(left - take);
      if (left > 0) i++;
    }
    let dueDate = days[Math.min(i, days.length - 1)];
    if (left > 0) {
      load[days.at(-1)] += left;
      dueDate = days.at(-1);
      warnings.push({ code: 'overflow', key: it.key });
    }
    planned.push({ key: it.key, startDate, dueDate, hours: it.hours, fixed: false });
    if (sprint && dueDate > sprint.end) warnings.push({ code: 'outside-sprint', key: it.key });
  }

  for (const d of days) if (load[d] > maxHoursPerDay) warnings.push({ code: 'over-max', date: d, hours: round(load[d]) });
  return {
    cap,
    window: { from, to },
    days: days.map((d) => ({ date: d, hours: round(load[d]) })),
    planned,
    warnings,
  };
}
