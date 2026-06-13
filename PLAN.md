# ศรีวรรณ อะไหล่แอร์ - Active Plan

## Purpose
- ไฟล์นี้เป็น entrypoint สำหรับ AI และคนที่เข้ามาทำงานต่อใน repo
- เก็บเฉพาะภาพรวมระบบ, งานที่กำลังทำ, งานที่ต้องตัดสินใจ, และลิงก์ไป source of truth
- รายละเอียดเก่าทั้งหมดถูก archive ไว้ที่ [docs/archive/PLAN-legacy-2026-05-21.md](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)

## Summary
- โปรเจกต์นี้คือระบบร้านอะไหล่แอร์รถยนต์ มี public storefront และ admin backoffice
- Tech หลัก: Next.js App Router, TypeScript strict, Prisma, PostgreSQL, NextAuth, Tailwind, Shadcn UI
- ระบบ stock ใช้ `StockCard` เป็น source of truth สำหรับ movement และ moving average cost
- กฎ cross-module สำคัญอยู่ใน [AGENTS.md](/D:/autoparts/AGENTS.md)
- ตอนนี้ phase ที่ยัง active หลักคือ Cash/Bank Lite และงานติดตามหลัง rollout บางส่วน

## Current Focus
- `Phase 6.6` โมดูลบัญชีธนาคาร/เงินสด Lite สำหรับธุรกิจเริ่มต้น
- ติดตาม manual/ongoing work ของ `Phase 7` ด้าน SEO, verification, และ content expansion
- Product Search Quality phase ถัดไป: Review Outcome Tracking, Fitment/Year remediation, Closed-Loop Measurement, และ Guarded Auto-Apply
- **Warranty Manual Mode + Cancel Flow (2026-05-28)** — เพิ่ม 2-mode บน `/admin/warranties/new` (WITH_SALE / NO_SALE) + ฟังก์ชันยกเลิกประกันที่สร้างเอง (เฉพาะ `createdVia = MANUAL`, hard delete, block ถ้ามี active claim) รายละเอียดอยู่ใน [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
- รักษาเอกสารให้ AI อ่านง่าย: ใช้ไฟล์นี้เป็น index และย้ายรายละเอียดลงเอกสารเฉพาะเรื่อง

## Current Priorities
- [ ] ยืนยันขอบเขตสุดท้ายของ `Phase 6.6` ก่อนแตะ schema และ flow บัญชี
- [ ] ระบุ source of truth ของ cash/bank posting, transfer, opening balance, และ report impact
- [ ] แตก detailed spec ของ Cash/Bank Lite เป็นเอกสารเฉพาะก่อนลงมือ implement
- [ ] ทยอยย้าย decision สำคัญจาก archive ไป `docs/decisions/`
- [ ] ทยอยย้าย detailed module specs จาก archive ไป `docs/specs/`

## Active Workstreams
### 1. Cash/Bank Lite
- สถานะ: ยังไม่เริ่ม implementation
- เอกสาร active: [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
- สิ่งที่ต้องกำหนดให้ชัดก่อน:
  - schema หลัก
  - transaction flows
  - report impact
  - reconciliation rules

### 2. SEO / AEO / AIO Follow-up
- สถานะ: baseline หลักเสร็จแล้ว แต่ยังมี external/manual work ต่อเนื่อง
- เอกสารอ้างอิง:
  - [docs/seo/phase-7-final-status-2026-04-03.md](/D:/autoparts/docs/seo/phase-7-final-status-2026-04-03.md)
  - [docs/seo/phase-7-follow-up-2026-04-03.md](/D:/autoparts/docs/seo/phase-7-follow-up-2026-04-03.md)
  - [docs/seo/phase-7-external-verification-2026-04-03.md](/D:/autoparts/docs/seo/phase-7-external-verification-2026-04-03.md)

### 3. Product Search Quality Follow-up
- สถานะ: Phase E + F1 + F2 เสร็จแล้ว, phase ถัดไปถูกเพิ่มใน roadmap
- เอกสาร active: [docs/specs/product-search-log-analysis.md](/D:/autoparts/docs/specs/product-search-log-analysis.md)
- สิ่งที่ต้องทำต่อ:
  - [x] Phase F3 - Review Outcome Tracking
  - [x] Phase F4 - Fitment/Year Remediation Flow
  - [x] Phase F5 - Closed-Loop Measurement
  - [x] Phase F6 - Guarded Auto-Apply
  - [x] Phase F7 - Search-quality hardening (2026-06-03, จาก production diagnostic)
    - [x] แก้ year-fragment bug: เลขชิ้นส่วน 4 หลัก (เช่น `1950`, `446610-1950`) ไม่ถูกตีความเป็นปีรถอีกต่อไป — `extractYearFromQuery` รับเฉพาะ token ปีเดี่ยว และ year-only query ใช้ UNION (text/code/oem ∪ fitment-year) แทน strict-only (`lib/product-search.ts`)
    - [x] กรอง bot/keyboard-mash/foreign-spam ออกจาก telemetry + จำแนกเป็น `review-noise` (`lib/search-noise.ts` wired เข้า `product-search-telemetry.ts` + `product-search-log-analysis.ts`)
    - [x] เติม synonym EN↔TH รุ่นรถยอดนิยมเชิงรุก 51 cluster (idempotent + audited): `prisma/scripts/seed-model-synonyms.ts` — SearchSynonym 134→143 terms
    - [x] (Phase F / concept-synonym) เติม synonym กลุ่มเคมีภัณฑ์/หมวดที่ขาด 4 cluster — น้ำยาล้างคอยล์ (P0482), น้ำยาล้างระบบแอร์ F-11 (P0458, แยกกลุ่ม), ใบพัดลม, คอนโทรลวาล์วคอมแอร์ — ทุกคำ grounded จาก ProductAlias จริง (idempotent + audited): `prisma/scripts/seed-concept-synonyms.ts` — SearchSynonym 143→147 terms
    - [x] (LINE skip rule) แก้ต้นเหตุจริงของอาการ "LINE ตอบคอยล์ทั้งที่ถามน้ำยาล้าง": `matchPartTypeToCategoryHint` ใช้ `.includes()` substring → ชื่อเคมีภัณฑ์/อุปกรณ์ (น้ำยาล้าง, ฟองน้ำ, น็อต, ฝาปิดวาล์ว ฯลฯ) ถูก map เข้าหมวดอะไหล่ผิดเป็น **hard category filter** (พบ 17/45 ตัวในหมวด "อะไหล่อื่นๆ" เสี่ยง). เพิ่ม `isAccessoryOrChemicalIntent()` + skip rule ใน `lib/line-fitment-resolve.ts` (เช็คทั้ง partType และ query text เต็ม ผ่าน `queryText` ที่ wire จาก `line-webhook-processor.ts`) → ข้าม category filter เฉพาะกลุ่มนี้ คง brand/model ไว้. ยืนยันจาก production `LineAiAuditLog` ว่า AI ไม่ได้ตัดคำ — `consolidatedQuery` ครบ แต่ `categoryName="คอยล์เย็น (Evaporator)"` คือตัวตัดทิ้ง
    - [x] (A-light / Thai segmentation) เพิ่ม `lib/thai-segment.ts` (`segmentThaiQueryTokens` ใช้ ICU `Intl.Segmenter`) ตัดคำไทยที่เขียนติดกัน → ป้อนเข้า required-token (LIKE-contains AND) ผ่าน `runStorefrontProductSearchWithRequiredTokenFallback` เฉพาะเมื่อตัดได้ ≥2 คำ (compound จริง) + อาศัย strict→fallback เดิมกัน regression. ไม่แตะ DB/index/trigger. ฝั่งเว็บได้ AND-precision วลีไทย; **note:** data issue 3 ตัว "น้ำมันคอมแอร์ EMKARATE/SUNOCO" ไฟล์ผิดหมวด (อยู่ "อะไหล่อื่นๆ" ควรอยู่ Compressor Oil) — ยังไม่แตะ รอยืนยัน
    - [ ] (พิจารณาภายหลัง) A-full: ตัดคำฝั่ง index (search_document) เพื่อ FTS เต็มรูป — งานใหญ่ ต้องย้าย doc-building มา app layer + re-index ทั้งหมด; ทำเฉพาะถ้า telemetry ชี้ว่า ranking ยังอ่อนหลัง A-light
    - [ ] (Ops) รีวิว no-result report รายสัปดาห์ → เติม SearchSynonym/ProductAlias สำหรับคำที่ miss จริง (ใช้หน้า `reports/product-search-no-result` ที่ตอนนี้กรอง noise แล้ว)

### 4. Shopee Open Platform Integration (โมดูลแยกอิสระ)
- สถานะ: **Phase A–E เสร็จ · Phase F core เสร็จ** (schema + sale-core refactor + create-sale service) · เหลือ Phase F UI (approval/filter/report/dashboard)
- หลักการ: แยกโมดูลออกจากระบบเดิมทั้งหมด (`lib/shopee/*`, `app/admin/(protected)/marketplace/*`, `app/api/shopee/*`) ไม่กระทบ logic หน้าร้าน/backoffice เดิม
- เอกสาร active:
  - [docs/shopee/README.md](/D:/autoparts/docs/shopee/README.md) — ภาพรวม + isolation principles
  - [docs/shopee/PLAN-shopee.md](/D:/autoparts/docs/shopee/PLAN-shopee.md) — checklist เต็มทุก phase
  - [docs/shopee/USER-TASKS.md](/D:/autoparts/docs/shopee/USER-TASKS.md) — งานที่เจ้าของร้านต้องทำเอง

### 5. LINE OA + AI Chat Hardening (2026-06-09)
- สถานะ: **review-driven hardening รอบแรกเสร็จสมบูรณ์** (13 ข้อจาก code review + `prisma db push` รัน index ใหม่แล้ว 2026-06-09)
- หลักการ: ปรับ reliability/performance ของ webhook + AI pipeline โดยไม่เปลี่ยน business logic / พฤติกรรมที่ลูกค้ารู้สึกได้
- ไฟล์หลัก: `app/api/line/webhook/route.ts`, `lib/line-webhook-processor.ts`, `lib/line-conversation-repository.ts`, `lib/line-ai-job-worker.ts`, `lib/line-intent-router.ts`, `app/api/line/ai-jobs/reconcile/route.ts`
- งานที่ทำเสร็จ:
  - [x] (1+3) แยก webhook เป็น ACK-ทันที + รัน profile lookup/AI pipeline ใน `after()` background → LINE ไม่ re-deliver, reply token ยังสดเมื่อ pipeline ถึงขั้นตอบ
  - [x] (2) Idempotency: catch P2002 บน `LineMessage.lineEventId` → `DuplicateLineEventError` กัน double-process จาก LINE re-delivery race
  - [x] (4) Atomic job claim ใน cron worker ด้วย `UPDATE ... FOR UPDATE SKIP LOCKED` กัน cron 2 รอบ pick job ซ้ำ
  - [x] (5) Reconciler cron `/api/line/ai-jobs/reconcile` (ทุก 10 นาที) mark OUTBOUND ที่ค้าง PENDING > 5 นาที เป็น FAILED
  - [x] (6) Per-event try/catch ใน processor loop → 1 event พังไม่ทำให้ทั้ง batch หยุด
  - [x] (7) แก้ comment ที่ระบุผิดว่า handoff notify ไม่ส่ง Telegram (จริงๆ ส่งทั้ง bell+Telegram ตาม Iron Rule)
  - [x] (8) ลบ `PRODUCT_HINT_RE` dead branch (default route ทำงานเหมือนกันอยู่แล้ว)
  - [x] (9) เปลี่ยน audit writes 7 จุด (debug/metric) เป็น fire-and-forget ตัด round-trip ออกจาก reply latency
  - [x] (10) Dedupe LINE profile fetch ต่อ userId ใน webhook payload เดียวกัน
  - [x] (11) เก็บ `pipelineDurationMs` ใน AI_SEND_DECISION audit เพื่อวัด p95
  - [x] (12) เพิ่ม composite index `LineAiAuditLog [conversationId, action, createdAt desc]` (schema แก้แล้ว + `prisma db push` แล้ว 2026-06-09)
  - [x] (13) Cap history แต่ละ turn ที่ 400 ตัวอักษร กัน Gemini prompt budget ล้น/ตอบถูกตัด
  - [x] (14) Sticker handler: สติกเกอร์ไม่เข้า search/handoff/notify pipeline อีกต่อไป — เดิมตก UNKNOWN → handoff → ตอบ "รับทราบค่ะ เดี๋ยวแอดมินมาดูแล" ซ้ำ + freeze AI + ping แอดมินทุกใบ. ใหม่: ทักทายครั้งเดียวเมื่อเป็น contact ใหม่/ห่าง > 6 ชม. (`lastCustomerMessageAt` snapshot), นอกนั้นนิ่งสนิท ไม่ตั้ง waiting_admin ไม่แจ้งเตือน (`handleStickerEvent` ใน `lib/line-webhook-processor.ts`) + เพิ่ม audit `STICKER_HANDLED` + 2 unit tests
  - [x] (15) AI-consolidated search query (แก้ปัญหา drip-feed): เดิมลูกค้าทยอยพิมพ์ ("คอยเย็น d max" → "ปี 06") แล้ว search ใช้แค่ข้อความล่าสุด "ปี 06" → เจอ 516 รายการมั่ว (ทั้งการ์ดสินค้า + ลิงก์ `?q=ปี 06`). ใหม่: `extractLineSearchIntent()` ใน `lib/line-ai-service.ts` (เดิม `consolidateLineSearchQuery`) ให้ Gemini รวมหัวข้อที่ลูกค้าตามหาจากบทสนทนาเป็นคำค้นเดียว (ชนิดอะไหล่+รุ่น+ปี, แปลงปีย่อ 2 หลัก) แล้ว `processLineAiReply` ป้อน query นั้นเข้า search แทน raw text (เรียกเฉพาะเทิร์น follow-up ที่มี history → เทิร์นแรกไม่เพิ่ม call). Fallback ปลอดภัย: Gemini off/error/ตอบ NONE → ใช้ logic เดิม (latest text + fitment carryover). แถมปิดรูรั่ว regex ใน `lib/line-fitment-extract.ts`: รองรับ "d max" เว้นวรรค + ขยาย "ปี NN" 2 หลัก (00–35) → ค.ศ. + audit `SEARCH_QUERY_CONSOLIDATED` + unit tests
  - [x] (16) จำกัดขอบเขตการค้นหา (option C — เคส "หม้อน้ำ mazda 2" เจอ 516):
    - **A. core search** (`lib/product-search.ts` + `lib/search-synonyms.ts`): เดิม FTS แตก token แล้ว **OR** กันทั้งหมด + เลขสั้น "2" กลายเป็น `2:*` → match ทุกปี 20xx → ระเบิด. ใหม่: `expandQueryTokenGroups()` แยก query เป็น "คอนเซ็ปต์" แล้ว `buildTsQueryExpression()` ทำ **AND ข้ามคอนเซ็ปต์ / OR ภายใน synonym** + เลข 1-2 หลักเป็น exact lexeme (ไม่ prefix). มี **OR-fallback**: ถ้า AND (หลายคอนเซ็ปต์) ได้ 0 แถว → รันซ้ำด้วย OR กันเคสเจอ 0. กระทบทั้งเว็บ+LINE
    - **B. LINE structured filters**: `extractLineSearchIntent()` คืน {query, partType, carBrand, carModel, year}; `resolveLineFitmentFilters()` (`lib/line-fitment-resolve.ts`) map ชื่อ → master data จริง (CarBrand/CarModel/Category, case-insensitive) แล้วส่งเป็น **hard filter** เข้า search ผ่าน bridge `fitmentHints` (+เพิ่ม `categoryName`). ปลอดภัย: hint ที่ resolve ไม่ได้จะถูก drop (ไม่ทำให้เจอ 0)
    - unit tests: tsquery builder 6 + parseLineSearchIntent 4 + processor (resolved fitment hints) 1
  - [ ] (17) Hybrid semantic search (Phase 1 — ยกระดับคุณภาพ retrieval) — **โค้ดเสร็จ + build ผ่าน, รอเปิดใช้งานจริง**:
    - **Gated ทั้งหมด** ด้วย env `PRODUCT_SEARCH_SEMANTIC=on` (default off) → ถ้าไม่เปิด/ไม่มี embedding/ล้มเหลว = lexical เดิมเป๊ะ ไม่กระทบ logic อื่น
    - embedding client: `generateGeminiEmbedding()` ใน `lib/google-ai-client.ts` (**gemini-embedding-001** ผ่าน `embedContent` + `outputDimensionality=768` — text-embedding-004 ไม่รองรับบน key นี้) ใช้ key rotation เดียวกับ generate (400/404 ไม่ cooldown key); helper `lib/embeddings.ts` (`embedQuery`, `embedTexts`, `buildProductEmbeddingText`, `toPgVectorLiteral`, `isSemanticSearchEnabled`)
    - schema (อนุมัติแล้ว, รันผ่าน `npm run db:setup-search-v2`): `CREATE EXTENSION vector` + `product_search_documents.embedding vector(768)` + HNSW cosine index. คอลัมน์ embedding ถูกกันออกจาก `refresh_product_search_document` upsert (เหมือน sales_count) → text refresh ไม่ลบ vector
    - backfill: `npm run backfill:embeddings` (`prisma/scripts/backfill-embeddings.ts`, batch 50, idempotent, `--all` เพื่อ re-embed)
    - sync ตอนแก้สินค้า: `reembedProductSearchDocument()` (`lib/product-embedding-sync.ts`) เรียกผ่าน `after()` ใน createProduct/updateProduct (fire-and-forget, ไม่ block response)
    - hybrid ใน `searchProductIdsV2`: vector recall (cosine, reuse exactScope filters เดิม) → inject เป็น candidate (`OR v.product_id IS NOT NULL`) + score boost (sim × 500, ต่ำกว่า exact/oem/contains) ใน ranked query เดียว → pagination/total semantics คงเดิม
    - unit tests: embeddings helpers 4
    - resolver part-type→category: `matchPartTypeToCategoryHint()` ใน `lib/line-fitment-resolve.ts` map คำที่ลูกค้า/AI พูด ("วาล์วแอร์", "คอยเย็น", "แผงแอร์"...) → หมวดจริงในระบบ (19 หมวด, alias เรียง specific→generic กันชน "วาล์ว"/"หม้อน้ำ"/"คอม") ก่อน fallback equals/contains → category hard filter ทำงานแม้คำพูดไม่ตรงชื่อหมวด + unit tests 3
    - **ขั้นตอนเปิดใช้:** 1) `npm run db:setup-search-v2` ✅ (รันแล้ว — vector ext + คอลัมน์ + HNSW) 2) `npm run backfill:embeddings` ✅ (embed 598/598 สำเร็จ) 3) ตั้ง `PRODUCT_SEARCH_SEMANTIC=on` ใน Vercel env **(เหลือขั้นนี้ — production ยังไม่เปิด)**
    - ทดสอบจริงแล้ว: "หม้อน้ำ mazda 2" → หม้อน้ำ Mazda 2 ขึ้นอันดับ 1 (sim 0.84), "ตัวทำความเย็นแอร์วีออส" → เจอคอยล์เย็น/แผงแอร์ Vios (semantic เข้าใจคำบรรยาย)

  - [x] (18) Intent-gated retrieval (กันสินค้าหลุดมาตอบคำถามทั่วไป — เคส "ร้านอยู่ที่ไหน" ดันรายการคอมแอร์ Vigo + การ์ดมาด้วย):
    - **A.** ขยาย `SHOP_INFO_RE` ใน `lib/line-intent-router.ts` ครอบ "ร้านอยู่ที่ไหน/อยู่ที่ไหน/พิกัด/แผนที่/ไปยังไง/เปิดไหม/สาขา..." → route SHOP_INFO (ตอบ canned ไม่ค้น ไม่แปะการ์ด)
    - **B.** `extractLineSearchIntent` คืน `isProductQuery` — ถ้าข้อความล่าสุดไม่ใช่การหาสินค้า (ถามข้อมูลร้าน/ทักทาย/ขอบคุณ/คุยเล่น) → `isProductQuery=false`, query=null. `processLineAiReply` gate: non-product turn → **ข้าม search + ไม่แปะการ์ด + ไม่ carryover** (audit `SEARCH_SKIPPED_NON_PRODUCT`) ไม่ให้บริบทสินค้าเก่าหลุดเข้าคำตอบ
    - unit tests: processor non-product 1 + parse isProductQuery 2

  - [x] (19) Latency: ตอบให้ทันใน reply-token window (ฟรี ไม่ต้องใช้ push) — ข้อมูลจริงพบ tail หลุด 60-118 วิ จาก Gemini call ค้างชน timeout 30 วิ แล้ว rotate key สะสม:
    - **(1)** เพิ่ม `timeoutMs`+`maxKeyAttempts` ใน `generateGeminiContent`; chat calls (generate/extract/purchase-intent/faq) ใช้ `CHAT_CALL_TIMEOUT_MS=15s` + `CHAT_MAX_KEY_ATTEMPTS=3` → key ที่ค้าง fail over เร็ว ไม่เผา 30 วิ (งาน embedding/backfill ใช้ default เดิม)
    - **(2)** รัน `classifyPurchaseIntent` + `generateLineSuggestion` แบบขนาน (เริ่ม generate ล่วงหน้าใน product path) → ตัด 1 call ออกจาก critical path; ผลลัพธ์เหมือนเดิม
    - **(3)** Deadline guard: race reply gen กับเวลาที่เหลือใน token window (margin 5s); ถ้าไม่ทัน → `buildJuneDeadlineReply()` ตอบสไตล์จูน + แสดงสินค้า/การ์ดชุดเดิมครบ (ต่างแค่ถ้อยคำ) ส่งทัน reply token เสมอ + audit `AI_DEADLINE_FALLBACK`
    - unit tests: deadline fallback 1; รวม LINE suite 43+ ผ่าน

  - [x] (20) AI Intent Classifier (hybrid routing — แทน regex จับกลุ่มคำที่เปราะ):
    - `lib/line-intent-groups.ts` (ใหม่): 12 กลุ่ม (`product`/`shop_info`/`general_faq`/`payment`/`shipping_address`/`order_status`/`price_negotiation`/`claim_or_return`/`purchase`/`greeting`/`social`/`other`) + `groupToRoute`/`intentToGroup`/`GUARD_GROUPS` (single source of truth)
    - `extractLineSearchIntent` → คืน `group` + product fields, ทำงาน **ทุกข้อความ** (รวมข้อความแรก, A=ข); ไม่มั่นใจ → `other`
    - processor: Layer-1 regex (guard payment/claim/price/purchase override + เมนู) → Layer-2 AI group → route ตามกลุ่ม (reuse forced-response/handoff/policy เดิม)
    - `general_faq`/`other` → ลอง FAQ ก่อน, ไม่เจอ → `buildJuneAskDetailsReply()` ถามต่อสไตล์จูน (ไม่ handoff/ไม่ dead-end)
    - `social` → `handleSocialTurn`: ack สั้น หรือนิ่งถ้าเป็น ack ปิดท้าย (กันวนซ้ำ)
    - safety: **ไม่มี flag เปิดใช้เลย**; classify ล่ม → fallback regex routing; รูปภาพไปทาง image path เดิม (text classifier เฉพาะข้อความ); เคารพ paused/waiting_admin (ไม่เด้งแทรกตอนแอดมินรับช่วง); audit `INTENT_CLASSIFIED {group, source, routedIntent}` + `SOCIAL_HANDLED`; classify timeout 15s
    - unit tests: groups mapping 6 + parse group 7 + processor (social/shop_info/paused/non-product/FAQ) + เดิมทั้งหมด

