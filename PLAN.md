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
- [x] CN sale RETURN writes StockCard `priceIn` from the editable CN line price converted to base unit; default line price comes from the referenced sale, or product sale price when no sale is referenced. MAVG remains neutral for `RETURN_IN` per stock rules.
- [x] CN purchase supplier credit amount remains based on the saved CN purchase `totalAmount` and active supplier-payment usages.

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

#### Phase 4.2-G — Delivery Proof Mobile App UX

> **Scope:** เฟสนี้เพิ่มเฉพาะหลักฐานการส่งบนหน้าจัดส่งมือถือ ไม่เปลี่ยน business logic เดิมของการขาย/จัดส่ง
> **UX direction:** หน้าจอนี้ต้องรู้สึกเป็น mobile application ให้มากที่สุด ใช้งานเร็วในมือพนักงาน ไม่เหมือนตารางเว็บย่อส่วน

- [x] คง logic เดิมทั้งหมด: อัปเดทสถานะข้ามได้เหมือนเดิม, เปลี่ยนเป็น `DELIVERED` ได้แม้ไม่มี proof, และ proof ทุกช่องเป็น optional
- [x] เพิ่ม `DeliveryProof` ใน `prisma/schema.prisma` แบบแยก model เพื่อผูกกับ `Sale` และรองรับหลักฐานหลายประเภทในอนาคต
- [x] เก็บข้อมูล proof รอบนี้ให้ครบ: `receiverName`, `signatureImageUrl`, `deliveryPhotoUrl`, `note`, `capturedAt`, `capturedByUserId`
- [x] เพิ่ม relation จาก `Sale` และ `User` ไปยัง `DeliveryProof` เพื่อเปิดดูย้อนหลังและ audit ได้
- [x] เพิ่ม server action สำหรับบันทึกหลักฐานการส่ง โดยใช้ permission `delivery.update` และไม่ผูกเป็นเงื่อนไขของ `updateShippingStatus`
- [x] อัปโหลดลายเซ็นและรูปหน้าบ้าน/จุดวางของไป Supabase Storage ด้วย path แยก เช่น `delivery-proofs/{saleId}/...`
- [x] เพิ่มปุ่ม/entrypoint “หลักฐานรับของ” ใน mobile delivery card (`/admin/delivery/update`) โดยไม่รบกวนปุ่มเปลี่ยนสถานะเดิม
- [x] ออกแบบ proof modal/sheet แบบ app-like: เปิดเต็มจอหรือ bottom sheet, ปุ่มใหญ่, tap target ชัด, ใช้งานมือเดียวได้, รองรับ touch จริงบนมือถือ
- [x] เพิ่ม library แบบจำกัด scope เฉพาะ proof sheet: `signature_pad` สำหรับลายเซ็นที่ลื่นขึ้น และ `browser-image-compression` สำหรับบีบอัดรูปหน้าบ้านก่อนอัปโหลด โดย self-host worker script เพื่อไม่พึ่ง CDN
- [x] เพิ่มช่องชื่อผู้รับแบบพิมพ์ (`receiverName`) พร้อม placeholder สำหรับกรณีลูกค้าไม่เซ็นหรือฝากคนอื่นรับ
- [x] เพิ่ม signature pad สำหรับลูกค้าเซ็นบนมือถือพนักงาน โดย canvas ต้องพื้นหลังขาวเสมอแม้ admin อยู่ dark mode
- [x] ตอน export ลายเซ็นต้อง flatten พื้นหลังเป็นสีขาวและเส้นสีดำ/เข้ม เพื่อให้รูปย้อนหลังอ่านได้บนทุก theme
- [x] เพิ่มการถ่าย/อัปโหลดรูปหน้าบ้านหรือจุดวางของ (`deliveryPhoto`) ผ่าน input กล้องมือถือ (`accept="image/*"` + `capture`)
- [x] แยก UX ปุ่มรูปเป็น “ถ่ายรูป” และ “เลือกรูป” โดยใช้ input คนละตัว เพื่อลดความสับสนบนมือถือที่ fallback เป็น file picker
- [x] บีบอัด/resize `deliveryPhoto` ฝั่ง client ก่อน preview/upload เพื่อลดเวลาส่งไฟล์บนมือถือและลด storage โดย server validation เดิมยังทำงานเหมือนเดิม
- [x] เพิ่มช่องหมายเหตุการส่ง เช่น “ลูกค้าไม่สะดวกเซ็น”, “ฝากไว้หน้าบ้าน”, “ฝาก รปภ.” โดยไม่บังคับกรอก
- [x] แสดง preview หลักฐานก่อนบันทึก: รูปลายเซ็นบนกรอบขาว, รูปถ่าย, ชื่อผู้รับ, หมายเหตุ
- [x] แสดงสถานะใน card เมื่อมี proof แล้ว เช่น badge “มีหลักฐาน” และปุ่มเปิดดูย้อนหลัง
- [x] เพิ่มส่วนดูย้อนหลังในหน้า sale detail (`/admin/sales/[id]`) และ/หรือ delivery mobile card สำหรับรายการ `DELIVERED`
- [x] เพิ่มหน้า `/admin/sales/[id]/delivery-proofs` สำหรับดูหลักฐานทั้งหมดแบบ pagination เมื่อรายการเกิน 20 รายการล่าสุดในหน้า detail
- [x] เขียน audit log ตอนบันทึก proof โดย log meta/URL เท่านั้น ไม่เก็บ binary หรือ base64 ลง audit log
- [x] หลังบันทึก proof ให้ revalidate `/admin/delivery`, `/admin/delivery/update`, และ `/admin/sales/{saleId}`
- [x] ตรวจ light/dark mode ของ admin surface ให้ครบ โดยเฉพาะ signature pad ต้องไม่เปลี่ยนพื้นหลังตาม dark mode
- [x] Performance pass 2026-04-30: mobile delivery list now sends only lightweight proof metadata, opens one shared proof sheet, loads latest proof detail on demand, uploads signature/photo in parallel, lazy-loads proof images, caps sale-detail proof history at 20 latest rows, and adds a delivery desktop sort index.
- [ ] ทดสอบ flow หลัก: ส่งแล้วแบบไม่มี proof, บันทึก proof ก่อน/หลังส่งแล้ว, อัปเดทสถานะข้าม, ดูย้อนหลัง, ถ่ายรูปบนมือถือ, ลายเซ็นพื้นขาวใน dark mode

---

### ✅ Phase 4.2-H — Delivery Commission Settlement (เสร็จแล้ว — commit `8476325`)

> **ที่มา:** เพิ่มระบบทำจ่ายค่าส่งให้พนักงานส่งจากคิวจัดส่งที่ส่งสำเร็จแล้ว โดยยึดเปอร์เซ็นต์จากค่าส่งและบันทึกเป็นค่าใช้จ่ายจริง
> **หลักการบัญชี:** `shippingFee` ที่เก็บจากลูกค้าเป็นรายได้ค่าจัดส่ง ส่วนยอดทำจ่ายพนักงานส่งเป็นค่าใช้จ่าย ทำให้กำไรสุทธิถูกหักผ่าน Expense/CashBank/FactProfit และไม่ปนกับต้นทุนสินค้า

- [x] ออกแบบ schema สำหรับ `Sale.deliveryStaffId`, `DeliveryCommissionRun`, `DeliveryCommissionItem`, และ flag `ExpenseCode.isDeliveryCommission`
- [x] ตั้งค่าเปอร์เซ็นต์ค่าส่งเริ่มต้นใน `/admin/settings/company` (`delivery_commission_percent`)
- [x] เพิ่ม checkbox ในหน้ารหัสค่าใช้จ่ายให้เลือกได้เพียง 1 รหัสสำหรับเมนูทำจ่ายค่าส่ง
- [x] ปรับผู้ส่งให้บันทึกอัตโนมัติจาก user ที่ login ตอนเปลี่ยนสถานะเป็น `DELIVERED` และไม่ให้แก้เองหลังส่งแล้ว
- [x] แสดงผู้ส่งแบบ read-only ในหน้า `/admin/delivery` และ `/admin/delivery/update`
- [x] เพิ่มเมนู `/admin/delivery-commissions` สำหรับ preview/generate/cancel รอบทำจ่าย
- [x] เมื่อ generate สร้าง Expense, CashBankMovement, FactProfit, AuditLog และกันบิลซ้ำด้วย active run relation
- [x] เมื่อ cancel รอบทำจ่าย ให้ cancel Expense ที่เกี่ยวข้อง, ล้าง CashBankMovement, rebuild FactProfit และเปิดบิลให้พร้อมทำจ่ายใหม่
- [x] ปรับ FactProfit ให้แยกรายได้ค่าจัดส่งออกจากรายได้สินค้า โดย `ค่าจัดส่ง` เป็น line แยก และค่าทำจ่ายพนักงานลดกำไรสุทธิผ่าน Expense
- [x] ตรวจผลกระทบ LINE Daily Summary: กำไรขั้นต้นยังรวมค่าจัดส่ง, ค่าทำจ่ายเข้า `ค่าใช้จ่ายวันนี้`, ถ้าต้องการกำไรสุทธิต้องเพิ่มบรรทัด `netProfitAmount` แยก
- [x] ตรวจ dashboard กำไรสุทธิ รายงานค่าใช้จ่าย cash-bank ledger summary/export และ Quick Search ให้ครอบคลุม
- [x] เปิด RLS ให้ `public.DeliveryCommissionRun` และ `public.DeliveryCommissionItem` พร้อม script `prisma/scripts/enable-delivery-commission-rls.ts`
- [x] Verification: `npx prisma generate`, `npx prisma db push`, `npx tsc --noEmit`, `npm run build` ผ่าน

**Hardening update (2026-05-03)**
- [x] เพิ่ม DB guard กันบิลซ้ำข้ามรอบทำจ่ายด้วย `DeliveryCommissionItem.activeSaleId @unique` และให้ `createDeliveryCommissionRun` re-check รายการใน transaction เดียวก่อนสร้างเอกสาร
- [x] เพิ่ม retry รอบสร้างเลขเอกสารทำจ่าย/ค่าใช้จ่ายเมื่อชนกัน และจำกัด batch ทำจ่ายที่ 200 บิลต่อครั้ง พร้อมแจ้งเตือนให้กรองช่วงวันที่เพิ่มเมื่อเกิน limit
- [x] เพิ่ม `ExpenseCode.deliveryCommissionSlot @unique` เพื่อบังคับให้มีรหัสค่าใช้จ่ายสำหรับทำจ่ายค่าส่งพนักงานได้เพียง 1 รหัสในเวลาเดียวกัน
- [x] หน้า `/admin/delivery-commissions` เปลี่ยนเป็น SearchableSelect + client action feedback สำหรับ create/cancel และ export route แยก query proof / payout เพื่อลด relation fan-out
- [x] หน้า `/admin/delivery/update` mobile เพิ่ม permission-aware UI, refresh หลังบันทึก, delivered date filter, load more, และบังคับ reorder ได้เฉพาะเมื่อโหลดคิวเปิดครบทั้งชุด
- [x] `updateShippingStatus` stamp ผู้ส่งจาก user ที่ login ตอนเปลี่ยนเป็น `DELIVERED` แบบแก้ย้อนหลังไม่ได้ และ block การย้อนสถานะถ้ามี active delivery commission payout แล้ว
- [x] เพิ่ม index ที่ใช้จริงกับ delivery/product filters: `Sale(deliveryStaffId, fulfillmentType, status, shippingStatus, saleDate, saleNo)`, `Product(categoryId)`, `Product(brandId)`, `ProductCarModel(carModelId, productId)`, `CarModel(carBrandId)`

**ข้อควรทราบหลังจบ phase**
- รายได้ค่าจัดส่งจากลูกค้ายังอยู่ในกำไรขั้นต้นของวันนั้น แต่ถูกแยกเป็น line `ค่าจัดส่ง` ไม่ปนกับสินค้า
- ค่าทำจ่ายผู้ส่งเป็น Expense จึงลดกำไรสุทธิ ไม่ลดกำไรขั้นต้นสินค้าโดยตรง
- LINE Daily Summary ปัจจุบันยังแสดง “กำไรขั้นต้น” และ “ค่าใช้จ่ายวันนี้” แต่ยังไม่แสดง “กำไรสุทธิวันนี้” เป็นบรรทัดแยก

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
- [x] ปรับสต็อกเคลมให้ตรวจสอบย้อนหลังได้ (2026-05-07): เพิ่ม `ClaimStockMovement` + `ClaimStockBalance` แยกสินค้ารับเคลมออกจากสต็อกปกติ; รับคืนจากลูกค้า / ส่งซัพพลายเออร์ไม่เขียน StockCard ปกติแล้ว
- [x] กฎต้นทุนเคลม (2026-05-07): รับคืนจากลูกค้าใช้ต้นทุนขายออกเดิมจาก `Warranty.saleItem` / ต้นทุนล็อต; สินค้าทดแทนจากซัพพลายเออร์ผ่านสต็อกเคลมก่อน แล้วเข้า stock ปกติด้วย `CLAIM_RECV_IN` ที่ไม่ทำให้ MAVG เพี้ยน
- [x] การย้อนกลับรายการเคลม (2026-05-07): ทุกการเคลื่อนไหวของสต็อกเคลมมีประวัติ และการยกเลิก/ย้อนสถานะสร้างรายการย้อนกลับแทนการลบประวัติสต็อกเคลม
- [x] การผูกใบลดหนี้ซื้อกับเคลม (2026-05-07): `PurchaseReturn.claimId` ผูกกับ `WarrantyClaim` และเขียนรายการ `SUPPLIER_CREDIT_SETTLE` แบบบันทึกเหตุการณ์; ยอดเจ้าหนี้ยังยึดตามบิลใบลดหนี้ซื้อที่บันทึกจริง
- [x] รายละเอียดใบเคลม (2026-05-07): หน้า detail ใบเคลมแสดงยอดคงเหลือสต็อกเคลม, ประวัติการเคลื่อนไหว, สถานะการย้อนกลับ และใบลดหนี้ซื้อที่ผูกกับเคลม
- [x] ทางลัดจากเคลมไปใบลดหนี้ซื้อ (2026-05-07): เพิ่มปุ่มจากหน้าเคลมไปสร้างใบลดหนี้ซื้อ พร้อมเติม claimId, ซัพพลายเออร์, สินค้า, รูปแบบชดเชยเป็นเครดิตซัพพลายเออร์ และต้นทุนบรรทัดจากต้นทุนขายออกเดิม
- [x] รายงานรวมสต็อกเคลม (2026-05-07): เพิ่ม `/admin/reports/claim-stock` สำหรับดูรายการเคลื่อนไหวสต็อกเคลมหลายใบ พร้อม filter วันที่, สถานะใบเคลม, ประเภทรายการ และค้นหาเลขที่เคลม/สินค้า/ซัพพลายเออร์
- [x] เก็บข้อความหน้าจอเป็นภาษาไทย (2026-05-07): แก้ข้อความอังกฤษที่เพิ่มใน flow สต็อกเคลม / ใบลดหนี้ซื้อ / รายงาน ให้เป็นภาษาไทย และเพิ่มคำสั่งค้นหาด่วนสำหรับรายงานสต็อกเคลม
- [x] Claim/LIFF hardening (2026-05-07): LIFF claims/warranties ย้าย filter/count ไป query DB ก่อน `take`, mutation ปิด/ส่งคืน/ย้อนกลับ/ยกเลิกเคลมเขียน `AuditLog`, และ date-only ของ claim/CN purchase ใช้ helper Thailand date policy
- [x] Claim stock report hardening (2026-05-07): ยอดสรุปรายงานคำนวณจากข้อมูลทั้งหมดตาม filter ไม่ใช่เฉพาะ 300 แถวที่แสดง, แจ้งเมื่อผลลัพธ์ถูกจำกัดบนตาราง, และเพิ่ม index `ClaimStockMovement(docDate, movementType)` สำหรับรายงาน

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

## Roadmap Update (2026-05-06 LIFF Production Linking Recovery)

- Kept LIFF phone mapping strict: a phone already linked to a different `lineUserId` remains blocked to prevent account takeover.
- Added an admin recovery path for preview/prod LIFF testing: staff with customer update permission can unlink a customer's LINE binding from the customer edit page, with audit log diff and metadata.
- Intended workflow: if a customer was linked through preview against the shared production customer record, staff unlink once in `/admin/customers/[id]/edit`, then the customer opens production LIFF and confirms the same phone again.

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

## Roadmap Update (2026-04-24 Fluid Active CPU Reduction)

Goal: reduce Vercel Fluid Active CPU usage without changing any business logic (MAVG, stock, AR/AP, permissions). Audit found 7 hotspots; plan executes in risk order.

### Execution Checklist — Final Status

- [x] **#1 Cache `getProfitDashboardData()` output** — wrapped the 9-query `Promise.all` block in `lib/profit-dashboard.ts` with `unstable_cache` (`revalidate: 60`, tag `profit-dashboard`). Kept calculation logic 100% unchanged; public signature preserved. **Decision:** used time-based revalidate only (60s) instead of fan-out tag invalidation across every mutation action — per-mutation invalidation would rebuild on every sale/stock write and defeat the CPU goal. Cache tag is exported as `PROFIT_DASHBOARD_CACHE_TAG` for future opt-in invalidation if business requires sub-60s freshness.
- [x] **#4 Audit `revalidatePath()` scope** — reviewed all 150+ `revalidatePath` calls across `app/admin/(protected)/**/actions.ts`. Finding: all calls use Next.js default `type="page"` which invalidates only the specific route segment — no broad cascade. Calls like `revalidatePath("/admin")` mark only the dashboard page stale (not the whole subtree), and do not invalidate `unstable_cache` entries (those need `revalidateTag`). With #1 in place, the dashboard's 9-query block is protected for 60s regardless of these calls. **No changes needed** — current scoping is already narrow per Next.js semantics.
- [x] **#5 Add `isActive` filter to carModels on storefront** — implemented. Query now filters `where: { carModel: { isActive: true, carBrand: { isActive: true } } }` in `lib/storefront-catalog.ts:39-42`. Storefront product pages now **exclude inactive car brands/models** from the displayed list. User sees fewer car models if any are marked inactive. **Impact: accuracy** (hides obsolete vehicles) + **minor CPU** (Prisma does the filter at query, not in JS).
- [x] **#2 Paginate reports with UI** — implemented pagination for sales & purchases reports. Changed `take: 2000` → `skip/take: 100` per page. Added `countSalesRows()/countPurchaseRows()` to get total document count. Added Previous/Next buttons + "Page X of Y" display. Aggregate totals (subtotal/VAT/total) computed separately via `querySalesRowsTotals()/queryPurchaseRowsTotals()` to ensure footer shows correct grand totals across ALL matching documents. User navigates via `?page=0`, `?page=1`, etc. **Impact: CPU** — per-request only loads 100 rows + counts, not 2000.
- [x] **#6 Batch/guard `recalculateAllStockCards()`** — reviewed: this is a manual admin-triggered action at `app/admin/(protected)/stock/card/actions.ts:8`, not invoked on any per-request code path. It does not contribute to ongoing Vercel Fluid Active CPU. Changing its transaction boundaries would risk violating .rules §8 (Stock/MAVG) for no steady-state benefit — **no changes in this round**.
- [x] **#3 Reduce `force-dynamic` scope on reports** — audited: all report pages pull user-filtered data (date range + type filters) and display immediately. .rules §8 mandates `force-dynamic` for all query-driven admin pages. Changing to `revalidate = 3600` risks user seeing stale data after a new transaction is entered → **deferred, kept `force-dynamic`**. Mitigation: #2 pagination (100 rows/page) already reduces per-request data load vs. 2000-row fetch.
- [ ] **#7 Debounce `/api/storefront-visit` upsert** — **skipped**. Debouncing would reduce DB hits per session but loses granular tracking (user journey becomes entry+last-only, middle pages hidden). User confusion risk is high (analytics suddenly show fewer page paths). Not worth the trade-off. Keep as-is.
- [ ] Run `npm run build` after each round; zero TS warnings.

### Constraints (per .rules)

- No `any`. No raw SQL. No change to MAVG / stock logic / AR-AP clearing.
- Keep `unstable_cache` on storefront (feedback memory).
- Keep `export const dynamic = "force-dynamic"` on admin pages in this round.
- Update this checklist immediately after each item lands.

## Roadmap Update (2026-04-25 Shopee Open Platform Integration)

> Scope: add a production-ready Shopee seller integration for order import, stock sync, LINE OA owner alerts, channel-separated sales reporting, and delivery/tracking synchronization. Use Shopee Open Platform as the official integration path, with app credentials and shop authorization managed outside source control.

### External dependency checklist

- [ ] Register or confirm the Shopee Open Platform app for the shop account
- [ ] Confirm production access, API permissions, and app review status before live sync
- [ ] Collect required credentials securely: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, `SHOPEE_REDIRECT_URL`, and production/test host setting
- [ ] Complete shop authorization and store the resulting `shop_id`, `access_token`, `refresh_token`, token expiry, and permission scope in DB, not in client code
- [ ] Confirm the callback URL matches production exactly, for example `https://www.sriwanparts.com/api/shopee/callback`
- [ ] Decide whether Shopee push notifications are available for this app; if not, use scheduled pull sync as the reliable baseline
- [ ] Keep test/sandbox and live credentials separated in environment variables and database rows

### Locked decisions

- [ ] `StockCard` remains the internal source of truth for stock quantity and moving average cost
- [ ] Shopee stock updates must be pushed from internal stock state; never let Shopee overwrite `Product.stock` directly
- [ ] Shopee order import must be idempotent by `shop_id + order_sn` so duplicate webhooks/polls cannot create duplicate sales
- [ ] Separate sales channels explicitly: in-store/admin-created sales and Shopee-imported sales must be filterable in sales lists, reports, dashboard, profit analysis, and LINE summaries
- [ ] No stock/MAVG shortcut: every Shopee sale that deducts stock must create normal `Sale`, `SaleItem`, `StockCard`, lot movement, warranty snapshot, and profit fact rows through shared services
- [ ] Do not auto-restock cancelled/refunded Shopee orders until the returned-item business rule is confirmed; use a review queue or CN/return workflow instead
- [ ] LINE OA alerts are owner/admin notifications only in this phase; no customer-facing LINE messages or chatbot changes
- [ ] All Shopee tokens, raw payloads, customer data, and error logs must avoid exposing secrets or unnecessary buyer PII in UI/log output

### Phase A - Foundation, credentials, and auth flow

- [ ] Add `.env.example` placeholders for Shopee integration without real secrets
- [ ] Add `lib/shopee/config.ts` for environment validation and host selection
- [ ] Add `lib/shopee/signature.ts` for Shopee request signing with unit tests against fixed fixtures
- [ ] Add `lib/shopee/client.ts` with typed request helpers, retry policy, timeout, and safe error mapping
- [ ] Add admin-protected route to start Shopee shop authorization
- [ ] Add callback route `/api/shopee/callback` to exchange authorization code for shop tokens
- [ ] Store shop token metadata in DB with refresh expiry and last-authorized audit fields
- [ ] Add token refresh service and scheduled refresh guard before sync jobs run
- [ ] Add sync audit logging so every API call category can be traced without logging secrets

### Phase B - Schema and channel separation

- [ ] Add a sales channel model/enum so `Sale` can distinguish `STORE` vs `SHOPEE`
- [ ] Add Shopee shop account table for shop identity, authorization state, token expiry, sync settings, and last sync cursor
- [ ] Add Shopee product mapping table linking internal `Product`/`ProductUnit` to Shopee `item_id`, `model_id`, seller SKU, and sync direction
- [ ] Add Shopee order import table storing `order_sn`, current Shopee status, raw payload snapshot, import status, linked `saleId`, and last error
- [ ] Add Shopee sync job/log table for order pull, stock push, token refresh, logistics sync, and webhook processing
- [ ] Index all lookup paths: `shopId + orderSn`, `productId`, `itemId + modelId`, `status + createdAt`, and `saleId`
- [ ] Update permission catalog and admin route rules for a new Shopee/Marketplace admin menu
- [ ] Run `prisma db push` and `npx prisma generate` only after schema confirmation

### Phase C - Product mapping and stock sync

- [ ] Build admin UI to map internal products to Shopee item/model/SKU
- [ ] Show unmapped Shopee SKUs and unmapped internal products separately so the owner can fix data safely
- [ ] Pull Shopee item/model stock for mapped products to compare against internal stock before enabling push mode
- [ ] Add stock sync modes per mapping: `monitor_only`, `push_internal_to_shopee`, and `disabled`
- [ ] Push available internal stock to Shopee after stock-affecting transactions: purchases, sales, returns, adjustments, BF, claim replacement/return flows
- [ ] Add stock buffer setting per shop or mapping to avoid overselling, for example internal stock 5 with buffer 1 pushes 4 to Shopee
- [ ] Add reconciliation report for internal stock vs Shopee stock with mismatch reason and last sync time
- [ ] Alert LINE OA when stock push fails, SKU is unmapped, Shopee stock differs from internal stock beyond threshold, or token refresh blocks sync

### Phase D - Shopee order import into internal sales

- [ ] Implement scheduled order pull by update/create time cursor with overlap window to avoid missed orders
- [ ] Implement Shopee push/webhook ingestion if app permission supports it, using the same idempotent importer as polling
- [ ] Import only eligible paid/ready-to-process orders according to confirmed Shopee status mapping
- [ ] Create or reuse a Shopee customer placeholder strategy that stores buyer/shipping snapshot without polluting normal customer master data
- [ ] Convert Shopee order lines to internal `SaleItem` rows using product mapping; unmatched SKU goes to an exception queue instead of creating a broken sale
- [ ] Create `Sale` with channel `SHOPEE`, fulfillment `DELIVERY`, Shopee order reference, payment/shipping snapshot, shipping fee, discount, and status mapping
- [ ] Deduct stock through existing sale/lot flow; if lot-controlled product cannot auto-allocate, put the order in manual review before stock deduction
- [ ] Rebuild profit fact for imported Shopee sales so Profit Dashboard can split in-store vs Shopee performance
- [ ] Prevent duplicate import when Shopee sends the same order through both webhook and scheduled pull

### Phase E - LINE OA alerts for Shopee operations

- [ ] Send LINE OA alert when a new Shopee order is imported successfully, including order no, net amount, customer/shipping summary, item count, and admin link
- [ ] Send LINE OA alert when a Shopee order cannot import because SKU is unmapped, stock is insufficient, lot selection is required, or payload validation fails
- [ ] Send LINE OA alert for stock sync failures and repeated API failures after retry limit
- [ ] Send LINE OA alert before Shopee token expiry or when authorization is revoked
- [ ] Send LINE OA alert for cancellation/refund/return events that need owner review
- [ ] Send LINE OA alert for delivery exceptions such as missing tracking number, failed logistics sync, or stale order not shipped within configured SLA
- [ ] Reuse existing LINE recipient mapping and delivery helper; do not create a second LINE integration stack
- [ ] Add notification throttling/deduplication so repeated sync failures do not spam LINE

### Phase F - Delivery, tracking, and Shopee logistics sync

- [ ] Map Shopee logistics/tracking fields to existing `Sale.shippingMethod`, `Sale.shippingStatus`, and `Sale.trackingNo`
- [ ] Pull tracking number and package/logistics status from Shopee into Delivery Queue
- [ ] Update internal delivery status when Shopee status changes, with an audit log entry for source `SHOPEE`
- [ ] Decide which direction is authoritative for tracking edits: Shopee-to-system only, system-to-Shopee only, or bidirectional with conflict warnings
- [ ] If Shopee API permission allows shipment arrangement, add an explicit admin action for arrange shipment instead of doing it silently
- [ ] Show Shopee order/tracking link on sale detail and delivery queue rows
- [ ] Include Shopee channel/status filters in `/admin/delivery` and delivery reports

### Phase G - Returns, cancellations, refunds, and exception handling

- [ ] Pull Shopee cancellation/refund/return status into a review queue
- [ ] Define which Shopee statuses cancel an internal sale and which require manual review
- [ ] For already-deducted stock, require explicit return/CN workflow before stock is added back
- [ ] Link Shopee return/refund events to internal Credit Note flow when the business rule is confirmed
- [ ] Keep reference-chain protection: do not cancel internal sale if active receipt/CN/claim dependencies make the normal cancellation invalid
- [ ] Alert LINE OA when Shopee cancellation/refund event conflicts with internal document state

### Phase H - Admin UI, reports, and owner visibility

- [ ] Add `/admin/marketplace/shopee` overview with authorization status, last sync time, token health, failed jobs, and stock mismatch count
- [ ] Add Shopee order import queue with filters: pending import, imported, failed, needs SKU mapping, needs lot selection, cancelled/refund review
- [ ] Add Shopee product mapping screen with bulk search and validation
- [ ] Add sales list filter for channel: all, in-store, Shopee
- [ ] Add dashboard/profit/report split for in-store vs Shopee sales, gross profit, order count, and stock risk
- [ ] Add daily LINE summary extension for Shopee order count, Shopee sales amount, failed import count, and stock sync failures
- [ ] Add export/report fields for Shopee order number, shop id/name, channel, tracking no, and sync status

### Phase I - Reliability, security, and rollout

- [ ] Add rate-limit/backoff handling for Shopee API responses and retry only safe idempotent operations
- [ ] Add request timeout and circuit-breaker behavior for repeated Shopee failures
- [ ] Add QStash-backed scheduled jobs for order pull, stock reconciliation, token refresh, and retry queue processing
- [ ] Add sync lock so the same shop cannot run overlapping order import or stock push jobs
- [ ] Add dry-run mode for the first rollout: pull orders and compare stock without creating sales or pushing stock
- [ ] Add a manual `Sync now` admin action with permission check and audit log
- [ ] Add tests for signature generation, token refresh, order idempotency, stock push payload mapping, and LINE alert dedupe
- [ ] Add operational runbook for credential renewal, failed sync recovery, unmapped SKU handling, and Shopee app review/production switch
- [ ] Verify with `npm run build` after implementation slices

### Suggested rollout order

