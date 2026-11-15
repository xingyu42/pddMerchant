# ADR 0004: Goods profit reporting semantics

## Status

Accepted - 2026-10-31 (implementation and fixture acceptance verified); amended 2026-11-15 (insurance from platform fee records; window by confirm time)

## Context

Merchants want to know whether a goods item earns money after costs, e.g. whether a promo ROI of 2.5 is still profitable. Pinduoduo does not store purchase cost, the order list carries no refund amount and no `sku_id`, and the platform's share of discounts is not exposed. Any profit figure therefore rests on choices the upstream data cannot settle. The project also reports facts only: `--break-even` and good/bad classifications were removed earlier.

## Decision

- **The window is by confirm time (成交时间)**: an order belongs to the window when its order-list `confirm_time` (seconds, equal to the payment time) falls in `[start, end)` of the last N complete Shanghai days, matching the platform data center's 成交 caliber. A cancelled unpaid order has `confirm_time` 0 and belongs to no window; any other missing, non-numeric or zero value marks order collection incomplete.
- **Costs are Merchant Cost Entries** stored locally per account, mall, and goods, with optional overrides matched exactly on the order `spec` text. An unmatched spec falls back to the goods default; with neither, profit is `null`. Only the current value is kept, and the output exposes `cost_updated_at`.
- **Return-shipping insurance (`insurance_yuan`) is the platform-charged service fee** of the Consumer Experience Plan, read per order from the plan's fee records (`order_insurance_list`, pending + charged, filtered by record creation time from one day before the window start to the window end, split into spans of at most 30 days) and matched on order number. The amount is platform-reported and never recomputed from the fee rate; the merchant-entered per-order insurance value is no longer read. Per order: a charged record counts in full even if the order is later refunded (agreement 5.1: a collected fee is not refunded); a pending record counts unless the order was refunded or cancelled before payment; an order with no record counts `0` (the platform did not charge it, e.g. before the plan was enabled), which is only valid when the records were collected completely; a cancelled unpaid order is `0`. Amounts are accepted only with `unit: "YUAN"`; any other unit makes that order's fee `null` with a warning. If collection fails or is truncated, insurance, merchant cost, gross and net profit are `null` with a hint, and `summary.data_quality` reports `insurance_complete` / `insurance_truncated`. Shipping compensation (运费补偿) is paid by the platform to the buyer and is not a merchant cost; the merchant bears only the service fee, so compensation is excluded from goods profit by design and no compensation field is reported.
- **Revenue = paid amount + platform discount**. Platform-funded discounts are assumed to be fully settled to the merchant; the total `platform_discount_yuan` is reported so the assumption can be audited.
- **Refunds**: an order with `after_sales_status = 5` is treated as a full refund with the goods returned. It contributes no revenue and no goods cost. Packaging and courier cost are still deducted if it had shipped. Orders still in after-sales (`10`/`11`) count as normal and are reported separately.
- **Promotion spend** is attributed only where `promo.entityReport` names the goods. Shop-level spend (shop follow, inquiry, etc.) appears only in the shop total and is never apportioned. Failed promo collection makes spend and profit `null`; collected-but-absent spend is `0`.
- **Output** is numeric only (`net_profit_yuan`, `gross_margin_pct`, …). Profit or loss is the sign of the number. No break-even ROI, no "loss-making" label.

## Considered Options

- Cost in a JSON/CSV file or per-invocation flags: rejected in favour of SQLite, which matches account storage and cascade deletion.
- Cost history with effective dates: deferred until price changes actually distort reports.
- Revenue = paid amount only, or goods amount minus merchant discount: rejected; the first understates platform-subsidised orders, the second ignores the buyer-paid shipping.
- Apportioning shop-level promo spend by sales share: rejected because it manufactures a number that reads as fact.
- Insurance as a merchant-entered fixed value per order, or recomputed from the daily fee rate: rejected (2026-11-15) once per-order fee records were found; the fee varies by order date and the platform record is the fact.
- Windowing by group time (成团时间, `group_time`): rejected (2026-11-15); the order list does not return it, so every order was dropped, and fetching it would cost one order-detail call per order. Group time is usually 0–30 minutes after confirm time.
- Deducting the fee back for refunded orders: rejected; the plan agreement says a collected fee is not refunded.

## Consequences

- Refund-only-without-return orders are overstated as "goods returned"; field descriptions must say so.
- Platform co-funded campaigns (e.g. 百亿补贴 with merchant share) overstate revenue.
- Renaming a spec in the backend silently drops its override; the report exposes the count of orders that fell back to the goods default.
- Orders whose fee record was created more than one day before the window start are reported as uncharged (`0`).
- Changing any rule above changes the `data` contract of `goods profit`.
