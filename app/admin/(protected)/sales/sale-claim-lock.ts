/**
 * Sale edit rules while warranty claims exist on the sale.
 *
 * A sale line whose warranties carry any claim is LOCKED as a whole row: it must
 * come back from the form unchanged (product, unit, qty, price, list price /
 * discount, warranty days, supplier, lots, extra detail — only its position may
 * move). While any claim exists on the sale, the sale date and customer are locked
 * too. Other lines can still be edited, removed or added; VAT may change.
 *
 * The server (updateSale) and the edit page both use these helpers, so the
 * refusal message and the form's disabled reason never drift apart.
 */

/** Thrown inside the sale transaction when a claim appeared after the pre-check. */
export class SaleClaimLockError extends Error {}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

export type ClaimedSaleLine = {
  saleItemId: string;
  productName: string;
  claimNos: string[];
};

/** A stored sale line in the shape the lock comparison needs (quantities in base units). */
export type StoredSaleLine = {
  productId: string;
  quantity: number;
  showQty: number | null;
  showUnitName: string | null;
  salePrice: number;
  unitListPrice: number;
  warrantyDays: number;
  supplierId: string | null;
  supplierName: string | null;
  moreDetail: string | null;
  lots: { lotNo: string; qty: number }[];
};

/** A line as submitted by the form (quantities in the selected unit). */
export type IncomingSaleLine = {
  productId: string;
  unitName: string;
  qty: number;
  salePrice: number;
  unitListPrice: number;
  warrantyDays: number;
  supplierId?: string;
  supplierName?: string;
  moreDetail?: string;
  lotItems: { lotNo: string; qty: number }[];
};

function lotKeys(lots: { lotNo: string; qty: number }[], scale: number): string {
  return lots
    .map((lot) => `${lot.lotNo.trim()}|${round4(lot.qty * scale)}`)
    .sort()
    .join("//");
}

/**
 * True when the submitted line reproduces the stored line exactly. `scale` is the
 * base-unit scale of the submitted unit. The line discount is derived by the
 * server from list price − net price × qty, so matching those three matches it.
 * Legacy rows stored unitListPrice 0; the edit form shows max(list, net) for them.
 */
export function isSaleLineUnchanged(stored: StoredSaleLine, incoming: IncomingSaleLine, scale: number): boolean {
  const storedListPrice = Math.max(stored.unitListPrice, stored.salePrice);
  return (
    incoming.productId === stored.productId &&
    (stored.showUnitName === null || incoming.unitName === stored.showUnitName) &&
    round4(incoming.qty * scale) === round4(stored.quantity) &&
    (stored.showQty === null || round4(incoming.qty) === round4(stored.showQty)) &&
    round2(incoming.salePrice) === round2(stored.salePrice) &&
    round2(incoming.unitListPrice) === round2(storedListPrice) &&
    incoming.warrantyDays === stored.warrantyDays &&
    (incoming.supplierId || null) === stored.supplierId &&
    (incoming.supplierName || null) === stored.supplierName &&
    (incoming.moreDetail || null) === (stored.moreDetail || null) &&
    lotKeys(incoming.lotItems, scale) === lotKeys(stored.lots, 1)
  );
}

export type LockedLineMatch = {
  /** incoming index → locked saleItemId */
  matchedByNewIdx: Map<number, string>;
  /** locked lines that no submitted line reproduces */
  violations: ClaimedSaleLine[];
};

/** Pairs every locked line with one identical submitted line (each used at most once). */
export function matchLockedSaleLines(
  locked: Array<ClaimedSaleLine & { stored: StoredSaleLine }>,
  incoming: IncomingSaleLine[],
  scaleOf: (line: IncomingSaleLine) => number,
): LockedLineMatch {
  const matchedByNewIdx = new Map<number, string>();
  const violations: ClaimedSaleLine[] = [];
  for (const line of locked) {
    const newIdx = incoming.findIndex(
      (candidate, idx) => !matchedByNewIdx.has(idx) && isSaleLineUnchanged(line.stored, candidate, scaleOf(candidate)),
    );
    if (newIdx === -1) {
      violations.push({ saleItemId: line.saleItemId, productName: line.productName, claimNos: line.claimNos });
    } else {
      matchedByNewIdx.set(newIdx, line.saleItemId);
    }
  }
  return { matchedByNewIdx, violations };
}

export function buildLockedLineError(violations: ClaimedSaleLine[]): string | null {
  if (violations.length === 0) return null;
  const lines = violations.map(
    (line) => `"${line.productName}" (ใบเคลม ${line.claimNos.join(", ")})`,
  );
  return `ไม่สามารถแก้ไขหรือลบรายการ ${lines.join(", ")} ได้ เนื่องจากมีใบเคลมอ้างอิงอยู่ — รายการนี้ต้องคงเดิมทั้งแถว (สินค้า หน่วย จำนวน ราคา ส่วนลด ประกัน ซัพพลายเออร์ Lot และรายละเอียด)`;
}

export function buildClaimLockedDateReason(claimNos: string[]): string {
  return `ไม่สามารถเปลี่ยนวันที่ขายได้ เนื่องจากมีใบเคลมอ้างอิงรายการในใบขายนี้: ${claimNos.join(", ")}`;
}

export function buildClaimLockedCustomerReason(claimNos: string[]): string {
  return `ไม่สามารถเปลี่ยนลูกค้าได้ เนื่องจากมีใบเคลมอ้างอิงรายการในใบขายนี้: ${claimNos.join(", ")}`;
}

export function buildClaimLockedRowReason(claimNos: string[]): string {
  return `ล็อกตามใบเคลม ${claimNos.join(", ")} — แก้ไขหรือลบรายการนี้ไม่ได้`;
}

export function buildConcurrentClaimError(claimNos: string[]): string {
  return `มีการเปิดใบเคลมใหม่ระหว่างแก้ไข (${claimNos.join(", ")}) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง`;
}

/** Groups claims (from `warrantyClaim.findMany` on the sale) by the sale line they hold. */
export function groupClaimNosBySaleItem(
  claims: Array<{ claimNo: string; warranty: { saleItemId: string | null } }>,
): Map<string, string[]> {
  const bySaleItem = new Map<string, string[]>();
  for (const claim of claims) {
    const saleItemId = claim.warranty.saleItemId;
    if (!saleItemId) continue;
    const list = bySaleItem.get(saleItemId) ?? [];
    list.push(claim.claimNo);
    bySaleItem.set(saleItemId, list);
  }
  for (const list of bySaleItem.values()) list.sort();
  return bySaleItem;
}
