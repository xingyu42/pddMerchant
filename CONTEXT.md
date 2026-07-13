# pdd-cli Domain Language

This glossary defines project-specific terms used when discussing merchant operations and source-product publishing.

## Goods Publishing

**Source Product Fetch**:
The consumer-side retrieval of product information used as input for publishing a merchant product. It is separate from all merchant-side draft, form-fill, save, and submit operations.
_Avoid_: Whole publish flow, merchant scraping

**Source Fetch Proxy**:
A proxy used only during Source Product Fetch. It must not carry merchant-side traffic or other CLI commands.
_Avoid_: Global proxy, publish proxy

**Proxy-Required Fetch**:
A Source Product Fetch for which proxy use was explicitly enabled. If proxy acquisition or connection fails, the fetch fails rather than falling back to the machine's direct network.
_Avoid_: Proxy-preferred fetch, automatic direct fallback

**Retryable Source Degradation**:
A Source Product Fetch result that is unusable because it returned the consumer-site empty shell or masked pricing. When proxy use is enabled, either condition may trigger at most two fresh-proxy retries before the fetch fails.
_Avoid_: Unlimited rotation, generic risk retry

**Proxy Attempt Context**:
A fresh consumer-side browser context created for one Source Fetch Proxy attempt. It reads the shared consumer login snapshot but never writes proxy-session state back to that snapshot.
_Avoid_: Reused proxy context, mutable shared consumer session

**Source Proxy Lease**:
A normalized, time-limited proxy allocation used by exactly one Proxy Attempt Context. Qingguo-specific API fields and errors are translated before the lease reaches the source-fetch flow.
_Avoid_: Raw Qingguo response, reusable global proxy

**Consumer Account Degradation**:
A consumer account state in which the saved login remains accepted, but a source-product page withholds price or SKU information. The first observed degradation signal stops the fetch and permanently invalidates the saved consumer login snapshot; recovery requires logging in with another consumer account.
_Avoid_: Dead account, expired login, proxy failure

**Login Online Check**:
A lightweight doctor check that verifies whether the merchant or consumer login state is still accepted. It does not certify proxy connectivity, source-product rendering, price visibility, SKU visibility, or source-fetch readiness.
_Avoid_: Source fetch health check, risk-control diagnosis
