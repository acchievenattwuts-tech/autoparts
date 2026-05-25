# Product Search Log Analysis

## Scope

Implement the analysis and reviewed-apply layer for `ProductSearchLog` so admins
can review no-result and low-result searches as grouped, normalized query
clusters.

This phase does not auto-import synonyms or product aliases. It surfaces
candidate actions and lets an admin explicitly apply a reviewed candidate.

## Checklist

- [x] Read `AGENTS.md`, `PLAN.md`, `docs/architecture.md`, and `docs/roadmap/active.md`.
- [x] Review current product search telemetry and report implementation.
- [x] Log low-result searches in addition to no-result searches.
- [x] Add normalized query aggregation helpers.
- [x] Add candidate action classification for common search gaps.
- [x] Update admin product search report to show no-result and low-result clusters.
- [x] Verify with focused tests.
- [x] Verify production build.

## Flow

1. Search runs on storefront/admin.
2. Telemetry records queries with result count below the quality threshold.
3. Report normalizes query variants such as spacing, dash, slash, and case.
4. Report groups raw query variants under the normalized query.
5. Report suggests a review action: `SearchSynonym`, `ProductAlias/OEM`, `Fitment/Year`, or `Ignore`.
6. Human reviews and applies changes manually through existing admin/import flows.

## Phase F2 Checklist

- [x] Keep review/apply flow inside the existing Product Search Quality report.
- [x] Add SearchSynonym apply action that updates an existing term or creates a new term.
- [x] Add ProductAlias apply action that adds a reviewed alias by exact product code.
- [x] Preserve permissions, audit logging, and search/storefront cache refreshes.
- [x] Add focused helper tests for candidate synonym merge behavior.
- [x] Verify production build.

## Phase F2 Flow

1. Admin opens Product Search Quality report.
2. Admin reviews a normalized query cluster and its candidate action.
3. For `SearchSynonym`, admin enters the canonical term and applies the raw query as a synonym.
4. For `ProductAlias/OEM`, admin enters an exact product code and applies the raw query as a product alias.
5. Server action validates permission, deduplicates existing data, writes audit log, refreshes caches, and returns to the same filtered report.

## Phase F3 - Review Outcome Tracking

Goal: make each reviewed query cluster trackable so the team knows what is still
pending, what was applied, and what was intentionally ignored.

Checklist:

- [x] Add persistent review outcome storage keyed by normalized query and candidate action.
- [x] Track status values: `pending`, `applied`, `ignored`, `needs-investigation`, and `duplicate`.
- [x] Store review note, reviewed by, reviewed at, applied type, and applied reference.
- [x] Update apply actions to create or update the review outcome automatically.
- [x] Add report filters for pending, applied, ignored, needs investigation, and duplicate.
- [x] Add buttons for `Ignore`, `Needs investigation`, and `Duplicate` with optional note.
- [x] Add summary counts for pending/applied/ignored/needs-investigation items.
- [x] Verify permissions, audit logging, light/dark mode, and report filter behavior.

Out of scope:

- Auto-applying any candidate.
- Changing search ranking.
- Changing fitment data model beyond references needed for outcome tracking.

## Phase F4 - Fitment/Year Remediation Flow

Goal: turn `fitment-year` candidates into a practical admin workflow for fixing
product-to-car-model coverage.

Checklist:

- [x] Detect fitment/year signals from query clusters and surface parsed model/year hints.
- [x] Add remediation form that links a query cluster to product code, car model, optional submodel, and year range.
- [x] Reuse existing `ProductFitment` data model unless implementation proves a schema gap.
- [x] Validate year ranges and car model selection before writing fitment data.
- [x] Write audit logs and refresh product/search/storefront caches after fitment changes.
- [x] Mark related review outcome as applied or needs investigation.
- [x] Add focused tests for fitment/year parsing and validation helpers.

Out of scope:

- Bulk fitment import.
- Automatic model detection without human confirmation.
- New car catalog dependency unless separately approved.

## Phase F5 - Closed-Loop Measurement

