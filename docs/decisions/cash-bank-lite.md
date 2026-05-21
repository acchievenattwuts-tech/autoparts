# Cash/Bank Lite Decisions

## Status
- Active

## Context
- ระบบต้องรู้ว่าเงินสดและเงินธนาคารอยู่บัญชีไหนจริง โดยไม่ขยาย scope ไปเป็นระบบบัญชีเต็มรูปแบบตั้งแต่รอบแรก

## Decision
- ใช้ Cash/Bank account master แบบ lean โดยรองรับอย่างน้อย `CASH` และ `BANK`
- แต่ละบัญชีต้องมี opening balance, opening date, และ active/inactive status
- ใช้ cash/bank ledger movement เป็น source of truth ของการเคลื่อนไหวเงิน
- movement ขั้นต่ำต้องเก็บ `accountId`, `txnDate`, `direction`, `amount`, `balanceAfter`, `sourceType`, `sourceId`, `referenceNo`, และ `note`
- source ขั้นต่ำของ Lite phase คือ `SALE`, `RECEIPT`, `PURCHASE`, `EXPENSE`, `CN_SALE`, `TRANSFER`, `ADJUSTMENT`
- ผูกเฉพาะเอกสารที่กระทบเงินสด/ธนาคารจริงเข้ากับบัญชี
- `Purchase.paymentStatus` ต้องใช้แยกเอกสารที่เกิดหนี้ออกจากเอกสารที่จ่ายเงินจริง
- transfer ระหว่างบัญชีต้องสร้าง movement สองฝั่งใน transaction เดียว
- adjustment ฝั่ง cash/bank เป็นเอกสารเฉพาะสำหรับปรับยอดเงินจริงพร้อมเหตุผลและสิทธิ์ใช้งาน

## Operating Rules
- เอกสารที่กระทบเงินจริงต้องสร้าง movement และอัปเดต running balance ทันที
- การแก้ไขเอกสารต้อง reverse/replace movement เดิมก่อนสร้างชุดใหม่
- การยกเลิกเอกสารต้องยกเลิก movement ที่เกี่ยวข้องและ recalculate card ของทุกบัญชีที่ได้รับผลกระทบ
- ห้ามปล่อยให้เอกสารถูกแก้หรือยกเลิกโดยที่ card ไม่อัปเดตตาม
- ต้องมี utility กลางสำหรับ recalculate cash/bank card คล้ายแนวคิด `recalculateStockCard()`

## Out Of Scope
- full bank reconciliation
- bank statement import
- payment run / clearing workflow
- slip attachment workflow
- backfill legacy movement ก่อน go-live รอบใหม่

## Impact
- งานที่แตะ sale, receipt, purchase, expense, credit note, transfer, adjustment, และ reports ต้อง review cash/bank posting ด้วย
- รายงานรับเงิน/จ่ายเงิน/summary/export ต้องเปลี่ยนจาก payment-method-centric ไปเป็น account-aware ในส่วนที่เกี่ยวข้อง

## Historical Detail
- ดูรายละเอียดเดิมใน [PLAN archive](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)
