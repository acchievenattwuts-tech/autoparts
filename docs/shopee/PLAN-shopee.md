# Shopee Integration — Implementation Plan & Checklist

> Source of truth สำหรับสถานะงาน Shopee ทุก phase ติ๊ก checklist ทันทีเมื่องานเสร็จ
> หลักการแยกโมดูล + กฎ isolation ดูที่ [README.md](./README.md) งานที่คนต้องทำเองดูที่ [USER-TASKS.md](./USER-TASKS.md)

สถานะรวม: **Phase A–F เสร็จ** (foundation → schema → auth → mapping → order queue → สร้าง Sale + approval UI/filter/report/dashboard)

---

## Phase A — Foundation (lib แยกอิสระ) ✅ เสร็จ

- [x] `.env.example` เพิ่ม placeholder Shopee (ไม่มี secret จริง)
- [x] `lib/shopee/config.ts` — validate env (zod) + เลือก host (live/test) + `ready` flag
- [x] `lib/shopee/signature.ts` — Shopee v2 signing (public/shop/merchant) — pure functions
- [x] `lib/shopee/types.ts` — response envelope + auth payloads + `ShopeeApiError`
- [x] `lib/shopee/client.ts` — typed client + retry (เฉพาะ idempotent) + timeout + safe error map
- [x] `lib/shopee/__tests__/signature.test.ts` — golden-fixture unit tests (9/9 ผ่าน)
- [x] eslint ผ่าน, ไม่มี `any`, ไม่แตะไฟล์เดิม

---

## Phase B — Schema + Notification + Permissions ✅ เสร็จ

> ยืนยัน field-level + 3 design decisions (String ids · Prisma relation · general Notification) แล้ว
> SQL diff = additive ล้วน (7 enum + 5 table + 19 index + 8 FK, 0 ALTER/DROP บนตารางเดิม) push สำเร็จ

- [x] `ShopeeShop` — identity ร้าน, token, วันหมดอายุ, sync settings, last sync cursor (รองรับหลายร้าน)
- [x] `ShopeeProductMapping` — Product/ProductUnit ↔ item_id/model_id/SKU + sync mode (FK `shopRecordId`)
- [x] `ShopeeOrderImport` — order_sn, สถานะ Shopee, raw payload, import status, linked saleId, last error
- [x] `ShopeeSyncJob` — log งาน sync (order pull / stock push / token refresh / logistics / webhook)
- [x] `Notification` + `NotificationType`/`NotificationSeverity` enum — กระดิ่งแจ้งเตือนใน-app (per-user fan-out)
- [x] enum: `ShopeeSyncMode`, `ShopeeOrderImportStatus`, `ShopeeSyncJobType/Status`, `ShopeeAuthStatus`
- [x] index ครบ: `shopRecordId+orderSn` (unique), `productId`, `itemId+modelId`, `importStatus+createdAt`, `saleId` (unique)
- [x] back-relation additive บน Product / ProductUnit / Sale / User (ไม่แก้ column เดิม)
- [x] permission keys ใน `lib/access-control.ts`: `marketplace.view/manage/sync` + route rule + staff `view`
- [x] **ไม่แตะ `Sale` schema** ใน phase นี้ (channel แยกไป Phase F)
- [x] `prisma db push` (4.13s, ไม่มี data loss) + `npx prisma generate` (5 model ใหม่อยู่ใน client)

---

## Phase C — Auth Flow + Health Page + Notification Bell ✅ เสร็จ

