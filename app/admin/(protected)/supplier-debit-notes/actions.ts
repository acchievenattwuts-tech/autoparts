"use server";

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { z, ZodError } from "zod";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { getAuditActorFromSession, getRequestContext } from "@/lib/audit-log";
import { PERIOD_LOCK_OVERRIDE_PERMISSION, PeriodLockedError } from "@/lib/period-lock";
import {
  postSupplierDebitNote, previewSupplierDebitNote, cancelSupplierDebitNote, updateSupplierDebitNote,
  SupplierDebitPreviewRequiredError, SupplierDebitStaleError, toSupplierDebitLockedPeriods,
  type SupplierDebitLockedPeriod, type SupplierDebitMutationOptions,
} from "@/lib/supplier-debit-note";
import { postSupplierDebitAdjustment, previewSupplierDebitAdjustment } from "@/lib/supplier-debit-adjustment";

type Preview = Awaited<ReturnType<typeof previewSupplierDebitNote>>;
/** Set when a distributed month blocked the save; canOverride tells the form to ask for the override reason. */
type PeriodLockResponse = { periodLock?: { canOverride: boolean; periods: SupplierDebitLockedPeriod[] } };
const overrideReasonSchema = z.string().trim().max(1000).optional();
/** The owner override (lib/period-lock.ts): permission from the session, reason from the form. */
function periodLockOptions(session: Session, rawReason: unknown): SupplierDebitMutationOptions {
  const allowed = (session.user.permissions ?? []).includes(PERIOD_LOCK_OVERRIDE_PERMISSION);
  const parsed = overrideReasonSchema.safeParse(rawReason);
  return { periodLockOverride: { allowed, reason: allowed && parsed.success ? parsed.data ?? null : null } };
}
const periodLockResponse = (error: unknown, options: SupplierDebitMutationOptions | null): PeriodLockResponse =>
  error instanceof PeriodLockedError ? { periodLock: { canOverride: options?.periodLockOverride?.allowed ?? false,
    periods: toSupplierDebitLockedPeriods(error.periods) } } : {};
