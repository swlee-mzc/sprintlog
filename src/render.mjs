import { addDays, md, weekday, weekDays } from './core/time.mjs';
import { entryFor, fixedText } from './notation.mjs';

const WIDE = [[0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6]];
const charWidth = (cp) => (WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1);
export const width = (s) => [...s].reduce((n, ch) => n + charWidth(ch.codePointAt(0)), 0);

export function fit(s, w) {
  let out = '';
  let n = 0;
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0));
    if (n + cw > w - (width(s) > w ? 1 : 0)) {
      out += '…';
      n += 1;
      break;
    }
    out += ch;
    n += cw;
  }
  return out + ' '.repeat(Math.max(0, w - n));
}

const SGR = { yellow: 33, cyan: 36, green: 32, red: 31, gray: 90, bold: 1, inverse: 7, strike: 9 };
const paint = (on, styles, s) => (on && styles.length ? `\x1b[${styles.map((k) => SGR[k]).join(';')}m${s}\x1b[0m` : s);

const MARK = {
  progress: { text: () => '▶ 진행', styles: ['yellow'] },
  due: { text: (e) => (e.strike ? '✓ [완료]' : '◆ [완료]'), styles: (e) => (e.strike ? ['green', 'strike'] : ['cyan']) },
  delayed: { text: (e) => `⚠ 지연(${e.text.match(/\((\d{4})\)/)?.[1] ?? ''})`, styles: (e) => (e.strike ? ['green', 'strike'] : ['red']) },
};

function weekModel(snapshot, week) {
  const days = weekDays(week);
  const holidays = new Set(snapshot.holidays ?? []);
  const rows = snapshot.features
    .map((f) => ({ label: f.label ?? f.summary, cells: days.map((d) => (holidays.has(d) ? null : entryFor(f, d))) }))
    .filter((r) => r.cells.some(Boolean));
  const fixed = (snapshot.fixedLines ?? [])
    .map((line) => ({ label: '고정', cells: days.map((d) => (holidays.has(d) || !fixedText(line, d) ? null : { kind: 'fixed', text: fixedText(line, d) })) }))
    .filter((r) => r.cells.some(Boolean));
  const hours = days.map((d) => snapshot.hours?.[d] ?? null);
  return { days, rows: [...rows, ...fixed], hours };
}

const hourStyle = (h, cap) => (h == null ? [] : h > cap.max ? ['red'] : h > cap.base ? ['yellow'] : []);

export function renderWeek(snapshot, { week, today, color = false, format = 'tty', stale = false }) {
  const { days, rows, hours } = weekModel(snapshot, week);
  const cap = { base: snapshot.capacity?.hoursPerDay ?? 8, max: snapshot.capacity?.maxHoursPerDay ?? 16 };
  const sprint = snapshot.sprint ? `${snapshot.sprint.name}  ${md(snapshot.sprint.start)}(${weekday(snapshot.sprint.start)}) ~ ${md(snapshot.sprint.end)}(${weekday(snapshot.sprint.end)})` : '스프린트 정보 없음';
  const synced = `기준: ${snapshot.syncedAt.slice(0, 16).replace('T', ' ')} UTC${stale ? '  ⚠ 동기화 필요' : ''}`;
  const head = days.map((d) => `${weekday(d)} ${md(d)}${d === today ? ' ▼오늘' : ''}`);
  const cellOf = (c) => (!c ? '·' : c.kind === 'fixed' ? c.text : MARK[c.kind].text(c));

  if (format === 'md') {
    const esc = (s) => s.replace(/\|/g, '\\|');
    const mdCell = (c) => (!c ? '' : c.strike ? `~~${esc(cellOf(c))}~~` : esc(cellOf(c)));
    const lines = [`**${sprint}** · ${synced}`, '', `| 기능 | ${head.join(' | ')} |`, `|---|${days.map(() => '---').join('|')}|`];
    for (const r of rows) lines.push(`| ${esc(r.label)} | ${r.cells.map(mdCell).join(' | ')} |`);
    if (hours.some((h) => h != null)) lines.push(`| 계획 시간 | ${hours.map((h) => (h == null ? '' : `${h}h${h > cap.max ? ' ⚠' : ''}`)).join(' | ')} |`);
    return lines.join('\n');
  }

  const LW = Math.min(16, Math.max(6, ...rows.map((r) => width(r.label))));
  const CW = 14;
  const line = (label, cells) => [fit(label, LW), ...cells].join('  ');
  const out = [paint(color, ['bold'], sprint) + '   ' + paint(color, stale ? ['yellow'] : ['gray'], synced), ''];
  out.push(line('', head.map((h, i) => paint(color, days[i] === today ? ['inverse'] : ['bold'], fit(h, CW)))));
  out.push(line('─'.repeat(LW), days.map(() => '─'.repeat(CW))));
  for (const r of rows) {
    out.push(
      line(
        r.label,
        r.cells.map((c) => {
          const text = fit(cellOf(c), CW);
          if (!c) return paint(color, ['gray'], text);
          if (c.kind === 'fixed') return paint(color, ['gray'], text);
          const m = MARK[c.kind];
          return paint(color, typeof m.styles === 'function' ? m.styles(c) : m.styles, text);
        }),
      ),
    );
  }
  if (hours.some((h) => h != null)) {
    out.push(line('─'.repeat(LW), days.map(() => '─'.repeat(CW))));
    out.push(line('계획 시간', hours.map((h) => paint(color, hourStyle(h, cap), fit(h == null ? '' : `${h}h${h > cap.max ? ' ⚠' : ''}`, CW)))));
  }
  return out.join('\n');
}

export function renderSprint(snapshot, opts) {
  if (!snapshot.sprint) return renderWeek(snapshot, opts);
  const weeks = [];
  for (let d = weekDays(snapshot.sprint.start)[0]; d <= snapshot.sprint.end; d = addDays(d, 7)) weeks.push(d);
  return weeks.map((w) => renderWeek(snapshot, { ...opts, week: w })).join('\n\n');
}
