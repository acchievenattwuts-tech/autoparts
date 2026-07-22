# LINE OA AI Agent Env

This feature must read all credentials server-side only. Do not expose these variables to client components, browser bundles, or `NEXT_PUBLIC_*` env names.

## Required

- `LINE_MESSAGING_API_CHANNEL_SECRET`
  - Used to verify `x-line-signature` from the raw webhook body.
- `LINE_MESSAGING_API_CHANNEL_ACCESS_TOKEN`
  - Used for LINE profile lookup, `replyMessage`, and push fallback/admin replies.
- `GOOGLE_AI_API_KEY_1` .. `GOOGLE_AI_API_KEY_30`
  - Google Gemini API keys (free tier) from up to 30 separate Google accounts.
  - The AI suggestion/vision layer rotates least-recently-used first and falls back
    to the next key automatically when one hits a rate/quota limit.
  - At least one key must be present for AI replies; the system runs with 1–30 keys.
  - Per-key health (cooldown / disabled) is tracked in the `AiApiKeyState` table so
    all serverless instances share the same rotation state.

## Existing Database Access

- `DATABASE_URL`
  - Used by Prisma through the repo's existing [lib/db.ts](/D:/autoparts/lib/db.ts).
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
  - Only required if a later image-storage step needs direct Supabase Storage access.
  - Must remain server-only. Never expose service-role credentials to client/browser code.

## Optional

- `GOOGLE_AI_MODEL`
  - Gemini model id. Defaults to `gemini-3.5-flash-lite`. Use a multimodal model for image/OCR steps.
- `GOOGLE_AI_THINKING_LEVEL`
  - Gemini 3 reasoning depth: `HIGH` (default), `LOW`, or `NONE` (disables thinking). Case-insensitive; sent upper-case to the API.
- `GOOGLE_AI_DAILY_COOLDOWN_MINUTES`
  - Minutes a key stays on cooldown after a daily-quota (`PerDay`) 429. Defaults to `60`.
  - Per-minute (RPM) 429s use a fixed 60-second cooldown; transient 5xx/network errors use 20 seconds.
## Runtime Toggles — Managed in the Admin Settings Page (not env)

The three AI runtime switches are **no longer environment variables**. They are
stored in `SiteContent` and managed from **ตั้งค่าร้านค้า → "LINE OA AI Agent"**, so
admins can flip them without a redeploy. Reads are uncached (`getLineAiSettings()`),
so changes take effect on the next inbound event.

- `line_ai_auto_reply_enabled` (default `false`)
  - Master switch. Off keeps webhook ingestion active but blocks all AI work; on lets the AI process and reply.
- `line_ai_dry_run` (default `true`)
  - On stores AI suggestions but sends nothing to LINE (safe rehearsal). Off delivers replies for real.
- `line_ai_image_search_enabled` (default `false`)
  - On lets the AI feed a part image's vision hints into product search and propose near-matches conservatively.
  - Off keeps part images as an admin hand-off (still classified, no auto search/reply).

## Delivery Mode

- Use LINE `replyMessage` first when handling an inbound webhook event with a valid reply token.
- Use push only when the reply token is unavailable/expired or when an admin sends an out-of-band/manual message.
- Log the delivery mode for each outbound message as `reply`, `push`, or `none`.

## Storage

Payment-slip images are persisted; no new env keys are required — it reuses the
existing Supabase storage credentials:

- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-only).
- Bucket: **`payment-slips`** — created automatically as **private** on first use.
- Object path: `YYYY/MM/DD/<slipId>.webp` (date-partitioned).
- Format: grayscale WebP, downscaled to ≤1000px (~20–50KB per slip).
- Captured at ingestion (when the slip arrives), deleted automatically if an admin
  rejects the slip. Admins view it via a short-lived signed URL (5 min TTL).

Part images are NOT stored — they are fetched on demand for classification only.
