import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { loadProfile, profilePath } from './profile.mjs';
import { isStale, loadSnapshot } from './snapshot.mjs';
import { readLocal } from './local.mjs';
import { listPlans } from './plans.mjs';

const onPath = (bin) => (process.env.PATH ?? '').split(delimiter).some((d) => d && existsSync(join(d, bin)));

export function doctor() {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 24 ? 'ok' : 'fail', `v${process.versions.node}`);

  let profile = null;
  try {
    profile = loadProfile();
    const mode = statSync(profilePath()).mode & 0o777;
    add('profile', mode === 0o600 ? 'ok' : 'warn', mode === 0o600 ? profilePath() : `권한 ${mode.toString(8)} — 600 이어야 함`);
  } catch (e) {
    add('profile', 'fail', e.message);
  }

  if (profile?.workflow?.configPath) {
    add('workflow-config', existsSync(profile.workflow.configPath) ? 'ok' : 'warn', profile.workflow.configPath);
  }
  if (profile) {
    try {
      const local = readLocal(profile);
      add('local-log', local.status === 'ok' ? 'ok' : 'warn', `${local.config.workbookPath} — ${local.status}; unscheduled ${local.unscheduled.length}; ${local.legacyStatus}`);
    } catch (e) { add('local-log', 'warn', e.message); }
  }
  if (profile?.sheet?.format === 'xlsx' && !profile.sheet.workUrl) add('sheet-work-copy', 'warn', 'Google 2단계 자동 전달 시 sheet.workUrl(작업본)을 확인한다. 로컬 동기화는 가능함');

  const snap = loadSnapshot();
  if (!snap) add('snapshot', 'warn', '스냅샷 없음 — plan·sync 를 한 번 실행한다');
  else add('snapshot', isStale(snap) ? 'warn' : 'ok', `syncedAt ${snap.syncedAt}`);

  const pending = listPlans().filter((p) => p.items.some((i) => !p.applied.includes(i.key)));
  add('local-plans', pending.length ? 'warn' : 'ok', pending.length ? `반영 대기: ${pending.map((p) => p.sprint.name).join(', ')}` : '없음');

  add('cli-on-path', onPath('sprintlog') ? 'ok' : 'skip', onPath('sprintlog') ? 'sprintlog' : '설치 안 됨(선택) — 플러그인 폴더에서 pnpm link --global');
  return { checks };
}
