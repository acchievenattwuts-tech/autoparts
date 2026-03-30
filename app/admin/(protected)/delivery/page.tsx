export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { SHIPPING_STATUS_LABEL, SHIPPING_STATUS_BADGE, SHIPPING_METHOD_LABEL } from "@/lib/shipping";
import Link from "next/link";
import { Eye, Printer } from "lucide-react";
import DeliveryUpdateButton from "./DeliveryUpdateButton";

const DeliveryPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) => {
  await requirePermission("delivery.view");
  const { status } = await searchParams;
  const statusFilter =
    status && ["PENDING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status)
      ? status
      : undefined;

  const sales = await db.sale.findMany({
    where: {
      fulfillmentType: "DELIVERY",
      status:          "ACTIVE",
      ...(statusFilter
        ? { shippingStatus: statusFilter as "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED" }
        : { shippingStatus: { in: ["PENDING", "OUT_FOR_DELIVERY"] } }),
    },
    orderBy: [{ saleDate: "desc" }, { saleNo: "desc" }],
    take: 100,
    select: {
      id:              true,
      saleNo:          true,
      saleDate:        true,
      customerName:    true,
      shippingAddress: true,
      shippingStatus:  true,
      shippingMethod:  true,
      trackingNo:      true,
      netAmount:       true,
      paymentType:     true,
      amountRemain:    true,
      customer:        { select: { name: true, phone: true } },
    },
  });

  const tabs = [
    { label: "รอจัดส่ง + กำลังส่ง", value: undefined },
    { label: "รอจัดส่ง",             value: "PENDING" },
    { label: "กำลังส่ง",             value: "OUT_FOR_DELIVERY" },
    { label: "ส่งแล้ว",              value: "DELIVERED" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">คิวจัดส่ง</h1>
        <span className="text-sm text-gray-500">{sales.length} รายการ</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.value ? `/admin/delivery?status=${tab.value}` : "/admin/delivery"}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-[#1e3a5f] text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:border-[#1e3a5f]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่ใบขาย</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ลูกค้า</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ที่อยู่จัดส่ง</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ชำระ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">อัปเดต</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">
                    ไม่มีรายการจัดส่ง
                  </td>
                </tr>
              ) : (
                sales.map((s) => (
                  <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{s.saleNo}</td>
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                      {new Date(s.saleDate).toLocaleDateString("th-TH-u-ca-gregory", {
                        day:   "2-digit",
                        month: "2-digit",
                        year:  "numeric",
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-gray-900">
                        {s.customer?.name ?? s.customerName ?? "-"}
                      </p>
                      {s.customer?.phone && (
                        <p className="text-xs text-gray-400">{s.customer.phone}</p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs">
                      <p className="truncate text-xs">{s.shippingAddress ?? "-"}</p>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">
                      {Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4">
                      {s.paymentType === "CASH_SALE" ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                          ชำระแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                          COD ฿{Number(s.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SHIPPING_STATUS_BADGE[s.shippingStatus]}`}
                      >
                        {SHIPPING_STATUS_LABEL[s.shippingStatus]}
                      </span>
                      {s.trackingNo && (
                        <p className="text-xs text-gray-500 mt-0.5 font-mono">
                          {SHIPPING_METHOD_LABEL[s.shippingMethod ?? "NONE"]}: {s.trackingNo}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <DeliveryUpdateButton
                        saleId={s.id}
                        currentStatus={s.shippingStatus}
                        currentTrackingNo={s.trackingNo ?? null}
                        currentShippingMethod={s.shippingMethod ?? "NONE"}
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/sales/${s.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700"
                        >
                          <Eye size={14} /> ดู
                        </Link>
                        <a
                          href={`/admin/sales/${s.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                        >
                          <Printer size={14} /> พิมพ์
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DeliveryPage;
