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

### 🔲 Phase 5 — Search Performance Upgrade (หน้าบ้าน + หลังบ้าน)

> **เป้าหมาย:** ให้ลูกค้าและพนักงานค้นหาสินค้าได้เร็วที่สุดในระยะยาว โดยยังคงขอบเขตการค้นหาเดิม 100%
> **กฎเหล็ก:** ห้ามทำให้ field ที่ค้นหาได้เดิมหายไป, ห้ามทำให้ผลลัพธ์ผิด, และห้าม rollout แบบเสี่ยงกระทบระบบอื่นโดยไม่มี benchmark + fallback
> **ขอบเขตการค้นหาที่ต้องคงไว้:** `name`, `code`, `description`, `aliases`, `car brand`, `car model`, `category`, `parts brand`

#### Phase 5-A — Audit + Benchmark + Safety Baseline
- [ ] วัดความเร็วของ search ปัจจุบันทั้ง `/products` และ `/admin/products`
- [ ] เก็บ baseline: response time, DB query time, จำนวน rows, payload size, และ TTFB
- [ ] ระบุ query ปัจจุบันที่ใช้ `contains` หลาย field ใน `lib/product-search.ts`
- [ ] ระบุจุดเสี่ยงที่อาจกระทบระบบอื่น เช่น product form dropdown, admin list, featured products, และ public filters
- [ ] สรุป acceptance criteria ก่อนลงมือ:
  - เร็วขึ้นจริงทั้งหน้าบ้านและหลังบ้าน
  - เงื่อนไขค้นหาเดิมต้องครบ
  - ถ้าคำค้นเดิมเคยเจอ ต้องยังเจอ
  - ต้องมี fallback path ถ้า search engine ใหม่มีปัญหา

#### Phase 5-B — Database Search Architecture (Supabase/PostgreSQL)
- [ ] ออกแบบ search engine ใหม่บน PostgreSQL ให้เร็วที่สุดในระยะยาว โดยใช้ **Full-text search + trigram/partial match**
- [ ] ออกแบบ search document ต่อสินค้าแบบรวมข้อมูลค้นหาทั้งหมดในที่เดียว
- [ ] เพิ่ม index ที่จำเป็นให้ปลอดภัยและตรง field ที่ใช้งานจริง
- [ ] รองรับทั้งคำค้นทั่วไป, รหัสสินค้า, alias, รุ่นรถ, ยี่ห้อรถ, และคำค้นบางส่วน
- [ ] ออกแบบ ranking ให้ผลลัพธ์ที่ตรงที่สุดขึ้นก่อน โดยไม่ทำให้ code/product exact match หาย
- [ ] เขียน rollout plan แบบไม่กระทบระบบเดิม:
  - ใช้ engine ใหม่หลัง benchmark ผ่าน
  - เก็บ engine เดิมเป็น fallback ชั่วคราว
  - ทดสอบบน data จริงก่อนเปิดใช้เต็ม

#### Phase 5-C — Shared Search Service (ใช้ร่วมกันทั้งระบบ)
- [ ] สร้าง search layer กลางให้ `/products` และ `/admin/products` ใช้ชุด logic เดียวกัน
- [ ] แยก concerns ให้ชัด:
  - search engine = รับผิดชอบ query และ ranking
  - page layer = รับผิดชอบ filter, pagination, select fields, และ rendering
- [ ] จำกัด select/payload ให้เบาที่สุดตามหน้าใช้งาน
- [ ] Hero search, navbar search, และ search หน้าสินค้าต้องยิงเข้าระบบค้นหาเดียวกัน
- [ ] Admin product search ต้องได้ความเร็วเพิ่ม โดยไม่กระทบ permissions และฟังก์ชันเดิม

#### Phase 5-D — Verification + Rollout + Regression Protection
- [ ] เทียบผลลัพธ์ engine ใหม่กับ engine เดิมด้วยชุดคำค้นจริงของร้าน
- [ ] ทดสอบคำค้นกลุ่มสำคัญ:
  - ชื่อสินค้าเต็ม
  - รหัสสินค้า
  - alias
  - ยี่ห้อรถ
  - รุ่นรถ
  - หมวดสินค้า
  - parts brand
  - คำค้นบางส่วน / สะกดไม่ครบ
