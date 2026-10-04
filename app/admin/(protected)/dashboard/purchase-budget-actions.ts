"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { getAuditActorFromSession, getRequestContext, writeAuditLogTx } from "@/lib/audit-log";
import { dbTx } from "@/lib/db";
import { AuditAction, type Prisma } from "@/lib/generated/prisma";
import { getPurchaseBudgetSettings } from "@/lib/purchase-budget";
import { safeCheckPurchaseBudgetAlert } from "@/lib/purchase-budget-alerts";
import {
  applyPurchaseBudgetChange,
  PURCHASE_BUDGET_AUDIT_ENTITY,
  PURCHASE_BUDGET_CAP_KEY,
  PURCHASE_BUDGET_MAX_AMOUNT,
  PURCHASE_BUDGET_MAX_THRESHOLD_PCT,
  PURCHASE_BUDGET_STARTED_ON_KEY,
  PURCHASE_BUDGET_THRESHOLD_KEY,
} from "@/lib/purchase-budget-core";
import { requirePermission } from "@/lib/require-auth";
import { getThailandDateKey, isDateOnlyString } from "@/lib/th-date";

const REASON_MAX_LENGTH = 500;

const stripNumberText = (value: unknown): unknown =>
  typeof value === "string" ? value.replace(/,/g, "").trim() : value;

const budgetChangeSchema = z.object({
  mode: z.enum(["add", "subtract", "restart"], { error: "เลือกวิธีปรับงบไม่ถูกต้อง" }),
  amount: z.preprocess(
    stripNumberText,
    z.coerce
      .number({ error: "กรอกจำนวนเงินเป็นตัวเลข" })
      .positive("จำนวนเงินต้องมากกว่า 0")
      .max(PURCHASE_BUDGET_MAX_AMOUNT, "จำนวนเงินมากเกินไป"),
  ),
  /** Restart only: Thailand date (YYYY-MM-DD) documents count from — today or earlier. */
  startDate: z.string().trim().optional(),
  thresholdPct: z.preprocess(
    stripNumberText,
    z.coerce
      .number({ error: "กรอกเส้นเตือนเป็นตัวเลข" })
      .min(0, `เส้นเตือนต้องอยู่ระหว่าง 0–${PURCHASE_BUDGET_MAX_THRESHOLD_PCT}%`)
      .max(PURCHASE_BUDGET_MAX_THRESHOLD_PCT, `เส้นเตือนต้องอยู่ระหว่าง 0–${PURCHASE_BUDGET_MAX_THRESHOLD_PCT}%`),
  ),
  reason: z.string().trim().min(1, "กรุณากรอกเหตุผล").max(REASON_MAX_LENGTH, "เหตุผลยาวเกินไป"),
});

class PurchaseBudgetInputError extends Error {}

export type PurchaseBudgetActionResult = { success?: boolean; budget?: number; error?: string };

async function upsertSetting(tx: Prisma.TransactionClient, key: string, value: string): Promise<void> {
  await tx.siteContent.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** A restart needs a valid start date that is not in the future (Thailand calendar). */
function readStartDate(mode: string, startDate: string | undefined): string | null {
  if (mode !== "restart") return null;
  if (!startDate || !isDateOnlyString(startDate)) throw new PurchaseBudgetInputError("กรุณาเลือกวันที่เริ่มนับ");
  if (startDate > getThailandDateKey()) throw new PurchaseBudgetInputError("วันที่เริ่มนับต้องไม่เกินวันนี้");
  return startDate;
}

/**
 * Top up, cut or restart the purchase budget (and set its warning line). A restart sets a new amount and
 * the date documents count from; the first setup is a restart. Settings live in SiteContent; every save
 * writes an AuditLog entry in the same transaction (.rules §9) — the ledger and history read it. Saves
 * are serialized by an advisory lock so two top-ups never read the same old amount.
 */
export async function updatePurchaseBudget(formData: FormData): Promise<PurchaseBudgetActionResult> {
  let session: Awaited<ReturnType<typeof requirePermission>>;
  try {
    session = await requirePermission("purchase_budget.manage");
  } catch {
    return { error: "ไม่มีสิทธิ์ปรับงบสั่งซื้อ" };
  }

  const parsed = budgetChangeSchema.safeParse({
    mode: formData.get("mode"),
    amount: formData.get("amount"),
    startDate: formData.get("startDate") ?? undefined,
    thresholdPct: formData.get("thresholdPct"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const input = parsed.data;

  try {
    const requestContext = await getRequestContext();
    const actor = getAuditActorFromSession(session);
    const restartOn = readStartDate(input.mode, input.startDate);
    const budget = await dbTx(async (tx): Promise<number> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PURCHASE_BUDGET_CAP_KEY}))`;
      const current = await getPurchaseBudgetSettings(tx);
      if (current.budget === null && !restartOn) throw new PurchaseBudgetInputError("ยังไม่ได้ตั้งงบ กรุณาตั้งงบก่อน");
      const nextBudget = applyPurchaseBudgetChange(current.budget, input.mode, input.amount);
      if (nextBudget <= 0) throw new PurchaseBudgetInputError("งบใหม่ต้องมากกว่า 0 บาท");
      if (nextBudget > PURCHASE_BUDGET_MAX_AMOUNT) throw new PurchaseBudgetInputError("งบใหม่มากเกินไป");
      const startedOn = restartOn ?? current.startedOn ?? getThailandDateKey();

      await upsertSetting(tx, PURCHASE_BUDGET_CAP_KEY, nextBudget.toFixed(2));
      await upsertSetting(tx, PURCHASE_BUDGET_THRESHOLD_KEY, String(input.thresholdPct));
      if (restartOn) await upsertSetting(tx, PURCHASE_BUDGET_STARTED_ON_KEY, startedOn);
      await writeAuditLogTx(tx, {
        ...actor,
        ...requestContext,
        action: current.budget === null ? AuditAction.CREATE : AuditAction.UPDATE,
        entityType: PURCHASE_BUDGET_AUDIT_ENTITY,
        entityRef: "purchase-budget",
        before: { cap: current.budget, thresholdPct: current.budget === null ? null : current.thresholdPct },
        after: { cap: nextBudget, thresholdPct: input.thresholdPct },
        meta: { mode: input.mode, amount: input.amount, reason: input.reason, startedOn },
      });
      return nextBudget;
    });

    revalidatePath("/admin/dashboard");
    // A cut or restart can cross the warning line at once; the hourly cron would catch it later anyway.
    after(() => safeCheckPurchaseBudgetAlert());
    return { success: true, budget };
  } catch (error) {
    if (error instanceof PurchaseBudgetInputError) return { error: error.message };
    console.error("[updatePurchaseBudget]", error instanceof Error ? error.message : "unknown");
    return { error: "บันทึกงบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}
