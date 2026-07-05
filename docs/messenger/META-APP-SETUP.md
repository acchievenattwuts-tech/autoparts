# คู่มือตั้งค่า Facebook Messenger AI Agent (Meta App) — Step by Step

คู่มือนี้สำหรับ **เจ้าของร้าน/แอดมิน** ทำเองบน Meta ตั้งแต่ศูนย์จนบอทตอบ DM ได้จริง
โค้ดฝั่งระบบ (webhook + AI) ทำเสร็จแล้ว — เหลือแค่ตั้งค่าฝั่ง Meta + กรอก env

> **ค่าที่ระบบใช้ (ล็อกไว้แล้ว):**
> - Webhook URL: `https://www.sriwanparts.com/api/messenger/webhook`
> - Callback สำหรับ recover (cron): `https://www.sriwanparts.com/api/messenger/ai-jobs/recover`
> - Graph API version: `v23.0`
> - Facebook Page: **ศรีวรรณ อะไหล่แอร์**
> - Meta Business Portfolio: **ศรีวรรณ อะไหล่แอร์** (มีแล้ว)

---

## ภาพรวม 8 ขั้น

| ขั้น | ทำที่ไหน | ผลลัพธ์ |
|---|---|---|
| 1 | Meta Business | Business verification (เริ่มก่อน รอนาน) |
| 2 | developers.facebook.com | สร้าง App + เพิ่ม Messenger |
| 3 | Messenger settings | เชื่อม Page → ได้ **Page Access Token** |
| 4 | App settings | เก็บ **App Secret** |
| 5 | Vercel | กรอก env 4 ตัว + deploy |
| 6 | Messenger settings | ตั้ง Webhook URL + Verify Token + subscribe |
| 7 | โหมด Development | ทดสอบด้วยบัญชี Tester + อัด screencast |
| 8 | App Review | ขอ permission → ผ่าน → สลับ Live |

> เคล็ดลับ: **ทำขั้น 1 (verification) กับขั้น 2–7 คู่ขนานกัน** เพราะ verification รออนุมัติหลายวัน แต่ระหว่างรอ ทดสอบในโหมด Development ได้เต็มที่

---

## ขั้น 1 — Business Verification (เริ่มก่อนเลย เพราะรอนาน)

1. ไปที่ **business.facebook.com** → เลือก Portfolio "ศรีวรรณ อะไหล่แอร์"
2. เมนู **การตั้งค่า (Settings)** → **ศูนย์การรักษาความปลอดภัย (Security Center)**
3. ทำ **Business Verification** — อัปโหลดเอกสารบริษัท (หนังสือรับรอง/ใบทะเบียนพาณิชย์ + ที่อยู่ + เบอร์โทร)
4. จัดการ "Action needed" ที่ค้าง (เพิ่ม trusted domain, เปิด passkey) — ไม่บล็อกการทดสอบ แต่ควรทำให้ครบ

> **ทำไมต้องทำ:** permission `pages_messaging` ระดับ Advanced Access (ส่งหาลูกค้าที่ไม่ใช่ Tester) ต้องผ่าน business verification ก่อน

---

## ขั้น 2 — สร้าง Meta App + เพิ่ม Messenger

1. ไปที่ **developers.facebook.com** → เข้าสู่ระบบด้วยบัญชีที่เป็นแอดมินของ Page
2. มุมขวาบน **My Apps** → **Create App**
3. เลือกประเภท:
   - "What do you want your app to do?" → เลือก **Other** → **Next**
   - App type → เลือก **Business** → **Next**
4. กรอกชื่อ App (เช่น `Sriwan Messenger AI`) + อีเมล + เลือก Business Portfolio "ศรีวรรณ อะไหล่แอร์" → **Create App**
5. หน้า Dashboard ของ App → หา **Messenger** → กด **Set up**

---

## ขั้น 3 — เชื่อม Page → เอา Page Access Token

1. ในหน้า **Messenger → Settings** (เมนูซ้าย: Messenger → Messenger API Settings)
2. ส่วน **Access Tokens / Generate token** → **Add or Remove Pages** → เลือกเพจ **ศรีวรรณ อะไหล่แอร์** → ให้สิทธิ์ทั้งหมดที่ขอ
3. เมื่อเพจปรากฏในตาราง → กด **Generate Token**
4. **คัดลอกค่า token ที่ได้** (ยาวมาก ขึ้นต้นด้วยตัวอักษร/ตัวเลข) → นี่คือ **`MESSENGER_PAGE_ACCESS_TOKEN`**
   - ⚠️ เก็บทันที เพราะบางทีปิดหน้าต่างแล้วดูซ้ำไม่ได้
