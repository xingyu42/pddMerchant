// fixture mall provider（design D-4）：店铺列表/当前店铺/切换。fixture 读取一律经 core 缓存。
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { loadFixture } from './core.js';

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