Goal: measure whether reviewed changes improve search quality after they are
applied.

Checklist:

- [x] Store baseline snapshot when an outcome is created: count, average result count, latest query time, and source mix.
- [x] Compute after-apply metrics for the same normalized query over a defined window.
- [x] Show before/after result count trend in the Product Search Quality report.
- [x] Flag outcomes that were applied but still produce no-result or low-result searches.
- [x] Add dashboard summary for improved, unchanged, and regressed reviewed queries.
- [x] Keep measurement read-only; do not auto-tune ranking in this phase.

Out of scope:

- Search ranking algorithm changes.
- A/B testing infrastructure.
- External analytics integration.

## Phase F6 - Guarded Auto-Apply

Goal: reduce repetitive manual work for high-confidence candidates while keeping
review controls and rollback visibility.

Prerequisites:

- Phase F3 review outcome tracking is live.
- Phase F5 closed-loop measurement is live.
- Admin can review applied/ignored history before enabling automation.

Checklist:

- [x] Define auto-apply eligibility rules for low-risk synonym candidates only.
- [x] Add dry-run mode that reports what would be applied without writing data.
- [x] Add admin setting to enable auto-apply explicitly.
- [x] Write outcomes, audit logs, and applied references for every auto-applied candidate.
- [x] Add duplicate and max-synonym safeguards before writes.
- [x] Add rollback guidance in the outcome detail.
- [x] Exclude ProductAlias/OEM and fitment/year candidates until they have separate confidence rules.

Out of scope:

- Fully autonomous ProductAlias creation.
- Fully autonomous fitment changes.
- Importing external synonym datasets without review.

## Hardening 2026-05-25

Goal: address critical correctness/performance findings from the post-F6 audit.
Scope is bug-fix only — no new features and no schema changes.

Checklist:

- [x] Make storefront/admin search telemetry fire-and-forget so a slow log
      insert never blocks the user-facing search response.
- [x] Tighten `sanitizeReturnTo` in the report Server Actions to reject prefix
      tricks such as `/admin/reports/product-search-no-result-evil` and any
      `//host` open-redirect attempts.
- [x] Add explicit `return` after every `redirectWithStatus` in
      `applySearchSynonymCandidate` so the create-new branch can never run
      after the update-existing branch.
- [x] Pre-validate the entire auto-apply batch (in memory, using the
      already-loaded SearchSynonym list) before any database write, so a
      mid-loop "list is full" no longer leaves partial commits.
- [x] Use the pre-loaded SearchSynonym list as the audit `before` snapshot to
      remove the per-item N+1 `findUnique` inside auto-apply.

## Hardening 2026-05-25 (Proposal A + B)

Goal: address the two follow-ups identified during the previous hardening pass.
Still bug-fix scope — no new features.

Checklist:

- [x] Proposal A: dedupe `ProductSearchLog` writes by `(normalizedQuery,
      source, hourBucket)`. Adds `dedupeKey`, `hitCount`, and `updatedAt`
      columns plus a unique index, switches telemetry to `upsert`, and teaches
      the cluster aggregator to count `hitCount` as the row weight so frequency
      stats are preserved.
- [x] Proposal B: wrap the auto-apply DB writes (SearchSynonym + matching
      ProductSearchReviewOutcome) in a single `db.$transaction` so any failure
      rolls the whole batch back. Baseline computation and audit logging stay
      outside the tx (baseline reads up to 1000 log rows; audit/revalidate must
      reflect the final committed state).

Out of scope for this round:

- Backfilling historical `ProductSearchLog` rows into deduped buckets — legacy
  rows keep `dedupeKey = NULL` and continue to count as one hit each.
- Touching the other four apply Server Actions (`markProductSearchReviewOutcome`,
  `applySearchSynonymCandidate`, `applyProductAliasCandidate`,
  `applyProductFitmentCandidate`) — they remain on the single-row write path
  via `upsertReviewOutcome`.

Operator note:

- The schema change requires `npx prisma db push` against the target
  environment before deploying the telemetry change; otherwise the upsert call
  will error on the missing `dedupeKey` column.

