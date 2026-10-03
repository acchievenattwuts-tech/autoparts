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
  applyPurchaseBudgetCapChange,
  PURCHASE_BUDGET_AUDIT_ENTITY,
  PURCHASE_BUDGET_CAP_KEY,
  PURCHASE_BUDGET_MAX_CAP,
  PURCHASE_BUDGET_MAX_THRESHOLD_PCT,
  PURCHASE_BUDGET_STARTED_ON_KEY,
  PURCHASE_BUDGET_THRESHOLD_KEY,
} from "@/lib/purchase-budget-core";
import { requirePermission } from "@/lib/require-auth";
import { getThailandDateKey } from "@/lib/th-date";

const REASON_MAX_LENGTH = 500;

const stripNumberText = (value: unknown): unknown =>
  typeof value === "string" ? value.replace(/,/g, "").trim() : value;

const capChangeSchema = z.object({
  mode: z.enum(["add", "subtract", "set"], { error: "เลือกวิธีปรับเพดานไม่ถูกต้อง" }),
  amount: z.preprocess(
    stripNumberText,
    z.coerce
      .number({ error: "กรอกจำนวนเงินเป็นตัวเลข" })
      .positive("จำนวนเงินต้องมากกว่า 0")
      .max(PURCHASE_BUDGET_MAX_CAP, "จำนวนเงินมากเกินไป"),
  ),
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

export type PurchaseBudgetCapActionResult = { success?: boolean; cap?: number; error?: string };

async function upsertSetting(tx: Prisma.TransactionClient, key: string, value: string): Promise<void> {
  await tx.siteContent.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/**
 * Raise, lower or replace the purchase budget cap (and its warning line). Settings live in SiteContent;
 * every save writes an AuditLog entry in the same transaction (.rules §9) — the card's history reads it.
 * Saves are serialized by an advisory lock so two "add" saves never read the same old cap.
 */
export async function updatePurchaseBudgetCap(formData: FormData): Promise<PurchaseBudgetCapActionResult> {
  let session: Awaited<ReturnType<typeof requirePermission>>;
  try {
    session = await requirePermission("purchase_budget.manage");
  } catch {
    return { error: "ไม่มีสิทธิ์ปรับเพดานงบสั่งซื้อ" };
  }

  const parsed = capChangeSchema.safeParse({
    mode: formData.get("mode"),
    amount: formData.get("amount"),
    thresholdPct: formData.get("thresholdPct"),
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  const input = parsed.data;

  try {
    const requestContext = await getRequestContext();
    const actor = getAuditActorFromSession(session);
    const cap = await dbTx(async (tx): Promise<number> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PURCHASE_BUDGET_CAP_KEY}))`;
      const current = await getPurchaseBudgetSettings(tx);
      const nextCap = applyPurchaseBudgetCapChange(current.cap, input.mode, input.amount);
      if (nextCap <= 0) throw new PurchaseBudgetInputError("เพดานใหม่ต้องมากกว่า 0 บาท");
      if (nextCap > PURCHASE_BUDGET_MAX_CAP) throw new PurchaseBudgetInputError("เพดานใหม่มากเกินไป");
      const startedOn = current.startedOn ?? getThailandDateKey();

      await upsertSetting(tx, PURCHASE_BUDGET_CAP_KEY, nextCap.toFixed(2));
      await upsertSetting(tx, PURCHASE_BUDGET_THRESHOLD_KEY, String(input.thresholdPct));
      if (!current.startedOn) await upsertSetting(tx, PURCHASE_BUDGET_STARTED_ON_KEY, startedOn);
      await writeAuditLogTx(tx, {
        ...actor,
        ...requestContext,
        action: current.cap === null ? AuditAction.CREATE : AuditAction.UPDATE,
        entityType: PURCHASE_BUDGET_AUDIT_ENTITY,
        entityRef: "purchase-budget",
        before: { cap: current.cap, thresholdPct: current.cap === null ? null : current.thresholdPct },
        after: { cap: nextCap, thresholdPct: input.thresholdPct },
        meta: { mode: input.mode, amount: input.amount, reason: input.reason, startedOn },
      });
      return nextCap;
    });

    revalidatePath("/admin/dashboard");
    // A lower cap can cross the warning line at once; the cron would catch it within minutes anyway.
    after(() => safeCheckPurchaseBudgetAlert());
    return { success: true, cap };
  } catch (error) {
    if (error instanceof PurchaseBudgetInputError) return { error: error.message };
    console.error("[updatePurchaseBudgetCap]", error instanceof Error ? error.message : "unknown");
    return { error: "บันทึกเพดานงบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}
