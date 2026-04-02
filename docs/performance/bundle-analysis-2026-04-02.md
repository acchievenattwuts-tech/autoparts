# Bundle Analysis

## Date

- 2026-04-02

## How the snapshot was generated

- Installed `@next/bundle-analyzer`
- Enabled analyzer in `next.config.ts` behind `ANALYZE=true`
- Ran a production analyze build

## Generated reports

Reports were generated successfully at:

- `.next/analyze/client.html`
- `.next/analyze/edge.html`
- `.next/analyze/nodejs.html`

## Largest client chunks from this snapshot

Top files in `.next/static/chunks`:

1. `1800-8805da2a321f1463.js` — 388632 bytes
2. `3794-123fdf632563f469.js` — 221957 bytes
3. `4bd1b696-e356ca5ba0218e27.js` — 199870 bytes
4. `framework-711ef29bc66f648c.js` — 189700 bytes
5. `main-7de5d63649a4d992.js` — 131651 bytes
6. `polyfills-42372ed130431b0a.js` — 112594 bytes

## Cleanup audit

Low-risk dependency audit was completed for the current source/config tree.

Packages confirmed as actively used:

- `@base-ui/react`
- `@supabase/supabase-js`
- `class-variance-authority`
- `clsx`
- `lucide-react`
- `recharts`
- `tailwind-merge`
- `tw-animate-css`
- `zod`
- `zustand`
- `@tailwindcss/postcss`

Notes:

- `shadcn` is still referenced by `app/globals.css` through `@import "shadcn/tailwind.css";`
- because of that import, no low-risk dependency removal was applied in this pass

## Recommended next step

- Open the generated analyzer reports and inspect the largest client chunk first
- focus the next cleanup/tuning pass on storefront client components that appear in the biggest browser bundle
