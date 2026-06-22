<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
# Print Form Sync Rule

When changing the invoice / delivery-note print form at `app/admin/(protected)/sales/[id]/page.tsx`, you must also update `app/admin/delivery/print/page.tsx` in the same round. These two pages intentionally use the same document form and must stay in sync. Do not ship a change that updates only one of them.

When changing the receipt-form presentation (layout/styling/text blocks/signature section) for `app/admin/(protected)/sales/[id]/page.tsx`, you must also review and update `app/admin/(protected)/receipts/[id]/page.tsx` in the same round. These two pages render receipt documents with intentionally similar presentation and should stay aligned unless the task explicitly calls for a difference.

All admin print forms must follow a two-layer structure: shared print presentation primitives first, then document-specific content/logic on top. Do not introduce a new print page by copying a full layout block inline when it can use the shared print layer instead.

If a change touches any shared print primitive or any presentation line intentionally reused by multiple print forms, you must review and update every affected consumer in the same round. Do not ship shared print changes with one form left visually out of sync.

# Admin Theme Sync Rule

When changing UI/UX on any admin surface, you must review and update both light mode and dark mode in the same round automatically. Do not ask the human whether dark mode should also be updated â€” that is the default requirement. Apply theme changes carefully, preserve the existing business logic, and avoid letting one theme drift visually or behaviorally out of sync with the other.

# Quick Search Sync Rule

When adding, removing, renaming, regrouping, or changing access for any admin menu item or admin entrypoint, you must review and update Quick Search command coverage in the same round. The `>` command mode must stay in sync with the currently available admin menus and must continue to respect the same permission gating as the sidebar/navigation.

Admin navigation and Quick Search command entries must share the same source of truth whenever possible. Do not maintain a second hand-written list of navigable admin menu commands if it can be derived from the shared navigation config.

When introducing a new admin menu, admin page entrypoint, or user-facing admin workflow shortcut, add or derive its Quick Search coverage before shipping. Do not leave new functionality discoverable in the UI but missing from Quick Search.

# Admin Search / Report Submit Rule

When adding or changing any admin `ค้นหา`, `แสดงรายงาน`, `แสดงรายการ`, or equivalent GET-filter submit button, you must use the shared `AdminSearchForm` + `AdminSearchSubmitButton` pattern in the same round. These flows must preserve the existing filter/query logic, navigate client-side, show immediate pending/loading feedback, and must not regress back to a full page refresh.

# Database Date/Time Schema Rule

All new Prisma `DateTime` fields must explicitly use `@db.Timestamptz(3)` unless a narrower PostgreSQL type is deliberately approved for that exact field. Do not add bare `DateTime` or PostgreSQL `timestamp without time zone`; date/time storage must preserve the instant semantics used by `lib/th-date.ts`.

# Bug Investigation Approval Rule

When the user asks to investigate, inspect, review, diagnose, analyze, check, or verify a bug or problem, including Thai requests such as `ตรวจสอบ`, `เช็ค`, `ดูสาเหตุ`, `หาสาเหตุ`, or similar wording, you must treat the turn as investigation-only unless the user explicitly asks you to edit code in that same message.

When available, use the `bug-investigation` skill for these requests.

For investigation-only bug/problem requests, do not modify application code, configuration, schema, migrations, dependencies, or generated artifacts. You may read files, inspect logs, run non-destructive commands, and reproduce behavior when appropriate.

Your investigation response must cover:
1. Likely root cause or confirmed cause.
2. Proposed fix options.
3. Pros of each option.
4. Cons or risks of each option.
5. Expected behavior changes after the fix.
6. Verification or testing needed.

After presenting the investigation, wait for explicit user confirmation before making any code changes. If the safest next step is a code change, state that clearly but do not implement it until confirmed.

# Documentation Entry Rule

When you need project context, read documents in this order unless the task clearly requires something else:
1. `AGENTS.md`
2. `PLAN.md`
3. `docs/architecture.md`
4. `docs/roadmap/active.md`
5. Relevant files under `docs/decisions/` and `docs/specs/`

Treat `PLAN.md` as the active index and `docs/archive/PLAN-legacy-2026-05-21.md` as historical detail only. Do not use the legacy archive as the default starting point.
<!-- END:nextjs-agent-rules -->
