# Document Update — Differential Stock Refresh

## Status
- Active (2026-05-26)
- Applies to: `updatePurchase`, `updateSale`, `updatePurchaseReturn`
- Not yet applied to: `updateCreditNote`

## Context
- หน้าฟอร์มแก้ไขเอกสาร (`/admin/purchases/[id]/edit`, `/admin/sales/[id]/edit`) เดิมทำงานแบบ "delete-then-recreate" คือเวลา save:
  - reverse lot balance ของทุก item
  - ลบ StockCard ทุก row ของใบนั้น
  - ลบ Item ทุกแถว (สำหรับ sale ลบ warranty ก่อนเพราะมี FK)
  - `recalculateStockCard()` ของทุก product ที่เคยอยู่ในใบ
  - สร้าง Item + StockCard + Lot (+ Warranty สำหรับ sale) ใหม่ทั้งหมด
- พฤติกรรมจริงของผู้ใช้คือกด "บันทึก" ซ้ำหลายครั้งระหว่างคีย์ข้อมูล (form ไม่ redirect ออกหลัง save) ทำให้ทุกครั้งที่กด ทุก item ของใบถูก recalc แม้ไม่มีอะไรเปลี่ยน

## Decision
- ใช้ **differential refresh** เป็น default โดยมี **fallback** ไป full reset เดิมเมื่อจำเป็น
- Greedy multiset matching ระหว่าง item เก่ากับใหม่ → ได้ `removed`, `added`, `matched`
- เส้นทาง differential แตะเฉพาะ item ที่เปลี่ยน:
  - reverse lot balance + delete StockCard + delete Item เฉพาะ removed
  - `recalculateStockCard()` เฉพาะ product ที่ถูกแตะ (`removed ∪ added`)
  - create เฉพาะ added
  - matched items: ปล่อยไว้ (ไม่แตะ StockCard / lot ledger / warranty)
  - sync field ที่ derive จาก header บน matched items ก็ต่อเมื่อ header เปลี่ยน

### Purchase signature (base-unit)
`productId | qtyInBase | costPerBase | sorted lots(lotNo|qtyInBase|unitCostBase|mfg|exp)`

- Helper: `buildItemStockSignature()` ใน `purchases/actions.ts`
- Header-derived sync บน matched items: `supplierId`, `subtotalAmount` (เมื่อ supplier / vatType / vatRate เปลี่ยน)
- Fallback ถูกบังคับเมื่อ:
  - `purchaseDate` เปลี่ยน → `docDate` ของทุก StockCard row ต้องเปลี่ยน
  - `shippingFee` / `discount` เปลี่ยน หรือ `totalLineValue` เปลี่ยนขณะที่มี landed allocation > 0 → landed allocation กระจายข้าม item ทำให้ทุก line cost เปลี่ยน

### Sale signature (base-unit)
`productId | qtyInBase | salePrice | warrantyDays | supplierId | supplierName | sorted lots(lotNo|qtyInBase)`

- Helper: `buildSaleItemSignature()` ใน `sales/actions.ts`
- ไม่ใส่ `costPrice` ใน signature เพราะ matched item เก็บ historical avgCost ที่ถูก lock ตอนสร้างเดิมไว้ — recreating จะทำให้ค่าเปลี่ยนตาม MAVG ปัจจุบัน
- Header-derived sync บน matched items: `subtotalAmount` (เมื่อ vatType / vatRate เปลี่ยน)
- Warranty row ของ matched item ถูกคงไว้ทั้งหมด (saleItemId ยังอยู่)
- Fallback ถูกบังคับเมื่อ:
  - `saleDate` เปลี่ยน → `docDate` ของทุก StockCard row ต้องเปลี่ยน
- **ไม่มี landed cost allocation** → `shippingFee` / `discount` เปลี่ยนไม่กระทบ per-line cost ของ sale → ไม่ trigger fallback

### Purchase Return signature (base-unit)
`productId | qtyInBase | costPerBase | sorted lots(lotNo|qtyInBase)`

