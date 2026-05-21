# Delivery Decisions

## Status
- Active

## Context
- ระบบจัดส่ง reuse sale flow เดิมและไม่ต้องการสร้าง accounting path แยกเกินจำเป็น

## Decision
- ใช้ `fulfillmentType = DELIVERY` เพื่อบอกว่าเป็นงานจัดส่ง
- ใช้ `paymentType = CREDIT_SALE + fulfillmentType = DELIVERY` สำหรับ flow เก็บเงินปลายทางแทนการเพิ่ม `codAmount`
- แยกสถานะจัดส่งด้วย `ShippingStatus`
- ใช้ `shippingMethod` และ `trackingNo` สำหรับข้อมูลการขนส่ง

## Impact
- งานที่แตะ sale, AR, delivery queue, และ print ต้องระวัง flow นี้
- ถ้าจะเปลี่ยนแนวคิด COD ต้อง review report และ AR logic ด้วย

## Historical Detail
- ดูรายละเอียดเดิมใน [PLAN archive](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)