### 6. Image Egress Reduction — Vercel CDN Proxy (2026-06-11)
- บริบท: Supabase Free ใกล้ชน limit Egress (3.675/5GB) + Cached Egress (3.662/5GB, เข้า grace period ถึง 15 มิ.ย.) ขณะที่ Vercel Pro มี headroom เหลือมาก ($5.43/$20) → ย้ายการ serve รูปสินค้าไปผ่าน Vercel CDN
- หลักการ: client / crawler / next-image optimizer → `/img/<objectPath>` (Vercel CDN cache, immutable 1 ปี) → Supabase Storage (ดึงครั้งเดียวต่อ cache window) ไม่แตะข้อมูลใน DB
- [x] เพิ่ม `lib/product-image-url.ts` — pure URL helper (no `@supabase/supabase-js`, client-safe) + `toProductImageCdnPath()` (idempotent, no-op กับ url ที่ไม่ใช่ product bucket); `product-image-storage.ts` re-export ให้ importer เดิมไม่ต้องแก้
- [x] เพิ่ม route handler `app/img/[...path]/route.ts` — proxy public object จาก Supabase + `Cache-Control: public, max-age/s-maxage=31536000, immutable`; จำกัดเฉพาะ object path ใน bucket `products/` (กัน open proxy)
- [x] ยกเว้น `/img` จาก middleware matcher (`proxy.ts`) — ไม่ให้ auth()/bot-check รันต่อ request รูป
- [x] ชี้ `next/image` src ผ่าน `/img` ทุกจุดที่ render รูปสินค้า: `ProductCard`, `ProductImageGallery`, `ProductImageZoomLightbox`, `ProductAutocomplete`, admin `ProductImagePreview` / `ProductForm` (display เท่านั้น, formData/DB คงเป็น URL Supabase เดิม) / `products/search`
- [x] JSON-LD/ItemList ใช้ absolute CDN URL: `ProductJsonLd` (product detail), `products/page.tsx`, `products/[categorySlug]/page.tsx` → ตัด bot ดูดรูปจาก Supabase ตรง
- [x] 2026-06-12: ขยาย `/img` เป็น allowlisted public-storage proxy สำหรับ `products/settings/*`, `products/users/signatures/*`, `products/delivery-proofs/*`, และ bucket `line-chat/*` โดยยัง block path อื่นและ `payment-slips/*`
- [x] 2026-06-12: ชี้โลโก้ร้าน, LINE QR, ลายเซ็น, หลักฐานจัดส่ง, LINE chat image, icon/JSON-LD, และ LINE Flex placeholder ผ่าน `/img` แบบ render-time; ค่า URL ใน DB ยังเป็นค่าเดิม ไม่ต้อง migrate
- [x] 2026-06-12: payment slips ยังเป็น private signed URL และ render ด้วย native `<img>` แทน `next/image` เพื่อไม่นำข้อมูลส่วนตัวเข้า shared image optimizer/CDN cache
- [x] 2026-06-12: ลบ Supabase `images.remotePatterns` ออกจาก `next.config.ts` เพื่อบังคับไม่ให้ `next/image` ดึง Supabase ตรง; ยังเก็บ CSP `img-src` Supabase ไว้สำหรับ signed/private image และ fallback ที่ตั้งใจไว้
- [ ] (Ops) หลัง deploy: เฝ้าดู Supabase Egress/Cached Egress ควรลดลงชัดเจน + ตรวจ Vercel Image Optimization usage ไม่พุ่งเกินงบ
- [ ] (ทางเลือก, ยังไม่ทำ) migrate `Product.imageUrl`/`ProductImage.url` ใน DB ให้เป็น CDN path — ชะลอไว้เพราะกระทบ logic ownership ใน `product-image-storage.ts` และไม่จำเป็นเมื่อใช้ render-time helper แล้ว

