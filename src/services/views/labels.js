// 项目自定义枚举 → 中文标签（输出契约 v2：枚举一律以中文标签输出）。
// 内部计算仍使用英文代码（spec 定义的内部值），仅在视图 / 输出层翻译。

// 数据可得性（diagnose status / compare status）
export const DATA_STATUS_LABEL = Object.freeze({ full: '数据完整', partial: '数据不完整' });

// diagnose 维度
export const DIMENSION_LABEL = Object.freeze({ orders: '订单', inventory: '库存', promo: '推广', funnel: '履约' });

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
export const AUTH_FILE_ERROR_LABEL = Object.freeze({ auth_state_unreadable: '登录态文件无法读取' });
