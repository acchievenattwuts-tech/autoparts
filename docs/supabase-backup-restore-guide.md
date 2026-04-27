# Supabase Backup and Restore Guide

คู่มือนี้อธิบายวิธีสำรองข้อมูล `database` และ `Storage files` ของ Supabase ลงเครื่อง และวิธี restore กลับไปใช้กับ Supabase อย่างปลอดภัย โดยเน้น workflow ที่เหมาะกับโปรเจ็กต์นี้

อัปเดตล่าสุดที่ใช้อ้างอิง: 2026-04-22

เอกสารอ้างอิงทางการ:
- [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase Backup and Restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase Restore Dashboard backup](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore)
- [Supabase Download Objects](https://supabase.com/docs/guides/storage/management/download-objects)

## Overview

สิ่งสำคัญที่ต้องเข้าใจก่อน:

- Supabase `database backups` ไม่รวมไฟล์จริงใน Storage
- metadata ของไฟล์อยู่ใน database แต่ object file จริงต้องสำรองแยก
- ถ้าต้องการ backup ให้ครบ ต้องทำ 2 ส่วน
  - backup database
  - backup storage files
- ถ้าต้องการ restore เพื่อทดสอบหรือ rollback แนะนำให้ restore เข้า Supabase project ใหม่ก่อนเสมอ

## Scope

คู่มือนี้ครอบคลุม:

- backup ข้อมูล database ลงเครื่อง
- backup ไฟล์จริงใน Supabase Storage ลงเครื่อง
- restore database กลับไปยัง Supabase project ใหม่
- restore storage files กลับไปยัง Supabase Storage
- ตรวจสอบผลหลัง restore

คู่มือนี้ไม่ครอบคลุมทั้งหมดของ platform config เช่น:

- Auth settings
- Project API keys
- Edge Functions
- Realtime settings
- custom config นอก schema `public` หรือ `storage.buckets`

## Programs

โปรแกรมที่ต้องใช้มี 2 ชุด:

1. PostgreSQL client tools
   ใช้ `pg_dump` และ `psql`
2. `rclone`
   ใช้สำรองและอัปโหลดไฟล์ผ่าน S3-compatible endpoint ของ Supabase Storage

## Install Programs

### 1. Install PostgreSQL client tools

ติดตั้ง PostgreSQL หรือ PostgreSQL Command Line Tools ให้มีคำสั่งเหล่านี้ใช้งานได้:

- `pg_dump`
- `psql`

หลังติดตั้ง ให้เปิด PowerShell แล้วเช็ก:

```powershell
pg_dump --version
psql --version
```

ถ้าคำสั่งไม่เจอ ให้ปิดแล้วเปิด PowerShell ใหม่ หรือเพิ่ม PostgreSQL `bin` ลงใน `PATH`

### 2. Install rclone

ติดตั้ง `rclone` จากเว็บไซต์ทางการ แล้วตรวจว่าใช้งานได้:

```powershell
rclone version
```

## Prepare Information from Supabase

ก่อนเริ่ม backup ให้เตรียมข้อมูลจาก Supabase Dashboard ดังนี้

### 1. Database connection string

ไปที่:

- `Supabase Dashboard > Connect`

คัดลอก database connection string

ถ้าเลือกได้ ให้ใช้ `direct connection` สำหรับงาน backup/restore เพราะนิ่งกว่าสำหรับงานยาว

ตัวอย่างรูปแบบ:

```text
postgresql://postgres.<PROJECT-REF>:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres
```

### 2. Database password

ถ้าจำไม่ได้ ให้ reset ที่:

- `Database > Settings`

### 3. Storage S3 credentials

ไปที่:

- `Storage > Configuration > S3`

แล้วทำสิ่งต่อไปนี้:

- เปิด S3 protocol
- สร้าง access key
- เก็บ `Access Key`
- เก็บ `Secret Key`
- เก็บ `Endpoint`

หมายเหตุ:

- `Secret Key` ควรเก็บทันที เพราะบางหน้าจะแสดงเพียงครั้งเดียว

### 4. Bucket list

จดชื่อ buckets ที่ใช้งานอยู่ เพื่อใช้ตรวจตอน backup และ restore

## Recommended Backup Folder Structure

แนะนำโครงสร้างโฟลเดอร์แบบนี้:

```text
D:\backups\supabase-YYYY-MM-DD\
  db\
    public_schema.sql
    public_data.sql
    storage_buckets.sql
    full_public.sql
  storage\
```

ตัวอย่างจริง:

```text
D:\backups\supabase-2026-04-22\
  db\
  storage\
```

## Step-by-Step: Backup Database

### Step 1. Create backup folders

```powershell
$backupRoot = "D:\backups\supabase-2026-04-22"
New-Item -ItemType Directory -Force "$backupRoot\db" | Out-Null
New-Item -ItemType Directory -Force "$backupRoot\storage" | Out-Null
```

### Step 2. Set the production DB URL

แทนค่าตาม project จริง:

```powershell
$dbUrl = "postgresql://postgres.<PROJECT-REF>:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres"
```

### Step 3. Backup public schema

คำสั่งนี้สำรองโครงสร้างตาราง, index, constraints, และ objects ใน schema `public`

```powershell
pg_dump --dbname $dbUrl --schema=public --no-owner --no-privileges --schema-only --file "$backupRoot\db\public_schema.sql"
```

### Step 4. Backup public data

คำสั่งนี้สำรองข้อมูลในตารางของ schema `public`

```powershell
pg_dump --dbname $dbUrl --schema=public --no-owner --no-privileges --data-only --file "$backupRoot\db\public_data.sql"
```

### Step 5. Backup storage bucket definitions

คำสั่งนี้สำรอง metadata ของ buckets ใน `storage.buckets`

```powershell
pg_dump --dbname $dbUrl --schema=storage --table=storage.buckets --no-owner --no-privileges --data-only --file "$backupRoot\db\storage_buckets.sql"
```

### Step 6. Create a convenience full dump of public

ไฟล์นี้ไม่จำเป็นแต่แนะนำให้มีไว้ เผื่อใช้สำรองหรืออ่านย้อนดูง่าย

```powershell
pg_dump --dbname $dbUrl --schema=public --no-owner --no-privileges --file "$backupRoot\db\full_public.sql"
```

## What Each Database Backup File Means

- `public_schema.sql`
  ใช้สร้าง schema และโครงสร้างตาราง
- `public_data.sql`
  ใช้ restore ข้อมูลในตารางของแอป
- `storage_buckets.sql`
  ใช้ restore bucket definitions
- `full_public.sql`
  เป็น backup รวมทั้ง schema และ data ของ `public`

## Step-by-Step: Backup Storage Files

### Step 1. Configure rclone

รัน:

```powershell
rclone config
```

สร้าง remote ใหม่ เช่นชื่อ `supabase-prod`

ค่าที่ต้องกรอกโดยทั่วไป:

- type: `s3`
- provider: `Other`
- access key: ใช้ค่าจาก Supabase Dashboard
- secret key: ใช้ค่าจาก Supabase Dashboard
- endpoint: ใช้ S3 endpoint จาก Supabase Dashboard

### Step 2. Verify bucket access

```powershell
rclone lsd supabase-prod:
```

ถ้าเชื่อมต่อถูกต้อง จะเห็นรายชื่อ buckets

### Step 3. Sync all storage files to local machine

```powershell
rclone sync supabase-prod: "$backupRoot\storage"
```

คำสั่งนี้จะดึงไฟล์จาก remote ลงเครื่องให้ตรงกันทั้งหมด

### Step 4. Optional: Backup per bucket

ถ้าต้องการแยก bucket:

```powershell
rclone sync supabase-prod:my-bucket "$backupRoot\storage\my-bucket"
```

## Verify Backup

หลัง backup เสร็จ ควรเช็กทุกส่วน

### 1. Verify SQL files exist

```powershell
Get-Item "$backupRoot\db\*.sql"
```

### 2. Check file headers

```powershell
Get-Content "$backupRoot\db\public_schema.sql" -TotalCount 20
Get-Content "$backupRoot\db\public_data.sql" -TotalCount 20
```

### 3. Check storage folder contents

```powershell
Get-ChildItem "$backupRoot\storage"
```

### 4. Recommended extra safety

อย่าเก็บ backup แค่ในเครื่องเดียว ควรมีอีกอย่างน้อย 1 ชุด:

- external drive
- private cloud storage
- NAS

## Recommended Restore Strategy

ถ้าต้องการ restore ให้ปลอดภัย:

1. สร้าง Supabase project ใหม่
2. restore database เข้า project ใหม่
3. restore storage files เข้า project ใหม่
4. ตรวจระบบให้ครบ
5. ค่อยตัดสินใจว่าจะย้าย traffic หรือใช้เป็น recovery copy

## Step-by-Step: Restore Database to Supabase

### Step 1. Create a new Supabase project

สร้าง project ใหม่ใน Supabase Dashboard

### Step 2. Get the new project DB URL

ไปที่:

- `Connect`

แล้วตั้งตัวแปร:

```powershell
$newDbUrl = "postgresql://postgres.<NEW-PROJECT-REF>:<PASSWORD>@db.<NEW-PROJECT-REF>.supabase.co:5432/postgres"
```

### Step 3. Restore public schema

```powershell
psql --single-transaction --set ON_ERROR_STOP=1 --file "$backupRoot\db\public_schema.sql" --dbname $newDbUrl
```

### Step 4. Restore public data

ใช้ `session_replication_role = replica` เพื่อลดผลกระทบจาก triggers ระหว่าง restore

```powershell
psql --single-transaction --set ON_ERROR_STOP=1 --command "SET session_replication_role = replica" --file "$backupRoot\db\public_data.sql" --dbname $newDbUrl
```

### Step 5. Restore storage bucket definitions

```powershell
psql --single-transaction --set ON_ERROR_STOP=1 --file "$backupRoot\db\storage_buckets.sql" --dbname $newDbUrl
```

## Step-by-Step: Restore Storage Files to Supabase

### Step 1. Configure rclone for the new project

สร้าง remote ใหม่ เช่น `supabase-new`

รัน:

```powershell
rclone config
```

แล้วใส่ S3 endpoint / access key / secret key ของ project ใหม่

### Step 2. Verify buckets

หลัง restore `storage_buckets.sql` แล้ว ให้เช็กว่ามี buckets ที่ต้องการอยู่

```powershell
rclone lsd supabase-new:
```

### Step 3. Upload storage files back

```powershell
rclone sync "$backupRoot\storage" supabase-new:
```

หรือทีละ bucket:

```powershell
rclone sync "$backupRoot\storage\my-bucket" supabase-new:my-bucket
```

## Post-Restore Verification Checklist

หลัง restore เสร็จ ให้ตรวจดังนี้

### Database

- เปิด Table Editor แล้วเช็กว่าตารางใน `public` กลับมาครบ
- ตรวจจำนวนแถวของตารางสำคัญ
- ทดสอบ query หลักของระบบ

### Storage

- เปิด `Storage` แล้วเช็กว่ามี buckets ครบ
- ตรวจว่ามีไฟล์ในแต่ละ bucket
- ทดสอบเปิดไฟล์จริงจาก dashboard หรือจากหน้าเว็บ

### Application

- ลองเปิดหน้า dashboard
- ลองเปิดหน้าสินค้า
- ลองเปิดเอกสารที่อ้างถึงรูปหรือไฟล์
- เช็กว่ารูป/เอกสารแสดงผลได้จริง

## Troubleshooting

### psql or pg_dump not found

สาเหตุ:

- PostgreSQL client tools ยังไม่ได้ติดตั้ง
- `PATH` ยังไม่ถูกอัปเดต

วิธีแก้:

- ติดตั้ง PostgreSQL client tools
- เปิด PowerShell ใหม่

### Wrong password

สาเหตุ:

- ใช้รหัสผ่านเก่า
- เพิ่ง reset password แล้วระบบยังไม่ sync ทันที

วิธีแก้:

- reset password ใหม่ที่ `Database > Settings`
- รอสักครู่แล้วลองใหม่

### Storage files are missing after DB restore

สาเหตุ:

- DB backup ไม่ได้รวมไฟล์จริงใน Storage

วิธีแก้:

- ต้อง restore ไฟล์ด้วย `rclone sync` แยกต่างหาก

### Buckets exist but objects are empty

สาเหตุ:

- restore `storage_buckets.sql` แล้ว แต่ยังไม่ได้ upload files กลับ

วิธีแก้:

- sync โฟลเดอร์ local กลับขึ้น S3 endpoint ของ Supabase project ใหม่

## Best Practices

- ทำ backup ก่อนลบข้อมูล production ทุกครั้ง
- เก็บ backup อย่างน้อย 2 ที่
- ทดสอบ restore ใน project ใหม่ก่อนงานจริง
- จดวันเวลาและ project ref ของ backup ไว้ทุกครั้ง
- อย่าใช้ local backup แทน dashboard backups เพียงอย่างเดียว ให้มีทั้งสองแบบ

## Recommended Workflow Before Large Data Cleanup

สำหรับโปรเจ็กต์นี้ ถ้าจะลบข้อมูล test ใน production:

1. backup database ลงเครื่อง
2. backup storage files ลงเครื่อง
3. ตรวจว่า restore ทดสอบได้จริงใน project ใหม่
4. ค่อยเริ่ม cleanup production

## Quick Command Summary

### Backup

```powershell
$backupRoot = "D:\backups\supabase-2026-04-22"
New-Item -ItemType Directory -Force "$backupRoot\db" | Out-Null
New-Item -ItemType Directory -Force "$backupRoot\storage" | Out-Null

$dbUrl = "postgresql://postgres.<PROJECT-REF>:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres"

pg_dump --dbname $dbUrl --schema=public --no-owner --no-privileges --schema-only --file "$backupRoot\db\public_schema.sql"
pg_dump --dbname $dbUrl --schema=public --no-owner --no-privileges --data-only --file "$backupRoot\db\public_data.sql"
pg_dump --dbname $dbUrl --schema=storage --table=storage.buckets --no-owner --no-privileges --data-only --file "$backupRoot\db\storage_buckets.sql"
pg_dump --dbname $dbUrl --schema=public --no-owner --no-privileges --file "$backupRoot\db\full_public.sql"

rclone sync supabase-prod: "$backupRoot\storage"
```

### Restore

```powershell
$newDbUrl = "postgresql://postgres.<NEW-PROJECT-REF>:<PASSWORD>@db.<NEW-PROJECT-REF>.supabase.co:5432/postgres"

psql --single-transaction --set ON_ERROR_STOP=1 --file "$backupRoot\db\public_schema.sql" --dbname $newDbUrl
psql --single-transaction --set ON_ERROR_STOP=1 --command "SET session_replication_role = replica" --file "$backupRoot\db\public_data.sql" --dbname $newDbUrl
psql --single-transaction --set ON_ERROR_STOP=1 --file "$backupRoot\db\storage_buckets.sql" --dbname $newDbUrl

rclone sync "$backupRoot\storage" supabase-new:
```

