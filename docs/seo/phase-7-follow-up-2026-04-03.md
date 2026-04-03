# Phase 7 Follow-up Plan

Date: 2026-04-03

## Scope

This note summarizes the remaining Phase 7 storefront SEO, AEO, AIO, and performance work after the latest slug, direct-product-URL, search-cache, content, and Thai-slug cleanup pass.

## What Was Confirmed

- Metadata, canonical tags, robots, sitemap, OG images, and JSON-LD foundations are present on the core public surfaces.
- `/about`, `/faq`, `/knowledge`, `llms.txt`, product pages, and category pages exist and align with the current roadmap direction.
- Performance baselines and bundle snapshots already exist for the first tuning loop.

## What Was Fixed In The Latest Pass

### Stable slug groundwork

- `Category.slug` and `Product.slug` exist in the Prisma schema.
- Existing rows were backfilled from the database:
  - categories updated: `10`
  - products updated: `4`
- Storefront path helpers now prefer DB-backed slugs over runtime-derived name slugs.
- Product detail pages now use direct canonical URLs under `/product/[productSlug]`.
- Category slug generation now preserves Thai-readable slugs instead of collapsing them into generic `item` patterns.
- Legacy category URLs produced by the older slug normalizer are still resolved and permanently redirected to the canonical DB-backed slug.
- Legacy product URLs under `/products/[categorySlug]/[productSlug]` are redirected to the direct product URL shape.
- Product and category sitemap entries now use DB-backed slugs.
- Admin create flows now assign slugs on new category and product records.

### Search freshness

- Product mutations now use immediate tag expiry for search-related cache tags.
- Category, parts-brand, car-brand, and car-model master actions now invalidate product-search-related cache when they change data that feeds the search document table.

### Content and internal-link depth

- Added another compatibility-first knowledge article focused on compressor plug, pulley, and mounting-point checks before ordering.
- Product detail pages now link directly to compatibility/OEM/photo-check articles to improve both user guidance and internal-link support.

## Remaining Work

### 1. External verification

These items cannot be completed from repo changes alone:

- Submit `https://www.sriwanparts.com/sitemap.xml` in Google Search Console
- Run Google Rich Results Test on:
  - home
  - faq
  - one category page
  - one product page
  - one knowledge article

Prepared tracking file:

- `docs/seo/phase-7-external-verification-2026-04-03.md`

### 2. Production measurement loop

Still open in the roadmap:

- re-measure the live storefront on the same benchmark URLs
- compare against `docs/performance/production-baseline-2026-04-02.md`
- confirm whether `/products` is still the main bottleneck
- inspect whether shared JS remains the next highest-value reduction target

Prepared tracking file:

- `docs/performance/production-remeasurement-2026-04-03.md`

### 3. Content/data depth

Still intentionally open:

- add deeper compatibility detail only when the data is real
- expand knowledge content from real production queries
- expand OEM / part-number / fitment guidance where the shop can support it without guesswork

Recommended next content cluster:

- compressor clutch / pulley mismatch checks
- what to send when the customer knows only the car model
- local-intent buying guidance tied to real order handoff questions

## Suggested Order

1. Complete external verification
2. Re-measure production and record deltas
3. Expand content from production query evidence

## Current Status

- `npm run build` passes
- stable slug backfill is complete
- search cache invalidation is stronger than the previous pass

## Notes

- Do not treat unresolved external verification as a code problem
- Do not fake compatibility or OEM claims to close content gaps
- Keep Phase 7 focused on measurable discoverability and performance gains, not just checklist completion