- [x] `lib/shopee/services/auth.ts` — `buildShopAuthorizationUrl`, `exchangeCodeForTokens`, `refreshShopAccessToken`, `getValidShopAuth` (refresh-before-expiry) + audit
- [x] Audit log auth event (AUTHORIZE = CREATE, TOKEN_REFRESH/REVOKE = UPDATE) — token ถูก redact
- [x] permission keys + route rule `/admin/marketplace` (ทำใน Phase B)
- [x] `app/admin/(protected)/marketplace/shopee/page.tsx` — overview สถานะ + `requirePermission("marketplace.view")` + force-dynamic + theme light/dark
- [x] `loading.tsx` ทุก route segment ใหม่ (marketplace/shopee + notifications)
- [x] ปุ่ม "เชื่อมต่อร้าน Shopee" (server action `startShopeeAuthorization`) → redirect ไป `buildShopAuthorizationUrl()` + ปุ่มยกเลิกการเชื่อมต่อ (`disconnectShopeeShop`)
- [x] `app/api/shopee/callback/route.ts` — รับ `code`+`shop_id` → `exchangeCodeForTokens()` → redirect กลับ + notification
- [x] `lib/notifications.ts` — general notification service (fan-out admin, dedupe, read state ใน DB)
- [x] Notification bell `components/shared/AdminNotificationBell.tsx` บน header (AdminShell) + `app/api/admin/notifications` + หน้า `/admin/notifications`
- [x] อัปเดต `lib/admin-navigation.ts` (เมนู Shopee/Marketplace) → Quick Search sync อัตโนมัติ (AGENTS.md rule)
- [x] Token refresh: `lib/shopee/services/token-maintenance.ts` + **Vercel Cron** endpoint `app/api/shopee/cron/refresh-tokens` (GET + `CRON_SECRET` bearer) + `vercel.json` schedule รายชั่วโมง

> ทั้งหมด verified: eslint 0, tsc 0, signature test 9/9. **การทดสอบ OAuth จริงรอ Shopee credentials**

---

## Phase D — Product Mapping (read-only) ✅ เสร็จ (core)
- [x] `lib/shopee/services/products.ts` — `fetchShopeeItems()` (get_item_list → get_item_base_info → get_model_list, normalized, defensive typing)
- [x] `lib/shopee/services/mapping.ts` — list/create/delete + **pure** `suggestAutoMappings()` (SKU==code) + unit test (4/4)
- [x] หน้า `/admin/marketplace/shopee/products` (page/loading) + `MappingManager` client (SearchableSelect, theme light/dark)
- [x] เพิ่มการ map เอง + ลบ map + validation (unique P2002 → ข้อความไทย) + audit (CREATE/DELETE)
- [x] Smart auto-mapping suggestion → checkbox เลือก + apply เป็น bulk (user ยืนยันก่อน save)
- [x] แสดงจำนวน unmapped Shopee items + ลิงก์จากหน้า overview
- [ ] (follow-up) แสดง list สินค้าภายในที่ยังไม่ map แบบแยก section
- [ ] เทียบ Shopee stock vs internal — **เลื่อนไป Phase G** (stock field ของ Shopee เป็น version-sensitive ต้อง verify กับ live API ก่อน)

> verified: lint 0, tsc 0, tests 13/13 · live item fetch รอ Shopee credentials เพื่อทดสอบจริง

## Phase E — Order Import (queue only, ไม่สร้าง Sale) ✅ เสร็จ (core)

> business decisions ที่ยืนยัน: สถานะ **READY_TO_SHIP + PROCESSED** · lookback **15 วัน** · scope รวม **Vercel cron**

- [x] `lib/shopee/services/orders.ts` — `pullShopeeOrders()` (get_order_list ต่อสถานะ + get_order_detail) idempotent by `shopRecordId+orderSn`
- [x] Importer เข้า `ShopeeOrderImport` (raw payload + buyer/total snapshot) — **ไม่สร้าง Sale ไม่ตัดสต็อก**
- [x] SKU mapping check → `NEEDS_SKU_MAPPING` ถ้ามี item ที่ยังไม่ map (ไม่ downgrade ออเดอร์ที่ IMPORTED/SKIPPED/CANCELLED_REVIEW)
- [x] Order queue UI `/admin/marketplace/shopee/orders` (status tabs + นับจำนวน + manual pull) + loading
- [x] Vercel cron `app/api/shopee/cron/pull-orders` (ทุก 30 นาที, `CRON_SECRET`) + `pullAllAuthorizedShops()` + vercel.json
- [x] Notification: ออเดอร์ใหม่ (SHOPEE_ORDER_IMPORTED) + ต้อง map SKU (SHOPEE_ORDER_FAILED, dedupe) + audit (SHOPEE_ORDER_PULL)
- [x] ลิงก์จากหน้า overview
- [x] UI toggle `syncEnabled` บนหน้า overview (`SyncEnabledToggle` + `setSyncEnabledAction` + audit) → เปิดแล้ว cron auto-pull ทำงาน
- [ ] (เลื่อน) Webhook ingestion — ยังไม่เลือกในรอบนี้ (ใช้ scheduled pull เป็นหลัก)

