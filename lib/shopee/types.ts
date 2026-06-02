/**
 * Shopee Open Platform — shared API types.
 *
 * Only the envelope + Phase A/C (auth) payloads live here. Per-domain response
 * types (orders, items, logistics) are added in their own phases to keep this
 * file focused and avoid speculative shapes.
 */

/**
 * Every Shopee v2 response carries these envelope fields. `error` is an empty
 * string on success; a non-empty `error` code means the call failed.
 */
export type ShopeeResponseEnvelope = {
  error: string;
  message: string;
  request_id?: string;
  warning?: string;
};

/** Generic successful response = envelope + a typed `response` payload. */
export type ShopeeResponse<TResponse> = ShopeeResponseEnvelope & {
  response?: TResponse;
};

/** Auth scope returned during shop authorization. */
export type ShopeeAuthScope = "shop" | "merchant";

/** Payload of POST /api/v2/auth/token/get (authorization code → tokens). */
export type ShopeeTokenGetResponse = {
  access_token: string;
  refresh_token: string;
  /** Access token lifetime in seconds. */
  expire_in: number;
  /** Present for shop-level authorization. */
  shop_id_list?: number[];
  /** Present for merchant-level authorization. */
  merchant_id_list?: number[];
};

/** Payload of POST /api/v2/auth/access_token/get (refresh_token → new tokens). */
export type ShopeeRefreshTokenResponse = {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  shop_id?: number;
  merchant_id?: number;
  partner_id?: number;
};

/**
 * Normalized error thrown by the Shopee client. `kind` lets callers decide
 * whether to retry, alert, or surface a generic Thai message to the UI.
 */
export type ShopeeErrorKind =
  | "config" // missing/invalid credentials
  | "network" // fetch failed / DNS / connection reset
  | "timeout" // request exceeded timeout budget
  | "http" // non-2xx HTTP status
  | "api" // 2xx but envelope.error is non-empty
  | "parse"; // body was not valid JSON

export class ShopeeApiError extends Error {
  readonly kind: ShopeeErrorKind;
  readonly apiPath: string;
  readonly httpStatus?: number;
  readonly shopeeError?: string;
  readonly requestId?: string;

  constructor(params: {
    kind: ShopeeErrorKind;
    apiPath: string;
    message: string;
    httpStatus?: number;
    shopeeError?: string;
    requestId?: string;
  }) {
    super(params.message);
    this.name = "ShopeeApiError";
    this.kind = params.kind;
    this.apiPath = params.apiPath;
    this.httpStatus = params.httpStatus;
    this.shopeeError = params.shopeeError;
    this.requestId = params.requestId;
  }
}

/** Shopee `error` codes that are safe/sensible to retry. */
export const SHOPEE_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "error_server",
  "error_busy",
  "error_inner",
]);
