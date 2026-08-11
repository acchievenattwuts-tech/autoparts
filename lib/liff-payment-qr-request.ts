export type LiffPaymentQrRequest =
  | { mode: "total" }
  | { mode: "selected"; saleIds: string[] };

const MAX_SELECTED_BILLS = 50;

export function parseLiffPaymentQrRequest(value: unknown): LiffPaymentQrRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;

  if (body.mode === "total") return { mode: "total" };
  if (body.mode !== "selected" || !Array.isArray(body.saleIds)) return null;

  const saleIds = Array.from(
    new Set(
      body.saleIds
        .filter((saleId): saleId is string => typeof saleId === "string")
        .map((saleId) => saleId.trim())
        .filter(Boolean),
    ),
  );

  if (saleIds.length === 0 || saleIds.length > MAX_SELECTED_BILLS) return null;
  return { mode: "selected", saleIds };
}
