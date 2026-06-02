import {
  getRequiredShopeeConfig,
  type ShopeeConfig,
} from "@/lib/shopee/config";
import {
  buildPublicQuery,
  buildShopQuery,
  toQueryRecord,
} from "@/lib/shopee/signature";
import {
  ShopeeApiError,
  SHOPEE_RETRYABLE_ERROR_CODES,
  type ShopeeResponse,
} from "@/lib/shopee/types";

/**
 * Shopee Open Platform HTTP client.
 *
 * Responsibilities (single, narrow): sign requests, enforce timeout, retry safe
 * idempotent reads with backoff, and map every failure to a typed
 * `ShopeeApiError`. It performs NO business logic and touches NO existing
 * tables — higher layers (services) own that.
 *
 * Security: never logs `partner_key`, `access_token`, `sign`, or raw payloads.
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 400;

export type ShopeeRequestOptions = {
  /** HTTP method. Shopee uses GET for reads and POST for writes/most calls. */
  method?: "GET" | "POST";
  /** Extra query params (besides the signed common params). */
  query?: Record<string, string | number | undefined>;
  /** JSON body for POST requests. */
  body?: Record<string, unknown>;
  timeoutMs?: number;
  maxAttempts?: number;
  /** AbortSignal from the caller (e.g. route handler) to cancel early. */
  signal?: AbortSignal;
};

export type ShopeeShopAuth = {
  accessToken: string;
  shopId: number;
};

function backoffDelay(attempt: number): number {
  // attempt is 1-based; exponential with small jitter
  const expo = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return expo + Math.floor(Math.random() * 150);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendQuery(
  url: URL,
  query: Record<string, string | number | undefined> | undefined,
): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
}

export class ShopeeClient {
  private readonly config: ShopeeConfig;

  constructor(config?: ShopeeConfig) {
    this.config = config ?? getRequiredShopeeConfig();
  }

  /** Call a PUBLIC (unauthenticated) endpoint such as token exchange/refresh. */
  async callPublic<TResponse>(
    apiPath: string,
    options: ShopeeRequestOptions = {},
  ): Promise<TResponse> {
    const common = buildPublicQuery(
      this.config.partnerId,
      apiPath,
      this.config.partnerKey,
    );
    return this.execute<TResponse>(apiPath, toQueryRecord(common), options);
  }

  /** Call a SHOP-scoped authenticated endpoint (orders, items, logistics, …). */
  async callShop<TResponse>(
    apiPath: string,
    auth: ShopeeShopAuth,
    options: ShopeeRequestOptions = {},
  ): Promise<TResponse> {
    const common = buildShopQuery(
      this.config.partnerId,
      apiPath,
      this.config.partnerKey,
      auth.accessToken,
      auth.shopId,
    );
    return this.execute<TResponse>(apiPath, toQueryRecord(common), options);
  }

  private async execute<TResponse>(
    apiPath: string,
    signedQuery: Record<string, string>,
    options: ShopeeRequestOptions,
  ): Promise<TResponse> {
    const method = options.method ?? "POST";
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxAttempts = options.maxAttempts ?? (method === "GET" ? DEFAULT_MAX_ATTEMPTS : 1);

    let lastError: ShopeeApiError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.attempt<TResponse>(apiPath, signedQuery, method, timeoutMs, options);
      } catch (error) {
        const apiError =
          error instanceof ShopeeApiError
            ? error
            : new ShopeeApiError({
                kind: "network",
                apiPath,
                message: "Shopee request failed",
              });
        lastError = apiError;

        const retryable = this.isRetryable(apiError);
        if (!retryable || attempt === maxAttempts) {
          throw apiError;
        }
        await sleep(backoffDelay(attempt));
      }
    }

    // Unreachable, but satisfies the type checker.
    throw lastError ?? new ShopeeApiError({ kind: "network", apiPath, message: "Shopee request failed" });
  }

  private async attempt<TResponse>(
    apiPath: string,
    signedQuery: Record<string, string>,
    method: "GET" | "POST",
    timeoutMs: number,
    options: ShopeeRequestOptions,
  ): Promise<TResponse> {
    const url = new URL(apiPath, this.config.host);
    for (const [key, value] of Object.entries(signedQuery)) {
      url.searchParams.set(key, value);
    }
    appendQuery(url, options.query);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    let httpStatus: number | undefined;
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
      httpStatus = response.status;

      const rawText = await response.text();
      let parsed: ShopeeResponse<TResponse>;
      try {
        parsed = JSON.parse(rawText) as ShopeeResponse<TResponse>;
      } catch {
        throw new ShopeeApiError({
          kind: "parse",
          apiPath,
          httpStatus,
          message: "Shopee response was not valid JSON",
        });
      }

      if (!response.ok) {
        throw new ShopeeApiError({
          kind: "http",
          apiPath,
          httpStatus,
          shopeeError: parsed.error || undefined,
          requestId: parsed.request_id,
          message: `Shopee HTTP ${httpStatus}`,
        });
      }

      if (parsed.error && parsed.error.length > 0) {
        throw new ShopeeApiError({
          kind: "api",
          apiPath,
          httpStatus,
          shopeeError: parsed.error,
          requestId: parsed.request_id,
          message: parsed.message || `Shopee API error: ${parsed.error}`,
        });
      }

      return (parsed.response ?? ({} as TResponse));
    } catch (error) {
      if (error instanceof ShopeeApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ShopeeApiError({
          kind: "timeout",
          apiPath,
          httpStatus,
          message: `Shopee request timed out after ${timeoutMs}ms`,
        });
      }
      throw new ShopeeApiError({
        kind: "network",
        apiPath,
        httpStatus,
        message: "Shopee network request failed",
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private isRetryable(error: ShopeeApiError): boolean {
    if (error.kind === "network" || error.kind === "timeout") return true;
    if (error.kind === "http") {
      return error.httpStatus === undefined || error.httpStatus >= 500;
    }
    if (error.kind === "api" && error.shopeeError) {
      return SHOPEE_RETRYABLE_ERROR_CODES.has(error.shopeeError);
    }
    return false;
  }
}

/** Convenience factory using env-based config. Throws if not configured. */
export function createShopeeClient(): ShopeeClient {
  return new ShopeeClient();
}
