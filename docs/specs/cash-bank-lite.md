# Cash/Bank Lite Spec

## Goal
- ทำโมดูลเงินสด/ธนาคารแบบ lite ที่ใช้งานจริงได้สำหรับธุรกิจเริ่มต้น
- ต้องตอบได้ว่าเงินอยู่บัญชีไหน, เงินเข้าออกจากเอกสารอะไร, และยอดคงเหลือรายบัญชีเป็นเท่าไร
- ยังไม่ขยาย scope ไปเป็นระบบบัญชีเต็มหรือ bank reconcile เต็มรูปแบบ

## Status
- **Implemented & live** — schema 4 model, posting flow (`lib/cash-bank.ts`) wired เข้าทุกเอกสารเงิน, UI `/admin/cash-bank` (+ledger/transfers/adjustments), report queries (`lib/cash-bank-report-queries.ts`), permission ครบ 5-step

## Scope
- cash/bank account master
- opening balance และ opening date ต่อบัญชี
- ledger movement เป็น source of truth ของเงินเข้าออก
- ผูกเอกสารธุรกิจที่กระทบเงินจริงเข้ากับบัญชี
- transfer ระหว่างบัญชี
- cash/bank adjustment
- cash/bank ledger report, balance summary, transfer history
- account-aware report impact สำหรับรายงานที่เกี่ยวข้อง

## Out Of Scope
- full bank reconciliation
- bank statement import
- payment run / clearing workflow
- slip attachment workflow
- legacy movement backfill ก่อน go-live รอบใหม่
- ระบบบัญชีเต็มรูปแบบ

## Core Data Model
- `CashBankAccount`
  - account type อย่างน้อย `CASH` และ `BANK`
  - opening balance
  - opening date
  - active/inactive
- `CashBankMovement`
  - `accountId`
  - `txnDate`
  - `direction` (`IN` / `OUT`)
  - `amount`
  - `balanceAfter`
  - `sourceType`
  - `sourceId`
  - `referenceNo`
  - `note`
- movement sources ขั้นต่ำ:
  - `SALE`
  - `RECEIPT`
  - `PURCHASE`
  - `EXPENSE`
  - `CN_SALE`
  - `TRANSFER`
  - `ADJUSTMENT`

## Business Rules
- ledger movement คือ source of truth ของ cash/bank card และ running balance
- เอกสารที่ไม่กระทบเงินจริงต้องไม่สร้าง movement ก่อนเวลา
- `Purchase.paymentStatus` ต้องแยก `UNPAID`, `PARTIALLY_PAID`, `PAID`
- purchase ที่ `UNPAID` ต้องยังไม่สร้าง cash/bank movement จนกว่าจะมีการจ่ายเงินจริง
- sale แบบเงินสดต้องเลือกบัญชีรับเงิน
- receipt ต้องเลือกบัญชีรับเงิน
- purchase ที่จ่ายทันทีต้องเลือกบัญชีจ่ายเงิน
- expense ต้องเลือกบัญชีจ่ายเงิน
- credit note ฝั่งขายที่คืนเงินจริงต้องเลือกบัญชีจ่ายเงิน
- transfer ต้องสร้าง movement สองฝั่งแบบ atomic
- adjustment ต้องสร้าง movement ใหม่เสมอและรองรับการ reverse/recalculate เมื่อยกเลิก

## Mutation Rules
- create เอกสารที่กระทบเงินจริง: สร้าง movement และอัปเดต running balance ทันที
- edit เอกสารที่กระทบเงินจริง: reverse/replace movement เดิมก่อนสร้างใหม่
- cancel เอกสารที่กระทบเงินจริง: ยกเลิก movement ที่เกี่ยวข้องและ recalculate card ของทุกบัญชีที่โดนผลกระทบ
- ต้องมี utility กลางสำหรับ recalculate cash/bank card ตามลำดับวันที่และเอกสาร

## Screens
- `/admin/cash-bank`
  - จัดการบัญชีเงินสด/ธนาคาร
  - เปิด/ปิดการใช้งาน
  - ตั้งยอดยกมา
- `/admin/cash-bank/ledger`
  - ดู ledger รายบัญชี
  - filter ตามบัญชีและช่วงวันที่
  - filter/source-aware ตาม `SALE`, `RECEIPT`, `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER`, `ADJUSTMENT`
  - drill-down ไปเอกสารต้นทางได้
  - แสดง opening, total in, total out, closing, running balance
- `/admin/cash-bank/transfers`
  - บันทึกโอนเงินระหว่างบัญชี
- `/admin/cash-bank/adjustments`
  - บันทึกปรับยอดเงินเข้า/ออก
  - ต้องมีเหตุผล
  - ต้องผูก role/permission สำหรับ create/edit/cancel

## Reports
- Cash/Bank Ledger Report
  - filter ตามบัญชีและช่วงวันที่
  - source-aware
  - drill-down ถึงเอกสารต้นทาง
  - สรุป opening, total in, total out, closing
- Cash/Bank Balance Summary
  - สรุปยอดคงเหลือล่าสุดทุกบัญชี
  - แยกเงินสด vs ธนาคาร
  - drill-down เข้า ledger รายบัญชี
- Transfer History Report
  - ดูประวัติโอนระหว่างบัญชี
  - filter ตามต้นทาง/ปลายทาง/ช่วงวันที่

## Report Impact
- `/admin/reports/receipts`
  - เพิ่มมุมมองบัญชีที่รับเงินจริง
  - เพิ่ม filter ตามบัญชีรับเงิน
  - export ต้องมี account name / type / source ref
- `/admin/reports/payments`
  - เพิ่มมุมมองบัญชีที่จ่ายเงินจริง
  - เพิ่ม filter ตามบัญชีจ่ายเงิน
  - แยก movement จาก `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER OUT`, `ADJUSTMENT`
  - สะท้อน `Purchase.paymentStatus` ให้ถูกต้อง โดย `UNPAID` ไม่ถูกนับเป็นเงินจ่ายจริงใน ledger view
- `/admin/reports/credit-notes`
  - แยก CN ที่เป็นเงินออกจริงจาก CN ที่เป็นเพียงการลดหนี้
  - เพิ่ม account-aware filters และ export fields
- `/admin/reports/summary`
  - เพิ่ม summary ของยอดคงเหลือเงินสด/ธนาคาร
  - แยกยอดตามเอกสารออกจากยอดตามบัญชี
- `/admin/reports/export` และ `/admin/reports/export-excel`
  - เพิ่ม field บัญชีและ source ที่เกี่ยวข้อง
- `/admin/reports/print`
  - ถ้าพิมพ์รายงานรับเงิน/จ่ายเงิน ต้องสะท้อนยอดตาม ledger ได้ถูกต้อง
- `lib/reports` และ `lib/report-queries`
  - ส่วนที่เกี่ยวกับเงินจริงต้องขยับจาก document-centric เป็น account-aware

## Affected Areas
- `prisma/schema.prisma`
- `lib/` ที่เกี่ยวกับ posting, recalculate, reports
- `app/admin/cash-bank/*`
- sale, receipt, purchase, expense, credit-note flows
- admin reports/export/print

## Open Questions
- จะใช้ ledger generic แค่ไหนใน phase แรก
- opening balance ควรเป็น setup action หรือ document type เฉพาะ
- purchase partial payment จะออกแบบ flow การจ่ายอย่างไร
- permission matrix ของ cash/bank adjustment และ transfer ควรละเอียดระดับไหน
