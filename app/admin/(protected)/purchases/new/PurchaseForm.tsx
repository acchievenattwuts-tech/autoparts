"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchase, updatePurchase } from "../actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";
import { calcVat, calcItemSubtotal, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import { PaymentMethod, PurchasePaymentStatus } from "@/lib/generated/prisma";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { validateLotRows, type LotSubRow } from "@/lib/lot-control-client";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  purchaseUnitName: string;
  costPrice: number;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  units: { name: string; scale: number; isBase: boolean }[];
  isLotControl: boolean;
  requireExpiryDate: boolean;
}

interface SupplierOption { id: string; name: string }

interface CashBankAccountOption {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
}

interface LineItem {
  productId:  string;
  unitName:   string;
  qty:        number;
  costPrice:  number;
  landedCost: number;
  lotItems:   LotSubRow[];
}

interface InitialData {
  id:           string;
  purchaseDate: string;
  supplierId:   string;
  paymentMethod: PaymentMethod;
  paymentStatus: PurchasePaymentStatus;
  cashBankAccountId: string;
  referenceNo:  string;
  discount:     number;
  note:         string;
  vatType:      string;
  vatRate:      number;
  items:        LineItem[];
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";
const paymentMethodOptions: Array<{ value: PaymentMethod; label: string }> = [
  { value: PaymentMethod.TRANSFER, label: "โอนเงิน" },
  { value: PaymentMethod.CASH, label: "เงินสด" },
];

const PurchaseForm = ({
  products,
  suppliers,
  cashBankAccounts,
  defaultVatType,
  defaultVatRate,
  initialData,
  editableLotOnEdit = false,
}: {
  products: ProductOption[];
  suppliers: SupplierOption[];
  cashBankAccounts: CashBankAccountOption[];
  defaultVatType: string;
  defaultVatRate: number;
  initialData?: InitialData;
  editableLotOnEdit?: boolean;
}) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const showReadonlyLots = isEdit && !editableLotOnEdit;
  const [isPending, startTransition] = useTransition();
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [supplierId, setSupplierId] = useState(initialData?.supplierId ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(initialData?.paymentMethod ?? PaymentMethod.TRANSFER);
  const [paymentStatus, setPaymentStatus] = useState<PurchasePaymentStatus>(initialData?.paymentStatus ?? PurchasePaymentStatus.UNPAID);
  const [cashBankAccountId, setCashBankAccountId] = useState(initialData?.cashBankAccountId ?? "");
  const [discount, setDiscount] = useState(initialData?.discount ?? 0);
  const [items, setItems]     = useState<LineItem[]>(
    initialData?.items ?? [{ productId: "", unitName: "", qty: 1, costPrice: 0, landedCost: 0, lotItems: [] }]
  );
  const [vatType, setVatType] = useState<string>(initialData?.vatType ?? defaultVatType);
  const [vatRate, setVatRate] = useState<number>(initialData?.vatRate ?? defaultVatRate);
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const productMap = new Map(productOptions.map((product) => [product.id, product]));

  const addItem = () =>
    setItems((prev) => [...prev, { productId: "", unitName: "", qty: 1, costPrice: 0, landedCost: 0, lotItems: [] }]);

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const rememberProduct = (product: ProductOption) => {
    setProductOptions((prev) => {
      const existingIndex = prev.findIndex((candidate) => candidate.id === product.id);
      if (existingIndex === -1) return [...prev, product];
      const next = [...prev];
      next[existingIndex] = product;
      return next;
    });
  };

  const clearItemProduct = (itemIndex: number) => {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIndex
          ? item
          : {
              ...item,
              productId: "",
              unitName: "",
              costPrice: 0,
              landedCost: 0,
              lotItems: [],
            },
      ),
    );
  };

  const applySelectedProduct = (itemIndex: number, product: ProductOption) => {
    rememberProduct(product);
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIndex
          ? item
          : {
              ...item,
              productId: product.id,
              unitName: product.purchaseUnitName ?? "",
              costPrice: product.costPrice ?? 0,
              lotItems: product.isLotControl
                ? [{ lotNo: "", qty: item.qty, unitCost: product.costPrice, mfgDate: "", expDate: "" }]
                : [],
            },
      ),
    );
  };

  const updateItem = (i: number, field: keyof Omit<LineItem, "lotItems">, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const updated = { ...item, [field]: value };
        if (field === "qty" && item.productId) {
          const prod = productMap.get(item.productId);
          if (prod?.isLotControl && updated.lotItems.length === 1) {
            // Auto-sync single lot qty when item qty changes
            updated.lotItems = [{ ...updated.lotItems[0], qty: Number(value) }];
          }
        }
        return updated;
      })
    );
  };

  const addLotRow = (itemIdx: number) => {
    setItems((prev) => prev.map((item, idx) => {
      if (idx !== itemIdx) return item;
      return { ...item, lotItems: [...item.lotItems, { lotNo: "", qty: 0, unitCost: item.costPrice, mfgDate: "", expDate: "" }] };
    }));
  };

  const removeLotRow = (itemIdx: number, lotIdx: number) => {
    setItems((prev) => prev.map((item, idx) => {
      if (idx !== itemIdx) return item;
      return { ...item, lotItems: item.lotItems.filter((_, li) => li !== lotIdx) };
    }));
  };

  const updateLotRow = (itemIdx: number, lotIdx: number, field: keyof LotSubRow, value: string | number) => {
    setItems((prev) => prev.map((item, idx) => {
      if (idx !== itemIdx) return item;
      return {
        ...item,
        lotItems: item.lotItems.map((lot, li) =>
          li === lotIdx ? { ...lot, [field]: value } : lot
        ),
      };
    }));
  };

  const getUnits = (productId: string) =>
    productMap.get(productId)?.units ?? [];

  const totalBeforeDiscount = items.reduce((sum, it) => sum + it.qty * it.costPrice, 0);
  const discountedTotal = Math.max(0, totalBeforeDiscount - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType as VatType, vatRate);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setSuccess("");

    const formData = new FormData(e.currentTarget);

    if (!supplierId) { setError("กรุณาเลือกผู้จำหน่าย"); return; }
    if (paymentStatus === PurchasePaymentStatus.PAID && !cashBankAccountId) { setError("กรุณาเลือกบัญชีจ่ายเงิน"); return; }
    formData.set("supplierId", supplierId);
    formData.set("paymentMethod", paymentMethod);
    formData.set("paymentStatus", paymentStatus);
    formData.set("cashBankAccountId", cashBankAccountId);

    for (const item of items) {
      if (!item.productId) { setError("กรุณาเลือกสินค้าทุกรายการ"); return; }
      if (!item.unitName)  { setError("กรุณาเลือกหน่วยนับทุกรายการ"); return; }
      if (item.qty <= 0)   { setError("จำนวนต้องมากกว่า 0"); return; }

      const prod = productMap.get(item.productId);
      if (prod?.isLotControl) {
        const lotErr = validateLotRows(item.lotItems, item.qty, prod.requireExpiryDate);
        if (lotErr) { setError(lotErr); return; }
      }
    }
    formData.set("items", JSON.stringify(items));
    formData.set("discount", String(discount));
    formData.set("vatType", vatType);
    formData.set("vatRate", String(vatRate));

    startTransition(async () => {
      if (isEdit && initialData) {
        const result = await updatePurchase(initialData.id, formData);
        if (result.error) setError(result.error);
        else router.push("/admin/purchases");
      } else {
        const result = await createPurchase(formData);
        if (result.error) setError(result.error);
        else {
          setSuccess(`บันทึกสำเร็จ เลขที่ใบซื้อ: ${result.purchaseNo}`);
          setTimeout(() => router.push("/admin/purchases"), 1500);
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลการซื้อ
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>วันที่ซื้อ <span className="text-red-500">*</span></label>
            <input type="date" name="purchaseDate" required
              defaultValue={initialData?.purchaseDate ?? new Date().toISOString().slice(0, 10)}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ซัพพลายเออร์</label>
            <SearchableSelect
              options={suppliers.map((s): SelectOption => ({ id: s.id, label: s.name }))}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="โปรดระบุผู้จำหน่าย"
            />
          </div>
          <div>
            <label className={labelCls}>เลขที่เอกสารอ้างอิง</label>
            <input
              type="text"
              name="referenceNo"
              maxLength={100}
              defaultValue={initialData?.referenceNo ?? ""}
              className={inputCls}
              placeholder="เช่น เลขที่ใบกำกับซัพพลายเออร์"
            />
          </div>
          <div>
            <label className={labelCls}>ช่องทางชำระเงิน</label>
            <select
              name="paymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className={`${inputCls} bg-white`}
            >
              {paymentMethodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>ส่วนลดรวม (บาท)</label>
            <input
              type="number"
              name="discount"
              min={0}
              step={0.01}
              value={discount}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>หมายเหตุ</label>
            <input type="text" name="note" maxLength={500} defaultValue={initialData?.note ?? ""} className={inputCls} placeholder="หมายเหตุ" />
          </div>

          <div>
            <label className={labelCls}>สถานะการชำระเงิน</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setPaymentStatus(PurchasePaymentStatus.UNPAID)}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  paymentStatus === PurchasePaymentStatus.UNPAID
                    ? "bg-orange-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ยังไม่ชำระ
              </button>
              <button
                type="button"
                onClick={() => setPaymentStatus(PurchasePaymentStatus.PAID)}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${
                  paymentStatus === PurchasePaymentStatus.PAID
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ชำระแล้ว
              </button>
            </div>
          </div>
          <div>
            <label className={labelCls}>บัญชีจ่ายเงิน {paymentStatus === PurchasePaymentStatus.PAID && <span className="text-red-500">*</span>}</label>
            <SearchableSelect
              options={cashBankAccounts.map((account): SelectOption => ({
                id: account.id,
                label: account.name,
                sublabel: [account.code, account.type === "BANK" ? account.bankName : "เงินสด", account.accountNo].filter(Boolean).join(" | ") || undefined,
              }))}
              value={cashBankAccountId}
              onChange={setCashBankAccountId}
              placeholder="โปรดระบุบัญชีจ่ายเงิน"
            />
          </div>

          {/* VAT Settings */}
          <div className="md:col-span-3 border-t border-gray-100 pt-4 mt-2">
            <p className="text-sm font-medium text-gray-700 mb-3">ภาษี (VAT)</p>
            <div className="flex flex-wrap gap-2 items-center">
              {(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setVatType(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    vatType === t
                      ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {VAT_TYPE_LABELS[t]}
                </button>
              ))}
              {vatType !== "NO_VAT" && (
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-sm text-gray-500">อัตรา</span>
                  <input
                    type="number"
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value))}
                    min={0} max={100} step={0.01}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm text-center"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">รายการสินค้า</h2>
          <button type="button" onClick={addItem}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors">
            <Plus size={14} /> เพิ่มรายการ
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-2 text-gray-500 font-medium">สินค้า</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-28">หน่วย</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-24">จำนวน</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-32">ราคาทุน/หน่วย</th>
                <th className="text-right py-2 px-2 text-gray-500 font-medium w-28">รวม</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const units = getUnits(item.productId);
                const prod  = productMap.get(item.productId);
                const isLot = prod?.isLotControl ?? false;
                const totalLotQty = item.lotItems.reduce((s, l) => s + l.qty, 0);
                const lotQtyMatch = !isLot || Math.abs(totalLotQty - item.qty) < 0.0001;
                return (
                  <Fragment key={i}>
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 px-2">
                        <ProductSearchSelect
                          products={productOptions}
                          value={item.productId}
                          selectedProduct={prod ?? null}
                          onProductSelect={(product) => applySelectedProduct(i, product)}
                          onChange={(id) => {
                            if (!id) clearItemProduct(i);
                          }}
                        />
                        {isLot && (
                          <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            Lot Control
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2">
                        <select value={item.unitName}
                          onChange={(e) => updateItem(i, "unitName", e.target.value)}
                          disabled={!item.productId}
                          className={`${inputCls} bg-white`}>
                          <option value="">-- โปรดระบุ --</option>
                          {units.map((u) => (
                            <option key={u.name} value={u.name}>{u.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" value={item.qty} min={0.0001} step={0.0001}
                          onChange={(e) => updateItem(i, "qty", Number(e.target.value))}
                          className={inputCls} />
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" value={item.costPrice} min={0} step={0.0001}
                          onChange={(e) => updateItem(i, "costPrice", Number(e.target.value))}
                          className={inputCls} placeholder="0.00" />
                      </td>
                      <td className="py-2 px-2 text-right font-medium text-gray-700">
                        {(item.qty * item.costPrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-2">
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(i)}
                            className="text-red-400 hover:text-red-600 transition-colors">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isLot && (
                      <tr className="bg-amber-50/60">
                        <td colSpan={6} className="px-4 pb-3 pt-1">
                          {showReadonlyLots ? (
                            /* Read-only lot display in edit mode */
                            <div className="flex flex-wrap gap-2">
                              {item.lotItems.length === 0 ? (
                                <span className="text-xs text-gray-400 italic">ไม่มีข้อมูล Lot</span>
                              ) : item.lotItems.map((lot, li) => (
                                <div key={li} className="inline-flex items-center gap-1.5 text-xs bg-white border border-amber-200 rounded-md px-2 py-1">
                                  <span className="font-mono font-semibold text-amber-800">{lot.lotNo}</span>
                                  <span className="text-gray-500">จำนวน</span>
                                  <span className="font-medium text-gray-700">{lot.qty}</span>
                                  {lot.expDate && (
                                    <>
                                      <span className="text-gray-400">|</span>
                                      <span className="text-gray-500">EXP {lot.expDate}</span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <>
                              {/* Progress */}
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs text-gray-500">Lot รวม</span>
                                <span className={`text-xs font-semibold ${lotQtyMatch ? "text-green-600" : "text-red-600"}`}>
                                  {totalLotQty}
                                </span>
                                <span className="text-xs text-gray-400">/ {item.qty} {item.unitName}</span>
                                {!lotQtyMatch && <span className="text-xs text-red-500">⚠ ไม่ตรง</span>}
                              </div>
                              {/* Lot sub-table */}
                              <table className="w-full text-xs border border-amber-200 rounded-lg overflow-hidden">
                                <thead>
                                  <tr className="bg-amber-100 text-amber-800">
                                    <th className="text-left py-1.5 px-2 font-medium">เลขที่ Lot</th>
                                    <th className="text-left py-1.5 px-2 font-medium w-24">จำนวน</th>
                                    <th className="text-left py-1.5 px-2 font-medium w-28">ต้นทุน/หน่วย</th>
                                    <th className="text-left py-1.5 px-2 font-medium w-32">วันผลิต (MFG)</th>
                                    <th className="text-left py-1.5 px-2 font-medium w-32">
                                      วันหมดอายุ (EXP)
                                      {prod?.requireExpiryDate && <span className="text-red-500 ml-0.5">*</span>}
                                    </th>
                                    <th className="w-6" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.lotItems.map((lot, li) => (
                                    <tr key={li} className="border-t border-amber-100">
                                      <td className="py-1 px-2">
                                        <input
                                          type="text"
                                          value={lot.lotNo}
                                          onChange={(e) => updateLotRow(i, li, "lotNo", e.target.value)}
                                          placeholder="เช่น LOT-001"
                                          className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        />
                                      </td>
                                      <td className="py-1 px-2">
                                        <input
                                          type="number"
                                          value={lot.qty}
                                          min={0.0001} step={0.0001}
                                          onChange={(e) => updateLotRow(i, li, "qty", Number(e.target.value))}
                                          className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        />
                                      </td>
                                      <td className="py-1 px-2">
                                        <input
                                          type="number"
                                          value={lot.unitCost}
                                          min={0} step={0.0001}
                                          onChange={(e) => updateLotRow(i, li, "unitCost", Number(e.target.value))}
                                          className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        />
                                      </td>
                                      <td className="py-1 px-2">
                                        <input
                                          type="date"
                                          value={lot.mfgDate}
                                          onChange={(e) => updateLotRow(i, li, "mfgDate", e.target.value)}
                                          className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        />
                                      </td>
                                      <td className="py-1 px-2">
                                        <input
                                          type="date"
                                          value={lot.expDate}
                                          onChange={(e) => updateLotRow(i, li, "expDate", e.target.value)}
                                          required={prod?.requireExpiryDate}
                                          className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        />
                                      </td>
                                      <td className="py-1 px-2">
                                        {item.lotItems.length > 1 && (
                                          <button type="button" onClick={() => removeLotRow(i, li)}
                                            className="text-red-400 hover:text-red-600">
                                            <Trash2 size={13} />
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <button
                                type="button"
                                onClick={() => addLotRow(i)}
                                className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 px-2 py-1 rounded transition-colors"
                              >
                                <Plus size={11} /> เพิ่ม Lot
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-100">
                <td colSpan={4} className="py-2 px-2 text-right text-sm text-gray-500">รวมก่อนส่วนลด</td>
                <td className="py-2 px-2 text-right text-gray-700">
                  {totalBeforeDiscount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={4} className="py-1 px-2 text-right text-sm text-gray-500">ส่วนลด</td>
                <td className="py-1 px-2 text-right text-red-500">
                  -{discount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              {vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={4} className="py-1 px-2 text-right text-sm text-gray-500">
                      ยอดก่อนภาษี
                    </td>
                    <td className="py-1 px-2 text-right text-gray-700">
                      {subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={4} className="py-1 px-2 text-right text-sm text-gray-500">
                      VAT {vatRate}%
                    </td>
                    <td className="py-1 px-2 text-right text-gray-700">
                      +{vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </>
              )}
              <tr className="border-t border-gray-200">
                <td colSpan={4} className="py-3 px-2 text-right text-sm font-semibold text-gray-700">ยอดสุทธิ</td>
                <td className="py-3 px-2 text-right font-bold text-[#1e3a5f] text-base">
                  {netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-600">{success}</p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button type="submit" disabled={isPending}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
          {isPending ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              กำลังบันทึก...
            </>
          ) : isEdit ? "บันทึกการแก้ไข" : "บันทึกใบซื้อ"}
        </button>
      </div>
    </form>
  );
};

export default PurchaseForm;
