export type ShopeeEscrowFeeKind = "COMMISSION" | "SERVICE" | "VOUCHER";

export type ShopeeEscrowFeeLine = {
  kind: ShopeeEscrowFeeKind;
  label: string;
  amount: number;
  sourceKey: string;
};

const FEE_KEY_GROUPS: Record<ShopeeEscrowFeeKind, string[]> = {
  COMMISSION: ["commission_fee", "commissionFee", "commission"],
  SERVICE: ["service_fee", "serviceFee", "service_fee_amount"],
  VOUCHER: [
    "voucher_from_seller",
    "seller_voucher",
    "sellerVoucher",
    "voucher_seller",
    "seller_coin_cashback",
    "seller_discount",
  ],
};

const FEE_LABELS: Record<ShopeeEscrowFeeKind, string> = {
  COMMISSION: "Shopee commission fee",
  SERVICE: "Shopee service fee",
  VOUCHER: "Shopee seller voucher",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.abs(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.abs(parsed);
  }
  return 0;
}

function pickFeeLines(source: Record<string, unknown>): ShopeeEscrowFeeLine[] {
  const lines: ShopeeEscrowFeeLine[] = [];
  for (const [kind, keys] of Object.entries(FEE_KEY_GROUPS) as Array<[ShopeeEscrowFeeKind, string[]]>) {
    for (const key of keys) {
      if (!(key in source)) continue;
      const amount = toAmount(source[key]);
      if (amount <= 0) continue;
      lines.push({ kind, label: FEE_LABELS[kind], amount, sourceKey: key });
      break;
    }
  }
  return lines;
}

function findEscrowObject(rawPayload: unknown): Record<string, unknown> | null {
  if (!isPlainObject(rawPayload)) return null;

  const directEscrow = rawPayload.escrow_detail ?? rawPayload.escrowDetail;
  if (isPlainObject(directEscrow)) return directEscrow;

  const directLines = pickFeeLines(rawPayload);
  if (directLines.length > 0) return rawPayload;

  for (const value of Object.values(rawPayload)) {
    if (isPlainObject(value)) {
      const found = findEscrowObject(value);
      if (found) return found;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findEscrowObject(item);
        if (found) return found;
      }
    }
  }

  return null;
}

export function extractShopeeEscrowFeeLines(rawPayload: unknown): ShopeeEscrowFeeLine[] {
  const escrow = findEscrowObject(rawPayload);
  if (!escrow) return [];
  return pickFeeLines(escrow);
}
