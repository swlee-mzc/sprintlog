import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir } from './core/runtime.mjs';
import { check } from './core/schema.mjs';

export const snapshotPath = () => join(cacheDir(), 'snapshot.json');

export function saveSnapshot(snapshot, now = new Date()) {
  const value = check({ ...snapshot, syncedAt: snapshot.syncedAt ?? now.toISOString() }, 'snapshot');
  mkdirSync(cacheDir(), { recursive: true, mode: 0o700 });
  writeFileSync(snapshotPath(), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  return value;
}

export function loadSnapshot() {
  if (!existsSync(snapshotPath())) return null;
  return check(JSON.parse(readFileSync(snapshotPath(), 'utf8')), 'snapshot');
}

export const isStale = (snapshot, now = new Date()) => now.getTime() - Date.parse(snapshot.syncedAt) > 24 * 3600 * 1000;