## Hardening 2026-05-25 (Important Level — Items 7-12)

Goal: address the "important / urgent" findings from the post-F6 audit.
Still bug-fix scope — no new features, no schema changes.

Checklist:

- [x] Item 7: Clarify Pending/Applied/Ignored/Needs-investigation/Duplicate count
      cards on the Product Search Quality report as system-wide (label suffix
      "(ทั้งระบบ)" + tooltip), since outcome counts do not honor the report's
      date/source/quality filters.
- [x] Item 8: Reduce page query load — replace 5 separate `productSearchLog.count`
      calls with a single `groupBy({ by: ["source", "resultCount"], _count })`
      and aggregate in memory; lower `ANALYSIS_LIMIT` from 1000 to 500 so the
      analysis + after-measurement `findMany` calls stay well under 3s SLA.
- [x] Item 9: Cap closed-loop `afterMeasurementLogs` via the same 500-row
      `ANALYSIS_LIMIT` (baseline computation is already cached on
      `ProductSearchReviewOutcome.baselineCount` from F5 — only re-computed
      when an outcome has no baseline yet).
- [x] Item 10: Replace misleading "f2Applied / ProductAlias already exists"
      and "f2Applied / ProductFitment already exists" with `f2Error` plus a
      clear Thai message, so admin no longer thinks a new record was created.
- [x] Item 11: Replace native `<select>` car-model picker (optgroups, often
      &gt;10 items) with `SearchableSelectFilter` so admins can type-to-search
      across all brand/model combinations.
- [x] Item 12: Fix audit-log entityType — `applyProductAliasCandidate` and
      `applyProductFitmentCandidate` now write `AuditAction.CREATE` with
      `entityType: "ProductAlias"` / `"ProductFitment"` (was incorrectly
      `UPDATE` on `Product`), and the unused product snapshot helpers are
      removed.

Out of scope for this round:

- Filtering outcome counts by date/source/quality (would require keying
  outcomes to log rows, beyond bug-fix scope).
- Materialized view for cluster aggregation (proposed in item 8 but
  requires schema + refresh strategy).
- ProductAlias/Fitment "already exists" silently marking review outcome
  as APPLIED (current behavior treats it as user error; revisit if
  product team wants idempotent semantics).

## Hardening 2026-05-25 (Dependencies — Items 7/8 Follow-up)

Goal: tackle the new dependencies surfaced during the Important-level hardening
round. Bug-fix scope expanded with one additive schema change for cache.

Checklist:

- [x] Dep 2A: Outcome count cards now include a "Reviewed in range" subtitle
      counting outcomes whose `reviewedAt` falls inside the report's date
      filter (semantic = admin review activity in this period).
- [x] Dep 2B: Outcome count cards' main number counts outcomes whose
      `normalizedQuery` appears in the filtered log window. Derived from the
      already-loaded `outcomes` array (no additional DB query).
- [x] Dep 1: Add `ProductSearchClusterCache` model + migration. Cache
      pre-aggregates ALL clusters for rolling windows ("last-7-days",
      "last-30-days") so the report can skip the 500-row live aggregation when
      the admin's date filter matches one of those windows. Cache is refreshed
      manually via two buttons in a new "Cluster cache (rolling windows)"
      section above the cluster table; freshness window is 1 hour, then the
      page falls back to live aggregation. No cron infrastructure exists in
      the repo, so refresh stays manual for now.

Operator notes:

- The schema change requires `npx prisma db push` against the target
  environment before deploying the report code; otherwise the cache lookup
  will error on the missing table.
- Admins must press "Refresh" once per window after deploy to populate the
  cache; until then the report falls back to live aggregation (existing
  behavior).

Out of scope for this round:

- Automatic refresh via cron — needs a cron infrastructure decision first
  (Vercel cron, separate worker, etc).
- Caching arbitrary admin-chosen date ranges — would explode storage and
  rarely hit. Only rolling windows are cached.
- Replacing in-memory aggregation entirely — kept as the fallback path.

## Out Of Scope

- Ranking changes.
