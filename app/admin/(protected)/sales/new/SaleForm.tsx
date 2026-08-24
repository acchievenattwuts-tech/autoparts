"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSale, loadSaleProductsByIds, searchSaleProducts, updateSale } from "../actions";
import { Plus, Trash2, CheckCircle, CheckCircle2, MapPin, Users, Zap } from "lucide-react";
import PrintCopyModeLink from "@/app/admin/_components/print/PrintCopyModeLink";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import PaymentChannelsInput, { type PaymentChannelRow } from "@/components/shared/PaymentChannelsInput";
import { validateLotRows, autoAllocateLots, type LotSubRow, type LotAvailableJSON } from "@/lib/lot-control-client";
import { fetchProductLots } from "../actions";
import { SHIPPING_METHOD_OPTIONS } from "@/lib/shipping";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";
import LocationPinPickerSheet from "@/components/shared/LocationPinPickerSheet";
import {
  buildSaleDraft,
  getSaleDraftKey,
  parseSaleDraft,
  type SaleDraftPayload,
  type SaleFormLineItem,
} from "../sale-form-data";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  salePrice: number;
  retailPrice: number;
  memberPrice: number;
  saleUnitName: string;
  warrantyDays: number;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  aliasSearchText?: string;
  units: { name: string; scale: number; isBase: boolean }[];
  preferredSupplierId:   string | null;
  preferredSupplierName: string | null;
  isLotControl:      boolean;
  lotIssueMethod:    string;
  allowExpiredIssue: boolean;
  isActive?: boolean;
}

interface SupplierOption {
  id:   string;
  name: string;
  code: string | null;
  isActive?: boolean;
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
  id:               string;
  name:             string;
  phone:            string | null;
  code:             string | null;
  shippingAddress:  string | null;
  creditTerm:       number | null;
  defaultLatitude:  number | null;
  defaultLongitude: number | null;
  isActive?: boolean;
  priceTier:        SalePriceTier;
}

