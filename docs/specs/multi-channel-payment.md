# Multi-Channel Payment (Split Payment) — Design Doc

## Goal
รองรับการ **รับเงิน** หรือ **จ่ายเงิน** ของเอกสารเดียว ได้มากกว่า 1 ช่องทาง/บัญชี
(เช่น ใบรับเงิน 1,000 บาท = เงินสด 400 + โอนเข้า SCB 600) โดยไม่ทำลาย ledger core
และ business logic เดิม

## Status
- **ครบทุก phase แล้ว (0–5)** ✅
  - `DocumentPayment` model + enum (db push แล้ว), helper กลาง `lib/document-payments.ts`
  - shared UI `components/shared/PaymentChannelsInput.tsx`
  - **10 เอกสารครบ loop** (form split rows → create/update/cancel → posting →
    detail breakdown → audit): Receipt, Sale (CASH_SALE), Purchase (CASH_PURCHASE),
    Expense, CreditNote (CASH_REFUND), PurchaseReturn (CASH_REFUND),
    SupplierAdvance, SupplierPayment
  - print: ใบเสร็จ + ใบขาย/ใบส่งของ multi-channel ครบทุก caller
  - reports: account filter multi-channel-aware (additive OR, ผลลัพธ์เดิมไม่เปลี่ยน)

## ทิศทาง IN/OUT ต่อเอกสาร
| เอกสาร | docType | เงื่อนไข split | ทิศทาง | target |
|--------|---------|--------------|--------|--------|
| Receipt | RECEIPT | netTotal > 0 | IN | totalAmount |
| Sale | SALE | CASH_SALE | IN | netAmount |
| Purchase | PURCHASE | CASH_PURCHASE | OUT | netAmount |
| Expense | EXPENSE | เสมอ | OUT | netAmount |
| CreditNote | CN_SALE | CASH_REFUND | OUT | netAmount |
| PurchaseReturn | CN_PURCHASE | CASH_REFUND | IN | netAmount |
| SupplierAdvance | SUPPLIER_ADVANCE | เสมอ | OUT | totalAmount |
| SupplierPayment | SUPPLIER_PAYMENT | totalCashPaid > 0 | OUT | totalCashPaid |

## Notes ต่อเอกสาร
- **Purchase**: split เฉพาะ `CASH_PURCHASE` (จ่ายทันที); `CREDIT_PURCHASE` ไม่มี
  DocumentPayment (จ่ายผ่าน SupplierPayment ภายหลัง). draft (localStorage) เก็บ
  `payments` เพิ่ม backward-compatible
- **Sale**: split เฉพาะ `CASH_SALE`; `CREDIT_SALE` ไม่มี. เพิ่ม
  `resolveSalePaymentMethodFromAccounts()` ใน `lib/sale-core.ts` (ตัวเดิม
  `resolveSalePaymentMethod` คงไว้ให้ Shopee/LINE). Shopee/LINE ยังสร้าง sale
  แบบบัญชีเดียวโดยไม่เขียน DocumentPayment — detail/print fallback ผ่าน
  `cashBankAccountId` แถวเดียว

## Follow-ups ค้าง (จาก Phase 1)
- ~~Print แสดงบัญชีเดียว~~ **เสร็จแล้ว** — print ใบเสร็จ (admin detail + LIFF +
  liff-print) แสดง "รายละเอียดการรับชำระ" แยกทุกช่องทาง + ยอดรวม ในกล่อง "ชำระโดย"
  ผ่าน prop `payments` ของ `SharedReceiptSettlementPrintDocument`
  (single-channel ยัง fallback เป็นบล็อกบัญชีเดี่ยวเดิม)
- report-queries ยัง filter ด้วย `cashBankAccountId` แถวแรก (นับพลาดเมื่อ split
  หลายบัญชี) — แก้ใน Phase 5 (ย้ายไปอ่าน `CashBankMovement`)

## Current State (ผลตรวจสอบ)
- ทุกเอกสารเงินผูก **บัญชีเดียว** ผ่าน `cashBankAccountId String?` (nullable, 1:1)
- เอกสารที่กระทบ: `Sale`, `Receipt`, `Purchase`, `Expense`, `CreditNote`,
  `PurchaseReturn`, `SupplierAdvance`, `SupplierPayment`
