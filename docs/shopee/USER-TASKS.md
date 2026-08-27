# Shopee Integration — งานที่เจ้าของร้าน/แอดมินต้องทำเอง

> รายการนี้คือสิ่งที่ **คนต้องทำเอง** (สมัคร/ตั้งค่า/ยืนยันธุรกิจ) ระบบทำให้ไม่ได้
> ทำตามลำดับ; ข้อที่ติ๊กแล้วคือทำเสร็จ

## 1. สมัคร & ตั้งค่า Shopee Open Platform

- [ ] สมัคร/ยืนยัน developer account ที่ https://open.shopee.com
- [ ] สร้าง App ในระบบ Shopee Open Platform แล้วจด **Partner ID** + **Partner Key**
- [ ] เลือก API permissions/scope ที่ต้องใช้: **Order, Item, Logistics, Shop, Payment (escrow), Push (ถ้ามี)**
- [ ] ตั้ง **Callback / Redirect URL** ในแอป Shopee ให้ตรงเป๊ะ:
  - Production: `https://www.sriwanparts.com/api/shopee/callback`
  - Dev: `http://localhost:3000/api/shopee/callback`
- [ ] ตรวจสอบสถานะ app review และขอ **production access** ก่อนใช้งานจริง
- [ ] ตรวจว่า Shopee app ของร้านรองรับ **push/webhook** หรือไม่ (ถ้าไม่รองรับ จะใช้ scheduled pull เป็นหลัก)

## 2. ส่งค่าให้ทีมพัฒนา (ใส่ใน .env.local — ห้าม commit)

- [ ] `SHOPEE_PARTNER_ID`
- [ ] `SHOPEE_PARTNER_KEY`
- [ ] `SHOPEE_REDIRECT_URL` (ต้องตรงกับที่ตั้งใน Shopee app)
- [ ] `SHOPEE_API_ENV` = `test` (ตอนทดสอบ) / `live` (ตอนใช้งานจริง)
- [ ] แยก credential test กับ live ออกจากกันชัดเจน

## 3. Authorize ร้านครั้งแรก (ทำในหน้า admin หลัง Phase C เสร็จ)

- [ ] เข้า `/admin/marketplace/shopee` → กด "เชื่อมต่อร้าน Shopee" → login + อนุญาตสิทธิ์
- [ ] ตรวจว่าระบบเก็บ `shop_id`, token, วันหมดอายุ token เรียบร้อย (หน้าจะโชว์สถานะ "เชื่อมต่อแล้ว")

## 4. ตั้งค่าก่อนเปิด sync จริง

- [ ] Map สินค้า: จับคู่ Shopee item/model/SKU กับสินค้าในระบบ (มี auto-suggest ให้ยืนยัน)
- [ ] ตั้ง **stock buffer** ต่อร้าน/ต่อ mapping (กันขายเกิน เช่น สต็อกจริง 5 กันไว้ 1 → push 4)
- [ ] เลือก **sync mode** ต่อ mapping: `monitor_only` / `push_internal_to_shopee` / `disabled`
- [ ] รัน **dry-run** (จำลอง import โดยไม่สร้าง Sale จริง) แล้วตรวจผลก่อน approve
- [ ] ตั้งค่า **บัญชีพักเงิน Shopee + ลูกค้าเริ่มต้น** ที่ `/admin/sales/shopee/settlements` (ใช้ร่วมกันทั้งโหมด API และโหมดคีย์เอง — ต้องเป็นบัญชีคนละใบกับช่องทางอื่น)

## 5. ยืนยันกฎธุรกิจ (Open business decisions — ต้องตอบก่อน implement Phase F+)

- [ ] Shopee order ถือเป็น **prepaid / COD / ผสม** ตาม payment field ของ Shopee?
- [ ] ตัดสต็อกตอนสถานะไหน: **paid / ready-to-ship / printed label / shipped**?
- [ ] สินค้าที่คุม lot ใน Shopee: ให้ **auto-allocate FIFO/FEFO** หรือ **รอแอดมินเลือก lot เสมอ**?
- [ ] ผู้ซื้อ Shopee: สร้างเป็น **Customer ปกติ** หรือเก็บเป็น **order snapshot** อย่างเดียว?
- [ ] การแก้ tracking: **push กลับ Shopee** หรือให้ **Shopee เป็น source of truth** ของ logistics?
- [ ] กฎ stock buffer ของ Shopee เพื่อไม่ให้หน้าร้าน walk-in ขายชนสต็อก marketplace?
- [ ] ออเดอร์ที่ถูกยกเลิก/คืนเงินใน Shopee: ให้ **คืนสต็อกอัตโนมัติ** หรือ **เข้า review queue / CN flow** ก่อน?

## 5.1 ตั้ง Vercel Cron (สำหรับ token refresh อัตโนมัติ)

- [ ] ตั้ง env `CRON_SECRET` ใน Vercel project (Settings → Environment Variables) — Vercel จะแนบ `Authorization: Bearer <CRON_SECRET>` ให้ cron อัตโนมัติ
- [ ] ตาราง cron ถูกประกาศไว้ใน `vercel.json` แล้ว — deploy แล้ว Vercel รันให้เอง:
  - `/api/shopee/cron/refresh-tokens` ทุกชั่วโมง (refresh token)
  - `/api/shopee/cron/pull-orders` ทุก 30 นาที (ดึงออเดอร์เข้า queue) — **ดึงเฉพาะร้านที่เปิด `syncEnabled`**
- [ ] (รอ follow-up) เปิด `syncEnabled` ของร้านเพื่อให้ auto-pull ทำงาน — ตอนนี้ใช้ปุ่ม "ดึงออเดอร์จาก Shopee" แบบ manual ได้เลย
  - **หมายเหตุ plan:** Vercel Hobby รัน cron ได้วันละครั้งและสูงสุด 2 jobs; ถ้าต้องการรายชั่วโมงต้องใช้ Pro — ปรับ `schedule` ใน `vercel.json` ได้ตามแผน
  - ถ้ายังไม่ตั้ง: ระบบ refresh token แบบ on-demand ก่อนเรียก API อยู่แล้ว (cron เป็น proactive layer + แจ้งเตือนก่อนหมดอายุ)

## 6. การดูแลต่อเนื่อง (operations)

- [ ] ต่ออายุ/หมุน credential เมื่อ Shopee แจ้งหมดอายุ
- [ ] ตรวจ reconciliation report (สต็อกในระบบ vs Shopee) เป็นระยะ
- [ ] จัดการ SKU ที่ยังไม่ map / ออเดอร์ที่ค้าง review queue
- [ ] ดูแลการสลับ test → production ตอน Shopee อนุมัติ
