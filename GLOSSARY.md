# pdd-cli Domain Language

This glossary defines project-specific terms used when discussing merchant operations, authentication, and source-product publishing.

## Merchant Authentication

**Merchant Session Validity**:
The server-side condition in which Pinduoduo accepts saved merchant credentials for a safe authenticated merchant request. Local Cookie expiry, auth-state presence, daemon liveness, homepage HTTP 200, and customer-service IM connectivity do not establish it.
_Avoid_: Cookie alive, daemon online, login file valid, IM online

**Merchant Authentication Check**:
A safe request whose endpoint-specific result explicitly reports whether saved merchant credentials are currently accepted. A successful check establishes Merchant Session Validity at that moment, but does not prove that the session was extended.
_Avoid_: Heartbeat, refresh, keepalive

**Merchant Session Renewal**:
A server-side extension or replacement of the time window in which merchant credentials remain accepted. It requires direct credential/response evidence or a controlled time-series comparison; a successful Authentication Check, local auth-state write, or auxiliary Cookie update does not establish renewal.
_Avoid_: Check succeeded, snapshot refreshed, Cookie touched

**Merchant LoginToken Consumption**:
The use of a source-identified merchant LoginToken to establish verified, account-bound Cookie materials for subsequent merchant operations. It does not imply issuance of a new server-side credential or Merchant Session Renewal.
_Avoid_: Token exchange, silent renewal, Cookie refresh

**Merchant Cookie Repair**:
The restoration of an account's missing or inconsistent browser Cookies from retained, verified merchant credentials belonging to that account. It does not issue a new LoginToken or establish Merchant Session Renewal.
_Avoid_: Session renewal, Token exchange, service-side Cookie refresh

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

## Browser Runtime

**Headless Consistency Profile**:
The fixed browser launch and Context used by automated headless commands: true `headless:true` with only `--enable-gpu`, a host-platform Chrome UA derived from the running browser version, viewport `1902x984`, screen `1920x1080`, DPR `1`, `zh-CN`, `Asia/Shanghai`, and only the three approved window/screen getter overrides. Chrome still owns renderer selection. It reduces project-created contradictions but is not an undetectability promise.
_Avoid_: Stealth profile, random fingerprint, anti-detect browser

**Desktop Natural Profile**:
The Context used by `--headed`. It uses `viewport:null` and leaves UA, locale, timezone, DPR, screen, and window properties to the visible browser environment.
_Avoid_: Headed consistency spoofing, desktop fingerprint preset

**Runtime Browser Profile**:
Internal metadata bound to one Browser instance, recording headless/headed mode, the actual `chrome` or `chromium` channel, browser version, and its Context configuration. Every consumer Context inherits this profile before adding its own storage snapshot or source-fetch proxy.
_Avoid_: Global browser config, caller-defined Context overrides

**Property Override Allowlist**:
The complete handwritten browser-property override surface: `window.outerWidth`, `window.outerHeight`, and `screen.availHeight`, implemented by proxying their native getters while preserving descriptors. UA is set through the Context option, not an init-script getter.
_Avoid_: Navigator patch bundle, fingerprint spoof script

**Preferred Chrome Path**:
The launch policy that tries the installed system Chrome first and uses Patchright Chromium only when Chrome is explicitly reported missing. Permission, crash, proxy, and other runtime failures do not trigger fallback.
_Avoid_: Retry on every launch error, silent browser switching

## Operating Reports

**Merchant Cost Entry**:
A per-unit cost supplied by the merchant because Pinduoduo does not hold it: goods purchase cost, packaging cost, courier cost, and optional fixed per-order items. A goods item without a cost entry has unknown profit rather than zero cost.
_Avoid_: Platform cost, default cost, estimated cost

**Goods Net Profit**:
The amount a goods item earned in a reporting window: its order revenue, less successful refunds, Merchant Cost Entries multiplied by the corresponding quantities, and the promotion spend attributed to that goods item. Profit or loss is expressed only by the sign of the number; no break-even threshold or profit classification is reported.
_Avoid_: Profitable goods, loss-making goods, break-even ROI

**Platform-Reported Score**:
A score or indicator issued by Pinduoduo itself, such as the 店铺综合体验星级 (Shop Experience Star Rating), the 领航员综合分 industry rank it is based on, and its per-dimension indicators, reported verbatim. It is distinct from scores generated by the CLI, which remain prohibited.
_Avoid_: Health score, CLI score, derived grade

**Negative Review**:
A buyer review whose description score is 3 stars or lower, covering both 中评 (3 stars) and 差评 (1-2 stars). Review keywords come only from Pinduoduo's own review tags; the CLI does not segment review text itself.
_Avoid_: Bad review (unscoped), keyword mining, word frequency

**Reply-Rate Caliber**:
The upstream source that defines a customer-service reply metric such as the 3-minute manual reply rate. Pinduoduo exposes several calibers that disagree for the same shop and day; every reported value names its caliber, and values from different calibers are never mixed or compared as one series.
_Avoid_: The reply rate, unified reply rate

**Obfuscated Metric**:
An upstream numeric value delivered as Private Use Area characters under a per-load remapped font. It counts as a fact only after decoding and a cross-check against a plaintext source; otherwise it is reported as unavailable.
_Avoid_: Encrypted data, garbled number, best-effort decode

**Estimated Merchant Receipt** (预估实收):
The per-unit amount Pinduoduo estimates the merchant receives for a SKU at its current price: the pre-coupon price (券前价) less the discounts funded by the merchant. It is a Platform-Reported figure, reported verbatim; the CLI never recomputes it from prices or fee rates. It is a forward-looking per-unit estimate and is distinct from the order revenue used in Goods Net Profit. Pinduoduo offers it as a single-unit receipt and as the lowest average multi-unit receipt, and under two merchant-discount calibers: 商家出资常规优惠 (regular merchant discounts) and 商家出资所有优惠 (additionally non-public discounts, multi-order instant reductions, and merchant-funded platform coupons). Every reported value names its caliber, and values from different calibers are never mixed.
_Avoid_: Net income, settlement amount, buyer price, CLI-calculated receipt

**Non-Promo Sales**:
The orders and transaction amount of a goods item that remain after subtracting the promotion's direct attribution from the goods total. It is a derived difference rather than a platform-reported split; a negative difference is unknown, not zero. Visitors are never split this way because promotion clicks are not visitors.
_Avoid_: Free traffic, natural traffic, organic visitors
