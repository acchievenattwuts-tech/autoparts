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
- หน้า `/admin/stock/bf` — บันทึกยอดสินค้าเริ่มต้น เลือกหน่วย+จำนวน+ต้นทุน + รองรับ Lot Control (Phase 5.5-I1)

#### ✅ 3.2 ปรับสต็อก (Adjustment)
- หน้า `/admin/stock/adjustments` — ปรับ +/- หลายรายการพร้อมเหตุผล + รองรับ Lot Control (Phase 5.5-I2: IN=manual input, OUT=dropdown)

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

### ✅ Phase 4.2 — ระบบจัดส่ง / Delivery Queue (เสร็จแล้ว — ยกเว้น 4.2-F)

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

- [x] เพิ่ม enum `ShippingStatus { PENDING OUT_FOR_DELIVERY DELIVERED }` ใน `schema.prisma`
- [x] เพิ่ม enum `ShippingMethod { NONE SELF KERRY FLASH JT OTHER }` ใน `schema.prisma`
- [x] เพิ่ม field ใน `Sale`:
  ```prisma
  shippingStatus  ShippingStatus  @default(PENDING)
  shippingMethod  ShippingMethod  @default(NONE)
  trackingNo      String?
  ```
- [x] `prisma db push`

---

#### Phase 4.2-B — ใบขาย (SaleForm) ปรับ UI

- [x] เมื่อเลือก `fulfillmentType = DELIVERY` → แสดง field เพิ่ม:
  - ที่อยู่จัดส่ง (auto-fill จาก `Customer.shippingAddress`)
  - ค่าส่ง (`shippingFee` — มีอยู่แล้ว)
  - ประเภทขนส่ง (`shippingMethod` dropdown)
  - **ไม่มีเลข Tracking ตรงนี้** — กรอกได้ที่หน้า Delivery Queue เมื่อส่งของแล้ว
- [x] เมื่อเลือก `CREDIT_SALE + DELIVERY` → แสดง note เตือน: "ยอดค้างชำระจะเปิด AR — บันทึก Receipt เมื่อได้รับเงิน"
- [x] ใบขาย detail page: แสดงสถานะจัดส่ง + tracking no

---

#### Phase 4.2-C — หน้า list ใบขาย ปรับ

- [x] เพิ่ม filter tab: **"รอจัดส่ง"** (`fulfillmentType = DELIVERY AND shippingStatus = PENDING`)
- [x] เพิ่ม column: สถานะจัดส่ง (badge รอส่ง / กำลังส่ง / ส่งแล้ว) แสดงเฉพาะแถว DELIVERY
- [x] เพิ่ม column: ยอด COD (แสดงเฉพาะ CREDIT_SALE + DELIVERY)

---

#### Phase 4.2-D — หน้า Delivery Queue (ใหม่)

- [x] Route: `/admin/delivery`
- [x] แสดงรายการใบขาย `fulfillmentType = DELIVERY + shippingStatus IN [PENDING, OUT_FOR_DELIVERY]`
- [x] เรียงตามวันที่ / กลุ่มตามสถานะ
- [x] ข้อมูลต่อแถว: ลูกค้า, ที่อยู่จัดส่ง, ยอดเงิน, สถานะชำระ (จ่ายแล้ว / เก็บปลายทาง + ยอด), tracking no
- [x] ปุ่มอัปเดตสถานะ: "ออกส่ง" → `OUT_FOR_DELIVERY` / "ส่งแล้ว" → `DELIVERED`
- [x] กรอก **เลข Tracking** และ **ประเภทขนส่ง** ได้ที่นี่ (inline edit) — เพราะตอนสร้างใบขายยังไม่รู้เลข Tracking
- [x] ปุ่ม Print ใบวางบิล / ใบเสร็จต่อรายการ

---

#### Phase 4.2-E — Print Slip สำหรับจัดส่ง

- [x] ใบแต่ละใบแสดง: ชื่อ/ที่อยู่ลูกค้า, รายการสินค้า, ยอดรวม + ค่าส่ง
- [x] Footer: **"ชำระแล้ว"** (Pre-paid) หรือ **"กรุณาชำระ ฿X,XXX"** (COD)
- [x] Print รวมหลายใบในครั้งเดียว (สำหรับออกรถ) — `/admin/delivery/print?ids=...` + ปุ่ม "Print ทั้งหมด" ใน Delivery Queue
- [x] **ใบแจ้งหนี้/ใบส่งของ (CREDIT_SALE)** — เมื่อกดพิมพ์เอกสารบนใบขายประเภท CREDIT_SALE:
  - หัวเอกสาร: **"ใบแจ้งหนี้/ใบส่งของ"** (แทน "ใบเสร็จรับเงิน")
  - แสดง: ชื่อลูกค้า + ที่อยู่จัดส่ง (`shippingAddress`) ด้านบน
  - รายการสินค้า, ยอดรวม, ค่าส่ง, ส่วนลด, ยอดสุทธิ — เหมือนฟอร์มขายสด
  - Footer เพิ่มช่องลงชื่อ 2 ช่อง:
    - **ผู้ส่งของ** ........................... วันที่ ...........
    - **ผู้รับของ** ........................... วันที่ ...........
  - ใช้ CSS `@media print` — ไม่ต้องสร้าง route ใหม่ แค่ toggle layout ตาม `paymentType`

---

#### Phase 4.2-F — AR Dashboard แยก COD

- [x] แก้ card "ลูกหนี้ค้างชำระ" แยกเป็น 2 cards:
  - ลูกหนี้ทั่วไป: `CREDIT_SALE + PICKUP`
  - COD รอรับเงิน: `CREDIT_SALE + DELIVERY + shippingStatus != DELIVERED`

---

### ✅ Phase 4.3 — Users + Roles + Permissions (เสร็จแล้ว — commit `307f9f4`)

> **หลักการ:** เพิ่มระบบสิทธิ์ใหม่แบบคู่ขนานกับ `User.role` เดิมก่อน เพื่อไม่ให้ flow ปัจจุบันหยุดทำงาน
> **รูปแบบสิทธิ์รอบแรก:** ระดับเมนู + action หลัก (`view`, `create`, `update`, `cancel`, `manage`)

#### Phase 4.3-A — Schema และ Permission Catalog

- [x] เพิ่ม model `AppRole`
- [x] เพิ่ม model `Permission`
- [x] เพิ่ม model `AppRolePermission`
- [x] เพิ่ม field ใน `User` — `appRoleId`, `mustChangePassword`
- [x] คง `User.role` เดิมไว้ชั่วคราวเพื่อ compatibility
- [x] นิยาม permission keys หลักตามเมนูงาน
- [x] `prisma db push` + `prisma generate`

#### Phase 4.3-B — Backend Foundations

- [x] helper `requirePermission()` แบบ fallback ให้ `ADMIN` เดิมผ่านได้
- [x] utility `ensureAccessControlSetup` — fast-path count check + `createMany` (ไม่ใช้ 89 upserts)
- [x] server actions สำหรับจัดการผู้ใช้
- [x] server actions สำหรับจัดการ roles / permissions
- [x] server action เปลี่ยนรหัสผ่านด้วยตัวเอง

#### Phase 4.3-C — User Management UI

- [x] หน้า `/admin/users`
- [x] หน้าเพิ่มผู้ใช้
- [x] หน้าแก้ไขผู้ใช้
- [x] เปิด/ปิดการใช้งานผู้ใช้
- [x] ผูกผู้ใช้กับ role ใหม่

#### Phase 4.3-D — Roles / Permissions UI

- [x] หน้า `/admin/roles`
- [x] หน้าแก้ role
- [x] ตารางสิทธิ์แบบ matrix
- [x] แยกตามเมนูหลักของระบบ
- [x] คัดลอกจาก role อื่น / preset มาตรฐาน / เปิด `view` อัตโนมัติ / ค้นหาเมนู

#### Phase 4.3-E — Change Password

- [x] หน้า `/admin/profile/change-password`
- [x] ตรวจรหัสผ่านเดิมก่อนเปลี่ยน + password policy
- [x] รองรับ `mustChangePassword`

#### Phase 4.3-F — Permission Matrix รอบแรก

- [x] ครอบคลุมทุกเมนูหลัก: Dashboard, สินค้า, ลูกค้า, ข้อมูลหลัก, BF, ปรับสต็อก, Stock Card, ซื้อ, CN ซื้อ, ขาย, CN ขาย, รับชำระ, ประกัน, ค่าใช้จ่าย, รายงาน, ตั้งค่าระบบ, ผู้ใช้และสิทธิ์

---

### ✅ Phase 4.4 — ระบบเคลมสินค้า (Warranty Claim) (เสร็จแล้ว — commit `37433b8`)

> **ที่มา:** ออกแบบจาก session 2026-03-30
> **หลักการ:** ติดตาม supplier ต้นทางต่อ SaleItem → สร้างใบเคลมส่งให้ supplier → จัดการ stock movement ตามผลลัพธ์
> **ทำ Phase A + B พร้อมกัน**

#### ข้อตกลงที่ผ่านการตัดสินใจแล้ว

| ประเด็น | ข้อตกลง |
|---|---|
| ระบุ Supplier | เพิ่ม `preferredSupplierId?` ใน `Product` (optional) / auto-fill ใน SaleItem ตอนสร้างใบขาย |
| Serial Number | ไม่ใช้ — ใช้ `unitSeq` (ลำดับที่ 1, 2, 3…) แทน แสดงใน Warranty card |
| ใบเคลม format | รายละเอียดมาตรฐานสากล (ชื่อสินค้า, เลขที่ warranty, อาการ, supplier, วันที่) |
| Phase A+B | ทำพร้อมกัน |

#### Phase 4.4-A — Schema

**เพิ่ม field ใน `Product`:**
```prisma
preferredSupplierId  String?
preferredSupplier    Supplier? @relation(fields: [preferredSupplierId], references: [id])
```

**เพิ่ม field ใน `SaleItem`:**
```prisma
supplierId   String?
supplierName String?   // snapshot ณ วันขาย
```

**เพิ่ม field ใน `Warranty`:**
```prisma
unitSeq  Int @default(1)   // ลำดับที่ของหน่วยภายใน SaleItem (1, 2, 3…)
```
> การสร้าง Warranty จาก SaleItem ที่มี qty=3 → สร้าง 3 rows (unitSeq 1, 2, 3)

**ตารางใหม่:**
```prisma
model WarrantyClaim {
  id            String              @id @default(cuid())
  claimNo       String              @unique   // format: WC{YYYYMMDD}{4-digit}
  warrantyId    String
  warranty      Warranty            @relation(...)
  claimDate     DateTime
  status        WarrantyClaimStatus @default(DRAFT)
  resolution    ClaimResolution?
  // Supplier ที่รับเคลม (snapshot ณ วันส่ง)
  supplierId    String?
  supplierName  String?
  supplierPhone String?
  supplierAddress String?
  note          String?
  resolvedAt    DateTime?
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  @@index([warrantyId])
  @@index([claimDate])
}

enum WarrantyClaimStatus {
  DRAFT              // บันทึกใบเคลม + รับของเสียจากลูกค้าแล้ว
  SENT_TO_SUPPLIER   // ส่งของเสียให้ supplier แล้ว
  CLOSED             // ปิดเคลม (รับกลับแล้ว หรือ supplier ปฏิเสธ) ยังไม่ใช่การส่งคืนลูกค้า
  RETURNED_TO_CUSTOMER // ส่งคืนลูกค้าแล้ว (ใช้เฉพาะ CUSTOMER_WAIT หลังปิดเคลม)
}

// option ที่เลือกตอนสร้างใบเคลม
enum ClaimType {
  REPLACE_NOW   // เปลี่ยนของใหม่ให้ลูกค้าทันที
  CUSTOMER_WAIT // ลูกค้ารอ — ส่งให้เมื่อได้รับจาก supplier
}

enum ClaimOutcome {
  RECEIVED      // supplier ส่งของกลับมาแล้ว
  NO_RESOLUTION // supplier ปฏิเสธเคลม
}
```

**Stock movement types ใหม่ (เพิ่มใน enum `StockMovementType`):**
```prisma
CLAIM_RETURN_IN    // ลูกค้าเอาของเสียกลับมาที่ร้าน (qtyIn)
CLAIM_SEND_OUT     // ส่งของเสียไปให้ supplier (qtyOut)
CLAIM_RECV_IN      // รับสินค้ากลับจาก supplier (qtyIn)
CLAIM_REPLACE_OUT  // ส่งสินค้าออกให้ลูกค้า (qtyOut)
```

**Stock flow ตาม ClaimType:**

| Stage | Movement | REPLACE_NOW (เปลี่ยนทันที) | CUSTOMER_WAIT (ลูกค้ารอ) |
|---|---|---|---|
| สร้างใบเคลม | `CLAIM_RETURN_IN` | +1 | +1 |
| สร้างใบเคลม | `CLAIM_REPLACE_OUT` | -1 (ให้ของใหม่ทันที) | — |
| ส่ง supplier | `CLAIM_SEND_OUT` | -1 | -1 |
| รับกลับ (RECEIVED) | `CLAIM_RECV_IN` | +1 (ขายใหม่ได้) | +1 |
| ส่งคืนลูกค้า | `CLAIM_REPLACE_OUT` | — | -1 (ส่งลูกค้าที่รอ) |
| **Net** | | **0** | **0** |

> `NO_RESOLUTION`: supplier ปฏิเสธ — ไม่มี `CLAIM_RECV_IN` / ร้านรับผลขาดทุน stock ของเสียยังติด +1 ให้ปรับออกทีหลังด้วยใบปรับสต็อก

- [x] เพิ่ม `preferredSupplierId` ใน `Product`
- [x] เพิ่ม `supplierId`, `supplierName` ใน `SaleItem`
- [x] เพิ่ม `unitSeq` ใน `Warranty`
- [x] สร้าง model `WarrantyClaim` พร้อม `claimType ClaimType`
- [x] เพิ่ม enum `ClaimType`, `ClaimOutcome`, `WarrantyClaimStatus` (incl. CANCELLED) และ 4 CLAIM_* sources ใน `StockCardSource`
- [x] `prisma db push` + `prisma generate`

---

#### Phase 4.4-B — ปรับหน้าสินค้า

- [x] เพิ่ม field `ผู้จำหน่ายหลัก (Preferred Supplier)` ใน `ProductForm` — SearchableSelect / ไม่บังคับ
- [x] บันทึก `preferredSupplierId` ผ่าน server action สินค้า

---

#### Phase 4.4-C — ปรับหน้าขายสินค้า

- [x] เพิ่ม column `supplierId` ต่อบรรทัดสินค้า — auto-fill จาก `product.preferredSupplierId` เมื่อเลือกสินค้า
- [x] ผู้ใช้แก้ไขได้ (override) — SearchableSelect supplier ใน line item
- [x] บันทึก `supplierId` + `supplierName` snapshot ลง `SaleItem`

---

#### Phase 4.4-D — ปรับระบบ Warranty (สร้างต่อหน่วย)

- [x] แก้ logic สร้าง Warranty หลังบันทึกใบขาย: ถ้า `warrantyDays > 0` และ `qty = N` → สร้าง N rows (`unitSeq` 1…N)
- [x] หน้า `/admin/warranties` แสดง unitSeq ต่อแถว + ปุ่มเคลม / แสดงจำนวนเคลม (ยกเว้น CANCELLED)
- [x] Search/filter ตาม warranty card ทำได้

---

#### Phase 4.4-E — ใบเคลมสินค้า (Claim Form)

- [x] หน้า `/admin/warranty-claims/new?warrantyId=...` — สร้างใบเคลมจาก warranty card
- [x] ข้อมูลที่กรอก: วันที่เคลม, อาการ/หมายเหตุ, ClaimType, supplier (auto-fill + แก้ได้), เบอร์โทร, ที่อยู่
- [x] บันทึก → DRAFT + StockCard (CLAIM_RETURN_IN ±CLAIM_REPLACE_OUT)
- [x] ส่งซัพพลายเออร์ → SENT_TO_SUPPLIER + CLAIM_SEND_OUT
- [x] ปิดเคลม → CLOSED + CLAIM_RECV_IN (ถ้า RECEIVED)
- [x] เพิ่มสถานะ RETURNED_TO_CUSTOMER สำหรับ CUSTOMER_WAIT → ตัด stock/lot ตอนส่งคืนลูกค้า ไม่ตัดตอนปิดเคลม
- [x] ย้อนกลับ CLOSED → SENT_TO_SUPPLIER (reverse CLAIM_RECV_IN + recalculate)
- [x] ย้อนกลับ RETURNED_TO_CUSTOMER → CLOSED (reverse CLAIM_REPLACE_OUT ของการส่งคืนลูกค้า)
- [x] ยกเลิกใบเคลม (CANCELLED) จากทุกสถานะ — ลบ StockCard ทั้งหมด + recalculate
- [x] แก้ไขรายละเอียด (symptom, note, supplier) ผ่าน `ClaimEditPanel`
- [x] หน้า list `/admin/warranty-claims` — filter status / วันที่ + summary cards (5 สถานะ)
- [x] Action buttons ต่อแถว: พิมพ์, ดู, แก้ไข, ยกเลิก (เหมือน sales)
- [x] `CancelDocButton` modal ยืนยัน + หมายเหตุ

---

#### Phase 4.4-F — ใบเคลม Print

- [x] Print template: เลขที่ใบเคลม, วันที่, ข้อมูลร้าน, ข้อมูล supplier, รายละเอียดสินค้า, unitSeq, อาการ, ลายเซ็น
- [x] Print page อยู่นอก `(protected)` layout — ไม่มี admin shell ติดมาตอนพิมพ์
- [x] `PrintFromListButton` (iframe) — พิมพ์จาก list โดยไม่ navigate ออก
- [x] Sync รูปแบบใบเคลมให้ยึด layout เดียวกับหน้าขายสินค้า (header/spacing/margins/signature ชิดล่าง) และตัดการแสดงชื่อ supplier ออกจากหน้าพิมพ์
- [x] เพิ่ม signer snapshot (`signerName`, `signerSignatureUrl`, `signedAt`) ใน `WarrantyClaim` และแสดงชื่อผู้บันทึก+ลายเซ็นในช่องผู้รับเคลมบนฟอร์มพิมพ์
- [x] ฟอร์มพิมพ์ใบเคลมแสดง `Lot No` ต้นทางของสินค้าที่ส่งเคลมจาก `warranty.lotNo`
- [x] หน้า detail ใบเคลมแสดง `Lot ที่รับกลับตอนปิดเคลม` จาก movement `CLAIM_RECV_IN` สำหรับสินค้าแบบ Lot

---

#### Phase 4.4 — Fixes & Polish (หลัง release)

- [x] `recalculateStockCard`: RETURN_IN, CLAIM_RETURN_IN, CLAIM_RECV_IN ใช้ `baPrice` แทน stored `priceIn` snapshot — MAVG neutral ไม่เพี้ยนแม้ประวัติก่อนหน้าเปลี่ยน
- [x] Stock card display: เพิ่ม label + badge สี สำหรับ CLAIM_* sources ทั้ง 4 ประเภท
- [x] TabsBar: เพิ่ม `/admin/warranty-claims` ใน ROUTE_LABELS
- [x] Delivery print: ย้ายออกนอก `(protected)` — fix onClick Server Component error

---

### ✅ Phase 5 — Search Performance Upgrade (หน้าบ้าน + หลังบ้าน) (เสร็จแล้ว)

> **เป้าหมาย:** ให้ลูกค้าและพนักงานค้นหาสินค้าได้เร็วที่สุดในระยะยาว โดยยังคงขอบเขตการค้นหาเดิม 100%
> **กฎเหล็ก:** ห้ามทำให้ field ที่ค้นหาได้เดิมหายไป, ห้ามทำให้ผลลัพธ์ผิด, และห้าม rollout แบบเสี่ยงกระทบระบบอื่นโดยไม่มี benchmark + fallback
> **ขอบเขตการค้นหาที่ต้องคงไว้:** `name`, `code`, `description`, `aliases`, `car brand`, `car model`, `category`, `parts brand`

> **สถานะปัจจุบัน:** Search V2 ถูก rollout แล้วสำหรับทั้ง storefront และ admin product search โดยใช้ search document บน PostgreSQL + trigram + full-text ranking, มี fallback กลับไปใช้ Prisma `contains` search เมื่อจำเป็น, และมี cache invalidation สำหรับข้อมูลที่ส่งผลต่อการค้นหาแล้ว

#### Phase 5-A — Audit + Benchmark + Safety Baseline
- [x] วัดและทบทวนพฤติกรรม search เดิมของทั้ง `/products` และ `/admin/products` ก่อน rollout
- [x] เก็บ safety baseline ของ query เดิมไว้ใน `lib/product-search.ts` ผ่าน legacy Prisma `contains` search เพื่อใช้เทียบและ fallback
- [x] ระบุ query เดิมที่ใช้ `contains` หลาย field ใน `lib/product-search.ts`
- [x] ระบุจุดเสี่ยงที่อาจกระทบระบบอื่น เช่น admin list, public filters, navbar/hero search, และ cache invalidation ของข้อมูล master
- [x] สรุป acceptance criteria ก่อนลงมือ:
  - เร็วขึ้นจริงทั้งหน้าบ้านและหลังบ้าน
  - เงื่อนไขค้นหาเดิมต้องครบ
  - ถ้าคำค้นเดิมเคยเจอ ต้องยังเจอ
  - ต้องมี fallback path ถ้า search engine ใหม่มีปัญหา

#### Phase 5-B — Database Search Architecture (Supabase/PostgreSQL)
- [x] ออกแบบ search engine ใหม่บน PostgreSQL โดยใช้ **Full-text search + trigram/partial match**
- [x] ออกแบบ search document ต่อสินค้าแบบรวมข้อมูลค้นหาทั้งหมดในตาราง `product_search_documents`
- [x] เพิ่ม index ที่จำเป็นให้ตรง field ที่ใช้งานจริง ทั้ง `search_document`, `search_text`, `product_code`, `product_name`, และ `is_active`
- [x] รองรับทั้งคำค้นทั่วไป, รหัสสินค้า, alias, รุ่นรถ, ยี่ห้อรถ, หมวดสินค้า, parts brand, และคำค้นบางส่วน
- [x] ออกแบบ ranking ให้ exact code / exact name / prefix match / full-text / similarity ทำงานร่วมกันโดยไม่ทำให้ exact match หาย
- [x] เขียน rollout plan แบบไม่กระทบระบบเดิม:
  - ใช้ engine ใหม่หลัง benchmark ผ่าน
  - เก็บ engine เดิมเป็น fallback ชั่วคราว
  - ทดสอบบน data จริงก่อนเปิดใช้เต็ม

#### Phase 5-C — Shared Search Service (ใช้ร่วมกันทั้งระบบ)
- [x] สร้าง search layer กลางใน `lib/product-search.ts` ให้ `/products/search` และ `/admin/products` ใช้ชุด logic เดียวกัน
- [x] แยก concerns ให้ชัด:
  - search engine = รับผิดชอบ query และ ranking
  - page layer = รับผิดชอบ filter, pagination, select fields, และ rendering
- [x] จำกัด select/payload ตามหน้าใช้งาน โดยให้ search layer คืนเฉพาะ ids + total แล้วค่อย select ข้อมูลที่แต่ละหน้าต้องใช้
- [x] Hero search, navbar search, และ search หน้าสินค้าถูกส่งเข้าสู่ flow `/products/search` เดียวกัน
- [x] Admin product search ได้ shared search engine เดียวกัน โดยยังคง permissions และฟังก์ชันเดิม

#### Phase 5-D — Verification + Rollout + Regression Protection
- [x] เทียบผลลัพธ์ engine ใหม่กับขอบเขตการค้นหาเดิมของร้าน และคง legacy fallback path ไว้ใน production
- [x] ทดสอบและครอบคลุมคำค้นกลุ่มสำคัญ:
  - ชื่อสินค้าเต็ม
  - รหัสสินค้า
  - alias
  - ยี่ห้อรถ
  - รุ่นรถ
  - หมวดสินค้า
  - parts brand
  - คำค้นบางส่วน / สะกดไม่ครบ
- [x] วัดและทบทวนผลหลัง rollout พร้อมบันทึกสถานะการใช้งานจริงของ Search V2 ไว้ใน roadmap updates
- [x] กำหนดให้ถ้าผลลัพธ์หรือความเร็วไม่ผ่านเกณฑ์ สามารถ fallback ไป legacy engine ได้ทันที
- [x] เพิ่ม regression protection ผ่าน trigger refresh, shared search service, cache tags (`product-search`), และ invalidation จาก master/product actions
- [x] อัปเดต roadmap ว่า public/admin search ใช้ search engine ใหม่แล้วหลัง rollout เสร็จ

### ✅ Phase 5.5 — ระบบ Lot Control (เสร็จสมบูรณ์)

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

#### ✅ Phase 5.5-A — Product Master + Schema ใหม่

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

- [x] เพิ่ม field ใน Product schema
- [x] สร้างตารางใหม่ทั้งหมด
- [x] `prisma db push`
- [x] เพิ่ม UI ตั้งค่า Lot ในหน้าแก้ไขสินค้า

---

#### ✅ Phase 5.5-B — ใบซื้อ รองรับแตก Lot

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

