import { formatQuotationReference } from "@/lib/sales-quotation-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import QuotationPrintDocument from "@/app/admin/_components/QuotationPrintDocument";
import BrowserPrintButton from "@/components/shared/BrowserPrintButton";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import CancelQuotationButton from "../CancelQuotationButton";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
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
  return <div className="space-y-5">
    <style>{`@media print { @page { size: A4; margin: 10mm; } body * { visibility: hidden; } #quotation-print, #quotation-print * { visibility: visible; } #quotation-print { position: absolute; inset: 0 auto auto 0; width: 100%; max-width: none; min-height: 270mm; padding: 0; background: white !important; color: black !important; } .no-print { display: none !important; } }`}</style>
    <div className="no-print flex flex-wrap items-center gap-4 text-gray-900 dark:text-slate-100"><Link href="/admin/sales-quotations">← ใบเสนอราคา</Link><h1 className="text-xl font-bold">{formatQuotationReference(quote.quotationNo, quote.revision)}</h1><BrowserPrintButton />
      {editable && hasPermissionAccess(role, permissions, "sales_quotations.update") && <Link href={`/admin/sales-quotations/${id}/edit`}>แก้ไข</Link>}
      {editable && hasPermissionAccess(role, permissions, "sales.create") && <Link href={`/admin/sales/new?quotationId=${id}`}>นำไปบันทึกขาย</Link>}
      {quote.status === "ACTIVE" && hasPermissionAccess(role, permissions, "sales_quotations.cancel") && <CancelQuotationButton id={id} disabled={!editable} />}
    </div>
    {search.saved && <p className="no-print text-green-700 dark:text-green-300">บันทึกสำเร็จ เลขที่ใบเสนอราคา {formatQuotationReference(quote.quotationNo, quote.revision)}</p>}
    {quote.activeSale && <p className="no-print text-amber-700 dark:text-amber-300">แก้ไขและยกเลิกไม่ได้ เนื่องจากอ้างอิงโดยใบขาย <Link className="underline" href={`/admin/sales/${quote.activeSale.id}`}>{quote.activeSale.saleNo}</Link></p>}
    <QuotationPrintDocument quote={quote} config={config} account={account} />
    <div className="no-print"><DocumentActivityTimeline events={events} /></div>
  </div>;
}
