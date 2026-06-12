// 批量执行器（design D-2）：--all-accounts 账号循环、jitter、SIGINT 中断与
// batch envelope 终结。withCommand 同时分派 single/batch，依 DAG 只能住本模块
//（batch-executor → single-lifecycle 是唯一允许同时触达两路径的位置）。
import { randomUUID } from 'node:crypto';
import { getLogger } from '../../infra/logger.js';
import { emit, buildBatchEnvelope, batchRenderer } from '../../infra/output.js';
import { PddCliError, ExitCodes, errorToEnvelope, batchExitCode } from '../../infra/errors.js';
import { abortableSleep } from '../../infra/abort.js';
import { ensureDaemonRunning } from '../../infra/daemon-launcher.js';
import { listAccounts } from '../../infra/account-registry.js';
import { accountAuthStatePath } from '../../infra/paths.js';
import { executeSingle } from './single-lifecycle.js';

const BATCH_JITTER_MIN = 2000;
const BATCH_JITTER_MAX = 5000;
function batchJitter() {
  return BATCH_JITTER_MIN + Math.floor(Math.random() * (BATCH_JITTER_MAX - BATCH_JITTER_MIN));
}

const COOLDOWN_INHERITED_PREFIX = 'cooldown_inherited_from:';
// 来源 endpoint 不明（错误形状缺 detail.endpoint）时的退化归因键
const COOLDOWN_GLOBAL_KEY = '*';

function appendAccountWarning(result, warning) {
  if (Array.isArray(result.meta?.warnings)) {
    result.meta.warnings.push(warning);
    return;
  }
  result.meta = { ...result.meta, warnings: [warning] };
}

// R3 cooldown 归因状态机（design D-5）：返回更新后的「endpoint → 冷却源 slug」映射，仅批量路径调用。
// 冷却状态在 endpoint-client 按 endpoint 分键（进程内共享），归因同维度展开（codex 终审建议）：
// "自身被限流"（E_RATE_LIMIT 且 detail.cooldown_triggered 非真）→ 当前账号成为该 endpoint 的源
//   （last-wins；detail.endpoint 缺失时退化记入 '*'）；
// "命中已激活冷却"（cooldown_triggered === true）→ 先查同 endpoint 源、缺失退化查 '*'，
//   源非自身则追加继承警告（additive-only，不触碰 ok/exit_code/data，batchExitCode 语义不变）。
export function applyCooldownAttribution(result, slug, sourcesByEndpoint) {
  if (result?.ok !== false || result.error?.code !== 'E_RATE_LIMIT') return sourcesByEndpoint;
  const endpoint = result.error.detail?.endpoint ?? COOLDOWN_GLOBAL_KEY;
  if (result.error.detail?.cooldown_triggered !== true) {
    return { ...sourcesByEndpoint, [endpoint]: slug };
  }

  const source = sourcesByEndpoint[endpoint] ?? sourcesByEndpoint[COOLDOWN_GLOBAL_KEY];
  if (source && source !== slug) {
    appendAccountWarning(result, `${COOLDOWN_INHERITED_PREFIX}${source}`);
  }
  return sourcesByEndpoint;
}

function assertBatchUsage(opts) {
  if (opts.account) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--all-accounts and --account are mutually exclusive',
      hint: 'Use one or the other, not both',
      exitCode: ExitCodes.USAGE,
    });
  }
  if (opts.authStatePath || process.env.PDD_AUTH_STATE_PATH) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--all-accounts and --auth-state-path / PDD_AUTH_STATE_PATH are mutually exclusive',
      hint: 'Use --all-accounts alone to iterate registered accounts',
      exitCode: ExitCodes.USAGE,
    });
  }
}

async function listEnabledAccounts() {
  const allAccounts = await listAccounts({ includeDisabled: true });
  if (allAccounts.length === 0) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'No registered accounts found',
      hint: 'Run "pdd account add" to register an account first',
      exitCode: ExitCodes.USAGE,
    });
  }
  return allAccounts.filter((a) => !a.disabled);
}