- [x] UI ฟอร์มใบซื้อ + sub-table Lot (PurchaseForm — amber inline sub-table)
- [x] Validation logic (client + server)
- [x] Server Action: บันทึก + LotBalance upsert (writePurchaseLots + writeStockMovementLots)
- [x] หน้าดูใบซื้อ (detail) แสดง lot chips ใต้แต่ละรายการ
- [x] หน้าแก้ไขใบซื้อ โหลด PurchaseItemLot จาก DB แสดงแบบ read-only

---

#### ✅ Phase 5.5-C — ใบขาย เลือก / Auto-allocate Lot

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

- [x] UI ฟอร์มใบขาย + Lot panel (SaleForm — amber inline sub-table)
- [x] Auto allocate engine (FIFO/FEFO) — ปุ่ม "Auto จัดสรร" เรียก fetchProductLots server action
- [x] Server Action: บันทึก + LotBalance deduct (writeSaleLots + writeStockMovementLots)
- [x] cancelSale: reverseSaleLotBalance คืน LotBalance
- [x] lib/lot-control-client.ts — แยก pure functions ออกจาก server module เพื่อใช้ใน "use client"
> ✅ อัพเดท 2026-04-01: เปลี่ยน lotNo input เป็น dropdown (filter Lot ที่มีคงเหลือ แสดง lotNo | EXP | qty ในหน่วยที่เลือก), auto-fill qty/expDate/unitCost เมื่อเลือก, cache lots per item, ย้าย Supplier ชิดกับสินค้า, ย้าย "Lot Control" badge ลง section Lot
> ⚠️ ยังไม่มี: color warning ล็อต EXP ใกล้หมด / block ถ้า allowExpiredIssue=false / manual override log

---

#### ✅ Phase 5.5-D — ยกเลิกเอกสาร Reverse Lot

**กฎเหล็ก:** ยกเลิกต้อง reverse ทั้ง StockCard + LotBalance ใน `$transaction` เดียวเสมอ

| เอกสาร | Reverse Logic |
|---|---|
| ยกเลิกใบซื้อ | อ่าน `PurchaseItemLot` → ลด `LotBalance` กลับ → ลบ `StockMovementLot` → recalculate |
| ยกเลิกใบขาย | อ่าน `SaleItemLot` → คืน `LotBalance` กลับ → ลบ `StockMovementLot` → recalculate |
| ยกเลิกใบคืนซัพพลายเออร์ | อ่าน `PurchaseReturnItemLot` → คืน `LotBalance` ตาม Lot เดิม |
| ยกเลิก CN (รับคืนจากลูกค้า) | ถ้า merge → ลด `LotBalance` กลับ / ถ้า RET-lot → ลบ LotBalance ของ RET-lot ทิ้ง |

- [x] แก้ `cancelPurchase` รองรับ Lot (reversePurchaseLotBalance)
- [x] แก้ `cancelSale` รองรับ Lot (reverseSaleLotBalance)
- [x] แก้ `cancelPurchaseReturn` รองรับ Lot (reversePurchaseReturnLotBalance — คืน stock ที่เคยส่งกลับซัพพลายเออร์)
- [x] แก้ `cancelCreditNote` RETURN รองรับ Lot (reverseCreditNoteLotBalance — ลบ stock ที่เคยรับคืนจากลูกค้า, รองรับทั้ง merge-lot และ RET-lot)
> หมายเหตุ: PurchaseReturn และ CreditNote RETURN ยังไม่มี UI กรอก Lot (writePurchaseReturnLots / writeCreditNoteLots ถูก implement แล้วใน lot-control.ts แต่ยังไม่ได้เรียกจาก form) → reverse จะ no-op จนกว่าจะ implement UI

---

#### ✅ Phase 5.5-E — รายงาน Lot

- [x] **Lot Balance** — คงเหลือราย Lot ทุกสินค้า (filter by product / expiry status) — `/admin/lots/balance`
  เปิดหน้าเริ่มต้นยังไม่แสดงข้อมูลจนกว่าจะค้นหาหรือเลือกสถานะแล้วกดกรอง
- [x] **Lot Trace** — ค้นหา Lot No → ดูใบซื้อต้นทาง + ใบขาย + ใบคืน + CN + movement จาก Warranty Claim (`CLAIM_RETURN_IN`, `CLAIM_SEND_OUT`, `CLAIM_RECV_IN`, `CLAIM_REPLACE_OUT`) — `/admin/lots/trace`
- [x] **Expiry Report** — Lot ที่หมดอายุแล้ว / ใกล้หมด (color-coded) — `/admin/lots/expiry`
- [x] **Slow Moving Lot** — Lot ที่ไม่มีการขายเกิน X วัน — `/admin/lots/slow-moving`
- [x] Sidebar เมนูเดียว "Stock Card Lot" (`lot_reports.view`) → tab nav 4 แท็บ

---

### ✅ Phase 5.5-F — แก้ไขเอกสาร + Lot Edit (ทุกโมดูลที่มี Lot)

> **Priority 1 — Bug Fix (Silent Data Corruption)**
> `updatePurchase` และ `updateSale` ปัจจุบันลบ PurchaseItem/SaleItem ด้วย cascade
> โดยไม่ reverse LotBalance ก่อน → LotBalance เกินจริง หลังแก้ไขเอกสารที่มี Lot

---

#### Phase 5.5-F1 — แก้ Bug: updatePurchase ไม่ reverse LotBalance ✅ DONE

**ไฟล์:** `app/admin/(protected)/purchases/actions.ts`

**Status update (2026-04-05):** Done. `updatePurchase` reverse lot balance before delete, rewrites lot rows after recreate, and the edit form now allows lot editing instead of read-only display.

**ปัญหา:**
```
ปัจจุบัน:  deleteMany PurchaseItem → cascade ลบ PurchaseItemLot
           แต่ไม่ reverse LotBalance ก่อน
ผลลัพธ์:  LotBalance ค้างอยู่ค่าเก่า (เกินจริง) ทุกครั้งที่แก้ไขใบซื้อที่มี Lot
```

**แก้ไข — เพิ่มใน `updatePurchase` ก่อน step 1 (ลบ PurchaseItems):**
```typescript
// 0. Reverse old Lot balance ก่อน (ป้องกัน LotBalance เกิน)
const oldItemsWithLots = await tx.purchaseItem.findMany({
  where: { purchaseId: id },
  select: { id: true, productId: true },
});
for (const item of oldItemsWithLots) {
  await reversePurchaseLotBalance(tx, item.id, item.productId);
}
// 1. ลบ items (cascade ลบ PurchaseItemLot ด้วย — lot balance reverse แล้ว)
await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
```

**เพิ่มหลังสร้าง purchaseItem + writeStockCard:**
```typescript
// writePurchaseLots + writeStockMovementLots ถ้ามี lot data ใน item
if (item.isLotControl && item.lots?.length > 0) {
  await writePurchaseLots(tx, purchaseItem.id, item.productId, item.lots);
  const stockCardRow = await tx.stockCard.findFirst({
    where: { docNo: existing.purchaseNo, referenceId: purchaseItem.id },
    select: { id: true },
  });
  if (stockCardRow) {
    await writeStockMovementLots(tx, stockCardRow.id, item.lots, "in");
  }
}
```

**Schema:** ไม่เปลี่ยน
**Checklist:**
- [ ] อ่าน existing items + id ก่อน delete
- [ ] เรียก `reversePurchaseLotBalance` ทุก item
- [ ] `purchaseItemSchema` รับ `lots: z.array(lotSubRowSchema).default([])`
- [ ] เรียก `writePurchaseLots` + `writeStockMovementLots` หลัง create item ใหม่
- [ ] UI: เปลี่ยนหน้าแก้ไขใบซื้อจาก read-only chips → editable sub-table (ส่ง lots ผ่าน items JSON)
- [ ] Test: แก้ไขใบซื้อ → ตรวจ LotBalance ว่า lot เก่าลดลง + lot ใหม่เพิ่มขึ้น

---

#### Phase 5.5-F2 — แก้ Bug: updateSale ไม่ reverse LotBalance ✅ DONE

**ไฟล์:** `app/admin/(protected)/sales/actions.ts`

**Status update (2026-04-05):** Done. `updateSale` reverse lot balance before delete, rewrites lot rows after recreate, validates lot balance on save, and the edit form now restores editable lot allocation with prefilled availability.

**ปัญหา:** เหมือน F1 — ลบ SaleItem ด้วย cascade โดยไม่ reverse SaleItemLot ก่อน

**แก้ไข — เพิ่มใน `updateSale` ก่อนลบ SaleItems:**
```typescript
// 0. Reverse old Lot balance
const oldSaleItems = await tx.saleItem.findMany({
  where: { saleId: id },
  select: { id: true, productId: true },
});
for (const item of oldSaleItems) {
  await reverseSaleLotBalance(tx, item.id, item.productId);
}
await tx.saleItem.deleteMany({ where: { saleId: id } });
```

**เพิ่มหลังสร้าง saleItem + writeStockCard:**
```typescript
if (item.isLotControl && item.lots?.length > 0) {
  await writeSaleLots(tx, saleItem.id, item.productId, item.lots);
  const stockCardRow = await tx.stockCard.findFirst({
    where: { docNo: existing.saleNo, referenceId: saleItem.id },
    select: { id: true },
  });
  if (stockCardRow) {
    await writeStockMovementLots(tx, stockCardRow.id, item.lots, "out");
  }
}
```

**Schema:** ไม่เปลี่ยน
**Checklist:**
- [ ] เรียก `reverseSaleLotBalance` ทุก item ก่อน delete
- [ ] `saleItemSchema` รับ `lots: z.array(lotSubRowSchema).default([])`
- [ ] เรียก `writeSaleLots` + `writeStockMovementLots` หลัง create item ใหม่
- [ ] UI: เปลี่ยนหน้าแก้ไขใบขาย — Lot dropdown (เหมือน SaleForm create mode) + pre-fill lot เดิม
- [ ] ตรวจสอบ LotBalance เพียงพอก่อน save (validateLotRows)
- [ ] Test: แก้ไขใบขาย → LotBalance ถูกต้อง

---

#### Phase 5.5-F3 — ใบคืนซัพพลายเออร์ รองรับ Lot (ครั้งแรก) ✅ DONE

**ไฟล์:** `app/admin/(protected)/purchase-returns/actions.ts`  
**Component:** `app/admin/(protected)/purchase-returns/new/PurchaseReturnForm.tsx` (และ edit)

**Status update (2026-04-05):** Done. Purchase Return now accepts lot rows on create/edit, reverses lot balances on update/cancel, rewrites `PurchaseReturnItemLot` + `StockMovementLot`, and shows lot data in the detail view.

> `writePurchaseReturnLots` + `reversePurchaseReturnLotBalance` ใน `lot-control.ts` implement แล้ว
> แต่ยังไม่ถูกเรียกจาก action ใดเลย

**createPurchaseReturn — เพิ่มหลัง purchaseReturnItem.create:**
```typescript
if (product.isLotControl && item.lots?.length > 0) {
  await writePurchaseReturnLots(tx, returnItem.id, item.productId, item.lots);
  // writeStockMovementLots direction="out" (stock ออกไปซัพพลายเออร์)
  const sc = await tx.stockCard.findFirst({
    where: { docNo: returnNo, referenceId: returnItem.id },
    select: { id: true },
  });
  if (sc) await writeStockMovementLots(tx, sc.id, item.lots, "out");
}
```

**updatePurchaseReturn — เพิ่มก่อนลบ items + หลังสร้างใหม่:**
```typescript
// Before delete:
for (const item of oldItems) {
  await reversePurchaseReturnLotBalance(tx, item.id, item.productId);
}
// After create:
await writePurchaseReturnLots(tx, newItem.id, ...)
await writeStockMovementLots(tx, sc.id, ..., "out")
```

**Validation เพิ่ม (server):**
```typescript
// ตรวจ LotBalance เพียงพอก่อนคืน
for (const lot of item.lots) {
  const balance = await tx.lotBalance.findUnique({
    where: { productId_lotNo: { productId, lotNo: lot.lotNo } },
  });
  if (!balance || Number(balance.qtyOnHand) < lot.qtyInBase) {
    throw new Error(`Lot ${lot.lotNo} คงเหลือไม่พอ`);
  }
}
```

**Schema:** ไม่เปลี่ยน
**Checklist:**
- [ ] `returnItemSchema` รับ `lots: z.array(lotSubRowSchema).default([])`
- [ ] `createPurchaseReturn`: เรียก `writePurchaseReturnLots` + `writeStockMovementLots`
- [ ] `updatePurchaseReturn`: reverse old → re-create new lots
- [ ] UI: เพิ่ม Lot sub-table ใน PurchaseReturnForm (dropdown filter lot คงเหลือ เหมือน SaleForm)
  - สินค้า `isLotControl = true` → แสดง lot sub-table ใต้บรรทัด
  - dropdown: lotNo | EXP | คงเหลือ (กรอง `qtyOnHand > 0`)
  - `sum(lot.qty) === item.qty` ต้องตรง
- [ ] หน้า detail + edit แสดง lot chips ที่บันทึกไว้
- [ ] Test: สร้างใบคืน → LotBalance ลดลง, ยกเลิก → LotBalance คืนกลับ

---

#### Phase 5.5-F4 — CN รับคืนจากลูกค้า (RETURN type) รองรับ Lot (ครั้งแรก) ✅ DONE

**ไฟล์:** `app/admin/(protected)/credit-notes/actions.ts`  
**Component:** `app/admin/(protected)/credit-notes/new/CreditNoteForm.tsx` (และ edit)

**Status update (2026-04-05):** Done. Credit Note `RETURN` now supports lot rows with `isReturnLot`, reverses lot balances on update/cancel, rewrites `CreditNoteItemLot` + `StockMovementLot`, and shows returned lot data in the detail view.

> `writeCreditNoteLots` + `reverseCreditNoteLotBalance` ใน `lot-control.ts` implement แล้ว

**createCreditNote (type=RETURN) — เพิ่มหลัง cnItem.create:**
```typescript
if (product.isLotControl && item.lots?.length > 0) {
  await writeCreditNoteLots(tx, cnItem.id, item.productId, item.lots);
  // direction="in" (stock เข้า — ลูกค้าคืน)
  const sc = await tx.stockCard.findFirst({
    where: { docNo: cnNo, referenceId: cnItem.id },
    select: { id: true },
  });
  if (sc) await writeStockMovementLots(tx, sc.id, item.lots, "in");
}
```

**updateCreditNote (type=RETURN):**
```typescript
// Before delete items:
for (const item of oldItems) {
  if (item.productId) {
    await reverseCreditNoteLotBalance(tx, item.id, item.productId);
  }
}
// After re-create:
await writeCreditNoteLots(tx, newItem.id, ...)
await writeStockMovementLots(tx, sc.id, ..., "in")
```

**Schema:** ไม่เปลี่ยน
**Checklist:**
- [ ] `cnItemSchema` รับ `lots: z.array(lotSubRowSchema & { isReturnLot: boolean }).default([])`
- [ ] `createCreditNote` RETURN: เรียก `writeCreditNoteLots` + `writeStockMovementLots`
- [ ] `updateCreditNote` RETURN: reverse old → re-create new lots
- [ ] UI: เพิ่ม Lot sub-table ใน CreditNoteForm (type=RETURN เท่านั้น)
  - dropdown lotNo | EXP | คงเหลือ (สำหรับ merge กลับ lot เดิม)
  - toggle "คืนแยก Lot ใหม่ (RET-)" ต่อ lot row → set `isReturnLot=true`
  - ถ้า `isReturnLot=true` → สร้าง `RET-{lotNo}` ใน ProductLot + LotBalance ใหม่
- [ ] หน้า detail + edit แสดง lot chips (ระบุ RET-lot ด้วยสีต่างหาก)
- [ ] Test: สร้าง CN RETURN → LotBalance เพิ่ม (merge หรือ RET-lot), ยกเลิก → reverse

---

### ✅ Phase 5.5-G — Delivery แสดง Lot

**ไฟล์ที่กระทบ:**
- `app/admin/delivery/print/page.tsx` (print)

> ไม่มี stock/lot transaction ใหม่ — Delivery เป็นแค่ logistics status

#### G-1: Delivery Detail

ไม่มี route detail แยกสำหรับ delivery ใน implementation ปัจจุบัน เพราะใช้ sale detail สำหรับการเปิดดูข้อมูลอยู่แล้ว จึงไม่ต้องเพิ่มหน้ารายละเอียดใหม่

#### G-2: ใบส่งของ (Print) แสดง Lot

**ไฟล์:** `app/admin/delivery/print/page.tsx`

**เพิ่ม:**
- คอลัมน์ "Lot No" ในตารางสินค้าของใบส่งของ
- ถ้า item มีหลาย lot → แสดงทุก lot บนบรรทัดใหม่ย่อย

**Checklist:**
- [x] query `lotItems` ใน delivery print
- [x] เพิ่มคอลัมน์ Lot No ในตารางสินค้า
- [x] ทดสอบ print layout ไม่แตก
---

### ✅ Phase 5.5-H — Warranty + Claim Lot Integration

---

#### Phase 5.5-H1 — Warranty เก็บ Lot Snapshot

**Schema change (`prisma/schema.prisma`):**
```prisma
model Warranty {
  ...
  lotNo  String?  // Snapshot Lot ณ วันขาย — อ้างอิงจาก SaleItemLot
}
```

**Logic เมื่อสร้าง Warranty จากใบขาย (`sales/actions.ts`):**
```typescript
// qty=5, lots=[LOT-A qty=3, LOT-B qty=2]
// สร้าง warranty unitSeq 1,2,3 → lotNo="LOT-A"
//           unitSeq 4,5     → lotNo="LOT-B"

// Algorithm: flatten lots เรียงตาม qty → assign sequential
const flatLots: string[] = [];
for (const lot of saleItem.lots) {
  for (let i = 0; i < lot.qty; i++) flatLots.push(lot.lotNo);
}
// unitSeq-1 = index ใน flatLots
warranties.forEach((w, idx) => { w.lotNo = flatLots[idx] ?? null; });
```

**Display:**
- หน้า warranty list: เพิ่มคอลัมน์ "Lot No"
- หน้า warranty detail: แสดง "Lot: LOT-001"
- หน้า warranty claim: แสดง lot ต้นทาง (อ่านจาก warranty.lotNo)

**Checklist:**
- [x] เพิ่ม `lotNo String?` ใน Warranty schema
- [x] `prisma db push`
- [x] แก้ logic สร้าง Warranty หลัง createSale: assign lotNo ตาม sequential algorithm
- [x] แก้ logic สร้าง Warranty หลัง updateSale: re-assign lotNo ใหม่
- [x] UI warranty list: เพิ่มคอลัมน์ Lot No
- [x] UI warranty list / claim page: แสดง Lot No ต้นทางตามโครงสร้าง route ปัจจุบัน
- [x] UI claim form: แสดง lot ต้นทาง (read-only, จาก warranty.lotNo)

---

#### Phase 5.5-H2 — WarrantyClaimLot Schema ใหม่

**Schema change (`prisma/schema.prisma`):**
```prisma
model WarrantyClaimLot {
  id         String        @id @default(cuid())
  claimId    String
  claim      WarrantyClaim @relation(fields: [claimId], references: [id], onDelete: Cascade)
  lotNo      String
  qty        Decimal       @db.Decimal(12,4)
  direction  String        // "in" | "out"
  unitCost   Decimal       @db.Decimal(10,4)

  @@index([claimId])
  @@index([lotNo])
}

// เพิ่มใน WarrantyClaim:
model WarrantyClaim {
  ...
  claimLots  WarrantyClaimLot[]
}
```

**Checklist:**
- [x] เพิ่ม `WarrantyClaimLot` model
- [x] เพิ่ม relation `claimLots` ใน `WarrantyClaim`
- [x] `prisma db push`

---

#### Phase 5.5-H3 — Claim Lot Stock Flow

**Stock + Lot logic ต่อ CLAIM action:**

| CLAIM Action | StockCard Source | LotBalance | WarrantyClaimLot |
|---|---|---|---|
| `CLAIM_RETURN_IN` | รับสินค้าเสียจากลูกค้า | `+qty` ของ `warranty.lotNo` (หรือ `RET-{lotNo}` ถ้าเปิด option) | `direction="in"` |
| `CLAIM_SEND_OUT` | ส่งสินค้าเสียให้ supplier | `-qty` ของ `warranty.lotNo` | `direction="out"` |
| `CLAIM_RECV_IN` | รับสินค้าทดแทนจาก supplier | `+qty` ของ lot ใหม่/เดิมที่ระบุ | `direction="in"` |
| `CLAIM_REPLACE_OUT` | ส่งสินค้าทดแทนให้ลูกค้า | `-qty` ของ lot ที่เลือก | `direction="out"` |

**ฟังก์ชันใหม่ใน `lib/lot-control.ts`:**
```typescript
// เพิ่ม + deduct LotBalance + สร้าง WarrantyClaimLot
export async function writeClaimLot(
  tx, claimId, productId, lotNo, qty, direction: "in"|"out", unitCost
): Promise<void>

// Reverse เมื่อยกเลิกใบเคลม
export async function reverseClaimLotBalance(
  tx, claimId, productId
): Promise<void>
```

**Logic cancelWarrantyClaim (เพิ่ม):**
```typescript
// อ่าน WarrantyClaimLot → reverse LotBalance
for (const lot of claimLots) {
  if (lot.direction === "in") {
    // deduct กลับ
    await tx.lotBalance.updateMany(...)
  } else {
    // คืนกลับ
    await tx.lotBalance.upsert(...)
  }
}
```

**Checklist:**
- [x] เพิ่ม `writeClaimLot` ใน `lib/lot-control.ts`
- [x] เพิ่ม `reverseClaimLotBalance` ใน `lib/lot-control.ts`
- [x] แก้ `warranty-claims/actions.ts`:
  - `CLAIM_RETURN_IN`: เรียก `writeClaimLot` direction="in" ด้วย `warranty.lotNo`
  - `CLAIM_SEND_OUT`: เรียก `writeClaimLot` direction="out"
  - `CLAIM_RECV_IN`: เรียก `writeClaimLot` direction="in" ด้วย lot ที่รับมา
  - `CLAIM_REPLACE_OUT`: เรียก `writeClaimLot` direction="out" ด้วย lot ที่ส่ง
- [x] แก้ `cancelWarrantyClaim`: เรียก `reverseClaimLotBalance`
- [x] UI Claim Form: 
  - CLAIM_RETURN_IN / CLAIM_RECV_IN: input/dropdown lot (pre-fill จาก warranty.lotNo)
  - CLAIM_SEND_OUT: แสดง lot ต้นทาง (auto-fill, editable)
  - CLAIM_REPLACE_OUT: dropdown เลือก lot ที่จะส่งออก (filter LotBalance > 0, auto-select ตาม allocation logic แต่ผู้ใช้ override เองได้)
- [x] Test: ทุก ClaimType → LotBalance ถูกต้อง + ยกเลิก → reverse ถูกต้อง

---

### ✅ Phase 5.5-H — Status Update

- [x] `Warranty.lotNo` snapshot ถูกเพิ่มและ assign ตาม lot ที่ขายจริงตอน create/update sale
- [x] warranty list และหน้าเปิด claim แสดง `Lot No` ต้นทางแบบ read-only
- [x] เพิ่ม model `WarrantyClaimLot` และ relation `claimLots`
- [x] เพิ่ม `writeClaimLot` และ `reverseClaimLotBalance` ใน `lib/lot-control.ts`
- [x] `CLAIM_RETURN_IN` / `CLAIM_SEND_OUT` ใช้ `warranty.lotNo` เป็นต้นทางและไม่เปิดให้แก้ snapshot lot เดิม
- [x] `CLAIM_RECV_IN` ตอนปิดเคลมรองรับกรอก `Lot No` / วันที่ผลิต / วันหมดอายุ ใหม่สำหรับของที่รับกลับ
- [x] `CLAIM_REPLACE_OUT` ใช้ dropdown lot สินค้าทดแทน โดย auto-allocate ค่าเริ่มต้นจาก lot คงเหลือปัจจุบันและให้ผู้ใช้ override เองได้
- [x] `prisma generate`
- [x] `prisma db push`
- [x] `npm run build`

> หมายเหตุ implementation:
> - warranty ไม่มี detail route แยกในโครงสร้างปัจจุบัน จึงแสดง lot ที่หน้า list และหน้า claim แทน
> - lot snapshot ที่มากับ warranty ถูกถือเป็นข้อมูลอ้างอิงจากตอนขายและไม่เปิดให้แก้ภายหลัง

### สรุป Schema Changes Phase 5.5-F/G/H

| Table | การเปลี่ยน | Requires |
|---|---|---|
| `Warranty` | เพิ่ม `lotNo String?` | `prisma db push` + migrate existing rows = null |
| `WarrantyClaimLot` | ตารางใหม่ | `prisma db push` |
| `WarrantyClaim` | เพิ่ม relation `claimLots` | `prisma db push` |
| อื่นๆ | ไม่เปลี่ยน schema | — |

---

### ✅ Phase 5.5-I — BF + Adjustment รองรับ Lot Control (เสร็จสมบูรณ์)

> **อัพเดท 2026-04-06:** เพิ่ม Lot Control ให้ BF (ยอดยกมา) และ Adjustment (ปรับสต็อก) ครบทั้ง server + UI

#### ✅ Phase 5.5-I1 — BF (ยอดยกมา) รองรับ Lot

**ไฟล์:**
- `app/admin/(protected)/stock/bf/actions.ts` — createBF + cancelBF
- `app/admin/(protected)/stock/bf/BfForm.tsx` — UI Lot sub-table
- `app/admin/(protected)/stock/bf/page.tsx` — ส่ง isLotControl/requireExpiryDate ให้ form

