<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

> **Do not put project rules inside the block above.** `next dev` replaces everything between
> the `BEGIN:nextjs-agent-rules` and `END:nextjs-agent-rules` HTML comments with its own text —
> see `upsertAgentRulesBlock()` in `node_modules/next/dist/server/lib/generate-agent-files.js`,
> which keeps only what is before the START marker and after the END marker. Rules written
> inside were silently destroyed once already in this repo. Everything below this line is safe.

# How to work in this repo

Two instruction files are loaded every session:

- **`AGENTS.md`** (this file) — how you operate, and what must change together in the same round.
- **`.rules`** — what correct code looks like here: stack, conventions, security, domain invariants.

A rule lives in exactly one of them. When they appear to disagree, `AGENTS.md` wins on process and `.rules` wins on code.

---

## 1. This is not the stack you know

This repo runs **Next.js 16, React 19, Prisma 7, Base UI** — newer than your training data. APIs, conventions, and file structure may all differ from what you remember. Heed deprecation notices.

Before using any framework API you have not verified in THIS repo:

- read `node_modules/next/dist/docs/index.md`, then the relevant guide under `node_modules/next/dist/docs/01-app/`, **or**
- grep the existing codebase for the real usage pattern.

A name you recognize is something to verify, not something you know.

---

## 2. Edit discipline

When it will not affect the end result, **surgically edit a file rather than rewrite the entire thing**. Change the lines that need changing; do not regenerate a file to alter part of it.

Never rewrite wholesale — patch the affected lines only:

- `PLAN.md` and `docs/archive/PLAN-legacy-2026-05-21.md` (>500KB each)
- any file over ~400 lines
- any file containing Thai string literals

For `PLAN.md`: locate the checklist item, edit those lines, and append new sub-steps to the end of the relevant section. Never regenerate a section.

Rewriting a Thai-bearing file re-emits every Thai character and is the main way mojibake enters this repo — see the encoding rule in `.rules`.

---

## 3. Verification before declaring done

- Run **`npm run verify`** (lint + typecheck + test) before reporting a code task complete.
- Run `npm run build` only when the change affects build output. It is slow and is not the default check.
- Run **`npm run check:mojibake`** after writing any file containing Thai text. Do not rely on reading the characters yourself.
- Report the real command output. If a check fails, say so. Never report success on a check you did not run.

---

## 4. Progress reporting

- Say in one line what you are about to do before starting multi-step work.
- Give a short update as each meaningful step lands.
- Close with a summary complete enough that reading only the last message shows the whole task.
- Tool output is often hidden from the user. Never run a command purely to show them something — put the finding in your own text.

---

## 5. Scope

Bugs or improvements you notice **outside** the current task: report them at the end of your response. Do not fix them this round unless the requested work does not function without the fix.

The same-round sync rules in section 8 are **not** extras — they are part of the task whenever their trigger fires.

Commit only the tests the task calls for.

This is about extras only: **implement every behavior the task asks for, completely.**

---

## 6. When to stop and ask

Stop and ask the user before:

- editing `prisma/schema.prisma` — summarize every field added, changed, or removed first
- any delete / drop / truncate, or any migration that can lose rows
- changing business logic: MAVG, pricing, stock deduction, document numbering, AR/AP clearing, cash/bank movement
- removing or weakening a guard: reference-chain guard, permission check, root POST guard, audit write, notification dispatch
- building a feature that is not in `PLAN.md` — ask which phase it belongs to
- an SEO change that needs a new route segment, or that touches a file containing business logic
- LINE / Messenger work where the intended platform scope is genuinely ambiguous

Everything else that is reversible and inside the stated task: do it, then report what you did.

Do not gate work on a numeric confidence estimate. The list above is the gate.

**Plan first** for non-trivial work: summarize the plan and get confirmation before writing code — unless the task is already confirmed in conversation and maps to a `PLAN.md` checklist item, in which case proceed and update the roadmap afterwards (section 9).

---

## 7. Investigation-only requests

When the user asks to investigate, inspect, review, diagnose, analyze, check, or verify a bug or problem — including Thai wording such as `ตรวจสอบ`, `เช็ค`, `ดูสาเหตุ`, `หาสาเหตุ`, or similar — treat the turn as **investigation-only** unless the same message explicitly asks you to edit code.

