"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSale, updateSale } from "../actions";
import { Plus, Trash2, CheckCircle, Zap } from "lucide-react";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { validateLotRows, autoAllocateLots, type LotSubRow, type LotAvailableJSON } from "@/lib/lot-control-client";
import { fetchProductLots } from "../actions";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  salePrice: number;
  saleUnitName: string;
  warrantyDays: number;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  units: { name: string; scale: number; isBase: boolean }[];
  preferredSupplierId:   string | null;
  preferredSupplierName: string | null;
  isLotControl:      boolean;
  lotIssueMethod:    string;
  allowExpiredIssue: boolean;
}

interface SupplierOption {
  id:   string;
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

interface CustomerOption {
  id:              string;
  name:            string;
  phone:           string | null;
  code:            string | null;
  shippingAddress: string | null;
  creditTerm:      number | null;
}

interface LineItem {
  productId:    string;
  unitName:     string;
  qty:          number;
  salePrice:    number;
  warrantyDays: number;
  supplierId:   string;
  supplierName: string;
  lotItems:     LotSubRow[];
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const emptyItem = (): LineItem => ({ productId: "", unitName: "", qty: 1, salePrice: 0, warrantyDays: 0, supplierId: "", supplierName: "", lotItems: [] });

interface InitialData {
  id:              string;
  saleDate:        string;
  customerId:      string;
  customerName:    string;
  customerPhone:   string;
  saleType:        string;
  paymentType:     "CASH_SALE" | "CREDIT_SALE";
  paymentMethod:   string;
  cashBankAccountId: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  shippingAddress: string;
  shippingFee:     number;
  shippingMethod:  string;
  discount:        number;
  note:            string;
  vatType:         string;
  vatRate:         number;
  creditTerm:      number | null;
  items:           (LineItem & { lotItems: LotSubRow[] })[];
}

const SaleForm = ({
  products,
  suppliers,
  cashBankAccounts,
  customers,
  defaultVatType,
  defaultVatRate,
  initialData,
  editableLotOnEdit = false,
  initialAvailableLots = {},
}: {
  products:       ProductOption[];
  suppliers:      SupplierOption[];
  cashBankAccounts: CashBankAccountOption[];
  customers:      CustomerOption[];
  defaultVatType: string;
  defaultVatRate: number;
  initialData?:   InitialData;
  editableLotOnEdit?: boolean;
  initialAvailableLots?: Record<number, LotAvailableJSON[]>;
}) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const showReadonlyLots = isEdit && !editableLotOnEdit;
  const [isPending, startTransition] = useTransition();
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");
  const [items, setItems]         = useState<LineItem[]>(initialData?.items ?? [emptyItem()]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialData?.customerId ?? "");
  const [customerNameOverride, setCustomerNameOverride] = useState(initialData?.customerName ?? "");
  const [customerPhoneOverride, setCustomerPhoneOverride] = useState(initialData?.customerPhone ?? "");
  const [creditTerm, setCreditTerm] = useState<number>(initialData?.creditTerm ?? 0);
  const [discount, setDiscount] = useState(initialData?.discount ?? 0);

  const [paymentType, setPaymentType] = useState<"CASH_SALE" | "CREDIT_SALE">(initialData?.paymentType ?? "CASH_SALE");
  const [cashBankAccountId, setCashBankAccountId] = useState(initialData?.cashBankAccountId ?? "");
  const [fulfillmentType, setFulfillmentType] = useState<"PICKUP" | "DELIVERY">(initialData?.fulfillmentType ?? "PICKUP");
  const [shippingAddress, setShippingAddress] = useState(initialData?.shippingAddress ?? "");
  const [shippingFee, setShippingFee]         = useState(initialData?.shippingFee ?? 0);
  const [shippingMethod, setShippingMethod]   = useState<string>(initialData?.shippingMethod ?? "NONE");

