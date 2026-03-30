# ศรีวรรณ อะไหล่แอร์ — Project Plan

## Overview
ร้านขายอะไหล่แอร์และหม้อน้ำรถยนต์ ชื่อร้าน **ศรีวรรณ อะไหล่แอร์**
- LINE OA: `@435adwz` | Link: `https://lin.ee/18P0SqG`
- เว็บไซต์มี 2 ส่วน: **หน้าร้าน (public)** และ **หลังบ้าน (admin)**

## Tech Stack
- Framework: Next.js 15+ (App Router)
- Language: TypeScript (strict mode)
- Styling: Tailwind CSS + Shadcn UI (Radix)
- Icons: Lucide React
- Validation: Zod
- ORM: Prisma v7
- Database: PostgreSQL (Supabase)
- Auth: NextAuth.js v5
- Deploy: Vercel
- Storage: Supabase Storage (รูปสินค้า)

## Folder Structure
```
/app              → routes & layouts
/app/admin        → admin dashboard (protected)
/components/ui    → Shadcn atomic components
/components/shared → reusable business components (หน้าร้าน)
/lib              → server utilities, db client
/lib/db.ts        → Prisma singleton client
/hooks            → custom React hooks
/types            → shared TypeScript types
/prisma           → schema + migrations
```

## Database Models (ใน prisma/schema.prisma)
| Model | ใช้สำหรับ |
|---|---|
| User | Admin/Staff login |
| CarBrand / CarModel | ยี่ห้อ/รุ่นรถ |
| Category | หมวดหมู่สินค้า |
| Supplier | ซัพพลายเออร์ |
| Product | สินค้า (stock = system-managed, มี saleUnitName/purchaseUnitName/reportUnitName) |
| ProductUnit | หน่วยนับต่อสินค้า (isBase=true → scale=1, อื่นๆ scale=จำนวนหน่วยย่อย) |
| ProductAlias | ชื่อเรียกอื่นๆ สำหรับ search |
| ProductCarModel | สินค้า ↔ รุ่นรถ (many-to-many) |
| StockCard | บัตรสต็อกสินค้า — source of truth การเคลื่อนไหว stock (qty/price ใน base unit) |
| Purchase / PurchaseItem | ระบบซื้อสินค้าเข้า |
| PurchaseReturn / PurchaseReturnItem | คืนสินค้าให้ซัพพลายเออร์ (RETURN_OUT) |
| Customer | ข้อมูลลูกค้า (รหัส, ชื่อ, เบอร์, ที่อยู่, เลขภาษี, ที่อยู่จัดส่ง) |
| Sale / SaleItem | ระบบขาย (saleType: RETAIL/WHOLESALE, paymentType: CASH/CREDIT, fulfillmentType: PICKUP/DELIVERY) |
| CreditNote / CreditNoteItem | CN ฝั่งขาย — settlementType: CASH_REFUND/CREDIT_DEBT |
| Adjustment / AdjustmentItem | ปรับสต็อก +/- พร้อมเหตุผล |
| Warranty | ประกันสินค้า (เริ่มนับจากวันขาย) |
| Expense | ค่าใช้จ่ายอื่นๆ (schema พร้อม, UI ยังไม่ได้ทำ) |
| SiteContent | Admin แก้ไขข้อความหน้าเว็บ + company settings + VAT config |

---

## Phases

### ✅ Phase 0 — หน้าร้าน (เสร็จแล้ว)
- Navbar, Hero, ProductCategories, WhyUs, FeaturedProducts, LineCTA, Footer
- FloatingLine button (LINE OA)
- Font: Kanit (heading) + Sarabun (body)
- Social links: Facebook, TikTok, Shopee, Lazada (show/hide toggle)

### ✅ Phase 1 — Setup DB + Deploy (เสร็จแล้ว)
- ติดตั้ง Prisma v7 + สร้าง schema ครบทุกระบบ
- เชื่อมต่อ Supabase PostgreSQL (Session pooler port 5432)
- Deploy บน Vercel + domain sriwanparts.com ✓

### ✅ Phase 2 — Admin Auth + สินค้า (เสร็จแล้ว)
- NextAuth.js v5 (Credentials provider) + Login page + Middleware
- Admin layout + Sidebar navigation (reorganized: สินค้า+ลูกค้า อยู่ใต้ ข้อมูลหลัก)
- Dashboard (summary cards)
- CRUD สินค้า (list, create, edit, delete) + Upload รูป Supabase Storage
- Multi-unit (ProductUnit + scale)
- Master data: Category, CarBrand/CarModel, Supplier, PartsBrand
- Security headers (CSP, HSTS, X-Frame-Options ฯลฯ)

