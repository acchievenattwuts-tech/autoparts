"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPurchase, loadPurchaseProductsByIds, searchPurchaseProducts, updatePurchase } from "../actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import { PurchaseType } from "@/lib/generated/prisma";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import PaymentChannelsInput, { type PaymentChannelRow } from "@/components/shared/PaymentChannelsInput";
import PurchaseInvoiceUploader, { type AppliedOcrItem } from "./PurchaseInvoiceUploader";
import { validateLotRows, type LotSubRow } from "@/lib/lot-control-client";
import { getThailandDateKey } from "@/lib/th-date";
import {
  buildPurchaseDraft,
  getPurchaseDraftKey,
  parsePurchaseDraft,
  sanitizePurchaseItemsForSubmit,
  type PurchaseDraftPayload,
  type PurchaseFormLineItem,
  type PurchaseProductOption,
} from "../purchase-form-data";

type ProductOption = PurchaseProductOption;

interface SupplierOption { id: string; name: string; creditTerm?: number | null; isActive?: boolean }

interface CashBankAccountOption {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
}

interface LineItem extends Omit<PurchaseFormLineItem, "lotItems"> {
  lotItems: LotSubRow[];
}

interface InitialData {
  id:           string;
  purchaseDate: string;
  supplierId:   string;
  purchaseType: PurchaseType;
  cashBankAccountId: string;
  payments?:    PaymentChannelRow[];
  referenceNo:  string;
  discount:     number;
  shippingFee:  number;
  note:         string;
  vatType:      string;
  vatRate:      number;
  creditTerm?:  number | null;
  items:        LineItem[];
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";

const PurchaseForm = ({
  products,
  suppliers,
  cashBankAccounts,
  defaultVatType,
  defaultVatRate,
  initialData,
  editableLotOnEdit = false,
  submitLocked = false,
}: {
  products: ProductOption[];
  suppliers: SupplierOption[];
  cashBankAccounts: CashBankAccountOption[];
  defaultVatType: string;
  defaultVatRate: number;
  initialData?: InitialData;
  editableLotOnEdit?: boolean;
  submitLocked?: boolean;
}) => {
  const isEdit = !!initialData;
  const showReadonlyLots = isEdit && !editableLotOnEdit;
  const [isPending, startTransition] = useTransition();
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [availableDraft, setAvailableDraft] = useState<PurchaseDraftPayload | null>(null);
  const [persistedPurchaseId, setPersistedPurchaseId] = useState(initialData?.id ?? "");
  const [purchaseDate, setPurchaseDate] = useState(initialData?.purchaseDate ?? getThailandDateKey());
  const [referenceNo, setReferenceNo] = useState(initialData?.referenceNo ?? "");
  const [note, setNote] = useState(initialData?.note ?? "");
  const [supplierId, setSupplierId] = useState(initialData?.supplierId ?? "");
  const [purchaseType, setPurchaseType] = useState<PurchaseType>(
    initialData?.purchaseType ?? PurchaseType.CASH_PURCHASE,
  );
  const [payments, setPayments] = useState<PaymentChannelRow[]>(
    initialData?.payments && initialData.payments.length > 0
      ? initialData.payments
      : initialData?.cashBankAccountId
        ? [{ cashBankAccountId: initialData.cashBankAccountId, amount: 0 }]
        : [{ cashBankAccountId: "", amount: 0 }],
  );
  const primaryAccountId = payments[0]?.cashBankAccountId ?? "";
  const [creditTerm, setCreditTerm] = useState<string>(
    initialData?.creditTerm != null ? String(initialData.creditTerm) : "",
  );
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const handleSupplierChange = (nextId: string) => {
    setSupplierId(nextId);
    if (initialData) return;
    const sup = supplierMap.get(nextId);
    if (sup && sup.creditTerm != null) setCreditTerm(String(sup.creditTerm));
  };
  const [discount, setDiscount] = useState(initialData?.discount ?? 0);
  const [shippingFee, setShippingFee] = useState(initialData?.shippingFee ?? 0);
  const [items, setItems]     = useState<LineItem[]>(
    initialData?.items ?? [{ productId: "", unitName: "", qty: 1, costPrice: 0, landedCost: 0, moreDetail: "", lotItems: [] }]
  );
  const [vatType, setVatType] = useState<string>(initialData?.vatType ?? defaultVatType);
  const [vatRate, setVatRate] = useState<number>(initialData?.vatRate ?? defaultVatRate);
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const productMap = new Map(productOptions.map((product) => [product.id, product]));
  const draftKey = getPurchaseDraftKey(
    persistedPurchaseId ? { mode: "edit", purchaseId: persistedPurchaseId } : { mode: "new" },
  );
  const lastPersistedDraftRef = useRef("");

  const getDraftSnapshot = useCallback(() =>
    JSON.stringify({
      purchaseDate,
      supplierId,
      purchaseType,
      payments,
      referenceNo,
      discount,
      shippingFee,
      note,
      vatType,
      vatRate,
      creditTerm,
      items,
    }), [payments, creditTerm, discount, items, note, purchaseDate, purchaseType, referenceNo, shippingFee, supplierId, vatRate, vatType]);

  const applyDraft = async (draft: PurchaseDraftPayload) => {
    const missingProductIds = [...new Set(draft.items.map((item) => item.productId).filter(Boolean))]
      .filter((productId) => !productOptions.some((product) => product.id === productId));
    if (missingProductIds.length > 0) {
      const restoredProducts = await loadPurchaseProductsByIds(missingProductIds);
      if (restoredProducts.length !== missingProductIds.length) {
        setError("โหลดข้อมูลสินค้าจาก draft ไม่ครบ กรุณาลองใหม่");
        return;
      }
      setProductOptions((current) => {
        const merged = new Map(current.map((product) => [product.id, product]));
        restoredProducts.forEach((product) => merged.set(product.id, product));
        return [...merged.values()];
      });
    }
    setPurchaseDate(draft.purchaseDate);
    setSupplierId(draft.supplierId);
    setPurchaseType(draft.purchaseType as PurchaseType);
    setPayments(
      draft.payments && draft.payments.length > 0
        ? draft.payments
        : draft.cashBankAccountId
          ? [{ cashBankAccountId: draft.cashBankAccountId, amount: 0 }]
          : [{ cashBankAccountId: "", amount: 0 }],
    );
    setReferenceNo(draft.referenceNo);
    setDiscount(draft.discount);
    setShippingFee(draft.shippingFee);
    setNote(draft.note);
    setVatType(draft.vatType);
    setVatRate(draft.vatRate);
    setCreditTerm(draft.creditTerm);
    setItems(draft.items as LineItem[]);
    setAvailableDraft(null);
    setDraftStatus("กู้คืน draft แล้ว");
  };

  useEffect(() => {
    lastPersistedDraftRef.current = getDraftSnapshot();
    const draft = parsePurchaseDraft(window.localStorage.getItem(draftKey), persistedPurchaseId ? { mode: "edit", purchaseId: persistedPurchaseId } : { mode: "new" });
    if (draft) {
      setAvailableDraft(draft);
      setDraftStatus(`พบ draft ล่าสุด ${new Date(draft.updatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`);
    }
    // Run once per loaded form context; user edits are handled by the autosave effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    const snapshot = getDraftSnapshot();
    if (snapshot === lastPersistedDraftRef.current) return;

    setDraftStatus("กำลังบันทึก draft...");
    const timeout = window.setTimeout(() => {
      try {
        const draft = buildPurchaseDraft({
          mode: persistedPurchaseId ? "edit" : "new",
          purchaseId: persistedPurchaseId || null,
          purchaseDate,
          supplierId,
          purchaseType,
          cashBankAccountId: primaryAccountId,
          payments,
          referenceNo,
          discount,
          shippingFee,
          note,
          vatType,
          vatRate,
          creditTerm,
          items,
        });
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
        lastPersistedDraftRef.current = snapshot;
        setDraftStatus(`Draft saved ${new Date(draft.updatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`);
      } catch {
        setDraftStatus("บันทึก draft ไม่สำเร็จ");
      }
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [primaryAccountId, payments, creditTerm, discount, draftKey, getDraftSnapshot, items, note, persistedPurchaseId, purchaseDate, purchaseType, referenceNo, shippingFee, supplierId, vatRate, vatType]);

  const addItem = () =>
    setItems((prev) => [...prev, { productId: "", unitName: "", qty: 1, costPrice: 0, landedCost: 0, moreDetail: "", lotItems: [] }]);

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

  // Merge AI-extracted invoice lines into the item list. Mirrors applySelectedProduct
  // (unit/cost/lot seeding) but never fills lot number / mfg / exp — the admin must
  // enter those. qty/cost fall back to product default when OCR left them blank.
  const mergeOcrItems = (ocrItems: AppliedOcrItem[], chosenProducts: ProductOption[]) => {
    chosenProducts.forEach(rememberProduct);
    const productById = new Map(chosenProducts.map((product) => [product.id, product]));
    const newLines: LineItem[] = ocrItems.map((ocr) => {
      const product = productById.get(ocr.productId) ?? productMap.get(ocr.productId);
      const qty = ocr.qty > 0 ? ocr.qty : 1;
      const costPrice = ocr.unitCost > 0 ? ocr.unitCost : product?.costPrice ?? 0;
      return {
        productId: ocr.productId,
        unitName: product?.purchaseUnitName ?? "",
        qty,
        costPrice,
        landedCost: 0,
        moreDetail: "",
        lotItems: product?.isLotControl
          ? [{ lotNo: "", qty, unitCost: costPrice, mfgDate: "", expDate: "" }]
          : [],
      };
    });
    setItems((prev) => {
      const onlyEmptyRow = prev.length === 1 && !prev[0].productId;
      return onlyEmptyRow ? newLines : [...prev, ...newLines];
    });
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
  const discountedTotal = Math.max(0, totalBeforeDiscount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType as VatType, vatRate);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setSuccess("");

    if (submitLocked) return;

    const formData = new FormData(e.currentTarget);

    if (!supplierId) { setError("กรุณาเลือกผู้จำหน่าย"); return; }

    let submitPayments: { cashBankAccountId: string; amount: number }[] = [];
    if (purchaseType === PurchaseType.CASH_PURCHASE) {
      const activePayments = payments.filter((row) => row.amount > 0);
      if (activePayments.length === 0) { setError("กรุณาระบุช่องทางจ่ายเงินอย่างน้อย 1 ช่องทาง"); return; }
      if (activePayments.some((row) => !row.cashBankAccountId)) { setError("กรุณาเลือกบัญชีให้ครบทุกช่องทางที่มียอดเงิน"); return; }
      const paymentsTotal = Math.round(activePayments.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      if (Math.abs(paymentsTotal - netAmount) > 0.005) {
        setError(`ยอดรวมช่องทางจ่ายเงินต้องเท่ากับยอดสุทธิ (${netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท)`);
        return;
      }
      submitPayments = activePayments.map((row) => ({ cashBankAccountId: row.cashBankAccountId, amount: row.amount }));
    }

    formData.set("supplierId", supplierId);
    formData.set("purchaseDate", purchaseDate);
    formData.set("purchaseType", purchaseType);
    formData.set("payments", JSON.stringify(submitPayments));
    formData.set("creditTerm", purchaseType === PurchaseType.CREDIT_PURCHASE ? creditTerm : "");
    formData.set("referenceNo", referenceNo);
    formData.set("note", note);

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
    formData.set("items", JSON.stringify(sanitizePurchaseItemsForSubmit(items)));
    formData.set("discount", String(discount));
    formData.set("shippingFee", String(shippingFee));
    formData.set("vatType", vatType);
    formData.set("vatRate", String(vatRate));

    startTransition(async () => {
      if (persistedPurchaseId) {
        const result = await updatePurchase(persistedPurchaseId, formData);
        if (result.error) setError(result.error);
        else {
          window.localStorage.removeItem(draftKey);
          lastPersistedDraftRef.current = getDraftSnapshot();
          setDraftStatus("");
          setSuccess("บันทึกการแก้ไขสำเร็จ");
        }
      } else {
        const result = await createPurchase(formData);
        if (result.error) setError(result.error);
        else {
          window.localStorage.removeItem(draftKey);
          if (result.purchaseId) {
            setPersistedPurchaseId(result.purchaseId);
            window.history.replaceState(null, "", `/admin/purchases/${result.purchaseId}/edit`);
          }
          lastPersistedDraftRef.current = getDraftSnapshot();
          setDraftStatus("");
          setSuccess(`บันทึกสำเร็จ เลขที่ใบซื้อ: ${result.purchaseNo}`);
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {availableDraft && (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <p>พบ draft ที่ยังไม่ได้บันทึกจริงจาก {new Date(availableDraft.updatedAt).toLocaleString("th-TH")}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void applyDraft(availableDraft)}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
            >
              กู้คืน draft
            </button>
            <button
              type="button"
              onClick={() => {
                window.localStorage.removeItem(draftKey);
                setAvailableDraft(null);
                setDraftStatus("");
              }}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-100 dark:hover:bg-amber-500/20"
            >
              ไม่ใช้ draft
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100 dark:text-sky-300 dark:border-white/10">
          ข้อมูลการซื้อ
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>วันที่ซื้อ <span className="text-red-500">*</span></label>
            <input type="date" name="purchaseDate" required
              value={purchaseDate}
              onChange={(event) => setPurchaseDate(event.target.value)}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ผู้จำหน่าย</label>
            <SearchableSelect
              options={suppliers.map((s): SelectOption => ({ id: s.id, label: s.name, disabled: s.isActive === false }))}
              value={supplierId}
              onChange={handleSupplierChange}
              placeholder="โปรดระบุผู้จำหน่าย"
            />
          </div>
          <div>
            <label className={labelCls}>เลขที่เอกสารอ้างอิง</label>
            <input
              type="text"
              name="referenceNo"
              maxLength={100}
              value={referenceNo}
              onChange={(event) => setReferenceNo(event.target.value)}
              className={inputCls}
              placeholder="เช่น เลขที่ใบกำกับของผู้จำหน่าย"
            />
          </div>
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
            <label className={labelCls}>ค่าจัดส่ง (บาท)</label>
            <AdminNumberInput
              name="shippingFee"
              min={0}
              step={0.01}
              value={shippingFee}
              onValueChange={setShippingFee}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              ระบบจะกระจายตามมูลค่าสินค้าก่อนส่วนลดและบันทึกเป็น landed cost
            </p>
          </div>
          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <input type="text" name="note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={inputCls} placeholder="หมายเหตุ" />
          </div>

          <div>
            <label className={labelCls}>ประเภทการซื้อ</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden dark:border-white/20">
              <button
                type="button"
                onClick={() => setPurchaseType(PurchaseType.CASH_PURCHASE)}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  purchaseType === PurchaseType.CASH_PURCHASE
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                ซื้อสด
              </button>
              <button
                type="button"
                onClick={() => setPurchaseType(PurchaseType.CREDIT_PURCHASE)}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 dark:border-white/20 ${
                  purchaseType === PurchaseType.CREDIT_PURCHASE
                    ? "bg-orange-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                ซื้อเชื่อ
              </button>
            </div>
          </div>
          {purchaseType === PurchaseType.CASH_PURCHASE ? (
            <div>
              <PaymentChannelsInput
                accounts={cashBankAccounts}
                value={payments}
                onChange={setPayments}
                targetAmount={netAmount}
                label="ช่องทางจ่ายเงิน"
                placeholder="โปรดระบุบัญชีจ่ายเงิน"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">ระบบจะลงรายการเงินออกจากบัญชีเหล่านี้ให้อัตโนมัติ</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className={labelCls}>เครดิตเทอม (วัน)</label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={creditTerm}
                  onChange={(e) => setCreditTerm(e.target.value)}
                  placeholder="เช่น 30"
                  className={inputCls}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">ระบบจะดึงค่าเริ่มต้นจากผู้จำหน่าย ถ้าไม่ระบุจะถือว่าครบกำหนด ณ วันที่ซื้อ</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300">
                ซื้อเชื่อจะยังไม่ตัดบัญชีจ่ายเงินจากใบซื้อ และยอดค้างจะไปชำระผ่านเอกสารจ่ายชำระเงินภายหลัง
              </div>
            </div>
          )}

          {/* VAT Settings */}
          <div className="md:col-span-3 border-t border-gray-100 pt-4 mt-2 dark:border-white/10">
            <p className="text-sm font-medium text-gray-700 mb-3 dark:text-slate-300">ภาษี (VAT)</p>
            <div className="flex flex-wrap gap-2 items-center">
              {(["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setVatType(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    vatType === t
                      ? "bg-[#1e3a5f] text-white border-[#1e3a5f] dark:bg-sky-700 dark:border-sky-700"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 dark:bg-slate-800 dark:text-slate-300 dark:border-white/20 dark:hover:border-white/40"
                  }`}
                >
                  {VAT_TYPE_LABELS[t]}
                </button>
              ))}
              {vatType !== "NO_VAT" && (
                <div className="flex items-center gap-1.5 ml-2">
                  <span className="text-sm text-gray-500 dark:text-slate-400">อัตรา</span>
                  <AdminNumberInput
                    value={vatRate}
                    onValueChange={setVatRate}
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

      {/* AI invoice scan — new purchases only (edit form stays fully manual) */}
      {!isEdit && (
        <PurchaseInvoiceUploader
          existingProducts={productOptions}
          onApply={mergeOcrItems}
          disabled={isPending}
        />
      )}

      {/* Line items */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 dark:border-white/10 dark:bg-[#101b2e]">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100 dark:border-white/10">
          <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-300">รายการสินค้า</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-white/10">
                <th className="text-center py-2 px-2 text-gray-500 font-medium w-10 dark:text-slate-400">ลำดับ</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium dark:text-slate-400">สินค้า</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-28 dark:text-slate-400">หน่วย</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-24 dark:text-slate-400">จำนวน</th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-32 dark:text-slate-400">ทุน/หน่วย</th>
                <th className="text-right py-2 px-2 text-gray-500 font-medium w-32 dark:text-slate-400">จำนวนเงิน</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const units = getUnits(item.productId);
                const prod  = productMap.get(item.productId);
                const isLot = prod?.isLotControl ?? false;
                const itemTotal = item.qty * item.costPrice;
                const totalLotQty = item.lotItems.reduce((s, l) => s + l.qty, 0);
                const lotQtyMatch = !isLot || Math.abs(totalLotQty - item.qty) < 0.0001;
                return (
                  <Fragment key={i}>
                    <tr key={i} className="border-b border-gray-50 dark:border-white/5">
                      <td className="py-2 px-2 text-center text-sm text-gray-500 dark:text-slate-400">{i + 1}</td>
                      <td className="py-2 px-2">
                        <ProductSearchSelect
                          products={productOptions}
                          searchProducts={searchPurchaseProducts}
                          value={item.productId}
                          selectedProduct={prod ?? null}
                          onProductSelect={(product) => applySelectedProduct(i, product)}
                          onChange={(id) => {
                            if (!id) clearItemProduct(i);
                          }}
                        />
                        {isLot && (
                          <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30">
                            Lot Control
                          </span>
                        )}
                        {item.productId && (
                          <input
                            type="text"
                            value={item.moreDetail ?? ""}
                            maxLength={500}
                            onChange={(e) => updateItem(i, "moreDetail", e.target.value)}
                            className={`${inputCls} mt-1`}
                            placeholder="รายละเอียดเพิ่มเติม (เช่น สี/รุ่น/หมายเหตุ)"
                          />
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
                        <AdminNumberInput value={item.qty} min={0.0001} step={0.0001}
                          onValueChange={(value) => updateItem(i, "qty", value)}
                          className={inputCls} />
                      </td>
                      <td className="py-2 px-2">
                        <AdminNumberInput value={item.costPrice} min={0} step={0.0001}
                          onValueChange={(value) => updateItem(i, "costPrice", value)}
                          className={inputCls} placeholder="0.00" />
                      </td>
                      <td className="py-2 px-2 text-right font-medium text-gray-700 dark:text-slate-200">
                        {itemTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
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
                      <tr className="bg-amber-50/60 dark:bg-amber-500/10">
                        <td colSpan={7} className="px-4 pb-3 pt-1">
                          {showReadonlyLots ? (
                            /* Read-only lot display in edit mode */
                            <div className="flex flex-wrap gap-2">
                              {item.lotItems.length === 0 ? (
                                <span className="text-xs text-gray-400 italic dark:text-slate-500">ไม่มีข้อมูล Lot</span>
                              ) : item.lotItems.map((lot, li) => (
                                <div key={li} className="inline-flex items-center gap-1.5 text-xs bg-white border border-amber-200 rounded-md px-2 py-1 dark:bg-slate-800 dark:border-amber-400/30">
                                  <span className="font-mono font-semibold text-amber-800 dark:text-amber-300">{lot.lotNo}</span>
                                  <span className="text-gray-500 dark:text-slate-400">จำนวน</span>
                                  <span className="font-medium text-gray-700 dark:text-slate-200">{lot.qty}</span>
                                  {lot.expDate && (
                                    <>
                                      <span className="text-gray-400 dark:text-slate-500">|</span>
                                      <span className="text-gray-500 dark:text-slate-400">EXP {lot.expDate}</span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <>
                              {/* Progress */}
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs text-gray-500 dark:text-slate-400">Lot รวม</span>
                                <span className={`text-xs font-semibold ${lotQtyMatch ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                  {totalLotQty}
                                </span>
                                <span className="text-xs text-gray-400 dark:text-slate-500">/ {item.qty} {item.unitName}</span>
                                {!lotQtyMatch && <span className="text-xs text-red-500 dark:text-red-400">จำนวน Lot ยังไม่ตรง</span>}
                              </div>
                              {/* Lot sub-table */}
                              <table className="w-full text-xs border border-amber-200 rounded-lg overflow-hidden dark:border-amber-400/30">
                                <thead>
                                  <tr className="bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
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
                                    <tr key={li} className="border-t border-amber-100 dark:border-amber-400/20">
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
                                        <AdminNumberInput
                                          value={lot.qty}
                                          min={0.0001} step={0.0001}
                                          onValueChange={(value) => updateLotRow(i, li, "qty", value)}
                                          className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                                        />
                                      </td>
                                      <td className="py-1 px-2">
                                        <AdminNumberInput
                                          value={lot.unitCost}
                                          min={0} step={0.0001}
                                          onValueChange={(value) => updateLotRow(i, li, "unitCost", value)}
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
                                className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 px-2 py-1 rounded transition-colors dark:text-amber-400 dark:hover:text-amber-200 dark:border-amber-400/40"
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
              <tr className="border-t border-gray-100 dark:border-white/10">
                <td colSpan={5} className="py-2 px-2 text-right text-sm text-gray-500 dark:text-slate-400">รวมค่าสินค้าก่อนส่วนลด</td>
                <td className="py-2 px-2 text-right text-gray-700 dark:text-slate-200">
                  {totalBeforeDiscount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              {shippingFee > 0 && (
                <tr>
                  <td colSpan={5} className="py-1 px-2 text-right text-sm text-gray-500 dark:text-slate-400">ค่าจัดส่ง</td>
                  <td className="py-1 px-2 text-right text-gray-700 dark:text-slate-200">
                    +{shippingFee.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </td>
                  <td />
                </tr>
              )}
              <tr>
                <td colSpan={5} className="py-1 px-2 text-right text-sm text-gray-500 dark:text-slate-400">ส่วนลด</td>
                <td className="py-1 px-2 text-right text-red-500 dark:text-red-400">
                  -{discount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              {vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={5} className="py-1 px-2 text-right text-sm text-gray-500 dark:text-slate-400">
                      ยอดก่อนภาษี
                    </td>
                    <td className="py-1 px-2 text-right text-gray-700 dark:text-slate-200">
                      {subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={5} className="py-1 px-2 text-right text-sm text-gray-500 dark:text-slate-400">
                      VAT {vatRate}%
                    </td>
                    <td className="py-1 px-2 text-right text-gray-700 dark:text-slate-200">
                      +{vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </>
              )}
              <tr className="border-t border-gray-200 dark:border-white/10">
                <td colSpan={5} className="py-3 px-2 text-right text-sm font-semibold text-gray-700 dark:text-slate-300">ยอดสุทธิ</td>
                <td className="py-3 px-2 text-right font-bold text-[#1e3a5f] text-base dark:text-sky-300">
                  {netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 dark:bg-red-500/10 dark:border-red-400/30">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2 dark:bg-green-500/10 dark:border-green-400/30">
          <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
          <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
        </div>
      )}
      {draftStatus && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-400">
          {draftStatus}
        </div>
      )}

      <div className="flex justify-end items-center gap-3">
        <button type="button" onClick={addItem}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 hover:border-[#1e3a5f] bg-white text-gray-700 hover:text-[#1e3a5f] text-sm font-semibold rounded-lg transition-colors dark:border-white/20 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-500 dark:hover:text-sky-300">
          <Plus size={14} /> เพิ่มรายการ
        </button>
        <button type="submit" disabled={isPending || submitLocked}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
          {isPending ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              กำลังบันทึก...
            </>
          ) : isEdit || persistedPurchaseId ? "บันทึกการแก้ไข" : "บันทึกใบซื้อ"}
        </button>
      </div>
    </form>
  );
};

export default PurchaseForm;





