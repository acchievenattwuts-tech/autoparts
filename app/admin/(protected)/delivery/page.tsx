export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { SHIPPING_STATUS_LABEL, SHIPPING_STATUS_BADGE, SHIPPING_METHOD_LABEL, getShippingTrackingUrl } from "@/lib/shipping";
import NavLink from "@/components/shared/NavLink";
import { ExternalLink, Eye, Smartphone } from "lucide-react";
import DeliveryUpdateButton from "./DeliveryUpdateButton";
import {
  DeliveryPrintActions,
  DeliveryRowCheckbox,
  DeliverySelectAllCheckbox,
  DeliverySelectionProvider,
  type DeliveryRow,
} from "./DeliverySelection";
import PrintFromListButton from "@/components/shared/PrintFromListButton";
import { isManualMarketplaceChannel } from "@/lib/marketplace/config";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import type { SelectOption } from "@/components/shared/SearchableSelect";
import { appendDeliveryDateParams, resolveDeliveryDateRange } from "@/lib/delivery-date-filter";
import { formatDateThai } from "@/lib/th-date";

const getDeliveryStaffLabel = ({
  shippingStatus,
  deliveryStaffName,
}: {
  shippingStatus: "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED";
  deliveryStaffName?: string | null;
}) => {
  if (deliveryStaffName) {
    return {
      label: deliveryStaffName,
      className: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-900/60",
    };
  }

  if (shippingStatus === "DELIVERED") {
    return {
      label: "ยังไม่ได้บันทึกผู้ส่ง",
      className: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60",
    };
  }

  return {
    label: "บันทึกอัตโนมัติ",
    className: "bg-gray-50 text-gray-600 ring-gray-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-white/10",
  };
};

const DeliveryPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string }>;
}) => {
  await requirePermission("delivery.view");
  const { status, from, to } = await searchParams;
  const statusFilter =
    status && ["PENDING", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status)
      ? status
      : undefined;

  const { fromKey, toKey, saleDateFilter, isDefaultFrom } = resolveDeliveryDateRange({
    status: statusFilter,
    from,
    to,
  });
  // A defaulted `ตั้งแต่` must not follow the user into the other tabs.
  const linkFromKey = isDefaultFrom ? "" : fromKey;

  const [sales, staffUsers] = await Promise.all([
    db.sale.findMany({
      where: {
        fulfillmentType: "DELIVERY",
        status: "ACTIVE",
        ...(statusFilter
          ? { shippingStatus: statusFilter as "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED" }
          : { shippingStatus: { in: ["PENDING", "OUT_FOR_DELIVERY"] } }),
        ...(saleDateFilter ? { saleDate: saleDateFilter } : {}),
      },
      orderBy: [{ saleDate: "desc" }, { saleNo: "desc" }],
      take: 100,
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        channel: true,
        customerName: true,
        shippingAddress: true,
        shippingStatus: true,
        shippingMethod: true,
        trackingNo: true,
        netAmount: true,
        paymentType: true,
        amountRemain: true,
        deliveryStaffId: true,
        _count: { select: { deliveryProofs: true } },
        customer: { select: { name: true, phone: true } },
        deliveryStaff: { select: { name: true } },
        shopeeOrderImport: { select: { id: true, orderSn: true } },
      },
    }),
    db.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const staffOptions: SelectOption[] = staffUsers.map((user) => ({
    id: user.id,
    label: user.name,
    sublabel: user.email,
  }));

  const buildTabHref = (value: string | undefined) => {
    const params = new URLSearchParams();
    if (value) params.set("status", value);
    appendDeliveryDateParams(params, { fromKey: linkFromKey, toKey });
    const query = params.toString();
    return query ? `/admin/delivery?${query}` : "/admin/delivery";
  };

  const mobileViewHref = (() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    appendDeliveryDateParams(params, { fromKey: linkFromKey, toKey });
    const query = params.toString();
    return query ? `/admin/delivery/update?${query}` : "/admin/delivery/update";
  })();

  const tabs = [
    { label: "รอจัดส่ง + กำลังส่ง", value: undefined },
    { label: "รอจัดส่ง",             value: "PENDING" },
    { label: "กำลังส่ง",             value: "OUT_FOR_DELIVERY" },
    { label: "ส่งแล้ว",              value: "DELIVERED" },
  ];

  // ใบขาย Shopee / Lazada ติ๊กพิมพ์ใบส่งของได้ตามปกติ แต่ไม่นับเป็นใบปะหน้ากล่อง
  // เพราะแพลตฟอร์มออกใบให้เอง และที่อยู่บนบิลมักยังเป็นข้อความตั้งต้นของช่องทาง
  const selectionRows: DeliveryRow[] = sales.map((s) => ({
    id: s.id,
    canPrintLabel: !isManualMarketplaceChannel(s.channel),
  }));

  return (
    <DeliverySelectionProvider rows={selectionRows}>
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">คิวจัดส่ง</h1>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-gray-500 dark:text-slate-400">{sales.length} รายการ</span>
          <NavLink
            href={mobileViewHref}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 transition-colors"
          >
            <Smartphone size={14} /> มุมมองมือถือ
          </NavLink>
          <DeliveryPrintActions />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((tab) => (
          <NavLink
            key={tab.label}
            href={buildTabHref(tab.value)}
            className={`relative inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-[#1e3a5f] text-white dark:bg-sky-700"
                : "bg-white border border-gray-200 text-gray-600 hover:border-[#1e3a5f] dark:bg-white/5 dark:border-white/15 dark:text-slate-300 dark:hover:border-sky-400"
            }`}
            hideSpinner
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* Date range filter (saleDate) */}
      <AdminSearchForm
        method="GET"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-[#101b2e]"
      >
        {statusFilter ? <input type="hidden" name="status" value={statusFilter} /> : null}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">
            ตั้งแต่วันที่
          </label>
          <input
            type="date"
            name="from"
            defaultValue={fromKey}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-white/15 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-slate-400">
            ถึงวันที่
          </label>
          <input
            type="date"
            name="to"
            defaultValue={toKey}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 dark:border-white/15 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <AdminSearchSubmitButton className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600">
          ค้นหา
        </AdminSearchSubmitButton>
      </AdminSearchForm>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden dark:border-white/10 dark:bg-[#101b2e]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1808px] table-fixed text-sm">
            <colgroup>
              <col className="w-[48px]" />
              <col className="w-[150px]" />
              <col className="w-[120px]" />
              <col className="w-[260px]" />
              <col className="w-[390px]" />
              <col className="w-[130px]" />
              <col className="w-[150px]" />
              <col className="w-[170px]" />
              <col className="w-[170px]" />
              <col className="w-[300px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="py-3 pl-4 pr-0 text-left">
                  <DeliverySelectAllCheckbox />
                </th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">เลขที่ใบขาย</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">วันที่</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">ลูกค้า</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">ที่อยู่จัดส่ง</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600 dark:text-slate-300">ยอดสุทธิ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">ชำระ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">ผู้ส่ง</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-slate-300">อัปเดต</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-gray-400 dark:text-slate-500">
                    ไม่มีรายการจัดส่ง
                  </td>
                </tr>
              ) : (
                sales.map((s) => (
                  <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50 dark:border-white/5 dark:hover:bg-white/5">
                    {(() => {
                      const deliveryStaffLabel = getDeliveryStaffLabel({
                        shippingStatus: s.shippingStatus,
                        deliveryStaffName: s.deliveryStaff?.name ?? null,
                      });
                      const trackingHref = s.trackingNo
                        ? getShippingTrackingUrl(s.shippingMethod ?? "NONE", s.trackingNo)
                        : null;

                      return (
                        <>
                    <td className="py-3 pl-4 pr-0 align-top">
                      <DeliveryRowCheckbox id={s.id} saleNo={s.saleNo} />
                    </td>
                    <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium dark:text-sky-300">{s.saleNo}</td>
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap dark:text-slate-300">
                      {formatDateThai(s.saleDate)}
                    </td>
                    <td className="py-3 px-4 align-top">
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {s.customer?.name ?? s.customerName ?? "-"}
                      </p>
                      {s.customer?.phone && (
                        <p className="text-xs text-gray-400 dark:text-slate-500">{s.customer.phone}</p>
                      )}
                    </td>
                    <td className="py-3 px-4 align-top text-gray-600 dark:text-slate-300">
                      <p className="whitespace-normal break-words text-xs leading-relaxed">{s.shippingAddress ?? "-"}</p>
                    </td>
                    <td className="py-3 px-4 align-top text-right font-medium text-gray-900 dark:text-slate-100">
                      {Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 align-top">
                      {s.paymentType === "CASH_SALE" ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                          ชำระแล้ว
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-amber-500/20 dark:text-amber-300">
                          COD ฿{Number(s.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 align-top">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SHIPPING_STATUS_BADGE[s.shippingStatus]}`}
                      >
                        {SHIPPING_STATUS_LABEL[s.shippingStatus]}
                      </span>
                      {s.trackingNo && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400">
                          <span className="font-mono">
                            {SHIPPING_METHOD_LABEL[s.shippingMethod ?? "NONE"]}: {s.trackingNo}
                          </span>
                          {trackingHref ? (
                            <a
                              href={trackingHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-400/10 dark:text-blue-200 dark:hover:bg-blue-400/20"
                            >
                              ติดตาม
                              <ExternalLink size={11} />
                            </a>
                          ) : null}
                        </div>
                      )}
                      {s.shopeeOrderImport ? (
                        <NavLink
                          href={`/admin/marketplace/shopee/orders/${s.shopeeOrderImport.id}`}
                          className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700 hover:bg-orange-100 dark:bg-orange-400/10 dark:text-orange-200 dark:hover:bg-orange-400/20"
                          hideSpinner
                        >
                          Shopee {s.shopeeOrderImport.orderSn}
                          <ExternalLink size={11} />
                        </NavLink>
                      ) : null}
                      {s._count.deliveryProofs > 0 ? (
                        <p className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                          มีหลักฐาน {s._count.deliveryProofs.toLocaleString("th-TH")} รายการ
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 px-4 align-top">
                      <span className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${deliveryStaffLabel.className}`}>
                        <span className="truncate">{deliveryStaffLabel.label}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4 align-top">
                      <DeliveryUpdateButton
                        saleId={s.id}
                        saleNo={s.saleNo}
                        currentStatus={s.shippingStatus}
                        currentTrackingNo={s.trackingNo ?? null}
                        currentShippingMethod={s.shippingMethod ?? "NONE"}
                        currentDeliveryStaffId={s.deliveryStaffId ?? null}
                        staffOptions={staffOptions}
                      />
                    </td>
                    <td className="py-3 px-4 align-top">
                      <div className="flex items-center gap-2">
                        <NavLink
                          href={`/admin/sales/${s.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200"
                          hideSpinner
                        >
                          <Eye size={14} /> ดู
                        </NavLink>
                        <PrintFromListButton href={`/admin/sales/${s.id}`} />
                      </div>
                    </td>
                        </>
                      );
                    })()}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </DeliverySelectionProvider>
  );
};

export default DeliveryPage;
