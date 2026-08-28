# Price List + Scheduled Price Promotion

## Status

- Owner approved the architecture on 2026-08-27.
- Implementation must be additive and preserve existing pricing, sale, chat, storefront,
  Shopee API, stock, VAT, profit, credit-note, and settlement behavior.
- Production database inspection and validation are read-only unless the owner explicitly
  authorizes a deployment/backfill operation in a later turn.

## Confirmed business rules

- [x] A product has one normal price per Price List.
- [x] Shopee and Lazada prices only prefill manually keyed sales; staff may edit the price.
- [x] A sale line with `salePrice = 0` is valid and may be saved.
- [x] A zero price must show a clear warning; it must not block submit.
- [x] Missing marketplace price does not silently fall back to wholesale/member/retail.
- [x] Customer Type selects an active Price List, including marketplace Price Lists.
- [x] Marketplace pricing resolves through its default customer:
  `MarketplaceChannelSetting -> Customer -> CustomerType -> PriceList`.
- [x] `MarketplaceChannelSetting` must not duplicate `priceListId`.
- [x] A channel-bound Price List must match the marketplace channel.
- [x] Promotions use the sale date shown on the sale document.
- [x] Promotion end date is inclusive.
- [x] Promotions are scheduled price overrides only; this phase excludes coupons,
  buy-X-get-Y, quantity breaks, usage quotas, and marketing campaign delivery.
- [x] Promotion and manual/bill discounts may stack, but the UI must warn.
- [x] A below-cost promotion may be published only after a prominent warning and explicit
  confirmation.
- [x] A product without a normal Price List price cannot be added to/published in a promotion.
- [x] Published promotion date ranges may not overlap for the same Product + Price List.
- [x] Shopee Open Platform imports keep the actual price from the order snapshot and must not
  be overwritten by Price List or Promotion resolution.
- [x] Existing `SaleItem.salePrice` remains the monetary source of truth and historical snapshot.
- [x] Existing `สอบถามราคา` behavior remains unchanged when the resolved chat/storefront price
  is missing or zero.
- [x] `CustomerType.priceTier` is temporary compatibility only. New resolution uses
  `priceListId`; after full backfill and consumer parity it will be removed together with the
  `PriceTier` enum in a separately verified cutover migration.
- [x] While compatibility is active, Price Lists without a legacy tier (including Shopee and
  Lazada) store `priceTier = RETAIL`; new pricing logic must not use that compatibility value.

## Related code inspected before implementation

### Schema and pricing

- [x] `prisma/schema.prisma`
- [x] `lib/product-pricing.ts`
- [x] `lib/transaction-product-search.ts`
- [x] `lib/transaction-options.ts`
- [x] `components/shared/ProductForm.tsx`
- [x] `app/admin/(protected)/products/actions.ts`
- [x] Product list/search/preview/edit price consumers

### Customer pricing and chat parity

- [x] Customer Type page, form, and actions
- [x] Customer form and customer options
- [x] `lib/line-conversation-repository.ts`
- [x] `lib/messenger/messenger-conversation-repository.ts`
- [x] LINE and Messenger webhook pricing paths
- [x] `lib/line-flex-product-card.ts`
- [x] Chat product search/pricing bridge and existing golden tests

### Sales and marketplace

- [x] Shared `SaleForm` and sale Server Actions
- [x] New/edit sale pages and restored-draft behavior
- [x] Manual Shopee/Lazada sale/setup/return/settlement shared module
- [x] Marketplace reports, profit facts, document guards, printing, and docs
- [x] Shopee Open Platform order preview/create-sale path
- [x] Navigation, Quick Search, route permissions, and permission catalog
- [x] Installed Next.js 16.3 forms, Server Actions, cache, and revalidation guides

## Implementation checklist

### Phase 0 — Safety baseline

- [x] Record the pre-change typecheck/lint/golden-test baseline. (`tsc`, scoped ESLint,
  32 pricing/marketplace/Shopee tests passed on 2026-08-27.)
