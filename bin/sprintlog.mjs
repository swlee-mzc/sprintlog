#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { check } from '../src/core/schema.mjs';
import { createLogger, EXIT, Failure, readInput, recordRun } from '../src/core/runtime.mjs';
import { addDays, assertDate, todayKst, weekDays } from '../src/core/time.mjs';
import { DEFAULTS, getPath, loadProfile, parseValue, profilePath, saveProfile, setPath, sheetIdFromUrl } from '../src/profile.mjs';
import { resolve } from '../src/sprint.mjs';
import { schedule } from '../src/schedule.mjs';
import { facts } from '../src/facts.mjs';
import { notation } from '../src/notation.mjs';
import { cells, tabTitle } from '../src/cells.mjs';
import { classify } from '../src/close.mjs';
import { check as checkPlan } from '../src/check.mjs';
import { applyReady, listPlans, markApplied, savePlan } from '../src/plans.mjs';
import { isStale, loadSnapshot, saveSnapshot } from '../src/snapshot.mjs';
import { renderSprint, renderWeek } from '../src/render.mjs';
import { readLocal, syncLocal, deliverLocal } from '../src/local.mjs';
import { doctor } from '../src/doctor.mjs';
import { leakCheck, loadPatterns, patternsPath } from '../src/leak.mjs';

const HELP = `sprintlog — 스프린트 계획과 주간 현황 시트 동기화

사람용
  week [날짜] [--next]          주간 계획·현황 표
  sprint                        추적 스프린트 캘린더
  status                        스프린트·동기화·대기 계획 요약
  doctor                        전제 점검
  config get [키] | set <키> <값> | path | init --in <파일>
  leak-check [--repo <경로>]    추적 파일의 회사 문자열 검사(패턴은 레포 밖)

스킬용 (JSON 입출력)
  sprint resolve                스프린트 판정·예측
  plan draft                    LLM 계획 초안 검증 → 배치 입력
  schedule                      시작 날짜·기한 배치
  facts --from <날짜> --to <날짜> [Jira 응답 파일...]
  notation                      칸별 표기 판정
  sheet target [--week <날짜>]  대상 시트·탭·읽을 범위
  cells                         Sheets 요청·차이표
  check                         주중 계획 대비 점검(기한 초과·오늘 기한·검토 중 머지·부모 완료)
  close classify                스프린트 종료 판정표
  labels set                    LLM 기능명 검증 후 프로필 반영
  plan local save|list|apply-ready|mark-applied --sprint <이름> --keys <a,b>
  local read [--week <날짜>]    로컬 로그·미배정·기존 기록 조회
  local sync                    확정한 주간 로그·미배정 → 로컬 Excel
  local delivery --week <날짜>  주간 전용 전달 파일·Google 요청/검증
  snapshot save

공통 옵션: --in <파일>(없으면 표준 입력), --today <날짜>, --json, --md, --no-color
종료 코드: 0 정상, 1 조치 필요, 2 입력 오류, 3 전제 미충족`;

