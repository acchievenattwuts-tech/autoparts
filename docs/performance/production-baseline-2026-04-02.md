# Production Performance Baseline — 2026-04-02

Measured against the live production site at `https://www.sriwanparts.com` using Lighthouse mobile emulation and Microsoft Edge headless on April 2, 2026.

## Pages measured

| Page | URL | Score | FCP | LCP | Speed Index | TBT | CLS | TTFB | Transfer | Requests |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Home | `https://www.sriwanparts.com/` | 95 | 1172 ms | 2864 ms | 1479 ms | 66 ms | 0.00 | 33 ms | 409 KiB | 32 |
| Products | `https://www.sriwanparts.com/products` | 83 | 1021 ms | 2985 ms | 5677 ms | 308 ms | 0.00 | 35 ms | 427 KiB | 37 |
| FAQ | `https://www.sriwanparts.com/faq` | 95 | 944 ms | 2748 ms | 2211 ms | 104 ms | 0.00 | 32 ms | 364 KiB | 34 |
| Knowledge | `https://www.sriwanparts.com/knowledge` | 96 | 952 ms | 2749 ms | 2186 ms | 88 ms | 0.00 | 34 ms | 371 KiB | 38 |
| Product detail | `https://www.sriwanparts.com/products/item/vigo-cmn8q8z60000004jirqltpt50` | 95 | 1070 ms | 2814 ms | 2037 ms | 76 ms | 0.00 | 35 ms | 383 KiB | 34 |

## Main findings

### 1. `/products` is the slowest public page right now

- Performance score dropped to `83`
- `Speed Index = 5677 ms`
- `TBT = 308 ms`
- `LCP = 2985 ms`

The root document is fast, so the issue is not backend latency. The biggest delay comes after the HTML arrives.

### 2. `/products` has an LCP discovery/load delay problem

LCP breakdown for `/products`:

- Time to first byte: `130 ms`
- Resource load delay: `3680 ms`
- Resource load duration: `371 ms`
- Element render delay: `92 ms`

This points to a late-discovered or low-priority LCP resource rather than a slow server response.

Current Lighthouse LCP node for `/products`:

- selector: `body.flex > main.min-h-screen > div.relative > img.object-cover`
- asset: `/_next/image?url=%2Fhero-banner.jpg&w=750&q=75`
- insight: `fetchpriority=high should be applied = false`

### 3. Product detail is healthy, but the hero image can still be prioritized

LCP breakdown for the sampled product detail page:

- Time to first byte: `126 ms`
- Resource load delay: `579 ms`
- Resource load duration: `97 ms`
- Element render delay: `301 ms`

Current Lighthouse LCP node for the sampled product page:

- selector: `div.grid > div.overflow-hidden > div.relative > img.object-contain`
- insight: `fetchpriority=high should be applied = false`

### 4. Server response time is already strong across the storefront

Observed document response times:

- Home: `33 ms`
- Products: `35 ms`
- FAQ: `32 ms`
- Knowledge: `34 ms`
- Product detail: `35 ms`

This means the next wins are mostly front-end delivery and render-path improvements, not database latency.

### 5. Shared JS still dominates the top transferred assets

Largest requests seen on both `/products` and the sampled product page:

- `_next/static/chunks/4bd1b696-e356ca5ba0218e27.js` at about `63 KiB`
- `_next/static/chunks/3794-123fdf632563f469.js` at about `59 KiB`

Lighthouse also reported:

- Home: `Reduce unused JavaScript` with about `150 ms` potential savings and about `27 KiB` wasted
- Products: `Legacy JavaScript` with about `12 KiB` estimated savings

## Recommended next actions

1. Mark the `/products` hero image as a true priority image.
2. Mark the product detail lead image as a priority image when it is above the fold.
3. Reduce or defer any client-side code on `/products` that is not needed for first paint.
4. Keep measuring the same five URLs after each performance change so trends stay comparable.

## Notes

- These numbers are lab metrics, not CrUX field data.
- Measurements were taken after the recent Phase 7 SEO and storefront performance work, so this file acts as the new baseline for future comparisons.
