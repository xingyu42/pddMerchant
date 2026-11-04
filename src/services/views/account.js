// 多账号管理视图（输出契约 v2）：数据库记录 → 本地时间 + headline。
import { isoToLocalDateTime } from '../../infra/units.js';
import { text } from './_shared.js';
import { formatPasswordReloginStatus } from './labels.js';

export const ACCOUNT_VIEW_FIELDS = Object.freeze([
  'slug', 'display_name', 'mall_id', 'is_default', 'last_login_at',
  'has_password', 'password_relogin_status',
]);

export const ACCOUNT_REMOVED_VIEW_FIELDS = Object.freeze([
  'headline', 'slug', 'display_name', 'was_default', 'has_password', 'has_login_state', 'goods_entry_count',
  'removed', 'dry_run',
]);

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
    last_login_at: isoToLocalDateTime(account.last_login_at),
    ...toPasswordReloginView(account.relogin),
  };
}

export function toAccountListView(accounts, defaultSlug) {
  const items = accounts.map((account) => toAccountView(account, defaultSlug ?? null));
  const headline = items.length === 0
    ? ['尚未注册账号']
    : [`共 ${items.length} 个账号，默认账号：${defaultSlug ?? '未设置'}`];
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

function removedHeadline(account, footprint, confirm) {
  const parts = [footprint.hasLoginState && '登录态', footprint.hasPassword && '已存密码',
    footprint.goodsCostCount > 0 && `商品成本 ${footprint.goodsCostCount} 条`].filter(Boolean);
  const name = text(account.display_name);
  const target = name ? `账号 ${name}（${account.slug}）` : `账号 ${account.slug}`;
  const scope = parts.length ? `，连同${parts.join('、')}` : '';
  const headline = [confirm ? `已删除${target}${scope}` : `预演删除${target}${scope}，未执行删除`];
  if (account.is_default) headline.push(confirm ? '删除的是默认账号，当前没有默认账号' : '该账号是默认账号，删除后没有默认账号');
  return headline;
}

export function toAccountRemovedView(account, footprint, { confirm }) {
  return {
    headline: removedHeadline(account, footprint, confirm),
    slug: account.slug,
    display_name: text(account.display_name),
    was_default: Boolean(account.is_default),
    has_password: footprint.hasPassword,
    has_login_state: footprint.hasLoginState,
    goods_entry_count: footprint.goodsCostCount,
    removed: confirm,
    dry_run: !confirm,
  };
}

export function toAccountDefaultView(slug) {
  return { headline: [`默认账号已设为 ${slug}`], slug, is_default: true };
}
