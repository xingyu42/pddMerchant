// envelope 终结点（design D-2）：成功/错误 envelope 的唯一组装出口 + emit-once 助手。
// 仅依赖 infra。PDD_DEBUG_RAW 钩子与 stripRaw 落位于 infra/output.js 的
// buildEnvelope/buildBatchEnvelope（D-1 规范边界），随本模块的终结调用生效。
import { emit, buildEnvelope } from '../../infra/output.js';
import { ExitCodes, errorToEnvelope } from '../../infra/errors.js';
import { accountMetaForEnvelope } from '../../infra/account-resolver.js';

export function normalizeRunResult(result) {
  if (result == null) return { data: null };
  if (typeof result !== 'object' || Array.isArray(result)) return { data: result };

  const hasReservedShape = 'data' in result || 'meta' in result || 'warnings' in result;
  if (hasReservedShape) {
    return {
      data: result.data ?? null,
      meta: result.meta,
      warnings: result.warnings,
    };
  }
  return { data: result };
}

// emit 受 runtime.emitResult 守门：每条终结路径恰好调用一次 finalize*，
// exactly-once 语义（PROP-WC-1）由此集中保证。返回值始终是组装的 envelope 本体。
function emitOnce(envelope, runtime, renderer) {
  if (runtime.emitResult) {
    emit(envelope, { json: runtime.opts.json, noColor: runtime.opts.noColor, renderer });
  }
  return envelope;
}

export function finalizeSuccess(spec, runtime, result) {
  const { data, meta: extraMeta, warnings: resultWarnings } = normalizeRunResult(result);
  const envelope = buildEnvelope({
    ok: true,
    command: spec.name,
    data,
    meta: {
      latency_ms: Date.now() - runtime.startedAt,
      warnings: [...runtime.warnings, ...(resultWarnings ?? [])],
      correlation_id: runtime.correlationId,
      exit_code: ExitCodes.OK,
      ...accountMetaForEnvelope(runtime.accountCtx),
      ...extraMeta,
    },
  });
  return emitOnce(envelope, runtime, spec.render);
}

export function finalizeError(spec, runtime, err) {
  const envelope = errorToEnvelope(spec.name, err, {
    latency_ms: Date.now() - runtime.startedAt,
    warnings: runtime.warnings,
    correlation_id: runtime.correlationId,
  });
  return emitOnce(envelope, runtime);
}
