import {
  getAvailableGeminiKeys,
  hasGeminiKeysConfigured,
  markGeminiKeyDisabled,
  markGeminiKeyRateLimited,
  markGeminiKeySuccess,
  markGeminiKeyTransientError,
} from "@/lib/google-ai-keys";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_KNOWLEDGE_EMBEDDING_MODEL = "gemini-embedding-2";
/** Embedding size requested via outputDimensionality. Kept in sync with the
 *  `embedding vector(768)` column in product_search_documents. */
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
// Gemini 3 thinkingLevel enum is upper-case: HIGH | LOW (NONE disables thinking).
const DEFAULT_THINKING_LEVEL = "HIGH";
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const REQUEST_TIMEOUT_MS = 30_000;
// Second model for interactive chat calls when the primary is overloaded (HTTP
// 5xx "high demand") or times out. A capacity spike is per model — every key of
// the same model fails together (LINE incidents 2026-10-12..18) — so retrying the
// same model on another key rarely helps. gemini-3.5-flash is a separate pool,
// verified live 2026-10-18 on the classify prompt while 3.1/3.7/3.8 returned 503.
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash";
// Flash (non-lite) models think when thinkingConfig is omitted (~600 thought
// tokens, ~5s on the classify prompt); LOW measured 0 thought tokens. Sent in
// place of "NONE" when the fallback model serves the call.
const DEFAULT_FALLBACK_THINKING_LEVEL = "LOW";
// After the primary model is overloaded, chat calls on this server instance start
// on the fallback for this long, so each turn stops burning a full timeout first.
const PRIMARY_OVERLOAD_WINDOW_MS = 60_000;
// A fallback model that rejects the request (400/404 — retired id, unsupported
// thinking level) is skipped for this long instead of failing chat calls.
const FALLBACK_REJECTED_WINDOW_MS = 10 * 60_000;

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
  /**
   * When the primary model is overloaded (5xx) or times out, run the next key
   * attempt on the fallback model (`GOOGLE_AI_FALLBACK_MODEL`). Interactive chat
   * calls opt in; background jobs keep a single model.
   */
  fallbackModelOnOverload?: boolean;
};

export type GeminiGenerateResult = {
  text: string;
  keyRef: string;
  /** The model that produced `text` (the fallback when the primary was overloaded). */
  model: string;
};

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function getModel(): string {
  return process.env.GOOGLE_AI_MODEL?.trim() || DEFAULT_MODEL;
}

