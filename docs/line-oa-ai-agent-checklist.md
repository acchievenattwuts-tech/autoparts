# LINE OA AI Agent Checklist

Scope: LINE OA AI agent integration for this repo, built on top of the existing Next.js App Router, Prisma, Supabase, LINE webhook, LIFF/customer-link, and product search foundations.

Objective: connect LINE OA messages to the existing system so the app can capture inbound conversations, classify intent, reuse the current product-search capabilities where appropriate, and support safe AI-assisted replies without breaking the current storefront, admin, LIFF, stock, sales, receipt, or search logic.

Rule reminder: this checklist is for scoped additive work only. Prefer extending existing modules and patterns over introducing a parallel subsystem. Do not change unrelated logic, contracts, or source-of-truth boundaries unless the exact task explicitly requires it.

## Repo Anchors

- Existing LINE webhook entrypoint: [app/api/line/webhook/route.ts](/D:/autoparts/app/api/line/webhook/route.ts)
- Existing LINE messaging helpers: [lib/line-messaging.ts](/D:/autoparts/lib/line-messaging.ts)
- Existing LIFF identity/session/customer-link flow:
  - [lib/liff-auth.ts](/D:/autoparts/lib/liff-auth.ts)
  - [lib/liff-session.ts](/D:/autoparts/lib/liff-session.ts)
  - [lib/liff-customer.ts](/D:/autoparts/lib/liff-customer.ts)
  - [app/api/liff/session/route.ts](/D:/autoparts/app/api/liff/session/route.ts)
  - [app/api/liff/verify-link/route.ts](/D:/autoparts/app/api/liff/verify-link/route.ts)
- Existing AI helper patterns: [lib/content-ai.ts](/D:/autoparts/lib/content-ai.ts)
- Existing product search source of truth:
  - [lib/product-search.ts](/D:/autoparts/lib/product-search.ts)
  - [app/admin/(protected)/products/search/page.tsx](/D:/autoparts/app/admin/(protected)/products/search/page.tsx)
  - [prisma/schema.prisma](/D:/autoparts/prisma/schema.prisma)

## Non-Negotiables

- [x] Do not break existing product, sales, receipt, purchase, warranty, stock, or LIFF flows.
- [x] Do not rewrite the current LINE/LIFF foundation if the needed capability can be added incrementally.
- [x] Do not change the existing product schema/search schema unless the change is truly required for AI agent work. (only additive `sales_count`/`stock` drift fix; no logic change)
- [x] Do not expose any secret in client/browser code.
- [x] Read all LINE, Supabase service-role, and Gemini credentials from server-side environment variables only.
- [x] Verify LINE signature from raw request body on every webhook call.
- [x] Persist inbound webhook/event payloads needed for audit/debug.
- [x] Prefer LINE `replyMessage` for immediate webhook-context replies to reduce messaging cost; use push only when reply token is unavailable/expired or the message is admin-initiated outside webhook context.
- [x] Every inbound message must go through intent routing before any product search or AI reply logic.
- [x] AI must not reply when the conversation is in an admin-owned paused/waiting state.
- [x] If the system is not confident, ask for more information or hand off to admin. Do not guess.
- [x] For payment-slip and shipping-address intents, do not route into product search.
- [x] Keep all new Prisma `DateTime` fields on `@db.Timestamptz(3)`.
- [x] Keep admin Quick Search in sync if a new admin entrypoint is added for this feature. (conversations, AI keys, payment slips)
- [x] If any admin UI is added or changed, review both light mode and dark mode in the same round.

## Implementation Stance

- [x] Treat this as an additive module, not a platform rewrite.
- [x] Reuse existing repo naming conventions, route patterns, auth patterns, and admin page structure.
- [x] Reuse the existing search engine in [lib/product-search.ts](/D:/autoparts/lib/product-search.ts) instead of building a second search path.
- [x] Reuse existing LINE messaging helpers where possible instead of introducing a second low-level LINE client.
- [x] Treat LINE reply delivery as two modes: `replyMessage` first for webhook-driven responses, `pushMessage` only for fallback or admin/out-of-band delivery.
- [x] Reuse existing audit/admin patterns instead of inventing a separate moderation workflow.

## Phase 0: Baseline Audit

