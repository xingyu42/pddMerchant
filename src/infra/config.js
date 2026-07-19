import { readFile } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import { z } from 'zod';
import {
  CONFIG_EXAMPLE_PATH as DEFAULT_CONFIG_EXAMPLE_PATH,
  CONFIG_PATH as DEFAULT_CONFIG_PATH,
  PROJECT_ROOT,
} from './paths.js';
import { PddCliError, ExitCodes } from './errors.js';

const REJECTED_LOG_DESTINATIONS = new Set(['stdout', 'stderr', '-', ':console']);

const qpsSchema = z.number().finite().refine(
  (value) => value === 0 || value >= 0.01,
  { message: 'must be 0 or at least 0.01' },
);

const logDestinationSchema = z.string().min(1).refine(
  (value) => !REJECTED_LOG_DESTINATIONS.has(value.toLowerCase()),
  { message: 'console destinations are not allowed' },
);

const fullCountDiscountRateSchema = z.number().finite()
  .transform((value) => (value > 1 && value <= 99 ? value / 100 : value))
  .refine(
    (value) => value >= 0.5 && value <= 0.99,
    { message: 'must be between 0.5 and 0.99, or between 50 and 99' },
  )
  .refine(
    (value) => Math.abs((value * 100) - Math.round(value * 100)) < 1e-9,
    { message: 'must use increments of 0.01' },
  );

const CONFIG_FIELD_DEFINITIONS = Object.freeze({
  logLevel: { schema: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']), env: 'PDD_LOG_LEVEL', kind: 'string', required: true },
  rateLimitQps: { schema: qpsSchema, env: 'PDD_RATE_LIMIT_QPS', kind: 'number', required: true },
  rateLimitBurst: { schema: z.number().int().positive(), env: 'PDD_RATE_LIMIT_BURST', kind: 'number', required: true },
  cooldownThreshold: { schema: z.number().int().positive(), env: 'PDD_COOLDOWN_THRESHOLD', kind: 'number', required: true },
  cooldownMs: { schema: z.number().int().positive(), env: 'PDD_COOLDOWN_MS', kind: 'number', required: true },
  refreshIntervalMs: { schema: z.number().int().positive(), env: 'PDD_REFRESH_INTERVAL_MS', kind: 'number', required: true },
  refreshJitterMs: { schema: z.number().int().nonnegative(), env: 'PDD_REFRESH_JITTER_MS', kind: 'number', required: true },
  writeRateTokensPerMinute: { schema: z.number().int().positive(), env: 'PDD_WRITE_RATE_TPM', kind: 'number', required: true },
  scrapeSoftBlockThreshold: { schema: z.number().int().positive(), env: 'PDD_SCRAPE_SOFTBLOCK_THRESHOLD', kind: 'number', required: true },
  scrapeSoftBlockCooldownMs: { schema: z.number().int().positive(), env: 'PDD_SCRAPE_SOFTBLOCK_COOLDOWN_MS', kind: 'number', required: true },
  categoryApiBase: { schema: z.string().url(), env: 'PDD_CATEGORY_API_BASE', kind: 'string', required: true },
  consumerLoginUrl: { schema: z.string().url(), env: 'PDD_CONSUMER_LOGIN_URL', kind: 'string', required: true },
  mallIdStrictParse: { schema: z.boolean(), env: 'PDD_MALL_ID_STRICT_PARSE', kind: 'boolean', required: true },
  fullCountDiscountRate: { schema: fullCountDiscountRateSchema, env: 'PDD_FULL_COUNT_DISCOUNT_RATE', kind: 'number', required: true },
  timeoutMs: { schema: z.number().int().positive(), env: 'PDD_TIMEOUT_MS', kind: 'number', required: false },
  defaultMall: { schema: z.string().min(1), env: 'PDD_DEFAULT_MALL', kind: 'string', required: false },
  authStatePath: { schema: z.string().min(1), env: 'PDD_AUTH_STATE_PATH', kind: 'string', required: false },
  logDestination: { schema: logDestinationSchema, env: 'PDD_LOG_DESTINATION', kind: 'string', required: false },
});

const optionalShape = Object.fromEntries(
  Object.entries(CONFIG_FIELD_DEFINITIONS).map(([key, definition]) => [key, definition.schema.optional()]),
);

const runtimeShape = Object.fromEntries(
  Object.entries(CONFIG_FIELD_DEFINITIONS).map(([key, definition]) => [
    key,
    definition.required ? definition.schema : definition.schema.optional(),
  ]),
);

const ConfigSchema = z.object(optionalShape).strict();
const RuntimeConfigSchema = z.object(runtimeShape).strict();

function displayConfigPath(path) {
  const rel = relative(PROJECT_ROOT, path);
  if (rel !== '' && !rel.startsWith('..') && !rel.includes(':')) {
    return rel.replaceAll('\\', '/');
  }
  return basename(path);
}

function sanitizeIssues(issues = []) {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }));
}

