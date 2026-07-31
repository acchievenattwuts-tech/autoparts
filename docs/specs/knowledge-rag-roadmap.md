# Knowledge RAG Roadmap

## เป้าหมาย

ยกระดับคำตอบความรู้ทั่วไปใน LINE และ Facebook Messenger ให้ถูกต้อง วัดผลได้ และดูแลผ่าน Knowledge CMS โดยไม่เปลี่ยนเส้นทางค้นหาสินค้า ผลลัพธ์สินค้า หรือดัชนีสินค้าเดิม

## ขอบเขตที่ล็อกไว้

- Product Search เป็นระบบแยก: ใช้ `product_search_documents` และ embedding model ของสินค้าเดิม
- Knowledge RAG ใช้ `knowledge_documents` และ `GOOGLE_AI_KNOWLEDGE_EMBEDDING_MODEL` (`gemini-embedding-2:768` ใน production ปัจจุบัน)
- RAG ห้ามยืนยันสินค้า ราคา สต็อก โปรโมชัน ความตรงรุ่น การชำระเงิน ออเดอร์ ใบเสนอราคา COD หรือผลเคลม
- เรื่องประกัน การคืนสินค้า ค่าจัดส่ง และการจัดส่ง ต้องส่งให้แอดมินในแชตเดิมเสมอ ทั้ง LINE และ Facebook Messenger
- เนื้อหาหัวข้อข้างต้นยังเผยแพร่บนหน้าร้านได้ แต่ห้ามสร้าง Knowledge RAG chunk

## สถาปัตยกรรมความปลอดภัย

1. Intent router ตรวจหัวข้อที่ต้องส่งแอดมินก่อนค้นความรู้
2. LINE และ Messenger ใช้กฎและข้อความส่งต่อชุดเดียวกัน
3. Knowledge RAG มี runtime guard ป้องกันกรณี intent ถูกจัดผิด
4. Knowledge CMS ตรวจตอนบันทึก ตอนส่งอนุมัติ และตอนอนุมัติเผยแพร่
5. Publisher ตรวจซ้ำและไม่สร้าง chunk จากเนื้อหาที่ต้องให้แอดมินตอบ แม้มีการเรียก action หรือ job โดยตรง
6. Query retrieval ตัด source เก่าที่เป็นนโยบายประกัน/คืนสินค้าออกระหว่างช่วงเปลี่ยนผ่าน

## การวัดผลมาตรฐาน

คำสั่ง `npm run check:knowledge-rag` ตรวจ production ด้วย `.env.local` ดังนี้:

- health ของ `knowledge_documents` และสถานะ automatic sync
- embedding ของ Knowledge ครบและใช้ model ที่กำหนด
- Knowledge embedding model ไม่ถูกใช้ใน `product_search_documents`
- golden retrieval 10 คำถาม ต้องพบ source ที่กำหนดใน Top 5
- admin-only guard 24 รูปแบบ ต้องจำแนกหัวข้อถูกต้องทั้งหมด

Baseline Round A วันที่ 2026-07-30: retrieval `10/10`, admin-only `24/24`, Knowledge model `gemini-embedding-2:768`, Product model `gemini-embedding-001:768`

Baseline Round B วันที่ 2026-07-31: retrieval `13/13`, admin-only `24/24`, corpus quality `38/38` sources, approved Knowledge chunks `40/40` embedded, Product Search ยังคง `gemini-embedding-001:768` จำนวน 941 รายการ

## Observability และ Privacy

ทุกครั้งที่ Knowledge RAG ทำงานจะบันทึก structured event เฉพาะ channel, outcome, latency, จำนวนเอกสาร, top hybrid score, embedding model และ SHA-256 query hash แบบตัดเหลือ 16 ตัวอักษร ระบบไม่ log ข้อความคำถาม คำตอบ ชื่อลูกค้า user id หรือ conversation id

Outcome ปัจจุบัน: `DISABLED`, `HUMAN_ONLY`, `NO_RETRIEVAL`, `ANSWERED`, `UNSUPPORTED`, `GENERATION_ERROR`

