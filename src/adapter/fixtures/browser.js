import {
  browserRuntimeError,
  assertValidOwnerTag,
  assertValidStorageState,
} from '../browser-validation.js';

function makeFixturePage(context) {
  return {
    __mock: true,
    context: () => context,
    url: () => 'https://mms.pinduoduo.com',
    goto: async () => {},
    close: async () => {},
  };
}

function makeFixtureContext(storageState) {
  const snapshot = structuredClone({
    cookies: storageState?.cookies ?? [],
    origins: storageState?.origins ?? [],
  });
  const context = {
    __mock: true,
    storageState: async () => structuredClone(snapshot),
    cookies: async () => structuredClone(snapshot.cookies),
    newPage: async () => makeFixturePage(context),
    close: async () => {},
  };
  return context;
}

// fixture browser provider（design D-4）：mock 浏览器三元组与关闭 no-op。
export function mockLaunchBrowser() {
  const page = { __mock: true };
  const context = { __mock: true };
  const browser = { __mock: true };
  return { browser, context, page };
}

export async function mockCloseBrowser() {
  // no-op
}

function resolveFixtureRecord(sessionRecords, session) {
  const record = session && typeof session === 'object' ? sessionRecords.get(session) : null;
  if (!record || record.closed) throw browserRuntimeError('browser_profile_missing');
  return record;
}

async function openFixtureSession({ headed = false, storageState, ownerTag } = {}, state) {
  assertValidOwnerTag(ownerTag);
  assertValidStorageState(storageState);

  const context = makeFixtureContext(storageState);
  const page = makeFixturePage(context);
  const record = {
    closed: false,
    profile: Object.freeze({ mode: headed ? 'headed' : 'headless', channel: 'fixture', version: 'fixture' }),
    session: null,
  };

  const session = Object.freeze({
    page,
    context,
    async close() {
      if (record.closed) return;
      record.closed = true;
      state.activeSessions.delete(session);
      await page.close();
      await context.close();
    },
    async createSnapshotContext(snapshotState) {
      resolveFixtureRecord(state.sessionRecords, session);
      assertValidStorageState(snapshotState, { required: true });
      return makeFixtureContext(snapshotState);
    },
  });

  record.session = session;
  state.sessionRecords.set(session, record);
  state.activeSessions.add(session);
  return session;
}

async function runFixtureWithSession(openSession, optionsOrFn, maybeFn) {
  const hasOptions = typeof optionsOrFn !== 'function';
  const options = hasOptions ? (optionsOrFn ?? {}) : {};
  const fn = hasOptions ? maybeFn : optionsOrFn;
  const session = await openSession(options);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}

async function deriveFixtureConsumerContext(state, session, { storageState } = {}) {
  resolveFixtureRecord(state.sessionRecords, session);
  assertValidStorageState(storageState);
  const context = makeFixtureContext(storageState);
  const page = makeFixturePage(context);
  return {
    context,
    page,
    async close() {
      await page.close();
      await context.close();
    },
  };
}

async function closeAllFixtureSessions(state) {
  if (state.closeAllInFlight) return state.closeAllInFlight;
  state.closeAllInFlight = (async () => {
    const snapshot = [...state.activeSessions];
    await Promise.allSettled(snapshot.map((session) => session.close()));
  })();
  try {
    return await state.closeAllInFlight;
  } finally {
    state.closeAllInFlight = null;
  }
}

/** Create an instance-scoped Fixture BrowserRuntimePort without loading Patchright. */
export function createFixtureBrowserRuntime({ available = true } = {}) {
  const state = {
    activeSessions: new Set(),
    sessionRecords: new WeakMap(),
    closeAllInFlight: null,
  };
  const openSession = (options) => openFixtureSession(options, state);

  return Object.freeze({
    checkAvailability: async () => ({ ok: Boolean(available), detail: { fixture: true } }),
    withSession: (optionsOrFn, maybeFn) => runFixtureWithSession(openSession, optionsOrFn, maybeFn),
    openSession,
    deriveConsumerContext: (session, opts) => deriveFixtureConsumerContext(state, session, opts),
    reclaimOrphans: async () => 0,
    closeAll: () => closeAllFixtureSessions(state),
  });
}
