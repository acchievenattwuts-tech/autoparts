# Profit Explanation Agent Plan

## Goal

Add a read-only AI Profit Explanation Agent to `/admin/dashboard` in the `Profit Dashboard` tab. The agent acts as a financial advisor for the shop owner: it explains profit/loss movement, summarizes drivers, highlights anomalies, and recommends what to inspect next. It must not change business data.

## Core Principles

- [x] The agent is advisory and read-only.
- [x] The agent explains from system evidence only.
- [x] The agent must not create, update, delete, approve, post, reconcile, adjust stock, adjust price, or mutate accounting data.
- [x] The agent must not query raw unbounded transaction data directly for the prompt.
- [x] The agent must not invent causes that are not supported by evidence.
- [x] Every AI claim should link back to deterministic dashboard evidence where possible.
- [x] Existing dashboard calculations and report logic must remain unchanged.
- [x] Light mode and dark mode must be reviewed in the same round.
- [x] Existing Google/Gemini key rotation must be reused.

## Existing Repo Fit

The repo already has the right foundation:

- `app/admin/(protected)/dashboard/page.tsx` renders the admin dashboard.
- `app/admin/(protected)/DashboardTabs.tsx` already has a `Profit Dashboard` tab.
- `app/admin/(protected)/ProfitDashboard.tsx` renders the profit dashboard UI.
- `lib/profit-dashboard.ts` computes `ProfitDashboardData` from `FactProfit`.
- `lib/google-ai-client.ts` exposes `generateGeminiContent()` and already rotates across configured Gemini keys.
- `lib/google-ai-keys.ts` handles available key selection, cooldown, disabled keys, and success/rate-limit state.

The first version should extend the existing Profit Dashboard rather than create a new admin page.

## Implementation Decisions

- [x] Existing Gemini key rotation may update `AiApiKeyState`; this is allowed key-health metadata and not business-data mutation.
- [x] Access uses existing `dashboard.view`.
- [x] Explanation generation is button-triggered only.
- [x] Explanation history is stored in DB and retained for the latest 60 days.
- [x] No feature flag for phase 1.
- [x] Use the existing `GOOGLE_AI_MODEL` path through `generateGeminiContent()`.

## UX Design

Place a panel inside the `Profit Dashboard` tab, after the top summary/snapshot area and before detailed tables.

Recommended layout:

```text
Profit Dashboard

[Summary cards]
[Trend]

[AI Profit Explanation]
Button: อธิบายกำไรช่วงนี้

Overview
- Net profit changed by X compared with previous period.

Main drivers
1. Product/category/channel/customer/invoice driver.
2. Product/category/channel/customer/invoice driver.
3. Product/category/channel/customer/invoice driver.

Anomalies
- Low margin / loss / cost spike / expense impact / return impact.

Recommended next checks
- Review low-margin products.
- Review high-impact invoices.
- Review expense or credit note impact.

[Top Products]
[Low Products]
[Profit by Stock]
[Profit by Customer]
[Profit by Invoice]
```

UI requirements:

- [x] Add a single professional dashboard panel, not a separate page.
- [x] Use button-triggered generation to avoid slowing initial dashboard load.
- [x] Preserve all existing dashboard filters: `from`, `to`, `basis`, `stockPage`, `customerPage`, `invoicePage`.
- [x] Show loading, success, empty, error, and unavailable states.
- [x] Render clear sections: overview, facts, drivers, anomalies, recommended checks, limitations.
- [x] Keep the panel readable in light and dark mode.
- [x] Do not add a new admin navigation item.
- [x] Do not change Quick Search coverage because no new admin entrypoint is introduced.

## Architecture

Use a two-layer design:

```text
ProfitDashboardData
        ↓
Deterministic evidence builder
        ↓
Prompt builder with strict guardrails
        ↓
Gemini via existing generateGeminiContent()
        ↓
Validated structured explanation JSON
        ↓
Read-only UI panel
```

The AI must not query the database itself. The database layer computes numbers first. AI only explains the curated evidence payload.

## Files To Create

- [x] `lib/profit-explanation/schema.ts`
  - Shared types for evidence and explanation result.
  - Type definitions for drivers, anomalies, facts, limitations, and evidence links.

- [x] `lib/profit-explanation/evidence.ts`
  - Pure evidence builder from `ProfitDashboardData`.
  - No DB access.
  - No AI call.
  - No business data writes.

- [x] `lib/profit-explanation/prompt.ts`
  - System instruction and user prompt builder.
  - JSON output contract.
  - Read-only and evidence-only rules.

- [x] `lib/profit-explanation/service.ts`
  - Calls `generateGeminiContent()`.
  - Parses/validates JSON output.
  - Returns safe fallback when AI fails.

