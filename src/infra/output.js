import chalk from 'chalk';
import Table from 'cli-table3';
import { redactRecursive } from './logger.js';

function shouldUseColor({ tty, noColor }) {
  if (process.env.FORCE_COLOR === '1') return true;
  if (noColor) return false;
  if (process.env.NO_COLOR) return false;
  if (tty === false) return false;
  return Boolean(tty ?? process.stdout.isTTY);
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// envelope.data 的保留键收口（design D-1）：递归删除键名严格 === 'raw' 的属性。
// 非变异；rawValue / raw_url 等近似键不受影响；非普通对象（Date/类实例）原样透传。
function stripRaw(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((v) => stripRaw(v, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'raw') continue;
      out[k] = stripRaw(v, seen);
    }
    return out;
  }
  return value;
}

const RAW_DEBUG_VALUE_MAX_BYTES = 65536;

function rawDebugEnabled() {
  return process.env.PDD_DEBUG_RAW === '1';
}

function appendRawPath(base, key) {
  if (!base) return key;
  if (key.startsWith('[')) return `${base}${key}`;
  return `${base}.${key}`;
}

function truncateUtf8(str, maxBytes) {
  if (Buffer.byteLength(str) <= maxBytes) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(str.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo);
}

function serializeRawValue(value) {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) ?? 'null';
  } catch {
    return JSON.stringify(String(value));
  }
}

function collectRawEntries(value, path, entries, seen) {
  if (value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectRawEntries(v, appendRawPath(path, `[${i}]`), entries, seen));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const childPath = appendRawPath(path, k);
    if (k === 'raw') entries.push({ path: childPath, value: v });
    collectRawEntries(v, childPath, entries, seen);
  }
}

function toRawDebugEntry({ path, value }) {
  const serialized = serializeRawValue(redactRecursive(value));
  if (Buffer.byteLength(serialized) <= RAW_DEBUG_VALUE_MAX_BYTES) {
    return { path, value: serialized };
  }
  return { path, value: truncateUtf8(serialized, RAW_DEBUG_VALUE_MAX_BYTES), truncated: true };
}

function writeRawDebug(command, correlationId, entries) {
  if (entries.length === 0) return;
  const line = JSON.stringify({
    type: 'raw_debug',
    command: command ?? '',
    correlation_id: correlationId ?? '',
    raw: entries.map(toRawDebugEntry),
  });
  process.stderr.write(line + '\n');
}

function displayEnvelope(envelope) {
  return {
    ...envelope,
    data: redactRecursive(envelope.data),
    error: redactRecursive(envelope.error),
  };
}

function buildBatchMeta(batchMeta) {
  return {
    v: 1,
    batch: true,
    latency_ms: batchMeta.latency_ms ?? 0,
    correlation_id: batchMeta.correlation_id ?? '',
    exit_code: batchMeta.exit_code ?? 0,
    warnings: batchMeta.warnings ?? [],
  };
}

function collectBatchRawEntries(entries) {
  const rawEntries = [];
  for (const [slug, r] of entries) {
    if (r.ok) collectRawEntries(r.data, `accounts.${slug}`, rawEntries, new WeakSet());
  }
  return rawEntries;
}

function buildEnvelope(input) {
  const { ok, command, data, error, meta } = input ?? {};
  const finalCommand = command ?? '';
  const finalMeta = {
    v: 1,
    latency_ms: 0,
    xhr_count: 0,
    warnings: [],
    ...(meta ?? {}),
  };
  if (rawDebugEnabled()) {
    const entries = [];
    collectRawEntries(data, '', entries, new WeakSet());
    writeRawDebug(finalCommand, finalMeta.correlation_id, entries);
  }
  return {
    ok: Boolean(ok),
    command: finalCommand,
    data: stripRaw(data) ?? null,
    error: error ?? null,
    meta: finalMeta,
  };
}

function renderTable(envelope, { useColor }) {
  const lines = [];
  const statusLabel = envelope.ok ? 'OK' : 'FAIL';
  const statusText = useColor
    ? (envelope.ok ? chalk.green(statusLabel) : chalk.red(statusLabel))
    : statusLabel;
  lines.push(`${statusText}  ${envelope.command || ''}`.trim());

  if (envelope.data != null) {
    if (Array.isArray(envelope.data)) {
      if (envelope.data.length === 0) {
        lines.push('(no rows)');
      } else {
        const headers = Object.keys(envelope.data[0] ?? {});
        const table = new Table({ head: headers });
        for (const row of envelope.data) {
          table.push(headers.map((h) => formatCell(row?.[h])));
        }
        lines.push(table.toString());
      }
    } else if (typeof envelope.data === 'object') {
      const table = new Table({ head: ['key', 'value'] });
      for (const [k, v] of Object.entries(envelope.data)) {
        table.push([k, formatCell(v)]);
      }
      lines.push(table.toString());
    } else {
      lines.push(String(envelope.data));
    }
  }

  const meta = envelope.meta ?? {};
  const metaParts = [];
  if (typeof meta.latency_ms === 'number') metaParts.push(`latency=${meta.latency_ms}ms`);
  if (typeof meta.xhr_count === 'number') metaParts.push(`xhr=${meta.xhr_count}`);
  if (Array.isArray(meta.warnings) && meta.warnings.length > 0) {
    metaParts.push(`warnings=${meta.warnings.length}`);
  }
  if (metaParts.length > 0) {
    const metaLine = metaParts.join(' ');
    lines.push(useColor ? chalk.dim(metaLine) : metaLine);
  }

  return lines.join('\n');
}

