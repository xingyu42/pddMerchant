# Page API Runtime Initialization

## Boundary And Data Flow

- Keep command and collector logic unchanged. The adapter owns browser preparation.
- Add a navigation target to ORDER_LIST using the existing exported PDD_HOME from auth-state.js, rather than the unverified /orders/list route suggested by the report.
- Pass the resolved navUrl to the page-api attempt. Before runtime discovery, compare current and target origins; navigate the same supplied page when blank, malformed or wrong-origin.
- Do not use pageSession sibling selection: direct page API calls do not depend on auto-load XHR and pagination should reuse its initialized page.
- Endpoints without nav retain the existing direct execution contract. Runtime absence remains a bounded E_NETWORK failure; no XHR fallback is added.

## Budgets And Failures

- Check cancellation/deadline before navigation and again before page API execution.
- Clamp navigation to the endpoint navTimeout or TIMEOUTS.QUICK_NAV and remaining command budget; use domcontentloaded unless explicitly configured otherwise.
- Preserve PddCliError and map other navigation failures to E_NETWORK, consistent with endpoint-attempt.js.
- Recalculate the page API request budget after navigation so preparation does not extend the command deadline.

## Compatibility And Risks

- No new dependency, CLI option, response shape, credential write or segmentation behavior.
- Same-origin pages remain subject to existing bounded runtime discovery; unsupported runtime discovery is not hidden by refresh/retry.
- The existing merchant home is established in source, but real authenticated backend readiness is not covered by offline mocks and must not be claimed as verified.
- Reverting the adapter/spec changes restores the previous behavior; no persistent migration is needed.
