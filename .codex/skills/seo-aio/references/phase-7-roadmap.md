# Phase 7 Roadmap Summary

Use this file as the condensed reference for the current SEO, AEO, AIO, and performance state of the repo. The full source of truth remains `PLAN.md`.

## Goal

- Rank strongly on search engines
- Improve visibility in AI search and answer surfaces
- Keep Core Web Vitals improving over time

## Completed Foundation

### URL and Canonical Layer

- Product detail routes use `/products/[categorySlug]/[productSlug]`
- Category routes use `/products/[categorySlug]`
- Product pages enforce canonical redirects when opened through a non-canonical path

### Metadata and Sharing

- Core storefront pages have metadata via the Next.js Metadata API
- Canonical tags exist on important public pages
- Open Graph and Twitter card coverage exists for core public pages
- Generated OG image routes exist for homepage, about, faq, knowledge, product, category, and knowledge article surfaces

### Crawlability

- `app/sitemap.ts` covers core public pages, categories, products, about, faq, and knowledge
- Inactive products are excluded from the sitemap
- `app/robots.ts` blocks `/admin/` from indexing

### Structured Data

- Dedicated JSON-LD components exist for:
  - `LocalBusiness`
  - `Organization`
  - `Product`
  - `BreadcrumbList`
  - `FAQPage`
  - `WebSite`
  - `Article`
  - `CollectionPage`

### AIO and Content Foundation

- `/about` explains the business, contact channels, and service model
- `/faq` addresses real customer questions and pairs with FAQ schema
- `/knowledge` exists as the knowledge hub
- `/public/llms.txt` exists
- Early AIO signals are present on product pages
- Knowledge content already covers business intent, troubleshooting, comparisons, local SEO, OEM questions, and compatibility-preparation guidance

### Local SEO Layer

- Natural local keyword coverage already includes:
  - `อะไหล่แอร์รถยนต์`
  - `นครสวรรค์`
  - `จังหวัดนครสวรรค์`
- Future-supporting clusters include shop, compressor, and radiator variants tied to Nakhon Sawan intent

### Performance Loop

- Baseline measurement exists in `docs/performance/production-baseline-2026-04-02.md`
- Bundle analysis exists in `docs/performance/bundle-analysis-2026-04-02.md`
- Real-user web vitals reporting exists
- Public performance passes already include:
  - LCP image priority tuning
  - static-generation and cache tuning
  - products-page render simplification
  - pagination
  - DOM reduction
  - font-weight trimming
  - idle deferral of non-critical client work

## Open Items

- Create stable slug fields in `Product` and `Category` at the database level
- Submit sitemap in Google Search Console
- Test structured data in Google Rich Results Test
- Expand product compatibility depth only when the data is genuinely available
- Keep expanding the knowledge hub from real production query patterns
- Continue the live measurement and tuning loop until public-page metrics are consistently stronger

## Working Principles

- Complete open roadmap items before inventing distant adjacent work
- Preserve natural language and business trust
- Treat SEO and performance as one system
- Keep content aligned with real inventory, real service behavior, and real local market context
