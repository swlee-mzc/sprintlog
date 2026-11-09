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

// ticketBase 가 있으면 줄 끝에 (티켓 키) 를 붙이고 그 키에 티켓 링크를 건다.
export function cellText(entries, bullet, ticketBase = null) {
  const lines = entries.map((e) => `${bullet}${e.text}${ticketBase && e.key ? ` (${e.key})` : ''}`);
  const text = lines.join('\n');
  if (!lines.length) return { text, runs: [] };
  const runs = [];
  const push = (startIndex, format) => {
    const last = runs.at(-1);
    if (last && JSON.stringify(last.format) === JSON.stringify(format)) return;
    runs.push({ startIndex, format });
  };
  let offset = 0;
  entries.forEach((e, i) => {
    push(offset, { strikethrough: e.strike });
    if (ticketBase && e.key) {
      const keyAt = offset + lines[i].length - e.key.length - 1;
      push(keyAt, { strikethrough: e.strike, link: { uri: `${ticketBase.replace(/\/$/, '')}/browse/${e.key}` } });
      push(keyAt + e.key.length, { strikethrough: e.strike });
    }
    offset += lines[i].length + 1;
  });
  return { text, runs };
}

// 런 표현은 달라도(빈 배열, strikethrough:false 런) 같은 글자에 같은 취소선·링크가 있으면 같다.
function signature(runs, length) {
  const sorted = [...(runs ?? [])].sort((x, y) => (x.startIndex ?? 0) - (y.startIndex ?? 0));
  const ranges = [];
  sorted.forEach((r, i) => {
    const from = r.startIndex ?? 0;
    const to = i + 1 < sorted.length ? sorted[i + 1].startIndex ?? 0 : length;
    const mark = `${r.format?.strikethrough ? 's' : ''}${r.format?.link?.uri ?? ''}`;
    if (mark && to > from) ranges.push(`${from}-${to}:${mark}`);
  });
  return ranges.join(',');
}

// 알려지지 않은 기존 줄도 유지한다. 동일 티켓 또는 동일 문구만 최신 입력으로 대체한다.
function preserveEntries(entries, before, runs, bullet) {
  const merged = [...entries];
  let offset = 0;
  for (const line of before.split('\n')) {
    const text = line.startsWith(bullet) ? line.slice(bullet.length) : line;
    const match = / \(([A-Za-z][A-Za-z0-9_]*-\d+)\)$/.exec(text);
    const key = match?.[1] ?? null;
    const label = match ? text.slice(0, match.index) : text;
    if (label && !entries.some((e) => (key && e.key === key) || e.text === label)) {
      const format = [...(runs ?? [])].filter((r) => (r.startIndex ?? 0) <= offset).at(-1)?.format;
      const kind = label.startsWith('[완료-지연(') ? 'delayed' : label.startsWith('[완료]') ? 'due' : 'progress';
      merged.push({ kind, text: label, key, strike: kind !== 'progress' && Boolean(format?.strikethrough) });
    }
    offset += line.length + 1;
  }
  return merged;
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
    if (entries === null) continue;
    const col = columns[k];
    const before = String(current[col] ?? '');
    const preserved = preserveEntries(entries, before, currentRuns?.[col], cfg.bullet);
    const { text, runs } = cellText(preserved, cfg.bullet, cfg.ticketBase);
    // 현재 서식을 모르면 내용이 있는 칸은 다시 써서 서식을 보장한다.
    const changed = Array.isArray(currentRuns) ? before !== text || signature(currentRuns[col], before.length) !== signature(runs, text.length) : before !== text || text.length > 0;
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
