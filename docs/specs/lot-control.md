# Lot Control Spec

## Goal
- ให้ stock traceability ลงถึงระดับ lot ตั้งแต่รับเข้า, ขาย, คืน, เคลม, และปรับสต็อก

## Scope
- product-level lot settings
- lot balance tracking
- lot movement tracking
- purchase/sale/return/CN/warranty/adjustment integration
- reverse/cancel logic

## Core Decisions
- ใช้ lot `unitCost` แยกต่างหาก ไม่ใช้ MAVG รวมตอน issue ออก
- cancel/recalculate ต้อง reverse ทั้ง `StockCard` และ `LotBalance` ใน transaction เดียว
- ใช้ auto allocate เป็น default ตาม `lotIssueMethod`
- manual allocation ทำได้ แต่ต้องมีเหตุผล/warning/log ถ้าไม่ตรง FIFO/FEFO
- stock เก่าจะไม่ backfill; ใช้แนวทาง reset/restore ก่อน go-live
- การขายต้องผ่านทั้ง stock รวมและ lot balance
- purchase return ต้องอ้างอิง lot เดิม
- credit note รับคืนจากลูกค้า default คือ merge กลับ lot เดิม และอาจมี option แยก lot คืน

## Product / Schema Requirements
- `Product.isLotControl`
- `Product.requireExpiryDate`
- `Product.lotIssueMethod`
- `Product.allowExpiredIssue`
- `LotIssueMethod { FIFO, FEFO, MANUAL }`
- โมเดลหลัก:
  - `ProductLot`
  - `LotBalance`
  - `StockMovementLot`
  - `PurchaseItemLot`
  - `SaleItemLot`
  - `PurchaseReturnItemLot`

## Integration Expectations
- purchase ต้องรับเข้าเป็น lot ได้
- sale ต้องเลือกหรือ auto-allocate lot ได้
- purchase return ต้อง reverse ตาม lot เดิม
- CN รับคืนจากลูกค้าต้องรองรับ lot
- delivery print/detail ต้องแสดง lot ที่เกี่ยวข้องเมื่อจำเป็น
- warranty และ claim ต้องเก็บ lot snapshot และใช้ต่อใน claim flow
- BF และ adjustment ต้องรองรับ lot control

## Mutation Rules
- edit เอกสารที่แตะ lot ต้อง reverse lot state ก่อนคำนวณใหม่
- cancel เอกสารต้อง reverse lot state และ stock state พร้อมกัน
- งานย้อนหลังมีความเสี่ยงสูง ต้อง review reverse/recalculate ครบทุกชั้น

## Out Of Scope
- purchase order
- warehouse transfer
- sales order / reserve lot
- barcode / QR scanning

## Affected Areas
- `prisma/schema.prisma`
- stock engine
- lot allocation logic
- purchase/sale/return/CN/warranty flows
- delivery detail/print

## Open Questions
- ถ้าจะขยายไปหลายคลังในอนาคต ควรทำ lot balance แยก warehouse อย่างไร
