# Scope Qingguo proxy use to source-product fetching

The Qingguo short-lived proxy integration is accepted only for consumer-side Source Product Fetch, never merchant-side draft, form-fill, save, submit, or unrelated CLI traffic. Proxy use is opt-in and fail-closed; each attempt acquires one non-reusable HTTP proxy lease, creates a fresh consumer context from the shared read-only login snapshot, and may retry at most twice for proxy infrastructure failures, empty-shell pages, or masked pricing. This boundary limits AuthKey exposure, avoids changing merchant-session network identity, and keeps provider failures from spreading across the CLI.

## Consequences

- The Qingguo extraction AuthKey is environment-only and normalized behind a Qingguo-specific adapter rather than a multi-provider framework.
- Empty-shell and masked-price attempts update persistent PDD cooldown state only after all three attempts fail; hard challenges and expired login state stop immediately.
- Successful recovery adds `source_proxy_retry_recovered` to envelope warnings, while proxy nodes and credentials remain absent from normal JSON output.
- The first version uses HTTP proxy nodes without proxy username/password authentication, performs no third-party exit-IP preflight, uses random region and carrier selection, and does not reuse leases across products.
