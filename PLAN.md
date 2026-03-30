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
- [ ] Print รวมหลายใบในครั้งเดียว (สำหรับออกรถ) — ยังไม่ได้ทำ
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

- [ ] แก้ card "ลูกหนี้ค้างชำระ" แยกเป็น 2 ส่วน:
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

### 🔲 Phase 4.4 — ระบบเคลมสินค้า (Warranty Claim) (ยังไม่ได้ทำ)

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

- [ ] เพิ่ม `preferredSupplierId` ใน `Product`
- [ ] เพิ่ม `supplierId`, `supplierName` ใน `SaleItem`
- [ ] เพิ่ม `unitSeq` ใน `Warranty`
- [ ] สร้าง model `WarrantyClaim` พร้อม `claimType ClaimType`
- [ ] เพิ่ม enum `ClaimType`, `ClaimOutcome` และ 4 movement types ใน `StockMovementType`
- [ ] `prisma db push` + `prisma generate`

---

#### Phase 4.4-B — ปรับหน้าสินค้า

- [ ] เพิ่ม field `ผู้จำหน่ายหลัก (Preferred Supplier)` ใน `ProductForm` — SearchableSelect / ไม่บังคับ
- [ ] บันทึก `preferredSupplierId` ผ่าน server action สินค้า

---

#### Phase 4.4-C — ปรับหน้าขายสินค้า

- [ ] เพิ่ม column `supplierId` ต่อบรรทัดสินค้า — auto-fill จาก `product.preferredSupplierId` เมื่อเลือกสินค้า
- [ ] ผู้ใช้แก้ไขได้ (override) — SearchableSelect supplier ใน line item
- [ ] บันทึก `supplierId` + `supplierName` snapshot ลง `SaleItem`

---

#### Phase 4.4-D — ปรับระบบ Warranty (สร้างต่อหน่วย)

- [ ] แก้ logic สร้าง Warranty หลังบันทึกใบขาย: ถ้า `warrantyDays > 0` และ `qty = N` → สร้าง N rows (`unitSeq` 1…N)
- [ ] หน้า `/admin/warranties` แสดง unitSeq ต่อแถว
- [ ] Search/filter ตาม warranty card ทำได้

---

#### Phase 4.4-E — ใบเคลมสินค้า (Claim Form)

- [ ] หน้า `/admin/warranties/[id]/claim/new` — สร้างใบเคลมจาก warranty card
- [ ] ข้อมูลที่กรอก:
  - วันที่เคลม, อาการ/หมายเหตุ
  - supplier (auto-fill จาก SaleItem / แก้ได้), เบอร์โทร, ที่อยู่ supplier
  - **ClaimType**: เลือก "เปลี่ยนของใหม่ให้ลูกค้าทันที" หรือ "ลูกค้ารอเคลม"
- [ ] บันทึก → status = `DRAFT` + สร้าง StockCard:
  - ทั้ง 2 option: `CLAIM_RETURN_IN` +1
  - `REPLACE_NOW` เพิ่ม: `CLAIM_REPLACE_OUT` -1 (ส่งของใหม่ทันที)
- [ ] ปุ่ม "ส่งเคลม supplier" → status = `SENT_TO_SUPPLIER` + `CLAIM_SEND_OUT` -1
- [ ] หน้า list ใบเคลม `/admin/warranty-claims` — filter ตาม status / ClaimType / วันที่
- [ ] หน้าอัปเดตผลเคลม — เลือก outcome เมื่อ supplier ตอบกลับ:
  - `RECEIVED` → `CLAIM_RECV_IN` +1 + (ถ้า `CUSTOMER_WAIT`) `CLAIM_REPLACE_OUT` -1 ส่งให้ลูกค้าที่รอ → status = `CLOSED`
  - `NO_RESOLUTION` → ปิดเคลมโดยไม่มี stock movement → status = `CLOSED` (ของเสียยังติด stock ให้ปรับออกทีหลัง)
- [ ] เปลี่ยน status เป็น `CLOSED` เมื่อเสร็จสิ้น

---

#### Phase 4.4-F — ใบเคลม Print

- [ ] Print template: เลขที่ใบเคลม, วันที่, ข้อมูลร้าน, ข้อมูล supplier, รายละเอียดสินค้า, เลข warranty, unitSeq, อาการ, ลายเซ็น
- [ ] Print ได้จากหน้าดูรายละเอียดใบเคลม

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
