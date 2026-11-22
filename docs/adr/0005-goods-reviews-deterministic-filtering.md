# ADR 0005: Deterministic filtering for goods reviews

## Status

Accepted - 2026-11-22 (implementation, fixture acceptance, and default-account read-only verification completed)

## Context

`pdd goods reviews` lists buyer reviews across all stars (up to the platform's 2,000-row view limit) and is primarily consumed by CLI workflows and downstream AI agents. Although `/saturn/reviews/list` omits pure system default reviews, live recon on 2026-11-22 confirmed that a substantial share of returned items are `status === 4` Platform Placeholder Reviews (backend-populated praise templates such as `该用户觉得商品很好，给出了5星好评`), alongside empty, pure-punctuation/emoji, pure-digit, or repeated-character comments.

Two project constraints shape the design: `pdd-cli` reports deterministic facts only (no LLM dependency, semantic scoring, or subjective praise-phrase dictionaries), and privacy redaction strips all picture and video URLs from review outputs. Pinduoduo Data Center also already owns the official term `有效评价` (`goodsUnfkUndfltRevCnt1m`), so CLI filtering must stay conceptually separate.

## Decision

- **Scope and default mode**: Deterministic filtering is enabled by default on `goods reviews` only (internal `mode: 'substantive'`, `min_length: 1`; emitted in view output as `filter: { mode: '实质内容', min_length: 1 }`). `diagnose reviews` remains unfiltered because it already scopes exclusively to Negative Reviews (`1–3` stars) as part of shop diagnostics.
- **CLI controls**: `goods reviews` adds `--all` (disables content filtering, internal `mode: 'all'` mapped to `'全部'`, `min_length: null`) and `--min-length <n>` (positive integer `>= 1`, internal `mode: 'min_length'` mapped to `'最小字数'`, keeping only reviews whose cleaned main or append comment reaches at least `n` characters). Argument validation and mutual exclusion (`--all` conflicts `--min-length`) are owned by the CLI registrar at Commander parse time (`commander.invalidArgument` / `commander.conflictingOption` -> `E_USAGE`, exit 2, `xhr_count: 0`, without duplicating CLI option validation in the service layer).
- **Substantive Review criteria (default mode)**: A review is retained if it has at least 1 valid character in its main comment or append comment, or carries a Negative Review rating (`(history_score ?? desc_score) <= 3`). Media-only (`picture_count > 0` or video) and tag-only `4–5` star reviews without buyer-authored text are filtered out because media URLs are redacted and unreadable to CLI/agent consumers, while `1–3` star reviews with media remain retained via the Negative Review rule.
- **Deterministic text normalization**:
  - Main comments with upstream `status === 4` or an exact match against the verified platform placeholder template set (backend templates `该用户未填写文字评价`, `该用户觉得商品较好`, `该用户觉得商品很好，给出了5星好评` plus frontend empty-comment fallback templates `该用户觉得商品稍有不足`, `该用户觉得商品不符合预期`, `该用户觉得商品一般`, `该用户觉得商品很好，给出去了5星好评`) contribute `0` valid characters; `append_comment` is evaluated independently.
  - Valid characters are Unicode letters (`\p{L}`), which strips whitespace, punctuation, symbols, emoji, and digits deterministically. Any cleaned string of length `>= 2` whose characters are all identical (case-insensitive for Latin letters) contributes `0` valid characters; length `1` (e.g. `差`, `假`) is preserved.
  - No subjective Chinese phrase blacklist (e.g. `好评`, `不错`) is embedded in the CLI.
- **Local lossless execution over upstream pushdown**: `goods reviews` continues fetching unfiltered pages from `/saturn/reviews/list` (extracting `status` internally in `REVIEWS_LIST` without changing the public `REVIEW_FIELDS` allowlist) and applies deterministic filtering locally. Live recon proved that while `/saturn/reviews/list` OR-unions `contentFilter` flags (`mainReviewContentStatus`, `appendStatus`, `videoStatus`), it AND-intersects them with `descScore` (causing `mainReviewContentStatus: "1"` to drop silent `status === 4` `1–3` star reviews), zeroes `totalNum` to `0` whenever `totalRows === 0` (losing the pre-filter platform `total`), and cannot enforce character-class or `--min-length` rules.
- **Accounting fields**: `goods reviews` preserves `total` as the platform's pre-filter `totalRows`, outputs filtered rows in `items`, and adds `fetched_count` (rows collected before filtering, distinguishing the 2,000-row cap from filtering), `filtered_out_count` (`0` under `--all`), and `filter: { mode, min_length }` (mapping internal codes `'substantive' | 'min_length' | 'all'` in the view layer to Chinese output labels `'实质内容' | '最小字数' | '全部'`). `headline` reports both platform `total` and retained item count when filtering is active.

## Considered Options

- **Pushing `mainReviewContentStatus: "1"` + `appendStatus: "1"` upstream**: Rejected for default execution because live recon proved it drops silent `1–3` star Negative Reviews (`status === 4`), zeroes `totalNum` on empty matches (corrupting pre-filter `total`), and cannot filter pure emoji/digits/repeated chars or `--min-length`. Splitting into multiple queries and deduplicating by `reviewId` was also rejected for unnecessary complexity and extra request volume.
- **Retaining media-only `4–5` star reviews (`picture_count > 0` or video)**: Rejected because `pdd-cli` strips image/video URLs by privacy policy, leaving uninspectable media counts as noise for agents and CLI readers; negative reviews with media are already retained by rating.
- **Opt-in filtering (default unfiltered)**: Rejected because default `goods reviews` outputs are heavily diluted by Platform Placeholder Reviews; `--all` preserves full access to raw rows whenever needed.
- **Embedding a subjective praise-phrase blacklist or external AI classifier (e.g. Jev)**: Rejected to uphold `pdd-cli`'s deterministic, zero-external-AI factual reporting boundary.

## Consequences

- High-volume queries exceeding 2,000 reviews in the window remain capped at 2,000 fetched rows before local filtering (`fetched_count: 2000`, `truncated: true`); if this becomes a practical bottleneck for `--stars 4,5` or `--min-length` queries later, upstream pushdown can be reconsidered with an explicit pre-filter total check.
- Existing callers expecting unfiltered default output from `pdd goods reviews` will receive Substantive Reviews by default and must pass `--all` to restore full raw rows; existing `REVIEW_FIELDS` per item stay unchanged.
- `REVIEWS_LIST` normalizer extracts `status` (nullable for backward compatibility with minimal test fixtures) while keeping it internal to the service/view filtering layer.
