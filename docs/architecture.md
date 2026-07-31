# Architecture Overview

## Purpose
- ไฟล์นี้สรุปโครงสร้างระบบระดับสูงเพื่อให้ AI และคนใหม่เข้าใจ repo ได้เร็ว
- ถ้าต้องการดูงานค้าง ให้ไป [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)

## System Summary
- ระบบนี้รองรับร้านอะไหล่แอร์รถยนต์
- มี 2 พื้นที่หลัก:
  - public storefront สำหรับหน้าร้าน
  - admin backoffice สำหรับขาย, ซื้อ, สต็อก, เอกสาร, รายงาน, และ setting

## Stack
- Framework: Next.js App Router
- Language: TypeScript strict mode
- UI: Tailwind CSS + Shadcn UI + Lucide
- Validation: Zod
- ORM: Prisma
- Database: PostgreSQL
- Auth: NextAuth.js v5
- Deploy: Vercel
- Storage: Supabase Storage

## Main Domain Areas
- Product master
- Customer master
- Purchase and purchase return
- Sale and fulfillment
- Accounts receivable and receipts
- Warranty and warranty claim
- Stock control and moving average cost
- Reporting
- SEO/content for storefront

## Key Business Rules
- `StockCard` เป็น source of truth ของ stock movement
- Transaction item rows keep base-unit fields for stock/accounting and display snapshot fields for the original user-entered quantity, unit, and unit price.
- เอกสาร print หลายหน้า share presentation rules และต้อง sync กันตาม [AGENTS.md](/D:/autoparts/AGENTS.md)
- Admin navigation และ quick search ต้อง sync กัน
- งาน UI admin ต้องดูทั้ง light/dark mode
- Date/time field ใหม่ใน Prisma ต้องใช้ `@db.Timestamptz(3)`

## AI Search and Knowledge RAG

- Product Search และ Knowledge RAG แยกดัชนี แยก embedding model และแยกหน้าที่อย่างชัดเจน
- Product Search ใช้ `product_search_documents`; ห้ามเปลี่ยน routing หรือผลการค้นหาสินค้าเพื่อเพิ่มความสามารถ RAG
- Knowledge RAG ใช้ `knowledge_documents` สำหรับคำถามความรู้ทั่วไปที่ผ่านอนุมัติเท่านั้น และใช้ร่วมกันทั้ง LINE/Facebook Messenger
- เรื่องประกัน คืนสินค้า ค่าจัดส่ง และการจัดส่งเป็น admin-only: router, channel processor, RAG runtime, CMS validation และ publisher ป้องกันซ้ำแบบ defense in depth
- Telemetry ของ RAG ห้ามเก็บข้อความคำถาม/คำตอบหรือข้อมูลระบุตัวลูกค้า เก็บเฉพาะ query hash และค่าการทำงานเชิง aggregate
- Retrieval policy มี source of truth ที่ `lib/knowledge-rag-retrieval-policy.ts`; runtime และ production check ต้องใช้ weight/threshold/exclusion ชุดเดียวกัน การทดลอง candidate ทำแบบ read-only และห้าม rollout หาก retrieval/admin-only/hard-negative ต่ำกว่า baseline หรือ latency เกินงบ
- Round C telemetry ระบุ retrieval version/policy เพิ่ม แต่ตัว aggregate exporter จะไม่ส่งออก query hash รายตัว ใช้สำหรับเทียบ outcome, answer/no-answer และ latency แยก LINE/Messenger โดยไม่เก็บข้อความลูกค้า
- Round D เก็บเฉพาะ aggregate รายวันใน `knowledge_rag_daily_metrics`, feedback แบบ closed reason code ใน `knowledge_rag_feedback` และ gap signals แบบ query hash ใน `knowledge_rag_gap_signals`; ห้ามเพิ่ม customer text/id หรือ conversation id
- Gap จะสร้าง Knowledge draft ได้หลังสถานะ `REVIEWED` เท่านั้น และ draft ต้องเริ่มที่ `ragEnabled=false` ก่อนผ่าน governance/approval/publish pipeline เดิม
- Sync/quality failure แจ้งผู้ดูแลผ่าน Notification และยังคง active revision เดิมเสมอ; runbook อยู่ที่ `docs/runbooks/knowledge-rag-operations.md`
- Governance ของคลังความรู้เก็บแบบ versioned ใน `KnowledgeRevision.content.governance`; claim-level evidence อยู่ใน `sections[].evidenceUrls` และ publisher ส่ง `valid_until` ลงแต่ละ Knowledge chunk
- Approval และ publisher ต้องผ่าน corpus quality gate: active owner, review/expiry, evidence/checklist, duplicate/conflict และ freshness
- Source of truth และแผนต่อยอดอยู่ที่ [docs/specs/knowledge-rag-roadmap.md](/D:/autoparts/docs/specs/knowledge-rag-roadmap.md)

## Suggested Reading Order
1. [AGENTS.md](/D:/autoparts/AGENTS.md)
2. [PLAN.md](/D:/autoparts/PLAN.md)
3. [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
4. เอกสาร decision/spec ที่เกี่ยวข้องกับงาน

## Important Source Of Truth
- Schema: `prisma/schema.prisma`
- Stock engine: `lib/stock-card.ts`
- VAT utility: `lib/vat.ts`
- Doc numbering: `lib/doc-number.ts`

## Documentation Layout
- Active plan: [PLAN.md](/D:/autoparts/PLAN.md)
- Active roadmap: [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
- Completed roadmap: [docs/roadmap/completed.md](/D:/autoparts/docs/roadmap/completed.md)
- Decisions: [docs/decisions/README.md](/D:/autoparts/docs/decisions/README.md)
- Specs: [docs/specs/README.md](/D:/autoparts/docs/specs/README.md)
- Historical archive: [docs/archive/PLAN-legacy-2026-05-21.md](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)
