import { withCommand } from '../../../infra/command-runner.js';
import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import {
  validateGoodsId,
  validateWriteValue,
  updateGoodsStatus,
  updateGoodsPrice,
  updateGoodsStock,
  updateGoodsTitle,
} from '../../../services/goods.js';

const FIELD_HANDLERS = {
  status: updateGoodsStatus,
  price: updateGoodsPrice,
  stock: updateGoodsStock,
  title: updateGoodsTitle,
};

const FIELD_VALUE_KEY = {
  status: 'status',
  price: 'price',
  stock: 'quantity',
  title: 'title',
};

function parseChanges(raw) {
  let items;
  if (typeof raw === 'string') {
    try {
      items = JSON.parse(raw);
    } catch {
      throw new PddCliError({
        code: 'E_USAGE',
        message: '--changes JSON 解析失败',
        hint: '格式: [{"goods_id":1001,"field":"price","value":2999}]',
        exitCode: ExitCodes.USAGE,
      });
    }
  } else {
    items = raw;
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '--changes 必须为非空 JSON 数组',
      hint: '格式: [{"goods_id":1001,"field":"price","value":2999}]',
      exitCode: ExitCodes.USAGE,
    });
  }
  return items.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new PddCliError({
        code: 'E_USAGE',
        message: `changes[${i}] 必须为对象`,
        exitCode: ExitCodes.USAGE,
      });
    }
    const { goods_id, field, value } = item;
    if (!field || !FIELD_HANDLERS[field]) {
      throw new PddCliError({
        code: 'E_USAGE',
        message: `changes[${i}].field 必须为 status|price|stock|title，收到: ${field}`,
        exitCode: ExitCodes.USAGE,
      });
    }
    return { goods_id, field, value };
  });
}

export const run = withCommand({
  name: 'goods.update.batch',
  needsAuth: true,
  needsMall: 'switch',
  allowAllAccounts: false,
  async run(ctx) {
    const { changes, confirm } = ctx.config;
    const mallId = ctx.mallCtx?.activeId ?? null;
    const items = parseChanges(changes);

    for (const item of items) {
      validateGoodsId(item.goods_id);
      validateWriteValue(item.field, item.value);
    }

    if (!confirm) {
      return {
        data: {
          planned: items.map((it) => ({
            goods_id: Number(it.goods_id),
            field: it.field,
            value: it.value,
          })),
          count: items.length,
          dry_run: true,
        },
        meta: { xhr_count: 0, mall: mallId },
      };
    }

    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (const item of items) {
      const id = Number(item.goods_id);
      const handler = FIELD_HANDLERS[item.field];
      const valueKey = FIELD_VALUE_KEY[item.field];
      try {
        await handler(ctx.page, id, item.value, ctx);
        results.push({ goods_id: id, field: item.field, ok: true });
        succeeded++;
      } catch (err) {
        results.push({
          goods_id: id,
          field: item.field,
          ok: false,
          error: err.code ?? 'E_GENERAL',
          message: err.message ?? '',
        });
        failed++;
      }
    }

    const exitCode = failed > 0 && succeeded > 0
      ? ExitCodes.PARTIAL
      : failed > 0
        ? ExitCodes.BUSINESS
        : ExitCodes.OK;

    return {
      data: { succeeded, failed, results, dry_run: false },
      meta: {
        xhr_count: succeeded + failed,
        mall: mallId,
        confirm: true,
        exit_code: exitCode,
      },
    };
  },
});

export default run;
