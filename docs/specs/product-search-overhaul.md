# Product Search Overhaul — OEM / Fitment / Synonym

## Purpose
ยกระดับระบบค้นหาสินค้า (storefront + /admin/products) ให้รองรับ:
- OEM / Part No. / เบอร์เทียบ
- ข้อมูลรถที่ใช้ได้แบบละเอียด (ยี่ห้อ, รุ่น, โฉม, ปีเริ่ม-ปีจบ, เครื่องยนต์)
- คลังคำพ้อง / คำสะกดหลายแบบ / ไทย-อังกฤษ
- ระบบให้คะแนนคำค้นตาม priority ที่ผู้ใช้ระบุ

## Search Ranking (Target)
| Match | Weight |
|---|---|
| code = q / OEM = q | 1500 / 1400 |
| name = q | 1000 |
| fitment (brand+model+ปี) match | +700 boost |
| code prefix / name prefix | 380 / 320 |
| OEM contains | 600 |
| alias / keyword contains | 250 |
| description contains | 80 |
| trigram fuzzy (code/name/oem) | x420 / x250 / x380 |

## Phasing
- **Phase A — Schema only** (low risk)
- **Phase B — Admin form + search scoring**
- **Phase C — Fitment ละเอียด (ProductFitment)**
- **Phase D — Synonym global + query expansion**
- **Phase E — Telemetry / no-result logging**

แต่ละ phase deploy แยก ดู metric 3-5 วัน ก่อนเริ่ม phase ถัดไป (ตาม .rules §9)

---

## Phase A — Schema-only (CURRENT)

### Scope
- ขยาย `ProductAlias` ให้รองรับ kind ต่าง ๆ (OEM, PART_NO, CROSS_REF, KEYWORD, MISSPELL, EN, TH)
- เพิ่ม weight optional สำหรับ boost ระดับ alias
- ไม่แตะ UI / Server Actions / Search engine / search documents
- ไม่ migrate ข้อมูลเดิม (default kind = ALIAS)

### Schema Diff (Proposed)

```prisma
enum AliasKind {
  ALIAS         // คำเรียกอื่น (default — ของเดิม)
  OEM           // เบอร์ OEM
  PART_NO       // Part Number ผู้ผลิต
  CROSS_REF     // เบอร์เทียบยี่ห้ออื่น
  KEYWORD       // คำค้นทั่วไป
  MISSPELL      // คำสะกดผิดที่พบบ่อย
  EN            // ชื่ออังกฤษ
  TH            // ชื่อไทย
}

model ProductAlias {
  id        String     @id @default(cuid())
  productId String
  alias     String
  kind      AliasKind  @default(ALIAS)
  weight    Int?
  createdAt DateTime   @default(now()) @db.Timestamptz(3)
  product   Product    @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, alias, kind])   // เปลี่ยนจาก (productId, alias)
  @@index([alias])
  @@index([kind])
}
```

### Migration Strategy
- ใช้ `prisma db push` (ตาม .rules §8 — ไม่ใช้ migrate dev)
- ข้อมูลเก่าทุก row จะได้ `kind = ALIAS` อัตโนมัติ → ไม่กระทบของเดิม
- Unique constraint เปลี่ยนจาก 2-col → 3-col → ขยายขอบเขต ไม่ลด → ไม่ทำให้ข้อมูลเดิมขัด constraint
- ไม่มี downstream code ที่ pin `kind` field อยู่ → backward compatible

### Files Affected (Phase A)
- `prisma/schema.prisma` — เพิ่ม enum + ขยาย model
- ไม่มีไฟล์อื่น

### Out of Scope (Phase A)
- UI ฟอร์ม admin (รอ Phase B)
- การปรับ scoring ใน `lib/product-search.ts` (รอ Phase B)
- การเพิ่ม column ใน `product_search_documents` (รอ Phase B)
- `ProductFitment` / submodel / year / engine (รอ Phase C)
- `SearchSynonym` global table (รอ Phase D)

---

## Phase A — Checklist

