# RLS Design for `autoparts`

## Goal

Enable Row Level Security on every table in the `public` schema to satisfy Supabase security guidance without breaking:

- Prisma server-side access
- NextAuth credential login
- Codex / Claude database inspection workflows
- current admin and storefront behavior

## Current Architecture

This project is **server-first** for database access:

- application data access runs through Prisma using `DATABASE_URL`
- auth reads users directly from PostgreSQL in `auth.ts`
- current `.env.local` does **not** configure public Supabase browser keys
- Supabase Storage is used for assets, but DB reads are not driven by Supabase client queries from the browser

Because of that, the safest rollout is:

1. enable RLS on every `public` table
2. do **not** use `FORCE ROW LEVEL SECURITY`
3. do **not** create broad `anon` / `authenticated` policies yet
4. keep API access denied by default
5. later expose only safe public data through narrow policies or views

## Why This Works

Supabase advisories are about API exposure when tables in `public` do not have RLS enabled.

For this project, enabling RLS with no public policies:

- blocks unintended access through Supabase API
- does not change the existing Prisma access pattern
- keeps rollout fast and low-risk

## Table Groups

### Group A: Internal-only, never public

These tables contain credentials, PII, financial data, stock movement, or operational data.

- `User`
- `LoginThrottle`
- `AppRole`
- `AppRolePermission`
- `Permission`
- `Customer`
- `Supplier`
- `Sale`
- `SaleItem`
- `SaleItemLot`
- `Purchase`
- `PurchaseItem`
- `PurchaseItemLot`
- `PurchaseReturn`
- `PurchaseReturnItem`
- `PurchaseReturnItemLot`
- `Receipt`
- `ReceiptItem`
- `CreditNote`
- `CreditNoteItem`
- `CreditNoteItemLot`
- `StockCard`
- `StockMovementLot`
- `Adjustment`
- `AdjustmentItem`
- `BalanceForward`
- `Expense`
- `ExpenseItem`
- `Warranty`
- `WarrantyClaim`
- `ProductLot`
- `LotBalance`
- `product_search_documents`

### Group B: Potentially public in the future, but not directly today

These are storefront-facing business entities, but should not be exposed as raw tables yet.

- `Product`
- `ProductAlias`
- `ProductCarModel`
- `ProductUnit`
- `Category`
- `CarBrand`
- `CarModel`
- `PartsBrand`
- `SiteContent`
- `ExpenseCode`

## Future Public Exposure Pattern

If the app later needs direct Supabase API reads from browser or external consumers, do **not** expose raw tables first.

Use one of these patterns:

1. `security_invoker` views for catalog-safe data
2. narrow `SELECT` policies on carefully scoped tables
3. whitelist-only public settings views for storefront config

Recommended future views:

- `public_catalog_products`
- `public_catalog_categories`
- `public_catalog_car_brands`
- `public_catalog_car_models`
- `public_site_settings`

## SiteContent Guidance

`SiteContent` mixes public storefront settings and potentially internal config growth over time.

Do not open the whole table to `anon`.

If public API exposure is needed later, create a safe view that only includes keys like:

- `shop_name`
- `shop_slogan`
- `shop_logo_url`
- `shop_phone`
- `shop_phone_secondary`
- `shop_line_id`
- `shop_line_url`
- `shop_google_map_url`
- `shop_business_hours`
- `shop_holiday_note`
- social profile URLs and toggles

## Rollout Rules

### Phase 1: Safe baseline

- enable RLS on all `public` tables
- do not force RLS
- do not add public policies

### Phase 2: Verify application safety

- verify Prisma reads still work
- verify login still works
- verify storefront config still loads
- verify product search still works

### Phase 3: Optional hardening later

- add public-safe views if needed
- add least-privilege policies only where necessary
- review Supabase Storage policies separately

## Performance Notes

This rollout should have negligible impact on the current app because:

- Prisma uses direct database access
- no complex runtime RLS predicates are introduced yet
- no additional joins or policy filters are executed for app queries

## Important Non-Goals in This Change

This baseline rollout does **not**:

- create browser-facing public read policies
- redesign Supabase Storage bucket policies
- move the app to Supabase Auth
- force owner connections to obey RLS

## Recommended Next Security Steps

1. rotate database password because the current workflow exposed direct DB credentials in tooling history
2. set real `NEXT_PUBLIC_SUPABASE_URL` / keys only if browser Supabase access is intentionally needed
3. audit Storage bucket policies separately
4. create safe public views before exposing any DB reads to `anon`
5. use the prepared blueprint in `docs/security/public-views-policy-blueprint.md` if storefront/API public read access is needed later
