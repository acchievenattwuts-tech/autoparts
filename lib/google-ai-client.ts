import {
  getAvailableGeminiKeys,
  hasGeminiKeysConfigured,
  markGeminiKeyDisabled,
  markGeminiKeyRateLimited,
  markGeminiKeySuccess,
  markGeminiKeyTransientError,
} from "@/lib/google-ai-keys";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
/** Embedding size requested via outputDimensionality. Kept in sync with the
 *  `embedding vector(768)` column in product_search_documents. */
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
// Gemini 3 thinkingLevel enum is upper-case: HIGH | LOW (NONE disables thinking).
const DEFAULT_THINKING_LEVEL = "HIGH";
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const REQUEST_TIMEOUT_MS = 30_000;

export class AllGeminiKeysExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllGeminiKeysExhaustedError";
  }
}

class GeminiHttpError extends Error {
  status: number;
  isDailyQuota: boolean;

  constructor(status: number, message: string, isDailyQuota: boolean) {
    super(message);
    this.name = "GeminiHttpError";
    this.status = status;
    this.isDailyQuota = isDailyQuota;
  }
}

export type GeminiInlineImage = {
  mimeType: string;
  dataBase64: string;
};

export type GeminiGenerateInput = {
  prompt: string;
  systemInstruction?: string;
  images?: GeminiInlineImage[];
  maxOutputTokens?: number;
  temperature?: number;
  /** When true, asks Gemini to return application/json. */
  json?: boolean;
  /** When true, enables Gemini Google Search grounding for research-style calls. */
  googleSearch?: boolean;
  /**
   * Per-call reasoning depth override (HIGH | LOW | NONE). Defaults to the global
   * `GOOGLE_AI_THINKING_LEVEL` env / HIGH. Use "NONE" for short or extraction-style
   * tasks so reasoning tokens don't eat into `maxOutputTokens` and truncate output.
   */
  thinkingLevel?: "HIGH" | "LOW" | "NONE";
  /**
   * Per-call HTTP timeout (ms). Defaults to {@link REQUEST_TIMEOUT_MS}. Interactive
   * chat calls pass a tighter value so a hung key fails over fast instead of
   * burning the full 30s (which previously stacked across key rotation into >60s).
   */
  timeoutMs?: number;
  /**
   * Max number of keys to try before giving up (default: all available). Chat
   * calls cap this low so a bad streak can't stack many timeouts in one turn.
   */
  maxKeyAttempts?: number;
};

export type GeminiGenerateResult = {
  text: string;
  keyRef: string;
};

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function getModel(): string {
  return process.env.GOOGLE_AI_MODEL?.trim() || DEFAULT_MODEL;
}

function getEmbeddingModel(): string {
  return process.env.GOOGLE_AI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function getThinkingLevel(): string {
  return process.env.GOOGLE_AI_THINKING_LEVEL?.trim().toUpperCase() || DEFAULT_THINKING_LEVEL;
}

function buildParts(input: GeminiGenerateInput): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: input.prompt }];
  for (const image of input.images ?? []) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.dataBase64 } });
  }
  return parts;
}

function detectDailyQuota(body: string): boolean {
  // Gemini 429 bodies reference the violated quota id, e.g.
  // "GenerateRequestsPerDayPerProjectPerModel" vs "...PerMinute...".
  return /per\s*day/i.test(body) || /PerDay/.test(body);
}

function extractText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return "";
  }
  const first = candidates[0] as { content?: { parts?: Array<{ text?: string }> } };
  const parts = first.content?.parts ?? [];
  return parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