async function runOneAccount(spec, opts, slug, batch) {
  const perAccountCorrelation = `${batch.correlationId}:${slug}`;

  const perOpts = {
    ...opts,
    account: undefined,
    authStatePath: accountAuthStatePath(slug),
    allAccounts: false,
    mall: undefined,
    _correlationId: perAccountCorrelation,
  };

  const envelope = await executeSingle(spec, perOpts, {
    emitResult: false,
    skipDaemonStart: true,
    parentSignal: batch.signal,
  }).catch((err) => errorToEnvelope(spec.name, err, {
    latency_ms: Date.now() - batch.startedAt,
    correlation_id: perAccountCorrelation,
  }));

  return {
    ok: envelope.ok,
    data: envelope.data,
    error: envelope.error,
    exit_code: envelope.meta?.exit_code ?? ExitCodes.GENERAL,
    latency_ms: envelope.meta?.latency_ms ?? 0,
    command: envelope.command,
    meta: envelope.meta,
  };
}

async function runAccountLoop(spec, opts, accounts, batch) {
  const accountResults = {};
  let cooldownSources = {};
  for (let i = 0; i < accounts.length; i++) {
    if (batch.signal.aborted) break;

    const slug = accounts[i].slug;
    batch.log.info({ slug, index: i, total: accounts.length }, 'batch: executing account');

    const result = await runOneAccount(spec, opts, slug, batch);
    // 归因须先于 warnings 上抛：继承警告借下方既有复制循环进入 batchWarnings。
    cooldownSources = applyCooldownAttribution(result, slug, cooldownSources);
    accountResults[slug] = result;

    if (result.meta?.warnings) {
      for (const w of result.meta.warnings) batch.warnings.push(w);
    }

    if (i < accounts.length - 1 && !batch.signal.aborted) {
      try {
        await abortableSleep(batchJitter(), batch.signal);
      } catch {
        break;
      }
    }
  }
  return accountResults;
}

function finalizeBatch(spec, opts, accountResults, batch) {
  const aborted = batch.signal.aborted;
  if (aborted) {
    batch.warnings.push('batch_interrupted_sigint');
  }

  const batchEnvelope = buildBatchEnvelope(spec.name, accountResults, {
    latency_ms: Date.now() - batch.startedAt,
    correlation_id: batch.correlationId,
    exit_code: aborted ? 130 : batchExitCode(accountResults),
    warnings: [...new Set(batch.warnings)],
  });

  emit(batchEnvelope, {
    json: opts.json,
    noColor: opts.noColor,
    renderer: (env, renderOpts) => batchRenderer(accountResults, renderOpts),
  });

  if (aborted) {
    process.exitCode = 130;
  }

  return batchEnvelope;
}

async function executeBatch(spec, opts) {
  const startedAt = Date.now();
  const correlationId = randomUUID();
  const warnings = [];

  const log = getLogger().withOp
    ? getLogger().withOp({ command: spec.name, correlation_id: correlationId })
    : getLogger();

  assertBatchUsage(opts);

  if (opts.mall) {
    warnings.push('unused_flag_mall_in_batch');
  }

  const accounts = await listEnabledAccounts();
  if (accounts.length === 0) {
    const emptyEnvelope = buildBatchEnvelope(spec.name, {}, {
      latency_ms: Date.now() - startedAt,
      correlation_id: correlationId,
      exit_code: ExitCodes.OK,
      warnings: [...new Set(warnings)],
    });
    emit(emptyEnvelope, { json: opts.json, noColor: opts.noColor });
    return emptyEnvelope;
  }

  ensureDaemonRunning().catch((err) => {
    log.debug({ err: err?.message }, 'auto-start daemon failed (non-fatal)');
  });

  const abortController = new AbortController();
  const onSigint = () => abortController.abort();
  process.prependListener('SIGINT', onSigint);

  const batch = { startedAt, correlationId, warnings, log, signal: abortController.signal };
  let accountResults;
  try {
    accountResults = await runAccountLoop(spec, opts, accounts, batch);
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  return finalizeBatch(spec, opts, accountResults, batch);
}

export function withCommand({
  name,
  needsAuth = true,
  needsMall = 'current',
  allowAllAccounts = true,
  run,
  render,
}) {
  const spec = { name, needsAuth, needsMall, run, render };
  return function executeCommand(opts = {}) {
    if (opts.allAccounts && !allowAllAccounts) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: `${name} does not support --all-accounts`,
        hint: '写操作不支持批量账号执行，请指定单一账号',
        exitCode: ExitCodes.USAGE,
      });
    }
    if (opts.allAccounts && needsAuth) {
      return executeBatch(spec, opts);
    }
    return executeSingle(spec, opts, { emitResult: true, skipDaemonStart: false });
  };
}
