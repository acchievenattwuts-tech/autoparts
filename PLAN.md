# ศรีวรรณ อะไหล่แอร์ - Active Plan

## Purpose
- ไฟล์นี้เป็น entrypoint สำหรับ AI และคนที่เข้ามาทำงานต่อใน repo
- เก็บเฉพาะภาพรวมระบบ, งานที่กำลังทำ, งานที่ต้องตัดสินใจ, และลิงก์ไป source of truth
- รายละเอียดเก่าทั้งหมดถูก archive ไว้ที่ [docs/archive/PLAN-legacy-2026-05-21.md](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)

## Summary
- โปรเจกต์นี้คือระบบร้านอะไหล่แอร์รถยนต์ มี public storefront และ admin backoffice
- Tech หลัก: Next.js App Router, TypeScript strict, Prisma, PostgreSQL, NextAuth, Tailwind, Shadcn UI
- ระบบ stock ใช้ `StockCard` เป็น source of truth สำหรับ movement และ moving average cost
- กฎ cross-module สำคัญอยู่ใน [AGENTS.md](/D:/autoparts/AGENTS.md)
- ตอนนี้ phase ที่ยัง active หลักคือ Cash/Bank Lite และงานติดตามหลัง rollout บางส่วน

## Current Focus
- `Phase 6.6` โมดูลบัญชีธนาคาร/เงินสด Lite สำหรับธุรกิจเริ่มต้น
- ติดตาม manual/ongoing work ของ `Phase 7` ด้าน SEO, verification, และ content expansion
- Product Search Quality phase ถัดไป: Review Outcome Tracking, Fitment/Year remediation, Closed-Loop Measurement, และ Guarded Auto-Apply
- รักษาเอกสารให้ AI อ่านง่าย: ใช้ไฟล์นี้เป็น index และย้ายรายละเอียดลงเอกสารเฉพาะเรื่อง

## Current Priorities
- [ ] ยืนยันขอบเขตสุดท้ายของ `Phase 6.6` ก่อนแตะ schema และ flow บัญชี
- [ ] ระบุ source of truth ของ cash/bank posting, transfer, opening balance, และ report impact
- [ ] แตก detailed spec ของ Cash/Bank Lite เป็นเอกสารเฉพาะก่อนลงมือ implement
- [ ] ทยอยย้าย decision สำคัญจาก archive ไป `docs/decisions/`
- [ ] ทยอยย้าย detailed module specs จาก archive ไป `docs/specs/`

## Active Workstreams
### 1. Cash/Bank Lite
- สถานะ: ยังไม่เริ่ม implementation
- เอกสาร active: [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
- สิ่งที่ต้องกำหนดให้ชัดก่อน:
  - schema หลัก
  - transaction flows
  - report impact
  - reconciliation rules

### 2. SEO / AEO / AIO Follow-up
- สถานะ: baseline หลักเสร็จแล้ว แต่ยังมี external/manual work ต่อเนื่อง
- เอกสารอ้างอิง:
  - [docs/seo/phase-7-final-status-2026-04-03.md](/D:/autoparts/docs/seo/phase-7-final-status-2026-04-03.md)
  - [docs/seo/phase-7-follow-up-2026-04-03.md](/D:/autoparts/docs/seo/phase-7-follow-up-2026-04-03.md)
  - [docs/seo/phase-7-external-verification-2026-04-03.md](/D:/autoparts/docs/seo/phase-7-external-verification-2026-04-03.md)

### 3. Product Search Quality Follow-up
- สถานะ: Phase E + F1 + F2 เสร็จแล้ว, phase ถัดไปถูกเพิ่มใน roadmap
- เอกสาร active: [docs/specs/product-search-log-analysis.md](/D:/autoparts/docs/specs/product-search-log-analysis.md)
- สิ่งที่ต้องทำต่อ:
  - [x] Phase F3 - Review Outcome Tracking
  - [x] Phase F4 - Fitment/Year Remediation Flow
  - [x] Phase F5 - Closed-Loop Measurement
  - [x] Phase F6 - Guarded Auto-Apply

## Source Of Truth Map
### Product and Inventory
- Stock movement + MAVG: `lib/stock-card.ts`
- Document numbers: `lib/doc-number.ts`
- VAT calculations: `lib/vat.ts`
- Prisma schema: `prisma/schema.prisma`

### Admin Rules
- Cross-module delivery/print/theme/search rules: [AGENTS.md](/D:/autoparts/AGENTS.md)

### Planning Docs
- Architecture overview: [docs/architecture.md](/D:/autoparts/docs/architecture.md)
- Active roadmap: [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
- Completed roadmap: [docs/roadmap/completed.md](/D:/autoparts/docs/roadmap/completed.md)
- Decision log index: [docs/decisions/README.md](/D:/autoparts/docs/decisions/README.md)
- Spec index: [docs/specs/README.md](/D:/autoparts/docs/specs/README.md)

## How To Use This Repo As AI
1. อ่าน [AGENTS.md](/D:/autoparts/AGENTS.md) ก่อนเสมอ
2. อ่านไฟล์นี้เพื่อดู current focus และ source of truth
3. เปิด [docs/architecture.md](/D:/autoparts/docs/architecture.md) ถ้าต้องเข้าใจภาพรวมระบบ
4. ถ้างานยัง active ให้ดู [docs/roadmap/active.md](/D:/autoparts/docs/roadmap/active.md)
5. ถ้าต้องตัดสินใจเชิงธุรกิจหรือ implementation rule ให้ดู `docs/decisions/`
6. ถ้าต้องลงลึกเป็นโมดูล ให้ดู `docs/specs/`

## Archive
- Master plan เดิมแบบละเอียดมาก: [docs/archive/PLAN-legacy-2026-05-21.md](/D:/autoparts/docs/archive/PLAN-legacy-2026-05-21.md)
- ห้ามใช้ archive เป็น entrypoint หลัก ยกเว้นต้องตาม historical detail
