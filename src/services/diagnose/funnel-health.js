export function scoreFunnelHealth({ data } = {}) {
  if (!data) {
    return {
      score: null,
      status: 'partial',
      issues: [],
      hints: ['funnel 分析需 DMP 数据源（V0 未覆盖，待 V0.1）'],
      detail: {},
    };
  }

  const visitors = Number(data.visitors ?? 0);
  const addCart = Number(data.add_cart ?? data.addCart ?? 0);
  const orders = Number(data.orders ?? 0);
  const paid = Number(data.paid ?? 0);

  if (visitors === 0) {
    return {
      score: null,
      status: 'partial',
      issues: ['访客数为 0'],
      hints: ['确认 SYCM 数据接入与日期范围'],
      detail: { visitors, add_cart: addCart, orders, paid },
    };
  }

  const issues = [];
  const hints = [];
  let score = 100;

  const cartRate = visitors > 0 ? addCart / visitors : 0;
  const orderRate = addCart > 0 ? orders / addCart : 0;
  const paidRate = orders > 0 ? paid / orders : 0;
  const overall = visitors > 0 ? paid / visitors : 0;

  if (cartRate < 0.02 && visitors > 100) {
    score -= 25;
    issues.push(`加购率 ${(cartRate * 100).toFixed(2)}%（<2%）`);
    hints.push('优化详情页主图与价格卖点');
  }

  if (orderRate < 0.10 && addCart > 10) {
    score -= 20;
    issues.push(`下单率 ${(orderRate * 100).toFixed(1)}%（<10%）`);
    hints.push('排查加购后流失原因');
  }

  if (paidRate < 0.80 && orders > 5) {
    score -= 25;
    issues.push(`支付率 ${(paidRate * 100).toFixed(1)}%（<80%）`);
    hints.push('审视支付流程异常');
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const status = finalScore >= 80 ? 'green' : finalScore >= 50 ? 'yellow' : 'red';

  return {
    score: finalScore,
    status,
    issues,
    hints,
    detail: {
      visitors,
      add_cart: addCart,
      orders,
      paid,
      cart_rate: Number(cartRate.toFixed(4)),
      order_rate: Number(orderRate.toFixed(4)),
      paid_rate: Number(paidRate.toFixed(4)),
      overall_conversion: Number(overall.toFixed(4)),
    },
  };
}
