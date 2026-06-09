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
const DEFAULT_EMBEDDING_MODEL = "text-embedding-004";
/** text-embedding-004 returns 768-dim vectors. Kept in sync with the
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
  /**
   * Per-call reasoning depth override (HIGH | LOW | NONE). Defaults to the global
   * `GOOGLE_AI_THINKING_LEVEL` env / HIGH. Use "NONE" for short or extraction-style
   * tasks so reasoning tokens don't eat into `maxOutputTokens` and truncate output.
   */
  thinkingLevel?: "HIGH" | "LOW" | "NONE";
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

  if (input.systemInstruction) {
    body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

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

  for (const key of keys) {
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

function extractEmbeddings(payload: unknown, expected: number): number[][] {
  if (typeof payload !== "object" || payload === null) return [];
  const embeddings = (payload as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || embeddings.length !== expected) return [];
  const out: number[][] = [];
  for (const item of embeddings) {
    const values = (item as { values?: unknown }).values;
    if (!Array.isArray(values) || values.length === 0) return [];
    out.push(values as number[]);
  }
  return out;
}

async function batchEmbedOnce(secret: string, texts: string[]): Promise<number[][]> {
  const model = getEmbeddingModel();
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:batchEmbedContents?key=${encodeURIComponent(secret)}`;
  const body = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
    })),
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
    return extractEmbeddings(payload, texts.length);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Embeds one or more texts via Gemini (text-embedding-004 by default) with the
 * same multi-key rotation/cooldown as generation. Returns one 768-dim vector per
 * input (same order). Throws {@link AllGeminiKeysExhaustedError} when no key can
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
      const vectors = await batchEmbedOnce(key.secret, texts);
      if (vectors.length !== texts.length) {
        throw new Error("EMBED_RESPONSE_COUNT_MISMATCH");
      }
      await markGeminiKeySuccess(key.keyRef);
      return vectors;
    } catch (error) {
      lastError = error;
      if (error instanceof GeminiHttpError) {
        if (error.status === 429) {
          await markGeminiKeyRateLimited(key.keyRef, { daily: error.isDailyQuota, message: error.message });
          continue;
        }
        if (error.status >= 500) {
          await markGeminiKeyTransientError(key.keyRef, error.message);
          continue;
        }
        if (error.status === 400 || error.status === 401 || error.status === 403) {
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
