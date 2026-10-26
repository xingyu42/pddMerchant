# Current daemon refresh audit

> Status: this file records the pre-fix audit that motivated the task. The implementation has since changed, and controlled live observations on 2026-08-01 found that the selected Janus endpoint is not a successful heartbeat for a fresh valid session. See `fresh-login-survival-observation-2026-08-01.md` for current evidence.

## Confirmed implementation facts

- `bin/pdd-daemon.js` uses `refreshIntervalMs` plus symmetric `refreshJitterMs`; defaults are 600000 ms and 120000 ms, so the default window is 8–12 minutes rather than a fixed 10 minutes.
- `src/adapter/auth-refresher.js` always opens the refresh browser with `headed: false`, navigates to `/home`, calls one Janus heartbeat, saves storage state on success, and closes the browser through `withBrowser()` cleanup.
- The heartbeat currently keeps only `status`, `ok`, `redirected`, and `url`. It does not read `success`, `errorCode`, or `error_code`.
- The fallback `isAuthValid()` checks only final login URL and HTTP status. A heartbeat body with `error_code: 43001` followed by a 200 homepage can therefore be accepted and saved.

## Evidence classification

- Confirmed defect: HTTP 200 business auth failure is outside both current validity checks.
- Confirmed behavior: headless one-shot refresh and repeated single-request trajectory.
- Not confirmed as root cause: the platform shortens the session specifically because the trajectory looks automated.

## Implementation decision

Fix the confirmed business-response gap and observability first. Preserve existing scheduling jitter. Do not add fake business traffic without endpoint evidence and a separate risk review.
