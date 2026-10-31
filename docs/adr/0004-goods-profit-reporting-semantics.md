# ADR 0004: Goods profit reporting semantics

## Status

Accepted - 2026-10-31 (implementation and fixture acceptance verified)

## Context

Merchants want to know whether a goods item earns money after costs, e.g. whether a promo ROI of 2.5 is still profitable. Pinduoduo does not store purchase cost, the order list carries no refund amount and no `sku_id`, and the platform's share of discounts is not exposed. Any profit figure therefore rests on choices the upstream data cannot settle. The project also reports facts only: `--break-even` and good/bad classifications were removed earlier.

## Decision

- **Costs are Merchant Cost Entries** stored locally per account, mall, and goods, with optional overrides matched exactly on the order `spec` text. An unmatched spec falls back to the goods default; with neither, profit is `null`. Only the current value is kept, and the output exposes `cost_updated_at`.
- **Revenue = paid amount + platform discount**. Platform-funded discounts are assumed to be fully settled to the merchant; the total `platform_discount_yuan` is reported so the assumption can be audited.
- **Refunds**: an order with `after_sales_status = 5` is treated as a full refund with the goods returned. It contributes no revenue and no goods cost. Packaging and courier cost are still deducted if it had shipped. Orders still in after-sales (`10`/`11`) count as normal and are reported separately.
- **Promotion spend** is attributed only where `promo.entityReport` names the goods. Shop-level spend (shop follow, inquiry, etc.) appears only in the shop total and is never apportioned. Failed promo collection makes spend and profit `null`; collected-but-absent spend is `0`.
- **Output** is numeric only (`net_profit_yuan`, `gross_margin_pct`, …). Profit or loss is the sign of the number. No break-even ROI, no "loss-making" label.

## Considered Options

- Cost in a JSON/CSV file or per-invocation flags: rejected in favour of SQLite, which matches account storage and cascade deletion.
- Cost history with effective dates: deferred until price changes actually distort reports.
- Revenue = paid amount only, or goods amount minus merchant discount: rejected; the first understates platform-subsidised orders, the second ignores the buyer-paid shipping.
- Apportioning shop-level promo spend by sales share: rejected because it manufactures a number that reads as fact.

## Consequences

- Refund-only-without-return orders are overstated as "goods returned"; field descriptions must say so.
- Platform co-funded campaigns (e.g. 百亿补贴 with merchant share) overstate revenue.
- Renaming a spec in the backend silently drops its override; the report exposes the count of orders that fell back to the goods default.
- Changing any rule above changes the `data` contract of `goods profit`.
