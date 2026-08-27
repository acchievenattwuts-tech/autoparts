# Shopee Open Platform Integration

> โมดูลเชื่อมต่อ Shopee แบบ **แยกอิสระ** จากระบบเดิม เป้าหมายคือ import ออเดอร์, sync สต็อก,
> แยกช่องทางการขาย (in-store vs Shopee), แจ้งเตือนเจ้าของร้าน (กระดิ่งใน-app + LINE OA),
> และ sync การจัดส่ง/tracking โดย **ไม่กระทบ logic เดิมของหน้าร้านและ backoffice**

> **โหมดคีย์เอง (2026-08-27)** — การบันทึกขาย/คืนสินค้า/กระทบยอดรับเงินแบบคีย์มือ
> ย้ายไปอยู่ในโมดูลกลาง [docs/marketplace](../marketplace/README.md) ซึ่งใช้ร่วมกับ Lazada
> เอกสารฉบับนี้ครอบเฉพาะการเชื่อม API เท่านั้น ทั้งสองโหมดใช้บัญชีพักเงินและลูกค้าเริ่มต้น
> ชุดเดียวกันจาก `MarketplaceChannelSetting`

## หลักการแยกโมดูล (Isolation Principles)

1. **โค้ดอยู่แยก** — ทุกอย่างของ Shopee อยู่ใน `lib/shopee/*`, `app/admin/(protected)/marketplace/*`,
   และ `app/api/shopee/*` ไม่มีการแก้ business logic เดิม (stock, pricing, sale flow) นอกขอบเขตนี้
2. **StockCard ยังเป็น source of truth** — Shopee ห้าม overwrite `Product.stock` / `Product.avgCost` โดยตรง
   การ push สต็อกไป Shopee จะอ่านค่าจาก internal stock เท่านั้น (one-way out)
3. **Idempotent** — order import ต้องไม่ซ้ำ โดยใช้ `shopId + orderSn` เป็น unique key
4. **ทุก Shopee sale ผ่าน service กลางเดิม** — เมื่อสร้าง `Sale` จาก Shopee order ต้องเดินผ่าน
   `writeStockCard()` / lot / profit fact เหมือน sale ปกติ ห้ามมี shortcut
5. **Additive schema** — เพิ่มตารางใหม่เท่านั้น การเพิ่ม column ในตารางเดิม (เช่น `Sale.channel`)
   ต้องมี default ที่ไม่เปลี่ยนพฤติกรรมของ record เดิม
6. **Rollback ง่าย** — ถ้าต้องถอด ลบ `lib/shopee/`, route, เมนู, และตาราง Shopee ได้โดยระบบเดิมไม่พัง

## โครงสร้างไฟล์

```
lib/shopee/
├── config.ts            # อ่าน/validate env + เลือก host (live/test) — pattern เดียวกับ lib/qstash.ts
├── signature.ts         # Shopee v2 request signing (HMAC-SHA256) — pure, มี unit test
├── client.ts            # typed HTTP client + retry/backoff + timeout + error mapping
├── types.ts             # response envelope + auth payloads + ShopeeApiError
└── __tests__/
    └── signature.test.ts  # golden-fixture tests (node:test)
```

## สถานะ: Phase A + B + C เสร็จ ✅