### ✅ Phase 2.5 — ระบบลูกค้า (เสร็จแล้ว)
- CRUD ลูกค้า: list (พร้อม search), create, edit, delete (ป้องกันลบถ้ามียอดขาย)
- หน้าโปรไฟล์ลูกค้า: ข้อมูล + สถิติ (ยอดซื้อรวม, จำนวนครั้ง) + ประวัติการซื้อ
- ที่อยู่จัดส่ง (shippingAddress) แยกจากที่อยู่ปกติ
- เชื่อม Sale ↔ Customer: ใบขายเลือกลูกค้าจากระบบ + auto-fill ชื่อ/เบอร์/ที่อยู่จัดส่ง

### ✅ Phase 3 — Stock + ซื้อ + ขาย + เอกสาร (เสร็จแล้ว)

#### ✅ 3.0 โครงสร้าง DB + MAVG Engine
- StockCard เป็น source of truth — qty/price ใน base unit ทั้งหมด
- avgCost (Moving Average Cost) เก็บใน Product + StockCard.priceBalance
- `lib/stock-card.ts` — MAVG engine (`writeStockCard`)
- `lib/doc-number.ts` — document number generator
- `lib/vat.ts` — VAT calculation utility (calcVat, calcItemSubtotal)

#### ✅ 3.1 ระบบ BF (ยอดยกมา)
- หน้า `/admin/stock/bf` — บันทึกยอดสินค้าเริ่มต้น เลือกหน่วย+จำนวน+ต้นทุน

#### ✅ 3.2 ปรับสต็อก (Adjustment)
- หน้า `/admin/stock/adjustments` — ปรับ +/- หลายรายการพร้อมเหตุผล

#### ✅ 3.3 ระบบซื้อสินค้า
- `/admin/purchases` — ใบซื้อ + MAVG + VAT (NoVAT/ExclVAT/InclVAT) + referenceNo + auto-fill ราคาทุน
- `/admin/purchase-returns` — คืนให้ซัพพลายเออร์ (RETURN_OUT) + VAT

#### ✅ 3.4 ระบบขาย
- `/admin/sales` — บันทึกการขาย + SaleType (ปลีก/ส่ง) + PaymentType (ขายสด/ขายเชื่อ) + FulfillmentType (หน้าร้าน/จัดส่ง) + VAT
- `/admin/sales/[id]` — รายละเอียด + พิมพ์ใบเสร็จ (browser print)

#### ✅ 3.5 Credit Note (CN ฝั่งขาย)
- `/admin/credit-notes` — CN type: รับคืนสินค้า/ส่วนลด/อื่นๆ + SettlementType: คืนเงินสด/ตั้งหนี้ + RefundMethod: เงินสด/โอนเงิน + VAT

#### ✅ 3.6 Stock Card MAVG Viewer
- `/admin/stock/card` — บัตรสต็อกรายสินค้า เลือกหน่วยแสดงได้

#### ✅ 3.7 VAT System
- VatType enum: NO_VAT / EXCLUDING_VAT / INCLUDING_VAT
- ครอบคลุม: ซื้อ, คืนซัพพลายเออร์, ขาย, CN — คำนวณ subtotalAmount + vatAmount realtime
- ตั้งค่า VAT default ได้ที่ `/admin/settings/company`

#### ✅ 3.8 โมดูลใบเสร็จรับเงิน / Accounts Receivable (เสร็จแล้ว)
- [x] บันทึกการรับชำระสำหรับการขายเชื่อ (Sale.paymentType=CREDIT_SALE)
- [x] CN ประเภทตั้งหนี้ (settlementType=CREDIT_DEBT) — บันทึกลดยอดหนี้
- [x] เก็บยอดลูกหนี้ค้างชำระต่อลูกค้า (Accounts Receivable)
- [x] พิมพ์ใบเสร็จรับเงิน (browser print)
- [x] แสดงยอดค้างชำระในหน้า Customer profile

