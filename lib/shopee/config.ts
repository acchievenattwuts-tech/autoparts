import { z } from "zod";

/**
 * Shopee Open Platform — environment configuration & host selection.
 *
 * ISOLATION NOTE: This module is part of the self-contained Shopee integration
 * layer (`lib/shopee/*`). It never imports from, or mutates, existing business
 * logic (stock, sales, pricing). It only reads Shopee-specific env vars.
 *
 * Follows the same "config object + `ready` flag" pattern as `lib/qstash.ts`:
 * it never throws at import time, so the rest of the app keeps working even when
 * Shopee credentials are not configured yet.
 */

/** Production (live) Shopee Open Platform host. */
export const SHOPEE_LIVE_HOST = "https://partner.shopeemobile.com";
/** Sandbox / test host used before production app approval. */
export const SHOPEE_TEST_HOST = "https://partner.test-stable.shopeemobile.com";

const shopeeEnvSchema = z.object({
  SHOPEE_PARTNER_ID: z
    .string()
    .trim()
    .regex(/^\d+$/, "SHOPEE_PARTNER_ID must be a numeric id"),
  SHOPEE_PARTNER_KEY: z.string().trim().min(1),
  SHOPEE_REDIRECT_URL: z.string().trim().url(),
  SHOPEE_API_ENV: z.enum(["live", "test"]).default("test"),
  SHOPEE_HOST: z.string().trim().url().optional(),
});

export type ShopeeApiEnv = "live" | "test";

export type ShopeeConfig = {
  ready: true;
  partnerId: number;
  partnerKey: string;
  redirectUrl: string;
  apiEnv: ShopeeApiEnv;
  /** Resolved API host (explicit SHOPEE_HOST override wins, else env-based). */
  host: string;
};

export type ShopeeConfigResult =
  | ShopeeConfig
  | { ready: false; missing: string[] };

function resolveHost(apiEnv: ShopeeApiEnv, override?: string): string {
  if (override) return override.replace(/\/+$/, "");
  return apiEnv === "live" ? SHOPEE_LIVE_HOST : SHOPEE_TEST_HOST;
}

/**
 * Reads Shopee config from the environment. Returns a discriminated union so
 * callers can branch on `ready` without try/catch — mirrors getQStashConfig().
 */
export function getShopeeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ShopeeConfigResult {
  const parsed = shopeeEnvSchema.safeParse({
    SHOPEE_PARTNER_ID: env.SHOPEE_PARTNER_ID,
    SHOPEE_PARTNER_KEY: env.SHOPEE_PARTNER_KEY,
    SHOPEE_REDIRECT_URL: env.SHOPEE_REDIRECT_URL,
    SHOPEE_API_ENV: env.SHOPEE_API_ENV ?? "test",
    SHOPEE_HOST: env.SHOPEE_HOST,
  });

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join("."));
    return { ready: false, missing: Array.from(new Set(missing)) };
  }

  const data = parsed.data;
  return {
    ready: true,
    partnerId: Number(data.SHOPEE_PARTNER_ID),
    partnerKey: data.SHOPEE_PARTNER_KEY,
    redirectUrl: data.SHOPEE_REDIRECT_URL,
    apiEnv: data.SHOPEE_API_ENV,
    host: resolveHost(data.SHOPEE_API_ENV, data.SHOPEE_HOST),
  };
}

/** True when Shopee credentials are fully configured. */
export function isShopeeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getShopeeConfig(env).ready;
}

/**
 * Returns the config or throws SHOPEE_NOT_CONFIGURED. Use only inside code
 * paths that genuinely need to call Shopee (auth start, sync jobs, etc.).
 */
export function getRequiredShopeeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ShopeeConfig {
  const config = getShopeeConfig(env);
  if (!config.ready) {
    throw new Error(
      `SHOPEE_NOT_CONFIGURED: missing/invalid env [${config.missing.join(", ")}]`,
    );
  }
  return config;
}
