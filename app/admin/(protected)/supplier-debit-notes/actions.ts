"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { getAuditActorFromSession, getRequestContext } from "@/lib/audit-log";
import { Prisma } from "@/lib/generated/prisma";
import { postSupplierDebitNote, previewSupplierDebitNote, cancelSupplierDebitNote, updateSupplierDebitNote } from "@/lib/supplier-debit-note";

type Preview = Awaited<ReturnType<typeof previewSupplierDebitNote>>;
function invalidateDebitPages(): void {
  for (const path of ["/admin/supplier-debit-notes", "/admin/purchases", "/admin/supplier-payments",
    "/admin/stock/card", "/admin/reports", "/admin/analytics", "/admin/profit-distributions", "/admin/dashboard"]) {
    revalidatePath(path);
  }
}
const THAI_TEXT = /[\u0E00-\u0E7F]/u;
function debitError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "เลข DN ของ supplier นี้ถูกบันทึกแล้ว กรุณาตรวจสอบรายการเดิม";
  }
  // ZodError.message is the serialized issue list; show only a Thai issue message, never the JSON.
  if (error instanceof ZodError) {
    return error.issues.find((issue) => THAI_TEXT.test(issue.message))?.message
      ?? "ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบเลข DN เหตุผล วันที่ และรายการที่เลือก";
  }
  if (error instanceof Error && THAI_TEXT.test(error.message)) return error.message;
  return "ข้อมูลไม่ถูกต้องหรือไม่สามารถบันทึกได้ กรุณาตรวจสอบแล้วลองใหม่";
}
export async function previewDebit(raw: unknown): Promise<{ preview?: Preview; error?: string }> {
  try {
    await requireAnyPermission(["supplier_debit_notes.create", "supplier_debit_notes.update"]);
    return { preview: await previewSupplierDebitNote(raw) };
  } catch (error) { return { error: debitError(error) }; }
}
export async function createDebit(raw: unknown): Promise<{ id?: string; debitNo?: string; error?: string }> {
  try {
    const session = await requirePermission("supplier_debit_notes.create");
    const result = await postSupplierDebitNote(raw, { ...getAuditActorFromSession(session),
      ...await getRequestContext(), userId: session.user.id });
    invalidateDebitPages();
    return { id: result.id, debitNo: result.debitNo };
  } catch (error) { console.error("[supplier-DN create]", error); return { error: debitError(error) }; }
}
export async function updateDebit(id: string, raw: unknown): Promise<{ success?: boolean; reposted?: boolean; error?: string }> {
  try {
    const session = await requirePermission("supplier_debit_notes.update");
    const result = await updateSupplierDebitNote(id, raw, { ...getAuditActorFromSession(session),
      ...await getRequestContext(), userId: session.user.id });
    invalidateDebitPages();
    revalidatePath(`/admin/supplier-debit-notes/${id}`);
    return { success: true, reposted: result.reposted };
  } catch (error) { console.error("[supplier-DN update]", error); return { error: debitError(error) }; }
}
export async function cancelDebit(id: string, note: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const session = await requirePermission("supplier_debit_notes.cancel");
    await cancelSupplierDebitNote(id, note, { ...getAuditActorFromSession(session),
      ...await getRequestContext(), userId: session.user.id });
    invalidateDebitPages();
    revalidatePath(`/admin/supplier-debit-notes/${id}`);
    return { success: true };
  } catch (error) { console.error("[supplier-DN cancel]", error); return { error: debitError(error) }; }
}
