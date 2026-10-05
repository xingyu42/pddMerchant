import https from 'node:https';
import { abortableSleep } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';

// Fixed site protocol. Input Cookie lists must belong to a frozen browser snapshot.
export const MERCHANT_CHECK_URL = 'https://mms.pinduoduo.com/janus/api/checkLogin';
export const MERCHANT_IDENTITY_URL = 'https://mms.pinduoduo.com/earth/api/mallInfo/querySimpleCredential';
export const MERCHANT_SHOP_READ_URL = 'https://mms.pinduoduo.com/earth/api/mallInfo/queryMallAuditInfo';
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const INVALID_VALUE = /[^\x21-\x7e]|["\\;]/;
const TEMPORARY_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED']);

function invalidCandidate(reason) {
  return new PddCliError({
    code: 'E_AUTH_CANDIDATE_INVALID', message: '候选登录材料无法用于协议核验',
    detail: { reason }, exitCode: ExitCodes.AUTH,
  });
}

export function hasPassId(cookies) {
  return cookies.some((cookie) => cookie.name === 'PASS_ID' && cookie.value);
}

// The browser owns URL/domain/path/expiry selection; never pass all-site cookies here.
export async function collectCheckCookies(context) {
  const cookies = structuredClone(await context.cookies([MERCHANT_CHECK_URL]));
  for (const cookie of cookies) Object.freeze(cookie);
  return Object.freeze(cookies);
}

export function buildCheckHeader(cookies) {
  if (!Array.isArray(cookies)) throw invalidCandidate('cookies_not_array');
  const names = new Set();
  const pairs = [];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== 'string' || !COOKIE_NAME.test(cookie.name)) {
      throw invalidCandidate('cookie_name_invalid');
    }
    if (typeof cookie.value !== 'string' || INVALID_VALUE.test(cookie.value)) {
      throw invalidCandidate('cookie_value_invalid');
    }
    if (cookie.partitionKey != null) throw invalidCandidate('partitioned_cookie_unsupported');
    if (names.has(cookie.name)) throw invalidCandidate('duplicate_cookie_name');
    if (cookie.name === 'PASS_ID' && (!cookie.value || cookie.value.includes(','))) {
      throw invalidCandidate('pass_id_value_invalid');
    }
    names.add(cookie.name);
    pairs.push(`${cookie.name}=${cookie.value}`);
  }
  if (!names.has('PASS_ID')) throw invalidCandidate('pass_id_missing');
  const header = pairs.join('; ');
  if (Buffer.byteLength(header) > 65_536) throw invalidCandidate('cookie_header_too_large');
  return header;
}

function outcome(verdict, reason, httpStatus = null) {
  return { verdict, reason, http_status: httpStatus, checked_at: new Date().toISOString() };
}

export function classifyCheckLogin(status, body) {
  if (status !== 200) return outcome('indeterminate', 'http_status', status);
  if (body == null || typeof body !== 'object' || Array.isArray(body)
    || body.success !== true || typeof body.result?.login !== 'boolean') {
    return outcome('indeterminate', 'response_shape', status);
  }
  return body.result.login
    ? outcome('verified', 'login_true', status)
    : outcome('rejected', 'login_false', status);
}

function networkOutcome(error) {
  const code = String(error?.code ?? '');
  const tls = /CERT|TLS|SSL/.test(code);
  return {
    result: outcome('indeterminate', tls ? 'tls_error' : 'network_error'),
    retryable: TEMPORARY_CODES.has(code),
  };
}

