import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const EXIT = { OK: 0, ACTION: 1, INPUT: 2, PRECONDITION: 3 };

export const configDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'sprintlog');
export const cacheDir = () => join(process.env.SPRINTLOG_CACHE_DIR || join(homedir(), '.cache', 'sprintlog'));

export class Failure extends Error {
  constructor(exit, message) {
    super(message);
    this.exit = exit;
  }
}

const fmt = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /[\s"=]/.test(s) ? JSON.stringify(s) : s;
};

// 로그 한 줄 형식: sprintlog <명령> <단계> <ok|warn|fail|skip> key=value ...
export function createLogger(command, sink = (line) => process.stderr.write(`${line}\n`)) {
  const lines = [];
  const log = (step, status, fields = {}) => {
    if (!['ok', 'warn', 'fail', 'skip'].includes(status)) throw new Error(`로그 상태 오류: ${status}`);
    const kv = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${fmt(v)}`);
    const line = ['sprintlog', command, step, status, ...kv].join(' ');
    lines.push(line);
    sink(line);
  };
  log.lines = lines;
  return log;
}

export function readInput(path) {
  const text = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Failure(EXIT.INPUT, `입력이 JSON 이 아님${path ? `: ${path}` : ''}`);
  }
}

export function recordRun({ command, input, output, logLines, exit }) {
  if (process.env.SPRINTLOG_NO_RUNS === '1') return null;
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const dir = join(cacheDir(), 'runs', id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const inputText = JSON.stringify(input ?? null);
  writeFileSync(join(dir, 'input.json'), inputText);
  writeFileSync(join(dir, 'output.json'), JSON.stringify(output ?? null, null, 2));
  writeFileSync(join(dir, 'log.txt'), logLines.join('\n') + '\n');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ id, command, at: new Date().toISOString(), inputSha256: createHash('sha256').update(inputText).digest('hex'), exit }, null, 2),
  );
  return id;
}