- [x] Inspect the current webhook behavior in [app/api/line/webhook/route.ts](/D:/autoparts/app/api/line/webhook/route.ts).
- [x] Inspect existing LINE push/signature/profile helpers in [lib/line-messaging.ts](/D:/autoparts/lib/line-messaging.ts).
- [x] Inspect current LINE customer-link and LIFF identity flow before proposing any new conversation-link logic.
- [x] Inspect existing Prisma schema for customer/LINE linkage fields, especially existing `lineUserId` usage.
- [x] Inspect current admin permission/navigation patterns before adding conversation-management UI/API.
- [x] Inspect current product search API/service boundaries and confirm the AI agent can call them without changing ranking logic.
- [x] Summarize which files should be extended versus which files should stay untouched.

## Phase 1: Boundary and Architecture Decisions

- [x] Confirm the feature will be implemented as a separate LINE conversation domain layered beside existing customer/LIFF logic.
- [x] Define the source of truth for:
  - [x] conversation state
  - [x] message log
  - [x] AI suggestion/result log
  - [x] admin takeover state
  - [x] slip-review state
- [x] Decide whether to extend the current `app/api/line/webhook/route.ts` handler directly or delegate from it into a new module while preserving current behavior.
- [x] Define which intents are eligible for automated AI handling and which must always hand off to admin.
- [x] Define minimum-confidence rules for safe reply versus ask-more-info versus waiting-admin.
- [x] Define the exact no-touch boundaries for legacy product logic, sales logic, and LIFF logic.

### Phase 1 — Decisions (Recorded)

**Domain boundary**
- The AI agent is a **separate LINE conversation domain** layered beside existing customer/LIFF logic. It introduces its own tables (`LineConversation`, `LineMessage`, `LineAiJob`, `LineAiSuggestion`, `LineAiAuditLog`, `PaymentSlip`, `AiApiKeyState`) and never overloads `Customer`/LIFF tables with chat-log or AI payloads.
- Linkage to the existing world is read-only/optional: `LineConversation.customerId` (nullable FK) and `PaymentSlip.matchedSaleId` (nullable, advisory only).

**Source of truth**
- Conversation state → `LineConversation.aiStatus` (+ paused/closed timestamps).
- Message log → `LineMessage` (inbound/outbound, `lineEventId` unique for idempotency).
- AI suggestion/result log → `LineAiSuggestion` (drafts/sent) + `LineAiJob` (job records); these are **never** business truth.
- Admin takeover state → `LineConversation.aiStatus` = `PAUSED_BY_ADMIN` / `WAITING_ADMIN` + `assignedAdminId`, with every transition written to `LineAiAuditLog`.
- Slip-review state → `PaymentSlip.verificationStatus` (advisory; does not mutate receipt/AR).

**Webhook handler strategy**
- The existing `app/api/line/webhook/route.ts` is **preserved** (signature verify + daily-summary recipient capture stay intact). AI processing is **delegated** to `lib/line-webhook-processor.ts` via `processLineWebhookPayload()`, wrapped in try/catch so AI failures never break the webhook response.

**Intent eligibility (AI vs admin)**
- AI-replyable (Gemini, conservative): `PRODUCT_INQUIRY_TEXT`, `GREETING`.
- Searchable but conservative: `PRODUCT_INQUIRY_TEXT` (via existing `lib/product-search.ts`, read-only).
- Always hand off to admin: `PRICE_NEGOTIATION`, `CLAIM_OR_RETURN`, `PAYMENT_SLIP_IMAGE`, `SHIPPING_ADDRESS`, `ORDER_STATUS`, `UNKNOWN`.
- `UNKNOWN` never falls through to product search.

**Minimum-confidence rules** (see `lib/line-ai-policy.ts`)
- `POSSIBLE_MATCH` / `NEED_MORE_INFO` on a search-safe intent → may reply (ask-more-info wording when weak), only via `replyMessage` when a valid reply token exists and the conversation is `ACTIVE`.
- `ADMIN_REQUIRED` or admin-only intent → no auto-send; conversation moves to `WAITING_ADMIN`.
- Any `PAUSED_BY_ADMIN` / `WAITING_ADMIN` / `CLOSED` state → suggestion stored, delivery mode `NONE`, nothing sent.
- Gemini confidence is **derived from the deterministic policy**, not from the model, so safety guarantees are independent of model output.

**No-touch boundaries**
- Product/search: reuse `lib/product-search.ts` read-only; no ranking/synonym/telemetry forks; no schema changes to product/search tables.
- Sales/receipt/AR/stock: never mutated by the AI agent; payment-slip matching stays advisory until admin/business logic confirms.
- LIFF: identity/session/customer-link flow untouched; no LIFF UX refactor for this feature.