#### ✅ 3.9 Search ทุก Transaction + ประวัติเอกสาร (เสร็จแล้ว)
- [x] Sales: SearchBar + filter paymentType
- [x] Purchases: SearchBar
- [x] Purchase Returns: SearchBar
- [x] Credit Notes: SearchBar
- [x] Receipts: SearchBar
- [x] BF: แสดงประวัติเอกสาร (BalanceForward model)
- [x] Adjustment: แสดงประวัติเอกสาร + CancelDocButton

#### ✅ 3.10 ระบบยกเลิกเอกสาร (Document Cancellation) (เสร็จแล้ว)
- [x] Schema: `enum DocStatus { ACTIVE CANCELLED }` + status/cancelledAt/cancelNote ใน Adjustment, Purchase, Sale, CreditNote, PurchaseReturn, Receipt
- [x] Schema: model `BalanceForward` (BF header tracking)
- [x] `lib/stock-card.ts`: `recalculateStockCard(tx, productId)` + fix backdating bug ใน `writeStockCard`
- [x] `cancelBF` — ลบ StockCard + recalculate + mark CANCELLED
- [x] `cancelAdjustment` — ลบ StockCard + recalculate + mark CANCELLED
- [x] `cancelPurchase` — ตรวจ PurchaseReturn reference + ลบ StockCard + recalculate
- [x] `cancelPurchaseReturn` — ลบ StockCard + recalculate
- [x] `cancelSale` — ตรวจ CN + Receipt reference + ลบ StockCard + reverse AR
- [x] `cancelCreditNote` — ลบ StockCard (ถ้า RETURN) + mark CANCELLED
- [x] `cancelReceipt` — reverse AR + mark CANCELLED
- [x] `CancelDocButton` shared component + status badge (ใช้งาน/ยกเลิกแล้ว) ทุก list page
- [x] Stock Card: เพิ่ม column มูลค่าคงเหลือ + ปุ่ม Re-calculate All

#### ✅ 3.11 Tab Navigation + Loading UX (เสร็จแล้ว)
- [x] `components/shared/TabsBar.tsx` — Zustand-based tab bar, เปิด tab ต่อเมนู, scroll, X-to-close
- [x] Tabs persist ใน sessionStorage, ล้างตอน logout
- [x] Sub-routes normalize เป็น parent tab (/sales/new → /sales)
- [x] `loading.tsx` ครบทุก route segment ใน `/admin/(protected)/` (20+ ไฟล์)

### ✅ Phase 4 — ประกัน + ค่าใช้จ่าย (เสร็จแล้ว)
- [x] ระบบประกัน (`/admin/warranties`) — เริ่มนับจากวันที่ขาย, แสดงสถานะ/หมดประกัน
- [x] ระบบค่าใช้จ่าย (`/admin/expenses`) — บันทึกตาม category + VAT (NoVAT/ExclVAT/InclVAT)

### ✅ Phase 4.1 — Edit ทุก Transaction + amountRemain Fix (เสร็จแล้ว)
- [x] Edit pages ครบ 6 ประเภท: purchases, purchase-returns, sales, credit-notes, receipts, expenses
- [x] ปุ่ม View (Eye) + Edit (Pencil) ทุก list page
- [x] amountRemain fix: CASH_SALE → 0 เสมอ, CN CREDIT_DEBT หักออกจาก AR, recalculate check paymentType
- [x] Logo upload (Supabase Storage) แทน URL input ในหน้าตั้งค่าร้านค้า
- [x] หลังบันทึก/แก้ไข redirect กลับหน้า list อัตโนมัติ
- [x] Product search dropdown fix: portal + fixed positioning (ไม่ถูก clip โดย overflow-x-auto)

### 🔲 Phase 4.2 — ระบบจัดส่ง / Delivery Queue (ยังไม่ได้ทำ)

> **ที่มา:** ออกแบบจาก session 2026-03-30
> **หลักการ:** reuse `fulfillmentType = DELIVERY` + `paymentType = CREDIT_SALE` ที่มีอยู่แล้ว
> ไม่มี COD Amount field แยก — ใช้ AR flow เดิมในการติดตามยอดค้างชำระ

#### ข้อตกลงที่ผ่านการตัดสินใจแล้ว