### Phase A — Foundation

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/shopee/config.ts` | env validation (zod), host selection, `getShopeeConfig()` / `getRequiredShopeeConfig()` |
| `lib/shopee/signature.ts` | `signPublic` / `signShop` / `signMerchant` + query builders |
| `lib/shopee/client.ts` | `ShopeeClient.callPublic()` / `callShop()` พร้อม retry เฉพาะ idempotent + timeout |
| `lib/shopee/types.ts` | `ShopeeResponse<T>`, `ShopeeApiError`, retryable error codes |

### Phase B — Schema + Permissions (push ลง DB แล้ว)

5 ตารางใหม่ (`ShopeeShop`, `ShopeeProductMapping`, `ShopeeOrderImport`, `ShopeeSyncJob`, `Notification`) +
7 enum + permission `marketplace.view/manage/sync` — additive ล้วน ไม่แตะตารางเดิม

### Phase C — Auth Flow + Notification Bell

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/shopee/services/auth.ts` | authorization URL, token exchange/refresh, `getValidShopAuth` (refresh-before-expiry) |
| `lib/shopee/services/token-maintenance.ts` | proactive refresh token ใกล้หมดอายุ + แจ้งเตือน |
| `lib/notifications.ts` | กระดิ่งแจ้งเตือนทั่วไป (fan-out admin, dedupe, read state ใน DB) |
| `app/admin/(protected)/marketplace/shopee/` | หน้า overview + connect/disconnect (page/loading/actions) |
| `app/admin/(protected)/notifications/` | หน้าการแจ้งเตือนทั้งหมด |
| `app/api/shopee/callback/route.ts` | OAuth callback แลก code → token |
| `app/api/shopee/cron/refresh-tokens/route.ts` | Vercel Cron refresh token (GET + `CRON_SECRET`) — schedule ใน `vercel.json` |
| `app/api/admin/notifications/route.ts` | feed กระดิ่ง (summary/list/markRead) |
| `components/shared/AdminNotificationBell.tsx` | กระดิ่งบน admin header |

### Phase D — Product Mapping (read-only)

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/shopee/services/products.ts` | `fetchShopeeItems()` — ดึง item/model/SKU จาก Shopee (live) |
| `lib/shopee/services/mapping.ts` | CRUD mapping + `suggestAutoMappings()` (pure, SKU==code) |
| `app/admin/(protected)/marketplace/shopee/products/` | หน้า map (page/loading/actions) + `MappingManager` client |

map สินค้าในระบบ ↔ Shopee item/model/SKU · auto-suggest จาก SKU ตรงรหัสสินค้า · ยังไม่ตัดสต็อก
(stock comparison เลื่อนไป Phase G)

### Phase E — Order Import (queue only, ไม่สร้าง Sale)

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/shopee/services/orders.ts` | `pullShopeeOrders()` / `pullAllAuthorizedShops()` — ดึงออเดอร์เข้า `ShopeeOrderImport` idempotent |
| `app/admin/(protected)/marketplace/shopee/orders/` | queue UI (status tabs + manual pull) |
| `app/api/shopee/cron/pull-orders/route.ts` | Vercel cron ดึงออเดอร์อัตโนมัติ (ทุก 30 นาที) |

สถานะ import: READY_TO_SHIP + PROCESSED · lookback 15 วัน · SKU ไม่ครบ → `NEEDS_SKU_MAPPING` ·
**ไม่สร้าง Sale / ไม่ตัดสต็อก** (Phase F) · auto-pull cron กรอง `syncEnabled=true`

### Shopee v2 signing (อ้างอิงสำหรับนักพัฒนา)

- **Public** (auth/token): `base = partner_id + path + timestamp`
- **Shop** (orders/items/logistics): `base = partner_id + path + timestamp + access_token + shop_id`
- **Merchant**: `base = partner_id + path + timestamp + access_token + merchant_id`
- `sign = HMAC_SHA256(base, partner_key)` แล้ว hex (lowercase), `timestamp` เป็นวินาที
- Host: live = `partner.shopeemobile.com`, test = `partner.test-stable.shopeemobile.com`

## เอกสารที่เกี่ยวข้อง

- **Checklist เต็มทุก phase:** [PLAN-shopee.md](./PLAN-shopee.md)
- **งานที่เจ้าของร้านต้องทำเอง:** [USER-TASKS.md](./USER-TASKS.md)
- **Roadmap เดิม (historical):** [docs/archive/PLAN-legacy-2026-05-21.md](../archive/PLAN-legacy-2026-05-21.md) §"Shopee Open Platform Integration"

## รันเทสต์

```bash
npx tsx --test lib/shopee/__tests__/signature.test.ts
```