## Source Of Truth Map
### Product and Inventory
- Stock movement + MAVG: `lib/stock-card.ts`
- Document numbers: `lib/doc-number.ts`
- VAT calculations: `lib/vat.ts`
- Prisma schema: `prisma/schema.prisma`
- Transaction item display snapshots: [docs/decisions/document-item-display-snapshot.md](/D:/autoparts/docs/decisions/document-item-display-snapshot.md)

### Admin Rules
- Cross-module delivery/print/theme/search rules: [AGENTS.md](/D:/autoparts/AGENTS.md)

### Planning Docs
- Architecture overview: [docs/architecture.md](/D:/autoparts/docs/architecture.md)
- Active roadmap: [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
- Completed roadmap: [docs/roadmap/completed.md](/D:/autoparts/docs/roadmap/completed.md)
- Decision log index: [docs/decisions/README.md](/D:/autoparts/docs/decisions/README.md)
- Spec index: [docs/specs/README.md](/D:/autoparts/docs/specs/README.md)

## How To Use This Repo As AI
1. อ่าน [AGENTS.md](/D:/autoparts/AGENTS.md) ก่อนเสมอ
2. อ่านไฟล์นี้เพื่อดู current focus และ source of truth
3. เปิด [docs/architecture.md](/D:/autoparts/docs/architecture.md) ถ้าต้องเข้าใจภาพรวมระบบ
4. ถ้างานยัง active ให้ดู [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
5. ถ้าต้องตัดสินใจเชิงธุรกิจหรือ implementation rule ให้ดู `docs/decisions/`
6. ถ้าต้องลงลึกเป็นโมดูล ให้ดู `docs/specs/`

## Archive
- Master plan เดิมแบบละเอียดมาก: [docs/archive/PLAN-legacy-2026-05-21.md](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)
- ห้ามใช้ archive เป็น entrypoint หลัก ยกเว้นต้องตาม historical detail