| ประเด็น | ข้อตกลง |
|---|---|
| COD tracking | ใช้ `paymentType = CREDIT_SALE + fulfillmentType = DELIVERY` — ไม่เพิ่ม codAmount |
| AR ปนกัน | แก้ด้วย filter แยก: CREDIT_SALE+PICKUP = หนี้จริง / CREDIT_SALE+DELIVERY = COD รอส่ง |
| สถานะจัดส่ง | enum `ShippingStatus { PENDING, OUT_FOR_DELIVERY, DELIVERED }` |
| ขนส่ง | field `shippingMethod` (SELF/KERRY/FLASH/JT/OTHER) + `trackingNo` (สำหรับขนส่งเอกชน) |

---

#### Phase 4.2-A — Schema

- [ ] เพิ่ม enum `ShippingStatus { PENDING OUT_FOR_DELIVERY DELIVERED }` ใน `schema.prisma`
- [ ] เพิ่ม enum `ShippingMethod { NONE SELF KERRY FLASH JT OTHER }` ใน `schema.prisma`
- [ ] เพิ่ม field ใน `Sale`:
  ```prisma
  shippingStatus  ShippingStatus  @default(PENDING)
  shippingMethod  ShippingMethod  @default(NONE)
  trackingNo      String?
  ```
- [ ] `prisma db push`

---

#### Phase 4.2-B — ใบขาย (SaleForm) ปรับ UI

- [ ] เมื่อเลือก `fulfillmentType = DELIVERY` → แสดง field เพิ่ม:
  - ที่อยู่จัดส่ง (auto-fill จาก `Customer.shippingAddress`)
  - ค่าส่ง (`shippingFee` — มีอยู่แล้ว)
  - ประเภทขนส่ง (`shippingMethod` dropdown)
  - **ไม่มีเลข Tracking ตรงนี้** — กรอกได้ที่หน้า Delivery Queue เมื่อส่งของแล้ว
- [ ] เมื่อเลือก `CREDIT_SALE + DELIVERY` → แสดง note เตือน: "ยอดค้างชำระจะเปิด AR — บันทึก Receipt เมื่อได้รับเงิน"
- [ ] ใบขาย detail page: แสดงสถานะจัดส่ง + tracking no

---

#### Phase 4.2-C — หน้า list ใบขาย ปรับ

- [ ] เพิ่ม filter tab: **"รอจัดส่ง"** (`fulfillmentType = DELIVERY AND shippingStatus = PENDING`)
- [ ] เพิ่ม column: สถานะจัดส่ง (badge รอส่ง / กำลังส่ง / ส่งแล้ว) แสดงเฉพาะแถว DELIVERY
- [ ] เพิ่ม column: ยอด COD (แสดงเฉพาะ CREDIT_SALE + DELIVERY)

---

#### Phase 4.2-D — หน้า Delivery Queue (ใหม่)

- [ ] Route: `/admin/delivery`
- [ ] แสดงรายการใบขาย `fulfillmentType = DELIVERY + shippingStatus IN [PENDING, OUT_FOR_DELIVERY]`
- [ ] เรียงตามวันที่ / กลุ่มตามสถานะ
- [ ] ข้อมูลต่อแถว: ลูกค้า, ที่อยู่จัดส่ง, ยอดเงิน, สถานะชำระ (จ่ายแล้ว / เก็บปลายทาง + ยอด), tracking no
- [ ] ปุ่มอัปเดตสถานะ: "ออกส่ง" → `OUT_FOR_DELIVERY` / "ส่งแล้ว" → `DELIVERED`
- [ ] กรอก **เลข Tracking** และ **ประเภทขนส่ง** ได้ที่นี่ (inline edit) — เพราะตอนสร้างใบขายยังไม่รู้เลข Tracking
- [ ] ปุ่ม Print ใบวางบิล / ใบเสร็จต่อรายการ

---

#### Phase 4.2-E — Print Slip สำหรับจัดส่ง

- [ ] ใบแต่ละใบแสดง: ชื่อ/ที่อยู่ลูกค้า, รายการสินค้า, ยอดรวม + ค่าส่ง
- [ ] Footer: **"ชำระแล้ว"** (Pre-paid) หรือ **"กรุณาชำระ ฿X,XXX"** (COD)
- [ ] Print รวมหลายใบในครั้งเดียว (สำหรับออกรถ)

---

#### Phase 4.2-F — AR Dashboard แยก COD

- [ ] แก้ card "ลูกหนี้ค้างชำระ" แยกเป็น 2 ส่วน:
  - ลูกหนี้ทั่วไป: `CREDIT_SALE + PICKUP`
  - COD รอรับเงิน: `CREDIT_SALE + DELIVERY + shippingStatus != DELIVERED`