> verified: lint 0, tsc 0, tests 13/13 · live pull รอ Shopee credentials

## Phase F — Sale Creation ✅ เสร็จ (core + UI)

> decisions ที่ยืนยัน: channel+channelRefNo+settlement field · CASH_SALE+บัญชี "Shopee พักเงิน" · customer snapshot (ไม่สร้าง Customer) · dashboard widget · prefix **SP** · approval gate ต่อออเดอร์ · architecture **B (reuse lib primitives, ไม่แตะ createSale)**

### เสร็จแล้ว ✅
- [x] Schema: `enum SaleChannel{STORE,SHOPEE}` + `Sale.channel @default(STORE)` + `Sale.channelRefNo` + index + `ShopeeShop.settlementCashBankAccountId` (FK→CashBankAccount) — push DB แล้ว (additive, search index restored 547)
- [x] `lib/sale-core.ts` — ย้าย helper (preloadSaleDependencies/assertLotBalanceAvailable/createWarrantySnapshots/resolveSalePaymentMethod) ออกจาก `sales/actions.ts` แบบ behavior คงเดิม → **createSale เดิม test 2/2 ผ่าน**
- [x] `generateSaleNo` รองรับ prefix `SP`
- [x] `lib/shopee/services/create-sale.ts` — `buildShopeeSaleDraft()` (dry-run preview) + `createSaleFromShopeeOrder()` reuse primitives เดียวกัน (writeStockCard/writeSaleLots/createWarrantySnapshots/rebuildSaleProfitFacts/replaceCashBankSourceMovements) → ผลลัพธ์ stock/lot/profit/cash เหมือน sale ปกติ · customer snapshot · CASH_SALE→บัญชีพักเงิน · mark IMPORTED+link saleId · audit (SHOPEE_SALE_CREATE)
- [x] **(review fix H1)** posting date = วันที่ออกบิล (`new Date()`) ตามมาตรฐาน ERP (post ในงวดเปิด + เรียงเวลา) — ไม่ใช้วันที่ลูกค้าสั่งเป็น saleDate/เลขบิล/stock movement (กัน StockCard/MAVG เพี้ยน + ตกงวดปิด) · แสดงวันที่สั่งเป็น reference บน preview

### UI + integration ✅ เสร็จ
- [x] **Approval UI**: ปุ่ม "ตรวจ/สร้างบิล" ในคิว → หน้า preview `/orders/[id]` (draft lines/totals/blockers) → `CreateSaleConfirm` → `createSaleFromOrderAction` (requirePermission marketplace.manage + audit + revalidate + redirect ไปหน้าบิล)
- [x] **Settlement account setting**: `SettlementAccountForm` (SearchableSelect) บนหน้า overview → `setSettlementAccountAction` เซ็ต `ShopeeShop.settlementCashBankAccountId`
- [x] **Sales list filter**: `?channel=STORE|SHOPEE|ALL` ใน `SalesFilterBar` + คอลัมน์/badge ช่องทาง (`/admin/sales`)
- [x] **Report**: channel filter ใน `report-queries.ts` (ReportFilters/where/export) + dropdown ช่องทางบนหน้า report sales (CSV export รองรับด้วย)
- [x] **Dashboard widget**: `ShopeeChannelSummary` ยอดขายแยก STORE vs SHOPEE เดือนนี้ (additive, ไม่แตะ dashboard เดิม)
- [x] theme light/dark ครบทุกส่วน · ลอจิก/ผลลัพธ์ sale เดิมไม่กระทบ (test 2/2)

