# 代码质量审查

## Goal

明确审查范围和标准，交付有代码证据的质量问题清单与整改优先级；不修改业务代码。

## Requirements

- Ground findings in code evidence and explain concrete impact; do not treat stylistic preferences as defects.
- Deliver prioritized findings and recommended remediation, without changing business code.
- Preserve existing uncommitted changes; do not commit or push.
- Survey the whole repository first, then deeply review the modules with the strongest concentration of problem evidence. Do not limit the review to uncommitted changes.
- Treat survey indicators as investigation leads, not confirmed defects; file size alone is not a finding.
- Cover functional failure risks and maintenance burden as equal review dimensions, with separate priority rankings.
- Maintenance findings must demonstrate concrete change cost or risk, such as duplicated rules, coupled responsibilities, or unnecessary abstraction; stylistic preference alone is insufficient.
- Verification is limited to local source inspection and isolated tests. Do not log in, request real merchant endpoints, or access or alter live account/session state.
- Inspect test setup before execution to ensure fixture transport and temporary storage isolation. Mark issues requiring live verification as unverified rather than confirmed defects.
- Deeply review the three highest-value modules identified by the survey, including necessary callers and dependencies. Follow serious cross-module issues beyond this limit and disclose the expanded scope.

## Confirmed Facts

- The user approved the final plan and audit execution with "开始任务".
- Initial checkout: branch main, HEAD 03c53f7.
- Existing changes: .gitattributes (staged), src/infra/daemon-launcher.js, src/infra/paths.js, and an untracked VMProtect handoff document. These are not audit-generated changes.

## Acceptance Criteria

- [x] The user has confirmed the review scope and quality criteria.
- [x] Each actionable finding cites a file and line, explains impact, and distinguishes verified defects from unverified risks.
- [x] The report ranks remediation priorities and states coverage and verification gaps.
- [x] Functional risks and maintenance problems have separate ranked lists, each backed by concrete evidence and impact.
- [x] The report explains why modules were selected for deep review and identifies areas surveyed but not deeply reviewed.
- [x] No business code or existing work has been modified by the audit.
- [x] Verification has not contacted real merchant services or accessed or changed live account/session state; live-only uncertainties are explicitly listed.

## Out of Scope

- Implementing fixes, committing, pushing, or exposing sensitive runtime data.
- Claiming exhaustive verification of the whole repository after a survey and three focused module reviews.

## Outcome

- The bounded first-pass audit produced report.md and coverage.md, with isolated observations under repro/.
- No remediation, commit, push, or archive was performed. Final acceptance verification is recorded in implement.md.