- [ ] Step 1: credential setup, auth callback, shop token storage, and read-only health page
- [ ] Step 2: product mapping and read-only stock/order comparison
- [ ] Step 3: import Shopee orders into an exception queue without creating `Sale`
- [ ] Step 4: create internal `Sale` from validated Shopee orders and send LINE alert
- [ ] Step 5: push internal stock to Shopee for mapped products after internal transactions
- [ ] Step 6: sync tracking/status into Delivery Queue and reports
- [ ] Step 7: enable returns/cancellations/refunds review flow and dashboard/report split

### Open business decisions before implementation

- [ ] Confirm whether Shopee orders should be treated as prepaid sales, COD, or mixed based on Shopee payment fields
- [ ] Confirm when stock should be deducted: at paid order, ready-to-ship, printed label, or shipped status
- [ ] Confirm whether lot-controlled Shopee items can auto-allocate FIFO/FEFO or must always wait for staff review
- [ ] Confirm whether Shopee buyer records should create normal `Customer` rows or stay as order snapshots only
- [ ] Confirm whether internal tracking edits should push back to Shopee, or Shopee should remain the logistics source of truth
- [ ] Confirm the stock buffer rule for Shopee listings so internal walk-in sales do not oversell marketplace inventory

## Roadmap Update (2026-04-25 Dynamic Category Icons)

- [x] Replace storefront category emoji icons with Lucide SVG category icons
- [x] Add per-category visual settings for icon, color tone, and hover motion
- [x] Let admin choose category icon, tone, and motion from `/admin/master/categories`
- [x] Store category visual settings in existing `SiteContent` JSON so no Prisma schema migration is required
- [x] Keep future categories safe with automatic visual inference by name/slug and a neutral fallback icon
- [x] Verify with `npm run build`

## Roadmap Update (2026-04-26 Category SEO + Cache)

- [x] Verified production cache headers for homepage, `/products`, and current static assets.
- [x] Found category pages were still dynamic (`private, no-cache`) because the public category route had `force-dynamic`.
- [x] Removed storefront category `force-dynamic` while keeping `revalidate = 300`, cached data helpers, and existing admin cache invalidation behavior.
- [x] Added SEO descriptions for all 10 active category pages: Compressor, Condenser, Evaporator, Drier/Receiver, Expansion Valve, Blower Motor, Compressor Clutch, Magnetic Clutch, Radiator, and Other Parts.
- [x] Reused the same category description for metadata, visible page copy, and `CollectionPageJsonLd` so canonical page content and structured data stay aligned.
- [x] Verified with `npm run build`; `/products/[categorySlug]` now builds as SSG instead of fully dynamic.

## 2-Month SEO Rollout Plan (April 26 – June 26, 2026)

> **Iron Rule:** Follow phases in order. Deploy → monitor 3-5 days → next phase.
> Never skip phases or bundle work from multiple phases in one deploy.
> If traffic drops or CWV degrades → pause and investigate before continuing.

---

### 🔴 TODAY — April 26 (Sunday) [Start Now, 2-3 hours]

- [x] Fix Product image alt text in `components/shared/ProductCard.tsx` ✅ DONE Apr 26
  - Changed `alt={product.name}` → `` `${product.name}${product.brand ? ` ${product.brand.name}` : ""} | อะไหล่แอร์รถยนต์ ${product.category.name}` ``
  - TypeScript clean — zero UI impact, zero logic change
  - Example output: "คอมแอร์ DENSO | อะไหล่แอร์รถยนต์ คอมแอร์"
- [x] Run PageSpeed Insights on 3 pages → record baseline ✅ DONE Apr 26

  **Baseline Scores (Mobile) — Apr 26, 2026 14:12–14:15**
  | Page | Performance | Accessibility | Best Practices | SEO |
  |------|-------------|---------------|----------------|-----|
  | Homepage `/` | 🟢 92 | 🟢 95 | 🟢 100 | 🟢 100 |
  | Products `/products` | 🟡 89 | 🟢 95 | 🟢 100 | 🟢 100 |
  | Knowledge `/knowledge` | 🟢 97 | 🟢 95 | 🟢 100 | 🟢 100 |

  **Notes:**
  - Field data: "ไม่มีข้อมูล" — traffic ยังน้อยเกินไปสำหรับ CrUX data
  - `/products` ต่ำสุดที่ 89 — root cause identified and fixed (see below)
  - `/knowledge` สูงสุดที่ 97 — text-heavy, fewer images
  - SEO 100 / Best Practices 100 ทุกหน้า — infrastructure แข็งแกร่งมาก

  **Diagnostics Found on /products (Apr 26):**
  - 🔴 CLS = 0.188 (เกิน threshold 0.1) → **FIXED Apr 26**
    - Root cause: `ProductFilterBarFallback` แสดง expanded skeleton บน mobile
    - แต่ `ProductFilterBar` หลัง hydrate = collapsed (header only)
    - Height mismatch ทำให้ product list ขยับลง = CLS
    - Fix: เพิ่ม `hidden lg:block` ใน expanded section ของ fallback
    - File: `app/products/ProductFilterBarFallback.tsx`
  - 🟡 Render-blocking CSS: 590ms (main Next.js CSS bundle 25.2 KiB)
    - ยาก eliminate — ปกติ Next.js behavior, ไม่แนะนำแก้ตอนนี้
  - 🟡 Legacy JavaScript: 12 KiB (Array.prototype polyfills ไม่จำเป็น)
    - Fix: ปรับ browserslist target ใน next.config.ts → Week 2
  - 🟡 Unused JavaScript: 43 KiB (121 KiB bundle → 43.5 KiB saveable)
    - Fix: ตรวจสอบ large imports + code splitting → Week 2
  - ✅ LCP element: Hero image (500ms) — acceptable ไม่ต้องแก้ด่วน
- [x] Audit `app/knowledge/[slug]/page.tsx` → confirm `ArticleJsonLd` is rendered on every article ✅ DONE Apr 26
  - `ArticleJsonLd` + `BreadcrumbJsonLd` — both present and complete
  - Metadata: title, description, canonical, OG, Twitter — all correct
  - No changes needed

**Deploy:** April 26 | **Monitor until:** April 29

---

### 📅 Week 1 — April 27–May 3 [Monitoring Setup, ~4 hours]

- [x] **April 27** — Verify Google Search Console property for sriwanparts.com ✅ DONE May 1
  - Check Coverage report, Mobile Usability, Core Web Vitals tabs ✅
  - Set up email alerts for critical issues ✅
  - Confirm sitemap at `/sitemap.xml` is submitted and indexed ✅
- [x] **April 28** — Set up Google Analytics 4
  - Create GA4 property → get Measurement ID
  - Add `NEXT_PUBLIC_GA_ID` to `.env.local` + `.env.example` ✅
  - Implement `next/script` with `strategy="afterInteractive"` ✅ (`components/shared/GoogleAnalytics.tsx`)
  - Add GA4 bootstrap queue + App Router page_view tracking ✅ (`components/shared/GoogleAnalytics.tsx`)
  - Emit conversion candidate events: LINE/phone `qualify_lead`, product `product_page_view` ✅
  - Set up GA4 key events/conversion goals for LINE button click, phone click, product page view ✅ DONE May 1
  - Verify events in GA4 DebugView (requires NEXT_PUBLIC_GA_ID in .env.local) ✅ DONE May 1
- [x] **April 29-30** — Verify caching headers on Vercel
  - `curl -I https://sriwanparts.com` → check Cache-Control
  - `curl -I https://sriwanparts.com/_next/static/` → should be `max-age=31536000`
- [x] **May 1-3** — Category page description audit
  - Measure word count on all 10 category pages
  - Recorded that all 10 active category pages were using a shared short template before the SEO content pass
  - 2026-04-26 cache check: homepage and `/products` are cacheable; category pages were `private, no-cache` before removing the storefront-only `force-dynamic`

**Deploy:** May 1 (GA4) | **Monitor until:** May 4

---

### 📅 Week 2 — May 4–10 [Category Pages + Article #1-2, ~12 hours]

**Category Pages (developer task):**
- [x] **May 4-5** — Add 150-200 word SEO descriptions to first 5 categories:
  - Compressor (คอมแอร์), Condenser (แผงแอร์), Evaporator (ตู้แอร์)
  - Drier/Receiver, Expansion Valve
  - Each description: keyword-rich + common car models + no logic change
- [x] Add `CollectionPageJsonLd` schema to each of the 5 category pages above
- [x] Verify CLS score did not increase after new description blocks
  - Implemented as server-rendered text only; no new client component, image, script, or layout-shifting asset

**Content (writing task):**
- [x] **May 1** — Article #1: "แอร์รถยนต์ไม่เย็น: 5 สาเหตุหลักและแนวทางแก้ไขก่อนเปลี่ยนอะไหล่" ✅ DONE May 1
  - slug: `car-ac-not-cold-5-main-causes-and-fixes` | Target: "แอร์รถยนต์ไม่เย็น" | CTA: LINE
  - Hybrid (option 3): new angle (5 causes + fixes), keeps existing `car-air-not-cold-what-to-check` (commercial intent) untouched
- [x] **May 1** — Article #2: "อะไหล่แอร์ของแท้ vs เทียม: วิธีดูให้ถูกก่อนซื้อจริง" ✅ DONE May 1
  - slug: `how-to-spot-genuine-vs-aftermarket-ac-parts` | Target: "อะไหล่แอร์ของแท้เทียม" | CTA: "ติดต่อเลือก"
  - Hybrid (option 3): new angle (visual/spec identification), keeps existing `genuine-vs-aftermarket-auto-ac-parts` (definitions) untouched

**Deploy:** May 7 (categories), May 10 (articles) | **Monitor until:** May 14

---

### 📅 Week 3 — May 11–17 [Category Pages Complete + Article #3-5, ~14 hours]

**Category Pages:**
- [x] **May 11-12** — Add descriptions to remaining 5 categories:
  - Blower Motor, Compressor Clutch, Magnetic Clutch, Radiator, Other Parts
  - Add `CollectionPageJsonLd` to each
  - Completed together with Week 2 at user request for all active categories as of 2026-04-26

**Content:**
- [ ] **May 12-13** — Article #3: "Honda Civic 2020-2024: อะไหล่แอร์ที่ต้องรู้"
  - 1,800 words | Target: "Honda Civic ac parts" | CTA: Product grid by model
- [ ] **May 14-15** — Article #4: "วิธีบำรุงรักษาคอมแอร์รถยนต์ - 5 ขั้นตอน"
  - 2,500 words | Target: "บำรุงรักษาคอมแอร์" | CTA: "ติดต่อบริการ"
- [ ] **May 16-17** — Article #5: "คอมแอร์รถยนต์ขาด: ซ่อมหรือเปลี่ยน?"
  - 2,000 words | Target: "คอมแอร์หัก ซ่อมได้ไหม" | CTA: Product upsell

**Deploy:** May 14 (categories), May 17 (articles) | **Monitor until:** May 21

---

### 📅 Week 4 — May 18–24 [Complete Phase 1 Articles + Review, ~14 hours]

**Content:**
- [ ] **May 18-19** — Article #6: "เสียงแอร์รถยนต์ดังผิดปกติ: สาเหตุและวิธีแก้"
  - 1,500 words | Target: "แอร์รถยนต์ดัง" | CTA: Phone contact
- [ ] **May 20-21** — Article #7: "แอร์รถยนต์มีกลิ่นแปลก: สาเหตุและวิธีล้าง"
  - 1,800 words | Target: "แอร์รถยนต์มีกลิ่น" | CTA: Service mention

**Phase 1 Review (May 22-24):**
- [ ] Check GSC Performance → any new keyword impressions from Week 2-3 articles?
- [ ] Check GA4 → top landing pages, bounce rate on new articles
- [ ] Re-run PageSpeed Insights → compare against baseline recorded April 26
- [ ] Fix any CLS or performance issues before continuing to Phase 2
- [ ] Update PLAN.md with actual results

**Deploy:** May 21 (articles) | **Review:** May 22-24 | **Monitor until:** May 28

---

### 📅 Week 5 — May 25–31 [Phase 2 Car Models — Honda + Toyota, ~14 hours]

- [ ] **May 25-26** — Article #8: "คอมแอร์ Honda Accord ของแท้ vs เทียบ"
  - 1,600 words | Target: "Honda Accord compressor"
- [ ] **May 26-27** — Article #9: "ตู้แอร์ Honda CR-V: ราคา + ของแท้ดูยังไง"
  - 1,500 words | Target: "Honda CRV evaporator"
- [ ] **May 27-28** — Article #10: "อะไหล่แอร์ Toyota Altis 2019-2023: รายชื่อมาตรฐาน"
  - 1,800 words | Target: "Toyota Altis AC parts"
- [ ] **May 29-30** — Article #11: "แผงแอร์ Toyota Innova: ส่วนที่พังบ่อยที่สุด"
  - 1,500 words | Target: "Toyota Innova condenser"
- [ ] **May 31** — Add internal links: articles #8-11 → related product pages

**Deploy:** May 31 | **Monitor until:** June 4

---

### 📅 Week 6 — June 1–7 [Phase 2 Car Models — Other Brands, ~14 hours]

- [ ] **June 1-2** — Article #12: "ไดเออร์แอร์ Toyota Fortuner: สำคัญกว่าที่คิด"
  - 1,400 words | Target: "Fortuner drier receiver"
- [ ] **June 2-3** — Article #13: "อะไหล่แอร์ Isuzu D-Max ราคาส่ง: ของแท้จากไหน"
  - 1,700 words | Target: "D-Max AC parts Thailand"
- [ ] **June 3-4** — Article #14: "คอมแอร์ Mitsubishi Pajero Sport: ปัญหาทั่วไป"
  - 1,600 words | Target: "Pajero AC compressor"
- [ ] **June 5-6** — Article #15: "ตู้แอร์ Ford Ranger: ต้องรู้ก่อนซื้อ"
  - 1,500 words | Target: "Ford Ranger evaporator"
- [ ] **June 7** — Article #16: "อะไหล่แอร์ Nissan Navara: ของแท้ vs เทียบ"
  - 1,600 words | Target: "Navara AC compressor"

**Phase 2 Mini-Review (June 7):**
- [ ] GSC → new keyword impressions from car model articles?
- [ ] Update PLAN.md status

**Deploy:** June 7 | **Monitor until:** June 11

---

### 📅 Week 7 — June 8–14 [Phase 3 Maintenance Guides, ~14 hours]

- [ ] **June 8-9** — Article #17: "ซ่อมแซมระบบแอร์รถยนต์: สัญญาณที่ต้องตรวจ"
  - 2,000 words | Target: "ตรวจสอบระบบแอร์"
- [ ] **June 9-10** — Article #18: "ล้างแอร์รถยนต์วิธีถูกต้อง: ทำเองหรือส่งร้าน"
  - 2,200 words | Target: "ล้างแอร์รถยนต์"
- [ ] **June 11-12** — Article #19: "คอนเดนเซอร์สกปรก = แอร์เย็นหมด: ทำอย่างไร"
  - 1,800 words | Target: "คอนเดนเซอร์สกปรก"
- [ ] **June 13-14** — Article #20: "ไดเออร์แอร์: ส่วนที่มักลืม แต่สำคัญมาก"
  - 1,600 words | Target: "ไดเออร์แอร์คืออะไร"

**Deploy:** June 14 | **Monitor until:** June 18

---

### 📅 Week 8 — June 15–21 [Phase 3 Finish + Comparison + Monthly Review, ~12 hours]

**Content:**
- [ ] **June 15-16** — Article #21: "บ่อปสิการแอร์รถยนต์: เลือกที่ไหน มีข้อห้ามไหม"
  - 1,500 words | Target: "บ่อปสิการแอร์"
- [ ] **June 17-18** — Article #22: "ต้องเติมน้ำยาแอร์กี่ปี: เครื่องหมาย + อันตราย"
  - 1,500 words | Target: "เติมน้ำยาแอร์กี่ปี"
- [ ] **June 19-20** — Article #23: "คอมแอร์ DENSO vs Coolgear vs Formula: เปรียบเทียบ"
  - 2,200 words | Target: "คอมแอร์แบรนด์ไหนดี"

**Monthly SEO Review #1 (June 21):**
- [ ] GSC → top 20 keywords by impressions + clicks
- [ ] Compare positions before/after content rollout
- [ ] GA4 → top 10 landing pages, avg session duration, bounce rate
- [ ] PageSpeed Insights → final comparison vs April 26 baseline
- [ ] Identify any keyword that gained position 1-5 → double down with more content
- [ ] Identify any article with < 50 impressions → revisit keyword or update content
- [ ] Update PLAN.md with actual metrics and adjustments

**Deploy:** June 20 | **Full review:** June 21

---

### 📅 Buffer Week — June 22–26 [Cleanup + Phase 4 Planning]

- [ ] Fix any issues discovered during Monthly Review
- [ ] Update article internal links where missing
- [ ] Prepare Phase 4 seasonal content calendar (July-August)
- [ ] Plan local SEO landing pages (e.g., "อะไหล่แอร์ นครสวรรค์")
- [ ] Brief plan for new car model articles (Q3)
- [ ] Decide on next 2-month cadence

---

### Summary: 2-Month Plan at a Glance

| Week | Dates | Tasks | Deploy Date |
|------|-------|-------|-------------|
| TODAY | Apr 26 | Alt text fix + CWV baseline + article audit | Apr 26 |
| 1 | Apr 27–May 3 | GSC + GA4 setup + caching check | May 1 |
| 2 | May 4–10 | 5 category pages + Articles #1-2 | May 10 |
| 3 | May 11–17 | 5 category pages + Articles #3-5 | May 17 |
| 4 | May 18–24 | Articles #6-7 + Phase 1 review | May 21 |
| 5 | May 25–31 | Articles #8-11 (Honda + Toyota) | May 31 |
| 6 | Jun 1–7 | Articles #12-16 (Other models) | Jun 7 |
| 7 | Jun 8–14 | Articles #17-20 (Maintenance) | Jun 14 |
| 8 | Jun 15–21 | Articles #21-23 + Monthly review | Jun 20 |
| Buffer | Jun 22–26 | Fixes + Phase 4 planning | — |

**Total:** 23 articles + 10 category pages + monitoring setup | **Expected traffic gain:** +1,500-2,000/month by June 26

---

## SEO Improvement Roadmap (sriwanparts.com)

### ✅ Already Implemented (Verified in Codebase)

**Priority 1 - Meta Tags & Core SEO** ✅ DONE
- [x] Unique Title Tags + Meta Descriptions (dynamic via metadata API)
- [x] Canonical Tags on all page types
- [x] Viewport Meta Tag configured
- [x] Title template: `%s | SITE_NAME`
- [x] Structured keywords in `lib/seo.ts`

**Priority 2 - Image Optimization & Alt Text** ✅ 90% DONE
- [x] Using `next/image` (auto WebP, srcset, lazy loading)
- [x] Alt text on key images (logos, hero, product cards)
- [x] Supabase CDN image optimization
- ⚠️ *Gap: Product alt text could be more descriptive (add brand + category)*

**Priority 3 - Structured Data & Schema Markup** ✅ DONE
- [x] Organization schema (OrganizationJsonLd.tsx)
- [x] Product schema (ProductJsonLd.tsx)
- [x] LocalBusiness schema (LocalBusinessJsonLd.tsx)
- [x] Article schema (ArticleJsonLd.tsx)
- [x] Breadcrumb schema (BreadcrumbJsonLd.tsx)
- [x] FAQ schema (FaqJsonLd.tsx)
- [x] WebSite schema (WebSiteJsonLd.tsx)
- [x] Collection/Category schema (CollectionPageJsonLd.tsx)
- [x] Google verification meta tag

**Priority 5 - Technical SEO & Performance (Partial)** ✅ INFRASTRUCTURE DONE
- [x] `next/image` with auto WebP (Priority 5 images)
- [x] ISR (revalidate: 300s on product pages)
- [x] Force-dynamic on necessary pages
- [x] Sitemap.xml (31 pages indexed)
- [x] Robots.txt properly configured
- [x] HTTPS/SSL active
- ⚠️ *Gaps: Core Web Vitals baseline not measured yet, caching headers not verified*

### Priority 4 - Content & Keyword Optimization (DETAILED CHECKLIST)

**Estimated effort:** 50-75 hours | **Timeline:** 2 months | **Expected traffic:** +2,300/month

#### Phase 1 - Week 1-2: High-Intent Problem-Solving Articles (7 articles)

- [ ] **"แอร์รถยนต์ไม่เย็น: 5 สาเหตุและวิธีแก้ไข"**
  - Target: "แอร์รถยนต์ไม่เย็น"
  - Word count: 2,000 | Effort: 6 hours | CTA: "Line เพื่อสอบถาม"
  - Outline: 5 causes + DIY checks + when to call pro + product recommendations
  
- [ ] **"เสียงแอร์รถยนต์ดังผิดปกติ? ปัญหาและแนวทางแก้"**
  - Target: "แอร์รถยนต์ดัง"
  - Word count: 1,500 | Effort: 5 hours | CTA: Phone contact
  - Outline: Noise types + compressor issues + fan problems + solutions

- [ ] **"แอร์รถยนต์มีกลิ่นแปลก - สาเหตุและวิธีล้าง"**
  - Target: "แอร์รถยนต์มีกลิ่น"
  - Word count: 1,800 | Effort: 5 hours | CTA: "ล้างแอร์" service
  - Outline: Mold growth + cleaning methods + prevention + product recommendations

- [ ] **"คอมแอร์รถยนต์ขาด = สิ้นไป? ซ่อมหรือเปลี่ยน?"**
  - Target: "คอมแอร์หัก ซ่อมได้ไหม"
  - Word count: 2,000 | Effort: 6 hours | CTA: Product upsell
  - Outline: When broken compressor + repair cost vs replacement + product grid link

- [ ] **"ต้องเติมน้ำยาแอร์กี่ปี? เครื่องหมาย + อันตราย"**
  - Target: "เติมน้ำยาแอร์กี่ปี"
  - Word count: 1,500 | Effort: 5 hours | CTA: "ติดต่อบริการ"
  - Outline: Refrigerant types + warning signs + refill schedule + leak dangers

- [ ] **"ท่อแอร์รั่ว = ปัญหา ต้องซ่อมด่วน?"**
  - Target: "ท่อแอร์รั่ว"
  - Word count: 1,200 | Effort: 4 hours | CTA: Product reference
  - Outline: How to spot leaks + DIY checks + repair urgency + parts needed

