// 项目自定义枚举 → 中文标签（输出契约 v2：枚举一律以中文标签输出）。
// 内部计算仍使用英文代码（spec 定义的内部值），仅在视图 / 输出层翻译。

// 数据可得性（diagnose status / compare status）
export const DATA_STATUS_LABEL = Object.freeze({ full: '数据完整', partial: '数据不完整' });

// diagnose 维度
export const DIMENSION_LABEL = Object.freeze({ orders: '订单', inventory: '库存', promo: '推广', after_sales: '售后' });

// orders.list 订单范围（--status）；内部销量口径 valid 不对外展示
export const ORDER_SCOPE_LABEL = Object.freeze({
  all: '全部', pending_ship: '待发货', shipped: '已发货待收货', received: '已收货', after_sales: '售后处理中',
});

// 订单 after_sales_status（.trellis/tasks/10-08-orders-status-and-refund/research/order-list-filters-2026-10-08.md §3）：
// 5 = 退款成功（高置信：与 order_status_str「…退款成功」、pay_status 4、fulfillmentStatus 31/32 一致 9/9）；
// 10 / 11 = 售后处理中（中置信：与 afterSaleType=2 过滤结果 4/4 吻合，二者子类区别无证据）
export const AFTER_SALES_STATUS_LABEL = Object.freeze({ 5: '退款成功', 10: '售后处理中', 11: '售后处理中' });

// 售后工作台的售后单状态独立于订单状态；重叠码取细分状态。
export const AFTER_SALES_TYPE_LABEL = Object.freeze({
  1: '退款', 2: '退款退货', 3: '换货', 4: '补寄', 5: '维修',
});
export const AFTER_SALES_SHIPPING_STATUS_LABEL = Object.freeze({ 0: '未发货', 1: '已发货' });
export const AFTER_SALES_CASE_STATUS_LABEL = Object.freeze({
  1: '待商家处理', 14: '待商家处理', 21: '待商家处理', 32: '待商家处理',
  9: '待消费者发货', 10: '待消费者发货', 15: '待消费者发货', 22: '待消费者发货',
  11: '待商家收货',
  2: '平台处理中', 3: '平台处理中', 7: '平台处理中',
  4: '进行中售后单', 18: '进行中售后单', 27: '进行中售后单', 31: '进行中售后单',
  5: '退款成功', 6: '退款关闭', 12: '退款关闭', 16: '换货/补寄成功', 17: '换货/补寄关闭',
  25: '维修成功', 24: '维修关闭',
});
export const AFTER_SALES_FILTER_STATUS_LABEL = Object.freeze({
  all: '全部', open: '进行中', refunded: '退款成功', closed: '已关闭',
});
export const AFTER_SALES_FILTER_TYPE_LABEL = Object.freeze({
  all: '全部', refund: '退款', return_refund: '退款退货', exchange: '换货', resend: '补寄', repair: '维修',
});

// 商品与订单的匹配方式（goods.segment / diagnose.inventory）
export const MATCHED_BY_LABEL = Object.freeze({
  goods_id: '按商品 ID 匹配',
  goods_name: '按商品名匹配',
  mixed: '按商品名匹配（一侧缺少商品 ID）',
});

// goods.segment 数据完整性
export const DATA_COMPLETENESS_LABEL = Object.freeze({
  full: '数据完整',
  no_promo: '数据完整（无推广数据）',
  no_orders: '数据完整（统计期内无订单）',
  empty: '无商品',
  partial: '数据不完整',
  partial_goods: '商品数据不完整',
  partial_orders: '订单数据不完整',
  partial_goods_orders: '商品与订单数据均不完整',
});

// 商家端登录态校验结论（adapter/merchant-auth*.js verdict）
export const AUTH_VERDICT_LABEL = Object.freeze({
  verified: '已验证', rejected: '已失效', failed: '验证失败', indeterminate: '无法判定', not_configured: '未配置',
});

export const PASSWORD_RELOGIN_STATUS_LABEL = Object.freeze({
  available: '可用', awaiting_human: '等待人工', blocked: '已熔断',
});

export const PASSWORD_RELOGIN_REASON_LABEL = Object.freeze({
  sms: '短信验证', slider: '滑块验证', click: '点选验证', risk_confirm: '风控确认',
  unknown: '未识别的验证', wrong_password: '密码错误', account_locked: '账号被锁', takeover_timeout: '接管超时',
});

export function formatPasswordReloginStatus(summary) {
  if (!summary?.has_password) return null;
  const status = Object.hasOwn(PASSWORD_RELOGIN_STATUS_LABEL, summary.status)
    ? PASSWORD_RELOGIN_STATUS_LABEL[summary.status] : null;
  if (status == null || summary.status === 'available') return status;
  const reason = Object.hasOwn(PASSWORD_RELOGIN_REASON_LABEL, summary.reason)
    ? PASSWORD_RELOGIN_REASON_LABEL[summary.reason] : null;
  return reason ? `${status}：${reason}` : status;
}

// 商家端登录态校验原因（adapter/merchant-auth*.js reason）
export const AUTH_REASON_LABEL = Object.freeze({
  shop_read: '店铺信息读取成功',
  shop_identity: '店铺身份已确认',
  login_true: '登录接口确认已登录',
  login_false: '登录接口返回未登录',
  known_rejected: '此前已判定失效',
  auth_missing: '未找到登录态',
  identity_mismatch: '店铺绑定不一致',
  check_failed: '检查过程出错',
  network_error: '网络错误',
  tls_error: 'TLS 错误',
  http_status: 'HTTP 状态异常',
  response_shape: '响应格式异常',
  shop_identity_shape: '响应格式异常',
  shop_read_shape: '响应格式异常',
  request_timeout: '请求超时',
  deadline: '超出命令时限',
  cancelled: '已取消',
  response_too_large: '响应过大',
  invalid_json: '响应不是有效 JSON',
  response_error: '响应读取中断',
  response_aborted: '响应读取中断',
  shop_identity_rejected: '店铺接口拒绝',
  shop_read_rejected: '店铺接口拒绝',
  unknown: '原因未知',
});