## Phase 2: Schema / Migration Planning

- [x] Add only new migrations. Do not edit old migrations.
- [x] Introduce conversation/message/AI audit tables only if they are not already represented sufficiently by the current schema.
- [x] Keep new conversation tables isolated from core sales/product tables.
- [x] Ensure unique/duplicate constraints exist for webhook/event idempotency.
- [x] Ensure every timestamp field uses timestamptz semantics.
- [x] Add only the minimum foreign keys needed to link to customers/admin users/orders when justified.

### Proposed Data Areas To Review Before Final Schema

- [x] `line_conversations`
- [x] `line_messages`
- [x] `ai_jobs`
- [x] `ai_suggestions`
- [x] `ai_audit_logs`
- [x] `payment_slips`

### Schema Guardrails

- [x] Do not overload existing customer tables with chat-log payloads.
- [x] Do not store derived AI output in a place that can be confused with transactional truth.
- [x] Do not make AI suggestion records the source of truth for final business actions.
- [x] Keep product/search tables unchanged unless a proven integration gap requires a small additive field or relation.

## Phase 3: Environment and Configuration

- [x] Inventory current LINE-related env names already used by this repo.
- [x] Normalize whether this feature should reuse existing env keys or introduce clearly-scoped new ones.
- [x] Keep all secrets server-only.
- [x] Add clear env documentation for:
  - [x] LINE channel secret
  - [x] LINE channel access token
  - [x] Supabase URL / service role
  - [x] Google Gemini API keys (`GOOGLE_AI_API_KEY_1..10`, multi-key fallback)
  - [x] Gemini model + daily cooldown (`GOOGLE_AI_MODEL`, `GOOGLE_AI_DAILY_COOLDOWN_MINUTES`)
  - [x] AI auto-reply enable switch
  - [x] AI dry-run switch
- [x] Ensure the feature has a safe disabled mode by config.

### AI Provider: Google Gemini (Multi-Key Fallback)

- [x] Use Google Gemini (free tier) as the AI suggestion provider for the LINE agent (OpenAI removed from this flow).
- [x] Support up to 10 keys from separate Google accounts (`GOOGLE_AI_API_KEY_1..10`); run with 1–10 keys.
- [x] Store API key secrets in server env only — never in the database.
- [x] Track per-key health in the `AiApiKeyState` table so all serverless instances share rotation state.
- [x] Select least-recently-used available key first to spread load evenly.
- [x] On 429 rate limit, put the key on cooldown and fall back to the next key automatically.
  - [x] Per-minute (RPM) 429 → 60-second cooldown.
  - [x] Daily (`PerDay`) 429 → configurable cooldown (default 60 min).
- [x] On transient 5xx/network error → short cooldown (20s) then try next key.
- [x] On 400/401/403 (invalid/revoked key) → mark key `DISABLED` until fixed.
- [x] When all keys are exhausted, fall back to the deterministic rule-based reply (never crash the webhook).
- [x] Key reference module: [lib/google-ai-keys.ts](/D:/autoparts/lib/google-ai-keys.ts)
- [x] Fallback execution client: [lib/google-ai-client.ts](/D:/autoparts/lib/google-ai-client.ts)
- [x] Additive SQL migration: [prisma/sql/2026-06-08-ai-api-key-state.sql](/D:/autoparts/prisma/sql/2026-06-08-ai-api-key-state.sql)
- [x] Default model `gemini-3.1-flash-lite` (override via `GOOGLE_AI_MODEL`).
- [x] Reasoning depth `thinkingConfig.thinkingLevel = HIGH` (override via `GOOGLE_AI_THINKING_LEVEL`: `HIGH`/`LOW`/`NONE`).
- [x] Admin monitoring page `/admin/line-ai-keys` shows per-key status/cooldown/counters + manual reset.
- [x] `googleSearch` web-grounding tool intentionally NOT enabled (AI answers from the shop catalog only).

## Phase 4: Webhook Ingestion and Idempotency

- [x] Preserve current webhook signature verification behavior.
- [x] Expand webhook ingestion from recipient capture into conversation/message event capture without breaking current behavior.
- [x] Parse and persist inbound events in an idempotent way.
- [x] Persist reply-token context when needed so the processor can attempt `replyMessage` inside the webhook execution path.
- [x] Return `200` for duplicates without processing them twice.
- [x] Store enough raw event payload for debugging, but avoid leaking secrets.
- [x] Capture whether each inbound event should:
  - [x] trigger AI processing
  - [x] be ignored
  - [x] be handed off to admin

