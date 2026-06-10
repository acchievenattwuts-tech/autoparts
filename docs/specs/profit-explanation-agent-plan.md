# Profit Explanation Agent Plan

## Goal

Add a read-only AI Profit Explanation Agent to `/admin/dashboard` in the `Profit Dashboard` tab. The agent acts as a financial advisor for the shop owner: it explains profit/loss movement, summarizes drivers, highlights anomalies, and recommends what to inspect next. It must not change business data.

## Core Principles

- [ ] The agent is advisory and read-only.
- [ ] The agent explains from system evidence only.
- [ ] The agent must not create, update, delete, approve, post, reconcile, adjust stock, adjust price, or mutate accounting data.
- [ ] The agent must not query raw unbounded transaction data directly for the prompt.
- [ ] The agent must not invent causes that are not supported by evidence.
- [ ] Every AI claim should link back to deterministic dashboard evidence where possible.
- [ ] Existing dashboard calculations and report logic must remain unchanged.
- [ ] Light mode and dark mode must be reviewed in the same round.
- [ ] Existing Google/Gemini key rotation must be reused.

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

- [ ] Add a single professional dashboard panel, not a separate page.
- [ ] Use button-triggered generation to avoid slowing initial dashboard load.
- [ ] Preserve all existing dashboard filters: `from`, `to`, `basis`, `stockPage`, `customerPage`, `invoicePage`.
- [ ] Show loading, success, empty, error, and unavailable states.
- [ ] Render clear sections: overview, facts, drivers, anomalies, recommended checks, limitations.
- [ ] Keep the panel readable in light and dark mode.
- [ ] Do not add a new admin navigation item.
- [ ] Do not change Quick Search coverage because no new admin entrypoint is introduced.

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

- [ ] `lib/profit-explanation/schema.ts`
  - Shared types for evidence and explanation result.
  - Type definitions for drivers, anomalies, facts, limitations, and evidence links.

- [ ] `lib/profit-explanation/evidence.ts`
  - Pure evidence builder from `ProfitDashboardData`.
  - No DB access.
  - No AI call.
  - No business data writes.

- [ ] `lib/profit-explanation/prompt.ts`
  - System instruction and user prompt builder.
  - JSON output contract.
  - Read-only and evidence-only rules.

- [ ] `lib/profit-explanation/service.ts`
  - Calls `generateGeminiContent()`.
  - Parses/validates JSON output.
  - Returns safe fallback when AI fails.

- [ ] `lib/profit-explanation/history.ts`
  - Stores explanation history only.
  - Prunes expired records.
  - Keeps records for 60 days.

- [ ] `app/api/admin/profit-explanation/route.ts`
  - Admin-only API route.
  - Reads dashboard filters.
  - Gets profit dashboard data.
  - Builds evidence.
  - Calls the service.
  - Stores explanation history.
  - Returns structured JSON.

- [ ] `components/shared/ProfitExplanationPanel.tsx`
  - Client panel with button-triggered analysis.
  - Handles loading and errors.
  - Renders explanation sections.

- [ ] `lib/__tests__/profit-explanation-evidence.test.ts`
  - Tests evidence builder.

- [ ] `lib/__tests__/profit-explanation-prompt.test.ts`
  - Tests prompt guardrails.

- [ ] `lib/__tests__/profit-explanation-service.test.ts`
  - Tests parser/fallback behavior.

## Files To Modify

- [ ] `app/admin/(protected)/ProfitDashboard.tsx`
  - Add `ProfitExplanationPanel`.
  - Pass selected filters to the panel.
  - Do not alter existing calculations/tables.

- [ ] `lib/access-control.ts`
  - Modify only if a dedicated permission is approved.

- [ ] `app/admin/(protected)/roles/*` or role form files
  - Modify only if a dedicated permission is approved and existing permission UI requires it.

- [ ] `PLAN.md`
  - Add a short active workstream entry after implementation begins.

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