- [x] Add pure golden fixtures representing production price coverage and legacy selection rules.
- [x] Confirm generated Prisma types are used broadly and must be regenerated immediately after
  every schema change; no code change will be verified against stale generated types.

### Phase 1 — Additive Price List foundation

- [x] Add `PriceList` with stable unique code, optional unique channel, active/system flags,
  and sort order.
- [x] Add `ProductPrice` with composite Product + Price List uniqueness and decimal amount.
- [x] Add nullable `CustomerType.priceListId` during compatibility rollout; the separately
  approved required-field cutover remains pending until production backfill parity is proven.
- [x] Add relations/indexes without changing existing Product price columns.
- [x] Add deterministic system Price Lists: WHOLESALE, MEMBER, RETAIL, SHOPEE, LAZADA.
- [x] Add idempotent dry-run-first backfill for legacy Product prices and Customer Types
  (`--apply` is explicit and has not been run against production).
- [x] Add production-read-only completeness verifier for row counts, missing mappings,
  duplicate prices, and value parity.

### Phase 2 — Central price resolver and golden parity

- [x] Add a pure price-resolution core with explicit source metadata.
- [x] Add database adapters that batch-load ProductPrice values without N+1 queries.
- [x] Preserve legacy fallback during transition when new rows have not been deployed/backfilled.
- [x] Preserve RETAIL fallback to wholesale only where the existing STORE rule already does so.
- [x] Preserve MEMBER zero-without-fallback behavior.
- [x] Preserve UNLINKED/UNKNOWN chat safety behavior.
- [x] Add golden tests proving pre/post-cutover output parity for wholesale/member/retail/zero.
- [x] Add golden tests for Shopee/Lazada configured/missing price behavior and channel matching.

### Phase 3 — Customer Type, products, sales, LINE, and Messenger

- [x] Update Customer Type UI/actions/audit to select active Price List.
- [x] Validate channel-bound Price Lists server-side, including existing marketplace settings.
- [x] Make product price inputs dynamic for active Price Lists while keeping the existing
  wholesale-derived member/retail convenience behavior.
- [x] Update product create/update/audit/cache invalidation atomically with ProductPrice.
- [x] Update transaction product search payloads to carry Price List prices without N+1 reads.
- [x] Update new STORE and manual marketplace sale pages to resolve via Customer Type Price List.
- [x] Keep sale edit snapshots stable; never reprice an existing bill automatically.
- [x] Allow zero sale price and show a visible light/dark warning without blocking submit.
- [x] Update LINE price resolution.
- [x] Update Messenger equivalently in the same round.
- [x] Keep storefront and `สอบถามราคา` behavior byte/semantics compatible.
- [x] Confirm Shopee API order-import prices bypass the new resolver.

### Phase 4 — Scheduled PricePromotion module

- [x] Add `PricePromotion` header with Price List, inclusive business-date range,
  draft/published/cancelled state, actors, notes, and audit timestamps.
- [x] Add `PricePromotionItem` with Product, normal reference-price snapshot, and promo price.
- [x] Add nullable SaleItem provenance schema: Price List, Promotion, and price source.
- [x] Add pure scheduled resolver using the sale date, not current time.
- [x] Block missing normal reference price.
- [x] Block overlapping published ranges in the publish transaction.
- [x] Add a PostgreSQL transaction advisory lock per Product + Price List during publish.
- [x] Warn and require confirmation for below-cost publish using the existing sale cost rule.
- [x] Warn when promotion and manual/whole-bill discounts stack.
- [x] On sale-date change, show a confirmation before applying newly resolved prices.
- [x] Never automatically reprice an existing saved sale.
- [x] Never apply internal promotions to Shopee API order snapshots.

### Phase 5 — Admin UX, access, discoverability, and audit

- [x] Add Price List list/coverage/create/activate/deactivate UI.
- [x] Add Price List detail/coverage and edit UI.
- [x] Add bulk price import with preview/dry-run and completeness summary.
- [x] Add Promotion list/new/publish/cancel UI.
- [x] Add Promotion detail/edit UI.
- [x] Implement both light and dark themes for the added pricing surfaces.
- [x] Add permission catalog and route guards.
- [x] Add navigation through the shared source so Quick Search derives the same entries.
- [x] Add audit records for Price List, ProductPrice, Customer Type mapping, and Promotion state.
- [x] Prevent deactivation/cancellation that would leave active dependent configuration invalid.

