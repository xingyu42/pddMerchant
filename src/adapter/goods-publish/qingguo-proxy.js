import { createHash } from 'node:crypto';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { throwIfAborted } from '../../infra/abort.js';

const QINGGUO_API_URL = 'https://share.proxy.qg.net/get';
const QINGGUO_TIMEOUT_MS = 10_000;
const MIN_REMAINING_MS = 30_000;

const AUTH_CODES = new Set([
  'INVALID_KEY',
  'UNAVAILABLE_KEY',
  'ACCESS_DENY',
  'API_AUTH_DENY',
  'KEY_BLOCK',
]);
const QUOTA_CODES = new Set(['BALANCE_INSUFFICIENT', 'EXTRACT_LIMIT_EXCEEDED']);
const RATE_LIMIT_CODES = new Set(['REQUEST_LIMIT_EXCEEDED']);
const UNAVAILABLE_CODES = new Set(['NO_RESOURCE_FOUND', 'FAILED_OPERATION', 'INTERNAL_ERROR']);

function proxyError(code, message, exitCode, detail = null) {
  return new PddCliError({
    code,
    message,
    hint: '检查青果代理配置或稍后重试；系统不会自动回退到直连',
    detail,
    exitCode,
  });
}

function requestIdHash(value) {
  if (value == null || String(value).trim() === '') return null;
  return `fp:${createHash('sha256').update(String(value)).digest('hex').slice(0, 8)}`;
}

function safeDetail(providerCode, rawRequestId) {
  return {
    provider: 'qingguo',
    provider_code: providerCode || null,
    request_id_hash: requestIdHash(rawRequestId),
  };
}

function mapProviderError(providerCode, rawRequestId) {
  const code = String(providerCode || '').trim().toUpperCase();
  const detail = safeDetail(code, rawRequestId);

  if (AUTH_CODES.has(code)) {
    return proxyError('E_PROXY_AUTH', '青果代理认证或权限校验失败', ExitCodes.AUTH, detail);
  }
  if (QUOTA_CODES.has(code)) {
    return proxyError('E_PROXY_QUOTA', '青果代理余额不足或提取额度已耗尽', ExitCodes.BUSINESS, detail);
  }
  if (RATE_LIMIT_CODES.has(code)) {
    return proxyError('E_PROXY_RATE_LIMIT', '青果代理提取接口请求过于频繁', ExitCodes.RATE_LIMIT, detail);
  }
  if (code === 'INVALID_PARAMETER') {
    return proxyError('E_USAGE', '青果代理提取参数无效', ExitCodes.USAGE, detail);
  }
  if (UNAVAILABLE_CODES.has(code)) {
    return proxyError('E_PROXY_UNAVAILABLE', '青果代理暂时没有可用资源', ExitCodes.NETWORK, detail);
  }
  return proxyError('E_PROXY_UNAVAILABLE', '青果代理返回了无法识别的结果', ExitCodes.NETWORK, detail);
}

function requiredEnv(env, name, missing) {
  const value = String(env[name] ?? '').trim();
  if (!value) missing.push(name);
  return value;
}

function optionalAreaEnv(env) {
  const area = String(env.PDD_QINGGUO_AREA ?? '').trim();
  if (!area) return null;

  const normalized = area.split(',').map((value) => value.trim()).join(',');
  if (!/^\d{6}(,\d{6})*$/.test(normalized)) {
    throw proxyError(
      'E_USAGE',
      '青果代理地区配置无效，PDD_QINGGUO_AREA 应为 6 位地区代码，多个代码用英文逗号分隔',
      ExitCodes.USAGE,
      { provider: 'qingguo', field: 'PDD_QINGGUO_AREA' },
    );
  }
  return normalized;
}

export function readSourceProxyConfig(env = process.env) {
  const provider = String(env.PDD_SOURCE_PROXY_PROVIDER ?? '').trim().toLowerCase();
  if (!provider) return { enabled: false, provider: null };
  if (provider !== 'qingguo') {
    throw proxyError(
      'E_USAGE',
      `不支持的源商品代理供应商: ${provider}`,
      ExitCodes.USAGE,
      { provider },
    );
  }

  const missing = [];
  const authKey = requiredEnv(env, 'PDD_QINGGUO_AUTH_KEY', missing);
  if (missing.length > 0) {
    throw proxyError(
      'E_USAGE',
      `青果代理配置不完整，缺少: ${missing.join(', ')}`,
      ExitCodes.USAGE,
      { provider, missing },
    );
  }

  const area = optionalAreaEnv(env);
  return {
    enabled: true,
    provider,
    authKey,
    ...(area ? { area } : {}),
  };
}

