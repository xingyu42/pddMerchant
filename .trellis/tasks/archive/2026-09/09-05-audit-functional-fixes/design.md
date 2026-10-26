# Functional Fix Design

## Scope And Ownership

One integrated remediation task covers F1-F9 from the audit. The main session implements and verifies; no implement/check subagents. M1/M2 and other cleanup remain deferred. Changes use existing command/service/adapter/infra boundaries, with no new dependencies, account migration, or real-environment validation.

The audit report and its observation tests remain historical evidence. Permanent regression tests belong in test/ and assert corrected behavior, not the historical bug. Do not run the old audit observations as a post-fix acceptance gate.

## A. Auth And Daemon Results (F2/F3/F4)

### Refresh Validity

Follow the existing auth-mall-context specification: install observation before home navigation, match only the merchant origin and POST /janus/api/checkLogin, and accept a boolean result.login only on HTTP 2xx. Do not send a guessed heartbeat request. Login redirection is explicit expiry; absent, malformed, timed-out, or non-2xx checks are inconclusive. A conclusive valid response is not proof of server-side lifetime extension.

Keep auth-state locking around the refresh operation. Save only after valid observation and a final abort check. Expiry and inconclusive outcomes must leave the existing state untouched. Dispose listeners and timers on every outcome, including navigation failures and cancellation. Isolate the observer in a small adapter helper if needed to make cleanup ownership explicit; do not replace the global login subsystem as unrelated work.

Preserve success as a boolean but align reason values with auth_valid/auth_expired/auth_check_inconclusive and existing missing/lock/abort failures. Update daemon single-account and multi-account reporting and fixture auth behavior so inconclusive checks do not produce a false manual-login requirement. QR handling remains only for conclusive expiry, not transport uncertainty. Do not change refresh intervals.

### Startup Confirmation

Give each newly requested launch a non-secret attempt identifier, propagated to the daemon and published in its state. New-launch confirmation requires matching attempt identity, running status, and a live valid PID. Windows must use the state PID, not assume the PowerShell launcher PID is the daemon PID. Keep the existing bounded confirmation window and lock.

Centralize the narrow state eligibility predicate across the launcher branches. Existing running state must have valid identity metadata, running status, and a live PID; corrupt/unverifiable state must not become a success. Never kill a process merely to repair an ambiguous startup record. Account for concurrent launchers and lock waiters without treating arbitrary old running state as this launch's acknowledgement. This is local startup correlation, not a claim of authenticated process identity against malicious state tampering.

### Stop Results

After graceful/forced termination attempts, perform bounded final liveness verification. If the process remains alive, return E_DAEMON_STOP_FAILED with a nonzero existing exit code and retain state. Clear state only after confirmed termination and only when the reread state identity still matches, preserving a concurrently started replacement. Preserve tokenless-state safety. No real processes are terminated in tests.

## B. Deadline And Context (F1/F9)

Await live execution inside the try/finally that owns the deadline timer, and remove comments preserving the faulty timing. Verify both timer-driven cancellation and parent-signal handling, success/error cleanup, and single envelope emission. Keep per-request deadline budgets; do not add detached Promise.race work that continues after the reported result.

Pass the full ctx through standalone orders/inventory/promo/funnel diagnosis. Add mallId without dropping signal, deadlineAt, pageSession, logger, or shared client. Test all four handlers rather than assuming one covers the others.

## C. Response And Recommendation Integrity (F5/F6/F7/F8)

### Required Response Shape

Validate required goods and promotion result containers/collections and consumed required metrics before normalization. Use the existing PddCliError response-shape convention found in the orders implementation; details contain endpoint/field names, never raw payloads. Business failure classification still precedes normalization. Explicit valid zeros and empty arrays remain valid; absent or malformed required fields must not silently produce zeros.

Inspect current committed fixtures and endpoint contracts to distinguish required metrics from optional enrichment. Do not invent required advertising metadata merely because some fixtures contain it. Retain supported MoneyVO/numeric representations and top-level/reportInfo aliases. Cover entity and hourly promotion reports.

### Scan Completeness

Keep goods-scan and orders-scan flags independent from collection through inventory, goods.segment, action.plan, and human/JSON output. Carry goodsScanTruncated/goodsScanRateLimited alongside existing order flags; report both when both scans are incomplete. Do not overload the existing action-plan boolean data_completeness fields with strings or objects; add explicit source-quality details inside data and stable warnings instead.

Observed item counts and stock facts remain available. Any numerical sample score must be labelled partial and cannot make a store-wide completeness claim. Existing complete-input outputs retain their meaning; renderer and consumer tests must cover additional uncertainty states.

### Unsupported Recommendations

With incomplete orders, an unmatched item has unknown sales, not proven zero sales. Suppress clearance and other recommendations whose premise requires complete sales or ranking data, both at segmentation and at action-plan consumption. A downstream action guard is necessary because an old/external segmentation object may still contain a D tier with partial_orders.

Keep independently supported facts or recommendations, such as directly observed stock and sales evidence, when they do not rely on the missing records. Do not merely hide a warning while preserving an unsafe action. Goods-scan incompleteness must also be considered for relative-ranking recommendations. Complete scans with genuinely zero sales preserve legitimate clearance behavior.

### Break-Even ROI

Check break-even eligibility before the fixed expansion threshold. Expansion requires ROI at least both the configured break-even value and the existing 2.0 threshold. Keep no-spend and zero-revenue classifications. Verify boundary values and preserve default valid behavior; avoid changing money units or scoring weights.

## Compatibility And Rollback

Preserve envelope keys and stdout JSON purity. New diagnostic errors use existing exit-code families. Add uncertainty fields rather than changing established field types. Update affected fixtures/tests/specs for intentional behavior changes instead of weakening validation to keep buggy tests green.

Do not touch staged .gitattributes or the handoff. Read current daemon-launcher.js before editing and preserve original line-ending/WIP intent. No global formatting. If an architectural premise fails, stop that part and present alternatives before expanding scope. Rollback, if required, is a targeted reversal of task-owned edits only, never git reset/checkout of existing WIP.

## Verification Boundary

Use mocked browser events/fetch/process calls, fake timers, and owned temporary filesystem roots. Check test imports, environment overrides, subprocesses, and cleanup before executing. Expand to the full test suite only if live-state/network isolation is established; otherwise document the exact safe subset and remaining validation gap. No real daemon, login, merchant requests, or dependency installation.
