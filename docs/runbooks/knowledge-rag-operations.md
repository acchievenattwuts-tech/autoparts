# Knowledge RAG Operations Runbook

อัปเดตล่าสุด: 2026-07-31

## ขอบเขต

Runbook นี้ใช้กับ Knowledge RAG ของ LINE และ Facebook Messenger เท่านั้น Product Search, `product_search_documents` และ embedding-1 ไม่อยู่ในขั้นตอนนี้

ระบบเก็บ operational data เฉพาะตัวเลข aggregate รายวัน, channel, outcome, latency, policy id, query hash 16 ตัวอักษร และ feedback reason code ห้ามเพิ่มข้อความคำถาม/คำตอบ customer id, conversation id, ชื่อ หรือเบอร์โทรลงตาราง Round D

## หลัง Deploy

1. รัน `npm run db:setup-knowledge-rag` หนึ่งครั้ง คำสั่งเป็น idempotent และสร้างตาราง Round D หากยังไม่มี
2. รัน `npm run check:knowledge-cms`
3. รัน `npm run check:knowledge-rag`
4. เปิด `/admin/knowledge/quality` และยืนยันว่าไม่มีคำเตือนเรื่องตาราง
5. ทดลองคำถามที่ `/admin/knowledge/test` ทั้ง LINE และ Messenger แล้วบันทึก feedback อย่างละหนึ่งครั้ง

ไม่ต้องเพิ่ม ENV ใหม่ ค่า `KNOWLEDGE_RAG_METRICS_ENABLED` ใช้เฉพาะ emergency opt-out และเปิดโดย default

## Dashboard

- Coverage: สัดส่วน outcome `ANSWERED`
- No retrieval: ไม่มีเอกสารผ่าน threshold
- Unsupported: มีเอกสารแต่ LLM ยืนยันคำตอบจากแหล่งข้อมูลไม่ได้
- Handoff: `HUMAN_ONLY + NO_RETRIEVAL + UNSUPPORTED + GENERATION_ERROR`
- Latency: ค่าเฉลี่ยรวม retrieval และ generation พร้อมสัดส่วนที่เกิน 3 วินาที
- Feedback และ gap ไม่เก็บข้อความลูกค้า

Metrics เริ่มนับหลัง deploy Round D จึงไม่ย้อนหลังไปก่อนวันที่เปิดใช้

## Knowledge-gap Workflow

1. ระบบสร้าง gap จาก `NO_RETRIEVAL`, `UNSUPPORTED`, `GENERATION_ERROR` หรือ feedback `BAD`
2. ผู้มีสิทธิ์อนุมัติตั้งชื่อหัวข้อภายในและกด `ตรวจแล้ว`
3. หลังสถานะ `REVIEWED` ผู้มีสิทธิ์สร้างเนื้อหาจึงกด `สร้างร่างที่ปิด RAG`
4. ร่างใหม่มี `ragEnabled=false`, evidence `UNVERIFIED` และ checklist ยังไม่ผ่าน
5. ผู้ใช้ต้องแก้เนื้อหา เพิ่มแหล่งอ้างอิง เปิด AI ตามความเหมาะสม และส่ง workflow อนุมัติเดิม
6. ห้ามสร้าง active chunk จาก gap โดยตรง

## Sync หรือ Quality Gate ล้มเหลว

1. ระบบคง active revision เดิมไว้และตั้งงานใหม่เป็น `FAILED`
2. ระบบสร้าง in-app notification ระดับ `ERROR` ไปยังผู้ดูแล พร้อมลิงก์ไปยัง Knowledge Source
3. เปิด `/admin/knowledge/sync` ตรวจ `lastError`
4. ถ้าเป็น `KNOWLEDGE_QUALITY_GATE:*` ให้แก้ owner, review/expiry, evidence, checklist, duplicate/conflict หรือหัวข้อ admin-only ก่อน
5. ถ้าเป็น embedding/network ให้ตรวจ Gemini key health แล้วกด Retry
6. รัน health checks ทั้งสองคำสั่งก่อนถือว่า incident ปิด

## Rollback

### หยุดเฉพาะ Metrics

ตั้ง `KNOWLEDGE_RAG_METRICS_ENABLED=off` แล้ว redeploy การตอบ RAG ยังทำงาน แต่ dashboard จะหยุดรับข้อมูลใหม่

### หยุด Knowledge RAG ฉุกเฉิน

ตั้ง `KNOWLEDGE_RAG_ENABLED=off` แล้ว redeploy Product Search ยังทำงานตามเดิม LINE/Messenger จะใช้ fallback/handoff เดิม

### ย้อน Retrieval Candidate

Round C ยังใช้ baseline semantic `0.8`, lexical `0.2`, semantic threshold `0.55`, hybrid threshold `0.52` หากมีการทดลอง ENV threshold ให้ลบ ENV เหล่านั้นเพื่อกลับ baseline แล้วรัน `npm run check:knowledge-rag`

### Database

ไม่ต้องลบตาราง Round D ระหว่าง rollback เพราะ runtime อ่านแบบ fail-safe และข้อมูลไม่มีข้อความลูกค้า หากต้องหยุดเขียนให้ใช้ ENV opt-out แทนการ drop table
