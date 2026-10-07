// 登录 / 授权与环境自检视图（输出契约 v2）：init、login、login.consumer、doctor。
// 不输出登录态 / 凭据内容；枚举（登录方式、校验结论、原因等）输出中文标签。
// 用词约定：「凭据」仅指已保存的登录凭据（account has_credential）；auth-state 文件称「登录态文件」。
import { isoToLocalDateTime, labelOf } from '../../infra/units.js';
import { text } from './_shared.js';
import {
  AUTH_FILE_ERROR_LABEL, AUTH_REASON_LABEL, AUTH_VERDICT_LABEL, LOGIN_MODE_LABEL, MALL_IDENTITY_SOURCE_LABEL,
} from './labels.js';

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
    has_credential: Boolean(account.hasCredential),
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
    consumer_auth_file: toCheckView(data.consumer_auth_file, toAuthFileDetail),
    consumer_logged_in: toCheckView(data.consumer_logged_in),
    ...(Array.isArray(data.accounts) ? { accounts: data.accounts.map(toDoctorAccountView) } : {}),
  };
  return { headline: doctorHeadline(view), ...view };
}
