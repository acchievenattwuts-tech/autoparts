"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/require-auth";
import { getAuditActorFromSession, getRequestContext } from "@/lib/audit-log";
import { Prisma } from "@/lib/generated/prisma";
import { postSupplierDebitNote, previewSupplierDebitNote, cancelSupplierDebitNote } from "@/lib/supplier-debit-note";

type Preview = Awaited<ReturnType<typeof previewSupplierDebitNote>>;
function invalidateDebitPages(): void {
  for (const path of ["/admin/supplier-debit-notes", "/admin/purchases", "/admin/supplier-payments",
    "/admin/stock/card", "/admin/reports", "/admin/analytics", "/admin/profit-distributions", "/admin/dashboard"]) {
    revalidatePath(path);
  }
}
function debitError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "เลข DN ของ supplier นี้ถูกบันทึกแล้ว กรุณาตรวจสอบรายการเดิม";
  }
  if (error instanceof Error && /[\u0E00-\u0E7F]/u.test(error.message)) return error.message;
  return "ข้อมูลไม่ถูกต้องหรือไม่สามารถบันทึกได้ กรุณาตรวจสอบแล้วลองใหม่";
}
export async function previewDebit(raw: unknown): Promise<{ preview?: Preview; error?: string }> {
  try {
    await requirePermission("supplier_debit_notes.create");
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
