# Shopee Integration — Operations Runbook

> คู่มือปฏิบัติการสำหรับดูแล Shopee integration หลัง deploy
> ภาพรวมสถาปัตยกรรมดูที่ [README.md](./README.md) · งานตั้งค่าครั้งแรกดูที่ [USER-TASKS.md](./USER-TASKS.md)

---

## 1. ต่ออายุ / หมุน credential

### Partner Key เปลี่ยน (rotate)
1. อัปเดต `SHOPEE_PARTNER_KEY` ใน env (Vercel → Settings → Environment Variables)
2. Redeploy เพื่อให้ค่าใหม่มีผล
3. ไม่ต้อง re-authorize ร้าน — partner key ใช้ตอน sign request เท่านั้น

### Access token / refresh token
- ระบบ refresh อัตโนมัติ 2 ชั้น:
  - **on-demand**: `getValidShopAuth()` refresh ก่อนเรียก API ทุกครั้งถ้าใกล้หมดอายุ
  - **proactive**: Vercel Cron `/api/shopee/cron/refresh-tokens` (รายชั่วโมง)
- ถ้า refresh ล้มเหลว → มี notification + Telegram แจ้ง "Token ใกล้หมดอายุ"
- **กู้คืน**: ไปหน้า `/admin/marketplace/shopee` → กด "เชื่อมต่อร้าน Shopee" ใหม่ (re-authorize)

### Refresh token หมดอายุ (revoked/expired)
- สถานะร้านจะเป็น `REVOKED` หรือ `EXPIRED`
- ต้อง re-authorize ใหม่จากหน้า overview (token เก่าถูกล้าง)

---

## 2. กู้ sync ที่ล้มเหลว

### ตรวจสอบ
- ดู `ShopeeSyncJob` (status `FAILED` + `lastError`) — query ผ่าน DB หรือ Stock Sync page
- ดู notification bell / Telegram สำหรับ alert ล่าสุด

### Sync lock (กันรันซ้อน)
- order pull ถูกป้องกันด้วย sync lock ต่อ `(shopRecordId, ORDER_PULL)`
- ถ้ามี job `RUNNING` อยู่ → รอบใหม่จะ **skip** (เห็นในผลลัพธ์ `skipped`)
- job ที่ `RUNNING` เกิน **10 นาที** ถือว่า crash → lock ปลดอัตโนมัติ รอบถัดไปรันได้
- ถ้าค้างผิดปกติ: หา job `RUNNING` ที่เก่าผิดปกติแล้ว set เป็น `FAILED` (manual) เพื่อปลด lock ทันที

### Retry
- **order pull**: กด "ดึงออเดอร์จาก Shopee" บนหน้า `/admin/marketplace/shopee/orders` (หรือรอ cron รอบถัดไป)
- **logistics / return scan**: ปุ่มบนหน้าเดียวกัน
- client มี retry + exponential backoff อยู่แล้วเฉพาะ operation ที่ idempotent (network/timeout/5xx/error_server)

---

## 3. จัดการ unmapped SKU

- ออเดอร์ที่มีสินค้ายังไม่ map → สถานะ `NEEDS_SKU_MAPPING` ในคิว + notification
- ไปหน้า `/admin/marketplace/shopee/products`:
  - กด "ดึงสินค้าจาก Shopee" → ระบบ auto-suggest map ตาม SKU == รหัสสินค้า
  - หรือ map เองด้วย item_id / model_id / SKU
- pull รอบถัดไปจะ re-evaluate ออเดอร์เดิม → ถ้า map ครบแล้วจะเป็น `PENDING` (พร้อมสร้างบิล)

---

## 4. สลับ test (sandbox) → production

1. เปลี่ยน `SHOPEE_API_ENV` จาก `test` → `live`
2. ใส่ `SHOPEE_PARTNER_ID` / `SHOPEE_PARTNER_KEY` ของ app production
3. ตั้ง `SHOPEE_REDIRECT_URL` = `https://www.sriwanparts.com/api/shopee/callback` (ต้องตรงกับที่ลงทะเบียนใน Shopee app)
4. Redeploy → re-authorize ร้านด้วย credential production
5. ตรวจ: หน้า overview แสดงสถานะ `AUTHORIZED` + token หมดอายุถูกต้อง
6. **แนะนำ dry-run ก่อน**: ดึงออเดอร์ + ตรวจ preview การสร้างบิล (ราคา/จำนวน) ก่อนกดยืนยันจริง

---

## 5. ตรวจก่อนสร้างบิลจริง (safety)

- หน้า preview ออเดอร์ (`/orders/[id]`) เป็น dry-run — แสดงรายการ/ราคา/blockers ก่อนสร้าง Sale
- **ราคา line** อ่านจาก `model_discounted_price` — ตรวจให้ตรงกับยอด Shopee ก่อนยืนยันเสมอ
- บิล Shopee = `CASH_SALE` เข้าบัญชี "Shopee พักเงิน" → เงินจริงเข้าธนาคารบันทึกผ่านเมนู "โอนเงินระหว่างบัญชี"
- สินค้าคุม lot → ต้องเลือก lot ก่อน (ปัจจุบัน preview จะ block ไว้)

---

## 6. แจ้งเตือน (Telegram)

- ตั้ง `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_IDS` ใน env (ว่าง = ปิด, ระบบ degrade gracefully)
- ยิงเมื่อมี `NotificationType.SHOPEE_*` ใหม่: order ใหม่/import fail, stock sync fail, token ใกล้หมดอายุ, cancel/refund review
- dedupe ด้วย `Notification.dedupeKey` — ไม่ยิงซ้ำถ้า unread เดิมยังอยู่

---

## 7. ของที่ยังไม่เปิด (รอ verify กับ live API)

- live stock push (`update_stock`), live logistics/return/escrow API pull — ปัจจุบันทำงานบน order snapshot + reconciliation เป็นหลัก
- webhook ingestion (ใช้ scheduled pull แทน)
- circuit breaker เต็มรูปแบบ (ตอนนี้มี retry/backoff ใน client + sync lock กันรันซ้อน)

---

## Quick reference — endpoints & menus

| งาน | ที่ |
|---|---|
| ภาพรวม/เชื่อมต่อร้าน | `/admin/marketplace/shopee` |
| map สินค้า | `/admin/marketplace/shopee/products` |
| คิวออเดอร์ / สร้างบิล | `/admin/marketplace/shopee/orders` |
| stock sync | `/admin/marketplace/shopee/stock` |
| token refresh cron | `POST /api/shopee/cron/refresh-tokens` (Vercel) |
| order pull cron | `POST /api/shopee/cron/pull-orders` (Vercel) |
| เงิน Shopee เข้าธนาคารจริง | `/admin/cash-bank/transfers` |
| ค่าธรรมเนียม Shopee | `/admin/expenses` |