**This rule outranks every sync rule in section 8.** A request to investigate a dark-mode problem is still investigation-only — do not start editing both themes.

Use the `bug-investigation` skill when available.

You may read files, inspect logs, run non-destructive commands, and reproduce behavior. Do not modify application code, configuration, schema, migrations, dependencies, or generated artifacts.

Your response must cover:

1. Likely or confirmed root cause
2. Proposed fix options
3. Pros of each option
4. Cons or risks of each option
5. Expected behavior change after the fix
6. Verification or testing needed

Then wait for explicit confirmation before changing code.

---

## 8. Same-round sync rules

Each rule names a trigger and the files that must change with it. When a trigger fires, those files are in scope — this is the carve-out to section 5.

### 8.1 Print forms

Changing the invoice / delivery-note print form at `app/admin/(protected)/sales/[id]/page.tsx` → also update `app/admin/delivery/print/page.tsx` in the same round. These two intentionally share one document form.

Changing receipt-form presentation (layout, styling, text blocks, signature section) on `app/admin/(protected)/sales/[id]/page.tsx` → also review and update `app/admin/(protected)/receipts/[id]/page.tsx`.

Changing any shared print primitive under `app/admin/_components/print/`, or any presentation line intentionally reused by several forms → review and update **every** consumer in the same round. Never ship a shared print change with one form visually out of sync.

All admin print forms use a two-layer structure: shared print presentation primitives first, then document-specific content on top. Do not introduce a new print page by copying a full layout block inline.

### 8.2 Admin theme

Changing UI/UX on any admin surface → review and update **both light and dark mode** in the same round. Do not ask whether dark mode should also be updated; that is the default. Preserve business logic, data flow, and permissions exactly.

### 8.3 Quick Search

Adding, removing, renaming, regrouping, or changing access for any admin menu item or entrypoint → update Quick Search command coverage in the same round. The `>` command mode must stay in sync with available admin menus and respect the same permission gating as the sidebar.

Admin navigation and Quick Search entries share one source of truth (`lib/admin-navigation.ts`). Do not maintain a second hand-written list of navigable admin commands.

### 8.4 New admin menu — 5 required steps

Whenever a new admin menu is added, all five are required:

1. Add the permission key to `PERMISSION_CATALOG` in `lib/access-control.ts` (group + Thai label), and include it in `STAFF_OPERATIONS_PERMISSIONS` / `STAFF_VIEWER_PERMISSIONS` as appropriate.
2. Add the route rule to `ADMIN_ROUTE_RULES`: `{ prefix: "/admin/<route>", permission: "<key>.view" }`.
3. Call `requirePermission("<key>.view")` at the top of the menu's `page.tsx`.
4. Call `requirePermission("<key>.<action>")` in every related Server Action, replacing direct `auth()` calls.
5. Add the nav entry with `permission: "<key>.view"` to `ADMIN_NAVIGATION` in **`lib/admin-navigation.ts`**. `components/shared/AdminSidebar.tsx` renders from that config via `filterAdminNavigationByPermission()` — it holds no permission list of its own.

Use the Sales page (view / add / update / cancel) as the reference structure. The `new-admin-menu` subagent in `.claude/agents/` covers this checklist.

### 8.5 Admin search / report submit

Adding or changing any admin `ค้นหา`, `แสดงรายงาน`, `แสดงรายการ`, or equivalent GET-filter submit button → use the shared `AdminSearchForm` + `AdminSearchSubmitButton` pattern in the same round. These flows must preserve existing filter/query logic, navigate client-side, show immediate pending feedback, and must not regress to a full page refresh.

### 8.6 Export / download prefetch guard

Admin export and download actions must use the shared `AdminExportLink`, which renders a native anchor. Never render an export/download route with `Link`, `router.prefetch()`, or any speculative-prefetch mechanism — production prefetch can execute the route's expensive database reads and audit writes without a user click.

New CSV, Excel, PDF, or backup entrypoints reuse `AdminExportLink` for link-style actions, or an explicit click handler for generated downloads. Keep the route's server-side permission check and audit logging; preventing prefetch is not an authorization substitute.

