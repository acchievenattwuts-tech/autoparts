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

## Measurement Notes

- Tooling: Lighthouse 13.0.3, mobile emulation, Microsoft Edge headless
- Date measured: 2026-04-03
- Runs: 2 per URL, using the better stable run for comparison
- Reports saved locally under `D:\autoparts\.tmp\lh`

## Success Criteria

- `/products` score improves or stays stable while LCP and Speed Index improve
- no regression larger than roughly 10% on home, faq, knowledge, product detail, or category
- product detail remains healthy after the URL-shape change
- category page does not emerge as a new bottleneck

## Measurement Table

| Page | URL | Score | FCP | LCP | Speed Index | TBT / INP proxy | CLS | TTFB | Transfer | Requests | Delta vs 2026-04-02 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Home | `https://www.sriwanparts.com/` | 93 | 1363 ms | 2659 ms | 2274 ms | 182 ms | 0.00 | 35 ms | 385 KiB | 33 | Score slipped slightly and TBT increased, but LCP improved and transfer stayed lower |
| Products | `https://www.sriwanparts.com/products` | 87 | 993 ms | 2436 ms | 1582 ms | 304 ms | 0.13 | 37 ms | 378 KiB | 43 | Big win: score, LCP, and Speed Index all improved sharply after the static landing change, but CLS regressed and request count rose |
| FAQ | `https://www.sriwanparts.com/faq` | 95 | 1069 ms | 2357 ms | 2359 ms | 182 ms | 0.00 | 38 ms | 310 KiB | 38 | Score held, LCP improved, but FCP and TBT regressed modestly |
| Knowledge | `https://www.sriwanparts.com/knowledge` | 96 | 1106 ms | 2449 ms | 2126 ms | 149 ms | 0.00 | 39 ms | 305 KiB | 36 | Score held, LCP improved, transfer shrank, but TBT rose from the previous baseline |
| Product detail | `https://www.sriwanparts.com/product/vigo-cmn8q8z60000004jirqltpt50` | 95 | 935 ms | 2422 ms | 1908 ms | 173 ms | 0.00 | 36 ms | 333 KiB | 39 | URL-shape change did not hurt score; LCP improved, but TBT increased versus the old canonical route |
| Category | `https://www.sriwanparts.com/products/คอมเพรสเซอร์แอร์` | 93 | 930 ms | 2404 ms | 2183 ms | 244 ms | 0.00 | 37 ms | 369 KiB | 44 | New comparison target; healthy overall and not worse than the old `/products` bottleneck |

## Findings

### 1. Current bottleneck

- `/products` is still the highest-value performance target, but for a different reason than the 2026-04-02 baseline.
- The previous problem was raw render speed. That improved substantially after moving the default entry route to a static landing page.
- The current issue is visual stability: Lighthouse now reports `CLS = 0.13` on `/products`, which is the clearest regression in the whole storefront run.

### 2. `/products` re-check

- `/products` improved from `83` to `87`.
- `LCP` dropped from `2985 ms` to `2436 ms`.
- `Speed Index` dropped from `5677 ms` to `1582 ms`, which confirms the static-first refactor paid off.
- `TBT` stayed roughly flat at `304 ms` versus `308 ms`, so the first-entry path is faster but the main-thread work has not really been reduced yet.
- The route now ships fewer transferred KiB than the old baseline, but it triggers more requests and still lacks a strong LCP priority hint on the main hero path.

### 3. Shared JS / client work

- The same shared storefront chunks are still the heaviest payloads on every measured page:
  - `_next/static/chunks/4bd1b696-e356ca5ba0218e27.js` at about `63 KiB`
  - `_next/static/chunks/3794-123fdf632563f469.js` at about `59 KiB`
- This matches the earlier baseline: the static landing change fixed the initial route shape, but shared JavaScript is still the largest cross-page delivery cost.
- `TBT` increased on home, faq, knowledge, and product detail, which reinforces that the next win is client-work reduction rather than backend tuning.

### 4. Image / font / render-path observations

- Product detail looks healthy after the canonical move to `/product/[productSlug]`.
- The sampled product page now shows the lead image as priority-discovered in Lighthouse, which is consistent with the improved `LCP` from `2814 ms` to `2422 ms`.
- Home, FAQ, and knowledge all kept good scores, but they no longer have the same margin they had in the 2026-04-02 run because TBT rose across the board.

### 5. Category page check

- The new category benchmark came in at `93`, with `LCP = 2404 ms`, `Speed Index = 2183 ms`, and `CLS = 0.00`.
- That means category pages are healthy enough to keep shipping, and they did not become the new storefront bottleneck after the slug and hero simplification work.
- The remaining work should stay focused on `/products` and shared client bundles before revisiting category pages.

## Recommended Next Pass

1. Fix the `/products` layout shift by checking hero, filter bar, and product grid placeholders for dimension or hydration-related movement.
2. Reduce shared client JavaScript on the storefront, especially the two persistent `59-63 KiB` chunks that still dominate every measured route.
3. Re-run the same six URLs after the CLS fix to confirm `/products` keeps its LCP and Speed Index gains without carrying the new instability regression.