  const [vatType, setVatType] = useState<string>(initialData?.vatType ?? defaultVatType);
  const [vatRate, setVatRate] = useState<number>(initialData?.vatRate ?? defaultVatRate);
  const [availableLots, setAvailableLots] = useState<Record<number, LotAvailableJSON[]>>(initialAvailableLots);
  const [lotsLoading, setLotsLoading]     = useState<Record<number, boolean>>({});
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const productMap = new Map(productOptions.map((product) => [product.id, product]));
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));

  const loadLots = async (itemIdx: number, productId: string, lotIssueMethod: string) => {
    setLotsLoading((prev) => ({ ...prev, [itemIdx]: true }));
    const result = await fetchProductLots(productId, lotIssueMethod);
    if (!("error" in result)) setAvailableLots((prev) => ({ ...prev, [itemIdx]: result }));
    setLotsLoading((prev) => ({ ...prev, [itemIdx]: false }));
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const clearCachedLots = (itemIndex: number) => {
    setAvailableLots((prev) => {
      const next = { ...prev };
      delete next[itemIndex];
      return next;
    });
  };

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
    clearCachedLots(itemIndex);
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIndex
          ? item
          : {
              ...item,
              productId: "",
              unitName: "",
              salePrice: 0,
              warrantyDays: 0,
              supplierId: "",
              supplierName: "",
              lotItems: [],
            },
      ),
    );
  };

  const applySelectedProduct = (itemIndex: number, product: ProductOption) => {
    rememberProduct(product);
    clearCachedLots(itemIndex);
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIndex
          ? item
          : {
              ...item,
              productId: product.id,
              unitName: product.saleUnitName ?? "",
              salePrice: product.salePrice ?? 0,
              warrantyDays: product.warrantyDays ?? 0,
              supplierId: product.preferredSupplierId ?? "",
              supplierName: product.preferredSupplierName ?? "",
              lotItems: product.isLotControl
                ? [{ lotNo: "", qty: item.qty, unitCost: 0, mfgDate: "", expDate: "" }]
                : [],
            },
      ),
    );
    if (product.isLotControl) {
      void loadLots(itemIndex, product.id, product.lotIssueMethod);
    }
  };

  const updateItem = (i: number, field: keyof Omit<LineItem, "lotItems">, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const updated = { ...item, [field]: value };
        if (field === "qty" && item.productId) {
          const prod = productMap.get(item.productId);
          if (prod?.isLotControl && updated.lotItems.length === 1) {
            updated.lotItems = [{ ...updated.lotItems[0], qty: Number(value) }];
          }
        }
        return updated;
      })
    );
  };

  const handleLotSelect = (itemIdx: number, lotIdx: number, lotNo: string) => {
    const item = items[itemIdx];
    const prod = productMap.get(item.productId);
    const scale = prod?.units.find((u) => u.name === item.unitName)?.scale ?? 1;
    const av = (availableLots[itemIdx] ?? []).find((l) => l.lotNo === lotNo);
    // qty already used by other lot rows
    const usedQty = item.lotItems.reduce((s, l, li) => li !== lotIdx ? s + l.qty : s, 0);
    const remaining = Math.max(0, item.qty - usedQty);
    const availInUnit = av ? Math.round((av.qtyOnHand / scale) * 10000) / 10000 : 0;
    setItems((prev) => prev.map((it, idx) => {
      if (idx !== itemIdx) return it;
      return {
        ...it,
        lotItems: it.lotItems.map((l, li) =>
          li !== lotIdx ? l : {
            lotNo:    lotNo,
            qty:      av ? Math.min(availInUnit, remaining) : 0,
            unitCost: av ? av.unitCost * scale : 0,
            mfgDate:  av?.mfgDate ?? "",
            expDate:  av?.expDate ?? "",
          }
        ),
      };
    }));
  };

  const updateItemSupplier = (i: number, supplierId: string) => {
    const supplier = supplierMap.get(supplierId);
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== i ? item : { ...item, supplierId, supplierName: supplier?.name ?? "" }
      )
    );
  };

  const addLotRow = (itemIdx: number) => {
    setItems((prev) => prev.map((item, idx) => {
      if (idx !== itemIdx) return item;
      return { ...item, lotItems: [...item.lotItems, { lotNo: "", qty: 0, unitCost: 0, mfgDate: "", expDate: "" }] };
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

  const handleAutoAllocate = async (itemIdx: number) => {
    const item = items[itemIdx];
    const prod = productMap.get(item.productId);
    if (!prod?.isLotControl) return;
    const scale = prod.units.find((u) => u.name === item.unitName)?.scale ?? 1;
    let available = availableLots[itemIdx];
    if (!available) {
      const result = await fetchProductLots(item.productId, prod.lotIssueMethod);
      if ("error" in result) return;
      available = result;
      setAvailableLots((prev) => ({ ...prev, [itemIdx]: available }));
    }
    const allocated = autoAllocateLots(available, item.qty, scale);
    setItems((prev) => prev.map((it, idx) => idx !== itemIdx ? it : { ...it, lotItems: allocated }));
  };

  const getUnits = (productId: string) =>
    productMap.get(productId)?.units ?? [];

  const totalAmount = items.reduce((sum, it) => sum + it.qty * it.salePrice, 0);
  const effectiveShippingFee = fulfillmentType === "DELIVERY" ? shippingFee : 0;
  const discountedTotal = Math.max(0, totalAmount + effectiveShippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType as VatType, vatRate);

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId) {
      const found = customerMap.get(customerId);
      setCustomerNameOverride(found?.name ?? "");
      setCustomerPhoneOverride(found?.phone ?? "");
      setShippingAddress(found?.shippingAddress ?? "");
      setCreditTerm(found?.creditTerm ?? 0);
    } else {
      setCustomerNameOverride("");
      setCustomerPhoneOverride("");
      setShippingAddress("");
      setCreditTerm(0);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!selectedCustomerId) { setError("กรุณาเลือกลูกค้า"); return; }

    for (const item of items) {
      if (!item.productId) { setError("กรุณาเลือกสินค้าทุกรายการ"); return; }
      if (!item.unitName)  { setError("กรุณาเลือกหน่วยนับทุกรายการ"); return; }
      if (item.qty <= 0)   { setError("จำนวนต้องมากกว่า 0"); return; }
      const prod = productMap.get(item.productId);
      if (prod?.isLotControl) {
        const lotErr = validateLotRows(item.lotItems, item.qty, false);
        if (lotErr) { setError(lotErr); return; }
      }
    }

    if (fulfillmentType === "DELIVERY" && !shippingAddress.trim()) {
      setError("กรุณาระบุที่อยู่จัดส่ง");
      return;
    }

    if (fulfillmentType === "DELIVERY" && shippingMethod === "NONE") {
      setError("กรุณาเลือกประเภทขนส่ง");
      return;
    }
    if (paymentType === "CASH_SALE" && !cashBankAccountId) {
      setError("กรุณาเลือกบัญชีรับเงิน");
      return;
    }

    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("items", JSON.stringify(items));
    formData.set("fulfillmentType", fulfillmentType);
    formData.set("shippingAddress", fulfillmentType === "DELIVERY" ? shippingAddress : "");
    formData.set("shippingFee", String(effectiveShippingFee));
    formData.set("shippingMethod", fulfillmentType === "DELIVERY" ? shippingMethod : "NONE");
    formData.set("cashBankAccountId", cashBankAccountId);
    formData.set("vatType", vatType);
    formData.set("vatRate", String(vatRate));

    startTransition(async () => {
      if (isEdit && initialData) {
        const result = await updateSale(initialData.id, formData);
        if (result.error) setError(result.error);
        else router.push("/admin/sales");
      } else {
        const result = await createSale(formData);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess(`บันทึกสำเร็จ เลขที่ใบขาย: ${result.saleNo}`);
          setTimeout(() => router.push("/admin/sales"), 1500);
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลการขาย
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>
              วันที่ขาย <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="saleDate"
              required
              defaultValue={initialData?.saleDate ?? new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>ลูกค้า</label>
            <SearchableSelect
              options={customers.map((c): SelectOption => ({
                id: c.id,
                label: c.name,
                sublabel: c.code ?? undefined,
              }))}
              value={selectedCustomerId}
              onChange={handleCustomerChange}
              placeholder="โปรดระบุลูกค้า"
            />
            <input type="hidden" name="customerId" value={selectedCustomerId} />
          </div>
          <div>
            <label className={labelCls}>ประเภทการขาย</label>
            <select name="saleType" defaultValue={initialData?.saleType ?? "RETAIL"} className={`${inputCls} bg-white`}>
              <option value="RETAIL">ขายปลีก</option>
              <option value="WHOLESALE">ขายส่ง</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>ชื่อลูกค้า</label>
            <input
              type="text"
              name="customerName"
              maxLength={100}
              value={customerNameOverride}
              onChange={(e) => setCustomerNameOverride(e.target.value)}
              className={inputCls}
              placeholder="ไม่ระบุ (หรือพิมพ์ชื่อเอง)"
            />
          </div>
          <div>
            <label className={labelCls}>เบอร์โทร</label>
            <input
              type="tel"
              name="customerPhone"
              maxLength={20}
              value={customerPhoneOverride}
              onChange={(e) => setCustomerPhoneOverride(e.target.value)}
              className={inputCls}
              placeholder="ไม่ระบุ"
            />
          </div>
          <div>
            <label className={labelCls}>เครดิต (วัน)</label>
            <AdminNumberInput
              name="creditTerm"
              min={0}
              max={365}
              value={creditTerm}
              onValueChange={setCreditTerm}
              className={inputCls}
              placeholder="0 = เงินสด, ว่าง = ไม่กำหนด"
            />
          </div>
          <div>
            <label className={labelCls}>ประเภทการชำระ</label>
            <input type="hidden" name="paymentType" value={paymentType} />
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setPaymentType("CASH_SALE")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  paymentType === "CASH_SALE"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ขายสด
              </button>
              <button
                type="button"
                onClick={() => setPaymentType("CREDIT_SALE")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${
                  paymentType === "CREDIT_SALE"
                    ? "bg-orange-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ขายเชื่อ
              </button>
            </div>
          </div>
          {paymentType === "CASH_SALE" ? (
          <div>
            <label className={labelCls}>
              บัญชีรับเงิน <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={cashBankAccounts.map((account): SelectOption => ({
                id: account.id,
                label: account.name,
                sublabel: [account.code, account.type === "BANK" ? account.bankName : "เงินสด", account.accountNo].filter(Boolean).join(" | ") || undefined,
              }))}
              value={cashBankAccountId}
              onChange={setCashBankAccountId}
              placeholder="โปรดระบุบัญชีรับเงิน"
            />
            <p className="mt-1 text-xs text-gray-500">ระบบจะระบุช่องทางรับเงินจากประเภทบัญชีให้อัตโนมัติ</p>
          </div>
          ) : (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
            ขายเชื่อจะยังไม่สร้างรายการเงินรับ และไม่ต้องระบุบัญชีรับเงิน
          </div>
          )}
          <div>
            <label className={labelCls}>ส่วนลดรวม (บาท)</label>
            <AdminNumberInput
              name="discount"
              min={0}
              step={0.01}
              value={discount}
              onValueChange={setDiscount}
              className={inputCls}
            />
          </div>
          <div>
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
                  <AdminNumberInput
                    value={vatRate}
                    onValueChange={setVatRate}
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

      {/* Fulfillment section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          การจัดส่ง
        </h2>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 w-24 shrink-0">การจัดส่ง</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setFulfillmentType("PICKUP")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  fulfillmentType === "PICKUP"
                    ? "bg-[#1e3a5f] text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                หน้าร้าน (รับเอง)
              </button>
              <button
                type="button"
                onClick={() => setFulfillmentType("DELIVERY")}
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${
                  fulfillmentType === "DELIVERY"
                    ? "bg-purple-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                จัดส่ง
              </button>
            </div>
          </div>

          {paymentType === "CREDIT_SALE" && fulfillmentType === "DELIVERY" && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ขายเชื่อ + จัดส่ง: ระบบจะเปิดยอดค้างชำระใน AR และค่อยบันทึกใบเสร็จเมื่อได้รับเงินจริง
            </p>
          )}

          {fulfillmentType === "DELIVERY" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="md:col-span-2">
                <label className={labelCls}>
                  ที่อยู่จัดส่ง <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  className={inputCls}
                  placeholder="ที่อยู่จัดส่งสินค้า"
                />
              </div>
              <div>
                <label className={labelCls}>ค่าจัดส่ง (บาท)</label>
                <AdminNumberInput
                  min={0}
                  step={0.01}
                  value={shippingFee}
                  onValueChange={setShippingFee}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>ประเภทขนส่ง</label>
                <select value={shippingMethod} onChange={(e) => setShippingMethod(e.target.value)} className={`${inputCls} bg-white`}>
                  <option value="NONE">-- ไม่ระบุ --</option>
                  <option value="SELF">ส่งเอง</option>
                  <option value="KERRY">Kerry</option>
                  <option value="FLASH">Flash</option>
                  <option value="JT">J&T</option>
                  <option value="OTHER">อื่น ๆ</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
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
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-28">
                  ประกัน (วัน)
                  <span className="block text-xs font-normal text-gray-400">0 = ไม่มี</span>
                </th>
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
                  <>
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
                      {item.productId && (
                        <div className="mt-1">
                          <SearchableSelect
                            options={[
                              { id: "", label: "-- ไม่ระบุซัพพลายเออร์ --" },
                              ...suppliers.map((s): SelectOption => ({ id: s.id, label: s.name })),
                            ]}
                            value={item.supplierId}
                            onChange={(id) => updateItemSupplier(i, id)}
                            placeholder="ซัพพลายเออร์"
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={item.unitName}
                        onChange={(e) => updateItem(i, "unitName", e.target.value)}
                        disabled={!item.productId}
                        className={`${inputCls} bg-white`}
                      >
                          <option value="">-- โปรดระบุ --</option>
                        {units.map((u) => (
                          <option key={u.name} value={u.name}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <AdminNumberInput
                        value={item.qty}
                        min={0.0001}
                        step={0.0001}
                        onValueChange={(value) => updateItem(i, "qty", value)}
                        className={inputCls}
                      />
                    </td>
                    <td className="py-2 px-2">
                      <AdminNumberInput
                        value={item.salePrice}
                        min={0}
                        step={0.01}
                        onValueChange={(value) => updateItem(i, "salePrice", value)}
                        className={inputCls}
                        placeholder="0.00"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <AdminNumberInput
                        value={item.warrantyDays}
                        min={0}
                        step={1}
                        onValueChange={(value) => updateItem(i, "warrantyDays", value)}
                        className={`${inputCls} ${item.warrantyDays > 0 ? "border-green-400 bg-green-50" : ""}`}
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 px-2 text-right font-medium text-gray-700">
                      {(item.qty * item.salePrice).toLocaleString("th-TH", {
                        minimumFractionDigits: 2,
                      })}
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
                  {isLot && (
                    <tr key={`lot-${i}`} className="bg-amber-50/60">
                      <td colSpan={7} className="px-4 pb-3 pt-1">
                        {/* Lot header */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300">
                            Lot Control
                          </span>
                          {!showReadonlyLots && (
                            <>
                              <span className="text-xs text-gray-500">จัดสรรรวม</span>
                              <span className={`text-xs font-semibold ${lotQtyMatch ? "text-green-600" : "text-red-600"}`}>
                                {totalLotQty}
                              </span>
                              <span className="text-xs text-gray-400">/ {item.qty} {item.unitName}</span>
                              {!lotQtyMatch && <span className="text-xs text-red-500">จำนวน Lot ยังไม่ครบ</span>}
                              <button
                                type="button"
                                onClick={() => handleAutoAllocate(i)}
                                className="ml-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 bg-indigo-50 px-2 py-0.5 rounded transition-colors"
                              >
                                <Zap size={11} /> Auto จัดสรร
                              </button>
                              {lotsLoading[i] && <span className="text-xs text-gray-400 animate-pulse">กำลังโหลด...</span>}
                            </>
                          )}
                        </div>
                        {/* Lot rows */}
                        {showReadonlyLots ? (
                          /* Read-only display in edit mode */
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
                                    <span className="text-gray-300">|</span>
                                    <span className="text-gray-500">EXP</span>
                                    <span className="text-gray-700">
                                      {new Date(lot.expDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                    </span>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {item.lotItems.map((lot, li) => {
                              const scale = prod?.units.find((u) => u.name === item.unitName)?.scale ?? 1;
                              const selectedLotNos = item.lotItems.filter((_, lj) => lj !== li).map((l) => l.lotNo);
                              const lotOptions = (availableLots[i] ?? []).filter(
                                (av) => av.lotNo === lot.lotNo || !selectedLotNos.includes(av.lotNo)
                              );
                              return (
                                <div key={li} className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-2 py-1.5">
                                  <div className="flex-1 min-w-0">
                                    <select
                                      value={lot.lotNo}
                                      onChange={(e) => handleLotSelect(i, li, e.target.value)}
                                      className="w-full px-2 py-1 border border-amber-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                                    >
                                      <option value="">-- เลือก Lot --</option>
                                      {lotOptions.length === 0 && lot.lotNo === "" && (
                                        <option disabled value="">ไม่มี Lot คงเหลือ</option>
                                      )}
                                      {lotOptions.map((av) => {
                                        const qtyInUnit = Math.round((av.qtyOnHand / scale) * 10000) / 10000;
                                        const expStr = av.expDate
                                          ? new Date(av.expDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })
                                          : "ไม่มี EXP";
                                        return (
                                          <option key={av.lotNo} value={av.lotNo}>
                                            {av.lotNo} | EXP {expStr} | คงเหลือ {qtyInUnit} {item.unitName}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </div>
                                  <div className="w-24 shrink-0">
                                    <AdminNumberInput
                                      value={lot.qty}
                                      min={0.0001} step={0.0001}
                                      onValueChange={(value) => updateLotRow(i, li, "qty", value)}
                                      className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 text-right"
                                      placeholder="จำนวน"
                                    />
                                  </div>
                                  {lot.expDate && (
                                    <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">
                                      EXP {new Date(lot.expDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                                    </span>
                                  )}
                                  {item.lotItems.length > 1 && (
                                    <button type="button" onClick={() => removeLotRow(i, li)}
                                      className="text-red-400 hover:text-red-600 shrink-0">
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {!showReadonlyLots && (
                          <button
                            type="button"
                            onClick={() => addLotRow(i)}
                            className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 px-2 py-1 rounded transition-colors"
                          >
                            <Plus size={11} /> เพิ่ม Lot
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals summary */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>ยอดรวม</span>
              <span className="font-medium">
                {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {fulfillmentType === "DELIVERY" && shippingFee > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>ค่าจัดส่ง</span>
                <span className="font-medium text-purple-600">
                  +{shippingFee.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>ส่วนลด</span>
              <span className="font-medium text-red-500">
                -{discount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {vatType !== "NO_VAT" && (
              <>
                <div className="flex justify-between text-gray-600">
                  <span>ยอดก่อนภาษี</span>
                  <span className="font-medium">
                    {subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>VAT {vatRate}%</span>
                  <span className="font-medium">
                    +{vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-gray-200 pt-2 font-semibold text-gray-900">
              <span>ยอดสุทธิ</span>
              <span className="text-[#1e3a5f]">
                {netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
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
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              กำลังบันทึก...
            </span>
          ) : isEdit ? "บันทึกการแก้ไข" : "บันทึกการขาย"}
        </button>
      </div>
    </form>
  );
};

export default SaleForm;

