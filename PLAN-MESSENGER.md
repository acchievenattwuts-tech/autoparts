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

### ✅ DONE 2026-07-04 (confirm field + push แล้ว)
- [x] C1. `MessengerConversation` (mirror `LineConversation` + `pageId`/`psid`, `@@unique([pageId, psid])`) — Timestamptz(3) ครบ
- [x] C2. `MessengerMessage` (mirror `LineMessage`; `psid`/`mid`/`fbEventId @unique` แทน line ids, ตัด replyToken)
- [x] C2b. `MessengerAiJob` + `MessengerAiSuggestion` (mirror LINE) — สร้างครบ 4 model รอบเดียว
- [x] C3. reuse enum เดิมทั้งหมดเป็น enum กลาง (`LineConversationAiStatus`, `LineMessageDirection`, `LineMessageType`, `LineIntent`, `LineDeliveryMode/Status`, `LineAiJobType/Status`, `LineAiConfidence`, `LineAiSuggestionStatus`)
- [x] C4. `PaymentSlip` option (ก): `conversationId`+`lineUserId` → nullable, เพิ่ม `messengerConversationId` FK + index (ไม่มี data loss, ไม่กระทบ pipeline LINE); back-relation ใน User(2)+Customer(1)
- [x] C5. index ครบ mirror LINE; audit ใช้ `AuditLog` กลาง (ไม่มี MessengerAiAuditLog)
- [x] `prisma validate` + `prisma db push` (sync สำเร็จ) + `prisma generate` (client มี 4 model) + `tsc` 0 error

---

## Phase D — Messenger channel layer (adapter บาง)

### Sub-stage 1 — core text flow ✅ DONE 2026-07-04
- [x] D1. `app/api/messenger/webhook/route.ts` — GET verify challenge + POST ตรวจ `X-Hub-Signature-256` (HMAC raw body) → ACK เร็ว → `after()` process (`dynamic="force-dynamic"`, `maxDuration=60`); ตัด echo/receipt, idempotency ด้วย `mid`→`fbEventId`
- [x] D2. `lib/messenger/messenger-messaging.ts` — Send API (`sendMessengerText`, `sendMessengerGenericTemplate`, `sendMessengerSenderAction` typing/seen, `fetchMessengerUserProfile`, `fetchMessengerAttachment`) + retry
- [x] D2b. `lib/messenger/messenger-config.ts` — env config + `verifyMessengerSubscription` + `verifyMessengerSignature` (timing-safe) + Graph API v23.0
- [x] D2c. `lib/messenger/messenger-conversation-repository.ts` — getOrCreate/append(idempotent)/recentForAi/showPrice/storeSuggestion/touch (mirror LINE repo, Messenger* tables)
- [x] D5(core). `lib/messenger/messenger-webhook-processor.ts` — text flow reuse chat-core: `routeChatIntent`→`searchChatProductInquiry`→`getChatProductSummaries`→`generateChatSuggestion`→ ส่งข้อความ + carousel (แทน Flex); greeting/smalltalk ผ่าน `generateScopedConversationalReply`; respa handoff (aiStatus≠ACTIVE)
- [x] env: เพิ่ม `MESSENGER_PAGE_ID/PAGE_ACCESS_TOKEN/APP_SECRET/VERIFY_TOKEN` ใน `.env.example`
- [x] test: `messenger-config.test.ts` (8 pass — signature/subscription) · tsc 0 error · eslint ผ่าน

### Sub-stage 2 — parity ที่เหลือ ✅ DONE 2026-07-04 (D3/D4/D6/D7 เสร็จ + D5 full)
- [x] D3. ✅ DONE 2026-07-04 — carousel เพิ่มการ์ด "ดูสินค้าทั้งหมด N รายการ" ลิงก์ storefront `/products?q=&category=&brand=&model=&year=` ตาม `appliedFilters` เมื่อ total > ที่แสดง (mirror Flex view-all)
- [x] D4. ✅ DONE 2026-07-04 — `messenger-image-service.ts`: ดึง attachment จาก FB CDN → `classifyImageContent` (extract เป็นฟังก์ชันกลางใน line-image-service, LINE delegate, behavior เดิม) → **payment_slip**: `ingestMessengerPaymentSlip` reuse OCR/storage เดิม เก็บ `PaymentSlip.messengerConversationId` (ขยาย `createPaymentSlip` รับ FK ใหม่, additive) → **part_image**: ป้อน hints เข้า `searchChatProductInquiry` ผ่าน helper `replyWithProductSearch` ร่วมกับ text path; tests 321/322 (fail เดิม), tsc/lint เขียว
- [x] D5(full). ✅ DONE 2026-07-04 — coalescing: `processMessengerBatch` ingest ทุก event (persist+bumpSeq ไม่ตอบ) → elect owner ต่อ conversation (lock) → `runMessengerOwnerLoop` debounce 3s + latest-wins (seq เพิ่ม=รอใหม่) + final pass 28s → `replyToMessengerTurn` merge unanswered เป็น turn เดียว (รวม text, ใช้รูปล่าสุด) ตอบ**ครั้งเดียว** + markProcessedSeq; repo เพิ่ม bump/state/mark/lock/getUnanswered; tsc/lint เขียว, 8 tests ผ่าน
- [x] D6. ✅ DONE 2026-07-04 — 24h messaging window guard: `replyToMessengerTurn` ข้าม auto-reply ถ้า inbound ล่าสุด > 24h (เลี่ยง Send API error/นโยบาย human_agent tag); live flow ตอบใน window เสมอ
- [x] D7. ✅ DONE 2026-07-04 — `app/api/messenger/ai-jobs/recover/route.ts` (CRON_SECRET auth) → `recoverStalledMessengerConversations` หา conversation ค้าง (seq>processed + lock free + quiet 90s) แล้ว re-run owner loop; vercel cron `1-59/2 * * * *`; repo เพิ่ม `findStalledMessengerConversationIds`/`getMessengerConversationPsid`
- [ ] note: system prompt บรรทัด "แชทใน LINE นี้" ยัง hardcode LINE — เว้นไว้เพื่อไม่แตะ prompt ที่ LINE ใช้ร่วม (ค่อย parametrize channel name ตอนทำ Phase E)

