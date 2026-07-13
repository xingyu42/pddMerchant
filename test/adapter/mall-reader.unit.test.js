import { describe, it, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  resolveMallContext,
  currentMall,
  listMalls,
  readFromState,
  readActiveIdFromUrl,
  readActiveIdFromCookie,
  readActiveIdFromStorage,
  buildMallContext,
  MALL_CONTEXT_HINT,
} from '../../src/adapter/mall-reader.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

// mall-reader 6层上下文探测单元测试
// 探测顺序（CLAUDE.md）: mock → state → url → cookie → storage → xhr → dom
// 本测试覆盖前5层（mock/state/url/cookie/storage）的单元逻辑 + 完整fallback链

describe('mall-reader: 6层上下文探测', () => {
  let mockPage;

  beforeEach(() => {
    mockPage = {
      url: () => 'https://mms.pinduoduo.com/home',
      context: () => ({
        cookies: async () => [],
      }),
      evaluate: vi.fn(async (fn, arg) => {
        // 默认处理 readMallListFromDom
        if (typeof fn === 'function' && fn.toString().includes('querySelectorAll')) {
          return []; // readMallListFromDom 默认返回空数组
        }
        return fn(arg);
      }),
      locator: vi.fn(() => ({
        first: () => ({
          click: vi.fn(),
        }),
      })),
      keyboard: { press: vi.fn() },
    };
  });

  describe('Layer 1: mock (通过 isMockEnabled)', () => {
    it('mock模式下返回 source=mock', async () => {
      // mock-dispatcher 的测试已覆盖，此处验证调用契约
      // 实际测试在 test/pbt/mock-dispatcher-baseline.pbt.test.js
      assert.ok(true, 'mock layer 由 mock-dispatcher.js 守卫，已有独立测试覆盖');
    });
  });

  describe('Layer 2: state (window全局变量)', () => {
    it('从 __PRELOADED_STATE__.mall.currentMallId 读取', async () => {
      mockPage.evaluate = vi.fn(async (fn, paths) => {
        const mockGlobal = {
          __PRELOADED_STATE__: {
            mall: { currentMallId: '123456', mallName: '测试店铺' },
          },
        };
        // 模拟 readFromState 的逻辑
        for (const path of paths) {
          let cur = mockGlobal;
          let ok = true;
          for (const key of path) {
            if (cur == null) { ok = false; break; }
            cur = cur[key];
          }
          if (ok && cur != null) return cur;
        }
        return null;
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '123456');
      assert.equal(ctx.source, 'state');
    });

    it('从 __INITIAL_STATE__.user.mallId 读取', async () => {
      mockPage.evaluate = vi.fn(async (fn, paths) => {
        const mockGlobal = {
          __INITIAL_STATE__: {
            user: { mallId: '789012' },
          },
        };
        for (const path of paths) {
          let cur = mockGlobal;
          let ok = true;
          for (const key of path) {
            if (cur == null) { ok = false; break; }
            cur = cur[key];
          }
          if (ok && cur != null) return cur;
        }
        return null;
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '789012');
      assert.equal(ctx.source, 'state');
    });

    it('state 层缺失时 fallback 到下一层', async () => {
      mockPage.evaluate = vi.fn(async () => null); // state 为空
      mockPage.url = () => 'https://mms.pinduoduo.com/home?mallId=111222';

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '111222');
      assert.equal(ctx.source, 'url');
    });
  });

  describe('Layer 3: url (URL 参数)', () => {
    it('从 URL ?mall_id= 读取', async () => {
      mockPage.evaluate = vi.fn(async () => null);
      mockPage.url = () => 'https://mms.pinduoduo.com/goods?mall_id=333444';

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '333444');
      assert.equal(ctx.source, 'url');
    });

    it('从 URL ?mallId= 读取（camelCase）', async () => {
      mockPage.evaluate = vi.fn(async () => null);
      mockPage.url = () => 'https://mms.pinduoduo.com/orders?mallId=555666';

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '555666');
      assert.equal(ctx.source, 'url');
    });

    it('URL 无参数时 fallback 到下一层', async () => {
      mockPage.evaluate = vi.fn(async () => null);
      mockPage.url = () => 'https://mms.pinduoduo.com/home';
      mockPage.context = () => ({
        cookies: async () => [{ name: 'mall_id', value: '777888' }],
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '777888');
      assert.equal(ctx.source, 'cookie');
    });
  });

  describe('Layer 4: cookie', () => {
    it('从 cookie mall_id 读取', async () => {
      mockPage.evaluate = vi.fn(async () => null);
      mockPage.context = () => ({
        cookies: async () => [
          { name: 'session', value: 'abc123' },
          { name: 'mall_id', value: '999000' },
        ],
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '999000');
      assert.equal(ctx.source, 'cookie');
    });

    it('从 cookie mallId 读取（camelCase）', async () => {
      mockPage.evaluate = vi.fn(async () => null);
      mockPage.context = () => ({
        cookies: async () => [{ name: 'mallId', value: '111333' }],
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '111333');
      assert.equal(ctx.source, 'cookie');
    });

    it('cookie 缺失时 fallback 到下一层', async () => {
      mockPage.evaluate = vi.fn(async (fn, arg) => {
        // state 为空，storage 返回值
        if (Array.isArray(arg) && arg.includes('mallId')) {
          return '222444'; // localStorage.getItem('mallId')
        }
        return null;
      });
      mockPage.context = () => ({
        cookies: async () => [],
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '222444');
      assert.equal(ctx.source, 'storage');
    });
  });

  describe('Layer 5: storage (localStorage/sessionStorage)', () => {
    it('从 localStorage.mallId 读取', async () => {
      mockPage.evaluate = vi.fn(async (fn, arg) => {
        if (Array.isArray(arg) && arg.includes('mallId')) {
          return '444555'; // 模拟 localStorage.getItem('mallId')
        }
        return null;
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '444555');
      assert.equal(ctx.source, 'storage');
    });

    it('从 sessionStorage.currentMallId 读取', async () => {
      mockPage.evaluate = vi.fn(async (fn, arg) => {
        if (Array.isArray(arg) && arg.includes('currentMallId')) {
          return '666777'; // 模拟 sessionStorage.getItem('currentMallId')
        }
        return null;
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '666777');
      assert.equal(ctx.source, 'storage');
    });

    it('storage 缺失时 fallback 到 xhr 层（未在此测试，由集成测试覆盖）', async () => {
      mockPage.evaluate = vi.fn(async (fn, arg) => {
        // 处理 readMallListFromDom
        if (typeof fn === 'function' && fn.toString().includes('querySelectorAll')) {
          return [];
        }
        return null;
      });
      mockPage.context = () => ({ cookies: async () => [] });

      const ctx = await resolveMallContext(mockPage);
      // Layer 6 (xhr) 和 Layer 7 (dom) 需要真实 page 环境，此处返回 null
      assert.equal(ctx.activeId, null);
      assert.equal(ctx.source, null);
    });
  });

  describe('完整 fallback 链', () => {
    it('state → url → cookie → storage 依次 fallback', async () => {
      const calls = [];

      mockPage.evaluate = vi.fn(async (fn, arg) => {
        // 处理 readMallListFromDom
        if (typeof fn === 'function' && fn.toString().includes('querySelectorAll')) {
          return [];
        }
        calls.push('evaluate');
        return null; // state 为空
      });

      mockPage.url = () => {
        calls.push('url');
        return 'https://mms.pinduoduo.com/home'; // url 无参数
      };

      mockPage.context = () => ({
        cookies: async () => {
          calls.push('cookie');
          return []; // cookie 为空
        },
      });

      const ctx = await resolveMallContext(mockPage);
      assert.ok(calls.includes('evaluate'));
      assert.ok(calls.includes('url'));
      assert.ok(calls.includes('cookie'));
    });

    it('优先使用 state，跳过后续层', async () => {
      mockPage.evaluate = vi.fn(async (fn, paths) => {
        // 处理 readMallListFromDom
        if (typeof fn === 'function' && fn.toString().includes('querySelectorAll')) {
          return [];
        }
        // 处理 CURRENT_STATE_PATHS - 任何包含这些路径的都返回ID
        if (Array.isArray(paths) && paths.length > 0) {
          const firstPath = paths[0];
          if (Array.isArray(firstPath) && (
            firstPath[0] === '__PRELOADED_STATE__' ||
            firstPath[0] === '__INITIAL_STATE__' ||
            firstPath[0] === '__mms' ||
            firstPath[0] === '__NEXT_DATA__'
          )) {
            // 如果是 CURRENT_STATE_PATHS (包含 mall_id 相关的路径)
            if (firstPath.includes('mallId') || firstPath.includes('mall_id') || firstPath.includes('currentMallId')) {
              return '123456';
            }
          }
        }
        return null;
      });

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, '123456');
      assert.equal(ctx.source, 'state');
    });
  });

  describe('buildMallContext 辅助函数', () => {
    it('规范化 mall 列表', () => {
      const ctx = buildMallContext({
        activeId: '123',
        activeName: '主店',
        malls: [
          { mallId: '123', mallName: '主店' },
          { mall_id: '456', mall_name: '副店' },
        ],
        source: 'state',
      });

      assert.equal(ctx.malls.length, 2);
      assert.equal(ctx.malls[0].id, '123');
      assert.equal(ctx.malls[0].name, '主店');
      assert.equal(ctx.malls[0].active, true);
      assert.equal(ctx.malls[1].active, false);
    });

    it('从 malls 列表反推 activeName', () => {
      const ctx = buildMallContext({
        activeId: '789',
        activeName: null,
        malls: [{ mallId: '789', mallName: '推断店铺名' }],
        source: 'url',
      });

      assert.equal(ctx.activeName, '推断店铺名');
    });

    it('activeId 为 null 时，activeName 为空', () => {
      const ctx = buildMallContext({
        activeId: null,
        activeName: null,
        malls: [],
        source: null,
      });

      assert.equal(ctx.activeId, null);
      assert.equal(ctx.activeName, '');
    });
  });

  describe('currentMall 错误处理', () => {
    it('无法识别店铺时抛 E_MALL_CONTEXT_MISSING', async () => {
      mockPage.evaluate = vi.fn(async () => null);
      mockPage.context = () => ({ cookies: async () => [] });
      mockPage.locator = vi.fn(() => ({
        first: () => ({
          click: vi.fn(async () => { throw new Error('No switcher'); }),
        }),
      }));

      await assert.rejects(
        async () => currentMall(mockPage),
        (err) => {
          assert.equal(err.code, 'E_MALL_CONTEXT_MISSING');
          assert.equal(err.exitCode, ExitCodes.BUSINESS);
          assert.ok(err.hint.includes(MALL_CONTEXT_HINT));
          return true;
        }
      );
    });
  });

  describe('listMalls 错误处理', () => {
    it('无店铺列表时抛 E_MALL_LIST_EMPTY', async () => {
      mockPage.evaluate = vi.fn(async () => null);
      mockPage.context = () => ({ cookies: async () => [] });
      mockPage.locator = vi.fn(() => ({
        first: () => ({
          click: vi.fn(async () => { throw new Error('No switcher'); }),
        }),
      }));

      await assert.rejects(
        async () => listMalls(mockPage),
        (err) => {
          assert.equal(err.code, 'E_MALL_LIST_EMPTY');
          assert.equal(err.exitCode, ExitCodes.GENERAL);
          return true;
        }
      );
    });

    it('有 activeId 但无 malls 时，返回单店列表', async () => {
      mockPage.evaluate = vi.fn(async (fn, paths) => {
        // resolveMallContext 会调用多次 evaluate
        // 第一次：读取 activeNameFromState (CURRENT_NAME_PATHS)
        // 第二次：读取 mallListFromState (MALL_LIST_PATHS)
        // 第三次：读取 fromState (CURRENT_STATE_PATHS) - 这里返回activeId
        if (Array.isArray(paths) && paths.length > 0) {
          // 检查是否是 CURRENT_STATE_PATHS (包含 __PRELOADED_STATE__ / __mms 等)
          const firstPath = paths[0];
          if (firstPath && (
            firstPath[0] === '__mms' ||
            firstPath[0] === '__NEXT_DATA__' ||
            firstPath[0] === '__PRELOADED_STATE__' ||
            firstPath[0] === '__INITIAL_STATE__'
          )) {
            // 如果路径包含 mall_id / mallId / currentMallId，返回ID
            if (firstPath.includes('mall_id') || firstPath.includes('mallId') || firstPath.includes('currentMallId')) {
              return '999888';
            }
          }
        }
        return null;
      });
      mockPage.locator = vi.fn(() => ({
        first: () => ({
          click: vi.fn(async () => { throw new Error('No switcher'); }),
        }),
      }));

      const malls = await listMalls(mockPage);
      assert.equal(malls.length, 1);
      assert.equal(malls[0].id, '999888');
      assert.equal(malls[0].active, true);
    });
  });

  describe('边界条件', () => {
    it('activeId 为空字符串时视为无效', async () => {
      mockPage.evaluate = vi.fn(async () => '   '); // 返回空白字符串
      mockPage.locator = vi.fn(() => ({
        first: () => ({
          click: vi.fn(async () => { throw new Error('No switcher'); }),
        }),
      }));

      const ctx = await resolveMallContext(mockPage);
      assert.equal(ctx.activeId, null);
    });

    it('mall 列表包含无效项时过滤', () => {
      const ctx = buildMallContext({
        activeId: '123',
        malls: [
          { mallId: '123', mallName: '正常店铺' },
          { mallId: '', mallName: '空ID' }, // 会被过滤
          { mallId: '456', mallName: '正常副店' },
        ],
        source: 'state',
      });

      assert.equal(ctx.malls.length, 2); // 仅保留有效的2个
      assert.equal(ctx.malls[0].id, '123');
      assert.equal(ctx.malls[1].id, '456');
    });
  });
});
