# Public Views + Policy Blueprint for Storefront

## Purpose

This blueprint is a **next-step design**, not a live rollout.

Use it when the storefront or future external consumers need safe read-only access through Supabase API without exposing raw business tables.

## Why Views First

The storefront should never read raw operational tables directly if we can avoid it.

Views give us:

- a stable public data contract
- field-level minimization
- less accidental exposure of internal columns
- simpler RLS policies than protecting raw tables one by one

## Recommended Public Data Surface

### 1. `public_site_settings`

Purpose:

- expose only storefront-safe company settings

Recommended fields:

- `key`
- `value`

Allowed keys only:

- `shop_name`
- `shop_slogan`
- `shop_logo_url`
- `shop_phone`
- `shop_phone_secondary`
- `shop_line_id`
- `shop_line_url`
- `shop_google_map_url`
- `shop_google_map_embed_url`
- `shop_business_hours`
- `shop_holiday_note`
- `shop_contact_note`
- `hero_title`
- `hero_subtitle`
- `shop_facebook_url`
- `shop_facebook_enabled`
- `shop_tiktok_url`
- `shop_tiktok_enabled`
- `shop_shopee_url`
- `shop_shopee_enabled`
- `shop_lazada_url`
- `shop_lazada_enabled`

### 2. `public_catalog_categories`

Purpose:

- storefront category listing

Recommended fields:

- `id`
- `name`

Rules:

- only `isActive = true`

### 3. `public_catalog_car_brands`

Purpose:

- storefront brand filter

Recommended fields:

- `id`
- `name`

Rules:

- only `isActive = true`

### 4. `public_catalog_car_models`

Purpose:

- storefront car model filter

Recommended fields:

- `id`
- `name`
- `carBrandId`

Rules:

- only active brands and active models

### 5. `public_catalog_products`

Purpose:

- storefront-safe product list/search source

Recommended fields:

- `id`
- `code`
- `name`
- `description`
- `imageUrl`
- `salePrice`
- `stock`
- `reportUnitName`
- `categoryName`
- `brandName`
- `isActive`
- `createdAt`

Rules:

- only `isActive = true`
- never include:
  - `costPrice`
  - `avgCost`
  - supplier linkage
  - stock movement data
  - internal lot data

### 6. `public_catalog_product_aliases`

Purpose:

- optional storefront search synonym support if browser/API search is needed later

Recommended fields:

- `productId`
- `alias`

Rules:

- only aliases for active products

## Policy Model

When these views are introduced, use read-only policies.

### Baseline policy shape

- `anon`: `SELECT` only
- `authenticated`: `SELECT` only
- no insert/update/delete through public views

### Important rule

If the app still runs server-first with Prisma, these views are optional.

Do not move the storefront to direct browser-side Supabase reads unless there is a clear product or scaling reason.

## Suggested SQL Shape

### View example: `public_site_settings`

```sql
create or replace view public.public_site_settings
with (security_invoker = true) as
select key, value
from public."SiteContent"
where key in (
  'shop_name',
  'shop_slogan',
  'shop_logo_url',
  'shop_phone',
  'shop_phone_secondary',
  'shop_line_id',
  'shop_line_url',
  'shop_google_map_url',
  'shop_google_map_embed_url',
  'shop_business_hours',
  'shop_holiday_note',
  'shop_contact_note',
  'hero_title',
  'hero_subtitle',
  'shop_facebook_url',
  'shop_facebook_enabled',
  'shop_tiktok_url',
  'shop_tiktok_enabled',
  'shop_shopee_url',
  'shop_shopee_enabled',
  'shop_lazada_url',
  'shop_lazada_enabled'
);
```

### Policy example

```sql
grant select on public.public_site_settings to anon, authenticated;
```

Apply the same pattern to other public catalog views.

## Rollout Plan

### Step 1

- keep current server-first Prisma architecture
- do not switch storefront reads yet

### Step 2

- create views only
- test data shape

### Step 3

- grant read-only access to `anon` and `authenticated`
- verify no sensitive fields are exposed

### Step 4

- only if needed, migrate selected storefront reads to Supabase API

## Do Not Expose

Never create public read access for these raw tables:

- `User`
- `Customer`
- `Supplier`
- `Sale`
- `Purchase`
- `Receipt`
- `CreditNote`
- `StockCard`
- `LoginThrottle`
- `WarrantyClaim`
- `product_search_documents`

## Recommendation

For this project, keep this blueprint as a prepared next phase.

It is valuable for future-proofing, but not required for the current storefront because Prisma server-side access is already the main path.
