# Warranty Claim Decisions

## Status
- Active

## Context
- ระบบเคลมต้องเชื่อมกับประกันสินค้าเดิมและต่อยอดกับ lot control โดยไม่ทำให้ stock traceability หลุด

## Decision
- warranty นับอิงจากวันที่ขาย
- claim ต้องผูกกับสินค้าและข้อมูลการขายเดิมให้ตามรอยได้
- เมื่อระบบ lot control เปิดใช้ warranty และ claim ต้องเก็บ lot snapshot ที่เกี่ยวข้อง
- claim flow ที่กระทบ stock ต้องสะท้อน lot movement ตามกติกา lot control
- งาน claim ต้องไม่ทำให้ stock traceability และเอกสารอ้างอิงขาดจากกัน

## Impact
- งานที่แตะ warranty, warranty claim, sale history, และ stock reverse/reissue ต้อง review lot integration ด้วย
- ถ้าเปลี่ยน claim return flow ต้องทบทวนทั้ง stock, lot, และ print/report ที่เกี่ยวข้อง

## Historical Detail
- ดูรายละเอียดเดิมใน [PLAN archive](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)
