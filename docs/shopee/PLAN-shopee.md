# Shopee Integration — Implementation Plan & Checklist

> Source of truth สำหรับสถานะงาน Shopee ทุก phase ติ๊ก checklist ทันทีเมื่องานเสร็จ
> หลักการแยกโมดูล + กฎ isolation ดูที่ [README.md](./README.md) งานที่คนต้องทำเองดูที่ [USER-TASKS.md](./USER-TASKS.md)

สถานะรวม: **Phase A–E เสร็จ · Phase F core เสร็จ** (schema + sale-core refactor + create-sale service) · เหลือ Phase F UI (approval/filter/report/dashboard)

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
- [ ] (follow-up) UI toggle `syncEnabled` บนหน้า overview — **cron auto-pull กรอง `syncEnabled=true`** (manual pull ใช้ได้เลย แต่ auto-pull ต้องเปิด gate ก่อน)
- [ ] (เลื่อน) Webhook ingestion — ยังไม่เลือกในรอบนี้ (ใช้ scheduled pull เป็นหลัก)

> verified: lint 0, tsc 0, tests 13/13 · live pull รอ Shopee credentials

## Phase F — Sale Creation (กำลังทำ — core เสร็จ, UI/report เหลือ)

> decisions ที่ยืนยัน: channel+channelRefNo+settlement field · CASH_SALE+บัญชี "Shopee พักเงิน" · customer snapshot (ไม่สร้าง Customer) · dashboard widget · prefix **SP** · approval gate ต่อออเดอร์ · architecture **B (reuse lib primitives, ไม่แตะ createSale)**

### เสร็จแล้ว ✅
- [x] Schema: `enum SaleChannel{STORE,SHOPEE}` + `Sale.channel @default(STORE)` + `Sale.channelRefNo` + index + `ShopeeShop.settlementCashBankAccountId` (FK→CashBankAccount) — push DB แล้ว (additive, search index restored 547)
- [x] `lib/sale-core.ts` — ย้าย helper (preloadSaleDependencies/assertLotBalanceAvailable/createWarrantySnapshots/resolveSalePaymentMethod) ออกจาก `sales/actions.ts` แบบ behavior คงเดิม → **createSale เดิม test 2/2 ผ่าน**
- [x] `generateSaleNo` รองรับ prefix `SP`
- [x] `lib/shopee/services/create-sale.ts` — `buildShopeeSaleDraft()` (dry-run preview) + `createSaleFromShopeeOrder()` reuse primitives เดียวกัน (writeStockCard/writeSaleLots/createWarrantySnapshots/rebuildSaleProfitFacts/replaceCashBankSourceMovements) → ผลลัพธ์ stock/lot/profit/cash เหมือน sale ปกติ · customer snapshot · CASH_SALE→บัญชีพักเงิน · mark IMPORTED+link saleId · audit (SHOPEE_SALE_CREATE)

### เหลือ (UI + integration)
- [ ] **Approval UI**: ปุ่ม "สร้างบิล" ในคิว → หน้า preview (draft lines/totals/blockers + เลือก lot สำหรับสินค้าคุม lot) → ยืนยัน → create action (requirePermission + audit + revalidate)
- [ ] **Settlement account setting**: เลือกบัญชี "Shopee พักเงิน" บนหน้า overview (เซ็ต `ShopeeShop.settlementCashBankAccountId`)
- [ ] **Sales list filter**: `?channel=STORE|SHOPEE|ALL` + badge ช่องทาง (`/admin/sales`)
- [ ] **Report**: channel filter + column ใน `report-queries.ts` (querySalesRows/Totals)
- [ ] **Dashboard widget**: ยอดขายแยก STORE vs SHOPEE (additive)
- [ ] อ่าน AGENTS.md (print/theme/quick-search) ก่อนแตะหน้า sale

> verified (core): lint 0, tsc 0, sale test 2/2 · **ยังไม่สร้าง Sale จริงจนกว่า approval UI + action จะเสร็จ** · ราคา line อ่านจาก `model_discounted_price` (defensive) → preview ให้ human ตรวจก่อนยืนยัน = safety net

## Phase G — Stock Push to Shopee
- [ ] Mode per mapping: monitor_only / push / disabled
- [ ] Hook หลัง stock-affecting transaction (purchase/sale/return/adjust/BF/claim)
- [ ] Stock buffer setting + reconciliation report + alert เมื่อ push fail/mismatch

## Phase H — Delivery / Tracking Sync
- [ ] Map logistics/tracking → `Sale.shippingMethod/shippingStatus/trackingNo`
- [ ] ดึง tracking เข้า Delivery Queue + audit source SHOPEE
- [ ] แสดงลิงก์ Shopee order/tracking บน sale detail + delivery queue

## Phase I — Returns / Cancellations / Refunds
- [ ] ดึง cancel/refund/return เข้า review queue
- [ ] กฎ: สถานะไหน cancel sale อัตโนมัติ / ไหนต้อง manual review
- [ ] เชื่อม return/refund → Credit Note flow (เมื่อ confirm กฎ) + reference-chain protection

## Phase J — LINE OA Alerts (ต่อยอด stack เดิม)
- [ ] order ใหม่ import สำเร็จ / import ไม่สำเร็จ (unmapped/สต็อกไม่พอ/lot/validation)
- [ ] stock sync fail, token ใกล้หมดอายุ, cancel/refund ต้อง review, delivery exception
- [ ] ใช้ recipient mapping + delivery helper เดิม + throttle/dedupe

## Phase K — Reports + Multi-channel Dashboard
- [ ] split in-store vs Shopee (ยอด, gross profit, จำนวนออเดอร์, stock risk)
- [ ] daily LINE summary เพิ่มส่วน Shopee + export fields (order no/shop/channel/tracking/sync)

## Phase L — Auto Shopee Fee → Expense
- [ ] ดึง escrow_detail → สร้าง Expense (commission/service/voucher) พร้อม category อัตโนมัติ

## Phase M — Reliability / Security / Tests
- [ ] rate-limit/backoff, circuit breaker, sync lock (กันรันซ้อน), QStash jobs
- [ ] tests: signature ✅, token refresh, order idempotency, stock push payload, LINE dedupe
- [ ] runbook: ต่ออายุ credential, กู้ sync fail, จัดการ unmapped SKU, สลับ test→prod

---

## ลูกเล่นพิเศษ (เหนือกว่า FlowAccount) — เก็บไว้ทำ

- [ ] 🔔 Notification bell ใน-app (Phase B/C) — FlowAccount มีแค่ LINE/email
- [ ] 📊 Live Sync Health widget บน dashboard (last sync, token countdown, failed jobs, mismatch)
- [ ] ⚡ Real-time order toast (ถ้าใช้ webhook) — เร็วกว่า polling 6 ชม.ของ FlowAccount
- [ ] 🔄 Smart auto-mapping suggestion (Phase D)
- [ ] 📦 Dry-run mode (Phase E) — safety net ก่อนสร้าง Sale จริง
- [ ] 💰 Auto-categorize Shopee fees → Expense (Phase L)
- [ ] 🧾 Print ใบกำกับภาษีจากหน้า Shopee order ด้วย format เดิมของระบบ