const OPTIONS = {
  in: { type: 'string' },
  today: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  week: { type: 'string' },
  next: { type: 'boolean' },
  json: { type: 'boolean' },
  md: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  repo: { type: 'string' },
  sprint: { type: 'string' },
  keys: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const today = (o) => (o.today ? assertDate(o.today) : todayKst());
const input = (o, schema) => {
  const value = readInput(o.in);
  try {
    return schema ? check(value, schema) : value;
  } catch (e) {
    throw new Failure(EXIT.INPUT, e.message);
  }
};

// 기계용 명령: 결과 JSON 은 표준 출력, 로그는 표준 오류, 실행 기록을 남긴다.
const machine = (name, fn) => async (o, rest, log) => {
  const ctx = { input: null };
  const { output, exit } = await fn(o, rest, log, ctx);
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  recordRun({ command: name, input: ctx.input, output, logLines: log.lines, exit });
  return exit;
};

const COMMANDS = {
  'sprint resolve': machine('sprint resolve', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = input(o, 'sprint-input');
    const out = resolve(p.sprint, { sprints: ctx.input.sprints, today: ctx.input.today ?? today(o) });
    log('resolve', out.status === 'ok' ? 'ok' : 'warn', { status: out.status, current: out.current?.name, next: out.next?.name, nextExists: out.next?.exists, mismatches: out.mismatches.length });
    return { output: out, exit: out.status === 'ok' ? EXIT.OK : EXIT.ACTION };
  }),

  'plan draft': machine('plan draft', (o, _, log, ctx) => {
    ctx.input = input(o, 'llm-plan-draft');
    const orders = ctx.input.map((d) => d.order);
    if (new Set(orders).size !== orders.length) throw new Failure(EXIT.INPUT, 'order 가 중복됨');
    const items = [...ctx.input].sort((a, b) => a.order - b.order).map(({ key, hours }) => ({ key, hours }));
    log('draft', 'ok', { items: items.length });
    return { output: { items }, exit: EXIT.OK };
  }),

  schedule: machine('schedule', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = input(o, 'schedule-input');
    const out = schedule({ hoursPerDay: p.capacity.hoursPerDay, maxHoursPerDay: p.capacity.maxHoursPerDay, holidays: p.holidays ?? [], ...ctx.input });
    for (const w of out.warnings) log('warning', 'warn', w);
    log('schedule', out.warnings.length ? 'warn' : 'ok', { items: out.planned.length, cap: out.cap });
    return { output: out, exit: out.warnings.length ? EXIT.ACTION : EXIT.OK };
  }),

  facts: machine('facts', (o, rest, log, ctx) => {
    const p = loadProfile();
    if (!o.from || !o.to) throw new Failure(EXIT.INPUT, '--from 과 --to 가 필요함');
    const responses = rest.length ? rest.map((f) => readInput(f)) : input(o).responses;
    if (!Array.isArray(responses)) throw new Failure(EXIT.INPUT, 'Jira 응답 파일 또는 {responses:[...]} 가 필요함');
    ctx.input = { from: o.from, to: o.to, files: rest };
    const out = facts({ me: p.jira.accountId, fields: p.jira.fields, from: assertDate(o.from), to: assertDate(o.to), holidays: p.holidays ?? [], responses });
    for (const w of out.warnings) log('warning', 'warn', w);
    for (const d of out.noEvidenceDays) log('evidence', 'warn', { date: d, reason: 'no-evidence' });
    log('facts', out.warnings.length || out.noEvidenceDays.length ? 'warn' : 'ok', { subtasks: out.subtasks.length, events: out.events.length });
    return { output: out, exit: out.warnings.length || out.noEvidenceDays.length ? EXIT.ACTION : EXIT.OK };
  }),

  notation: machine('notation', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = input(o, 'notation-input');
    const out = notation({ labels: p.labels ?? {}, fixedLines: p.fixedLines ?? [], holidays: p.holidays ?? [], countScopes: p.countScopes ?? {}, ...ctx.input });
    for (const m of out.missingLabels) log('label', 'warn', { key: m.key, reason: 'missing-label' });
    for (const k of out.unscheduled) log('schedule', 'warn', { key: k, reason: 'unscheduled' });
    log('notation', out.missingLabels.length || out.unscheduled.length ? 'warn' : 'ok', { features: out.features.length });
    return { output: out, exit: out.missingLabels.length || out.unscheduled.length ? EXIT.ACTION : EXIT.OK };
  }),

  'sheet target': machine('sheet target', (o, _, log, ctx) => {
    const p = loadProfile();
    const week = o.week ? assertDate(o.week) : today(o);
    ctx.input = { week };
    const s = p.sheet;
    const url = s.format === 'xlsx' ? s.workUrl : s.url;
    if (!url) throw new Failure(EXIT.PRECONDITION, 'xlsx 대상은 sheet.workUrl(Google Sheets 작업본)이 필요함');
    const tab = tabTitle(s.tabPattern, week);
    const q = `'${tab.replace(/'/g, "''")}'`;
    const out = {
      spreadsheetId: sheetIdFromUrl(url),
      targetUrl: s.url,
      delivery: s.delivery,
      format: s.format,
      tab,
      week: weekDays(week),
      ranges: { header: `${q}!A${s.headerRow}:Z${s.headerRow}`, names: `${q}!${s.nameColumn}1:${s.nameColumn}300` },
    };
    log('target', 'ok', { tab, delivery: s.delivery });
    return { output: out, exit: EXIT.OK };
  }),

  cells: machine('cells', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = input(o, 'cells-input');
    const out = cells({ ...ctx.input, profile: { nextHeader: DEFAULTS.nextHeader, bullet: DEFAULTS.bullet, ...p.sheet, ticketBase: p.jira.site ?? null } });
    if (out.error) {
      log('locate', 'fail', { error: out.error });
      return { output: out, exit: EXIT.ACTION };
    }
    for (const c of out.cells.filter((c) => c.changed)) log('diff', 'ok', { cell: c.a1, key: c.key });
    log('cells', 'ok', { row: out.row, changed: out.requests.length });
    return { output: out, exit: EXIT.OK };
  }),

  check: machine('check', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = input(o, 'check-input');
    const out = checkPlan({ reviewStatuses: p.jira.reviewStatuses ?? DEFAULTS.reviewStatuses, ...ctx.input });
    for (const a of out.actions) log('check', a.action === 'check-pr' ? 'warn' : 'ok', { key: a.key, action: a.action, reason: a.reason });
    log('check', out.actions.length ? 'warn' : 'ok', { actions: out.actions.length });
    return { output: out, exit: out.actions.length ? EXIT.ACTION : EXIT.OK };
  }),

  'close classify': machine('close classify', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = input(o, 'close-input');
    const out = classify({ reviewStatuses: p.jira.reviewStatuses ?? DEFAULTS.reviewStatuses, ...ctx.input });
    for (const a of out.actions) log('classify', a.action === 'undetermined' ? 'warn' : 'ok', { key: a.key, action: a.action, reason: a.reason, redate: a.redate });
    const undetermined = out.summary.undetermined ?? 0;
    return { output: out, exit: undetermined ? EXIT.ACTION : EXIT.OK };
  }),

  'labels set': machine('labels set', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = input(o, 'llm-labels');
    p.labels = { ...(p.labels ?? {}), ...Object.fromEntries(ctx.input.map((l) => [l.key, l.label])) };
    saveProfile(p);
    log('labels', 'ok', { updated: ctx.input.length });
    return { output: { labels: p.labels }, exit: EXIT.OK };
  }),

  'plan local save': machine('plan local save', (o, _, log, ctx) => {
    ctx.input = input(o);
    let out;
    try {
      out = savePlan(ctx.input);
    } catch (e) {
      throw new Failure(EXIT.INPUT, e.message);
    }
    log('save', 'ok', { sprint: out.sprint.name, items: out.items.length });
    return { output: out, exit: EXIT.OK };
  }),
  'plan local list': machine('plan local list', (o, _, log) => {
    const out = listPlans();
    log('list', 'ok', { plans: out.length });
    return { output: out, exit: EXIT.OK };
  }),
  'plan local apply-ready': machine('plan local apply-ready', (o, _, log, ctx) => {
    ctx.input = input(o, 'sprint-input');
    const out = applyReady(ctx.input.sprints);
    for (const p of out) log('ready', 'ok', { sprint: p.sprint.name, items: p.items.length });
    return { output: out, exit: EXIT.OK };
  }),
  'plan local mark-applied': machine('plan local mark-applied', (o, _, log, ctx) => {
    if (!o.sprint || !o.keys) throw new Failure(EXIT.INPUT, '--sprint 와 --keys 가 필요함');
    ctx.input = { sprint: o.sprint, keys: o.keys };
    const out = markApplied(o.sprint, o.keys.split(',').map((k) => k.trim()).filter(Boolean));
    log('applied', 'ok', { sprint: o.sprint, applied: out.applied.length });
    return { output: out, exit: EXIT.OK };
  }),

  'local read': machine('local read', (o, _, log) => {
    const out = readLocal(loadProfile(), o.week);
    log('read', out.status === 'ok' ? 'ok' : 'warn', { status: out.status, unscheduled: out.unscheduled.length });
    return { output: out, exit: out.status === 'ok' ? EXIT.OK : EXIT.ACTION };
  }),
  'local sync': machine('local sync', (o, _, log, ctx) => {
    ctx.input = input(o);
    const out = syncLocal(loadProfile(), ctx.input);
    log('sync', 'ok', { weeks: out.weeks.length, unscheduled: out.unscheduled.length });
    return { output: out, exit: EXIT.OK };
  }),
  'local delivery': machine('local delivery', (o, _, log, ctx) => {
    if (!o.week) throw new Failure(EXIT.INPUT, '--week 가 필요함');
    ctx.input = o.in ? input(o, 'cells-input') : null;
    const out = deliverLocal(loadProfile(), o.week, ctx.input);
    log('delivery', out.stage === 'google-verified' ? 'ok' : 'warn', { stage: out.stage });
    return { output: out, exit: out.stage === 'google-verified' ? EXIT.OK : EXIT.ACTION };
  }),

  'snapshot save': machine('snapshot save', (o, _, log, ctx) => {
    const p = loadProfile();
    ctx.input = readInput(o.in);
    const out = saveSnapshot({ fixedLines: p.fixedLines ?? [], holidays: p.holidays ?? [], capacity: p.capacity, ...ctx.input });
    log('snapshot', 'ok', { features: out.features.length });
    return { output: { syncedAt: out.syncedAt, features: out.features.length }, exit: EXIT.OK };
  }),

  week: async (o, rest, log) => view(o, rest, log, 'week'),
  sprint: async (o, rest, log) => view(o, rest, log, 'sprint'),

  status: async (o, _, log) => {
    const snap = loadSnapshot();
    const plans = listPlans();
    const out = {
      sprint: snap?.sprint ?? null,
      syncedAt: snap?.syncedAt ?? null,
      stale: snap ? isStale(snap) : null,
      pendingPlans: plans.filter((p) => p.items.some((i) => !p.applied.includes(i.key))).map((p) => p.sprint.name),
    };
    if (o.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    else {
      process.stdout.write(`스프린트  ${out.sprint ? `${out.sprint.name} ${out.sprint.start} ~ ${out.sprint.end}` : '정보 없음'}\n`);
      process.stdout.write(`동기화    ${out.syncedAt ?? '없음'}${out.stale ? '  (동기화 필요)' : ''}\n`);
      process.stdout.write(`대기 계획 ${out.pendingPlans.join(', ') || '없음'}\n`);
    }
    log('status', out.stale || out.pendingPlans.length ? 'warn' : 'ok', { stale: out.stale, pending: out.pendingPlans.length });
    return out.stale || out.pendingPlans.length || !snap ? EXIT.ACTION : EXIT.OK;
  },

  doctor: async (o, _, log) => {
    const out = doctor();
    if (o.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    else for (const c of out.checks) process.stdout.write(`${c.status.padEnd(4)}  ${c.name.padEnd(16)}  ${c.detail}\n`);
    for (const c of out.checks) log('check', c.status, { name: c.name });
    if (out.checks.some((c) => c.status === 'fail')) return EXIT.PRECONDITION;
    return out.checks.some((c) => c.status === 'warn') ? EXIT.ACTION : EXIT.OK;
  },

  config: async (o, rest, log) => {
    const [sub, key, value] = rest;
    if (sub === 'path') {
      process.stdout.write(profilePath() + '\n');
      return EXIT.OK;
    }
    if (sub === 'init') {
      const profile = readInput(o.in);
      try {
        saveProfile(profile);
      } catch (e) {
        throw new Failure(EXIT.INPUT, e.message);
      }
      log('init', 'ok', { path: profilePath() });
      return EXIT.OK;
    }
    const profile = loadProfile();
    if (sub === 'get') {
      const v = key ? getPath(profile, key) : profile;
      process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v, null, 2)) + '\n');
      return v === undefined ? EXIT.INPUT : EXIT.OK;
    }
    if (sub === 'set' && key && value !== undefined) {
      if (key === 'sheet.url' || key === 'sheet.workUrl') sheetIdFromUrl(value);
      try {
        saveProfile(setPath(profile, key, parseValue(value)));
      } catch (e) {
        throw new Failure(EXIT.INPUT, e.message);
      }
      log('set', 'ok', { key });
      return EXIT.OK;
    }
    throw new Failure(EXIT.INPUT, 'config get [키] | set <키> <값> | path | init --in <파일>');
  },

  'leak-check': async (o, _, log) => {
    const patterns = loadPatterns();
    if (!patterns) throw new Failure(EXIT.PRECONDITION, `패턴 파일 없음: ${patternsPath()}`);
    const out = leakCheck({ repo: o.repo ?? process.cwd(), patterns });
    for (const h of out.hits) log('hit', 'fail', h);
    log('leak-check', out.hits.length ? 'fail' : 'ok', { files: out.files, hits: out.hits.length });
    if (o.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return out.hits.length ? EXIT.ACTION : EXIT.OK;
  },
};

