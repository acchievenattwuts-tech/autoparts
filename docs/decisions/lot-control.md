# Lot Control Decisions

## Status
- Active

## Context
- ระบบ lot control ถูกเพิ่มเพื่อให้ติดตาม stock ตาม lot ได้ใน purchase, sale, return, warranty, และ adjustment

## Decision
- ระบบต้องรองรับ lot ตั้งแต่รับเข้าไปจนถึงขาย/คืน/เคลม
- งาน reverse หรือ cancel เอกสารที่แตะ stock ต้อง reverse lot state ด้วย
- BF และ adjustment ต้องรองรับ lot เช่นกัน

## Impact
- งานที่แตะ inventory flow ต้อง review ทั้ง stock card และ lot balance
- การแก้เอกสารย้อนหลังมีความเสี่ยงสูงและต้องเช็ก reverse/recalculate ให้ครบ

## Historical Detail
- ดูรายละเอียดเดิมใน [PLAN archive](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)
