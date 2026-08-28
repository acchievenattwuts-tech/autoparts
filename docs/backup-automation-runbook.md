# Weekly Backup Automation Runbook

คู่มือตั้งค่าและกู้คืนระบบสำรองข้อมูลอัตโนมัติ ที่สำรอง **ฐานข้อมูล Supabase** และ **ไฟล์รูปทั้งหมดใน Vercel Blob** ขึ้น **Google Drive** ทุกสัปดาห์

สร้างเมื่อ: 2026-08-17

## ภาพรวม

| หัวข้อ | ค่า |
|---|---|
| ตัวรันงาน | GitHub Actions — [.github/workflows/backup.yml](../.github/workflows/backup.yml) |
| ตารางเวลา | ทุกวันจันทร์ 02:00 น. เวลาไทย (cron `0 19 * * 0` UTC) |
| สั่งเอง | ปุ่ม "สำรองข้อมูลเดี๋ยวนี้" ในหน้า Backup Center หรือปุ่ม Run workflow บน GitHub |
| ปลายทาง | Google Drive ผ่าน `rclone` |
| แจ้งเตือน | Telegram ทั้งกรณีสำเร็จและล้มเหลว |
| เก็บย้อนหลัง | dump + report 90 วัน / ไฟล์รูปเก็บสะสมไม่ลบ |

**ทำไมต้องรันบน GitHub ไม่ใช่บน Vercel** — Vercel serverless runtime ไม่มีคำสั่ง `pg_dump` และมีลิมิตเวลาทำงาน 300 วินาที ส่วน runner ของ GitHub เป็น Ubuntu เต็มรูปแบบ ติดตั้ง `pg_dump` และ `rclone` ได้ และให้เวลาถึง 6 ชั่วโมง

**ทำไมต้องเป็น Google Drive** — backup ที่อยู่กับผู้ให้บริการเดียวกับ production ไม่ใช่ backup ข้อมูลจริงอยู่ที่ Supabase + Vercel ส่วนสำเนาอยู่ Google คนละเจ้ากันทั้งหมด

## โครงสร้างไฟล์บน Google Drive

```text
autoparts-backup/
  db/
    postgres-2026-08-17.dump          ← pg_dump custom format (ใช้ pg_restore)
    blob-manifest-2026-08-17.json     ← รายการไฟล์รูปทั้งหมด ณ วันนั้น
  blob-mirror/
    products/<code>/<file>.webp       ← ไฟล์จริง เก็บสะสม ไม่เคยลบ
    expenses/... , line/... ฯลฯ
  state/
    blob-index.json                   ← ตัวจำว่าไฟล์ไหนสำรองไปแล้ว (etag)
  reports/
    REPORT-2026-08-17.txt             ← ขนาด dump, จำนวนไฟล์, จำนวนแถวต่อตาราง
```

`state/blob-index.json` คือหัวใจของการทำงานแบบ incremental — รอบถัดไปจะโหลดเฉพาะไฟล์ที่ `etag` เปลี่ยน ทำให้ egress จาก Vercel Blob แทบเป็นศูนย์หลังรอบแรก

## ขั้นตอนตั้งค่า (ทำครั้งเดียว)

### 1. สร้าง role อ่านอย่างเดียวใน Supabase

เปิด `Supabase Dashboard > SQL Editor` แล้วรัน (เปลี่ยนรหัสผ่านเป็นของจริงที่สุ่มขึ้นมาเอง):

```sql
create role backup_reader with login bypassrls password 'ใส่รหัสผ่านสุ่มยาว ๆ ตรงนี้';

grant connect on database postgres to backup_reader;
grant usage on schema public to backup_reader;
grant select on all tables in schema public to backup_reader;
grant select on all sequences in schema public to backup_reader;

-- ตารางที่สร้างใหม่ในอนาคตจะได้สิทธิ์อ่านอัตโนมัติ ไม่ต้องกลับมารันซ้ำ
alter default privileges in schema public grant select on tables to backup_reader;
alter default privileges in schema public grant select on sequences to backup_reader;
```

