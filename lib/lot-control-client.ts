// Client-safe lot control types and pure functions (no DB imports)

export interface LotSubRow {
  lotNo:      string;
  qty:        number;  // ใน selected unit
  unitCost:   number;  // ต้นทุน/selected unit
  mfgDate:    string;  // ISO date string หรือ ""
  expDate:    string;  // ISO date string หรือ ""
}

// Used server-side (Date objects)
export interface LotAvailable {
  lotNo:     string;
  qtyOnHand: number;
  unitCost:  number;
  expDate:   Date | null;
  mfgDate:   Date | null;
}

// Used client-side (JSON-serializable — Date becomes string via server action)
export interface LotAvailableJSON {
  lotNo:     string;
  qtyOnHand: number;
  unitCost:  number;
  expDate:   string | null;
  mfgDate:   string | null;
}

/**
 * Validate lot sub-rows สำหรับ product ที่ isLotControl=true
 * - sum(lot.qty) ต้องเท่ากับ itemQty
 * - lotNo ต้องไม่ว่าง
 * - ถ้า requireExpiryDate=true → expDate บังคับ
 */
export function validateLotRows(
  lots: LotSubRow[],
  itemQty: number,
  requireExpiryDate: boolean
): string | null {
  if (lots.length === 0) return "กรุณาระบุ Lot อย่างน้อย 1 รายการ";

  for (const lot of lots) {
    if (!lot.lotNo.trim()) return "กรุณากรอกเลขที่ Lot";
    if (lot.qty <= 0) return "จำนวน Lot ต้องมากกว่า 0";
    if (requireExpiryDate && !lot.expDate) return `Lot ${lot.lotNo}: กรุณากรอกวันหมดอายุ (EXP)`;
  }

  const lotNos = lots.map((l) => l.lotNo.trim());
  if (new Set(lotNos).size !== lotNos.length) return "เลขที่ Lot ซ้ำกัน";

  const totalLotQty = lots.reduce((s, l) => s + l.qty, 0);
  const diff = Math.abs(totalLotQty - itemQty);
  if (diff > 0.0001) {
    return `จำนวน Lot รวม (${totalLotQty}) ไม่ตรงกับจำนวนในบรรทัด (${itemQty})`;
  }

  return null;
}

/**
 * Auto-allocate Lot ตาม FIFO/FEFO
 * รับ LotAvailableJSON (string dates จาก server action) คืน LotSubRow[]
 */
export function autoAllocateLots(
  available: LotAvailableJSON[],
  qtyNeeded: number,
  scale: number  // base unit scale ของ selected unit
): LotSubRow[] {
  const result: LotSubRow[] = [];
  let remaining = qtyNeeded;

  for (const lot of available) {
    if (remaining <= 0) break;
    const availQtyInUnit = lot.qtyOnHand / scale;
    const allocated = Math.min(availQtyInUnit, remaining);
    result.push({
      lotNo:    lot.lotNo,
      qty:      Math.round(allocated * 10000) / 10000,
      unitCost: lot.unitCost * scale,
      mfgDate:  lot.mfgDate ? lot.mfgDate.slice(0, 10) : "",
      expDate:  lot.expDate ? lot.expDate.slice(0, 10) : "",
    });
    remaining -= allocated;
  }

  return result;
}