- [ ] `data.selectedRange`
- [ ] `data.previousRange`
- [ ] `data.trend`
- [ ] `data.topProducts`
- [ ] `data.lowProducts`
- [ ] `data.alerts`
- [ ] `data.invoices.items`
- [ ] `data.stockProducts.items`
- [ ] `data.customerAnalysis.items`

Evidence should include only top-N compact data:

- [ ] Top 5 positive product/profit drivers.
- [ ] Top 5 negative product/profit drivers.
- [ ] Top 5 anomaly alerts.
- [ ] Top 5 low-margin or loss invoices.
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

- [ ] Drop or flag any `evidenceRefs` that do not exist in `evidenceLinks`.
- [ ] If JSON is invalid, return a safe fallback instead of crashing the dashboard.
- [ ] If AI output claims data mutation, reject the response and return fallback.
- [ ] Limit summary length.
- [ ] Limit driver/anomaly/recommendation count.

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

- [ ] Use existing `generateGeminiContent()` from `lib/google-ai-client.ts`.
- [ ] Do not implement a second key rotation system.
- [ ] Do not read API keys directly in the new feature.
- [ ] Do not hardcode keys.
- [ ] Do not expose key refs or secrets to the browser.
- [ ] Use `json: true`.
- [ ] Use low temperature, recommended `0.2`.
- [ ] Use bounded output tokens, recommended around `1600`.
- [ ] Use timeout around `15_000`.
- [ ] Use all available keys unless product owner wants faster failure. That means do not set `maxKeyAttempts` in phase 1.

Important: existing key rotation may update key health metadata. Confirm whether this is acceptable under the read-only requirement.

## Read-Only Guardrails

Implementation must pass these checks:

- [ ] New `lib/profit-explanation/*` files contain no Prisma writes.
- [ ] New API route writes only `ProfitExplanationHistory` records and prunes expired `ProfitExplanationHistory` records.
- [ ] No `create`, `update`, `delete`, `upsert`, `updateMany`, `deleteMany` against business models.
- [ ] No stock movement writes.
- [ ] No accounting posting writes.
- [ ] No sales/receipt/credit note mutation.
- [ ] No product price changes.
- [ ] No customer data mutation.
- [ ] No automatic notifications to customers.
- [ ] No automatic purchase order creation.
- [ ] AI response is never treated as source-of-truth financial data.

## Implementation Checklist

### Phase 1: Decisions

- [ ] Confirm key-state metadata writes are acceptable.
- [ ] Confirm permission choice.
- [ ] Confirm button-triggered behavior.
- [x] Confirm persistent explanation storage: store 60 days.
- [x] Confirm whether an env flag is required: no env flag.

### Phase 2: Evidence Builder

- [ ] Create `lib/profit-explanation/schema.ts`.
- [ ] Create failing tests in `lib/__tests__/profit-explanation-evidence.test.ts`.
- [ ] Test selected vs previous range deltas.
- [ ] Test top positive drivers.
- [ ] Test top negative drivers.
- [ ] Test anomaly extraction from existing alerts/invoices.
- [ ] Test evidence link IDs.
- [ ] Implement `buildProfitExplanationEvidence(data)`.
- [ ] Run `npx tsx --test lib/__tests__/profit-explanation-evidence.test.ts`.
- [ ] Commit evidence builder.

### Phase 3: Prompt Builder

- [ ] Create failing tests in `lib/__tests__/profit-explanation-prompt.test.ts`.
- [ ] Test prompt includes read-only rules.
- [ ] Test prompt includes evidence-only rules.
- [ ] Test prompt requires JSON-only output.
- [ ] Test prompt contains no API keys or secrets.
- [ ] Create `lib/profit-explanation/prompt.ts`.
- [ ] Run `npx tsx --test lib/__tests__/profit-explanation-prompt.test.ts`.
- [ ] Commit prompt builder.

### Phase 4: AI Service