- Posting ทำผ่าน `replaceCashBankSourceMovements(tx, sourceType, sourceId, entries[])`
  ใน `lib/cash-bank.ts` — **รับ array ของ entries อยู่แล้ว** จึงสร้าง movement
  หลายบัญชีต่อเอกสารเดียวได้ทันที (recalc / reverse / cancel เป็น per-account อยู่แล้ว)
- คอขวดจริง = document level เท่านั้น (เก็บบัญชีเดียว + amount ก้อนเดียว
  แล้วส่ง entry ก้อนเดียวเข้า posting)

## Key Insight
Ledger layer **ไม่ต้องแก้เลย** — งานทั้งหมดอยู่ที่ document level (schema เก็บ split,
UI กรอกหลายแถว, actions แปลง split → entries[]) และ reports (เลิกอ่าน
`cashBankAccountId` ตรงจากเอกสาร)

## Chosen Approach: ตาราง `DocumentPayment` กลางตัวเดียว (polymorphic)

### Schema (รอ confirm ก่อน db push)
```prisma
enum DocumentPaymentDocType {
  SALE
  RECEIPT
  PURCHASE
  EXPENSE
  CN_SALE
  CN_PURCHASE
  SUPPLIER_ADVANCE
  SUPPLIER_PAYMENT
}

model DocumentPayment {
  id                String                 @id @default(cuid())
  docType           DocumentPaymentDocType
  docId             String                 // polymorphic — ไม่มี FK ตรง
  lineNo            Int
  cashBankAccountId String
  direction         CashBankDirection      // IN / OUT
  amount            Decimal                @db.Decimal(10, 2)
  note              String?
  createdAt         DateTime               @default(now()) @db.Timestamptz(3)

  cashBankAccount   CashBankAccount        @relation(fields: [cashBankAccountId], references: [id])

  @@index([docType, docId])
  @@index([cashBankAccountId])
}
```
- `docId` เป็น polymorphic (ไม่มี FK ข้ามไปเอกสารต้นทาง) — ต้องลบ DocumentPayment
  เองตอน cancel เอกสาร (cascade ทำเองใน action ไม่พึ่ง DB)
- `direction` เก็บซ้ำใน row เพื่อรองรับเอกสารที่มีทั้ง IN/OUT (เช่น PurchaseReturn)
- **หมายเหตุ trade-off**: ไม่มี FK ตรง = referential integrity ต้อง enforce ในโค้ด;
  แลกกับการเพิ่มเอกสารใหม่ในอนาคตทำได้โดยไม่แตะ schema

### Back-compat กับ `cashBankAccountId` เดิม
`cashBankAccountId` เดิมบนแต่ละเอกสาร **คงไว้** เป็น "บัญชีหลัก/แถวแรก" เพื่อ:
1. ไม่ break query/print/report ที่อ่านฟิลด์นี้ระหว่างเปลี่ยนผ่าน
2. ข้อมูลเก่า (single-channel) อ่านได้เหมือนเดิม โดยไม่ต้อง backfill DocumentPayment

กติกา: ถ้า split มี 1 แถว → เขียน `cashBankAccountId` = แถวนั้น (พฤติกรรมเดิมเป๊ะ);
ถ้ามากกว่า 1 แถว → `cashBankAccountId` = แถวแรก (ใช้เป็น "primary" สำหรับ label)

## Posting Flow (ต่อเอกสาร)
```ts
// เดิม: entry ก้อนเดียว
[{ accountId: resolvedCashBankAccountId, amount: totalAmount, ... }]

// ใหม่: map จาก DocumentPayment split rows
payments.map((p) => ({
  accountId: p.cashBankAccountId,
  txnDate: docDate,
  direction: p.direction,
  amount: p.amount,
  referenceNo: docNo,
  note: p.note,
}))
```
- Validation: `sum(payments.amount by direction)` ต้องเท่ากับยอดเอกสาร
  (เงินเข้า/เงินออก) — reject ถ้าไม่ balance
