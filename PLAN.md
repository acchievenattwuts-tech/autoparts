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
  - [x] (15) AI-consolidated search query (แก้ปัญหา drip-feed): เดิมลูกค้าทยอยพิมพ์ ("คอยเย็น d max" → "ปี 06") แล้ว search ใช้แค่ข้อความล่าสุด "ปี 06" → เจอ 516 รายการมั่ว (ทั้งการ์ดสินค้า + ลิงก์ `?q=ปี 06`). ใหม่: `consolidateLineSearchQuery()` ใน `lib/line-ai-service.ts` ให้ Gemini รวมหัวข้อที่ลูกค้าตามหาจากบทสนทนาเป็นคำค้นเดียว (ชนิดอะไหล่+รุ่น+ปี, แปลงปีย่อ 2 หลัก) แล้ว `processLineAiReply` ป้อน query นั้นเข้า search แทน raw text (เรียกเฉพาะเทิร์น follow-up ที่มี history → เทิร์นแรกไม่เพิ่ม call). Fallback ปลอดภัย: Gemini off/error/ตอบ NONE → ใช้ logic เดิม (latest text + fitment carryover). แถมปิดรูรั่ว regex ใน `lib/line-fitment-extract.ts`: รองรับ "d max" เว้นวรรค + ขยาย "ปี NN" 2 หลัก (00–35) → ค.ศ. + audit `SEARCH_QUERY_CONSOLIDATED` + unit tests (processor 2 + fitment 3)

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