ถ้า role มีอยู่แล้ว ให้เปิด `BYPASSRLS` แยกต่างหาก:

```sql
alter role backup_reader bypassrls;
```

ทำไมถึงคุ้มที่จะทำ: credential ตัวนี้จะไปอยู่ใน GitHub Secrets ถ้าหลุด คนที่ได้ไปก็ทำได้แค่อ่าน — เขียน แก้ หรือลบข้อมูลไม่ได้

จากนั้นประกอบ connection string โดยใช้ **direct connection** หรือ **session pooler**
(พอร์ต 5432) ห้ามใช้ transaction pooler พอร์ต 6543 เพราะไม่เหมาะกับ `pg_dump` ที่รันนาน

ตัวอย่าง direct connection:

```text
postgresql://backup_reader:<PASSWORD>@db.<PROJECT-REF>.supabase.co:5432/postgres
```

ถ้าเครื่อง runner ต่อ direct host ไม่ได้ ให้ใช้ session pooler และใส่ project ref ต่อท้ายชื่อ role:

```text
postgresql://backup_reader.<PROJECT-REF>:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
```

> **หมายเหตุเรื่อง RLS** — Production เปิด row-level security บนตาราง `public` ดังนั้น
> `backup_reader` ต้องมี `BYPASSRLS` เพื่อให้ dump ครบทุกแถว แต่ยังคงให้เฉพาะ `CONNECT`,
> `USAGE`, และ `SELECT`; ห้ามให้ `SUPERUSER`, `CREATEDB`, `CREATEROLE`, หรือสิทธิ์เขียน
> workflow ตรวจทั้งรายชื่อตาราง RLS และ flag ของ role หากพบ RLS โดยไม่มี `BYPASSRLS`
> จะหยุดก่อนสร้าง dump

### 2. ตั้งค่า rclone ให้ต่อ Google Drive

ทำบนเครื่องตัวเองครั้งเดียว เพื่อสร้างไฟล์ config แล้วค่อยยกไปใส่ GitHub

#### 2.1 ติดตั้ง rclone

```powershell
winget install Rclone.Rclone
```

ปิด PowerShell แล้วเปิดใหม่ (ให้ PATH อัปเดต) จากนั้นเช็ก:

```powershell
rclone version
```

#### 2.2 สร้าง OAuth client ของตัวเองใน Google Cloud

ข้ามขั้นนี้ได้ (กด Enter ผ่าน `client_id` / `client_secret` ตอน config) แต่ **ไม่แนะนำ** เพราะจะไปใช้ client id กลางที่ผู้ใช้ rclone ทั้งโลกใช้ร่วมกัน Google จะจำกัดอัตราการเรียกจนอัปโหลดช้าหรือหลุดกลางคัน ใช้เวลาทำประมาณ 5 นาที

