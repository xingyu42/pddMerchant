// envelope 终结点（design D-2）：成功/错误 envelope 的唯一组装出口 + emit-once 助手。
import { emit as defaultEmit, buildEnvelope } from '../../infra/output.js';
import { ExitCodes, errorToEnvelope } from '../../infra/errors.js';
import { accountMetaForEnvelope } from '../../infra/account-resolver.js';

function normalizeRunResult(result) {
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

function nowMs(runtime) {
  return runtime.clock?.now ? runtime.clock.now() : Date.now();
}

// emit 受 runtime.emitResult 守门：每条终结路径恰好调用一次 finalize*，
// exactly-once 语义（PROP-WC-1）由此集中保证。返回值始终是组装的 envelope 本体。
function emitOnce(envelope, runtime, renderer) {
  if (runtime.emitResult) {
    const emitFn = runtime.outputSink?.emit ?? defaultEmit;
    emitFn(envelope, { json: runtime.opts.json, noColor: runtime.opts.noColor, renderer });
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
      latency_ms: nowMs(runtime) - runtime.startedAt,
      warnings: [...runtime.warnings, ...(resultWarnings ?? [])],
      correlation_id: runtime.correlationId,
      exit_code: ExitCodes.OK,
      ...accountMetaForEnvelope(runtime.accountCtx),
      ...extraMeta,
    },
  }, {
    debugRaw: Boolean(runtime.env?.debugRaw),
    onRawDebug: runtime.outputSink ? (entry) => runtime.outputSink.writeDebugRaw(entry) : undefined,
  });
  return emitOnce(envelope, runtime, spec.render);
}

export function finalizeError(spec, runtime, err) {
  const envelope = errorToEnvelope(spec.name, err, {
    latency_ms: nowMs(runtime) - runtime.startedAt,
    warnings: runtime.warnings,
    correlation_id: runtime.correlationId,
  });
  return emitOnce(envelope, runtime);
}
