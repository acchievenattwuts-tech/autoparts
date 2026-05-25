# Product Search F6 Deploy Checklist

## Scope

Checklist นี้ครอบคลุมการเปิดใช้งาน `Phase F6 - Guarded Auto-Apply` สำหรับ `SearchSynonym` เท่านั้น

- In scope: dry-run + guarded auto-apply + outcome/audit verification
- Out of scope: ProductAlias/OEM auto-apply, fitment/year auto-apply

## Preconditions

- [ ] โค้ด F6 deploy แล้ว (route: `/admin/reports/product-search-no-result`)
- [ ] DB schema ล่าสุดถูก apply แล้ว (F3/F5 fields อยู่ครบ)
- [ ] Role ผู้เปิด/ปิด setting มีสิทธิ์ `settings.company.manage`
- [ ] Role ผู้กด auto-apply มีสิทธิ์ `search_synonyms.update`
- [ ] มีข้อมูล low/no-result logs ในช่วงวันที่ที่จะทดสอบ

## Release Controls

- [ ] เริ่มจากปิด Toggle `Auto-apply SearchSynonym` ที่ `/admin/settings/company`
- [ ] กำหนด owner ที่อนุมัติการเปิด setting ชัดเจน
- [ ] กำหนดช่วงเวลาเปิดใช้งาน (แนะนำช่วงที่ทีมดูแลอยู่)
- [ ] ตรวจ audit log หลังเปลี่ยน setting เพราะการบันทึกใช้ action ตั้งค่าร้านค้าเดิม

## Deploy Steps

1. Deploy โค้ดขึ้น environment เป้าหมาย
2. ตรวจหน้า `/admin/settings/company` ว่ามี Toggle `Auto-apply SearchSynonym`
3. ตรวจหน้า `/admin/reports/product-search-no-result` เข้าได้ปกติ
4. กด `Run dry-run` และยืนยันว่ามี panel `Guarded Auto-Apply`
5. ตรวจ summary dry-run:
   - `Eligible`
   - `Rejected by guard`
   - `Write mode` ต้องเป็น `Dry-run only` ถ้า Toggle ยังปิด
6. ตรวจตาราง dry-run ว่ามีเหตุผล reject/eligible แสดงครบ

## Enable Setting

1. เข้า `/admin/settings/company`
2. เปิด Toggle `Auto-apply SearchSynonym`
3. กดบันทึกการตั้งค่า
4. กลับเข้า report เดิม แล้วกด `Run dry-run` ใหม่
5. ยืนยัน `Write mode` เปลี่ยนเป็น `Available`

## Smoke Test (Production-safe)

1. เลือกช่วงวันที่แคบ ๆ ที่รู้ข้อมูลแน่ชัด
2. กด `Run dry-run`
3. ตรวจว่ารายการ eligible เป็น `search-synonym` เท่านั้น
4. กด `Auto-apply eligible`
5. ยืนยันมี success message กลับมาหน้าเดิม
6. ตรวจแถวที่ถูก apply:
   - Review status = `Applied`
   - มี note ที่มี rollback guidance

## Data Verification

- [ ] ตรวจ `SearchSynonym` ว่ามีการ create/update ตาม dry-run
- [ ] ตรวจว่าไม่เกิน max synonyms ต่อ term
- [ ] ตรวจว่าไม่มี synonym ซ้ำข้าม term แบบผิดเงื่อนไข guard
- [ ] ตรวจ `ProductSearchReviewOutcome`:
  - status = `APPLIED`
  - appliedType = `SearchSynonymAutoApply`
  - appliedRef ถูกเขียน
  - reviewedAt/reviewedBy ถูกเขียน
- [ ] ตรวจ Audit Log:
  - มี event `CREATE`/`UPDATE` ของ `SearchSynonym`
  - มี event update/create ของ `ProductSearchReviewOutcome`
  - มี event update ของ `CompanySettings` เมื่อเปิด/ปิด Toggle

## Rollback Runbook

กรณี apply ผิด:

1. เข้า `/admin/settings/company` แล้วปิด Toggle `Auto-apply SearchSynonym`
2. เข้า `/admin/master/search-synonyms`
3. เปิดแถว term ที่ถูก apply
4. ลบ synonym ที่ไม่ต้องการ หรือ set `isActive = false`
5. กลับไป report แล้ว mark outcome ตามจริง (เช่น `needs-investigation` พร้อม note)

## Post-Release Monitoring (3-7 days)

- [ ] ติดตาม Closed-loop summary ใน report:
  - improved / unchanged / regressed / unmeasured
- [ ] ตรวจคำที่ยัง low/no-result ซ้ำหลัง apply
- [ ] รวบรวม false-positive เพื่อปรับ eligibility rules รอบถัดไป
- [ ] สรุปผลสั้น ๆ ต่อทีม (จำนวน apply, จำนวนที่ดีขึ้น, จำนวนที่ต้อง rollback)

## Exit Criteria

- [ ] มี auto-apply สำเร็จอย่างน้อย 1 รอบโดยไม่มี incident
- [ ] มีหลักฐาน outcome + audit + rollback path ครบ
- [ ] ทีมยืนยันว่าจะเปิดใช้ต่อเนื่องหรือปิด Toggle ชั่วคราวพร้อมเหตุผล
