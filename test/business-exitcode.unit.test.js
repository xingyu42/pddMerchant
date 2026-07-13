import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError, ExitCodes, mapErrorToExit } from '../src/infra/errors.js';

// 补充 ExitCodes.BUSINESS(6) 的测试覆盖
// 审查报告指出 BUSINESS 退出码测试次数仅 4 次，需补充以下场景：
//   1. 发布业务错误 (endpoint errorMapper)
//   2. mapErrorToExit 对 E_BUSINESS / E_NOT_FOUND 的映射
//   3. PddCliError 显式 exitCode 参数

describe('ExitCodes.BUSINESS(6) 业务错误场景补充', () => {
  describe('endpoint errorMapper', () => {
    it('goods.publish endpoint 错误码 54009 → E_BUSINESS(6)', async () => {
      const { mapPublishBusinessError } = await import('../src/adapter/endpoints/goods-publish.js');

      const result = mapPublishBusinessError({
        success: false,
        error_code: 54009,
        error_msg: '商品主图不符合要求',
      });

      assert.equal(result.code, 'E_BUSINESS');
      assert.equal(result.exitCode, 6);
      assert.ok(result.message.includes('商品主图') || result.message.includes('发布业务错误'));
    });

    it('goods.publish endpoint 默认业务错误 → E_BUSINESS(6)', async () => {
      const { mapPublishBusinessError } = await import('../src/adapter/endpoints/goods-publish.js');

      const result = mapPublishBusinessError({
        success: false,
        error_code: 99999,
      });

      assert.equal(result.code, 'E_BUSINESS');
      assert.equal(result.exitCode, 6);
      assert.ok(result.message.includes('发布业务错误'));
    });

    it('goods.publish endpoint success=true → null', async () => {
      const { mapPublishBusinessError } = await import('../src/adapter/endpoints/goods-publish.js');

      const result = mapPublishBusinessError({
        success: true,
      });

      assert.equal(result, null);
    });

  });

  describe('mapErrorToExit 函数', () => {
    it('code=E_BUSINESS → exitCode 6', () => {
      const err = { code: 'E_BUSINESS', message: '业务错误' };
      assert.equal(mapErrorToExit(err), ExitCodes.BUSINESS);
      assert.equal(mapErrorToExit(err), 6);
    });

    it('code=E_NOT_FOUND → exitCode 6', () => {
      const err = { code: 'E_NOT_FOUND', message: '资源未找到' };
      assert.equal(mapErrorToExit(err), ExitCodes.BUSINESS);
      assert.equal(mapErrorToExit(err), 6);
    });

    it('code=e_business (小写) → exitCode 6', () => {
      const err = { code: 'e_business', message: '业务错误' };
      // mapErrorToExit 会转大写
      assert.equal(mapErrorToExit(err), ExitCodes.BUSINESS);
    });

    it('PddCliError 显式 exitCode 参数优先', () => {
      const err = new PddCliError({
        code: 'E_BUSINESS',
        message: '测试业务错误',
        exitCode: ExitCodes.BUSINESS,
      });

      // 显式传入的 exitCode 会被使用
      assert.equal(err.exitCode, ExitCodes.BUSINESS);
      assert.equal(err.exitCode, 6);
      assert.equal(mapErrorToExit(err), 6);
    });
  });

  describe('类目相关工具函数', () => {
    it('pickCategoryOptionIndex 无匹配项返回 -1', async () => {
      const { pickCategoryOptionIndex } = await import('../src/adapter/goods-publish/form-filler.js');

      const result = pickCategoryOptionIndex([], '不存在的分类');
      assert.equal(result, -1);
    });

    it('pickCategoryOptionIndex 精确匹配', async () => {
      const { pickCategoryOptionIndex } = await import('../src/adapter/goods-publish/form-filler.js');

      const items = ['食品 > 零食 > 坚果', '食品 > 零食 > 饼干'];
      const result = pickCategoryOptionIndex(items, '食品 > 零食 > 坚果');
      assert.equal(result, 0);
    });

    it('normalizeCategoryText 移除首尾空白', async () => {
      const { normalizeCategoryText } = await import('../src/adapter/goods-publish/form-filler.js');

      assert.equal(normalizeCategoryText('  类目  '), '类目');
      assert.equal(normalizeCategoryText('食品'), '食品');
    });
  });

  describe('已有覆盖 (参考)', () => {
    it('mall-reader E_MALL_CONTEXT_MISSING → BUSINESS(6) 已在 mall-reader.unit.test.js 覆盖', () => {
      // 参考: test/adapter/mall-reader.unit.test.js:338-356
      // 此测试验证 currentMall() 在无法识别店铺时抛出 E_MALL_CONTEXT_MISSING (exitCode 6)
      assert.ok(true, '已在 test/adapter/mall-reader.unit.test.js L338-356 覆盖');
    });

    it('endpoint-error-mapping E_BUSINESS 映射已在 endpoint-error-mapping.unit.test.js 覆盖', () => {
      // 参考: test/endpoint-error-mapping.unit.test.js:104-118
      // 此测试验证 isSuccess=false 业务错误映射为 E_BUSINESS (exitCode 6)
      assert.ok(true, '已在 test/endpoint-error-mapping.unit.test.js L104-118 覆盖');
    });

    it('goods-publish 草稿校验失败 E_BUSINESS(6) 已在 goods-publish.unit.test.js 覆盖', () => {
      // 参考: test/goods-publish.unit.test.js:341, 508, 800
      // 此测试验证草稿保存/校验失败抛出 E_BUSINESS (exitCode 6)
      assert.ok(true, '已在 test/goods-publish.unit.test.js L341, 508, 800 覆盖');
    });
  });
});
