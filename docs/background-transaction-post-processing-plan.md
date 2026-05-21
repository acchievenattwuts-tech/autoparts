# แผนงาน Phase: ย้ายงานตามหลัง Transaction ไปทำเบื้องหลัง

วันที่จัดทำ: 2026-05-20  
เป้าหมายหลัก: ทำให้การบันทึก transaction รู้สึกไวขึ้น โดยไม่กระทบ logic สำคัญเดิมของ stock, lot, AR/AP, cash-bank movement, permission, document number และการ rollback ของ core transaction

## หลักการตัดสินใจ

งานที่จะย้ายไป background ต้องเป็นงานตามหลังที่ derive จากข้อมูลจริง หรือเป็นงานเสริมที่ไม่ใช้ตัดสินผลการบันทึก ณ ตอนนั้นเท่านั้น

ห้ามย้ายงานเหล่านี้ออกจาก transaction หลัก:

- `writeStockCard(...)`
- lot validation, lot allocation, lot balance write, `StockMovementLot`
- `replaceCashBankSourceMovements(...)` สำหรับ movement หลัก
- `recalculateSaleAmountRemain(...)`, `recalculateCNAmountRemain(...)` และ AR/AP remain หลัก
- document number generation
- permission/session validation
- reference-chain validation ก่อน edit/cancel

งาน background ต้องยอมรับ eventual consistency เฉพาะส่วนที่เป็น audit, reporting, projection, snapshot หรือ warranty snapshot ที่ไม่ถูกใช้เป็นตัวตัดสินการบันทึกทันที

## Scope งานที่จะย้าย

1. ย้าย `safeWriteAuditLog(...)`

   เป้าหมาย: ไม่ให้ request หลักรอการเขียน audit log หลัง transaction สำเร็จ

   เงื่อนไข:
   - ต้องยังคงมี audit log สำหรับทุก mutation ตาม `.rules`
   - ถ้า enqueue job ล้ม ต้องไม่ทำให้เอกสารหลัก rollback หลังจาก core transaction commit แล้ว
   - job ต้อง retry ได้ และต้องไม่สร้าง audit log ซ้ำ

   จุดระวัง:
   - audit snapshot ต้องตรงกับจังหวะของ event ไม่ใช่ state ล่าสุดหลังมีคนแก้ซ้ำ
   - ต้องมี `idempotencyKey` เช่น `audit:${entityType}:${entityId}:${action}:${version}`
   - ห้าม log secrets, token, password หรือข้อมูลอ่อนไหว

2. ย้าย audit snapshot reads

   เป้าหมาย: ลด query หลังบันทึกที่ใช้เพื่อสร้าง before/after audit payload

   แนวทาง:
   - สำหรับ create: ส่ง `after` payload ที่จำเป็นจากผลลัพธ์ใน transaction หรือ enqueue ด้วย `entityId` + `eventVersion`
   - สำหรับ update/cancel: เก็บ `before` snapshot ก่อน mutation ตามเดิมถ้าจำเป็นต่อ diff แต่พิจารณาส่ง snapshot payload เข้า job เพื่อลดการอ่านซ้ำหลัง transaction
   - หลีกเลี่ยงการให้ worker ไปอ่านข้อมูลล่าสุดอย่างเดียว เพราะอาจไม่ตรงกับ event ที่เกิดจริง

   จุดระวัง:
   - ไม่เพิ่ม query หนักใน transaction เพียงเพื่อย้ายงานออกไป
   - ต้องใช้ `select` เฉพาะ field ที่ audit ต้องใช้
   - ต้องจำกัด payload ไม่ให้ใหญ่เกินจำเป็น โดยเฉพาะเอกสารที่มีหลาย items/lots

