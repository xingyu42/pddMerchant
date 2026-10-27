// 多账号管理视图（输出契约 v2）：数据库记录 → 本地时间 + headline。
import { isoToLocalDateTime } from '../../infra/units.js';
import { text } from './_shared.js';
import { formatPasswordReloginStatus } from './labels.js';

export const ACCOUNT_VIEW_FIELDS = Object.freeze([
  'slug', 'display_name', 'mall_id', 'is_default', 'disabled', 'last_login_at',
  'has_password', 'password_relogin_status',
]);

export const ACCOUNT_REMOVED_VIEW_FIELDS = Object.freeze(['headline', 'slug', 'removed']);

export function toPasswordReloginView(summary) {
  return {
    has_password: Boolean(summary?.has_password),
    password_relogin_status: formatPasswordReloginStatus(summary),
  };
}

export function toAccountView(account, defaultSlug) {
  return {
    slug: account.slug,
    display_name: text(account.display_name),
    mall_id: text(account.identity),
    is_default: defaultSlug != null && defaultSlug === account.slug,
    disabled: Boolean(account.disabled),
    last_login_at: isoToLocalDateTime(account.last_login_at),
    ...toPasswordReloginView(account.relogin),
  };
}

export function toAccountListView(accounts, defaultSlug) {
  const items = accounts.map((account) => toAccountView(account, defaultSlug ?? null));
  const disabled = items.filter((item) => item.disabled).length;
  const headline = items.length === 0
    ? ['尚未注册账号']
    : [`共 ${items.length} 个账号（停用 ${disabled} 个），默认账号：${defaultSlug ?? '未设置'}`];
  return { headline, items, total: items.length, default_slug: defaultSlug ?? null };
}

export function toAccountAddedView({ slug, display_name: displayName, identity: mallId }) {
  return {
    headline: [`已添加账号 ${displayName ?? slug}（${slug}），店铺 ${mallId ?? '未知'}`],
    slug,
    display_name: text(displayName),
    mall_id: text(mallId),
  };
}

export function toAccountRemovedView(slug) {
  return {
    headline: [`已移除账号 ${slug} 及其认证数据`],
    slug,
    removed: true,
  };
}

export function toAccountDefaultView(slug) {
  return { headline: [`默认账号已设为 ${slug}`], slug, is_default: true };
}