- [x] `lib/profit-explanation/history.ts`
  - Stores explanation history only.
  - Prunes expired records.
  - Keeps records for 60 days.

- [x] `app/api/admin/profit-explanation/route.ts`
  - Admin-only API route.
  - Reads dashboard filters.
  - Gets profit dashboard data.
  - Builds evidence.
  - Calls the service.
  - Stores explanation history.
  - Returns structured JSON.

- [x] `components/shared/ProfitExplanationPanel.tsx`
  - Client panel with button-triggered analysis.
  - Handles loading and errors.
  - Renders explanation sections.

- [x] `lib/__tests__/profit-explanation-evidence.test.ts`
  - Tests evidence builder.

- [x] `lib/__tests__/profit-explanation-prompt.test.ts`
  - Tests prompt guardrails.

- [x] `lib/__tests__/profit-explanation-service.test.ts`
  - Tests parser/fallback behavior.

## Files To Modify

- [x] `app/admin/(protected)/ProfitDashboard.tsx`
  - Add `ProfitExplanationPanel`.
  - Pass selected filters to the panel.
  - Do not alter existing calculations/tables.

- [x] `lib/access-control.ts`
  - Modify only if a dedicated permission is approved.
  - Not modified because `dashboard.view` was approved.

- [x] `app/admin/(protected)/roles/*` or role form files
  - Modify only if a dedicated permission is approved and existing permission UI requires it.
  - Not modified because no dedicated permission was approved.

- [x] `PLAN.md`
  - Add a short active workstream entry after implementation begins.
  - Not modified; the active spec is tracked in `docs/specs/profit-explanation-agent-plan.md` and indexed from `docs/specs/README.md`.

## Evidence Contract

The evidence builder should produce compact, deterministic JSON:

```ts
export type ProfitExplanationEvidence = {
  filters: {
    from: string;
    to: string;
    basis: "ex_vat" | "inc_vat";
  };
  selectedRange: ProfitExplanationSummary;
  previousRange: ProfitExplanationSummary;
  deltas: {
    salesAmount: number;
    costAmount: number;
    expenseAmount: number;
    grossProfit: number;
    netProfitAmount: number;
    marginPct: number;
  };
  topPositiveDrivers: ProfitExplanationDriver[];
  topNegativeDrivers: ProfitExplanationDriver[];
  anomalies: ProfitExplanationAnomaly[];
  evidenceLinks: ProfitExplanationEvidenceLink[];
};
```

Evidence sources:

- [x] `data.selectedRange`
- [x] `data.previousRange`
- [ ] `data.trend`
- [x] `data.topProducts`
- [x] `data.lowProducts`
- [x] `data.alerts`
- [x] `data.invoices.items`
- [ ] `data.stockProducts.items`
- [ ] `data.customerAnalysis.items`

Evidence should include only top-N compact data:

- [x] Top 5 positive product/profit drivers.
- [x] Top 5 negative product/profit drivers.
- [x] Top 5 anomaly alerts.
- [x] Top 5 low-margin or loss invoices.
- [ ] Top 5 customer or product impacts if useful.

## AI Output Contract

The service should return this structure:

```ts
export type ProfitExplanationResult = {
  summary: string;
  confidence: "high" | "medium" | "low";
  facts: Array<{
    label: string;
    value: string;
    source: "system";
  }>;
  drivers: Array<{
    title: string;
    explanation: string;
    impact: "positive" | "negative" | "neutral";
    amount?: number;
    evidenceRefs: string[];
  }>;
  anomalies: Array<{
    title: string;
    explanation: string;
    severity: "high" | "medium" | "low";
    evidenceRefs: string[];
  }>;
  recommendedChecks: Array<{
    label: string;
    reason: string;
    href?: string;
  }>;
  limitations: string[];
};
```

Validation rules:

- [x] Drop or flag any `evidenceRefs` that do not exist in `evidenceLinks`.
- [x] If JSON is invalid, return a safe fallback instead of crashing the dashboard.
- [x] If AI output claims data mutation, reject the response and return fallback.
- [x] Limit summary length.
- [x] Limit driver/anomaly/recommendation count.

## Prompt Design

### System Instruction

```text
You are a senior retail finance analyst for an auto-parts business.

You are read-only. You must never suggest that you changed, posted, approved, reconciled, deleted, or updated any business data.

You explain profit and loss using only the provided evidence JSON. Do not use outside assumptions. Do not invent missing product names, invoice numbers, costs, fees, customers, or causes.

Separate facts from interpretation:
- Facts are numbers directly present in the evidence.
- Interpretation is your explanation of what those facts likely mean.

If evidence is insufficient, say exactly what is missing and lower confidence.

Return only valid JSON matching the requested schema. Do not include Markdown.

Write concise Thai business language suitable for a shop owner. Use English terms only where the dashboard already uses them, such as Net Profit, Gross Profit, Margin, Shopee, Credit Note.
```

