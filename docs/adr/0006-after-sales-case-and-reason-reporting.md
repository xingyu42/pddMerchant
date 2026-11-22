# ADR 0006: After-Sales Case and refund reason reporting

## Status

Accepted - 2026-11-22. All three slices are implemented, two-axis code review findings are resolved, and authorized real-account read-only verification on the default merchant account passed alongside the recon findings in [the recon report](../research/after-sales-refund-reason-recon-2026-11-22.md).

## Context

Before this change, `pdd-cli` exposed order details and order-level after-sales statistics without the reasons buyers requested after-sales service. Live read-only recon on 2026-11-22 verified that:

- `/mangkhut/mms/recentOrderList` and `/mangkhut/mms/orderDetail` carry `after_sales_id` and status codes without any refund reason field. Moreover, `orderDetail` returns `after_sales_status` as a Chinese string and places the numeric code in `after_sales_status_code`, which previously caused `toOrderDetailView` to output `未知(<中文文案>)`.
- Pinduoduo's merchant workbench endpoints `/mercury/mms/afterSales/queryList` and `/mercury/mms/afterSales/queryParams` are plaintext JSON `page-api` endpoints callable directly from `PDD_HOME`, exposing per-case `afterSalesReasonCode`, `afterSalesReasonDesc`, type, status, amounts in fen, and application/close timestamps.
- Additional context such as buyer free-text `questionRemarks`, `afterSalesFlows` timelines, and `qualityReasonRefund` / `isNoReason` flags resides inside the Next.js SSR HTML payload of `/aftersales-ssr/detail` alongside extensive receiver/address/image PII, while Data Center `/sydney/api/saleQuality/*` provides aggregate shop/goods metrics (quality refunds, dispute refunds, platform intervention rates) without per-reason breakdowns.

## Decision

