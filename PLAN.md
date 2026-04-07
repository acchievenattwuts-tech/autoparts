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
  CLOSED             // ปิดเคลม (รับกลับแล้ว หรือ supplier ปฏิเสธ)
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
| รับกลับ (RECEIVED) | `CLAIM_REPLACE_OUT` | — | -1 (ส่งลูกค้าที่รอ) |
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
- [x] ย้อนกลับ CLOSED → SENT_TO_SUPPLIER (reverse CLAIM_RECV_IN + recalculate)
- [x] ยกเลิกใบเคลม (CANCELLED) จากทุกสถานะ — ลบ StockCard ทั้งหมด + recalculate
- [x] แก้ไขรายละเอียด (symptom, note, supplier) ผ่าน `ClaimEditPanel`
- [x] หน้า list `/admin/warranty-claims` — filter status / วันที่ + summary cards (4 สถานะ)
- [x] Action buttons ต่อแถว: พิมพ์, ดู, แก้ไข, ยกเลิก (เหมือน sales)
- [x] `CancelDocButton` modal ยืนยัน + หมายเหตุ

---

#### Phase 4.4-F — ใบเคลม Print

- [x] Print template: เลขที่ใบเคลม, วันที่, ข้อมูลร้าน, ข้อมูล supplier, รายละเอียดสินค้า, unitSeq, อาการ, ลายเซ็น
- [x] Print page อยู่นอก `(protected)` layout — ไม่มี admin shell ติดมาตอนพิมพ์
- [x] `PrintFromListButton` (iframe) — พิมพ์จาก list โดยไม่ navigate ออก

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
- [x] **Lot Trace** — ค้นหา Lot No → ดูใบซื้อต้นทาง + ใบขาย + ใบคืน + CN — `/admin/lots/trace`
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

**ยังไม่ได้ทำ (ข้ามตามที่ตกลง):**
- [ ] AR Register / AP Register (ยังไม่ implement)
- [ ] รายงานภาษีขาย / ภาษีซื้อ (ยังไม่ implement)

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
- [ ] เพิ่มเมนู `/admin/cash-bank/accounts`
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
- [x] ปรับ static generation concurrency ให้เหมาะกับ Supabase session pool เพื่อให้ build/deploy ของ storefront เสถียรมากขึ้น
- [x] วิเคราะห์ JavaScript bundle เพิ่มด้วย `@next/bundle-analyzer` และบันทึก snapshot ไว้ที่ `docs/performance/bundle-analysis-2026-04-02.md`
- [x] ตรวจ dependency audit ระดับ low-risk แล้ว และยืนยัน package ที่ยังต้องคงไว้ตาม source/config ปัจจุบัน
- [ ] clean up dependency ที่ไม่ได้ใช้จริง: `shadcn` (^4.1.0) และ `tw-animate-css` (^1.4.0) — ยืนยันแล้วว่า 0 imports ใน codebase
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
- [ ] Submit sitemap ใน Google Search Console *(manual action — ต้องทำใน GSC)*

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
- [ ] ทดสอบด้วย [Google Rich Results Test](https://search.google.com/test/rich-results) *(manual action)*

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
- Tuned Next.js static generation concurrency to better fit the current Supabase session pool limits during build.
- This reduces the risk of prerender failures caused by too many concurrent DB reads while keeping public SEO pages prerendered.

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

- Card: เจ้าหนี้คงค้าง (A/P)
- Card: เงินมัดจำ supplier คงเหลือ
- Card: เครดิต CN ซื้อคงเหลือ
- ปรับ daily cash-in ให้รวม `PurchaseReturn(CASH_REFUND)`
- ปรับ daily cash-out ให้รวม `SupplierAdvance` และ `SupplierPayment`

## Supplier AP Implementation Checklist

อัปเดตล่าสุด: `2026-04-07`

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

- [ ] ขยาย reports / dashboard / export สำหรับ A/P เต็มรูปแบบ
  - รายงานเงินมัดจำ supplier คงเหลือ ณ วันที่
  - รายงานเจ้าหนี้คงค้าง (A/P) ณ วันที่
  - รายงานเครดิต CN ซื้อคงเหลือ ณ วันที่
  - รายงานฐานะสุทธิ supplier ณ วันที่
  - dashboard cards: A/P, supplier advance outstanding, purchase return supplier credit outstanding

- [ ] ทำ data migration / backfill สำหรับเอกสารซื้อเก่าที่ต้องเข้ากับ flow ใหม่

### หมายเหตุการติดตามงาน

- [x] ใช้ checklist นี้เป็นตัวบอกสถานะปัจจุบันแทนการ append log ต่อท้าย
- [x] งานที่เสร็จแล้วต้องย้ายมาอยู่ใต้ `เสร็จแล้ว`
- [ ] งานที่เริ่มทำรอบถัดไปให้ย้ายมาอยู่หัวข้อ `กำลังทำ` หากต้องการติดตามละเอียดขึ้น
