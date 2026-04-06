"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCreditNote, updateCreditNote, getSalesForCustomer, getSaleDetail, searchCreditNoteCustomers } from "../actions";
import { Plus, Trash2, CheckCircle, Info } from "lucide-react";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { validateLotRows, type LotSubRow } from "@/lib/lot-control-client";

interface CustomerOption {
  id: string;
  name: string;
}

interface CashBankAccountOption {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
}

interface ProductOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  salePrice: number;
  saleUnitName: string;
  isLotControl: boolean;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  units: { name: string; scale: number; isBase: boolean }[];
}

interface SaleOption {
  id: string;
  saleNo: string;
  customerName: string | null;
  saleDate: Date;
}

interface CreditNoteLotRow extends LotSubRow {
  isReturnLot: boolean;
}

interface LineItem {
  productId: string;
  unitName: string;
  qty: number;
  salePrice: number;
  lotItems: CreditNoteLotRow[];
}

interface InitialData {
  id: string;
  cnDate: string;
  customerId: string;
  customerName: string;
  saleId: string;
  type: "RETURN" | "DISCOUNT" | "OTHER";
  settlementType: "CASH_REFUND" | "CREDIT_DEBT";
  refundMethod: "CASH" | "TRANSFER";
  cashBankAccountId: string;
  note: string;
  vatType: string;
  vatRate: number;
  items: LineItem[];
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const emptyItem = (): LineItem => ({ productId: "", unitName: "", qty: 1, salePrice: 0, lotItems: [] });

const CreditNoteForm = ({
  products,
  customers,
  cashBankAccounts,
  initialSales,
  defaultVatType,
  defaultVatRate,
  initialData,
}: {
  products: ProductOption[];
  customers: CustomerOption[];
  cashBankAccounts: CashBankAccountOption[];
  initialSales?: SaleOption[];
  defaultVatType: string;
  defaultVatRate: number;
  initialData?: InitialData;
}) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [customerId, setCustomerId] = useState(initialData?.customerId ?? "");
  const [customerName, setCustomerName] = useState(initialData?.customerName ?? "");
  const [filteredSales, setFilteredSales] = useState<SaleOption[]>(initialSales ?? []);
  const [loadingSales, setLoadingSales] = useState(false);
  const [saleId, setSaleId] = useState(initialData?.saleId ?? "");
  const [items, setItems] = useState<LineItem[]>(initialData?.items ?? [emptyItem()]);
  const [cnType, setCnType] = useState<"RETURN" | "DISCOUNT" | "OTHER">(initialData?.type ?? "RETURN");
  const [settlementType, setSettlementType] = useState<"CASH_REFUND" | "CREDIT_DEBT">(initialData?.settlementType ?? "CASH_REFUND");
  const [refundMethod, setRefundMethod] = useState<"CASH" | "TRANSFER">(initialData?.refundMethod ?? "CASH");
  const [cashBankAccountId, setCashBankAccountId] = useState(initialData?.cashBankAccountId ?? "");
  const [vatType, setVatType] = useState<string>(initialData?.vatType ?? defaultVatType);
  const [vatRate, setVatRate] = useState<number>(initialData?.vatRate ?? defaultVatRate);
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const productMap = new Map(productOptions.map((product) => [product.id, product]));
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));

  const handleCustomerChange = async (id: string) => {
    setCustomerId(id);
    const customer = customerMap.get(id);
    setCustomerName(customer?.name ?? "");
    setSaleId("");
    setItems([emptyItem()]);
    if (!id) {
      setFilteredSales([]);
      return;
    }
    setLoadingSales(true);
    const sales = await getSalesForCustomer(id);
    setFilteredSales(sales);
    setLoadingSales(false);
  };

  const handleSaleChange = async (id: string) => {
    setSaleId(id);
    if (!id) return;
    const detail = await getSaleDetail(id);
    if (!detail) return;
    setProductOptions((prev) => {
      const next = new Map(prev.map((product) => [product.id, product]));
      detail.products.forEach((product) => {
        next.set(product.id, product);
      });
      return [...next.values()];
    });
    setVatType(detail.vatType);
    setVatRate(detail.vatRate);
    setItems(detail.items.map((item) => ({ ...item, lotItems: [] })));
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
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
              salePrice: 0,
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
              unitName: product.saleUnitName ?? "",
              salePrice: product.salePrice ?? 0,
              lotItems: product.isLotControl
                ? [{ lotNo: "", qty: item.qty, unitCost: product.salePrice, mfgDate: "", expDate: "", isReturnLot: false }]
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
          const product = productMap.get(item.productId);
          if (product?.isLotControl && updated.lotItems.length === 1) {
            updated.lotItems = [{ ...updated.lotItems[0], qty: Number(value) }];
          }
        }
        return updated;
      })
    );
  };

  const addLotRow = (itemIdx: number) => {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIdx
          ? item
          : {
              ...item,
              lotItems: [...item.lotItems, { lotNo: "", qty: 0, unitCost: item.salePrice, mfgDate: "", expDate: "", isReturnLot: false }],
            }
      )
    );
  };

  const removeLotRow = (itemIdx: number, lotIdx: number) => {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIdx
          ? item
          : { ...item, lotItems: item.lotItems.filter((_, index) => index !== lotIdx) }
      )
    );
  };

  const updateLotRow = (
    itemIdx: number,
    lotIdx: number,
    field: keyof CreditNoteLotRow,
    value: string | number | boolean
  ) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== itemIdx) return item;
        return {
          ...item,
          lotItems: item.lotItems.map((lot, index) => (index === lotIdx ? { ...lot, [field]: value } : lot)),
        };
      })
    );
  };

  const getUnits = (productId: string) => productMap.get(productId)?.units ?? [];

  const validateCreditNoteLots = (item: LineItem): string | null => {
    const rowsForQtyCheck = item.lotItems.map((lot) => ({
      lotNo: lot.lotNo,
      qty: lot.qty,
      unitCost: lot.unitCost,
      mfgDate: lot.mfgDate,
      expDate: lot.expDate,
    }));
    return validateLotRows(rowsForQtyCheck, item.qty, false);
  };

  const totalAmount = items.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, vatType as VatType, vatRate);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!customerId) {
      setError("กรุณาเลือกลูกค้า");
      return;
    }
    for (const item of items) {
      if (!item.productId) {
        setError("กรุณาเลือกสินค้าทุกรายการ");
        return;
      }
      if (!item.unitName) {
        setError("กรุณาเลือกหน่วยนับทุกรายการ");
        return;
      }
      if (item.qty <= 0) {
        setError("จำนวนต้องมากกว่า 0");
        return;
      }
      const product = productMap.get(item.productId);
      if (cnType === "RETURN" && product?.isLotControl) {
        const lotErr = validateCreditNoteLots(item);
        if (lotErr) {
          setError(lotErr);
          return;
        }
      }
    }

    if (settlementType === "CASH_REFUND" && !cashBankAccountId) {
      setError("à¸à¸£à¸¸à¸“à¸²à¹€à¸¥à¸·à¸­à¸à¸šà¸±à¸à¸Šà¸µà¸ˆà¹ˆà¸²à¸¢à¹€à¸‡à¸´à¸™");
      return;
    }

    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("customerId", customerId);
    formData.set("customerName", customerName);
    formData.set("items", JSON.stringify(items));
    formData.set("cashBankAccountId", cashBankAccountId);
    formData.set("vatType", vatType);
    formData.set("vatRate", String(vatRate));

    startTransition(async () => {
      if (isEdit && initialData) {
        const result = await updateCreditNote(initialData.id, formData);
        if (result.error) setError(result.error);
        else router.push("/admin/credit-notes");
      } else {
        const result = await createCreditNote(formData);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess(`บันทึกสำเร็จ เลขที่ CN: ${result.cnNo}`);
          setTimeout(() => router.push("/admin/credit-notes"), 1500);
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลใบลดหนี้ (Credit Note)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>วันที่ CN <span className="text-red-500">*</span></label>
            <input
              type="date"
              name="cnDate"
              required
              defaultValue={initialData?.cnDate ?? new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>ลูกค้า <span className="text-red-500">*</span></label>
            <SearchableSelect
              options={customers.map((customer): SelectOption => ({ id: customer.id, label: customer.name }))}
              value={customerId}
              onChange={handleCustomerChange}
              onOptionSelect={(option) => setCustomerName(option.label)}
              searchOptions={searchCreditNoteCustomers}
              selectedOption={customerId ? { id: customerId, label: customerName || customerMap.get(customerId)?.name || "" } : null}
              placeholder="โปรดระบุลูกค้า"
            />
          </div>
          <div>
            <label className={labelCls}>อ้างอิงใบขาย</label>
            <SearchableSelect
              options={[
                { id: "", label: "-- ไม่อ้างอิง --" },
                ...filteredSales.map((sale): SelectOption => ({
                  id: sale.id,
                  label: sale.saleNo,
                  sublabel: new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  }),
                })),
              ]}
              value={saleId}
              onChange={handleSaleChange}
              placeholder={loadingSales ? "กำลังโหลด..." : customerId ? "-- ไม่อ้างอิง --" : "เลือกลูกค้าก่อน"}
              disabled={!customerId || loadingSales}
            />
            <input type="hidden" name="saleId" value={saleId} />
          </div>
          <div>
            <label className={labelCls}>การชำระ CN</label>
            <input type="hidden" name="settlementType" value={settlementType} />
            <input type="hidden" name="refundMethod" value={settlementType === "CASH_REFUND" ? refundMethod : ""} />
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setSettlementType("CASH_REFUND")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  settlementType === "CASH_REFUND" ? "bg-emerald-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                คืนเป็นเงินสด
              </button>
              <button
                type="button"
                onClick={() => setSettlementType("CREDIT_DEBT")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${
                  settlementType === "CREDIT_DEBT" ? "bg-orange-500 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ตั้งหนี้
              </button>
            </div>
          </div>
          {settlementType === "CASH_REFUND" && (
            <div>
              <label className={labelCls}>ช่องทางการคืนเงิน <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                {(["CASH", "TRANSFER"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setRefundMethod(method)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      refundMethod === method
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    {method === "CASH" ? "เงินสด" : "โอนเงิน"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className={labelCls}>
              à¸šà¸±à¸à¸Šà¸µà¸ˆà¹ˆà¸²à¸¢à¹€à¸‡à¸´à¸™ {settlementType === "CASH_REFUND" && <span className="text-red-500">*</span>}
            </label>
            <SearchableSelect
              options={cashBankAccounts.map((account): SelectOption => ({
                id: account.id,
                label: account.name,
                sublabel: [account.code, account.type === "BANK" ? account.bankName : "à¹€à¸‡à¸´à¸™à¸ªà¸”", account.accountNo].filter(Boolean).join(" | ") || undefined,
              }))}
              value={cashBankAccountId}
              onChange={setCashBankAccountId}
              placeholder="à¹‚à¸›à¸£à¸”à¸£à¸°à¸šà¸¸à¸šà¸±à¸à¸Šà¸µà¸ˆà¹ˆà¸²à¸¢à¹€à¸‡à¸´à¸™"
            />
          </div>
          <div>
            <label className={labelCls}>ประเภท CN <span className="text-red-500">*</span></label>
            <select
              name="type"
              value={cnType}
              onChange={(e) => setCnType(e.target.value as "RETURN" | "DISCOUNT" | "OTHER")}
              className={`${inputCls} bg-white`}
            >
              <option value="RETURN">รับคืนสินค้า</option>
              <option value="DISCOUNT">ส่วนลดราคา</option>
              <option value="OTHER">อื่นๆ</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>หมายเหตุ</label>
            <input
              type="text"
              name="note"
              maxLength={500}
              defaultValue={initialData?.note ?? ""}
              className={inputCls}
              placeholder="หมายเหตุ"
            />
          </div>
          <div className="md:col-span-3 border-t border-gray-100 pt-4 mt-2">
            <p className="text-sm font-medium text-gray-700 mb-3">ภาษี (VAT)</p>
            <div className="flex flex-wrap gap-2 items-center">
              {(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setVatType(value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    vatType === value
                      ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {VAT_TYPE_LABELS[value]}
                </button>
              ))}
              {vatType !== "NO_VAT" && (
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-sm text-gray-500">อัตรา</span>
                  <input
                    type="number"
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value))}
                    min={0}
                    max={100}
                    step={0.01}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm text-center"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {cnType === "RETURN" ? (
          <div className="mt-4 flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>รับคืนสินค้าเข้าสโต๊ก และถ้าเป็นสินค้า Lot Control ต้องระบุ Lot ของสินค้าที่รับคืนด้วย</span>
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>ไม่กระทบสต็อก เหมาะสำหรับส่วนลดราคาและรายการอื่น ๆ ที่ไม่รับสินค้าคืน</span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">รายการสินค้า</h2>
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors"
          >
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
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-36">ราคาขาย/หน่วย</th>
                <th className="text-right py-2 px-2 text-gray-500 font-medium w-28">รวม</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const units = getUnits(item.productId);
                const product = productMap.get(item.productId);
                const showLots = cnType === "RETURN" && !!product?.isLotControl;

                return (
                  <>
                    <tr key={`item-${i}`} className="border-b border-gray-50">
                      <td className="py-2 px-2">
                        <ProductSearchSelect
                          products={productOptions}
                          value={item.productId}
                          onChange={(id) => {
                            if (!id) clearItemProduct(i);
                          }}
                          onProductSelect={(productOption) => applySelectedProduct(i, productOption)}
                          selectedProduct={productMap.get(item.productId) ?? null}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <select
                          value={item.unitName}
                          onChange={(e) => updateItem(i, "unitName", e.target.value)}
                          disabled={!item.productId}
                          className={`${inputCls} bg-white`}
                        >
                          <option value="">-- โปรดระบุ --</option>
                          {units.map((unit) => (
                            <option key={unit.name} value={unit.name}>
                              {unit.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          value={item.qty}
                          min={0.0001}
                          step={0.0001}
                          onChange={(e) => updateItem(i, "qty", Number(e.target.value))}
                          className={inputCls}
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          value={item.salePrice}
                          min={0}
                          step={0.01}
                          onChange={(e) => updateItem(i, "salePrice", Number(e.target.value))}
                          className={inputCls}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="py-2 px-2 text-right font-medium text-gray-700">
                        {(item.qty * item.salePrice).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-2">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(i)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {showLots && (
                      <tr key={`lot-${i}`} className="bg-amber-50/60 border-b border-gray-50">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-medium text-amber-800">Lot Control</div>
                            <button
                              type="button"
                              onClick={() => addLotRow(i)}
                              className="text-xs text-amber-700 hover:text-amber-900"
                            >
                              เพิ่ม Lot
                            </button>
                          </div>
                          <div className="space-y-2">
                            {item.lotItems.map((lot, lotIdx) => (
                              <div key={`${i}-${lotIdx}`} className="grid grid-cols-1 md:grid-cols-[2fr_110px_120px_120px_130px_130px_40px_32px] gap-2 items-center">
                                <input
                                  type="text"
                                  value={lot.lotNo}
                                  onChange={(e) => updateLotRow(i, lotIdx, "lotNo", e.target.value)}
                                  className={inputCls}
                                  placeholder="Lot No"
                                />
                                <label className="flex items-center gap-2 text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={lot.isReturnLot}
                                    onChange={(e) => updateLotRow(i, lotIdx, "isReturnLot", e.target.checked)}
                                  />
                                  Return Lot
                                </label>
                                <input
                                  type="number"
                                  value={lot.qty}
                                  min={0.0001}
                                  step={0.0001}
                                  onChange={(e) => updateLotRow(i, lotIdx, "qty", Number(e.target.value))}
                                  className={inputCls}
                                />
                                <input
                                  type="number"
                                  value={lot.unitCost}
                                  min={0}
                                  step={0.01}
                                  onChange={(e) => updateLotRow(i, lotIdx, "unitCost", Number(e.target.value))}
                                  className={inputCls}
                                />
                                <input
                                  type="date"
                                  value={lot.mfgDate}
                                  onChange={(e) => updateLotRow(i, lotIdx, "mfgDate", e.target.value)}
                                  className={inputCls}
                                />
                                <input
                                  type="date"
                                  value={lot.expDate}
                                  onChange={(e) => updateLotRow(i, lotIdx, "expDate", e.target.value)}
                                  className={inputCls}
                                />
                                <div className="text-[11px] text-gray-500">
                                  {lot.isReturnLot ? "จะบันทึกเป็น RET-lot" : "จะ merge กลับ lot เดิม"}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeLotRow(i, lotIdx)}
                                  className="text-red-400 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-100">
                <td colSpan={4} className="py-2 px-2 text-right text-sm text-gray-500">ยอดรวม</td>
                <td className="py-2 px-2 text-right text-gray-700">
                  {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              {vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={4} className="py-1 px-2 text-right text-sm text-gray-500">ยอดก่อนภาษี</td>
                    <td className="py-1 px-2 text-right text-gray-700">
                      {subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={4} className="py-1 px-2 text-right text-sm text-gray-500">VAT {vatRate}%</td>
                    <td className="py-1 px-2 text-right text-gray-700">
                      +{vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </>
              )}
              <tr className="border-t border-gray-200">
                <td colSpan={4} className="py-3 px-2 text-right text-sm font-medium text-gray-600">ยอดรวม CN</td>
                <td className="py-3 px-2 text-right font-bold text-gray-900">
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
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึก Credit Note"}
        </button>
      </div>
    </form>
  );
};

export default CreditNoteForm;