- [ ] **"อะไหล่แอร์ของแท้ vs เทียม: วิธีดูให้ถูก"** (PRIORITY #2)
  - Target: "อะไหล่แอร์ของแท้เทียม"
  - Word count: 2,500 | Effort: 7 hours | CTA: "ติดต่อเลือก"
  - Outline: Visual differences + packaging + serial numbers + brand verification + why it matters

**Subtotal Phase 1:** 11,000 words | 38 hours | Expected traffic: +500/month

---

#### Phase 2 - Week 3-4: Car Model-Specific Buying Guides (8 articles)

**Honda Models:**
- [ ] **"อะไหล่แอร์ Honda Civic 2020-2024: ส่วนไหนต้องเปลี่ยน"** (PRIORITY #3)
  - Target: "Honda Civic ac parts"
  - Word count: 1,800 | Effort: 5 hours | CTA: Product grid by model
  - Outline: Civic gen + compatible parts + common issues + where to buy

- [ ] **"คอมแอร์ Honda Accord ของแท้ vs เทียบ - วิธีเลือก"**
  - Target: "Honda Accord compressor"
  - Word count: 1,600 | Effort: 5 hours | CTA: "Compare products"
  - Outline: Accord generations + compressor specs + OEM vs aftermarket

- [ ] **"ตู้แอร์ Honda CR-V ราคาเท่าไหร่ ของแท้ยังไง"**
  - Target: "Honda CRV evaporator"
  - Word count: 1,500 | Effort: 5 hours | CTA: Price list

**Toyota Models:**
- [ ] **"อะไหล่แอร์ Toyota Altis 2019-2023: รายชื่อมาตรฐาน"**
  - Target: "Toyota Altis AC parts"
  - Word count: 1,800 | Effort: 5 hours | CTA: Product grid
  - Outline: Altis generations + complete parts list + compatibility chart

- [ ] **"แผงแอร์ Toyota Innova - ส่วนที่พัง บ่อยที่สุด"**
  - Target: "Toyota Innova condenser"
  - Word count: 1,500 | Effort: 5 hours | CTA: Preventive maintenance tip
  - Outline: Innova design + condenser issues + durability + alternatives

- [ ] **"ไดเออร์แอร์ Toyota Fortuner: สำคัญกว่าที่คิด"**
  - Target: "Fortuner drier receiver"
  - Word count: 1,400 | Effort: 4 hours | CTA: Product info
  - Outline: What drier does + why it fails + replacement cost + symptoms

**Other Popular Models:**
- [ ] **"อะไหล่แอร์ Isuzu D-Max ราคาส่ง ของแท้จากไหน"**
  - Target: "D-Max AC parts Thailand"
  - Word count: 1,700 | Effort: 5 hours | CTA: Wholesale pricing
  - Outline: D-Max gen + parts compatibility + wholesale vs retail

- [ ] **"คอมแอร์ Mitsubishi Pajero Sport - ปัญหาทั่วไป"**
  - Target: "Pajero AC compressor"
  - Word count: 1,600 | Effort: 5 hours | CTA: Problem diagnosis

**Subtotal Phase 2:** 12,900 words | 40 hours | Expected traffic: +800/month

---

#### Phase 3 - Month 2: Maintenance & Care Guides (6 articles)

- [ ] **"วิธีบำรุงรักษาคอมแอร์รถยนต์ - 5 ขั้นตอนเบื้องต้น"** (PRIORITY #4)
  - Target: "บำรุงรักษาคอมแอร์"
  - Word count: 2,500 | Effort: 7 hours | CTA: "ติดต่อบริการประจำ"
  - Outline: 5 maintenance steps + DIY checks + seasonal care + professional service intervals

- [ ] **"ซ่อมแซมระบบแอร์รถยนต์: สัญญาณ ต้องตรวจ"**
  - Target: "ตรวจสอบระบบแอร์"
  - Word count: 2,000 | Effort: 6 hours | CTA: Product grid
  - Outline: Diagnostic checklist + parts that fail most + troubleshooting flowchart

- [ ] **"ล้างแอร์รถยนต์วิธีถูกต้อง - ทำเองหรือส่งร้าน"**
  - Target: "ล้างแอร์รถยนต์"
  - Word count: 2,200 | Effort: 6 hours | CTA: Service mention
  - Outline: DIY vs professional + cleaning chemicals + coil cleaning + cost comparison

- [ ] **"คอนเดนเซอร์สกปรก = แอร์เย็นหมด ทำอย่างไร"**
  - Target: "คอนเดนเซอร์สกปรก"
  - Word count: 1,800 | Effort: 5 hours | CTA: Product upsell
  - Outline: Why condenser clogs + cleaning methods + replacement decision

- [ ] **"ไดเออร์แอร์: ส่วนที่มักลืม แต่สำคัญมาก"**
  - Target: "ไดเออร์แอร์คืออะไร"
  - Word count: 1,600 | Effort: 5 hours | CTA: Product info
  - Outline: What it does + how it fails + replacement signs + cost

- [ ] **"บ่อปสิการแอร์รถยนต์: ที่ไหนดี มีข้อห้ามไหม"**
  - Target: "บ่อปสิการแอร์"
  - Word count: 1,500 | Effort: 5 hours | CTA: Partner shops
  - Outline: Shop selection criteria + seasonal timing + cost range + DIY vs professional

**Subtotal Phase 3:** 12,600 words | 34 hours | Expected traffic: +600/month

---

#### Phase 4 - Month 3+: Comparison, Seasonal & Authority Content (5+ articles)

**Commercial Intent / Comparison (2 articles):**
- [ ] **"คอมแอร์ DENSO vs Coolgear vs Formula: เปรียบเทียบ"** (PRIORITY #5)
  - Target: "คอมแอร์แบรนด์ไหนดี"
  - Word count: 2,200 | Effort: 6 hours | CTA: Product comparison grid
  - Outline: Brand history + quality comparison + price vs value + warranty + customer reviews

- [ ] **"ราคาอะไหล่แอร์ขายส่ง vs ปลีก - ต่างกันเท่าไหร่"**
  - Target: "อะไหล่แอร์ราคาส่ง"
  - Word count: 1,800 | Effort: 5 hours | CTA: "เรียกราคา"
  - Outline: Wholesale vs retail pricing + bulk discounts + quality comparison + ROI for mechanics

**Seasonal (4 articles):**
- [ ] **"เตรียมแอร์ก่อน Summer - ตรวจสอบ 5 จุด"** (Publish Mar-Apr)
  - Target: "เตรียมแอร์ฤดูร้อน"
  - Word count: 1,600 | Effort: 5 hours | CTA: Pre-summer check-up service

- [ ] **"ขับรถช่วง Monsoon: แอร์ต้องดูแลพิเศษ"** (Publish May-Sep)
  - Target: "ขับรถช่วง Monsoon"
  - Word count: 1,500 | Effort: 5 hours | CTA: Humidity control tips

- [ ] **"ยางรถเก่า? อะไหล่แอร์ก็แก่แล้ว - เตรียมจำหน่าย"** (Publish Jan-Mar)
  - Target: "ยางรถเก่า"
  - Word count: 1,400 | Effort: 4 hours | CTA: Trade-in + upgrade

- [ ] **"หลังพัก + ใช้น้อย: ตรวจแอร์ให้พร้อม"** (Publish Oct-Nov)
  - Target: "ตรวจแอร์"
  - Word count: 1,300 | Effort: 4 hours | CTA: Check-up service

**Authority / Educational (2+ articles):**
- [ ] **"ประวัติและหลักการทำงาน AC/Refrigeration ระบบแอร์"**
  - Target: General authority
  - Word count: 3,000 | Effort: 8 hours | CTA: Authority + credibility
  - Outline: History + thermodynamics + modern AC systems + innovations

- [ ] **"ส่วนประกอบแอร์รถยนต์: ชื่อไทย-อังกฤษ คำศัพท์"**
  - Target: Reference content
  - Word count: 2,000 | Effort: 6 hours | CTA: Glossary + product reference
  - Outline: Complete glossary + diagram + function + common abbreviations

**Subtotal Phase 4:** 15,800 words | 48 hours (ongoing) | Expected traffic: +400/month (growing)

---

#### Supporting Activities (All Phases)

**Category Page Optimization:**
- [ ] Audit all 10 category pages for description length (currently < 150 words?)
- [ ] Add 150-200 word SEO-optimized descriptions to each category:
  - [ ] Compressor category
  - [ ] Condenser category
  - [ ] Evaporator category
  - [ ] Drier/Receiver category
  - [ ] Blower Motor category
  - [ ] Expansion Valve category
  - [ ] Compressor Clutch category
  - [ ] Radiator category
  - [ ] Other Parts category
- [ ] Add `CollectionPageJsonLd` schema to category pages
- [ ] Include "common car models that use this part" in each description
- [ ] Add internal links from category descriptions to relevant blog articles

**Internal Linking Strategy:**
- [ ] From "แอร์ไม่เย็น" article → Link to product pages (compressor, condenser, etc.)
- [ ] From car model articles (e.g., Honda Civic) → Link to related parts + problem articles
- [ ] From maintenance articles → Link to relevant products
- [ ] From comparison articles → Link to product details page with specs

**Blog Publishing Setup:**
- [ ] Create `/knowledge` category taxonomy:
  - [ ] Problem-solving (แก้ปัญหา)
  - [ ] Buyer's guide (การเลือกซื้อ)
  - [ ] Maintenance (การบำรุงรักษา)
  - [ ] Car models (รุ่นรถ)
  - [ ] Educational (ความรู้ทั่วไป)
- [ ] Set up article metadata template (author, publish date, featured image, estimated read time)
- [ ] Create article outline template for consistency

**Internal Linking Checklist Per Article:**
- [ ] Link 3-5 product pages (contextual)
- [ ] Link 2-3 related articles (natural)
- [ ] Link to category pages where relevant
- [ ] Add CTAs (LINE, Phone, Product grid)

---

#### Implementation Timeline & Ownership

| Phase | Articles | Weeks | Hours | Owner | Status |
|-------|----------|-------|-------|-------|--------|
| Phase 1 | 7 | 1-2 | 38 | Content team | ⏳ Start now |
| Phase 2 | 8 | 3-4 | 40 | Content team | ⏳ Start week 3 |
| Phase 3 | 6 | Month 2 | 34 | Content team | ⏳ Start week 5 |
| Phase 4+ | 5+ | Month 3+ | 48+ | Content team | ⏳ Ongoing |
| Category pages | 10 | Concurrent | 10 | Developer | ⏳ Parallel |
| JSON-LD schema | All | Concurrent | 5 | Developer | ⏳ Parallel |
| **TOTAL** | **25+** | **2 months** | **75-85 hrs** | | |

---

#### Success Metrics & Monitoring

- [ ] Track ranking positions for all targeted keywords (Google Search Console)
- [ ] Monitor article traffic weekly (Google Analytics)
- [ ] Expected results:
  - Week 2-4: +500 organic impressions/month
  - Week 6-8: +1,200 organic impressions/month
  - Month 3+: +2,300 organic impressions/month + improved CTR
- [ ] Set up Content Calendar in Google Sheet (shared with team)
- [ ] Monthly review: Top performing articles + underperformers to revise

### Priority 5 - Technical SEO & Performance (FOCUS: MEASUREMENT & MONITORING)

**What's NOT done yet (Focus items):**

- [ ] **Core Web Vitals Baseline Measurement** (Critical)
  - [ ] Run PageSpeed Insights on: homepage, product page, category page, knowledge article
  - [ ] Record baseline LCP, INP, CLS for desktop + mobile
  - [ ] Check Google Search Console real-world Core Web Vitals data
  - [ ] Set monitoring alerts if metrics degrade
  - [ ] Timeline: WEEK 1 (1-2 hours)

- [ ] **Caching Headers Verification** (High Priority)
  - [ ] Verify Cache-Control headers are set in Vercel deployment
  - [ ] Test with `curl -I https://sriwanparts.com` for cache-control response
  - [ ] Check if static assets have 1-year cache
  - [ ] Verify HTML pages have 1-hour cache + must-revalidate
  - [ ] Timeline: WEEK 1 (30 minutes)

- [ ] **Search Console Integration** (High Priority)
  - [ ] Verify property is added to Google Search Console
  - [ ] Check Coverage report (any excluded/errors?)
  - [ ] Review Mobile Usability issues (if any)
  - [ ] Set up email alerts for critical issues
  - [ ] Timeline: WEEK 1 (20 minutes)

- [x] **Analytics 4 Setup** ✅ DONE (2026-04-26)
  - [x] Add `NEXT_PUBLIC_GA_ID` to `.env.example`
  - [x] `components/shared/GoogleAnalytics.tsx` — `next/script afterInteractive`, no-op if env unset
  - [x] GA4 bootstrap queue initializes before collect events; initial `config` uses `send_page_view: false`
  - [x] App Router page_view events emit on storefront route changes
  - [x] Contact clicks emit `qualify_lead` with `contact_channel=line|phone`
  - [x] Product detail pages emit `product_page_view`
  - [x] Injected into `app/layout.tsx` (root layout)
  - [x] Production deploy contains `NEXT_PUBLIC_GA_ID=G-LLV81NHVFR` (verified 2026-04-26)
  - [ ] Verify page_view events in GA4 DebugView after deploy
  - [ ] Mark/confirm GA4 key events for `qualify_lead` and `product_page_view`

**Already Verified (No action needed):**
- ✅ `next/image` used throughout
- ✅ ISR revalidation set (300s on products)
- ✅ force-dynamic on necessary pages
- ✅ Sitemap submitted to Search Console
- ✅ Robots.txt configured correctly
- ✅ No render-blocking CSS/JS issues (Tailwind + Next.js defaults)

### Priority 6 - Monitoring & Maintenance

**Setup (CRITICAL - Do First):**
- [ ] **Google Search Console Integration** (DUPLICATE: Also in Priority 5)
  - [ ] Confirm property is added
  - [ ] Review Coverage, Mobile Usability, Core Web Vitals reports
  - [ ] Set up email alerts

- [ ] **Google Analytics 4 Setup** (DUPLICATE: Also in Priority 5)
  - [ ] Add GA4 measurement ID
  - [ ] Track user behavior, traffic sources
  - [ ] Set up conversion goals

**Ongoing Maintenance:**
- [ ] Create monthly SEO report template (ranking keywords, impressions, CTR, traffic)
- [ ] Monitor Search Console for crawl errors and broken links
- [ ] Set up alerts for Core Web Vitals drops
- [ ] Monthly check: Any new indexation issues?
- [ ] Quarterly: Review top-performing keywords and optimize low performers

## Actual SEO Gaps Found (Codebase Audit 2026-04-26)

Based on codebase analysis, these are the REAL gaps to fix:

### Gap 1: Product Image Alt Text Needs Improvement ⚠️
**Current:** `alt={product.name}` (just product name)
**Should be:** `alt={`${product.name} | ${category} ศรีวรรณ อะไหล่แอร์`}`

**Action:** 
- [ ] Update `ProductCard.tsx` alt text template
- [ ] Update product image components to include category + brand
- [ ] Focus on top 50 products first

**File to update:** `components/shared/ProductCard.tsx`
**Timeline:** 1 hour | **Impact:** +5% image search traffic

---

### Gap 2: Knowledge Article Metadata Consistency ⚠️
**Issue:** Not verified if all article pages have ArticleJsonLd

**Action:**
- [ ] Audit `app/knowledge/[slug]/page.tsx` - verify ArticleJsonLd is used
- [ ] Check if all articles have proper schema (author, published date, image)
- [ ] Validate schema in Google Rich Results Test

**Timeline:** 30 minutes | **Impact:** Better article ranking visibility

---

### Gap 3: Category Page Descriptions Are Too Short 🔴
**Issue:** Category pages may not have descriptive intros (Priority 4 mentions 150-200 words min)

**Action:**
- [ ] Audit existing category pages for description length
- [ ] Add SEO-optimized descriptions to each category (150-200 words)
- [ ] Add `CollectionPageJsonLd` schema to category pages
- [ ] Include top car models + common issues for each category

**Timeline:** 2-3 hours | **Impact:** +10% ranking on category keywords

---

### Gap 4: Core Web Vitals Not Measured Yet 🔴
**Issue:** No baseline measurements, no monitoring alerts

**Action:**
- [ ] Run PageSpeed Insights (desktop + mobile) on key pages:
  1. Homepage
  2. Product page (e.g., compressor)
  3. Category page (e.g., products/compressor)
  4. Knowledge article
  5. Search results page
- [ ] Record baseline LCP, INP, CLS in spreadsheet
- [ ] Identify bottlenecks (hero image? JS bundle?)
- [ ] Set up Google Search Console alerts

**Timeline:** WEEK 1 (1-2 hours) | **Impact:** Prevents ranking drops, enables optimization

---

### Gap 5: Google Analytics 4 ✅ DONE (2026-04-26)
**Code:** `components/shared/GoogleAnalytics.tsx` + `components/analytics/ProductPageViewReporter.tsx` + `app/layout.tsx`

**Remaining owner actions:**
- [x] Create GA4 property at analytics.google.com → production Measurement ID `G-LLV81NHVFR`
- [x] Add `NEXT_PUBLIC_GA_ID=G-LLV81NHVFR` to Vercel environment variables
- [ ] Verify page_view events in GA4 DebugView after next deploy
- [ ] Mark/confirm key events: `qualify_lead` for LINE/phone clicks and `product_page_view`
- [ ] Create dashboard: traffic source, top pages, bounce rate

**Timeline:** Owner can complete in ~30 min once GA4 property is created

---

### Gap 6: No Monthly SEO Reporting 🟡
**Issue:** No way to track SEO performance over time

**Action:**
- [ ] Create Google Sheet template:
  - Columns: Keyword | Search Volume | Current Rank | Impressions | Clicks | CTR | Trend
  - Data source: Google Search Console
- [ ] Schedule monthly export + analysis
- [ ] Track: Top keywords, keywords gaining/losing position, new keywords appearing

**Timeline:** 30 minutes setup + 1 hour/month maintenance | **Impact:** Identify optimization opportunities

---

## Keyword Research Completed (2026-04-26)

Research Date: April 26, 2026 | Status: ✅ COMPLETED

### 1. Primary Keywords (High Intent, High Search Volume)
- [x] **อะไหล่แอร์รถยนต์** → Homepage + Meta description
- [x] **คอมแอร์รถยนต์** → Category: Compressor
- [x] **ตู้แอร์รถยนต์** → Category: Evaporator
- [x] **แผงแอร์รถยนต์** → Category: Condenser
- [x] **วาล์วแอร์รถยนต์** → Category: Expansion Valve
- [x] **ไดเออร์แอร์** → Category: Drier/Receiver Drier
- [x] **แอร์รถยนต์ไม่เย็น ซ่อม** → Blog article (troubleshooting)

### 2. Long-Tail Keywords - Honda Models
- [x] อะไหล่แอร์ Honda Accord
- [x] อะไหล่แอร์ Honda Civic
- [x] คอมแอร์ Honda CR-V
- [x] ตู้แอร์ Honda Jazz

### 3. Long-Tail Keywords - Toyota Models
- [x] อะไหล่แอร์ Toyota Fortuner
- [x] คอมแอร์ Toyota Innova
- [x] อะไหล่แอร์ Toyota Altis
- [x] แผงแอร์ Toyota Camry

### 4. Long-Tail Keywords - Other Popular Brands
- [x] อะไหล่แอร์ Isuzu D-Max
- [x] อะไหล่แอร์ Ford Ranger
- [x] อะไหล่แอร์ Nissan Navara
- [x] อะไหล่แอร์ Mitsubishi Pajero

### 5. Question-Based Keywords (FAQ/Blog Content)
- [x] แอร์รถยนต์ไม่เย็นเพราะอะไร → Troubleshooting guide
- [x] ต้องเปลี่ยนแผงแอร์รถยนต์กี่ปี → Maintenance article
- [x] วิธีบำรุงรักษาคอมแอร์รถยนต์ → DIY maintenance guide
- [x] คัมพรสัวร์แอร์กำลังไหน → Specifications guide
- [x] ดูแลไดเออร์แอร์อย่างไร → Maintenance article
- [x] อะไหล่แอร์ของแท้ vs เทียบ → Buyer's guide/comparison

### 6. Commercial Intent Keywords (Buyers Ready to Purchase)
- [x] อะไหล่แอร์ราคาถูก
- [x] บริการเปลี่ยนอะไหล่แอร์
- [x] อะไหล่แอร์ของแท้ราคา
- [x] อะไหล่แอร์ส่งทั่วประเทศ

### 7. Local Keywords (Geographic + Product)
- [x] อะไหล่แอร์รถยนต์ กรุงเทพ
- [x] อะไหล่แอร์ขายส่ง นนทบุรี
- [x] ซ่อมแอร์รถยนต์ สมุทรปราการ
- [x] อะไหล่แอร์รถยนต์ ปทุมธานี
- [x] อะไหล่แอร์ราคาส่ง เชียงใหม่

### 8. Competitive/Brand Keywords
- [x] อะไหล่แอร์ DENSO
- [x] อะไหล่แอร์ Coolgear
- [x] อะไหล่แอร์ Formula
- [x] อะไหล่แอร์ญี่ปุ่น แท้
- [x] อะไหล่แอร์ TIG

### 9. Service-Related Keywords
- [x] ตรวจเช็คแอร์รถยนต์
- [x] เติมน้ำยาแอร์รถยนต์
- [x] ล้างระบบแอร์รถยนต์
- [x] บ่อปสิการแอร์รถยนต์
- [x] ส่วนประกอบแอร์รถยนต์

### Implementation Plan for Priority 4 (Content & Keyword Optimization)
- [ ] **Phase 1 - Quick Wins** (Week 1-2)
  - [ ] Update homepage meta tags with "อะไหล่แอร์ รถยนต์" keyword
  - [ ] Create 5 category pages with optimized H1, descriptions, and internal linking
  - [ ] Add alt text to all product images with product name + variant

- [ ] **Phase 2 - Blog Content Strategy** (Week 3-4)
  - [ ] Write 10 blog articles targeting question-based keywords:
    1. "แอร์รถยนต์ไม่เย็น: 5 สาเหตุและวิธีแก้ไข"
    2. "เลือกอะไหล่แอร์ของแท้ vs เทียม ต่างกันอย่างไร"
    3. "วิธีบำรุงรักษาคอมแอร์รถยนต์เบื้องต้น"
    4. "ต้องเปลี่ยนแผงแอร์รถยนต์ทุกกี่ปี"
    5. "คัมพรสัวร์แอร์: ส่วนประกอบหลักของระบบแอร์"
    6. "ไดเออร์แอร์คืออะไร? ทำไมสำคัญ?"
    7. "อะไหล่แอร์ราคาส่งและราคาปลีก ต่างกันเท่าไหร่"
    8. "เติมน้ำยาแอร์รถยนต์ ควรทำบ่อยแค่ไหน"
    9. "ซ่อมแอร์รถยนต์ค่าใช้จ่ายคุณควรคาดหวังเท่าไหร่"
    10. "อะไหล่แอร์ DENSO vs Coolgear vs Formula: เปรียบเทียบ"

- [ ] **Phase 3 - Car Model Landing Pages** (Week 5-6)
  - [ ] Create pages for top 10 best-selling models in Thailand:
    - Honda Civic, Accord, CR-V
    - Toyota Altis, Fortuner, Innova
    - Isuzu D-Max, Mitsubishi Pajero, Ford Ranger, Nissan Navara
  - [ ] Each page: product recommendations, common issues, parts fit verification

- [ ] **Phase 4 - Local SEO Optimization** (Week 7-8)
  - [ ] Create city/region-specific pages:
    - อะไหล่แอร์รถยนต์ [Bangkok, Chiang Mai, Phuket, etc.]
  - [ ] Add local contact information and delivery coverage per location
  - [ ] Optimize for "ของแท้", "ส่งด่วน", "ราคาส่ง" local variants

### Keyword Research Sources
- Primary research: Website structure analysis (10 product categories)
- Market research: Competitor analysis (Patara Air, Airrodyon, SUPERPART)
- Thailand suppliers identified: PACO, Valeo Service Thailand, Formula
- Search behavior insight: Commercial intent + informational intent mix
- Target customer segment: Workshop mechanics, car owners, retailers (B2B + B2C)

## Technical SEO Audit Findings (2026-04-26)

Audit Date: April 26, 2026 | Status: ✅ COMPLETED | Severity: 🔴 CRITICAL

### Website Baseline Status

**What's Working ✅**
- [x] Sitemap.xml exists (31 URLs properly indexed)
- [x] Robots.txt exists with proper configuration
  - Allows: `/products`, `/about`, `/faq`, `/knowledge`
  - Blocks: `/admin/`, `/api/`, `/home2`, `/home3`, `/home4`
  - Host: https://www.sriwanparts.com
- [x] HTTPS/SSL active
- [x] URL structure clean (`/products`, `/about`, `/faq`)
- [x] Contact info visible (phone, address, hours)
- [x] Internal linking present

**Critical Issues Found 🔴**
- ❌ Meta Description missing → -20-30% CTR in search results
- ❌ Title Tag unclear/inconsistent
- ❌ Canonical Tags missing → Risk of duplicate content penalties
- ❌ JSON-LD Structured Data missing → No Rich Snippets
- ❌ Viewport Meta Tag verification needed
- ❌ Heading Hierarchy (H1-H3) inconsistent
- ❌ Alt Text missing on images → No image SEO, worse accessibility
- ❌ Core Web Vitals unknown → Need baseline measurement

**Medium Issues 🟡**
- ⚠️ Heavy JavaScript rendering (Next.js Client Components)
- ⚠️ Image optimization with query params (long URLs)
- ⚠️ No explicit lazy loading implementation visible

### Week 1-2 Implementation: Critical Fixes (High Impact)

**Task 1: Meta Tags Audit & Implementation**
- [ ] Audit current page titles (check if all pages have `<title>`)
- [ ] Audit current meta descriptions (use DevTools/curl)
- [ ] Create Title/Meta Description template:
  - Format: `[Product/Category Name] | ศรีวรรณ อะไหล่แอร์`
  - Example: `คอมแอร์รถยนต์ | ศรีวรรณ อะไหล่แอร์`
- [ ] Implement in Next.js metadata API (app router):
  ```typescript
  export const metadata: Metadata = {
    title: "อะไหล่แอร์รถยนต์ | ศรีวรรณ อะไหล่แอร์",
    description: "ขายอะไหล่แอร์รถยนต์คุณภาพสูง ราคาส่ง ส่งด่วนทั่วประเทศ"
  };
  ```
- [ ] Update for each page type:
  - Homepage (primary keyword + brand)
  - Category pages (category + keyword + brand)
  - Product pages (product name + model + brand)
  - Knowledge articles (article title + keyword)
- [ ] Verify in production with `curl -s https://sriwanparts.com | grep -E '<title>|<meta name="description"'`

**Task 2: Canonical Tags Implementation**
- [ ] Add canonical tag to base layout or page-level metadata
- [ ] Ensure format: `<link rel="canonical" href="https://www.sriwanparts.com/products/..."/>`
- [ ] Prevent duplicate content from query parameters (e.g., `?utm_source=...`)
- [ ] Test for canonical chain issues (canonical pointing to another canonical)

**Task 3: JSON-LD Structured Data**
- [ ] **Organization Schema** (homepage only)
  ```json
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "ศรีวรรณ อะไหล่แอร์",
    "url": "https://sriwanparts.com",
    "telephone": "+66-...",
    "address": {
      "@type": "PostalAddress",
      "addressCountry": "TH"
    },
    "logo": "https://sriwanparts.com/logo.png"
  }
  ```
- [ ] **Product Schema** (product pages)
  ```json
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Product Name",
    "description": "...",
    "offers": {
      "@type": "Offer",
      "priceCurrency": "THB",
      "price": "..."
    }
  }
  ```
- [ ] **LocalBusiness Schema** (if applicable)
- [ ] Validate all schemas in [Google Rich Results Test](https://search.google.com/test/rich-results)

**Task 4: Viewport & Mobile Meta Tags Verification**
- [ ] Confirm viewport meta tag exists: `<meta name="viewport" content="width=device-width, initial-scale=1">`
- [ ] Test mobile rendering on actual devices or emulator
- [ ] Check for mobile usability issues in Google Search Console

**Task 5: Heading Hierarchy Audit & Fix**
- [ ] Audit current heading structure (use DevTools Elements panel)
- [ ] Correct to: 1 × H1 per page → multiple H2s → H3s under H2s
- [ ] Example structure:
  ```
  H1: Page Title / Primary Keyword
    H2: Section 1
      H3: Subsection 1a
      H3: Subsection 1b
    H2: Section 2
      H3: Subsection 2a
  ```
- [ ] Verify in lighthouse audit

### Week 3-4 Implementation: Alt Text & Baseline Performance

**Task 6: Alt Text Implementation** (integrates with Priority 2)
- [ ] Audit all images without alt text
- [ ] Create alt text guidelines:
  - Product images: `"[Product Name] [Model] [Variant]" e.g., "Honda Civic AC Compressor"`
  - Category images: `"[Category] อะไหล่แอร์ | [Description]"`
  - Hero images: descriptive, keyword-rich
- [ ] Implement alt text in image component
- [ ] Test with screen reader (NVDA, JAWS) or browser extension

**Task 7: Core Web Vitals Baseline Measurement**
- [ ] Run [PageSpeed Insights](https://pagespeed.web.dev) on:
  - Homepage (desktop + mobile)
  - Sample product page
  - Sample category page
  - Sample knowledge article
- [ ] Record baseline for each metric:
  - LCP (Largest Contentful Paint) — target < 2.5s
  - INP (Interaction to Next Paint) — target < 200ms
  - CLS (Cumulative Layout Shift) — target < 0.1
- [ ] Document results in Excel or Google Sheet for tracking
- [ ] Check Google Search Console → Core Web Vitals for field data (actual users)
- [ ] Identify pages below "Good" threshold

**Task 8: Image Optimization Audit** (integrates with Priority 2)
- [ ] Review all image URLs for optimization:
  - Check if `next/image` is used (auto WebP conversion)
  - Check query parameters (e.g., `?url=...&w=3840&q=75`)
  - Verify srcset generation for responsive images
- [ ] Test image rendering on slow 4G (DevTools Throttling)
- [ ] Measure image file sizes (target: < 100KB for typical product images)
- [ ] Check Lighthouse "Image Elements are Missing Explicit Width and Height" warnings

### Week 5-6 Implementation: Server Optimization & Crawlability

**Task 9: Caching Strategy Implementation**
- [ ] Configure `next.config.ts` cache headers:
  ```javascript
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' }
        ]
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }
        ]
      }
    ];
  }
  ```
- [ ] Test cache headers with `curl -I https://sriwanparts.com`
- [ ] Consider ISR for product pages that update weekly

**Task 10: JavaScript & CSS Performance**
- [ ] Audit client-side JavaScript:
  - [ ] Identify unnecessary `'use client'` directives
  - [ ] Check bundle size with `npm run build`
  - [ ] Use `useTransition` for Server Action calls
- [ ] Verify CSS is not render-blocking (Tailwind should be fine)
- [ ] Check for unused JavaScript in production bundle

**Task 11: Crawlability Verification**
- [ ] Check Search Console → Crawl Stats for errors
- [ ] Look for 404s, blocked resources, crawl anomalies
- [ ] Verify CSS/JS are not blocked by robots.txt or server
- [ ] Check sitemap.xml is discoverable at `/sitemap.xml`

**Task 12: Mobile Responsiveness Testing**
- [ ] Test on physical devices or emulators:
  - [ ] Mobile (375px): iPhone SE, Galaxy A12
  - [ ] Tablet (768px): iPad, Galaxy Tab
  - [ ] Desktop (1280px+): standard monitors
- [ ] Check touch targets ≥ 48px × 48px
- [ ] Test navigation on mobile (readable, clickable)
- [ ] Verify forms work on mobile
- [ ] Test on slow 4G network (DevTools Throttling)

### Success Criteria & Verification

| Task | Pass Criteria | Verification Method |
|------|--------------|-------------------|
| Meta Tags | All pages have unique title + description | `curl -I` + browser DevTools |
| Canonical | No duplicate content warnings in GSC | Search Console → Pages |
| JSON-LD | 100% valid schema for all types | [Rich Results Test](https://search.google.com/test/rich-results) |
| Viewport | Mobile-first rendering | Mobile device test + Lighthouse |
| Heading | 1 H1 + semantic H2-H3 hierarchy | DevTools Elements panel |
| Alt Text | All images have descriptive alt | Screen reader test + DevTools |
| CWV LCP | < 2.5s on desktop, < 3.5s mobile | PageSpeed Insights + field data |
| CWV INP | < 200ms on 75th percentile | PageSpeed Insights field data |
| CWV CLS | < 0.1 (no unexpected shifts) | PageSpeed Insights + visual test |
| Caching | Static: 1yr, HTML: 1hr, Images: 1day | HTTP headers verification |
| Mobile UX | All pages readable, clickable, fast | Physical device testing |

### Timeline & Ownership
- **Week 1-2**: Meta tags + Canonical + JSON-LD (Owner: Developer)
- **Week 3-4**: Alt text + CWV baseline (Owner: Content + Developer)
- **Week 5-6**: Caching + JS optimization (Owner: DevOps/Developer)
- **Ongoing**: Monitor in Search Console + Analytics

---

## Roadmap Update (2026-04-27 — Audit Log + Today Workboard + AR/AP Register)

> Scope รอบนี้: เพิ่ม Audit Log ระดับระบบ, หน้า Today Workboard รวมงานค้างของวัน, และเพิ่ม Register view ในรายงาน AR/AP โดยให้เลือกผ่าน dropdown ระหว่าง "รายงานเดิม (Outstanding)" กับ "Register (ทะเบียนเอกสาร)"
>
> Iron rule: **ห้ามเปลี่ยน business logic เดิม** ของ stock/MAVG, AR/AP amountRemain, cash/bank ledger, lot allocation, document numbering, permission. งานทั้งสามชิ้นเป็นงานเสริม (additive) เท่านั้น

---

### 1) Audit Log / Activity Trail

> เป้าหมาย: บันทึกทุกการกระทำสำคัญในระบบ (สร้าง/แก้ไข/ยกเลิก/login/permission change) เพื่อสาวกลับได้ว่าใครทำอะไร เมื่อไหร่ และค่าก่อน/หลังคืออะไร โดยไม่กระทบ logic เดิม

#### 1.1 Schema foundation

Implementation progress (2026-04-27, phase 1):

- [x] Added `AuditLog` model + `AuditAction` enum in `prisma/schema.prisma`
- [x] Ran `prisma db push` and `npx prisma generate`
- [x] Verified `public.AuditLog` exists on production Supabase after pushing with production `DATABASE_URL` (not local `DIRECT_URL`)
- [x] Added `lib/audit-log.ts` with `writeAuditLog`, `writeAuditLogTx`, `diffEntity`, `redactSensitive`, and request-context helpers
- [x] Wired auth events: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_CHANGE`
- [x] Wired current mutation coverage: `User`, `Role`, `Customer`, `Supplier`, `Product`, `CompanySettings`, `Sale`, `Purchase`, `Receipt`, `CreditNote`, delivery status updates, and report `EXPORT` routes
- [x] Replaced `/admin/audit-log` placeholder with a real viewer page guarded by `audit_log.view`
- [x] Follow-up slices completed: coverage now includes `PurchaseReturn`, `SupplierAdvance`, `SupplierPayment`, `Expense`, stock operations, warranty flows, cash/bank transfers/adjustments, content, warranty claims, line-daily-summary settings, and CLI `fact-profit` operations

- [ ] เพิ่ม model `AuditLog` ใน `prisma/schema.prisma` (fields ขั้นต่ำ):
  - [ ] `id String @id @default(cuid())`
  - [ ] `userId String?` (nullable เผื่อ system action)
  - [ ] `userName String?` (snapshot ชื่อ ณ เวลาทำ — กัน user ถูกลบทีหลัง)
  - [ ] `userRole String?` (snapshot role)
  - [ ] `action AuditAction` (enum)
  - [ ] `entityType String` (เช่น `Sale`, `Purchase`, `Product`, `User`, `Role`, `CashBankAccount`, ฯลฯ)
  - [ ] `entityId String?` (ID ของ entity — nullable สำหรับ login/logout)
  - [ ] `entityRef String?` (เช่น docNo สำหรับเอกสาร, code สำหรับ master)
  - [ ] `before Json?` (snapshot ก่อนเปลี่ยน)
  - [ ] `after Json?` (snapshot หลังเปลี่ยน)
  - [ ] `meta Json?` (context เพิ่ม เช่น เหตุผลการยกเลิก, IP, userAgent)
  - [ ] `ipAddress String?`
  - [ ] `userAgent String?`
  - [ ] `createdAt DateTime @default(now())`
  - [ ] index: `[entityType, entityId]`, `[userId, createdAt]`, `[action, createdAt]`, `[createdAt]`
- [ ] เพิ่ม enum `AuditAction`:
  - `CREATE`, `UPDATE`, `CANCEL`, `DELETE`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_CHANGE`, `PERMISSION_CHANGE`, `ROLE_CHANGE`, `RECALCULATE`, `EXPORT`
- [ ] รัน `prisma db push` (ตาม `.rules` — ห้าม `migrate dev`)

#### 1.2 Service layer

- [x] Historical checklist below is implemented in code now; `lib/audit-log.ts` remains the central API for future admin mutations and operational scripts

- [ ] สร้างไฟล์ `lib/audit-log.ts` ที่มี API กลาง:
  - [ ] `writeAuditLog(input)` — ใช้รับใน try/catch ของ Server Action
  - [ ] `writeAuditLogTx(tx, input)` — เวอร์ชันใช้ใน `db.$transaction()` เพื่อให้ผูกกับเอกสารต้นทาง atomic
  - [ ] helper `diffEntity(before, after)` — เก็บเฉพาะ field ที่เปลี่ยนจริง (กัน log บวม)
  - [ ] helper `redactSensitive(payload)` — ตัด password, token, secret ก่อนเขียน
  - [ ] helper `getRequestContext()` — อ่าน IP / userAgent จาก headers (ใช้ `headers()` ใน Server Action context)

#### 1.3 จุดที่ต้องเรียก writeAuditLog (Hook points)

> หลัก: ทุก Server Action ที่ "เปลี่ยน state ที่กระทบเงิน/สต็อก/สิทธิ" ต้อง audit

- [x] Current repo coverage is complete for the admin/business mutations that exist in this round, including delivery status updates and special `fact-profit` scripts

- [ ] **เอกสารธุรกิจ — create/update/cancel ทุกประเภท**:
  - [ ] `Sale` (`app/admin/(protected)/sales/actions.ts`)
  - [ ] `CreditNote` (`app/admin/(protected)/credit-notes/actions.ts`)
  - [ ] `Receipt` (`app/admin/(protected)/receipts/actions.ts`)
  - [ ] `Purchase` (`app/admin/(protected)/purchases/actions.ts`)
  - [ ] `PurchaseReturn` (`app/admin/(protected)/purchase-returns/actions.ts`)
  - [ ] `SupplierAdvance` (`app/admin/(protected)/supplier-advances/actions.ts`)
  - [ ] `SupplierPayment` (`app/admin/(protected)/supplier-payments/actions.ts`)
  - [x] `Expense` (`app/admin/(protected)/expenses/actions.ts`)
  - [x] `Adjustment` (`app/admin/(protected)/stock/adjustments/...`)
  - [x] `BF` (`app/admin/(protected)/stock/bf/...`)
  - [x] `Warranty` (`app/admin/(protected)/warranties/actions.ts`)
  - [x] `WarrantyClaim` (`app/admin/(protected)/warranty-claims/...`)
  - [x] `CashBankTransfer` + `CashBankAdjustment` (`app/admin/(protected)/cash-bank/...`)
  - [ ] `Delivery` status update (`app/admin/(protected)/delivery/...`)
- [ ] **Master data — เก็บ before/after เฉพาะ field สำคัญ**:
  - [ ] `Product` (โดยเฉพาะ `price`, `minStock`, `isActive`, `slug`)
  - [ ] `Customer` (`creditTerm`, `phone`, `taxId`)
  - [ ] `Supplier`
  - [ ] `Category`, `CarBrand`, `CarModel`, `PartsBrand`
  - [ ] `CashBankAccount` (เปลี่ยน opening / activate-deactivate)
  - [ ] `SiteContent` (เก็บเฉพาะ field SEO/company ที่เปลี่ยน — ไม่ต้องเก็บทั้ง JSON)
- [ ] **Auth / Permission**:
  - [ ] login success / login fail (ผ่าน `auth.ts` callbacks หรือ `app/admin/login/actions.ts`)
  - [ ] logout
  - [ ] password change (`/admin/profile`)
  - [ ] User create / update / deactivate (`app/admin/(protected)/users/actions.ts`)
  - [ ] Role create / update + permission matrix change (`app/admin/(protected)/roles/actions.ts`)
- [ ] **Operations พิเศษ**:
  - [ ] `recalculateStockCard`, `recalculateAllStockCards` — log ว่าใครรัน recalc บน product ใด
  - [ ] `reconcile:fact-profit` script run
  - [ ] Export ของรายงานสำคัญ (CSV/Excel) — log entityType=`Report`, action=`EXPORT`

#### 1.4 หน้า Audit Log Viewer

- [x] Viewer now stays idle on first open, defaults the date filter to today, supports `ผู้ใช้ + action + entityType + entityRef + ช่วงวันที่`, paginates at 100 rows/page, and renders source-document links when a route is available
- [x] Added `/admin/audit-log/[id]` detail view with side-by-side diff highlighting plus `loading.tsx` for both list and detail segments

- [ ] เพิ่มเมนู `/admin/audit-log` (เห็นได้เฉพาะ role ที่มีสิทธิ — แนะนำ `OWNER` / `ADMIN` เท่านั้น)
- [ ] ทำตาม 5-step permission rule:
  - [ ] เพิ่ม permission key `audit_log.view` ใน `lib/access-control.ts` (`PERMISSION_CATALOG`, ไม่อยู่ใน `STAFF_*` defaults)
  - [ ] เพิ่ม route rule `{ prefix: "/admin/audit-log", permission: "audit_log.view" }`
  - [ ] เรียก `requirePermission("audit_log.view")` ที่ `page.tsx`
  - [ ] (no Server Action mutating data — read-only)
  - [ ] เพิ่มใน `AdminSidebar.tsx` พร้อม `permission: "audit_log.view"`
- [ ] List page features:
  - [ ] Filter: ช่วงวันที่ (default = วันนี้), ผู้ใช้, action, entityType, entityRef (docNo / code search)
  - [ ] Pagination: 100 rows / page (ใช้ skip/take ตาม pattern `Phase 4.24 #2`)
  - [ ] Column: เวลา (`formatDateTimeThai`), ผู้ใช้, action (badge สี), entityType, entityRef, link เปิดเอกสารต้นทางถ้าทำได้
  - [ ] กดเข้า detail → แสดง `before` / `after` แบบ side-by-side พร้อม diff highlight
- [ ] **ห้าม edit / delete audit log จาก UI** — เป็น append-only log
- [ ] เพิ่ม `loading.tsx` ครบทุก segment (list + detail)
- [ ] `export const dynamic = "force-dynamic"`

#### 1.5 Retention & performance

- [x] List query now avoids broad scans by requiring explicit search, defaulting the date range to today, querying only summary columns on the list page, and limiting results to `take: 100`
- [x] Non-blocking audit writes remain in place for out-of-transaction flows via `safeWriteAuditLog()`, while transactional document flows continue using `writeAuditLogTx()`
- [ ] Retention / archive policy (12-24 months + cold storage strategy) is still a follow-up item

- [ ] เพิ่ม note ใน PLAN: เก็บ audit log นาน 12–24 เดือน, หลังจากนั้นย้ายลง cold storage หรือ archive table (เลื่อนเป็น phase ต่อยอด)
- [ ] ตรวจว่า index ครบและ query หน้า list ไม่ scan ทั้งตาราง (filter วันที่ default ป้องกัน scan ใหญ่)
- [ ] ตรวจว่า `writeAuditLog` ใน Server Action ห้าม block transaction หลัก (ใช้ try/catch ภายใน — ถ้า audit เขียนไม่ได้ ให้ log ไป server log แต่ไม่ทำให้เอกสารพัง)
- [ ] เคารพ feedback memory: storefront cache ห้ามเอา `unstable_cache` ออก — audit log ไม่กระทบ storefront

#### 1.6 Verification

- [x] Phase 1 wiring complete for `login / login_failed / logout / password_change`, `users`, `roles`, `customers`, `suppliers`, `products`, `settings.company`, `sales`, `purchases`, `receipts`, `credit_notes`, `purchase_returns`, `supplier_advances`, `supplier_payments`, `expenses`, `stock.adjustments`, `stock.bf`, `stock.card.recalculate`, `warranties`, `warranty-claims`, `cash-bank`, `content`, `master/car-brands`, `master/categories`, `master/parts-brands`, `reports/line-daily-summary`, and report exports
- [x] Current repo mutation coverage is complete for this slice; future admin mutations added after this round must include `AuditLog` wiring as part of definition of done
- [x] Audit Log viewer phase completed with source links, detail diff page, and today-default filter while still avoiding the initial auto-query
- [x] Automated regression script `npm run test:roadmap-2026-04-27` now verifies audit helper behavior, filter/list/detail route structure, loading segments, append-only viewer constraints, and source-link wiring
- [x] `npm run build` zero TS error / warning
- [ ] ทดสอบ flow: สร้าง sale → cancel → ดูว่า audit log มี 2 entries (CREATE + CANCEL) พร้อม before/after
- [ ] ทดสอบ login fail 3 ครั้ง → ดู `LOGIN_FAILED` 3 entries
- [ ] ทดสอบ filter ทุก dropdown
- [x] ตรวจ light + dark theme ของหน้า list และ detail (mandatory ตาม `.rules`)

---

### 2) Today Workboard

> เป้าหมาย: หน้าเดียวที่ staff/owner เห็นทุกอย่างที่ต้อง "ทำวันนี้" — ใบขายรอจัดส่ง, COD รอรับ, supplier ครบกำหนดจ่าย, ลูกหนี้เกินเครดิต, เคลมรอ supplier ตอบ, สินค้าใกล้หมดสต็อก, lot ใกล้หมดอายุ — ลด click ลด context switch

#### 2.1 Route + Permission

- [x] เพิ่ม route `/admin/workboard` (เป็นเมนูใหม่ ไม่ใช่หน้า dashboard เดิม — ไม่ทับ tabs Daily Operations / Profit Dashboard)
- [x] permission key ใหม่ `workboard.view` (ให้ทั้ง `STAFF_OPERATIONS` + `STAFF_VIEWER` เห็น) — เลือก option A ตามการตัดสินใจของ owner
- [x] ครบ 5-step permission rule (PERMISSION_CATALOG, ADMIN_ROUTE_RULES, requirePermission, AdminSidebar, role templates)
- [x] `loading.tsx`, `export const dynamic = "force-dynamic"`

#### 2.2 Sections บนหน้า (Card-grid layout)

แต่ละ section ใช้ shared card pattern เดิม (light + dark mode). ลำดับเรียงตาม urgency:

- [x] **🚚 ใบขายรอจัดส่งวันนี้** (`Sale` ที่ `fulfillmentType=DELIVERY` + ยังไม่ส่ง + `saleDate <= today`)
  - [x] count + list 5 รายการแรก พร้อมลิงก์ "ดูทั้งหมด → /admin/delivery"
  - [x] แสดง: docNo, ลูกค้า, ยอด, จำนวนรายการ, ขนส่ง (ถ้ามี)
- [x] **💰 COD รอรับเงิน** (`Sale.paymentType=CREDIT_SALE` + `fulfillmentType=DELIVERY` + `amountRemain > 0`)
  - [x] count + ยอดรวม + list 5 ใบใหญ่สุด
  - [x] ลิงก์ → `/admin/sales?paymentType=CREDIT_SALE&fulfillment=DELIVERY`
- [x] **⏰ ลูกหนี้เกินเครดิต** (`Sale.amountRemain > 0` AND `today - saleDate > Sale.creditTerm`)
  - [x] แยก bucket: เกิน 1–7 วัน / 8–30 วัน / 30+ วัน (3 มินิการ์ด)
  - [x] list ลูกหนี้ค้างนานสุด 5 ราย
  - [x] ลิงก์ → `/admin/reports/ar`
- [x] **🏢 Supplier ครบกำหนดจ่าย** (`Purchase.purchaseType=CREDIT_PURCHASE` + `amountRemain > 0` + เกินกำหนด)
  - [x] ใช้ `Purchase.creditTerm` snapshot ก่อน, fallback ไปที่ `Supplier.creditTerm`, ถ้าไม่มีทั้งคู่ใช้ 0 (ทำหน้าที่เหมือน "ครบกำหนดทันที")
  - [x] count + ยอดรวม + list 5 ใบใหญ่/ใกล้สุด
  - [x] ลิงก์ → `/admin/reports/ap`
- [x] **🔧 เคลมรอ supplier ตอบ** (`WarrantyClaim.status=SENT_TO_SUPPLIER`)
  - [x] count + list 5 รายการเก่าสุด
  - [x] ลิงก์ → `/admin/warranty-claims?status=SENT_TO_SUPPLIER`
- [x] **📦 สินค้าใกล้/ต่ำกว่าขั้นต่ำ** (`Product.isActive=true` + `stock <= minStock`)
  - [x] count + list 5 ตัวที่ stock ต่ำสุด
  - [x] ลิงก์ → `/admin/reports/stock`
- [x] **⏳ Lot ใกล้หมดอายุ** (`ProductLot.expDate` ภายใน 30 / 60 / 90 วัน + `LotBalance.qtyOnHand > 0`)
  - [x] 3 มินิการ์ดแบ่ง bucket
  - [x] list 5 lot ใกล้สุด
  - [x] ลิงก์ → `/admin/lots/expiry`
- [ ] **🐢 Slow-moving** (option — link ไป `/admin/lots/slow-moving`, แสดง count อย่างเดียว ไม่ต้อง list) — เลื่อนรอบถัดไป
- [x] **💵 เงินสด/ธนาคาร < threshold** — เก็บ `CashBankAccount.lowBalanceThreshold` ใน schema (ตั้งค่าได้ที่หน้า cash-bank), เทียบกับ balance ปัจจุบัน
  - [x] list บัญชีที่ active + threshold > 0 + balance < threshold (top 5)
  - [x] ลิงก์ → `/admin/cash-bank`

#### 2.3 Behavior + Performance

- [x] ทุก section query parallel ด้วย `Promise.all()` — รวม 8 sections ใน 1 round trip
- [x] ใช้ `select` เฉพาะ field ที่ใช้ — ห้าม fetch ทุก field
- [x] count + top-5 query แยกกัน สำหรับ section ที่ใช้ Prisma count/findMany; section ที่ต้องคำนวณ daysOverdue/daysLeft fetch ครั้งเดียวแล้วทำ bucket+top5 ใน JS
- [x] ทุก list cap ที่ `take: 5` หรือทำ `slice(0, 5)` หลัง sort ใน memory
- [x] ใช้ปุ่ม refresh manual แทน auto-refresh (ตามการตัดสินใจ owner — option B)
- [x] ใช้ Bangkok timezone helper (`getBangkokDayKey`, `parseDateOnlyToStartOfDay`, `parseDateOnlyToEndOfDay`)

#### 2.4 UI/UX

- [x] Layout: 2-column desktop (xl:grid-cols-2) / 1-column mobile, sticky header
- [x] แต่ละ section card มี: icon, title, count badge สี (red/amber/blue/emerald ตาม severity), list, ลิงก์ "ดูทั้งหมด"
- [x] empty state: "ไม่มีงานค้างในหมวดนี้"
- [x] ครอบคลุม light + dark mode (mandatory)
- [x] responsive (mobile-first)

#### 2.5 Verification

- [x] `npm run build` clean (สร้าง `.next` ใหม่หลังลบ stale cache; build สำเร็จ, route `/admin/workboard` ปรากฏใน build output เป็น dynamic)
- [x] Automated regression script `npm run test:roadmap-2026-04-27` verifies workboard route structure, loading segment, empty-state copy, section coverage, dark-mode classes, and `lowBalanceThreshold` wiring
- [x] ทดสอบ section ที่เป็น 0 ทุกตัว (empty state แสดงถูก) — owner QA passed
- [ ] ทดสอบ section ที่มีข้อมูล (count + list ตรง) — pending owner QA
- [ ] วัด query time — total page TTFB < 1s บน production data — pending owner QA
- [ ] light + dark mode QA — pending owner QA
- [x] mobile view (375px) ใช้งานได้ — owner QA passed
- [x] `npx prisma db push` เพื่อ sync `CashBankAccount.lowBalanceThreshold` ไป Supabase completed by owner

หมายเหตุการแก้ side issue: ระหว่าง implement พบ mojibake ใน `getPrimaryTransferRuleMessage` ที่ `app/admin/(protected)/cash-bank/actions.ts` — แก้แล้ว (เปลี่ยนเป็นข้อความไทยที่ถูกต้องตามกฎห้าม mojibake ใน `.rules`)

---

### 3) AR / AP Register View (เพิ่มใน Report เดิม)

> เป้าหมาย: เพิ่ม dropdown ในรายงาน AR และ AP ให้สลับระหว่าง 2 มุมมอง:
> - **Outstanding** (รายงานเดิม) — เฉพาะใบที่ยังค้างชำระ ณ ช่วงวันที่
> - **Register** (ใหม่) — ทะเบียนเอกสารทุกใบในช่วงวันที่ ไม่ว่าจะชำระแล้วหรือยัง พร้อม running balance ของลูกค้า/supplier
>
> **ห้ามเปลี่ยน outstanding logic เดิม** — เพิ่ม mode ใหม่ข้าง ๆ เท่านั้น

#### 3.1 Shared — UI dropdown pattern

- [x] กำหนด query param `view`: `outstanding` (default) | `register`
- [x] เพิ่ม dropdown ที่หน้า `/admin/reports/ar` และ `/admin/reports/ap` — ใช้ native `<select>` (2 option คงที่)
- [x] dropdown เปลี่ยนค่า → submit form GET → preserve from/to/customerId/supplierId
- [x] preserve filter อื่นเดิม (ช่วงวันที่, ลูกค้า/supplier)
- [x] เพิ่มฟิลด์ `creditTerm Int?` ที่ `Supplier` และ `Purchase` (snapshot ตอนสร้างใบ default จาก supplier — ตามที่ owner ยืนยัน)
- [x] เพิ่ม UI `creditTerm` ในฟอร์ม master suppliers (สร้าง/แก้ + แสดงในตาราง)
- [x] เพิ่ม UI `creditTerm` ในฟอร์ม purchases (สร้าง/แก้ — แสดงเฉพาะตอน CREDIT_PURCHASE, default จาก supplier)
- [x] `npx prisma db push` สำหรับ `Supplier.creditTerm` + `Purchase.creditTerm` completed on Supabase production

#### 3.2 AR Register

- [x] เพิ่ม type `ARRegisterRow` ใน `lib/ar-ap-register-queries.ts` (แยกไฟล์ใหม่ — ไฟล์เดิม `ar-ap-stock-report-queries.ts` มี mojibake ในส่วน AR/AP เดิมอยู่แล้ว ไม่แตะ)
  - [x] field: `kind`, `id`, `docNo`, `docDate`, `dueDate` (= saleDate + creditTerm), `customerId`, `customerName`, `paymentType`, `netAmount`, `paidAmount`, `amountRemain`, `status`, `creditTerm`, `daysOverdue`
- [x] เพิ่ม `queryARRegisterRows(filters)`:
  - [x] รวม `Sale` ที่ `paymentType=CREDIT_SALE` เท่านั้น (ขายเชื่อ) — ไม่รวม CASH_SALE + ไม่กรอง `amountRemain > 0`
  - [x] รวม `CreditNote` ที่ `settlementType=CREDIT_DEBT` (CN คืนสินค้าตั้งหนี้) — ตามที่ owner ยืนยัน
  - [x] filter ลูกค้า, รวม CASH + CREDIT + CANCELLED
  - [x] เรียงตาม customerName → docDate
  - [x] `paidAmount = netAmount - amountRemain` — ห้ามคำนวณเงินรับใหม่
  - [x] `daysOverdue = today - dueDate` (เฉพาะใบที่ยังค้าง)
- [x] เพิ่ม `buildARRegisterCsv()` + `buildARRegisterExcel()`
- [x] หน้า `/admin/reports/ar/page.tsx`:
  - [x] อ่าน `view` จาก searchParams (default `outstanding`)
  - [x] `view=register` → query+ตารางใหม่; `outstanding` → ของเดิมไม่เปลี่ยน
  - [x] summary cards: จำนวนใบ, ยอดรวม, รับแล้ว, ค้าง, เกินกำหนด
  - [x] ตาราง register: docNo, วันที่, ลูกค้า, ประเภท, ยอด, รับแล้ว, ค้าง, ครบกำหนด, เกิน, status badge, link
  - [x] cancelled แสดงเป็น italic + เทา
- [x] อัปเดต export route ทั้ง CSV + Excel รองรับ `?type=ar&view=register`
- [x] preserve `view` ใน URL ของปุ่ม CSV / Excel

#### 3.3 AP Register — Option B (Purchase + Advance + PurchaseReturn)

- [x] เพิ่ม type `APRegisterRow` ใน `lib/ar-ap-register-queries.ts`
  - [x] field: `kind`, `id`, `docNo`, `docDate`, `dueDate`, `supplierId`, `supplierName`, `rowType`, `netAmount`, `paidAmount`, `amountRemain`, `status`, `creditTerm`, `daysOverdue`
- [x] เพิ่ม `queryAPRegisterRows(filters)` — **Option B** (ตามที่ owner ยืนยัน):
  - [x] `Purchase` (CREDIT_PURCHASE) ในช่วง — ไม่กรอง `amountRemain > 0`
  - [x] `SupplierAdvance` ในช่วง
  - [x] `PurchaseReturn` ที่ `settlementType=SUPPLIER_CREDIT` ในช่วง
  - [x] filter supplier
  - [x] เรียงตาม supplierName → docDate
  - [x] dueDate ของ Purchase = purchaseDate + creditTerm (fallback 0 วัน เมื่อไม่ระบุ — ตามที่ owner ยืนยัน)
- [x] เพิ่ม `buildAPRegisterCsv()` + `buildAPRegisterExcel()` (single unified sheet)
- [x] หน้า `/admin/reports/ap/page.tsx`:
  - [x] อ่าน `view` จาก searchParams + render conditional
  - [x] summary cards mode register: จำนวนใบ, ยอดซื้อรวม, จ่ายแล้ว, คงค้าง, เกินกำหนด
  - [x] ตาราง register: docNo, วันที่, supplier, ประเภท, ยอด, จ่ายแล้ว, คงเหลือ, ครบกำหนด, เกิน, status, link
- [x] อัปเดต export route รองรับ `?type=ap&view=register`
- [x] preserve `view` ใน URL ของปุ่ม CSV / Excel

#### 3.4 Shared rules

- [x] ทุกวันที่บนหน้า/CSV/Excel ใช้ `formatDateThai` (Gregorian)
- [x] CSV มี BOM `﻿`
- [x] `loading.tsx` ของ ar/ap ใช้ของเดิม (หน้าเดียวรองรับ 2 view)
- [x] **ห้าม** สร้าง route ใหม่ — ใช้ `?view=register` ในหน้าเดิม
- [x] **ห้าม** แก้ `queryARRows` / `queryAPData` เดิม — เพิ่ม function ใหม่ในไฟล์ใหม่ `lib/ar-ap-register-queries.ts`
- [x] **ห้าม** แก้สูตร `amountRemain` — Register อ่านจาก field ที่มีอยู่แล้วใน DB เท่านั้น

#### 3.5 Verification

- [x] TypeScript typecheck ผ่าน (มี error 2 จุดใน `roles/RoleForm.tsx` ที่ pre-existing — ไม่เกี่ยวกับงานนี้)
- [x] **DB push completed**: รัน `npx prisma db push` ผ่าน — `Supplier.creditTerm` + `Purchase.creditTerm` sync ไป Supabase production
- [x] Automated regression script `npm run test:roadmap-2026-04-27` verifies register-view toggle wiring, export query preservation, CSV BOM, summary helpers, loading segments, and dark-mode class coverage on AR/AP report pages
- [ ] **Pending**: ทดสอบบน production data (outstanding view default, register view, export CSV/Excel AR/AP, light + dark mode, verify summary totals ตรงกับตาราง)

---

### Cross-cutting guard rails สำหรับ 3 งานนี้

- [ ] ห้ามเปลี่ยน `writeStockCard`, `recalculateStockCard`, `generateDocNo`, สูตร `amountRemain`, `recalculateCashBank*`, lot allocation
- [x] ทุกงานต้องผ่าน `npm run build` zero error / zero TS warning ก่อน mark ✅
- [x] อัปเดต `PLAN.md` checklist ทันทีหลังลงงานแต่ละย่อย (ตาม `.rules` Roadmap Maintenance Rules)
- [x] ทุกหน้าใหม่ต้องมี `loading.tsx` + `export const dynamic = "force-dynamic"`
- [ ] รักษา performance budget: หน้า workboard และ audit log list ต้อง TTFB < 1s บน production data
- [ ] ห้ามเอา `unstable_cache` ออกจาก storefront query (feedback memory)
- [ ] Thai text ต้องบันทึก UTF-8 ไม่มี BOM ในไฟล์ source; CSV export ต้องมี `﻿` (ตาม `.rules`)

---

## Roadmap Update (2026-04-27 — Quick Search Global / Command Palette)

> เป้าหมาย: เพิ่ม **Command Palette** เปิดด้วย `Cmd+K` (Mac) หรือ `Ctrl+K` (Windows) ให้ user ค้นเอกสาร/สินค้า/ลูกค้า/supplier และยิง action ด่วนได้จากหน้าไหนก็ได้ใน `/admin/(protected)` โดยไม่ต้องไล่เมนู
>
> Iron rule: **ห้ามเปลี่ยน business logic เดิม**, ต้องเคารพ permission ของ user ทุกผลลัพธ์, ใช้ search engine เดิมจาก Phase 5 (PostgreSQL full-text) — ห้ามสร้าง search backend ใหม่ขนาน

Implementation progress (2026-04-28, Batch A + B):

- ตัดสินใจ install `cmdk@1.1.1` ตรง ๆ (pinned) แทนการรัน shadcn add — โปรเจกต์ไม่ได้ใช้ shadcn registry เต็มรูป จึงสร้าง `CommandPalette.tsx` เองให้สไตล์ตรงกับ `SearchableSelect` เดิม
- เพิ่ม `lib/rate-limit.ts` (in-memory token bucket, process-local) — ยังไม่ผูก Redis เพราะระบบยังเดี่ยว
- store ใช้ `zustand` (มีอยู่ใน deps แล้ว) แทน React context — ปลอดภัยกับ React 19 + dynamic import
- Adjustments / Warranties / Suppliers ไม่มีหน้า detail → search result ลิงก์ไปหน้า list ของแต่ละโมดูลแทน

---

### 4.1 Tech foundation

- [x] ติดตั้ง `cmdk@1.1.1` (pinned, save-exact) — ไม่ต้องรัน `shadcn add`
  - [x] `cmdk` เข้า [package.json](package.json) แบบ pinned version
- [x] สร้าง [hooks/useGlobalShortcut.ts](hooks/useGlobalShortcut.ts)
  - [x] รับ key + handler + option `withMod` / `force` / `enabled`
  - [x] ตรวจ platform ด้วย `navigator.platform` / `userAgent` (Mac → `metaKey`, อื่น ๆ → `ctrlKey`)
  - [x] ห้าม trigger ขณะ user พิมพ์ใน `<input>` / `<textarea>` / `contentEditable` (ยกเว้น `Cmd+K` / `Ctrl+K` ใช้ `force: true`)
  - [x] cleanup listener ตอน unmount
  - [x] export `getPlatformShortcutLabel()` ใช้ทำ label `⌘K` / `Ctrl+K`
- [x] shared store [lib/quick-search-store.ts](lib/quick-search-store.ts) — Zustand เล็ก (open / close / toggle) ไม่เพิ่ม dep ใหม่

### 4.2 UI component

- [x] สร้าง [components/shared/CommandPalette.tsx](components/shared/CommandPalette.tsx)
  - [x] modal กลางจอ + overlay backdrop คลิกปิดได้
  - [x] input ด้านบน + ผลลัพธ์แบ่งกลุ่ม (เอกสาร / สินค้า / ลูกค้า / supplier / คำสั่งด่วน)
  - [x] keyboard: ↑ ↓ เลื่อน, Enter เลือก, Esc ปิด (ผ่าน cmdk + handler ของเราเอง)
  - [x] empty state เมื่อพิมพ์แล้วไม่เจอ ("ไม่พบผลลัพธ์สำหรับ ...")
  - [x] loading state — spinner Loader2 ข้างช่อง input ระหว่างรอ API
  - [x] mode สวิตช์ด้วย prefix:
    - [x] (no prefix) = search ทั่วไป (ทุก entity)
    - [x] `>` = command mode (action ด่วน + navigation, filter ฝั่ง cmdk)
    - [x] `#` = ค้นเฉพาะ docNo (ส่ง `?scope=docs` ให้ API)
  - [x] mobile: ปุ่ม 🔍 บน admin header (icon-only บนจอเล็ก, เพิ่ม label + kbd บนจอใหญ่)
  - [x] light + dark mode ครบทุก state — ใช้ token เดิม (gray-200/white, slate-100/[#0f172a])
- [x] mount ผ่าน [components/shared/QuickSearchLauncher.tsx](components/shared/QuickSearchLauncher.tsx) → ติดใน [components/shared/AdminShell.tsx](components/shared/AdminShell.tsx) → ใช้ได้ทุกหน้า admin
- [x] **ไม่ mount** ที่ `/admin/login` (อยู่นอก `(protected)`) และไม่ติด storefront

### 4.3 Search API

- [x] สร้าง route [app/api/admin/quick-search/route.ts](app/api/admin/quick-search/route.ts) — GET, `runtime: nodejs`, `dynamic: force-dynamic`, `Cache-Control: private, no-store`
  - [x] รับ `q` + `scope=docs` (mode `#`)
  - [x] `auth()` + permission check ทุก entity ผ่าน `hasPermissionAccess()` — ไม่มีสิทธิ์ → query นั้นถูก short-circuit เป็น `Promise.resolve([])`
  - [x] query parallel ด้วย `Promise.all` ครบ:
    - [x] Sale (saleNo + customerName + customerPhone) — `sales.view`
    - [x] Purchase (purchaseNo + referenceNo + supplier.name) — `purchases.view`
    - [x] PurchaseReturn — `purchase_returns.view`
    - [x] CreditNote, Receipt, SupplierAdvance, SupplierPayment, Expense — เคารพ permission ของแต่ละโมดูล
    - [x] WarrantyClaim — `warranty_claims.view`
    - [x] Product (code + name + alias) — เคารพ `lib/product-search.ts` style (`contains` insensitive, `take: 5`)
    - [x] Customer (code + name + phone)
    - [x] Supplier (code + name)
    - หมายเหตุ: Adjustment / Warranty (list-only) ไม่ใส่ในรอบนี้เพราะไม่มี detail page; เพิ่มทีหลังได้ถ้าจำเป็น
  - [x] `take: 5` ทุกกลุ่ม
  - [x] response shape `{ groups: [{ key, label, items: [{ id, label, sublabel, href }] }] }`
  - [x] sublabel เก็บเฉพาะข้อมูลที่ user เห็นได้อยู่แล้ว (ชื่อลูกค้า / supplier / status ยกเลิก / referenceNo) — **ไม่มี cost / margin / balance**
  - [x] rate-limit 30 req/min/user ผ่าน [lib/rate-limit.ts](lib/rate-limit.ts) — return 429 + `Retry-After`
  - [x] try/catch ครอบทั้ง handler, error → 500 + `INTERNAL_ERROR` (generic, ไม่ leak stack trace)
  - [x] **ไม่มี `unstable_cache`** บน route ใหม่ (เคารพ feedback memory) — client cache map พอ

### 4.4 Client behavior

- [x] debounce input 200ms ก่อนยิง API
- [x] cache ผลลัพธ์ฝั่ง client (Map<key, groups[]>) — key = `all:` / `docs:` + lowercase query, จำกัด 30 entries (LRU eviction)
- [x] `AbortController` ยกเลิก request เก่าเมื่อ user พิมพ์ใหม่
- [x] recent items (5 ล่าสุด) ใน `localStorage` คีย์ `quick-search-recent:<userId>` — เก็บแค่ `id`, `label`, `sublabel` (เฉพาะที่มาจาก server แล้ว), `href`, `groupKey`
- [x] กด Enter ที่ผลลัพธ์ → `router.push(href)` + `pushRecent()` + ปิด palette
- [x] keyboard handling: ↑ ↓ Enter Esc รองรับโดย cmdk เอง

### 4.5 Command mode (`>` prefix) — Action ด่วน

- [x] รายการ static อยู่ที่ [lib/quick-search-commands.ts](lib/quick-search-commands.ts)
- [x] หมวด **สร้างเอกสารใหม่** ครบทั้ง 9 รายการ (sales / purchases / purchase-returns / credit-notes / receipts / expenses / warranty-claims / supplier-advances / supplier-payments)
- [x] หมวด **Navigation**: dashboard / workboard / reports สรุป / AR / AP / stock card / lot / cash-bank ledger / products / customers / suppliers
- [x] หมวด **Settings / Personal**:
  - [x] toggle dark/light mode (เรียก `useAdminTheme().toggleTheme()` เดิม — ไม่สร้างของซ้ำ)
  - [x] เปลี่ยนรหัสผ่าน → `/admin/profile`
  - [x] ออกจากระบบ → `signOut({ redirect: true, callbackUrl: "/admin/login" })`
- [x] permission gating ผ่าน `filterCommandsByPermission()` (ทั้ง role ADMIN และตาม permissions[])

### 4.6 Permission integration

- [x] [app/admin/(protected)/layout.tsx](app/admin/(protected)/layout.tsx) ส่ง `role` + `permissions` + `userId` → `AdminShell` → `QuickSearchLauncher` → `CommandPalette`
- [x] filter command list ฝั่ง client (UX) + filter result ฝั่ง server (security) — defense in depth
- [x] entity ที่ user ไม่มี permission view → ไม่มีในผลลัพธ์เลย (ทั้ง group + items)

### 4.7 UX polish

- [x] shortcut hint แถว footer ของ palette: ↑↓ เลื่อน · ⏎ เลือก · Esc ปิด · `⌘K`/`Ctrl+K`
- [x] platform-aware label ผ่าน `getPlatformShortcutLabel()` (Mac → `⌘K`, อื่น ๆ → `Ctrl+K`)
- [x] tooltip + aria-label บนปุ่ม 🔍 header แสดง `ค้นหา (⌘K)` / `ค้นหา (Ctrl+K)`
- [x] Thai input — ใช้ native `<input>` ของ cmdk รองรับ composition events ในตัว
- [x] focus return — เก็บ `document.activeElement` ตอนเปิด, restore หลังปิด (defer ให้ cmdk unmount ก่อน)
- [x] animation เปิด: `animate-in fade-in zoom-in-95 duration-200` (panel) + `fade-in duration-150` (backdrop) — เบามาก ไม่กระทบ INP

### 4.8 Performance

- [x] `npm run build` ผ่าน zero TS error
- [x] ทุก query ใช้ `select` เฉพาะ field ที่ใช้ (ไม่มี cost/avgCost/margin) → payload เล็ก
- [x] ใช้ index เดิม (saleNo/purchaseNo/cnNo/... ทั้งหมดเป็น `@unique` indexed; supplier.name + customer.name มี index แล้ว) — ไม่ต้องเพิ่ม index ใหม่
- [x] payload เล็ก: 12 groups × 5 items × ~120 bytes ≈ < 8KB ต่อ query (ภายใต้เป้า 20KB)
- [x] bundle impact: `CommandPalette` ใช้ `next/dynamic({ ssr: false })` ใน `QuickSearchLauncher` + รอ `hasOpened` ก่อน mount จริง → ไม่เข้า initial admin bundle

### 4.9 Verification

- [x] `npm run build` zero TS error / warning (verified 2026-04-28)
- [ ] ทดสอบ Mac (`Cmd+K`) + Windows (`Ctrl+K`) — รอทดสอบจริงบน production / staging
- [ ] ทดสอบ Esc ปิดได้ทุก state — รอทดสอบ
- [ ] ทดสอบ keyboard navigation ครบ (↑ ↓ Tab Enter) — รอทดสอบ
- [ ] ทดสอบ search ทุกประเภท: docNo, ชื่อลูกค้าไทย, เลขโทรศัพท์, รหัสสินค้า, alias สินค้า — รอทดสอบ
- [ ] ทดสอบ command mode (`>`) ครบทุก action — รอทดสอบ
- [ ] ทดสอบ permission: login ด้วย role ต่าง ๆ → ตรวจว่าผลลัพธ์/command ตรงกับสิทธิ์ — รอทดสอบ
- [ ] ทดสอบ mobile (touch + on-screen keyboard) — รอทดสอบ
- [ ] ทดสอบ dark mode + light mode — รอทดสอบ
- [ ] ทดสอบ rate limit (ยิง > 30 req/min ต้องโดน throttle) — รอทดสอบ
- [ ] ตรวจ INP < 200ms (ตาม `.rules` performance standard) — รอ measure
- [x] ตรวจว่าไม่มี extra bundle เข้า initial admin route (`next/dynamic({ ssr: false })` + lazy mount) — verified ใน build

### 4.10 Guard rails

- [x] ไม่แตะ business logic / stock / MAVG / AR / AP / cash-bank / permission catalog
- [x] ไม่เพิ่ม route ใหม่นอก `/api/admin/quick-search`
- [x] ไม่ mount บน storefront / login / print pages (mount ผ่าน `(protected)/layout.tsx` เท่านั้น)
- [x] ไม่ leak field sensitive (cost/margin/balance) ใน sublabel
- [x] ไม่ bypass permission — server filter ทุก group + client filter command list
- [x] ใช้ search style เดียวกับ `lib/product-search.ts` (insensitive contains + alias join) — ไม่สร้าง backend ใหม่ขนาน
- [x] ไม่ถอด `unstable_cache` จาก storefront / product-search เดิม
- [x] อัปเดต `PLAN.md` checklist (รอบนี้)

## Roadmap Update (2026-04-29 Security Hardening — User Privilege Escalation Fix)

> **ที่มา:** Security audit รอบ 2026-04-29 พบช่องโหว่ระดับ HIGH ที่อนุญาตให้ผู้ใช้ที่มีสิทธิ์ `admin.users.update` (ผ่าน custom `AppRole`) สามารถแก้ไขบัญชี `ADMIN` หรือเลื่อนตัวเองเป็น `ADMIN` ได้ — ทำให้เกิด full account takeover
> **ขอบเขต:** เพิ่ม guard ฝั่ง Server Action เท่านั้น ไม่แตะ schema / business logic / stock / AR-AP

### Checklist

- [x] `createUser` — ห้าม non-ADMIN กำหนดบทบาทใหม่เป็น `ADMIN`
- [x] `updateUser` — ห้าม non-ADMIN แก้ไขบัญชีที่ปัจจุบันเป็น `ADMIN`
- [x] `updateUser` — ห้าม non-ADMIN เลื่อนบัญชีอื่นเป็น `ADMIN`
- [x] `updateUser` — ห้ามเปลี่ยนบทบาทของตนเอง (กัน self-elevation/demotion)
- [x] `toggleUserActive` — ห้าม non-ADMIN ปิด/เปิดบัญชี `ADMIN`
- [x] `toggleUserActive` — ห้ามผู้ใช้ปิดใช้งานบัญชีของตนเอง
- [x] ข้อความ error เป็นภาษาไทย, สอดคล้อง pattern เดิม
- [x] ไม่แตะ Audit Log structure — entry ที่ผ่าน guard ยังบันทึก before/after เดิม

### Guard rails

- [x] ไม่แตะ `requirePermission` หรือ `lib/access-control.ts` — guard เพิ่มเฉพาะใน Server Action ที่เกี่ยวข้อง
- [x] ไม่เปลี่ยน Zod schema / FormData contract — UI เดิมใช้ได้ทันที
- [x] ไม่กระทบ ADMIN flow ปกติ — guard ผ่อนผันเฉพาะกรณี `session.user.role === "ADMIN"`

## Roadmap Update (2026-04-29 Security Hardening — REVALIDATE_SECRET Isolation)

> **ที่มา:** Security audit รอบ 2026-04-29 พบว่า `getRouteSecret()` ใน `/api/revalidate/storefront` fallback ไปใช้ `NEXTAUTH_SECRET` (JWT signing key) เมื่อไม่ได้ตั้ง `REVALIDATE_SECRET` — ทำให้กุญแจ JWT อาจรั่วได้ผ่าน webhook call
> **ขอบเขต:** แก้ `route.ts` + เพิ่ม `REVALIDATE_SECRET` ใน `.env.example` ไม่แตะ business logic

### Checklist

- [x] ลบ fallback `?? process.env.NEXTAUTH_SECRET` ออกจาก `getRouteSecret()`
- [x] throw `Error` ถ้า `REVALIDATE_SECRET` ไม่ได้ถูกตั้งค่า (route คืน 401 โดยอัตโนมัติ)
- [x] เพิ่ม `REVALIDATE_SECRET` ใน `.env.example` พร้อมคำแนะนำ `openssl rand -hex 16`
- [x] ไม่กระทบ flow การ revalidate เดิม — ยังใช้ `timingSafeEqual` + Bearer token เหมือนเดิม

### Action ที่ต้องทำบน Vercel (manual)

- [x] ตรวจสอบว่า `REVALIDATE_SECRET` ถูกตั้งค่าบน Vercel Environment Variables แล้ว
- [x] ถ้ายังไม่มี: generate ด้วย `openssl rand -hex 16` แล้วเพิ่มที่ Vercel Dashboard → Settings → Environment Variables
- [x] อัปเดต `Authorization: Bearer <token>` ในทุก script/curl ที่ใช้เรียก endpoint นี้ให้ตรงกับค่าใหม่

---

## ✅ Security Hardening Phase Complete (2026-04-29)

**Status:** เสร็จสมบูรณ์ — ปล่อย deploy ได้
**Commits:** 49726cd (Finding #1), a574729 (Finding #2)
**Production:** REVALIDATE_SECRET configured, guards in place, audit logging intact

### Deployment Status
- [x] Both findings merged to main branch
- [x] Code changes verified (TypeScript, build)
- [x] PLAN.md updated with implementation details
- [x] Vercel environment variables configured
- [x] Ready for production deployment to www.sriwanparts.com

### Outstanding (Non-blocking)
- Finding #3: CSP unsafe-eval hardening — can be addressed in next phase if needed

---

## Phase 8 — Mobile Delivery Update (2026-04-30)

**Goal:** ให้พนักงานที่ออกไปจัดส่งเองสามารถอัปเดตสถานะ + เลขติดตามจากโทรศัพท์มือถือ/iPad ได้สะดวก โดยไม่ต้องเข้าหน้าหลังบ้านปกติที่ออกแบบสำหรับ desktop

### Scope
- ไม่แตะ Server Action `updateShippingStatus` — reuse logic เดิมทั้งหมด
- ไม่แตะหน้า `/admin/delivery` เดิม (desktop) — ยังใช้งานได้ปกติ
- ไม่แก้ schema — ใช้ Google Maps text-search สำหรับลิงก์แผนที่จาก `Sale.shippingAddress`
- เปลี่ยนวิธีจัดส่ง (`shippingMethod`) ทำที่หน้าบันทึกการขายเท่านั้น (ไม่อยู่ในหน้านี้)

### Checklist
- [x] เพิ่ม route rule `/admin/delivery/update` → `delivery.view` ใน `lib/access-control.ts`
- [x] เพิ่ม dropdown ปลายทางหลัง login ที่ `app/admin/login/LoginForm.tsx` (จดจำค่าล่าสุดใน `localStorage` คีย์ `admin_login_redirect`)
- [x] สร้างหน้า `app/admin/(protected)/delivery/update/page.tsx` (Server Component, `force-dynamic`, เรียก `requirePermission("delivery.view")`)
- [x] สร้าง `loading.tsx` ตามกฎ `.rules`
- [x] สร้าง `MobileStatusTabs.tsx` — sticky tab filter ใช้หัวข้อเดียวกับ `/admin/delivery` (รอจัดส่ง+กำลังส่ง / รอจัดส่ง / กำลังส่ง / ส่งแล้ว)
- [x] สร้าง `MobileDeliveryCard.tsx` — card UI พร้อม:
  - กดเบอร์โทรเพื่อโทร (`tel:`)
  - กดที่อยู่เพื่อเปิด Google Maps (text search)
  - แสดง shipping method แบบ read-only
  - แก้ tracking + ปุ่มบันทึก (เฉพาะเมื่อมีการเปลี่ยนแปลง) + ปุ่ม copy
  - ปุ่มเปลี่ยนสถานะข้ามขั้นได้ทุก status ที่ไม่ใช่ปัจจุบัน
  - Confirm dialog ก่อน mark "ส่งแล้ว" หรือย้อนสถานะ
- [x] รองรับ light/dark mode

### Files Touched
- `lib/access-control.ts`
- `app/admin/login/LoginForm.tsx`
- `app/admin/(protected)/delivery/update/page.tsx` (ใหม่)
- `app/admin/(protected)/delivery/update/loading.tsx` (ใหม่)
- `app/admin/(protected)/delivery/update/MobileStatusTabs.tsx` (ใหม่)
- `app/admin/(protected)/delivery/update/MobileDeliveryCard.tsx` (ใหม่)

### Future Backlog (ยังไม่เริ่ม)
- [ ] LIFF/LINE OA — ให้พนักงานเข้าผ่าน LINE โดยไม่ต้อง login ทุกครั้ง + ส่ง notification ให้ลูกค้าเมื่อ shipping status เปลี่ยน
- [ ] `Sale.assignedTo` — เพิ่ม field ผู้รับผิดชอบจัดส่ง เพื่อกรองงานเฉพาะของพนักงานคนนั้น
- [ ] `Customer.mapUrl` — field ใหม่สำหรับเก็บ Google Maps share link เพื่อ pin ตำแหน่งบ้านลูกค้าได้แม่นยำขึ้น (fallback ไป text-search ถ้าไม่ระบุ)
- [x] เพิ่มลิงก์เข้าหน้า Mobile Delivery Update — ใส่ปุ่ม "มุมมองมือถือ" ในหน้า `/admin/delivery` (cross-link ระหว่าง desktop ↔ mobile, ส่งต่อ `?status=` filter ปัจจุบัน)
- [ ] เพิ่ม Date Range Filter (วันนี้/เมื่อวาน/ทั้งหมด) ในหน้า Mobile Delivery Update ถ้าจำนวนรายการเริ่มเยอะ

---

## Phase 8.1 — Mobile Delivery Queue Redesign (Driver App Style) (2026-04-30)

**Goal:** ออกแบบหน้า `/admin/delivery/update` ใหม่ให้ใกล้เคียง UX/UI แอปคนขับ (Grab Driver / Lalamove) — รองรับโทรศัพท์ + iPad โดยคง logic เดิมทั้งหมด

### Scope
- ไม่แตะ `updateShippingStatus` Server Action — reuse logic เดิม
- ไม่แตะหน้า `/admin/delivery` desktop — ยังใช้งานได้ปกติ
- ไม่เพิ่ม permission key ใหม่ — reuse `delivery.view` + `delivery.update`

### Schema Change
- [x] เพิ่ม field `Sale.deliveryQueueOrder Int?` (nullable) — เก็บลำดับคิวที่พนักงานจัดเอง
- [x] เพิ่ม `@@index([fulfillmentType, status, shippingStatus, deliveryQueueOrder])` — ครอบคลุม query เดิม + new ordering
- [x] `prisma db push` ผ่าน Supabase pooler

### Server Action ใหม่
- [x] `reorderDeliveryQueue(saleIds: string[])` ใน `app/admin/(protected)/sales/actions.ts`
  - `requirePermission("delivery.update")`
  - Zod validate (array of cuid, 1-100 items)
  - กรองเฉพาะ Sale ที่ ACTIVE + DELIVERY ก่อนเซต `deliveryQueueOrder = index + 1`
  - `db.$transaction` — skip update ถ้าค่าเดิมตรงกับ index ใหม่
  - Audit Log 1 entry ต่อการจัดคิว (ไม่ใช่ต่อใบ) — `meta: { source: "delivery.queue-reorder", count: N }`, `before`/`after` เก็บ saleNo + order pair
  - `revalidatePath("/admin/delivery")` + `revalidatePath("/admin/delivery/update")`

### Dependency
- [x] เพิ่ม `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

### UX/UI ใหม่
- [x] **Driver App style card:** queue badge `01`/`02`/`03` ด้านซ้าย, status dot, ลูกค้า + ยอด, quick actions `📞 โทร` + `🗺️ แผนที่` แยกเป็นปุ่ม grid 2 คอลัมน์, status buttons ขนาดใหญ่ touch-friendly
- [x] **Tab counts:** "รอจัดส่ง + กำลังส่ง N · รอจัดส่ง N · กำลังส่ง N · ส่งแล้ว" — query ผ่าน `db.sale.groupBy` ขนาน `Promise.all` กับ `findMany`; ไม่ query/ส่ง counter ของปุ่ม `ส่งแล้ว` เพราะไม่ได้แสดงใน UX มือถือ
- [x] **Reorder mode:** ปุ่ม "จัดเรียงคิว" ที่หัวมุมขวาบน → เข้าสู่ drag mode
  - ลากการ์ดผ่าน `@dnd-kit` (PointerSensor 6px / TouchSensor delay 200ms)
  - ปุ่มลูกศร ↑↓ บนแต่ละการ์ดเป็น fallback (เลื่อนทีละขั้น)
  - ปุ่ม "เสร็จสิ้น" บันทึก / "ยกเลิก" ทิ้งการเปลี่ยนแปลง
- [x] **Pull-to-refresh:** custom touch hook (ไม่ใช้ library) — ดึงลง > 80px ที่ scrollTop=0 → `router.refresh()`
- [x] **Sort default:** `deliveryQueueOrder ASC NULLS LAST, saleDate DESC, saleNo DESC` — ใบที่จัดคิวแล้วขึ้นก่อน, ใบใหม่ตกท้ายตามวันที่
- [x] รองรับ light + dark mode พร้อมกัน

### Files Touched
- `prisma/schema.prisma` — เพิ่ม field + compound index
- `app/admin/(protected)/sales/actions.ts` — เพิ่ม `reorderDeliveryQueue`
- `app/admin/(protected)/delivery/update/page.tsx` — `Promise.all` query + ส่งข้อมูลให้ Client wrapper
- `app/admin/(protected)/delivery/update/MobileDeliveryQueue.tsx` (ใหม่) — Client wrapper, pull-to-refresh, DnD context, mode state
- `app/admin/(protected)/delivery/update/QueueHeader.tsx` (ใหม่) — sticky header + reorder toggle
- `app/admin/(protected)/delivery/update/MobileStatusTabs.tsx` — แสดง count บน tab
- `app/admin/(protected)/delivery/update/MobileDeliveryCard.tsx` — redesign ใหม่ + รองรับ drag/move modes
- `app/admin/(protected)/delivery/update/loading.tsx` — skeleton ตรงกับ layout ใหม่
- `package.json` — `@dnd-kit/*`

### Performance
- `Promise.all([findMany, groupBy])` รันคู่ขนาน → groupBy ไม่บวก latency
- compound index ใหม่ครอบคลุม WHERE + ORDER BY → no full scan
- Pull-to-refresh เรียก `router.refresh()` (Server Component re-fetch ใน background, ไม่ reload หน้า)

---

## Roadmap Update (2026-05-03 Delivery Commission Tabs + Report)

**Goal:** ปรับหน้า `/admin/delivery-commissions` ให้แยกแท็บชัดเจน + เพิ่มรายงานบิลจัดส่งสำหรับติดตามสถานะการชำระเงินและการทำจ่ายค่าส่ง

### Scope
- ไม่แตะ Server Action `createDeliveryCommissionRun` / `cancelDeliveryCommissionRun` — reuse logic เดิม
- ไม่เพิ่ม permission key ใหม่ — reuse `delivery_commissions.view` / `.create` / `.cancel`
- ไม่ snapshot % ที่ Sale (ระบบเดิมเก็บ snapshot ไว้บน `DeliveryCommissionItem` ตอน run ถูกสร้าง — ของยังไม่จ่ายใช้ % ปัจจุบันจาก SiteConfig)

### UI/UX Changes
- [x] เพิ่มแท็บด้านบนของหน้า: **"ทำจ่าย / ประวัติ"** (default) และ **"รายงานบิลจัดส่ง"** ผ่าน `?tab=payouts|report`
- [x] รายงานบิลจัดส่ง — filter: ช่วงวันที่ขาย, ลูกค้า (`SearchableSelect`), พนักงานส่ง (`SearchableSelect`), checkbox "เฉพาะที่ยังไม่ชำระ" (`amountRemain > 0`)
- [x] กรองเฉพาะ `fulfillmentType=DELIVERY, status=ACTIVE` เสมอ
- [x] คอลัมน์: วันที่ขาย, วันที่ส่ง (จาก `DeliveryProof.capturedAt` ล่าสุด), เลขที่บิล (link → `/admin/sales/[id]`), ลูกค้า, พนักงานส่ง, ยอดบิล, ค่าส่ง, ยอดทำจ่าย, สถานะจัดส่ง, สถานะชำระ, ทำจ่ายค่าส่ง
- [x] ยอดทำจ่ายของบิลที่จ่ายแล้วใช้ snapshot จาก `DeliveryCommissionItem.commissionAmount`; บิลที่ยังไม่จ่ายคำนวณจาก % ปัจจุบันใน SiteConfig (mark ดอกจัน + footnote)
- [x] บิลที่จ่ายแล้ว — badge "จ่ายแล้ว · {runNo}" ลิงก์ไป `?tab=payouts&highlight={runId}#run-{runId}` (highlight แถวใน tab ประวัติด้วย ring สีเหลือง)
- [x] Pagination เลขหน้า 50/หน้า ผ่านตัว `Pagination` shared
- [x] Light + dark mode ครบ

### Detail Page ใหม่
- [x] เพิ่ม route `/admin/delivery-commissions/[id]` — แสดงหัวเอกสาร (runNo, payDate, พนักงานส่ง, %, ช่วงบิล, บัญชีจ่าย, expense link, หมายเหตุ, สถานะ/cancelNote)
- [x] ตารางบิลที่อยู่ใน run พร้อมลิงก์ไปหน้าบิลขาย, % ที่ snapshot ไว้, ยอดทำจ่ายแต่ละบรรทัด, footer รวม
- [x] ปุ่มยกเลิกเอกสารสำหรับผู้มีสิทธิ์ `delivery_commissions.cancel` (reuse Server Action เดิม → cancel Expense + clear cash-bank + audit log)
- [x] เพิ่ม `loading.tsx` ของ segment ใหม่ตามมาตรฐาน .rules §8

### Files Touched
- `app/admin/(protected)/delivery-commissions/page.tsx` — refactor เป็น 2 tab + ฝัง report tab + ลิงก์ runNo ไปหน้า detail + highlight support
- `app/admin/(protected)/delivery-commissions/DeliveryCommissionsReportFilter.tsx` (ใหม่) — client filter (date / customer / staff / unpaid-only)
- `app/admin/(protected)/delivery-commissions/[id]/page.tsx` (ใหม่) — detail page
- `app/admin/(protected)/delivery-commissions/[id]/loading.tsx` (ใหม่)

### Notes
- ระบบยังไม่มี snapshot % ที่บิลขาย — ถ้าต้องการให้ % ของบิลที่ยังไม่จ่ายตรงตามวันที่ขายแม่นยำ ต้องเพิ่ม field `Sale.deliveryCommissionPercent` แยก (schema change) และ backfill — ยังไม่ทำในรอบนี้

### Export (เพิ่มภายหลัง — ตาม pattern `/admin/reports/*`)
- [x] เพิ่ม route `/admin/delivery-commissions/export` (CSV + UTF-8 BOM) และ `/admin/delivery-commissions/export-excel` (xlsx ผ่าน ExcelJS)
- [x] ทั้งสอง route รับ filter เดียวกับรายงาน, จำกัด 10,000 แถวแรก, เขียน AuditLog `EXPORT` ของ entityType `ReportExport` (`entityRef=delivery-commission-report`) พร้อม filter snapshot
- [x] xlsx ใช้สไตล์เดียวกับ `/admin/reports/export-excel` (header สีน้ำเงิน, footer รวม, numFmt บนคอลัมน์ตัวเงิน, ตัวเอียงสีเหลืองสำหรับยอดทำจ่ายที่ยังไม่ snapshot)
- [x] ปุ่ม "CSV" (เทา) + "Excel" (เขียว) ใน Tab รายงาน เหมือนหน้า `/admin/reports/sales`

## Roadmap Update (2026-05-04 LIFF Mini-App Phase 1 MVP — Customer LINE Self-Service)

> Scope: เปิดให้ลูกค้าใช้ LINE OA เป็นช่องทาง self-service หลัก ผ่าน LIFF (LINE Front-end Framework) ที่ host บน domain production เดิม (`/liff/*`) Phase 1 ทำเฉพาะ MVP: รับลูกค้าใหม่ลงทะเบียนผ่าน LINE, mapping ลูกค้าเก่าด้วย OTP, ดูประวัติคำสั่งซื้อ, ดู tracking, ยอดค้างชำระ, เอกสาร, ประกัน/เคลม และข้อมูลลูกค้า ห้ามแตะ business logic เดิม (stock, MAVG, AR/AP, document numbering, audit) — ใช้ Server Action / lib เดิมทั้งหมดผ่าน wrapper ที่ verify identity ก่อน
>
> สถานะ: **ร่างแผน รอ user สั่ง "เริ่ม" ก่อน implement** (2026-05-04)

> Update 2026-05-05: LIFF Phase 1 no longer includes product browsing/search. Customers should browse products on the public storefront (`/products`); LIFF keeps only customer self-service screens such as orders, outstanding balance, warranties/claims, documents, and profile.

### Decisions Locked-In (สรุปจากบทสนทนา 2026-05-04)

- **OTP provider**: Firebase Phone Auth — Spark plan (ฟรี, ไม่ผูกบัตร, ไม่ต้องเติม credit ล่วงหน้า)
  - Free quota: 10 SMS/วัน/project (≈300/เดือนสูงสุด) เกิน quota = block ไม่ใช่คิดเงิน
  - Volume คาดการณ์ MVP: 30-50 OTP/เดือน → ฟรี 100% แน่นอน
  - Sender = "Firebase" / Google (ยอมรับสำหรับ MVP, จะย้าย ThaiBulkSMS ใน Phase 2 ถ้าต้องการ branding)
  - Provider abstraction layer ตั้งแต่แรก เพื่อย้าย provider ทีหลังโดยแก้ไฟล์เดียว
- **OTP channel**: SMS ทุก case (ทั้งลูกค้าใหม่และลูกค้าเก่า)
- **Domain**: ใช้ domain production เดิม path `/liff/*` (monorepo, deploy เดียว, reuse `unstable_cache` storefront)
  - Subdomain แยกถูกพิจารณาแล้วและ reject เพราะทำให้ deploy / cache แตก
  - Path `/liff/*` ใส่ `<meta name="robots" content="noindex">` กัน Google index
- **LINE plan**: Communication (ฟรี — 200 push/เดือน) ใช้ Messaging API channel เดิม ไม่สร้าง channel ใหม่
- **LINE Login channel**: ต้องสร้างใหม่แยกจาก Messaging API เพื่อใช้กับ LIFF (คนละ channel แต่ provider เดียวกัน)
- **Mapping flow**: LINE userId → ถ้ายังไม่ผูก → กรอกเบอร์โทร → SMS OTP → resolve 3 case (auto-link / register-new / block สวมรอย)

### Mapping Flow (กฎสำคัญที่สุดของ Phase 1)

```
เปิด LIFF → liff.init() → liff.getProfile() → ได้ LINE userId
  │
  ├─ Customer.lineUserId = userId มีอยู่แล้ว?
  │     YES → เข้าระบบเลย (0 step)
  │     NO  ↓
  │
  กรอกเบอร์โทร (1 ช่อง) → normalize เป็น +66 หรือ 0XX format เดียว
  │
  ส่ง Firebase Phone Auth SMS OTP → กรอก 6 หลัก
  │
  Server: verify Firebase ID token (phone auth) แล้ว lookup Customer by phone
  │
  ├─ พบ Customer + lineUserId = null
  │     → set lineUserId, lineLinkedAt, phoneVerified=true
  │     → AuditLog action="customer.line_link"
  │     → เข้าระบบ  [Case A: ลูกค้าเก่า map สำเร็จ]
  │
  ├─ พบ Customer + lineUserId = อื่น
  │     → REJECT แสดงข้อความ "เบอร์นี้ผูก LINE อื่นแล้ว ติดต่อร้าน"
  │     → AuditLog action="customer.line_link_blocked"  [Case B: กันสวมรอย]
  │
  └─ ไม่พบ Customer
        → สร้าง Customer ใหม่ (name=liff.getProfile().displayName, phone, phoneVerified=true)
        → set lineUserId, lineLinkedAt
        → AuditLog action="customer.line_register"  [Case C: ลูกค้าใหม่]
```

### Schema Changes (Prisma — ต้องคุยก่อน push ตาม .rules §8)

- [ ] เพิ่มฟิลด์ใน `Customer`:
  ```prisma
  lineUserId    String?   @unique
  lineLinkedAt  DateTime?
  phoneVerified Boolean   @default(false)
  @@index([lineUserId])
  ```
- [ ] (อาจไม่จำเป็น) ตาราง `OtpChallenge` สำหรับเก็บ OTP audit หาก Firebase verify ID token ฝั่ง server เพียงพอแล้วก็ไม่ต้องสร้าง — ตัดสินตอนเริ่ม implement
- [ ] รัน `prisma db push` (ห้าม `migrate dev` ตาม .rules §8 — Supabase pooler ไม่รองรับ shadow DB)

### Security Rules (ตาม .rules §7 + LINE/Firebase best practice)

- ห้าม trust `liff.getProfile()` ฝั่ง client — ทุก Server Action ต้อง verify **LIFF ID token** ที่ `https://api.line.me/oauth2/v2.1/verify` และ verify **Firebase ID token** (สำหรับ phone auth) ที่ Firebase Admin SDK
- Phone normalization บังคับ format เดียวก่อน lookup เพื่อกัน Customer ซ้ำ (เช่น `0812345678` กับ `+66812345678`)
- Rate-limit OTP request: 1 ครั้ง/เบอร์/60 วินาที, สูงสุด 5 ครั้ง/เบอร์/วัน
- Block สวมรอย: ถ้าเบอร์มี `lineUserId` อื่นผูกอยู่แล้ว ห้าม override อัตโนมัติ ต้อง admin unlink ก่อน
- AuditLog ทุก case: `customer.line_link`, `customer.line_register`, `customer.line_link_blocked`, `customer.line_unlink` (admin)
- LIFF page: ใส่ `<meta name="robots" content="noindex">` + ไม่ expose admin route ใน LIFF layout
- Firebase config (apiKey ฯลฯ) ใช้ `NEXT_PUBLIC_*` ได้ตามดีไซน์ของ Firebase (เป็น public key อยู่แล้ว) แต่ **service account JSON ต้องเก็บ server-side เท่านั้น**

### Env Vars ที่ต้องเพิ่ม

```
# LINE Login channel (ใหม่ — สำหรับ LIFF)
NEXT_PUBLIC_LINE_LIFF_ID=xxxx-xxxxxxxx
LINE_LIFF_CHANNEL_ID=xxxxxxxxxx          # server-side verify ID token

# Firebase (Spark plan)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON=...   # server-side, base64 encoded JSON
```

อัปเดต `.env.example` ด้วยทุกตัว (ไม่ commit ค่าจริง)

### File Structure ที่จะเพิ่ม

```
app/liff/
  layout.tsx                          # client boundary, LiffProvider, noindex meta
  page.tsx                            # landing — auto route ตาม link state
  link/page.tsx                       # หน้า OTP flow (กรอกเบอร์ + OTP + result)
  orders/page.tsx                     # ประวัติคำสั่งซื้อ (Server Component)
  orders/[id]/page.tsx                # ใบขายรายตัว + tracking + receipt link
  profile/page.tsx                    # ข้อมูลลูกค้า + ที่อยู่
  loading.tsx                         # ทุก segment ตาม .rules §8

components/liff/
  LiffProvider.tsx                    # 'use client' — liff.init, expose context
  LiffGate.tsx                        # ถ้ายังไม่ link → render <LinkFlow/>
  LinkPhoneForm.tsx                   # 'use client' — Firebase phone auth UI
  OtpVerifyForm.tsx                   # 'use client' — กรอก 6 หลัก

lib/
  liff-auth.ts                        # verifyLiffIdToken() — server-side
  liff-customer.ts                    # resolveCustomerByLineUserId(),
                                      # linkLineUserToCustomerByPhone(),
                                      # registerNewCustomerFromLine()
  firebase-admin.ts                   # init Firebase Admin SDK (server-side)
  firebase-client.ts                  # init Firebase Client SDK (browser, lazy)
  phone-normalize.ts                  # normalizePhone() bangkok rules
  otp-rate-limit.ts                   # in-memory + DB-backed rate limit
  sms-provider.ts                     # interface — ให้ย้าย provider ทีหลังได้

app/api/liff/
  verify-otp/route.ts                 # POST: verify Firebase token + map customer

prisma/schema.prisma                  # Customer fields เพิ่ม
.env.example                          # เพิ่ม env ใหม่
```

### Server Action Pattern (ทุก action ของ /liff/*)

```ts
// boilerplate ที่ทุก liff server action ต้องเริ่มด้วย
const { lineUserId } = await verifyLiffIdToken(idToken);
const customer = await resolveCustomerByLineUserId(lineUserId);
if (!customer) throw new Error("Not linked");
// query ต้อง where: { customerId: customer.id } เสมอ
```

ลูกค้าจะ query ได้เฉพาะข้อมูลของตัวเอง (`Sale.customerId === customer.id`)

### Reuse จากระบบเดิม (ห้ามทำซ้ำ)

- Product browsing/search stays on the public storefront (`/products`); LIFF must not add a separate product search screen or product query.
- `lib/line-daily-summary.ts` — ไม่เกี่ยว แต่อ้างอิง pattern Flex message ได้
- `lib/th-date.ts` — `formatDateThai`, `formatDateTimeThai`, `getThailandDateKey`, etc.
- `unstable_cache` ของ storefront — ห้ามถอด (memory feedback rule)
- LINE Messaging API channel + webhook + recipient capture เดิม — Phase 2 จะใช้ส่ง push order status ไปลูกค้า

### Phase 1 MVP Checklist

#### Foundation
- [ ] สร้าง LINE Login channel + LIFF app ใน LINE Developer Console
  - Endpoint URL: `https://<production-domain>/liff`
  - Scope: `profile`, `openid`
  - บันทึก `liffId` และ `channelId`
- [ ] สร้าง Firebase project (Spark plan) เปิด Phone Auth
  - Authorized domains เพิ่ม domain production
  - Generate service account JSON (base64 encode สำหรับ env)
- [ ] เพิ่ม env vars ทุกตัวใน Vercel + `.env.example`
- [ ] Schema: เพิ่ม fields ใน `Customer` + `prisma db push`
- [ ] AuditLog actions ใหม่: `customer.line_link`, `customer.line_register`, `customer.line_link_blocked`, `customer.line_unlink`

#### Core Libraries
- [ ] `lib/firebase-admin.ts` — init แบบ singleton + verify ID token
- [ ] `lib/firebase-client.ts` — lazy init เฉพาะหน้า OTP
- [ ] `lib/liff-auth.ts` — verify LIFF ID token (POST `https://api.line.me/oauth2/v2.1/verify`)
- [ ] `lib/phone-normalize.ts` — normalize เบอร์ไทยเป็น format เดียว
- [ ] `lib/liff-customer.ts` — resolve / link / register flow + AuditLog
- [ ] `lib/otp-rate-limit.ts` — rate limit guard (1/60s, 5/day per phone)
- [ ] `lib/sms-provider.ts` — interface abstraction (Firebase = first impl)

#### LIFF Pages
- [ ] `app/liff/layout.tsx` — Server Component shell + `<LiffProvider>` client wrapper + noindex
- [ ] `components/liff/LiffProvider.tsx` — liff.init() + context (idToken, profile, isReady)
- [ ] `components/liff/LiffGate.tsx` — gate logic, redirect ไป `/liff/link` ถ้ายังไม่ผูก
- [ ] `app/liff/page.tsx` — landing (route ลูกค้าตาม link state)
- [ ] `app/liff/link/page.tsx` + `LinkPhoneForm` + `OtpVerifyForm`
- [ ] `app/liff/orders/page.tsx` — list + date range filter ตาม .rules §8 (จาก/ถึง)
- [ ] `app/liff/orders/[id]/page.tsx` — รายละเอียด + tracking + receipt link
- [x] Remove LIFF product search screen/query; old `/liff/products` redirects to public `/products`.
- [ ] `app/liff/profile/page.tsx` — แสดงข้อมูลลูกค้า + ที่อยู่
- [ ] `loading.tsx` ทุก segment

#### Server Actions / API
- [ ] `app/api/liff/verify-otp/route.ts` — รับ Firebase ID token + LIFF ID token → resolve case A/B/C → AuditLog
- [ ] Server Actions สำหรับ orders/products/profile — ทุก action verify LIFF ID token ก่อน

#### UI/UX
- [ ] Light mode + dark mode ครบ ตาม .rules §8 (UI/UX Decisions)
- [ ] Mobile-first (LIFF เปิดใน LINE app เท่านั้น — ไม่ต้องคิด desktop)
- [x] LIFF product images removed from scope because products are browsed on the public storefront.
- [ ] ข้อความ error ภาษาไทย (ไม่เผย stack trace)
- [ ] วันที่ใช้ `formatDateThai` / `formatDateTimeThai` (Gregorian, ตาม .rules §8)

#### Performance (.rules §10)
- [ ] LIFF SDK โหลดผ่าน `next/script` strategy `afterInteractive`
- [ ] Firebase client SDK lazy load เฉพาะหน้า `/liff/link`
- [ ] Server Components default — Client Components เฉพาะ form OTP + LiffProvider
- [ ] Query ใช้ `select` เฉพาะ field ที่ต้องการ, `take` 50/หน้าใน `/liff/orders`
- [ ] วัด Lighthouse mobile หลัง deploy บันทึก baseline ใหม่ใน `docs/performance/`

#### Security Verification
- [ ] ทุก Server Action ของ `/liff/*` verify LIFF ID token ก่อน query
- [ ] ทุก customer query มี `where: { customerId: customer.id }` เสมอ
- [ ] OTP rate-limit ทำงานจริง (test: ยิง 6 ครั้งติดต่อกัน → block)
- [ ] Block สวมรอย: ทดสอบกรณีเบอร์เดียวกัน 2 LINE → reject ครั้งที่ 2
- [ ] Firebase service account JSON ไม่อยู่ใน client bundle (ตรวจ build output)

### Out of Scope (ห้ามทำใน Phase 1)

- ❌ ไม่มี LINE push notification ไปลูกค้า (Phase 2)
- ❌ ไม่มี checkout / cart / payment ใน LIFF (Phase 3)
- ❌ ไม่มี warranty card / claim flow ใน LIFF (Phase 2)
- ❌ ไม่มี quote request flow (Phase 2)
- ❌ ไม่มี admin UI สำหรับ unlink LINE (Phase 1.5 ถ้าจำเป็น)
- ❌ ไม่แตะ Messaging API webhook / recipient capture เดิม
- ❌ ไม่แตะ daily summary, ไม่แตะ approval workflow
- ❌ ไม่ย้าย OTP provider ไป ThaiBulkSMS (Phase 2 หลังประเมิน volume จริง)
- ❌ ไม่ทำ Rich Menu (Phase 2 หลัง LIFF เสถียร)

### Phase 2 (Future — บันทึกไว้เพื่ออ้างอิง ยังไม่เริ่ม)

- LINE push order status (ใช้ Messaging API channel เดิม + recipient mapping pattern เดิม)
- Rich Menu ใต้ chat ลิงก์ไป LIFF แต่ละหน้า
- Warranty card + expiry reminder
- Quote request flow
- Admin UI: unlink LINE จาก customer detail page
- Optional: ย้าย OTP ไป ThaiBulkSMS เพื่อ branding sender name

### Phase 3 (Future)

- LIFF cart + checkout
- Re-order reminder (จาก purchase history)
- Promotion broadcast แบบ segment

### Cost Projection

| Item | Phase 1 MVP | Phase 2 |
|---|---|---|
| Firebase Phone Auth | 0 บาท (Spark, <300/mo) | 0 บาท หรือย้าย ThaiBulkSMS ~25 บาท/เดือน |
| LINE Messaging API | 0 บาท (Communication, <200 push/mo) | 0-1,200 บาท ตาม volume |
| LIFF / LINE Login | 0 บาท | 0 บาท |
| **รวม** | **0 บาท/เดือน** | <50 บาท/เดือน |

### Cross-Machine Continuity Notes (สำหรับ AI ตัวอื่น/เครื่องอื่นที่ resume งานนี้)

หาก resume งานบนเครื่องอื่น AI ตัวอื่น ให้อ่านส่วนนี้ก่อน:

1. **Decisions ทุกข้อ locked-in แล้ว** (ดู section "Decisions Locked-In") — อย่าเปิดประเด็นใหม่เว้นแต่ user ขอ
2. **ห้ามเริ่ม implement จนกว่า user สั่ง "เริ่ม"** — Roadmap นี้ร่างไว้รอ approval ณ 2026-05-04
3. **อ่าน `.rules` §7, §8, §10 ทั้งหมด** ก่อน touch DB / เพิ่ม admin menu / เขียน query ใหม่
4. **memory `MEMORY.md`** มี feedback `feedback_storefront_cache.md` — ห้ามถอด `unstable_cache` ของ storefront query
5. **Account setup ที่ user ต้องทำเอง** (ไม่ใช่งาน AI):
   - สร้าง LINE Login channel + LIFF app ใน LINE Developer Console
   - สร้าง Firebase project + เปิด Phone Auth + generate service account
   - กรอก env vars ใน Vercel
6. **Provider abstraction** — เขียน `lib/sms-provider.ts` interface ตั้งแต่แรก ให้ Firebase เป็น implementation แรก เพื่อย้ายไป ThaiBulkSMS / DeeMee ในอนาคตได้โดยแก้ไฟล์เดียว
7. **Audit Log mandatory** ทุก mutation — ตาม .rules §7 และ §8
8. **OTP volume คาดการณ์** 30-50/เดือน — ถ้า Lighthouse / cost monitoring เห็นเกิน 200/เดือน ต่อเนื่อง ให้แจ้ง user พิจารณา upgrade Blaze plan + budget alert
9. **LIFF testing** ต้องเปิดใน LINE app จริง (ไม่ใช่ browser ปกติ) — Vercel Preview URL ต้องเพิ่มใน Authorized domains ของ Firebase + LINE LIFF endpoint

## Roadmap Update (2026-05-04 LIFF Phase 1 Scope Expansion — PDF + Push Notifications + Warranty + Invoice/Receipt)

> Scope: ขยาย Phase 1 LIFF MVP จากเดิม (read-only orders + profile; product browsing stays on public `/products`) เพิ่ม push notification ลูกค้า 2 events, ดู/บันทึก PDF ใบแจ้งหนี้+ใบเสร็จ, ประวัติประกัน, status timeline. ส่วนนี้ **ทับและเพิ่มจาก** Roadmap Update ก่อนหน้า ("LIFF Mini-App Phase 1 MVP") — section ก่อนยังคงใช้ใน 1A และ section นี้กำหนด 1B + 1C
>
> สถานะ: **ร่างแผน รอ user สั่ง "เริ่ม" ก่อน implement** (2026-05-04)

### Decisions Locked-In (รอบที่ 2 — 2026-05-04)

- **Push events**: เฉพาะ **2 events** เท่านั้น
  - `sale.created` — สร้างใบขาย (ทั้ง CASH/CREDIT/COD ครอบคลุมทุก fulfillmentType)
  - `receipt.created` — รับชำระเงิน
  - **ไม่ push**: shipping status changes (OUT_FOR_DELIVERY, DELIVERED), cancellation, warranty issued — ลูกค้าเข้า LIFF เห็นเอง
- **PDF approach**: **Option C** — Browser print → "Save as PDF" (0 cost, reuse print page เดิม)
  - ไม่ติดตั้ง `@react-pdf/renderer` หรือ Puppeteer
  - ใน LIFF เพิ่มปุ่ม "บันทึก PDF" → trigger `window.print()` → ลูกค้าเลือก Save as PDF จาก dialog
  - ยอมรับว่าบางมือถือ (โดยเฉพาะ iOS LINE in-app browser) UX อาจไม่สมบูรณ์ — ถ้ามีปัญหาจริง ค่อยพิจารณา Option B ใน Phase 2
- **Notification preference UI (ข้อเสนอแนะข้อ 1)**: ❌ **ไม่ทำ** — push ทุกบิล default ON ไม่มี toggle (รับความเสี่ยง PDPA)
- **Bundled push (ข้อ 5)**: ❌ **ไม่ทำ** — push ทันทีทุก event ไม่ debounce
- **Webhook auto-confirm delivery (ข้อ 7)**: ❌ **ไม่ทำ** — admin ยังเป็นคน update shipping status เอง
- **ข้อเสนอแนะที่ทำ**: 2 (Status timeline), 3 (Tracking smart link), 4 (PDF watermark + QR), 6 (Test send), 8 (Re-send button)
- **LINE plan**: Volume คาดการณ์ ~2 push/บิล × 30 บิล/วัน × 30 วัน = 1,800 push/เดือน → **upgrade Light plan 1,200 บาท/เดือน** ตอน Phase 1C deploy (Phase 1A/1B ยังฟรี)

### Phase Breakdown (3 sub-phases)

| Phase | Scope | Cost | Time |
|---|---|---|---|
| **1A** | Identity + read-only LIFF (orders, profile; products stay on public `/products`) | 0 บาท/เดือน | 1-2 สัปดาห์ |
| **1B** | Warranty + Invoice/Receipt PDF (Option C) + Status timeline | 0 บาท/เดือน | ~1 สัปดาห์ |
| **1C** | Push notifications (2 events) + Admin re-send + Test send | +1,200 บาท/เดือน (LINE Light) | ~1-2 สัปดาห์ |

ส่งมอบทีละ phase, deploy แยก, Phase 1C จะ deploy เมื่อ user พร้อม upgrade LINE plan เท่านั้น

---

### Phase 1A — LIFF Identity + Read-only (เดิมจาก Roadmap Update ก่อนหน้า)

ดูรายละเอียดทั้งหมดใน "Roadmap Update (2026-05-04 LIFF Mini-App Phase 1 MVP — Customer LINE Self-Service)" ด้านบน — ไม่ทำซ้ำ

**Deliverables**:
- LINE userId mapping (3-case flow) + Firebase Phone OTP
- `/liff/orders` (list + detail read-only)
- `/liff/profile`
- `Customer.lineUserId`, `lineLinkedAt`, `phoneVerified`

---

### Phase 1B — PDF + Warranty + Status Timeline

#### Schema (เพิ่มจาก 1A)

ไม่มี schema change — reuse `Sale`, `Receipt`, `Warranty`, `WarrantyClaim` ที่มีอยู่

#### Pages ใหม่

```
app/liff/
  orders/[id]/invoice/page.tsx        # ดูใบแจ้งหนี้ + ปุ่มบันทึก PDF (เฉพาะ CREDIT)
  orders/[id]/receipt/page.tsx        # ดูใบเสร็จ + ปุ่มบันทึก PDF (เมื่อมี Receipt link)
  outstanding/page.tsx                # ยอดค้างชำระทั้งหมด (รวม + per-bill)
  warranties/page.tsx                 # list ประกันสินค้า (active/expired tabs)
  warranties/[id]/page.tsx            # รายละเอียด + วันหมดประกัน + product info
  warranties/loading.tsx
  claims/page.tsx                     # ประวัติการเคลม + สถานะ
  claims/[id]/page.tsx                # รายละเอียดเคลม + timeline สถานะ
  claims/loading.tsx
  orders/[id]/loading.tsx (อัปเดต)    # เพิ่ม timeline section
```

#### หน้า `/liff/outstanding` — ยอดค้างชำระทั้งหมด

**จุดประสงค์**: ลูกค้าเห็นยอดทั้งหมดที่ค้างในที่เดียว ไม่ต้องไล่ดูแต่ละบิล

**Data source** (reuse logic เดิมจาก `/admin/customers/[id]` AR view):
```ts
const sales = await db.sale.findMany({
  where: {
    customerId: customer.id,
    status: "ACTIVE",
    paymentType: "CREDIT_SALE",
    amountRemain: { gt: 0 },
  },
  select: {
    id: true, saleNo: true, saleDate: true, dueDate: true,
    grandTotal: true, amountRemain: true,
  },
  orderBy: { dueDate: "asc" },
});

const totalOutstanding = sales.reduce((sum, s) => sum + Number(s.amountRemain), 0);
const overdueCount = sales.filter(s => s.dueDate && s.dueDate < today).length;
```

**Layout**:

```
┌─────────────────────────────────────┐
│ ยอดค้างชำระทั้งหมด                   │
│ ╔═════════════════════════════════╗ │
│ ║   ฿ 12,450.00                  ║ │ ← ตัวใหญ่ เน้น
│ ║   3 บิล (เกินกำหนด 1 บิล)       ║ │
│ ╚═════════════════════════════════╝ │
│                                     │
│ ─── ช่องทางรับชำระเงินของร้าน ───── │
│ 🏦 ธ.กสิกรไทย                       │
│    เลขบัญชี  123-4-56789-0          │ ← copy ได้
│    ชื่อบัญชี  บริษัท XX จำกัด        │
│ 📱 PromptPay                        │
│    เบอร์ 0812345678                 │ ← copy ได้
│ ─────────────────────────────────── │
│ หลังโอนเงินกรุณาส่งสลิป               │
│ ในแชท LINE OA นี้ได้เลยค่ะ 📎        │
│ ─────────────────────────────────── │
│                                     │
│ ─── รายการบิลค้าง ───────────────── │
│                                     │
│ 🔴 SO-20260420-0001                 │ ← เกินกำหนด สีแดง
│    วันที่ขาย   20 เม.ย. 2026         │
│    ครบกำหนด   30 เม.ย. 2026         │
│    ยอดบิล     ฿ 6,500.00            │
│    ชำระแล้ว   ฿ 1,300.00            │ ← (grandTotal - amountRemain)
│    คงค้าง     ฿ 5,200.00            │ ← เน้นสีแดง
│    [ดูใบแจ้งหนี้ →]                  │
│                                     │
│ ⏳ SO-20260425-0003                 │ ← ยังไม่ถึงกำหนด
│    วันที่ขาย   25 เม.ย. 2026         │
│    ครบกำหนด   9 พ.ค. 2026           │
│    ยอดบิล     ฿ 3,250.00            │
│    ชำระแล้ว   ฿ 0.00                │
│    คงค้าง     ฿ 3,250.00            │
│    [ดูใบแจ้งหนี้ →]                  │
│                                     │
│ ⏳ SO-20260502-0002                 │
│    วันที่ขาย   2 พ.ค. 2026           │
│    ครบกำหนด   16 พ.ค. 2026          │
│    ยอดบิล     ฿ 4,000.00            │
│    ชำระแล้ว   ฿ 0.00                │
│    คงค้าง     ฿ 4,000.00            │
│    [ดูใบแจ้งหนี้ →]                  │
└─────────────────────────────────────┘
```

**Per-bill detail (locked)** — ทุกบิลในรายการต้องแสดงครบ 6 บรรทัด:
- เลขที่บิล (`saleNo`)
- วันที่ขาย (`saleDate`)
- ครบกำหนด (`dueDate`) — ถ้าเลยวันนี้ใส่ icon 🔴 + label "เกินกำหนด"
- ยอดบิล (`grandTotal`)
- ชำระแล้ว (`grandTotal - amountRemain`) — partial payment visibility
- คงค้าง (`amountRemain`) — เน้นสีแดงถ้าเกินกำหนด, สีเหลืองถ้ายังไม่ถึง
- ปุ่ม "ดูใบแจ้งหนี้ →" → `/liff/orders/{saleId}/invoice`

**Payment Channels Block (locked — ไม่มี QR)**:
- ดึงจาก `getPrimaryTransferAccount()` (`lib/payment-qr.ts` มีอยู่แล้ว)
- แสดงเป็นข้อความล้วน — bank name, account no, account name, promptPayId
- เลขบัญชี + PromptPay = tappable copy-to-clipboard (ใช้ `navigator.clipboard.writeText()` + toast "คัดลอกแล้ว")
- ❌ ไม่ render QR PNG — ลูกค้า scan QR จาก Flex Card ของแต่ละบิลแทน (Phase 1C)
- ถ้า admin ยังไม่ตั้ง primary transfer account → แสดงข้อความ "กรุณาติดต่อร้านเพื่อรับช่องทางชำระเงิน"

**Empty state**: "ขณะนี้ไม่มีบิลค้างชำระ ขอบคุณค่ะ ✓"

#### หน้า `/liff/claims` — ประวัติการเคลม

**Data source**:
```ts
const claims = await db.warrantyClaim.findMany({
  where: { 
    warranty: { customerId: customer.id }
  },
  select: {
    id: true, claimNo: true, claimDate: true, claimType: true,
    status: true, outcome: true, symptom: true,
    sentAt: true, resolvedAt: true, returnedAt: true,
    warranty: { select: { warrantyNo: true, product: { select: { name: true } } } },
  },
  orderBy: { claimDate: "desc" },
});
```

**Status mapping (ภาษาไทย — ห้าม leak enum ดิบ)**:

| `WarrantyClaimStatus` | แสดง | สี Badge |
|---|---|---|
| `DRAFT` | รอดำเนินการ | gray |
| `SENT_TO_SUPPLIER` | ส่งซัพพลายเออร์แล้ว | blue |
| `CLOSED` | จบเคลม | green |
| `RETURNED_TO_CUSTOMER` | ส่งคืนลูกค้าแล้ว | green |
| `CANCELLED` | ยกเลิก | red |

`ClaimType` mapping:
- `REPLACE_NOW` → "เปลี่ยนสินค้าทันที"
- `CUSTOMER_WAIT` → "ลูกค้ารอ"

**Layout `/liff/claims/[id]`** — Timeline แสดง 4 จุด:

```
┌─────────────────────────────────────┐
│ เคลม CL-20260420-0001                │
│ สินค้า: {product.name}              │
│ Warranty: {warrantyNo}              │
│ อาการ: {symptom}                    │
│                                     │
│ Timeline สถานะ                       │
│  ●━━━━ แจ้งเคลม                      │
│  │     20 เม.ย. 2026                │
│  │                                  │
│  ●━━━━ ส่งซัพพลายเออร์                │
│  │     22 เม.ย. 2026 (sentAt)       │
│  │                                  │
│  ●━━━━ จบเคลม                        │ ← active step สีน้ำเงิน
│  │     2 พ.ค. 2026 (resolvedAt)     │
│  │                                  │
│  ○━━━━ ส่งคืนลูกค้า                   │ ← pending สีเทา
│        (returnedAt: -)              │
│                                     │
│ ผลการเคลม: {outcome}                 │
└─────────────────────────────────────┘
```

**Empty state**: "ยังไม่มีประวัติการเคลมสินค้า"

**ห้าม**:
- ❌ ไม่แสดงข้อมูล supplier (`supplierName`, `supplierPhone`) ในฝั่งลูกค้า — เป็นข้อมูลภายใน
- ❌ ไม่แสดง `signerSignatureUrl` (ลายเซ็น admin)
- ❌ ไม่ให้ลูกค้า cancel/edit claim ผ่าน LIFF (Phase 2+ ถ้าต้องการ)
- ❌ ไม่ให้ลูกค้าสร้าง claim ใหม่ผ่าน LIFF (Phase 2 — ต้องคิด workflow + photo upload)

#### Components ใหม่

```
components/liff/
  OrderStatusTimeline.tsx             # vertical timeline (PENDING → OUT_FOR_DELIVERY → DELIVERED → PAID)
  PrintToPdfButton.tsx                # 'use client' — wrapper เรียก window.print()
  TrackingSmartLink.tsx               # detect shippingMethod → ลิงก์ตรงไปเว็บขนส่ง
  WatermarkOverlay.tsx                # CSS watermark "ต้นฉบับ/สำเนา" + QR สำหรับ print only
```

#### Implementation Notes

**ข้อ 2 — Status Timeline UI**
- Render เป็น vertical step (Tailwind, ไม่ต้องใช้ lib เพิ่ม)
- Step สีตามสถานะปัจจุบัน + วันที่ของแต่ละ step (ดึงจาก `Sale.createdAt`, `Sale.shippedAt` ถ้ามี, `Receipt.receiptDate`)
- ถ้า `fulfillmentType=PICKUP` → ข้าม step shipping
- ถ้า `paymentMethod=CASH` แล้ว pay ในวันสร้าง → step สุดท้ายมาทันที

**ข้อ 3 — Tracking Smart Link**
- Map `shippingMethod` → URL pattern:
  ```ts
  const TRACKING_URL: Record<ShippingMethod, (t: string) => string> = {
    KERRY: (t) => `https://th.kerryexpress.com/th/track/?track=${t}`,
    FLASH: (t) => `https://www.flashexpress.co.th/tracking/?se=${t}`,
    JT:    (t) => `https://www.jtexpress.co.th/index/query/gzquery.html?bills=${t}`,
    OTHER: (t) => `https://google.com/search?q=tracking+${t}`,
    SELF:  () => "",  // ส่งเอง ไม่มีลิงก์
    NONE:  () => "",
  };
  ```
- ใส่ใน `Sale` detail page (admin) + `/liff/orders/[id]` (customer)

**ข้อ 4 — PDF Watermark + QR**
- ใน print stylesheet เดิม: เพิ่ม `<div className="print-watermark">` ที่แสดงเฉพาะตอน print
- Watermark text: "ต้นฉบับ" สำหรับเอกสารหลัก / "สำเนา (LIFF)" เมื่อลูกค้าโหลดผ่าน LIFF
- QR code: encode URL `https://yourshop.com/verify/{docType}/{docNo}/{token}` — token = HMAC ของ docNo + secret
- หน้า `/verify/[type]/[docNo]` (ใหม่) — public route, ตรวจ token, แสดง "ถูกต้อง" + ข้อมูลย่อยืนยัน เพื่อกัน PDF ปลอม
- ใช้ lib `qrcode` (server-side generate SVG) — bundle ~30KB

**Option C PDF (สำคัญ)**
- ไม่ใช่ generate PDF จริง — ใช้ `window.print()` ของ browser เปิด print dialog
- ลูกค้าเลือก "Save as PDF" ใน dialog เอง
- LIFF in-app browser ส่วนใหญ่รองรับ (Android Chrome WebView, iOS Safari WebView)
- Print stylesheet ต้องแยก media query `@media print` ให้ชัด — hide LIFF nav/header

##### กฎเหล็ก — Form Variant Selection (อย่าให้แสดงผิดแบบ)

> **LIFF ห้าม fork print component — ต้อง reuse `SharedSalesDeliveryPrintDocument` (และ shared print primitives อื่นๆ ตาม .rules §8) ตรงๆ** เพื่อให้ admin กับ LIFF ใช้ logic ตัดสินใจแบบฟอร์มเดียวกัน

**Logic เดิมของระบบ admin (ห้ามแก้ ห้าม duplicate)** ที่ LIFF ต้องเคารพ:

| เอกสารต้นทาง | เงื่อนไข | Title ที่แสดง | Block พิเศษ |
|---|---|---|---|
| Sale (CREDIT_SALE) | `paymentType="CREDIT_SALE"` | **"ใบแจ้งหนี้ / ใบส่งของ"** | shippingAddress + PromptPay QR card + เลขบัญชีโอน |
| Sale (CASH_SALE) | `paymentType="CASH_SALE"` | **"ใบเสร็จรับเงิน"** | block "ชำระแล้ว" + ไม่มี QR (จ่ายแล้ว) |
| Receipt (`/admin/receipts`) | จาก `Receipt` entity | **"ใบเสร็จรับเงิน"** (จากการรับชำระบิลเชื่อ) | reference saleNo, paymentMethod, ยอดรับชำระ |

**Mapping ใน LIFF**:
- `/liff/orders/[id]/invoice` — สำหรับ Sale ใดก็ได้ → render ผ่าน `SharedSalesDeliveryPrintDocument` ส่ง props เดิมจาก `paymentType` → component เลือก title/block เอง
- `/liff/orders/[id]/receipt` — เปิดได้เฉพาะเมื่อ Sale มี Receipt ที่ link อยู่:
  - ถ้า `paymentType=CASH_SALE` → ใช้ `SharedSalesDeliveryPrintDocument` (รวมในตัว)
  - ถ้า `paymentType=CREDIT_SALE` + มี Receipt → ใช้ shared receipt print component (`SharedReceiptPrintDocument` ถ้ามี ไม่งั้นต้องเช็ค `app/admin/(protected)/receipts/[id]`)

**ห้ามทำ**:
- ❌ ห้ามสร้าง `LiffInvoicePrintDocument.tsx` หรือ `LiffReceiptPrintDocument.tsx` ใหม่ที่ duplicate logic
- ❌ ห้าม hardcode title "ใบแจ้งหนี้" หรือ "ใบเสร็จรับเงิน" ใน LIFF page
- ❌ ห้ามตัดสินใจ form variant ใหม่ใน LIFF ด้วย if/else — ต้องส่ง props ตามจริง แล้วให้ shared component ตัดสินเอง
- ❌ ห้าม hide block ไหนใน shared component (เช่น hide watermark, hide QR) — ถ้าจำเป็นจริงๆ ต้องเพิ่ม prop ใน shared component แล้วอัปเดตทุก consumer (sale + delivery + warranty claim + LIFF) พร้อมกัน

**ที่ต้องทำใน LIFF page**:
1. Server-side load Sale (พร้อม `paymentType`, `shippingAddress`, `items`, `customer`, `transferPrimaryAccount`, `printNotice`)
2. Verify `customer.id === currentLineCustomer.id` (security boundary — ห้ามดูใบของคนอื่น)
3. ส่ง props เข้า `<SharedSalesDeliveryPrintDocument>` ตรงๆ
4. wrap ด้วย `<PrintToPdfButton>` + watermark variant="LIFF_COPY"
5. ใส่ `@media screen` style ให้แสดงสวยในมือถือ + `@media print` ใช้ของเดิม

##### Receipt PDF — เคสที่ลูกค้าเปิดได้

| Sale paymentType | มี Receipt? | LIFF เปิดอะไรได้ |
|---|---|---|
| CASH_SALE | (มีในตัว) | `/liff/orders/[id]/invoice` แสดง "ใบเสร็จรับเงิน" |
| CASH_SALE | — | เหมือนข้างบน (ไม่มี receipt page แยก) |
| CREDIT_SALE | ยังไม่มี Receipt | `/liff/orders/[id]/invoice` แสดง "ใบแจ้งหนี้ / ใบส่งของ" + QR ชำระ |
| CREDIT_SALE | มี Receipt 1 ใบ | `/liff/orders/[id]/invoice` (ใบแจ้งหนี้) + `/liff/orders/[id]/receipt` (ใบเสร็จรับเงิน) |
| CREDIT_SALE | มี Receipt หลายใบ (ผ่อน) | `/liff/orders/[id]/invoice` + `/liff/orders/[id]/receipts/[receiptId]` (รายตัว) |

LIFF order detail แสดงรายการ receipt ทั้งหมดที่ link กับบิล + ปุ่มเปิดแต่ละใบ

##### Test Matrix — ต้อง verify ก่อน deploy

- [ ] ขายสด → `/liff/orders/[id]/invoice` title = "ใบเสร็จรับเงิน" ไม่มี QR
- [ ] ขายเชื่อยังไม่ชำระ → title = "ใบแจ้งหนี้ / ใบส่งของ" มี QR + บัญชีโอน
- [ ] ขายเชื่อชำระบางส่วน → ใบแจ้งหนี้ยังแสดง + มี Receipt 1 ใบให้เปิด
- [ ] ขายเชื่อชำระครบ → ใบแจ้งหนี้ยังเปิดได้ + Receipt ทุกใบเปิดได้
- [ ] เปิดบิลของลูกค้าอื่น → 403 / redirect (security)
- [ ] เปลี่ยนแปลงใน `SharedSalesDeliveryPrintDocument` → ต้อง reflect ทั้ง admin + LIFF พร้อมกัน

#### Files Touched
- `lib/tracking-url.ts` (ใหม่)
- `lib/verify-token.ts` (ใหม่ — HMAC sign/verify)
- `app/verify/[type]/[docNo]/page.tsx` (ใหม่ — public)
- หน้า print เดิม (sales/receipts) — เพิ่ม watermark + QR (เฉพาะ @media print)
- `components/liff/*` ตามที่ลิสต์ข้างบน

#### Phase 1B Checklist
- [x] `OrderStatusTimeline.tsx` + integrate ใน `/liff/orders/[id]`
- [x] `TrackingSmartLink.tsx` + map URL ทุก ShippingMethod
- [x] `lib/verify-token.ts` (HMAC) + env `DOC_VERIFY_SECRET`
- [x] `qrcode` package install
- [x] Watermark + QR ใน print stylesheet ของ sale/receipt เดิม (light + dark mode)
- [x] หน้า `/verify/[type]/[docNo]/[token]` public + i18n ไทย
- [x] หน้า `/liff/orders/[id]/invoice` + `/receipt` + ปุ่ม `PrintToPdfButton`
- [x] หน้า `/liff/warranties` + `/liff/warranties/[id]`
- [ ] Test ใน LINE app จริง (Android + iOS) ว่า Save as PDF ใช้ได้
- [x] AuditLog: `CUSTOMER_VIEW_INVOICE_PDF`, `CUSTOMER_VIEW_RECEIPT_PDF` (track usage)
- [ ] **Form variant test** — ขายสด/เชื่อ/เชื่อมี Receipt: title + block แสดงตรงกับ admin print 100%
- [x] **Reuse audit** — ตรวจว่า LIFF ใช้ `SharedSalesDeliveryPrintDocument` (และ shared receipt print component) ตรงๆ ไม่มี fork
- [ ] **Cross-customer security test** — ลูกค้า A เปิด URL ของลูกค้า B → 403
- [x] หน้า `/liff/outstanding` — รวมยอดค้าง + list บิลเรียงตามครบกำหนด + badge เกินกำหนด
- [x] Per-bill detail ครบ 6 บรรทัด (saleNo / saleDate / dueDate / grandTotal/netAmount / paid / amountRemain) — paid คำนวณจาก grandTotal - amountRemain
- [x] Payment channels block (text-only ไม่มี QR) — bank + PromptPay จาก `getPrimaryTransferAccount()`
- [x] Tap-to-copy เลขบัญชี + PromptPay ID + toast "คัดลอกแล้ว"
- [x] Empty state: ไม่มีบิลค้าง + ไม่มี primary transfer account → ข้อความ "ติดต่อร้าน"
- [x] หน้า `/liff/claims` + `/liff/claims/[id]` — list + timeline 4 จุด
- [x] Status / ClaimType i18n mapping (Thai labels) ใน `lib/warranty-claim-i18n.ts`
- [x] ซ่อนข้อมูลภายใน (supplier info, signature URL) ในฝั่ง LIFF
- [x] Test: ลูกค้าเห็นเฉพาะ claims ของตัวเอง (where `warranty.sale.customerId = currentCustomer.id`)

---

### Phase 1C — Customer Push Notifications

#### Schema เพิ่ม

```prisma
model LineCustomerNotification {
  id          String   @id @default(cuid())
  customerId  String
  customer    Customer @relation(fields: [customerId], references: [id])
  eventType   String   // sale.created, receipt.created
  entityType  String   // sale, receipt
  entityId    String   // saleId or receiptId
  status      String   // PENDING, SENT, FAILED, SKIPPED
  attempts    Int      @default(0)
  lastError   String?
  payload     Json     // Flex message JSON snapshot
  sentAt      DateTime?
  createdAt   DateTime @default(now())
  @@index([customerId, createdAt])
  @@index([status, createdAt])
  @@index([entityType, entityId])
}

model Customer {
  // เพิ่มจาก 1A:
  lineNotifications LineCustomerNotification[]
}
```

ไม่เพิ่ม `notifyOptIn` flag (decision: ไม่ทำ ข้อ 1)

#### Architecture: Event Hook Pattern

**ห้ามแก้** business logic ของ `sales/actions.ts`, `receipts/actions.ts` — เพิ่มเฉพาะ "side-effect call" ท้าย transaction:

```ts
// ใน sales/actions.ts หลัง create สำเร็จ (นอก transaction)
await enqueueCustomerNotification({
  eventType: "sale.created",
  saleId: sale.id,
});

// ใน receipts/actions.ts เช่นกัน
await enqueueCustomerNotification({
  eventType: "receipt.created",
  receiptId: receipt.id,
});
```

**`enqueueCustomerNotification`** จะ:
1. โหลด Sale/Receipt + Customer
2. ถ้า `customer.lineUserId` = null → INSERT row status=`SKIPPED` reason="not_linked" (เพื่อ audit)
3. ถ้ามี → INSERT row status=`PENDING` พร้อม Flex payload snapshot
4. Fire-and-forget dispatch (immediate try, ถ้า fail ปล่อยให้ cron retry)

**ข้อสำคัญ**: fail การ enqueue/push ห้ามทำให้ Sale/Receipt fail — wrap try-catch แยก

#### Dispatcher + Retry

- `lib/line-customer-notification.ts` — `enqueueCustomerNotification()`, `dispatchPending()`, `buildSaleFlexPayload()`, `buildReceiptFlexPayload()`
- Retry pattern reuse จาก `lib/line-daily-summary` retry helper เดิม (max 3 attempts, exponential backoff)
- Cron route `/api/internal/dispatch-line-customer-notifications` ทุก 5 นาที ดึง `PENDING` หรือ `FAILED + attempts<3` มา retry
- ใช้ QStash schedule เดียวกับ pattern ของ daily summary (signed)

#### Flex Message Templates (Visual Spec)

##### Color Palette (locked)

| Card Type | Header Hex | เงื่อนไข |
|---|---|---|
| `sale_paid` (CASH ชำระครบ) | `#22c55e` (เขียว) | `paymentMethod=CASH` + `amountRemain=0` |
| `sale_credit_pending` | `#f59e0b` (ส้มเหลือง) | `paymentMethod=CREDIT` |
| `sale_cod_pending` | `#14b8a6` (ฟ้าเขียว) | `fulfillmentType=DELIVERY` + `paymentMethod=CASH` + `amountRemain>0` |
| `receipt.created` | `#3b82f6` (น้ำเงิน) | ทุกใบเสร็จ |

##### Template selector logic

```ts
function pickSaleTemplate(sale): "sale_paid" | "sale_credit_pending" | "sale_cod_pending" {
  if (sale.paymentMethod === "CASH" && sale.amountRemain === 0) return "sale_paid";
  if (sale.paymentMethod === "CREDIT") return "sale_credit_pending";
  if (sale.fulfillmentType === "DELIVERY" && sale.paymentMethod === "CASH" && sale.amountRemain > 0) {
    return "sale_cod_pending";
  }
  return "sale_paid"; // default fallback
}
```

##### Card 1 — `sale_paid` (CASH ชำระครบ — ไม่มี QR)

```
┌─────────────────────────────────────┐
│ [HEADER เขียว #22c55e]              │
│ ✓  ขอบคุณสำหรับการสั่งซื้อ           │
├─────────────────────────────────────┤
│ เลขที่บิล    SO-20260504-0001       │
│ วันที่        4 พ.ค. 2026           │
│ รายการ       3 รายการ                │
│ ยอดรวม       ฿ 2,580.00             │
│ ชำระแล้ว ✓ เงินสด                    │
│ ─────────────────────────────────── │
│ [ปุ่มหลัก] ดูรายละเอียด →            │ ← LIFF deep link
└─────────────────────────────────────┘
```

##### Card 2 — `sale_credit_pending` (CREDIT — มี QR + เลขบัญชี + ครบกำหนด)

```
┌─────────────────────────────────────┐
│ [HEADER ส้มเหลือง #f59e0b]          │
│ ⚠️  รอชำระเงิน (เงินเชื่อ)           │
├─────────────────────────────────────┤
│ เลขที่บิล    SO-20260504-0001       │
│ วันที่        4 พ.ค. 2026           │
│ ─────────────────────────────────── │
│ ยอดที่ต้องชำระ                       │
│ ฿ 2,580.00 (font ใหญ่ เน้น)         │
│ 📅 ครบกำหนด 18 พ.ค. 2026           │
│ ─────────────────────────────────── │
│       [QR PromptPay 240x240]        │ ← Image จาก /api/public/qr/promptpay
│       สแกนเพื่อชำระเงิน              │
│ ─────────────────────────────────── │
│ หรือโอนเข้าบัญชี                     │
│ {bankName} เลขที่ {accountNo}       │
│ ชื่อบัญชี {accountName}              │
│ ─────────────────────────────────── │
│ หลังโอนเงินกรุณาส่งสลิป              │
│ ในแชทนี้ได้เลยค่ะ 📎                │
│ ─────────────────────────────────── │
│ [ปุ่มหลัก] ดูรายละเอียด →            │
└─────────────────────────────────────┘
```

##### Card 3 — `sale_cod_pending` (COD — มี QR + เลขบัญชี + badge เก็บปลายทาง)

```
┌─────────────────────────────────────┐
│ [HEADER ฟ้าเขียว #14b8a6]           │
│ 📦  รอจัดส่ง (เก็บเงินปลายทาง)       │
├─────────────────────────────────────┤
│ เลขที่บิล    SO-20260504-0001       │
│ วันที่        4 พ.ค. 2026           │
│ ─────────────────────────────────── │
│ ยอดเก็บปลายทาง                       │
│ ฿ 2,580.00 (font ใหญ่ เน้น)         │
│ 🚚 จัดส่งโดย {shippingMethod}        │
│ ─────────────────────────────────── │
│       [QR PromptPay 240x240]        │ ← optional แสดงเสมอ
│       สแกนเพื่อชำระเงินก่อนส่ง        │
│ ─────────────────────────────────── │
│ หรือโอนเข้าบัญชี (ก่อนจัดส่ง)         │
│ {bankName} เลขที่ {accountNo}       │
│ ชื่อบัญชี {accountName}              │
│ ─────────────────────────────────── │
│ หากชำระล่วงหน้า กรุณาส่งสลิป          │
│ ในแชทนี้ได้เลยค่ะ 📎                │
│ ─────────────────────────────────── │
│ [ปุ่มหลัก] ดูรายละเอียด →            │
└─────────────────────────────────────┘
```

##### Card 4 — `receipt.created` (ใบเสร็จ — สีน้ำเงิน ไม่มี QR)

```
┌─────────────────────────────────────┐
│ [HEADER น้ำเงิน #3b82f6]            │
│ ₿  ได้รับชำระเงินแล้ว                │
├─────────────────────────────────────┤
│ เลขที่ใบเสร็จ  RC-20260504-0001     │
│ วันที่          4 พ.ค. 2026          │
│ อ้างถึงบิล      SO-20260504-0001    │
│ ─────────────────────────────────── │
│ ยอดรับชำระ     ฿ 2,580.00           │
│ วิธีชำระ        เงินสด/โอน           │
│ ─────────────────────────────────── │
│ [ปุ่มหลัก] ดูใบเสร็จ →               │ ← `/orders/{saleId}/receipt`
└─────────────────────────────────────┘
```

##### PromptPay QR Endpoint (security)

- Route: `app/api/public/qr/promptpay/[saleId]/route.ts`
- Method: GET
- Query: `?t={hmacToken}` (token = HMAC-SHA256 of `{saleId}|{timestamp}` with `DOC_VERIFY_SECRET`, expires 24h)
- Logic:
  1. Verify HMAC token (reject ถ้าผิด/หมดอายุ)
  2. Load `Sale` + ตรวจ `amountRemain > 0` (ถ้าจ่ายครบไม่ออก QR)
  3. Load `getPrimaryTransferAccount()` → ถ้าไม่มี `promptPayId` → 404
  4. Call `buildPromptPayQrDataUrl(promptPayId, amountRemain)` แล้ว decode data URL → return PNG buffer
  5. Headers: `Content-Type: image/png`, `Cache-Control: public, max-age=300, immutable`
- ห้าม Server Action — Flex โหลด image ผ่าน HTTPS GET เท่านั้น

##### Bank Account Display Logic

- Card 2 + Card 3 ดึงจาก `getPrimaryTransferAccount()` (มีอยู่แล้วใน `lib/payment-qr.ts`)
- ถ้า `promptPayId = null` → ซ่อนส่วน QR ทั้งบล็อก แสดงแค่เลขบัญชี
- ถ้า `accountNo = null` → ซ่อนส่วนเลขบัญชี แสดงแค่ QR
- ถ้าทั้งสองว่าง → ซ่อนทั้งบล็อกชำระเงิน + แสดงข้อความ "กรุณาติดต่อร้านเพื่อรับวิธีชำระเงิน"

##### Slip Notification (decision: ใช้ข้อความในการ์ด ไม่มี upload page)

- Card CREDIT + COD ปิดท้ายด้วยข้อความ "หลังโอนเงินกรุณาส่งสลิปในแชทนี้ได้เลยค่ะ 📎"
- ลูกค้าส่งรูปสลิปกลับเข้า LINE OA chat ปกติ — admin เห็นใน LINE OA inbox
- ❌ ไม่มี `/liff/orders/{id}/notify-payment` page
- ❌ ไม่มี schema `PaymentNotification`
- ❌ ไม่ทำ webhook auto-process slip image (Phase 2+ ถ้าต้องการ)

##### Reuse จากระบบเดิม

- `lib/payment-qr.ts` — `buildPromptPayQrDataUrl()`, `getPrimaryTransferAccount()`
- `lib/cash-bank-primary-transfer.ts` — `getTransferDocumentState()`
- Pattern Flex jsonจาก `lib/line-daily-summary.ts` (Flex container/box/text/separator)
- ห้าม fork helper เดิม — ใช้ตรงๆ

#### Admin UI เพิ่ม

**ข้อ 6 — Test Send**
- ในหน้า admin `/admin/sales/[id]` และ `/admin/receipts/[id]`: ปุ่ม **"ทดสอบส่ง LINE (admin)"** — ส่งไปที่ LINE userId ของ admin คนกด (จาก mapping เดิม) ไม่ใช่ลูกค้า
- ใช้ Flex payload ตัวจริง — preview ก่อน push ลูกค้า

**ข้อ 8 — Re-send Button**
- ในหน้า admin `/admin/sales/[id]` + `/admin/receipts/[id]`: ปุ่ม **"ส่ง LINE แจ้งลูกค้าซ้ำ"**
- ตรวจ permission `sales.notify` / `receipts.notify` (ใหม่)
- เรียก `enqueueCustomerNotification` อีกครั้ง แต่ status= `PENDING` ใหม่ (สร้าง row ใหม่ ไม่ทับเดิม — เก็บ history)
- AuditLog action: `customer.line_notification_resend`

#### Permissions ใหม่ (ตาม .rules §8 — 5 steps)
- `customer_notifications.view` — ดู history (admin)
- `sales.notify` — กด re-send LINE จากใบขาย
- `receipts.notify` — กด re-send LINE จากใบเสร็จ
- เพิ่มใน `PERMISSION_CATALOG` + `STAFF_OPERATIONS_PERMISSIONS`
- ไม่ต้องเพิ่ม route rule (ไม่มี menu แยก) — Phase 1C ยังไม่มี notification history page

#### Phase 1C Checklist
- [ ] Schema: `LineCustomerNotification` + `prisma db push`
- [ ] LINE plan upgrade Light 1,200 บาท/เดือน (user ต้องทำเอง)
- [ ] `lib/line-customer-notification.ts` (enqueue, dispatch, payload builders, retry)
- [ ] `lib/line-customer-flex-templates.ts` — Flex JSON sale/receipt
- [ ] Hook ใน `app/admin/(protected)/sales/actions.ts` (create only — ไม่แตะ update/cancel)
- [ ] Hook ใน `app/admin/(protected)/receipts/actions.ts` (create only)
- [ ] Cron route `/api/internal/dispatch-line-customer-notifications` + QStash schedule
- [ ] Test send button ใน sale + receipt detail page (admin)
- [ ] Re-send button ใน sale + receipt detail page (admin)
- [ ] Permission keys + permission checks ใน Server Actions
- [ ] AuditLog: `customer.line_notification_sent`, `customer.line_notification_resend`, `customer.line_notification_failed`
- [ ] LIFF deep link routing ทำงาน (`liff.line.me/{liffId}/orders/{id}` → เปิดหน้า detail ทันที)
- [ ] E2E test: สร้างใบขาย CASH → ตรวจ LINE ลูกค้าได้ Flex
- [ ] E2E test: รับชำระ → ตรวจได้ Flex อันที่สอง
- [ ] Failure mode test: ลูกค้าที่ยังไม่ link → row status=SKIPPED, ไม่มี error
- [ ] Retry test: mock LINE API fail → cron retry สำเร็จในรอบถัดไป

---

### Out of Scope ทั้ง Phase 1 (1A + 1B + 1C)

- ❌ Push event อื่นๆ นอกเหนือจาก sale.created + receipt.created (shipping, cancel, warranty)
- ❌ Notification opt-in/opt-out UI (decision: ไม่ทำ)
- ❌ Bundled/debounced push (decision: ไม่ทำ)
- ❌ Webhook auto-confirm delivery จากลูกค้า (decision: ไม่ทำ — Phase 2+)
- ❌ Server-side PDF generator (decision: Option C ใช้ browser print)
- ❌ LIFF cart / checkout / payment
- ❌ Quote request flow
- ❌ Admin UI สำหรับ unlink LINE จาก customer (Phase 2)
- ❌ Rich Menu (Phase 2)
- ❌ ย้าย OTP provider ไป ThaiBulkSMS (Phase 2 ถ้า volume สูง)

### Cost Summary (Final)

| Phase | LINE | Firebase | PDF | รวม/เดือน |
|---|---|---|---|---|
| 1A | 0 (Communication) | 0 (Spark) | — | **0 บาท** |
| 1B | 0 (Communication) | 0 (Spark) | 0 (browser print) | **0 บาท** |
| 1C | 1,200 (Light) | 0 (Spark) | 0 | **1,200 บาท** |

ค่าใช้จ่ายครั้งเดียว: 0 (Firebase + LINE สมัครฟรี, ไม่ต้องเติม credit)

### Cross-Machine Continuity Notes (อัปเดต — สำหรับ AI ตัวอื่น)

10. **Phase ลำดับ**: ต้องเสร็จ 1A ก่อน 1B ก่อน 1C — ห้าม jump
11. **Push events lock**: เฉพาะ `sale.created` + `receipt.created` เท่านั้น ห้ามเพิ่ม event อื่นโดยไม่ถาม user
12. **PDF lock**: Option C (browser print) เท่านั้น — ห้ามติดตั้ง `@react-pdf/renderer`, `puppeteer`, `chromium` โดยไม่ถาม user
13. **No opt-in UI**: ห้ามเพิ่ม notification preference toggle (decision ลงไว้ชัด)
14. **LINE plan upgrade เป็น blocker ของ Phase 1C** — ห้าม deploy 1C จนกว่า user ยืนยัน upgrade Light plan
15. **Event hook pattern**: ห้ามแทรก push call ใน transaction ของ Sale/Receipt — ต้องอยู่หลัง commit, wrap try-catch แยก, fail การ push ต้องไม่ทำให้ business mutation fail
16. **Re-send สร้าง row ใหม่** ไม่ทับเดิม (เก็บ history audit)
17. **Verify token secret** `DOC_VERIFY_SECRET` ต้องเป็น random 32+ chars, server-side only

## Roadmap Update (2026-05-04 LIFF Phase 1 — Final Decisions ทับล่าสุด)

> **สำคัญ**: Section นี้ทับและแก้ไข decisions ทั้งหมดที่ขัดแย้งใน 2 Roadmap Update ก่อนหน้า (LIFF Mini-App Phase 1 MVP + LIFF Phase 1 Scope Expansion) — ถ้ามีข้อขัดแย้ง ให้ใช้ section นี้เป็นหลัก ตัด section ก่อนเป็น historical context
>
> สถานะ: **Phase 1A + 1B = ทำตามแผน, Phase 1C = DEFERRED ยังไม่ทำ** (2026-05-04)

### Final Decisions (override ทุก decision ก่อนหน้า)

| # | เรื่อง | Decision Final | เหตุผล |
|---|---|---|---|
| 1 | **OTP** | ❌ ไม่มี OTP เลย (Option A) | LINE userId เป็น identity, phone lookup ตรงๆ — security ระดับเดียวกับ LINE OTP แต่เร็วกว่า ฟรีกว่า |
| 2 | **Firebase** | ❌ ไม่ใช้ ลบทั้งหมดจาก plan | ไม่ต้อง phone auth |
| 3 | **Mapping flow** | LINE userId → ไม่มี link → กรอกเบอร์ 1 ช่อง → resolve 4 case | ไม่มี OTP step, register/auto-link ทันที |
| 4 | **Phase 1C (Push notifications)** | 🟡 **DEFERRED** ไม่ทำในรอบนี้ | รอประเมินอีกครั้งเมื่อ user พร้อม + ยืนยัน LINE plan |
| 5 | **LINE plan** | Communication ฟรี (ใช้แค่ daily summary admin เดิม) | Phase 1A+1B ไม่ใช้ push ลูกค้า |
| 6 | **Background dispatch** | ใช้ `waitUntil()` + popup admin หาก fail (ไม่มี cron retry) | Phase 1C เท่านั้น — ตอนนี้ defer |
| 7 | **Preview workflow** | Vercel alias `liff-preview.yourshop.com` → branch `develop` (fix ครั้งเดียวใน LINE/Firebase console) | ไม่ต้อง Firebase แล้ว แต่ LINE LIFF endpoint ยังต้องคงที่ |

### Mapping Flow (แทนที่ flow เดิม)

```
เปิด LIFF → liff.init() → liff.getProfile() → ได้ LINE userId
  │
  ├─ Customer.lineUserId = userId มีอยู่แล้ว?
  │     YES → เข้าระบบเลย (0 step)
  │     NO  ↓
  │
  กรอกเบอร์โทร (1 ช่องเดียว) → normalize เป็น format เดียว
  │
  Server lookup Customer by phone:
  │
  ├─ พบ Customer + lineUserId = null
  │     → set lineUserId, lineLinkedAt
  │     → AuditLog action="customer.line_link"
  │     → เข้าระบบ  [Case A: ลูกค้าเก่า link สำเร็จ]
  │
  ├─ พบ Customer + lineUserId = อื่น
  │     → REJECT แสดงข้อความ "เบอร์นี้ผูก LINE อื่นแล้ว ติดต่อร้าน"
  │     → AuditLog action="customer.line_link_blocked"  [Case B: กันสวมรอย]
  │
  ├─ ไม่พบ Customer
  │     → สร้าง Customer ใหม่ (name=liff.getProfile().displayName, phone, source="LINE_LIFF")
  │     → set lineUserId, lineLinkedAt
  │     → AuditLog action="customer.line_register"  [Case C: ลูกค้าใหม่]
  │
  └─ พบ Customer หลายราย (เบอร์ซ้ำ — ไม่มี data ตอนนี้ แต่กันไว้)
        → REJECT "พบบัญชีหลายรายการ ติดต่อร้าน"
        → AuditLog action="customer.line_link_ambiguous"  [Case D]
```

**Security note**: ระดับเดียวกับ LINE OTP — ลูกค้ากรอกเบอร์ใครก็ได้ แต่ Block สวมรอย (Case B) ป้องกันการยึดบัญชีเดิม สำหรับ MVP รับความเสี่ยงนี้ได้ — Phase 2 ค่อยเพิ่ม magic link จาก admin สำหรับ VIP

### ลบจาก plan เดิม (ห้าม implement)

จาก Roadmap Update ก่อน — ส่วนต่อไปนี้ **ยกเลิกทั้งหมด ห้าม implement**:

- ❌ Firebase project + Phone Auth setup
- ❌ Env vars: `NEXT_PUBLIC_FIREBASE_*`, `FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON`
- ❌ ไฟล์: `lib/firebase-admin.ts`, `lib/firebase-client.ts`, `lib/phone-normalize.ts` (ย้ายเป็น helper เล็กๆ ใน `lib/liff-customer.ts` แทน), `lib/otp-rate-limit.ts`, `lib/sms-provider.ts`
- ❌ Components: `OtpVerifyForm.tsx`
- ❌ API: `app/api/liff/verify-otp/route.ts` (ใช้ `verify-link` แทน)
- ❌ Schema: `OtpChallenge` table
- ❌ AuditLog: `customer.line_link_blocked` (ของเดิม) → คง รวมกับ Case B แล้ว

### File Structure ปรับใหม่ (Phase 1A)

```
app/liff/
  layout.tsx
  page.tsx                            # landing — auto route
  link/page.tsx                       # หน้ากรอกเบอร์ + resolve 4 case
  orders/page.tsx
  orders/[id]/page.tsx
  orders/[id]/invoice/page.tsx             # customer PDF/print — reuse shared admin print document
  orders/[id]/receipt/page.tsx             # customer PDF/print — reuse shared admin print document
  profile/page.tsx
  loading.tsx (ทุก segment)

components/liff/
  LiffProvider.tsx
  LiffGate.tsx
  LinkPhoneForm.tsx                   # 'use client' — ช่องเดียว ส่งเบอร์ไปเช็ค
  ContactShopButton.tsx               # ปุ่มลอย "ติดต่อร้าน" — เรียก liff.closeWindow()
  WelcomeScreen.tsx                   # onboarding ครั้งแรก (ตามข้อ 6)

lib/
  liff-auth.ts                        # verifyLiffIdToken() — server-side
  liff-customer.ts                    # resolve / link / register (4 case) + phone normalize helper

app/api/liff/
  verify-link/route.ts                # POST: รับ phone + LIFF ID token → resolve case A/B/C/D
```

### Env Vars ปรับใหม่

```
# LINE Login channel — สำหรับ LIFF
NEXT_PUBLIC_LINE_LIFF_ID=xxxx-xxxxxxxx
LINE_LIFF_CHANNEL_ID=xxxxxxxxxx

# Document verify (Phase 1B watermark + QR ตรวจสอบ)
DOC_VERIFY_SECRET=<random 32+ chars>

# (ตัด Firebase ทั้งหมด)
```

### Phase 1A Checklist (แทนที่ checklist เดิม)

#### Foundation
- [x] สร้าง LINE Login channel + LIFF app (Endpoint = `https://liff-preview.yourshop.com/liff` สำหรับ test, `https://yourshop.com/liff` สำหรับ production — สร้าง 2 LIFF apps แยก dev/prod)
- [x] ตั้ง Vercel alias `liff-preview.yourshop.com` → branch `develop`
- [x] เพิ่ม env: `NEXT_PUBLIC_LINE_LIFF_ID`, `LINE_LIFF_CHANNEL_ID`, `DOC_VERIFY_SECRET` + อัปเดต `.env.example`
- [x] Schema: `Customer.lineUserId` + `lineLinkedAt` + `source String @default("ADMIN")` (ค่า `ADMIN`, `LINE_LIFF`) + `Customer.phone @unique` + `prisma db push` (ไม่ต้องมี `phoneVerified` field แล้ว)
- [x] AuditLog actions: `customer.line_link`, `customer.line_register`, `customer.line_link_blocked`, `customer.line_link_ambiguous`

#### Core Libraries
- [x] `lib/liff-auth.ts` — verify LIFF ID token (POST `https://api.line.me/oauth2/v2.1/verify`)
- [x] `lib/liff-customer.ts` — phone normalize + resolve 4 case + AuditLog
- [x] `lib/customer-phone.ts` — helper กลางบังคับ format เบอร์ลูกค้าเป็น `081-234-5678` ใช้ร่วมกันทั้ง admin และ LINE_LIFF
- [x] `lib/liff-session.ts` + `lib/liff-data.ts` — signed httpOnly LIFF customer session หลัง verify LINE token แล้ว เพื่อให้ Server Components query ได้โดยไม่ expose identity ฝั่ง client ซ้ำ

#### LIFF Pages
- [x] `app/liff/layout.tsx` — Server shell + LiffProvider + ContactShopButton + noindex meta
- [x] `components/liff/WelcomeScreen.tsx` — onboarding 1 ครั้งแรก (3 bullet: ดูบิล/เช็คประกัน/ใบเสร็จ + ปุ่มเริ่ม) + flag `liff_onboarded` ใน localStorage
- [x] `components/liff/ContactShopButton.tsx` — ปุ่มลอยทุกหน้า เรียก `liff.closeWindow()` + (option) `liff.sendMessages()` ส่งข้อความเข้า OA chat
- [x] `app/liff/link/page.tsx` + `LinkPhoneForm` — กรอกเบอร์ 1 ช่อง
- [x] `app/liff/page.tsx` — landing route ตาม link state
- [x] `app/liff/orders/page.tsx` + `[id]/page.tsx` — list + detail (read-only)
- [x] `app/liff/orders/[id]/invoice/page.tsx` + `receipt/page.tsx` — บันทึก PDF/print โดย reuse shared admin print primitives และ verify customer ownership ก่อน render
- [x] Remove LIFF product search screen/query; old `/liff/products` redirects to public `/products`
- [x] `app/liff/profile/page.tsx` — แสดงข้อมูลลูกค้า + ปุ่ม unlink (option Phase 2)
- [x] `loading.tsx` ทุก segment

#### API
- [x] `app/api/liff/verify-link/route.ts` — POST: ตรวจ LIFF ID token + phone → resolve 4 case → AuditLog → return result
- [x] `app/api/liff/session/route.ts` — POST: ตรวจ LIFF ID token → set signed customer session เมื่อมี link แล้ว
- [x] Server Actions/Server reads ของ `/liff/*` ทุก action verify LIFF session + customer ownership

#### Admin Customer Visibility
- [x] หน้า `/admin/customers` แสดง badge แยกลูกค้าที่ `source = LINE_LIFF` เช่น "สมัครผ่าน LINE" และ badge "ผูก LINE แล้ว" เมื่อมี `lineUserId`
- [x] หน้า `/admin/customers` เพิ่ม filter หรือ quick filter สำหรับ "ลูกค้าจาก LINE" โดยใช้ shared `AdminSearchForm` + `AdminSearchSubmitButton` pattern เพื่อให้พนักงานตามตรวจข้อมูลได้ง่าย
- [x] หน้า customer detail/edit แสดงสถานะ `lineLinkedAt` + แหล่งที่มาลูกค้า และยังแก้ไขข้อมูลลูกค้าปกติได้เหมือนเดิม
- [x] UI admin ที่เพิ่มต้องตรวจทั้ง light mode และ dark mode ในรอบเดียวกัน
- [x] หน้า admin customer create/edit บังคับ format เบอร์โทรเดียวกับ LINE_LIFF เป็น `081-234-5678` และ server normalize ก่อนบันทึกเสมอ
- [x] เพิ่มตัวบ่งชี้ "ข้อมูลยังไม่ครบ" แบบ derived จาก field สำคัญที่มักต้องให้พนักงานเติม เช่น ที่อยู่จัดส่ง / เลขภาษี / creditTerm (ไม่ต้องเก็บเป็น field ถาวรถ้า derive ได้)
- [x] ลูกค้าใหม่จาก LIFF ต้องสร้างเป็น `Customer` ปกติ ไม่แยกตาราง เพื่อให้ sale/receipt/admin workflow เดิมใช้งานต่อได้ทันที

#### Security
- [x] ทุก customer query มี `where: { customerId: customer.id }` เสมอ
- [x] Rate limit phone lookup: 5 ครั้ง/LINE userId/ชั่วโมง (กัน brute force scan ฐานข้อมูลลูกค้า)
- [x] LIFF page noindex meta + ไม่ expose admin route

#### UI/UX
- [x] Light + dark mode ครบ
- [x] Mobile-first, ใช้ `formatDateThai` (Gregorian)
- [x] Onboarding screen ดีไซน์สากล (illustration / icon + ข้อความสั้น + ปุ่ม CTA เดียว)
- [x] Contact shop button ลอย bottom-right ทุกหน้า

#### Implementation Progress (2026-05-04)
- [x] Phase 1A foundation slice implemented: Prisma schema + generated client + DB push completed
- [x] Customer phone uniqueness/format slice implemented: `Customer.phone @unique`, shared phone normalizer, admin + LINE_LIFF use `081-234-5678`
- [x] LIFF MVP routes added: `/liff`, `/liff/link`, `/liff/orders`, `/liff/orders/[id]`, `/liff/profile`; product browsing stays on public `/products`
- [x] Phase 1B read-only routes added: `/liff/outstanding`, `/liff/warranties`, `/liff/warranties/[id]`, `/liff/claims`, `/liff/claims/[id]`
- [x] LIFF order detail upgraded with status timeline + tracking smart link
- [x] Phase 1B print/PDF invoice/receipt routes added: `/liff/orders/[id]/invoice`, `/liff/orders/[id]/receipt`, and `components/liff/PrintToPdfButton.tsx`; both reuse shared print primitives and keep admin print logic untouched
- [x] Shared print documents now show derived status stamp: `เอกสารถูกยกเลิกแล้ว` for cancelled sale/receipt documents, and `ชำระเงินแล้ว` for active credit-sale documents with `amountRemain <= 0`
- [x] Phase 1B document verify watermark/QR token added: `lib/verify-token.ts`, `/verify/[type]/[docNo]/[token]`, print-only watermark/QR mark, admin original variant, LIFF copy variant
- [x] LIFF loading states completed for every route segment with shared `components/liff/LiffPageLoading.tsx`
- [x] LIFF outstanding payment channel now supports tap-to-copy account no / PromptPay without extra query
- [x] AuditLog actions added for LIFF PDF views: `CUSTOMER_VIEW_INVOICE_PDF`, `CUSTOMER_VIEW_RECEIPT_PDF`
- [x] LIFF dark-mode polish completed with scoped `LiffThemeProvider` + root CSS overrides, while keeping `print-document-root` previews in light document mode
- [x] Customer LINE admin visibility added in list/detail/edit without changing existing sale/receipt/stock logic
- [x] LIFF hardening update (2026-05-05): phone lookup rate limit moved from per-process memory to persistent `LoginThrottle` keys, LINE token verify now has timeout, `verify-link` returns only safe customer-facing errors, and `LiffProvider` no longer re-verifies session on every route navigation
- [x] LIFF bottom nav now includes a dedicated `เคลม` menu to `/liff/claims`, while warranties still expose a "ดูประวัติเคลมทั้งหมด" shortcut for discoverability
- [x] LIFF UX polish (2026-05-05): contact button moved above bottom nav, bottom nav supports mobile safe-area + stronger active state, `/liff/claims` adds status tabs, and `/liff/warranties` adds active/expired/all tabs
- [x] LIFF UX polish (2026-05-06): profile incomplete-data notice now directs customers to contact staff for personal-data edits, LIFF status tabs show immediate loading feedback while filters navigate, the LIFF customer portal was restyled to match the blue/white rich-menu theme across shell, headers, cards, bottom nav, loading, onboarding, print toolbars, and key list/detail pages, and the orders dashboard summary now keeps only bill/outstanding cards
- [x] LIFF production performance fix (2026-05-06): added customer-facing indexes for Sale/SaleItem/Warranty queries and reduced `/liff/orders` relation counts so linked customers with existing history do not stay on the loading skeleton
- [x] LIFF/admin mobile stability fix (2026-05-06): LIFF refreshes Server Components after session sync so newly-set cookies are read consistently across devices, and mobile delivery queue no longer intercepts touch scrolling with custom pull-to-refresh handlers
- [x] Admin delivery proof + LIFF warranty status fix (2026-05-06): delivery proof uploads now tolerate phone camera/compressed image filenames by deriving storage extension from image content type, the mobile proof button is more prominent, and LIFF warranty claim history now uses the same customer-facing `REPLACE_NOW` status logic as the claim pages
- [x] LIFF document PDF UX fix (2026-05-06): customer order document links now say `ดู/บันทึก...` instead of implying instant download, cash-sale duplicate receipt actions were collapsed to one document entry, and print-preview buttons open the document in an external browser from LINE before saving/printing PDF
- [x] LIFF external PDF access fix (2026-05-06): external-browser print links now use short-lived signed document tokens instead of reopening the LIFF URL, so Safari/Chrome can render the print form without losing LIFF session and falling into LINE Login
- [x] LIFF external PDF gate fix (2026-05-06): `LiffProvider` now skips LIFF SDK login only for signed `printToken` document URLs, preventing Safari/Chrome external print pages from redirecting to `access.line.me`
- [x] LIFF external PDF print-form fix (2026-05-06): signed `printToken` document pages now suppress LIFF onboarding/contact overlays, force light/white document colors, and render print forms on an A4-sized root to prevent Android print preview from splitting the document background across two pages
- [x] LIFF order timeline status polish (2026-05-06): delivery orders now show `รอจัดส่ง` before `กำลังจัดส่ง`, and the shipping info label for pending delivery now uses the same customer-facing wording
- [x] Admin mobile delivery item UX + LIFF print dark-mode follow-up (2026-05-06): mobile delivery cards now show a compact product summary with expandable full item details including unit price, total, quantity, unit, and lots; LIFF print CSS now uses `color-scheme: only light` and `forced-color-adjust: none` to resist Android/browser forced darkening in print preview
- [x] LIFF print token theme fix (2026-05-06): `LiffThemeProvider` now forces signed `printToken` pages to light-only mode at the root and suppresses dark LIFF wrapper backgrounds before Android/browser print preview captures the page
- [x] LIFF external print isolation fix (2026-05-06): external PDF links now open signed `/liff-print/orders/...` routes outside the LIFF shell, force white/light print rendering without onboarding/contact overlays, and shrink the A4 content box to 198mm x 285mm with safe print margins to avoid iPhone blank page 2 overflow
- [x] Verification: `npx tsc --noEmit` pass, targeted LIFF lint pass, `npm run build` pass
- [x] Full `npm run lint` ผ่านแล้วในระดับ error (2026-05-07): แก้ React Compiler rule `react-hooks/set-state-in-effect` ใน `components/shared/QuickSearchLauncher.tsx`, `components/liff/ContactShopButton.tsx`, `components/liff/PrintToPdfButton.tsx`; ยังเหลือ warning เดิมกระจายหลายไฟล์ซึ่งไม่บล็อก lint
- [x] Carrier tracking refresh (2026-05-08): runtime labels now show KEX instead of Kerry while preserving the legacy `KERRY` enum value, LIFF/admin delivery links use the updated KEX and Flash tracking URLs from `lib/shipping.ts`, mobile delivery cards can open carrier tracking from the tracking field, and storefront carrier copy now says KEX / Flash / J&T.
- [x] Thailand Post carrier option (2026-05-08): added `THAILAND_POST` shipping method for admin sale/delivery flows, central tracking link to `track.thailandpost.co.th`, LIFF/admin tracking support, and storefront copy including ไปรษณีย์ไทย.

### Phase 1B Checklist (คงเดิม + เพิ่ม)

ใช้ checklist เดิมจาก section "Phase 1B" ก่อนหน้า + เพิ่ม:
- [x] หน้า `/liff/outstanding` (ตามที่ระบุไปแล้ว)
- [x] หน้า `/liff/claims` + `[id]` (ตามที่ระบุไปแล้ว)
- [x] Order detail แสดง "ประวัติการชำระเงิน" — list `ReceiptItem[]` ที่ link กับ saleId เรียงตาม `Receipt.receiptDate` แบบย่อ (วันที่, ยอด, methodชำระ, ปุ่มดูใบเสร็จ) — รายละเอียดน้อยกว่า admin
- [x] Order detail แสดง Receipt ที่ถูกยกเลิกพร้อม badge "ยกเลิก" + เหตุผล (ใช้ `Receipt.cancelNote`) — กันลูกค้า confused
- [x] Order detail เพิ่ม card "เอกสารของฉัน" สำหรับเปิดใบแจ้งหนี้/ใบส่งของ/ใบเสร็จและบันทึกเป็น PDF จากมือถือ
- [x] หน้า PDF/print ฝั่งลูกค้าตรวจ `customerId` จาก LIFF session ทุกครั้งก่อน query เอกสาร และไม่ expose admin route
- [x] LIFF claim customer timeline: `claimType = REPLACE_NOW` แสดงจบที่ "เปลี่ยนสินค้าแล้ว" เพราะถือว่าลูกค้าได้รับสินค้าแล้ว โดยไม่กระทบ admin claim workflow เดิม
- [x] LIFF claim visibility polish (2026-05-07): ซ่อนเคลมที่ยกเลิกจากหน้าลูกค้า, คงกฎ `REPLACE_NOW` ให้จบสำหรับลูกค้าทันที, และแสดงกรณี supplier ไม่รับเคลมเป็นสถานะ/ไทม์ไลน์ที่ชัดขึ้น โดยไม่เปิด claim stock movement หรือ CN purchase ให้ฝั่งลูกค้าเห็น
- [x] Watermark/QR ตรวจสอบเอกสารด้วย `DOC_VERIFY_SECRET` สำหรับเอกสาร admin/LIFF print/PDF โดยไม่ fork shared print layout
- [x] Payment channels block เพิ่มปุ่ม copy เลขบัญชี + PromptPay พร้อมข้อความ `คัดลอกแล้ว`

### Phase 1C — DEFERRED (เก็บไว้ทำในอนาคต)

> **สถานะ**: ยังไม่ทำในรอบนี้ — ทุก spec ใน section "Phase 1C — Customer Push Notifications" ก่อนหน้า **คงไว้เป็น reference** สำหรับ resume งานในอนาคต ไม่ลบ

**เงื่อนไขที่ต้องครบก่อน start Phase 1C ในอนาคต**:
1. User ยืนยัน upgrade LINE plan Light 1,200 บาท/เดือน
2. ประเมินยอดขายปัจจุบัน + คาดการณ์ push volume ใหม่
3. POC test Flex card บน LINE OA จริง (ส่ง test ไป admin ดูสวย)
4. ตัดสินใจ: ทำ Bundle / Opt-in / Cancel push อีกครั้ง (ตอนนี้ทุกข้อ "ไม่ทำ")

**สิ่งที่จะเปลี่ยนเมื่อ Phase 1C เริ่ม** (จากที่ตอบรอบนี้):
- Background dispatch: ใช้ `waitUntil()` (ไม่มี cron retry)
- Failure UX: popup สีแดงในหน้า admin "ส่ง LINE ไม่สำเร็จ" + ปุ่ม "ส่งใหม่" (toast/dialog ทันที, ไม่ใช่ silent log)
- Notification status badge ทุก row ใน sale/receipt list (icon เขียว=sent, แดง=failed, เทา=skipped)
- Re-send button ในหน้า detail (เดิม)

**Spec ของ Flex card (4 templates)** + **PromptPay QR endpoint** + **Permission keys** ใน Phase 1C section ก่อนหน้า — **คงไว้ทั้งหมด** สำหรับ implement ในอนาคต

### Database Date/Time Standard (2026-05-08)

- New Prisma `DateTime` fields must explicitly use `@db.Timestamptz(3)` unless the user approves a narrow exception.
- Date-only document fields, claim dates, report ranges, and business day calculations must parse/format through `lib/th-date.ts`.
- Do not add bare `DateTime`, PostgreSQL `timestamp without time zone`, manual `setHours`/`setDate`, or `toISOString().slice(...)` date formatting for Thailand business dates.

### Cost Summary (Final — รอบนี้)

| Phase | Cost/เดือน | สถานะ |
|---|---|---|
| **1A** | **0 บาท** | จะทำ |
| **1B** | **0 บาท** | จะทำต่อจาก 1A |
| 1C | +1,200 บาท (Light plan) | **DEFERRED** |

ค่าใช้จ่าย one-time: 0 บาท

### Cross-Machine Continuity Notes (อัปเดต — สำหรับ AI ตัวอื่น)

ลบข้อ 14 เดิม + เพิ่ม:

18. **Decision tree priority**: ถ้า PLAN.md มี 2 section ที่ขัดแย้งกัน ให้เชื่อ section ที่เขียนทีหลัง (ตามวันที่ใน header) — section "Final Decisions" 2026-05-04 ทับ section "Scope Expansion" 2026-05-04 ก่อนหน้า
19. **No Firebase**: ห้ามติดตั้ง `firebase`, `firebase-admin`, ห้ามใช้ Phone Auth ในรอบนี้
20. **Phase 1C DEFERRED**: ห้ามเริ่ม Phase 1C จนกว่า user สั่ง — push notification ห้ามทำใน Phase 1A/1B
21. **Phone lookup security**: ระดับ Option A — ยอมรับว่าไม่ verify phone ownership, ป้องกันแค่สวมรอย (Case B) + brute force (rate limit)
22. **Vercel alias preview workflow**: `liff-preview.yourshop.com` ชี้ไป branch `develop` — feature branch อื่น test LIFF ไม่ได้ ต้อง merge develop ก่อน
23. **2 LIFF apps แยก**: dev = `liff-preview.yourshop.com/liff`, prod = `yourshop.com/liff` — มี `NEXT_PUBLIC_LINE_LIFF_ID` คนละค่า ใช้ Vercel env per-environment
24. **Receipt cancel UX**: ไม่ push noti (Phase 1C decision เดิม) แต่หน้า LIFF order detail แสดง badge "ยกเลิก" + เหตุผลให้ลูกค้าเห็น — กัน confused
25. **Onboarding screen**: แสดงครั้งแรกเท่านั้น เก็บ flag `liff_onboarded` ใน localStorage — ห้าม block ลูกค้าที่เคยใช้แล้ว
26. **Admin visibility for LINE customers**: ลูกค้าใหม่ที่สมัครผ่าน LIFF ต้องเป็น `Customer` ปกติพร้อม `source = LINE_LIFF`, แสดง badge/filter ใน admin, และให้พนักงานแก้ข้อมูลเพิ่มเติมได้จาก customer edit flow เดิม
27. **No LIFF product catalog**: ตัดเมนู/หน้าค้นหาสินค้าออกจาก LIFF; `/liff/products` ต้อง redirect ไป public `/products` และห้าม query สินค้าใน LIFF เพื่อใช้หน้าจอ catalog แยก

---

## Phase 8 — Delivery Tracking (GPS + LIFF Real-time)

> **สถานะ**: ✅ Implemented — 2026-05-12
>
> ระบบติดตามการจัดส่งแบบ real-time ด้วย GPS + Leaflet + OpenStreetMap + OSRM (ฟรีทั้งหมด) โดยไม่ใช้ WebSocket หรือ Firebase

### Architecture Overview

```
Driver (Staff) — หน้า /admin/delivery/update (mobile)
  ↓ browser Geolocation API
  ↓ Server Action: updateDriverLocationAction()
  ↓ upsert DeliveryTracking (lat/lon/accuracy per saleId)

Customer (LINE)
  → เปิด /liff/tracking/{token}
  → SSR initial render + Nominatim geocode
  → Client poll GET /api/liff/tracking/{token} ทุก 3 นาที
  → อัปเดต Leaflet marker.setLatLng() เท่านั้น — map ไม่ flicker
```

### Database Schema

- [x] เพิ่ม model `DeliveryTracking` — `saleId @unique`, `latitude`, `longitude`, `accuracy`, `updatedAt @db.Timestamptz(3)`
- [x] เพิ่ม `Sale.trackingToken String? @unique` — UUID สำหรับ customer tracking link
- [x] เพิ่ม `Sale.trackingExpiry DateTime? @db.Timestamptz(3)` — หมดอายุ 48 ชั่วโมงหลัง DELIVERED
- [x] เพิ่ม `User.phone String?` — เบอร์โทรพนักงานส่ง แสดงใน LIFF tracking page
- [x] `prisma db push` + `prisma generate` ผ่านสำเร็จ

### Utility Library (`lib/delivery-tracking.ts`)

- [x] `generateTrackingToken()` → `crypto.randomUUID()`
- [x] `haversineDistance(lat1, lon1, lat2, lon2)` → ระยะทางกิโลเมตร
- [x] `isNearby(driverLat, driverLon, destLat, destLon)` → `true` ถ้า ≤ 2 กม.
- [x] `isStale(updatedAt)` → `true` ถ้าไม่มี update เกิน 30 นาที
- [x] `shouldRecalcRoute(prev, new)` → `true` ถ้า driver เคลื่อนที่ > 100 เมตร
- [x] `isTrackingExpired(trackingExpiry)` → เช็ค token หมดอายุ
- [x] `fetchOsrmRoute()` → OSRM public API, return `coordinates[]`, `durationSeconds`, `distanceMetres`
- [x] `geocodeAddress()` → Nominatim (OSM) แปลง address → lat/lon สำหรับ destination pin
- [x] `formatEta()` + `formatDistance()` → แสดงผลภาษาไทย

### Security & Config (`next.config.ts`)

- [x] `Permissions-Policy: geolocation=(self)` — เปิด GPS สำหรับ admin pages
- [x] CSP `img-src` เพิ่ม `https://*.tile.openstreetmap.org`
- [x] CSP `connect-src` เพิ่ม `https://router.project-osrm.org` + `https://nominatim.openstreetmap.org`
- [x] Token-based access — `trackingToken = UUID` ไม่ต้องการ auth เพิ่มเติม
- [x] Token lifetime 48 ชั่วโมงหลัง delivery สำเร็จ (410 Gone เมื่อ expired)

### Permissions (`lib/access-control.ts`)

- [x] รวม GPS เข้า `delivery.update` — label: "อัปเดตสถานะจัดส่งและตำแหน่ง GPS" (ลบ delivery.track แล้ว)

### Driver GPS Update

- [x] สร้าง `app/admin/(protected)/delivery/track/actions.ts` (Server Action)
  - [x] `requirePermission("delivery.update")`
  - [x] Validate ด้วย Zod (lat/lon range, accuracy, saleIds array)
  - [x] ตรวจสอบ saleIds เป็น `OUT_FOR_DELIVERY` ที่ assign ให้ driver คนนี้จริง
  - [x] `db.deliveryTracking.upsert()` ทุก saleId ที่ valid
  - [x] บันทึก `AuditLog` ทุกครั้ง
- [x] สร้าง `app/admin/(protected)/delivery/update/GpsUpdateBanner.tsx` (Client Component)
  - [x] แสดงบน delivery/update page เมื่อ driver มี OUT_FOR_DELIVERY ที่ assign ตัวเอง
  - [x] ปุ่ม "📍 อัปเดต" สีส้ม กด manual ได้ทันที
  - [x] Auto-update ทุก 10 นาที ด้วย `setInterval` ตลอดที่ page เปิดอยู่
  - [x] ปฏิเสธ GPS accuracy > 100 เมตร พร้อมข้อความแจ้งเตือน
  - [x] Error messages ครบ: GPS disabled / Permission denied / ไม่แม่นยำ / Network error
  - [x] แสดง last update time + accuracy หลัง success
- [x] อัปเดต `delivery/update/page.tsx` — ส่ง `canTrack` + `myOutForDeliveryIds` ไปที่ queue
- [x] อัปเดต `MobileDeliveryQueue.tsx` — embed `<GpsUpdateBanner>` บนสุดของ list

### Token Auto-Generation (`sales/actions.ts`)

- [x] `updateShippingStatus()` → เมื่อสถานะเป็น `OUT_FOR_DELIVERY` ครั้งแรก → auto-generate `trackingToken` + `trackingExpiry = now + 48h`
- [x] เมื่อสถานะเป็น `DELIVERED` → update `trackingExpiry = now + 48h` (ลูกค้าเปิดดูย้อนหลังได้)

### Tracking API (`app/api/liff/tracking/[token]/route.ts`)

- [x] `force-dynamic`, ไม่ต้องการ auth
- [x] Validate token length, return 404 ถ้าไม่พบ, 410 ถ้า expired
- [x] Response compact: `{ saleNo, status, destination, driver: { lat, lon, accuracy, updatedAt, stale }, driverName, driverPhone }`
- [x] `stale: true` ถ้าไม่มี GPS update เกิน 30 นาที

### Customer LIFF Tracking Page

- [x] สร้าง `app/liff/tracking/[token]/page.tsx` (Server Component)
  - [x] SSR initial data + geocode destination ด้วย Nominatim server-side
  - [x] แสดงหน้า "ลิงก์หมดอายุ" ถ้า token expired
- [x] สร้าง `app/liff/tracking/[token]/DeliveryTrackingClient.tsx` (Client Component)
  - [x] **Single Leaflet instance** — init ครั้งเดียวใน `useEffect([], [])`, cleanup on unmount
  - [x] `useRef` สำหรับ map / driverMarker / destMarker / routeLayer — ไม่ rerender
  - [x] Driver marker: 🚚 div icon, Destination marker: 📦 div icon (หลีกเลี่ยง webpack default icon issue)
  - [x] `fitBounds()` แสดงทั้ง driver + destination ในครั้งแรก
  - [x] Polling `setInterval` ทุก 3 นาที → `marker.setLatLng()` เท่านั้น (ไม่ flicker)
  - [x] Recalculate OSRM route เฉพาะเมื่อ driver เคลื่อนที่ > 100 เมตร
  - [x] Status card (PENDING / กำลังจัดส่ง / จัดส่งแล้ว ✓)
  - [x] NEARBY badge "🔔 ใกล้แล้ว!" เมื่อ ≤ 2 กม. — client-side เท่านั้น, ไม่แก้ DB enum
  - [x] ETA card "ถึงใน ~X นาที" + ระยะทาง (จาก OSRM)
  - [x] Stale warning เมื่อไม่มี update > 30 นาที
  - [x] Network error fallback
  - [x] Driver info card: ชื่อ + ปุ่ม "📞 โทรหาคนขับ" (`tel:` link)
  - [x] "ข้อมูลจะอัปเดตอัตโนมัติทุก 3 นาที"

### Dependencies

- [x] ติดตั้ง `leaflet` + `@types/leaflet`

### Build Verification

- [x] `npm run build` ผ่าน 0 errors
- [x] TypeScript type check ผ่าน
- [x] Route `ƒ /api/liff/tracking/[token]` ปรากฏใน build output
- [x] Route `ƒ /liff/tracking/[token]` ปรากฏใน build output

### สิ่งที่ไม่ได้ทำ (Intentional Out-of-Scope)

- ❌ WebSocket / Firebase Realtime — ใช้ polling เพียงพอ + ฟรี
- ❌ แก้ `ShippingStatus` enum — NEARBY แสดง UI เท่านั้น
- ❌ Auto-send tracking link ผ่าน LINE OA — รอ Phase 1C (LINE push)
- ❌ Driver location history — เก็บเฉพาะตำแหน่งล่าสุด (upsert)

### To-Do ต่อเนื่อง (ยังไม่ทำ)

- [ ] เพิ่ม field `User.phone` ใน admin users new/edit form — field มีใน DB แล้ว แต่ยังไม่ expose ใน UI
- [ ] แสดง tracking link URL ในหน้า admin sales detail — ให้พนักงาน copy ส่งลูกค้าได้ง่าย
- [ ] ส่ง tracking link ผ่าน LINE OA อัตโนมัติเมื่อ `OUT_FOR_DELIVERY` — ต้องรอ Phase 1C

