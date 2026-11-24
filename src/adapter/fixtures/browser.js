import { PddCliError, ExitCodes } from '../../infra/errors.js';

const OWNER_TAG_PATTERN = /^[a-z0-9-]{1,32}$/;

function browserRuntimeError(reason, message = '浏览器运行时配置无效') {
  return new PddCliError({
    code: 'E_BROWSER_RUNTIME',
    message,
    hint: '确认浏览器版本与当前操作系统受支持，并重新安装 Patchright Chromium',
    detail: { reason },
    exitCode: ExitCodes.GENERAL,
  });
}

function assertValidOwnerTag(ownerTag) {
  if (ownerTag !== undefined && (typeof ownerTag !== 'string' || !OWNER_TAG_PATTERN.test(ownerTag))) {
    throw browserRuntimeError('invalid_owner_tag');
  }
}

function assertValidStorageState(storageState, { required = false } = {}) {
  if (!storageState && !required) return;
  if (!Array.isArray(storageState?.cookies) || !Array.isArray(storageState?.origins)) {
    throw browserRuntimeError('snapshot_shape_invalid');
  }
}

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

/** Create an instance-scoped Fixture BrowserRuntimePort without loading Patchright. */
export function createFixtureBrowserRuntime({ available = true } = {}) {
  const activeSessions = new Set();
  const sessionRecords = new WeakMap();
  let closeAllInFlight = null;

  function activeRecord(session) {
    const record = session && typeof session === 'object' ? sessionRecords.get(session) : null;
    if (!record || record.closed) throw browserRuntimeError('browser_profile_missing');
    return record;
  }

  async function checkAvailability() {
    return { ok: Boolean(available), detail: { fixture: true } };
  }

  async function openSession({ headed = false, storageState, ownerTag } = {}) {
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
        activeSessions.delete(session);
        await page.close();
        await context.close();
      },
      async createSnapshotContext(snapshotState) {
        activeRecord(session);
        assertValidStorageState(snapshotState, { required: true });
        return makeFixtureContext(snapshotState);
      },
    });

    record.session = session;
    sessionRecords.set(session, record);
    activeSessions.add(session);
    return session;
  }

  async function withSession(optionsOrFn, maybeFn) {
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

  async function deriveConsumerContext(session, { storageState } = {}) {
    activeRecord(session);
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

  async function reclaimOrphans() {
    return 0;
  }

  async function closeAll() {
    if (closeAllInFlight) return closeAllInFlight;
    closeAllInFlight = (async () => {
      const snapshot = [...activeSessions];
      await Promise.allSettled(snapshot.map((session) => session.close()));
    })();
    try {
      return await closeAllInFlight;
    } finally {
      closeAllInFlight = null;
    }
  }

  return Object.freeze({
    checkAvailability,
    withSession,
    openSession,
    deriveConsumerContext,
    reclaimOrphans,
    closeAll,
  });
}
