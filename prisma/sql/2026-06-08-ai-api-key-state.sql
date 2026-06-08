-- Additive only: AI API key health tracking for Gemini multi-key fallback.
-- Safe to run on production — creates new enum types + table, touches nothing else.

DO $$ BEGIN
  CREATE TYPE "AiApiKeyProvider" AS ENUM ('GOOGLE_GEMINI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AiApiKeyStatus" AS ENUM ('AVAILABLE', 'COOLING_DOWN', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AiApiKeyState" (
  "id"             TEXT NOT NULL,
  "keyRef"         TEXT NOT NULL,
  "provider"       "AiApiKeyProvider" NOT NULL DEFAULT 'GOOGLE_GEMINI',
  "status"         "AiApiKeyStatus" NOT NULL DEFAULT 'AVAILABLE',
  "cooldownUntil"  TIMESTAMPTZ(3),
  "lastError"      TEXT,
  "requestCount"   INTEGER NOT NULL DEFAULT 0,
  "successCount"   INTEGER NOT NULL DEFAULT 0,
  "errorCount"     INTEGER NOT NULL DEFAULT 0,
  "rateLimitCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt"     TIMESTAMPTZ(3),
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "AiApiKeyState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiApiKeyState_keyRef_key" ON "AiApiKeyState"("keyRef");
CREATE INDEX IF NOT EXISTS "AiApiKeyState_provider_status_cooldownUntil_idx" ON "AiApiKeyState"("provider", "status", "cooldownUntil");
CREATE INDEX IF NOT EXISTS "AiApiKeyState_provider_lastUsedAt_idx" ON "AiApiKeyState"("provider", "lastUsedAt");
