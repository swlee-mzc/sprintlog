import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './core/runtime.mjs';

export const patternsPath = () => join(configDir(), 'leak-patterns.txt');

export function loadPatterns(path = patternsPath()) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((src) => new RegExp(src, 'i'));
}

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).split('\n').filter(Boolean);

// 추적·스테이징·추적 예정(무시되지 않은 새 파일) 파일을 검사한다. 일치한 문자열은 출력하지 않는다.
export function leakCheck({ repo, patterns }) {
  const files = [...new Set([...git(repo, ['ls-files']), ...git(repo, ['diff', '--cached', '--name-only']), ...git(repo, ['ls-files', '--others', '--exclude-standard'])])].sort();
  const hits = [];
  for (const file of files) {
    const path = join(repo, file);
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    if (buf.includes(0)) continue;
    buf.toString('utf8').split('\n').forEach((text, i) => {
      patterns.forEach((re, p) => re.test(text) && hits.push({ file, line: i + 1, pattern: p + 1 }));
    });
  }
  return { files: files.length, hits };
}