---

## Phase E — Admin / Permissions / Notifications / Audit (.rules §7–8)

- [x] E1. ✅ DONE 2026-07-04 — inbox `/admin/messenger-conversations` (list + `[id]` detail) mirror LINE: `messenger-admin-service.ts` (list/getMessages/pause/resume/waiting/close/sendAdminMessage), `loading.tsx` ทุก segment, `force-dynamic`, status filter; client `MessengerConversationPanel` (ปุ่มสถานะ + reply); admin reply ส่งด้วย `HUMAN_AGENT` tag (ตอบได้นอก 24h window)
- [x] E2. ✅ DONE 2026-07-04 — permission 5 ขั้น: 3 key ใน `access-control.ts` (view/reply/manage กลุ่ม "Facebook Messenger"), route rule `/admin/messenger-conversations`, `requirePermission("...view")` ใน page ทั้ง 2, `requirePermission` ในทุก Server Action (manage/reply), sidebar navItem. (mirror LINE: ไม่ให้ staff default เช่นเดียวกับ line_conversations)
- [x] E4. ✅ DONE 2026-07-04 — ทุก mutation เขียน central `AuditLog` ผ่าน `safeWriteAuditLog` (action=UPDATE, entityRef=เหตุการณ์จริง MESSENGER_ADMIN_PAUSE/RESUME/…/SEND_MESSAGE) — ตามที่ตกลงใช้ audit กลาง
- [x] E3. ✅ DONE 2026-07-04 — Notification (bell + Telegram, Iron Rule): เพิ่ม enum `MESSENGER_NEW_CONVERSATION`/`MESSENGER_PAYMENT_SLIP`/`MESSENGER_HANDOFF` (db push แล้ว) + helper ใน `lib/notifications.ts` + label/emoji ใน `lib/telegram.ts`; wire processor: ลูกค้าใหม่ทักครั้งแรก (getOrCreate คืน `created`), รับสลิป, handoff (escalation ใหม่: `route.requiresAdmin` → set WAITING_ADMIN + แจ้ง + ข้อความส่งต่อแอดมิน). ทุก call ใช้ `safeNotify` (ไม่ทำ flow พัง). tsc/lint/tests เขียว

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
- 2026-07-04: Phase B Stage 2 เสร็จ — rename 34 export symbol `Line*`→`Chat*` (26 ไฟล์), คง Prisma enum, tsc/lint เขียว, tests 313/314
- 2026-07-04: Phase C เสร็จ — เพิ่ม 4 model Messenger + แก้ PaymentSlip (nullable + FK), `prisma db push` sync สำเร็จ, generate + tsc เขียว
- 2026-07-04: Phase D sub-stage 1 เสร็จ — webhook route + Send API transport + config/signature + repository + core text processor (reuse chat-core), 8 tests เขียว, tsc/lint ผ่าน
- 2026-07-04: Phase D sub-stage 2 เสร็จ — D4 image/slip (classifyImageContent กลาง + ingest slip), D5 coalescing (batch+owner loop), D6 24h window guard, D7 cron recover + vercel cron, D3 view-all card. Phase D ครบทุกข้อ
- 2026-07-04: Phase E เสร็จครบ — E1 inbox (list+detail+panel), E2 permission 5 ขั้น, E4 audit กลาง, E3 notification (3 enum + helper + wire processor + handoff escalation). **Phase B–E ครบ → เหลือ Phase A (Meta App Review, งานเจ้าของร้าน) + Phase F (rollout/QA)**
