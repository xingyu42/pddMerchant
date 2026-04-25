import chalk from 'chalk';
import Table from 'cli-table3';

function shouldUseColor({ tty, noColor }) {
  if (process.env.FORCE_COLOR === '1') return true;
  if (noColor) return false;
  if (process.env.NO_COLOR) return false;
  if (tty === false) return false;
  return Boolean(tty ?? process.stdout.isTTY);
}

function buildEnvelope(input) {
  const { ok, command, data, error, meta } = input ?? {};
  return {
    ok: Boolean(ok),
    command: command ?? '',
    data: data ?? null,
    error: error ?? null,
    meta: {
      v: 1,
      latency_ms: 0,
      xhr_count: 0,
      warnings: [],
      ...(meta ?? {}),
    },
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
    process.stdout.write(JSON.stringify(envelope) + '\n');
    if (envelope.error) {
      const errLine = renderError(envelope, { useColor: false });
      if (errLine) process.stderr.write(errLine + '\n');
    }
    return envelope;
  }

  const useColor = shouldUseColor({ tty, noColor });

  if (raw) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
    return envelope;
  }

  if (typeof renderer === 'function') {
    const rendered = renderer(envelope, { useColor });
    if (rendered != null) process.stdout.write(String(rendered) + '\n');
  } else {
    const body = renderTable(envelope, { useColor });
    process.stdout.write(body + '\n');
  }

  if (envelope.error) {
    const errLine = renderError(envelope, { useColor });
    if (errLine) process.stderr.write(errLine + '\n');
  }
  return envelope;
}

export { buildEnvelope };
