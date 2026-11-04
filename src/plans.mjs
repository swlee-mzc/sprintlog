import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './core/runtime.mjs';
import { check } from './core/schema.mjs';

const plansDir = () => join(configDir(), 'plans');
const fileOf = (name) => join(plansDir(), `${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.json`);

export function listPlans() {
  if (!existsSync(plansDir())) return [];
  return readdirSync(plansDir())
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => check(JSON.parse(readFileSync(join(plansDir(), f), 'utf8')), 'plan'));
}

const write = (plan) => {
  mkdirSync(plansDir(), { recursive: true, mode: 0o700 });
  writeFileSync(fileOf(plan.sprint.name), JSON.stringify(check(plan, 'plan'), null, 2) + '\n', { mode: 0o600 });
  return plan;
};

// sprint 에는 sprint resolve 의 next 를 그대로 넣어도 된다 — 저장에 필요한 키만 남긴다.
// 같은 스프린트의 기존 계획과 키 단위로 합친다(새 값이 이긴다).
export function savePlan(plan) {
  const { n = null, name, start, end, id = null } = plan.sprint ?? {};
  const sprint = { n, name, start, end, id };
  const prev = listPlans().find((p) => p.sprint.name === name);
  const items = new Map((prev?.items ?? []).map((i) => [i.key, i]));
  for (const { key, startDate, dueDate, hours } of plan.items ?? []) items.set(key, { key, startDate, dueDate, hours });
  return write({ sprint, items: [...items.values()].sort((a, b) => a.key.localeCompare(b.key)), applied: prev?.applied ?? [] });
}

// Jira 에 스프린트가 생긴 로컬 계획과 아직 반영하지 않은 항목.
export function applyReady(sprints) {
  const byName = new Map(sprints.map((s) => [s.name, s]));
  return listPlans()
    .filter((p) => byName.has(p.sprint.name))
    .map((p) => ({ sprint: { ...p.sprint, id: byName.get(p.sprint.name).id }, items: p.items.filter((i) => !p.applied.includes(i.key)) }))
    .filter((p) => p.items.length);
}

export function markApplied(name, keys) {
  const plan = listPlans().find((p) => p.sprint.name === name);
  if (!plan) throw new Error(`로컬 계획 없음: ${name}`);
  return write({ ...plan, applied: [...new Set([...plan.applied, ...keys])].sort() });
}
