# Production Remeasurement Log

Date: 2026-04-03

Compare this run against [production-baseline-2026-04-02.md](/D:/autoparts/docs/performance/production-baseline-2026-04-02.md).

## Target URLs

1. `https://www.sriwanparts.com/`
2. `https://www.sriwanparts.com/products`
3. `https://www.sriwanparts.com/faq`
4. `https://www.sriwanparts.com/knowledge`
5. One live product detail page

## Measurement Table

| Page | URL | Score | FCP | LCP | Speed Index | TBT / INP proxy | CLS | TTFB | Transfer | Requests | Delta vs 2026-04-02 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Home |  |  |  |  |  |  |  |  |  |  |  |
| Products |  |  |  |  |  |  |  |  |  |  |  |
| FAQ |  |  |  |  |  |  |  |  |  |  |  |
| Knowledge |  |  |  |  |  |  |  |  |  |  |  |
| Product detail |  |  |  |  |  |  |  |  |  |  |  |

## What Changed Since The Baseline

- Stable slug groundwork moved into the Prisma schema and route helpers.
- Storefront search cache invalidation now uses immediate tag expiry in product and relevant master-data actions.
- Search index restore and trigger verification were completed after the accidental table drop.

## Findings

### 1. Current bottleneck

- 

### 2. `/products` re-check

- 

### 3. Shared JS / client work

- 

### 4. Image / font / render-path observations

- 

## Recommended Next Pass

1. 
2. 
3. 