function invalidConfigError({ source, path, reason, issues }) {
  const isBaseline = source === 'baseline';
  return new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: isBaseline
      ? 'Required baseline configuration is missing or invalid'
      : `${source} configuration is invalid`,
    hint: isBaseline
      ? 'Restore config/config.example.json from the repository'
      : 'Fix the reported configuration fields and retry',
    detail: {
      source,
      ...(path ? { path: displayConfigPath(path) } : {}),
      reason,
      ...(issues?.length ? { issues: sanitizeIssues(issues) } : {}),
    },
    exitCode: ExitCodes.GENERAL,
  });
}

function validateLayer(value, schema, { source, path, reason = 'schema_invalid' }) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidConfigError({ source, path, reason, issues: parsed.error.issues });
  }
  return parsed.data;
}

async function readJsonLayer(path, { required, source, schema }) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return {};
    throw invalidConfigError({
      source,
      path,
      reason: error?.code === 'ENOENT' ? 'file_missing' : 'file_unreadable',
    });
  }

  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalidConfigError({ source, path, reason: 'json_invalid' });
  }

  return validateLayer(value, schema, { source, path });
}

function coerceEnvValue(raw, kind) {
  const text = String(raw).trim();
  if (kind === 'number') {
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return raw;
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (kind === 'boolean') {
    if (text === '1' || text.toLowerCase() === 'true') return true;
    if (text === '0' || text.toLowerCase() === 'false') return false;
    return raw;
  }
  return raw;
}

function readEnvLayer(env = process.env) {
  const values = {};
  for (const [key, definition] of Object.entries(CONFIG_FIELD_DEFINITIONS)) {
    const raw = env[definition.env];
    if (raw == null || raw === '') continue;
    values[key] = coerceEnvValue(raw, definition.kind);
  }
  return validateLayer(values, ConfigSchema, { source: 'environment' });
}

function compactDefined(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export function parseWritableConfigField(key, rawValue) {
  const definition = CONFIG_FIELD_DEFINITIONS[key];
  if (!definition) {
    throw invalidConfigError({
      source: 'input',
      reason: 'unknown_field',
      issues: [{ path: [key], code: 'unrecognized_key', message: 'Unknown configuration field' }],
    });
  }
  const value = coerceEnvValue(rawValue, definition.kind);
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    throw invalidConfigError({
      source: 'input',
      reason: 'field_invalid',
      issues: parsed.error.issues.map((issue) => ({ ...issue, path: [key, ...issue.path] })),
    });
  }
  return parsed.data;
}

export function validateLocalConfigCandidate(value) {
  return validateLayer(value, ConfigSchema, { source: 'local' });
}

function inspectionIssue(error, fallbackLayer) {
  const detail = error?.detail ?? {};
  const layer = detail.source === 'environment' ? 'env' : (detail.source ?? fallbackLayer);
  const issues = Array.isArray(detail.issues) && detail.issues.length > 0
    ? detail.issues
    : [{ path: '', code: detail.reason ?? 'invalid', message: error?.message ?? 'Configuration is invalid' }];
  return issues.map((issue) => ({
    layer,
    ...(detail.path ? { path: detail.path } : {}),
    field: issue.path ?? '',
    code: issue.code ?? detail.reason ?? 'invalid',
    message: issue.message ?? error?.message ?? 'Configuration is invalid',
  }));
}

async function inspectLayer(layer, read) {
  try {
    return { valid: true, value: await read(), issues: [] };
  } catch (error) {
    return { valid: false, value: null, issues: inspectionIssue(error, layer) };
  }
}

export async function inspectConfig({
  cliFlags = {},
  env = process.env,
  baselinePath = DEFAULT_CONFIG_EXAMPLE_PATH,
  configPath = DEFAULT_CONFIG_PATH,
} = {}) {
  const [baseline, local] = await Promise.all([
    inspectLayer('baseline', () => readJsonLayer(baselinePath, {
      required: true,
      source: 'baseline',
      schema: RuntimeConfigSchema,
    })),
    inspectLayer('local', () => readJsonLayer(configPath, {
      required: false,
      source: 'local',
      schema: ConfigSchema,
    })),
  ]);
  const environment = await inspectLayer('env', () => readEnvLayer(env));
  const cli = await inspectLayer('cli', () => validateLayer(
    compactDefined(cliFlags),
    ConfigSchema,
    { source: 'cli' },
  ));

  const layers = { baseline, local, environment, cli };
  const prerequisitesValid = Object.values(layers).every((layer) => layer.valid);
  let merged = { valid: false, value: null, issues: [] };
  if (prerequisitesValid) {
    merged = await inspectLayer('merged', () => validateLayer({
      ...baseline.value,
      ...local.value,
      ...environment.value,
      ...cli.value,
    }, RuntimeConfigSchema, { source: 'merged' }));
  }

  const valid = prerequisitesValid && merged.valid;
  const sources = {};
  if (valid) {
    for (const key of Object.keys(baseline.value)) sources[key] = 'baseline';
    for (const key of Object.keys(local.value)) sources[key] = 'local';
    for (const key of Object.keys(environment.value)) sources[key] = 'env';
    for (const key of Object.keys(cli.value)) sources[key] = 'cli';
  }

  return {
    valid,
    runtimeConfig: valid ? Object.freeze({ ...merged.value }) : null,
    localOverrides: local.valid ? { ...local.value } : null,
    sources,
    layers: { ...layers, merged },
    issues: [...baseline.issues, ...local.issues, ...environment.issues, ...cli.issues, ...merged.issues],
  };
}

export function configInspectionError(inspection) {
  return new PddCliError({
    code: 'E_CONFIG_INVALID',
    message: 'Runtime configuration is invalid',
    hint: 'Run "pdd config validate --json" to inspect configuration layers',
    detail: {
      source: 'inspection',
      reason: 'layers_invalid',
      issues: inspection?.issues ?? [],
    },
    exitCode: ExitCodes.GENERAL,
  });
}

export async function loadConfig({
  cliFlags = {},
  env = process.env,
  baselinePath = DEFAULT_CONFIG_EXAMPLE_PATH,
  configPath = DEFAULT_CONFIG_PATH,
} = {}) {
  const baseline = await readJsonLayer(baselinePath, {
    required: true,
    source: 'baseline',
    schema: RuntimeConfigSchema,
  });
  const local = await readJsonLayer(configPath, {
    required: false,
    source: 'local',
    schema: ConfigSchema,
  });
  const environment = readEnvLayer(env);
  const cli = validateLayer(compactDefined(cliFlags), ConfigSchema, { source: 'cli' });
  const config = validateLayer(
    { ...baseline, ...local, ...environment, ...cli },
    RuntimeConfigSchema,
    { source: 'merged' },
  );

  return {
    config,
    valid: true,
    issues: [],
    layers: { baseline, local, environment, cli },
  };
}

export async function loadRuntimeConfig(options) {
  const { config } = await loadConfig(options);
  return Object.freeze({ ...config });
}

export {
  ConfigSchema,
  RuntimeConfigSchema,
  CONFIG_FIELD_DEFINITIONS,
  DEFAULT_CONFIG_EXAMPLE_PATH,
  DEFAULT_CONFIG_PATH,
  REJECTED_LOG_DESTINATIONS,
};
