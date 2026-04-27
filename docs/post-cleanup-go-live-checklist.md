# Post-Cleanup Go-Live Checklist

คู่มือนี้สรุปสิ่งที่ควรทำต่อหลังจากลบข้อมูลสินค้าและ transaction ออกจาก production แล้ว เพื่อเตรียมเริ่มใช้งานด้วยข้อมูลจริง

อัปเดตล่าสุด: 2026-04-22

## Current Status

หลัง cleanup แล้ว:

- transaction tables ถูกลบออกแล้ว
- `Product`, `Customer`, `Supplier`, `FactProfit` และเอกสารทั้งหมดเหลือ `0`
- `CashBankAccount` ยังอยู่ครบ 3 บัญชี และ `openingBalance = 0`
- build ผ่านหลัง cleanup

## Masters That Still Exist

master ที่ยังอยู่ในระบบตอนนี้:

- `Category`
- `PartsBrand`
- `CarBrand`
- `CarModel`
- `ExpenseCode`
- `CashBankAccount`
- `SiteContent`
- `User`, `Role`, `Permission`
- LINE mappings และ settings บางส่วน

## Immediate Review Before Real Data Entry

### 1. Review company information

ตรวจและแก้ข้อมูลร้านที่หน้า:

- [page.tsx](/D:/autoparts/app/admin/(protected)/settings/company/page.tsx)

สิ่งที่ควรเช็ก:

- ชื่อร้าน
- เบอร์โทร
- ที่อยู่
- social links
- VAT settings
- logo
- ข้อความในเอกสารพิมพ์

## 2. Review retained master data

ข้อมูลเหล่านี้ยังอยู่จากรอบก่อนและควรตรวจว่าเป็นข้อมูลจริงหรือข้อมูลทดสอบ

### Categories

ตอนนี้มี 11 รายการ เช่น:

- คอมเพรสเซอร์แอร์
- หม้อน้ำรถยนต์
- แผงคอนเดนเซอร์
- ท่อแอร์
- ดรายเออร์

### Parts brands

ตอนนี้มี 3 รายการ:

- `AMZTON`
- `Denso`
- `FOMULA`

ถ้าอันไหนเป็นข้อมูลทดสอบ ควรลบหรือแก้ก่อนเริ่มใช้งานจริง

### Expense codes

ตอนนี้มี 4 รายการ:

- `E0001` ค่าไฟฟ้า
- `E0002` ค่าน้ำปะปา
- `E0003` `E003` และ inactive
- `E0004` ค่าอะไหล่

แนะนำให้ทบทวนชื่อและ active status โดยเฉพาะ `E0003`

### Cash-bank accounts

ตอนนี้มี 3 บัญชี:

- `CASH-MAIN`
- `BANK-KBANK`
- `BANK-KTB`

ตอนนี้ยอดตั้งต้นเป็น `0` แล้วทั้งหมด

แนะนำให้เช็กต่อ:

- ชื่อบัญชี
- เปิด/ปิดการใช้งาน
- `openingDate`
- เลือกบัญชีโอนหลักถ้าต้องใช้ QR หรือ payment flow

## 3. Recreate real suppliers

ตาราง `Supplier` ถูกลบแล้วทั้งหมด จึงต้องสร้างใหม่ด้วยข้อมูลจริง

หน้าใช้งาน:

- `/admin/master/suppliers`

สิ่งที่ควรกรอก:

- ชื่อ supplier
- รหัส supplier ถ้าใช้
- เบอร์โทร
- ที่อยู่
- เลขภาษี

## 4. Recreate real customers if needed

ตาราง `Customer` ถูกลบแล้วทั้งหมด

ถ้าระบบจะเริ่มจากการขายใหม่ทั้งหมด สามารถให้ระบบสร้างจากการใช้งานจริงได้

แต่ถ้าต้องมีลูกค้าหลักไว้ก่อน ควรสร้างใหม่ด้วยข้อมูลจริง

หน้าใช้งาน:

- `/admin/customers`

## 5. Recreate products

ตาราง `Product` และ relation ของสินค้าเหลือ `0` แล้ว

ก่อนเริ่มสร้างสินค้า แนะนำให้ confirm master ด้านล่างก่อน:

- categories
- parts brands
- suppliers
- car brands/models

จากนั้นค่อยเริ่มที่:

- `/admin/products/new`

สิ่งที่ควรระวัง:

- slug
- หน่วยซื้อ/ขาย
- preferred supplier
- warranty days
- lot control / expiry settings

## 6. Set opening balances through business flow

เพราะ `BalanceForward`, `StockCard`, lot tables และ ledger movements ถูกลบหมดแล้ว

ถ้าจะเริ่มระบบจริง แนะนำให้ใช้ flow มาตรฐานของระบบ:

- ตั้งยอดสินค้าเริ่มต้นที่ `/admin/stock/bf`
- ถ้าสินค้าใช้ lot ให้กรอก lot ตั้งต้นผ่าน BF

## 7. Recheck reporting expectations

เพราะ transaction data เหลือ `0`:

- reports จะว่างเป็นปกติ
- dashboard cards ที่อิงเอกสารจะต้องแสดง empty state ไม่ใช่ error

build ผ่านแล้ว แต่หลังเริ่มลงข้อมูลจริงรอบแรก แนะนำให้ทดสอบ:

- สร้างสินค้า 1 ตัว
- BF 1 รายการ
- ซื้อ 1 ใบ
- ขาย 1 ใบ
- รับเงิน 1 ใบ
- ดู report หลักอีกครั้ง

## Seed Notes

ไฟล์ seed ปัจจุบัน:

- [seed.ts](/D:/autoparts/prisma/seed.ts)

สิ่งที่ seed ปัจจุบันทำ:

- optional admin user จาก env
- default cash-bank accounts
- categories ชุดเริ่มต้น
- car brands และ car models ชุดเริ่มต้น

สิ่งที่ seed ปัจจุบันยังไม่ได้ทำ:

- suppliers
- customers
- products
- parts brands
- expense codes

## Optional Seed Command

ถ้าต้องการให้ระบบ ensure categories, car brands/models, และ cash-bank defaults อีกครั้ง:

```powershell
npx tsx --env-file=.env.local prisma/seed.ts
```

หมายเหตุ:

- ถ้าใช้คำสั่งนี้โดยไม่ตั้ง `SEED_ADMIN_USERNAME` และ `SEED_ADMIN_PASSWORD` ระบบจะข้ามการสร้าง admin user
- คำสั่งนี้ไม่สร้างสินค้า, supplier, หรือ customer

## Recommended First Real-Data Workflow

ลำดับที่แนะนำสำหรับเริ่มใช้งานจริง:

1. ตรวจ company settings
2. ทบทวน categories / parts brands / expense codes / cash-bank accounts
3. สร้าง suppliers จริง
4. สร้าง products จริง
5. ตั้ง BF เริ่มต้น
6. ทดลอง purchase 1 ใบ
7. ทดลอง sale 1 ใบ
8. ทดลอง receipt 1 ใบ
9. ตรวจ stock card, cash-bank, reports, และ print forms

## Final Reminder

ก่อนเริ่มลงข้อมูลจริง:

- อย่าเพิ่ง import ข้อมูลจำนวนมากในรอบแรก
- ทดลองด้วยข้อมูลจริงจำนวนน้อยก่อน
- หลัง flow แรกผ่านแล้วค่อยลงข้อมูลเพิ่ม

