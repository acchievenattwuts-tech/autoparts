# Active Roadmap

## Purpose
- ไฟล์นี้เก็บเฉพาะงานที่ยัง active หรือยังต้องตัดสินใจ
- งานที่เสร็จแล้วแบบสรุปอยู่ที่ [completed.md](/D:/autoparts/docs/roadmap/completed.md)

## Active Now
### ตัวกรองหมวดหมู่แบบเลือกหลายหมวด (Multi-select Category Filter) — เสร็จแล้ว
- สถานะ: **DONE** — หน้าแรก + `/admin/products` + `/admin/products/search` เลือกหมวดหมู่ได้มากกว่า 1
- สิ่งที่ทำเสร็จ:
  - [x] คอมโพเนนต์ใหม่ `components/shared/MultiSelectFilter.tsx` — dropdown + ช่องค้นหา + checkbox, portal ไป `document.body` และพก class `dark` จาก `AdminThemeProvider` (แพตเทิร์นเดียวกับ `SearchableSelect`), รองรับ light + dark
  - [x] หน้าแรก `HeroFitmentFinder` — ช่อง "หมวดอะไหล่" เป็น multi-select, ส่ง `?categories=` ซ้ำหลายค่าไป `/products` (ฝั่ง `/products` รองรับหลายหมวดอยู่แล้ว ไม่ต้องแก้)
  - [x] `lib/product-search.ts` — เพิ่ม `categoryIds?: string[]` ใน `ProductSearchInput`, รวมกับ `categoryId` เดิมเป็นชุดเดียว (`where.categoryId = { in }` / raw SQL `IN (${Prisma.join(...)})`) และใส่ใน cache key
  - [x] `lib/admin-product-filter-params.ts` — `categoryId` เป็น param ซ้ำได้ (`?categoryId=a&categoryId=b`), parse เป็น `categoryIds: string[]`, เพิ่ม `buildAdminProductFilterQueryString()`; `buildAdminProductFilterSearchParams()` คืนคู่ `[key, value][]` เพื่อรองรับ key ซ้ำ
  - [x] `components/shared/Pagination.tsx` — prop `searchParams` รับได้ทั้ง object และคู่ `[key, value][]`
  - [x] `/admin/products` — `ProductFilterForm` ใช้ `MultiSelectFilter` + hidden input `categoryId` หลายตัว, pill "หมวดหมู่" แยกลบทีละหมวด
  - [x] `/admin/products/search` — `MobileProductSearchForm` filter sheet ติ๊กหมวดหมู่ได้หลายหมวด (badge นับตามจำนวนหมวดจริง), chip สรุปแสดงครบทุกหมวด
  - [x] export CSV/Excel (`lib/product-report-queries.ts` + 2 routes) รับหลายหมวดตาม filter เดิมของหน้าจอ, audit meta เก็บเป็น query string
- ลิงก์/bookmark เดิมที่ส่ง `categoryId` ค่าเดียวยังใช้ได้ตามปกติ (ไม่ต้อง migrate URL)
- `npm run build` ผ่าน ไม่มี TypeScript error

### เมนูโปรดต่อผู้ใช้ (Sidebar Favorites) — เสร็จแล้ว
- สถานะ: **DONE** — เก็บใน DB ต่อ `userId`, sidebar อย่างเดียว
- สิ่งที่ทำเสร็จ:
  - [x] model `UserFavoriteMenu` (`@@unique([userId, href])`, `@@index([userId, sortOrder])`) + relation `User.favoriteMenus` — `prisma db push` แล้ว
  - [x] helper `lib/user-favorite-menu.ts` — `getFavoriteMenuHrefs()` + `isKnownAdminHref()` + `MAX_FAVORITE_MENUS = 20`
  - [x] Server Actions `app/admin/(protected)/favorite-menu-actions.ts` — `toggleFavoriteMenu()` / `reorderFavoriteMenus()`, ยึด `userId` จาก session เท่านั้น, Zod validate href กับ `ADMIN_NAVIGATION`, เขียน AuditLog (`UPDATE` / entityType `UserFavoriteMenu`)
  - [x] hook `components/shared/use-admin-favorite-menus.tsx` — optimistic update + `useTransition` + rollback
  - [x] `AdminSidebar` — section "รายการโปรด" บนสุด, ปุ่มดาวทุกเมนู, จัดลำดับด้วยปุ่มขึ้น/ลง, เลขรันนิ่งต่อ section, light + dark mode
  - [x] favorites กรองสิทธิ์ซ้ำอีกชั้น + ตัด href ที่ไม่มีในเมนูแล้ว โดยไม่ลบแถวใน DB
- ไม่เพิ่ม permission key ใหม่ (เป็น personal preference — ป้องกันด้วย session)
- ยังไม่ทำ (out of scope): drag-and-drop, favorites ใน Quick Search / Command Palette

