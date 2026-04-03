# Production Remeasurement Log

Date: 2026-04-03

Compare this run against [production-baseline-2026-04-02.md](/D:/autoparts/docs/performance/production-baseline-2026-04-02.md).

## Goal

Confirm whether the latest Phase 7 storefront changes improved the live render path, especially on `/products`, without regressing the already healthy public routes.

## Target URLs

1. `https://www.sriwanparts.com/`
2. `https://www.sriwanparts.com/products`
3. `https://www.sriwanparts.com/faq`
4. `https://www.sriwanparts.com/knowledge`
5. `https://www.sriwanparts.com/product/vigo-cmn8q8z60000004jirqltpt50`
6. `https://www.sriwanparts.com/products/คอมเพรสเซอร์แอร์`

## Pre-flight Checklist

- Use the live production domain only
- Use the same Lighthouse mobile profile as the 2026-04-02 baseline
- Run each URL at least 2 times and record the better stable run
- Note whether the route was warm or cold if the tooling exposes it
- Confirm the tested product URL uses the current canonical `/product/[productSlug]` shape

## What Changed Since The Baseline

- `/products` is now a static landing page instead of serving the full default search state on first entry
- product detail canonical URLs moved to `/product/[productSlug]`
- category and product URL handling now use DB-backed slugs
- search cache invalidation is stronger after product and master-data updates
- storefront mobile/product/category hero sections were simplified further
- `llms.txt`, sitemap, route linking, and URL references were aligned with the current canonical structure

## Execution Steps

1. Measure all target URLs with Lighthouse mobile emulation
2. Record the metrics in the table below
3. Compare each row against the 2026-04-02 baseline
4. Write the delta in plain language, not just raw numbers
5. Decide whether `/products` is still the highest-value performance target

## Success Criteria

- `/products` score improves or stays stable while LCP and Speed Index improve
- no regression larger than roughly 10% on home, faq, knowledge, product detail, or category
- product detail remains healthy after the URL-shape change
- category page does not emerge as a new bottleneck

## Measurement Table

| Page | URL | Score | FCP | LCP | Speed Index | TBT / INP proxy | CLS | TTFB | Transfer | Requests | Delta vs 2026-04-02 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Home |  |  |  |  |  |  |  |  |  |  |  |
| Products |  |  |  |  |  |  |  |  |  |  |  |
| FAQ |  |  |  |  |  |  |  |  |  |  |  |
| Knowledge |  |  |  |  |  |  |  |  |  |  |  |
| Product detail |  |  |  |  |  |  |  |  |  |  |  |
| Category |  |  |  |  |  |  |  |  |  |  |  |

## Findings

### 1. Current bottleneck

- 

### 2. `/products` re-check

- 

### 3. Shared JS / client work

- 

### 4. Image / font / render-path observations

- 

### 5. Category page check

- 

## Recommended Next Pass

1. 
2. 
3. 
