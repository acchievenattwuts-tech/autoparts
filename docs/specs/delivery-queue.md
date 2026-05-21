# Delivery Queue Spec

## Goal
- จัดการงานส่งของโดย reuse sale flow เดิมให้มากที่สุด
- แยกงาน COD ออกจาก AR ปกติแบบไม่เพิ่มโมเดลบัญชีเกินจำเป็น

## Scope
- delivery-specific fields ใน sale
- delivery queue
- shipping status update
- tracking and shipping method
- delivery print slip
- AR dashboard split สำหรับ COD

## Key Decisions
- ใช้ `fulfillmentType = DELIVERY`
- ใช้ `paymentType = CREDIT_SALE + fulfillmentType = DELIVERY` สำหรับ COD tracking
- ไม่เพิ่ม `codAmount`
- ใช้ AR flow เดิมในการติดตามยอดค้าง COD
- ใช้ `ShippingStatus { PENDING, OUT_FOR_DELIVERY, DELIVERED }`
- ใช้ `shippingMethod` และ `trackingNo`

## Schema Impact
- `Sale.shippingStatus`
- `Sale.shippingMethod`
- `Sale.trackingNo`

## UI / Flow
- sale form:
  - เมื่อ `fulfillmentType = DELIVERY` ต้องแสดง shipping address, shipping fee, shipping method
  - tracking ยังไม่ต้องกรอกตอนสร้างใบขาย
  - ถ้าเป็น `CREDIT_SALE + DELIVERY` ต้องมี note ว่าเป็น AR/COD flow
- sale detail:
  - แสดง shipping status และ tracking
- sales list:
  - มี filter tab สำหรับงานรอจัดส่ง
  - แสดงสถานะจัดส่ง
  - แสดงยอด COD สำหรับรายการที่เกี่ยวข้อง
- `/admin/delivery`
  - แสดงงานจัดส่งที่ยัง pending หรือ out for delivery
  - อัปเดต status ได้
  - กรอก tracking และ shipping method แบบ inline ได้
  - พิมพ์เอกสารได้
- AR dashboard:
  - แยก `CREDIT_SALE + PICKUP` ออกจาก `CREDIT_SALE + DELIVERY`

## Print Rules
- print slip แสดงชื่อลูกค้า, ที่อยู่จัดส่ง, รายการสินค้า, ยอดรวม, ค่าส่ง
- footer แยก prepaid กับ COD
- รองรับพิมพ์หลายใบพร้อมกันที่ `/admin/delivery/print?ids=...`
- ถ้าเอกสารเป็น `CREDIT_SALE` ให้ใช้หัวเอกสารแนวใบแจ้งหนี้/ใบส่งของแทนใบเสร็จ

## Affected Areas
- sale schema and form
- delivery queue UI
- delivery print page
- AR dashboard/report split

## Open Questions
- ถ้าจะขยาย proof of delivery เพิ่ม ต้องเก็บ media/receiver signature แบบใด
