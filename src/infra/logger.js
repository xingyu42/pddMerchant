import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { CLI_LOG_DIR } from './paths.js';

const REDACT_KEYS = [
  'cookies',
  'cookie',
  'Cookie',
  'auth_token',
  'authToken',
  'LoginToken',
  'login_token',
  'loginToken',
  'PASS_ID',
  'pass_id_value',
  'ck',
  'cookie_headers',
  'cookieHeaders',
  'session_id',
  'sessionId',
  'localStorage',
  'Anti-Content',
  'anti-content',
  'anti_content',
  'antiContent',
  'crawlerInfo',
  'crawler_info',
  'set-cookie',
  'setCookie',
  'authorization',
  'Authorization',
  'goods_image',
  'phone',
  'addr',
  'receiver_name',
  'receiver_phone',
  'receiverPhone',
  'receiver_address',
  'receiverAddress',
  'password',
  'credential',
  'credentials',
  'mobile',
  'masterPassword',
  'ciphertext',
  'qrContent',
  'qr_content',
  'auth_path',
  'authStatePath',
];

const REDACT_KEY_SET = new Set(REDACT_KEYS);

// 指纹序列化必须不可抛：敏感值可能含环（→'[Circular]'）或 bigint（→string）。
// 访问集语义：共享引用二次出现记 '[Circular]'——指纹只用于关联比对，无需保真展开。
function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (v != null && typeof v === 'object') {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  }) ?? 'null';
}

function fingerprint(value) {
  if (value == null) return value;
  let str;
  if (typeof value === 'string') {
    str = value;
  } else {
    try {
      str = safeStringify(value);
    } catch {
      str = String(value);
    }
  }
  return 'fp:' + createHash('sha256').update(str).digest('hex').slice(0, 8);
}

function redactKey(v) {
  if (typeof v === 'string' && v.startsWith('fp:')) return v;
  return fingerprint(v);
}

function redactRecursive(value, seen) {
  if (value == null || typeof value !== 'object') return value;
  if (!seen) seen = new WeakSet();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Map) {
    const out = new Map();
    for (const [k, v] of value) {
      out.set(k, REDACT_KEY_SET.has(k) ? redactKey(v) : redactRecursive(v, seen));
    }
    return out;
  }

  if (value instanceof Set) {
    const out = new Set();
    for (const v of value) out.add(redactRecursive(v, seen));
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactRecursive(v, seen));
  }

  if (value instanceof Error) {
    const out = { message: value.message, stack: value.stack };
    for (const k of Object.keys(value)) {
      out[k] = REDACT_KEY_SET.has(k) ? redactKey(value[k]) : redactRecursive(value[k], seen);
    }
    return out;
  }

  const out = {};
  for (const k of Object.keys(value)) {
    out[k] = REDACT_KEY_SET.has(k) ? redactKey(value[k]) : redactRecursive(value[k], seen);
  }
  return out;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** Local calendar date key YYYY-MM-DD (not UTC). */
export function formatLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Resolve a dated log file under a dedicated directory:
 *   resolveDatedLogPath(log/cli, date) -> log/cli/2026-07-20.log
 * Optional basename: resolveDatedLogPath(dir, date, 'pdd') -> dir/pdd-2026-07-20.log
 * When basename is omitted/null, file is simply YYYY-MM-DD.log inside the directory.
 */
export function resolveDatedLogPath(logDirectory, date = new Date(), basename = null) {
  const dateKey = formatLocalDateKey(date);
  const fileName = basename
    ? `${basename}-${dateKey}.log`
    : `${dateKey}.log`;
  return join(logDirectory, fileName);
}

function closeStreamBestEffort(stream) {
  if (!stream) return;
  try {
    if (typeof stream.end === 'function') stream.end();
  } catch {
    /* best effort */
  }
  try {
    if (typeof stream.destroy === 'function') stream.destroy();
  } catch {
    /* best effort */
  }
}

/**
 * pino-compatible destination that writes under a dedicated log directory
 * as YYYY-MM-DD.log and switches on local calendar day change without restart.
 */
