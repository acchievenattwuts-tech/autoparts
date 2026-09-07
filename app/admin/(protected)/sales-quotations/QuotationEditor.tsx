import { quotationProductOption } from "@/lib/quotation-product";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { getTransactionProductDetailRowsByIds } from "@/lib/transaction-product-search";
import { quotationToFormData } from "@/lib/sales-quotation-data";
import { formatQuotationReference } from "@/lib/sales-quotation-form";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { checkDocumentMutation, buildMutationBlockMessage, buildMutationBlockReferenceLinks } from "@/lib/document-mutation-guard";
import DocumentMutationBlockedNotice from "@/components/shared/DocumentMutationBlockedNotice";
import QuotationForm from "./QuotationForm";
import type { QuotationData } from "@/lib/sales-quotation-form";

export default async function QuotationEditor({ id }: { id?: string }) {
  const [quote, customers, config] = await Promise.all([
    id ? db.salesQuotation.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: "asc" } } } }) : null,
    db.customer.findMany({ where: { OR: [{ isActive: true }, ...(id ? [{ quotations: { some: { id } } }] : [])] }, orderBy: { name: "asc" }, select: {
      id: true, name: true, address: true, shippingAddress: true, phone: true, creditTerm: true,
      customerType: { select: { priceTier: true, priceList: { select: { id: true, code: true, name: true, isActive: true } } } },
    } }),
    getSiteConfig(),
  ]);
  if (id && !quote) notFound();
  const block = id ? await checkDocumentMutation("SalesQuotation", id, "update") : null;
  const products = quote ? await getTransactionProductDetailRowsByIds(quote.items.map((row) => row.productId)) : [];
  const data = quote ? quotationToFormData(quote) : undefined;
  const reference = quote ? formatQuotationReference(quote.quotationNo, quote.revision) : "";
  return <div>
    <div className="flex items-center gap-2 mb-6">
      <Link
        href={quote ? `/admin/sales-quotations/${id}` : "/admin/sales-quotations"}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300"
      >
        <ChevronLeft size={16} /> {quote ? reference : "ใบเสนอราคาทั้งหมด"}
      </Link>
      <span className="text-gray-300 dark:text-slate-600">/</span>
      <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{quote ? "แก้ไข" : "เพิ่มใบเสนอราคาใหม่"}</span>
    </div>
    <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">{quote ? `แก้ไขใบเสนอราคา ${reference}` : "เพิ่มใบเสนอราคา"}</h1>
    {block?.blocked && <div className="mb-6"><DocumentMutationBlockedNotice message={buildMutationBlockMessage(block)!} references={buildMutationBlockReferenceLinks(block)} /></div>}
    {quote?.status === "CANCELLED" && (
      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
        เอกสารถูกยกเลิกแล้ว
      </div>
    )}
    <QuotationForm id={id} revision={quote?.revision} customers={customers} products={products.map(quotationProductOption)} initialData={data} defaultVatType={config.vatType as QuotationData["vatType"]} defaultVatRate={config.vatRate} locked={block?.blocked || quote?.status === "CANCELLED"} />
  </div>;
}
