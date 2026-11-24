// fixture mall provider（design D-4）：店铺列表/当前店铺/切换。fixture 读取一律经 core 缓存。
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { FixtureStore, loadFixture } from './core.js';
import { buildMallContext, normalizeMallRecord } from '../mall-context.js';
import { requireMallId } from '../mall-id.js';

export function mockListMalls() {
  return loadFixture('shops.list.json');
}

export function mockCurrentMall() {
  return loadFixture('shops.current.json');
}

export function mockSwitchTo(mallId) {
  const target = String(mallId ?? '');
  if (!target) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: 'switchTo: mallId 必填',
      exitCode: ExitCodes.USAGE,
    });
  }
  const list = loadFixture('shops.list.json');
  const found = Array.isArray(list)
    ? list.find((m) => String(m?.id) === target)
    : null;
  if (!found) {
    throw new PddCliError({
      code: 'E_MALL_NOT_FOUND',
      message: `未找到店铺 ${target}`,
      hint: '执行 pdd shops list 查看可用店铺',
      exitCode: ExitCodes.USAGE,
    });
  }
  return { ...found, active: true };
}

/** Create an instance-scoped Fixture MallPort sharing live normalization and mall_id validation. */
export function createFixtureMallPort({ fixtureStore = new FixtureStore() } = {}) {
  let activeOverride = null;

  function readOptionalList() {
    try {
      const loaded = fixtureStore.load('shops.list.json');
      return Array.isArray(loaded) ? loaded : [];
    } catch (error) {
      if (error?.code !== 'E_FIXTURE_MISSING') throw error;
      return [];
    }
  }

  function readOptionalCurrent() {
    if (activeOverride) return activeOverride;
    try {
      const normalized = normalizeMallRecord(fixtureStore.load('shops.current.json'));
      return normalized.id ? { id: normalized.id, name: normalized.name } : null;
    } catch (error) {
      if (error?.code !== 'E_FIXTURE_MISSING') throw error;
      return null;
    }
  }

  async function detectCurrentMall() {
    const current = activeOverride ?? normalizeMallRecord(fixtureStore.load('shops.current.json'));
    const rawMalls = readOptionalList();
    return buildMallContext({
      activeId: current?.id || null,
      activeName: current?.name ?? '',
      malls: rawMalls,
      source: 'mock',
    });
  }

  async function listMalls() {
    const loaded = fixtureStore.load('shops.list.json');
    const current = readOptionalCurrent();
    const ctx = buildMallContext({
      activeId: current?.id ?? null,
      activeName: current?.name ?? '',
      malls: Array.isArray(loaded) ? loaded : [],
      source: 'mock',
    });
    if (ctx.malls.length > 0) return ctx.malls;
    if (ctx.activeId) return [{ id: ctx.activeId, name: ctx.activeName, is_current: true }];
    throw new PddCliError({
      code: 'E_MALL_LIST_EMPTY',
      message: '未能获取店铺列表',
      hint: '确认已登录，或手动在浏览器中点击店铺切换下拉确认 UI',
      exitCode: ExitCodes.GENERAL,
    });
  }

  async function switchMall(_target, mallId, { strict } = {}) {
    const validatedId = requireMallId(mallId, { strict });
    const before = await detectCurrentMall().catch(() => null);
    if (before?.activeId === validatedId) {
      return { id: before.activeId, name: before.activeName, source: before.source };
    }
    const malls = await listMalls().catch((error) => {
      if (error?.code === 'E_MALL_LIST_EMPTY') return [];
      throw error;
    });
    const found = malls.find((item) => item.id === validatedId);
    if (!found) {
      throw new PddCliError({
        code: 'E_MALL_NOT_FOUND',
        message: `未找到店铺 ${validatedId}`,
        hint: '执行 pdd shops list 查看可用店铺',
        exitCode: ExitCodes.USAGE,
      });
    }
    activeOverride = { id: found.id, name: found.name };
    return { id: found.id, name: found.name, source: 'mock' };
  }

  return Object.freeze({
    detectCurrentMall,
    listMalls,
    switchMall,
  });
}