function requestCheck(url, header, classify, { signal, timeoutMs, maxResponseBytes }) {
  return new Promise((resolve) => {
    let settled = false;
    let request;
    let response;
    const finish = (result, retryable = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ result, retryable });
      response?.destroy();
      request?.destroy();
    };
    const onAbort = () => finish(outcome('indeterminate', 'cancelled'));
    const timer = setTimeout(() => finish(outcome('indeterminate', 'request_timeout'), true), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      request = https.request(url, {
        method: 'GET', rejectUnauthorized: true,
        headers: { Accept: 'application/json', Cookie: header },
      }, (incoming) => {
        response = incoming;
        const status = incoming.statusCode;
        if (settled) { incoming.destroy(); return; }
        if (status !== 200) { finish(outcome('indeterminate', 'http_status', status)); return; }
        const chunks = [];
        let size = 0;
        incoming.on('data', (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxResponseBytes) { finish(outcome('indeterminate', 'response_too_large', status)); return; }
          chunks.push(chunk);
        });
        incoming.on('end', () => {
          if (settled) return;
          try { finish(classify(status, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))); }
          catch { finish(outcome('indeterminate', 'invalid_json', status)); }
        });
        incoming.on('error', () => finish(outcome('indeterminate', 'response_error', status)));
        incoming.on('aborted', () => finish(outcome('indeterminate', 'response_aborted', status)));
      });
      request.on('error', (error) => {
        const mapped = networkOutcome(error);
        finish(mapped.result, mapped.retryable);
      });
      request.end();
    } catch (error) {
      const mapped = networkOutcome(error);
      finish(mapped.result, mapped.retryable);
    }
  });
}

async function probeAtUrl(url, classify, cookies, {
  signal, deadlineAt = Date.now() + 30_500, timeoutMs = 15_000,
  maxResponseBytes = 1024 * 1024,
} = {}) {
  if (!Number.isFinite(deadlineAt) || !Number.isFinite(timeoutMs) || timeoutMs <= 0
    || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw invalidCandidate('probe_limits_invalid');
  }
  const header = buildCheckHeader(cookies);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) return outcome('indeterminate', 'cancelled');
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return outcome('indeterminate', 'deadline');
    const { result, retryable } = await requestCheck(url, header, classify, {
      signal, timeoutMs: Math.min(timeoutMs, remaining), maxResponseBytes,
    });
    if (!retryable || attempt === 1) return result;
    if (deadlineAt - Date.now() <= 500) return outcome('indeterminate', 'deadline');
    try { await abortableSleep(500, signal); }
    catch { return outcome('indeterminate', 'cancelled'); }
  }
}

export function probeCheckLogin(cookies, options) {
  return probeAtUrl(MERCHANT_CHECK_URL, classifyCheckLogin, cookies, options);
}

export function classifyMerchantIdentity(status, body) {
  if (status === 200 && body?.success === false) return outcome('failed', 'shop_identity_rejected', status);
  const main = body?.result?.merchantMainSimpleVO;
  const mallId = main?.mallId;
  const displayName = main?.mallName;
  if (status !== 200 || body?.success !== true || !main
    || !['string', 'number'].includes(typeof mallId) || !/^[1-9][0-9]{0,14}$/.test(String(mallId))
    || (typeof mallId === 'number' && !Number.isSafeInteger(mallId))
    || typeof displayName !== 'string' || !displayName.trim()) {
    return outcome('indeterminate', 'shop_identity_shape', status);
  }
  return { ...outcome('verified', 'shop_identity', status), identity: { mallId: String(mallId), displayName: displayName.trim() } };
}

function classifyShopRead(status, body) {
  if (status === 200 && body?.success === false) return outcome('failed', 'shop_read_rejected', status);
  return status === 200 && body?.success === true && Array.isArray(body?.result?.auditInfoVOList)
    ? outcome('verified', 'shop_read', status)
    : outcome('indeterminate', 'shop_read_shape', status);
}

export async function probeMerchantShop(context, checkCookies, options = {}) {
  const targets = [MERCHANT_IDENTITY_URL, MERCHANT_SHOP_READ_URL];
  const selected = await Promise.all(targets.map(async (url) => structuredClone(await context.cookies([url]))));
  for (const cookies of selected) {
    buildCheckHeader(cookies);
    if (cookies.find((cookie) => cookie.name === 'PASS_ID')?.value
      !== checkCookies.find((cookie) => cookie.name === 'PASS_ID')?.value) {
      throw invalidCandidate('cross_target_pass_id_mismatch');
    }
  }
  const identityCheck = await probeAtUrl(MERCHANT_IDENTITY_URL, classifyMerchantIdentity, selected[0], options);
  if (identityCheck.verdict !== 'verified') return { ...identityCheck, scope: 'shop_identity' };
  const readCheck = await probeAtUrl(MERCHANT_SHOP_READ_URL, classifyShopRead, selected[1], options);
  return { ...readCheck, identity: identityCheck.identity, scope: 'shop_read' };
}