---

### 🔲 Phase 5 — ระบบค้นหา (ยังไม่ได้ทำ)
- [ ] Full-text search สินค้า (ค้นได้จากชื่อ, โค้ด, alias, ยี่ห้อรถ, รุ่นรถ)
- [ ] ค้นหาจากหน้าร้าน (ลูกค้าใช้)
- [ ] ค้นหาจากหลังบ้าน (admin ใช้)

### 🔲 Phase 5.5 — ระบบ Lot Control (ยังไม่ได้ทำ)

> **ที่มา:** ออกแบบจากไฟล์ `lot_flow_aircon_spare_parts.docx` + sessions การตัดสินใจ 2026-03-27
> **หลักการ:** "ครอบระบบเดิม" — สินค้าที่ไม่ใช้ Lot ต้องทำงานเหมือนเดิม 100%

#### ข้อตกลงที่ผ่านการตัดสินใจแล้ว (ห้ามเปลี่ยนโดยไม่ปรึกษา)

| ประเด็น | ข้อตกลง |
|---|---|
| ต้นทุน | **ใช้ Lot unitCost แยกต่างหาก** — ไม่ใช้ MAVG รวม ตอนขายออกให้ใช้ต้นทุนของ Lot นั้นๆ |
| recalculate | ยกเลิกเอกสารต้อง reverse ทั้ง StockCard + LotBalance พร้อมกันใน `$transaction` เดียว |
| Manual Allocation | ใช้ **Auto Allocate เป็น default** ตาม `lotIssueMethod` / user แก้ไขได้แต่ต้องกรอกเหตุผล / แสดง warning ถ้าไม่ตรง FIFO-FEFO / บันทึก log ว่าใครเปลี่ยน |
| สต็อกเก่า | ไม่มีปัญหา — จะ restore DB ใหม่ก่อนเปิดใช้จริง |
| Lot validation | ต้องมีทั้ง stock รวม และ LotBalance เพียงพอจึงจะขายได้ |
| PurchaseReturn | ต้องอ้างอิง Lot เดิมตามใบซื้อเสมอ — reverse LotBalance ตาม Lot ที่รับเข้ามา |
| CreditNote (รับคืน) | **Default = Merge กลับ LotBalance เดิม** / มี option "คืนแยก Lot" สำหรับของที่ไม่แน่ใจสภาพ (prefix `RET-{lotNo}`) |

#### โมดูลที่ข้ามเลย (ไม่มีในระบบ)
- Purchase Order, Transfer Warehouse, Sales Order / Reserve Lot, Barcode/QR Scan

---

#### Phase 5.5-A — Product Master + Schema ใหม่

**เพิ่ม field ใน `Product`:**
```prisma
isLotControl       Boolean  @default(false)
requireExpiryDate  Boolean  @default(false)
lotIssueMethod     LotIssueMethod @default(FIFO)
allowExpiredIssue  Boolean  @default(false)
```

**ตาราง enum ใหม่:**
```prisma
enum LotIssueMethod { FIFO FEFO MANUAL }
```

**ตารางใหม่:**
```prisma
model ProductLot          // ข้อมูล Lot: lotNo, productId, mfgDate, expDate, unitCost, purchaseItemId
model LotBalance           // คงเหลือราย Lot: productId + lotNo (unique), qtyOnHand
model StockMovementLot     // movement ราย Lot ผูกกับ StockCard: stockCardId, lotNo, qtyIn, qtyOut
model PurchaseItemLot      // sub-rows ของบรรทัดใบซื้อ: purchaseItemId, lotNo, qty, unitCost
model SaleItemLot          // sub-rows ของบรรทัดใบขาย: saleItemId, lotNo, qty, unitCost (snapshot)
model PurchaseReturnItemLot // sub-rows ใบคืนซัพพลายเออร์ อ้างอิง Lot เดิม
model CreditNoteItemLot    // sub-rows CN รับคืนจากลูกค้า: isReturnLot (flag สร้าง RET- lot ใหม่)
```

**Index บังคับ:**
- `@@unique([productId, lotNo])` ใน `LotBalance`
- `@@index([productId, expDate])` ใน `ProductLot` (สำหรับ FEFO + expiry report)
- `@@index([stockCardId])` ใน `StockMovementLot`