function invalidateDebitPages(): void {
  // Sales and credit notes too: a cancel or line edit restates the cost of later sales.
  for (const path of ["/admin/supplier-debit-notes", "/admin/purchases", "/admin/supplier-payments",
    "/admin/stock/card", "/admin/reports", "/admin/analytics", "/admin/profit-distributions", "/admin/dashboard",
    "/admin/sales", "/admin/credit-notes"]) {
    revalidatePath(path);
  }
}
const THAI_TEXT = /[\u0E00-\u0E7F]/u;
const AUTH_ERROR_CODES = new Set(["UNAUTHORIZED", "FORBIDDEN"]);
function debitError(error: unknown): string {
  // requirePermission throws these codes; reuse the repo-wide no-permission message.
  if (error instanceof Error && AUTH_ERROR_CODES.has(error.message)) return "ไม่มีสิทธิ์เข้าถึง";
  // A duplicate supplier DN number (T4) arrives as SupplierDebitReferenceConflictError with a Thai message naming the
  // ACTIVE DN; the service maps the index's P2002 to it. Any other P2002 gets the generic message below.
  // ZodError.message is the serialized issue list; show only a Thai issue message, never the JSON.
  if (error instanceof ZodError) {
    return error.issues.find((issue) => THAI_TEXT.test(issue.message))?.message
      ?? "ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบเลข DN เหตุผล วันที่ และรายการที่เลือก";
  }
  if (error instanceof Error && THAI_TEXT.test(error.message)) return error.message;
  return "ข้อมูลไม่ถูกต้องหรือไม่สามารถบันทึกได้ กรุณาตรวจสอบแล้วลองใหม่";
}
/** With debitId (edit) the preview uses the DN's original position and reports restated sales and locked months. */
export async function previewDebit(raw: unknown, debitId?: string): Promise<{ preview?: Preview; error?: string }> {
  try {
    await requireAnyPermission(["supplier_debit_notes.create", "supplier_debit_notes.update"]);
    const id = z.string().min(1).optional().parse(debitId);
    return { preview: await previewSupplierDebitNote(raw, id ? { debitId: id } : undefined) };
  } catch (error) { return { error: debitError(error) }; }
}
export async function createDebit(raw: unknown, periodLockReason?: string): Promise<{
  id?: string; debitNo?: string; error?: string } & PeriodLockResponse> {
  let options: SupplierDebitMutationOptions | null = null;
  try {
    const session = await requirePermission("supplier_debit_notes.create");
    options = periodLockOptions(session, periodLockReason);
    const result = await postSupplierDebitNote(raw, { ...getAuditActorFromSession(session),
      ...await getRequestContext(), userId: session.user.id }, options);
    invalidateDebitPages();
    return { id: result.id, debitNo: result.debitNo };
  } catch (error) {
    console.error("[supplier-DN create]", error);
    return { error: debitError(error), ...periodLockResponse(error, options) };
  }
}
type AdjustmentPreview = Awaited<ReturnType<typeof previewSupplierDebitAdjustment>>;
/** "ปรับยอด DN" (R5-D / ก3): totals, coverage and the parent/excess split before saving. */
export async function previewDebitAdjustment(raw: unknown): Promise<{ preview?: AdjustmentPreview; error?: string }> {
  try {
    await requirePermission("supplier_debit_notes.create");
    return { preview: await previewSupplierDebitAdjustment(raw) };
  } catch (error) { return { error: debitError(error) }; }
}
/** Posts the adjustment today; previewRequired asks the form to run "ตรวจยอด" again (the parent's balance moved). */
export async function createDebitAdjustment(raw: unknown, periodLockReason?: string): Promise<{
  id?: string; debitNo?: string; error?: string; previewRequired?: boolean } & PeriodLockResponse> {
  let options: SupplierDebitMutationOptions | null = null;
  try {
    const session = await requirePermission("supplier_debit_notes.create");
    options = periodLockOptions(session, periodLockReason);
    const result = await postSupplierDebitAdjustment(raw, { ...getAuditActorFromSession(session),
      ...await getRequestContext(), userId: session.user.id }, options);
    invalidateDebitPages();
    revalidatePath("/admin/cash-bank");
    return { id: result.id, debitNo: result.debitNo };
  } catch (error) {
    console.error("[supplier-DN adjust]", error);
    return { error: debitError(error), ...(error instanceof SupplierDebitPreviewRequiredError ? { previewRequired: true } : {}),
      ...periodLockResponse(error, options) };
  }
}
/** previewRequired re-enables "ตรวจยอด" on the form; stale means the DN changed and the page must reload. */
export async function updateDebit(id: string, raw: unknown, periodLockReason?: string): Promise<{
  success?: boolean; reposted?: boolean; error?: string; previewRequired?: boolean; stale?: boolean;
} & PeriodLockResponse> {
  let options: SupplierDebitMutationOptions | null = null;
  try {
    const session = await requirePermission("supplier_debit_notes.update");
    options = periodLockOptions(session, periodLockReason);
    const result = await updateSupplierDebitNote(id, raw, { ...getAuditActorFromSession(session),
      ...await getRequestContext(), userId: session.user.id }, options);
    invalidateDebitPages();
    revalidatePath(`/admin/supplier-debit-notes/${id}`);
    return { success: true, reposted: result.reposted };
  } catch (error) {
    console.error("[supplier-DN update]", error);
    return { error: debitError(error), ...(error instanceof SupplierDebitPreviewRequiredError ? { previewRequired: true } : {}),
      ...(error instanceof SupplierDebitStaleError ? { stale: true } : {}), ...periodLockResponse(error, options) };
  }
}
export async function cancelDebit(id: string, note: string, periodLockReason?: string): Promise<{
  success?: boolean; error?: string } & PeriodLockResponse> {
  let options: SupplierDebitMutationOptions | null = null;
  try {
    const session = await requirePermission("supplier_debit_notes.cancel");
    options = periodLockOptions(session, periodLockReason);
    await cancelSupplierDebitNote(id, note, { ...getAuditActorFromSession(session),
      ...await getRequestContext(), userId: session.user.id }, options);
    invalidateDebitPages();
    // Cancelling a ปรับยอด DN reverses its cash refund.
    revalidatePath("/admin/cash-bank");
    revalidatePath(`/admin/supplier-debit-notes/${id}`);
    return { success: true };
  } catch (error) {
    console.error("[supplier-DN cancel]", error);
    return { error: debitError(error), ...periodLockResponse(error, options) };
  }
}