## Phase 5: Conversation State Machine

- [x] Define allowed conversation states and transitions.
- [x] Support at least:
  - [x] `ACTIVE`
  - [x] `PAUSED_BY_ADMIN`
  - [x] `WAITING_ADMIN`
  - [x] `CLOSED`
- [x] Ensure admin actions can pause/resume/take over safely.
- [x] Ensure outbound admin replies can automatically pause AI for that conversation when required.
- [x] Ensure AI never sends messages while paused or waiting for admin. (policy `resolveLineAiSendDecision` blocks PAUSED/WAITING/CLOSED; tested)

## Phase 6: Intent Routing

- [x] Create a central intent-router layer before any product search or reply generation.
- [x] Route text and image inputs through the same high-level decision stage.
- [x] Support at least these intent groups:
  - [x] product inquiry by text
  - [x] part image inquiry
  - [x] payment slip image
  - [x] shipping address / location info
  - [x] order-status inquiry
  - [x] price negotiation
  - [x] claim / return / complaint
  - [x] greeting / small talk
  - [x] unknown / ambiguous
- [x] Define explicit rules for which intents are searchable, which are AI-answerable, and which are admin-only.
- [x] Do not let unknown intent fall through to product search by default.

## Phase 7: Product Search Reuse

- [x] Reuse [lib/product-search.ts](/D:/autoparts/lib/product-search.ts) as the product lookup engine.
- [x] Do not fork ranking, synonym, telemetry, or fallback behavior into a LINE-only variant unless absolutely necessary.
- [x] Add a thin translation layer from intent-router output to the existing search input contract if needed.
- [x] Ensure product-search calls from AI are read-only and do not mutate search data.
- [x] Define when to search by:
  - [x] exact SKU / code
  - [x] part number
  - [x] free text
  - [x] extracted image/OCR clues
  - [x] vehicle fitment clues
- [x] Define the safe fallback when search results are weak or ambiguous.

## Phase 8: AI Reply Policy

- [x] Define approved answer style for this business domain in Thai.
- [x] Use conservative wording; do not overclaim compatibility or certainty.
- [x] Require “ask for more info” behavior when confidence is low.
- [x] Require “hand off to admin” behavior for negotiation, claims, complex exceptions, and uncertain cases.
- [x] Ensure reply generation is separated from message delivery so dry-run/suggestion-only mode is possible.
- [x] When an AI/customer-safe reply is generated inside webhook flow, attempt `replyMessage` first.
- [x] Log AI suggestions/results separately from final outbound messages.

### Reply Safety Rules

- [x] Do not say the part is guaranteed compatible unless there is strong supporting evidence. (enforced in the Gemini system instruction + rule-based fallback)
- [x] Do not confirm payment success from image alone unless confirmed by real payment/admin evidence. (slips go to admin review; never auto-confirmed)
- [x] Do not use a payment-slip image as a product-search input. (intent router routes PAYMENT_SLIP_IMAGE away from search)
- [x] Do not use a shipping-address message as a product-search input. (intent router routes SHIPPING_ADDRESS away from search)
- [x] When uncertain, ask for model/year/engine/old-part photo/part number instead of guessing. (NEED_MORE_INFO behavior + system instruction)

## Phase 9: Image Workflow

- [x] Separate image classification into at least:
  - [x] part image
  - [x] payment slip
  - [x] unsupported / unknown image
- [x] For part-image flow, extract useful search hints without mutating product truth. (Gemini Vision returns `searchHints`; stored in `IMAGE_CLASSIFIED` audit, read-only)
- [x] Optionally auto-search the catalog from part-image hints, gated by the `line_ai_image_search_enabled` setting (ตั้งค่าร้านค้า → "LINE OA AI Agent"; default off → admin hand-off; on → conservative near-match reply). Search stays read-only via `lib/product-search.ts`.
- [x] For payment-slip flow, keep it out of product search. (slip kind re-routes to `PAYMENT_SLIP_IMAGE`, `allowsSearch=false`; tested)
- [x] Decide where to store inbound images and derived OCR/vision metadata. (Part images: on-demand fetch, not stored. Payment slips: image captured at ingestion, compressed to grayscale WebP, stored in a private Supabase bucket; OCR fields persist in `PaymentSlip`.)
- [x] Reuse existing storage patterns if the repo already has a preferred upload/storage approach. (Reuses the Supabase service-role upload pattern; dedicated private bucket `payment-slips`, signed URLs for admin viewing.)
- [x] Keep image-processing failures isolated so they do not break the whole webhook pipeline. (classifier wrapped, degrades to `unknown_image`; never throws)

