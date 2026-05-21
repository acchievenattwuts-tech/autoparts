# Active Roadmap

## Purpose
- ไฟล์นี้เก็บเฉพาะงานที่ยัง active หรือยังต้องตัดสินใจ
- งานที่เสร็จแล้วแบบสรุปอยู่ที่ [completed.md](/D:/autoparts/docs/roadmap/completed.md)

## Active Now
### Phase 6.6 - Cash/Bank Lite
- สถานะ: planning
- เป้าหมาย:
  - มีโมดูลเงินสด/ธนาคารแบบ lite สำหรับธุรกิจเริ่มต้น
  - รองรับ opening balance, income/expense movement, transfer, และรายงานพื้นฐาน
- สิ่งที่ต้องทำต่อ:
  - [ ] สรุป schema ที่จำเป็น
  - [ ] สรุปหน้าจอหลัก
  - [ ] สรุป posting flow ที่สัมพันธ์กับ receipts/payments/expenses
  - [ ] สรุป impact กับรายงานปัจจุบัน
  - [ ] แยก spec ลง [docs/specs/cash-bank-lite.md](/D:/autoparts/docs/specs/cash-bank-lite.md)

### Product Search Overhaul (OEM / Fitment / Synonym)
- สถานะ: Phase A + B + C + D + E เสร็จ
- เอกสาร spec: [docs/specs/product-search-overhaul.md](/D:/autoparts/docs/specs/product-search-overhaul.md)
- Phase E: no-result telemetry + dashboard/report เสร็จแล้ว

### Phase 7 - SEO Follow-up
- สถานะ: mostly complete with ongoing follow-up
- สิ่งที่ยังเป็นงานต่อเนื่อง:
  - [ ] external verification
  - [ ] content expansion ตาม priority
  - [ ] periodic Core Web Vitals review

## Open Questions
- Cash/Bank Lite จะใช้ ledger กลางแบบยืดหยุ่นเลยหรือใช้ model แบบง่ายเฉพาะธุรกิจเริ่มต้น
- opening balance จะลงผ่าน document แยกหรือผ่าน setting/setup flow
- cash/bank transfer ควรมี approval/state หรือใช้ post ทันที

## Rules For Updating This File
- เก็บเฉพาะงานที่ยังไม่จบหรือยังมี decision ค้าง
- ถ้างานปิดแล้ว ให้ย้ายสรุปไป [completed.md](/D:/autoparts/docs/roadmap/completed.md)
- ถ้ารายละเอียดโมดูลยาวเกิน 1 หน้า ให้แยกไป `docs/specs/`
