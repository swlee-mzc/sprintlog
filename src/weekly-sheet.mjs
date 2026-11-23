import { EXIT, Failure } from './core/runtime.mjs';
import { assertDate, weekDays, addDays } from './core/time.mjs';

export const WEEKLY_HEADERS = ['주차', '월', '화', '수', '목', '금', '차주 계획', '이슈·요청'];
const fail = (message) => new Failure(EXIT.PRECONDITION, message);
export const weekLabel = (week) => `${week}\n${week.slice(5).replace('-', '/')} ~ ${addDays(week, 4).slice(5).replace('-', '/')}`;
export function weekKey(value) {
  const first = String(value ?? '').trim().split(/\r?\n/)[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) return null;
  const date = assertDate(first);
  if (weekDays(date)[0] !== date) throw fail('주차 키는 월요일이어야 합니다');
  return date;
}
export const cellValue = (cell) => cell?.formattedValue ?? cell?.effectiveValue?.stringValue ?? cell?.userEnteredValue?.stringValue ?? '';
export function weeklyColumns(header, days) {
  const columns = {};
  for (const title of WEEKLY_HEADERS) {
    const matches = header.flatMap((h, i) => String(h ?? '').trim() === title ? [i] : []);
    if (matches.length !== 1) throw fail(`사용자별 주간 로그 헤더 누락·중복: ${title}`);
    columns[title] = matches[0];
  }
  return { week: columns['주차'], next: columns['차주 계획'], issues: columns['이슈·요청'], ...Object.fromEntries(days.map((d, i) => [d, columns[WEEKLY_HEADERS[i + 1]]])) };
}
