import { z } from "zod";

/**
 * Startup environment check.
 *
 * 51 environment variables are read across the codebase and nothing verified
 * any of them, so a missing value surfaced whenever a customer happened to hit
 * the feature — or, worse, never surfaced at all. `CRON_SECRET` is the clearest
 * case: unset, every cron route answers 401 and the jobs simply stop running,
 * silently, forever.
 *
 * The split below is deliberately conservative. Only variables whose absence
 * already breaks the process are fatal; everything else warns. Promoting a
 * warning to fatal would turn a degraded feature into a failed deployment, so
 * that is a decision to make one variable at a time, not a default.
 */

/** Absent → the app cannot serve a single authenticated request. */
const requiredSchema = z.object({
  // lib/db.ts already throws on this; declared here so the failure is reported
  // once at startup with the rest, instead of at the first query.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is not set"),
});

/**
 * Absent → a specific capability silently stops working, with no error anyone
 * would notice. Each entry names the consequence so the log line is actionable.
 */
const WARN_IF_MISSING: ReadonlyArray<{ key: string; consequence: string }> = [
  {
    // NextAuth v5 reads AUTH_SECRET and falls back to NEXTAUTH_SECRET; handled
    // as a pair below rather than as a plain key.
    key: "NEXTAUTH_SECRET",
    consequence: "admin sessions cannot be signed — every login will fail",
  },
  {
    key: "CRON_SECRET",
    consequence:
      "every /api/**/cron/* route answers 401, so search popularity, notification cleanup and stock alerts stop running",
  },
  {
    key: "REVALIDATE_SECRET",
    consequence: "storefront cache revalidation webhooks are rejected",
  },
  {
    key: "DOC_VERIFY_SECRET",
    consequence: "printed document verification QR codes cannot be validated",
  },
  {
    key: "LINE_MESSAGING_API_CHANNEL_SECRET",
    consequence: "LINE webhook signatures cannot be verified",
  },
  {
    key: "MESSENGER_APP_SECRET",
    consequence: "Messenger webhook signatures cannot be verified",
  },
];

export type EnvIssue = { key: string; consequence: string };

export type EnvCheckResult = {
  /** Fatal problems. Non-empty means the process should not continue. */
  errors: string[];
  /** Degraded capabilities worth logging loudly. */
  warnings: EnvIssue[];
};

/** Anything process.env-shaped. Kept looser than NodeJS.ProcessEnv so tests can
 *  build a snapshot literal without asserting a type. */
export type EnvSnapshot = Record<string, string | undefined>;

const isPresent = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Pure check over an environment snapshot. Exported (and tested) separately
 * from the process-level wrapper so the classification can be exercised
 * without mutating process.env.
 */
export const checkEnv = (env: EnvSnapshot): EnvCheckResult => {
  const parsed = requiredSchema.safeParse(env);
  const errors = parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);

  const warnings: EnvIssue[] = [];
  for (const entry of WARN_IF_MISSING) {
    // AUTH_SECRET is the v5 name for NEXTAUTH_SECRET; either satisfies it.
    if (entry.key === "NEXTAUTH_SECRET" && isPresent(env.AUTH_SECRET)) continue;
    if (!isPresent(env[entry.key])) warnings.push(entry);
  }

  return { errors, warnings };
};

/**
 * Runs the check against the real environment and reports it. Throws only on a
 * fatal problem, so a missing optional integration degrades that feature rather
 * than taking the deployment down.
 */
export const assertEnv = (env: EnvSnapshot = process.env): void => {
  const { errors, warnings } = checkEnv(env);

  for (const warning of warnings) {
    console.warn(`[env] ${warning.key} is not set — ${warning.consequence}`);
  }

  if (errors.length > 0) {
    throw new Error(`[env] missing required configuration:\n  - ${errors.join("\n  - ")}`);
  }
};