### Phase 9 — Implementation Notes

- Content fetch: `fetchLineMessageContent()` in [lib/line-messaging.ts](/D:/autoparts/lib/line-messaging.ts) (6MB cap, 404/410 → null).
- Vision classifier: `classifyLineImage()` / `parseLineImageClassification()` in [lib/line-image-service.ts](/D:/autoparts/lib/line-image-service.ts) (uses the Gemini multi-key client).
- Processor wiring: image events run classification, then `applyImageClassificationToRoute()` re-routes intent; result logged as `IMAGE_CLASSIFIED`.
- Tests: [lib/__tests__/line-image-service.test.ts](/D:/autoparts/lib/__tests__/line-image-service.test.ts) + processor image tests (slip→admin no-search, part→image-workflow no-search).

## Phase 10: Payment Slip Review Flow

- [x] Store slip submissions separately from transactional truth. (`PaymentSlip` table; `ingestPaymentSlip()` fetches once → OCR → row → compressed image to private bucket)
- [x] Extract OCR/vision fields as review aids only. (`runPaymentSlipOcr()` Gemini Vision; advisory, never confirms payment)
- [x] Store the slip image space-efficiently with date-partitioned paths. (`payment-slips/YYYY/MM/DD/<id>.webp`, grayscale WebP ~20–50KB, private bucket; deleted when an admin rejects the slip)
- [x] Define verification statuses clearly.
- [x] Route slips to admin review instead of auto-confirming payment.
- [x] If an order match is attempted, keep it advisory unless admin/business logic explicitly confirms it. (no auto-match this round; `matchedSaleId` stays null; admin decides)
- [x] Ensure this flow does not alter receipt/accounting logic by itself. (review API only updates `PaymentSlip.verificationStatus` + reviewer; never touches receipts/AR/stock)

### Phase 10 — Implementation Notes (permission 5 steps + audit)

- Permission keys `line_payment_slips.view` / `line_payment_slips.manage`; route rule `/admin/line-payment-slips`; sidebar nav under "ขาย & ลูกหนี้".
- OCR (network): [lib/line-payment-slip-ocr.ts](/D:/autoparts/lib/line-payment-slip-ocr.ts); pure parser `parsePaymentSlipOcr()` in [lib/line-payment-slip-service.ts](/D:/autoparts/lib/line-payment-slip-service.ts).
- Repository: [lib/line-payment-slip-repository.ts](/D:/autoparts/lib/line-payment-slip-repository.ts) (create/list/get/review).
- Admin pages: list + detail/review (`force-dynamic`, `loading.tsx`, light/dark).
- Review API with central `AuditLog`: [app/api/admin/line-payment-slips/[id]/review/route.ts](/D:/autoparts/app/api/admin/line-payment-slips/[id]/review/route.ts).
- Processor: slip image → OCR → persist `PaymentSlip` → audit `PAYMENT_SLIP_OCR` (injectable; tested).

## Phase 11: Order / Customer Context Linking

- [x] Define how a LINE conversation links to an existing customer record when possible.
- [x] Reuse current `lineUserId` and LIFF-related linkage concepts where compatible.
- [x] Decide when a conversation is:
  - [x] linked customer (unique active `Customer.lineUserId` — strong signal)
  - [x] unlinked customer (no match)
  - [x] ambiguous customer match (>1 weak phone candidate → admin-manual only, never auto-merged)
- [x] Avoid auto-merging customers on weak evidence.
- [x] Define how order-status lookup should work without weakening current auth/privacy boundaries.

### Phase 11 — Implementation Notes

- Linkage module: [lib/line-customer-linkage.ts](/D:/autoparts/lib/line-customer-linkage.ts) — `resolveLineCustomerLinkage()` (lineUserId only), `findLineCustomerCandidatesByPhone()` (weak → ambiguous, admin-manual), `getLinkedCustomerRecentOrders()`.
- Order-status privacy: orders are shown only on the admin conversation-detail page (admin-authenticated + `line_conversations.view`), scoped strictly to the exactly-linked `customerId`. The AI never sends order status to the LINE user — `ORDER_STATUS` stays an admin-only intent.
- No auto-merge: only the unique `lineUserId` signal links automatically; phone candidates are surfaced for manual linking.

