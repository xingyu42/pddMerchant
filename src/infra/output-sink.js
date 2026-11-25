import { emit as defaultEmit, formatRawDebugPayload } from './output.js';
import { PddCliError, ExitCodes } from './errors.js';

function assertWritableStream(stream, name) {
  if (!stream || typeof stream.write !== 'function') {
    throw new PddCliError({
      code: 'E_CONFIG_INVALID',
      message: `OutputSink streams.${name} must be a writable stream with write()`,
      detail: { source: 'runtime', reason: 'invalid_stream', stream: name },
      exitCode: ExitCodes.GENERAL,
    });
  }
  return stream;
}

/**
 * Create a runtime-scoped OutputSink guaranteeing single-envelope emission,
 * stream isolation, and PDD_DEBUG_RAW isolation via composition-root flags.
 */
export function createOutputSink({ streams, debugRaw = false } = {}) {
  const hasCustomStreams = streams !== undefined;
  const stdout = hasCustomStreams ? assertWritableStream(streams?.stdout, 'stdout') : process.stdout;
  const stderr = hasCustomStreams ? assertWritableStream(streams?.stderr, 'stderr') : process.stderr;
  const frozenStreams = Object.freeze({ stdout, stderr });

  let emitted = false;
  let lastEnvelope = null;

  function writeDebugRaw(payload) {
    if (debugRaw !== true) return false;
    const line = formatRawDebugPayload(payload);
    if (!line) return false;
    stderr.write(line + '\n');
    return true;
  }

  function emit(envelopeInput, options = {}) {
    if (emitted) return lastEnvelope;
    const useDebugRaw = options.debugRaw ?? debugRaw;
    const envelope = defaultEmit(envelopeInput, {
      ...options,
      debugRaw: useDebugRaw,
      stdout,
      stderr,
      onRawDebug: (entry) => writeDebugRaw(entry),
    });
    emitted = true;
    lastEnvelope = envelope;
    return envelope;
  }

  function hasEmitted() {
    return emitted;
  }

  return Object.freeze({
    emit,
    hasEmitted,
    writeDebugRaw,
    streams: frozenStreams,
  });
}
