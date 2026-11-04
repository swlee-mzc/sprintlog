const KST_MS = 9 * 3600 * 1000;
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// Jira 는 "+0900" 처럼 콜론 없는 오프셋을 쓴다.
export function parseTime(iso) {
  const d = new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (Number.isNaN(d.getTime())) throw new Error(`시각을 읽을 수 없음: ${iso}`);
  return d;
}

const kst = (iso) => new Date(parseTime(iso).getTime() + KST_MS).toISOString();
export const kstDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : kst(iso).slice(0, 10));
export const kstTime = (iso) => kst(iso).slice(11, 16);
export const todayKst = (now = new Date()) => new Date(now.getTime() + KST_MS).toISOString().slice(0, 10);

export function assertDate(date) {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) {
    throw new Error(`날짜 형식은 YYYY-MM-DD: ${date}`);
  }
  return date;
}

export function addDays(date, n) {
  const d = new Date(`${assertDate(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const weekdayIndex = (date) => new Date(`${assertDate(date)}T00:00:00Z`).getUTCDay();
export const weekday = (date) => WEEKDAYS[weekdayIndex(date)];
export const mmdd = (date) => date.slice(5, 7) + date.slice(8, 10);
export const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

export const mondayOf = (date) => addDays(date, -((weekdayIndex(date) + 6) % 7));
export const weekDays = (date) => [0, 1, 2, 3, 4].map((i) => addDays(mondayOf(date), i));

export function workdays(from, to, holidays = []) {
  const off = new Set(holidays);
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = weekdayIndex(d);
    if (w !== 0 && w !== 6 && !off.has(d)) out.push(d);
  }
  return out;
}

// 월요일이 속한 달과, 그 달에서 몇 번째 월요일인지로 주차를 정한다.
export function weekOfMonth(date) {
  const monday = mondayOf(date);
  return { month: Number(monday.slice(5, 7)), week: Math.ceil(Number(monday.slice(8, 10)) / 7) };
}
