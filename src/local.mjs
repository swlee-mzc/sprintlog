import { existsSync, readFileSync, readdirSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EXIT, Failure } from './core/runtime.mjs';
import { assertDate, weekDays } from './core/time.mjs';
import { cells } from './cells.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/workbook.py', import.meta.url));
export function localConfig(profile) {
  const cfg = profile.local;
  if (!cfg) throw new Failure(EXIT.PRECONDITION, 'local 설정 없음 — setup 에서 workbookPath·recordsPath 를 지정한다');
  for (const key of ['workbookPath', 'recordsPath']) if (!isAbsolute(cfg[key])) throw new Failure(EXIT.INPUT, `local.${key} 는 절대 경로여야 함`);
  if (!cfg.workbookPath.endsWith('.xlsx')) throw new Failure(EXIT.INPUT, 'local.workbookPath 는 .xlsx 파일이어야 함');
  return { python: 'python3', ...cfg };
}

function workbook(profile, request) {
  const cfg = localConfig(profile);
  const r = spawnSync(cfg.python, [SCRIPT], {
    input: JSON.stringify({ path: cfg.workbookPath, bullet: profile.sheet.bullet ?? '- ', tickets: Boolean(profile.jira.site), ...request }),
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) throw new Failure(EXIT.PRECONDITION, `Excel 처리 실패: ${r.error?.message ?? r.stderr.trim()} — Python 3·openpyxl>=3.1 설치 및 파일 상태를 확인한다`);
  return JSON.parse(r.stdout);
}

export function legacyUnscheduled(profile) {
  const { recordsPath } = localConfig(profile);
  if (!existsSync(recordsPath)) return { status: 'missing-records', items: [] };
  const items = new Map();
  for (const name of readdirSync(recordsPath).filter((f) => f.endsWith('.json')).sort()) {
    const path = join(recordsPath, name);
    let record;
    try { record = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new Failure(EXIT.INPUT, `기존 기록을 읽을 수 없음: ${path}`); }
    if (record.unscheduled === undefined) continue;
    if (!Array.isArray(record.unscheduled)) throw new Failure(EXIT.INPUT, `unscheduled 목록 형식 오류: ${path}`);
    for (const item of record.unscheduled) {
      if (!item || typeof item.title !== 'string' || !item.title.trim()) throw new Failure(EXIT.INPUT, `unscheduled 제목 누락: ${path}`);
      const title = item.title.trim();
      const status = item.status ?? '미배정';
      const note = item.note ?? item.reason ?? '';
      if (![title, status, note].every((v) => typeof v === 'string' && v.length <= 30000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))) throw new Failure(EXIT.INPUT, `unscheduled 내용 형식 오류: ${path}`);
      items.set(title, { title, status, note, source: path });
    }
  }
  return { status: 'ok', items: [...items.values()] };
}

export function readLocal(profile, week) {
  const local = workbook(profile, { action: 'read', week: week ? weekDays(assertDate(week))[0] : null });
  const legacy = legacyUnscheduled(profile);
  const byTitle = new Map(legacy.items.map((i) => [i.title, i]));
  for (const item of local.unscheduled) byTitle.set(item.title, item);
  return { ...local, unscheduled: [...byTitle.values()], legacyStatus: legacy.status, config: localConfig(profile) };
}