- [ ] วัด performance ซ้ำหลังเปลี่ยน และบันทึกผลเทียบ baseline
- [ ] ถ้าผลลัพธ์หรือความเร็วไม่ผ่านเกณฑ์ ห้ามเปิดใช้เต็ม
- [ ] เพิ่ม regression checklist สำหรับการแก้ search ครั้งถัดไป
- [ ] อัปเดต roadmap ว่า public/admin search ใช้ search engine ใหม่แล้วเมื่อ rollout เสร็จ

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

### 🔲 Phase 5.5-F — แก้ไขเอกสาร + Lot Edit (ทุกโมดูลที่มี Lot)

> **Priority 1 — Bug Fix (Silent Data Corruption)**
> `updatePurchase` และ `updateSale` ปัจจุบันลบ PurchaseItem/SaleItem ด้วย cascade
> โดยไม่ reverse LotBalance ก่อน → LotBalance เกินจริง หลังแก้ไขเอกสารที่มี Lot

---

#### Phase 5.5-F1 — แก้ Bug: updatePurchase ไม่ reverse LotBalance 🔴 BUG

**ไฟล์:** `app/admin/(protected)/purchases/actions.ts`

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

#### Phase 5.5-F2 — แก้ Bug: updateSale ไม่ reverse LotBalance 🔴 BUG

**ไฟล์:** `app/admin/(protected)/sales/actions.ts`

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

#### Phase 5.5-F3 — ใบคืนซัพพลายเออร์ รองรับ Lot (ครั้งแรก)

**ไฟล์:** `app/admin/(protected)/purchase-returns/actions.ts`  
**Component:** `app/admin/(protected)/purchase-returns/new/PurchaseReturnForm.tsx` (และ edit)

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

#### Phase 5.5-F4 — CN รับคืนจากลูกค้า (RETURN type) รองรับ Lot (ครั้งแรก)

**ไฟล์:** `app/admin/(protected)/credit-notes/actions.ts`  
**Component:** `app/admin/(protected)/credit-notes/new/CreditNoteForm.tsx` (และ edit)

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

### 🔲 Phase 5.5-G — Delivery แสดง Lot

**ไฟล์ที่กระทบ:**
- `app/admin/(protected)/delivery/[id]/page.tsx` (detail)
- `app/admin/(protected)/delivery/print/page.tsx` (print)

> ไม่มี stock/lot transaction ใหม่ — Delivery เป็นแค่ logistics status

#### G-1: Delivery Detail แสดง Lot

**Query เพิ่ม:**
```typescript
// ใน sale items include:
lotItems: { select: { lotNo: true, qty: true } }
// + batch join ProductLot สำหรับ expDate
const productLotExpMap = ...  // เหมือน pattern ใน sales/[id]/edit/page.tsx
```

**UI:**
- ใต้แต่ละบรรทัดสินค้า แสดง lot chips: `LOT-001 × 5 | EXP 31/12/2026`
- สีเตือน: orange ถ้า EXP ≤ 30 วัน, red ถ้าหมดอายุแล้ว

**Checklist:**
- [ ] `delivery/[id]/page.tsx` — query `lotItems` + `productLotExpMap`
- [ ] แสดง lot chips ใต้แต่ละ item row

#### G-2: ใบส่งของ (Print) แสดง Lot

**ไฟล์:** `app/admin/(protected)/delivery/print/page.tsx` (หรือ component ใบส่งของ)

**เพิ่ม:**
- คอลัมน์ "Lot No" ในตารางสินค้าของใบส่งของ
- ถ้า item มีหลาย lot → แสดงทุก lot บนบรรทัดใหม่ย่อย

**Checklist:**
- [ ] query `lotItems` ใน delivery print
- [ ] เพิ่มคอลัมน์ Lot No ในตารางสินค้า
- [ ] ทดสอบ print layout ไม่แตก

---