- [ ] เพิ่ม field ใน Product schema
- [ ] สร้างตารางใหม่ทั้งหมด
- [ ] `prisma db push`
- [ ] เพิ่ม UI ตั้งค่า Lot ในหน้าแก้ไขสินค้า

---

#### Phase 5.5-B — ใบซื้อ รองรับแตก Lot

**Logic:**
1. เลือกสินค้าที่ `isLotControl = true` → แสดง sub-table ด้านล่างบรรทัด
2. กรอก: Lot No, Qty, MFG Date (optional), EXP Date (required ถ้า `requireExpiryDate = true`), Unit Cost
3. **Validate:** `sum(lot.qty) === item.qty` — ห้ามบันทึกถ้าไม่ตรง
4. บันทึก: สร้าง `PurchaseItemLot` + upsert `LotBalance` + สร้าง `ProductLot` (ถ้า lot ใหม่) + `StockMovementLot`
5. ต้นทุน StockCard ใช้ weighted average ของ Lot ทั้งหมดในบรรทัด (เพื่อความ compatible กับ MAVG เดิม)

**UX:**
- Sub-table แบบ inline expandable (ไม่ popup)
- ปุ่ม "+ เพิ่ม Lot" ใต้บรรทัดสินค้า
- แสดง progress bar "Lot รวม X / Y ชิ้น" แบบ realtime
- สีแดงถ้า Lot qty ไม่ตรงกับบรรทัด

- [ ] UI ฟอร์มใบซื้อ + sub-table Lot
- [ ] Validation logic
- [ ] Server Action: บันทึก + LotBalance upsert

---

#### Phase 5.5-C — ใบขาย เลือก / Auto-allocate Lot

**Logic:**
1. บรรทัดสินค้า `isLotControl = true` → แสดงปุ่ม "เลือก Lot"
2. **Auto Allocate** ทำตาม `lotIssueMethod`:
   - `FIFO` = เรียง `mfgDate ASC` (เก่าก่อน)
   - `FEFO` = เรียง `expDate ASC` (ใกล้หมดอายุก่อน)
   - `MANUAL` = ผู้ใช้เลือกเองทั้งหมด
3. แสดง Lot ที่มีคงเหลือ + วันหมดอายุ + สีเตือน:
   - 🟡 เหลือ ≤ 30 วัน
   - 🔴 หมดอายุแล้ว (block ถ้า `allowExpiredIssue = false`)
4. รองรับ 1 บรรทัดตัดจากหลาย Lot
5. Manual override: กรอกเหตุผล + บันทึก log
6. **Validate:** LotBalance เพียงพอทุก Lot ที่เลือก
7. บันทึก: สร้าง `SaleItemLot` (snapshot unitCost ณ วันขาย) + ลด `LotBalance` + `StockMovementLot`

**UX:**
- Popup / expandable panel เลือก Lot ใต้บรรทัด
- ปุ่ม "Auto จัดสรร" กด 1 ครั้งเสร็จ
- แสดงสรุปว่า allocate Lot ไหนเท่าไหร่

- [ ] UI ฟอร์มใบขาย + Lot panel
- [ ] Auto allocate engine (FIFO/FEFO/MANUAL)
- [ ] Server Action: บันทึก + LotBalance deduct

---

#### Phase 5.5-D — ยกเลิกเอกสาร Reverse Lot

**กฎเหล็ก:** ยกเลิกต้อง reverse ทั้ง StockCard + LotBalance ใน `$transaction` เดียวเสมอ

| เอกสาร | Reverse Logic |
|---|---|
| ยกเลิกใบซื้อ | อ่าน `PurchaseItemLot` → ลด `LotBalance` กลับ → ลบ `StockMovementLot` → recalculate |
| ยกเลิกใบขาย | อ่าน `SaleItemLot` → คืน `LotBalance` กลับ → ลบ `StockMovementLot` → recalculate |
| ยกเลิกใบคืนซัพพลายเออร์ | อ่าน `PurchaseReturnItemLot` → คืน `LotBalance` ตาม Lot เดิม |
| ยกเลิก CN (รับคืนจากลูกค้า) | ถ้า merge → ลด `LotBalance` กลับ / ถ้า RET-lot → ลบ LotBalance ของ RET-lot ทิ้ง |

