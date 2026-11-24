import { EndpointClient } from '../../src/adapter/endpoint-client.js';

function toTransportResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.status === 'number' && Object.hasOwn(value, 'raw')) {
    return {
      status: value.status,
      raw: value.raw,
      response: value.response ?? { status: () => value.status },
    };
  }
  return {
    status: 200,
    raw: value,
    response: { status: () => 200 },
  };
}

export function createMemoryEndpointTransport(handlerOrOptions = {}) {
  const isFn = typeof handlerOrOptions === 'function';
  const initial = isFn ? {} : handlerOrOptions;
  let onEndpoint = isFn ? handlerOrOptions : (initial.onEndpoint ?? null);
  const responses = { ...(initial.responses ?? {}) };
  const errors = { ...(initial.errors ?? {}) };
  const queues = new Map();
  const calls = [];

  async function resolveOutcome(spec, params, ctx) {
    if (errors[spec.name]) throw errors[spec.name];
    const queue = queues.get(spec.name);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      const resolved = typeof next === 'function' ? await next(params, ctx, spec) : next;
      if (resolved instanceof Error) throw resolved;
      return resolved;
    }
    if (onEndpoint) {
      const resolved = await onEndpoint(spec, params, ctx);
      if (resolved instanceof Error) throw resolved;
      return resolved;
    }
    if (Object.hasOwn(responses, spec.name)) {
      const entry = responses[spec.name];
      const resolved = typeof entry === 'function' ? await entry(params, ctx, spec) : entry;
      if (resolved instanceof Error) throw resolved;
      return resolved;
    }
    throw new Error(`unexpected endpoint ${spec.name}`);
  }

  return {
    requiresPage: false,
    skipRateLimit: false,
    calls,
    responses,
    errors,
    setHandler(fn) {
      onEndpoint = fn;
    },
    set(name, value) {
      delete errors[name];
      queues.delete(name);
      responses[name] = value;
    },
    queue(name, ...values) {
      const existing = queues.get(name) ?? [];
      existing.push(...values);
      queues.set(name, existing);
    },
    fail(name, error) {
      errors[name] = error;
    },
    reset() {
      calls.length = 0;
      queues.clear();
      onEndpoint = isFn ? handlerOrOptions : (initial.onEndpoint ?? null);
      for (const key of Object.keys(responses)) delete responses[key];
      for (const key of Object.keys(errors)) delete errors[key];
      Object.assign(responses, initial.responses ?? {});
      Object.assign(errors, initial.errors ?? {});
    },
    async send(spec, params = {}, ctx = {}) {
      const payload = ctx.pageApiRequest?.payload
        ?? (typeof spec.buildPayload === 'function' ? spec.buildPayload(params, ctx) : undefined);
      calls.push({ name: spec.name, spec, params, page: ctx.page, payload, ctx });
      const outcome = await resolveOutcome(spec, params, ctx);
      return toTransportResult(outcome);
    },
  };
}

export function createTestCtx({
  transport,
  responses,
  errors,
  onEndpoint,
  page = null,
  mallId = null,
  mallCtx,
  log = { debug() {}, info() {}, warn() {}, error() {} },
  limiter,
  cooldownState = { map: new Map(), threshold: 3, ms: 300_000 },
  clock,
  ...extra
} = {}) {
  const resolvedTransport = typeof transport === 'function'
    ? createMemoryEndpointTransport(transport)
    : (transport && typeof transport.send === 'function'
      ? transport
      : createMemoryEndpointTransport({ responses, errors, onEndpoint }));
  const client = new EndpointClient({
    transport: resolvedTransport,
    limiter,
    cooldownState,
    clock,
  });
  const resolvedMallCtx = mallCtx !== undefined
    ? mallCtx
    : (mallId != null ? { activeId: String(mallId), activeName: '', malls: [], source: 'test' } : null);

  return {
    client,
    page,
    mallCtx: resolvedMallCtx,
    mallId: resolvedMallCtx?.activeId ?? (mallId != null ? String(mallId) : null),
    log,
    warnings: [],
    config: {},
    runtimeConfig: null,
    signal: undefined,
    deadlineAt: undefined,
    ...extra,
  };
}