## Phase 12: Admin API and Admin Surface

- [x] Add admin endpoints only after permission model and conversation state machine are clear.
- [x] Follow existing admin route and permission conventions.
- [x] Consider adding endpoints for:
  - [x] conversation list
  - [x] conversation detail/messages
  - [x] pause AI
  - [x] resume AI
  - [x] mark waiting admin
  - [x] close conversation
  - [x] send admin message
- [x] If an admin page is added:
  - [x] reuse existing admin shell/components
  - [x] keep Quick Search coverage in sync
  - [x] review both light and dark themes
  - [x] avoid changing unrelated admin navigation behavior
  - [x] add missing `loading.tsx` for `line-conversations` (list + `[id]`) per .rules
  - [x] convert the conversation-list status filter to the shared `AdminSearchForm` + `AdminSearchSubmitButton` (.rules §11)

### AI Key Monitoring (Gemini Multi-Key) — Admin Surface

- [x] Permission keys `line_ai_keys.view` / `line_ai_keys.manage` in `PERMISSION_CATALOG`.
- [x] Route rules added for `/admin/line-ai-keys` (and backfilled the missing `/admin/line-conversations` rule).
- [x] `requirePermission("line_ai_keys.view")` at the top of the page.
- [x] `requirePermission("line_ai_keys.manage")` on the reset endpoint + central `AuditLog` entry.
- [x] Sidebar nav item under "ตั้งค่าระบบ" with Quick Search keywords.
- [x] `loading.tsx` + `force-dynamic` + light/dark themes.
- [x] Page: [app/admin/(protected)/line-ai-keys/page.tsx](/D:/autoparts/app/admin/(protected)/line-ai-keys/page.tsx)
- [x] Reset API: [app/api/admin/line-ai-keys/[keyRef]/reset/route.ts](/D:/autoparts/app/api/admin/line-ai-keys/[keyRef]/reset/route.ts)

## Phase 13: Logging, Audit, and Observability

- [x] Log inbound event receipt.
- [x] Log duplicate detection outcomes.
- [x] Log intent classification result.
- [x] Log product-search invocation/result summary.
- [x] Log AI suggestion/reply generation result.
- [x] Log outbound send result, including whether LINE delivery used `replyMessage` or `pushMessage`.
- [x] Log admin takeover/resume actions.
- [x] Log payment-slip OCR/match summary. (`PAYMENT_SLIP_OCR` audit: slip id, status, presence flags — no raw PII values)
- [x] Ensure logs are useful for debugging but do not leak secrets or sensitive payloads beyond necessity. (OCR audit stores boolean presence flags, not amounts/names/refs; API keys never logged)

## Phase 14: Feature Flags and Rollout Safety

- [x] Implement disabled mode.
- [x] Implement dry-run mode where AI suggestions are stored but not sent.
- [x] Implement controlled auto-reply mode for only the allowed intents/confidence bands.
- [x] Define rollback steps that do not require touching product/sales data.
- [x] Ensure webhook ingestion can stay active even when outbound AI is disabled.
- [x] Ensure `replyMessage` remains the default low-cost path even after auto-reply is enabled.

### Runtime Toggles — Admin-Managed (not env)

The three runtime switches moved out of env into the shop-settings page so admins
flip them without a redeploy (stored in `SiteContent`, read uncached on each event).

- [x] `line_ai_auto_reply_enabled` (master switch, default off) — page: ตั้งค่าร้านค้า → "LINE OA AI Agent".
- [x] `line_ai_dry_run` (default on) — store suggestions, send nothing.
- [x] `line_ai_image_search_enabled` (default off) — auto-search the catalog from part-image hints.
- [x] Resolver `getLineAiSettings()` ([lib/line-ai-settings.ts](/D:/autoparts/lib/line-ai-settings.ts)); the webhook route reads it and passes to the processor.
- [x] Saving toggles writes a central `AuditLog` (CompanySettings) entry.

## Phase 15: Testing Checklist