- [ ] Create failing tests in `lib/__tests__/profit-explanation-service.test.ts`.
- [ ] Test valid JSON parsing.
- [ ] Test markdown-wrapped JSON parsing if needed.
- [ ] Test invalid JSON fallback.
- [ ] Test unsupported evidence refs are rejected or moved to limitations.
- [ ] Test mutation claims are rejected.
- [ ] Create `lib/profit-explanation/service.ts`.
- [ ] Call `generateGeminiContent()` with existing key rotation.
- [ ] Do not call any business-data write path.
- [ ] Run `npx tsx --test lib/__tests__/profit-explanation-service.test.ts`.
- [ ] Commit AI service.

### Phase 4.5: Explanation History

- [x] Add Prisma model `ProfitExplanationHistory`.
- [x] Use `@db.Timestamptz(3)` for all new `DateTime` fields.
- [x] Create `lib/profit-explanation/history.ts`.
- [x] Store only curated evidence, structured result, key ref, status, requester, and retention expiry.
- [x] Add retention helper for 60 days.
- [x] Add tests for stable filter hash and 60-day expiry.

### Phase 5: API Route

- [ ] Read relevant Next.js 16 route handler docs under `node_modules/next/dist/docs/`.
- [ ] Create `app/api/admin/profit-explanation/route.ts`.
- [ ] Require admin auth.
- [ ] Require approved permission.
- [ ] Validate filter input.
- [ ] Call `getProfitDashboardData()`.
- [ ] Build evidence.
- [ ] Call explanation service.
- [ ] Return structured JSON.
- [ ] Return safe errors for unavailable AI keys.
- [ ] Add focused route tests if a route test pattern exists.
- [ ] Run lint for route.
- [ ] Commit API route.

### Phase 6: Profit Dashboard UI

- [ ] Create `components/shared/ProfitExplanationPanel.tsx`.
- [ ] Add button-triggered analysis.
- [ ] Add loading state.
- [ ] Add empty state.
- [ ] Add error state.
- [ ] Add unavailable state.
- [ ] Render summary, facts, drivers, anomalies, recommended checks, limitations.
- [ ] Support dark mode.
- [ ] Modify `app/admin/(protected)/ProfitDashboard.tsx` to place the panel.
- [ ] Do not change existing dashboard calculations.
- [ ] Run focused lint.
- [ ] Commit UI panel.

### Phase 7: Permission And Rollout

- [ ] If `dashboard.view` is used, document the decision in implementation notes.
- [ ] If `dashboard.profit_ai` is approved, update `lib/access-control.ts` and role UI.
- [ ] Add env flag only if approved.
- [ ] Verify unauthorized API calls are rejected.
- [ ] Commit permission/rollout changes.

### Phase 8: Verification

- [ ] Run `npx tsx --test lib/__tests__/profit-explanation-evidence.test.ts`.
- [ ] Run `npx tsx --test lib/__tests__/profit-explanation-prompt.test.ts`.
- [ ] Run `npx tsx --test lib/__tests__/profit-explanation-service.test.ts`.
- [ ] Run focused lint for all changed files.
- [ ] Run `npm run build`.
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

- [ ] Deterministic evidence builder.
- [ ] Strict prompt.
- [ ] Read-only explanation API.
- [ ] Button-triggered dashboard panel.
- [ ] Tests, lint, build.

Do not build yet:

- [ ] Chat follow-up questions.
- [ ] Persistent explanation history.
- [ ] Auto-generated price changes.
- [ ] Auto-created purchase suggestions.
- [ ] Accounting adjustments.
- [ ] Customer-facing messages.

## Final Acceptance Criteria

- [ ] `/admin/dashboard` Profit Dashboard has a working AI explanation panel.
- [ ] Existing dashboard behavior is unchanged.
- [ ] AI uses existing Google/Gemini key rotation.
- [ ] AI explains only curated evidence.
- [ ] AI is read-only for business data.
- [ ] AI output is structured and validated.
- [ ] AI recommendations are advisory.
- [ ] Permissions are enforced.
- [ ] Light/dark UI is acceptable.
- [ ] Tests pass.
- [ ] Lint passes.
- [ ] Build passes.
