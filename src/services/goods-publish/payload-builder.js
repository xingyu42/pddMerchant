import { PddCliError, ExitCodes } from '../../infra/errors.js';

function priceToCents(priceStr) {
  const n = parseFloat(String(priceStr ?? ''));
  if (!Number.isFinite(n) || n <= 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `价格无效: ${priceStr}`,
      hint: '确认源商品页面价格可正常提取',
      exitCode: ExitCodes.BUSINESS,
    });
  }
  return Math.round(n * 100);
}

export function buildGoodsEditPayload(draft, scraped, matched, category, costTemplateId) {
  if (!draft?.goods_id || !draft?.goods_commit_id) {
    throw new PddCliError({
      code: 'E_PAYLOAD_INVALID_DRAFT',
      message: 'draft must contain goods_id and goods_commit_id',
      exitCode: ExitCodes.USAGE,
    });
  }

  const name = scraped.goodsName || scraped.title || '';
  const cents = priceToCents(scraped.price);

  return {
    goods_id: draft.goods_id,
    goods_commit_id: draft.goods_commit_id,
    goods_name: name,
    goods_desc: name,
    cat_id: category.cat_id,
    cat_ids: category.cat_ids,
    cats: category.cats,
    market_price: Math.round(cents * 1.5),
    gallery: [],
    goods_properties: (matched.matched ?? []).map(m => ({
      template_pid: m.template_pid,
      template_module_id: m.template_module_id,
      ref_pid: m.ref_pid,
      pid: m.pid,
      vid: m.vid,
      value: m.value,
      value_unit: m.value_unit || '',
      content: m.content || '',
    })),
    skus: [{
      id: 0,
      is_onsale: 1,
      multi_price: cents,
      price: cents,
      quantity_delta: 999,
      thumb_url: '',
      spec: '',
      weight: 0,
    }],
    groups: {
      single_price: cents,
      group_price: cents,
      customer_num: 2,
      buy_limit: 999999,
    },
    cost_template_id: costTemplateId,
    shipment_limit_second: 172800,
    goods_type: 1,
    is_refundable: 1,
    propertys_tid: category.propertys_tid,
    validate_message: '',
    crawlerInfo: '',
  };
}

export function buildDecorationPayload(goodsCommitId, goodsId, detailImageUrls) {
  return {
    goods_commit_id: goodsCommitId,
    goods_id: goodsId,
    floor_list: (detailImageUrls ?? []).map(url => ({
      type: 'image',
      content_list: [{
        img_url: url,
        height: 800,
        width: 750,
      }],
    })),
  };
}
