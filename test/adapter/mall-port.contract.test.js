import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import { createLiveMallPort, SWITCHER_TRIGGER_SELECTORS } from '../../src/adapter/mall-port.js';
import { createFixtureMallPort } from '../../src/adapter/fixtures/mall.js';
import { FixtureStore } from '../../src/adapter/fixtures/core.js';
import { createInMemoryMallPort } from '../helpers/in-memory-ports.js';
import { createCliSandbox } from '../helpers/isolated-cli.js';
import { toCurrentShopView, toShopListView } from '../../src/services/views/shops.js';

function createFakeMallPage({
  activeId = '900001',
  activeName = 'Shop A',
  malls = [
    { mallId: 900001, mallName: 'Shop A' },
    { mallId: 900002, mallName: 'Shop B' },
  ],
  hasSwitcher = true,
  switchOutcome = 'success',
} = {}) {
  const state = { activeId, activeName, malls };
  const page = {
    url: () => 'https://mms.pinduoduo.com/home',
    context: () => ({ cookies: async () => [] }),
    keyboard: { press: async () => {} },
    waitForLoadState: async () => {},
    async evaluate(fn, arg) {
      const previous = {
        __PRELOADED_STATE__: globalThis.__PRELOADED_STATE__,
      };
      globalThis.__PRELOADED_STATE__ = {
        mall: {
          currentMallId: state.activeId,
          mallName: state.activeName,
          mallList: state.malls,
        },
      };
      try {
        return fn(arg);
      } finally {
        globalThis.__PRELOADED_STATE__ = previous.__PRELOADED_STATE__;
      }
    },
    getByTestId(testId) {
      return {
        async click() {
          if (!hasSwitcher) throw new Error('missing switcher');
          const targetId = testId.replace('mall-option-', '');
          const found = state.malls.find((item) => String(item.mallId) === targetId);
          if (!found) throw new Error('option not found');
          if (switchOutcome === 'success') {
            state.activeId = String(found.mallId);
            state.activeName = found.mallName;
          } else if (switchOutcome === 'mismatch') {
            state.activeId = '999999';
          }
        },
      };
    },
    locator(selector) {
      return {
        first() {
          return {
            async click() {
              if (!hasSwitcher) throw new Error('missing switcher');
              if (SWITCHER_TRIGGER_SELECTORS.includes(selector)) return;
              throw new Error(`selector not matched: ${selector}`);
            },
          };
        },
      };
    },
  };
  return { page, state };
}

const sandboxes = [];
afterEach(() => {
  while (sandboxes.length > 0) {
    sandboxes.pop().dispose();
  }
});

const ADAPTER_FACTORIES = [
  {
    name: 'live',
    create: (opts = {}) => {
      const { page } = createFakeMallPage({
        activeId: opts.activeId === undefined ? '900001' : opts.activeId,
        activeName: opts.activeName ?? 'Shop A',
        malls: opts.malls ?? [
          { mallId: 900001, mallName: 'Shop A' },
          { mallId: 900002, mallName: 'Shop B' },
        ],
      });
      return {
        port: createLiveMallPort(),
        target: page,
      };
    },
  },
  {
    name: 'fixture',
    create: (opts = {}) => {
      const activeId = opts.activeId === undefined ? '900001' : opts.activeId;
      const activeName = opts.activeName ?? 'Shop A';
      const rawMalls = opts.malls ?? [
        { mallId: 900001, mallName: 'Shop A' },
        { mallId: 900002, mallName: 'Shop B' },
      ];
      const sandbox = createCliSandbox({
        'shops.current.json': activeId != null ? { mallId: activeId, mallName: activeName } : {},
        'shops.list.json': rawMalls,
      });
      sandboxes.push(sandbox);
      return {
        port: createFixtureMallPort({ fixtureStore: new FixtureStore({ fixtureDir: sandbox.fixtureDir }) }),
        target: null,
      };
    },
  },
  {
    name: 'in-memory',
    create: (opts = {}) => ({
      port: createInMemoryMallPort({
        currentMall: (opts.activeId === undefined ? '900001' : opts.activeId) != null
          ? { id: opts.activeId === undefined ? '900001' : opts.activeId, name: opts.activeName ?? 'Shop A' }
          : null,
        malls: opts.malls ?? [
          { mallId: 900001, mallName: 'Shop A' },
          { mallId: 900002, mallName: 'Shop B' },
        ],
      }),
      target: null,
    }),
  },
];