### User Prompt Template

```text
Analyze this Profit Dashboard evidence and explain why profit changed.

Required output JSON schema:
{
  "summary": "string",
  "confidence": "high|medium|low",
  "facts": [{"label":"string","value":"string","source":"system"}],
  "drivers": [{"title":"string","explanation":"string","impact":"positive|negative|neutral","amount":0,"evidenceRefs":["string"]}],
  "anomalies": [{"title":"string","explanation":"string","severity":"high|medium|low","evidenceRefs":["string"]}],
  "recommendedChecks": [{"label":"string","reason":"string","href":"string"}],
  "limitations": ["string"]
}

Rules:
- Use only evidence IDs that exist in evidenceLinks.
- If a cause is not directly supported, phrase it as "ควรตรวจต่อ" instead of a conclusion.
- Never recommend changing data automatically.
- Never say a sale, stock, expense, or credit note was modified.
- Keep summary under 500 Thai characters.
- Return at most 5 drivers, 5 anomalies, and 5 recommendedChecks.

Evidence JSON:
<EVIDENCE_JSON>
```

## Gemini Key Usage

- [x] Use existing `generateGeminiContent()` from `lib/google-ai-client.ts`.
- [x] Do not implement a second key rotation system.
- [x] Do not read API keys directly in the new feature.
- [x] Do not hardcode keys.
- [x] Do not expose key refs or secrets to the browser.
- [x] Use `json: true`.
- [x] Use low temperature, recommended `0.2`.
- [x] Use bounded output tokens, recommended around `1600`.
- [x] Use timeout around `15_000`.
- [x] Use all available keys unless product owner wants faster failure. That means do not set `maxKeyAttempts` in phase 1.

Important: existing key rotation may update key health metadata. Confirm whether this is acceptable under the read-only requirement.

## Read-Only Guardrails

Implementation must pass these checks:

- [x] New `lib/profit-explanation/*` files contain no business-data Prisma writes.
- [x] New API route writes only `ProfitExplanationHistory` records and prunes expired `ProfitExplanationHistory` records.
- [x] No `create`, `update`, `delete`, `upsert`, `updateMany`, `deleteMany` against business models.
- [x] No stock movement writes.
- [x] No accounting posting writes.
- [x] No sales/receipt/credit note mutation.
- [x] No product price changes.
- [x] No customer data mutation.
- [x] No automatic notifications to customers.
- [x] No automatic purchase order creation.
- [x] AI response is never treated as source-of-truth financial data.

## Implementation Checklist

### Phase 1: Decisions

- [x] Confirm key-state metadata writes are acceptable.
- [x] Confirm permission choice.
- [x] Confirm button-triggered behavior.
- [x] Confirm persistent explanation storage: store 60 days.
- [x] Confirm whether an env flag is required: no env flag.

### Phase 2: Evidence Builder

- [x] Create `lib/profit-explanation/schema.ts`.
- [x] Create failing tests in `lib/__tests__/profit-explanation-evidence.test.ts`.
- [x] Test selected vs previous range deltas.
- [x] Test top positive drivers.
- [x] Test top negative drivers.
- [x] Test anomaly extraction from existing alerts/invoices.
- [x] Test evidence link IDs.
- [x] Implement `buildProfitExplanationEvidence(data)`.
- [x] Run `npx tsx --test lib/__tests__/profit-explanation-evidence.test.ts`.
- [x] Commit evidence builder.

### Phase 3: Prompt Builder

- [x] Create failing tests in `lib/__tests__/profit-explanation-prompt.test.ts`.
- [x] Test prompt includes read-only rules.
- [x] Test prompt includes evidence-only rules.
- [x] Test prompt requires JSON-only output.
- [x] Test prompt contains no API keys or secrets.
- [x] Create `lib/profit-explanation/prompt.ts`.
- [x] Run `npx tsx --test lib/__tests__/profit-explanation-prompt.test.ts`.
- [x] Commit prompt builder.

### Phase 4: AI Service

- [x] Create failing tests in `lib/__tests__/profit-explanation-service.test.ts`.
- [x] Test valid JSON parsing.
- [x] Test markdown-wrapped JSON parsing if needed.
- [x] Test JSON object extraction from surrounding prose.
- [x] Test invalid JSON fallback.
- [x] Test unsupported evidence refs are rejected or moved to limitations.
- [x] Test mutation claims are rejected.
- [x] Create `lib/profit-explanation/service.ts`.
- [x] Call `generateGeminiContent()` with existing key rotation.
- [x] Do not call any business-data write path.
- [x] Run `npx tsx --test lib/__tests__/profit-explanation-service.test.ts`.
- [x] Commit AI service.

