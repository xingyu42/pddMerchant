import { PddCliError, ExitCodes } from '../infra/errors.js';

const VALID_MODES = new Set(['live', 'fixture']);

function parsePositiveSafeInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

function parseNonNegativeDelay(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

/**
 * Resolve runtime mode and parse/freeze all whitelisted runtime, adapter and test env vars
 * strictly at the composition root boundary.
 */
export function parseRuntimeEnv(env = process.env, { mode } = {}) {
  const sourceEnv = env && typeof env === 'object' ? env : {};
  let resolvedMode;
  if (mode !== undefined) {
    if (typeof mode !== 'string' || !VALID_MODES.has(mode)) {
      throw new PddCliError({
        code: 'E_CONFIG_INVALID',
        message: `Unsupported runtime mode: ${String(mode)}`,
        detail: { source: 'runtime', reason: 'invalid_mode', mode: mode ?? null },
        exitCode: ExitCodes.GENERAL,
      });
    }
    resolvedMode = mode;
  } else {
    resolvedMode = sourceEnv.PDD_TEST_ADAPTER === 'fixture' ? 'fixture' : 'live';
  }

  const isFixture = resolvedMode === 'fixture';
  const testEntries = {};
  const sourceProxyEntries = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (key.startsWith('PDD_TEST_')) {
      testEntries[key] = String(value);
    } else if (
      key.startsWith('PDD_SOURCE_PROXY_')
      || key === 'PDD_QINGGUO_AUTH_KEY'
      || key === 'PDD_QINGGUO_AREA'
    ) {
      sourceProxyEntries[key] = String(value);
    }
  }

  const fixtureDir = isFixture && typeof sourceEnv.PDD_TEST_FIXTURE_DIR === 'string' && sourceEnv.PDD_TEST_FIXTURE_DIR.length > 0
    ? sourceEnv.PDD_TEST_FIXTURE_DIR
    : undefined;
  const passwordLoginTrace = isFixture && typeof sourceEnv.PDD_TEST_PASSWORD_LOGIN_TRACE === 'string' && sourceEnv.PDD_TEST_PASSWORD_LOGIN_TRACE.length > 0
    ? sourceEnv.PDD_TEST_PASSWORD_LOGIN_TRACE
    : undefined;

  return Object.freeze({
    mode: resolvedMode,
    fixtureDir,
    authInvalid: isFixture && sourceEnv.PDD_TEST_AUTH_INVALID === '1',
    authIndeterminate: isFixture && sourceEnv.PDD_TEST_AUTH_INDETERMINATE === '1',
    consumerAuthInvalid: isFixture && sourceEnv.PDD_TEST_CONSUMER_AUTH_INVALID === '1',
    passwordLogin: isFixture ? (sourceEnv.PDD_TEST_PASSWORD_LOGIN ?? 'success') : null,
    passwordLoginTrace,
    passwordLoginDelayMs: isFixture ? parseNonNegativeDelay(sourceEnv.PDD_TEST_PASSWORD_LOGIN_DELAY_MS) : 0,
    daemonLeaseTtlMs: isFixture ? parsePositiveSafeInt(sourceEnv.PDD_TEST_DAEMON_LEASE_TTL_MS) : null,
    daemonHeartbeatMs: isFixture ? parsePositiveSafeInt(sourceEnv.PDD_TEST_DAEMON_HEARTBEAT_MS) : null,
    patrolIntervalMs: isFixture ? parsePositiveSafeInt(sourceEnv.PDD_TEST_PATROL_INTERVAL_MS) : null,
    debugRaw: sourceEnv.PDD_DEBUG_RAW === '1',
    scrapeSimulate: sourceEnv.PDD_SCRAPE_SIMULATE !== '0',
    imageTransform: sourceEnv.PDD_IMAGE_TRANSFORM === '1',
    sourceProxyEnv: Object.freeze(sourceProxyEntries),
    testEnv: Object.freeze(isFixture ? testEntries : {}),
  });
}
