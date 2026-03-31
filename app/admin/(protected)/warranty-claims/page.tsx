export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { ShieldAlert, Clock, CheckCircle2, Send, XCircle, Eye, Pencil } from "lucide-react";
import CancelClaimButton from "./CancelClaimButton";
import PrintFromListButton from "@/components/shared/PrintFromListButton";

const STATUS_LABEL: Record<string, string> = {
  DRAFT:             "รอส่งเคลม",
  SENT_TO_SUPPLIER:  "ส่งซัพพลายเออร์แล้ว",
  CLOSED:            "ปิดเคลม",
  CANCELLED:         "ยกเลิกแล้ว",
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT:             "bg-yellow-100 text-yellow-700",
  SENT_TO_SUPPLIER:  "bg-blue-100 text-blue-700",
  CLOSED:            "bg-green-100 text-green-700",
  CANCELLED:         "bg-red-100 text-red-500",
};

const OUTCOME_LABEL: Record<string, string> = {
  RECEIVED:      "ได้รับของคืน",
  NO_RESOLUTION: "ไม่ได้รับการแก้ไข",
};

const ClaimListPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; from?: string; to?: string }>;
}) => {
  await requirePermission("warranty_claims.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "warranty_claims.update");

  const { status, q, from: fromParam, to: toParam } = await searchParams;

  const dateWhere = (fromParam || toParam) ? {
    claimDate: {
      ...(fromParam ? { gte: new Date(`${fromParam}T00:00:00`) } : {}),
      ...(toParam   ? { lte: new Date(`${toParam}T23:59:59.999`) } : {}),
    },
  } : {};

  // Fetch counts from ALL claims (ignore status filter) for accurate summary cards
  const [claims, allCounts] = await Promise.all([
    db.warrantyClaim.findMany({
      where: {
        ...dateWhere,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { claimDate: "desc" },
      take: 200,
      select: {
        id: true,
        claimNo: true,
        claimDate: true,
        claimType: true,
        status: true,
        outcome: true,
        symptom: true,
        supplierName: true,
        warranty: {
          select: {
            unitSeq: true,
            product: { select: { code: true, name: true } },
            sale:    { select: { saleNo: true, customerName: true } },
          },
        },
      },
    }),
    db.warrantyClaim.groupBy({
      by: ["status"],
      where: dateWhere,
      _count: { _all: true },
    }),
  ]);

  const countMap: Record<string, number> = {};
  for (const row of allCounts) countMap[row.status] = row._count._all;

  const filtered = q
    ? claims.filter((c) =>
        c.claimNo.toLowerCase().includes(q.toLowerCase()) ||
        c.warranty.product.name.toLowerCase().includes(q.toLowerCase()) ||
        c.warranty.product.code.toLowerCase().includes(q.toLowerCase()) ||
        (c.warranty.sale.customerName?.toLowerCase().includes(q.toLowerCase()) ?? false)
      )
    : claims;

  const from = fromParam ?? "";
  const to   = toParam   ?? "";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldAlert size={22} className="text-[#1e3a5f]" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900">ใบเคลมสินค้า</h1>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        {[
          { key: "DRAFT",            label: "รอส่งเคลม",             icon: Clock,         color: "text-yellow-600 bg-yellow-50 border-yellow-100" },
          { key: "SENT_TO_SUPPLIER", label: "ส่งซัพพลายเออร์แล้ว",   icon: Send,          color: "text-blue-600 bg-blue-50 border-blue-100" },
          { key: "CLOSED",           label: "ปิดเคลมแล้ว",           icon: CheckCircle2,  color: "text-green-600 bg-green-50 border-green-100" },
          { key: "CANCELLED",        label: "ยกเลิกแล้ว",            icon: XCircle,       color: "text-red-500 bg-red-50 border-red-100" },
        ].map(({ key, label, icon: Icon, color }) => (
          <Link
            key={key}
            href={`/admin/warranty-claims?status=${status === key ? "" : key}`}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
              status === key ? color + " ring-2 ring-offset-1 ring-current/20" : "bg-white border-gray-100 hover:border-gray-200"
            }`}
          >
            <Icon size={20} className={status === key ? "" : "text-gray-400"} />
            <div>
              <p className={`text-xl font-bold ${status === key ? "" : "text-gray-800"}`}>{countMap[key] ?? 0}</p>
              <p className={`text-xs ${status === key ? "" : "text-gray-500"}`}>{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <form method="GET" className="flex gap-3 flex-wrap">
          {status && <input type="hidden" name="status" value={status} />}
          <div lang="en-GB" className="flex items-center gap-2 text-sm">
            <span className="text-gray-500 whitespace-nowrap">ช่วงวันที่</span>
            <input type="date" name="from" defaultValue={from}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20" />
            <span className="text-gray-400">–</span>
            <input type="date" name="to" defaultValue={to}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20" />
          </div>
          <input type="text" name="q" defaultValue={q ?? ""} placeholder="ค้นหาเลขเคลม, สินค้า, ลูกค้า..."
            className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm" />
          <button type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors">
            ค้นหา
          </button>
          {(q || from || to) && (
            <Link href={status ? `/admin/warranty-claims?status=${status}` : "/admin/warranty-claims"}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors">
              ล้าง
            </Link>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm text-gray-500">
            แสดง <span className="font-medium text-gray-700">{filtered.length} รายการ</span>
          </p>
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">ไม่พบรายการเคลม</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">#</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่เคลม</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">สินค้า</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ลูกค้า / ใบขาย</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ประเภทเคลม</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ซัพพลายเออร์</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">สถานะ</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่เคลม</th>
                  <th className="py-3 px-4 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, idx) => (
                  <tr key={c.id} className={`border-t border-gray-50 hover:bg-gray-50 transition-colors ${c.status === "CANCELLED" ? "opacity-50" : ""}`}>
                    <td className="py-2.5 px-4 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-2.5 px-4">
                      <Link href={`/admin/warranty-claims/${c.id}`}
                        className="font-mono text-sm text-[#1e3a5f] hover:underline font-medium">
                        {c.claimNo}
                      </Link>
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="font-medium text-gray-800">{c.warranty.product.name}</p>
                      <p className="text-xs text-gray-400">[{c.warranty.product.code}] ลำดับ #{c.warranty.unitSeq}</p>
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="text-gray-700">{c.warranty.sale.customerName ?? "—"}</p>
                      <p className="font-mono text-xs text-gray-400">{c.warranty.sale.saleNo}</p>
                    </td>
                    <td className="py-2.5 px-4 text-gray-600 text-xs">
                      {c.claimType === "REPLACE_NOW" ? "เปลี่ยนให้ทันที" : "ลูกค้ารอผล"}
                    </td>
                    <td className="py-2.5 px-4 text-gray-600 text-xs">{c.supplierName ?? "—"}</td>
                    <td className="py-2.5 px-4 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                      {c.outcome && (
                        <p className="text-xs text-gray-400 mt-0.5">{OUTCOME_LABEL[c.outcome]}</p>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-gray-600 text-xs whitespace-nowrap">
                      {new Date(c.claimDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2 justify-end">
                        <PrintFromListButton href={`/admin/warranty-claims/${c.id}/print`} />
                        <Link href={`/admin/warranty-claims/${c.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors">
                          <Eye size={14} /> ดู
                        </Link>
                        {canUpdate && c.status !== "CANCELLED" && (
                          <>
                            <Link href={`/admin/warranty-claims/${c.id}`}
                              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">
                              <Pencil size={14} /> แก้ไข
                            </Link>
                            <CancelClaimButton claimId={c.id} claimNo={c.claimNo} />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClaimListPage;