export class DailyRotatingFileDestination {
  constructor(logDirectory, { now = () => new Date(), basename = null } = {}) {
    this.logDirectory = logDirectory;
    this.basename = basename;
    this.now = now;
    this.dayKey = null;
    this.currentPath = null;
    this.stream = null;
  }

  #ensureStream() {
    const dayKey = formatLocalDateKey(this.now());
    if (this.stream && this.dayKey === dayKey) return this.stream;

    const previous = this.stream;
    const datedPath = resolveDatedLogPath(this.logDirectory, this.now(), this.basename);
    mkdirSync(this.logDirectory, { recursive: true });
    // sync:true keeps short CLI writes durable without relying on process exit flush.
    this.stream = pino.destination({ dest: datedPath, sync: true });
    this.dayKey = dayKey;
    this.currentPath = datedPath;
    closeStreamBestEffort(previous);
    return this.stream;
  }

  write(chunk) {
    return this.#ensureStream().write(chunk);
  }

  flushSync() {
    const stream = this.stream ?? this.#ensureStream();
    if (typeof stream.flushSync !== 'function') return;
    try {
      stream.flushSync();
    } catch (err) {
      // sonic-boom may throw "not ready yet" during open; next write still persists with sync:true
      if (!String(err?.message || err).includes('not ready yet')) throw err;
    }
  }

  end() {
    closeStreamBestEffort(this.stream);
    this.stream = null;
    this.dayKey = null;
  }

  destroy() {
    this.end();
  }
}

function isWritableDestination(value) {
  return value != null
    && typeof value === 'object'
    && typeof value.write === 'function';
}

function buildFileDestination(logDirectory, { now, basename = null } = {}) {
  return new DailyRotatingFileDestination(logDirectory, { now, basename });
}

export function resolveDefaultLogDirectory({ config, channel } = {}) {
  if (channel === 'foreground') return null;
  if (config) return CLI_LOG_DIR;
  return null;
}

/**
 * destination selection:
 * - writable stream/object (tests): use as-is
 * - string path treated as log *directory* (internal/test only)
 * - channel 'foreground': stderr
 * - config present (CLI): log/cli/
 * - no config: stderr (bootstrap/silent)
 * logDestination / PDD_LOG_DESTINATION is intentionally unsupported.
 */
function buildDestination({ destination, config, now, channel } = {}) {
  if (isWritableDestination(destination)) {
    return destination;
  }
  if (typeof destination === 'string' && destination.length > 0) {
    return buildFileDestination(destination, { now });
  }
  const logDirectory = resolveDefaultLogDirectory({ config, channel });
  if (logDirectory) return buildFileDestination(logDirectory, { now });
  return pino.destination({ dest: process.stderr.fd, sync: false });
}

let currentLogger = null;

export function createLogger({ verbose = false, level, destination, config, now, channel } = {}) {
  const resolvedLevel = level ?? (verbose ? 'debug' : undefined);
  const opts = {
    ...(resolvedLevel ? { level: resolvedLevel } : {}),
    serializers: {
      err: (err) => redactRecursive(err),
    },
    formatters: {
      log(obj) {
        return redactRecursive(obj);
      },
    },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  const dest = buildDestination({ destination, config, now, channel });
  const logger = pino(opts, dest);

  logger.withOp = function withOp(ctx) {
    const bindings = {};
    if (ctx.command) bindings.command = ctx.command;
    if (ctx.endpoint) bindings.endpoint = ctx.endpoint;
    if (ctx.correlation_id) bindings.correlation_id = ctx.correlation_id;
    if (ctx.mall_id != null) {
      bindings.mall_id_hash = fingerprint(String(ctx.mall_id));
    } else {
      bindings.mall_id_hash = null;
    }
    const child = logger.child(bindings);
    child.withOp = logger.withOp;
    return child;
  };

  currentLogger = logger;
  return logger;
}

export function getLogger() {
  if (!currentLogger) currentLogger = createLogger({ level: 'silent' });
  return currentLogger;
}

export function redactValue(value) {
  return fingerprint(value);
}

export { REDACT_KEYS, REDACT_KEY_SET, redactRecursive };
