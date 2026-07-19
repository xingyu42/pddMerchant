import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createLogger,
  formatLocalDateKey,
  resolveDatedLogPath,
  resolveDefaultLogDirectory,
  DailyRotatingFileDestination,
} from '../src/infra/logger.js';
import {
  LOG_DIR,
  CLI_LOG_DIR,
  DAEMON_LOG_DIR,
  PROJECT_ROOT,
  DATA_DIR,
} from '../src/infra/paths.js';

const tempRoots = [];

async function makeTempDir() {
  const root = await mkdtemp(join(tmpdir(), 'pdd-logger-dest-'));
  tempRoots.push(root);
  return root;
}

function flushLogger(logger) {
  const stream = logger[Symbol.for('pino')]?.stream
    ?? logger.stream;
  if (stream && typeof stream.flushSync === 'function') {
    try {
      stream.flushSync();
    } catch {
      /* sonic-boom may not be ready yet */
    }
  }
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    await rm(root, { recursive: true, force: true });
  }
});

describe('paths log defaults', () => {
  it('exports dedicated CLI/daemon log directories under log/', () => {
    assert.equal(LOG_DIR, join(PROJECT_ROOT, 'log'));
    assert.equal(CLI_LOG_DIR, join(LOG_DIR, 'cli'));
    assert.equal(DAEMON_LOG_DIR, join(LOG_DIR, 'daemon'));
    assert.ok(!CLI_LOG_DIR.startsWith(DATA_DIR));
    assert.ok(!DAEMON_LOG_DIR.startsWith(DATA_DIR));
  });
});

describe('resolveDatedLogPath / formatLocalDateKey', () => {
  it('formats local calendar date as YYYY-MM-DD', () => {
    const date = new Date(2026, 6, 20, 15, 30, 0);
    assert.equal(formatLocalDateKey(date), '2026-07-20');
  });

  it('places dated files inside the channel directory', () => {
    const date = new Date(2026, 6, 20);
    assert.equal(
      resolveDatedLogPath(join(PROJECT_ROOT, 'log', 'cli'), date),
      join(PROJECT_ROOT, 'log', 'cli', '2026-07-20.log'),
    );
    assert.equal(
      resolveDatedLogPath(join(PROJECT_ROOT, 'log', 'daemon'), date),
      join(PROJECT_ROOT, 'log', 'daemon', '2026-07-20.log'),
    );
  });

  it('supports optional basename prefix', () => {
    const date = new Date(2026, 0, 5);
    const dir = join(tmpdir(), 'custom-log-dir');
    assert.equal(
      resolveDatedLogPath(dir, date, 'app'),
      join(dir, 'app-2026-01-05.log'),
    );
  });
});

describe('DailyRotatingFileDestination', () => {
  it('creates the channel directory and writes YYYY-MM-DD.log', async () => {
    const root = await makeTempDir();
    const logDir = join(root, 'cli');
    const fixedDate = new Date(2026, 6, 20, 10, 0, 0);
    const dest = new DailyRotatingFileDestination(logDir, { now: () => fixedDate });
    dest.write(Buffer.from('hello-day-1\n'));
    dest.flushSync();
    dest.end();

    const expected = join(logDir, '2026-07-20.log');
    assert.equal(existsSync(expected), true);
    const body = await readFile(expected, 'utf8');
    assert.ok(body.includes('hello-day-1'));
  });

  it('rotates to a new file when local date changes', async () => {
    const root = await makeTempDir();
    const logDir = join(root, 'daemon');
    let current = new Date(2026, 6, 20, 23, 59, 0);
    const dest = new DailyRotatingFileDestination(logDir, { now: () => current });

    dest.write(Buffer.from('day-a\n'));
    dest.flushSync();
    current = new Date(2026, 6, 21, 0, 1, 0);
    dest.write(Buffer.from('day-b\n'));
    dest.flushSync();
    dest.end();

    const fileA = join(logDir, '2026-07-20.log');
    const fileB = join(logDir, '2026-07-21.log');
    assert.equal(existsSync(fileA), true);
    assert.equal(existsSync(fileB), true);
    assert.ok((await readFile(fileA, 'utf8')).includes('day-a'));
    assert.ok((await readFile(fileB, 'utf8')).includes('day-b'));
  });
});

describe('createLogger destination policy', () => {
  it('resolves CLI, daemon, foreground, and bootstrap defaults', () => {
    const config = { logLevel: 'info' };
    assert.equal(resolveDefaultLogDirectory({ config }), CLI_LOG_DIR);
    assert.equal(resolveDefaultLogDirectory({ config, channel: 'daemon' }), DAEMON_LOG_DIR);
    assert.equal(resolveDefaultLogDirectory({ config, channel: 'foreground' }), null);
    assert.equal(resolveDefaultLogDirectory(), null);
  });

  it('uses stream object destination without creating log files', async () => {
    const root = await makeTempDir();
    const chunks = [];
    const destination = {
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
    };
    const logger = createLogger({
      level: 'info',
      destination,
      config: { logLevel: 'info' },
    });
    logger.info({ probe: true }, 'stream-dest');
    assert.ok(chunks.some((line) => line.includes('stream-dest')));
    assert.equal(existsSync(join(root, '2026-07-20.log')), false);
  });

  it('writes under an explicit log directory when destination is a string dir', async () => {
    const root = await makeTempDir();
    const logDir = join(root, 'cli');
    const fixedDate = new Date(2026, 6, 20, 12, 0, 0);
    const logger = createLogger({
      level: 'info',
      destination: logDir,
      now: () => fixedDate,
    });
    logger.info({ ok: true }, 'cli-default-line');
    flushLogger(logger);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const expected = join(logDir, '2026-07-20.log');
    assert.equal(existsSync(expected), true, `expected ${expected}`);
    const body = await readFile(expected, 'utf8');
    assert.ok(body.includes('cli-default-line'));
  });

  it('does not force file destination when config is absent (bootstrap/silent)', async () => {
    const root = await makeTempDir();
    const chunks = [];
    const destination = {
      write(chunk) {
        chunks.push(String(chunk));
        return true;
      },
    };
    const logger = createLogger({ level: 'info', destination });
    logger.info('bootstrap-ok');
    assert.ok(chunks.some((line) => line.includes('bootstrap-ok')));
    assert.equal(existsSync(join(root, 'pdd.log')), false);
  });
});
