// Pure helpers shared by the lot report pages (balance / expiry / slow-moving).
// Kept free of DB imports so they can be unit-tested directly.

export type LotKey = { productId: string; lotNo: string };

export type LotKeyFilter = { productId: string; lotNo: { in: string[] } };

export type LotExpiryStatus = "ok" | "expiring" | "expired" | "no-exp";

const DAY_MS = 86_400_000;
const EXPIRING_WITHIN_DAYS = 30;

// Upper bound on (productId, lotNo) keys per `OR` query so a large lot table
// never produces a statement with an unbounded number of bind parameters.
export const LOT_KEY_CHUNK_SIZE = 1000;

export function lotKeyOf(key: LotKey): string {
  return `${key.productId}:${key.lotNo}`;
}

/**
 * Collapse (productId, lotNo) pairs into one `{ productId, lotNo: { in } }`
 * filter per product. Matches exactly the same rows as `OR: keys` but with far
 * fewer OR branches when a product has several lots.
 */
export function groupLotKeysByProduct(keys: LotKey[]): LotKeyFilter[] {
  const byProduct = new Map<string, Set<string>>();
  for (const key of keys) {
    const lots = byProduct.get(key.productId);
    if (lots) lots.add(key.lotNo);
    else byProduct.set(key.productId, new Set([key.lotNo]));
  }
  return [...byProduct.entries()].map(([productId, lots]) => ({
    productId,
    lotNo: { in: [...lots] },
  }));
}

export function chunkLotKeys<T>(keys: T[], size: number = LOT_KEY_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < keys.length; i += size) {
    chunks.push(keys.slice(i, i + size));
  }
  return chunks;
}

/**
 * Lot status used by the Lot Balance report. `startOfExpDay` is the Thailand
 * start-of-day of the lot's expiry date (or null when the lot has no EXP).
 * Same arithmetic the page used inline before it was extracted.
 */
export function classifyLotExpiry(
  startOfExpDay: Date | null,
  today: Date,
): { daysUntil: number | null; status: LotExpiryStatus } {
  if (!startOfExpDay) return { daysUntil: null, status: "no-exp" };
  const daysUntil = Math.ceil((startOfExpDay.getTime() - today.getTime()) / DAY_MS);
  if (daysUntil < 0) return { daysUntil, status: "expired" };
  if (daysUntil <= EXPIRING_WITHIN_DAYS) return { daysUntil, status: "expiring" };
  return { daysUntil, status: "ok" };
}

/** Oldest expiry first; ties broken by productId then lotNo so paging is stable. */
export function compareLotsByExpiry(
  a: LotKey & { expDate: Date },
  b: LotKey & { expDate: Date },
): number {
  const diff = a.expDate.getTime() - b.expDate.getTime();
  if (diff !== 0) return diff;
  if (a.productId !== b.productId) return a.productId < b.productId ? -1 : 1;
  if (a.lotNo !== b.lotNo) return a.lotNo < b.lotNo ? -1 : 1;
  return 0;
}

export function pageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice((page - 1) * pageSize, page * pageSize);
}