- [x] Valid signature accepted.
- [x] Invalid signature rejected.
- [x] New inbound message creates or reuses conversation correctly. (tests: "reuses the same conversation for two distinct messages from one user" in line-webhook-processor.test.ts)
- [x] Duplicate webhook event does not process twice. (tests: single-duplicate + mixed-batch "skips an already-seen event in the same batch")
- [x] `ACTIVE` conversation can proceed to intent routing.
- [x] `PAUSED_BY_ADMIN` conversation blocks AI reply.
- [x] `WAITING_ADMIN` conversation blocks AI reply.
- [x] Product inquiry text can reach existing search layer safely.
- [x] Part-image inquiry enters image workflow.
- [x] Payment-slip image enters slip workflow and does not hit product search. (test: "routes a payment-slip image to admin and never hits product search")
- [x] Shipping-address message does not hit product search.
- [x] Negotiation/claim/complex case routes to admin.
- [x] Unknown intent does not invent an answer.
- [x] Dry-run mode stores suggestion and sends nothing.
- [x] Webhook-context auto replies choose `replyMessage` when reply token is present and valid.
- [x] Admin/manual or out-of-band replies use push/send fallback correctly. (admin send-message uses `pushLineMessages`; logged with deliveryMode PUSH)
- [x] Admin message/takeover can pause AI correctly.
- [x] Resume flow re-enables AI correctly.
- [x] No secret is exposed to client code.
- [x] Existing storefront/admin/LIFF flows still work after the feature is introduced. (additive-only; full `npm run build` green every round; final smoke test at deploy)

## Data Flow & Privacy (Third-Party)

- The Gemini model has **no database access**. It only receives what our code puts in
  the prompt and returns text — it cannot query, read other tables, or mutate data.
- Application code accesses the production DB normally (Prisma): writes LINE/AI tables,
  reads `Customer`/`Sale`/`product_search_documents`. All AI-triggered writes go through
  our code and are audit-logged; AI never writes directly.
- What leaves to Google (sent in prompts): customer message text, part images, **payment-slip
  images (for OCR)**, and product-search result snippets (names/codes). Never sent: secrets,
  credentials, other customers' data, or order/AR figures (`ORDER_STATUS` is admin-only).
- Payment-slip OCR is the one place financial data leaves the system. It can be disabled by
  not configuring Gemini keys (AI falls back to rule-based and admin-only handling).
- Payment-slip images are stored in a **private** Supabase bucket and shown to admins only via
  signed URLs; rejected slips are deleted. The detail/review page uses a short-lived (5-min)
  signed URL; the gallery caches a longer-lived (7-day) signed URL per slip in
  `PaymentSlip.imageSignedUrl` / `imageSignedUrlExpiresAt` and refreshes them in batch only when
  missing/near-expiry, so browsing many slips makes near-zero Supabase Storage calls.

## Acceptance Criteria

- [x] LINE webhook remains valid and verifiable.
- [x] Inbound LINE conversations are captured reliably.
- [x] Intent routing happens before any product search or AI reply.
- [x] Product inquiries can reuse existing product search without altering its current behavior.
- [x] Payment-slip and address flows are isolated from product search.
- [x] Admin can pause/resume/take over a conversation safely.
- [x] AI replies stay conservative and do not overclaim certainty.
- [x] Dry-run and feature-flag controls exist. (managed in the shop settings page, not env)
- [x] The implementation is additive and does not disturb existing production business logic.

## Explicit Out-of-Scope Until Needed

- [x] Do not refactor LIFF UX just because the AI agent touches LINE. (respected)
- [x] Do not rewrite current search ranking logic for this feature. (respected)
- [x] Do not merge AI suggestion state directly into sales/receipt/accounting truth. (respected)
- [x] Do not add broad schema refactors unrelated to conversation handling. (respected)
- [x] Do not change admin print forms or unrelated admin theme work as part of this feature unless a directly related admin page is introduced. (respected)

## Post-Launch Enhancements

### Reliability & Alerts
- [x] **Layer-6 safety net** in `processLineAiReply()` catch block: when the AI pipeline throws
  unexpectedly, the customer still gets a polite fallback ("ขออนุญาตส่งต่อให้แอดมินค่ะ จะติดต่อกลับในทันทีค่ะ 🙏")
  via reply token (else push), admins are notified, and the original error/FAILED-job bookkeeping is
  preserved. Every fallback step is wrapped so it can never override the original error.
- [x] **Telegram alerts for handoffs**: `shouldSendTelegramForNotification()` now also fires for
  `LINE_OA_HANDOFF` (was Shopee-only). The existing in-app bell + dedupe key (`line-oa-handoff:<id>`)
  are reused, so a burst of customer messages never spams Telegram. Requires `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_CHAT_IDS`.
