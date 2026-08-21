export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft, Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { SaleType, PaymentMethod, PaymentSlipVerificationStatus, SalePaymentType } from "@/lib/generated/prisma";
import { hasPermissionAccess } from "@/lib/access-control";
import { listPaymentSlipsByCustomer } from "@/lib/line-payment-slip-repository";
import { paymentSlipStatusLabel } from "@/lib/line-payment-slip-display";
import { requirePermission } from "@/lib/require-auth";
import { isLineCustomerProfileIncomplete } from "@/lib/line-customer-profile";
import { formatDateThai } from "@/lib/th-date";
import type { PriceTier } from "@/lib/generated/prisma";

/** ระดับราคาที่ลูกค้ารายนี้เห็นในแชท LINE/Messenger (ตามประเภทลูกค้าที่ผูกไว้) */
const PRICE_TIER_LABEL: Record<PriceTier, string> = {
  WHOLESALE: "ราคาขายส่ง",
  MEMBER: "ราคาสมาชิก",
  RETAIL: "ราคาขายปลีก",
};

const PRICE_TIER_TONE: Record<PriceTier, "success" | "info" | "muted"> = {
  WHOLESALE: "success",
  MEMBER: "info",
  RETAIL: "muted",
};
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatCard from "@/components/shared/AdminStatCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";

const slipStatusTone: Record<
  PaymentSlipVerificationStatus,
  "success" | "info" | "warning" | "danger" | "neutral"
> = {
  PENDING_REVIEW: "warning",
  MATCHED_PENDING_ADMIN_CONFIRM: "info",
  CONFIRMED_BY_ADMIN: "success",
  REJECTED: "danger",
  NEEDS_MORE_INFO: "neutral",
};

const saleTypeLabel: Record<SaleType, string> = {
  RETAIL:    "ปลีก",
  WHOLESALE: "ส่ง",
};

const saleTypeTone: Record<SaleType, "success" | "info"> = {
  RETAIL:    "success",
  WHOLESALE: "info",
};

const paymentMethodLabel: Record<PaymentMethod, string> = {
  CASH:     "เงินสด",
  TRANSFER: "โอนเงิน",
  CREDIT:   "เครดิต",
};

type SaleStatus = "UNPAID" | "PARTIAL" | "PAID";

const statusLabel: Record<SaleStatus, string> = {
  UNPAID:  "ยังไม่ชำระ",
  PARTIAL: "ชำระบางส่วน",
  PAID:    "ชำระครบ",
};

const statusTone: Record<SaleStatus, "danger" | "warning" | "success"> = {
  UNPAID:  "danger",
  PARTIAL: "warning",
  PAID:    "success",
};

const CustomerDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await requirePermission("customers.view");

  const { id } = await params;

  // Payment slips are PII — only show them to admins who can view LINE slips.
  const canViewSlips = hasPermissionAccess(
    session.user.role,
    session.user.permissions,
    "line_payment_slips.view",
  );

  const [customer, creditSales, receipts, customerAdvances, paymentSlips] = await Promise.all([
    db.customer.findUnique({
      where: { id },
      include: {
        customerType: { select: { name: true, priceTier: true } },
        sales: {
          orderBy: { saleDate: "desc" },
          take: 50,
          select: {
            id:            true,
            saleNo:        true,
            saleDate:      true,
            netAmount:     true,
            saleType:      true,
            paymentType:   true,
            paymentMethod: true,
            _count: { select: { items: true } },
          },
        },
      },
    }),

    db.sale.findMany({
      where: { customerId: id, paymentType: SalePaymentType.CREDIT_SALE },
      select: {
        id:        true,
        saleNo:    true,
        saleDate:  true,
        netAmount: true,
        amountRemain: true,
        receipts:  { select: { paidAmount: true } },
      },
      orderBy: { saleDate: "desc" },
    }),

    db.receipt.findMany({
      where: { customerId: id },
      select: {
        receiptNo:     true,
        receiptDate:   true,
        totalAmount:   true,
        paymentMethod: true,
      },
      orderBy: { receiptDate: "desc" },
      take: 20,
    }),

    db.customerAdvance.findMany({
      where: { customerId: id },
      select: {
        id: true,
        advanceNo: true,
        advanceDate: true,
        totalAmount: true,
        amountRemain: true,
        status: true,
      },
      orderBy: [{ advanceDate: "desc" }, { advanceNo: "desc" }],
      take: 20,
    }),

    canViewSlips ? listPaymentSlipsByCustomer(id) : Promise.resolve([]),
  ]);

  if (!customer) notFound();

  // AR balance calculation
  const arBalance = creditSales.reduce((sum, sale) => sum + Number(sale.amountRemain), 0);
  const customerAdvanceRemain = customerAdvances
    .filter((advance) => advance.status === "ACTIVE")
    .reduce((sum, advance) => sum + Number(advance.amountRemain), 0);

  // Per-sale status
  const salesWithStatus = creditSales.map((s) => {
    const paid        = s.receipts.reduce((sum, r) => sum + Number(r.paidAmount), 0);
    const outstanding = Math.max(0, Number(s.netAmount) - paid);
    const status: SaleStatus =
      paid === 0 ? "UNPAID" : outstanding <= 0 ? "PAID" : "PARTIAL";
    return { ...s, paid, outstanding, status };
  });

  const totalSpent = customer.sales.reduce((sum, s) => sum + Number(s.netAmount), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <NavLink
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รายการลูกค้า
        </NavLink>
      </div>

      <AdminPageHeader
        title={customer.name}
        description={`รหัสลูกค้า: ${customer.code ?? "-"}`}
        meta={
          <div className="flex flex-wrap gap-2">
              {customer.source === "LINE_LIFF" ? (
              <AdminStatusBadge tone="info">สมัครผ่าน LINE</AdminStatusBadge>
              ) : null}
              {customer.lineUserId ? (
              <AdminStatusBadge tone="success">ผูก LINE แล้ว</AdminStatusBadge>
              ) : null}
              {isLineCustomerProfileIncomplete(customer) ? (
              <AdminStatusBadge tone="warning">ข้อมูลยังไม่ครบ</AdminStatusBadge>
              ) : null}
            </div>
        }
        actions={
          <NavLink
            href={`/admin/customers/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#162d4a]"
          >
            <Pencil size={12} /> แก้ไข
          </NavLink>
        }
      />

      <AdminSectionCard title="ข้อมูลลูกค้า">
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 md:grid-cols-3">
          <div>
            <p className="mb-1 text-gray-500 dark:text-slate-400">รหัสลูกค้า</p>
            <p className="font-mono font-medium text-gray-900 dark:text-slate-100">{customer.code ?? "-"}</p>
          </div>
          <div>
            <p className="mb-1 text-gray-500 dark:text-slate-400">เบอร์โทร</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{customer.phone ?? "-"}</p>
          </div>
          <div>
            <p className="mb-1 text-gray-500 dark:text-slate-400">เลขผู้เสียภาษี</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">{customer.taxId ?? "-"}</p>
          </div>
          <div>
            <p className="mb-1 text-gray-500 dark:text-slate-400">ประเภทลูกค้า</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {customer.customerType ? (
                <span className="inline-flex items-center gap-1.5">
                  {customer.customerType.name}
                  <AdminStatusBadge tone={PRICE_TIER_TONE[customer.customerType.priceTier]}>
                    {PRICE_TIER_LABEL[customer.customerType.priceTier]}
                  </AdminStatusBadge>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  ลูกค้าทั่วไป
                  <AdminStatusBadge tone="muted">ยังไม่ผูกกลุ่มราคา</AdminStatusBadge>
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="mb-1 text-gray-500 dark:text-slate-400">แหล่งที่มา</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {customer.source === "LINE_LIFF" ? "สมัครผ่าน LINE" : "พนักงานเพิ่มในระบบ"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-gray-500 dark:text-slate-400">วันที่ผูก LINE</p>
            <p className="font-medium text-gray-900 dark:text-slate-100">
              {customer.lineLinkedAt ? formatDateThai(customer.lineLinkedAt) : "-"}
            </p>
          </div>
          {customer.lineUserId ? (
            <div className="sm:col-span-2 md:col-span-3">
              <p className="mb-1 text-gray-500 dark:text-slate-400">LINE userId</p>
              <p className="break-all font-mono text-xs font-semibold text-gray-900 dark:text-slate-100">
                {customer.lineUserId}
              </p>
            </div>
          ) : null}
          {customer.address && (
            <div className="sm:col-span-2 md:col-span-3">
              <p className="mb-1 text-gray-500 dark:text-slate-400">ที่อยู่</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{customer.address}</p>
            </div>
          )}
          {customer.shippingAddress && (
            <div className="sm:col-span-2 md:col-span-3">
              <p className="mb-1 text-gray-500 dark:text-slate-400">ที่อยู่จัดส่ง</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{customer.shippingAddress}</p>
            </div>
          )}
          {customer.note && (
            <div className="sm:col-span-2 md:col-span-3">
              <p className="mb-1 text-gray-500 dark:text-slate-400">หมายเหตุ</p>
              <p className="font-medium text-gray-900 dark:text-slate-100">{customer.note}</p>
            </div>
          )}
        </div>
      </AdminSectionCard>

      {arBalance > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-400/20 dark:bg-orange-400/10">
          <p className="text-sm font-medium text-orange-600 dark:text-orange-200">ยอดค้างชำระ (AR)</p>
          <p className="text-2xl font-bold text-orange-700 dark:text-orange-100">
            {arBalance.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AdminStatCard
          label="ยอดซื้อทั้งหมด"
          value={totalSpent.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
          hint="บาท"
        />
        <AdminStatCard
          label="จำนวนครั้งที่ซื้อ"
          value={customer.sales.length}
          hint="ครั้ง"
        />
        <AdminStatCard
          label="เงินมัดจำคงเหลือ"
          value={customerAdvanceRemain.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
          hint="บาท"
        />
      </div>

      {salesWithStatus.length > 0 && (
        <AdminTableSection title="รายการขายเชื่อ">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขที่ใบขาย</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดรวม</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ชำระแล้ว</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ค้างชำระ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {salesWithStatus.map((s) => (
                  <tr key={s.id} className="border-t border-gray-50 transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                    <td className="px-4 py-3 font-mono">
                      <NavLink href={`/admin/sales/${s.id}`} className="font-medium text-[#1e3a5f] hover:underline dark:text-sky-300" hideSpinner>
                        {s.saleNo}
                      </NavLink>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {formatDateThai(s.saleDate)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-800 dark:text-slate-100">
                      {Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-slate-300">
                      {s.paid.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-orange-600 dark:text-orange-300">
                      {s.outstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3">
                      <AdminStatusBadge tone={statusTone[s.status]}>{statusLabel[s.status]}</AdminStatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </AdminTableSection>
      )}

      {receipts.length > 0 && (
        <AdminTableSection title="ประวัติใบเสร็จรับเงิน">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขที่ใบเสร็จ</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ช่องทาง</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดรับชำระ</th>
                </tr>
              </thead>
              <tbody>
                {receipts.slice(0, 10).map((r) => (
                  <tr key={r.receiptNo} className="border-t border-gray-50 transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{r.receiptNo}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {formatDateThai(r.receiptDate)}
                    </td>
                    <td className="px-4 py-3">
                      <AdminStatusBadge tone="neutral">{paymentMethodLabel[r.paymentMethod]}</AdminStatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">
                      {Number(r.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </AdminTableSection>
      )}

      {customerAdvances.length > 0 && (
        <AdminTableSection title="ประวัติรับเงินมัดจำลูกค้า">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขที่มัดจำ</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดมัดจำ</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">คงเหลือ</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {customerAdvances.map((advance) => (
                <tr key={advance.id} className="border-t border-gray-50 transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                  <td className="px-4 py-3 font-mono">
                    <NavLink href={`/admin/customer-advances/${advance.id}`} className="font-medium text-[#1e3a5f] hover:underline dark:text-sky-300" hideSpinner>
                      {advance.advanceNo}
                    </NavLink>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDateThai(advance.advanceDate)}</td>
                  <td className="px-4 py-3 text-right text-gray-900 dark:text-slate-100">{Number(advance.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right font-medium text-amber-700 dark:text-amber-300">{Number(advance.amountRemain).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-center">
                    <AdminStatusBadge tone={advance.status === "ACTIVE" ? "success" : "danger"}>{advance.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}</AdminStatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableSection>
      )}

      {canViewSlips && paymentSlips.length > 0 && (
        <AdminTableSection title="ประวัติสลิปโอนเงิน (LINE)">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่โอน</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จำนวนเงิน</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ธนาคาร / ผู้โอน</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขอ้างอิง</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {paymentSlips.map((slip) => (
                <tr key={slip.id} className="border-t border-gray-50 transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                    {formatDateThai(slip.detectedTransferDatetime ?? slip.createdAt)}
                    {slip.detectedTransferDatetime ? "" : " *"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">
                    {slip.detectedAmount !== null
                      ? Number(slip.detectedAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                    {slip.detectedBank ?? "-"}
                    {slip.detectedSenderName ? ` · ${slip.detectedSenderName}` : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-slate-400">
                    {slip.detectedReferenceNo ?? "-"}
                  </td>
                  <td className="px-4 py-3">
                    <AdminStatusBadge tone={slipStatusTone[slip.verificationStatus]}>
                      {paymentSlipStatusLabel[slip.verificationStatus]}
                    </AdminStatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <NavLink
                      href={`/admin/line-payment-slips/${slip.id}`}
                      className="text-xs text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200"
                      hideSpinner
                    >
                      ดูสลิป
                    </NavLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableSection>
      )}

      <AdminTableSection title="ประวัติการซื้อ">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขที่</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ประเภท</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดสุทธิ</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ช่องทางชำระ</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">รายการ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {customer.sales.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-400 dark:text-slate-500">
                    ยังไม่มีประวัติการซื้อ
                  </td>
                </tr>
              ) : (
                customer.sales.map((s) => (
                  <tr key={s.id} className="border-t border-gray-50 transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5">
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{s.saleNo}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {formatDateThai(s.saleDate)}
                    </td>
                    <td className="px-4 py-3">
                      <AdminStatusBadge tone={saleTypeTone[s.saleType]}>{saleTypeLabel[s.saleType]}</AdminStatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">
                      {Number(s.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {s.paymentType === SalePaymentType.CREDIT_SALE
                        ? <AdminStatusBadge tone="warning">เชื่อ</AdminStatusBadge>
                        : s.paymentMethod
                          ? (paymentMethodLabel[s.paymentMethod] ?? s.paymentMethod)
                          : "-"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-slate-300">{s._count.items} รายการ</td>
                    <td className="px-4 py-3">
                      <NavLink
                        href={`/admin/sales/${s.id}`}
                        className="text-xs text-[#1e3a5f] transition-colors hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200"
                        hideSpinner
                      >
                        ดูใบเสร็จ
                      </NavLink>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </AdminTableSection>
    </div>
  );
};

export default CustomerDetailPage;