- [x] อ่าน AGENTS.md / PLAN.md / docs/architecture.md
- [x] เขียน spec ไฟล์นี้
- [x] ขอ confirm จาก human เรื่อง schema diff (.rules §0/§8) — confirmed
- [x] แก้ `prisma/schema.prisma` — เพิ่ม enum `AliasKind` + ขยาย model `ProductAlias`
- [x] รัน `npx prisma generate` ตรวจ type ผ่าน
- [x] รัน `npx prisma db push` (sync กับ Supabase สำเร็จ)
- [x] รัน `npm run build` ผ่าน zero error
- [x] อัปเดต `docs/roadmap/active.md` แจ้งว่า Phase A ปิดแล้ว
- [x] mark checklist นี้เป็น done — **Phase A COMPLETE**

## Decisions (Confirmed)
1. รัน `prisma db push` กับ Supabase ปัจจุบันทันที — confirmed
2. Enum values: `ALIAS | OEM | PART_NO | CROSS_REF | KEYWORD | MISSPELL | EN | TH` — confirmed
3. ฟิลด์ `weight Int?` default `null` (ไม่ boost — fallback ไปใช้ weight ระดับ kind ใน scoring SQL) — confirmed

---

## Phase B — IN PROGRESS

### Scope
- UI redesign ProductForm: จัดกลุ่มใหม่ + dark mode + Tab chips สำหรับ alias kinds
- Server actions: รับ `aliases[].kind`, sync `kind` ลง DB
- Search engine: ปรับ scoring (OEM weight 1400, alias 250, description 80)
- SQL rebuild: เพิ่ม `oem_text` + `keyword_text` columns ใน `product_search_documents`, แก้ `build_product_search_text` aggregate ตาม `kind`

### Checklist
- [x] วางแผน UI mockup + ขอ confirm
- [x] อ่าน actions.ts + product-search.ts + setup-search-v2.ts
- [x] Rewrite `components/shared/ProductForm.tsx` (จัดกลุ่ม + dark mode + tab chips)
- [x] Update `app/admin/(protected)/products/[id]/edit/page.tsx` — map kind
- [x] Update `app/admin/(protected)/products/actions.ts` — zod + create/update kind
- [x] Update `prisma/scripts/setup-search-v2.ts` — เพิ่ม columns + แก้ function
- [x] Update `lib/product-search.ts` — scoring weights ใหม่
- [x] รัน setup-search-v2 script เพื่อ rebuild ตาราง
- [x] `npm run build` zero error
- [x] อัปเดต `docs/roadmap/active.md` — **Phase B COMPLETE**

## Mini-step (between B and C) — Batch rebuild script — DONE
- [x] เปลี่ยน TRUNCATE → DELETE missing rows (zero downtime)
- [x] เพิ่ม BATCH_SIZE constant (500) + DO/LOOP keyset pagination (`p.id > last_id`)
- [x] verify count Product == product_search_documents (9 = 9)
- [x] script เก็บ best-effort logging (RAISE NOTICE ระหว่าง batch)

## Phase C — DONE

### Checklist
- [x] เขียน migration script `prisma/scripts/phase-c-migrate-fitment.ts` (idempotent)
- [x] รัน migration บน Supabase (11 rows ปลอดภัย)
- [x] Schema update: rename model + `@@map("ProductCarModel")` + เพิ่ม columns + restructure PK
- [x] `prisma db push` (schema in sync)
- [x] `prisma generate`
- [x] Update `actions.ts`: zod schema fitments + create/update logic + audit snapshot
- [x] Update `edit/page.tsx`: select fitment columns + pass to form
- [x] Update `ProductForm.tsx`: replace car-brand checkbox tree → fitment table repeater (desktop table / mobile card stack) + dark mode + validation (yearStart ≤ yearEnd)
- [x] Update `lib/product-search.ts`: extractYearFromQuery + lenient year filter (B) + +700 year-match boost (C)
- [x] Update `app/products/search/page.tsx`: รับ `year` query param + pass fitmentYear
- [x] Update `setup-search-v2.ts`: fitment_text รวม submodel/year-range/engine
- [x] รัน setup-search-v2 rebuild
- [x] Update `db-backup.ts` + `db-restore.ts`: db.productFitment
- [x] `npm run build` zero error
- [x] อัปเดต roadmap

### Decisions (Confirmed)
- Q1 = **C**: rename `ProductCarModel` → `ProductFitment` + add columns (ALTER TABLE)
- Q2 = **A**: Table repeater UI (mobile-responsive)
- Q3 = **B+C**: lenient year filter + year-match boost +700 ในคะแนน
- Q4 = **C**: storefront auto-detect ปีจากคำค้น (regex) + optional dropdown