- [x] **Pending-slip hint on handoff notifications**: `notifyLineOaNeedsAdmin()` takes
  `pendingSlipCount`; when > 0 the title is suffixed "(มีสลิปรอตรวจสอบ)" so admins can triage
  payment-slip cases from the bell/Telegram without opening the conversation.

### Admin Surface
- [x] **Slip status on the conversations list**: `listLineConversations()` includes pending slips
  (PENDING_REVIEW / MATCHED_PENDING_ADMIN_CONFIRM / NEEDS_MORE_INFO); each renders as a "สลิป: …"
  badge next to the conversation status, reusing `paymentSlipStatusLabel` / `paymentSlipStatusBadgeClass`.
- [x] **Thai status labels** on the conversations list (filter dropdown + badges) instead of raw enums.
- [x] Removed the secondary `LineAdminTabNav` (Conversations | Payment slips) — top nav already covers it;
  component deleted, all four LINE OA pages updated.

### Payment-Slip Gallery (Phase 3)
- [x] Route `/admin/line-payment-slips/gallery` (reuses `line_payment_slips.view`; `force-dynamic` + `loading.tsx`).
- [x] Browse slips by date range / status / bank / sender / **reference no** / **exact amount**
  (Phase 2 lookup filters folded into the gallery — no separate search page); effective date =
  transfer date, else received date (marked `*` + amber note). Infinite scroll via
  `IntersectionObserver` + the `loadMorePaymentSlipGalleryAction` Server Action (re-verifies
  permission; view-only, no mutation).
- [x] Click a thumbnail → lightbox with full image, details, keyboard ←/→, download, and a link to
  the review page.
- [x] **Supabase load reduction**: 7-day signed URLs cached in `PaymentSlip.imageSignedUrl` /
  `imageSignedUrlExpiresAt`; cache-miss/near-expiry rows refreshed in ONE batch call
  (`createPaymentSlipSignedUrlsBatch`); `next/image` adds Vercel CDN + lazy-load + browser cache.
- [x] Read model isolated in [lib/line-payment-slip-gallery.ts](/D:/autoparts/lib/line-payment-slip-gallery.ts);
  never confirms a payment or touches receipts/AR/stock (view-only, no AuditLog needed).

### Bank-Transfer Reconciliation (Phase 1)
- [x] Route `/admin/line-payment-slips/reconciliation` (reuses `line_payment_slips.view`; `force-dynamic` + `loading.tsx`).
- [x] Per-day comparison: confirmed slips (`CONFIRMED_BY_ADMIN`, sum `detectedAmount`, effective date =
  transfer date else received date) **vs** ACTIVE receipts with `paymentMethod = TRANSFER`
  (sum `totalAmount`, by `receiptDate`), plus a slip − receipt variance per day and in total.
- [x] Aggregate/period comparison only — slips and receipts are **not** line-matched
  (`matchedSaleId` stays null). Read-only: never writes receipts/AR/stock, no AuditLog needed.
- [x] Date range defaults to the current month (reports reconcile a period); variance ~0 shows green,
  otherwise amber. Logic isolated in
  [lib/line-payment-slip-reconciliation.ts](/D:/autoparts/lib/line-payment-slip-reconciliation.ts).

### Customer Payment History (Phase 4)
- [x] Customer detail page (`/admin/customers/[id]`) gains a "ประวัติสลิปโอนเงิน (LINE)" section listing
  that customer's slips (date / amount / bank / sender / reference / status) with a link to each slip's
  review page. Slips resolve via `LineConversation.customerId` (`listPaymentSlipsByCustomer`).
- [x] **PII gate**: the section only renders for admins who also hold `line_payment_slips.view`
  (a `customers.view`-only user never sees slip data); query is skipped entirely otherwise. View-only,
  no image fetched on this page (links out to the slip detail).

### Reviewer Productivity Stats (Phase 8)
- [x] Route `/admin/line-payment-slips/reviewer-stats` (reuses `line_payment_slips.view`; `force-dynamic`
  + `loading.tsx`). Per-reviewer: slips reviewed, outcome breakdown (confirmed / rejected / needs-info),
  and average time from slip arrival (`createdAt`) to decision (`reviewedAt`).
- [x] Counts only acted-on slips (`reviewedById` set, `reviewedAt` in range); date range defaults to the
  current month. Read-only aggregation in
  [lib/line-payment-slip-reviewer-stats.ts](/D:/autoparts/lib/line-payment-slip-reviewer-stats.ts);
  no mutation, no AuditLog.
