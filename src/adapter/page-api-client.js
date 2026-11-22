import { evaluateInMainWorld } from './browser.js';
import { throwIfAborted, timeoutError } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { normalizePageApiMethod } from './endpoint-strategy-resolver.js';

const DEFAULT_DISCOVERY_ATTEMPTS = 15;
const DEFAULT_DISCOVERY_INTERVAL_MS = 200;

function normalizeDiscovery(discovery = {}) {
  return {
    attempts: Number.isInteger(discovery.attempts) && discovery.attempts > 0
      ? discovery.attempts
      : DEFAULT_DISCOVERY_ATTEMPTS,
    intervalMs: Number.isFinite(discovery.intervalMs) && discovery.intervalMs >= 0
      ? discovery.intervalMs
      : DEFAULT_DISCOVERY_INTERVAL_MS,
  };
}

function isBusinessEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.hasOwn(value, 'success')
    || Object.hasOwn(value, 'errorCode')
    || Object.hasOwn(value, 'error_code');
}

async function waitForEvaluation(evaluation, { signal, timeoutMs } = {}) {
  throwIfAborted(signal);
  const hasTimeout = Number.isFinite(timeoutMs);
  if (hasTimeout && timeoutMs <= 0) throw timeoutError();
  if (!signal && !hasTimeout) return evaluation;

  let timeoutId;
  let abortHandler;
  const deadline = new Promise((_, reject) => {
    if (signal) {
      abortHandler = () => reject(timeoutError());
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    if (hasTimeout) {
      timeoutId = setTimeout(() => reject(timeoutError()), timeoutMs);
    }
  });

  try {
    return await Promise.race([evaluation, deadline]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

export async function executePageApiRequest(
  page,
  { apiUrl, method = 'POST', payload, discovery },
  { signal, timeoutMs } = {},
) {
  const normalizedMethod = normalizePageApiMethod(method);
  if (!normalizedMethod) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'page-api: unsupported HTTP method',
      hint: 'page-api 端点仅支持 GET 或 POST 方法',
      detail: { method },
      exitCode: ExitCodes.USAGE,
    });
  }
  if (normalizedMethod === 'GET' && payload != null
    && (typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length > 0)) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'page-api: GET request does not accept a non-empty payload',
      hint: 'GET 端点不支持非空请求体，请将参数编码到 apiUrl 或使用 POST',
      exitCode: ExitCodes.USAGE,
    });
  }
  const evaluation = evaluateInMainWorld(page, async ({ url, method: requestMethod, body, discovery: wait }) => {
    function looksLikeMmsRequestClient(exports) {
      return exports
        && typeof exports === 'object'
        && typeof exports.fetch === 'function'
        && typeof exports.post === 'function'
        && typeof exports.get === 'function'
        && typeof exports.put === 'function'
        && typeof exports.del === 'function'
        && typeof exports.redirectToLogin === 'function';
    }

    function captureWebpack4Runtime(runtime, probeId) {
      const captured = { webpackRequire: null };
      runtime.push([
        [],
        {
          [probeId]: function capture(module, exports, webpackRequire) {
            captured.webpackRequire = webpackRequire;
          },
        },
        [[probeId]],
      ]);
      if (captured.webpackRequire) {
        delete captured.webpackRequire.c?.[probeId];
        delete captured.webpackRequire.m?.[probeId];
      }
      return captured.webpackRequire;
    }

    function captureWebpack5Runtime(runtime) {
      const captured = { webpackRequire: null };
      runtime.push([[], {}, (webpackRequire) => {
        captured.webpackRequire = webpackRequire;
      }]);
      return captured.webpackRequire;
    }

    function captureRuntime(globalName, runtime, probeId) {
      if (runtime.push === Array.prototype.push) return null;
      if (globalName.startsWith('webpackChunk')) {
        return captureWebpack5Runtime(runtime);
      }
      return captureWebpack4Runtime(runtime, probeId);
    }

    function discoverRuntimes(capturedRuntimes) {
      const runtimeNames = Object.getOwnPropertyNames(window)
        .filter((key) => key.startsWith('webpackJsonp') || key.startsWith('webpackChunk'));
      let candidateSeen = false;
      for (const globalName of runtimeNames) {
        if (capturedRuntimes.has(globalName)) continue;
        const runtime = window[globalName];
        if (!Array.isArray(runtime) || runtime.push === Array.prototype.push) continue;
        candidateSeen = true;
        try {
          const probeId = `__runtime_probe_${Date.now()}_${capturedRuntimes.size}`;
          const webpackRequire = captureRuntime(globalName, runtime, probeId);
          if (webpackRequire) capturedRuntimes.set(globalName, webpackRequire);
        } catch {
          // Another runtime global may still provide the merchant client.
        }
      }
      return { candidateSeen, runtimeCaptured: capturedRuntimes.size > 0 };
    }

    function findRequestClient(webpackRequire) {
      for (const module of Object.values(webpackRequire.c ?? {})) {
        if (looksLikeMmsRequestClient(module?.exports)) {
          return module.exports;
        }
      }

      for (const [moduleId, factory] of Object.entries(webpackRequire.m ?? {})) {
        if (typeof factory !== 'function') continue;
        const source = Function.prototype.toString.call(factory);
        if (!source.includes('redirectToLogin') || !source.includes('Anti-Content')) continue;
        try {
          // 仅实例化强特征匹配的 factory；Webpack 会像正常页面加载一样缓存该 module。
          const exports = webpackRequire(moduleId);
          if (looksLikeMmsRequestClient(exports)) {
            return exports;
          }
        } catch {
          // Ignore unrelated modules with similar source markers.
        }
      }
      return null;
    }

    const capturedRuntimes = new Map();
    let runtimeCandidateSeen = false;
    let runtimeCaptured = false;
    let client = null;
    for (let attempt = 0; attempt < wait.attempts; attempt += 1) {
      const discovery = discoverRuntimes(capturedRuntimes);
      runtimeCandidateSeen = discovery.candidateSeen || runtimeCandidateSeen;
      runtimeCaptured = discovery.runtimeCaptured || runtimeCaptured;
      for (const webpackRequire of capturedRuntimes.values()) {
        client = findRequestClient(webpackRequire);
        if (client) break;
      }
      if (client) break;
      if (attempt < wait.attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, wait.intervalMs));
      }
    }
    if (!client) {
      const reason = runtimeCaptured
        ? 'client-not-found'
        : (runtimeCandidateSeen ? 'runtime-shape-mismatch' : 'runtime-not-found');
      return { unavailable: true, reason };
    }

    try {
      const data = requestMethod === 'GET'
        ? await client.get(url)
        : await client.post(url, body);
      return { ok: true, status: 200, data };
    } catch (error) {
      const statusCandidate = error?.status ?? error?.response?.status;
      const status = Number.isInteger(statusCandidate) ? statusCandidate : null;
      const errorCode = error?.error_code ?? error?.errorCode ?? null;
      return {
        ok: false,
        status,
        errorCode,
        errorMessage: error?.error_msg ?? error?.errorMsg ?? error?.message ?? null,
        transportError: errorCode == null && !(status != null && status >= 400),
      };
    }
  }, { url: apiUrl, method: normalizedMethod, body: payload, discovery: normalizeDiscovery(discovery) });
  const result = await waitForEvaluation(evaluation, { signal, timeoutMs });

  if (result?.unavailable) {
    return {
      status: null,
      raw: null,
      unavailable: true,
      reason: result.reason ?? 'client-not-found',
    };
  }
  if (result?.ok) {
    return {
      status: result.status,
      raw: isBusinessEnvelope(result.data)
        ? result.data
        : { success: true, errorCode: 0, result: result.data },
    };
  }
  if (result?.transportError) {
    return {
      status: result.status ?? null,
      raw: null,
      transportError: true,
      message: result.errorMessage ?? 'page request client rejected',
    };
  }
  return {
    status: result?.status ?? 200,
    raw: {
      success: false,
      errorCode: result?.errorCode ?? null,
      errorMsg: result?.errorMessage ?? '',
    },
  };
}