### Phase 6 — Verification and handoff

- [x] Prisma format/generate succeeds.
- [x] TypeScript succeeds with no errors.
- [x] ESLint succeeds for every changed source file.
- [x] Existing unit/golden tests succeed.
- [x] New pricing golden tests succeed.
- [x] New promotion date-boundary/overlap/zero/stacking tests succeed.
- [x] LINE and Messenger parity tests succeed.
- [x] Marketplace settlement/profit/return tests succeed unchanged.
- [x] Shopee order-import pricing tests succeed unchanged.
- [x] Full repository verification succeeds with 902/902 tests passing and zero skipped tests.
- [x] Next.js production build succeeds, including 71 statically generated pages, while the
  production database connection is forced to `default_transaction_read_only=on`.
- [ ] Production read-only verifier reports complete legacy parity and no invalid mappings.
- [x] Update this checklist after every completed work item.
- [x] Update `PLAN.md` and relevant marketplace/Shopee documentation.

### Phase 7 — Remove the legacy tier after verified cutover

Compatibility registry audited on 2026-08-28:

- Primary runtime selection already reads `CustomerType.priceList` first in STORE/manual
  marketplace sales, LINE, and Messenger.
- Temporary reads remain only as pre-backfill fallbacks in sale customer-option payloads,
  `SaleForm`, LINE/Messenger repositories, customer Price List badges, backfill, and verifier.
- Temporary writes remain in Customer Type actions and the default Customer Type seed solely to
  keep the old enum synchronized while the old application version can still run.
- Legacy pricing types/tests remain intentionally to prove wholesale/member/retail behavior parity;
  they are not evidence that a linked, backfilled customer still resolves through `priceTier`.
- Historical `PLAN.md` entries and archived design documents are records, not runtime consumers.
- Customer list/detail now present Price List as the primary label. The Customer Form payload no
  longer carries an unused `priceTier`, and its Data Cache key was versioned to prevent an old
  cached option shape surviving deployment.

- [ ] Prove every active and referenced Customer Type has a valid `priceListId`.
- [ ] Prove no runtime consumer, cache payload, form, report, LINE path, Messenger path, or test
  reads or writes `CustomerType.priceTier`.
- [ ] Disable the compatibility fallback and rerun the complete golden suite.
- [ ] Enforce required `CustomerType.priceListId`.
- [ ] Remove `CustomerType.priceTier` and the `PriceTier` enum in a dedicated migration.
- [ ] Keep the legacy Product price columns until their separate cleanup is explicitly approved.

## Production rollout status

Production read-only preflight refreshed on 2026-08-28 before rollout:

- Before rollout, `PriceList`, `ProductPrice`, `PricePromotion`, and `PricePromotionItem`
  were absent. The two approved additive migrations were applied successfully on 2026-08-28;
  `prisma migrate status` now reports the production schema is up to date.
- Products: 1,045 total / 1,013 active; 1,012 active products have distinct legacy-tier
  prices.
- The only active product with a zero legacy price is `P0000 อื่นๆ`, with all three legacy
  prices equal to zero. This is valid and must remain zero through backfill.
- Legacy prices contain no negative values and are within the new decimal bounds (maximums:
  wholesale 7,500 / member 8,930 / retail 12,750). Product codes have no case-insensitive
  duplicates, so CSV matching and the initial backfill are unambiguous.
- Customer Types: RETAIL 1, MEMBER 1, WHOLESALE 1; all are active and together are referenced
  by 23 customers.
- Marketplace channel settings: none. Shopee/Lazada default customers and their new Customer
  Types must be configured only after Price Lists exist.
- Active sales: 128; 5 use a whole-bill discount. Historical `SaleItem.salePrice` remains
  untouched by both migrations and backfill.
