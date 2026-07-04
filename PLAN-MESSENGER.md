# Facebook Messenger AI Agent — Plan & Checklist

> เป้าหมาย: ทำ AI agent ตอบ DM ลูกค้าบน Facebook Messenger โดยใช้ "สมอง" (การประมวลผล + logic ค้นหา) ชุดเดียวกับ LINE OA AI Chat — แก้ที่เดียวใช้ได้ทั้งสอง channel
>
> หลักการเหล็ก: **ห้ามกระทบ business logic เดิม / LINE ต้องทำงานเหมือนเดิม 100%** — พิสูจน์ด้วย build เขียว + test เดิมผ่านทุกตัว

## Decisions (ยืนยันกับเจ้าของแล้ว 2026-07-04)

- **สถาปัตยกรรม**: Extract สมองเป็น `lib/chat-core/` (channel-agnostic) แล้วให้ทั้ง LINE + Messenger เรียกใช้ร่วมกัน — **แก้ทั้ง repo แบบสะอาด ไม่ใช้ re-export shim**
- **Data model**: ตารางแยกใหม่ `MessengerConversation` / `MessengerMessage` (ไม่ยุ่ง LineConversation) — reuse enum เดิม (`LineIntent`, `LineAiConfidence`) เป็น enum กลาง
- **ขอบเขต MVP**: parity เต็มเท่า LINE (ข้อความ + รูป + สลิป/OCR + product card + FAQ + fitment)
- **Infra**: เหมือน LINE — webhook route + `after()` coalesce + cron/QStash job worker บน Vercel
- **Domain (production)**: `https://www.sriwanparts.com` → Messenger webhook = `https://www.sriwanparts.com/api/messenger/webhook`
- **Facebook Page / Meta Business Portfolio**: "ศรีวรรณ อะไหล่แอร์" มีแล้ว

## สถาปัตยกรรมเป้าหมาย

```
   LINE webhook ──▶ line-webhook-processor (adapter) ──▶ LINE transport (Flex/reply/push)
                              │
                              ▼
                   lib/chat-core/ (สมองกลาง — แก้ที่เดียว)
                   generateChatSuggestion · extractSearchIntent
                   searchProductInquiry · fitment-resolve · faq
                              ▲
                              │
 Messenger webhook ▶ messenger-webhook-processor (adapter) ─▶ Messenger transport (Send API/generic template)
```

รอยต่อ: การประมวลผลไม่ผูกกับ transport อยู่แล้ว (processor ฉีด transport ผ่าน dependency injection) — Messenger เสียบ adapter ของตัวเอง

---

## Phase A — Meta App Review (งานฝั่ง Meta, ทำคู่ขนาน / เจ้าของร้าน + dev)

รออนุมัตินาน → เริ่มเร็วที่สุด

