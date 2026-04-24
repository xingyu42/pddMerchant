import { createHash } from 'node:crypto';
import pino from 'pino';

const REDACT_KEYS = [
  'cookies',
  'cookie',
  'auth_token',
  'authToken',
  'session_id',
  'sessionId',
  'localStorage',
  'Anti-Content',
  'anti-content',
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
];

const REDACT_KEY_SET = new Set(REDACT_KEYS);

function fingerprint(value) {
  if (value == null) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
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

function buildDestination(config) {
  if (config?.logDestination) {
    return pino.destination({ dest: config.logDestination, sync: false });
  }
  return pino.destination({ dest: process.stderr.fd, sync: false });
}

let currentLogger = null;

export function createLogger({ verbose = false, level, destination, config } = {}) {
  const resolvedLevel = level ?? (verbose ? 'debug' : 'warn');
  const opts = {
    level: resolvedLevel,
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
  const dest = destination ?? buildDestination(config);
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
  if (!currentLogger) currentLogger = createLogger();
  return currentLogger;
}

export function redactValue(value) {
  return fingerprint(value);
}

export { REDACT_KEYS, REDACT_KEY_SET, redactRecursive };
