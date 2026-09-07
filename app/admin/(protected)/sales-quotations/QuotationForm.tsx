"use client";
import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
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

/** Presentation tokens mirrored from app/admin/(protected)/sales/new/SaleForm.tsx — keep both forms in sync. */
const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";
const cardCls = "bg-white rounded-xl shadow-sm border border-gray-100 p-6 dark:border-white/10 dark:bg-[#101b2e]";
const sectionTitleCls = "font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-300";
const thCls = "text-left py-2 px-2 text-gray-500 font-medium dark:text-slate-400";
const thHintCls = "block text-xs font-normal text-gray-400 dark:text-slate-500";
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
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
  const grossBeforeLineDiscount = round2(data.items.reduce((sum, row) => sum + row.qty * row.unitListPrice, 0));
  const totalLineDiscount = round2(grossBeforeLineDiscount - totals.totalAmount);
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
  return <form className="space-y-6" onSubmit={(event) => {
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
    <fieldset disabled={pending || locked} className="space-y-6 disabled:opacity-70">
      {/* Header card */}
      <div className={cardCls}>
        <h2 className={`${sectionTitleCls} mb-5 pb-3 border-b border-gray-100 dark:border-white/10`}>ข้อมูลใบเสนอราคา</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>วันที่ <span className="text-red-500">*</span></label>
            <input required type="date" className={inputCls} value={data.quotationDate} onChange={(e) => {
              const date = e.target.value;
              const changePrices = data.items.some((row) => row.productId) && window.confirm("ปรับราคาสินค้าตามวันที่เอกสารใหม่หรือไม่?");
              setData((prev) => ({ ...prev, quotationDate: date, items: changePrices ? reprice(prev.items, customer, date) : prev.items }));
            }} />
          </div>
          <div>
            <label className={labelCls}>ลูกค้า <span className="text-red-500">*</span></label>
            <SearchableSelect options={customers.map((c) => ({ id: c.id, label: c.name }))} value={data.customerId} placeholder="โปรดระบุลูกค้า" onChange={(value) => {
              const selected = customers.find((c) => c.id === value);
              const changePrices = data.items.some((row) => row.productId) && window.confirm("ปรับราคาตามระดับราคาของลูกค้าที่เลือกหรือไม่?");
              setData((prev) => ({ ...prev, customerId: value, customerName: selected?.name ?? "", customerPhone: selected?.phone ?? "", customerAddress: selected?.shippingAddress?.trim() || selected?.address?.trim() || "", creditTerm: selected?.creditTerm ?? 0, items: changePrices ? reprice(prev.items, selected, prev.quotationDate) : prev.items }));
            }} />
          </div>
          <div>
            <label className={labelCls}>ประเภทการขาย</label>
            <select className={`${inputCls} bg-white`} value={data.saleType} onChange={(e) => setData({ ...data, saleType: e.target.value as QuotationData["saleType"] })}>
              <option value="RETAIL">ขายปลีก</option>
              <option value="WHOLESALE">ขายส่ง</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>ชื่อลูกค้า <span className="text-red-500">*</span></label>
            <input required maxLength={100} className={inputCls} value={data.customerName} placeholder="ชื่อที่จะพิมพ์บนใบเสนอราคา" onChange={(e) => setData({ ...data, customerName: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>เบอร์โทร</label>
            <input type="tel" maxLength={20} className={inputCls} value={data.customerPhone} placeholder="ไม่ระบุ" onChange={(e) => setData({ ...data, customerPhone: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>เครดิต (วัน)</label>
            <AdminNumberInput className={inputCls} value={data.creditTerm} min={0} max={365} placeholder="0 = เงินสด" onValueChange={(value) => setData({ ...data, creditTerm: value })} />
          </div>
          <div>
            <label className={labelCls}>ระดับราคา</label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
              {customer?.customerType?.priceList?.name ?? customer?.customerType?.priceTier ?? "ราคาขายปลีก"}
            </div>
          </div>
          <div>
            <label className={labelCls}>ส่วนลดท้ายบิล (บาท)</label>
            <AdminNumberInput className={inputCls} value={data.discount} min={0} onValueChange={(value) => setData({ ...data, discount: value })} />
          </div>
          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <textarea rows={2} maxLength={2000} className={inputCls} value={data.note} placeholder="หมายเหตุ" onChange={(e) => setData({ ...data, note: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>ที่อยู่</label>
            <textarea rows={3} maxLength={500} className={inputCls} value={data.customerAddress} placeholder="ที่อยู่ลูกค้าที่จะพิมพ์บนใบเสนอราคา" onChange={(e) => setData({ ...data, customerAddress: e.target.value })} />
          </div>

          {/* VAT Settings */}
          <div className="md:col-span-3 border-t border-gray-100 dark:border-white/10 pt-4 mt-2">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">ภาษี (VAT)</p>
            <div className="flex flex-wrap gap-2 items-center">
              {(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setData({ ...data, vatType: type })}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    data.vatType === type
                      ? "bg-[#1e3a5f] text-white border-[#1e3a5f] dark:bg-sky-700 dark:border-sky-700"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 dark:bg-slate-800 dark:text-slate-300 dark:border-white/20 dark:hover:border-white/40"
                  }`}
                >
                  {VAT_TYPE_LABELS[type]}
                </button>
              ))}
              {data.vatType !== "NO_VAT" && (
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-sm text-gray-500 dark:text-slate-400">อัตรา</span>
                  <AdminNumberInput
                    value={data.vatRate}
                    onValueChange={(value) => setData({ ...data, vatRate: value })}
                    min={0} max={100} step={0.01}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm text-center dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <span className="text-sm text-gray-500 dark:text-slate-400">%</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100 dark:border-white/10">
          <h2 className={sectionTitleCls}>รายการสินค้า</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10">
                <th className={`${thCls} text-center w-10`}>ลำดับ</th>
                <th className={thCls}>สินค้า</th>
                <th className={`${thCls} w-28`}>หน่วย</th>
                <th className={`${thCls} w-24`}>จำนวน</th>
                <th className={`${thCls} w-32`}>
                  ราคาขาย/หน่วย
                  <span className={thHintCls}>ก่อนลด</span>
                </th>
                <th className="text-left py-2 px-2 text-amber-600 font-medium w-28 dark:text-amber-400/80">
                  ส่วนลด/หน่วย
                  <span className={thHintCls}>0 = ไม่ลด</span>
                </th>
                <th className={`${thCls} w-32`}>
                  ราคาสุทธิ/หน่วย
                  <span className={thHintCls}>หลังลด</span>
                </th>
                <th className={`${thCls} text-right w-28`}>รวม</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((row, index) => {
                const product = products.find((p) => p.id === row.productId);
                const isZeroPriced = Boolean(row.productId) && row.salePrice <= 0;
                return (
                  <Fragment key={index}>
                    <tr className={`border-b border-gray-50 dark:border-white/5 ${isZeroPriced ? "bg-rose-50 dark:bg-rose-500/10" : ""}`}>
                      <td className="py-2 px-2 text-center text-sm text-gray-500 dark:text-slate-400">{index + 1}</td>
                      <td className="py-2 px-2">
                        <ProductSearchSelect
                          products={products}
                          value={row.productId}
                          selectedProduct={product}
                          searchProducts={searchQuotationProducts}
                          onChange={(value) => { if (!value) updateItem(index, { productId: "", unitName: "" }); }}
                          onProductSelect={(p) => pickProduct(index, p)}
                        />
                        {row.productId && (
                          <input
                            type="text"
                            maxLength={500}
                            className={`${inputCls} mt-1`}
                            value={row.moreDetail}
                            placeholder="รายละเอียดเพิ่มเติม (เช่น สี/รุ่น/หมายเหตุ)"
                            onChange={(e) => updateItem(index, { moreDetail: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <select className={`${inputCls} bg-white`} value={row.unitName} disabled={!row.productId} onChange={(e) => {
                          const oldScale = Number(product?.units.find((u) => u.name === row.unitName)?.scale ?? 1);
                          const newScale = Number(product?.units.find((u) => u.name === e.target.value)?.scale ?? 1);
                          updateItem(index, { unitName: e.target.value, salePrice: Math.round(row.salePrice / oldScale * newScale * 100) / 100, unitListPrice: Math.round(row.unitListPrice / oldScale * newScale * 100) / 100 });
                        }}>
                          <option value="">-- โปรดระบุ --</option>
                          {product?.units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <AdminNumberInput value={row.qty} min={0} className={inputCls} onValueChange={(value) => updateItem(index, { qty: value })} />
                      </td>
                      <td className="py-2 px-2">
                        <AdminNumberInput value={row.unitListPrice} min={0} className={inputCls} placeholder="0.00" onValueChange={(value) => updateItem(index, { unitListPrice: value, salePrice: Math.min(row.salePrice, value) })} />
                      </td>
                      <td className="py-2 px-2">
                        <AdminNumberInput
                          value={Math.max(0, row.unitListPrice - row.salePrice)}
                          min={0}
                          max={row.unitListPrice}
                          placeholder="0.00"
                          className={`${inputCls} ${row.unitListPrice - row.salePrice > 0.0001 ? "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10" : ""}`}
                          onValueChange={(value) => updateItem(index, { salePrice: Math.max(0, row.unitListPrice - value) })}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <AdminNumberInput
                          value={row.salePrice}
                          min={0}
                          placeholder="0.00"
                          className={`${inputCls} font-medium ${isZeroPriced ? "border-rose-400 bg-rose-50 dark:border-rose-500/60 dark:bg-rose-500/10" : ""}`}
                          onValueChange={(value) => updateItem(index, { salePrice: value, unitListPrice: Math.max(value, row.unitListPrice) })}
                        />
                      </td>
                      <td className="py-2 px-2 text-right font-medium text-gray-700 dark:text-slate-200">
                        {(row.qty * row.salePrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-2">
                        {data.items.length > 1 && (
                          <button
                            type="button"
                            className="text-red-400 hover:text-red-600 transition-colors"
                            aria-label={`ลบรายการที่ ${index + 1}`}
                            onClick={() => setData({ ...data, items: data.items.filter((_, i) => i !== index) })}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isZeroPriced && (
                      <tr className="bg-rose-50 dark:bg-rose-500/10">
                        <td colSpan={9} className="px-2 pb-2 text-xs text-rose-700 dark:text-rose-300">รายการนี้มีราคา 0 บาท</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals summary */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            {totalLineDiscount > 0 && (
              <>
                <div className="flex justify-between text-gray-500 dark:text-slate-400">
                  <span>ราคาขายรวม</span>
                  <span className="font-medium dark:text-slate-300">{grossBeforeLineDiscount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>ส่วนลดระดับรายการ</span>
                  <span className="font-medium">-{totalLineDiscount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                </div>
              </>
            )}
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>ยอดรวม</span>
              <span className="font-medium dark:text-slate-200">{totals.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>ส่วนลดท้ายบิล</span>
              <span className="font-medium text-red-500 dark:text-red-400">-{data.discount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
            {data.vatType !== "NO_VAT" && (
              <>
                <div className="flex justify-between text-gray-600 dark:text-slate-400">
                  <span>ยอดก่อนภาษี</span>
                  <span className="font-medium dark:text-slate-200">{totals.subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-slate-400">
                  <span>VAT {data.vatRate}%</span>
                  <span className="font-medium dark:text-slate-200">+{totals.vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-gray-200 dark:border-white/10 pt-2 font-semibold text-gray-900 dark:text-slate-100">
              <span>ยอดสุทธิ</span>
              <span className="text-[#1e3a5f] dark:text-sky-300">{totals.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>
    </fieldset>

    {error && (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 dark:bg-red-500/10 dark:border-red-400/30">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
        {references.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-3">
            {references.map((reference) => (
              <Link className="text-sm underline text-sky-700 dark:text-sky-300" key={reference.href} href={reference.href}>{reference.label}</Link>
            ))}
          </div>
        )}
      </div>
    )}

    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-gray-500 dark:text-slate-400">
        ใบเสนอราคายังไม่ตัดสต็อกและไม่กระทบบัญชี จนกว่าจะนำไปบันทึกขาย
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || locked}
          onClick={() => setData({ ...data, items: [...data.items, emptyItem()] })}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 hover:border-[#1e3a5f] bg-white text-gray-700 hover:text-[#1e3a5f] text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 dark:border-white/20 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-500 dark:hover:text-sky-300"
        >
          <Plus size={14} /> เพิ่มรายการ
        </button>
        <button
          type="submit"
          disabled={pending || locked}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:bg-orange-600 dark:hover:bg-orange-500 dark:disabled:bg-orange-900/50"
        >
          {pending ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              กำลังบันทึก...
            </span>
          ) : id ? "บันทึกการแก้ไข" : "บันทึกใบเสนอราคา"}
        </button>
      </div>
    </div>
  </form>;
}