> verified: lint 0, tsc 0, tests 15/15
> **lot-controlled orders**: ✅ lot-picker UI บนหน้า preview — auto-allocate (FEFO/FIFO) + ปรับเอง, validate ครบจำนวนก่อนยืนยัน, ส่ง `lotSelections` เข้า create action (service + `validateLotRows` ตรวจซ้ำฝั่ง server)
> ราคา line อ่านจาก `model_discounted_price` (defensive) → preview ให้ human ตรวจก่อนยืนยัน = safety net · live ทดสอบรอ credentials

## Phase G — Stock Push to Shopee
- [x] Mode per mapping: monitor_only / push / disabled + per-mapping stock buffer override บนหน้า Stock Sync
- [ ] Hook หลัง stock-affecting transaction (purchase/sale/return/adjust/BF/claim) — ยังไม่แตะ stock engine หลักจนกว่า live push payload/behavior จะ verified
- [x] Stock buffer setting + reconciliation report + in-app alert สำหรับรายการที่ต้องตรวจ/ส่งใหม่
- [ ] Live Shopee `update_stock` push — รอ verify official/live payload กับ Shopee credentials ก่อนเปิดใช้จริง (ตอนนี้เป็น reconciliation-only safety layer)

## Phase H — Delivery / Tracking Sync
- [x] Map logistics/tracking จาก Shopee order snapshot → `Sale.shippingMethod/shippingStatus/trackingNo`
- [x] ดึง tracking จาก `ShopeeOrderImport.rawPayload` เข้า Delivery Queue + audit/job source `SHOPEE`
- [x] แสดงลิงก์ Shopee order ภายใน + tracking link บน sale detail + delivery queue
- [ ] Live logistics API refresh / external Shopee seller order URL — รอ verify endpoint/field/payload กับ Shopee credentials ก่อนเปิดใช้จริง

## Phase I — Returns / Cancellations / Refunds
- [x] ดึง cancel/refund/return จาก Shopee order snapshot เข้า review queue (`CANCELLED_REVIEW`) + notification
- [x] กฎรอบนี้: cancel/refund/return = `MANUAL_REVIEW_ONLY` ทั้งหมด, ไม่ auto-cancel Sale / ไม่ auto-CN
- [x] เพิ่ม reference-chain protection summary บนหน้า Shopee order detail (Sale/CN/Receipt/Claim blockers)
- [ ] Live cancel/refund/return API pull — รอ verify endpoint/field/payload กับ Shopee credentials ก่อนเปิดใช้จริง
- [ ] เชื่อม return/refund → Credit Note flow หลัง confirm business rule + lot/reference-chain behavior