1. เข้า [Google Cloud Console](https://console.cloud.google.com/) → สร้าง project ใหม่ ตั้งชื่อเช่น `autoparts-backup`
2. `APIs & Services > Library` → ค้น **Google Drive API** → กด **Enable**
3. `APIs & Services > OAuth consent screen` → เลือก **External** → กรอกชื่อแอป, email ผู้ติดต่อ, email นักพัฒนา
4. **สำคัญที่สุด** — ไปที่หน้า Audience แล้วกด **Publish app** เปลี่ยนสถานะจาก `Testing` เป็น `In production`

   ถ้าปล่อยไว้ที่ `Testing` **refresh token ของ Google จะหมดอายุใน 7 วัน** แล้ว backup จะพังเงียบ ๆ ตั้งแต่สัปดาห์ที่สองเป็นต้นไป นี่คือสาเหตุอันดับหนึ่งที่ backup ผ่าน rclone หยุดทำงานเอง

   scope `drive.file` ที่เราจะใช้ไม่ใช่ restricted scope จึงกด publish ได้เลยโดยไม่ต้องส่งให้ Google ตรวจสอบ (ถ้าเจอหน้าให้ยื่นขอ verification แปลว่าเลือก scope ผิด)
5. `APIs & Services > Credentials` → `Create Credentials` → `OAuth client ID` → Application type เลือก **Desktop app** → กด Create
6. เก็บ **Client ID** และ **Client secret** ไว้ใช้ขั้นถัดไป

#### 2.3 รัน rclone config

```powershell
rclone config
```

ตอบตามนี้:

| คำถาม | ตอบ |
|---|---|
| `e/n/d/r/c/s/q>` | `n` (New remote) |
| `name>` | `gdrive` |
| `Storage>` | `drive` |
| `client_id>` | Client ID จากข้อ 2.2 |
| `client_secret>` | Client secret จากข้อ 2.2 |
| `scope>` | **`3`** = `drive.file` |
| `service_account_file>` | Enter (ปล่อยว่าง) |
| `Edit advanced config?` | `n` |
| `Use web browser to automatically authenticate?` | `y` |
| หน้าเบราว์เซอร์ | เลือกบัญชี Google → กด Continue → อนุญาต |
| `Configure this as a Shared Drive?` | `n` |
| `y/e/d>` | `y` (ยืนยัน) |
| `e/n/d/r/c/s/q>` | `q` (ออก) |

**ทำไมต้องเป็น scope `drive.file`** — scope นี้ให้ rclone เห็นเฉพาะไฟล์ที่ rclone สร้างเองเท่านั้น ไฟล์อื่นทั้งหมดใน Google Drive ของคุณมองไม่เห็นและแตะไม่ได้เลย ต่อให้ token หลุดออกไป ความเสียหายก็จำกัดอยู่แค่โฟลเดอร์ backup

ผลข้างเคียงที่ต้องรู้: **ห้ามสร้างโฟลเดอร์ `autoparts-backup` เองผ่านหน้าเว็บ Drive** เพราะ rclone จะมองไม่เห็นโฟลเดอร์ที่ตัวเองไม่ได้สร้าง ต้องให้ rclone สร้างด้วยคำสั่งในข้อถัดไป และด้วยเหตุผลเดียวกันจึง**ไม่ต้องตั้ง `root_folder_id`**

#### 2.4 ให้ rclone สร้างโฟลเดอร์แล้วทดสอบ

```powershell
rclone mkdir gdrive:autoparts-backup
rclone lsd gdrive:
```

ต้องเห็น `autoparts-backup` ในรายการ จากนั้นลองเขียนไฟล์จริง:

```powershell
"test" | Out-File -Encoding utf8 test.txt
rclone copy test.txt gdrive:autoparts-backup
rclone ls gdrive:autoparts-backup
rclone delete gdrive:autoparts-backup/test.txt
Remove-Item test.txt
```

ถ้าเห็น `test.txt` ในผลลัพธ์ `rclone ls` แปลว่าใช้งานได้แล้ว

#### 2.5 แปลง config เป็น base64

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:APPDATA\rclone\rclone.conf")) | Set-Clipboard
```

ค่าอยู่ใน clipboard แล้ว เอาไปวางใน GitHub Secret `RCLONE_CONFIG_BASE64` ในขั้นตอนถัดไป

> ไฟล์ `rclone.conf` มี refresh token ของ Google Drive อยู่ข้างใน ปฏิบัติกับมันเหมือนรหัสผ่าน อย่า commit ลง git เด็ดขาด

### 3. ใส่ GitHub Secrets

ไปที่ `GitHub repo > Settings > Secrets and variables > Actions > New repository secret` แล้วเพิ่ม 6 ตัว:

| ชื่อ Secret | ค่า |
|---|---|
| `BACKUP_DATABASE_URL` | connection string ของ `backup_reader` จากข้อ 1 |
| `BLOB_READ_WRITE_TOKEN` | token เดียวกับที่ใช้ใน Vercel |
| `RCLONE_CONFIG_BASE64` | ค่า base64 จากข้อ 2 |
| `RCLONE_REMOTE` | `gdrive:autoparts-backup` |
| `TELEGRAM_BOT_TOKEN` | token เดียวกับที่ใช้ในระบบ |
| `TELEGRAM_CHAT_IDS` | chat id คั่นด้วยจุลภาค |

### 4. เปิดใช้ปุ่มในหน้า Backup Center

สร้าง fine-grained personal access token ที่ `GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens`:

- Repository access: เลือกเฉพาะ repo นี้
- Permissions → Repository permissions → **Actions: Read and write** (ต้องมีตัวนี้เท่านั้น อย่าให้สิทธิ์อื่นเกินจำเป็น)
- Expiration: ตั้งวันหมดอายุแล้วจดไว้ในปฏิทิน เพราะเมื่อหมดอายุปุ่มจะใช้ไม่ได้ (ตารางอัตโนมัติยังทำงานปกติ)

แล้วเพิ่ม env ใน `Vercel > Project > Settings > Environment Variables`:

```text
GITHUB_BACKUP_TOKEN = github_pat_xxxxxxxx
GITHUB_BACKUP_REPO  = acchievenattwuts-tech/autoparts
```

deploy ใหม่หนึ่งครั้ง แล้วปุ่มในหน้า Backup Center จะพร้อมใช้งาน

### 5. ทดสอบ

กดปุ่ม "สำรองข้อมูลเดี๋ยวนี้" หนึ่งครั้ง แล้วดูว่า:

- สถานะในหน้าเปลี่ยนเป็น "กำลังทำงาน" ภายในไม่กี่วินาที
- Telegram เด้งแจ้งผลเมื่อเสร็จ
- บน Google Drive มีไฟล์ครบทั้ง 4 โฟลเดอร์
- เปิด `reports/REPORT-<วันที่>.txt` ดูว่าจำนวนแถวสมเหตุสมผล

**รอบแรกจะช้าที่สุด** เพราะต้องโหลดไฟล์รูปทั้งหมด รอบถัดไปจะเหลือไม่กี่นาที

## การกู้คืน

> ห้าม restore ทับ production โดยตรง ให้ restore เข้า Supabase project ใหม่ก่อนเสมอ แล้วค่อยตัดสินใจ

### กู้คืนฐานข้อมูล

```powershell
rclone copy gdrive:autoparts-backup/db/postgres-2026-08-17.dump .

$newDbUrl = "postgresql://postgres:<PASSWORD>@db.<NEW-PROJECT-REF>.supabase.co:5432/postgres"
pg_restore --dbname $newDbUrl --no-owner --no-acl --clean --if-exists .\postgres-2026-08-17.dump
```

ถ้าต้องการกู้แค่ตารางเดียว:

```powershell
pg_restore --dbname $newDbUrl --no-owner --no-acl --data-only --table=Product .\postgres-2026-08-17.dump
```

ดูว่าใน dump มีอะไรบ้างโดยไม่ต้อง restore:

```powershell
pg_restore --list .\postgres-2026-08-17.dump
```

### กู้คืนไฟล์รูป

ไฟล์ใน `blob-mirror/` เก็บด้วย pathname เดิมของ Vercel Blob เป๊ะ ๆ การกู้คืนคืออัปโหลดกลับเข้า Blob store ด้วย pathname เดิม แล้ว URL เดิมจะกลับมาใช้ได้

กู้ทั้งหมด:

```powershell
rclone copy gdrive:autoparts-backup/blob-mirror D:\restore\blob-mirror
npx tsx scripts/backup-blob-restore.ts --source D:\restore\blob-mirror
```

กู้ไฟล์เดียว — หา pathname จาก `blob-manifest-<วันที่>.json` แล้วดึงเฉพาะไฟล์นั้น:

```powershell
rclone copy "gdrive:autoparts-backup/blob-mirror/products/AB123/main.webp" D:\restore\
```

> สคริปต์ `backup-blob-restore.ts` ยังไม่ได้เขียน — ตอนนี้ถ้าต้องกู้ไฟล์จำนวนมากให้แจ้งก่อน จะเขียนให้ตอนนั้น เพราะการอัปโหลดทับ Blob store เป็นงานที่ต้องคุมมือ ไม่ควรมีสคริปต์พร้อมยิงวางทิ้งไว้

## Troubleshooting

### Telegram แจ้งว่า backup ล้มเหลว

เปิดลิงก์ในข้อความไปดู log ของ step ที่แดง แล้วกด Re-run jobs บน GitHub หรือกดปุ่มในแอปอีกครั้ง

### `Row-level security is enabled on: ...`

มีใครเปิด RLS บนตารางใน `public` — dump จะได้ข้อมูลไม่ครบ ต้องเลือกอย่างใดอย่างหนึ่ง: ปิด RLS บนตารางนั้น หรือรัน `alter role backup_reader bypassrls;` แล้วสั่งรันใหม่

### ปุ่มในแอปขึ้นว่า "ยังไม่ได้ตั้งค่า"

ยังไม่ได้ใส่ `GITHUB_BACKUP_TOKEN` / `GITHUB_BACKUP_REPO` ใน Vercel หรือใส่แล้วแต่ยังไม่ได้ redeploy

### ปุ่มขึ้นว่า token ไม่มีสิทธิ์

PAT หมดอายุ หรือไม่ได้ให้สิทธิ์ `Actions: Read and write` — สร้างใหม่แล้วอัปเดต env ใน Vercel

### rclone แจ้ง `token expired` หรือ `invalid_grant`

refresh token ของ Google หมดอายุ สาเหตุที่พบบ่อยที่สุดคือ OAuth consent screen ยังค้างสถานะ `Testing` ซึ่ง Google ให้ token อายุแค่ 7 วัน — เข้า Google Cloud Console กด Publish app ให้เป็น `In production` แล้วรัน `rclone config reconnect gdrive:` บนเครื่อง จากนั้นอัปเดต Secret `RCLONE_CONFIG_BASE64` ใหม่

### ตารางอัตโนมัติหยุดไปเอง

GitHub ปิด scheduled workflow อัตโนมัติเมื่อ repo ไม่มี commit ใหม่ติดต่อกัน 60 วัน ถ้าเกิดขึ้นจะมีอีเมลแจ้ง เข้าไปกด Enable workflow ในแท็บ Actions

### เนื้อที่ Google Drive เต็ม

`blob-mirror/` เก็บสะสมโดยตั้งใจ (เป็นด่านสุดท้ายกันไฟล์ถูกลบพลาด) ถ้าเนื้อที่ตึงจริง ๆ ให้ดู `removedSinceLastRun` ใน manifest ล่าสุดเพื่อรู้ว่าไฟล์ไหนไม่ได้อยู่ใน production แล้ว แล้วค่อยตัดสินใจลบทีละรายการ อย่าใช้ `rclone sync` กับโฟลเดอร์นี้เด็ดขาด เพราะจะลบไฟล์เก่าทิ้งทันที

## สิ่งที่ระบบนี้ไม่ครอบคลุม

- ตั้งค่าฝั่ง Supabase platform (Auth settings, API keys, Edge Functions, Realtime)
- schema อื่นนอกจาก `public` — โดยเฉพาะ `auth` และ `storage` ของ Supabase
- bucket ชั่วคราวของ purchase OCR ใน Supabase Storage (มี cron ลบทิ้งอยู่แล้ว ไม่ต้องสำรอง)
- environment variables ทั้งหมดใน Vercel — **ต้องเก็บสำเนาไว้เองในที่ปลอดภัย** ถ้าไม่มีชุดนี้ ต่อให้กู้ข้อมูลกลับมาได้ก็ deploy ระบบใหม่ไม่ได้

## สิ่งที่ควรทำต่อเนื่อง

- **ซ้อมกู้คืนจริงไตรมาสละครั้ง** — restore เข้า Supabase project ใหม่แล้วเปิดหน้าเว็บดูว่ารูปขึ้นครบ backup ที่ไม่เคยกู้คืน คือ backup ที่ยังไม่รู้ว่าใช้ได้จริงหรือเปล่า
- เปิด backup อัตโนมัติฝั่ง Supabase ควบคู่กันไว้เป็นด่านแรกสำหรับกู้เร็ว ระบบนี้เป็นด่านสองที่รอดแม้บัญชี Supabase มีปัญหา
- ทบทวนวันหมดอายุของ PAT และ refresh token ของ Google Drive ปีละครั้ง
