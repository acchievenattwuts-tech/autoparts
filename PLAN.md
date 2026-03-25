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
| Customer | ข้อมูลลูกค้า (รหัส, ชื่อ, เบอร์, ที่อยู่, เลขภาษี) |
| Sale / SaleItem | ระบบขาย (saleType: RETAIL/WHOLESALE) |
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
- Social links: Facebook, TikTok, Shopee, Lazada (show/hide toggle)

### ✅ Phase 1 — Setup DB + Deploy (เสร็จแล้ว)
- ติดตั้ง Prisma v7 + สร้าง schema ครบทุกระบบ
- เชื่อมต่อ Supabase PostgreSQL (Session pooler port 5432)
- Deploy บน Vercel สำเร็จ ✓

### ✅ Phase 2 — Admin Auth + สินค้า (เสร็จแล้ว)
- NextAuth.js v5 (Credentials provider) + Login page + Middleware
- Admin layout + Sidebar navigation
- Dashboard (summary cards)
- CRUD สินค้า (list, create, edit, delete) + Upload รูป Supabase Storage
- Multi-unit (ProductUnit + scale)
- Master data: Category, CarBrand/CarModel, Supplier, PartsBrand
- Security headers (CSP, HSTS, X-Frame-Options ฯลฯ)

### ✅ Phase 3 — BF + Stock + ซื้อ + ขาย + เอกสาร (เสร็จแล้ว)

#### ✅ 3.0 โครงสร้าง DB + MAVG Engine
- StockCard เป็น source of truth — qty/price ใน base unit ทั้งหมด
- avgCost (Moving Average Cost) เก็บใน Product + StockCard.priceBalance
- `lib/stock-card.ts` — MAVG engine (`writeStockCard`)
- `lib/doc-number.ts` — document number generator

#### ✅ 3.1 ระบบ BF (ยอดยกมา)
- หน้า `/admin/stock/bf` — บันทึกยอดสินค้าเริ่มต้น เลือกหน่วย+จำนวน+ต้นทุน
- สร้าง StockCard source=BF → อัปเดต Product.stock + avgCost

#### ✅ 3.2 ปรับสต็อก (Adjustment)
- หน้า `/admin/stock/adjustments` — ปรับ +/- หลายรายการพร้อมเหตุผล
- สร้าง Adjustment + AdjustmentItem → เขียน StockCard ADJUST_IN/ADJUST_OUT

#### ✅ 3.3 ระบบซื้อ + ขาย
- `/admin/purchases` — ใบซื้อสินค้า + MAVG คำนวณ avgCost ใหม่ทุกครั้ง
- `/admin/sales` — บันทึกการขาย + snapshot avgCost ลง SaleItem.costPrice

#### ✅ 3.4 เอกสารคืนสินค้า / ลดหนี้
- `/admin/credit-notes` — CN ฝั่งขาย (RETURN=รับคืน+RETURN_IN, DISCOUNT=ลดราคา)
- `/admin/purchase-returns` — คืนให้ซัพพลายเออร์ (RETURN_OUT)

#### ✅ 3.5 เอกสารออก
- `/admin/sales/[id]` — ดูรายละเอียดใบขาย + พิมพ์ใบเสร็จรับเงิน (browser print)

#### ✅ 3.x เพิ่มเติม
- `/admin/stock/card` — บัตรสต็อกรายสินค้า เลือกหน่วยแสดงได้ (หาร scale)

#### 🔲 3.6 โมดูลใบเสร็จรับเงิน (Receipt)
- [ ] ใบเสร็จรับเงินสำหรับการขายเชื่อ (Sale.paymentType=CREDIT_SALE) — บันทึกการรับชำระ
- [ ] CN ประเภทตั้งหนี้ (settlementType=CREDIT_DEBT) — บันทึกลดยอดหนี้
- [ ] เก็บยอดลูกหนี้ค้างชำระต่อลูกค้า (Accounts Receivable)
- [ ] พิมพ์ใบเสร็จรับเงิน (browser print + PDF export)
- [ ] แสดงยอดค้างชำระในหน้า Customer profile

### ✅ Phase 2.5 — ระบบลูกค้า (Customer Module)
- CRUD ลูกค้า: list (พร้อม search), create, edit, delete (ป้องกันลบถ้ามียอดขาย)
- หน้าโปรไฟล์ลูกค้า: ข้อมูล + สถิติ (ยอดซื้อรวม, จำนวนครั้ง) + ประวัติการซื้อ
- เชื่อม Sale ↔ Customer: ใบขายเลือกลูกค้าจากระบบ + auto-fill ชื่อ/เบอร์
- ประเภทการขาย (saleType): RETAIL=ขายปลีก (badge เขียว), WHOLESALE=ขายส่ง (badge น้ำเงิน)
- แสดง saleType badge ในหน้า sales list + sales detail
- แสดง customer link (→ /admin/customers/{id}) ใน sales detail
- Sidebar: เพิ่มเมนู "ลูกค้า" ใต้หัวข้อ "ระบบงาน"

### 🔲 Phase 4 — ประกัน + ค่าใช้จ่าย
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