**Logic:**
- สินค้า `isLotControl=true` → แสดง Lot sub-table (manual input: lotNo, qty, unitCost, mfgDate, expDate)
- `createBF`: validate lots → `writePurchaseLots` (bf.id เป็น purchaseItemId) + `writeStockMovementLots` direction="in"
- `cancelBF`: `reversePurchaseLotBalance(tx, bf.id, bf.productId)` → delete StockCard → recalculate

**Checklist:**
- [x] actions.ts: lotSubRowSchema + lotItems ใน bfSchema
- [x] actions.ts: createBF — writePurchaseLots + writeStockMovementLots
- [x] actions.ts: cancelBF — reversePurchaseLotBalance
- [x] BfForm.tsx: Lot sub-table UI (amber styling, manual input)
- [x] page.tsx: query isLotControl + requireExpiryDate

---

#### ✅ Phase 5.5-I2 — Adjustment (ปรับสต็อก) รองรับ Lot

**ไฟล์:**
- `app/admin/(protected)/stock/adjustments/actions.ts` — createAdjustment + cancelAdjustment + fetchAdjustmentProductLots
- `app/admin/(protected)/stock/adjustments/AdjustmentForm.tsx` — UI Lot (IN=manual, OUT=dropdown)
- `app/admin/(protected)/stock/adjustments/page.tsx` — ส่ง isLotControl/requireExpiryDate/lotIssueMethod ให้ form
- `lib/lot-control.ts` — writeAdjustmentLots + reverseAdjustmentLotBalance

**Logic:**
- **ADJUST_IN:** แสดง manual input (lotNo, qty, unitCost, mfgDate, expDate) — เหมือน BF/Purchase
- **ADJUST_OUT:** แสดง dropdown เลือก Lot (filter คงเหลือ, แสดง lotNo | EXP | qty) + ปุ่ม "Auto จัดสรร" — เหมือน SaleForm
- `createAdjustment`: validate lots → `writeAdjustmentLots` (upsert LotBalance + ProductLot + StockMovementLot)
- `cancelAdjustment`: `reverseAdjustmentLotBalance(tx, adj.id, affectedProductIds)` → delete StockCard → recalculate

**ฟังก์ชันใหม่ใน `lib/lot-control.ts`:**
- `writeAdjustmentLots(tx, stockCardId, productId, lots, direction)` — direction="in" upsert LotBalance+ProductLot / direction="out" deduct LotBalance
- `reverseAdjustmentLotBalance(tx, adjustmentId, productIds)` — อ่าน StockMovementLot จาก StockCard ที่มี referenceId=adjustmentId แล้ว reverse

**Checklist:**
- [x] lot-control.ts: writeAdjustmentLots + reverseAdjustmentLotBalance
- [x] actions.ts: lotSubRowSchema + lotItems ใน adjustItemSchema
- [x] actions.ts: createAdjustment — writeAdjustmentLots per item
- [x] actions.ts: cancelAdjustment — reverseAdjustmentLotBalance
- [x] actions.ts: fetchAdjustmentProductLots (FIFO/FEFO sort)
- [x] AdjustmentForm.tsx: ADJUST_IN = manual lot input, ADJUST_OUT = dropdown + Auto จัดสรร
- [x] page.tsx: query isLotControl + requireExpiryDate + lotIssueMethod

---

### ✅ Phase 6 — Report (เสร็จแล้ว)
- [x] Report สรุปยอดขาย (รายวัน/สัปดาห์/เดือน) พร้อม Net sale = ขาย - คืนขาย
- [x] Report กำไร-ขาดทุน (รวม VAT breakdown)
- [x] Report stock คงเหลือ + สินค้าต่ำกว่า minStock
- [x] Report ประกันที่กำลังจะหมด
- [x] Report ลูกหนี้ค้างชำระ (A/R aging + COD pending)
- [x] Report ซื้อแยกซัพพลายเออร์
- [x] Report ขายแยกลูกค้า
- [x] Report ค่าใช้จ่าย (summary by expense code + detail rows)
- [x] Report รับเงินประจำวัน (ขายสด + ใบเสร็จรับเงิน พร้อมช่องทางชำระ)
- [x] Report จ่ายเงินประจำวัน (ซื้อสินค้า + ค่าใช้จ่าย)
- [x] Filter รายงานตามช่วงวันที่ + code range ที่สอดคล้องกับแต่ละโมดูล
- [x] หน้าใบซื้อสินค้าเพิ่มช่องทางชำระเงิน เงินสด / โอนเงิน โดย default = โอนเงิน
- [x] Export Excel-compatible CSV / PDF print page

---

### ✅ Phase 6.5 — Accounting Reports Alignment (เสร็จแล้ว — 2026-04-06)
> เป้าหมาย: ยกระดับรายงานเป็นแบบ Raw Data ระดับ line item พร้อม Export CSV และ Export Excel (.xlsx) แยกปุ่ม

#### สิ่งที่ implement แล้ว

**โครงสร้างใหม่:** `lib/report-queries.ts` + tab navigation (`ReportTabNav`) + layout ครอบทุก sub-page

| Tab | Route | ประเภท | Export |
|---|---|---|---|
| รายงานขาย | `/reports/sales` | Raw data 1 row/item — filter ประเภทขาย/การชำระ | CSV + Excel |
| รายงานซื้อ | `/reports/purchases` | Raw data 1 row/item — ทุกรายการซื้อ | CSV + Excel |
| คืนขาย (CN) | `/reports/credit-notes` | Raw data 1 row/item — filter ประเภท CN | CSV + Excel |
| รับเงินประจำวัน | `/reports/receipts` | ระดับใบ — ขายสด + รับชำระหนี้ — filter ประเภท | CSV + Excel |
| จ่ายเงินประจำวัน | `/reports/payments` | ระดับใบ — ซื้อ + ค่าใช้จ่าย + CN คืนเงินสด — filter ประเภท | CSV + Excel |
| สรุปภาพรวม | `/reports/summary` | Summary cards: กำไร-ขาดทุน, สต็อก, ลูกหนี้, ประกัน | — |

**Export Excel** ใช้ `exceljs` — header สีน้ำเงิน (`#1e3a5f`), numeric format, แถวรวมท้าย, แถวที่ยกเลิกเป็นสีเทาและ italic

**รายงานรับเงินประจำวัน** รวม:
- ขายสด (`Sale.paymentType = CASH_SALE`) — พร้อมช่องทางชำระ
- รับชำระหนี้ (`Receipt`) — พร้อมช่องทางชำระ
- Summary cards แยก 3 ช่อง

**รายงานจ่ายเงินประจำวัน** รวม:
- ซื้อสินค้า (`Purchase`) — พร้อม paymentMethod
- ค่าใช้จ่าย (`Expense`)
- คืนเงินลูกค้า (`CreditNote.settlementType = CASH_REFUND`) — พร้อม refundMethod
- Summary cards แยก 4 ช่อง

- [x] แยก tab ชัด: ขาย / ซื้อ / CN / รับเงิน / จ่ายเงิน / สรุป
- [x] Sales Register — raw data per line item
- [x] Purchase Register — raw data per line item (fix รหัสซัพพลายเออร์ fallback)
- [x] Credit Note Register — raw data per line item, filter CN type
- [x] รายงานรับเงินประจำวัน — ระดับใบ, ขายสด + รับชำระหนี้, แสดงช่องทางชำระ
- [x] รายงานจ่ายเงินประจำวัน — ระดับใบ, ซื้อ + ค่าใช้จ่าย + CN คืนเงินสด, แสดงช่องทางชำระ
- [x] สรุปภาพรวม — P&L cards + สต็อก + ลูกหนี้ (ใช้ ReportsContent เดิม)
- [x] Export CSV (BOM สำหรับ Thai ใน Excel) แยกปุ่มสีเทา
- [x] Export Excel .xlsx (exceljs) แยกปุ่มสีเขียว — route `/reports/export-excel`
- [x] แถวที่ยกเลิก: opacity + strikethrough ในตาราง, ตัวเอียงสีเทาใน Excel
- [x] Footer row รวมยอดทุกรายงาน
- [x] loading.tsx ครบทุก sub-route

**งานอนาคต / ยังไม่ทำในรอบนี้:**
- [ ] AR Register / AP Register (รายงานทะเบียนอีกมิติหนึ่ง ต่างจากหน้า outstanding ปัจจุบันที่ `/admin/reports/ar` และ `/admin/reports/ap`)
- [ ] รายงานภาษีขาย / ภาษีซื้อ (เก็บไว้เป็นงานอนาคต)

---

### 🔲 Phase 6.6 — โมดูลบัญชีธนาคาร/เงินสด Lite สำหรับธุรกิจเริ่มต้น
> เป้าหมาย: ทำ Cash/Bank ledger ระดับใช้งานจริงแบบเบา ใช้คุมว่าเงินอยู่บัญชีไหน, เงินเข้าออกจากเอกสารอะไร, และดูยอดคงเหลือรายบัญชีได้ทันที โดยยังไม่เปิด scope เป็นระบบบัญชีเต็มหรือ bank reconcile เต็มรูปแบบตั้งแต่รอบแรก

#### ขอบเขตของ Lite Version
- [x] เพิ่ม master บัญชีการเงินแบบจำเป็นก่อน
  - [x] Cash/Bank Account master
  - [x] รองรับประเภทอย่างน้อย `CASH` / `BANK`
  - [x] เก็บ Opening balance และ Opening date ของแต่ละบัญชี
  - [x] รองรับสถานะ active/inactive
  - [x] ใช้จำนวนบัญชีแบบ lean สำหรับธุรกิจเริ่มต้น เช่น เงินสดหน้าร้าน, เงินสดย่อย, ธนาคารหลัก 1-2 บัญชี
- [x] เพิ่ม Cash/Bank ledger movement เป็น source of truth ของการเคลื่อนไหวเงิน
  - [x] ทุก movement ต้องระบุ `accountId`, `txnDate`, `direction (IN/OUT)`, `amount`, `balanceAfter`, `sourceType`, `sourceId`, `referenceNo`, `note`
  - [x] รองรับ source ขั้นต่ำใน Lite อย่างน้อย `SALE`, `RECEIPT`, `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER`, `ADJUSTMENT`
  - [x] `PURCHASE` ใช้สำหรับรายการจ่ายเงินจริงให้ supplier ที่กระทบบัญชีเงินทันที
  - [x] `CN_SALE` ใช้สำหรับ Credit Note ฝั่งขายที่มีผลเป็นเงินออก/ปรับเงินลูกค้า
  - [x] `ADJUSTMENT` ใช้สำหรับการปรับยอดเงินระดับบัญชี เช่น เงินขาด/เงินเกิน/ค่าธรรมเนียมธนาคาร/ปรับยอดเริ่มต้นหลัง go-live
  - [x] ledger movement ต้องใช้เป็น cash/bank card ของแต่ละบัญชี ไม่ใช่คำนวณสดจากรายงานทุกครั้ง
- [x] ผูกเอกสารธุรกิจกับบัญชีการเงินเฉพาะจุดที่กระทบเงินจริงก่อน
  - [x] Sale แบบขายสด ต้องเลือกบัญชีรับเงิน
  - [x] Receipt ต้องเลือกบัญชีรับเงิน
  - [x] Purchase ที่จ่ายทันที ต้องเลือกบัญชีจ่ายเงิน
  - [x] Purchase ต้องมี `paymentStatus` (`UNPAID` / `PARTIALLY_PAID` / `PAID`) เพื่อแยกรายการที่ยังไม่กระทบเงินจริงออกจากรายการที่จ่ายเงินจริง
  - [x] Purchase ที่ `paymentStatus=UNPAID` ต้องยังไม่สร้าง cash/bank movement จนกว่าจะมีการจ่ายเงินจริง
  - [x] Expense ต้องเลือกบัญชีจ่ายเงิน
  - [x] Credit Note ฝั่งขายที่คืนเงินจริง ต้องเลือกบัญชีจ่ายเงิน
  - [x] Credit Note ฝั่งขายที่ `SettlementType=คืนเงินสด` ให้ถือเป็น `CN_SALE` ที่กระทบ cash/bank card โดยตรง
  - [x] Transfer ระหว่างบัญชี ต้องสร้าง movement 2 ฝั่ง (ออกจากบัญชีต้นทาง + เข้าบัญชีปลายทาง)
  - [x] เพิ่มโมดูล Adjustment สำหรับปรับยอดเงินรายบัญชีโดยตรง พร้อมเหตุผลและการอนุมัติใช้งานตามสิทธิ์
  - [x] เฟส Lite ยังไม่ทำ Bank Reconcile เต็ม แต่ต้องวางโครงสร้าง source และ card ให้พร้อมต่อยอด

#### กติกาธุรกิจสำคัญของ Cash/Bank Card
- [x] การเพิ่มเอกสารที่กระทบเงินจริง ต้องสร้าง cash/bank movement และอัปเดตยอดคงเหลือปลายรายการของบัญชีนั้นทันที
- [x] การแก้ไขเอกสารที่กระทบเงินจริง ต้อง reverse/replace movement เดิมก่อน แล้วสร้าง movement ชุดใหม่เสมอ
- [x] การยกเลิกเอกสารที่กระทบเงินจริง ต้องยกเลิก movement ที่เกี่ยวข้องและ recalculate cash/bank card ของทุกบัญชีที่ได้รับผลกระทบ
- [x] การปรับยอดเงินด้วย Adjustment ต้องสร้าง movement ใหม่เสมอ และถ้ายกเลิกรายการต้อง reverse + recalculate cash/bank card เหมือนเอกสารประเภทอื่น
- [x] Adjustment ต้องผูกกับบทบาทและสิทธิของผู้ใช้ โดยแยกสิทธิ create/edit/cancel ให้ชัดก่อนเปิดใช้งาน
- [x] การโอนระหว่างบัญชีต้องเป็น atomic transaction เดียวเสมอ เพื่อไม่ให้ยอดเงินหายระหว่างทาง
- [x] ห้ามปล่อยให้เอกสารถูกแก้หรือยกเลิกโดยที่ cash/bank card ไม่อัปเดตตาม
- [x] ต้องมี utility กลางสำหรับ recalculate cash/bank card ตามลำดับวันและลำดับเอกสาร คล้ายแนวคิด `recalculateStockCard()` แต่สำหรับ ledger เงิน

#### หน้าจอหลักของ Lite Version
- [x] เพิ่มเมนู `/admin/cash-bank`
  - [x] จัดการบัญชีเงินสด/ธนาคาร
  - [x] เปิด/ปิดการใช้งาน
  - [x] ตั้งยอดยกมา
- [x] เพิ่มเมนู `/admin/cash-bank/ledger`
  - [x] ดู cash/bank card รายบัญชี
  - [x] filter ตามบัญชี / ช่วงวันที่
  - [x] แยกประเภท source เช่น `SALE`, `RECEIPT`, `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER`, `ADJUSTMENT`
  - [x] กดเข้าไปดูเอกสารต้นทางได้
  - [x] แสดงยอดยกมา, รวมรับ, รวมจ่าย, ยอดคงเหลือปลายงวด
  - [x] แสดง running balance ต่อรายการ
- [x] เพิ่มเมนู `/admin/cash-bank/transfers`
  - [x] บันทึกโอนเงินระหว่างบัญชีแบบง่าย
  - [x] ใช้สำหรับเงินสดฝากธนาคารหรือโอนข้ามบัญชีธนาคาร
- [x] เพิ่มเมนู `/admin/cash-bank/adjustments`
  - [x] บันทึกปรับยอดเงินเข้า/ออกบัญชีโดยตรง
  - [x] ใช้สำหรับเงินสดขาด/เกิน, ค่าธรรมเนียมธนาคาร, ดอกเบี้ย, และรายการปรับปรุงเปิดระบบ
  - [x] ต้องมีเหตุผลประกอบและรองรับการยกเลิกรายการพร้อม reverse movement
  - [x] ต้องตรวจ role/permission ก่อนสร้าง แก้ไข หรือยกเลิก Adjustment

#### รายงานที่ต้องมีใน Lite Version
- [x] Cash/Bank Ledger Report
  - [x] filter ตามบัญชี / ช่วงวันที่
  - [x] แยกประเภท source เช่น `SALE`, `RECEIPT`, `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER`, `ADJUSTMENT`
  - [x] กดเข้าไปดูเอกสารต้นทางได้
  - [x] สรุปยอดยกมา, รวมรับ, รวมจ่าย, ยอดคงเหลือปลายงวด
- [x] Cash/Bank Balance Summary
  - [x] สรุปยอดคงเหลือล่าสุดทุกบัญชีใน summary/print snapshot
  - [x] แยกเงินสด vs ธนาคารใน summary/print snapshot
  - [x] drill-down เข้า ledger รายบัญชีได้
- [x] Transfer History Report
  - [x] ดูประวัติโอนระหว่างบัญชี
  - [x] ติดตามจากบัญชีต้นทาง/ปลายทาง/ช่วงวันที่ได้

#### ผลกระทบที่ต้อง preview และแก้ในโมดูลรายงานปัจจุบัน
- [x] preview และทบทวน `/admin/reports/receipts`
  - [x] เพิ่มมุมมองบัญชีที่รับเงินจริง ไม่ใช่แค่ payment method
  - [x] เพิ่ม filter ตามบัญชีรับเงิน
  - [x] export ต้องรองรับ account name / account type / source ref
- [x] preview และทบทวน `/admin/reports/payments`
  - [x] เพิ่มมุมมองบัญชีที่จ่ายเงินจริง
  - [x] เพิ่ม filter ตามบัญชีจ่ายเงิน
  - [x] แยก movement จาก `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER OUT`, `ADJUSTMENT` และรายการจ่ายอื่นให้ชัด
  - [x] รายงานต้องสะท้อน `Purchase.paymentStatus` ให้ถูกต้อง โดย `UNPAID` ต้องไม่ถูกนับเป็นเงินจ่ายจริงในมุม ledger
- [x] preview และทบทวน `/admin/reports/credit-notes`
  - [x] แยกกรณี `CN_SALE` ที่เป็นเงินออกจริง ออกจาก CN ที่เป็นเพียงเอกสารลดหนี้
  - [x] เพิ่ม account-aware filters และ export fields สำหรับรายการคืนเงินจริง
- [x] preview และทบทวน `/admin/reports/summary`
  - [x] เพิ่ม summary ของยอดคงเหลือเงินสด/ธนาคาร
  - [x] ปรับความหมายของรายงานรับเงิน/จ่ายเงินให้สอดคล้องกับ ledger เงินจริง
  - [x] แยกยอดตามเอกสาร ออกจากยอดตามบัญชีเงิน
- [x] preview และทบทวนรายงาน adjustment ใหม่ของ cash/bank
  - [x] ต้องเห็นประวัติการปรับยอดเงินรายบัญชี
  - [x] ต้องแยก adjustment ที่เป็นเงินเข้าและเงินออก
- [x] preview และทบทวน `/admin/reports/export` และ `/admin/reports/export-excel`
  - [x] เพิ่ม field บัญชีการเงินและข้อมูล source ตาม report type ที่เกี่ยวข้อง
  - [x] ตรวจว่าไฟล์ export เดิมไม่ทำให้ผู้ใช้เข้าใจว่า payment method เท่ากับบัญชีเงิน
- [x] preview และทบทวน `/admin/reports/print`
  - [x] ถ้าพิมพ์รายงานรับเงิน/จ่ายเงิน ต้องระบุบัญชีและยอดสรุปตาม ledger ได้ถูกต้อง
- [x] preview `lib/reports` และ `lib/report-queries`
  - [x] ปรับ query model จาก document-centric ไปเป็น account-aware สำหรับ report ที่เกี่ยวกับการเงินในส่วนที่ทำแล้ว
  - [x] ระบุชัดว่ารายงานไหนยังใช้ document totals ได้เหมือนเดิม และรายงานไหนต้องอิง ledger movement แทนให้ครบทั้งหมด

#### เฟสที่ intentionally ยังไม่รวมใน Lite Version
- [ ] ยังไม่ทำ Bank Reconcile เต็มรูปแบบใน Phase 6.6 Lite
- [ ] ยังไม่ทำ import bank statement
- [ ] ยังไม่ทำ payment run / clearing workflow / slip attachment
- [ ] ย้ายสิ่งเหล่านี้ไปเป็นเฟสต่อยอดหลังธุรกิจเริ่มนิ่งและมี volume มากพอ
- [ ] ไม่ต้องทำ backfill legacy movement สำหรับข้อมูลเก่า เพราะก่อนเริ่มใช้งานจริงจะ clear data แล้วเริ่มระบบใหม่

> หมายเหตุ: เวอร์ชัน Lite นี้ตั้งใจให้เริ่มใช้งานได้เร็ว, คุมเงินจริงได้จริง, และไม่เพิ่มภาระงานเกินจำเป็นสำหรับธุรกิจเริ่มต้น โดยเน้นรู้ว่าเงินอยู่บัญชีไหนก่อนกระทบยอด statement อัตโนมัติ

**Status update (2026-04-07):** วาง schema foundation, utility กลางสำหรับ movement/recalculate, ผูกเอกสาร `SALE`, `RECEIPT`, `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER`, `ADJUSTMENT`, เพิ่ม validation message, starter account seed, summary/print cash-bank snapshot, เพิ่ม `/admin/cash-bank/ledger`, รายงาน Cash/Bank Ledger, Transfer History, Adjustment History, drill-down จาก snapshot เข้า ledger รายบัญชี, และปรับ CSV/Excel export ให้ account-aware ครบแล้ว

### ✅ Phase 7 — SEO + AEO + AIO + Core Web Vitals (เสร็จสมบูรณ์ — เหลือ manual actions + ongoing content)

**เป้าหมาย:** ติดอันดับ Google + ขึ้นใน AI search (ChatGPT, Perplexity, Google AI Overview) + ปรับ Core Web Vitals ให้ดีขึ้นอย่างต่อเนื่อง

---

#### Phase 7-A — URL Structure (อ่านรู้เรื่อง / SEO-Friendly)

- [x] เปลี่ยน URL สินค้าเป็น `/products/[categorySlug]/[productSlug]`
- [x] เปลี่ยน URL หมวดหมู่เป็น `/products/[categorySlug]`
- [x] สร้าง `slug` field ใน `Product` และ `Category` ใน database โดยตรง (`slug String? @unique` ใน schema.prisma)
- [x] canonical redirect สำหรับหน้าสินค้าเมื่อเปิดด้วย path ที่ไม่ตรงรูปแบบหลัก
- [x] ทุก URL หลักของ storefront อ่านแล้วรู้ได้ว่าเป็นหน้าอะไร

---

#### Phase 7-B — Core Web Vitals (กำลังปรับต่อ)

**เป้าหมาย:** LCP < 2.5s | INP < 200ms | CLS < 0.1

- [x] วัด baseline ด้วย Lighthouse / PageSpeed Insights แล้ว และบันทึกไว้ที่ `docs/performance/production-baseline-2026-04-02.md`
- [x] ฝัง real-user Core Web Vitals reporting ผ่าน `useReportWebVitals` + `/api/web-vitals` เพื่อเก็บ measurement loop จาก production เพิ่มเติม
- [x] ปรับ LCP image loading hints ตามแนวทาง Next.js 16 (`fetchPriority` / `loading="eager"`) ในจุดสำคัญ
- [x] ตรวจ TTFB และทำ static generation / revalidate ในหน้าที่ทำได้
- [x] ลด render cost บางส่วนของ `/products` ผ่านการตัด hero image, pagination, และลด DOM complexity
- [x] ยืนยันว่า `<Image>` สำคัญบน storefront ระบุ `fill` + `sizes` หรือขนาดที่เหมาะสม
- [x] ปรับ static generation concurrency ให้เหมาะกับ Supabase pooled connection limits เพื่อให้ build/deploy ของ storefront เสถียรมากขึ้น
- [x] วิเคราะห์ JavaScript bundle เพิ่มด้วย `@next/bundle-analyzer` และบันทึก snapshot ไว้ที่ `docs/performance/bundle-analysis-2026-04-02.md`
- [x] ตรวจ dependency audit ระดับ low-risk แล้ว และยืนยัน package ที่ยังต้องคงไว้ตาม source/config ปัจจุบัน
- [ ] clean up dependency ที่ไม่ได้ใช้จริง: `shadcn` (^4.1.0) และ `tw-animate-css` (^1.4.0) — ยังไม่พร้อมลบ เพราะยังมี import ใน `app/globals.css`
- [x] วัด production ซ้ำ — บันทึกไว้ที่ `docs/performance/production-remeasurement-2026-04-03.md` และ `docs/performance/real-user-web-vitals.md`

---

#### Phase 7-C — Metadata + Open Graph

- [x] Next.js Metadata API ครบหน้าหลักของ storefront: `title`, `description`, `canonical`
- [x] หน้าหลัก, `/products`, `/about`, `/faq`, `/knowledge`, knowledge articles, product pages, category pages มี metadata ใช้งานจริง
- [x] Open Graph + Twitter Card ครบหน้าสำคัญของ storefront
- [x] generated `og:image` สำหรับหน้าหลัก, about, faq, knowledge, knowledge article, product, category
- [x] `<link rel="canonical">` ครบหน้าหลักของ storefront

---

#### Phase 7-D — XML Sitemap + robots.txt