## Phase J — Telegram Alerts (ต่อยอด Notification Bell เดิม)
- [x] เปลี่ยนแผนจาก LINE OA → Telegram ตาม requirement ล่าสุด
- [x] ส่ง Telegram เมื่อ `NotificationType.SHOPEE_*` ถูกสร้างใหม่จริง: order ใหม่/import fail, stock sync fail, token ใกล้หมดอายุ, cancel/refund review, delivery exception
- [x] ใช้ dedupe/throttle จาก `Notification.dedupeKey` เดิม: ถ้า unread notification เดิมยังอยู่ จะไม่สร้าง notification ใหม่และไม่ยิง Telegram ซ้ำ
- [x] Telegram config: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_IDS` (หรือ `TELEGRAM_CHAT_ID`) และใช้ `APP_BASE_URL`/`NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL` เพื่อสร้างลิงก์ admin แบบเต็ม
- [ ] ตั้งค่า Telegram bot token/chat id ใน production env และทดสอบส่งจริง

## Phase K — Reports + Multi-channel Dashboard
- [x] split in-store vs Shopee (ยอด, gross profit, จำนวนออเดอร์, stock risk) บน dashboard แบบ read-only ไม่แตะ logic เดิม
- [x] daily summary เพิ่มส่วน Shopee + export fields (order no/shop/channel/tracking/sync)
- [x] รายงานขาย CSV/Excel export เพิ่ม Shopee order no/shop/channel/tracking/sync โดยใช้ข้อมูล Sale + ShopeeOrderImport เดิม

## Phase L — Auto Shopee Fee → Expense
- [x] สร้าง Expense จาก `escrow_detail` ที่อยู่ใน Shopee order snapshot แล้ว (commission/service/voucher) พร้อม auto category + cash movement/profit fact เดิม
- [x] ผูก Shopee order → Expense แบบ idempotent (`escrowExpenseId`) เพื่อกันสร้างซ้ำ
- [x] เพิ่ม preview/action บนหน้า Shopee order detail พร้อม blocker ถ้ายังไม่มี sale, settlement account, หรือ escrow payload ที่รองรับ
- [ ] Live escrow_detail API pull — รอ verify endpoint/field/payload กับ Shopee credentials ก่อนเปิด sync จริง

## Phase M — Reliability / Security / Tests
- [x] **sync lock** (กันรันซ้อน) — `lib/shopee/sync-lock.ts` (`withShopeeSyncLock` + ShopeeSyncJob RUNNING mutex + stale auto-release 10 นาที) ใช้กับ order pull (cron + manual) → `pullShopeeOrdersGuarded`
- [x] rate-limit/backoff — client retry/backoff (Phase A) สำหรับ operation idempotent
- [x] **runbook** — [RUNBOOK.md](./RUNBOOK.md): ต่ออายุ credential, กู้ sync fail, sync lock, unmapped SKU, สลับ test→prod, Telegram
- [x] test: sync-lock `isLockHeld` (5/5) + signature (9/9) ที่มีอยู่
- [x] **(review fix H2)** token refresh race — `refreshShopAccessTokenGuarded` ใช้ sync-lock `TOKEN_REFRESH` (getValidShopAuth + cron) กัน double-refresh ที่ทำให้ refresh_token ใช้ไม่ได้
- [ ] circuit breaker เต็มรูปแบบ + QStash jobs (ตอนนี้ใช้ Vercel cron + retry/backoff + sync lock แทน)
- [ ] tests เพิ่ม: token refresh, order idempotency (ต้อง DB), stock push payload (รอ live)

---

## ลูกเล่นพิเศษ (เหนือกว่า FlowAccount) — เก็บไว้ทำ

- [x] 🔔 Notification bell ใน-app (Phase B/C) — FlowAccount มีแค่ LINE/email
- [x] 📊 Sync Health panel บนหน้า marketplace overview — `SyncHealthPanel`: token countdown, last order sync ต่อร้าน, failed sync jobs (24 ชม.), stock push risk (needsPush/failed)
- [ ] ⚡ Real-time order toast (ถ้าใช้ webhook) — เร็วกว่า polling 6 ชม.ของ FlowAccount (เลื่อนไปตอน go-live: ต้องตั้ง push config + credentials)
- [x] 🔄 Smart auto-mapping suggestion (Phase D)
- [x] 📦 Dry-run mode (Phase E/F) — `buildShopeeSaleDraft` preview safety net ก่อนสร้าง Sale จริง
- [x] 💰 Auto-categorize Shopee fees → Expense (Phase L escrow) — `createShopeeFeeExpense` + ปุ่มในหน้า order (รอ live escrow_detail ป้อนข้อมูล)
- [x] 🧾 Print ใบกำกับ/ใบเสร็จ จากหน้า Shopee order — ลิงก์ "เปิด/พิมพ์" → `/admin/sales/[saleId]` (print form เดิมของระบบ) เมื่อสร้างบิลแล้ว
