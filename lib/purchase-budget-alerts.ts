import { dbTx } from "@/lib/db";
import { notifyPurchaseBudgetAlert } from "@/lib/notifications";
import { getPurchaseBudgetSnapshot } from "@/lib/purchase-budget";
import {
  isPurchaseBudgetLevelWorse,
  PURCHASE_BUDGET_ALERT_LEVEL_KEY,
  type PurchaseBudgetLevel,
} from "@/lib/purchase-budget-core";

/**
 * Purchase budget alert check, run by the cron route every few minutes and right after a cap change.
 * It never touches a document flow: it reads the budget, compares its level with the level the last
 * check stored (SiteContent), stores the new level, and alerts (bell + Telegram) only when the level
 * got worse — ok → low, ok/low → over. An improvement re-arms the alert silently.
 */

export type PurchaseBudgetAlertResult = {
  checked: boolean;
  previous: PurchaseBudgetLevel | null;
  current: PurchaseBudgetLevel | null;
  notified: boolean;
};

export function parseStoredPurchaseBudgetLevel(value: string | null | undefined): PurchaseBudgetLevel {
  return value === "low" || value === "over" ? value : "ok";
}

/** Stores `next` under an advisory lock (concurrent checks alert once); returns the previous level when it changed. */
async function swapStoredLevel(next: PurchaseBudgetLevel): Promise<PurchaseBudgetLevel | null> {
  return dbTx(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PURCHASE_BUDGET_ALERT_LEVEL_KEY}))`;
    const row = await tx.siteContent.findUnique({ where: { key: PURCHASE_BUDGET_ALERT_LEVEL_KEY }, select: { value: true } });
    const previous = parseStoredPurchaseBudgetLevel(row?.value);
    if (previous === next) return null;
    await tx.siteContent.upsert({
      where: { key: PURCHASE_BUDGET_ALERT_LEVEL_KEY },
      update: { value: next },
      create: { key: PURCHASE_BUDGET_ALERT_LEVEL_KEY, value: next },
    });
    return previous;
  });
}

export async function checkPurchaseBudgetAlert(): Promise<PurchaseBudgetAlertResult> {
  const snapshot = await getPurchaseBudgetSnapshot();
  if (!snapshot) return { checked: false, previous: null, current: null, notified: false };

  const { figures } = snapshot;
  const previous = await swapStoredLevel(figures.level);
  if (previous === null || figures.level === "ok" || !isPurchaseBudgetLevelWorse(previous, figures.level)) {
    return { checked: true, previous, current: figures.level, notified: false };
  }
  await notifyPurchaseBudgetAlert({
    level: figures.level,
    cap: figures.cap,
    remaining: figures.remaining,
    remainingPct: figures.remainingPct,
    thresholdPct: figures.thresholdPct,
  });
  return { checked: true, previous, current: figures.level, notified: true };
}

/** For callers outside the cron (cap change): a failed check is logged, never thrown (.rules §10). */
export async function safeCheckPurchaseBudgetAlert(): Promise<void> {
  try {
    await checkPurchaseBudgetAlert();
  } catch (error) {
    console.error("[purchase-budget] alert check failed", error instanceof Error ? error.message : "unknown");
  }
}