5. **Page ID**: ในหน้าเพจ Facebook → About/เกี่ยวกับ → เลื่อนล่างสุดจะเห็น Page ID (ตัวเลข) → นี่คือ **`MESSENGER_PAGE_ID`**

---

## ขั้น 4 — เก็บ App Secret

1. เมนูซ้าย **App settings → Basic**
2. ช่อง **App Secret** → กด **Show** → กรอกรหัสผ่าน Facebook → คัดลอกค่า
3. นี่คือ **`MESSENGER_APP_SECRET`** (ใช้ตรวจลายเซ็น webhook — ห้ามเปิดเผย)

---

## ขั้น 5 — กรอก env ใน Vercel แล้ว deploy

1. คิดค่า **Verify Token** ขึ้นมาเอง — เป็นข้อความอะไรก็ได้ที่เดายาก (เช่น `sriwan-fb-verify-9x7k2`)
   - นี่คือ **`MESSENGER_VERIFY_TOKEN`** (จะใช้ซ้ำในขั้น 6)
2. ไปที่ **Vercel → โปรเจกต์ → Settings → Environment Variables** เพิ่ม 4 ตัว (Environment: **Production**):

   | Key | Value |
   |---|---|
   | `MESSENGER_PAGE_ID` | (จากขั้น 3) |
   | `MESSENGER_PAGE_ACCESS_TOKEN` | (จากขั้น 3) |
   | `MESSENGER_APP_SECRET` | (จากขั้น 4) |
   | `MESSENGER_VERIFY_TOKEN` | (ค่าที่คิดในข้อ 1) |

3. **Redeploy** โปรเจกต์ (Deployments → ปุ่ม ⋯ → Redeploy) เพื่อให้ env มีผล
   - ⚠️ ต้อง deploy **ก่อน** ทำขั้น 6 ไม่งั้น Meta verify webhook ไม่ผ่าน

---

## ขั้น 6 — ตั้ง Webhook + subscribe

1. กลับไป **Messenger → Settings → Webhooks** → **Add Callback URL** (หรือ Edit)
2. กรอก:
   - **Callback URL:** `https://www.sriwanparts.com/api/messenger/webhook`
   - **Verify Token:** ค่าเดียวกับ `MESSENGER_VERIFY_TOKEN` ที่กรอกใน Vercel (ขั้น 5)
3. กด **Verify and Save**
   - ✅ ถ้าเขียว = ระบบตอบ handshake ถูกต้อง (โค้ด GET verify ทำงาน)
   - ❌ ถ้าแดง = ตรวจว่า deploy แล้วยัง / verify token ตรงกันไหม / URL ถูกไหม
4. ส่วน **Webhook Fields** → กด **Add Subscriptions** เลือก:
   - ✅ `messages` (บังคับ — ข้อความลูกค้า)
   - ✅ `messaging_postbacks` (ปุ่ม/quick reply)
   - ✅ `messaging_referrals` (แนะนำ — ลิงก์ m.me)
   - (ไม่ต้องเลือก `message_echoes` — ระบบกรอง echo อยู่แล้ว)
5. ในตาราง **Page → Subscribe** เพจ "ศรีวรรณ อะไหล่แอร์" เข้ากับ webhook นี้ให้เรียบร้อย

---

## ขั้น 7 — ทดสอบในโหมด Development (ยังไม่ต้องผ่าน Review)

ระหว่าง App ยังเป็นโหมด **Development** จะตอบได้เฉพาะคนที่มี role ใน App เท่านั้น

1. **เพิ่ม Tester:** App → **App Roles / Roles** → เพิ่มบัญชี Facebook ของคุณเป็น **Tester/Admin/Developer** (ผู้ทดสอบต้องกด Accept คำเชิญ)
2. เปิด **m.me/<ชื่อเพจ>** หรือทัก DM เพจจากบัญชี Tester
3. ทดสอบครบทุกกรณี:
   - พิมพ์หาสินค้า เช่น "มีคอยล์เย็น vios ไหม" → บอทตอบ + การ์ดสินค้า
   - ส่งรูปอะไหล่ → บอทค้นจากรูป
   - ส่งรูปสลิปโอนเงิน → บอทตอบ "ได้รับสลิป" + เด้งแจ้งเตือนแอดมิน
   - พิมพ์ "ขอเคลมสินค้า" → บอทส่งต่อแอดมิน (handoff)