function view(o, rest, log, kind) {
  const snap = loadSnapshot();
  if (!snap) throw new Failure(EXIT.PRECONDITION, '스냅샷 없음 — 스킬 plan·sync 를 한 번 실행한다');
  const base = rest[0] ? assertDate(rest[0]) : today(o);
  const week = o.next ? addDays(base, 7) : base;
  const stale = isStale(snap);
  if (o.json) process.stdout.write(JSON.stringify(snap, null, 2) + '\n');
  else {
    const opts = { week, today: today(o), stale, format: o.md ? 'md' : 'tty', color: !o.md && !o['no-color'] && !process.env.NO_COLOR && process.stdout.isTTY };
    process.stdout.write((kind === 'sprint' ? renderSprint(snap, opts) : renderWeek(snap, opts)) + '\n');
  }
  log(kind, stale ? 'warn' : 'ok', { week: weekDays(week)[0], stale });
  return stale ? EXIT.ACTION : EXIT.OK;
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return EXIT.INPUT;
  }
  const { values: o, positionals: pos } = parsed;
  if (o.help || !pos.length || pos[0] === 'help') {
    process.stdout.write(HELP + '\n');
    return EXIT.OK;
  }
  const name = [3, 2, 1].map((n) => pos.slice(0, n).join(' ')).find((k) => COMMANDS[k]);
  if (!name) {
    process.stderr.write(`알 수 없는 명령: ${pos.join(' ')}\n\n${HELP}\n`);
    return EXIT.INPUT;
  }
  const log = createLogger(name);
  try {
    return await COMMANDS[name](o, pos.slice(name.split(' ').length), log);
  } catch (e) {
    log('error', 'fail', { message: e.message });
    return e instanceof Failure ? e.exit : EXIT.INPUT;
  }
}

process.exitCode = await main(process.argv.slice(2));