### Knowledge RAG Quality — Round A–D เสร็จ

- สเปก: [docs/specs/knowledge-rag-roadmap.md](/D:/autoparts/docs/specs/knowledge-rag-roadmap.md)
- [x] ล็อกหัวข้อประกัน/คืนสินค้า/ค่าจัดส่ง/การจัดส่งให้ส่งแอดมินทั้ง LINE และ Messenger
- [x] บังคับ policy ซ้ำใน Knowledge CMS และ publish boundary โดยไม่กระทบ public storefront
- [x] golden production evaluation: retrieval 10/10, admin-only 24/24
- [x] PII-safe RAG telemetry และตรวจ model isolation จาก Product Search
- [x] Round B: source inventory 38 แหล่ง, owner/review/expiry, claim-level evidence, quality gate, FAQ gap 3 เรื่อง และ production backfill
- [x] Round C: production retrieval `21/21` (baseline 13 + paraphrase 8), admin-only `24/24`, hard negative `8/8`, offline weighting/chunk experiments และ threshold/latency gate; ยังรักษา production baseline เดิมเพราะ candidate ที่ผ่านไม่ได้ดีขึ้นอย่างมีนัยสำคัญ
- [x] Round D: quality dashboard แยก LINE/Messenger, feedback แบบ reason code, PII-safe gap backlog ที่บังคับ review ก่อนสร้าง draft, failure notification และ rollback/runbook

### Phase 6.6 - Cash/Bank Lite — เสร็จแล้ว (ใช้งานจริง)
- สถานะ: **DONE** — implement เสร็จและใช้งานจริง
- เป้าหมาย (บรรลุแล้ว):
  - [x] โมดูลเงินสด/ธนาคารแบบ lite สำหรับธุรกิจเริ่มต้น
  - [x] opening balance/date, income/expense movement, transfer, adjustment, รายงานพื้นฐาน
- สิ่งที่ทำเสร็จ:
  - [x] schema 4 model (`CashBankAccount/Movement/Transfer/Adjustment`)
  - [x] หน้าจอ `/admin/cash-bank` + ledger + transfers + adjustments
  - [x] posting flow `lib/cash-bank.ts` wire เข้าทุกเอกสารเงิน (sales/receipts/purchases/purchase-returns/credit-notes/expenses/supplier-payments/supplier-advances/delivery-commissions/Shopee)
  - [x] รายงาน `lib/cash-bank-report-queries.ts` + Excel/CSV export
  - [x] permission ครบ 5-step + nav
  - [x] spec อยู่ที่ [docs/specs/cash-bank-lite.md](/D:/autoparts/docs/specs/cash-bank-lite.md)
- คงเหลือ (out of scope ตามตั้งใจ): full bank reconcile, bank statement import, payment run/clearing, slip attachment

### Product Search Overhaul (OEM / Fitment / Synonym)
- สถานะ: Phase A + B + C + D + E + F1 + F2 เสร็จ
- เอกสาร spec: [docs/specs/product-search-overhaul.md](/D:/autoparts/docs/specs/product-search-overhaul.md)
- Phase E: no-result telemetry + dashboard/report เสร็จแล้ว
- Product Search Quality report: no-result/low-result clustering + reviewed apply flow เสร็จแล้ว
- เอกสาร phase ถัดไป: [docs/specs/product-search-log-analysis.md](/D:/autoparts/docs/specs/product-search-log-analysis.md)
- งานที่ต้องทำต่อ:
  - [x] Phase F3 - Review Outcome Tracking
  - [x] Phase F4 - Fitment/Year Remediation Flow
  - [x] Phase F5 - Closed-Loop Measurement
  - [x] Phase F6 - Guarded Auto-Apply

