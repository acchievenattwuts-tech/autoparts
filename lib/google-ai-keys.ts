import { db } from "@/lib/db";
import { AiApiKeyProvider, AiApiKeyStatus } from "@/lib/generated/prisma";

/**
 * Multi-key rotation/fallback registry for Google Gemini free-tier API keys.
 *
 * - Secrets live ONLY in server env vars (GOOGLE_AI_API_KEY_1..5). They are never
 *   stored in the database — the DB only tracks per-key health so that all Vercel
 *   serverless instances share the same "this key is cooling down" knowledge.
 * - When a key hits a rate/quota limit it is put into COOLING_DOWN until a timed
 *   window passes; selection skips cooling/disabled keys automatically.
 */

const PROVIDER = AiApiKeyProvider.GOOGLE_GEMINI;
const MAX_KEYS = 10;

// Per-minute (RPM) burst limit — short cooldown, the quota refills every minute.
const RATE_LIMIT_COOLDOWN_MS = 60_000;
// Transient upstream errors (5xx / network) — very short cooldown before retry.
const TRANSIENT_COOLDOWN_MS = 20_000;

function dailyCooldownMs(): number {
  const minutes = Number.parseInt(process.env.GOOGLE_AI_DAILY_COOLDOWN_MINUTES ?? "", 10);
  if (Number.isFinite(minutes) && minutes > 0) {
    return minutes * 60_000;
  }
  // Daily quota exhausted — back off for an hour by default, other keys cover load.
  return 60 * 60_000;
}

export type GeminiKeyHandle = {
  keyRef: string;
  secret: string;
};

function envKeyName(index: number): string {
  return `GOOGLE_AI_API_KEY_${index}`;
}

function keyRefForIndex(index: number): string {
  return `google-gemini-${index}`;
}

/**
 * Reads the configured Gemini keys from env (1..MAX_KEYS). Only keys that are
 * actually present (non-empty) are returned, so you can run with 1–10 keys.
 */
export function getConfiguredGeminiKeys(): GeminiKeyHandle[] {
  const configured: GeminiKeyHandle[] = [];
  for (let index = 1; index <= MAX_KEYS; index += 1) {
    const secret = process.env[envKeyName(index)]?.trim();
    if (secret) {
      configured.push({ keyRef: keyRefForIndex(index), secret });
    }
  }
  return configured;
}

export function hasGeminiKeysConfigured(): boolean {
  return getConfiguredGeminiKeys().length > 0;
}

async function ensureKeyRows(keyRefs: string[]): Promise<void> {
  await Promise.all(
    keyRefs.map((keyRef) =>
      db.aiApiKeyState.upsert({
        where: { keyRef },
        create: { keyRef, provider: PROVIDER },
        update: {},
      }),
    ),
  );
}

/**
 * Returns the currently usable keys, ordered so the least-recently-used key is
 * tried first (spreads load evenly across all accounts). Keys that are DISABLED
 * or still inside their cooldown window are excluded.
 */
export async function getAvailableGeminiKeys(): Promise<GeminiKeyHandle[]> {
  const configured = getConfiguredGeminiKeys();
  if (configured.length === 0) {
    return [];
  }

  const secretByRef = new Map(configured.map((handle) => [handle.keyRef, handle.secret]));
  const keyRefs = configured.map((handle) => handle.keyRef);

  await ensureKeyRows(keyRefs);

  const now = new Date();
  const rows = await db.aiApiKeyState.findMany({
    where: {
      provider: PROVIDER,
      keyRef: { in: keyRefs },
      status: { not: AiApiKeyStatus.DISABLED },
      OR: [{ status: AiApiKeyStatus.AVAILABLE }, { cooldownUntil: { lte: now } }],
    },
    orderBy: [{ lastUsedAt: { sort: "asc", nulls: "first" } }],
    select: { keyRef: true },
  });

  return rows
    .map((row) => {
      const secret = secretByRef.get(row.keyRef);
      return secret ? { keyRef: row.keyRef, secret } : null;
    })
    .filter((handle): handle is GeminiKeyHandle => handle !== null);
}

export async function markGeminiKeySuccess(keyRef: string): Promise<void> {
  await db.aiApiKeyState.update({
    where: { keyRef },
    data: {
      status: AiApiKeyStatus.AVAILABLE,
      cooldownUntil: null,
      lastError: null,
      requestCount: { increment: 1 },
      successCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export async function markGeminiKeyRateLimited(
  keyRef: string,
  options: { daily?: boolean; message?: string },
): Promise<void> {
  const cooldownMs = options.daily ? dailyCooldownMs() : RATE_LIMIT_COOLDOWN_MS;
  await db.aiApiKeyState.update({
    where: { keyRef },
    data: {
      status: AiApiKeyStatus.COOLING_DOWN,
      cooldownUntil: new Date(Date.now() + cooldownMs),
      lastError: (options.message ?? "RATE_LIMITED").slice(0, 500),
      requestCount: { increment: 1 },
      rateLimitCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export async function markGeminiKeyTransientError(keyRef: string, message: string): Promise<void> {
  await db.aiApiKeyState.update({
    where: { keyRef },
    data: {
      status: AiApiKeyStatus.COOLING_DOWN,
      cooldownUntil: new Date(Date.now() + TRANSIENT_COOLDOWN_MS),
      lastError: message.slice(0, 500),
      requestCount: { increment: 1 },
      errorCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export async function markGeminiKeyDisabled(keyRef: string, message: string): Promise<void> {
  await db.aiApiKeyState.update({
    where: { keyRef },
    data: {
      status: AiApiKeyStatus.DISABLED,
      lastError: message.slice(0, 500),
      requestCount: { increment: 1 },
      errorCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export type AiApiKeyStateView = {
  keyRef: string;
  configured: boolean;
  status: AiApiKeyStatus;
  cooldownUntil: Date | null;
  lastError: string | null;
  requestCount: number;
  successCount: number;
  errorCount: number;
  rateLimitCount: number;
  lastUsedAt: Date | null;
  updatedAt: Date;
};

/**
 * Lists every configured Gemini key with its current health row (creating any
 * missing rows first). Used by the admin monitoring page. Never returns secrets.
 */
export async function listAiApiKeyStates(): Promise<AiApiKeyStateView[]> {
  const configured = getConfiguredGeminiKeys();
  const configuredRefs = new Set(configured.map((handle) => handle.keyRef));

  if (configured.length > 0) {
    await ensureKeyRows(configured.map((handle) => handle.keyRef));
  }

  const rows = await db.aiApiKeyState.findMany({
    where: { provider: PROVIDER },
    orderBy: [{ keyRef: "asc" }],
    select: {
      keyRef: true,
      status: true,
      cooldownUntil: true,
      lastError: true,
      requestCount: true,
      successCount: true,
      errorCount: true,
      rateLimitCount: true,
      lastUsedAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({ ...row, configured: configuredRefs.has(row.keyRef) }));
}

/**
 * Re-enables a key after its secret has been fixed/replaced: clears cooldown,
 * disabled status, and the last error so it re-enters rotation immediately.
 */
export async function resetAiApiKey(keyRef: string): Promise<void> {
  await db.aiApiKeyState.update({
    where: { keyRef },
    data: {
      status: AiApiKeyStatus.AVAILABLE,
      cooldownUntil: null,
      lastError: null,
    },
  });
}