### 🔲 Phase 5.5-H — Warranty + Claim Lot Integration

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
- [ ] เพิ่ม `lotNo String?` ใน Warranty schema
- [ ] `prisma db push`
- [ ] แก้ logic สร้าง Warranty หลัง createSale: assign lotNo ตาม sequential algorithm
- [ ] แก้ logic สร้าง Warranty หลัง updateSale: re-assign lotNo ใหม่
- [ ] UI warranty list: เพิ่มคอลัมน์ Lot No
- [ ] UI warranty detail: แสดง Lot No
- [ ] UI claim form: แสดง lot ต้นทาง (read-only, จาก warranty.lotNo)

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
- [ ] เพิ่ม `WarrantyClaimLot` model
- [ ] เพิ่ม relation `claimLots` ใน `WarrantyClaim`
- [ ] `prisma db push`

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
- [ ] เพิ่ม `writeClaimLot` ใน `lib/lot-control.ts`
- [ ] เพิ่ม `reverseClaimLotBalance` ใน `lib/lot-control.ts`
- [ ] แก้ `warranty-claims/actions.ts`:
  - `CLAIM_RETURN_IN`: เรียก `writeClaimLot` direction="in" ด้วย `warranty.lotNo`
  - `CLAIM_SEND_OUT`: เรียก `writeClaimLot` direction="out"
  - `CLAIM_RECV_IN`: เรียก `writeClaimLot` direction="in" ด้วย lot ที่รับมา
  - `CLAIM_REPLACE_OUT`: เรียก `writeClaimLot` direction="out" ด้วย lot ที่ส่ง
- [ ] แก้ `cancelWarrantyClaim`: เรียก `reverseClaimLotBalance`
- [ ] UI Claim Form: 
  - CLAIM_RETURN_IN / CLAIM_RECV_IN: input/dropdown lot (pre-fill จาก warranty.lotNo)
  - CLAIM_SEND_OUT: แสดง lot ต้นทาง (auto-fill, editable)
  - CLAIM_REPLACE_OUT: dropdown เลือก lot ที่จะส่งออก (filter LotBalance > 0)
- [ ] Test: ทุก ClaimType → LotBalance ถูกต้อง + ยกเลิก → reverse ถูกต้อง

---

### สรุป Schema Changes Phase 5.5-F/G/H

| Table | การเปลี่ยน | Requires |
|---|---|---|
| `Warranty` | เพิ่ม `lotNo String?` | `prisma db push` + migrate existing rows = null |
| `WarrantyClaimLot` | ตารางใหม่ | `prisma db push` |
| `WarrantyClaim` | เพิ่ม relation `claimLots` | `prisma db push` |
| อื่นๆ | ไม่เปลี่ยน schema | — |

---

### 🔲 Phase 6 — Report (ยังไม่ได้ทำ)
- [ ] Report สรุปยอดขาย (รายวัน/สัปดาห์/เดือน)
- [ ] Report กำไร-ขาดทุน (รวม VAT breakdown)
- [ ] Report stock คงเหลือ + สินค้าต่ำกว่า minStock
- [ ] Report ประกันที่กำลังจะหมด
- [ ] Export Excel / PDF

### 🔲 Phase 7 — SEO + AEO + AIO + Core Web Vitals (ยังไม่ได้ทำ)

**เป้าหมาย:** ติดอันดับ Google + ขึ้นใน AI search (ChatGPT, Perplexity, Google AI Overview) + Core Web Vitals ผ่าน

---

#### Phase 7-A — URL Structure (อ่านรู้เรื่อง / SEO-Friendly)

- [ ] เปลี่ยน URL สินค้าเป็น `/products/[categorySlug]/[productSlug]` — ใช้ชื่อที่สื่อความหมาย ภาษาไทย-อังกฤษ
- [ ] เปลี่ยน URL หมวดหมู่เป็น `/products/[categorySlug]` — เช่น `/products/compressor` แทน `/products?category=xxx`
- [ ] สร้าง `slug` field ใน `Product` และ `Category` (unique, kebab-case, รองรับภาษาไทย transliterate)
- [ ] 301 redirect จาก URL เดิมไปยัง URL ใหม่ (ไม่ให้ broken link)
- [ ] ทุก URL ต้องอ่านแล้วรู้ทันทีว่าคืออะไร เช่น `/products/คอมเพรสเซอร์/denso-toyota-camry-2.0`

