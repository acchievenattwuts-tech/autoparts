export const dynamic = "force-dynamic";

import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import TransferManager from "./TransferManager";

export default async function CashBankTransfersPage() {
  await requirePermission("cash_bank.transfers.view");
  const { role, permissions } = await getSessionPermissionContext();

  const [accounts, transfers] = await Promise.all([
    db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    db.cashBankTransfer.findMany({
      orderBy: [{ transferDate: "desc" }, { transferNo: "desc" }],
      take: 100,
      select: {
        id: true,
        transferNo: true,
        transferDate: true,
        amount: true,
        note: true,
        status: true,
        cancelNote: true,
        fromAccount: { select: { name: true } },
        toAccount: { select: { name: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">โอนเงินระหว่างบัญชี</h1>
        <p className="text-sm text-gray-500">จัดการการย้ายเงินสดเข้าธนาคาร หรือโอนระหว่างบัญชี โดยสร้าง movement สองฝั่งอัตโนมัติ</p>
      </div>

      <TransferManager
        accounts={accounts}
        transfers={transfers.map((transfer) => ({
          id: transfer.id,
          transferNo: transfer.transferNo,
          transferDate: transfer.transferDate.toISOString().slice(0, 10),
          fromAccountName: transfer.fromAccount.name,
          toAccountName: transfer.toAccount.name,
          amount: Number(transfer.amount),
          note: transfer.note,
          status: transfer.status,
          cancelNote: transfer.cancelNote,
        }))}
        canCreate={hasPermissionAccess(role, permissions, "cash_bank.transfers.create")}
        canCancel={hasPermissionAccess(role, permissions, "cash_bank.transfers.cancel")}
      />
    </div>
  );
}