- [x] `app/sitemap.ts` ครอบคลุมหน้าหลัก, สินค้า, หมวดหมู่, `/about`, `/faq`, `/knowledge`
- [x] ใส่ `lastModified`, `changeFrequency`, `priority` ตามประเภทหน้าหลักแล้ว
- [x] สินค้าที่ไม่ active (`isActive: false`) ไม่อยู่ใน sitemap
- [x] `app/robots.ts` ใช้ Next.js Metadata robots
- [x] กัน `/admin/` จาก indexing
- [x] Sitemap ชี้ `https://www.sriwanparts.com/sitemap.xml`
- [x] Submit sitemap ใน Google Search Console *(manual action completed)*

---

#### Phase 7-E — Schema Markup (JSON-LD แยกไฟล์)

> **หลักการ:** JSON-LD ทุกอันเขียนเป็น component แยก ไม่ inline ใน JSX

- [x] `components/seo/LocalBusinessJsonLd.tsx`
- [x] `components/seo/ProductJsonLd.tsx`
- [x] `components/seo/BreadcrumbJsonLd.tsx`
- [x] `components/seo/FaqJsonLd.tsx`
- [x] `components/seo/OrganizationJsonLd.tsx`
- [x] `components/seo/WebSiteJsonLd.tsx`
- [x] `components/seo/ArticleJsonLd.tsx` — สำหรับ knowledge articles
- [x] `components/seo/CollectionPageJsonLd.tsx` — สำหรับหน้าหมวดหมู่
- [x] `components/seo/JsonLd.tsx` — base wrapper
- [x] `components/seo/OgImageTemplate.tsx` — OG image generation
- [x] ทดสอบด้วย [Google Rich Results Test](https://search.google.com/test/rich-results) *(manual action completed)*

---

#### Phase 7-F — AIO Content (ให้ AI อ้างอิงได้ + น่าเชื่อถือ)

> **หลักการ:** เขียนเนื้อหาที่ตอบคำถามตรงๆ ชัดเจน และอ้างอิงจากบริบทของร้านจริง

- [x] **หน้า `/about`** — foundation พร้อมใช้งาน
  - ความเชี่ยวชาญของร้าน
  - ช่องทางติดต่อ
  - รูปแบบการให้บริการ
  - local SEO layer สำหรับนครสวรรค์
- [x] **หน้า `/faq`** — มีคำถามหลักที่ลูกค้าสงสัยจริง และใช้ `FAQPage` JSON-LD คู่กัน
- [x] **หน้า `/knowledge`** — มี **14 บทความ** ครอบคลุมหมวด: การเลือกซื้อ, การวินิจฉัยอาการ, การใช้งานเว็บไซต์, local SEO นครสวรรค์ พร้อม ArticleJsonLd ทุกบทความ
- [x] **`llms.txt`** — มีแล้วที่ `/public/llms.txt` (ระบุข้อมูลร้าน, หน้าหลัก, keyword, ช่องทางติดต่อ)
- [x] **AIO Signals** — หน้าสินค้าแสดงยี่ห้อรถ/รุ่นรถที่ใช้ได้ จาก `ProductCarModel` + `buildStorefrontProductDescription()`
- [ ] เพิ่มข้อมูลปีรถ / OEM / compatibility depth ถ้ามีข้อมูลพอ *(ongoing — ขึ้นกับข้อมูล DB)*
- [x] ขยาย knowledge hub ต่อให้ครอบคลุมคำค้นเชิงธุรกิจและ local intent
- [x] ขยาย knowledge hub ต่อด้วยบทความเชิง conversion / เปรียบเทียบ / troubleshooting
- [ ] ขยาย knowledge hub จากคำค้นจริงใน production + บทความเชิงรุ่นรถ / compatibility *(ongoing content)*

---

## Environment Variables ที่ต้องมี
ดูตัวอย่างได้ที่ `.env.example`

| Variable | ใช้สำหรับ |
|---|---|
| `DATABASE_URL` | Supabase Transaction pooler (port 6543, `pgbouncer=true`) |
| `DIRECT_URL` | Supabase direct connection (db host, for Prisma CLI / migrate) |
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

---

## Roadmap Update (2026-03-30)
- Phase 5 Search: done
- Public search at /products is live.
- Admin product search at /admin/products is live.
- Product search now covers name, code, description, aliases, car brand, car model, category, and parts brand.

## Roadmap Update (2026-04-01)
- Hero search UI on the storefront was redesigned to make product search more prominent and easier to use on all screen sizes.
- Footer was simplified to focus on branding and contact information only.
- Phase 5 was redefined as a **Search Performance Upgrade** roadmap and has now been completed for both storefront and admin product search:
  - Phase 5-A Audit + Benchmark + Safety Baseline
  - Phase 5-B Database Search Architecture (PostgreSQL Full-text + trigram)
  - Phase 5-C Shared Search Service for `/products` and `/admin/products`
  - Phase 5-D Verification + Rollout + Regression Protection
- Search upgrade must preserve existing search coverage exactly while improving speed, correctness, and safety.

## Roadmap Update (2026-04-01 Search V2)
- Phase 5 — Search Performance Upgrade (หน้าบ้าน + หลังบ้าน): เสร็จแล้ว
- Search V2 target is now **marketplace-inspired**: fast, forgiving, and shared by both storefront and admin product search.
- Search V2 must preserve the existing search coverage exactly:
  - product name
  - product code
  - description
  - aliases
  - car brand
  - car model
  - category
  - parts brand
- Search V2 architecture decision:
  - dedicated PostgreSQL search document table
  - `pg_trgm` similarity matching for partial and typo-tolerant queries
  - PostgreSQL full-text search for broader matching and ranking
  - weighted ranking with exact code/name matches prioritized above loose matches
  - one shared server-side search service for `/products` and `/admin/products`
- Safety and rollout requirements:
  - fallback to legacy Prisma contains search if Search V2 is unavailable or errors
  - keep all existing filters working (`isActive`, category, car brand, car model)
  - benchmark before and after rollout on real store queries
  - no schema-breaking change to core transaction tables

## Roadmap Update (2026-04-01 UI Consistency)
- Fixed storefront `/products` navbar to use `shopLogoUrl` from company settings, keeping logo behavior consistent with the homepage, footer, favicon, and admin login.

## Roadmap Update (2026-04-02 Security Baseline)
- Enabled RLS on every table in the `public` schema on Supabase.
- Kept rollout in safe mode:
  - RLS enabled
  - no `FORCE RLS`
  - no broad public policies
  - Prisma / NextAuth / coding tools still retain database access through the current server-first architecture
- Added repo documentation and scripts for:
  - live RLS audit
  - safe RLS enablement for `public`
  - Prisma verification after rollout

## Roadmap Update (2026-04-02 Public API Blueprint)
- Prepared a non-live blueprint for future storefront-safe Supabase API exposure through public views instead of raw tables.
- Planned public views:
  - `public_site_settings`
  - `public_catalog_categories`
  - `public_catalog_car_brands`
  - `public_catalog_car_models`
  - `public_catalog_products`
  - `public_catalog_product_aliases`
- This blueprint is intentionally kept as the next security/data-contract phase and is **not required** for the current storefront while Prisma server-side data access remains the primary path.

## Roadmap Update (2026-04-02 Phase 7 Start)
- Phase 7 implementation has started with the lowest-risk SEO foundation for the live storefront.
- Completed in this rollout:
  - canonical-friendly metadata base at the app root using `https://www.sriwanparts.com`
  - homepage metadata generated from live company settings
  - `/products` metadata with canonical handling and `noindex` for search/filter result states
  - `robots.txt` generated via Next.js metadata route
  - `sitemap.xml` generated via Next.js metadata route for the current core public pages
  - `/admin/*` marked `noindex, nofollow`
- This rollout is intentionally scoped to technical SEO groundwork first, before expanding Phase 7 into structured data, content pages, URL architecture, and Core Web Vitals tuning.

## Roadmap Update (2026-04-02 Phase 7 Content + Schema)
- Added `/about` to explain the shop, service model, contact channels, and storefront purpose in a way that supports trust and SEO.
- Added `/faq` with customer-first questions and answers focused on:
  - how to search for parts
  - how ordering works through LINE OA / phone
  - stock confirmation expectations
  - trust and contact verification
  - shipping and warranty questions
- Added reusable JSON-LD components for:
  - `Organization`
  - `AutoPartsStore` / local business context
  - `WebSite` search action
  - `BreadcrumbList`
  - `FAQPage`
- Expanded sitemap and robots coverage for `/about` and `/faq`
- Updated storefront navigation so the new SEO pages are reachable from the main navbar

## Roadmap Update (2026-04-02 Phase 7 Product SEO)
- Added SEO-friendly product detail routes under `/products/[categorySlug]/[productSlug]`
- Product slugs are readable for users and search engines while still resolving safely by product id
- Added canonical enforcement with permanent redirect when a product is opened through a non-canonical slug
- Added product detail metadata and `Product` JSON-LD
- Updated product cards so storefront catalog pages now link to product detail pages
- Expanded sitemap coverage to include active product detail pages

## Roadmap Update (2026-04-02 Phase 7 Knowledge + LLMs)
- Added `/knowledge` as a storefront knowledge hub for SEO, AEO, and AIO
- Added article detail routes under `/knowledge/[slug]`
- Published the first knowledge article set focused on:
  - choosing the right AC compressor
  - checking symptoms when car air is not cold
  - preparing the right information before ordering

## Roadmap Update (2026-04-02 Phase 7 Knowledge Expansion)
- Expanded the knowledge hub with more bottom-of-funnel and comparison content for SEO/AEO:
  - genuine vs aftermarket vs used auto AC parts
  - compressor pricing and what to check before buying
  - condenser vs evaporator symptom differences
- This rollout is intended to improve:
  - conversion-oriented search coverage
  - comparison intent coverage
  - troubleshooting intent coverage
  - local SEO support for customers searching auto AC parts in Nakhon Sawan

## Roadmap Update (2026-04-02 Phase 7 Real User Web Vitals)
- Added a lightweight real-user web vitals loop for the live storefront:
  - `useReportWebVitals` in a dedicated client component
  - `POST /api/web-vitals` endpoint for structured metric intake
  - production-safe logging to support ongoing tuning after deploy
- This rollout avoids database writes and keeps performance measurement isolated from core business flows.

## Roadmap Update (2026-04-02 Phase 7 Build Stability)
- Tuned Next.js static generation concurrency to better fit the current Supabase pooled connection limits during build.
- This reduces the risk of prerender failures caused by too many concurrent DB reads while keeping public SEO pages prerendered.

## Roadmap Update (2026-04-21 Production DB Connection Guard)
- Added a runtime guard in `lib/db.ts` so a Supabase session-pooler `DATABASE_URL` on serverless automatically switches to the transaction pooler (`6543`) and appends `pgbouncer=true`.
- Updated `prisma.config.ts` so Prisma CLI prefers `DIRECT_URL`, keeping migrations/admin tooling separate from pooled application traffic.
- Corrected the documented environment contract so production app traffic uses the transaction pooler and direct connections stay reserved for CLI workflows.

## Roadmap Update (2026-04-21 Transaction Hot Path Audit)
- Audited the busiest admin write paths and found repeated per-line `productUnit` / `product` lookups inside `sales` and `purchases` transactions.
- Batched those dependency reads up front so create/update flows reuse cached unit and product snapshots inside the same transaction instead of re-querying for every line item.
- Reused the `writeStockCard()` return value for purchase lot movements and switched sale warranty snapshot creation to `createMany()` to shorten transaction round trips without changing document, stock, or warranty logic.

## Roadmap Update (2026-04-02 Phase 7 Bundle Audit)
- Added `@next/bundle-analyzer` and a local `npm run analyze` workflow for Windows.
- Generated bundle analyzer reports under `.next/analyze/`.
- Recorded the first bundle snapshot and low-risk dependency audit in `docs/performance/bundle-analysis-2026-04-02.md`.
- No low-risk dependency removal was applied in this pass because the current source/config still references the packages that were inspected.
  - common radiator problem signs
  - how to search the storefront faster
- Added `Article` JSON-LD for knowledge articles
- Added `llms.txt` under `/public/llms.txt`
- Expanded sitemap and storefront navigation to include the knowledge section

## Roadmap Update (2026-04-02 Phase 7 Sharing + Performance)
- Added generated Open Graph image routes for key public pages:
  - `/opengraph-image`
  - `/about/opengraph-image`
  - `/faq/opengraph-image`
  - `/knowledge/opengraph-image`
  - product detail og-image
  - knowledge article og-image
- Updated page metadata to use generated OG images instead of a generic logo-only image
- Reduced unnecessary public runtime rendering by allowing the homepage to be statically generated while still using `site-config` cache invalidation from admin settings
- Added `generateStaticParams` for `/knowledge/[slug]` and knowledge article OG image routes so the knowledge section can be pre-rendered

## Roadmap Update (2026-04-02 Phase 7 Storefront Cache Tuning)
- Added cached storefront filter data for the `/products` page so category and car brand filters do not hit the database on every request
- Added cache-tag based storefront product detail caching for public product pages
- Updated admin product mutations to invalidate storefront caches after create/update/toggle so public product pages and sitemap stay fresh
- Revalidated storefront-related paths during product changes:
  - `/products`
  - `/sitemap.xml`

## Roadmap Update (2026-04-02 Phase 7 Performance Pass)
- Tightened product image upload constraints for storefront performance:
  - product uploads now allow `jpg`, `png`, `webp`
  - removed `gif` support for product images
  - reduced max product upload size to `3 MB`
- Enabled Next.js image optimization output formats:
  - `AVIF`
  - `WebP`
- Added cache TTL tuning for optimized images in `next.config.ts`
- Added cached product search results with tag-based invalidation
- Kept homepage static and added `revalidate` tuning for public product routes

## Roadmap Update (2026-04-02 Phase 7 Production Performance Measurement)
- Started production performance measurement against the live `https://www.sriwanparts.com` storefront
- Captured a mobile Lighthouse baseline for:
  - `/`
  - `/products`
  - `/faq`
  - `/knowledge`
  - one live product detail page
- Baseline report saved at `docs/performance/production-baseline-2026-04-02.md`
- Current takeaway:
  - backend document latency is already strong across the storefront
  - `/products` is the slowest public page in the current baseline
  - the largest current bottleneck is front-end LCP resource discovery on `/products`, not server response time

## Roadmap Update (2026-04-02 Phase 7 LCP Priority Pass)
- Applied explicit `fetchPriority="high"` and `loading="eager"` to the storefront's primary above-the-fold images identified as likely LCP candidates:
  - homepage hero image
  - `/products` hero image
  - product detail lead image
- Replaced deprecated Next.js `priority` usage on those images with the Next.js 16-friendly loading hints recommended by the local docs
- This pass is intentionally scoped to low-risk LCP discovery improvements before deeper client-bundle reductions on `/products`

## Roadmap Update (2026-04-02 Phase 7 Products Render Path Simplification)
- Removed the decorative hero image from `/products` and replaced it with a CSS-only banner treatment
- Kept the catalog heading and search-state summary while removing one large above-the-fold image request from the products listing page
- This pass is intended to reduce the critical render path on the slowest public storefront route before the next measurement cycle

## Roadmap Update (2026-04-02 Phase 7 Products Pagination Pass)
- Added storefront pagination to `/products` with a default page size of `24` items
- Search and filter behavior remain the same, but the initial render now ships fewer product cards and images per request
- Added preserved next/previous pagination links that keep the current search and filter state
- Marked paginated catalog states as `noindex` through the existing metadata logic by treating `page > 1` as a search-state page

## Roadmap Update (2026-04-02 Phase 7 Products DOM Reduction Pass)
- Simplified `ProductCard` so compatibility information renders as one summary line instead of multiple chips
- Updated the products filter panel to mount its detailed filter controls only when expanded
- This pass is aimed at reducing initial DOM and client-side render cost on the `/products` page while keeping the same search and filter behavior

## Roadmap Update (2026-04-02 Phase 7 Local SEO Keyword Layer)
- Expanded Phase 7 to explicitly include local SEO language for the shop's real market:
  - `อะไหล่แอร์รถยนต์`
  - `นครสวรรค์`
  - `จังหวัดนครสวรรค์`
- Added these keywords to the storefront SEO foundation in places where they fit naturally:
  - metadata defaults
  - homepage messaging
  - `/about`
  - `/faq`
  - FAQ content
  - structured data
  - `llms.txt`
- Recommended supporting keyword cluster for future content and landing-page refinement:
  - `ร้านอะไหล่แอร์รถยนต์`
  - `ร้านอะไหล่แอร์ นครสวรรค์`
  - `ร้านหม้อน้ำรถยนต์ นครสวรรค์`
  - `คอมแอร์รถยนต์`
  - `คอมเพรสเซอร์แอร์รถยนต์`
  - `อะไหล่แอร์รถยนต์ นครสวรรค์`
- Keyword usage must remain natural and trust-focused rather than repetitive or spammy.

## Roadmap Update (2026-04-02 Phase 7 Category SEO + Checklist)
- Added SEO category landing pages under `/products/[categorySlug]`
- Category pages now provide:
  - category-specific metadata
  - canonical URLs
  - `CollectionPage` JSON-LD
  - breadcrumb coverage
  - internal links into filtered catalog states
  - product previews for each category page
- Updated internal linking so storefront category cards point to category landing pages instead of query-only URLs
- Expanded sitemap coverage to include active category landing pages
- Added one more local SEO knowledge article focused on customers looking for auto AC parts in Nakhon Sawan

## Roadmap Update (2026-04-03 Phase 7 Knowledge Compatibility Expansion)
- Expanded the knowledge hub with compatibility-first content that matches real purchase conversations:
  - how to check OEM / original part numbers before ordering
  - when one AC part can or cannot fit multiple car models
  - how to photograph and compare an old part before sending it to the shop
- This pass is meant to support:
  - compatibility intent
  - OEM / part-number intent
  - faster LINE OA handoff with better customer-prepared information
- Product-level compatibility data in the catalog still remains a separate future task and is not being faked in content.

## Roadmap Update (2026-04-03 Phase 7 Shared JS + Font Tuning)
- Measured the live `/products` page again in desktop and mobile mode to isolate the current bottlenecks.
- Current finding:
  - backend response is still strong
  - mobile `/products` remains the main pain point
  - font requests and non-critical storefront client code still deserve trimming
- Applied low-risk storefront tuning:
  - reduced Google font weights to the weights actually used in the UI
  - deferred non-critical analytics reporters until idle time
  - deferred the floating LINE CTA until idle time so it no longer competes with first paint on public pages
- Applied an additional mobile filter-panel reduction pass:
  - long brand and category button lists now stay collapsed by default on small screens
  - mobile users only mount the heavier filter option groups after explicitly opening them
- The production tuning loop remains open and should be re-measured after deploy.

### Phase 7 Checklist Status
- [x] canonical + metadata base
- [x] `robots.txt`
- [x] `sitemap.xml`
- [x] `/about`
- [x] `/faq`
- [x] `/knowledge`
- [x] `llms.txt`
- [x] JSON-LD foundation
- [x] product SEO pages
- [x] category SEO pages
- [x] generated OG images for core public pages
- [x] local SEO keyword layer
- [x] initial production performance measurement
- [x] first rounds of storefront performance tuning
- [x] category-specific OG image routes
- [x] deeper content expansion for knowledge hub
- [ ] continued production measurement + tuning loop

## Roadmap Update (2026-04-03 Phase 7 URL Consolidation)
- Added stable `slug` fields to `Product` and `Category` in the database and backfilled existing rows.
- Storefront paths now prefer DB-backed slugs instead of runtime-derived names.
- Product detail canonical URLs were simplified to direct paths under `/product/[productSlug]`.
- Legacy product URLs under `/products/[categorySlug]/[productSlug]` now redirect to the direct product URL.
- Category URLs remain under `/products/[categorySlug]` with Thai-readable slug support and legacy redirect handling.
- Sitemap and internal linking were updated to use the current canonical URL shapes.

## Roadmap Update (2026-04-03 Phase 7 External Verification Complete)
- Google Search Console ownership verification is complete.
- `https://www.sriwanparts.com/sitemap.xml` was submitted successfully in Google Search Console.
- URL inspection was run on the key public storefront pages.
- Google Rich Results Test was run on the key page types:
  - home
  - faq
  - category
  - product
  - knowledge article
- Phase 7 implementation and external verification are complete.
- The remaining open item is the ongoing production measurement + tuning loop.

## Roadmap Update (2026-04-08 Phase 7 Canonical Consolidation Follow-up)
- Tightened duplicate-control for legacy product URLs under `/products/[categorySlug]/[productSlug]` so the route now acts as a redirect-only legacy entrypoint.
- The legacy product route now returns `noindex, follow` metadata alongside the canonical product URL to reduce mixed canonical signals while Google refreshes older URLs.
- `/products/search` now stays `noindex, follow` in metadata for every state and aligns its Open Graph URL with the canonical `/products` catalog page.
- This follow-up is intended to reduce "Duplicate, Google chose different canonical than user" risk while the canonical `/product/[productSlug]` URLs continue to accumulate stronger signals.

## Roadmap Update (2026-04-07 Phase 6.6 Lite Cash-Bank Progress)
- Phase 6.6 Lite is now partially implemented in code, beyond the original roadmap draft.
- The current foundation now includes schema, core movement logic, account-aware document flows, admin module surfaces, seed support, and report/export alignment work.

### Completed in code
- Added cash-bank schema foundation in `prisma/schema.prisma`
  - `CashBankAccount`
  - `CashBankMovement`
  - `CashBankTransfer`
  - `CashBankAdjustment`
  - enums for account type, source type, direction, transfer status, and adjustment status
- Added `cashBankAccountId` linkage to core money-impacting documents
  - `Sale`
  - `Receipt`
  - `Purchase`
  - `Expense`
  - `CreditNote`
- Added `Purchase.paymentStatus`
  - `UNPAID`
  - `PARTIALLY_PAID`
  - `PAID`
- Added cash-bank core utility layer
  - movement replace/rebuild logic
  - movement clear logic
  - running balance recalculation per account
  - account lookup/link helpers
- Added admin cash-bank module surfaces
  - `/admin/cash-bank`
  - `/admin/cash-bank/transfers`
  - `/admin/cash-bank/adjustments`
- Added permissions and sidebar integration for cash-bank module access
- Added seed support for default cash-bank accounts
  - `CASH-MAIN`
  - `BANK-KBANK`
  - `BANK-KTB`
- Updated `package.json` so `npm run seed` now loads `.env.local` automatically

### Core business logic now implemented
- `SALE`
  - cash sale must select a receiving cash/bank account
  - creates `IN` movement into the selected account
- `RECEIPT`
  - receipt must select a receiving cash/bank account
  - creates `IN` movement into the selected account
- `PURCHASE`
  - only `paymentStatus = PAID` is treated as real money-out in ledger
  - `UNPAID` must not create cash-bank movement
  - purchase must select a paying cash/bank account when it impactsเงินจริง
- `EXPENSE`
  - expense must select a paying cash/bank account
  - creates `OUT` movement from the selected account
- `CN_SALE`
  - only `CreditNote.settlementType = CASH_REFUND` is treated as real money-out
  - creates `OUT` movement from the selected account
  - `CREDIT_DEBT` remains document/AR logic, not cash out
- `TRANSFER`
  - transfer creates 2 linked movements in one flow
  - source account `OUT`
  - destination account `IN`
- `ADJUSTMENT`
  - adjustment supports direct in/out movement against an account
  - intended for opening correction, cash difference, bank fee, manual adjustment cases

### Critical ledger rules that must remain true
- `CashBankMovement` is the source of truth for cash/bank card movement.
- Every movement must carry at least:
  - `accountId`
  - `txnDate`
  - `direction`
  - `amount`
  - `balanceAfter`
  - `sourceType`
  - `sourceId`
  - `referenceNo`
  - `note`
- Document change rules:
  - add document -> create or replace movement entries
  - edit document -> clear old movement for that source, rebuild new movement, then recalculate balances
  - cancel document -> clear movement for that source, then recalculate affected account balances
- Cash/bank cards must always be recalculated after any add/edit/cancel that affects money.
- Running balance must come from ordered ledger movement, not from ad hoc report summation.
- `paymentMethod` alone must never be treated as the bank/cash account identity.
- `accountId` is the account identity; `paymentMethod` is only the payment channel label.

### Validation and safety rules now added
- Cash-bank account validation
  - `BANK` accounts require `bankName`
  - `BANK` accounts require `accountNo`
  - opening date must be valid
- Transfer validation
  - source and destination accounts cannot be the same
  - amount must be greater than zero
  - cancel requires a reason
- Adjustment validation
  - account is required
  - amount must be greater than zero
  - reason is required
  - cancel requires a reason
- Seed logic now skips admin creation if seed admin env vars are not provided, but still creates default cash-bank accounts

### Reporting work completed
- Added reusable cash-bank snapshot component for summary and print reports
- Updated summary report and print report to show cash/bank snapshot
- Updated report data layer so daily receipt/payment summaries can carry account-aware data
- Daily receipt summary now supports
  - `SALE`
  - `RECEIPT`
  - account name
- Daily payment summary now supports
  - `PURCHASE`
  - `EXPENSE`
  - `CN_SALE`
  - account name
  - `creditNoteRefundAmount`

### Export alignment completed
- CSV and Excel export flows under:
  - `/admin/reports/export`
  - `/admin/reports/export-excel`
- Export datasets now align more closely with current cash-bank logic:
  - receipts export includes account
  - payments export includes account
  - daily receipt export includes account
  - daily payment export includes account
  - sales export now includes payment method and account
  - purchases export now includes payment status, payment method, and account
  - credit note export now includes refund method and account
- Excel layouts were updated so added columns still keep correct total-row positions

### Seed and environment note
- `npm run seed` should now be the standard command for this repo.
- It runs:
  - `npx tsx --env-file=.env.local prisma/seed.ts`
- This avoids the previous problem where `npm run seed` did not automatically load `.env.local`.

### Still open after the current coding pass
- Back-office polish
  - final validation wording across all related forms
  - transfer / adjustment sub-pages and related manager copy should be reviewed for final consistency

### Current implementation order from this point
- [x] Schema foundation
- [x] Core cash-bank utility logic
- [x] Document linkage for `SALE`, `RECEIPT`, `PURCHASE`, `EXPENSE`, `CN_SALE`
- [x] Cash-bank admin module shell
- [x] Transfer module
- [x] Adjustment module
- [x] Seed default accounts
- [x] Summary/print cash-bank snapshot
- [x] Main CSV/Excel export alignment for account/source fields
- [x] Final summary CSV cleanup in `lib/reports.ts`
- [x] Cash-bank ledger report page
- [x] Transfer history report
- [x] Adjustment history report
- [x] Staff usage guide and final UX polish

### Phase 6.6 Lite checklist status snapshot

#### Completed
- [x] Cash-bank schema foundation
- [x] `CashBankAccount`
- [x] `CashBankMovement`
- [x] `CashBankTransfer`
- [x] `CashBankAdjustment`
- [x] Cash-bank enums for account type, source type, direction, and statuses
- [x] `cashBankAccountId` linkage on `Sale`, `Receipt`, `Purchase`, `Expense`, `CreditNote`
- [x] `Purchase.paymentStatus`

- [x] Core movement utility layer
- [x] Replace movement by source
- [x] Clear movement by source
- [x] Recalculate running balance by account
- [x] Use movement as source of truth for cash/bank card

- [x] Document linkage in working code
- [x] `SALE` cash sale
- [x] `RECEIPT`
- [x] `PURCHASE` where `paymentStatus = PAID`
- [x] `EXPENSE`
- [x] `CN_SALE` for `CreditNote.settlementType = CASH_REFUND`

- [x] Critical add/edit/cancel ledger rules in working code
- [x] Add document -> create movement
- [x] Edit document -> clear old movement and rebuild
- [x] Cancel document -> clear movement and recalculate
- [x] Recalculate affected account balances after document change

- [x] Admin cash-bank module shell
- [x] `/admin/cash-bank`
- [x] `/admin/cash-bank/transfers`
- [x] `/admin/cash-bank/adjustments`
- [x] Permission integration
- [x] Sidebar integration

- [x] Transfer logic
- [x] `OUT` from source account
- [x] `IN` to destination account
- [x] Cancel transfer and rebuild balances

- [x] Adjustment logic
- [x] Direct `IN` / `OUT` movement
- [x] Reason validation
- [x] Permission-aware create/edit/cancel flow

- [x] Validation improvements
- [x] `BANK` account requires `bankName`
- [x] `BANK` account requires `accountNo`
- [x] Transfer cannot use the same source/destination account
- [x] Amount must be greater than zero
- [x] Cancel transfer requires a reason
- [x] Cancel adjustment requires a reason

- [x] Seed support
- [x] Default account seed logic
- [x] `CASH-MAIN`
- [x] `BANK-KBANK`
- [x] `BANK-KTB`
- [x] `npm run seed` now loads `.env.local`

- [x] Summary/print reporting integration
- [x] Cash-bank snapshot component
- [x] Summary report shows cash-bank snapshot
- [x] Print report shows cash-bank snapshot
- [x] Snapshot drill-down links to `/admin/cash-bank/ledger`
- [x] Daily receipt summary carries account information
- [x] Daily payment summary carries account information
- [x] Daily payment summary includes `CN_SALE` refund amount

- [x] CSV/Excel export alignment
- [x] Receipts export includes account
- [x] Payments export includes account
- [x] Daily receipt export includes account
- [x] Daily payment export includes account
- [x] Sales export includes payment method and account
- [x] Purchases export includes payment status, payment method, and account
- [x] Credit note export includes refund method and account
- [x] Excel total-row positions updated to match added columns

- [x] Dedicated cash-bank reporting
- [x] Full cash-bank ledger report page
- [x] Transfer history report
- [x] Adjustment history report
- [x] Report tab navigation for cash-bank reports
- [x] CSV/Excel export support for new cash-bank report types
- [x] `lib/reports` / `lib/report-queries` cleanup for ledger-based vs document-based reporting

- [x] Latest `npm run build` passes after these changes

#### Still open
- [x] Final text/encoding cleanup in older report UI surfaces
- [x] Staff usage guide / back-office operating notes

## Roadmap Update (2026-04-07 Supplier AP + Advance Redesign)

> **สถานะปัจจุบัน:** approved design + schema foundation started
> **หลักการ:** ฝั่ง supplier ต้อง mirror logic ฝั่งขายให้มากที่สุด
> `Receipt` ฝั่งขาย = `SupplierPayment` ฝั่งซื้อ
> **ตัด `SupplierAdvanceApply` ออก**
> เงินมัดจำจะถูก apply ผ่าน `SupplierPaymentItem` เท่านั้น

### ข้อตกลงที่ผ่านการตัดสินใจแล้ว

| ประเด็น | ข้อตกลง |
| --- | --- |
| เงินมัดจำ supplier | ใช้เอกสาร `SupplierAdvance` แยกจาก `Purchase` เสมอ |
| การตัดใช้เงินมัดจำ | ไม่สร้าง `SupplierAdvanceApply` |
| เอกสาร apply กลาง | ใช้ `SupplierPayment` เป็นตัว apply `Purchase`, `PurchaseReturn(SUPPLIER_CREDIT)`, และ `SupplierAdvance` |
| การผูก supplier | เอกสารใน `SupplierPayment` ต้องเป็น supplier เดียวกันทั้งหมด |
| ซื้อสินค้า | เพิ่ม `Purchase.purchaseType = CASH_PURCHASE / CREDIT_PURCHASE` |
| ซื้อสด | เงินออกที่ `Purchase` ทันที และ `amountRemain = 0` |
| ซื้อเชื่อ | ไม่กระทบ cash/bank ตอนรับสินค้า และไปรับชำระที่ `SupplierPayment` |
| คืนสินค้าซัพพลายเออร์ | เพิ่ม `settlementType = CASH_REFUND / SUPPLIER_CREDIT` |
| CN ซื้อแบบคืนเงิน | เป็นเงิน **เข้า** เรา ไม่ใช่เงินออก |
| CN ซื้อแบบตั้งเครดิต | ไม่กระทบ cash/bank ทันที และใช้หักใน `SupplierPayment` |

### สูตร amountRemain ที่ต้องใช้ต่อจากนี้

> ให้ copy logic จากฝั่งขายและ CN ขาย โดยเปลี่ยนเอกสารอ้างอิงเป็นฝั่ง supplier

- `Sale.amountRemain = netAmount - sum(active ReceiptItem.saleId)`
- `CreditNote.amountRemain = totalAmount - sum(active ReceiptItem.cnId)` เฉพาะ `CREDIT_DEBT`

ฝั่ง supplier:

- `Purchase.amountRemain = netAmount - sum(active SupplierPaymentItem.purchaseId)`
- `PurchaseReturn.amountRemain = totalAmount - sum(active SupplierPaymentItem.purchaseReturnId)` เฉพาะ `settlementType = SUPPLIER_CREDIT`
- `SupplierAdvance.amountRemain = totalAmount - sum(active SupplierPaymentItem.advanceId)`

กติกา:

- `CASH_PURCHASE` ต้องมี `amountRemain = 0` เสมอ
- `PurchaseReturn.settlementType = CASH_REFUND` ต้องมี `amountRemain = 0` เสมอ
- เอกสาร `CANCELLED` ทุกประเภทต้องมี `amountRemain = 0`
- ทุกบรรทัดใน `SupplierPaymentItem` ใช้ได้ไม่เกิน `amountRemain` ล่าสุดของเอกสารปลายทาง

### เอกสารหลักใน design ใหม่

#### 1. Purchase

- หน้าที่: รับสินค้าเข้า + VAT + stock movement
- เพิ่ม `purchaseType`
- ใช้ `amountRemain` จริงทั้งซื้อสดและซื้อเชื่อ
- `paymentStatus` ต้อง derive จาก `amountRemain` และสถานะการชำระจริง
- cash movement เกิดที่:
  - `Purchase` เอง เมื่อ `purchaseType = CASH_PURCHASE`
  - `SupplierPayment` เมื่อ `purchaseType = CREDIT_PURCHASE`

#### 2. SupplierAdvance

- หน้าที่: จ่ายมัดจำหรือจ่ายล่วงหน้า supplier ก่อนรับสินค้า
- ไม่กระทบ stock
- กระทบ cash/bank ทันที (เงินออก)
- ยอดคงเหลือเก็บที่ `amountRemain`
- ใช้หักได้เฉพาะ supplier เดียวกันผ่าน `SupplierPayment`

#### 3. PurchaseReturn

- หน้าที่: คืนสินค้า supplier + RETURN_OUT + VAT
- เพิ่ม settlement 2 แบบ:
  - `CASH_REFUND` = supplier คืนเงินจริงเข้ามา
  - `SUPPLIER_CREDIT` = เก็บเครดิตไว้หักตอนจ่าย supplier รอบถัดไป
- `SUPPLIER_CREDIT` ต้องมี `amountRemain`
- `CASH_REFUND` ต้องสร้าง cash/bank movement ฝั่ง `IN`

#### 4. SupplierPayment

- หน้าที่: mirror หน้า `Receipt`
- ใช้ชำระ / net off เอกสาร supplier
- ดึงเอกสารได้ 3 ประเภท:
  - `Purchase` ค้างจ่าย
  - `PurchaseReturn` แบบ `SUPPLIER_CREDIT`
  - `SupplierAdvance` คงเหลือ
- สูตรเงินสดจริง:
  - `totalCashPaid = sum(Purchase) - sum(PurchaseReturn SUPPLIER_CREDIT) - sum(SupplierAdvance)`
- ถ้า `totalCashPaid > 0` ต้องเลือก cash/bank account
- ถ้า `totalCashPaid = 0` ให้บันทึกได้แบบ net off
- ถ้า `totalCashPaid < 0` ไม่ให้บันทึก

### Schema foundation ที่ต้องมี

- `Purchase.purchaseType`
- `PurchaseReturn.settlementType`
- `PurchaseReturn.refundMethod`
- `PurchaseReturn.amountRemain`
- `PurchaseReturn.cashBankAccountId`
- model `SupplierAdvance`
- model `SupplierPayment`
- model `SupplierPaymentItem`
- cash/bank source ใหม่:
  - `CN_PURCHASE`
  - `SUPPLIER_ADVANCE`
  - `SUPPLIER_PAYMENT`

### จุดที่กระทบของเดิม

#### Purchase flow

- `app/admin/(protected)/purchases/actions.ts`
  - ต้องเลิก block partial payment
  - ต้องแยก flow `CASH_PURCHASE` vs `CREDIT_PURCHASE`
  - ต้องคำนวณ `amountRemain` แบบใหม่
  - cash movement ของ `CREDIT_PURCHASE` ต้องย้ายไป `SupplierPayment`

#### Purchase Return flow

- `app/admin/(protected)/purchase-returns/actions.ts`
  - เพิ่ม settlement logic แบบ mirror `CreditNote`
  - `CASH_REFUND` ต้องเป็นเงินเข้า cash/bank
  - `SUPPLIER_CREDIT` ต้องคำนวณ `amountRemain`
  - ยกเลิกเอกสารต้อง reverse เครดิต/ledger ให้ครบ

#### Amount remain utility

- `lib/amount-remain.ts`
  - เพิ่ม helper:
    - `recalculatePurchaseAmountRemain`
    - `recalculatePurchaseReturnAmountRemain`
    - `recalculateSupplierAdvanceAmountRemain`
  - สูตรต้องยึด pattern เดียวกับ `Sale` และ `CreditNote`

#### Running number / doc number

- `lib/doc-number.ts`
  - เพิ่ม running number สำหรับ:
    - `SupplierAdvance`
    - `SupplierPayment`
  - ปรับ prefix logic สำหรับ `Purchase` cash/credit ให้ mirror sale

#### Cash / Bank

- `lib/cash-bank.ts`
  - เพิ่ม source support:
    - `CN_PURCHASE`
    - `SUPPLIER_ADVANCE`
    - `SUPPLIER_PAYMENT`
- `lib/cash-bank-links.ts`
  - เพิ่ม label / route mapping สำหรับเอกสารใหม่
- `lib/cash-bank-report-queries.ts`
  - ledger ต้อง drill down ไปเอกสารใหม่ได้

#### Permissions / Routes / Sidebar

- `lib/access-control.ts`
  - เพิ่ม permission ใหม่สำหรับ:
    - supplier advances
    - supplier payments
  - เพิ่ม route rules
- `AdminSidebar.tsx`
  - เพิ่มเมนูตาม permission
- ทุก page / action ใหม่ต้องใช้ `requirePermission()`

#### Reports / Dashboard / Export

- `lib/report-queries.ts`
  - รายงาน register ต้องรองรับเอกสารใหม่
  - รายงานจ่ายเงินต้องเปลี่ยนจากดู `Purchase.paymentStatus = PAID` อย่างเดียว
  - ต้องรวม `SupplierAdvance` และ `SupplierPayment`
- `lib/reports.ts`
  - summary ต้องเพิ่มฝั่งเจ้าหนี้/เครดิต/มัดจำ
- `app/admin/(protected)/page.tsx`
  - dashboard ต้องเพิ่ม cards ใหม่
- `reports/export` และ `reports/export-excel`
  - ต้องเพิ่ม/ปรับ export datasets และ column

### รายงานที่ต้องมี / ต้องแก้

#### รายงานใหม่

- รายงานเงินมัดจำ supplier คงเหลือ ณ วันที่
- รายงานเจ้าหนี้คงค้าง ณ วันที่
- รายงานเครดิต CN ซื้อคงเหลือ ณ วันที่
- รายงานฐานะสุทธิ supplier ณ วันที่
  - `เจ้าหนี้คงค้าง - เงินมัดจำคงเหลือ - เครดิต CN ซื้อคงเหลือ`

#### รายงานเดิมที่ต้องขยาย

- รายงานซื้อ
  - แสดง `purchaseType`, `paymentStatus`, `amountRemain`
- รายงานจ่ายเงิน
  - รวม `Purchase` ซื้อสด
  - รวม `SupplierAdvance`
  - รวม `SupplierPayment`
- รายงานรับเงิน
  - ต้องรองรับ `PurchaseReturn(CASH_REFUND)` เป็นเงินเข้า
- Cash / Bank Ledger
  - drill down source ใหม่ครบ
- Summary report / print report / CSV / Excel
  - เพิ่ม A/P
  - เพิ่ม supplier advance outstanding
  - เพิ่ม purchase return supplier credit outstanding
  - เพิ่มผลรวม cash in จาก `CN_PURCHASE`
  - เพิ่มผลรวม cash out จาก `SUPPLIER_ADVANCE` และ `SUPPLIER_PAYMENT`

### Dashboard ที่ต้องเพิ่ม / แก้

- [x] Card: เจ้าหนี้คงค้าง (A/P)
- [x] Card: เงินมัดจำ supplier คงเหลือ
- [x] Card: เครดิต CN ซื้อคงเหลือ
- [x] ปรับ daily cash-in ให้รวม `PurchaseReturn(CASH_REFUND)`
- [x] ปรับ daily cash-out ให้รวม `SupplierAdvance` และ `SupplierPayment`

## Supplier AP Implementation Checklist

อัปเดตล่าสุด: `2026-04-08`

### เสร็จแล้ว

- [x] วาง schema foundation สำหรับฝั่ง Supplier AP
  - เพิ่ม `Purchase.purchaseType`
  - เพิ่ม `PurchaseReturn.settlementType`, `refundMethod`, `amountRemain`, `cashBankAccountId`
  - เพิ่ม model `SupplierAdvance`, `SupplierPayment`, `SupplierPaymentItem`
  - เพิ่ม cash/bank source ใหม่ `CN_PURCHASE`, `SUPPLIER_ADVANCE`, `SUPPLIER_PAYMENT`

- [x] ปรับสูตร `amountRemain` ตาม logic ล่าสุด
  - `Purchase.amountRemain = netAmount - sum(active SupplierPaymentItem.purchaseId)`
  - `PurchaseReturn.amountRemain = totalAmount - sum(active SupplierPaymentItem.purchaseReturnId)` เฉพาะ `settlementType = SUPPLIER_CREDIT`
  - `SupplierAdvance.amountRemain = totalAmount - sum(active SupplierPaymentItem.advanceId)`

- [x] เพิ่ม running number และ cash/bank source mappings
  - running number สำหรับ `ADV`, `PAY`, และ prefix `RR` / `RRC`
  - เชื่อม source ใหม่ใน cash/bank link และ report query ที่เกี่ยวข้อง

- [x] refactor หน้า `ซื้อสินค้า` ให้ใช้ `purchaseType` แทน `paymentStatus`
  - ตัด UI `สถานะการชำระเงิน`
  - `ซื้อสด` ต้องเลือก `บัญชีจ่ายเงิน`
  - `ซื้อเชื่อ` ซ่อน `บัญชีจ่ายเงิน`
  - form submit ส่งเฉพาะ `purchaseType` + `cashBankAccountId`

- [x] ปรับ server action ของ `Purchase` ให้ derive ค่าจาก `purchaseType`
  - derive `paymentStatus` จาก `purchaseType`
  - derive `paymentMethod` จากบัญชีเงินสด/ธนาคารเมื่อเป็น `CASH_PURCHASE`
  - `CASH_PURCHASE` กำหนด `amountRemain = 0`
  - `CREDIT_PURCHASE` ยังไม่เกิด cash movement ตอนรับสินค้า และไปชำระภายหลังผ่าน `SupplierPayment`

- [x] ปรับ purchase flow ที่กระทบแล้ว
  - `app/admin/(protected)/purchases/new/PurchaseForm.tsx`
  - `app/admin/(protected)/purchases/actions.ts`
  - `app/admin/(protected)/purchases/[id]/edit/page.tsx`
  - `app/admin/(protected)/purchases/page.tsx`
  - `app/admin/(protected)/purchases/[id]/page.tsx`

- [x] ปรับ report / export / dashboard alignment ที่กระทบจาก purchase cash vs credit
  - `lib/report-queries.ts` ให้ purchase register และ daily payment ดู `purchaseType = CASH_PURCHASE` แทน `paymentStatus = PAID`
  - `lib/reports.ts` ปรับ daily payments summary ให้ใช้ logic ใหม่
  - `app/admin/(protected)/reports/purchases/page.tsx` ปรับ dataset เป็น `purchaseType`
  - `app/admin/(protected)/reports/export-excel/route.ts` ปรับ export column จาก `Payment Status` เป็น `Purchase Type`

- [x] ตรวจสอบ build หลัง refactor รอบล่าสุด
  - `npm run build` ผ่าน

### คิวถัดไป

- [x] ทำโมดูล `SupplierAdvance`
  - หน้า list / create / detail / edit (loading.tsx ครบทุก segment)
  - cash/bank movement เงินออก (SUPPLIER_ADVANCE source type)
  - คำนวณ `amountRemain` ผ่าน `recalculateSupplierAdvanceAmountRemain`
  - Reference chain check: ป้องกันแก้ไข/ยกเลิกถ้ามี SupplierPayment active อ้างถึง

- [x] refactor `PurchaseReturn` ให้รองรับ `CASH_REFUND` / `SUPPLIER_CREDIT`
  - `CASH_REFUND` = เงินเข้า cash/bank (CN_PURCHASE source type)
  - `SUPPLIER_CREDIT` = เก็บเครดิตไว้หักใน `SupplierPayment`, `amountRemain` = totalAmount
  - คำนวณ `amountRemain` ผ่าน `recalculatePurchaseReturnAmountRemain` ตอน cancel

- [x] ทำโมดูล `SupplierPayment`
  - หน้า list / create / detail / edit (loading.tsx ครบทุก segment)
  - ดึง `Purchase`, `PurchaseReturn(SUPPLIER_CREDIT)`, `SupplierAdvance` ของ supplier เดียวกัน
  - คำนวณ `totalCashPaid = sum(Purchase) - sum(PurchaseReturn SUPPLIER_CREDIT) - sum(SupplierAdvance)`
  - validate ต่อบรรทัดไม่เกิน `amountRemain` ของเอกสารปลายทาง
  - cash/bank movement เงินออก เฉพาะกรณี `totalCashPaid > 0`

- [x] เพิ่ม permissions / routes / sidebar สำหรับ Supplier AP modules
  - permission keys: `supplier_advances.*`, `supplier_payments.*` ครบ
  - ADMIN_ROUTE_RULES: `/admin/supplier-advances`, `/admin/supplier-payments`
  - AdminSidebar: เงินมัดจำซัพพลายเออร์, จ่ายชำระซัพพลายเออร์

- [x] ขยาย reports / export สำหรับ A/R และ A/P เบื้องต้น (เสร็จแล้ว — 2026-04-08)
  - [x] รายงานลูกหนี้ค้างชำระ (A/R) — `/admin/reports/ar` — filter วันที่ + ลูกค้า, CSV + Excel
  - [x] รายงานเจ้าหนี้คงค้าง (A/P) — `/admin/reports/ap` — filter วันที่ + supplier, 3 sections (ซื้อเชื่อ / มัดจำ / CN เครดิต), CSV + Excel
  - [x] รายงาน Stock คงเหลือ — `/admin/reports/stock` — filter หมวดหมู่ + ค้นหา, CSV + Excel
  - [x] dashboard cards: A/P, supplier advance outstanding, purchase return supplier credit outstanding
  - [x] ปรับ daily cash-in ให้รวม `PurchaseReturn(CASH_REFUND)` ใน summary report
  - [x] ปรับ daily cash-out ให้รวม `SupplierAdvance` และ `SupplierPayment` ใน summary report

### หมายเหตุการติดตามงาน

- [x] ใช้ checklist นี้เป็นตัวบอกสถานะปัจจุบันแทนการ append log ต่อท้าย
- [x] งานที่เสร็จแล้วต้องย้ายมาอยู่ใต้ `เสร็จแล้ว`
- [ ] งานที่เริ่มทำรอบถัดไปให้ย้ายมาอยู่หัวข้อ `กำลังทำ` หากต้องการติดตามละเอียดขึ้น

---

## Roadmap Update (2026-04-08 — Purchase Return Type / Credit Term / AR-AP-Stock Reports)

### สิ่งที่ implement เสร็จในรอบนี้

#### 1. PurchaseReturn Type System

เพิ่ม enum `PurchaseReturnType` (RETURN | DISCOUNT | OTHER) ใน schema และผูกกับ `PurchaseReturn.type`:

- [x] Schema: `enum PurchaseReturnType { RETURN DISCOUNT OTHER }` + field `type PurchaseReturnType @default(RETURN)` ใน `PurchaseReturn`
- [x] `prisma db push` สำเร็จ
- [x] `PurchaseReturnForm.tsx` — UI เลือก type แบบ 3-button toggle ก่อนส่วน settlementType
- [x] Business logic: `type = RETURN` → deduct stock + lot เหมือนเดิม; `DISCOUNT` / `OTHER` → ข้าม stock/lot ทั้งหมด
- [x] Cancel: ตรวจ `ret.type === RETURN` ก่อน reverse stock — ไม่ reverse ถ้าเป็น DISCOUNT/OTHER
- [x] Update: ตรวจ `oldHadStock` ก่อน decide ว่าต้อง reverse ชุดเก่าหรือไม่
- [x] Detail page: แสดง label ของ type ที่เลือก
- [x] Edit page: ส่ง `type: ret.type` เข้า initialData

#### 2. Customer creditTerm

- [x] Schema: `creditTerm Int?` บน `Customer` model
- [x] `prisma db push` สำเร็จ
- [x] `CustomerForm.tsx` — เพิ่ม input field creditTerm (จำนวนวัน)
- [x] `customers/actions.ts` — validate + save `creditTerm` ทั้ง create และ update

#### 3. Sale creditTerm

- [x] Schema: `creditTerm Int?` บน `Sale` model
- [x] `prisma db push` สำเร็จ
- [x] `SaleForm.tsx` — auto-fill จาก customer ที่เลือก, แก้ไขได้, state `creditTerm`
- [x] `sales/new/page.tsx` — ดึง `creditTerm: true` จาก customer
- [x] `sales/[id]/edit/page.tsx` — ส่ง `creditTerm: sale.creditTerm ?? null` เข้า initialData
- [x] `sales/actions.ts` — validate + save `creditTerm` ทั้ง create และ update

#### 4. Browser Tab Titles

- [x] `supplier-advances/page.tsx` — เพิ่ม `export const metadata = { title: "เงินมัดจำซัพพลายเออร์" }`
- [x] `supplier-payments/page.tsx` — เพิ่ม `export const metadata = { title: "จ่ายชำระซัพพลายเออร์" }`

#### 5. Reports — No-Query-on-Open Pattern

เพิ่ม `hasFilter: boolean` ใน filter types และเปลี่ยน query เป็น conditional:

- [x] `lib/report-queries.ts` — เพิ่ม `hasFilter: !!(params.from || params.to)` ใน `parseReportQueryFilters`
- [x] `lib/cash-bank-report-queries.ts` — เพิ่ม `hasFilter` ใน `parseCashBankReportFilters`
- [x] ทุกหน้า report (sales, purchases, credit-notes, receipts, payments) — conditional query + empty state
- [x] ทุกหน้า cash-bank report (ledger, transfers, adjustments) — conditional query + empty state

#### 6. Reports — ปรับ Summary

- [x] `ReportsContent.tsx` — ลบ VAT Summary card ออก, ปรับหัว section จาก "Tax & Stock" เป็น "Stock"

#### 7. Reports — 3 Tab ใหม่ (AR / AP / Stock)

- [x] `ReportTabNav.tsx` — เพิ่ม tab: ลูกหนี้ (AR), เจ้าหนี้ (AP), Stock คงเหลือ
- [x] `lib/ar-ap-stock-report-queries.ts` (ไฟล์ใหม่) — ครอบคลุม:
  - `ARAPStockFilters` type + `parseARAPStockFilters()` (date defaults: 1st of month → today)
  - `ARRow` + `queryARRows()` — query CREDIT_SALE ที่ amountRemain > 0
  - `buildARCsv()` + `buildARExcel()` — CSV (BOM) + Excel (.xlsx)
  - `APData` + `queryAPData()` — query purchases/advances/cnCredits แบบ parallel
  - `buildAPCsv()` — 3 sections ในไฟล์เดียว
  - `buildAPExcel()` — 3 worksheets ในไฟล์เดียว
  - `StockRow` + `queryStockRows()` — query products พร้อม categoryName + stockValue
  - `buildStockCsv()` + `buildStockExcel()`

#### 8. AR Report Page (`/admin/reports/ar`)

- [x] ใช้ `parseARAPStockFilters` — date input pre-filled ด้วย 1st of month / today
- [x] ใช้ `queryARRows` จาก lib
- [x] filter: ช่วงวันที่ + ลูกค้า
- [x] summary cards: จำนวนเอกสาร, ยอดขายรวม, ยอดค้างชำระรวม
- [x] ตาราง: เลขที่, วันที่, ลูกค้า, ยอดขาย, ค้างชำระ, เครดิต (วัน), link เปิดเอกสาร
- [x] ปุ่ม CSV + Excel export

#### 9. AP Report Page (`/admin/reports/ap`)

- [x] ใช้ `parseARAPStockFilters` — date defaults เหมือน AR
- [x] ใช้ `queryAPData` จาก lib
- [x] filter: ช่วงวันที่ + supplier
- [x] summary cards: ค้างจ่าย, มัดจำคงเหลือ, CN เครดิต, ยอดสุทธิ
- [x] 3 ตาราง: ค้างจ่ายซัพพลายเออร์ / มัดจำคงเหลือ / CN เครดิตคงเหลือ
- [x] ปุ่ม CSV + Excel export (AP Excel = 3 worksheets)

#### 10. Stock Report Page (`/admin/reports/stock`)

- [x] ใช้ `queryStockRows` จาก lib
- [x] filter: ค้นหา + หมวดหมู่ + รวมสต็อก 0
- [x] summary cards: จำนวน SKU, มูลค่าสต็อกรวม, สต็อก 0
- [x] ตาราง: รหัส, ชื่อสินค้า, หมวดหมู่, สต็อก, ต้นทุนเฉลี่ย, มูลค่า (highlight ใกล้ขั้นต่ำ)
- [x] ปุ่ม CSV + Excel export

#### 11. Export Routes อัพเดท

- [x] `reports/export/route.ts` — เพิ่ม params: customerId, supplierId, categoryId, search, showAll + cases: `ar`, `ap`, `stock`
- [x] `reports/export-excel/route.ts` — เพิ่ม params เดียวกัน + cases: `ar`, `ap`, `stock`

---

## Roadmap Update (2026-04-08 - Audit Fix Checklist)

> สรุปรายการจาก code audit รอบ logic หลัก: stock mavg, stock lot, AR/AP, cash-bank, document reference, warranty, claim, delivery
> เป้าหมาย: แก้ bug และเพิ่ม guard โดยไม่เปลี่ยน business logic เดิมของระบบ

### A. จุดหลัก (แก้ก่อน)

- [x] AR / Receipt: ปิดช่อง over-apply และอ้างอิงเอกสารผิด
  แนวทางแก้ไข: เพิ่ม server-side validation ตอน create/update ให้ตรวจ `saleId` / `cnId` ว่า `ACTIVE`, เป็นลูกค้าคนเดียวกัน, และ `paidAmount` รวมต่อเอกสารไม่เกิน outstanding ปัจจุบัน
  ไฟล์หลัก: `app/admin/(protected)/receipts/actions.ts`, `lib/amount-remain.ts`

- [x] Cash-bank: cancel `CreditNote(CASH_REFUND)` ต้อง reverse movement
  แนวทางแก้ไข: เรียก `clearCashBankSourceMovements(tx, CashBankSourceType.CN_SALE, cn.id)` ก่อน set status = `CANCELLED`
  ไฟล์หลัก: `app/admin/(protected)/credit-notes/actions.ts`

- [x] Stock lot: `PurchaseReturn` ต้องกันการตัด lot เกินคงเหลือ
  แนวทางแก้ไข: เพิ่ม availability guard ก่อน `writePurchaseReturnLots` และ throw error เมื่อ lot ไม่พอ แทนการปล่อยให้ clamp เป็น `0`
  ไฟล์หลัก: `app/admin/(protected)/purchase-returns/actions.ts`, `lib/lot-control.ts`

- [x] Stock lot: `Stock Adjustment OUT` ต้องกันการตัด lot เกินคงเหลือ
  แนวทางแก้ไข: เพิ่ม availability guard ก่อน `writeAdjustmentLots` สำหรับ direction = `out`
  ไฟล์หลัก: `app/admin/(protected)/stock/adjustments/actions.ts`, `lib/lot-control.ts`

- [x] Warranty Claim: `CUSTOMER_WAIT` ตอนปิดเคลม `RECEIVED` ต้องส่งของออกให้ลูกค้าที่รออยู่ด้วย
  แนวทางแก้ไข: ตอน `closeClaim(outcome=RECEIVED)` ถ้า `claimType = CUSTOMER_WAIT` ให้สร้าง `CLAIM_REPLACE_OUT` เพิ่มอีก 1 movement พร้อม lot movement ที่เกี่ยวข้อง เพื่อให้ net stock = 0 ตาม roadmap
  ไฟล์หลัก: `app/admin/(protected)/warranty-claims/actions.ts`

### B. จุดรอง (Hardening / Validation)

- [x] Document reference: `CreditNote` และ `PurchaseReturn` ต้อง re-validate source document ฝั่ง server
  แนวทางแก้ไข: ตอน create/update ตรวจ `saleId` / `purchaseId` ว่าเอกสารต้นทาง `ACTIVE` และสัมพันธ์กับ customer/supplier เดียวกันจริงก่อนบันทึก
  ไฟล์หลัก: `app/admin/(protected)/credit-notes/actions.ts`, `app/admin/(protected)/purchase-returns/actions.ts`

- [x] Warranty Claim: ต้อง validate ว่า warranty ยังอยู่ในช่วงประกันและยังไม่มี active claim ค้างอยู่
  แนวทางแก้ไข: เพิ่ม check `endDate >= today` และไม่ให้สร้าง claim ถ้ามี claim status != `CANCELLED`
  ไฟล์หลัก: `app/admin/(protected)/warranty-claims/actions.ts`

- [x] Warranty manual create: ต้องผูก snapshot ให้สอดคล้องกับ claim flow ปัจจุบัน
  แนวทางแก้ไข: ไม่เชื่อ `saleId` จาก payload ตรงๆ ให้ derive จาก `saleItem`; ถ้าเป็นสินค้าคุม lot ต้องเติม `lotNo` snapshot หรือ block manual create สำหรับกรณีที่ derive lot ไม่ได้
  ไฟล์หลัก: `app/admin/(protected)/warranties/actions.ts`

- [x] Delivery: `updateShippingStatus` ต้องมี server-side guard เท่ากับหน้า UI
  แนวทางแก้ไข: ตรวจว่า sale เป็น `ACTIVE`, `fulfillmentType = DELIVERY`; ถ้า `shippingMethod` เป็น carrier ภายนอกต้องมี `trackingNo`; reject การอัปเดตเอกสารที่ไม่เข้าเงื่อนไข
  ไฟล์หลัก: `app/admin/(protected)/sales/actions.ts`

### C. เชิงโครงสร้าง / Performance (ไม่เปลี่ยน logic หลัก)

- [x] ลด N+1 query ตอนดึง lot detail ในทุกฟอร์มที่ใช้ lot
  แนวทางแก้ไข: เปลี่ยนจาก loop `findUnique/findFirst` ต่อ lot เป็น bulk fetch `productLot` / `lotBalance` แล้ว map ใน memory
  ไฟล์หลัก: `app/admin/(protected)/sales/actions.ts`, `app/admin/(protected)/purchase-returns/actions.ts`, `app/admin/(protected)/stock/adjustments/actions.ts`, `app/admin/(protected)/warranty-claims/actions.ts`

- [x] preload `product` และ `productUnit` ก่อนเข้าลูปใน document line items
  แนวทางแก้ไข: ดึง `productId in [...]` และ `(productId, unitName)` ที่ใช้ทั้งหมดครั้งเดียว แล้วทำ map ใน memory แทน query ต่อ item
  ไฟล์หลัก: `app/admin/(protected)/sales/actions.ts`, `app/admin/(protected)/purchase-returns/actions.ts`, `app/admin/(protected)/stock/adjustments/actions.ts`, `app/admin/(protected)/credit-notes/actions.ts`

- [x] ให้ `writeStockCard()` คืน `stockCardId` กลับมาเพื่อตัด query `findFirst` ซ้ำ
  แนวทางแก้ไข: ปรับ helper ให้ return row id ที่เพิ่งสร้าง แล้วส่งต่อเข้า `writeStockMovementLots()` ได้ทันที
  ไฟล์หลัก: `lib/stock-card.ts`, จุดเรียกใช้ใน `sales/actions.ts`, `purchase-returns/actions.ts`, `credit-notes/actions.ts`, `warranty-claims/actions.ts`, `stock/adjustments/actions.ts`

- [x] ทำ utility validation กลางให้ AR ใช้ pattern เดียวกับ AP
  แนวทางแก้ไข: ใช้แนวเดียวกับ `SupplierPayment.validatePaymentItemsAgainstAvailable()` มาทำ helper สำหรับ `Receipt` เพื่อให้ logic สมมาตรและดูแลง่าย
  ไฟล์หลัก: `app/admin/(protected)/receipts/actions.ts`, `app/admin/(protected)/supplier-payments/actions.ts`

- [x] ปรับ `cash-bank` recalc ให้คุ้มขึ้นเมื่อ ledger โต
  แนวทางแก้ไข: จากเดิม recalc ทั้งบัญชีและ update ทีละ row ทุกครั้ง ให้พิจารณา recalc เฉพาะช่วงที่ได้รับผลกระทบ หรือทำ set-based recalculation ในรอบถัดไป
  ไฟล์หลัก: `lib/cash-bank.ts`

- [x] ลด query summary ซ้ำในหน้าที่มี count หลายก้อน
  แนวทางแก้ไข: ทบทวนหน้า list ที่ยิง count หลาย query พร้อมกัน เช่น warranty list เพื่อรวม summary ให้เหลือ query น้อยลงเมื่อข้อมูลโต
  ไฟล์หลัก: `app/admin/(protected)/warranties/page.tsx`

### D. ภาพรวมที่ต้องรักษาไว้

- [x] Reference-chain guard ต้องคงหลักเดิมไว้ทุกจุด
  แนวทางแก้ไข: ก่อน edit/cancel เอกสารต้นทาง ต้อง reject ถ้ามี downstream `ACTIVE` อ้างอิงอยู่; งานรอบนี้เพิ่มเฉพาะ server-side validation ตอน create/update เอกสารลูก ไม่เปลี่ยนลำดับธุรกิจเดิม

- [x] ฝั่ง AP ปัจจุบันเป็น baseline ที่แข็งแรงกว่า AR
  แนวทางแก้ไข: เวลาเติม validation ฝั่ง AR ให้ mirror pattern จาก `SupplierPayment` โดยไม่เปลี่ยนสูตร `amountRemain` เดิม

### E. Notes

- [x] Note: ระบบปัจจุบัน "ยอมให้ stock ติดลบได้" ถือเป็น behavior ที่ตั้งใจรองรับในตอนนี้ ไม่ให้นับเป็น bug ใน audit รอบนี้
  แนวทางติดตาม: ถ้าอนาคตต้องการปิด negative stock ค่อยเปิดเป็น initiative แยก เพราะจะกระทบ flow เดิมหลายจุดทั้ง sale, purchase return, adjustment และ stock valuation

---

## Roadmap Update (2026-04-09 Phase 7 Products Runtime Reduction)

- Continued the Phase 7 production tuning loop with a route-specific pass focused on `/products` and `/products/search`, without changing the already healthy public detail/category flows.
- Removed `force-dynamic` from `/products` so the landing route can be served as a static/ISR page again.
- Moved the `/products` landing query into a tagged cached helper (`getStorefrontProductsLandingPageData`) so the route no longer re-runs the same product list + count query work on every request.
- Tightened `getStorefrontProductFilters()` to fetch only the fields used by the filter UI (`id`, `name`, and active `carModels`) instead of full table rows.
- Added a collapsed `ProductFilterBar` fallback shell for `/products` so the static shell is closer to the hydrated UI and less likely to introduce layout shift while the client filter panel boots.
- Disabled automatic product-detail prefetch on the high-cardinality grids used by `/products` and `/products/search` to reduce request fan-out and non-critical client work during catalog browsing.
- Validation: `npm run build` passes after the tuning pass, and the build output now shows `/products` as a static route again.
- The production measurement + tuning loop remains open and should be re-measured after deploy to confirm:
  - `/products` request count drops versus the previous run
  - `/products` CLS improves from the previous `0.13` regression
  - no meaningful regression appears on the other benchmark storefront pages

## Roadmap Update (2026-04-09 Phase 7 Shared Client Bundle Reduction Audit)

- Scope: audit and reduce shared storefront client bundle cost only where it materially helps the Phase 7 production tuning loop.
- Safety note: every item below must be implemented conservatively, with the explicit goal of avoiding regressions in `UI/UX`, business `logic`, and visual rendering. If a change risks altering healthy storefront behaviour, keep the current behaviour and skip the reduction.

### Candidate checklist

- [x] Split `Navbar` into a server-first shell and a minimal client island for the mobile menu only
- [x] Keep `Navbar` search, logo, contact links, and static navigation markup server-rendered where possible
- [x] Review whether `DeferredAnalytics` should stay mounted in the root app layout or be narrowed to storefront-only scope
- [x] Review whether `DeferredAnalytics` can be deferred more aggressively without losing required tracking coverage
- [x] Reduce `FloatingLine` / `DeferredFloatingLine` client footprint while preserving the current CTA behaviour
- [x] Review whether `FloatingLine` should mount only on the storefront routes where it adds real conversion value
- [x] Audit shared `lucide-react` usage inside storefront client components and reduce icon-driven shared chunk weight only after the client surface has been reduced first
- [x] Keep `ProductCard` server-rendered and avoid introducing new client logic into the catalog card path
- [x] Refactor `ProductFilterBar` only if the change can shrink the `/products` route client cost without changing filter behaviour, query-string behaviour, or perceived UX
- [x] Re-check `/products/search` rendering strategy only if a safe reduction in server/runtime cost can be made without stale or incorrect search results
- [x] Keep fallback shells for `/products` and `/products/search` visually close to the hydrated UI to avoid new CLS regressions during bundle reductions
- [x] Re-run bundle/performance verification after each reduction pass and reject any change that causes meaningful regressions on already healthy storefront pages

### Status update (2026-04-09)

- Storefront benchmark routes now use a new server-first `StorefrontNavbar`, so the old client `Navbar.tsx` is no longer part of the public route client reference path.
- Deferred storefront analytics were moved out of the root app layout and are now mounted only on storefront/public pages via `StorefrontDeferredAssets`, reducing app-wide shared client scope without changing public page behaviour.
- Analytics deferral policy was reviewed again after route scoping and intentionally kept on the current idle/timeout gate because delaying it further risks missing short-session visit tracking and early vitals coverage.
- `DeferredFloatingLine` now lazy-loads the interactive floating CTA, and the floating dismiss button no longer pulls its own `lucide-react` icon import.
- Floating CTA route scoping was reviewed and intentionally kept on the current public storefront pages because about/FAQ/knowledge routes still feed the LINE/phone handoff path; removing the CTA there would trade conversion/help UX for only a small JS gain.
- `ProductFilterBar` now uses inline SVG icons instead of a `lucide-react` client import, trimming route client work without changing filter behaviour or query-string behaviour.
- The storefront `lucide-react` audit is now reduced to server-rendered public components plus the unused legacy client `Navbar.tsx`; the active storefront client path no longer depends on `lucide-react` for `FloatingLine` or `ProductFilterBar`.
- `/products/search` now reuses the same `ProductFilterBarFallback` shell as `/products`, so the catalog filter placeholder stays closer to the hydrated UI.
- `/products/search` rendering strategy was re-checked and intentionally kept as `force-dynamic`; the route is query-driven and should prefer freshness/correctness over risky caching changes.
- Validation: `npm run build` passes after the reduction pass, and the `/products` client reference manifest no longer includes `components/shared/Navbar.tsx`.
- Validation was re-run with both `npm run build` and `npm run analyze` after the final reduction pass.

## Roadmap Update (2026-04-09 Electronic Signatures for Receipt Print)

- [x] Added per-user electronic signature fields on `User` so admin can maintain a reusable signature image from the existing user management flow.
- [x] Reused the current Supabase Storage upload pattern for signature images, with server-side validation for MIME type, extension, and file size.
- [x] Added signer snapshot fields on both `Receipt` and `Sale` so printed documents keep the signer name/signature used at document time instead of reading live user data only.
- [x] `createReceipt` and `createSale` now snapshot the current user signature into the document header at creation time.
- [x] `updateReceipt` and `updateSale` preserve the existing signer snapshot instead of replacing historical signatures automatically.
- [x] Receipt print (`/admin/receipts/[id]`) now renders the saved signature in the `ผู้รับเงิน` section.
- [x] Cash-sale print from sale detail (`/admin/sales/[id]`) now renders the saved signature in the `ผู้รับเงิน` section when printing the receipt form.
- [x] Scope was intentionally kept narrow to the current print flows only: `User`, `Receipt`, and `Sale`. No legal digital-signature workflow, approval chain, or cross-document signature engine was introduced in this round.

## Roadmap Update (2026-04-09 Supplier Payment Supplier Filter)

- [x] `supplier-payments` supplier dropdown now mirrors the receipt-style outstanding filter by loading only suppliers with non-zero net payable balance.
- [x] Net payable is derived from active `CREDIT_PURCHASE.amountRemain - SUPPLIER_CREDIT.amountRemain - SupplierAdvance.amountRemain`, and edit mode keeps the current supplier selectable.
- [x] Updated the outstanding dropdown rule again so both `supplier-payments` and `receipts` now include any non-zero net balance (`!== 0`), not only positive balances.

## Roadmap Update (2026-04-10 Primary Transfer Account + Invoice/Delivery QR)

> Scope for this round: manual collection only. Customer can scan and pay from the document, but staff still verify the incoming payment and key the receipt manually in the existing `Receipt` flow.

> Maintenance rule: `app/admin/(protected)/sales/[id]/page.tsx` and `app/admin/delivery/print/page.tsx` share the same invoice / delivery-note form. Any layout or content change to one must be applied to the other in the same round. Do not leave these two print forms out of sync.

### Completion update

- [x] Added `isPrimaryTransferAccount` to `CashBankAccount`
- [x] Added `promptPayId` on `CashBankAccount` so payment QR can be generated from the primary transfer account
- [x] Ran schema sync / `prisma db push` for the new fields
- [x] Enforced server-side rules for `BANK only`, `0 or 1 primary`, `inactive not allowed`, and `unset old primary before setting a new one`
- [x] Updated `/admin/cash-bank` UI with primary-transfer control, PromptPay ID input, badge, and 2-step change guidance
- [x] Added shared utility/query for reading the current primary transfer account
- [x] Updated `/admin/sales/[id]` print to show transfer account details and QR from `netAmount`
- [x] Updated `/admin/delivery/print` bulk print to show transfer account details and QR from `netAmount`
- [x] Refactored the sales invoice / delivery-note / receipt print layout into a shared template so `/admin/sales/[id]` and `/admin/delivery/print` now use the same form logic
- [x] Kept documents printable when no primary account exists, with QR/details hidden by fallback
- [x] Kept this round manual-only: no auto receipt creation, no webhook/bank callback, no reconciliation, no slip OCR
- [x] Verified the implementation with `npm run build`

> Checklist below now reflects the actual status of this round.

- [x] Add `isPrimaryTransferAccount` to `CashBankAccount`
- [x] Add migration / `prisma db push` for the new field
- [x] Enforce business rules on the server
- [x] Allow primary transfer account only when `type = BANK`
- [x] Allow at most `0 or 1` primary transfer account in the whole system
- [x] Allow the system to stay in a "no primary transfer account" state
- [x] If a primary already exists, require users to unset it first before setting another account as primary
- [x] Prevent inactive accounts (`isActive = false`) from being marked as primary
- [x] Update `/admin/cash-bank` UI
- [x] Add a control for the primary transfer account
- [x] Show a clear badge in the account list for the current primary account
- [x] Show validation messaging when a user attempts to set a second primary account
- [x] Support the agreed 2-step change flow: unset old primary, save, then set the new `BANK` account
- [x] Add a shared utility/query for reading the current primary transfer account
- [x] Update print documents to read bank name and account number from the primary transfer account
- [x] Generate payment QR using `netAmount`
- [x] Show QR only when a primary transfer account exists
- [x] Keep documents printable when no primary transfer account exists, but hide QR and transfer-account details
- [x] Limit first-round document scope to:
- [x] `/admin/sales/[id]` invoice / delivery-note print
- [x] `/admin/delivery/print` bulk delivery print
- [x] Test the agreed business rules
- [x] Existing primary blocks creating a second primary
- [x] Unsetting primary does not auto-switch another account into primary
- [x] Documents without a primary account still render safely
- [x] QR amount follows `netAmount` exactly per current policy
- [x] Keep non-scope items out of this round
- [x] No auto receipt creation
- [x] No webhook / bank callback / reconciliation
- [x] No slip OCR / slip matching / payment-status automation

## Roadmap Update (2026-04-11 Print Notice Block for Sales Documents)

> Scope for this round: extend the existing shared sales print form only. Keep the work inside company settings + current print layouts. Do not introduce new document types, schema changes, or workflow automation.

> Maintenance rule: `app/admin/(protected)/sales/[id]/page.tsx` and `app/admin/delivery/print/page.tsx` share the same invoice / delivery-note form. Any layout or content change to one must be applied to the other in the same round. Do not leave these two print forms out of sync.

### Checklist

- [x] Add company-setting content for print notice details using the existing `SiteContent` path
- [x] Keep the print notice title fixed as `โปรดทราบ`
- [x] Allow admins to edit print notice detail lines from `/admin/settings/company`
- [x] Validate print notice details to no more than 5 lines
- [x] Keep print notice rendering safe when settings are empty
- [x] Update the shared sales print template to render the notice block for both invoice/delivery-note and receipt print
- [x] Place the notice block in the lower-right print area beside the existing QR/payment block
- [x] Use a 70/30 width split between the existing QR/payment block and the new notice block
- [x] Keep visible table borders and spacing between the two lower blocks
- [x] Render notice detail text at 2px smaller than the normal print body text
- [x] Preserve existing QR/payment behaviour and existing receipt/delivery-note business rules
- [x] Re-verify single-document print from `/admin/sales/[id]`
- [x] Re-verify bulk delivery print from `/admin/delivery/print`
- [x] Verify `npm run build`

## Roadmap Update (2026-04-17 Shared Admin Print Form Layer)

> Scope for this round: refactor the existing admin print forms into a shared two-layer structure only. Preserve the current rendered output and business logic. Do not introduce new document workflows, schema changes, or field-level behaviour changes.

> Maintenance rule: all current and future admin print forms must use shared print presentation primitives plus document-specific content/logic. If a shared print primitive changes, every consumer must be reviewed and updated in the same round.

### Checklist

- [x] Add shared print presentation primitives for document root, header, signature grid, and common print helpers
- [x] Move sales print consumption to the shared two-layer print structure without changing output
- [x] Move delivery print consumption to the shared two-layer print structure without changing output
- [x] Move receipt print consumption to the shared two-layer print structure without changing output
- [x] Move warranty-claim print consumption to the shared two-layer print structure without changing output
- [x] Keep document-specific business logic and field selection in document-level components only
- [x] Update repository rules so future print forms follow the same shared-primitive pattern
- [x] Verify `npm run build`

## Roadmap Update (2026-04-11 LINE OA Daily Closing Summary Mapping)

> Scope for this round: define the first production-ready daily summary payload for `LINE Official Account + Messaging API` only. Keep the round limited to summary content, data mapping, scheduling target, and implementation checklist. Do not introduce webhook payment matching, per-event push spam, chatbot flows, or customer-facing LINE features in this round.

> Reporting rule: keep the summary focused on owner/internal use once per day in the evening. The message must separate `ยอดขายวันนี้` from `เงินรับเข้าวันนี้` so cash-sale money and debt-collection money are never mixed under the same meaning.

### Summary payload (v1)

```text
สรุปงานประจำวัน DD/MM/YYYY

ยอดขายวันนี้
- ขายรวม X บาท
- ขายสด X บาท
- ขายเชื่อ X บาท

เงินรับเข้าวันนี้
- จากการขายสด X บาท
- จากการรับชำระหนี้ X บาท
- รวมเงินเข้า X บาท

แยกตามช่องทางรับเงิน
- เงินสด X บาท
- เงินโอน X บาท

ยอดค้าง
- ลูกหนี้ค้างรับ X บาท
- COD ค้างรับเงิน X บาท
- เจ้าหนี้ค้างจ่าย X บาท

งานจัดส่ง
- รอจัดส่ง X รายการ
- กำลังจัดส่ง X รายการ
- ส่งสำเร็จวันนี้ X รายการ

สต๊อก
- ต่ำกว่าขั้นต่ำ X รายการ
- ของหมด X รายการ
- lot ใกล้หมดอายุ X lot
- lot หมดอายุค้างสต๊อก X lot

เคลม/เอกสารผิดปกติ
- เคลมค้างดำเนินการ X รายการ
- เอกสารถูกยกเลิกวันนี้ X รายการ
- ปรับสต๊อกวันนี้ X เอกสาร

สรุปเพิ่มเติม
- ค่าใช้จ่ายวันนี้ X บาท
- เงินโอนระหว่างบัญชีวันนี้ X บาท
```

### Data mapping checklist

- [x] `ยอดขายวันนี้ > ขายรวม`
  Mapping: sum `Sale.netAmount`
  Filter: `Sale.status = ACTIVE` และ `saleDate` อยู่ในวันรายงาน

- [x] `ยอดขายวันนี้ > ขายสด`
  Mapping: sum `Sale.netAmount`
  Filter: `Sale.status = ACTIVE`, `Sale.paymentType = CASH_SALE`, และ `saleDate` อยู่ในวันรายงาน

- [x] `ยอดขายวันนี้ > ขายเชื่อ`
  Mapping: sum `Sale.netAmount`
  Filter: `Sale.status = ACTIVE`, `Sale.paymentType = CREDIT_SALE`, และ `saleDate` อยู่ในวันรายงาน

- [x] `เงินรับเข้าวันนี้ > จากการขายสด`
  Mapping: sum `Sale.netAmount`
  Filter: `Sale.status = ACTIVE`, `Sale.paymentType = CASH_SALE`, และ `saleDate` อยู่ในวันรายงาน
  Note: รอบแรกยึดตามเอกสารขายสดที่สร้างในวันนั้นเท่านั้น และไม่ดึง `Receipt` มาปนในบรรทัดนี้

- [x] `เงินรับเข้าวันนี้ > จากการรับชำระหนี้`
  Mapping: sum `Receipt.totalAmount`
  Filter: `Receipt.status = ACTIVE` และ `receiptDate` อยู่ในวันรายงาน
  Note: เป็นเงินที่รับจริงจากการเก็บหนี้/รับชำระภายหลัง จะแยกความหมายจากยอดขายใหม่

- [x] `เงินรับเข้าวันนี้ > รวมเงินเข้า`
  Mapping: (`cash-sale receipts by Sale`) + (`Receipt.totalAmount`)
  Formula v1: `sum(Sale.netAmount where CASH_SALE, ACTIVE, saleDate in day)` + `sum(Receipt.totalAmount where ACTIVE, receiptDate in day)`

- [x] `แยกตามช่องทางรับเงิน > เงินสด`
  Mapping: `Sale.netAmount` + `Receipt.totalAmount`
  Filter A: `Sale.status = ACTIVE`, `Sale.paymentType = CASH_SALE`, `Sale.paymentMethod = CASH`, `saleDate` อยู่ในวันรายงาน
  Filter B: `Receipt.status = ACTIVE`, `Receipt.paymentMethod = CASH`, `receiptDate` อยู่ในวันรายงาน

- [x] `แยกตามช่องทางรับเงิน > เงินโอน`
  Mapping: `Sale.netAmount` + `Receipt.totalAmount`
  Filter A: `Sale.status = ACTIVE`, `Sale.paymentType = CASH_SALE`, `Sale.paymentMethod = TRANSFER`, `saleDate` อยู่ในวันรายงาน
  Filter B: `Receipt.status = ACTIVE`, `Receipt.paymentMethod = TRANSFER`, `receiptDate` อยู่ในวันรายงาน

- [x] `ยอดค้าง > ลูกหนี้ค้างรับ`
  Mapping: sum `Sale.amountRemain`
  Filter: `Sale.status = ACTIVE`, `Sale.paymentType = CREDIT_SALE`, `Sale.fulfillmentType = PICKUP`
  Note: ยึดตาม dashboard logic ปัจจุบันเพื่อไม่ปน COD

- [x] `ยอดค้าง > COD ค้างรับเงิน`
  Mapping: sum `Sale.amountRemain`
  Filter: `Sale.status = ACTIVE`, `Sale.paymentType = CREDIT_SALE`, `Sale.fulfillmentType = DELIVERY`, `Sale.shippingStatus != DELIVERED`
  Note: ยึดตาม dashboard logic ปัจจุบันในรอบแรก

- [x] `ยอดค้าง > เจ้าหนี้ค้างจ่าย`
  Mapping: sum `Purchase.amountRemain`
  Filter: `Purchase.status = ACTIVE`, `Purchase.purchaseType = CREDIT_PURCHASE`, `Purchase.amountRemain > 0`

- [x] `งานจัดส่ง > รอจัดส่ง`
  Mapping: count `Sale.id`
  Filter: `Sale.status = ACTIVE`, `Sale.fulfillmentType = DELIVERY`, `Sale.shippingStatus = PENDING`

- [x] `งานจัดส่ง > กำลังจัดส่ง`
  Mapping: count `Sale.id`
  Filter: `Sale.status = ACTIVE`, `Sale.fulfillmentType = DELIVERY`, `Sale.shippingStatus = OUT_FOR_DELIVERY`

- [x] `งานจัดส่ง > ส่งสำเร็จวันนี้`
  Mapping v1: count `Sale.id`
  Filter: `Sale.status = ACTIVE`, `Sale.fulfillmentType = DELIVERY`, `Sale.shippingStatus = DELIVERED`, และ `Sale.updatedAt` อยู่ในวันรายงาน
  Note: รอบแรกใช้ `updatedAt` เป็น proxy จนกว่าจะมี dedicated delivered timestamp

- [x] `สต๊อก > ต่ำกว่าขั้นต่ำ`
  Mapping: count `Product.id`
  Filter: `Product.isActive = true`, `Product.stock > 0`, `Product.stock <= Product.minStock`

- [x] `สต๊อก > ของหมด`
  Mapping: count `Product.id`
  Filter: `Product.isActive = true`, `Product.stock <= 0`
  Note: ระบบปัจจุบันยอมให้ stock ติดลบได้ ให้รวมค่าติดลบในบรรทัดนี้ด้วย

- [x] `สต๊อก > lot ใกล้หมดอายุ`
  Mapping: count lot จาก `ProductLot`
  Join/Filter: `ProductLot.expDate != null`, `ProductLot.expDate` อยู่ภายในช่วงเตือน, และมี `LotBalance.qtyOnHand > 0` คู่กันตาม `(productId, lotNo)`
  Default window v1: ภายใน 30 วันนับจากวันรายงาน

- [x] `สต๊อก > lot หมดอายุค้างสต๊อก`
  Mapping: count lot จาก `ProductLot`
  Join/Filter: `ProductLot.expDate < วันรายงาน` และมี `LotBalance.qtyOnHand > 0` คู่กันตาม `(productId, lotNo)`

- [x] `เคลม/เอกสารผิดปกติ > เคลมค้างดำเนินการ`
  Mapping: count `WarrantyClaim.id`
  Filter: `WarrantyClaim.status in (DRAFT, SENT_TO_SUPPLIER)`

- [x] `เคลม/เอกสารผิดปกติ > เอกสารถูกยกเลิกวันนี้`
  Mapping: sum counts across document headers
  Sources v1:
  `Sale.cancelledAt`, `Purchase.cancelledAt`, `Receipt.cancelledAt`, `CreditNote.cancelledAt`, `PurchaseReturn.cancelledAt`, `Expense.cancelledAt`, `Adjustment.cancelledAt`, `CashBankTransfer.cancelledAt`, `CashBankAdjustment.cancelledAt`
  Filter: cancelled timestamp อยู่ในวันรายงาน และ status = `CANCELLED` ถ้ามี field status

- [x] `เคลม/เอกสารผิดปกติ > ปรับสต๊อกวันนี้`
  Mapping: count `Adjustment.id`
  Filter: `Adjustment.status = ACTIVE` และ `adjustDate` อยู่ในวันรายงาน

- [x] `สรุปเพิ่มเติม > ค่าใช้จ่ายวันนี้`
  Mapping: sum `Expense.netAmount`
  Filter: `Expense.status = ACTIVE` และ `expenseDate` อยู่ในวันรายงาน

- [x] `สรุปเพิ่มเติม > เงินโอนระหว่างบัญชีวันนี้`
  Mapping: sum `CashBankTransfer.amount`
  Filter: `CashBankTransfer.status = ACTIVE` และ `transferDate` อยู่ในวันรายงาน

### Implementation checklist

- [x] Add a shared server-side summary builder for one business day, for example `lib/line-daily-summary.ts`
- [x] Normalize the report day to Bangkok business date boundaries before querying `saleDate`, `receiptDate`, `expenseDate`, and other document dates
- [x] Reuse the current dashboard split between normal AR and COD so the LINE summary stays consistent with admin numbers
- [x] Keep `ยอดขายวันนี้` and `เงินรับเข้าวันนี้` as separate sections in code, tests, and final LINE message text
- [x] Implement aggregate queries with `status = ACTIVE` guards to exclude cancelled documents from every money total
- [x] For lot metrics, reuse the same `ProductLot` + `LotBalance` pairing rule already used by the expiry report so only on-hand lots are counted
- [x] For `ส่งสำเร็จวันนี้`, document the temporary `updatedAt` proxy clearly in code comments and roadmap notes
- [x] Add unit-level formatter helpers for Thai currency and Thai date text used by the LINE payload
- [x] Add message renderer that omits optional rows cleanly when values are `0` only if the owner confirms a compact mode later; default v1 should show all agreed rows
- [x] Add one dry-run/admin preview path before enabling scheduled send, so the owner can verify wording and numbers against the admin UI
- [x] Schedule the first run as once per day in the evening after operations close
- [x] Keep this round owner-facing only; do not add per-staff targeting, alert subscriptions, or per-role templates yet

### Out of scope for this round

- [ ] No per-event push for every sale / receipt / shipment
- [ ] No webhook, bank callback, slip OCR, or payment auto-reconciliation
- [ ] No customer-facing LINE messaging
- [ ] No chatbot / LINE rich menu flow changes
- [ ] No attempt to infer true delivery completion time beyond the current data available in `Sale`

### Completion update (2026-04-11)

- [x] Added shared server-side summary builder at `lib/line-daily-summary.ts`
- [x] Implemented Bangkok business-day normalization and Thai formatter helpers in the LINE summary path
- [x] Kept `ยอดขายวันนี้` separate from `เงินรับเข้าวันนี้` in both data model and rendered LINE text
- [x] Reused the current dashboard split between normal AR and COD to keep summary numbers aligned with admin screens
- [x] Implemented aggregate queries with `status = ACTIVE` guards for all money totals in the summary
- [x] Reused the `ProductLot` + `LotBalance` pairing rule so near-expiry / expired lot counts only include on-hand stock
- [x] Kept `ส่งสำเร็จวันนี้` on the agreed temporary `Sale.updatedAt` proxy and documented that constraint in the roadmap and code
- [x] Added owner-facing admin preview page at `/admin/reports/line-daily-summary`
- [x] Added scheduled-send route at `/api/internal/line-daily-summary`
- [x] Added LINE Messaging API delivery helper with env-based recipient configuration
- [x] Added first-pass daily evening scheduler for the LINE summary route
- [x] Kept this round owner-facing only and out of scope from webhook/slip-OCR/chatbot/customer messaging flows
- [x] Reused Profit Dashboard daily `factProfit` summary for `ต้นทุนขายวันนี้`, `กำไรขั้นต้นวันนี้`, and `% Margin วันนี้` in the LINE summary without changing existing cash/AR/AP logic
- [x] Moved the top hero KPI in the LINE summary to `กำไรขั้นต้นวันนี้` and moved `ยอดขายรวม` into the detailed sales section with `ขายสด`, `ขายเชื่อ`, and `ต้นทุนขาย`

## Roadmap Update (2026-04-11 LINE OA Admin Targeting + Scheduler Settings)

> Scope for this round: keep the existing LINE daily summary payload intact, but add runtime scheduling in DB, admin-side test send, LINE recipient capture, admin-to-LINE mapping, and admin-target delivery. Do not change the existing sales/receipt/purchase/business calculations inside the summary builder.

### Checklist

- [x] Keep `lib/line-daily-summary.ts` business totals unchanged so the summary content still matches the agreed mapping
- [x] Add DB-backed runtime settings for `enabled`, `sendTime`, `targetMode`, and last successful scheduled send markers
- [x] Keep DB-backed scheduling settings and duplicate protection while allowing the trigger layer to evolve independently
- [x] Add a `Test Send` action on `/admin/reports/line-daily-summary`
- [x] Add a dedicated table for LINE recipients captured from webhook events
- [x] Add a dedicated table for `User -> LINE recipient` mapping so admin targeting is explicit and auditable
- [x] Add a dispatch log table for scheduled/test sends to support visibility and duplicate protection
- [x] Add webhook route to capture `userId`, `groupId`, and `roomId` automatically from LINE events
- [x] Verify LINE webhook requests with `LINE_MESSAGING_API_CHANNEL_SECRET`
- [x] Add admin-target recipient resolution that sends only to active `ADMIN` users with mapped LINE `USER` recipients
- [x] Preserve env-based target delivery as the default non-breaking mode (`ENV_IDS`) until the owner switches to `ADMIN_USERS`
- [x] Keep group/room recipients visible in admin, but do not include them in admin-user targeting
- [x] Add admin UI on the LINE summary page for schedule settings, mappings, captured recipients, and recent dispatches
- [x] Update `.env.example` with webhook secret requirements
- [x] Run Prisma generate / db push for the new LINE models
- [x] Verify `npm run build`

### Guard rails

- [x] Do not alter existing sale / receipt / purchase / stock logic used by the daily summary numbers
- [x] Do not remove the existing env-recipient delivery path
- [x] Do not auto-link LINE recipients to system users heuristically; mapping must be explicit
- [x] Do not send scheduled messages twice for the same day when a dispatch lock already exists
- [x] Keep only one active scheduler for the LINE summary at a time

## Roadmap Update (2026-04-16 LINE OA Daily Summary QStash Migration)

> Scope for this round: replace the Vercel Cron trigger with Upstash QStash for the LINE daily summary, keep the summary payload and delivery logic unchanged, and allow the owner to edit Bangkok send time from the existing admin page with minimal schema impact.

### Checklist

- [x] Reuse the existing LINE summary builder, recipient resolution, and LINE delivery logic without changing money/stock/accounting semantics
- [x] Replace the Vercel Cron trigger with a QStash-signed route invocation for `/api/internal/line-daily-summary`
- [x] Verify scheduler requests with QStash signing keys instead of `CRON_SECRET`
- [x] Keep the admin-owned `enabled` + `sendTime` settings in DB and sync them directly to QStash from the same server action
- [x] Use a stable QStash `scheduleId` so changing time from admin updates the same daily schedule without adding a new Prisma field
- [x] Convert Bangkok `sendTime` to the daily UTC cron expression required by QStash
- [x] Remove the old `vercel.json` cron configuration so only the QStash scheduler remains
- [x] Update runtime readiness and admin copy from Vercel Cron wording to QStash wording
- [x] Keep the runtime `shouldSendLineDailySummaryNow()` guard in place as duplicate/early-send protection

### Minimal-change implementation notes

- No new Prisma model or schema field is needed for the LINE daily summary schedule
- The QStash schedule is stored under the fixed id `line-daily-summary`
- Disabling the feature deletes the QStash schedule; enabling or changing the time recreates/updates the same schedule id
- The system still stores the owner-selected Bangkok time in DB and only converts it to UTC when syncing the QStash cron

## Roadmap Update (2026-04-11 LINE OA Delivery Hardening + UX Completion)

> Scope for this round: keep the existing owner-facing LINE summary logic intact, but harden delivery visibility, scheduled-send diagnostics, preview/send parity, Flex-card delivery, and retry behavior so production support is easier on Vercel Hobby.

### Checklist

- [x] Keep the daily summary business totals unchanged while improving delivery behavior only
- [x] Move LINE summary send payload from mixed text+card to Flex card only so preview and real send stay aligned
- [x] Add preview parity so the admin preview matches the actual Flex payload sent to LINE
- [x] Refine the card layout for SME readability, including a dedicated `รายละเอียดการขาย` card
- [x] Move `ขายสด` / `ขายเชื่อ` into the dedicated sales-detail card and keep `ยอดขายรวม` only in the header card
- [x] Switch ADMIN recipient mapping to use `บทบาทการใช้งาน` (`appRole`) instead of `Legacy Role`
- [x] Add readable admin status text for scheduled delivery such as `ส่งแล้ว`, `ข้ามเพราะส่งแล้ววันนี้`, `ปิดใช้งาน`, and `รอรอบส่งวันนี้`
- [x] Record `SKIPPED` scheduled attempts in the dispatch history so cron behavior is auditable even when no LINE push occurs
- [x] Record configuration-related `FAILED` attempts even when LINE push could not start because recipients/env were incomplete
- [x] Keep recent dispatch history limited to the latest 10 rows in the admin UI
- [x] Add human-readable status/reason rendering in dispatch history for `SENT`, `FAILED`, and `SKIPPED`
- [x] Add LINE push retry behavior with a short backoff strategy on retryable failures
- [x] Limit LINE push retries to a maximum of 3 attempts per recipient
- [x] Retry only on transient cases (`429`, `5xx`, and network failure), not on permanent request errors
- [x] Emit Vercel/server logs for each LINE push attempt so operators can see which retry round failed or recovered
- [x] Include final attempt summary in the thrown LINE push error when delivery still fails after retries
- [x] Verify `npm run build`

### Guard rails

- [x] Do not change the agreed daily summary data mapping or accounting semantics
- [x] Do not add queue workers, background daemons, or multi-cron retry loops on Hobby
- [x] Do not auto-resend forever; cap retries inside a single request at 3 attempts
- [x] Keep retry behavior inside the LINE delivery helper so webhook/admin/scheduled entry points stay simple

## Roadmap Update (2026-04-11 LINE Recipient Identity + Lightweight Retention UI)

> Scope for this round: improve recipient identification and admin usability without deleting any historical webhook data. Keep the delivery model unchanged, but enrich `USER` recipients with LINE profile names and hide stale webhook recipients in the UI by default.

### Checklist

- [x] Fetch `displayName` from LINE Profile API for webhook events that contain a `userId`
- [x] Keep webhook processing resilient by falling back to raw `userId` when LINE profile lookup fails
- [x] Store fetched `displayName` on `LineRecipient` for `USER` recipients only
- [x] Leave `GROUP` / `ROOM` handling unchanged and do not attempt unsupported profile lookups for them
- [x] Keep all webhook recipients in the database; do not delete old rows in this round
- [x] Add a lightweight 90-day visibility filter in the admin recipient UI instead of deleting old data
- [x] Keep mapped recipients visible even when their last webhook activity is older than 90 days
- [x] Apply the same 90-day visibility rule to the admin recipient picker so old, unused IDs do not clutter the dropdown
- [x] Keep the 90-day filter and the webhook recipient list in the same admin card for easy operator understanding
- [x] Verify `npm run build`

### Guard rails

- [x] Do not introduce automatic cleanup jobs or archival schema in this round
- [x] Do not require LINE profile lookup success for webhook persistence
- [x] Do not hide recipients that are already linked to an admin user

## Roadmap Update (2026-04-16 Facebook Content Approval + Scheduled Auto Post without Vercel Cron)

> Scope for this round: extend the existing admin system and the existing LINE OA integration so the owner can run `AI draft -> LINE notify -> approve in admin -> schedule -> auto post to Facebook Page` without relying on Vercel Cron. Reuse the current LINE channel, webhook, recipient capture, and admin-to-LINE mapping already in production. Add a queue-based scheduler instead of adding more cron-driven behavior.

### Architecture decision

- [x] Reuse the existing LINE OA integration for approval notifications instead of creating a second LINE channel
- [x] Keep the current LINE webhook route and recipient mapping flow as the source of truth for which admin receives notifications
- [x] Use a delayed job / queue provider for timed publishing instead of Vercel Cron
- [x] Keep content approval and Facebook publishing logic separate from the LINE daily summary business logic
- [x] Keep the first production scope owner-facing/admin-facing only; do not add customer-facing messaging in this round

### System implementation checklist

- [x] Add DB models for content posting flow, at minimum covering `content_posts`, `content_approvals`, `scheduled_jobs`, and `content_audit_logs`
- [x] Add post lifecycle statuses such as `draft`, `pending_approval`, `approved`, `scheduled`, `posted`, `failed`, and `cancelled`
- [x] Generate AI draft content in batches of 3 alternatives per request so the owner can compare and choose before requesting approval
- [x] Add admin pages for content list, approval queue, and post detail / approval action
- [x] Add AI draft generation flow for Facebook caption/content draft creation
- [x] Add approval actions for `approve`, `request_revision`, `cancel`, and `post_now`
- [x] Reuse the existing LINE delivery foundation, but add new approval-notification templates for content workflow
- [x] Add LINE notifications for at least `approval requested`, `revision requested`, `posted`, and `publish failed`
- [x] Add a queue-backed scheduling path so `Approve & Schedule` creates a delayed publish job instead of relying on cron polling
- [x] Add a publish endpoint/job handler that verifies queue signatures, loads the approved content row, prevents duplicate publish, and posts to Facebook
- [x] Add publish idempotency so the same scheduled job cannot create duplicate Facebook posts
- [x] Record success/failure details from each publish attempt in DB and audit logs
- [x] Add a retry strategy for transient publish failures through the chosen queue provider rather than custom cron loops
- [x] Keep all scheduling and display times normalized to `Asia/Bangkok`
- [x] Verify `npm run build` after implementation
- [x] Add admin-side runtime readiness visibility for `OpenAI`, `QStash`, `Facebook`, `APP_BASE_URL`, and approver mapping status
- [x] Add admin-side `requeue failed publish` action without introducing cron-based retry loops
- [x] Add guardrails that block schedule/post flows when required production config is missing
- [x] Add queue/job-state guards so duplicate or already-running publish jobs are skipped safely

### Reuse checklist from existing LINE system

- [x] Reuse `LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN` and `LINE_MESSAGING_API_CHANNEL_SECRET`
- [x] Reuse the existing LINE webhook route and recipient capture flow
- [x] Reuse the existing `User -> LINE recipient` mapping UI and tables for choosing approval recipients
- [x] Do not fork the daily summary module into a second LINE integration stack
- [x] Add a separate content-approval notification module/template set so the summary flow and approval flow stay maintainable

### Owner checklist — things to do outside the codebase

#### 1. Upstash QStash setup

- [ ] Create an Upstash account
- [ ] Create a `QStash` project
- [ ] Copy `QSTASH_TOKEN`
- [ ] Copy `QSTASH_CURRENT_SIGNING_KEY`
- [ ] Copy `QSTASH_NEXT_SIGNING_KEY`
- [ ] Add the three QStash values to Vercel Project Settings -> Environment Variables
- [ ] Add `APP_BASE_URL` for the production admin domain if it is not already set correctly
- [ ] After env changes, redeploy or trigger a fresh deployment so the new values are available at runtime

#### 2. LINE reuse verification

- [ ] Confirm the existing LINE OA is still the account that should send approval notifications
- [ ] Confirm `LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN` and `LINE_MESSAGING_API_CHANNEL_SECRET` are valid in Vercel
- [ ] Confirm the webhook URL currently configured in LINE Developer Console points to the production route
- [ ] Open the current LINE summary admin page and confirm the recipient list still loads correctly
- [ ] Confirm the intended approver accounts are already linked to their LINE user IDs in the existing admin mapping UI
- [ ] Ask each approver to add the LINE OA as a friend if they have not done so yet

#### 3. Facebook / Meta setup

- [ ] Create or confirm access to a Meta Developer account
- [ ] Create a Meta app for Page publishing, or confirm an existing app can be used for this project
- [ ] Connect the Facebook Page that will receive the auto-posted content
- [ ] Generate a Page access token for the target page
- [ ] Confirm the token has the permissions required for Page post publishing in the current Meta app setup
- [ ] Add `FACEBOOK_PAGE_ID` to Vercel environment variables
- [ ] Add `FACEBOOK_PAGE_ACCESS_TOKEN` to Vercel environment variables
- [ ] Keep a note of which Facebook Page is production so the system does not accidentally publish to the wrong page

#### 4. Approval process decisions

- [x] Decide who is allowed to approve Facebook posts in the first version
- [x] Decide whether v1 uses one approver only or allows multiple approvers
- [x] Decide whether `no approval = no publish` is mandatory for every scheduled post
- [x] Decide whether some post categories can use `Approve & Post Now` while others must always schedule
- [x] Decide whether the AI is allowed to choose the publish time automatically or whether humans always choose the time
- [ ] Decide what minimum information must be shown in the LINE notification, for example caption preview, cover image preview, publish time, and page name

Approved decisions for v1:
- Any user who already has content approval permission (`content.manage`) can act as an approver
- Every post must be approved before it can be published
- `Approve & Post Now` is allowed for every post
- Humans choose the publish time themselves; AI does not auto-pick the final publish time in v1
- Scheduled publish timing must respect the current `QStash` free-tier constraints, especially the maximum delay window supported by that plan

#### 5. Production verification after code is ready

- [ ] Create one test draft in admin
- [ ] Confirm the approval notification arrives on LINE
- [ ] Open the approval page from the notification link and confirm the correct post loads
- [ ] Test `Approve & Post Now` with a safe test post first
- [ ] Test `Approve & Schedule` with a near-future time first
- [ ] Confirm the queued publish job runs at the expected Bangkok time
- [ ] Confirm the Facebook post appears on the correct Page
- [ ] Confirm the post status changes to `posted` in admin
- [ ] Confirm a failed publish shows a readable error in admin/logs

### Owner step-by-step guide for beginners

#### Step 1 — Prepare QStash

- [ ] Go to Upstash and sign in
- [ ] Create a new `QStash` project
- [ ] Open the project settings/overview screen
- [ ] Copy the token and signing keys
- [ ] Open Vercel -> this project -> Settings -> Environment Variables
- [ ] Add the QStash env values one by one
- [ ] Save the env values and redeploy the project

#### Step 2 — Verify existing LINE production settings

- [ ] Open Vercel env and verify the two LINE env values already exist
- [ ] Open the LINE daily summary admin page in the system
- [ ] Confirm recipients still appear in the recipient list
- [ ] Confirm the approver's LINE account is linked to the correct admin user
- [ ] If someone new will approve posts, have that person chat with the OA first so webhook capture can store the recipient
- [ ] Link that LINE recipient to the admin user in the existing mapping UI

#### Step 3 — Prepare Facebook publishing credentials

- [ ] Open Meta for Developers
- [ ] Create/select the app that will be used for publishing
- [ ] Connect/select the target Facebook Page
- [ ] Generate the Page token
- [ ] Copy the Page ID and Page token
- [ ] Add them to Vercel env
- [ ] Redeploy after saving env changes

#### Step 4 — Test the end-to-end workflow

- [ ] Create a test content draft
- [ ] Wait for the LINE approval notification
- [ ] Open the approval link
- [ ] Approve the draft
- [ ] Choose either `post now` or a scheduled time
- [ ] Confirm the post appears on Facebook
- [ ] Confirm the system shows the correct final status

### Guard rails

- [ ] Do not create a second LINE OA for the same approval flow unless there is a business reason to split channels
- [ ] Do not mix content-approval notifications into the daily summary code path
- [ ] Do not rely on Vercel Cron for scheduled publish in this round
- [ ] Do not allow scheduled publish to run if the content is not explicitly approved
- [ ] Do not store Facebook credentials in source files or hard-coded config
- [ ] Do not publish to production without first testing on a controlled post/page flow

## Roadmap Update (2026-04-16 Next Scope after Approval-First Facebook Posting)

> Scope for the next phase after the current approval-first posting flow is stable: extend the content system into customer-facing messaging and recurring campaign orchestration without breaking the admin-first approval flow introduced in the current round.

### Phase A — Customer-facing messaging

#### Goal

- [ ] Add customer-targeted outbound messaging as a separate domain from admin approval notifications
- [ ] Keep owner/admin notifications and customer messaging on separate templates, logs, consent rules, and delivery flows
- [ ] Start with reusable audience + campaign + delivery records instead of hard-coding per-channel messaging

#### Proposed DB structure

- [ ] Add `CustomerAudience`
  Stores saved recipient segments such as "customers who bought in last 90 days" or "customers with phone numbers and active status"
- [ ] Add `CustomerAudienceMember`
  Stores resolved recipients included in an audience snapshot when a campaign is prepared or sent
- [ ] Add `CustomerCampaign`
  Stores the campaign header such as objective, target channel, message type, approval requirement, and schedule mode
- [ ] Add `CustomerCampaignMessage`
  Stores one or more generated message variants/content assets for a campaign
- [ ] Add `CustomerCampaignDelivery`
  Stores actual send attempts and delivery results per recipient
- [ ] Add `CustomerCampaignAuditLog`
  Stores business-level actions such as draft created, approved, scheduled, started, completed, cancelled

#### Proposed table details

- [ ] `CustomerAudience`
  Recommended fields: `id`, `name`, `description`, `channel`, `filterJson`, `isActive`, `createdByUserId`, `createdAt`, `updatedAt`
- [ ] `CustomerAudienceMember`
  Recommended fields: `id`, `audienceId`, `customerId`, `lineRecipientId`, `snapshotLabel`, `createdAt`
- [ ] `CustomerCampaign`
  Recommended fields: `id`, `name`, `objective`, `channel`, `status`, `audienceId`, `scheduledAt`, `approvedAt`, `createdByUserId`, `approvedByUserId`, `createdAt`, `updatedAt`
- [ ] `CustomerCampaignMessage`
  Recommended fields: `id`, `campaignId`, `variantNo`, `title`, `body`, `imageUrl`, `ctaLabel`, `ctaUrl`, `isSelected`, `createdAt`, `updatedAt`
- [ ] `CustomerCampaignDelivery`
  Recommended fields: `id`, `campaignId`, `messageId`, `customerId`, `lineRecipientId`, `status`, `provider`, `providerMessageId`, `attemptCount`, `lastError`, `sentAt`, `createdAt`, `updatedAt`
- [ ] `CustomerCampaignAuditLog`
  Recommended fields: `id`, `campaignId`, `actorUserId`, `action`, `detail`, `metadataJson`, `createdAt`

#### Guard rails

- [ ] Do not mix customer-facing messages into the admin approval notification templates
- [ ] Do not auto-message customers until opt-in/consent rules for the chosen channel are confirmed
- [ ] Do not assume every `Customer` has a valid LINE recipient; delivery must go only to mapped/eligible recipients
- [ ] Do not let customer campaign sending reuse the same dispatch log semantics as owner-only summary sends without a dedicated campaign delivery table

### Phase B — Recurring campaign engine

#### Goal

- [ ] Add recurring campaign definitions so the owner can schedule repeated content generation and approval cycles
- [ ] Reuse the same approval-first content flow instead of building a second automation path
- [ ] Keep recurring generation separate from actual publish execution so approval can still block publish

#### Proposed DB structure

- [ ] Add `RecurringCampaign`
  Stores the recurring campaign definition/template
- [ ] Add `RecurringCampaignRun`
  Stores each generated occurrence/run from the recurring campaign
- [ ] Add `RecurringCampaignTemplate`
  Stores reusable generation prompt settings, posting defaults, and optional audience/content rules

#### Proposed table details

- [ ] `RecurringCampaign`
  Recommended fields: `id`, `name`, `channel`, `status`, `scheduleType`, `scheduleExpr`, `timezone`, `templateId`, `approvalMode`, `nextRunAt`, `lastRunAt`, `createdByUserId`, `createdAt`, `updatedAt`
- [ ] `RecurringCampaignRun`
  Recommended fields: `id`, `campaignId`, `runKey`, `status`, `plannedAt`, `startedAt`, `finishedAt`, `generatedPostCount`, `selectedPostId`, `errorMessage`, `createdAt`, `updatedAt`
- [ ] `RecurringCampaignTemplate`
  Recommended fields: `id`, `name`, `objective`, `promptTemplate`, `defaultPageId`, `defaultPublishTime`, `defaultHashtagSet`, `active`, `createdByUserId`, `createdAt`, `updatedAt`

#### Engine behavior checklist

- [ ] Each recurring run should generate 3 draft post options by default unless the owner changes the rule later
- [ ] A recurring run should create drafts only; it must not auto-publish without approval in the current product scope
- [ ] The owner should be able to pick one of the generated drafts and discard the others
- [ ] Keep a durable run record even when the AI generation fails or produces no acceptable draft

#### Guard rails

- [ ] Do not bypass the existing content approval workflow for recurring campaigns
- [ ] Do not create infinite recurring jobs without a visible next-run / last-run state in admin
- [ ] Do not let one failed recurring run block every future run without a visible error state and recovery action

## Roadmap Update (2026-04-16 SEO Intent Hub for "อะไหล่แอร์รถยนต์")

> Scope for this round: strengthen ranking potential and AI-answer extractability for the core storefront intent `อะไหล่แอร์รถยนต์` without creating competing keyword-stuffed pages. Reuse the homepage and `/products` as the primary public hubs.

### Checklist

- [x] Tighten homepage metadata so the core intent `อะไหล่แอร์รถยนต์` is expressed explicitly in the title and description
- [x] Add an answer-first homepage section for `อะไหล่แอร์รถยนต์` with factual short-form explanations and internal links to key public hubs
- [x] Strengthen `/products` as the indexable hub for `อะไหล่แอร์รถยนต์` through metadata, visible copy, and clearer intent framing
- [x] Add `CollectionPage` structured data to `/products` so the listing hub is easier to interpret as a collection surface
- [x] Improve `llms.txt` with short, extractable guidance for the core `อะไหล่แอร์รถยนต์` intent
- [x] Verify `npm run build`

### Guard rails

- [x] Do not promise first-page rankings or guaranteed AI citations
- [x] Do not create duplicate public URLs that compete with the homepage and `/products` for the same keyword intent
- [x] Keep all SEO/AEO wording grounded in the real shop workflow: search on site first, then confirm with the shop before ordering

## Roadmap Update (2026-04-17 Homepage Canonical Root Cleanup)

- [x] Normalized the homepage root canonical signal to the host-form `https://www.sriwanparts.com` so app metadata and the rendered head use the same root URL shape consistently.
- [x] Aligned the homepage `openGraph.url` with the same normalized root canonical value.
- [x] Updated the home entry in `sitemap.xml` to use the same normalized root URL shape as the homepage canonical, reducing slash/no-slash mixed signals on `/`.
- [x] Verified `npm run build`

## Roadmap Update (2026-04-20 Thailand Date Policy Rollout)

- [x] Added a shared Thailand-aware date utility layer in `lib/th-date.ts` to separate `date-only` handling from timestamp formatting.
- [x] Replaced UTC-based default date values in transaction forms with Thailand-local defaults so document dates no longer drift to the previous day after midnight in Thailand.
- [x] Updated edit pages and lot/date serialization paths to emit `YYYY-MM-DD` values through the shared Thailand date helpers instead of `toISOString().slice(0, 10)`.
- [x] Updated transaction list filters and report query helpers to parse `from/to` ranges with Thailand start/end-of-day semantics instead of naive `new Date("YYYY-MM-DD")`.
- [x] Extended the rollout into key detail/list/report pages so displayed document dates also use the shared Thailand-aware formatter instead of ad-hoc `toLocaleDateString(...)` calls.
- [x] Codified the Thailand date-only vs timestamp policy in `.rules` so future changes must follow the same helper-based approach.
- [x] Kept existing business logic intact: no stock/MAVG/document-sequence logic was changed in this rollout.
- [x] Verified `npm run build`

## Roadmap Update (2026-04-20 Summary Report Stock Follow-up)

- [x] Updated the summary report `Stock` section to replace the `ประกันใกล้หมด` card with an owner-facing `เคลมค้างดำเนินการ` card.
- [x] Kept the open-claim definition aligned with the existing roadmap and LINE daily summary rule: only `WarrantyClaim.status in (DRAFT, SENT_TO_SUPPLIER)` is treated as still in progress.
- [x] Added open-claim fields to the summary payload so the report can show claim number/date, product, customer with sale reference, claim type, supplier name, and current status from the real claim workflow.
- [x] Verified `npm run build`
## Roadmap Update (2026-04-20 Summary Report Filter Separation)

- [x] Removed the summary-report open-claims date filter so current open claims now ignore the selected report `from/to` range.
- [x] Reorganized the summary-report layout so date-filtered sections and current-snapshot sections are visually separated.
- [x] Grouped date-filtered cards under `Overview`, `Cashflow`, and `Operations`, and moved stock/open-claim monitoring into the snapshot-oriented `Stock` section.
- [x] Verified `npm run build`

## Phase ใหม่ - Profit Dashboard และ Analytical Fact Layer

### Goal

- [x] เพิ่ม dashboard tab ใหม่ `Profit Dashboard` และเปลี่ยน dashboard เดิมเป็น `Daily Operations`
- [x] ให้ `Daily Operations` เป็น tab เริ่มต้นของหน้า dashboard
- [x] สร้าง analytical layer สำหรับกำไรโดยเฉพาะผ่านตารางกลาง `fact_profit`
- [x] คง transaction logic เดิมของระบบไว้ โดยให้ profit analytics อ่านผ่านชั้น fact ใหม่แทนการไปกระทบ stock / cash / AR/AP logic เดิม
- [ ] ทำให้เจ้าของเห็นได้เร็วว่า วันนี้กำไรไหม, อะไรทำเงิน/ขาดทุน, และสิ้นเดือนมีแนวโน้มเหลือเท่าไร

### Locked decisions

- [x] ใช้ `fact_profit` แบบ table หลัก ไม่ใช้ pure database view
- [x] ยึดต้นทุนขายจาก `SaleItem.costPrice` ซึ่งเป็น snapshot ต้นทุนเฉลี่ยตอนขาย
- [x] แยก transaction layer ออกจาก analytical / KPI layer อย่างชัดเจน
- [x] Profit recognition หลักใน phase นี้ใช้ 3 source แรก: `SALE`, `SALE_RETURN`, `EXPENSE`
- [x] ไม่ย้าย logic กำไรไปผูกกับ `Receipt`, `SupplierPayment`, หรือ `CashBankMovement`
- [x] Profit Dashboard รองรับ revenue display basis แบบ dropdown `ก่อน VAT` / `รวม VAT` โดย default เป็น `ก่อน VAT`
- [x] แบบแสดงผล `รวม VAT` เปลี่ยนเฉพาะยอดขายและ view ที่อิงยอดขาย ส่วน `Gross Profit`, `Net Profit`, และ `Margin %` ยังคำนวณบนฐาน `ก่อน VAT`
- [x] `Profit by Stock` ใน phase นี้หมายถึงกำไรรวมแยกตามสินค้า (aggregate by product จาก `fact_profit`) ไม่ใช่ lot-level / stock-movement profit

### Phase 1 - Business definition lock

- [x] ล็อกนิยาม `Gross Profit`, `Net Profit`, `Profit per Unit`, `Margin %` ให้ตรงกันทั้ง dashboard และ report
- [x] ล็อกฐานคำนวณรายได้ว่าต้องใช้ก่อน VAT หรือรวม VAT ในแต่ละ KPI
- [x] ล็อกวิธีคิด `SALE_RETURN` ว่าต้อง reverse ทั้งรายได้และต้นทุนของรายการคืน
- [x] ล็อกความหมายของ `Profit by Invoice` กับ `Profit by Stock` ให้เป็นคนละ analytical view ชัดเจน
- [x] ล็อกพฤติกรรมกรณี `create / update / cancel` เอกสาร ว่า fact ต้อง rebuild จากสถานะเอกสารปัจจุบันโดยไม่กระทบ logic เดิม

### Phase 2 - Schema และ analytical fact design

- [x] เพิ่มตาราง `fact_profit` ใน `prisma/schema.prisma`
- [ ] ออกแบบ grain เป็นหนึ่งแถวต่อเหตุการณ์กำไรที่ trace กลับไปยังเอกสารต้นทางและ line ต้นทางได้
- [x] กำหนด field หลักอย่างน้อย: `businessDate`, `sourceType`, `sourceId`, `sourceLineId`, `docNo`, `statusActive`, `productId`, `customerId`, `supplierId`, `qty`, `salesAmountExVat`, `costAmount`, `grossProfit`, `expenseAmount`, `netProfitContribution`, `unitSellPrice`, `unitCostPrice`, `unitProfit`, `marginPct`, `versionNo`, `createdAt`, `updatedAt`
- [x] เพิ่ม index ที่รองรับ dashboard query เช่น `businessDate`, `sourceType`, `productId`, `customerId`, `statusActive`
- [x] เตรียม enum / source-type contract สำหรับ `SALE`, `SALE_RETURN`, `EXPENSE`

### Phase 3 - Profit fact write service

- [x] เพิ่ม service กลาง เช่น `lib/profit-fact.ts` สำหรับ upsert / rebuild / deactivate fact
- [x] เพิ่ม service query layer เช่น `lib/profit-dashboard.ts` สำหรับ KPI, ranking, trend, alerts
- [x] แยก logic การสร้าง fact ออกจากหน้า UI และออกจาก action แต่ละเอกสาร
- [x] ทำให้ service รองรับ rebuild แบบทั้งเอกสารโดยไม่ต้องแก้ logic transaction เดิมซ้ำหลายจุด

### Phase 4 - Transaction integration

- [x] ผูก `createSale` ให้สร้าง `fact_profit` จาก `SaleItem.costPrice`
- [x] ผูก `updateSale` ให้ rebuild fact ของ sale ใบนั้นใหม่ทั้งชุด
- [x] ผูก `cancelSale` ให้ deactivate หรือ reverse fact ของ sale ใบนั้น
- [x] ผูก `createCreditNote` ให้สร้าง fact ประเภท `SALE_RETURN`
- [x] ผูก `updateCreditNote` ให้ rebuild fact ของ credit note ใบนั้น
- [x] ผูก `cancelCreditNote` ให้ deactivate หรือ reverse fact ของ credit note ใบนั้น
- [x] ผูก `createExpense`, `updateExpense`, `cancelExpense` ให้ sync fact สำหรับ net profit
- [x] ระวังไม่ให้กระทบ `StockCard`, MAVG, AR/AP remain, และ cash-bank ledger logic เดิม

### Phase 5 - Backfill และ reconciliation

- [x] เพิ่ม script backfill เพื่อสร้าง `fact_profit` จากข้อมูลเก่า
- [x] เพิ่ม script / report สำหรับเทียบผลรวมจาก `fact_profit` กับ logic รายงานเดิม
- [x] ตรวจให้ตัวเลข Gross Profit / Net Profit ตรงกับ source-of-truth ที่คาดหวังก่อนเปิดใช้ dashboard ใหม่
- [x] รัน `npm run build` และทดสอบ flow เอกสารสำคัญหลังผูก fact layer

### Phase 6 - Dashboard tab split

- [x] ปรับหน้า dashboard ให้มี tabs `Daily Operations` และ `Profit Dashboard`
- [x] ตั้งค่า default tab เป็น `Daily Operations`
- [x] แยก component ของ dashboard เดิมออกจาก component ของ profit dashboard ให้ดูแลง่าย
- [x] แยก filter ที่อิงช่วงวันที่ออกจาก snapshot/current-state blocks ให้ผู้ใช้เข้าใจได้ทันที

### Phase 7 - Profit Dashboard MVP

- [x] ทำ `Daily Snapshot` KPI: `ยอดขายวันนี้`, `ต้นทุนขาย`, `กำไรขั้นต้น`, `% Margin`
- [x] แสดงเทียบ `เมื่อวาน` หรือ `เป้า` พร้อมสีช่วยตัดสินใจ
- [x] ทำตาราง `Money Maker / Killer` แสดงสินค้า, ยอดขาย, ต้นทุน, กำไร, `% Margin`
- [x] ทำมุมมอง `Profit by Invoice` เพื่อ drill down กลับไปยังเอกสารขายได้
- [x] ทำมุมมอง `Profit by Stock` ในความหมายที่ล็อกไว้จาก business definition

### Phase 8 - Trend และ owner view

- [x] เพิ่มกราฟ `ยอดขายรายวัน`
- [x] เพิ่มกราฟ `กำไรขั้นต้น`
- [x] เพิ่มกราฟ `% Margin`
- [x] เพิ่ม monthly owner view: `รายได้รวม`, `ค่าใช้จ่ายรวม`, `กำไรสุทธิ`
- [x] แสดง `เดือนนี้ vs เดือนที่แล้ว` และ `% change`

### Phase 9 - Alerts และ Profit Analysis

- [x] เพิ่ม alert `Margin ต่ำกว่า threshold`
- [x] เพิ่ม alert `สินค้าขาดทุน`
- [x] เพิ่ม alert `ต้นทุนเฉลี่ยพุ่ง`
- [x] เพิ่ม profit analysis สำหรับ `ตามสินค้า`, `ตามลูกค้า`, และช่องวิเคราะห์ที่รองรับการตัดสินใจของเจ้าของ
- [x] รองรับ drill down จาก dashboard ไปดู transaction / invoice ที่เป็นต้นเหตุได้

### Delivered slice note (2026-04-20)

- [x] Added `fact_profit` schema, generated Prisma client, and pushed the schema to the live database.
- [x] Backfilled current historical data into `fact_profit` with the initial dataset snapshot: 20 sales, 2 credit notes, and 3 expenses.
- [x] Released the first working `Profit Dashboard` slice with daily snapshot, product ranking, trend cards, owner monthly summary, alerts, and invoice-profit view.
- [x] Added `reconcile:fact-profit` and aligned the legacy report profit logic so `CreditNote RETURN` reverses both revenue and COGS, eliminating reconciliation delta against `fact_profit`.
- [x] Added `enable:fact-profit-rls` and enabled row level security on `public.FactProfit` to clear the security advisor warning for the new analytical table.
- [x] Clarified the dashboard split between today snapshot vs filtered analysis, added the `% Margin` trend chart, and linked `Profit by Invoice` rows back to sale / credit-note documents for faster drill down.
- [x] Expanded `fact_profit` to persist both `ก่อน VAT` and `รวม VAT` revenue fields, added a revenue-basis dropdown to Profit Dashboard, and backfilled / reconciled production with zero delta against the legacy report.
- [x] Added `Profit by Stock` as product-aggregated profit analysis, added `Profit by Customer`, and enabled drilldown from the dashboard to customer detail and source sale / credit-note documents.
- [x] Added filter-ready drilldown from Profit Dashboard to `/admin/sales` and `/admin/credit-notes` using `customerId` / `productId` plus the same date range, so owners can jump from summary rows into the causal document list in one click.
- [x] Refined the dashboard so `สินค้าเด่นทำกำไร` / `สินค้าเสี่ยงกำไรต่ำ` stay as compact spotlight/watchlist blocks, while `Profit by Stock`, `Profit by Customer`, and `Profit by Invoice` became paginated analysis tables to keep long result sets manageable.
- [x] Moved analysis-table pagination into `lib/profit-dashboard.ts` so stock/customer/invoice sections page from the query layer instead of slicing fully aggregated arrays in the component.
- [x] Replaced the filtered trend-summary cards from fixed month-comparison values to selected-range summaries plus same-length previous-range comparison, so revenue / expense / net-profit cards now change with the chosen `profitFrom` / `profitTo`.

## Roadmap Update (2026-04-21 Admin Light/Dark Theme Rollout)

> Scope for this round: add a user-controlled light/dark theme switch for the protected `/admin` experience, keep the current light theme unchanged, persist each signed-in user's choice safely, and avoid any business-logic regression while tightening dark-mode coverage across shared admin surfaces.

### Checklist

- [x] Added a shared admin theme layer and a top-right toggle button in the protected admin shell
- [x] Persisted the selected theme per signed-in user with a user-scoped cookie, without changing transaction/business logic
- [x] Kept the current light mode visuals as the default/reference design
- [x] Added a dark palette for shared admin chrome such as header, sidebar, tabs, cards, inputs, tables, alerts, overlays, and chart tooltips
- [x] Extended dark-mode coverage into shared admin patterns and high-risk dashboard/chart surfaces so common hard-coded color utilities do not break readability
- [x] Performed a targeted dark-mode QA pass on dashboard cards, alerts, loading state, and portal-based select dropdowns used across admin transaction forms
- [x] Added admin-scoped semantic color mappings so success/warning/error/info badges remain legible across protected admin pages without changing business logic
- [x] Performed a second polish pass on dashboard/chart surfaces to improve card depth, helper contrast, loading skeletons, and dark-mode chart readability
- [x] Added a lightweight `npm run test:admin-theme-regression` source-level guard so admin theme wiring and the no-toggle login requirement are checked automatically
- [x] Kept print pages and non-admin public pages unaffected by the admin theme work
- [x] Verified with `npm run build`

### Guard rails

- [x] Did not modify stock, accounting, AR/AP, document numbering, or permission logic as part of this UI-only change
- [x] Did not change the current light mode layout or spacing except where required to host the toggle safely
- [x] Kept the admin login page unchanged and did not add a theme toggle there
- [x] Kept the regression check lightweight and source-based instead of introducing a new browser-test framework in this round
- [x] Did not let dark mode leak into public/storefront routes or print-document output
- [x] Covered shared admin patterns first, then patched remaining dark-mode gaps deliberately

## Roadmap Update (2026-04-21 Admin Print Dark-Mode Isolation)

- Hardened the shared admin print surface so sales, receipts, delivery, and warranty-claim documents stay on a light document palette even when admin dark mode is active.
- Added a shared `print-document-root` escape hatch from admin dark-theme utility overrides so print preview and browser print keep the intended white background plus gray border/text contrast.
- Tightened standalone print hosts (`/admin/delivery/print`, `/admin/warranty-claims/[id]/print`) so the surrounding preview page no longer inherits the dark-mode body background while reviewing documents on screen.
