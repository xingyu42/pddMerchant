import { withCommand } from '../../_runner.js';
import { PddCliError, ExitCodes } from '../../../infra/errors.js';
import { executeGoodsBatchWrite, GOODS_WRITE_FIELDS } from '../../../services/goods-write.js';

const CHANGES_FORMAT = '格式: [{"goods_id":1001,"field":"price_yuan","value":29.9}]（价格单位为元）';

// 旧字段 price（单位分）已移除：显式拒绝，避免被当作元静默提交
function assertField(field, index) {
  if (field === 'price') {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `changes[${index}].field "price" 已移除，请改用 "price_yuan"（单位：元）`,
      hint: CHANGES_FORMAT,
      exitCode: ExitCodes.USAGE,
    });
  }
  if (!field || !GOODS_WRITE_FIELDS.includes(field)) {
    throw new PddCliError({
      code: 'E_USAGE',
      message: `changes[${index}].field 必须为 ${GOODS_WRITE_FIELDS.join('|')}，收到: ${field}`,
      hint: CHANGES_FORMAT,
      exitCode: ExitCodes.USAGE,
    });
  }
}

function parseChanges(raw) {
  let items;
  if (typeof raw === 'string') {
    try {
      items = JSON.parse(raw);
    } catch {
      throw new PddCliError({
        code: 'E_USAGE',
        message: '--changes JSON 解析失败',
        hint: CHANGES_FORMAT,
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
      hint: CHANGES_FORMAT,
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
    assertField(field, i);
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
    const items = parseChanges(changes);
    const { data, exitCode } = await executeGoodsBatchWrite(ctx, items, { confirm });
    const xhrCount = data.dry_run ? 0 : data.results.length;
    return { data, meta: { xhr_count: xhrCount, exit_code: exitCode } };
  },
});

export default run;
