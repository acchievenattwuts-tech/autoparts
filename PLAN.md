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
| Sale / SaleItem | ระบบขาย |
| CreditNote / CreditNoteItem | CN ฝั่งขาย — เราออกให้ลูกค้า (RETURN=คืนของ / DISCOUNT=ลดราคา) |
| Adjustment / AdjustmentItem | ปรับสต็อก +/- พร้อมเหตุผล |
| Warranty | ประกันสินค้า (เริ่มนับจากวันขาย) |
| Expense | ค่าใช้จ่ายอื่นๆ |
| SiteContent | Admin แก้ไขข้อความหน้าเว็บ |

---

## Phases

### ✅ Phase 0 — หน้าร้าน (เสร็จแล้ว)
- Navbar, Hero, ProductCategories, WhyUs, FeaturedProducts, LineCTA, Footer
- FloatingLine button (LINE OA)
- Font: Kanit (heading) + Sarabun (body)
- LINE link: `https://lin.ee/18P0SqG`

### ✅ Phase 1 — Setup DB + Deploy (เสร็จแล้ว)
- ติดตั้ง Prisma v7 + สร้าง schema ครบทุกระบบ
- เชื่อมต่อ Supabase PostgreSQL (Session pooler port 5432)
- รัน `prisma db push` สร้าง table สำเร็จ
- Push ขึ้น GitHub: `acchievenattwuts-tech/autoparts`
- Deploy บน Vercel สำเร็จ ✓
- **TODO:** ผูก custom domain (ถ้าต้องการ)

### 🔲 Phase 2 — Admin Auth + สินค้า
**เป้าหมาย:** Admin login + CRUD สินค้าครบถ้วน

งานที่ต้องทำ:
- [ ] ติดตั้ง NextAuth.js v5 (Credentials provider)
- [ ] สร้าง `/app/admin/login/page.tsx`
- [ ] สร้าง middleware.ts (protect `/admin/*` routes)
- [ ] Admin layout (`/app/admin/layout.tsx`) — sidebar navigation
- [ ] หน้า Dashboard (`/app/admin/page.tsx`) — summary cards
- [ ] CRUD สินค้า (`/app/admin/products/`) — list, create, edit, delete
- [ ] จัดการ CarBrand/CarModel/Category/Supplier (master data)
- [ ] Upload รูปสินค้าไปยัง Supabase Storage
- [ ] สร้าง seed script (`prisma/seed.ts`) สำหรับ admin user แรก

### 🔲 Phase 3 — BF + Stock + ซื้อ + ขาย + เอกสาร

#### 3.0 ตรวจสอบโครงสร้าง DB (ผลกระทบจาก Multi-Unit)
- [ ] **ReviewDB**: `StockTransaction.quantity` ปัจจุบันเป็น Int ใน base unit
  → ต้องเพิ่ม `unitName String?` + `unitScale Float?` เพื่อบันทึกว่าใช้หน่วยอะไรในแต่ละ transaction
- [ ] `PurchaseItem.quantity` → ต้องเพิ่ม `unitName` (ใช้ purchaseUnitName ของสินค้า)
- [ ] `SaleItem.quantity` → ต้องเพิ่ม `unitName` (ใช้ saleUnitName ของสินค้า)
- [ ] Logic แปลงหน่วย: stockChange = quantity × unit.scale (คำนวณจาก ProductUnit.scale)
- [ ] ทุก transaction ที่กระทบ stock ต้อง convert เป็น base unit ก่อนบันทึก

#### 3.1 ระบบ BF (ยอดยกมา / Beginning Balance)
- [ ] หน้า `/admin/stock/bf` — บันทึกยอดสินค้าเริ่มต้น (แทนการใส่ stock ตอนสร้างสินค้า)
- [ ] เลือกสินค้า, ระบุจำนวน, เลือกหน่วย (จาก ProductUnit ของสินค้านั้น), ระบุวันที่ BF
- [ ] สร้าง `StockTransaction` type = `BALANCE_FORWARD` → อัปเดต `Product.stock`
- [ ] แสดงประวัติ BF ที่บันทึกแล้ว

#### 3.2 ระบบ Stock
- [ ] ดู stock คงเหลือทุกสินค้า (แสดงใน base unit + หน่วยรายงาน พร้อมเลือกหน่วยได้)
- [ ] **Stock Card** — แสดงบัตรสต็อกรายสินค้า (qtyIn/qtyOut/qtyBalance/priceBalance) เลือกหน่วยแสดงได้ (หาร scale)
- [ ] **Adjustment (ปรับสต็อก)** — บันทึก ADJUST_IN / ADJUST_OUT พร้อมเหตุผล → เขียน StockCard + อัปเดต Product.stock

#### 3.3 ระบบซื้อ + ขาย
- [ ] **ซื้อสินค้า (Purchase)** — บันทึกใบซื้อ, อัปเดต stock, คำนวณ avgCost ใหม่ทุกครั้ง
- [ ] **ขายสินค้า (Sale)** — บันทึกใบขาย, ลด stock, บันทึก priceOut = avgCost ณ วันขาย
- [ ] StockCard logic: ทุก transaction เขียน StockCard + อัปเดต Product.stock + Product.avgCost ใน $transaction เดียว
- [ ] Moving Average Cost formula: `avgCost ใหม่ = (stock × avgCost + qty × unitCost) / (stock + qty)`

