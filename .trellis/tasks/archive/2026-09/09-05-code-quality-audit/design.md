# Audit Design

## Boundary

Review the current working-tree version, recording HEAD and existing changes before execution. Do not silently replace modified files with HEAD versions. Preserve all existing work. Changes produced by this task are limited to audit documents and, if needed, isolated reproduction artifacts under this task directory.

The repository survey covers first-party runtime code, tests, scripts, configuration, and relevant documentation. Inventory generated, vendored, historical, and tooling material separately rather than treating it as runtime code. Exclude credential stores, live runtime data, logs, dependencies, and .git contents from content scans. Documentation is a contract reference, not proof of runtime behavior.

## Selection Method

Map responsibilities and dependencies, then compare functional risk signals and maintenance burden signals separately. Use concrete evidence: error handling and state transitions, duplicated business rules, responsibility coupling, abstraction cost, and test gaps. File size and counts are navigation aids, not findings. Select three modules based on impact, concentration of evidence, and cross-cutting reach; explain the tradeoffs without artificial numeric scores.

Trace selected modules through necessary callers, contracts, and dependencies. Follow serious cross-module defects beyond the three-module boundary. Do not pad the report to meet a finding quota.

## Evidence Contract

For each finding record category, priority, file:line and symbol, triggering conditions or concrete maintenance scenario, supporting evidence, impact, and the smallest recommended remediation. Keep verified defects, supported maintenance findings, and unverified risks distinct. Search for counterevidence such as caller guarantees, intentional design, or tests before accepting a finding.

Rank functional risks and maintenance burden separately. Deduplicate findings sharing one root cause. Explain prioritization by impact and reach, not by preferred coding style.

## Verification Safety

Inspect package scripts, test setup, fixture transport, subprocess behavior, and storage paths before running tests. Permit only tests shown to use local fixtures and isolated temporary state. Setting a fixture environment variable alone does not prove isolation. Skip unsafe or uncertain commands and record the gap. Do not start live CLI workflows, browsers using real profiles, or daemons. Do not access live account/session state or real merchant endpoints.

Any minimal reproduction must use synthetic inputs and isolated task-local or temporary artifacts, without editing existing source or test files. No dependency installation or global configuration changes are planned.

## Deliverables

- report.md: separate prioritized functional and maintenance findings, remediation order, verification outcomes, and residual uncertainty.
- coverage.md: repository survey, selected modules and rationale, deeply reviewed paths, survey-only areas, and exclusions.

## Completion Boundary

Complete the survey and three focused reviews; resolve accepted findings against their contracts and available safe local checks. Record remaining uncertainty explicitly. This is a bounded first-pass audit, not proof that unreported code is defect-free. Remediation remains a separate approval and task.
