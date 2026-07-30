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

Baseline วันที่ 2026-07-30: retrieval `10/10`, admin-only `24/24`, Knowledge model `gemini-embedding-2:768`, Product model `gemini-embedding-001:768`

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

- [ ] ทำ source inventory พร้อม owner, reviewed date, expiry และ claim-level evidence
- [ ] ตรวจและเพิ่ม FAQ/บทความเฉพาะคำถามทั่วไปที่ RAG ตอบได้จริง
- [ ] เพิ่ม duplicate/conflict/stale-content checks ก่อนอนุมัติ
- [ ] เพิ่ม evidence checklist และ freshness SLA ตามประเภทเนื้อหา

### Round C — Retrieval quality

- [ ] เก็บ baseline จาก query hash/outcome แบบ aggregate โดยไม่เก็บ PII
- [ ] ทดลอง chunk size, title/section weighting และ reranking แบบ offline ก่อนเปิด production
- [ ] เพิ่ม hard-negative และ paraphrase cases ใน golden set
- [ ] เปิดการเปลี่ยน threshold เฉพาะเมื่อ golden score ไม่ถอยและ latency อยู่ในงบ

### Round D — Operations and feedback

- [ ] Dashboard coverage, no-answer, unsupported, latency และ handoff rate แยก LINE/Messenger
- [ ] ปุ่มให้ admin ระบุคำตอบดี/ไม่ดี พร้อมเหตุผลแบบไม่เก็บข้อความลูกค้าโดยตรง
- [ ] สร้าง knowledge-gap backlog จาก aggregate signals และให้คนอนุมัติก่อนสร้าง draft
- [ ] กำหนด rollback/runbook และ alert เมื่อ sync หรือ quality gate ล้มเหลว

## เกณฑ์ก่อนเปิดแต่ละรอบ

- ทดสอบ LINE และ Messenger พร้อมกัน
- golden evaluation ต้องผ่าน 100% สำหรับ admin-only และไม่ต่ำกว่า baseline retrieval
- Product Search tests และ product embedding model ต้องไม่เปลี่ยน
- เนื้อหาใหม่ต้องผ่าน human approval และมี source ที่ตรวจสอบได้
- ห้ามเปิด feature จากผลทดลองโดยไม่มี rollback path