export function getGeminiEmbeddingModel(): string {
  return process.env.GOOGLE_AI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

/**
 * Dedicated model selector for Knowledge RAG. This intentionally does not reuse
 * GOOGLE_AI_EMBEDDING_MODEL: product vectors and knowledge vectors live in
 * incompatible embedding spaces and must never be switched together.
 */
export function getGeminiKnowledgeEmbeddingModel(): string {
  return (
    process.env.GOOGLE_AI_KNOWLEDGE_EMBEDDING_MODEL?.trim() ||
    DEFAULT_KNOWLEDGE_EMBEDDING_MODEL
  );
}

function getThinkingLevel(): string {
  return process.env.GOOGLE_AI_THINKING_LEVEL?.trim().toUpperCase() || DEFAULT_THINKING_LEVEL;
}

/** The chat fallback model, or null when disabled ("off") or equal to the primary. */
function getFallbackModel(): string | null {
  const configured = process.env.GOOGLE_AI_FALLBACK_MODEL?.trim() || DEFAULT_FALLBACK_MODEL;
  if (/^(off|none|false)$/i.test(configured) || configured === getModel()) return null;
  return configured;
}

function getFallbackThinkingLevel(): string {
  return (
    process.env.GOOGLE_AI_FALLBACK_THINKING_LEVEL?.trim().toUpperCase() ||
    DEFAULT_FALLBACK_THINKING_LEVEL
  );
}

type GeminiModelAttempt = { model: string; thinkingLevel: string; isFallback: boolean };

let primaryOverloadedUntil = 0;
let fallbackRejectedUntil = 0;

/** Test seam: clears the per-instance overload / rejected-fallback windows. */
export function resetGeminiModelFallbackStateForTest(): void {
  primaryOverloadedUntil = 0;
  fallbackRejectedUntil = 0;
}

/**
 * Model order for one call. Without the opt-in (or with no usable fallback) it is
 * the primary alone. With it, the primary leads unless it was overloaded within
 * {@link PRIMARY_OVERLOAD_WINDOW_MS}, in which case the fallback leads.
 */
function buildModelPlan(input: GeminiGenerateInput): GeminiModelAttempt[] {
  const thinkingLevel = input.thinkingLevel?.trim().toUpperCase() || getThinkingLevel();
  const primary: GeminiModelAttempt = { model: getModel(), thinkingLevel, isFallback: false };
  const fallbackModel = input.fallbackModelOnOverload ? getFallbackModel() : null;
  const now = Date.now();
  if (!fallbackModel || now < fallbackRejectedUntil) return [primary];

  const fallback: GeminiModelAttempt = {
    model: fallbackModel,
    thinkingLevel: thinkingLevel === "NONE" ? getFallbackThinkingLevel() : thinkingLevel,
    isFallback: true,
  };
  return now < primaryOverloadedUntil ? [fallback, primary] : [primary, fallback];
}

/** 5xx, timeout/abort or a network failure: the model may serve on another try. */
function isModelOverloadError(error: unknown): boolean {
  if (error instanceof GeminiHttpError) return error.status >= 500;
  return true;
}

/**
 * The model for the next key attempt after `failed` threw. An overload switches
 * to the other model in the plan (and opens the primary-overloaded window); a
 * fallback that rejects the request is skipped for a while; a key problem (429,
 * 401/403, invalid key) keeps the same model for the next key.
 */
function selectNextModelAttempt(
  plan: GeminiModelAttempt[],
  failed: GeminiModelAttempt,
  error: unknown,
): GeminiModelAttempt {
  const other = plan.find((candidate) => candidate !== failed);
  if (!other) return failed;

  const fallbackRejected =
    failed.isFallback &&
    error instanceof GeminiHttpError &&
    (error.status === 404 || (error.status === 400 && !isGeminiInvalidKeyError(error.message)));
  if (fallbackRejected) {
    fallbackRejectedUntil = Date.now() + FALLBACK_REJECTED_WINDOW_MS;
    console.warn("[google-ai-client] fallback model rejected the request", failed.model, error.status);
    return other;
  }

  if (!isModelOverloadError(error)) return failed;
  if (!failed.isFallback) primaryOverloadedUntil = Date.now() + PRIMARY_OVERLOAD_WINDOW_MS;
  return other;
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

/**
 * Gemini reports a bad/expired API key as HTTP 400 (reason API_KEY_INVALID),
 * the same status it uses for a malformed request. Only the former is a
 * key-health problem, so tell them apart by the error body.
 */
export function isGeminiInvalidKeyError(message: string): boolean {
  return /API_KEY_INVALID|API key not valid|API key expired/i.test(message);
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

async function callGeminiOnce(
  secret: string,
  input: GeminiGenerateInput,
  attempt: GeminiModelAttempt,
): Promise<string> {
  const { model, thinkingLevel } = attempt;
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(secret)}`;

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
  const plan = buildModelPlan(input);
  let attempt = plan[0];

  for (const key of attemptKeys) {
    try {
      const text = await callGeminiOnce(key.secret, input, attempt);
      // Fire-and-forget: the success stamp is telemetry (counters/lastUsedAt),
      // not selection-critical state, so the interactive turn shouldn't pay its
      // DB round-trip. Error marks below stay awaited — they gate key selection.
      void markGeminiKeySuccess(key.keyRef).catch(() => undefined);
      if (attempt.isFallback) {
        console.warn("[google-ai-client] served by fallback model", attempt.model);
      }
      return { text, keyRef: key.keyRef, model: attempt.model };
    } catch (error) {
      lastError = error;
      const failedAttempt = attempt;
      attempt = selectNextModelAttempt(plan, failedAttempt, error);

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
        if (
          error.status === 401 ||
          error.status === 403 ||
          (error.status === 400 && isGeminiInvalidKeyError(error.message))
        ) {
          // Invalid / revoked / unauthorized key — stop using it until fixed.
          await markGeminiKeyDisabled(key.keyRef, error.message);
          continue;
        }
        if ((error.status === 400 || error.status === 404) && failedAttempt.isFallback) {
          // The fallback model rejected the request (retired id, unsupported
          // thinking level): not a key problem — go on with the primary model.
          continue;
        }
        if (error.status === 400 || error.status === 404) {
          // Malformed request (bad image, unsupported option, prompt too large)
          // or unknown model: every key would fail the same way and it is not a
          // key-health problem. Abort without touching key state — mirrors the
          // embedding path — so one bad request cannot disable the whole pool.
          throw new AllGeminiKeysExhaustedError(`GEMINI_REQUEST_ERROR:${error.message}`);
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
  const model = getGeminiEmbeddingModel();
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

async function embedKnowledgeContentOnce(secret: string, text: string): Promise<number[]> {
  const model = getGeminiKnowledgeEmbeddingModel();
  // gemini-embedding-2 does not accept the legacy taskType field. Callers add
  // the documented task prefix to the text instead (question-answering for a
  // query; title/text structure for a document).
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
        `GEMINI_KNOWLEDGE_EMBED_HTTP_${response.status}:${errorBody}`,
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
      void markGeminiKeySuccess(key.keyRef).catch(() => undefined);
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

/**
 * Embeds Knowledge RAG documents/queries with gemini-embedding-2. Kept as a
 * separate public function so product search cannot accidentally migrate away
 * from gemini-embedding-001 or compare vectors across incompatible spaces.
 */
export async function generateGeminiKnowledgeEmbedding(texts: string[]): Promise<number[][]> {
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
        const vector = await embedKnowledgeContentOnce(key.secret, text);
        if (vector.length !== GEMINI_EMBEDDING_DIMENSIONS) {
          throw new Error(`KNOWLEDGE_EMBED_DIM_MISMATCH:${vector.length}`);
        }
        vectors.push(vector);
      }
      void markGeminiKeySuccess(key.keyRef).catch(() => undefined);
      return vectors;
    } catch (error) {
      lastError = error;
      if (error instanceof GeminiHttpError) {
        // A model/request-shape error applies to every key; rotating secrets only
        // burns quota and can incorrectly disable healthy keys.
        if (error.status === 400 || error.status === 404) {
          throw new AllGeminiKeysExhaustedError(
            `GEMINI_KNOWLEDGE_EMBED_REQUEST_ERROR:${error.message}`,
          );
        }
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
        if (error.status === 401 || error.status === 403) {
          await markGeminiKeyDisabled(key.keyRef, error.message);
          continue;
        }
      }
      await markGeminiKeyTransientError(
        key.keyRef,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  throw new AllGeminiKeysExhaustedError(
    `ALL_GEMINI_KNOWLEDGE_EMBED_KEYS_FAILED:${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