## แผนต่อยอด

### Round A — Safety baseline (เสร็จใน code)

- [x] ล็อก admin-only policy ทุกชั้น
- [x] เพิ่ม UI เตือนและปิดตัวเลือก AI อัตโนมัติทั้ง light/dark mode
- [x] เพิ่ม golden evaluation สำหรับ retrieval และ admin-only phrases
- [x] เพิ่ม PII-safe structured telemetry
- [x] ยืนยัน model isolation กับ production

### Round B — Corpus quality

- [x] ทำ source inventory พร้อม owner, reviewed date, expiry และ claim-level evidence
- [x] ตรวจและเพิ่ม FAQ 3 เรื่องที่ RAG ตอบได้: การถ่ายรูปอะไหล่เดิม, การใช้รหัส OEM และการเทียบปลั๊ก/พูลเลย์/ขายึด
- [x] ปิด RAG ของ FAQ เก่า 3 เรื่องที่ต้องให้แอดมินตอบ: การส่ง 2 เรื่อง และใบเสนอราคา/ความตรงรุ่น 1 เรื่อง
- [x] เพิ่ม duplicate/conflict/stale-content checks ก่อนอนุมัติและตรวจซ้ำที่ publish boundary
- [x] เพิ่ม evidence checklist และ freshness SLA: FAQ 90 วัน, บทความ 180 วัน, นโยบาย 30 วัน
- [x] backfill production 38 sources; quality gate ผ่านโดยไม่มี failure

ข้อมูล governance เก็บใน `KnowledgeRevision.content.governance` เพื่อให้ประวัติ owner/review/expiry/evidence เดินไปพร้อม revision โดยไม่เพิ่ม schema หรือตารางใหม่ ส่วน `sections[].evidenceUrls` และ `sections[].evidenceNote` รองรับหลักฐานระดับหัวข้อ หากไม่ระบุจะสืบทอด URL ระดับเอกสาร

แหล่งข้อมูลต้นทางที่เพิ่มใน Round B:

- DENSO compressor label guidance: `https://www.denso-am.eu/de/news/201604-neue-kompressor-labels`
- HELLA A/C compressor and vehicle identification: `https://www.hella.com/techworld/en/car-parts/thermal-management/a-c-compressors/`
- HELLA air-conditioning service and part inspection: `https://www.hella.com/techworld/ae/technical/car-air-conditioning/car-air-conditioning/`
- MAHLE Automotive air conditioning technical guide: `https://www.mahle-aftermarket.com/media/homepage/facelift/media-center/klima/kompaktwissen-ac-fahrzeugklimatisierung-en-screen.pdf`

### Round C — Retrieval quality

- [x] เก็บ baseline จาก query hash/outcome แบบ aggregate โดยไม่เก็บ PII
- [x] ทดลอง chunk size, title/section weighting และ reranking แบบ offline ก่อนเปิด production
- [x] เพิ่ม hard-negative และ paraphrase cases ใน golden set
- [x] เปิดการเปลี่ยน threshold เฉพาะเมื่อ golden score ไม่ถอยและ latency อยู่ในงบ

ผล Round C วันที่ 2026-07-31:

- production baseline ยังคงสูตรเดิม semantic `0.8` + lexical `0.2`, threshold semantic `0.55`, hybrid `0.52` และ top-k `5`
- golden production ผ่าน retrieval `21/21` แบ่ง baseline `13/13` + paraphrase `8/8`, admin-only `24/24` และ hard negative `8/8`
- exact offline evaluation บน 40 approved chunks: baseline MRR `0.8254`; title/section rerank เท่ากับ baseline, semantic-leaning ถอยเป็น `0.8016`, strict threshold เท่ากับ baseline จึงยังไม่มีเหตุผลพอให้เปลี่ยน production
- chunk experiment เป็น read-only: current `40` chunks, split `900` ตัวอักษรยังได้ `40` chunksเพราะ corpus ปัจจุบันไม่มี chunk ยาวเกินเกณฑ์, merge `1,600` ตัวอักษรลดเหลือ `15` chunksแต่ MRR ลดลง จึงไม่ rollout
- retrieval p95 รวม embedding ใน production check ต่ำกว่างบ `3,000 ms`; SQL reranking p95 ใน offline run อยู่ต่ำกว่า `100 ms`
- telemetry event เพิ่ม retrieval version/policy และยังเก็บเฉพาะ channel, outcome, latency, count, score, embedding model และ query hash 16 ตัวอักษร
- พบ hard negative รูปประโยค `ใส่...ได้ไหม` ที่ guard เดิมจับเฉพาะคำติดกัน จึงขยาย defense-in-depth เฉพาะ Knowledge RAG โดยไม่เปลี่ยน Product Search

