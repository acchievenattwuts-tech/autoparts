"use server";

import { z } from "zod";

import {
  getPurchaseBudgetLedgerDay,
  getPurchaseBudgetLedgerPage,
  type PurchaseBudgetLedgerDoc,
  type PurchaseBudgetLedgerPage,
} from "@/lib/purchase-budget-ledger";
import { requirePermission } from "@/lib/require-auth";
import { isDateOnlyString } from "@/lib/th-date";

/**
 * Read-only loads for the Purchase Budget ledger panel: called from the browser only when the viewer
 * opens the panel or a day, so the dashboard itself never pays for them.
 */

const MAX_OFFSET = 10_000;

const offsetSchema = z.coerce.number().int().min(0).max(MAX_OFFSET);
const dateKeySchema = z.string().trim().refine((value) => isDateOnlyString(value), { message: "วันที่ไม่ถูกต้อง" });

export type LedgerPageResult = { page?: PurchaseBudgetLedgerPage | null; error?: string };
export type LedgerDayResult = { documents?: PurchaseBudgetLedgerDoc[] | null; error?: string };

export async function loadPurchaseBudgetLedgerPage(offset: number): Promise<LedgerPageResult> {
  try {
    await requirePermission("purchase_budget.view");
  } catch {
    return { error: "ไม่มีสิทธิ์ดูงบสั่งซื้อ" };
  }
  const parsed = offsetSchema.safeParse(offset);
  if (!parsed.success) return { error: "ข้อมูลไม่ถูกต้อง" };
  try {
    return { page: await getPurchaseBudgetLedgerPage(parsed.data) };
  } catch (error) {
    console.error("[purchase-budget] ledger page failed", error instanceof Error ? error.message : "unknown");
    return { error: "โหลดรายการไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function loadPurchaseBudgetLedgerDay(dateKey: string): Promise<LedgerDayResult> {
  try {
    await requirePermission("purchase_budget.view");
  } catch {
    return { error: "ไม่มีสิทธิ์ดูงบสั่งซื้อ" };
  }
  const parsed = dateKeySchema.safeParse(dateKey);
  if (!parsed.success) return { error: "วันที่ไม่ถูกต้อง" };
  try {
    return { documents: await getPurchaseBudgetLedgerDay(parsed.data) };
  } catch (error) {
    console.error("[purchase-budget] ledger day failed", error instanceof Error ? error.message : "unknown");
    return { error: "โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}