- [ ] A1. Business verification ให้เสร็จใน Meta Business Portfolio (จัดการ Action-needed: add trusted domain, passkey) — ไม่บล็อก dev แต่ต้องมีก่อน advanced access
- [ ] A2. สร้าง Meta App (type Business) ใน developers.facebook.com
- [ ] A3. Add product **Messenger** → เชื่อม Facebook Page → generate **Page Access Token**
- [ ] A4. ตั้ง Webhook URL `https://www.sriwanparts.com/api/messenger/webhook` + Verify Token → subscribe fields: `messages`, `messaging_postbacks`, `messaging_referrals` (+`message_reads` optional)
- [ ] A5. ขอ permission App Review: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`
- [ ] A6. หน้า **Privacy Policy** (public) + **Data Deletion Callback** — บังคับสำหรับ review
- [ ] A7. อัด screencast + สคริปต์ use case (ทัก DM → บอทตอบ/ค้นสินค้า) ให้ reviewer
- [ ] A8. Submit for Review → ผ่าน → สลับ App เป็น **Live**

> ระหว่างรอ review: dev + demo ได้เต็มที่กับ role Admin/Tester/Developer ของ App โดยไม่ต้องผ่าน review

---

## Phase B — Extract สมองกลาง `lib/chat-core/` (clean repo-wide, commit แรก)

ทำก่อน Messenger ทั้งหมด — พิสูจน์ว่า LINE ไม่กระทบ

### Stage 1 — ย้ายไฟล์ + แก้ path (pure move) ✅ DONE 2026-07-04
- [x] B1. ย้ายไฟล์สมอง (pure logic) → `lib/chat-core/`:
  - `line-ai-service.ts` → `chat-core/ai-service.ts`
  - `line-product-search-bridge.ts` → `chat-core/product-search-bridge.ts`
  - `line-fitment-resolve.ts` / `line-fitment-extract.ts` → `chat-core/fitment-*.ts`
  - `line-search-guards.ts`, `line-search-gate.ts`, `line-intent-router.ts`, `line-intent-groups.ts`, `line-inquiry-frame.ts`, `line-brand-variants.ts`, `line-text-normalize.ts`, `known-query-intent.ts`, `line-faq.ts`
- [x] B3. ไล่แก้ทุก import ทั้ง repo (37 ไฟล์) ให้ชี้ path ใหม่ `@/lib/chat-core/*` โดยตรง — **ไม่มี shim**
- [x] B4. Prisma enum `LineIntent`/`LineAiConfidence` = enum กลาง (ไม่ rename, ไม่ migrate)
- [x] **B-GATE Stage 1:**
  - [x] grep path เก่าตกค้าง → **0**
  - [x] `npx tsc --noEmit` → **0 error**
  - [x] `node:test` lib tests → **313/314 pass** (1 fail `budget fallback` เป็น pre-existing/env — พิสูจน์ด้วย `git stash` ว่า fail เหมือนกันบน HEAD ก่อน refactor)
  - [x] `eslint lib/chat-core` → ผ่าน
  - [x] diff review: pure move + import-path เท่านั้น ไม่มี logic เปลี่ยน
- [x] B5. commit (pure move)

### Stage 2 — Rename symbol เป็นชื่อกลาง ✅ DONE 2026-07-04
- [x] B2. Rename 34 export symbol `Line*`→`Chat*` (function/type) + แก้ call site ทั้ง repo (26 ไฟล์) ด้วย whole-word regex — **คง Prisma enum `LineIntent`/`LineAiConfidence` ไว้**
  - [x] tsc 0 error · `node:test` 313/314 (1 fail pre-existing เดิม) · eslint ผ่าน · ไม่มี symbol เก่าตกค้าง · line-ending ไม่พัง (แก้เฉพาะ 26 ไฟล์ที่มี symbol จริง)

---

## Phase C — Data model (schema ตารางแยกใหม่)

ต้อง confirm field กับเจ้าของก่อน `prisma db push` (ตาม .rules §8)

- [ ] C1. เพิ่ม model `MessengerConversation` (mirror `LineConversation`: psid, pageId, displayName, pictureUrl, status, aiEnabled, linked customerId …) — timestamp ใช้ `@db.Timestamptz(3)`
- [ ] C2. เพิ่ม model `MessengerMessage` (mirror `LineMessage`: role, text, attachments, intent, confidence, mid, createdAt …) — idempotency key บน FB message id (`mid`)
- [ ] C3. reuse enum เดิมเป็น enum กลาง
- [ ] C4. สรุปทุก field ให้เจ้าของ confirm → `prisma db push`
- [ ] C5. index ครบ (field ใน where/orderBy/FK)

---

## Phase D — Messenger channel layer (adapter บาง)

- [ ] D1. `app/api/messenger/webhook/route.ts` — GET verify challenge + POST ตรวจ `X-Hub-Signature-256` → `after()` coalesce → job (`dynamic="force-dynamic"`, `maxDuration=60`)
- [ ] D2. `lib/messenger/messenger-messaging.ts` — Send API (`sendText`, `sendGenericTemplate`, `senderAction typing_on`), fetch user profile
- [ ] D3. `lib/messenger/messenger-product-card.ts` — แปลงผลค้นหา → Generic Template / carousel (แทน Flex ที่ FB ไม่มี)
- [ ] D4. `lib/messenger/messenger-image-service.ts` — รับ attachment (รูป/สลิป) จาก FB CDN → เข้า chat-core + payment-slip OCR pipeline เดิม
- [ ] D5. `lib/messenger-webhook-processor.ts` — เลียนโครง `processLineAiReply` ฉีด transport ของ Messenger เรียก chat-core ตัวเดียวกับ LINE
- [ ] D6. จัดการ **24-hour messaging window** ของ Meta (reply ปกติ vs. message tag เมื่อเกิน window)
- [ ] D7. cron/QStash worker `app/api/messenger/ai-jobs/*` (process/reconcile/cleanup) mirror LINE ai-jobs + ลง Vercel cron config

---

## Phase E — Admin / Permissions / Notifications / Audit (.rules §7–8)

- [ ] E1. เมนู `/admin/messenger-conversations` (mirror line-conversations inbox) + `loading.tsx` ทุก segment + `force-dynamic` + date filter
- [ ] E2. Permission ครบ 5 ขั้น: key ใน `access-control.ts`, route rule, `requirePermission` ใน page, `requirePermission` ในทุก Server Action, sidebar
- [ ] E3. Notification: เพิ่ม `NotificationType.MESSENGER_*` + helper ใน `lib/notifications.ts` → bell + Telegram พร้อมกัน (Iron Rule)
- [ ] E4. Audit Log ทุก mutation (toggle AI, link customer, manual reply, export)

---

## Phase F — Rollout & QA

- [ ] F1. Phase B เขียว (build + test) → commit
- [ ] F2. Phase A เริ่มคู่ขนานตั้งแต่วันแรก
- [ ] F3. Phase C confirm + push
- [ ] F4. Phase D เทสในโหมด Development ของ FB App ด้วยบัญชี Tester
- [ ] F5. Phase E ครบ
- [ ] F6. E2E: ทัก DM → บอทตอบ/ค้นสินค้า/สลิป/การ์ด → อัด screencast
- [ ] F7. Submit review → ผ่าน → App Live → production

---

## งานที่เจ้าของร้านต้องทำเอง (Meta side)

- ทำ business verification / จัดการ security action-needed ใน portfolio
- สร้าง Meta App + เชื่อม Page + ออก Page Access Token
- กรอก webhook URL + verify token, subscribe fields
- Submit App Review + สลับ Live

## Status Log

- 2026-07-04: ยืนยัน decisions + domain, เริ่ม Phase B
- 2026-07-04: Phase B Stage 1 เสร็จ — ย้าย 13 ไฟล์สมอง → `lib/chat-core/`, แก้ import 37 ไฟล์, tsc/lint เขียว, tests 313/314 (1 fail pre-existing)
- 2026-07-04: Phase B Stage 2 เสร็จ — rename 34 export symbol `Line*`→`Chat*` (26 ไฟล์), คง Prisma enum, tsc/lint เขียว, tests 313/314. **Phase B ครบทั้ง Stage → พร้อมไป Phase C (schema)**