---

#### Phase 7-B — Core Web Vitals (บังคับผ่าน)

**เป้าหมาย:** LCP < 2.5s | INP < 200ms | CLS < 0.1

- [ ] วัด Core Web Vitals ด้วย Lighthouse / PageSpeed Insights ก่อนทำ — บันทึก baseline
- [ ] **LCP (Largest Contentful Paint):**
  - [ ] ใส่ `priority` ใน `<Image>` ที่เป็น hero/above-fold ทุกหน้า
  - [ ] Preload font Kanit + Sarabun ผ่าน `next/font` (ทำแล้ว — verify)
  - [ ] ตรวจ TTFB — ถ้าเกิน 800ms ให้เพิ่ม `revalidate` / static generation ในหน้าที่ทำได้
- [ ] **INP (Interaction to Next Paint):**
  - [ ] ลด JavaScript bundle — วิเคราะห์ด้วย `@next/bundle-analyzer`
  - [ ] แยก Client Components ให้เล็กที่สุด — ย้าย logic ที่ทำ server ได้ไป Server Component
  - [ ] ลบ package ที่ไม่ใช้ออก (ตรวจด้วย `depcheck`)
  - [ ] ใช้ `dynamic(() => import(...), { ssr: false })` สำหรับ component หนักที่ไม่ต้องการ SSR
- [ ] **CLS (Cumulative Layout Shift):**
  - [ ] ทุก `<Image>` ต้องมี `width`+`height` หรือ `fill`+`sizes` — ไม่มีรูปไม่ระบุขนาด
  - [ ] Font swap: ใช้ `font-display: swap` (next/font ดูแลให้แล้ว — verify)
  - [ ] Reserved space สำหรับ dynamic content (skeleton / min-height)
- [ ] วัดซ้ำหลังแก้ — ถ้าไม่ผ่านเกณฑ์ใดให้เสนอแผนแก้ไขเพิ่มเติมพร้อม root cause

---

#### Phase 7-C — Metadata + Open Graph

- [ ] Next.js Metadata API ครบทุกหน้า: `title`, `description`, `canonical`
  - หน้าหลัก: "ศรีวรรณ อะไหล่แอร์ — อะไหล่แอร์รถยนต์ราคาส่ง ชลบุรี"
  - หน้าสินค้า: `{ชื่อสินค้า} | ศรีวรรณ อะไหล่แอร์`
  - หน้าหมวดหมู่: `{หมวดหมู่} ราคาส่ง | ศรีวรรณ อะไหล่แอร์`
- [ ] Open Graph + Twitter Card — รูป og:image ขนาด 1200×630px ต่อสินค้า
- [ ] `<link rel="canonical">` ทุกหน้า (ป้องกัน duplicate content)

---

#### Phase 7-D — XML Sitemap + robots.txt

- [ ] `app/sitemap.ts` — dynamic sitemap ครอบคลุม:
  - หน้าหลัก, หน้าสินค้าทุกชิ้น, หน้าหมวดหมู่ทุกหมวด, `/about`, `/faq`
  - ใส่ `lastModified`, `changeFrequency`, `priority` ให้ถูกต้องตามประเภทหน้า
  - สินค้าที่ไม่ active (`isActive: false`) ต้องไม่อยู่ใน sitemap
- [ ] `app/robots.ts` — Next.js Metadata robots:
  - Allow: `/`, `/products/`, `/about`, `/faq`
  - Disallow: `/admin/`, `/api/`, `/profile/`
  - Sitemap: `https://sriwanparts.com/sitemap.xml`
- [ ] Submit sitemap ใน Google Search Console

---

#### Phase 7-E — Schema Markup (JSON-LD แยกไฟล์)

> **หลักการ:** JSON-LD ทุกอันเขียนเป็น component แยก ไม่ inline ใน JSX — import เข้าหน้าผ่าน `<script type="application/ld+json">`

- [ ] `components/seo/LocalBusinessJsonLd.tsx` — ข้อมูลร้าน:
  ```json
  { "@type": "LocalBusiness", "name": "ศรีวรรณ อะไหล่แอร์",
    "address": {...}, "telephone": "...", "openingHours": "Mo-Sa 08:00-17:00",
    "geo": { "latitude": ..., "longitude": ... }, "priceRange": "฿฿" }
  ```
