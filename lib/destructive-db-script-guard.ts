/**
 * Target check for maintenance scripts that bulk-delete rows (for example
 * prisma/scripts/clear-transaction-data.ts). Pure — no DB import — so it can be
 * unit-tested and reused by any future wipe/reset script.
 *
 * The rule is an allowlist, not a denylist, because `.env` and `.env.local` in
 * this repo point at the PRODUCTION Supabase project:
 *
 *   1. A URL that mentions a known production Supabase project ref is refused
 *      outright. No flag or env var can override this.
 *   2. A database on this machine (localhost / 127.0.0.1 / ::1) is allowed.
 *   3. Any other host is refused unless ALLOW_DESTRUCTIVE_DB_SCRIPT is set to
 *      the exact target string the refusal prints (user@host:port/db — never
 *      the password), so a disposable remote database has to be named on
 *      purpose, and the approval stops matching if DATABASE_URL changes.
 */

/**
 * Supabase project refs that hold real business data. The ref is public (it is
 * in NEXT_PUBLIC_SUPABASE_URL and every product-image URL), so listing it here
 * exposes nothing. It appears in the pooler username (`postgres.<ref>`) and in
 * the direct-connection host (`db.<ref>.supabase.co`).
 */
export const PRODUCTION_SUPABASE_PROJECT_REFS: readonly string[] = ["lueeusrezzhokfikxjgi"];

export const DESTRUCTIVE_DB_OVERRIDE_ENV = "ALLOW_DESTRUCTIVE_DB_SCRIPT";

const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const DEFAULT_POSTGRES_PORT = "5432";

export type DestructiveDbTargetCheck =
  | { allowed: true; target: string }
  | { allowed: false; target: string | null; reason: string };

/** `user@host:port/db` — identifies the database without the password. */
export const describeDatabaseTarget = (url: URL): string =>
  `${decodeURIComponent(url.username)}@${url.hostname}:${url.port || DEFAULT_POSTGRES_PORT}${url.pathname}`;

export const checkDestructiveDbTarget = (
  databaseUrl: string | undefined,
  override: string | undefined,
): DestructiveDbTargetCheck => {
  if (!databaseUrl?.trim()) {
    return { allowed: false, target: null, reason: "DATABASE_URL is not set." };
  }

  let url: URL;
  try {
    url = new URL(databaseUrl.trim());
  } catch {
    return { allowed: false, target: null, reason: "DATABASE_URL is not a valid URL." };
  }

  const target = describeDatabaseTarget(url);
  const identity = `${url.username}@${url.hostname}`.toLowerCase();
  const productionRef = PRODUCTION_SUPABASE_PROJECT_REFS.find((ref) => identity.includes(ref.toLowerCase()));
  if (productionRef) {
    return {
      allowed: false,
      target,
      reason: `DATABASE_URL points at the production Supabase project (${productionRef}). This script never runs against production.`,
    };
  }

  if (LOCAL_DATABASE_HOSTS.has(url.hostname.toLowerCase())) {
    return { allowed: true, target };
  }

  if (override?.trim() === target) {
    return { allowed: true, target };
  }

  return {
    allowed: false,
    target,
    reason:
      `DATABASE_URL points at a remote database (${target}). If this is a disposable test database, ` +
      `set ${DESTRUCTIVE_DB_OVERRIDE_ENV}="${target}" and run again.`,
  };
};
