import { formatQuotationReference } from "@/lib/sales-quotation-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FilePlus2, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { formatDateThai } from "@/lib/th-date";
import QuotationPrintDocument from "@/app/admin/_components/QuotationPrintDocument";
import BrowserPrintButton from "@/components/shared/BrowserPrintButton";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import CancelQuotationButton from "../CancelQuotationButton";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const summaryLabelCls = "mb-1 text-gray-500 dark:text-slate-400";
const summaryValueCls = "font-medium text-gray-900 dark:text-slate-100";
const headerButtonCls = "inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300";

export default async function QuotationDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  await requirePermission("sales_quotations.view");
  const { role, permissions } = await getSessionPermissionContext();
  const { id } = await params;
  const [quote, config, account, search] = await Promise.all([
    db.salesQuotation.findUnique({ where: { id }, include: { activeSale: { select: { id: true, saleNo: true } }, items: { orderBy: { lineNo: "asc" }, include: { product: { select: { code: true, name: true } } } } } }),
    getSiteConfig(), db.cashBankAccount.findFirst({ where: { type: "BANK", isActive: true, isPrimaryTransferAccount: true }, select: { name: true, bankName: true, accountNo: true } }), searchParams,
  ]);
  if (!quote) notFound();
  const events = await getDocumentActivityTimeline("SalesQuotation", id);
  const editable = quote.status === "ACTIVE" && !quote.activeSale;
  const reference = formatQuotationReference(quote.quotationNo, quote.revision);
  return <>
    <style>{`@media print { @page { size: A4; margin: 0; } body * { visibility: hidden; } #quotation-print, #quotation-print * { visibility: visible; } #quotation-print { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; min-height: 270mm; padding: 0; background: white !important; color: black !important; } .no-print { display: none !important; } }`}</style>

    <div className="no-print">
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/sales-quotations"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> ใบเสนอราคา
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{reference}</span>
      </div>

      {search.saved && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-600 dark:border-green-400/30 dark:bg-green-500/10 dark:text-green-400">
          บันทึกสำเร็จ เลขที่ใบเสนอราคา {reference}
        </div>
      )}
      {quote.activeSale && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
          แก้ไขและยกเลิกไม่ได้ เนื่องจากอ้างอิงโดยใบขาย{" "}
          <Link className="font-mono underline" href={`/admin/sales/${quote.activeSale.id}`}>{quote.activeSale.saleNo}</Link>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="mb-5 flex flex-col gap-3 border-b border-gray-100 pb-3 dark:border-white/10 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">สรุปข้อมูลใบเสนอราคา</h1>
            {quote.status === "CANCELLED" ? (
              <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>
            ) : quote.activeSale ? (
              <AdminStatusBadge tone="info">อ้างอิงแล้ว</AdminStatusBadge>
            ) : (
              <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
            )}
          </div>
          <AdminActionGroup align="end">
            {editable && hasPermissionAccess(role, permissions, "sales_quotations.update") && (
              <Link href={`/admin/sales-quotations/${id}/edit`} className={headerButtonCls}>
                <Pencil size={14} /> แก้ไข
              </Link>
            )}
            <BrowserPrintButton label="พิมพ์ / บันทึก PDF" className={headerButtonCls} />
            {editable && hasPermissionAccess(role, permissions, "sales.create") && (
              <Link
                href={`/admin/sales/new?quotationId=${id}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-900 dark:bg-sky-700 dark:hover:bg-sky-600"
              >
                <FilePlus2 size={14} /> นำไปบันทึกขาย
              </Link>
            )}
            {quote.status === "ACTIVE" && hasPermissionAccess(role, permissions, "sales_quotations.cancel") && <CancelQuotationButton id={id} disabled={!editable} />}
          </AdminActionGroup>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div>
            <p className={summaryLabelCls}>เลขที่ใบเสนอราคา</p>
            <p className="font-mono font-semibold text-[#1e3a5f] dark:text-sky-300">{reference}</p>
          </div>
          <div>
            <p className={summaryLabelCls}>วันที่</p>
            <p className={summaryValueCls}>{formatDateThai(quote.quotationDate)}</p>
          </div>
          <div>
            <p className={summaryLabelCls}>ลูกค้า</p>
            <p className={summaryValueCls}>{quote.customerName}</p>
          </div>
          <div>
            <p className={summaryLabelCls}>เบอร์โทร</p>
            <p className={summaryValueCls}>{quote.customerPhone || "-"}</p>
          </div>
          <div>
            <p className={summaryLabelCls}>ประเภทการขาย</p>
            <AdminStatusBadge tone={quote.saleType === "WHOLESALE" ? "info" : "success"}>
              {quote.saleType === "WHOLESALE" ? "ขายส่ง" : "ขายปลีก"}
            </AdminStatusBadge>
          </div>
          <div>
            <p className={summaryLabelCls}>เครดิต (วัน)</p>
            <p className={summaryValueCls}>{quote.creditTerm}</p>
          </div>
          <div>
            <p className={summaryLabelCls}>ยอดสุทธิ</p>
            <p className="font-semibold text-[#1e3a5f] dark:text-sky-300">{Number(quote.netAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p>
          </div>
          {quote.customerAddress && (
            <div className="col-span-2 md:col-span-3">
              <p className={summaryLabelCls}>ที่อยู่</p>
              <p className={`${summaryValueCls} whitespace-pre-line`}>{quote.customerAddress}</p>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* ประวัติเอกสาร (30%) คู่กับ preview ใบพิมพ์ (70%) บนจอกว้าง — เลย์เอาต์เดียวกับหน้าใบขาย
        ห้ามใส่ `relative` — print stylesheet วาง #quotation-print แบบ absolute */}
    <div className="mb-6 grid items-start gap-6 xl:grid-cols-[30fr_70fr]">
      <div className="no-print xl:sticky xl:top-4">
        <DocumentActivityTimeline events={events} variant="compact" className="mb-0" />
      </div>

      <div className="min-w-0">
        <QuotationPrintDocument quote={quote} config={config} account={account} />
      </div>
    </div>
  </>;
}
