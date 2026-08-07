/**
 * Preloaded by `npm test` (via --import) before any test module is evaluated.
 *
 * Every test in this repo is a pure unit test, but a lot of them import modules
 * whose import chain reaches lib/db.ts — which throws at import time when
 * DATABASE_URL is unset. Rather than loading .env.local (which points at the
 * PRODUCTION Supabase instance), we pin an unroutable placeholder URL.
 *
 * That keeps the suite hermetic in both directions:
 *   - imports resolve, so the ~104 test files load,
 *   - a test that ever tries a real query fails loudly against a dead host
 *     instead of silently reading or writing production data.
 *
 * If a test genuinely needs a database, give it its own script with an explicit
 * --env-file pointing at a disposable database — never add it to `npm test`.
 */
const PLACEHOLDER_DATABASE_URL =
  "postgresql://test:test@127.0.0.1:1/autoparts_test_placeholder";

process.env.DATABASE_URL = PLACEHOLDER_DATABASE_URL;
process.env.DIRECT_URL ??= PLACEHOLDER_DATABASE_URL;
process.env.NODE_ENV ??= "test";