- Helper: `buildPurchaseReturnItemSignature()` ใน `purchase-returns/actions.ts`
- Lot ของ purchase-return เก็บแค่ `lotNo` + `qty` (ไม่มี unitCost/mfg/exp) → lot portion ของ signature ง่ายกว่า purchase
- `costPerBase` resolve ด้วย logic เดียวกับ `buildLineData`: `item.costPrice / scale` ถ้ามี, ไม่งั้น fallback ไป product avgCost (tracked) หรือ costPrice
- Header-derived sync บน matched items: `subtotalAmount` (เมื่อ vatType / vatRate เปลี่ยน)
- Fallback ถูกบังคับเมื่อ:
  - `returnDate` เปลี่ยน → docDate ของทุก StockCard row ต้องเปลี่ยน
  - `type` เปลี่ยน (RETURN ↔ DEBIT) → stock effect toggle ทั้งใบ (RETURN เขียน StockCard, DEBIT ไม่เขียน)
  - `purchaseId` เปลี่ยน → `buildPurchaseReferenceCostMap()` เปลี่ยน → priceIn ของ `RETURN_OUT` ทุก row ต้องเปลี่ยน
- `claimId` เปลี่ยนไม่ต้อง fallback — claim stock movement (`SUPPLIER_CREDIT_SETTLE`) เป็น per-document ทำงานทั้ง 2 paths
- กรณี DEBIT ทั้งเก่าและใหม่ → ไม่มี StockCard work เลย แต่ differential ยังช่วยลด delete/recreate ของ `PurchaseReturnItem` rows

## Impact
- Manual save UX (2026-05-26): purchase and sale add/edit forms now stay on the current form after a successful save instead of redirecting to the listing page. A first save from the new form returns the created document id (`purchaseId` / `saleId`), updates the browser URL to the edit route with `history.replaceState`, and subsequent saves in the same form call `updatePurchase` / `updateSale`. This keeps repeated user saves on the differential update path and avoids creating duplicate documents.
- Client draft autosave (2026-05-26): purchase and sale forms keep unsaved draft state only in `localStorage`, scoped by `purchase-draft:new`, `purchase-draft:edit:<id>`, `sale-draft:new`, and `sale-draft:edit:<id>`. Draft save/restore does not call server actions and does not affect stock, lot ledger, cash-bank, AR/AP, profit facts, or audit logs until the user explicitly presses the save button.
- MAVG correctness ไม่เปลี่ยน — ทุกครั้งที่มี item ถูกแตะ ระบบจะเรียก `recalculateStockCard()` ของ product นั้นเหมือนเดิม
- Performance gain ตามกรณีหลักของผู้ใช้:
  - กดบันทึกซ้ำโดยไม่แก้อะไร → 0 stockcard work
  - แก้เฉพาะ header (note / customer / shippingAddress / ฯลฯ) → 0 stockcard work
  - แก้ 1 item โดยไม่ trigger fallback → recalc 1 product
  - เปลี่ยนวันที่เอกสาร หรือ (purchase) shipping/discount → กลับเข้าสู่ logic เดิม (ปลอดภัย)
- Reference chain check / AR-AP / audit log / cash-bank movement / profit facts ใช้ logic เดิมทั้งหมด
- Sale: `recalculateSaleAmountRemain`, `replaceCashBankSourceMovements`, `rebuildSaleProfitFacts` ยังถูกเรียกหลัง diff path เหมือนเดิม

## Out of Scope
- ยังไม่ apply กับ:
  - `updateCreditNote`
- ถ้าจะขยายไปโมดูลอื่นต้องเปิด task แยก เพราะแต่ละโมดูลมี nuance ต่างกัน (lot direction, AR/AP clearing, reference cost, neutral stock-in)

## Source of Truth
- Purchase: `app/admin/(protected)/purchases/actions.ts` → `updatePurchase`, `buildItemStockSignature()`
- Sale: `app/admin/(protected)/sales/actions.ts` → `updateSale`, `buildSaleItemSignature()`
- Purchase Return: `app/admin/(protected)/purchase-returns/actions.ts` → `updatePurchaseReturn`, `buildPurchaseReturnItemSignature()`
- MAVG engine: `lib/stock-card.ts` (`recalculateStockCard`, `writeStockCard`)
- Lot ledger: `lib/lot-control.ts` (`reverseSaleLotBalance`, `reversePurchaseLotBalance`, `reversePurchaseReturnLotBalance`, `writeSaleLots`, `writePurchaseLots`, `writePurchaseReturnLots`)