- [ ] `components/seo/ProductJsonLd.tsx` — ต่อสินค้า:
  ```json
  { "@type": "Product", "name": "...", "image": "...", "description": "...",
    "brand": { "@type": "Brand", "name": "..." },
    "offers": { "@type": "Offer", "price": "...", "priceCurrency": "THB", "availability": "..." } }
  ```
- [ ] `components/seo/BreadcrumbJsonLd.tsx` — navigation path ทุกหน้า
- [ ] `components/seo/FaqJsonLd.tsx` — หน้า FAQ
- [ ] `components/seo/OrganizationJsonLd.tsx` — ข้อมูลองค์กร + social profiles
- [ ] ทดสอบด้วย [Google Rich Results Test](https://search.google.com/test/rich-results)

---

#### Phase 7-F — AIO Content (ให้ AI อ้างอิงได้ + น่าเชื่อถือ)

> **หลักการ:** เขียนเนื้อหาที่ตอบคำถามตรงๆ ชัดเจน ไม่ต้องตีความ — AI จะนำไปอ้างอิงได้ทันที (Generative Engine Optimization)

- [ ] **หน้า `/about`** — E-E-A-T สูง:
  - ประวัติร้าน (ก่อตั้งปีไหน, ประสบการณ์กี่ปี)
  - ความเชี่ยวชาญ: อะไหล่แอร์รถยนต์ทุกยี่ห้อ, คอมเพรสเซอร์, หม้อน้ำ, แผงแอร์
  - พื้นที่บริการ: ชลบุรี, ระยอง, จันทบุรี, ภาคตะวันออก
  - ใบรับรอง / ตัวแทนจำหน่ายอย่างเป็นทางการ (ถ้ามี)
- [ ] **หน้า `/faq`** — ตอบคำถามที่ AI ถามบ่อย:
  - "คอมเพรสเซอร์แอร์รถยนต์ราคาเท่าไหร่?"
  - "อะไหล่แอร์ Toyota/Honda/Isuzu มีไหม?"
  - "ส่งสินค้าต่างจังหวัดได้ไหม?"
  - "รับประกันสินค้านานเท่าไหร่?"
  - ใช้ `FAQPage` JSON-LD คู่กัน
- [ ] **หน้า `/knowledge`** — บทความให้ความรู้ (ทำให้ AI อ้างอิงเป็น source):
  - "วิธีเลือกคอมเพรสเซอร์แอร์รถยนต์"
  - "สัญญาณบอกว่าแอร์รถยนต์เสีย"
  - "ความแตกต่างระหว่างอะไหล่แท้ vs อะไหล่เทียม"
  - เนื้อหาต้องมี: นิยามชัดเจน, ขั้นตอนที่ทำตามได้, ตัวเลขอ้างอิงได้
- [ ] **`llms.txt`** — ไฟล์แนะนำร้านสำหรับ AI crawlers (วางไว้ที่ `/public/llms.txt`):
  ```
  # ศรีวรรณ อะไหล่แอร์
  ร้านจำหน่ายอะไหล่แอร์รถยนต์ คอมเพรสเซอร์ หม้อน้ำ แผงแอร์
  ที่อยู่: [ที่อยู่จริง] จ.ชลบุรี
  โทร: [เบอร์จริง]
  เว็บไซต์: https://sriwanparts.com
  บริการ: จำหน่ายปลีก-ส่ง, จัดส่งทั่วประเทศ
  ความเชี่ยวชาญ: อะไหล่แอร์รถยนต์ทุกยี่ห้อ ประสบการณ์กว่า X ปี
  ```
- [ ] **AIO Signals** — เพิ่มในทุกหน้าสินค้า:
  - ระบุยี่ห้อรถที่ใช้ได้ชัดเจน (Toyota Camry 2.0, Honda Civic 1.5 Turbo ฯลฯ)
  - ระบุปีรถที่ compatible
  - ระบุ OEM part number (ถ้ามี)
  - รีวิว / rating (ถ้ามี) — ช่วย E-E-A-T

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
