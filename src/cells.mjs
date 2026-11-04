import { md, weekOfMonth } from './core/time.mjs';

export const colLetter = (i) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
export const colIndex = (letter) => [...letter].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export function tabTitle(pattern, date) {
  const { month, week } = weekOfMonth(date);
  return pattern.replace('{M}', String(month)).replace('{N}', String(week));
}

export function cellText(entries, bullet) {
  const lines = entries.map((e) => `${bullet}${e.text}`);
  const text = lines.join('\n');
  if (!lines.length) return { text, runs: [] };
  const runs = [];
  let offset = 0;
  entries.forEach((e, i) => {
    if (!runs.length || runs.at(-1).format.strikethrough !== e.strike) runs.push({ startIndex: offset, format: { strikethrough: e.strike } });
    offset += lines[i].length + 1;
  });
  return { text, runs };
}

// 런 표현은 달라도(빈 배열, strikethrough:false 런) 같은 글자에 취소선이 있으면 같다.
function struck(runs, length) {
  const sorted = [...(runs ?? [])].sort((x, y) => (x.startIndex ?? 0) - (y.startIndex ?? 0));
  const ranges = [];
  sorted.forEach((r, i) => {
    const from = r.startIndex ?? 0;
    const to = i + 1 < sorted.length ? sorted[i + 1].startIndex ?? 0 : length;
    if (r.format?.strikethrough && to > from) ranges.push(`${from}-${to}`);
  });
  return ranges.join(',');
}

// header·names·current 는 A열 1행부터 읽은 값이어야 한다(get_values 의 'tab'!A{행}:… 와 'tab'!{이름열}1:…).
export function cells({ notation, sheet, profile, header, names, current = [], currentRuns = null }) {
  const cfg = { nextHeader: '차주 계획', bullet: '- ', ...profile };
  const matches = names.map((v, i) => [String(v ?? '').trim(), i]).filter(([v]) => v === cfg.memberName);
  if (!matches.length) return { error: 'member-not-found', member: cfg.memberName };
  if (matches.length > 1) return { error: 'member-ambiguous', member: cfg.memberName, rows: matches.map(([, i]) => i + 1) };
  const rowIndex = matches[0][1];

  const columns = {};
  header.forEach((h, i) => {
    const v = String(h ?? '').trim();
    for (const d of notation.week.days) if (new RegExp(`(^|\\D)${md(d)}($|\\D)`).test(v)) columns[d] = i;
    if (v === cfg.nextHeader) columns.next = i;
  });
  const missing = [...notation.week.days, 'next'].filter((k) => columns[k] === undefined);
  if (missing.length) return { error: 'columns-not-found', missing };

  const targets = [...notation.week.days.map((d) => [d, notation.cells[d]]), ['next', notation.next]];
  const out = [];
  const requests = [];
  for (const [k, entries] of targets) {
    const col = columns[k];
    const { text, runs } = cellText(entries, cfg.bullet);
    const before = String(current[col] ?? '');
    // 현재 서식을 모르면 내용이 있는 칸은 다시 써서 서식을 보장한다.
    const changed = Array.isArray(currentRuns) ? before !== text || struck(currentRuns[col], before.length) !== struck(runs, text.length) : before !== text || text.length > 0;
    const a1 = `${colLetter(col)}${rowIndex + 1}`;
    out.push({ key: k, a1, before, after: text, runs, changed });
    if (!changed) continue;
    const value = { userEnteredValue: { stringValue: text } };
    if (runs.length) value.textFormatRuns = runs;
    requests.push({
      updateCells: {
        start: { sheetId: sheet.sheetId, rowIndex, columnIndex: col },
        rows: [{ values: [value] }],
        fields: 'userEnteredValue,textFormatRuns',
      },
    });
  }
  return { tab: sheet.title, row: rowIndex + 1, columns: Object.fromEntries(Object.entries(columns).map(([k, i]) => [k, colLetter(i)])), cells: out, requests };
}
