export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import AdjustmentManager from "./AdjustmentManager";

export default async function CashBankAdjustmentsPage() {
  await requirePermission("cash_bank.adjustments.view");
  const { role, permissions } = await getSessionPermissionContext();

  const [accounts, adjustments] = await Promise.all([
    db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    db.cashBankAdjustment.findMany({
      orderBy: [{ adjustDate: "desc" }, { adjustNo: "desc" }],
      take: 100,
      select: {
        id: true,
        adjustNo: true,
        adjustDate: true,
        accountId: true,
        direction: true,
        amount: true,
        reason: true,
        note: true,
        status: true,
        cancelNote: true,
        account: { select: { code: true, name: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ปรับยอดเงิน</h1>
        <p className="text-sm text-gray-500">
          ใช้กับรายการเงินเข้าออกที่ไม่ได้เกิดจากเอกสารหลัก เช่น เงินขาด เงินเกิน ค่าธรรมเนียมธนาคาร หรือการตั้งยอดเริ่มต้น
        </p>
      </div>

      <AdjustmentManager
        accounts={accounts}
        adjustments={adjustments.map((adjustment) => ({
          id: adjustment.id,
          adjustNo: adjustment.adjustNo,
          adjustDate: adjustment.adjustDate.toISOString().slice(0, 10),
          accountId: adjustment.accountId,
          accountCode: adjustment.account.code,
          accountName: adjustment.account.name,
          direction: adjustment.direction,
          amount: Number(adjustment.amount),
          reason: adjustment.reason,
          note: adjustment.note,
          status: adjustment.status,
          cancelNote: adjustment.cancelNote,
        }))}
        canCreate={hasPermissionAccess(role, permissions, "cash_bank.adjustments.create")}
        canUpdate={hasPermissionAccess(role, permissions, "cash_bank.adjustments.update")}
        canCancel={hasPermissionAccess(role, permissions, "cash_bank.adjustments.cancel")}
      />
    </div>
  );
}
