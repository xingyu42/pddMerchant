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
];

function fingerprint(value) {
  if (value == null) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return 'fp:' + createHash('sha256').update(str).digest('hex').slice(0, 8);
}

function buildRedactPaths(keys) {
  const paths = [];
  for (const k of keys) {
    paths.push(k);
    paths.push(`*.${k}`);
    paths.push(`*.*.${k}`);
  }
  return paths;
}

let currentLogger = null;

export function createLogger({ verbose = false, level, destination } = {}) {
  const resolvedLevel = level ?? (verbose ? 'debug' : 'warn');
  const opts = {
    level: resolvedLevel,
    redact: {
      paths: buildRedactPaths(REDACT_KEYS),
      censor: (val) => fingerprint(val),
    },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  const logger = destination ? pino(opts, destination) : pino(opts);
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

export { REDACT_KEYS };