interface LineItem extends Omit<SaleFormLineItem, "lotItems"> {
  productId:    string;
  unitName:     string;
  qty:          number;
  salePrice:    number;
  warrantyDays: number;
  supplierId:   string;
  supplierName: string;
  lotItems:     LotSubRow[];
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";

const emptyItem = (): LineItem => ({ productId: "", unitName: "", qty: 1, salePrice: 0, unitListPrice: 0, lineDiscount: 0, warrantyDays: 0, supplierId: "", supplierName: "", moreDetail: "", lotItems: [] });

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Recompute the reporting line-discount total from list price vs net price. */
const withLineDiscount = (item: LineItem): LineItem => ({
  ...item,
  lineDiscount: round2(Math.max(0, item.unitListPrice - item.salePrice) * item.qty),
});

/** ระดับราคาของลูกค้าบนหน้าขาย (ตรงกับ CustomerType.priceTier) */
type SalePriceTier = "WHOLESALE" | "MEMBER" | "RETAIL";

const SALE_PRICE_TIER_LABEL: Record<SalePriceTier, string> = {
  WHOLESALE: "ราคาขายส่ง",
  MEMBER: "ราคาสมาชิก",
  RETAIL: "ราคาขายปลีก",
};

/**
 * Pick the unit price for a product based on the customer's price tier.
 * WHOLESALE → ราคาขายส่ง (salePrice). RETAIL → ราคาขายปลีก (retailPrice),
 * falling back to salePrice when retailPrice is unset (0) so no product ever
 * defaults to a zero price.
 * MEMBER → ราคาสมาชิก (memberPrice) — ไม่ fallback: สินค้าที่ยังไม่ตั้งราคาสมาชิกจะได้ 0
 * เพื่อให้พนักงานกรอกราคาเอง (แถวจะถูกไฮไลต์ และมีข้อความยืนยันก่อนบันทึก)
 */
const priceForTier = (
  product: Pick<ProductOption, "salePrice" | "retailPrice" | "memberPrice">,
  tier: SalePriceTier,
): number => {
  const wholesale = product.salePrice ?? 0;
  if (tier === "WHOLESALE") return wholesale;
  if (tier === "MEMBER") return product.memberPrice ?? 0;
  const retail = product.retailPrice ?? 0;
  return retail > 0 ? retail : wholesale;
};

/** Ensure a restored/legacy draft item carries the two new price fields. */
const normalizeDraftItem = (item: LineItem): LineItem => {
  const salePrice = item.salePrice ?? 0;
  const unitListPrice = Math.max(item.unitListPrice ?? 0, salePrice);
  return withLineDiscount({ ...item, salePrice, unitListPrice });
};

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
  payments?:       PaymentChannelRow[];
  fulfillmentType:  "PICKUP" | "DELIVERY";
  shippingAddress:  string;
  shippingFee:      number;
  shippingMethod:   string;
  destLatitude:     number | null;
  destLongitude:    number | null;
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
  submitLocked = false,
  canPrint = false,
  channel = "STORE",
  defaultCustomerId = "",
  defaultCashBankAccountId = "",
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
  submitLocked?: boolean;
  canPrint?: boolean;
  channel?: "STORE" | "SHOPEE";
  defaultCustomerId?: string;
  defaultCashBankAccountId?: string;
}) => {
  const isShopee = channel === "SHOPEE";
  const router = useRouter();
  const isEdit = !!initialData;
  const showReadonlyLots = isEdit && !editableLotOnEdit;
  const [isPending, startTransition] = useTransition();
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [availableDraft, setAvailableDraft] = useState<SaleDraftPayload | null>(null);
  const [persistedSaleId, setPersistedSaleId] = useState(initialData?.id ?? "");
  const [saleDate, setSaleDate] = useState(initialData?.saleDate ?? getThailandDateKey());
  const [saleType, setSaleType] = useState(initialData?.saleType ?? "RETAIL");
  const [note, setNote] = useState(initialData?.note ?? "");
  const [items, setItems]         = useState<LineItem[]>(initialData?.items.map(normalizeDraftItem) ?? [emptyItem()]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialData?.customerId ?? defaultCustomerId);
  const [channelRefNo, setChannelRefNo] = useState("");
  const [customerNameOverride, setCustomerNameOverride] = useState(initialData?.customerName ?? "");
  const [customerPhoneOverride, setCustomerPhoneOverride] = useState(initialData?.customerPhone ?? "");
  const [creditTerm, setCreditTerm] = useState<number>(initialData?.creditTerm ?? 0);
  const [discount, setDiscount] = useState(initialData?.discount ?? 0);

  const [paymentType, setPaymentType] = useState<"CASH_SALE" | "CREDIT_SALE">(initialData?.paymentType ?? "CASH_SALE");
  const [payments, setPayments] = useState<PaymentChannelRow[]>(
    initialData?.payments && initialData.payments.length > 0
      ? initialData.payments
      : initialData?.cashBankAccountId
        ? [{ cashBankAccountId: initialData.cashBankAccountId, amount: 0 }]
        : [{ cashBankAccountId: defaultCashBankAccountId, amount: 0 }],
  );
  const primaryAccountId = payments[0]?.cashBankAccountId ?? "";
  const [fulfillmentType, setFulfillmentType] = useState<"PICKUP" | "DELIVERY">(initialData?.fulfillmentType ?? (isShopee ? "DELIVERY" : "PICKUP"));
  const [shippingAddress, setShippingAddress] = useState(initialData?.shippingAddress ?? (isShopee ? "จัดส่งตามที่อยู่ในคำสั่งซื้อ Shopee" : ""));
  const [shippingFee, setShippingFee]         = useState(initialData?.shippingFee ?? 0);
  const [shippingMethod, setShippingMethod]   = useState<string>(initialData?.shippingMethod ?? (isShopee ? "OTHER" : "NONE"));
  const [destLat, setDestLat] = useState<number | null>(initialData?.destLatitude ?? null);
  const [destLon, setDestLon] = useState<number | null>(initialData?.destLongitude ?? null);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const [saveAsCustomerDefault, setSaveAsCustomerDefault] = useState(false);

  const [vatType, setVatType] = useState<string>(initialData?.vatType ?? (isShopee ? "NO_VAT" : defaultVatType));
  const [vatRate, setVatRate] = useState<number>(initialData?.vatRate ?? defaultVatRate);
  const [availableLots, setAvailableLots] = useState<Record<number, LotAvailableJSON[]>>(initialAvailableLots);
  const [lotsLoading, setLotsLoading]     = useState<Record<number, boolean>>({});
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const customerOptions = customers;
  const supplierOptions = suppliers;
  const productMap = new Map(productOptions.map((product) => [product.id, product]));
  const supplierMap = new Map(supplierOptions.map((supplier) => [supplier.id, supplier]));
  const customerMap = new Map(customerOptions.map((customer) => [customer.id, customer]));
  const deriveTier = (customerId: string): SalePriceTier =>
    customerMap.get(customerId)?.priceTier ?? "RETAIL";
  const activeTier = deriveTier(selectedCustomerId);
  const draftKey = `${getSaleDraftKey(
    persistedSaleId ? { mode: "edit", saleId: persistedSaleId } : { mode: "new" },
  )}${isShopee && !persistedSaleId ? ":shopee" : ""}`;
  const lastPersistedDraftRef = useRef("");

  const getDraftSnapshot = useCallback(() =>
    JSON.stringify({
      saleDate,
      customerId: selectedCustomerId,
      customerName: customerNameOverride,
      customerPhone: customerPhoneOverride,
      saleType,
      paymentType,
      payments,
      fulfillmentType,
      shippingAddress,
      shippingFee,
      shippingMethod,
      destLatitude: destLat,
      destLongitude: destLon,
      discount,
      note,
      vatType,
      vatRate,
      creditTerm,
      items,
    }), [payments, creditTerm, customerNameOverride, customerPhoneOverride, destLat, destLon, discount, fulfillmentType, items, note, paymentType, saleDate, saleType, selectedCustomerId, shippingAddress, shippingFee, shippingMethod, vatRate, vatType]);

  const applyDraft = async (draft: SaleDraftPayload) => {
    const missingProductIds = [...new Set(draft.items.map((item) => item.productId).filter(Boolean))]
      .filter((productId) => !productOptions.some((product) => product.id === productId));
    if (missingProductIds.length > 0) {
      const restoredProducts = await loadSaleProductsByIds(missingProductIds);
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
    setSaleDate(draft.saleDate);
    setSelectedCustomerId(draft.customerId);
    setCustomerNameOverride(draft.customerName);
    setCustomerPhoneOverride(draft.customerPhone);
    setSaleType(draft.saleType);
    setPaymentType(draft.paymentType);
    setPayments(
      draft.payments && draft.payments.length > 0
        ? draft.payments
        : draft.cashBankAccountId
          ? [{ cashBankAccountId: draft.cashBankAccountId, amount: 0 }]
          : [{ cashBankAccountId: "", amount: 0 }],
    );
    setFulfillmentType(draft.fulfillmentType);
    setShippingAddress(draft.shippingAddress);
    setShippingFee(draft.shippingFee);
    setShippingMethod(draft.shippingMethod);
    setDestLat(draft.destLatitude);
    setDestLon(draft.destLongitude);
    setDiscount(draft.discount);
    setNote(draft.note);
    setVatType(draft.vatType);
    setVatRate(draft.vatRate);
    setCreditTerm(draft.creditTerm);
    setItems((draft.items as LineItem[]).map(normalizeDraftItem));
    setAvailableDraft(null);
    setDraftStatus("กู้คืน draft แล้ว");
  };

  useEffect(() => {
    lastPersistedDraftRef.current = getDraftSnapshot();
    const draft = parseSaleDraft(
      window.localStorage.getItem(draftKey),
      persistedSaleId ? { mode: "edit", saleId: persistedSaleId } : { mode: "new" },
    );
    if (draft) {
      setAvailableDraft(draft);
      setDraftStatus(`พบ draft ล่าสุด ${new Date(draft.updatedAt).toLocaleTimeString("th-TH-u-ca-gregory", { hour: "2-digit", minute: "2-digit" })}`);
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
        const draft = buildSaleDraft({
          mode: persistedSaleId ? "edit" : "new",
          saleId: persistedSaleId || null,
          saleDate,
          customerId: selectedCustomerId,
          customerName: customerNameOverride,
          customerPhone: customerPhoneOverride,
          saleType,
          paymentType,
          cashBankAccountId: primaryAccountId,
          payments,
          fulfillmentType,
          shippingAddress,
          shippingFee,
          shippingMethod,
          destLatitude: destLat,
          destLongitude: destLon,
          discount,
          note,
          vatType,
          vatRate,
          creditTerm,
          items,
        });
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
        lastPersistedDraftRef.current = snapshot;
        setDraftStatus(`Draft saved ${new Date(draft.updatedAt).toLocaleTimeString("th-TH-u-ca-gregory", { hour: "2-digit", minute: "2-digit" })}`);
      } catch {
        setDraftStatus("บันทึก draft ไม่สำเร็จ");
      }
    }, 2000);

    return () => window.clearTimeout(timeout);
  }, [primaryAccountId, payments, creditTerm, customerNameOverride, customerPhoneOverride, destLat, destLon, discount, draftKey, fulfillmentType, getDraftSnapshot, items, note, paymentType, persistedSaleId, saleDate, saleType, selectedCustomerId, shippingAddress, shippingFee, shippingMethod, vatRate, vatType]);

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
              unitListPrice: 0,
              lineDiscount: 0,
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
              salePrice: priceForTier(product, activeTier),
              unitListPrice: priceForTier(product, activeTier),
              lineDiscount: 0,
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
        let updated = { ...item, [field]: value };
        if (field === "qty") {
          if (item.productId) {
            const prod = productMap.get(item.productId);
            if (prod?.isLotControl && updated.lotItems.length === 1) {
              updated.lotItems = [{ ...updated.lotItems[0], qty: Number(value) }];
            }
          }
          // qty affects the reporting discount total (per-unit discount × qty).
          updated = withLineDiscount(updated);
        }
        return updated;
      })
    );
  };

  // Price editing keeps salePrice (net) as the source of truth while
  // maintaining the invariant unitListPrice >= salePrice. Each entry point
  // recomputes the other fields so all three stay consistent.
  const updateListPrice = (i: number, value: number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const unitListPrice = round2(value);
        // Never let the list price fall below the net price.
        const salePrice = Math.min(item.salePrice, unitListPrice);
        return withLineDiscount({ ...item, unitListPrice, salePrice });
      }),
    );
  };

  const updateNetPrice = (i: number, value: number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const salePrice = round2(value);
        // If net exceeds the current list price, raise the list price to match
        // (i.e. no discount) so the invariant holds.
        const unitListPrice = Math.max(item.unitListPrice, salePrice);
        return withLineDiscount({ ...item, salePrice, unitListPrice });
      }),
    );
  };

  const updateDiscountPerUnit = (i: number, value: number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const discountPerUnit = Math.max(0, round2(value));
        const salePrice = round2(Math.max(0, item.unitListPrice - discountPerUnit));
        return withLineDiscount({ ...item, salePrice });
      }),
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
  const totalLineDiscount = items.reduce((sum, it) => sum + it.lineDiscount, 0);
  const grossBeforeLineDiscount = items.reduce((sum, it) => sum + it.qty * it.unitListPrice, 0);
  const effectiveShippingFee = fulfillmentType === "DELIVERY" ? shippingFee : 0;
  const discountedTotal = Math.max(0, totalAmount + effectiveShippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType as VatType, vatRate);

  useEffect(() => {
    if (!isShopee || !defaultCashBankAccountId) return;
    setPayments([{ cashBankAccountId: defaultCashBankAccountId, amount: netAmount }]);
  }, [defaultCashBankAccountId, isShopee, netAmount]);

  /** Re-apply the tier price to every line that already has a product selected. */
  const repriceItemsToTier = (tier: SalePriceTier) => {
    setItems((prev) =>
      prev.map((item) => {
        if (!item.productId) return item;
        const prod = productMap.get(item.productId);
        if (!prod) return item;
        const price = priceForTier(prod, tier);
        return withLineDiscount({ ...item, salePrice: price, unitListPrice: price });
      }),
    );
  };

  const handleCustomerChange = (customerId: string) => {
    const prevTier = deriveTier(selectedCustomerId);
    const nextTier = deriveTier(customerId);
    setSelectedCustomerId(customerId);
    // ราคาผูกกับประเภทลูกค้า — ถ้าระดับราคาเปลี่ยนและมีสินค้าในบิลแล้ว
    // ถามยืนยันก่อนปรับราคาทุกบรรทัดตามประเภทลูกค้าใหม่ (ไม่บังคับทับราคาที่แก้มือ)
    if (
      nextTier !== prevTier &&
      items.some((item) => item.productId) &&
      window.confirm(
        `เปลี่ยนประเภทลูกค้าเป็น “${SALE_PRICE_TIER_LABEL[nextTier]}” ต้องการปรับราคาสินค้าในบิลตามประเภทลูกค้าใหม่หรือไม่?`,
      )
    ) {
      repriceItemsToTier(nextTier);
    }
    if (customerId) {
      const found = customerMap.get(customerId);
      setCustomerNameOverride(found?.name ?? "");
      setCustomerPhoneOverride(found?.phone ?? "");
      setShippingAddress(found?.shippingAddress ?? "");
      setCreditTerm(found?.creditTerm ?? 0);
      setDestLat(found?.defaultLatitude ?? null);
      setDestLon(found?.defaultLongitude ?? null);
    } else {
      setCustomerNameOverride("");
      setCustomerPhoneOverride("");
      setShippingAddress("");
      setCreditTerm(0);
      setDestLat(null);
      setDestLon(null);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (submitLocked) return;

    if (isShopee && !channelRefNo.trim()) { setError("กรุณาระบุเลขคำสั่งซื้อ Shopee"); return; }

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

    const zeroPricedRows = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.salePrice <= 0);
    if (zeroPricedRows.length > 0) {
      const rowNames = zeroPricedRows
        .map(({ item, index }) => `แถวที่ ${index + 1} — ${productMap.get(item.productId)?.name ?? "-"}`)
        .join("\n");
      if (
        !window.confirm(
          `รายการต่อไปนี้ยังมีราคาขายเป็น 0 บาท:\n${rowNames}\n\nต้องการบันทึกการขายด้วยราคานี้หรือไม่?`,
        )
      ) {
        return;
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
    let submitPayments: { cashBankAccountId: string; amount: number }[] = [];
    if (paymentType === "CASH_SALE") {
      const activePayments = payments.filter((row) => row.amount > 0);
      if (activePayments.length === 0) { setError("กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง"); return; }
      if (activePayments.some((row) => !row.cashBankAccountId)) { setError("กรุณาเลือกบัญชีให้ครบทุกช่องทางที่มียอดเงิน"); return; }
      const paymentsTotal = Math.round(activePayments.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      if (Math.abs(paymentsTotal - netAmount) > 0.005) {
        setError(`ยอดรวมช่องทางรับเงินต้องเท่ากับยอดสุทธิ (${netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท)`);
        return;
      }
      submitPayments = activePayments.map((row) => ({ cashBankAccountId: row.cashBankAccountId, amount: row.amount }));
    }

    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("saleDate", saleDate);
    formData.set("channel", channel);
    if (isShopee) formData.set("channelRefNo", channelRefNo.trim());
    formData.set("saleType", saleType);
    formData.set("customerId", selectedCustomerId);
    formData.set("customerName", customerNameOverride);
    formData.set("customerPhone", customerPhoneOverride);
    formData.set("items", JSON.stringify(items));
    formData.set("paymentType", paymentType);
    formData.set("fulfillmentType", fulfillmentType);
    formData.set("shippingAddress", fulfillmentType === "DELIVERY" ? shippingAddress : "");
    formData.set("shippingFee", String(effectiveShippingFee));
    formData.set("shippingMethod", fulfillmentType === "DELIVERY" ? shippingMethod : "NONE");
    formData.set("payments", JSON.stringify(submitPayments));
    formData.set("discount", String(discount));
    formData.set("note", note);
    formData.set("vatType", vatType);
    formData.set("vatRate", String(vatRate));
    formData.set("creditTerm", String(creditTerm));
    if (fulfillmentType === "DELIVERY" && destLat !== null) formData.set("destLatitude", String(destLat));
    if (fulfillmentType === "DELIVERY" && destLon !== null) formData.set("destLongitude", String(destLon));
    if (
      fulfillmentType === "DELIVERY" &&
      destLat !== null &&
      destLon !== null &&
      saveAsCustomerDefault &&
      selectedCustomerId
    ) {
      formData.set("saveAsCustomerDefault", "1");
    }

    startTransition(async () => {
      if (persistedSaleId) {
        const result = await updateSale(persistedSaleId, formData);
        if (result.error) setError(result.error);
        else {
          window.localStorage.removeItem(draftKey);
          lastPersistedDraftRef.current = getDraftSnapshot();
          setAvailableDraft(null);
          setDraftStatus("");
          setSuccess("บันทึกการแก้ไขสำเร็จ");
        }
      } else {
        const result = await createSale(formData);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess(`บันทึกสำเร็จ เลขที่ใบขาย: ${result.saleNo}`);
          window.localStorage.removeItem(draftKey);
          lastPersistedDraftRef.current = getDraftSnapshot();
          setAvailableDraft(null);
          setDraftStatus("");
          if (result.saleId) {
            if (isShopee) {
              router.replace(`/admin/sales/${result.saleId}`);
              router.refresh();
              return;
            }
            setPersistedSaleId(result.saleId);
            window.history.replaceState(null, "", `/admin/sales/${result.saleId}/edit`);
          }
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {availableDraft && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>
              พบ draft ที่ยังไม่ได้บันทึกจาก {new Date(availableDraft.updatedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
            </span>
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
                className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-400/40 dark:text-amber-300 dark:hover:bg-amber-500/20"
              >
                ไม่ใช้ draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header card */}
      {isShopee && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-5 dark:border-orange-400/30 dark:bg-orange-500/10">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-end">
            <div>
              <label className={labelCls}>เลขคำสั่งซื้อ Shopee <span className="text-red-500">*</span></label>
              <input
                value={channelRefNo}
                onChange={(event) => setChannelRefNo(event.target.value)}
                maxLength={100}
                autoComplete="off"
                className={inputCls}
                placeholder="เช่น 260824ABCDEF"
              />
            </div>
            <p className="text-sm text-orange-800 dark:text-orange-200">
              บันทึกเมื่อคำสั่งซื้อขึ้นสถานะพร้อมจัดส่ง ระบบจะตัดสต็อกและพักยอดขายเต็มจำนวนไว้ในบัญชี Shopee จากนั้นค่อยหักค่าธรรมเนียมในหน้ากระทบยอด
            </p>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100 dark:text-sky-300 dark:border-white/10">
          ข้อมูลการขาย
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>
              {isShopee ? "วันที่พร้อมจัดส่ง" : "วันที่ขาย"} <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="saleDate"
              required
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>ลูกค้า</label>
            {isShopee ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                {customerMap.get(selectedCustomerId)?.name ?? "ลูกค้า Shopee"}
              </div>
            ) : <SearchableSelect
              options={customerOptions.map((c): SelectOption => ({
                id: c.id,
                label: c.name,
                sublabel: c.code ?? undefined,
                disabled: c.isActive === false,
              }))}
              value={selectedCustomerId}
              onChange={handleCustomerChange}
              selectedOption={
                selectedCustomerId
                  ? (() => {
                      const customer = customerMap.get(selectedCustomerId);
                      return customer
                        ? { id: customer.id, label: customer.name, sublabel: customer.code ?? undefined }
                        : null;
                    })()
                  : null
              }
              placeholder="โปรดระบุลูกค้า"
            />}
            <input type="hidden" name="customerId" value={selectedCustomerId} />
          </div>
          <div>
            <label className={labelCls}>ประเภทการขาย</label>
            <select name="saleType" value={saleType} onChange={(e) => setSaleType(e.target.value)} className={`${inputCls} bg-white`}>
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
          {!isShopee && <div>
            <label className={labelCls}>ประเภทการชำระ</label>
            <input type="hidden" name="paymentType" value={paymentType} />
            <div className="flex rounded-lg border border-gray-300 dark:border-white/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setPaymentType("CASH_SALE")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  paymentType === "CASH_SALE"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                ขายสด
              </button>
              <button
                type="button"
                onClick={() => setPaymentType("CREDIT_SALE")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 dark:border-white/20 ${
                  paymentType === "CREDIT_SALE"
                    ? "bg-orange-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                ขายเชื่อ
              </button>
            </div>
          </div>}
          {isShopee ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-200">
            รับยอดเต็มเข้าบัญชีพักเงิน Shopee อัตโนมัติ (ยังไม่ใช่เงินเข้าธนาคารจริง)
          </div>
          ) : paymentType === "CASH_SALE" ? (
          <div>
            <PaymentChannelsInput
              accounts={cashBankAccounts}
              value={payments}
              onChange={setPayments}
              targetAmount={netAmount}
              label="ช่องทางรับเงิน"
              placeholder="โปรดระบุบัญชีรับเงิน"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">รองรับรับเงินหลายช่องทาง — ยอดรวมต้องเท่ากับยอดสุทธิ</p>
          </div>
          ) : (
          <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700 dark:border-orange-400/30 dark:bg-orange-500/10 dark:text-orange-300">
            ขายเชื่อจะยังไม่สร้างรายการเงินรับ และไม่ต้องระบุบัญชีรับเงิน
          </div>
          )}
          <div>
            <label className={labelCls}>ส่วนลดท้ายบิล (บาท)</label>
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
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={inputCls}
              placeholder="หมายเหตุ"
            />
          </div>

          {/* VAT Settings */}
          <div className="md:col-span-3 border-t border-gray-100 dark:border-white/10 pt-4 mt-2">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-3">ภาษี (VAT)</p>
            {isShopee ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">ไม่คิด VAT ตามสถานะร้านที่ตั้งไว้</p>
            ) : (
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
            )}
          </div>
        </div>
      </div>

      {/* Fulfillment section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100 dark:text-sky-300 dark:border-white/10">
          การจัดส่ง
        </h2>
        <div className="space-y-4">
          {!isShopee && <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 dark:text-slate-300 w-24 shrink-0">การจัดส่ง</label>
            <div className="flex rounded-lg border border-gray-300 dark:border-white/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setFulfillmentType("PICKUP")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  fulfillmentType === "PICKUP"
                    ? "bg-[#1e3a5f] text-white dark:bg-sky-700"
                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                หน้าร้าน (รับเอง)
              </button>
              <button
                type="button"
                onClick={() => setFulfillmentType("DELIVERY")}
                className={`px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 dark:border-white/20 ${
                  fulfillmentType === "DELIVERY"
                    ? "bg-purple-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                จัดส่ง
              </button>
            </div>
          </div>}

          {paymentType === "CREDIT_SALE" && fulfillmentType === "DELIVERY" && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 dark:bg-amber-500/10 dark:border-amber-400/30 dark:text-amber-300">
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
              <div className="md:col-span-2">
                <label className={labelCls}>ปักหมุดที่อยู่จัดส่ง</label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1 text-sm">
                    {destLat !== null && destLon !== null ? (
                      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <CheckCircle2 size={14} />
                        ปักหมุดแล้ว ({destLat.toFixed(6)}, {destLon.toFixed(6)})
                      </span>
                    ) : (
                      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        ยังไม่ได้ปักหมุด
                      </span>
                    )}
                    {saveAsCustomerDefault && destLat !== null && destLon !== null ? (
                      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                        <Users size={12} />
                        จะบันทึกเป็นพิกัดเริ่มต้นของลูกค้าด้วย
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPinSheetOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/20"
                  >
                    <MapPin size={15} />
                    {destLat !== null && destLon !== null ? "แก้ไขหมุด" : "ปักหมุดที่อยู่จัดส่ง"}
                  </button>
                </div>
                <LocationPinPickerSheet
                  mode="sale"
                  open={pinSheetOpen}
                  onClose={() => setPinSheetOpen(false)}
                  initialLat={destLat}
                  initialLon={destLon}
                  customerLinked={!!selectedCustomerId}
                  title="ปักหมุดที่อยู่จัดส่ง"
                  subtitle={customerNameOverride || undefined}
                  onConfirm={(lat, lon, options) => {
                    setDestLat(lat);
                    setDestLon(lon);
                    setSaveAsCustomerDefault(lat !== null && lon !== null && options.saveToCustomer);
                  }}
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
                  <option value="KERRY">{SHIPPING_METHOD_OPTIONS.KERRY}</option>
                  <option value="FLASH">{SHIPPING_METHOD_OPTIONS.FLASH}</option>
                  <option value="JT">{SHIPPING_METHOD_OPTIONS.JT}</option>
                  <option value="THAILAND_POST">{SHIPPING_METHOD_OPTIONS.THAILAND_POST}</option>
                  <option value="OTHER">อื่น ๆ</option>
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

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
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-32 dark:text-slate-400">
                  ราคาขาย/หน่วย
                  <span className="block text-xs font-normal text-gray-400 dark:text-slate-500">ก่อนลด</span>
                </th>
                <th className="text-left py-2 px-2 text-amber-600 font-medium w-28 dark:text-amber-400/80">
                  ส่วนลด/หน่วย
                  <span className="block text-xs font-normal text-gray-400 dark:text-slate-500">0 = ไม่ลด</span>
                </th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-32 dark:text-slate-400">
                  ราคาสุทธิ/หน่วย
                  <span className="block text-xs font-normal text-gray-400 dark:text-slate-500">หลังลด</span>
                </th>
                <th className="text-left py-2 px-2 text-gray-500 font-medium w-28 dark:text-slate-400">
                  ประกัน (วัน)
                  <span className="block text-xs font-normal text-gray-400 dark:text-slate-500">0 = ไม่มี</span>
                </th>
                <th className="text-right py-2 px-2 text-gray-500 font-medium w-28 dark:text-slate-400">รวม</th>
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
                // ราคา 0 = สินค้ายังไม่ตั้งราคาในระดับราคาของลูกค้ารายนี้ (เช่น ยังไม่ตั้งราคาสมาชิก)
                // ไฮไลต์แถวให้พนักงานกรอกราคาเอง และมีข้อความยืนยันอีกครั้งตอนกดบันทึก
                const isZeroPriced = Boolean(item.productId) && item.salePrice <= 0;
                return (
                  <Fragment key={i}>
                  <tr
                    className={`border-b border-gray-50 dark:border-white/5 ${
                      isZeroPriced ? "bg-rose-50 dark:bg-rose-500/10" : ""
                    }`}
                  >
                    <td className="py-2 px-2 text-center text-sm text-gray-500 dark:text-slate-400">{i + 1}</td>
                    <td className="py-2 px-2">
                      <ProductSearchSelect
                        products={productOptions}
                        searchProducts={searchSaleProducts}
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
                              ...supplierOptions.map((s): SelectOption => ({ id: s.id, label: s.code ? `[${s.code}] ${s.name}` : s.name, disabled: s.isActive === false })),
                            ]}
                            value={item.supplierId}
                            selectedOption={
                              item.supplierId
                                ? (() => {
                                    const supplier = supplierMap.get(item.supplierId);
                                    return supplier
                                      ? { id: supplier.id, label: supplier.code ? `[${supplier.code}] ${supplier.name}` : supplier.name }
                                      : null;
                                  })()
                                : null
                            }
                            onChange={(id) => updateItemSupplier(i, id)}
                            placeholder="ซัพพลายเออร์"
                          />
                        </div>
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
                        value={item.unitListPrice}
                        min={0}
                        step={0.01}
                        onValueChange={(value) => updateListPrice(i, value)}
                        className={inputCls}
                        placeholder="0.00"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <AdminNumberInput
                        value={round2(Math.max(0, item.unitListPrice - item.salePrice))}
                        min={0}
                        step={0.01}
                        onValueChange={(value) => updateDiscountPerUnit(i, value)}
                        className={`${inputCls} ${item.unitListPrice - item.salePrice > 0.0001 ? "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10" : ""}`}
                        placeholder="0.00"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <AdminNumberInput
                        value={item.salePrice}
                        min={0}
                        step={0.01}
                        onValueChange={(value) => updateNetPrice(i, value)}
                        className={`${inputCls} font-medium ${
                          isZeroPriced ? "border-rose-400 bg-rose-50 dark:border-rose-500/60 dark:bg-rose-500/10" : ""
                        }`}
                        placeholder="0.00"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <AdminNumberInput
                        value={item.warrantyDays}
                        min={0}
                        step={1}
                        onValueChange={(value) => updateItem(i, "warrantyDays", value)}
                        className={`${inputCls} ${item.warrantyDays > 0 ? "border-green-400 bg-green-50 dark:border-green-500/50 dark:bg-green-500/10" : ""}`}
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 px-2 text-right font-medium text-gray-700 dark:text-slate-200">
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
                    <tr className="bg-amber-50/60 dark:bg-amber-500/10">
                      <td colSpan={10} className="px-4 pb-3 pt-1">
                        {/* Lot header */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-400/40">
                            Lot Control
                          </span>
                          {!showReadonlyLots && (
                            <>
                              <span className="text-xs text-gray-500 dark:text-slate-400">จัดสรรรวม</span>
                              <span className={`text-xs font-semibold ${lotQtyMatch ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                                {totalLotQty}
                              </span>
                              <span className="text-xs text-gray-400 dark:text-slate-500">/ {item.qty} {item.unitName}</span>
                              {!lotQtyMatch && <span className="text-xs text-red-500 dark:text-red-400">จำนวน Lot ยังไม่ครบ</span>}
                              <button
                                type="button"
                                onClick={() => handleAutoAllocate(i)}
                                className="ml-1 inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 bg-indigo-50 px-2 py-0.5 rounded transition-colors dark:text-indigo-300 dark:hover:text-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-500/10"
                              >
                                <Zap size={11} /> Auto จัดสรร
                              </button>
                              {lotsLoading[i] && <span className="text-xs text-gray-400 dark:text-slate-500 animate-pulse">กำลังโหลด...</span>}
                            </>
                          )}
                        </div>
                        {/* Lot rows */}
                        {showReadonlyLots ? (
                          /* Read-only display in edit mode */
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
                                    <span className="text-gray-300 dark:text-slate-600">|</span>
                                    <span className="text-gray-500 dark:text-slate-400">EXP</span>
                                    <span className="text-gray-700 dark:text-slate-200">
                                          {formatDateThai(lot.expDate)}
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
                                <div key={li} className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-2 py-1.5 dark:bg-slate-800/50 dark:border-amber-400/30">
                                  <div className="flex-1 min-w-0">
                                    <select
                                      value={lot.lotNo}
                                      onChange={(e) => handleLotSelect(i, li, e.target.value)}
                                      className="w-full px-2 py-1 border border-amber-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 dark:bg-slate-900 dark:border-amber-400/30 dark:text-slate-100"
                                    >
                                      <option value="">-- เลือก Lot --</option>
                                      {lotOptions.length === 0 && lot.lotNo === "" && (
                                        <option disabled value="">ไม่มี Lot คงเหลือ</option>
                                      )}
                                      {lotOptions.map((av) => {
                                        const qtyInUnit = Math.round((av.qtyOnHand / scale) * 10000) / 10000;
                                        const expStr = av.expDate
                                        ? formatDateThai(av.expDate)
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
                                      className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 text-right dark:bg-slate-900 dark:border-amber-400/30 dark:text-slate-100"
                                      placeholder="จำนวน"
                                    />
                                  </div>
                                  {lot.expDate && (
                                    <span className="text-xs text-gray-500 whitespace-nowrap shrink-0 dark:text-slate-400">
                                      EXP {formatDateThai(lot.expDate)}
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
                            className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 px-2 py-1 rounded transition-colors dark:text-amber-400 dark:hover:text-amber-200 dark:border-amber-400/40"
                          >
                            <Plus size={11} /> เพิ่ม Lot
                          </button>
                        )}
                      </td>
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
                  <span className="font-medium dark:text-slate-300">
                    {grossBeforeLineDiscount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-amber-600 dark:text-amber-400">
                  <span>ส่วนลดระดับรายการ</span>
                  <span className="font-medium">
                    -{totalLineDiscount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>ยอดรวม</span>
              <span className="font-medium dark:text-slate-200">
                {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {fulfillmentType === "DELIVERY" && shippingFee > 0 && (
              <div className="flex justify-between text-gray-600 dark:text-slate-400">
                <span>ค่าจัดส่ง</span>
                <span className="font-medium text-purple-600 dark:text-purple-400">
                  +{shippingFee.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>ส่วนลดท้ายบิล</span>
              <span className="font-medium text-red-500 dark:text-red-400">
                -{discount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            {vatType !== "NO_VAT" && (
              <>
                <div className="flex justify-between text-gray-600 dark:text-slate-400">
                  <span>ยอดก่อนภาษี</span>
                  <span className="font-medium dark:text-slate-200">
                    {subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-gray-600 dark:text-slate-400">
                  <span>VAT {vatRate}%</span>
                  <span className="font-medium dark:text-slate-200">
                    +{vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-gray-200 dark:border-white/10 pt-2 font-semibold text-gray-900 dark:text-slate-100">
              <span>ยอดสุทธิ</span>
              <span className="text-[#1e3a5f] dark:text-sky-300">
                {netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 dark:bg-red-500/10 dark:border-red-400/30">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between dark:bg-green-500/10 dark:border-green-400/30">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
            <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
          </div>
          {canPrint && persistedSaleId && (
            <PrintCopyModeLink
              href={`/admin/sales/${persistedSaleId}?print=1`}
              label="พิมพ์แบบฟอร์ม"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900"
            />
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-gray-500 dark:text-slate-400">
          {draftStatus || "Draft จะถูกเก็บเฉพาะในเครื่องนี้ ยังไม่กระทบข้อมูลจริงจนกว่าจะกดบันทึก"}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={addItem}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 hover:border-[#1e3a5f] bg-white text-gray-700 hover:text-[#1e3a5f] text-sm font-semibold rounded-lg transition-colors dark:border-white/20 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-sky-500 dark:hover:text-sky-300"
          >
            <Plus size={14} /> เพิ่มรายการ
          </button>
        {canPrint && persistedSaleId && (
          <PrintCopyModeLink
            href={`/admin/sales/${persistedSaleId}?print=1`}
            label="พิมพ์"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1e3a5f] hover:bg-blue-900 text-white text-sm font-medium rounded-lg transition-colors"
          />
        )}
        <button
          type="submit"
          disabled={isPending || submitLocked}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:bg-orange-600 dark:hover:bg-orange-500 dark:disabled:bg-orange-900/50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              กำลังบันทึก...
            </span>
          ) : isEdit || persistedSaleId ? "บันทึกการแก้ไข" : "บันทึกการขาย"}
        </button>
        </div>
      </div>
    </form>
  );
};

export default SaleForm;