- [ ] แก้ `cancelPurchase` รองรับ Lot
- [ ] แก้ `cancelSale` รองรับ Lot
- [ ] แก้ `cancelPurchaseReturn` รองรับ Lot
- [ ] แก้ `cancelCreditNote` รองรับ Lot

---

#### Phase 5.5-E — รายงาน Lot

- [ ] **Lot Balance** — คงเหลือราย Lot ทุกสินค้า (filter by product / expiry status)
- [ ] **Lot Trace** — เลือก Lot No → ดูว่ารับจากใบซื้อใด + ขายให้ใครบ้าง
- [ ] **Expiry Report** — Lot ที่หมดอายุแล้ว / เหลือ ≤ 30 วัน / ≤ 90 วัน
- [ ] **Slow Moving Lot** — Lot ที่ไม่มี movement เกิน X วัน

---

### 🔲 Phase 6 — Report (ยังไม่ได้ทำ)
- [ ] Report สรุปยอดขาย (รายวัน/สัปดาห์/เดือน)
- [ ] Report กำไร-ขาดทุน (รวม VAT breakdown)
- [ ] Report stock คงเหลือ + สินค้าต่ำกว่า minStock
- [ ] Report ประกันที่กำลังจะหมด
- [ ] Export Excel / PDF

### 🔲 Phase 7 — SEO + AEO (ยังไม่ได้ทำ)
**เป้าหมาย:** ติดอันดับ Google + ขึ้นใน AI search (ChatGPT, Perplexity, Google AI Overview)

**SEO พื้นฐาน:**
- [ ] Next.js Metadata API — title, description, canonical URL ทุกหน้า
- [ ] Open Graph + Twitter Card (แชร์ใน social ได้สวย)
- [ ] `sitemap.xml` — dynamic (ครอบคลุมหน้าสินค้าทุกชิ้น)
- [ ] `robots.txt`
- [ ] Core Web Vitals — ปรับ loading speed, image optimization
- [ ] URL structure — `/products/[category]/[slug]` อ่านง่าย

**Structured Data (Schema.org JSON-LD):**
- [ ] `LocalBusiness` — ชื่อร้าน, ที่อยู่, เบอร์, เวลาทำการ
- [ ] `Product` — ชื่อสินค้า, ราคา, รูป, คำอธิบาย, ยี่ห้อ
- [ ] `BreadcrumbList` — navigation path
- [ ] `FAQPage` — คำถามที่พบบ่อย
- [ ] `Organization` — ข้อมูลองค์กร/ร้านค้า

**AEO — ให้ AI search อ้างอิงได้:**
- [ ] หน้า `/about` — แนะนำร้าน, ประวัติ, ความเชี่ยวชาญ (E-E-A-T)
- [ ] หน้า `/faq` — คำถามที่ลูกค้าถามบ่อย
- [ ] หน้า `/blog` หรือ `/knowledge` — บทความให้ความรู้เรื่องอะไหล่แอร์
- [ ] `llms.txt` — ไฟล์แนะนำร้านสำหรับ AI crawlers

---

## Environment Variables ที่ต้องมี
ดูตัวอย่างได้ที่ `.env.example`

| Variable | ใช้สำหรับ |
|---|---|
| `DATABASE_URL` | Supabase Session pooler (port 5432) |
| `DIRECT_URL` | Supabase direct (สำหรับ migrate) |
| `NEXTAUTH_SECRET` | NextAuth encryption key |
| `NEXTAUTH_URL` | URL ของเว็บ (เปลี่ยนเป็น production URL หลัง deploy) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

## คำสั่งที่ใช้บ่อย
```bash
# Sync schema กับ database
npx prisma db push

# Generate Prisma client หลังแก้ schema
npx prisma generate

# ดู database ผ่าน UI
npx prisma studio

# Dev server
npm run dev

# Build ตรวจสอบ error
npm run build

# Backup / Restore ข้อมูล
npm run db:backup
npm run db:restore backup-{timestamp}.json
```

## หมายเหตุสำคัญ
- ใช้ **Prisma db push** (ไม่ใช่ migrate dev) เพราะ Supabase Transaction pooler ไม่รองรับ shadow database
- `lib/generated/prisma` อยู่ใน `.gitignore` → ต้องรัน `prisma generate` หลัง clone repo ใหม่
- Admin user แรกต้องสร้างผ่าน seed script (Phase 2)