### Product Search Quality Improvements (Round 2)
- สถานะ: Q1 + Q2 + Q3 + Q4 + Q5 เสร็จ
- เอกสาร spec: [docs/specs/product-search-quality-improvements.md](/D:/autoparts/docs/specs/product-search-quality-improvements.md)
- งานที่เสร็จ: Autocomplete dropdown (storefront + admin), unaccent extension, Search Coverage Audit report, Did-you-mean suggestions, Match highlighting chips
- รอ round ถัดไป: LINE Bot (#12) — Flex Message + Rule-based dispatcher

### Warranty Manual Mode + Cancel Flow (2026-05-28)
- สถานะ: implemented
- เป้าหมาย: รองรับการคีย์ประกัน 2 mode บน `/admin/warranties/new` + ยกเลิกประกันที่สร้างเอง
  - **WITH_SALE** — อ้างอิงใบขาย แสดงสินค้าทุกบรรทัด (สินค้าที่มีประกันแล้วจะ disabled) ไม่บังคับว่าสินค้าต้องมี `warrantyDays > 0`
  - **NO_SALE** — ประกันหน้างาน เลือกลูกค้าจาก master + เลือกสินค้า + ระบุวันเริ่ม + ระบุจำนวนวัน (ใช้กับเคส QC fail / ประกันพิเศษ)
- การเปลี่ยนแปลงสำคัญ:
  - Schema: `Warranty.saleId` / `saleItemId` เปลี่ยนเป็น nullable, เพิ่ม `customerId` (FK Customer) + `customerName` snapshot, เพิ่ม `createdVia` enum (`AUTO_FROM_SALE` / `MANUAL`) + `@@index`
  - Form: 2-mode toggle, `SearchableSelect` รองรับ `disabled` option ในตัว
  - Action: `createWarranty` ใช้ Zod discriminated union (WITH_SALE / NO_SALE) — NO_SALE block ห้ามสินค้า lot-controlled
  - Display: list `/admin/warranties` + `/admin/warranty-claims` + LIFF `/liff/warranties` + LIFF `/liff/claims` + รายงาน + print form รองรับ warranty ที่ไม่มี sale (fallback ลูกค้าจาก `customer.name` หรือ `customerName` snapshot)
  - LIFF filter ยอมรับทั้งกรณีมี sale และ NO_SALE (`customerId = me AND saleId = null`)
  - `lib/claim-stock.ts` fallback unit cost ไป `product.avgCost` เมื่อไม่มี saleItem
- Audit log บันทึก mode (WITH_SALE / NO_SALE) ใน `after` payload
- ข้อจำกัด: NO_SALE ไม่รองรับสินค้า lot-controlled (ต้องผ่านใบขายเพื่อ pin lot snapshot)

#### Cancel Flow (ยกเลิกประกันที่สร้างเอง)
- ปุ่มยกเลิกอยู่บนหน้า `/admin/warranties` แสดงเฉพาะเมื่อ:
  1. user มี permission `warranties.cancel`
  2. `warranty.createdVia = MANUAL` (กันยกเลิก warranty ที่มาจาก auto-generate ตอนสร้างใบขาย)
  3. ไม่มี active claim อ้างอิง (claim ที่ status ≠ CANCELLED)
- กลไก:
  - `cancelWarranty(formData)` ใน `app/admin/(protected)/warranties/actions.ts` — **hard delete**
  - Reference chain check: block ถ้ามี active claim ตามกฎ `.rules §8`
  - บันทึก AuditLog action = `CANCEL` พร้อม `before` snapshot ของ warranty และ `after` = cancelNote (ถ้ามี)
  - หลังยกเลิก: sale item กลับมาเลือกได้ในหน้า `+บันทึกประกันใหม่` อีกครั้งโดยอัตโนมัติ (เพราะ row ถูกลบจริง)
- Permission ใหม่: `warranties.cancel` (admin-only — ไม่อยู่ใน `STAFF_OPERATIONS_PERMISSIONS` ตาม pattern เดียวกับ `warranties.create`)
- ใช้ `CancelDocButton` shared (UI pattern เดียวกับ Sale/Receipt/Claim cancel) ผ่าน wrapper `CancelWarrantyButton`
- Backfill: รัน `prisma/scripts/backfill-warranty-created-via.ts` ใน production แล้ว — rules: `saleId IS NULL` → MANUAL, `createdAt > sale.createdAt + 1min` → MANUAL, ที่เหลือ AUTO_FROM_SALE

### Phase 7 - SEO Follow-up
- สถานะ: mostly complete with ongoing follow-up
- [x] 2026-08-20 Option A technical trust patch: crawler policy sync, structured-data claim cleanup, filtered/search noindex, title deduplication, broken internal-link repair, policy sitemap entry (ไม่มี UI change และไม่แตะ H1 `/products`)
- สิ่งที่ยังเป็นงานต่อเนื่อง:
  - [x] external verification (Google Search Console ownership + sitemap submission; ดู `docs/seo/phase-7-final-status-2026-04-03.md`)
  - [ ] content expansion ตาม priority
  - [ ] periodic Core Web Vitals review

## Open Questions
- (Resolved) Cash/Bank Lite ตัดสินใจใช้ model เฉพาะ (movement ledger ต่อบัญชี) — implement แล้ว
- (Resolved) opening balance ลงที่ระดับ account (`openingBalance` + `openingDate`)
- (Resolved) transfer ใช้ post ทันที + มี status ACTIVE/cancel

## Rules For Updating This File
- เก็บเฉพาะงานที่ยังไม่จบหรือยังมี decision ค้าง
- ถ้างานปิดแล้ว ให้ย้ายสรุปไป [completed.md](/D:/autoparts/docs/roadmap/completed.md)
- ถ้ารายละเอียดโมดูลยาวเกิน 1 หน้า ให้แยกไป `docs/specs/`
