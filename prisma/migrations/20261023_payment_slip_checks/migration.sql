-- Payment-slip duplicate + receiver checks (2026-10-23), approved by the owner (S1 + S2).
-- Additive only and safe to apply BEFORE deploying the code.
-- Apply with: npx prisma db execute --file prisma/migrations/20261023_payment_slip_checks/migration.sql
-- Then run indexes/01.sql separately, outside a transaction.
-- Then fill existing rows: npm run backfill:payment-slip-reference-key -- --apply

-- Normalized reference number used to find the same slip sent twice.
ALTER TABLE "PaymentSlip" ADD COLUMN IF NOT EXISTS "referenceNoKey" TEXT;

-- Bell + Telegram alert when a new slip has a duplicate reference, a possible
-- duplicate (same amount + minute) or a receiver name that is not the shop's.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_SLIP_FLAGGED';