const validText = (text) => typeof text === 'string' && text.length > 0 && text.length <= 30000 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text);
function validateEntries(entries) {
  if (!Array.isArray(entries)) throw new Failure(EXIT.INPUT, '셀 항목은 배열이어야 함');
  const keys = new Set();
  for (const e of entries) {
    if (!e || Object.keys(e).some((k) => !['kind', 'text', 'strike', 'key'].includes(k)) || !['due', 'delayed', 'progress', 'fixed'].includes(e.kind) || !validText(e.text) || e.text.includes('\n') || typeof e.strike !== 'boolean' || !(e.key == null || /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(e.key))) throw new Failure(EXIT.INPUT, '주간 셀 항목 형식 오류');
    if (e.strike && (!['due', 'delayed'].includes(e.kind) || !e.text.startsWith('[완료'))) throw new Failure(EXIT.INPUT, '실제 완료된 완료 태그 줄에만 취소선을 적용한다');
    const key = e.key ?? e.text;
    if (keys.has(key)) throw new Failure(EXIT.INPUT, '같은 셀의 업무가 중복됨');
    keys.add(key);
  }
}
export function syncLocal(profile, input) {
  if (input.confirmed !== true) throw new Failure(EXIT.PRECONDITION, '사용자와 확정한 입력(confirmed:true)이 필요함');
  if (!Object.hasOwn(input, 'revision')) throw new Failure(EXIT.INPUT, 'local read 의 revision 이 필요함(새 파일은 null)');
  if (input.notation) {
    const n = input.notation;
    if (!n.week?.days || n.week.days.length !== 5 || JSON.stringify(weekDays(assertDate(n.week.days[0]))) !== JSON.stringify(n.week.days)) throw new Failure(EXIT.INPUT, '주간 날짜는 월~금이어야 함');
    if (!n.cells || Object.keys(n.cells).some((d) => !n.week.days.includes(d))) throw new Failure(EXIT.INPUT, '주간 셀 날짜 오류');
    for (const day of n.week.days) if (n.cells[day] !== null) validateEntries(n.cells[day]);
    validateEntries(n.next);
  }
  const cfg = localConfig(profile);
  const lock = cfg.workbookPath + '.lock';
  mkdirSync(dirname(lock), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = openSync(lock, 'wx', 0o600); }
  catch (e) { throw new Failure(EXIT.PRECONDITION, `로컬 로그 잠금 실패: ${e.message}`); }
  try {
    const { unscheduled: existing } = readLocal(profile);
    const items = new Map(existing.map(({ source, ...i }) => [i.title, i]));
    if (input.unscheduled !== undefined && !Array.isArray(input.unscheduled)) throw new Failure(EXIT.INPUT, 'unscheduled 는 배열이어야 함');
    for (const item of input.unscheduled ?? []) {
      if (!item || Object.keys(item).some((k) => !['title', 'status', 'note'].includes(k)) || !validText(item.title) || ['status', 'note'].some((k) => item[k] !== undefined && (typeof item[k] !== 'string' || item[k].length > 30000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item[k])))) throw new Failure(EXIT.INPUT, '미배정 업무는 title·status·note 만 허용한다');
      const title = item.title.trim();
      if (!title) throw new Failure(EXIT.INPUT, '미배정 제목은 비어 있으면 안 됨');
      items.set(title, { status: '미배정', note: '', ...items.get(title), ...item, title });
    }
    return workbook(profile, { action: 'sync', revision: input.revision, notation: input.notation, unscheduled: [...items.values()] });
  } finally { closeSync(fd); unlinkSync(lock); }
}

export function deliverLocal(profile, week, target = null) {
  const cfg = localConfig(profile);
  const monday = weekDays(assertDate(week))[0];
  const output = join(dirname(cfg.workbookPath), `weekly-delivery-${monday}.xlsx`);
  if (resolve(output) === resolve(cfg.workbookPath)) throw new Failure(EXIT.INPUT, '전달 파일은 로컬 원본과 달라야 함');
  const out = workbook(profile, { action: 'delivery', week: monday, output });
  const result = { ...out, stage: profile.sheet.delivery === 'paste' ? 'pending-user-paste' : `pending-${profile.sheet.delivery}`, targetUrl: profile.sheet.url, mode: profile.sheet.delivery };
  if (target) {
    const plan = cells({ ...target, notation: out.notation, profile: { ...profile.sheet, ticketBase: profile.jira.site ?? null } });
    if (plan.error) throw new Failure(EXIT.PRECONDITION, `Google 대상 위치 확인 실패: ${plan.error}`);
    return { ...result, ...plan, stage: Array.isArray(target.currentRuns) && plan.requests.length === 0 ? 'google-verified' : result.stage };
  }
  return result;
}
