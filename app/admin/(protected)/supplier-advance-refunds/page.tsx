export const dynamic = "force-dynamic";
export const metadata = { title: "รับคืนเงินมัดจำซัพพลายเออร์" };

import AdvanceRefundList from "@/components/admin/AdvanceRefundList";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import {
  getSessionPermissionContext,
  requirePermission,
} from "@/lib/require-auth";
import {
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

const PAGE_SIZE = 30;

export default async function SupplierAdvanceRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}) {
  await requirePermission("supplier_advance_refunds.view");
  const { role, permissions } = await getSessionPermissionContext();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const from = params.from ?? "";
  const to = params.to ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const where: Prisma.SupplierAdvanceRefundWhereInput = {};
  if (from || to)
    where.refundDate = {
      ...(from ? { gte: parseDateOnlyToStartOfDay(from) } : {}),
      ...(to ? { lte: parseDateOnlyToEndOfDay(to) } : {}),
    };
  if (q)
    where.OR = [
      { refundNo: { contains: q, mode: "insensitive" } },
      { supplierAdvance: { advanceNo: { contains: q, mode: "insensitive" } } },
      {
        supplierAdvance: {
          supplier: { name: { contains: q, mode: "insensitive" } },
        },
      },
      { note: { contains: q, mode: "insensitive" } },
    ];
  const [records, totalCount] = await Promise.all([
    db.supplierAdvanceRefund.findMany({
      where,
      orderBy: [{ refundDate: "desc" }, { refundNo: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: {
        supplierAdvance: { include: { supplier: { select: { name: true } } } },
        cashBankAccount: { select: { name: true } },
      },
    }),
    db.supplierAdvanceRefund.count({ where }),
  ]);
  return (
    <AdvanceRefundList
      side="SUPPLIER"
      rows={records.map((row) => ({
        id: row.id,
        refundNo: row.refundNo,
        refundDate: row.refundDate,
        refundAmount: Number(row.refundAmount),
        partyName: row.supplierAdvance.supplier.name,
        sourceAdvanceId: row.supplierAdvanceId,
        sourceAdvanceNo: row.supplierAdvance.advanceNo,
        accountName: row.cashBankAccount?.name ?? null,
        status: row.status,
      }))}
      totalCount={totalCount}
      page={page}
      totalPages={Math.ceil(totalCount / PAGE_SIZE)}
      q={q}
      from={from}
      to={to}
      canCreate={hasPermissionAccess(
        role,
        permissions,
        "supplier_advance_refunds.create",
      )}
      canUpdate={hasPermissionAccess(
        role,
        permissions,
        "supplier_advance_refunds.update",
      )}
      canCancel={hasPermissionAccess(
        role,
        permissions,
        "supplier_advance_refunds.cancel",
      )}
    />
  );
}
