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
| Product | สินค้า (มี shelfLocation, stock) |
| ProductAlias | ชื่อเรียกอื่นๆ สำหรับ search |
| ProductCarModel | สินค้า ↔ รุ่นรถ (many-to-many) |
| StockTransaction | ประวัติการเปลี่ยนแปลง stock |
| Purchase / PurchaseItem | ระบบซื้อสินค้าเข้า |
| Sale / SaleItem | ระบบขาย |
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
- **TODO:** Deploy บน Vercel + ผูก custom domain

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

### 🔲 Phase 3 — Stock + ซื้อ + ขาย
- [ ] ระบบ Stock — ดู stock, ปรับยอด manual
- [ ] ระบบซื้อ — บันทึกการซื้อสินค้าเข้า, อัพเดต stock อัตโนมัติ
- [ ] ระบบขาย — บันทึกการขาย, ลด stock อัตโนมัติ
- [ ] สร้าง Server Actions สำหรับทุก transaction

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
