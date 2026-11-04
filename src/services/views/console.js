import { isoToLocalDateTime, labelOf } from '../../infra/units.js';
import { AUTH_VERDICT_LABEL, PASSWORD_RELOGIN_REASON_LABEL, PENDING_ACTION_KIND_LABEL,
  CONSOLE_STATUS_LABEL, CONSOLE_LOGIN_REASON_LABEL, CONSOLE_CHALLENGE_DETAIL, CONSOLE_VERDICT_DETAIL,
  formatPasswordReloginStatus } from './labels.js';

export const CONSOLE_ACCOUNT_VIEW_FIELDS = Object.freeze([
  'slug', 'display_name', 'mall_id', 'session_status', 'has_password', 'password_relogin_status', 'pending_actions',
  'status_kind', 'status', 'status_detail',
]);

function consoleLabel(table, code, fallback = null) {
  return Object.hasOwn(table, code) ? table[code] : fallback;
}

function consoleActionDetail(summary, openActions) {
  if (summary.status === 'awaiting_human') {
    return consoleLabel(CONSOLE_CHALLENGE_DETAIL, summary.reason, '需要完成安全验证');
  }
  const action = openActions.find((item) => item.kind === 'human_takeover') ?? openActions[0];
  const reason = consoleLabel(CONSOLE_LOGIN_REASON_LABEL, action?.reason);
  return reason ? `待处理：${reason}` : '有待处理事项';
}

function toConsoleStatusView(verdict, summary, openActions) {
  let kind = 'unknown';
  let detail = consoleLabel(CONSOLE_VERDICT_DETAIL, verdict,
    verdict == null || verdict === '' ? '暂无核验记录' : '上次核验结果未知');
  if (summary.status === 'blocked') {
    kind = 'relogin_paused';
    const reason = consoleLabel(CONSOLE_LOGIN_REASON_LABEL, summary.reason);
    detail = reason ? `自动登录暂停：${reason}` : '自动登录已暂停';
  } else if (summary.status === 'awaiting_human' || openActions.length > 0) {
    kind = 'action_required';
    detail = consoleActionDetail(summary, openActions);
  } else if (verdict === 'rejected') {
    kind = 'relogin_required';
  } else if (verdict === 'verified') {
    kind = 'verified';
  }
  return { status_kind: kind, status: CONSOLE_STATUS_LABEL[kind], status_detail: detail };
}

export function toConsoleAccountView(account, metadata, summary, actions) {
  const verdict = metadata?.last_check?.verdict ?? metadata?.check_verdict;
  const openActions = actions.filter((action) => action.status === 'open');
  return {
    slug: account.slug, display_name: account.display_name, mall_id: account.identity ?? null,
    session_status: labelOf(AUTH_VERDICT_LABEL, verdict),
    has_password: summary.has_password, password_relogin_status: formatPasswordReloginStatus(summary),
    pending_actions: openActions.map((action) => ({
      kind: labelOf(PENDING_ACTION_KIND_LABEL, action.kind),
      reason: labelOf(PASSWORD_RELOGIN_REASON_LABEL, action.reason), created_at: isoToLocalDateTime(action.created_at),
    })),
    ...toConsoleStatusView(verdict, summary, openActions),
  };
}

export function toConsolePatrolView({ enabled, intervalMs, lastPatrolAt }) {
  return { enabled, interval_minutes: Number.isFinite(intervalMs) ? Math.round(intervalMs / 60_000) : null,
    last_patrol_at: isoToLocalDateTime(lastPatrolAt) };
}

export function toConsoleLinkView(link) {
  return { headline: ['控制台访问链接已生成，有效期 10 分钟'], url: link.url,
    expires_at: isoToLocalDateTime(link.expires_at) };
}