describe.each(ADAPTER_FACTORIES)('MallPort shared contract ($name)', ({ create }) => {
  it('detectCurrentMall and listMalls normalize upstream records into isomorphic shop views', async () => {
    const { port, target } = create();
    const detected = await port.detectCurrentMall(target);
    assert.equal(detected.activeId, '900001');
    assert.equal(detected.activeName, 'Shop A');
    assert.equal(typeof detected.source, 'string');
    assert.deepEqual(detected.malls, [
      { id: '900001', name: 'Shop A', is_current: true },
      { id: '900002', name: 'Shop B', is_current: false },
    ]);

    const malls = await port.listMalls(target);
    assert.deepEqual(malls, [
      { id: '900001', name: 'Shop A', is_current: true },
      { id: '900002', name: 'Shop B', is_current: false },
    ]);

    const listView = toShopListView(malls, detected.activeId);
    assert.deepEqual(listView.items, [
      { mall_id: '900001', name: 'Shop A', is_current: true },
      { mall_id: '900002', name: 'Shop B', is_current: false },
    ]);
    assert.equal(toCurrentShopView(detected).mall_id, '900001');
  });

  it('switchMall validates strict boolean and mallId format before switching', async () => {
    const { port, target } = create();
    await assert.rejects(
      port.switchMall(target, '900002'),
      { code: 'E_CONFIG_INVALID' },
    );
    await assert.rejects(
      port.switchMall(target, 'non-numeric', { strict: true }),
      { code: 'E_USAGE' },
    );
    await assert.rejects(
      port.switchMall(target, '  ', { strict: false }),
      { code: 'E_USAGE' },
    );
  });

  it('switchMall updates active mall and rejects unknown mall IDs with E_MALL_NOT_FOUND', async () => {
    const { port, target } = create();
    await assert.rejects(
      port.switchMall(target, '999999', { strict: true }),
      { code: 'E_MALL_NOT_FOUND' },
    );

    const switched = await port.switchMall(target, '900002', { strict: true });
    assert.equal(switched.id, '900002');
    assert.equal(switched.name, 'Shop B');
    assert.equal(typeof switched.source, 'string');

    const after = await port.detectCurrentMall(target);
    assert.equal(after.activeId, '900002');
    assert.deepEqual(await port.listMalls(target), [
      { id: '900001', name: 'Shop A', is_current: false },
      { id: '900002', name: 'Shop B', is_current: true },
    ]);
  });

  it('throws E_MALL_LIST_EMPTY when no shops and no active mall exist', async () => {
    const { port, target } = create({ activeId: null, activeName: '', malls: [] });
    await assert.rejects(port.listMalls(target), { code: 'E_MALL_LIST_EMPTY' });
  });
});

describe('Live & Fixture MallPort boundary behaviors', () => {
  it('Live MallPort probes url/cookie fallback and reports switcher errors deterministically', async () => {
    const port = createLiveMallPort();
    const urlPage = {
      url: () => 'https://mms.pinduoduo.com/orders?mall_id=900003',
      context: () => ({ cookies: async () => [] }),
    };
    const detected = await port.detectCurrentMall(urlPage);
    assert.equal(detected.activeId, '900003');
    assert.equal(detected.source, 'url');

    const noUi = createFakeMallPage({ hasSwitcher: false });
    await assert.rejects(
      port.switchMall(noUi.page, '900002', { strict: true }),
      { code: 'E_MALL_SWITCH_NO_UI' },
    );

    const mismatch = createFakeMallPage({ switchOutcome: 'mismatch' });
    await assert.rejects(
      port.switchMall(mismatch.page, '900002', { strict: true }),
      { code: 'E_MALL_SWITCH_FAILED' },
    );
  });

  it('Fixture MallPort fails with E_FIXTURE_MISSING when shops fixtures are absent', async () => {
    const sandbox = createCliSandbox();
    sandboxes.push(sandbox);
    const emptyDir = `${sandbox.root}/missing-fixtures`;
    const port = createFixtureMallPort({ fixtureStore: new FixtureStore({ fixtureDir: emptyDir }) });
    await assert.rejects(port.detectCurrentMall(null), { code: 'E_FIXTURE_MISSING' });
    await assert.rejects(port.listMalls(null), { code: 'E_FIXTURE_MISSING' });
  });
});
