import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { isMockEnabled, loadFixture } from '../mock-dispatcher.js';

const CATEGORY_API_BASE = process.env.PDD_CATEGORY_API_BASE || 'https://api.gj.dangxun.com';

export async function resolvePddCategory(catId3, catId1, catId2) {
  if (isMockEnabled()) return loadFixture('goods-publish/category.json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  let response;
  try {
    response = await fetch(
      `${CATEGORY_API_BASE}/api/v1/crx/PddCate?last_cate_id=${catId3}`,
      { signal: controller.signal }
    );
  } catch (err) {
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `类目 API 请求失败: ${err.message}`,
      exitCode: ExitCodes.NETWORK,
    });
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `类目 API 响应解析失败: ${err.message}`,
      exitCode: ExitCodes.NETWORK,
    });
  }

  if (body.code !== 1 || !body.data) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `类目解析失败 (catId=${catId3})`,
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const data = body.data;
  return {
    root: data.root,
    cates: data.cates,
    cat_id: Number(catId3),
    cat_ids: [Number(catId1), Number(catId2), Number(catId3), null],
    cats: [data.cates[0] || null, data.cates[1] || null, data.cates[2] || null, null],
  };
}

export function buildCategorySearchText(resolved) {
  const cats = (resolved.cates || resolved.cats || []).filter(Boolean);
  return cats.join(' > ');
}
