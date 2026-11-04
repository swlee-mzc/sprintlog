import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check } from './core/schema.mjs';
import { configDir, EXIT, Failure } from './core/runtime.mjs';

export const DEFAULTS = {
  reviewStatuses: ['Review', 'In Review'],
  nextHeader: '차주 계획',
  bullet: '- ',
};

export const profilePath = () => join(configDir(), 'profile.json');

export function sheetIdFromUrl(url) {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url ?? '');
  if (!m) throw new Failure(EXIT.INPUT, `시트 URL 에서 ID 를 찾을 수 없음: ${url}`);
  return m[1];
}

export function loadProfile({ required = true } = {}) {
  const path = profilePath();
  if (!existsSync(path)) {
    if (!required) return null;
    throw new Failure(EXIT.PRECONDITION, `프로필이 없음: ${path} — sprintlog:setup 으로 만든다`);
  }
  let profile;
  try {
    profile = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Failure(EXIT.PRECONDITION, `프로필이 JSON 이 아님: ${path}`);
  }
  try {
    check(profile, 'profile');
  } catch (e) {
    throw new Failure(EXIT.PRECONDITION, e.message);
  }
  return profile;
}

export function saveProfile(profile) {
  check(profile, 'profile');
  const path = profilePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(profile, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys.at(-1)] = value;
  return obj;
}

export const parseValue = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};
