# Warranty Claim Spec

## Goal
- จัดการ warranty และ warranty claim ให้ตามรอยกลับไปถึงการขายและ lot ที่เกี่ยวข้องได้

## Scope
- warranty creation จากการขาย
- claim intake
- claim document / print
- lot snapshot integration
- stock implications ของ claim flow ที่เกี่ยวข้อง

## Core Rules
- warranty เริ่มนับจากวันที่ขาย
- claim ต้องอ้างอิงสินค้าและเอกสารที่เกี่ยวข้องได้
- เมื่อสินค้าอยู่ใน lot control ต้องเก็บ lot snapshot ใน warranty
- claim lot schema ต้องรองรับการเชื่อม claim กับ lot ที่เกี่ยวข้อง
- claim flow ที่กระทบ stock ต้องสะท้อน lot movement ให้ครบ

## Functional Areas
- product/sale flow ต้องสร้าง warranty ได้ถูกต้อง
- warranty page ต้องแสดงสถานะ/หมดประกัน
- claim form ต้องรวบรวมข้อมูลเอกสารอ้างอิงและ lot ที่เกี่ยวข้อง
- claim print ต้องสะท้อนข้อมูล claim ที่จำเป็น

## Integration
- sale history
- warranty records
- claim records
- lot control
- stock reverse/reissue logic หาก flow นั้นกระทบ stock

## Affected Areas
- warranty pages
- claim pages
- lot-related schema
- sale-linked warranty creation logic

## Open Questions
- claim แต่ละสถานะควรมี stock impact เมื่อใด
- จะมี supplier claim flow ต่อจาก customer claim หรือไม่
