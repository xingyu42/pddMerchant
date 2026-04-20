import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { CONFIG_PATH as DEFAULT_CONFIG_PATH } from './paths.js';

const ConfigSchema = z.object({
  apiBase: z.string().url().optional(),
  mallId: z.string().optional(),
  profileDir: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  defaultMall: z.string().optional(),
}).partial();

const ENV_KEY_MAP = {
  PDD_API_BASE: 'apiBase',
  PDD_MALL_ID: 'mallId',
  PDD_PROFILE_DIR: 'profileDir',
  PDD_TIMEOUT_MS: 'timeoutMs',
  PDD_LOG_LEVEL: 'logLevel',
  PDD_DEFAULT_MALL: 'defaultMall',
};

function readEnv(env = process.env) {
  const out = {};
  for (const [envKey, cfgKey] of Object.entries(ENV_KEY_MAP)) {
    const v = env[envKey];
    if (v == null || v === '') continue;
    if (cfgKey === 'timeoutMs') {
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

export { ConfigSchema, DEFAULT_CONFIG_PATH };
