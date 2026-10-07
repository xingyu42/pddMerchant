// 多账号管理视图（输出契约 v2）：registry 记录（camelCase）→ snake_case + 本地时间 + headline。
import { isoToLocalDateTime } from '../../infra/units.js';
import { text } from './_shared.js';

export const ACCOUNT_VIEW_FIELDS = Object.freeze([
  'slug', 'display_name', 'mall_id', 'is_default', 'disabled', 'last_login_at', 'last_refresh_at', 'has_credential',
]);

export function toAccountView(account, defaultSlug) {
  return {
    slug: account.slug,
    display_name: text(account.displayName),
    mall_id: text(account.mallId),
    is_default: defaultSlug != null && defaultSlug === account.slug,
    disabled: Boolean(account.disabled),
    last_login_at: isoToLocalDateTime(account.lastLoginAt),
    last_refresh_at: isoToLocalDateTime(account.lastRefreshAt),
    has_credential: account.credential != null,
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

export function toAccountAddedView({ slug, displayName, mallId }) {
  return {
    headline: [`已添加账号 ${displayName ?? slug}（${slug}），店铺 ${mallId ?? '未知'}`],
    slug,
    display_name: text(displayName),
    mall_id: text(mallId),
    has_credential: false,
  };
}

export function toAccountRemovedView(slug, { removeFiles }) {
  return {
    headline: [removeFiles ? `已移除账号 ${slug}，并删除账号目录` : `已移除账号 ${slug}`],
    slug,
    removed: true,
    files_removed: Boolean(removeFiles),
  };
}

export function toAccountDefaultView(slug) {
  return { headline: [`默认账号已设为 ${slug}`], slug, is_default: true };
}