#### 3.4 เอกสารคืนสินค้า / ลดหนี้
- [ ] **Credit Note (CN ฝั่งขาย)** — เราออกให้ลูกค้า
  - type=RETURN: คืนสินค้า → stock +qty (RETURN_IN), avgCost ไม่เปลี่ยน
  - type=DISCOUNT: ลดราคา → ไม่กระทบ stock
- [ ] **Purchase Return (คืนให้ซัพพลายเออร์)** → stock -qty (RETURN_OUT), คำนวณ avgCost ใหม่

#### 3.5 เอกสารออก
- [ ] **ใบแจ้งหนี้ (Invoice)** — เลขที่เอกสาร, ข้อมูลลูกค้า, รายการสินค้า+หน่วย, ยอดรวม
- [ ] **ใบเสร็จรับเงิน (Receipt)** — ข้อมูลร้าน, ลายเซ็น, QR Code ชำระเงิน
- [ ] Export PDF (`@react-pdf/renderer` หรือ `html2pdf`)
- [ ] Print โดยตรงจากเบราว์เซอร์

### 🔲 Phase 4 — ประกัน + ค่าใช้จ่าย
- [ ] ระบบประกัน — เริ่มนับจากวันที่ขาย, แสดงสถานะหมดประกัน
- [ ] ระบบค่าใช้จ่าย — บันทึกตาม category (ค่าเช่า, ไฟ, เงินเดือน ฯลฯ)

### 🔲 Phase 5 — ระบบค้นหา
- [ ] Full-text search สินค้า (ค้นได้จากชื่อ, โค้ด, alias, ยี่ห้อรถ, รุ่นรถ)
- [ ] ค้นหาจากหน้าร้าน (ลูกค้าใช้)
- [ ] ค้นหาจากหลังบ้าน (admin ใช้)

### 🔲 Phase 6 — Report
- [ ] Report สรุปยอดขาย (รายวัน/สัปดาห์/เดือน)
- [ ] Report กำไร-ขาดทุน
- [ ] Report stock คงเหลือ + สินค้าต่ำกว่า minStock
- [ ] Report ประกันที่กำลังจะหมด
- [ ] Export Excel / PDF

### 🔲 Phase 7 — SEO + AEO (AI Engine Optimization)
**เป้าหมาย:** ติดอันดับ Google + ขึ้นใน AI search (ChatGPT, Perplexity, Google AI Overview)

**SEO พื้นฐาน:**
- [ ] Next.js Metadata API — title, description, canonical URL ทุกหน้า
- [ ] Open Graph + Twitter Card (แชร์ใน social ได้สวย)
- [ ] `sitemap.xml` — dynamic (ครอบคลุมหน้าสินค้าทุกชิ้น)
- [ ] `robots.txt`
- [ ] Core Web Vitals — ปรับ loading speed, image optimization
- [ ] URL structure — `/products/[category]/[slug]` อ่านง่าย

**Structured Data (Schema.org JSON-LD) — สำคัญมากสำหรับ AI:**
- [ ] `LocalBusiness` — ชื่อร้าน, ที่อยู่, เบอร์, เวลาทำการ
- [ ] `Product` — ชื่อสินค้า, ราคา, รูป, คำอธิบาย, ยี่ห้อ
- [ ] `BreadcrumbList` — navigation path
- [ ] `FAQPage` — คำถามที่พบบ่อย (ขึ้น AI Overview ได้ง่าย)
- [ ] `Organization` — ข้อมูลองค์กร/ร้านค้า

**AEO — ให้ AI search อ้างอิงได้:**
- [ ] หน้า `/about` — แนะนำร้าน, ประวัติ, ความเชี่ยวชาญ (E-E-A-T)
- [ ] หน้า `/faq` — คำถามที่ลูกค้าถามบ่อย เช่น "คอมเพรสเซอร์แอร์โตโยต้ากี่บาท"
- [ ] หน้า `/blog` หรือ `/knowledge` — บทความให้ความรู้เรื่องอะไหล่แอร์
- [ ] เนื้อหาสินค้า — คำอธิบายละเอียด ใช้ภาษาธรรมชาติ ตอบคำถามลูกค้าได้
- [ ] `llms.txt` — ไฟล์แนะนำร้านสำหรับ AI crawlers (เทรนใหม่ปี 2025)

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
```

## หมายเหตุสำคัญ
- ใช้ **Prisma db push** (ไม่ใช่ migrate dev) เพราะ Supabase Transaction pooler ไม่รองรับ shadow database
- `lib/generated/prisma` อยู่ใน `.gitignore` → ต้องรัน `prisma generate` หลัง clone repo ใหม่
- Admin user แรกต้องสร้างผ่าน seed script (Phase 2)
