# Implementation Guidelines

Use this file when performing actual `seo-aio` work inside this repo.

## First Principles

- Read `.rules` before any implementation work
- Treat `PLAN.md` Phase 7 as the active roadmap scope
- If a request touches Next.js behavior or APIs, read the relevant local docs under `node_modules/next/dist/docs/` first
- Never invent business facts, compatibility claims, or trust signals

## What Success Looks Like

A good `seo-aio` change improves one or more of these:

- crawlability
- canonical clarity
- search-intent coverage
- direct-answer usefulness
- AI citation readiness
- internal-link structure
- Core Web Vitals

## Search + AI Optimization Heuristics

### For metadata and SERP presentation

- Keep titles specific to the page intent
- Keep descriptions useful, concrete, and human-readable
- Avoid repeating near-identical templates across unrelated page types
- Prefer canonical stability over adding many competing URLs

### For AI citation surfaces

- Answer the main question in the first useful block
- Use plain, extractable sentences before longer explanation
- Include limitations when fitment or stock certainty is incomplete
- Prefer concrete nouns over vague slogans
- Make the contact or handoff path explicit when the next step is to verify with the shop

### For knowledge content

- Prioritize real purchase-conversation topics:
  - compatibility checks
  - OEM and part number checks
  - symptom diagnosis
  - comparison and buying guidance
  - local sourcing intent
- Build clusters, not isolated posts
- Link related articles, categories, and relevant product surfaces when justified

### For category and product pages

- Keep the category page as the indexable hub for category-level intent
- Keep the product page focused on the specific part and its strongest supported use cases
- Do not turn filter-result states into index targets unless the roadmap changes explicitly

### For local SEO

- Mention Nakhon Sawan only where it genuinely improves clarity for the user
- Use local terms naturally across metadata, visible copy, structured data, and AI-oriented reference surfaces
- Do not over-repeat province or city names

### For performance-sensitive SEO work

- A slower page is an SEO problem
- On public pages, reduce work before adding richer presentation
- Treat `/products` as the highest-performance-sensitivity surface unless new measurements show otherwise

## Preferred Workflow

1. Audit the current page or surface
2. Map the gap to a Phase 7 objective
3. Implement the smallest high-confidence change
4. Validate build and behavior
5. Note what still requires production measurement or external submission

## Common Task Translations

- "Make the site rank higher"
  Translate into missing metadata, schema, content depth, internal links, and performance work
- "Make AI cite the site"
  Translate into answer-first content, entity clarity, FAQ/knowledge expansion, `llms.txt`, and grounded trust signals
- "Improve SEO for this category"
  Translate into a stronger category landing page, metadata, internal links, schema, and supporting knowledge links
- "Improve product discoverability"
  Translate into product detail completeness, canonical integrity, related links, and compatibility clarity without fabrication

## Validate Before Closing

- Is the page intent clearer than before?
- Does the change avoid unsupported claims?
- Is the canonical/indexation behavior still correct?
- Is the content useful both to users and answer engines?
- Does the change preserve or improve performance expectations?
