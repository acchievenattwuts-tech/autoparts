export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: heavy transaction (StockCard + MAVG recalc) can reach 180s

import { db } from "@/lib/db";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import Link from "next/link";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { hasPermissionAccess } from "@/lib/access-control";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";

const PurchaseReturnDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  await requirePermission("purchase_returns.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "purchase_returns.update");
  const { id } = await params;

  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      purchase: { select: { purchaseNo: true } },
      cashBankAccount: { select: { name: true } },
      user:     { select: { name: true } },
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        include: {
          product: { select: { code: true, name: true } },
          lotItems: { select: { lotNo: true, qty: true } },
        },
      },
    },
  });

  if (!ret) notFound();
  const [activityEvents, returnPayments] = await Promise.all([
    getDocumentActivityTimeline("PurchaseReturn", ret.id),
    db.documentPayment.findMany({
      where: { docType: "CN_PURCHASE", docId: ret.id },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: {
        amount: true,
        cashBankAccount: { select: { name: true, type: true, bankName: true, accountNo: true } },
      },
    }),
  ]);

  const vatLabel: Record<string, string> = {
    NO_VAT:        "ไม่มี VAT",
    EXCLUDING_VAT: "แยก VAT",
    INCLUDING_VAT:  "รวม VAT แล้ว",
  };

  const returnTypeLabel: Record<string, string> = {
    RETURN:   "ส่งคืนสินค้า",
    DISCOUNT: "ส่วนลดราคา",
    OTHER:    "อื่นๆ",
  };

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/purchase-returns"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> คืนสินค้าทั้งหมด
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{ret.returnNo}</span>
      </div>

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-white/10">
          <div className="flex items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">คืนสินค้าให้ซัพพลายเออร์</h1>
            {ret.status === "CANCELLED" ? (
              <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
            ) : (
              <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-emerald-500/20 dark:text-emerald-300">ใช้งาน</span>
            )}
          </div>
          {ret.status === "ACTIVE" && canUpdate && (
            <Link
              href={`/admin/purchase-returns/${id}/edit`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
            >
              <Pencil size={14} /> แก้ไข
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">เลขที่คืนสินค้า</p>
            <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{ret.returnNo}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">วันที่คืน</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {formatDateThai(ret.returnDate)}
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ซัพพลายเออร์</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{ret.supplier?.name ?? "-"}</p>
          </div>
          {ret.purchase && (
            <div>
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">อ้างอิงใบซื้อ</p>
              <Link
                href={`/admin/purchases/${ret.purchaseId}`}
                className="font-mono text-[#1e3a5f] hover:underline dark:text-sky-300 dark:hover:text-sky-200"
              >
                {ret.purchase.purchaseNo}
              </Link>
            </div>
          )}
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ประเภทการคืน</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{returnTypeLabel[ret.type] ?? ret.type}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ภาษี</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{vatLabel[ret.vatType] ?? ret.vatType}</p>
          </div>
          <div>
            <p className="mb-0.5 text-gray-500 dark:text-slate-400">ผู้บันทึก</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{ret.user?.name ?? "-"}</p>
          </div>
          {returnPayments.length > 0 && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-1 text-gray-500 dark:text-slate-400">
                ช่องทางรับเงิน (รับคืน){returnPayments.length > 1 ? ` — ${returnPayments.length} ช่องทาง` : ""}
              </p>
              <div className="space-y-1">
                {returnPayments.map((row, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-1.5 dark:border-white/10"
                  >
                    <span className="font-medium text-gray-900 dark:text-slate-100">
                      {row.cashBankAccount.name}
                      <span className="ml-1 text-xs font-normal text-gray-500 dark:text-slate-400">
                        {row.cashBankAccount.type === "BANK" ? row.cashBankAccount.bankName ?? "ธนาคาร" : "เงินสด"}
                        {row.cashBankAccount.accountNo ? ` | ${row.cashBankAccount.accountNo}` : ""}
                      </span>
                    </span>
                    <span className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300">
                      {Number(row.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {ret.note && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">หมายเหตุ</p>
              <p className="text-gray-700 dark:text-slate-300">{ret.note}</p>
            </div>
          )}
          {ret.status === "CANCELLED" && ret.cancelNote && (
            <div className="col-span-2 md:col-span-3">
              <p className="mb-0.5 text-gray-500 dark:text-slate-400">เหตุผลยกเลิก</p>
              <p className="text-red-600 dark:text-rose-400">{ret.cancelNote}</p>
            </div>
          )}
        </div>
      </div>

      <DocumentActivityTimeline events={activityEvents} />

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          รายการสินค้าที่คืน
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">สินค้า</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">จำนวน</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-slate-300">หน่วย</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">ทุน/หน่วย</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 dark:text-slate-300">รวม</th>
              </tr>
            </thead>
            <tbody>
              {ret.items.map((item) => {
                const displayScale = Number(item.unitScale ?? 1) || 1;
                const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.qty);
                const displayUnitName = item.showUnitName ?? "-";
                const displayPrice =
                  item.showPricePerUnit != null
                    ? Number(item.showPricePerUnit)
                    : Number(item.costPrice);
                return (
                <tr key={item.id} className="border-t border-gray-50 dark:border-white/5">
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{item.product.code}</td>
                  <td className="px-3 py-2 text-gray-800 dark:text-slate-200">
                    <div>
                      {item.product.name}
                      {item.moreDetail ? <span className="text-gray-500 dark:text-slate-400"> {item.moreDetail}</span> : null}
                    </div>
                    {item.lotItems.length > 0 && (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Lot: {item.lotItems.map((lot) => `${lot.lotNo} (${(Number(lot.qty) / displayScale).toLocaleString("th-TH")} ${displayUnitName})`).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">{displayQty.toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{displayUnitName}</td>
                  <td className="px-3 py-2 text-right text-gray-700 dark:text-slate-300">
                    {displayPrice.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-slate-100">
                    {Number(item.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              )})}
            </tbody>
            <tfoot className="border-t-2 border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/5">
              {ret.vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={5} className="px-3 py-1 text-right text-sm text-gray-500 dark:text-slate-400">ยอดก่อนภาษี</td>
                    <td className="px-3 py-1 text-right text-gray-700 dark:text-slate-300">
                      {Number(ret.subtotalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="px-3 py-1 text-right text-sm text-gray-500 dark:text-slate-400">
                      VAT {Number(ret.vatRate)}%
                    </td>
                    <td className="px-3 py-1 text-right text-gray-700 dark:text-slate-300">
                      +{Number(ret.vatAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={5} className="px-3 py-3 text-right font-semibold text-gray-700 dark:text-slate-300">ยอดสุทธิ</td>
                <td className="px-3 py-3 text-right text-base font-bold text-[#1e3a5f] dark:text-sky-300">
                  {Number(ret.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PurchaseReturnDetailPage;
