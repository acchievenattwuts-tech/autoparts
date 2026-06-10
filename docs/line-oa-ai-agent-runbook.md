# LINE OA AI Agent Runbook

## Webhook

- Configure LINE Developers webhook URL to `/api/line/webhook`.
- The route must verify `x-line-signature` against the raw request body before JSON parsing.
- The existing recipient-capture behavior for LINE daily summary must remain active.

## Modes

The runtime toggles live in the admin page **ตั้งค่าร้านค้า → "LINE OA AI Agent"**
(stored in SiteContent, not env). Defaults: auto-reply off, dry-run on, image-search off.

- Disabled mode: "เปิดใช้งาน AI ตอบแชท" = off.
  - Webhook events are verified and ingested.
  - AI does not process or send replies.
- Dry-run mode: auto-reply = on, "โหมดซ้อม (Dry-run)" = on.
  - AI suggestions may be generated and stored.
  - No outbound LINE message is sent.
- Active mode: auto-reply = on, dry-run = off.
  - Only policy-approved intents can send.
  - Webhook-context replies must try `replyMessage` first.
- Image search: "ค้นหาสินค้าจากรูปอะไหล่อัตโนมัติ" toggles whether part images auto-search the catalog (off = admin hand-off).

## AI Provider — Google Gemini Multi-Key Fallback

- The AI suggestion layer uses Google Gemini (free tier) via `GOOGLE_AI_API_KEY_1..30`.
- Secrets live in server env only; the `AiApiKeyState` table tracks per-key health (cooldown / disabled / counters) shared across all serverless instances.
- Key selection: least-recently-used available key first, to spread load across accounts.
- Fallback behavior:
  - `429` per-minute (RPM) → key cools down 60s, next key is tried.
  - `429` daily (`PerDay`) → key cools down `GOOGLE_AI_DAILY_COOLDOWN_MINUTES` (default 60 min).
  - `5xx` / network → 20s cooldown, next key is tried.
  - `400` / `401` / `403` → key is marked `DISABLED` (fix or replace the key).
  - All keys exhausted → system falls back to the deterministic rule-based reply; the webhook never fails.
- Operate with 1–10 keys; absent keys are simply skipped.

### Inspecting key health

```sql
SELECT "keyRef", status, "cooldownUntil", "requestCount", "successCount",
       "rateLimitCount", "errorCount", "lastUsedAt", "lastError"
FROM "AiApiKeyState"
WHERE provider = 'GOOGLE_GEMINI'
ORDER BY "keyRef";
```

To re-enable a `DISABLED` key after fixing/replacing the secret, set its `status` back to `AVAILABLE` and clear `cooldownUntil`.

## Reply vs Push

- `replyMessage` is the default delivery path for immediate webhook-context replies because it uses the inbound event reply token.
- `pushMessage` is reserved for:
  - admin manual replies
  - retry/fallback when reply token is unavailable or expired
  - out-of-band messages that are not inside the original webhook processing window

## Verification

- Valid signature returns success.
- Invalid signature returns `401`.
- Duplicate LINE event returns success but does not process twice.
- `PAUSED_BY_ADMIN` and `WAITING_ADMIN` conversations do not send AI replies.
- Product inquiries can reach the existing product search service.
- Payment-slip and shipping-address messages do not enter product search.
- A payment-slip image is classified, OCR'd, persisted (`PaymentSlip`), and its image stored in the private `payment-slips` bucket; it routes to admin (no auto-confirm).
- Rejecting a slip in `/admin/line-payment-slips` deletes its stored image.
- Admin takeover pauses AI before manual follow-up.
- Outbound logs record delivery mode: `reply`, `push`, or `none`.

## Data Flow / Privacy

- Gemini has no DB access; it only sees prompt content (message text, images, product-search snippets) and returns text.
- Payment-slip images are sent to Google for OCR — the one point financial data leaves the system. Disable by not configuring Gemini keys.
- Slip images live in a private bucket, admin-viewable via 5-minute signed URLs only.

## Rollout

1. Deploy schema and code with disabled mode.
2. Add 1–30 `GOOGLE_AI_API_KEY_*` secrets in the environment (Vercel + `.env.local`); confirm Supabase keys exist (for slip image storage).
3. In ตั้งค่าร้านค้า → "LINE OA AI Agent", enable AI + keep dry-run on; inspect captured conversations/suggestions (Gemini drafts stored, nothing sent).
4. Verify admin takeover and duplicate handling; send a test slip and confirm it appears in /admin/line-payment-slips with image + OCR.
5. Inspect `AiApiKeyState` to confirm key rotation/cooldown behaves as expected.
6. Turn off dry-run (active mode) for eligible intents only.
7. Monitor outbound delivery mode, fallback count, and per-key rate-limit counters.

## Rollback

In **ตั้งค่าร้านค้า → "LINE OA AI Agent"**, turn off "เปิดใช้งาน AI ตอบแชท". This keeps webhook ingestion/audit available while stopping all outbound AI delivery without touching product, sales, receipt, or stock data — and takes effect on the next inbound event (no redeploy).