async function callGeminiOnce(secret: string, input: GeminiGenerateInput): Promise<string> {
  const model = getModel();
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(secret)}`;

  const thinkingLevel = input.thinkingLevel?.trim().toUpperCase() || getThinkingLevel();
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: buildParts(input) }],
    generationConfig: {
      maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      temperature: input.temperature ?? 0.4,
      // Gemini 3 reasoning depth. "NONE" disables it; otherwise pass the level.
      ...(thinkingLevel && thinkingLevel !== "NONE"
        ? { thinkingConfig: { thinkingLevel } }
        : {}),
      ...(input.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  if (input.googleSearch) {
    body.tools = [{ googleSearch: {} }];
  }

  if (input.systemInstruction) {
    body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 800);
      throw new GeminiHttpError(
        response.status,
        `GEMINI_HTTP_${response.status}:${errorBody}`,
        response.status === 429 && detectDailyQuota(errorBody),
      );
    }

    const payload = (await response.json()) as unknown;
    return extractText(payload);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generates content with automatic fallback across all configured Gemini keys.
 * On a rate/quota error the current key is put on cooldown and the next key is
 * tried. Throws {@link AllGeminiKeysExhaustedError} when every key is unusable.
 */
export async function generateGeminiContent(input: GeminiGenerateInput): Promise<GeminiGenerateResult> {
  if (!hasGeminiKeysConfigured()) {
    throw new AllGeminiKeysExhaustedError("NO_GEMINI_KEYS_CONFIGURED");
  }

  const keys = await getAvailableGeminiKeys();
  if (keys.length === 0) {
    throw new AllGeminiKeysExhaustedError("ALL_GEMINI_KEYS_COOLING_DOWN_OR_DISABLED");
  }

  let lastError: unknown = null;

  // Cap how many keys we'll try in one call so a bad streak can't stack many
  // timeouts into a single (interactive) turn.
  const attemptKeys = input.maxKeyAttempts ? keys.slice(0, Math.max(1, input.maxKeyAttempts)) : keys;

  for (const key of attemptKeys) {
    try {
      const text = await callGeminiOnce(key.secret, input);
      await markGeminiKeySuccess(key.keyRef);
      return { text, keyRef: key.keyRef };
    } catch (error) {
      lastError = error;

      if (error instanceof GeminiHttpError) {
        if (error.status === 429) {
          await markGeminiKeyRateLimited(key.keyRef, {
            daily: error.isDailyQuota,
            message: error.message,
          });
          continue;
        }
        if (error.status >= 500) {
          await markGeminiKeyTransientError(key.keyRef, error.message);
          continue;
        }
        if (error.status === 400 || error.status === 401 || error.status === 403) {
          // Invalid / revoked / unauthorized key — stop using it until fixed.
          await markGeminiKeyDisabled(key.keyRef, error.message);
          continue;
        }
      }

      // Network/abort/unknown — treat as transient and try the next key.
      await markGeminiKeyTransientError(
        key.keyRef,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  throw new AllGeminiKeysExhaustedError(
    `ALL_GEMINI_KEYS_FAILED:${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function extractEmbedding(payload: unknown): number[] {
  if (typeof payload !== "object" || payload === null) return [];
  const embedding = (payload as { embedding?: { values?: unknown } }).embedding;
  const values = embedding?.values;
  return Array.isArray(values) ? (values as number[]) : [];
}

async function embedContentOnce(secret: string, text: string): Promise<number[]> {
  const model = getEmbeddingModel();
  // gemini-embedding-001 supports `embedContent` (single) — NOT the legacy
  // `batchEmbedContents`. outputDimensionality trims the native vector to the
  // 768 dims stored in product_search_documents.embedding.
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:embedContent?key=${encodeURIComponent(secret)}`;
  const body = {
    model: `models/${model}`,
    content: { parts: [{ text }] },
    outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 800);
      throw new GeminiHttpError(
        response.status,
        `GEMINI_EMBED_HTTP_${response.status}:${errorBody}`,
        response.status === 429 && detectDailyQuota(errorBody),
      );
    }
    const payload = (await response.json()) as unknown;
    return extractEmbedding(payload);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Embeds one or more texts via Gemini (gemini-embedding-001 by default, 768d)
 * with the same multi-key rotation/cooldown as generation. Returns one vector per
 * input (same order). A bad-request/model error (400/404) aborts immediately
 * WITHOUT cooling down keys — every key would fail identically, and it is not a
 * key-health problem. Throws {@link AllGeminiKeysExhaustedError} when no key can
 * serve the request — callers degrade to lexical-only search on failure.
 */
export async function generateGeminiEmbedding(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!hasGeminiKeysConfigured()) {
    throw new AllGeminiKeysExhaustedError("NO_GEMINI_KEYS_CONFIGURED");
  }

  const keys = await getAvailableGeminiKeys();
  if (keys.length === 0) {
    throw new AllGeminiKeysExhaustedError("ALL_GEMINI_KEYS_COOLING_DOWN_OR_DISABLED");
  }

  let lastError: unknown = null;
  for (const key of keys) {
    try {
      const vectors: number[][] = [];
      for (const text of texts) {
        const vector = await embedContentOnce(key.secret, text);
        if (vector.length !== GEMINI_EMBEDDING_DIMENSIONS) {
          throw new Error(`EMBED_DIM_MISMATCH:${vector.length}`);
        }
        vectors.push(vector);
      }
      await markGeminiKeySuccess(key.keyRef);
      return vectors;
    } catch (error) {
      lastError = error;
      if (error instanceof GeminiHttpError) {
        // Bad request / model not found: not a key issue — all keys would fail
        // the same way. Abort without touching key health.
        if (error.status === 400 || error.status === 404) {
          throw new AllGeminiKeysExhaustedError(`GEMINI_EMBED_REQUEST_ERROR:${error.message}`);
        }
        if (error.status === 429) {
          await markGeminiKeyRateLimited(key.keyRef, { daily: error.isDailyQuota, message: error.message });
          continue;
        }
        if (error.status >= 500) {
          await markGeminiKeyTransientError(key.keyRef, error.message);
          continue;
        }
        if (error.status === 401 || error.status === 403) {
          await markGeminiKeyDisabled(key.keyRef, error.message);
          continue;
        }
      }
      await markGeminiKeyTransientError(key.keyRef, error instanceof Error ? error.message : String(error));
    }
  }

  throw new AllGeminiKeysExhaustedError(
    `ALL_GEMINI_EMBED_KEYS_FAILED:${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
