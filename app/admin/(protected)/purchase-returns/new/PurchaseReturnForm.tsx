"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseReturn, updatePurchaseReturn, getPurchasesForSupplier, getPurchaseDetail, fetchProductLots, searchPurchaseReturnProducts, searchPurchaseReturnSuppliers } from "../actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { validateLotRows, type LotAvailableJSON, type LotSubRow } from "@/lib/lot-control-client";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  avgCost: number;
  isLotControl: boolean;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  units: { name: string; scale: number; isBase: boolean }[];
}

interface SupplierOption {
  id: string;
  name: string;
}

interface PurchaseOption {
  id: string;
  purchaseNo: string;
  purchaseDate?: Date;
}

interface LineItem {
  productId: string;
  unitName: string;
  qty: number;
  lotItems: LotSubRow[];
}

interface InitialData {
  id: string;
  returnDate: string;
  purchaseId: string;
  supplierId: string;
  note: string;
  vatType: string;
  vatRate: number;
  items: LineItem[];
  initialAvailableLots?: Record<number, LotAvailableJSON[]>;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const emptyItem = (): LineItem => ({ productId: "", unitName: "", qty: 1, lotItems: [] });

const PurchaseReturnForm = ({
  products,
  suppliers,
  initialPurchases,
  defaultVatType,
  defaultVatRate,
  initialData,
}: {
  products: ProductOption[];
  suppliers: SupplierOption[];
  initialPurchases?: PurchaseOption[];
  defaultVatType: string;
  defaultVatRate: number;
  initialData?: InitialData;
}) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [supplierId, setSupplierId] = useState(initialData?.supplierId ?? "");
  const [selectedSupplierOption, setSelectedSupplierOption] = useState<SelectOption | null>(
    supplierId
      ? (() => {
          const supplier = suppliers.find((entry) => entry.id === supplierId);
          return supplier ? { id: supplier.id, label: supplier.name } : null;
        })()
      : null,
  );
  const [purchaseId, setPurchaseId] = useState(initialData?.purchaseId ?? "");
  const [filteredPurchases, setFilteredPurchases] = useState<PurchaseOption[]>(initialPurchases ?? []);
  const [loadingPurchases, setLoadingPurchases] = useState(false);
  const [items, setItems] = useState<LineItem[]>(initialData?.items ?? [emptyItem()]);
  const [vatType, setVatType] = useState<string>(initialData?.vatType ?? defaultVatType);
  const [vatRate, setVatRate] = useState<number>(initialData?.vatRate ?? defaultVatRate);
  const [availableLots, setAvailableLots] = useState<Record<number, LotAvailableJSON[]>>(initialData?.initialAvailableLots ?? {});
  const [lotsLoading, setLotsLoading] = useState<Record<number, boolean>>({});
  const [productOptions, setProductOptions] = useState<ProductOption[]>(products);
  const productMap = new Map(productOptions.map((product) => [product.id, product]));

  const loadLots = async (itemIdx: number, productId: string) => {
    setLotsLoading((prev) => ({ ...prev, [itemIdx]: true }));
    const result = await fetchProductLots(productId);
    if (!("error" in result)) {
      setAvailableLots((prev) => ({ ...prev, [itemIdx]: result }));
    }
    setLotsLoading((prev) => ({ ...prev, [itemIdx]: false }));
  };

  const handleSupplierChange = async (id: string) => {
    setSupplierId(id);
    if (!id) setSelectedSupplierOption(null);
    setPurchaseId("");
    setItems([emptyItem()]);
    setAvailableLots({});
    if (!id) {
      setFilteredPurchases([]);
      return;
    }
    setLoadingPurchases(true);
    const purchases = await getPurchasesForSupplier(id);
    setFilteredPurchases(purchases);
    setLoadingPurchases(false);
  };

