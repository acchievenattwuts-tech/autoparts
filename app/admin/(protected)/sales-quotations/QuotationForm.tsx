"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SearchableSelect from "@/components/shared/SearchableSelect";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import { getThailandDateKey } from "@/lib/th-date";
import { quotationTotals, type QuotationData } from "@/lib/sales-quotation-form";
import { VAT_TYPE_LABELS } from "@/lib/vat";
import { resolveNormalPrice } from "@/lib/pricing/resolve-price";
import { resolveScheduledPrice } from "@/lib/pricing/price-promotion";
import { saveQuotation, searchQuotationProducts } from "./actions";

type Product = Awaited<ReturnType<typeof searchQuotationProducts>>[number];
type Customer = { id: string; name: string; phone: string | null; address: string | null; shippingAddress: string | null; creditTerm: number | null;
  customerType: { priceTier: string; priceList: { id: string; code: string; name: string; isActive: boolean } | null } | null };
const input = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100";
const panel = "rounded-xl border border-gray-200 bg-white p-5 dark:border-white/15 dark:bg-slate-900";
const emptyItem = () => ({ productId: "", unitName: "", qty: 1, salePrice: 0, unitListPrice: 0, moreDetail: "", priceListId: null, pricePromotionId: null });

export default function QuotationForm({ customers, products: initialProducts, initialData, id, revision, defaultVatType, defaultVatRate, locked = false }: {
  customers: Customer[]; products: Product[]; initialData?: QuotationData; id?: string; revision?: number; defaultVatType: QuotationData["vatType"]; defaultVatRate: number; locked?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [references, setReferences] = useState<{ href: string; label: string }[]>([]);
  const [products, setProducts] = useState(initialProducts);
  const [data, setData] = useState<QuotationData>(initialData ?? { quotationDate: getThailandDateKey(new Date()), customerId: "", customerName: "", customerPhone: "", customerAddress: "", creditTerm: 0, discount: 0, note: "", vatType: defaultVatType, vatRate: defaultVatRate, saleType: "RETAIL", items: [emptyItem()] });
  const totals = quotationTotals(data);
  const customer = customers.find((row) => row.id === data.customerId);
  const priceFor = (product: Product, selectedCustomer = customer, date = data.quotationDate) => {
    const list = selectedCustomer?.customerType?.priceList;
    const code = list?.isActive ? list.code : selectedCustomer?.customerType?.priceTier ?? "RETAIL";
    const normalPrice = resolveNormalPrice({ priceListCode: code, configuredAmount: product.priceListPrices[code], legacyPrices: product });
    return { ...resolveScheduledPrice({ saleDateKey: date, normalPrice, promotions: product.pricePromotions.filter((row) => row.priceListCode === code).map((row) => ({ ...row, status: "PUBLISHED" as const })) }), priceListId: list?.isActive ? list.id : null };
  };
  const reprice = (rows: QuotationData["items"], selected: Customer | undefined, date: string) => rows.map((row) => {
    const product = products.find((p) => p.id === row.productId);
    if (!product) return row;
    const price = priceFor(product, selected, date);
    return { ...row, salePrice: price.amount, unitListPrice: price.amount, priceListId: price.priceListId, pricePromotionId: price.promotionId };
  });
  const updateItem = (index: number, values: Partial<QuotationData["items"][number]>) => setData((prev) => ({ ...prev, items: prev.items.map((row, i) => i === index ? { ...row, ...values } : row) }));
  const pickProduct = (index: number, product: Product) => {
    setProducts((prev) => [...prev.filter((p) => p.id !== product.id), product]);
    const price = priceFor(product);
    updateItem(index, { productId: product.id, unitName: product.saleUnitName, salePrice: price.amount, unitListPrice: price.amount, priceListId: price.priceListId, pricePromotionId: price.promotionId });
  };
  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault();
    if (locked || pending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await saveQuotation(data, id, revision);
        if ("error" in result) { setError(result.error ?? "บันทึกไม่สำเร็จ"); setReferences("references" in result ? result.references ?? [] : []); }
        else { router.push(`/admin/sales-quotations/${result.id}?saved=1`); router.refresh(); }
      } catch { setError("บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"); }
    });
  }}>
    <fieldset disabled={pending || locked} className="space-y-5 disabled:opacity-70">
      <div className={`${panel} grid gap-4 md:grid-cols-3`}>
        <label>ลูกค้า<SearchableSelect options={customers.map((c) => ({ id: c.id, label: c.name }))} value={data.customerId} onChange={(value) => {
          const selected = customers.find((c) => c.id === value);
          const changePrices = data.items.some((row) => row.productId) && window.confirm("ปรับราคาตามระดับราคาของลูกค้าที่เลือกหรือไม่?");
          setData((prev) => ({ ...prev, customerId: value, customerName: selected?.name ?? "", customerPhone: selected?.phone ?? "", customerAddress: selected?.shippingAddress?.trim() || selected?.address?.trim() || "", creditTerm: selected?.creditTerm ?? 0, items: changePrices ? reprice(prev.items, selected, prev.quotationDate) : prev.items }));
        }} /></label>
        <label>วันที่<input required type="date" className={input} value={data.quotationDate} onChange={(e) => {
          const date = e.target.value;
          const changePrices = data.items.some((row) => row.productId) && window.confirm("ปรับราคาสินค้าตามวันที่เอกสารใหม่หรือไม่?");
          setData((prev) => ({ ...prev, quotationDate: date, items: changePrices ? reprice(prev.items, customer, date) : prev.items }));
        }} /></label>
        <label>เครดิต (วัน)<AdminNumberInput className={input} value={data.creditTerm} min={0} max={365} onValueChange={(value) => setData({ ...data, creditTerm: value })} /></label>
        <label>ชื่อลูกค้า<input required maxLength={100} className={input} value={data.customerName} onChange={(e) => setData({ ...data, customerName: e.target.value })} /></label>
        <label>เบอร์โทร<input maxLength={20} className={input} value={data.customerPhone} onChange={(e) => setData({ ...data, customerPhone: e.target.value })} /></label>
        <div>ระดับราคา<p className="py-2 font-semibold">{customer?.customerType?.priceList?.name ?? customer?.customerType?.priceTier ?? "ราคาขายปลีก"}</p></div>
        <label className="md:col-span-3">ที่อยู่<textarea maxLength={500} className={input} value={data.customerAddress} onChange={(e) => setData({ ...data, customerAddress: e.target.value })} /></label>
      </div>
      <div className={panel}>
        <div className="mb-4 flex justify-between"><h2 className="font-semibold">รายการสินค้า</h2><button type="button" onClick={() => setData({ ...data, items: [...data.items, emptyItem()] })}>+ เพิ่มสินค้า</button></div>
        <div className="space-y-4">{data.items.map((row, index) => {
          const product = products.find((p) => p.id === row.productId);
          return <div key={index} className="grid gap-3 border-b border-gray-200 pb-4 dark:border-white/15 md:grid-cols-6">
            <div className="md:col-span-3"><ProductSearchSelect products={products} value={row.productId} selectedProduct={product} searchProducts={searchQuotationProducts} onChange={(value) => { if (!value) updateItem(index, { productId: "", unitName: "" }); }} onProductSelect={(p) => pickProduct(index, p)} /></div>
            <label>จำนวน<AdminNumberInput value={row.qty} min={0} className={input} onValueChange={(value) => updateItem(index, { qty: value })} /></label>
            <label>หน่วย<select className={input} value={row.unitName} onChange={(e) => {
              const oldScale = Number(product?.units.find((u) => u.name === row.unitName)?.scale ?? 1);
              const newScale = Number(product?.units.find((u) => u.name === e.target.value)?.scale ?? 1);
              updateItem(index, { unitName: e.target.value, salePrice: Math.round(row.salePrice / oldScale * newScale * 100) / 100, unitListPrice: Math.round(row.unitListPrice / oldScale * newScale * 100) / 100 });
            }}><option value="">เลือกหน่วย</option>{product?.units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}</select></label>
            <button type="button" className="text-red-600 dark:text-red-300" onClick={() => setData({ ...data, items: data.items.filter((_, i) => i !== index) })}>ลบรายการ</button>
            <label>ราคาตั้ง/หน่วย<AdminNumberInput value={row.unitListPrice} min={0} className={input} onValueChange={(value) => updateItem(index, { unitListPrice: value, salePrice: Math.min(row.salePrice, value) })} /></label>
            <label>ส่วนลด/หน่วย<AdminNumberInput value={Math.max(0, row.unitListPrice - row.salePrice)} min={0} max={row.unitListPrice} className={input} onValueChange={(value) => updateItem(index, { salePrice: Math.max(0, row.unitListPrice - value) })} /></label>
            <label>ราคาสุทธิ/หน่วย<AdminNumberInput value={row.salePrice} min={0} className={input} onValueChange={(value) => updateItem(index, { salePrice: value, unitListPrice: Math.max(value, row.unitListPrice) })} /></label>
            <div>ยอดรวม<p className="py-2 font-semibold">{(row.qty * row.salePrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p></div>
            <label className="md:col-span-2">รายละเอียดเพิ่มเติม<input maxLength={500} className={input} value={row.moreDetail} onChange={(e) => updateItem(index, { moreDetail: e.target.value })} /></label>
            {row.productId && row.salePrice === 0 && <p className="text-amber-700 dark:text-amber-300 md:col-span-6">รายการนี้มีราคา 0 บาท</p>}
          </div>;
        })}</div>
      </div>
      <div className={`${panel} grid gap-4 md:grid-cols-3`}>
        <label>ส่วนลดท้ายบิล (บาท)<AdminNumberInput value={data.discount} min={0} className={input} onValueChange={(value) => setData({ ...data, discount: value })} /></label>
        <label>ประเภทภาษี<select className={input} value={data.vatType} onChange={(e) => setData({ ...data, vatType: e.target.value as QuotationData["vatType"] })}>{Object.entries(VAT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>อัตราภาษี (%)<AdminNumberInput value={data.vatRate} min={0} max={100} className={input} onValueChange={(value) => setData({ ...data, vatRate: value })} /></label>
        <label className="md:col-span-2">หมายเหตุ<textarea maxLength={2000} className={input} value={data.note} onChange={(e) => setData({ ...data, note: e.target.value })} /></label>
        <div className="space-y-2 text-right"><p>ก่อนภาษี {totals.subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p><p>ภาษี {totals.vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</p><p className="text-xl font-bold">สุทธิ {totals.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</p></div>
      </div>
      <button disabled={pending || locked} className="rounded-lg bg-orange-600 px-5 py-3 font-semibold text-white disabled:opacity-50">{pending ? "กำลังบันทึก..." : "บันทึกใบเสนอราคา"}</button>
    </fieldset>
    {references.map((ref) => <Link className="underline text-sky-700 dark:text-sky-300" key={ref.href} href={ref.href}>{ref.label}</Link>)}
    {error && <p role="alert" className="text-red-600 dark:text-red-300">{error}</p>}
  </form>;
}