### Scope
- Schema: rename model + add `submodel`, `yearStart`, `yearEnd`, `engineCode`, `engineSize`, `note` + restructure PK (composite → cuid id) + new unique key
- All callers: rename `productCarModel` references throughout codebase
- ProductForm UI: เปลี่ยน car-brand checkbox tree → fitment table repeater
- actions: sync fitment rows
- search-v2 function: aggregate `submodel + yearStart-yearEnd + engineCode` ลง `fitment_text`
- search engine: year-aware filter (lenient) + year-match boost +700
- storefront: regex `\b(19|20)\d{2}\b` auto-extract year + optional year dropdown
- Audit log: ProductFitment changes

## Post-Phase-C Follow-ups — DONE
- [x] npm script `db:push` — รวม `prisma db push` + `setup-search-v2.ts` กันลืม; destructive push ถูกแยกเป็น `db:push:accept-data-loss` (Finding #5)
- [x] npm script `db:setup-search-v2` — shortcut สำหรับ rebuild search docs

## Phase D — DONE

### Decisions
- Permission: `search_synonyms.*` แยกจาก `master.*` (Option B — principle of least privilege)
- Max synonyms per term: **10**
- Expansion: bi-directional (search term หรือ synonym จะขยายไปทั้งกลุ่ม)
- Strategy: expand at QUERY time (ไม่ index time) — flexible และไม่ต้อง rebuild

### Checklist
- [x] Schema `SearchSynonym` (term unique, synonyms[], language?, isActive, timestamps)
- [x] Permissions 5 keys (`search_synonyms.view/create/update/cancel/manage`) ใน access-control.ts
- [x] `STAFF_VIEWER` ได้ view (operations roles ไม่ได้ — เพราะกระทบ search ทั้งระบบ)
- [x] ADMIN_ROUTE_RULES entry (อยู่ก่อน `/admin/master` catch-all)
- [x] Library `lib/search-synonyms.ts` — load + cache + `expandQueryTokens` + MAX safety caps
- [x] Integrate ใน `lib/product-search.ts` — tsquery OR-expansion ของ tokens ที่ขยาย + sanitize input
- [x] Admin pages: page.tsx + loading.tsx + SearchSynonymsClient.tsx (inline edit + chip input) + actions.ts
- [x] AdminSidebar: เพิ่ม "คลังคำพ้อง" ใต้ master section + Quick Search keywords ครอบคลุม
- [x] `db:push` (push schema + rebuild search docs)
- [x] `npm run build` zero error
- [x] อัปเดต roadmap

## Phase E — DONE

### Scope
- เก็บ telemetry เฉพาะ product search ที่ไม่พบผลลัพธ์ (`resultCount = 0`) จาก storefront `/products/search` และ admin `/admin/products`
- เพิ่ม `ProductSearchLog` สำหรับ query, filters, source, path, resultCount, createdAt
- เขียน log แบบ best-effort เพื่อไม่ให้ search page ล่มถ้า telemetry fail
- แสดง Top 10 ล่าสุดบน Daily Operations Dashboard พร้อมลิงก์ไป report
- เพิ่ม report `/admin/reports/product-search` สำหรับดูรายการล่าสุด, filter ตามช่วงวันที่/source/query, และ Top 10 query ในตัวกรอง

### Checklist
- [x] เพิ่ม schema `ProductSearchLog` พร้อม `@db.Timestamptz(3)` และ index สำหรับ dashboard/report
- [x] เพิ่ม helper `lib/product-search-telemetry.ts` สำหรับ sanitize/truncate query/filter และ log แบบ best-effort
- [x] เพิ่ม test `scripts/test-product-search-telemetry.ts`
- [x] integrate telemetry ใน storefront search และ admin products search
- [x] เพิ่ม widget บน Daily Operations Dashboard: no-result latest Top 10 + link report
- [x] เพิ่ม report route `/admin/reports/product-search`
- [x] sync ReportTabNav, admin navigation, และ Quick Search coverage ผ่าน `admin-navigation`
- [x] backup/restore รองรับ `ProductSearchLog`
- [x] `prisma generate`, `prisma db push`, `prisma validate`, test script, และ `npm run build` ผ่าน
