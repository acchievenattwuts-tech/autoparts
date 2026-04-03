---
name: seo-aio
description: Improve this repo's storefront discoverability across traditional search engines and AI answer engines by planning, auditing, and implementing SEO, AEO, AIO, structured data, crawlability, internal linking, content expansion, and Core Web Vitals work. Use when Codex is asked to increase first-page or top-ranking visibility, improve AI citation readiness, expand search-intent coverage, tune Phase 7 roadmap items, or modify files related to metadata, sitemap, robots, JSON-LD, category/product URLs, knowledge content, llms.txt, Open Graph, and storefront performance.
---

# SEO AIO

## Overview

Use this skill to move the storefront toward stronger ranking potential on search engines and stronger citation potential in AI systems such as ChatGPT, Perplexity, and Google AI Overviews.

Treat `PLAN.md` Phase 7 as the source of truth for roadmap scope and current status. Treat `.rules` as mandatory operating constraints before any change. If the task touches Next.js implementation details, read the relevant local guide under `node_modules/next/dist/docs/` before editing code.

## Operating Order

1. Read `.rules` first. Follow its planning, validation, and safety requirements strictly.
2. Read the relevant Phase 7 sections in `PLAN.md` and any referenced performance notes before proposing or making changes.
3. Identify which lane the request belongs to:
   - technical SEO foundation
   - schema and metadata
   - content and AI citation readiness
   - internal linking and crawlability
   - Core Web Vitals and rendering performance
4. Check whether the request is already in the roadmap. If not, ask the user which phase should own it before implementing.
5. Prefer the smallest high-confidence change that improves search visibility, trust, or performance without inventing unsupported business facts.
6. After meaningful changes, validate with the repo-standard checks and note any remaining measurement or rollout work.

## Decision Tree

- If the task is about metadata, canonical URLs, `robots.ts`, `sitemap.ts`, OG images, or JSON-LD:
  read `references/phase-7-roadmap.md` first, then inspect the current implementation and align changes with the existing Phase 7 structure.
- If the task is about knowledge articles, `/about`, `/faq`, `/knowledge`, or `llms.txt`:
  read `references/implementation-guidelines.md` first and preserve trust-first language grounded in the real shop context.
- If the task is about rankings, traffic growth, or "get found in AI":
  convert the request into concrete execution buckets:
  - crawlability and indexation
  - intent coverage
  - structured answers and entity clarity
  - internal links and canonical consistency
  - performance and Core Web Vitals
- If the task is about performance on public pages:
  treat performance as SEO work, not a separate concern. Focus on LCP, INP, CLS, render cost, cache strategy, and image delivery before adding more UI complexity.

## Core Rules

- Do not promise rankings. Optimize for ranking potential, crawlability, clarity, trust, and measurable performance gains.
- Do not fake compatibility, OEM, stock, local presence, reviews, or business credentials. Use only information supported by the repo or user-provided facts.
- Do not keyword-stuff. Keep Thai and English keyword usage natural, local, and trust-focused.
- Keep canonicals, metadata, structured data, and URL patterns aligned. Do not let multiple public URLs compete for the same intent unless intentionally designed.
- Prefer high-intent landing pages over query-string states for indexable search coverage.
- Keep JSON-LD in dedicated components rather than inline JSX, matching the existing Phase 7 rule.
- For paginated, filtered, or search-result states, preserve the existing noindex logic unless the user explicitly wants a roadmap change.
- Treat `llms.txt`, FAQ answers, knowledge articles, and product/category copy as AI citation surfaces. Write them for direct answer extraction, not vague marketing filler.

## Execution Lanes

### 1. Technical SEO Foundation

Use this lane for:
- metadata and canonical audits
- sitemap and robots coverage
- indexation control
- URL consistency
- Open Graph coverage
- public route discoverability

Check:
- one canonical URL per primary intent
- metadata exists on core storefront pages
- `robots.ts` blocks admin and exposes sitemap
- `sitemap.ts` excludes inactive or non-indexable pages
- internal links point to canonical category/product destinations

### 2. Schema and Entity Clarity

Use this lane for:
- `Organization`
- `LocalBusiness` or `AutoPartsStore`
- `WebSite`
- `BreadcrumbList`
- `Product`
- `FAQPage`
- `Article`
- `CollectionPage`

Check:
- JSON-LD matches the visible page content
- the schema type matches the page purpose
- breadcrumb and canonical data are consistent
- no unsupported claims are added just to "improve SEO"

### 3. AEO and AIO Content

Use this lane for pages that need to answer real customer questions clearly enough for search snippets and AI systems to reuse.

Write content that:
- answers the core question early
- uses real shop context
- makes the next action obvious
- includes compatibility caution where certainty is limited
- supports local intent without sounding spammy

Strong content surfaces in this repo include:
- `/about`
- `/faq`
- `/knowledge`
- product detail pages
- category landing pages
- `/public/llms.txt`

### 4. Internal Linking and Intent Coverage

Use this lane when expanding discoverability across categories, products, local terms, compatibility questions, troubleshooting, comparisons, and conversion-intent topics.

Prefer:
- hub-to-spoke linking from `/knowledge`
- category-to-product linking
- product-to-category and product-to-knowledge linking when context fits
- intent-specific landing pages for stable, indexable themes

Avoid:
- orphan pages
- duplicate pages chasing the same keyword cluster
- thin content created only to target a keyword variant

### 5. Core Web Vitals and Render Path

Use this lane when public pages are slow or when visual/UI changes could hurt rankings.

Default priorities:
1. improve LCP discovery and image delivery
2. reduce unnecessary client work on public pages
3. preserve caching and static generation where safe
4. reduce DOM and payload on `/products` before adding richer UI
5. measure again after deploy instead of assuming gains

## Repo-Specific Reading Order

Read only what is needed:

- `PLAN.md`
  Start with Phase 7 sections and roadmap updates.
- `references/phase-7-roadmap.md`
  Use for a condensed summary of what already exists and what remains open.
- `references/implementation-guidelines.md`
  Use for repo-specific content, trust, and execution heuristics.
- `docs/performance/production-baseline-2026-04-02.md`
  Read when the task involves live storefront performance.
- `docs/performance/bundle-analysis-2026-04-02.md`
  Read when the task involves bundle weight or client-side cost.

## Change Strategy

When asked to improve rankings or AI visibility:

1. Translate the request into one or more execution lanes above.
2. Audit the current implementation before proposing new files or routes.
3. Prefer completing unfinished Phase 7 items before inventing adjacent work.
4. If content expansion is needed, derive topics from real purchase intent, local intent, troubleshooting, comparison, OEM, and compatibility questions already reflected in the roadmap.
5. Keep the implementation measurable. Define what should improve:
   - indexable coverage
   - snippet quality
   - AI answer extractability
   - internal-link clarity
   - LCP, INP, or CLS

## Validation

After substantive changes:

- run the relevant build or validation checks required by `.rules`
- verify no schema, metadata, or canonical contradictions were introduced
- confirm new public content is internally linked
- confirm AI-oriented content remains factual and grounded in the real business
- if the change targets performance, compare against the current baseline or note that production measurement is still required

## References

- Read `references/phase-7-roadmap.md` for the condensed roadmap state and unresolved items.
- Read `references/implementation-guidelines.md` for repo-specific execution guidance and target outcomes.
