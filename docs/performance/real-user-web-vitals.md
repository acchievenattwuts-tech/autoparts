# Real User Web Vitals

## Purpose

This project now records real user Core Web Vitals from the live storefront and writes them to the server log through `POST /api/web-vitals`.

The goal is to support the ongoing Phase 7 measurement loop with production data instead of relying on Lighthouse alone.

## What gets recorded

- `CLS`
- `FCP`
- `FID`
- `INP`
- `LCP`
- `TTFB`

Each record includes:

- metric id
- metric name
- metric value
- metric delta
- rating
- navigation type
- current pathname
- current href
- capture timestamp

## How it works

- `components/analytics/WebVitalsReporter.tsx` uses `useReportWebVitals` from Next.js
- the reporter sends metrics with `navigator.sendBeacon()` when available
- `app/api/web-vitals/route.ts` accepts the payload and writes a structured log entry

## Notes

- reporting only runs in production
- no database writes are involved
- this is intentionally lightweight so it does not add unnecessary risk to storefront performance

## Recommended workflow

1. Deploy to production
2. Browse the main storefront pages on real devices
3. Review Vercel logs for `[web-vitals]`
4. Group the results by pathname
5. Prioritize pages with repeated `LCP`, `INP`, or `CLS` problems
