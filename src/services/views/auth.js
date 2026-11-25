// 登录 / 授权与环境自检视图（输出契约 v2）：init、login、login.consumer、doctor。
// 不输出登录态 / 凭据内容；枚举（登录方式、校验结论、原因等）输出中文标签。
// 登录态字段名保持输出契约兼容。
import { isoToLocalDateTime, labelOf } from '../../infra/units.js';
import { text } from './_shared.js';
import { toPasswordReloginView } from './account.js';
import { AUTH_REASON_LABEL, AUTH_VERDICT_LABEL } from './labels.js';

const LOGIN_MODE_LABEL = Object.freeze({
  qr: '扫码登录', headed: '有头浏览器登录', 'consumer-qr': '扫码登录', 'consumer-headed': '有头浏览器登录',
});
const MALL_IDENTITY_SOURCE_LABEL = Object.freeze({ verified_shop_endpoint: '店铺接口验证' });
const AUTH_FILE_ERROR_LABEL = Object.freeze({
  auth_state_unreadable: '登录态文件无法读取', auth_state_undecryptable: '登录态文件无法解密',
});

// 店铺名缺失时只陈述 ID，不拼接占位名
function merchantLoginHeadline({ displayName, mallId }) {
  if (displayName) return `商家端授权成功：${displayName}（${mallId ?? '店铺 ID 未获取'}）`;
  return mallId ? `商家端授权成功：店铺 ID ${mallId}（未获取到店铺名）` : '商家端授权成功（未获取到店铺信息）';
}

// result：performQrLogin / performHeadedLogin 结果；provisioned：注册到 registry 的账号（可空）
export function toMerchantLoginView(result, provisioned) {
  const identity = result.identity ?? {};
  return {
    headline: [merchantLoginHeadline(identity)],
    url: result.url ?? null,
    mode: labelOf(LOGIN_MODE_LABEL, result.mode),
    display_name: text(identity.displayName),
    mall_id: text(identity.mallId),
    check_verdict: AUTH_VERDICT_LABEL.verified,
    account_slug: provisioned?.account?.slug ?? null,
    ...(result.qrContentPresent !== undefined ? { qr_decoded: result.qrContentPresent } : {}),
  };
}

// accountFingerprint：消费者账号 uid 的指纹（redactValue），不输出原值
export function toConsumerLoginView(result, { accountFingerprint = null, fixture = false } = {}) {
  const mode = labelOf(LOGIN_MODE_LABEL, result.mode);
  return {
    headline: [`消费端授权成功（${mode ?? '未知方式'}${fixture ? '，fixture 模式' : ''}）`],
    url: result.url ?? null,
    mode,
    account_fingerprint: accountFingerprint,
    ...(result.qrImagePath ? { qr_image_path: result.qrImagePath } : {}),
  };
}

function toAuthFileDetail(detail) {
  if (!detail) return null;
  if (detail.error) return { error: labelOf(AUTH_FILE_ERROR_LABEL, detail.error) };
  if (detail.exists === false) return { exists: false };
  return { exists: true, cookie_count: detail.cookies ?? null, origin_count: detail.origins ?? null };
}

function toCheckView(check, toDetail = (detail) => detail) {
  return { ok: Boolean(check?.ok), detail: toDetail(check?.detail ?? null) };
}

function toMerchantLoginDetail(detail) {
  if (!detail) return null;
  return {
    configured: Boolean(detail.configured),
    verdict: labelOf(AUTH_VERDICT_LABEL, detail.verdict),
    reason: labelOf(AUTH_REASON_LABEL, detail.reason),
    checked_at: isoToLocalDateTime(detail.checked_at),
    shops: detail.shops ?? null,
    mall_source: labelOf(MALL_IDENTITY_SOURCE_LABEL, detail.mall_source),
  };
}

function toDoctorAccountView(account) {
  return {
    slug: account.slug,
    display_name: text(account.displayName),
    auth_file: toCheckView(account.auth_file, toAuthFileDetail),
    ...toPasswordReloginView(account.relogin),
  };
}

function doctorHeadline(view) {
  const fallbackVerdict = view.logged_in.ok ? '已验证' : '无法判定';
  const merchant = `商家端登录态${view.logged_in.detail?.verdict ?? fallbackVerdict}`;
  const consumer = view.consumer_logged_in.ok ? '用户端登录态有效' : '用户端未配置或无效';
  const headline = [`Chromium ${view.chromium.ok ? '可用' : '不可用'}；${merchant}；${consumer}`];
  if (Array.isArray(view.accounts)) {
    const valid = view.accounts.filter((account) => account.auth_file.ok).length;
    headline.push(`账号登录态文件 ${valid}/${view.accounts.length} 可用`);
  }
  return headline;
}

// data：doctor 内部检查结果（内部代码）→ v2
export function toDoctorView(data) {
  const view = {
    chromium: toCheckView(data.chromium),
    auth_file: toCheckView(data.auth_file, toAuthFileDetail),
    logged_in: toCheckView(data.logged_in, toMerchantLoginDetail),
    password_relogin: data.password_relogin,
    consumer_auth_file: toCheckView(data.consumer_auth_file, toAuthFileDetail),
    consumer_logged_in: toCheckView(data.consumer_logged_in),
    ...(Array.isArray(data.accounts) ? { accounts: data.accounts.map(toDoctorAccountView) } : {}),
  };
  return { headline: doctorHeadline(view), ...view };
}

/** Format a doctor command envelope as human-readable terminal lines. */
export function renderDoctor(envelope) {
  const data = envelope?.data ?? {};
  const lines = [`OK  ${envelope?.command || 'doctor'}`, ...(Array.isArray(data.headline) ? data.headline : [])];

  lines.push(data.chromium?.ok ? '✓ Chromium 可用' : '· Chromium 不可用');
  lines.push(data.auth_file?.ok ? '✓ 商家端登录态文件可用' : '· 商家端登录态文件未配置或损坏');

  const shops = data.logged_in?.detail?.shops;
  const shopSummary = Number.isInteger(shops) ? `（${shops} 个店铺）` : '';
  const verdict = data.logged_in?.detail?.verdict;
  lines.push(data.logged_in?.ok ? `✓ 商家端登录态有效${shopSummary}`
    : data.logged_in?.detail?.reason === AUTH_REASON_LABEL.identity_mismatch ? '· 商家端店铺绑定不一致'
      : verdict === AUTH_VERDICT_LABEL.rejected ? '· 商家端登录态已失效'
        : verdict === AUTH_VERDICT_LABEL.not_configured ? '· 商家端未配置' : '· 商家端登录态无法判定');
  lines.push(`密码重登：${data.password_relogin?.status ?? '未保存密码'}`);

  if (data.consumer_auth_file?.ok === true && data.consumer_logged_in?.ok === true) {
    lines.push('✓ 用户端登录态有效');
  } else {
    lines.push('· 用户端未配置');
  }

  return lines.join('\n');
}