function formatCell(v) {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function renderError(envelope, { useColor }) {
  if (!envelope.error) return '';
  const { code, message, hint } = envelope.error;
  const header = `[${code || 'E_GENERAL'}] ${message || ''}`;
  const lines = [useColor ? chalk.red(header) : header];
  if (hint) {
    const hintLine = `hint: ${hint}`;
    lines.push(useColor ? chalk.yellow(hintLine) : hintLine);
  }
  return lines.join('\n');
}

export function emit(envelopeInput, options = {}) {
  const envelope = buildEnvelope(envelopeInput);
  const json = options.json === true;
  const raw = options.raw === true;
  const noColor = options.noColor === true;
  const tty = options.tty;
  const renderer = options.renderer;

  if (json) {
    const safeEnvelope = {
      ...envelope,
      ...(envelope.data ? { data: redactRecursive(envelope.data) } : {}),
      ...(envelope.error ? { error: redactRecursive(envelope.error) } : {}),
    };
    process.stdout.write(JSON.stringify(safeEnvelope) + '\n');
    if (envelope.error) {
      const errLine = renderError(envelope, { useColor: false });
      if (errLine) process.stderr.write(errLine + '\n');
    }
    return envelope;
  }

  const useColor = shouldUseColor({ tty, noColor });
  const display = displayEnvelope(envelope);

  if (raw) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
    return envelope;
  }

  if (typeof renderer === 'function') {
    const rendered = renderer(display, { useColor });
    if (rendered != null) process.stdout.write(String(rendered) + '\n');
  } else {
    const body = renderTable(display, { useColor });
    process.stdout.write(body + '\n');
  }

  if (envelope.error) {
    const errLine = renderError(display, { useColor });
    if (errLine) process.stderr.write(errLine + '\n');
  }
  return envelope;
}

function buildBatchEnvelope(name, accountResults, batchMeta = {}) {
  const entries = Object.entries(accountResults);
  const succeeded = entries.filter(([, r]) => r.ok).length;
  const failed = entries.length - succeeded;
  const meta = buildBatchMeta(batchMeta);

  if (rawDebugEnabled()) {
    writeRawDebug(name, meta.correlation_id, collectBatchRawEntries(entries));
  }

  const accounts = {};
  for (const [slug, r] of entries) {
    accounts[slug] = {
      ok: r.ok,
      ...(r.ok ? { data: stripRaw(r.data) } : { error: r.error }),
      latency_ms: r.latency_ms ?? r.meta?.latency_ms ?? 0,
    };
  }

  const allOk = failed === 0;
  let error = null;
  if (failed > 0 && succeeded > 0) {
    error = { code: 'E_PARTIAL', message: `${failed}/${entries.length} accounts failed` };
  } else if (failed > 0 && succeeded === 0) {
    error = { code: 'E_BATCH_ALL_FAILED', message: 'all accounts failed' };
  }

  return {
    ok: allOk,
    command: name,
    data: {
      accounts,
      summary: {
        total_accounts: entries.length,
        attempted: entries.length,
        succeeded,
        failed,
      },
    },
    error,
    meta,
  };
}

function batchRenderer(accountEnvelopes, { useColor }) {
  const safeAccountEnvelopes = redactRecursive(accountEnvelopes);
  const lines = [];
  for (const [slug, env] of Object.entries(safeAccountEnvelopes)) {
    const separator = `━━━ ${slug} ━━━`;
    lines.push(useColor ? chalk.bold(separator) : separator);

    const statusLabel = env.ok ? 'OK' : 'FAIL';
    const statusText = useColor
      ? (env.ok ? chalk.green(statusLabel) : chalk.red(statusLabel))
      : statusLabel;
    lines.push(`${statusText}  ${env.command || ''}`.trim());

    if (env.ok && env.data != null) {
      if (Array.isArray(env.data)) {
        if (env.data.length === 0) {
          lines.push('(no rows)');
        } else {
          const headers = Object.keys(env.data[0] ?? {});
          const table = new Table({ head: headers });
          for (const row of env.data) {
            table.push(headers.map((h) => formatCell(row?.[h])));
          }
          lines.push(table.toString());
        }
      } else if (typeof env.data === 'object') {
        const table = new Table({ head: ['key', 'value'] });
        for (const [k, v] of Object.entries(env.data)) {
          table.push([k, formatCell(v)]);
        }
        lines.push(table.toString());
      } else {
        lines.push(String(env.data));
      }
    }

    if (env.error) {
      lines.push(renderError(env, { useColor }));
    }

    const latency = env.meta?.latency_ms ?? env.latency_ms;
    if (typeof latency === 'number') {
      const latLine = `latency=${latency}ms`;
      lines.push(useColor ? chalk.dim(latLine) : latLine);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export { buildEnvelope, buildBatchEnvelope, batchRenderer };
