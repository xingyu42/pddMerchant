# Live API Contract Evidence (Redacted)

Date: 2026-07-30

Environment: existing signed-in merchant Chrome profile, merchant home page. The probe returned only response-shape metadata and boolean field presence. No order number, goods ID, Cookie, Anti-Content, authorization, mobile, address, receiver, image, or raw response value was persisted.

## Runtime

- Active runtime global: `webpackJsonp`.
- Runtime value is an Array using the Webpack 4 push contract.
- The merchant request client was discoverable from the home-page module cache without navigating to the orders page.
- Webpack 4 capture with an empty chunk-id list succeeded; deleting the temporary module from `webpackRequire.c` and `webpackRequire.m` left no probe module entry.

## Request Client Return Shape

- `recentOrderList`: direct unwrapped object with `hasMore`, `pageItems`, `totalItemNum`; no `success`, error code, or nested `result`.
- `statisticWithType`: direct unwrapped object with `unship`, `unship12h`, `delay`, `unreceive`; no envelope fields.
- `orderDetail`: direct unwrapped order object; no envelope fields.

This confirms the current page client resolves successful requests to `raw.result`, while compatibility code still needs to accept a future full business envelope without wrapping it again.

## Detail Request Field

- A request containing only `orderSn` and `source: 'MMS'` succeeded.
- The returned detail object exposed its order number as `order_sn`.
- Conclusion: request and response naming differ. Keep request `orderSn`; do not infer request naming from response `error_code` or `order_sn` fields.

## Data Presence

- The one-item list probe contained an order identifier and goods identifier.
- The detail probe contained an order identifier and goods identifier.
- These observations prove non-null fields existed in the sampled responses only. They do not establish total historical order volume, per-goods sales, or complete order-to-goods mapping.
