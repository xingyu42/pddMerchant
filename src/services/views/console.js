import { isoToLocalDateTime, labelOf } from '../../infra/units.js';
import { AUTH_VERDICT_LABEL, PASSWORD_RELOGIN_REASON_LABEL, PENDING_ACTION_KIND_LABEL,
  formatPasswordReloginStatus } from './labels.js';

export const CONSOLE_ACCOUNT_VIEW_FIELDS = Object.freeze([
  'slug', 'display_name', 'mall_id', 'session_status', 'has_password', 'password_relogin_status', 'pending_actions',
]);

export function toConsoleAccountView(account, metadata, summary, actions) {
  return {
    slug: account.slug, display_name: account.display_name, mall_id: account.identity ?? null,
    session_status: labelOf(AUTH_VERDICT_LABEL, metadata?.last_check?.verdict ?? metadata?.check_verdict),
    has_password: summary.has_password, password_relogin_status: formatPasswordReloginStatus(summary),
    pending_actions: actions.filter((action) => action.status === 'open').map((action) => ({
      kind: labelOf(PENDING_ACTION_KIND_LABEL, action.kind),
      reason: labelOf(PASSWORD_RELOGIN_REASON_LABEL, action.reason), created_at: isoToLocalDateTime(action.created_at),
    })),
  };
}

export function toConsoleLinkView(link) {
  return { headline: ['控制台访问链接已生成，有效期 10 分钟'], url: link.url,
    expires_at: isoToLocalDateTime(link.expires_at) };
}
