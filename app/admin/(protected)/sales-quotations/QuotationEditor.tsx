import { quotationProductOption } from "@/lib/quotation-product";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { getTransactionProductDetailRowsByIds } from "@/lib/transaction-product-search";
import { quotationToFormData } from "@/lib/sales-quotation-data";
import { formatQuotationReference } from "@/lib/sales-quotation-form";
import { notFound } from "next/navigation";
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
  return <div className="space-y-5 text-gray-900 dark:text-slate-100">
    <h1 className="text-2xl font-bold">{quote ? `แก้ไขใบเสนอราคา ${formatQuotationReference(quote.quotationNo, quote.revision)}` : "เพิ่มใบเสนอราคา"}</h1>
    {block?.blocked && <DocumentMutationBlockedNotice message={buildMutationBlockMessage(block)!} references={buildMutationBlockReferenceLinks(block)} />}
    {quote?.status === "CANCELLED" && <p>เอกสารถูกยกเลิกแล้ว</p>}
    <QuotationForm id={id} revision={quote?.revision} customers={customers} products={products.map(quotationProductOption)} initialData={data} defaultVatType={config.vatType as QuotationData["vatType"]} defaultVatRate={config.vatRate} locked={block?.blocked || quote?.status === "CANCELLED"} />
  </div>;
}