function parseServer(server) {
  const raw = String(server ?? '').trim();
  const separator = raw.lastIndexOf(':');
  if (separator <= 0 || separator === raw.length - 1) return null;

  const host = raw.slice(0, separator).trim();
  const port = Number(raw.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}`;
}

function parseDeadline(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  const isoLike = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(isoLike) ? isoLike : `${isoLike}+08:00`;
  return Date.parse(zoned);
}

export function normalizeQingguoLease(body, config, { now = Date.now() } = {}) {
  const providerCode = body?.code;
  const rawRequestId = body?.request_id ?? body?.requestId ?? null;
  if (String(providerCode ?? '').toUpperCase() !== 'SUCCESS') {
    throw mapProviderError(providerCode, rawRequestId);
  }

  const item = Array.isArray(body?.data) ? body.data[0] : null;
  const server = parseServer(item?.server);
  const expiresAt = parseDeadline(item?.deadline);
  if (!server || !Number.isFinite(expiresAt)) {
    throw proxyError(
      'E_PROXY_UNAVAILABLE',
      '青果代理响应缺少有效的节点或截止时间',
      ExitCodes.NETWORK,
      safeDetail(providerCode, rawRequestId),
    );
  }

  const remainingMs = expiresAt - now;
  if (remainingMs < MIN_REMAINING_MS) {
    throw proxyError(
      'E_PROXY_UNAVAILABLE',
      '青果代理剩余有效期不足 30 秒',
      ExitCodes.NETWORK,
      { ...safeDetail(providerCode, rawRequestId), remaining_ms: Math.max(0, remainingMs) },
    );
  }

  return {
    provider: 'qingguo',
    server,
    expiresAt,
    area: item?.area ?? null,
    isp: item?.isp ?? null,
    requestIdHash: requestIdHash(rawRequestId),
  };
}

function mapHttpError(status) {
  if (status === 401 || status === 403 || status === 407) {
    return proxyError('E_PROXY_AUTH', '青果代理认证或权限校验失败', ExitCodes.AUTH, {
      provider: 'qingguo',
      http_status: status,
    });
  }
  if (status === 429) {
    return proxyError('E_PROXY_RATE_LIMIT', '青果代理提取接口请求过于频繁', ExitCodes.RATE_LIMIT, {
      provider: 'qingguo',
      http_status: status,
    });
  }
  return proxyError('E_PROXY_UNAVAILABLE', '青果代理提取接口暂时不可用', ExitCodes.NETWORK, {
    provider: 'qingguo',
    http_status: status,
  });
}

export async function acquireQingguoProxyLease(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? QINGGUO_TIMEOUT_MS;
  const signal = options.signal ?? null;
  const now = options.now ?? Date.now;
  throwIfAborted(signal);

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const url = new URL(QINGGUO_API_URL);
  url.searchParams.set('key', config.authKey);
  url.searchParams.set('num', '1');
  url.searchParams.set('distinct', 'true');
  if (config.area) url.searchParams.set('area', config.area);

  try {
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    if (!response?.ok) throw mapHttpError(response?.status);

    let body;
    try {
      body = await response.json();
    } catch {
      throw proxyError(
        'E_PROXY_UNAVAILABLE',
        '青果代理响应不是有效 JSON',
        ExitCodes.NETWORK,
        { provider: 'qingguo' },
      );
    }
    return normalizeQingguoLease(body, config, { now: now() });
  } catch (err) {
    if (err instanceof PddCliError) throw err;
    if (signal?.aborted) throwIfAborted(signal);
    if (timedOut || err?.name === 'AbortError') {
      throw proxyError('E_PROXY_UNAVAILABLE', '青果代理提取请求超时', ExitCodes.NETWORK, {
        provider: 'qingguo',
      });
    }
    throw proxyError('E_PROXY_UNAVAILABLE', '青果代理提取请求失败', ExitCodes.NETWORK, {
      provider: 'qingguo',
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