3. ย้าย `rebuildSaleProfitFacts(...)`

   เป้าหมาย: ลดเวลาบันทึก sale/edit sale โดยย้ายงาน projection ด้านกำไรออกจาก request หลัก

   เงื่อนไข:
   - sale หลัก, stock, lot, cash-bank และ amountRemain ต้อง commit เสร็จก่อน enqueue
   - report กำไรต้องยอมรับสถานะ pending/processing ชั่วคราว
   - job ต้อง idempotent เพราะ retry อาจเกิดซ้ำ

   จุดระวัง:
   - `FactProfit` เป็น report projection ไม่ใช่ source of truth
   - ถ้า sale ถูกแก้ซ้ำก่อน job เก่าทำงาน ต้องให้ job เก่ารู้ว่า stale แล้ว skip หรือ rebuild ตาม version ล่าสุดอย่างปลอดภัย
   - ควรมี unique/idempotency guard ต่อ `sourceType + sourceId + versionNo` หรือ job key ที่ชัดเจน

4. ย้าย report/snapshot/export refresh

   เป้าหมาย: ไม่ให้ transaction save flow รอการ refresh ข้อมูลรายงานหรือ snapshot ที่ derive จากข้อมูลจริง

   ขอบเขตที่ทำได้:
   - report projection refresh
   - dashboard/workboard snapshot ที่ไม่ใช่ source of truth
   - export dataset preparation/cache ถ้ามีการสร้าง cache ในอนาคต
   - cash-bank summary/report snapshot แต่ไม่ใช่ `CashBankMovement` หลัก

   จุดระวัง:
   - ผู้ใช้อาจเห็นรายงานเก่าชั่วคราว ต้องมี timestamp หรือสถานะ "กำลังอัปเดต"
   - ห้าม query full scan บนตารางใหญ่ เช่น `StockCard`, `CashBankMovement`, `FactProfit`
   - ต้องใช้ pagination, date range, `take`, index และ `select` ตาม `.rules`

5. ย้าย `createWarrantySnapshots(...)`

   เป้าหมาย: ลดเวลาบันทึก sale ที่มีสินค้า warranty จำนวนมาก

   เงื่อนไขก่อนย้าย:
   - ต้องยืนยันว่าไม่มี flow ที่ต้องใช้ warranty ทันทีหลังบันทึก sale
   - หน้า detail/print/claim ต้องรับมือสถานะ warranty snapshot pending ได้
   - job ต้องสร้าง warranty แบบ idempotent ไม่ซ้ำเมื่อ retry

   จุดระวัง:
   - ถ้าขายจำนวนมาก งานนี้สร้าง row ตามจำนวนชิ้น จึงต้องระวัง batch size
   - ถ้า sale ถูก cancel ก่อน job เสร็จ ต้อง skip หรือ mark cancelled-safe
   - ถ้ามี lot sequence สำหรับ warranty ต้องรักษา mapping ให้ตรงกับ sale item เดิม

## งานที่ไม่อยู่ใน Scope

- ไม่ย้าย `revalidatePath(...)` ใน phase นี้ เพราะอาจทำให้ผู้ใช้เห็นข้อมูลเก่าทันทีหลังบันทึก
- ไม่เปลี่ยนสูตร MAVG, lot cost, AR/AP remain, cash-bank ledger movement
- ไม่เพิ่ม business rule ใหม่ใน transaction save flow
- ไม่แก้ schema โดยไม่สรุป field และขออนุมัติก่อน
- ไม่เพิ่ม cron loop หรือ worker ที่ไม่มีสถานะให้ admin ตรวจสอบ

## Architecture ที่เสนอ

### 1. Background Job Foundation

ต้องมี job storage หรือ queue provider ที่บันทึกสถานะได้อย่างน้อย:

- `id`
- `type`
- `status`: `PENDING`, `PROCESSING`, `RETRYING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `SKIPPED`
- `entityType`
- `entityId`
- `entityRef`
- `idempotencyKey`
- `payload`
- `attemptCount`
- `maxAttempts`
- `runAt`
- `startedAt`
- `finishedAt`
- `lastError`
- `createdByUserId`
- `createdAt`
- `updatedAt`

สถานะต้องอ่านได้ใน admin เพื่อให้ผู้ใช้รู้ว่างานตามหลังสำเร็จหรือไม่

### 2. Retry Policy

แนะนำค่าเริ่มต้น:

- `maxAttempts = 5`
- backoff: 1 นาที, 5 นาที, 15 นาที, 1 ชั่วโมง, 3 ชั่วโมง
- retry เฉพาะ transient errors เช่น timeout, connection reset, lock timeout
- non-retryable errors เช่น payload invalid, entity not found แบบถาวร, permission context invalid ต้อง mark `FAILED`

ทุก retry ต้อง idempotent และไม่สร้างข้อมูลซ้ำ

### 3. Idempotency

ทุก job ต้องมี `idempotencyKey` ที่ unique

ตัวอย่าง:

- audit create: `audit:Sale:<saleId>:CREATE:<eventVersion>`
- profit fact rebuild: `profit-fact:Sale:<saleId>:<saleUpdatedAt>`
- warranty snapshot: `warranty-snapshot:Sale:<saleId>:<saleUpdatedAt>`
- report refresh: `report-refresh:<reportName>:<scope>:<dateKey>`

ถ้าเจอ key เดิม:

- ถ้า job สำเร็จแล้ว ให้ skip
- ถ้า job กำลังทำอยู่ ให้ไม่สร้างซ้ำ
- ถ้า job failed และ user กด retry ให้ใช้ job เดิมหรือสร้าง retry run ที่อ้างอิง key เดิมอย่างชัดเจน

### 4. Version/Stale Guard

งานที่อ่าน entity ภายหลังต้องมี guard:

- เก็บ `entityUpdatedAt` หรือ `eventVersion` ตอน enqueue
- ก่อนทำงานให้ตรวจว่ายังตรงกับ state ที่คาดไว้หรือไม่
- ถ้า stale ให้ `SKIPPED` พร้อมเหตุผล หรือ enqueue job ใหม่สำหรับ version ล่าสุด

ใช้กับ:

- audit snapshot reads
- `rebuildSaleProfitFacts(...)`
- `createWarrantySnapshots(...)`
- report/snapshot refresh ที่ผูกกับเอกสาร

## UI/UX Plan

### ตำแหน่งแสดงสถานะ

1. หน้า detail ของเอกสาร

   แสดงสถานะงานตามหลังใกล้ header/เลขเอกสาร:
   - เอกสารถูกบันทึกแล้ว
   - กำลังอัปเดตข้อมูลตามหลัง
   - สำเร็จ
   - ลองใหม่อัตโนมัติ
   - ไม่สำเร็จ ต้องตรวจสอบ

2. หน้า list ของเอกสาร

   แสดง badge ต่อแถวแบบสั้น:
   - `พร้อมใช้งาน`
   - `กำลังอัปเดต`
   - `มีงานล้มเหลว`

3. หน้า admin สำหรับ background jobs

   ใช้สำหรับ owner/admin ตรวจงานค้างและ retry manual:
   - filter ตาม status/type/date/entity
   - แสดง attempt count, last error, updated time
   - ปุ่ม retry เฉพาะ job ที่ failed และผู้ใช้มี permission

### หน้า Background Jobs

Route ที่เสนอ:

- `/admin/system/background-jobs`

Permission ที่เสนอ:

- `system.jobs.view` สำหรับดูรายการและรายละเอียด job
- `system.jobs.retry` สำหรับสั่ง retry job ที่ล้มเหลว
- `system.jobs.cancel` สำหรับยกเลิก job ที่ยังไม่เริ่ม ถ้าธุรกิจต้องการในอนาคต

ข้อกำหนด permission:

- ต้องเพิ่ม permission ใน `lib/access-control.ts`
- ต้องเพิ่ม route rule ใน `ADMIN_ROUTE_RULES`
- ต้องเพิ่มเมนูใน sidebar หรือ Quick Search เฉพาะผู้มีสิทธิ์
- ถ้าเพิ่มเมนูหรือ entrypoint ต้อง sync Quick Search ตามกฎ Admin Quick Search
- ทุก Server Action ของ retry/cancel ต้องเรียก `requirePermission(...)`

หน้ารายการต้องมี filters:

- ค้นหา: docNo, entityRef, entityId, idempotencyKey
- Job type: audit, profit fact, report refresh, warranty snapshot
- Status: all, pending, processing, retrying, succeeded, failed, cancelled, skipped
- Entity type: Sale, Purchase, Receipt, Adjustment, Report, Warranty
- วันที่สร้างงาน: from/to
- วันที่อัปเดตล่าสุด: from/to

กฎ filter/search:

- ใช้ `AdminSearchForm` + `AdminSearchSubmitButton`
- filter ผ่าน query string
- date-only ต้องใช้ helper จาก `lib/th-date.ts`
- query list ต้องมี pagination หรือ `take` ไม่เกิน 100-200
- ต้องใช้ `select` เฉพาะ columns ที่แสดง
- ห้ามโหลด `payload` หรือ `lastError` เต็มใน list ถ้าข้อมูลยาว ให้แสดง preview และเปิด detail drawer/page แยก

Columns ในตาราง:

- เวลา: createdAt / updatedAt
- ประเภทงาน
- สถานะ
- เอกสาร: entityType + entityRef พร้อม link ไปเอกสารต้นทางถ้ามี
- attempt: `attemptCount / maxAttempts`
- runAt / next retry time
- runtime ล่าสุด
- error preview
- action: ดูรายละเอียด, retry

หน้ารายละเอียด job หรือ detail drawer:

- job id
- idempotency key
- entity type/id/ref
- status timeline
- attempts history ถ้ามี
- payload แบบ redacted
- last error แบบ user-safe
- technical error เฉพาะ admin ที่มีสิทธิ์สูง ถ้าจำเป็น
- ปุ่ม retry เฉพาะ status ที่ retry ได้

Manual retry UX:

- แสดงปุ่ม retry เฉพาะ job status `FAILED` หรือ `SKIPPED` เฉพาะกรณีที่ retry ได้
- ก่อน retry ต้องแสดง dialog ยืนยันสั้น ๆ ว่าเป็นงานตามหลัง ไม่ใช่การบันทึกเอกสารใหม่
- หลัง retry ให้เปลี่ยนสถานะเป็น `PENDING` หรือ `RETRYING`
- ต้องแสดง toast ภาษาไทย เช่น "ส่งงานไปลองใหม่แล้ว"
- ถ้า retry ไม่ได้ ต้องแสดงเหตุผล เช่น stale version, entity ถูกยกเลิก, job สำเร็จไปแล้ว
- การ retry manual ต้องไม่สร้าง job ซ้ำถ้า idempotency key เดิมกำลังทำงานอยู่

ข้อความสถานะภาษาไทยที่เสนอ:

- `PENDING`: รอดำเนินการ
- `PROCESSING`: กำลังประมวลผล
- `RETRYING`: รอลองใหม่
- `SUCCEEDED`: สำเร็จ
- `FAILED`: ไม่สำเร็จ
- `CANCELLED`: ยกเลิก
- `SKIPPED`: ข้ามงาน

Badge สีที่เสนอ:

- pending/retrying: เหลืองหรือ amber
- processing: ฟ้า
- succeeded: เขียว
- failed: แดง
- cancelled/skipped: เทา

ต้องทำทั้ง light mode และ dark mode ในรอบเดียวกัน

Mobile/responsive:

- บนมือถือให้แสดงเป็น compact cards แทนตารางกว้าง
- card ต้องแสดง status, type, entityRef, attempt และ updatedAt ก่อน
- error preview ต้องตัดบรรทัด ไม่ทำให้ layout ล้น
- action buttons ต้องกดง่ายและไม่เบียดกัน
- หลีกเลี่ยงข้อความยาวใน badge

Audit สำหรับ manual retry/cancel:

- การกด retry/cancel job โดยผู้ใช้ต้องเขียน Audit Log
- audit action ที่เสนอ: `RETRY` หรือใช้ action ที่ catalog รองรับพร้อม meta ชัดเจน
- meta ควรมี `jobId`, `jobType`, `entityType`, `entityId`, `entityRef`, `previousStatus`, `nextStatus`, `attemptCount`
- audit ของการ retry เองสามารถใช้ background audit ได้ถ้าระบบพร้อม แต่ต้องไม่ทำให้ retry action ล้มเพราะ audit ล้ม

Performance ของหน้า jobs:

- list query ต้อง index ตาม field ที่ใช้บ่อย: `status`, `type`, `entityType`, `entityId`, `createdAt`, `updatedAt`, `runAt`, `idempotencyKey`
- default view ควรแสดงเฉพาะงานที่ยังไม่สำเร็จหรืออัปเดตล่าสุดก่อน ตาม UX ที่เลือก
- ถ้าแสดง succeeded ควรจำกัด date range หรือ pagination ชัดเจน
- ห้าม query payload/error ขนาดใหญ่ใน list
- detail page/drawer ค่อยโหลด payload/error ของ job เดียว

### กฎ UI สำคัญ

- แยกสถานะเอกสาร (`ACTIVE`, `CANCELLED`) ออกจากสถานะงานตามหลัง
- ห้ามใช้คำที่ทำให้ผู้ใช้เข้าใจว่าเอกสารยังไม่ถูกบันทึก ถ้า core transaction commit แล้ว
- รองรับ light/dark mode พร้อมกัน
- responsive บนมือถือ โดย badge ต้องไม่ดันตารางจนอ่านยาก
- ไม่ทำ full page refresh สำหรับ filter/search ใหม่ ให้ใช้ pattern `AdminSearchForm` + `AdminSearchSubmitButton` ถ้ามีหน้า admin filter
- error message สำหรับผู้ใช้ต้องเป็นภาษาไทยที่เข้าใจง่าย ไม่เปิด stack trace

## Performance Rules

ทุก implementation ใน phase นี้ต้องทำตามกฎต่อไปนี้:

- query เฉพาะ field ด้วย `select`
- ห้าม query ใน loop ถ้าสามารถ batch ได้
- ใช้ `Promise.all()` เมื่อ query เป็นอิสระและไม่อยู่ใน transaction ที่ต้องลำดับชัดเจน
- job processor ต้องจำกัด batch size
- หน้า list jobs ต้องมี pagination หรือ `take`
- table ใหญ่ต้องมี index สำหรับ field ที่ใช้ `where`/`orderBy`
- ห้ามทำ full scan `StockCard`, `CashBankMovement`, `AuditLog`, `FactProfit`
- วัดเวลาก่อน/หลังอย่างน้อยใน dev หรือ staging สำหรับ sale, purchase, receipt, adjustment

## Phased Implementation

### Phase A: Baseline และ Job Foundation

- [ ] วัด baseline save time ของ sale, sale edit, purchase, purchase edit, receipt, adjustment
- [ ] ระบุ transaction ที่ช้าสุด 3 อันดับแรก
- [ ] ออกแบบ job schema/queue provider พร้อม idempotency
- [ ] เพิ่ม job status model หรือ reuse queue/job model ที่เหมาะสม ถ้ามีอยู่แล้ว
- [ ] เพิ่ม worker/job handler ที่ validate signature หรือ internal guard
- [ ] เพิ่ม retry/backoff และ dead failure state
- [ ] เพิ่มหน้า `/admin/system/background-jobs` สำหรับดู job status แบบ read-only ก่อน
- [ ] เพิ่ม filters, pagination, responsive card layout และ dark mode สำหรับหน้า jobs
- [ ] เพิ่ม permission `system.jobs.view` และ route guard

Acceptance criteria:

- มี job record ที่เห็นสถานะได้
- job duplicate ถูกกันด้วย idempotency
- failed job มี `lastError` และ retry count
- หน้า jobs responsive และมี light/dark mode
- หน้า jobs ไม่โหลด payload/error เต็มใน list
- Quick Search และ sidebar permission sync ถูกต้องถ้าเพิ่ม entrypoint

### Phase B: Audit Log Background

- [ ] แยก audit event enqueue helper
- [ ] ย้าย `safeWriteAuditLog(...)` หลัง transaction ไปเป็น job
- [ ] ปรับ audit snapshot strategy เพื่อลด query หลัง save
- [ ] เพิ่ม retry/idempotency สำหรับ audit job
- [ ] เพิ่ม manual retry สำหรับ audit failed job
- [ ] เพิ่ม permission `system.jobs.retry` และ Server Action สำหรับ retry failed job
- [ ] เขียน Audit Log เมื่อผู้ใช้กด manual retry

Acceptance criteria:

- mutation หลักยังสำเร็จแม้ audit job ล้ม
- audit job retry แล้วไม่สร้าง log ซ้ำ
- audit log ยังครบตาม `.rules`
- ไม่มีการอ่าน field เกินจำเป็น
- manual retry เปลี่ยนสถานะ job ถูกต้องและไม่สร้าง duplicate job
- manual retry มี audit trail

### Phase C: Profit Fact Background

- [ ] ย้าย `rebuildSaleProfitFacts(...)` จาก sale create/update ไปเป็น job หลัง commit
- [ ] เพิ่ม stale/version guard สำหรับ sale ที่ถูกแก้ซ้ำ
- [ ] เพิ่มสถานะ profit projection บน sale detail/list หรือ job widget
- [ ] ทดสอบ sale create/edit/cancel กับรายงานกำไร

Acceptance criteria:

- sale save time ลดลงเมื่อเทียบ baseline
- รายงานกำไรแสดงสถานะ pending/updated ได้
- retry ไม่สร้าง `FactProfit` ซ้ำ
- sale ที่แก้ซ้ำไม่โดน job เก่าทับ state ใหม่

### Phase D: Report/Snapshot/Export Refresh

- [ ] ระบุ report/snapshot/export ที่เป็น projection เท่านั้น
- [ ] ย้าย refresh ที่ไม่ใช่ source of truth ไปเป็น job
- [ ] เพิ่ม timestamp "อัปเดตล่าสุด"
- [ ] เพิ่ม guard ไม่ให้ job report query ตารางใหญ่แบบ full scan

Acceptance criteria:

- report ยอมรับ eventual consistency ได้และมีสถานะบอกผู้ใช้
- ไม่มี N+1 query ใหม่
- หน้า report/job list มี pagination หรือ limit

### Phase E: Warranty Snapshot Background

- [ ] ตรวจทุก flow ที่ใช้ warranty หลัง sale
- [ ] เพิ่ม warranty snapshot job สำหรับ sale create/update
- [ ] เพิ่ม idempotency ต่อ sale item/warranty unit
- [ ] เพิ่ม UI state ถ้า warranty ยังสร้างไม่ครบ
- [ ] ทดสอบ sale ที่มี qty มากและ lot sequence

Acceptance criteria:

- sale save time ดีขึ้นในเคส warranty qty มาก
- warranty ไม่ซ้ำเมื่อ retry
- cancel sale ก่อน job เสร็จไม่สร้าง warranty ที่ควรยกเลิก
- claim flow ไม่เห็นข้อมูลครึ่งกลางแบบทำให้ผู้ใช้สับสน

## Test Plan

### Unit/Integration

- [ ] enqueue duplicate job แล้วต้องได้ job เดิมหรือ skip
- [ ] worker retry transient error แล้วสำเร็จ
- [ ] worker non-retryable error แล้ว mark `FAILED`
- [ ] stale job ต้อง `SKIPPED` หรือ enqueue version ล่าสุด
- [ ] audit job retry ไม่สร้าง log ซ้ำ
- [ ] profit fact job retry ไม่สร้าง active fact ซ้ำ
- [ ] warranty job retry ไม่สร้าง warranty ซ้ำ

### End-to-End Manual

- [ ] create sale เงินสด + stock + lot + cash-bank movement ยังถูกต้อง
- [ ] edit sale แล้ว stock/lot/amountRemain ยังถูกต้อง
- [ ] create purchase + lot ยังถูกต้อง
- [ ] create receipt แล้ว AR amountRemain ยังถูกต้อง
- [ ] create adjustment แล้ว stock/lot ยังถูกต้อง
- [ ] background job failed แล้วผู้ใช้เห็นสถานะและ retry ได้
- [ ] mobile admin เห็น badge/status โดย layout ไม่แตก
- [ ] dark mode status badge อ่านง่าย

### Performance Verification

- [ ] เปรียบเทียบ save time ก่อน/หลังสำหรับ sale create
- [ ] เปรียบเทียบ save time ก่อน/หลังสำหรับ sale edit
- [ ] เปรียบเทียบ save time ก่อน/หลังสำหรับ purchase create/edit
- [ ] เปรียบเทียบ save time ก่อน/หลังสำหรับ receipt
- [ ] ตรวจ slow query log หรือ Prisma timing ในจุด worker สำคัญ

## Rollback Plan

- Feature flag แยกตาม job type:
  - `BACKGROUND_AUDIT_ENABLED`
  - `BACKGROUND_PROFIT_FACT_ENABLED`
  - `BACKGROUND_REPORT_REFRESH_ENABLED`
  - `BACKGROUND_WARRANTY_SNAPSHOT_ENABLED`

- ถ้าเกิดปัญหา:
  - ปิด flag เฉพาะ job type ที่มีปัญหา
  - กลับไปทำ synchronous เฉพาะส่วนนั้น
  - job ที่ค้างให้ mark `CANCELLED` หรือ retry หลังแก้ไขแล้ว

ห้าม rollback ด้วยการลบข้อมูลธุรกรรมหลัก

## Monitoring และ Alert

ต้องมีอย่างน้อย:

- จำนวน `FAILED` jobs แยกตาม type
- จำนวน `PENDING` jobs ที่ค้างเกิน SLA
- ค่าเฉลี่ย runtime ต่อ job type
- จำนวน retry ต่อวัน
- last successful run ต่อ job type

SLA เบื้องต้น:

- audit job: ควรสำเร็จภายใน 1 นาที
- profit fact job: ควรสำเร็จภายใน 5 นาที
- report/snapshot refresh: ควรสำเร็จภายใน 5-15 นาที ตามขนาดข้อมูล
- warranty snapshot: ควรสำเร็จภายใน 1-5 นาที

## Definition of Done

- บันทึก transaction หลักไวขึ้นโดยวัดได้จาก baseline
- core logic เดิมไม่เปลี่ยนและยัง rollback ใน `dbTx(...)` เหมือนเดิม
- job มีสถานะ, retry, idempotency, stale guard และ manual retry
- UI แสดงสถานะชัดเจนโดยไม่ทำให้ผู้ใช้เข้าใจผิดว่าเอกสารหลักยังไม่บันทึก
- ไม่มี N+1 query ใหม่
- ไม่มี full scan บนตารางใหญ่
- ผ่าน `npm run build`
- อัปเดต `PLAN.md` หลัง implementation จริงตามกฎ roadmap maintenance