4. เช็คว่าเข้าระบบหลังบ้าน `/admin/messenger-conversations` เห็นบทสนทนา + ตอบเองได้
5. **อัดวิดีโอ screencast** ทุกกรณีข้างต้น (ใช้ยื่น App Review ขั้น 8)

> ถ้าบอทไม่ตอบ: ดู log ที่ Vercel (Functions → `/api/messenger/webhook`) ว่ามี error อะไร และตรวจว่า `MESSENGER_PAGE_ACCESS_TOKEN` ถูกต้อง

---

## ขั้น 8 — App Review → Live

เมื่อทดสอบผ่านหมดแล้ว จึงขอ permission เพื่อตอบลูกค้าทั่วไป (ไม่ใช่แค่ Tester)

1. **เตรียมหน้าบังคับก่อนยื่น:**
   - **Privacy Policy URL** (หน้า public บนเว็บ) — ใส่ใน App settings → Basic
   - **Data Deletion** — ใส่ Data Deletion Instructions URL หรือ callback
2. App → **App Review → Permissions and Features** → ขอ (Request Advanced Access):
   - `pages_messaging` — **บังคับ** (ตอบ DM)
   - `pages_manage_metadata` — subscribe webhook
   - `pages_read_engagement` — อ่านชื่อ/รูปโปรไฟล์ผู้ส่ง
3. แต่ละ permission กด **Request** → กรอกคำอธิบาย use case (ภาษาอังกฤษ) + แนบ screencast จากขั้น 7
   - ตัวอย่างคำอธิบาย: *"Our shop uses this to auto-reply to customer product inquiries in Messenger DMs and route complex cases to human staff. The screencast shows a customer asking for a part, the bot replying with matching products, and an admin taking over."*
4. **Submit for Review** → รอ Meta ตรวจ (ปกติไม่กี่วัน)
5. เมื่ออนุมัติ → App → สลับ toggle **Development → Live** (มุมบน)
6. ✅ เสร็จ — บอทตอบลูกค้าทั่วไปได้แล้ว

---

## ตารางสรุป env ที่ต้องกรอก

| Env | เอามาจาก | หมายเหตุ |
|---|---|---|
| `MESSENGER_PAGE_ID` | ขั้น 3 (About เพจ) | ตัวเลข Page ID |
| `MESSENGER_PAGE_ACCESS_TOKEN` | ขั้น 3 (Generate Token) | ต้องมีสิทธิ์ `pages_messaging` |
| `MESSENGER_APP_SECRET` | ขั้น 4 (App settings → Basic) | ใช้ตรวจลายเซ็น webhook |
| `MESSENGER_VERIFY_TOKEN` | คิดเอง (ขั้น 5) | ต้องกรอกซ้ำในขั้น 6 ให้ตรงกัน |

> **หมายเหตุ:** มี env `FACEBOOK_PAGE_ACCESS_TOKEN` เดิมอยู่แล้ว (ใช้ฟีเจอร์โพสต์ Facebook feed) — คนละตัวกับ Messenger token ห้ามสับสน ให้กรอก `MESSENGER_*` แยกต่างหาก

## Troubleshooting

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| Verify webhook แดง (ขั้น 6) | ยังไม่ deploy env / verify token ไม่ตรง / URL พิมพ์ผิด |
| บอทเงียบ ไม่ตอบ | ยังไม่ subscribe field `messages` / token ผิด / บัญชีทดสอบไม่ใช่ Tester (โหมด Dev) |
| ตอบช้ามาก | ปกติ — บอท debounce ~3 วิ รอลูกค้าพิมพ์จบก่อนตอบครั้งเดียว |
| ตอบลูกค้าจริงไม่ได้ แต่ Tester ได้ | App ยังเป็นโหมด Development → ต้องผ่าน App Review + สลับ Live (ขั้น 8) |
| แจ้งเตือนไม่เข้า Telegram | ตั้ง `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_IDS` (bell ในระบบยังทำงานปกติแม้ไม่ตั้ง) |

---

_อัปเดตล่าสุด: 2026-07-05 · อ้างอิงโค้ด `lib/messenger/*`, `app/api/messenger/*`, `.env.example`_
