import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { CONFIG_PATH as DEFAULT_CONFIG_PATH } from './paths.js';
import { PddCliError, ExitCodes } from './errors.js';

const ConfigSchema = z.object({
  apiBase: z.string().url().optional(),
  mallId: z.string().optional(),
  profileDir: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  defaultMall: z.string().optional(),
  rateLimitQps: z.number().finite().optional(),
  rateLimitBurst: z.number().int().positive().optional(),
  cooldownThreshold: z.number().int().positive().optional(),
  cooldownMs: z.number().int().positive().optional(),
  authStatePath: z.string().optional(),
  logDestination: z.string().optional(),
  refreshIntervalMs: z.number().int().positive().optional(),
  refreshJitterMs: z.number().int().nonnegative().optional(),
}).partial();

const REJECTED_LOG_DESTINATIONS = new Set(['stdout', 'stderr', '-', ':console']);

const ENV_KEY_MAP = {
  PDD_API_BASE: 'apiBase',
  PDD_MALL_ID: 'mallId',
  PDD_PROFILE_DIR: 'profileDir',
  PDD_TIMEOUT_MS: 'timeoutMs',
  PDD_LOG_LEVEL: 'logLevel',
  PDD_DEFAULT_MALL: 'defaultMall',
  PDD_RATE_LIMIT_QPS: 'rateLimitQps',
  PDD_RATE_LIMIT_BURST: 'rateLimitBurst',
  PDD_COOLDOWN_THRESHOLD: 'cooldownThreshold',
  PDD_COOLDOWN_MS: 'cooldownMs',
  PDD_AUTH_STATE_PATH: 'authStatePath',
  PDD_LOG_DESTINATION: 'logDestination',
  PDD_REFRESH_INTERVAL_MS: 'refreshIntervalMs',
  PDD_REFRESH_JITTER_MS: 'refreshJitterMs',
};

const NUMERIC_KEYS = new Set([
  'timeoutMs', 'rateLimitQps', 'rateLimitBurst',
  'cooldownThreshold', 'cooldownMs',
  'refreshIntervalMs', 'refreshJitterMs',
]);

function readEnv(env = process.env) {
  const out = {};
  for (const [envKey, cfgKey] of Object.entries(ENV_KEY_MAP)) {
    const v = env[envKey];
    if (v == null || v === '') continue;
    if (NUMERIC_KEYS.has(cfgKey)) {
      const n = Number(v);
      if (Number.isFinite(n)) out[cfgKey] = n;
    } else {
      out[cfgKey] = v;
    }
  }
  return out;
}

async function readFileConfig(path) {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    return {};
  }
}

export async function loadConfig({
  cliFlags = {},
  env = process.env,
  configPath = DEFAULT_CONFIG_PATH,
} = {}) {
  const fileCfg = await readFileConfig(configPath);
  const envCfg = readEnv(env);
  const merged = {
    ...fileCfg,
    ...envCfg,
    ...cliFlags,
  };
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return { config: merged, valid: false, issues: parsed.error.issues };
  }
  return { config: parsed.data, valid: true, issues: [] };
}

const RUNTIME_DEFAULTS = Object.freeze({
  rateLimitQps: 2,
  rateLimitBurst: 3,
  cooldownThreshold: 3,
  cooldownMs: 5 * 60 * 1000,
  refreshIntervalMs: 60 * 60 * 1000,
  refreshJitterMs: 15 * 60 * 1000,
});

function validateLogDestination(dest) {
  if (dest == null || dest === '') return undefined;
  if (REJECTED_LOG_DESTINATIONS.has(dest.toLowerCase())) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `PDD_LOG_DESTINATION="${dest}" is not allowed — use an absolute or project-relative file path`,
      exitCode: ExitCodes.USAGE,
    });
  }
  return dest;
}

export async function loadRuntimeConfig(options) {
  const { config } = await loadConfig(options);
  const logDestination = validateLogDestination(config.logDestination);
  const runtime = Object.freeze({
    ...config,
    rateLimitQps: validQpsOrDefault(config.rateLimitQps, RUNTIME_DEFAULTS.rateLimitQps),
    rateLimitBurst: validIntPositiveOrDefault(config.rateLimitBurst, RUNTIME_DEFAULTS.rateLimitBurst),
    cooldownThreshold: validIntPositiveOrDefault(config.cooldownThreshold, RUNTIME_DEFAULTS.cooldownThreshold),
    cooldownMs: validIntPositiveOrDefault(config.cooldownMs, RUNTIME_DEFAULTS.cooldownMs),
    logDestination,
    refreshIntervalMs: validIntPositiveOrDefault(config.refreshIntervalMs, RUNTIME_DEFAULTS.refreshIntervalMs),
    refreshJitterMs: validIntNonNegOrDefault(config.refreshJitterMs, RUNTIME_DEFAULTS.refreshJitterMs),
    testAdapter: (options?.env ?? process.env).PDD_TEST_ADAPTER || null,
  });
  return runtime;
}

function validQpsOrDefault(v, fallback) {
  if (v === 0) return 0;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0.01) return v;
  return fallback;
}

function validFinitePositiveOrDefault(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0.01) return v;
  return fallback;
}

function validIntPositiveOrDefault(v, fallback) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return fallback;
}

function validIntNonNegOrDefault(v, fallback) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  return fallback;
}

export { ConfigSchema, DEFAULT_CONFIG_PATH, RUNTIME_DEFAULTS, REJECTED_LOG_DESTINATIONS };