- `replaceCashBankSourceMovements` เดิมรองรับ array นี้แล้ว ไม่ต้องแก้ core

## Mutation Rules
- **create**: insert DocumentPayment rows + post entries[] + set `cashBankAccountId`
  = แถวแรก
- **edit**: ลบ DocumentPayment เดิมของ (docType, docId) → insert ใหม่ →
  `replaceCashBankSourceMovements` (reverse/replace movement เดิม)
- **cancel**: ลบ DocumentPayment rows ของเอกสาร + `clearCashBankSourceMovements`
  + recalculate ทุกบัญชีที่โดนผลกระทบ (เดิมทำอยู่แล้ว)

## Reports Impact (สำคัญ)
`lib/report-queries.ts` filter ด้วย `where.cashBankAccountId` **~16 จุด**
(บรรทัด 245, 393, 513, 602, 664, 707, 890, 929, 1003, 1041, 1088, 1128, 1181)
- ถ้ายังใช้ split 1 แถว → filter เดิมทำงานถูก (เพราะ `cashBankAccountId` = แถวแรก)
- ถ้าเอกสารมี split หลายบัญชี → filter by document `cashBankAccountId`
  **จะนับพลาด** (จับได้แค่บัญชีแถวแรก)
- **ทางแก้**: report ฝั่ง "เงินจริง/บัญชี" ควรย้ายไปอ่านจาก `CashBankMovement`
  (source of truth ตาม cash-bank-lite spec ข้อ report impact) แทน filter บนเอกสาร
- Cash/Bank Ledger report ถูกต้องอยู่แล้ว เพราะอ่านจาก movement โดยตรง

## UI Impact
- Form ทุกเอกสาร: เปลี่ยน single `SearchableSelect` (บัญชี) เป็น
  **repeatable rows** (บัญชี + จำนวนเงิน + ปุ่มเพิ่ม/ลบแถว) + แสดงยอดคงเหลือ
  ที่ต้องกระจาย (total − sum(rows))
- ส่งเป็น JSON: `formData.set("payments", JSON.stringify(rows))` ตามมาตรฐาน
  line-items เดิม
- Default: 1 แถว (UX เดิม, ผู้ใช้ที่จ่ายช่องทางเดียวไม่เห็นความต่าง)
- Print/detail: แสดงรายการช่องทางเป็น list ถ้ามีหลายแถว, single line ถ้าแถวเดียว
- อัปเดตทั้ง light + dark mode พร้อมกัน (ตาม .rules §8)

## Audit / Permissions / Notifications
- ไม่มี permission key ใหม่ (ยังเป็น action เดิมของแต่ละเอกสาร)
- Audit snapshot ของแต่ละเอกสารต้องรวม payments[] ใน before/after metadata

## Rollout Plan (เสนอ)
1. **Phase 0**: เพิ่ม `DocumentPayment` model + enum → `prisma db push`
   (รออนุมัติ schema)
2. **Phase 1 (pilot)**: ทำ **Receipt** เอกสารเดียวครบ loop
   (schema-fed form → actions create/edit/cancel → posting → print/detail → audit)
   เพื่อ validate design จริงก่อนขยาย
3. **Phase 2**: ขยายไป Sale, Purchase, Expense ทีละเอกสาร
4. **Phase 3**: CreditNote, PurchaseReturn, SupplierAdvance, SupplierPayment
5. **Phase 4**: ย้าย report queries ฝั่งบัญชีไปอ่าน `CashBankMovement`
   + ปรับ export/print
6. แต่ละ phase deploy + verify ก่อนขึ้น phase ถัดไป

## Open Questions
- ต้องการจำกัดจำนวนช่องทางต่อเอกสารไหม (เช่น max 5 แถว)?
- ฝั่ง Purchase partial payment (paymentStatus) จะให้ split ต่อครั้งจ่าย
  หรือรวมทั้งเอกสาร?
- ต้องการ backfill DocumentPayment จากเอกสารเก่าไหม หรือปล่อยให้ back-compat
  ผ่าน `cashBankAccountId` แถวเดียวพอ?