คำสั่ง:

- `npm run check:knowledge-rag` — production health + golden + latency gate
- `npm run evaluate:knowledge-rag` — เปรียบเทียบ weighting/threshold แบบ read-only
- `npm run evaluate:knowledge-rag -- --with-chunk-experiments` — ทดลอง split/merge และสร้าง embedding ในหน่วยความจำเท่านั้น
- `npm run evaluate:knowledge-rag -- --gate=title-section-rerank` — fail process ถ้า candidate ต่ำกว่า baseline
- `npm run aggregate:knowledge-rag-telemetry -- --input=<vercel-log-file>` — สรุป log แบบ aggregate โดยไม่แสดง query hash รายตัว

### Round D — Operations and feedback

- [x] Dashboard coverage, no-answer, unsupported, latency และ handoff rate แยก LINE/Messenger
- [x] ปุ่มให้ admin ระบุคำตอบดี/ไม่ดี พร้อมเหตุผลแบบไม่เก็บข้อความลูกค้าโดยตรง
- [x] สร้าง knowledge-gap backlog จาก aggregate signals และให้คนอนุมัติก่อนสร้าง draft
- [x] กำหนด rollback/runbook และ alert เมื่อ sync หรือ quality gate ล้มเหลว

ผล Round D วันที่ 2026-07-31:

- เพิ่ม `/admin/knowledge/quality` พร้อม loading/action feedback และ light/dark mode แสดง metrics 30 วันแยก LINE/Messenger
- operational tables เก็บเฉพาะ daily counters, latency buckets, query hash 16 ตัวอักษร, citation ids และ closed reason code ไม่มีข้อความคำถาม/คำตอบหรือ customer/conversation id
- หน้า `ทดลองถาม AI` บันทึก feedback ดี/ต้องปรับได้ โดย admin test ไม่ถูกนับปนกับ production traffic
- `NO_RETRIEVAL`, `UNSUPPORTED`, `GENERATION_ERROR` และ feedback BAD สร้าง/เพิ่ม occurrence ใน gap backlog
- gap ต้องถูก review และตั้งชื่อโดยผู้มีสิทธิ์อนุมัติก่อนจึงสร้าง draft ได้ ร่างที่สร้างมี `ragEnabled=false`, `UNVERIFIED` และ checklist false
- sync/publish boundary ที่ล้มเหลวสร้าง in-app notification ระดับ ERROR แต่ active revision เดิมยังทำงาน
- Quick Search ใช้ source เดียวกับ Knowledge tabs และค้นหน้า approval/sync/test/quality ได้ตาม permission
- production tables ถูก setup แบบ idempotent แล้ว ดูขั้นตอน deploy/rollback ที่ [Knowledge RAG Operations Runbook](/D:/autoparts/docs/runbooks/knowledge-rag-operations.md)

## เกณฑ์ก่อนเปิดแต่ละรอบ

- ทดสอบ LINE และ Messenger พร้อมกัน
- golden evaluation ต้องผ่าน 100% สำหรับ admin-only และไม่ต่ำกว่า baseline retrieval
- Product Search tests และ product embedding model ต้องไม่เปลี่ยน
- เนื้อหาใหม่ต้องผ่าน human approval และมี source ที่ตรวจสอบได้
- ห้ามเปิด feature จากผลทดลองโดยไม่มี rollback path
