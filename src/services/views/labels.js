// 项目自定义枚举 → 中文标签（输出契约 v2：枚举一律以中文标签输出）。
// 内部计算仍使用英文代码（spec 定义的内部值），仅在视图 / 输出层翻译。

// 数据可得性（diagnose status / compare status）
export const DATA_STATUS_LABEL = Object.freeze({ full: '数据完整', partial: '数据不完整' });
export const TRAFFIC_HINT_LABEL = Object.freeze({
  daily_uv_sum: '访客汇总为逐日访客数之和，跨日存在重复访客',
  missing_days: '返回的统计日少于窗口天数，summary 仅汇总已返回的统计日',
  promo_caliber: '推广拆分口径来自对第三方插件实现的分析，尚未经有投放店铺实测',
  non_promo_caliber: '非推广成交 = 商品明细总量减去推广直接成交，平台不提供该拆分',
  goods_truncated: '商品明细采集不完整（分页上限或提前空页），结果已截断',
  promo_unavailable: '推广数据拉取失败或已达采集上限，推广及非推广成交字段为 null',
  negative_difference: '总成交减去推广直接成交出现负差额，对应非推广成交字段为 null',
  promo_unknown_unit: '推广金额单位未知，对应推广金额及非推广成交额为 null',
});
export const CUSTOMER_SERVICE_CALIBER = '多多客服-客服数据（人工回复）';
export const CUSTOMER_SERVICE_HINT_LABEL = Object.freeze({ trend_unavailable: '客服逐日趋势拉取失败' });
export const REVIEW_HINT_LABEL = Object.freeze({
  keywords_unavailable: '评价标签聚合拉取失败', types_unavailable: '评价问题类型拉取失败',
  reviews_unavailable: '中差评列表拉取失败', list_truncated: '中差评列表已达 30 页采集上限，结果已截断',
});
export const EXPERIENCE_DIMENSION_LABEL = Object.freeze({
  after_sales: '售后服务', quality: '商品品质', logistics: '物流服务', activity: '店铺活跃', special: '特色服务',
});
export const EXPERIENCE_UNIT_LABEL = Object.freeze({ pct: '百分比', hours: '小时', days: '天', raw: '平台原值' });
export const EXPERIENCE_STANDARD_LABEL = Object.freeze({ 0: '已达标', 1: '未达标' });
export const EXPERIENCE_HINT_LABEL = Object.freeze({
  ready_date_unavailable: '趋势就绪日期拉取失败', trend_unavailable: '趋势数据拉取失败', delayed: '平台标记数据延迟',
});
export const COST_SCOPE_LABEL = Object.freeze({ default: '商品默认', spec: '指定规格' });
export const PROFIT_HINT_LABEL = Object.freeze({
  orders_truncated: '订单量超出采集上限，窗口财务金额为 null，保留已观测样本',
  orders_ratelimited: '订单采集因限流中断，窗口财务金额为 null，保留已观测样本',
  invalid_order_window: '成团时间缺失或重复订单事实冲突，订单采集不完整',
  promo_incomplete: '推广采集不完整，相关推广花费和净利润为 null',
  promo_unavailable: '推广数据拉取失败，相关推广花费和净利润为 null',
  negative_promo_difference: '推广报表总计减商品归属合计的差额为负，店铺级推广花费为 null',
  promo_amount_unknown: '推广金额缺失或单位无效，相关金额为 null',
});
export const PROFIT_FIXED_HINTS = Object.freeze([
  '成本按当前录入值计算，历史窗口会随成本更新重算',
  '退款成功按全额退款且货已退回处理；仅退款不退货时，利润可能高估',
  '平台优惠按全部结算给商家计入收入；商家共担补贴活动时，利润可能高估',
  '推广花费仅含商品推广报表口径',
]);

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

// promo.roi 分组维度
export const PROMO_GROUP_BY_LABEL = Object.freeze({ plan: '推广计划', sku: '商品', channel: '推广场景' });

// 推广场景 scenesType：仅收录有仓库证据的码值——
// archive/2026-07/07-05-promo-poseidon-adapt/prd.md：「搜索/场景推广已合并为商品推广，scenesType 恒 9」
export const SCENES_TYPE_LABEL = Object.freeze({ 9: '商品推广' });

// diagnose.shop --compare：仅当前快照的指标说明
export const COMPARE_NOTE_LABEL = Object.freeze({ current_snapshot_only: '仅有当前快照，无上期数据' });

// 当前店铺识别来源（adapter/mall-reader.js 探测链）
export const MALL_SOURCE_LABEL = Object.freeze({
  mock: '测试数据', state: '页面状态', url: '页面 URL', cookie: 'Cookie',
  storage: '本地存储', xhr: '接口响应', dom: '页面元素',
});

// 配置字段来源（infra/config.js 分层）
export const CONFIG_SOURCE_LABEL = Object.freeze({
  baseline: '基线配置', local: '本地覆盖', env: '环境变量', cli: '命令行参数',
});

// 登录方式（services/auth.js）
export const LOGIN_MODE_LABEL = Object.freeze({
  qr: '扫码登录', headed: '有头浏览器登录', 'consumer-qr': '扫码登录', 'consumer-headed': '有头浏览器登录',
});

// 商家端登录态校验结论（adapter/merchant-auth*.js verdict）
export const AUTH_VERDICT_LABEL = Object.freeze({
  verified: '已验证', rejected: '已失效', failed: '验证失败', indeterminate: '无法判定', not_configured: '未配置',
});

export const CONSOLE_STATUS_LABEL = Object.freeze({
  relogin_paused: '暂停', action_required: '需验证', relogin_required: '失效', verified: '正常', unknown: '未知',
});

export const CONSOLE_LOGIN_REASON_LABEL = Object.freeze({
  sms: '短信验证', slider: '滑块验证', click: '点选验证', risk_confirm: '安全确认', unknown: '安全验证',
  wrong_password: '密码错误', account_locked: '账号被锁', takeover_timeout: '验证超时',
});

export const CONSOLE_CHALLENGE_DETAIL = Object.freeze({
  sms: '需要完成短信验证', slider: '需要完成滑块验证', click: '需要完成点选验证',
  risk_confirm: '需要完成安全确认', unknown: '需要完成安全验证',
});

export const CONSOLE_VERDICT_DETAIL = Object.freeze({
  indeterminate: '上次核验无法判定', failed: '上次核验未通过', not_configured: '尚未配置登录信息',
});

export const PASSWORD_RELOGIN_STATUS_LABEL = Object.freeze({
  available: '可用', awaiting_human: '等待人工', blocked: '已熔断',
});

export const PENDING_ACTION_KIND_LABEL = Object.freeze({
  human_takeover: '人工接管', relogin_blocked: '重登熔断',
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

// 店铺身份来源（doctor）
export const MALL_IDENTITY_SOURCE_LABEL = Object.freeze({ verified_shop_endpoint: '店铺接口验证' });

// 登录态文件检查错误（doctor）
export const AUTH_FILE_ERROR_LABEL = Object.freeze({
  auth_state_unreadable: '登录态文件无法读取',
  auth_state_undecryptable: '登录态文件无法解密',
});