  const handlePurchaseChange = async (id: string) => {
    setPurchaseId(id);
    setAvailableLots({});
    if (!id) return;
    const detail = await getPurchaseDetail(id);
    if (!detail) return;
    setProductOptions((prev) => {
      const next = new Map(prev.map((product) => [product.id, product]));
      detail.products.forEach((product) => {
        next.set(product.id, product);
      });
      return [...next.values()];
    });
    setItems(detail.items.map((item) => ({ ...item })));
    detail.items.forEach((item, index) => {
      if (item.lotItems.length > 0) void loadLots(index, item.productId);
    });
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
              lotItems: [],
            },
      ),
    );
  };

  const applySelectedProduct = (itemIndex: number, product: ProductOption) => {
    rememberProduct(product);
    clearCachedLots(itemIndex);
    const baseUnit = product.units.find((unit) => unit.isBase) ?? product.units[0];
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIndex
          ? item
          : {
              ...item,
              productId: product.id,
              unitName: baseUnit?.name ?? "",
              lotItems: product.isLotControl
                ? [{ lotNo: "", qty: item.qty, unitCost: 0, mfgDate: "", expDate: "" }]
                : [],
            },
      ),
    );
    if (product.isLotControl) void loadLots(itemIndex, product.id);
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

  const addLotRow = (itemIdx: number) => {
    setItems((prev) =>
      prev.map((item, idx) =>
        idx !== itemIdx
          ? item
          : {
              ...item,
              lotItems: [...item.lotItems, { lotNo: "", qty: 0, unitCost: 0, mfgDate: "", expDate: "" }],
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

  const updateLotRow = (itemIdx: number, lotIdx: number, field: keyof LotSubRow, value: string | number) => {
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

  const handleLotSelect = (itemIdx: number, lotIdx: number, lotNo: string) => {
    const item = items[itemIdx];
    const product = productMap.get(item.productId);
    const scale = product?.units.find((u) => u.name === item.unitName)?.scale ?? 1;
    const lot = (availableLots[itemIdx] ?? []).find((entry) => entry.lotNo === lotNo);

    setItems((prev) =>
      prev.map((entry, idx) => {
        if (idx !== itemIdx) return entry;
        return {
          ...entry,
          lotItems: entry.lotItems.map((subRow, index) =>
            index !== lotIdx
              ? subRow
              : {
                  lotNo,
                  qty: subRow.qty || (entry.lotItems.length === 1 ? entry.qty : 0),
                  unitCost: lot ? lot.unitCost * scale : subRow.unitCost,
                  mfgDate: lot?.mfgDate ?? "",
                  expDate: lot?.expDate ?? "",
                }
          ),
        };
      })
    );
  };

  const getUnits = (productId: string) => productMap.get(productId)?.units ?? [];

  const getDisplayCost = (productId: string, unitName: string): number => {
    const prod = productMap.get(productId);
    if (!prod) return 0;
    const unit = prod.units.find((u) => u.name === unitName);
    const scale = unit?.scale ?? 1;
    return prod.avgCost * scale;
  };

  const totalBeforeVat = items.reduce((sum, item) => {
    const cost = getDisplayCost(item.productId, item.unitName);
    return sum + item.qty * cost;
  }, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalBeforeVat, vatType as VatType, vatRate);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const form = e.currentTarget;
    const formData = new FormData(form);

    if (!supplierId) {
      setError("กรุณาเลือกผู้จำหน่าย");
      return;
    }
    formData.set("supplierId", supplierId);
    formData.set("purchaseId", purchaseId);

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
      if (product?.isLotControl) {
        const lotErr = validateLotRows(item.lotItems, item.qty, false);
        if (lotErr) {
          setError(lotErr);
          return;
        }
      }
    }

    formData.set("items", JSON.stringify(items));
    formData.set("vatType", vatType);
    formData.set("vatRate", String(vatRate));

    startTransition(async () => {
      if (isEdit && initialData) {
        const result = await updatePurchaseReturn(initialData.id, formData);
        if (result.error) setError(result.error);
        else router.push("/admin/purchase-returns");
      } else {
        const result = await createPurchaseReturn(formData);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess(`บันทึกสำเร็จ เลขที่คืนสินค้า: ${result.returnNo}`);
          setTimeout(() => router.push("/admin/purchase-returns"), 1500);
        }
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลการคืนสินค้า
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>วันที่คืน <span className="text-red-500">*</span></label>
            <input
              type="date"
              name="returnDate"
              required
              defaultValue={initialData?.returnDate ?? new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>ซัพพลายเออร์ <span className="text-red-500">*</span></label>
            <SearchableSelect
              options={suppliers.map((supplier): SelectOption => ({ id: supplier.id, label: supplier.name }))}
              value={supplierId}
              onChange={handleSupplierChange}
              onOptionSelect={setSelectedSupplierOption}
              searchOptions={searchPurchaseReturnSuppliers}
              selectedOption={selectedSupplierOption}
              placeholder="โปรดระบุผู้จำหน่าย"
            />
          </div>
          <div>
            <label className={labelCls}>อ้างอิงใบซื้อ</label>
            <SearchableSelect
              options={[
                { id: "", label: "-- ไม่อ้างอิง --" },
                ...filteredPurchases.map((purchase): SelectOption => ({
                  id: purchase.id,
                  label: purchase.purchaseNo,
                  sublabel: purchase.purchaseDate
                    ? new Date(purchase.purchaseDate).toLocaleDateString("th-TH-u-ca-gregory", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })
                    : undefined,
                })),
              ]}
              value={purchaseId}
              onChange={handlePurchaseChange}
              placeholder={loadingPurchases ? "กำลังโหลด..." : supplierId ? "-- ไม่อ้างอิง --" : "เลือกซัพพลายเออร์ก่อน"}
              disabled={!supplierId || loadingPurchases}
            />
            <input type="hidden" name="purchaseId" value={purchaseId} />
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
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100">
          <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f]">รายการสินค้าที่คืน</h2>
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
                <th className="text-right py-2 px-2 text-gray-500 font-medium w-36">ต้นทุน/หน่วย</th>
                <th className="text-right py-2 px-2 text-gray-500 font-medium w-28">รวม</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const units = getUnits(item.productId);
                const displayCost = getDisplayCost(item.productId, item.unitName);
                const product = productMap.get(item.productId);
                const isLot = !!product?.isLotControl;
                const scale = product?.units.find((u) => u.name === item.unitName)?.scale ?? 1;

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
                          searchProducts={searchPurchaseReturnProducts}
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
                      <td className="py-2 px-2 text-right text-gray-500 bg-gray-50 rounded">
                        {displayCost.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-2 text-right font-medium text-gray-700">
                        {(item.qty * displayCost).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
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
                              <div key={`${i}-${lotIdx}`} className="grid grid-cols-1 md:grid-cols-[2fr_120px_120px_140px_140px_32px] gap-2 items-center">
                                <select
                                  value={lot.lotNo}
                                  onChange={(e) => handleLotSelect(i, lotIdx, e.target.value)}
                                  className={`${inputCls} bg-white`}
                                >
                                  <option value="">{lotsLoading[i] ? "กำลังโหลด Lot..." : "-- เลือก Lot --"}</option>
                                  {(availableLots[i] ?? []).map((option) => (
                                    <option key={option.lotNo} value={option.lotNo}>
                                      {option.lotNo} ({(option.qtyOnHand / scale).toLocaleString("th-TH", { maximumFractionDigits: 4 })})
                                    </option>
                                  ))}
                                </select>
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
                  {totalBeforeVat.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
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
                <td colSpan={4} className="py-3 px-2 text-right text-sm font-semibold text-gray-700">ยอดสุทธิ</td>
                <td className="py-3 px-2 text-right font-bold text-[#1e3a5f] text-base">
                  {netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          * ต้นทุน/หน่วย คำนวณจาก avgCost ปัจจุบัน ณ เวลาที่บันทึก
        </p>
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
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกการคืนสินค้า"}
        </button>
      </div>
    </form>
  );
};

export default PurchaseReturnForm;
