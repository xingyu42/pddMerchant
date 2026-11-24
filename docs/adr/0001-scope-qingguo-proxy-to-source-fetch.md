# Scope Qingguo proxy use to source-product fetching

The Qingguo short-lived proxy integration is accepted only for consumer-side Source Product Fetch, never merchant-side draft, form-fill, save, submit, or unrelated CLI traffic. Proxy use is opt-in and fail-closed; each attempt acquires one non-reusable HTTP proxy lease, creates a fresh consumer context from the shared read-only login snapshot, and may retry at most twice for proxy infrastructure failures, empty-shell pages, or masked pricing. This boundary limits AuthKey exposure, avoids changing merchant-session network identity, and keeps provider failures from spreading across the CLI.

- Amended 2026-11-25 (goods-publish-deepening): retries (at most two attempts with `[500, 1000]ms` abortable backoff) apply solely to **Retryable Source Proxy Fault** (`E_PROXY_UNAVAILABLE` and `E_PROXY_NETWORK`). Chromium `ERR_TUNNEL_CONNECTION_FAILED` maps to `E_PROXY_AUTH` and stops after one lease. Empty-shell pages (`_fiberFound === false && _appWall === true`) are classified before price/SKU loss, stop proxy rotation immediately on attempt 1, preserve consumer auth, and record persistent cooldown (`E_RATE_LIMIT`); price or SKU loss confirms **Consumer Account Degradation** on the first occurrence (`E_RISK_CONTROL_SOFT`), stops proxy rotation immediately, permanently deletes saved consumer auth state from SQLite storage, and skips persistent cooldown updates.

## Consequences

- The Qingguo extraction AuthKey is environment-only and normalized behind a Qingguo-specific adapter rather than a multi-provider framework.
- Empty-shell and masked-price attempts update persistent PDD cooldown state only after all three attempts fail; hard challenges and expired login state stop immediately.
  - Amended 2026-11-25: empty-shell responses stop proxy rotation on attempt 1 and record persistent cooldown immediately (preserving consumer auth), whereas Consumer Account Degradation stops on attempt 1, removes consumer auth state, and skips cooldown updates (a replacement consumer login resets cooldown).
- Successful recovery adds `source_proxy_retry_recovered` to envelope warnings, while proxy nodes and credentials remain absent from normal JSON output.
- The first version uses HTTP proxy nodes without proxy username/password authentication, performs no third-party exit-IP preflight, uses random region and carrier selection, and does not reuse leases across products.