- **Domain and caliber separation**:
  - Model workbench records as **After-Sales Cases** (售后单) tracked by application time (`createdAt`), covering all 5 types (`退款`, `退款退货`, `换货`, `补寄`, `维修`) and all lifecycle statuses by default, distinct from **Orders** (tracked by order/group time, with 1:N cardinality between an Order and After-Sales Cases).
  - Apply fine-grained case status labels derived from `queryParams.afterSalesStatusParams` only to After-Sales Case views (`orders after-sales` and `orders detail`'s `after_sales_cases`). Existing order-level statistics (`orders.stats`, `diagnose.after-sales`) and profit accounting (`goods.profit`, [ADR-0004](file:///d:/Dev/pddMerchant/docs/adr/0004-goods-profit-reporting-semantics.md)) retain their established `after_sales_status = 5` / open-after-sales calibers unchanged.
- **Pure JSON `page-api` boundary**:
  - Integrate only `/mercury/mms/afterSales/queryList` and `/mercury/mms/afterSales/queryParams` in v1.
  - Exclude per-case HTML/SSR scraping of `/aftersales-ssr/detail` to avoid slow per-order browser navigation and broad PII surface exposure; defer Data Center `/sydney/api/saleQuality/*` and `/api/colombo/rectification/listv2` to separate future topics.
- **CLI entry points and query semantics**:
  - Add `pdd orders after-sales` under the existing `orders` command group rather than creating a new top-level command group.
  - Support two mutually exclusive windowing modes (`E_USAGE` on conflict):
    - `--days <n>`: rolling window in `1–365` days (default `30`). When `--sn` is supplied without `--days`, `--since`, or `--until`, the window defaults to unbounded history (`window: { start_at: null, end_at: null, days: null }`); explicit `--days` or `--since`/`--until` with `--sn` still applies the filter.
    - `--since` / `--until`: exact start/end bounds accepting either `YYYY-MM-DD` (interpreted in `Asia/Shanghai` closed day boundaries `00:00:00` to `23:59:59`) or Unix seconds, allowing arbitrary historical slices. `--since` without `--until` defaults `--until` to current time; `--until` without `--since` or `since > until` fails with `E_USAGE`.
  - Support filters `--sn <order_sn>` and `--goods-id <id>` (mutually exclusive via `E_USAGE` because upstream shares one `searchText` field; `--sn` queries also apply a local `order_sn === sn` exact filter), `--status <all|open|refunded|closed>` (default `all`, mapping `refunded` to `[5]`, `closed` to `[6, 12, 17, 24]`, and `open` to in-progress status codes), and `--type <all|refund|return_refund|exchange|resend|repair>` (default `all`). Omit `--reason` filtering in v1.
  - Collect up to `20` pages at `pageSize: 100` (`2,000` cases max per invocation), emitting `fetched_count`, `total`, `truncated`, `window`, `reason_summary[]`, `items[]`, and `hints`. Wide historical spans exceeding `2,000` cases are sliced externally by callers/agents via `--since`/`--until` (weekly or monthly chunks) rather than adding multi-span loops inside a single CLI invocation.
- **Enriching `pdd orders detail --sn <sn>`**:
  - Fix the `after_sales_status` defect by reading `after_sales_status_code` whenever `after_sales_status` has no numeric value, using the existing order-level labels (so non-numeric `"无售后"` with `null` `after_sales_status_code` maps to `null`).
  - Trigger `queryList(searchText: sn)` automatically only when `orderDetail` indicates after-sales (`after_sales_id != null` or `after_sales_status_code != null`), keeping non-after-sales `orders detail` calls at zero extra requests.
  - Apply local exact `order_sn === sn` filtering and output `data.after_sales_cases` sorted by application time descending and numeric case ID descending (`[]` with no indicators or matches; `null` with a Chinese hint on degraded `queryList` failure). Fetch the reason dictionary only for non-empty matches. The headline adds the latest case or a degraded-list notice when applicable.
- **Shared view allowlist and `reason_summary[]` aggregation**:
  - Both `orders.after-sales` `items[]` and `orders.detail` `after_sales_cases[]` share one v2-compliant 18-field allowlist (`AFTER_SALES_CASE_FIELDS`): `after_sales_id`, `order_sn`, `goods_name`, `spec`, `quantity`, `type`, `status`, `status_detail`, `shipping_status`, `reason_code`, `reason_desc`, `reason_category`, `refund_amount_yuan`, `order_amount_yuan`, `receive_amount_yuan`, `created_at`, `closed_at`, `reverse_tracking_number`.
  - Keep platform-verbatim `reason_code` and `reason_desc` as primary identifiers; enrich `reason_category` from `queryParams.reasonCodeParams` (7 coarse workbench groups) and emit `null` for ungrouped live codes (such as `405030` `尺码没选对`) or when `queryParams` is unavailable.
  - Aggregate `reason_summary[]` by `reason_desc` (fallback `未知(<reason_code>)`) into `{ reason_desc, reason_category, count, share_pct, refund_amount_yuan }`, computing `share_pct` against `fetched_count`, setting `reason_category` only when all aggregated cases share one non-null category (else `null`), sorting by `count` descending then `refund_amount_yuan` descending, and explicitly noting truncation in `headline` and `hints`.

## Considered Options

- **Scraping `/aftersales-ssr/detail` `__NEXT_DATA__` in v1**: Rejected for v1 because it requires full-page navigation per case, introduces broad receiver/address/image PII surface, and is unnecessary when `queryList` already delivers structured reason codes, labels, amounts, and status via `page-api`.
- **Single-page `--page` / `--size` pagination for `pdd orders after-sales`**: Rejected because single-page samples cannot deliver an accurate window-level `reason_summary[]`; auto-paging up to `2,000` cases matches `pdd goods reviews` while keeping invocations bounded.
- **Internal multi-span splitting inside one CLI call**: Rejected in favor of caller-driven `--since` / `--until` slicing to avoid long-held account leases, timeout risk, and deep consecutive paging under rate limits.
- **New top-level `pdd after-sales` command group**: Rejected to keep order and post-order queries consolidated under `orders`, matching existing `orders list`, `orders detail`, and `orders stats`.
- **Altering existing `orders.stats` / `diagnose.after-sales` / `goods.profit` calibers or inventing CLI reason categories**: Rejected to preserve backward-compatible order/profit accounting and strict factual reporting without CLI-invented taxonomies.

## Consequences

- Callers querying high-volume windows exceeding `2,000` cases receive `truncated: true` with guidance to split the query into smaller `--since` / `--until` intervals.
- `orders detail` incurs additional read-only `page-api` calls only when an order carries after-sales indicators: up to 20 list pages and one dictionary request if cases match.
- Filtering by `--goods-id` depends on upstream `searchText` matching because `queryList` items omit `goodsId` in the response payload.
- `--type` sends a scalar integer `afterSalesType` or omits the field for `all`. Read-only verification confirmed that an array is rejected and `afterSalesTypeList` is ignored (recon §2.2).