- The expected first legacy backfill after migration is 3,135 ProductPrice rows
  (1,045 products × 3 legacy lists) and 3 Customer Type mappings. Shopee/Lazada coverage starts
  empty until explicitly entered or imported.

- [x] Review dry-run backfill output: 1,045 products, 3,135 legacy ProductPrice inserts,
  and 3 Customer Type mappings, exactly matching the read-only preflight.
- [ ] Take a production backup. Explicitly skipped by the owner on 2026-08-28 after both
  visible GitHub Weekly Backup runs were found to have failed; no fresh rollback dump was
  claimed or recorded.
- [x] Apply the two additive schema migrations in the approved production workflow.
- [x] Run the idempotent backfill with explicit apply flag. The post-apply dry-run reports
  5/5 system Price Lists present, 0 ProductPrice inserts remaining, and 0 Customer Type
  mappings remaining.
- [x] Run production completeness/parity verification: 5 Price Lists, 1,045 products,
  3,135 ProductPrice rows, and 3 mapped Customer Types; complete legacy parity passes.
  Shopee and Lazada remain intentionally empty at 0/1,045 until their prices are entered.
- [x] Verify rollout did not rewrite transaction history: all 268 existing SaleItem rows retain
  null provenance, and both PricePromotion and PricePromotionItem remain empty.
- [ ] Enable the new resolver only after parity passes.
- [x] Keep legacy Product price columns until a later separately approved cleanup.

## Post-rollout hardening (2026-08-28)

Audit of the shipped feature found and fixed the following. All changes are additive
guards or naming; no pricing formula, stock, or document logic was touched.

- [x] Rename every user-facing "Price List" string to Thai **"ระดับราคา"** (sidebar, page
  headers, tables, dropdowns, permission labels, server-action error messages). Internal
  identifiers, model names, codes, and English code comments are unchanged.
- [x] Register `/admin/pricing/price-lists` and `/admin/pricing/promotions` in
  `TabsBar.ROUTE_LABELS`. The map is hardcoded, so an unregistered route opened no tab at
  all; the same gap was fixed for 7 other menus (customer types, search synonyms, Messenger
  conversations, AI keys, both advance-refund menus, backup center).
- [x] Block CSV price import into `WHOLESALE` / `MEMBER` / `RETAIL`. `syncProductPrices()`
  rewrites those rows from the legacy Product columns on every product save, so an import
  into them was silently reverted. Guarded in `buildPriceImportPreview()` and again inside
  the apply transaction, and the codes are filtered out of the import dropdown.
- [x] Deactivating a Price List now requires that **no** Customer Type references it
  (previously only active ones were counted) and that no non-cancelled promotion references
  it. A Customer Type left pointing at a closed list silently falls back to the legacy tier
  at sale time. The guard and the write now share one transaction.
- [x] `applyPriceImport()` no longer issues one upsert round trip per CSV line inside the
  transaction. Rows are diffed against existing prices: one `createMany` for new rows, one
  update per genuinely changed row, unchanged rows skipped. Added an outer try/catch that
  returns a generic Thai message, and per-bucket counts in the audit entry.
- [x] Product form price inputs for non-legacy Price Lists default to blank instead of `0`,
  and a blank field is skipped instead of coerced to `0`. Saving an unrelated product no
  longer writes a real 0-baht price into every newly created Price List.
- [x] Added the missing `loading.tsx` to both `/pricing` route segments and set
  `maxDuration = 300` on the Price List page so a large import cannot hit the platform
  default function timeout.

Open follow-ups:

- [ ] `queryDetailRows()` in `lib/transaction-product-search.ts` loads **every** PUBLISHED
  promotion for each product with no date bound; `resolveScheduledPrice()` filters by date
  afterwards. Correct today, but the payload grows without a ceiling. Needs an agreed date
  window before bounding it, because backdated sale documents must still resolve.
- [ ] `price_lists.*` and `price_promotions.*` are deliberately absent from
  `STAFF_OPERATIONS_PERMISSIONS` and `STAFF_VIEWER_PERMISSIONS`, so pricing is ADMIN-only.
  Left unchanged pending an explicit decision.