### 8.7 Transaction reference safety

Changing any transaction update, cancel, reopen, rollback, or status-transition flow → preserve downstream reference safety in the same round. If an active downstream document uses the current document, the server action must block the mutation **before** touching data, stock, cash/bank movements, audit state, or status.

Server-side guards are the source of truth. Disabled buttons, hidden controls, and client-side checks are UX helpers only — Server Actions can be invoked directly.

When a mutation is blocked, show a user-facing reason and, when downstream IDs are available, the referenced document numbers as links. The guard message and the UI disabled reason should come from the same helper so action behavior and detail pages do not drift.

Adding a new transaction type or document relationship → update both the document activity timeline relation map and the mutation guard coverage in the same round.

### 8.8 AI search across LINE and Messenger

Changing AI chat search logic, product-search routing, no-match fallback, query normalization, search guards, or intent-to-search bridging for LINE or Facebook Messenger → review and update **both** platforms in the same round.

Routine: implement and verify the first platform, then continue immediately to the second and apply the equivalent change and verification there. Do not stop after one platform unless the user explicitly scoped the work to that platform. If the equivalent change is genuinely not obvious, ask (section 6) rather than guessing.

Primary files: `lib/line-webhook-processor.ts` (4,800+ lines) and `lib/messenger/messenger-webhook-processor.ts`. Both are far past the rewrite threshold in section 2 — patch, never regenerate.

### 8.9 Root POST guard

The public root path is intentionally GET/HEAD-only. `proxy.ts` rejects `POST /` with `405` before Next.js can misclassify malformed multipart traffic as a Server Action and fail parsing `FormData`.

If a change adds a Server Action rendered on `/`, a webhook targeting `/`, or any other legitimate `POST /` workflow → review this guard in the same round and either remove it or add the narrowest safe exception, updating the guard regression tests at the same time. Prefer a dedicated `/api/...` route for new webhooks.

### 8.10 Notifications and audit log

Every notification goes to **both** the in-app bell and Telegram in a single `createNotification()` call. Every admin mutation writes an `AuditLog` entry. Both are detailed in `.rules` — wiring them is part of the definition of done, not a follow-up.

---

## 9. Roadmap maintenance

When a task is confirmed and belongs to a `PLAN.md` checklist item, update `PLAN.md` immediately after implementing — no further approval needed:

- mark the checklist item to match the real implementation state
- if the implementation differs from the plan, correct the roadmap text so it reflects final behavior
- append newly discovered sub-steps, caveats, or follow-up fixes as concise checklist entries

Edit surgically (section 2). `PLAN.md` is ~500KB; regenerating it will truncate and destroy roadmap state.

---

## 10. Finding project context

Read in this order, and read **narrowly**:

1. `AGENTS.md` (this file)
2. `PLAN.md` — **grep for the relevant section first, then read only those lines.** Never read the file whole; it is ~500KB and ~1,260 lines.
3. `docs/architecture.md`
4. `docs/roadmap/active.md`
5. Relevant files under `docs/decisions/` and `docs/specs/`

`PLAN.md` is the active index. `docs/archive/PLAN-legacy-2026-05-21.md` is historical detail only — never the starting point, and never edited as part of routine roadmap maintenance.

Ignore `testsprite_tests/tmp/prd_files/PLAN.md` — it is a stale gitignored copy that still matches repo-wide greps.

---

## 11. Project subagents

`.claude/agents/` holds task-specific reviewers. Use them when their subject matches:

- `new-admin-menu` — the 5-step checklist in 8.4
- `th-date-lint` — Thailand date/time policy compliance
- `code-compliance-reviewer` — general `.rules` compliance review
- `cancel-flow-audit` — document cancellation and reference-chain safety
- `global-research-advisor` — external research

`.claude/skills/bug-investigation` backs section 7.

---

## 12. Protected paths

The `PreToolUse` hook (`.claude/hooks/protect-paths.mjs`) blocks writes to `lib/generated/prisma/*` and `.env*`, but it only matches `Write`, `Edit`, and `NotebookEdit`. **A shell redirect, `sed -i`, or heredoc bypasses it entirely.** Treat those paths as off-limits by any means, including Bash.