### Phase 4.5: Explanation History

- [x] Add Prisma model `ProfitExplanationHistory`.
- [x] Use `@db.Timestamptz(3)` for all new `DateTime` fields.
- [x] Create `lib/profit-explanation/history.ts`.
- [x] Store only curated evidence, structured result, key ref, status, requester, and retention expiry.
- [x] Add retention helper for 60 days.
- [x] Add tests for stable filter hash and 60-day expiry.

### Phase 5: API Route

- [x] Read relevant Next.js 16 route handler docs under `node_modules/next/dist/docs/`.
- [x] Create `app/api/admin/profit-explanation/route.ts`.
- [x] Require admin auth.
- [x] Require approved permission.
- [x] Validate filter input.
- [x] Call `getProfitDashboardData()`.
- [x] Build evidence.
- [x] Call explanation service.
- [x] Return structured JSON.
- [x] Return safe errors for unavailable AI keys.
- [ ] Add focused route tests if a route test pattern exists.
- [x] Run lint for route.
- [x] Commit API route.

### Phase 6: Profit Dashboard UI

- [x] Create `components/shared/ProfitExplanationPanel.tsx`.
- [x] Add button-triggered analysis.
- [x] Add loading state.
- [x] Add empty state.
- [x] Add error state.
- [x] Add unavailable state.
- [x] Render summary, facts, drivers, anomalies, recommended checks, limitations.
- [x] Support dark mode.
- [x] Modify `app/admin/(protected)/ProfitDashboard.tsx` to place the panel.
- [x] Do not change existing dashboard calculations.
- [x] Run focused lint.
- [x] Commit UI panel.

### Phase 7: Permission And Rollout

- [x] If `dashboard.view` is used, document the decision in implementation notes.
- [x] If `dashboard.profit_ai` is approved, update `lib/access-control.ts` and role UI.
- [x] Add env flag only if approved.
- [ ] Verify unauthorized API calls are rejected.
- [x] Commit permission/rollout changes.

### Phase 8: Verification

- [x] Run `npx tsx --test lib/__tests__/profit-explanation-evidence.test.ts`.
- [x] Run `npx tsx --test lib/__tests__/profit-explanation-prompt.test.ts`.
- [x] Run `npx tsx --test lib/__tests__/profit-explanation-service.test.ts`.
- [x] Run focused lint for all changed files.
- [x] Run `npm run build`.
- [ ] Start dev server.
- [ ] Open `/admin/dashboard`.
- [ ] Test Profit Dashboard without clicking AI button.
- [ ] Test explanation generation with keys configured.
- [ ] Test unavailable state with keys missing/exhausted in a controlled environment.
- [ ] Test light mode.
- [ ] Test dark mode.
- [ ] Confirm no business data changed.

### Phase 9: Production Acceptance

- [ ] Owner reviews at least 10 real explanations.
- [ ] Confirm explanations are useful and not overconfident.
- [ ] Confirm recommendations link to useful evidence.
- [ ] Confirm latency is acceptable.
- [ ] Confirm key usage is acceptable.
- [ ] Decide whether to expand to follow-up questions in a later phase.

## Risks

- [ ] If `FactProfit` is incomplete, AI explanations will be incomplete.
- [ ] If expenses are not allocated clearly, net profit causes may be uncertain.
- [ ] If AI is allowed to phrase unsupported causes as facts, users may trust wrong conclusions.
- [ ] If explanations auto-load, dashboard may become slower and more expensive.
- [ ] If persistent storage is added too early, privacy/audit scope grows.

## Recommended Phase 1 Scope

Build only:

- [x] Deterministic evidence builder.
- [x] Strict prompt.
- [x] Read-only explanation API.
- [x] Button-triggered dashboard panel.
- [x] Tests, lint, build.

Do not build yet:

- [ ] Chat follow-up questions.
- [x] Persistent explanation history.
- [ ] Auto-generated price changes.
- [ ] Auto-created purchase suggestions.
- [ ] Accounting adjustments.
- [ ] Customer-facing messages.

## Final Acceptance Criteria

- [x] `/admin/dashboard` Profit Dashboard has a working AI explanation panel.
- [x] Existing dashboard behavior is unchanged.
- [x] AI uses existing Google/Gemini key rotation.
- [x] AI explains only curated evidence.
- [x] AI is read-only for business data.
- [x] AI output is structured and validated.
- [x] AI recommendations are advisory.
- [x] Permissions are enforced.
- [ ] Light/dark UI is acceptable.
- [x] Tests pass.
- [x] Lint passes.
- [x] Build passes.
