-- Purchase budget alerts (2026-10-03), approved by the owner. Safe to apply BEFORE deploying the code.
-- Apply with: npx prisma db execute --file prisma/migrations/20261003_purchase_budget_notifications/migration.sql
-- Bell + Telegram alert when a purchase, supplier deposit or cap change moves the purchase budget
-- below its warning line (LOW) or past its cap (EXCEEDED).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PURCHASE_BUDGET_LOW';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PURCHASE_BUDGET_EXCEEDED';
