# Product Search — Quality Improvements (Round 2)

## Purpose
ต่อยอดจาก `product-search-overhaul.md` (Phase A-E เสร็จแล้ว) — เพิ่มคุณภาพการค้นหาทั้งในมุมลูกค้าและ admin

## Scope (Confirmed by Human)
1. **Autocomplete dropdown** — search-as-you-type ทั้ง storefront + admin product list
2. **`unaccent` extension** — Postgres extension รองรับการสะกดที่มีอักษรประกอบ
3. **Backfill audit report** — หน้า `/admin/reports/search-coverage` แสดงสินค้าที่ขาดข้อมูล
4. **"Did you mean" suggestion** — แสดงคำที่น่าจะถูกเมื่อ no-result
5. **Match highlighting** — แสดง chip "ตรง OEM" / "ตรงรุ่น/ปี" / "ตรงคำพ้อง" ใต้ผลการค้น

## Out of Scope (รอ round ถัดไปตามที่ human ระบุ)
- LINE Bot (#12) — ทำหลังจาก round นี้
- Trending searches / Search history / Image search / Voice search ฯลฯ

## Iron Rules (Project)
- ห้ามขยาย scope เอง — เจอ dependency ใหม่ → รายงานเป็นข้อเสนอแยก
- Update both light + dark mode (AGENTS Theme Sync Rule)
- Update Quick Search coverage ถ้าเพิ่ม admin menu ใหม่ (AGENTS Quick Search Sync Rule)
- Admin search/report submit ใช้ `AdminSearchForm` + `AdminSearchSubmitButton` (AGENTS rule)
- ใช้ Gregorian calendar + `lib/th-date.ts` ตามนโยบาย
- ทุก mutation → AuditLog entry (.rules §7)
- Admin menu ใหม่ → 5-step setup (.rules §8)
- ห้ามใช้ `any`, ใช้ Zod ทุก mutation, ทุก async ต้องมี try-catch

---

## Phase Q1 — Autocomplete Dropdown

### Decisions (Confirmed)
- Q1.1: เฉพาะสินค้า 5-8 รายการ (ไม่รวม category/brand suggestions)
- Q1.2: ทั้ง storefront + admin product list

### Design
- Debounce **200ms** (มี SearchableSelect pattern อยู่แล้ว — copy concept)
- Max **8 results** ในการแสดง
- Min query length **2 chars**
- ใช้ search engine V2 ที่มีอยู่ (Phase A-E)
- แสดง: code · name · ราคา · มี/ไม่มีสต็อก · รูป thumbnail (ถ้ามี)
- กดเลือก → navigate ไปหน้า product detail / admin edit
- กด Enter ที่ input → ยิง full search ปกติ

### Checklist — DONE
- [x] สร้าง API endpoint `/api/search/products/autocomplete` (active only, debounce-cache 30s, rate limit 60/นาที, max 8 results, min 2 chars)
- [x] สร้าง `components/shared/ProductAutocomplete.tsx` — debounce 200ms + keyboard (↑↓ Enter Esc) + dark mode + accessibility (combobox/listbox roles)
- [x] สร้าง `components/shared/StorefrontSearchForm.tsx` — wrapper สำหรับ navbar (mobile + desktop variants)
- [x] แทนที่ form ใน `StorefrontNavbar.tsx` ทั้ง 2 variant
- [x] แทนที่ search input ใน `ProductFilterForm.tsx` (admin) — keep `name="search"` hidden, Enter ไม่เลือก suggestion = ส่งฟอร์มปกติ
- [x] Light + Dark mode
- [x] `npm run build` zero error

---

## Phase Q2 — Postgres `unaccent` Extension

### Decisions
- ใช้ `unaccent` extension มาตรฐานของ Postgres (Supabase รองรับ)
- รวม `unaccent()` ใน search SQL ทุกที่ที่ทำ `lower()` comparison

### Checklist — DONE
- [x] เพิ่ม `CREATE EXTENSION IF NOT EXISTS unaccent;` + `f_unaccent()` IMMUTABLE wrapper
- [x] อัปเดต `build_product_search_text` ห่อ tsvector ด้วย `f_unaccent()`
- [x] เพิ่ม functional GIN indexes (`f_unaccent(search_text)`, name, oem, keyword)
- [x] อัปเดต `lib/product-search.ts` — ทุก `lower(x)` เปลี่ยนเป็น `f_unaccent(lower(x))` ในทั้ง scoring/WHERE/similarity
- [x] tsQuery ผ่าน `f_unaccent()` ให้ตรงกับ index
- [x] รัน rebuild ผ่าน `npm run db:setup-search-v2` (9/9 indexed)
- [x] `npm run build` zero error

---

## Phase Q3 — Backfill Audit Report (`/admin/reports/search-coverage`)

### Decisions
- หน้าใหม่ใต้ `/admin/reports/search-coverage` (ตาม pattern reports ปัจจุบัน)
- Permission: piggyback `reports.view` (ไม่สร้างใหม่ — เป็นรายงาน ไม่ใช่ data mutation)
- **No mutation** — read-only report
- ไม่ต้องเขียน AuditLog (read-only)

### แสดงข้อมูล
- สรุปบนสุด: % สินค้าที่มีข้อมูลครบ
- ตาราง: product code · name · ขาดอะไร (chips: ขาด OEM, ขาด keyword TH, ขาดรูป, ขาด fitment)
- Filter: เลือก "ขาดเฉพาะ X"
- Sort default: ขาดข้อมูลมากที่สุดก่อน

### Definition of "ครบ"
| ฟิลด์ | ครบเมื่อ |
|---|---|
| OEM | มี `ProductAlias` อย่างน้อย 1 รายการ kind ∈ {OEM, PART_NO} |
| Keyword TH | มี `ProductAlias` kind ∈ {KEYWORD, TH, MISSPELL, ALIAS} ที่มีตัวอักษรไทย |
| รูป | `imageUrl` ไม่ว่าง |
| Fitment | มี `ProductFitment` อย่างน้อย 1 row |

### Checklist — DONE
- [x] สร้าง `app/admin/(protected)/reports/search-coverage/page.tsx` + loading.tsx
- [x] ใช้ `reports.view` ที่มีอยู่แล้ว (ครอบคลุมโดย `/admin/reports` catch-all rule — ไม่ต้องเพิ่ม)
- [x] เพิ่มใน AdminSidebar กลุ่ม "รายงาน" + Quick Search keywords ("search coverage audit backfill ขาดข้อมูล oem keyword รูป รุ่นรถ")
- [x] รองรับ `?filter=all|missing_oem|missing_keyword|missing_image|missing_fitment` ใช้ `AdminSearchForm` + `AdminSearchSubmitButton` (AGENTS rule compliant)
- [x] Summary cards 5 ตัว (coverage %, missing OEM/keyword/image/fitment counts)
- [x] Sort: ขาดข้อมูลมากสุดก่อน
- [x] Light + Dark mode
- [x] `npm run build` zero error

---

## Phase Q4 — "Did you mean" Suggestion

### Decisions
- แสดงเฉพาะเมื่อ search **ไม่เจอ** หรือเจอน้อยกว่า 3 รายการ
- ใช้ trigram `similarity()` กับ product names + aliases + `SearchSynonym.term` (top 3 candidates)
- กดที่ suggestion → redirect ไป search ด้วย term นั้น

### Checklist — DONE
- [x] เพิ่ม `suggestDidYouMean(query, limit)` ใน `lib/product-search.ts` (trigram จาก Product.name + ProductAlias.alias + SearchSynonym.term, threshold 0.25)
- [x] Integrate storefront `/products/search/page.tsx` (chip suggestion ใต้ "ไม่พบสินค้า") — แสดงเมื่อ total < 3
- [x] Integrate admin product list (chip suggestion ใต้ row "ไม่พบสินค้า")
- [x] Light + Dark mode
- [x] `npm run build` zero error

---

## Phase Q5 — Match Highlighting

### Decisions
- แสดงทั้ง storefront ProductCard + admin product list row
- แสดง chip **เฉพาะเมื่อ** มี query (ไม่ใช่ browse mode)
- chip ต้องคำนวณจากผลการ match (ส่งจาก server)

### Match Categories
| Chip | เงื่อนไข | สี |
|---|---|---|
| `ตรง OEM` | match `oem_text` token | น้ำเงิน |
| `ตรงรหัส` | exact `product_code` | indigo |
| `ตรงรุ่น/ปี` | fitment year match | เขียว |
| `ตรงคำพ้อง` | match `keyword_text` หรือ synonym expansion | emerald |
| `ตรงชื่อ` | match `product_name` | slate |

### Checklist — DONE
- [x] ขยาย search engine return `matchReasons: Record<productId, ProductMatchReason[]>`
- [x] `ProductSearchResult.matchReasons` (optional) + early-return branches set ด้วย
- [x] สร้าง `components/shared/ProductMatchChips.tsx` (sortable + compact mode + dark mode)
- [x] ProductCard รับ `matchReasons` prop optional + render compact ใต้ compatibility line
- [x] Admin product list row แสดง chip เดียวกัน (เฉพาะเมื่อมี search query)
- [x] `npm run build` zero error

---

## Performance Considerations
- Autocomplete อาจกระทบ DB load → ใช้ debounce 200ms + cache (`unstable_cache` 60s) + LIMIT 8
- Match highlighting → ต้องคำนวณ CASE WHEN ใน SQL ที่ score คำนวณอยู่แล้ว → ไม่มี extra query
- `unaccent()` มี overhead เล็กน้อย แต่ index ใช้ functional GIN ได้ → ต้องสร้าง index ใหม่
- Backfill audit page → query หนัก ถ้าสินค้าเยอะ → ใช้ `take: 200` + filter

## Open Questions (ตอบไว้แล้ว)
- Q1.1: A — เฉพาะสินค้า
- Q1.2: A — ทั้ง storefront + admin
- LINE Bot: รอ round ถัดไป

## Dependency Watch (รายงานเท่านั้น — ไม่ทำเอง)
- ถ้า autocomplete ต้องใช้ websocket หรือ stream → out of scope, แค่ HTTP GET ก็พอ
- ถ้า `unaccent` ทำให้ similarity threshold เดิม (0.18/0.20) ต้องปรับ → จะรายงานหลังทดสอบ
