# Keyword-First Search + LINE-Grade Submit Precision

สถานะ: implemented (2026-06-27)

## เป้าหมาย
1. **Autocomplete หน้าบ้านต้องเร็วระดับ Shopee** — ตอนพิมพ์ไม่แตะสินค้าจริง
2. **ผลตอน submit ต้องตรง** — หมวด/ยี่ห้อรถ/รุ่น/ปี ไม่กว้าง ไม่โชว์ของที่ไม่ได้หา (logic เดียวกับ LINE OA)

## ปัญหาเดิม (วัดจาก production จริง)
- แคตตาล็อกเล็ก (~790 สินค้า) แต่ auto-search ยิงเครื่องค้นหา V2 เต็ม **ทุก keystroke**
- V2 ใช้ `similarity()` (trigram) บนหลายคอลัมน์ → ไม่ใช้ GIN index (รูปแบบ `>= threshold`) → full scan
- วัดจริง: trigram scan ตารางเดียว 797 แถว = **139–475 ms ต่อครั้ง** + transaction (pooler) + อาจมี Gemini embedding ต่อ keystroke + double-pass (strict→fallback)

## สถาปัตยกรรมใหม่

### A. Keyword-first autocomplete (ตอนพิมพ์)
- ตาราง `SearchKeyword` (`prisma/schema.prisma`): `term, normalized, kind(category|partsBrand|carBrand|carModel|product|synonym), sublabel, popularity` + `@@index([normalized])`
- เติมจากข้อมูลที่มีอยู่: master tables + ชื่อสินค้า + `SearchSynonym` + hot queries จาก `ProductSearchLog` (เฉพาะ resultCount>0)
  - lib: [lib/search-keyword-index.ts](/D:/autoparts/lib/search-keyword-index.ts) (`buildSearchKeywordRows`, `refreshSearchKeywordIndex`, `querySearchKeywords`)
  - refresh: upsert (ON CONFLICT (normalized,kind)) + ลบเฉพาะ stale ใน transaction เดียว — คง id/createdAt, ไม่ truncate
  - กลไกเรียก refresh (best-effort + safety net):
    - **best-effort ต่อการแก้ข้อมูล** ผ่าน `triggerSearchKeywordRefresh()` (fire-and-forget) ที่ฝังใน `revalidateStorefrontCaches()` (ครอบคลุมการแก้สินค้า) และใน helper revalidate ของ master actions: categories / car-brands (รวมรุ่นรถ) / parts-brands / search-synonyms
    - **safety net** cron `/api/search/cron/refresh-keywords` (vercel.json 18:30 UTC daily) + manual `npm run refresh:search-keywords` — ครอบคลุมทุกชนิดข้อมูล
    - หมายเหตุ: บน serverless การ fire-and-forget อาจถูกตัดก่อนจบ → cron คือกลไกที่การันตี
- endpoint เบา: [app/api/search/keywords/route.ts](/D:/autoparts/app/api/search/keywords/route.ts) — prefix lookup เดียว (btree) คืน "คำ" ล้วน → วัดได้ ~40ms (เทียบ 139–475ms เดิม)
- UI: [components/shared/ProductAutocomplete.tsx](/D:/autoparts/components/shared/ProductAutocomplete.tsx) — โหมด `enhanced` (storefront) แสดงรายการคำแบบ Shopee, เลือกคำ → submit ค้นหาจริง. โหมด admin (default variant) ยังใช้การ์ดสินค้าเหมือนเดิม

### B. Submit ใช้ logic LINE OA
- pipeline รวมศูนย์: [lib/storefront-search-intent.ts](/D:/autoparts/lib/storefront-search-intent.ts) (`resolveStorefrontSearchIntent`)
  1. `extractLineSearchIntent` (LLM classify) → partType/carBrand/carModel/year
  2. `guardLineSearchIntent` → เก็บเฉพาะ ยี่ห้อ/รุ่น/ปี ที่ลูกค้าพิมพ์จริง (ตัด hallucination/ค่าค้างจากเทิร์นก่อน) + required code tokens
  3. `resolveLineFitmentFilters` → map เป็นชื่อ master จริง (เป็น hard filter เฉพาะที่ resolve เจอ)
- wiring: `getStorefrontProductSearchPageData` ([lib/storefront-product-search.ts](/D:/autoparts/lib/storefront-product-search.ts)) เรียก pipeline เมื่อมี `q` และผู้ใช้ยังไม่ได้เลือก filter เอง + มี **year-drop retry** เมื่อผลเป็น 0 (เลียนแบบ bridge ของ LINE)

### Hybrid A — rule-first classify (ข้าม LLM เคสที่รู้จัก)
- [lib/known-query-intent.ts](/D:/autoparts/lib/known-query-intent.ts) (`resolveKnownQueryIntent`) — ถ้า **ทุก token** ของ query แตกเป็น dictionary term (SearchKeyword) / ปี 4 หลัก / รหัส ได้ครบ → derive intent (filters) โดย **ไม่เรียก Gemini** (1 indexed query แทน LLM)
- รองรับคำลำลองหมวดผ่าน `CategoryAlias` (เก็บใน SearchKeyword: normalized=คำลำลอง, term=ชื่อ canonical → ใช้เป็น hard filter ได้)
- เคสรู้จัก: `Toyota`, `Vios`, `Toyota Vios`, `คอมแอร์ Toyota Vios 2015`, รหัส `W3-7044` / เคสไม่รู้จัก (→LLM): คำที่ไม่มีใน dictionary, ประโยคธรรมชาติ, ปีลอย ๆ, คำเหลือที่ตีความไม่ได้
- **เว็บ:** known != null → ข้าม LLM ได้เลย (ไม่มี context ข้ามเทิร์น)
- **LINE:** ข้าม LLM เฉพาะ `contextFree` (มีทั้ง part+vehicle หรือมีรหัส) เพื่อรักษา context-merge/ multi-subject ของ LLM ไว้กับเคสที่อาจต้องต่อความ; audit log บันทึก source = `rule_dictionary`
- coverage ของหมวดขึ้นกับ `CategoryAlias` ที่ร้าน curate — เพิ่ม alias แล้ว refresh จะติดเอง

### กันช้า (รักษาธง "ต้องไว")
- cache ผล classify ต่อ normalized query 1 วัน (`unstable_cache`, tag `PRODUCT_SEARCH_TAG`) → query ซ้ำไม่เรียก Gemini อีก
- query รหัสล้วน (เช่น `W3-7044`) ข้าม LLM → required-token path ตรงๆ
- classify null/timeout/ไม่มี key → degrade เป็น literal + required tokens (ไม่แย่กว่าเดิม)

## พฤติกรรมที่เปลี่ยน
- dropdown หน้าบ้าน = คำล้วน (ไม่เห็นรูป/ราคาตอนพิมพ์) — เห็นสินค้าจริงหลังเลือกคำ/กดค้นหา
- ผล submit "ตรงแต่แคบ" ขึ้น; submit ครั้งแรกของคำใหม่ช้าลงเล็กน้อย (LLM ก่อนเข้า cache)
- admin product search ไม่เปลี่ยน

## งานต่อ / ที่ต้องเฝ้า
- [ ] ดู match rate + ความพอใจคำแนะนำ แล้วปรับ popularity weighting
- [ ] พิจารณาตัด product term ที่ยาวมากออกจาก suggestion ถ้ารก
- [ ] เฝ้า Gemini quota หลัง rollout (แม้ cache แล้ว)
