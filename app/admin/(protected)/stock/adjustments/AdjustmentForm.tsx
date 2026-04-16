"use client";

import { useState, useTransition } from "react";
import { createAdjustment, fetchAdjustmentProductLots } from "./actions";
import { Plus, Trash2, CheckCircle, Zap } from "lucide-react";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import {
  validateLotRows,
  autoAllocateLots,
  type LotSubRow,
  type LotAvailableJSON,
} from "@/lib/lot-control-client";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  stock: number;
  costPrice: number;
  salePrice: number;
  isLotControl: boolean;
  requireExpiryDate: boolean;
  lotIssueMethod: string;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  units: { name: string; scale: number; isBase: boolean }[];
}

interface AdjItem {
  productId: string;
  unitName: string;
  qty: number;
  price: number;
  type: "ADJUST_IN" | "ADJUST_OUT";
  reason: string;
  lotItems: LotSubRow[];
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const emptyItem = (): AdjItem => ({
  productId: "",
  unitName: "",
  qty: 1,
  price: 0,
  type: "ADJUST_IN",
  reason: "",
  lotItems: [],
});

const getDefaultPrice = (
  product: ProductOption | undefined,
  type: "ADJUST_IN" | "ADJUST_OUT",
) => (product ? (type === "ADJUST_IN" ? product.costPrice : product.salePrice) : 0);

const AdjustmentForm = ({
  products,
  canCreate,
}: {
  products: ProductOption[];
  canCreate: boolean;
}) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [items, setItems] = useState<AdjItem[]>([emptyItem()]);
  const [availableLots, setAvailableLots] = useState<Record<number, LotAvailableJSON[]>>({});
  const [lotsLoading, setLotsLoading] = useState<Record<number, boolean>>({});

  const loadLots = async (itemIdx: number, productId: string, lotIssueMethod: string) => {
    setLotsLoading((prev) => ({ ...prev, [itemIdx]: true }));
    const result = await fetchAdjustmentProductLots(productId, lotIssueMethod);
    if (!("error" in result)) setAvailableLots((prev) => ({ ...prev, [itemIdx]: result }));
    setLotsLoading((prev) => ({ ...prev, [itemIdx]: false }));
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof Omit<AdjItem, "lotItems">, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const updated = { ...item, [field]: value };

        if (field === "productId") {
          const product = products.find((p) => p.id === String(value));
          updated.unitName = "";
          updated.price = getDefaultPrice(product, updated.type);
          updated.lotItems = [];
          setAvailableLots((prevLots) => {
            const next = { ...prevLots };
            delete next[i];
            return next;
          });

          if (product?.isLotControl) {
            updated.lotItems = [
              {
                lotNo: "",
                qty: updated.qty,
                unitCost: updated.price,
                mfgDate: "",
                expDate: "",
              },
            ];
            if (updated.type === "ADJUST_OUT") loadLots(i, product.id, product.lotIssueMethod);
          }
        }

        if (field === "type") {
          const product = products.find((p) => p.id === updated.productId);
          const nextType = String(value) as "ADJUST_IN" | "ADJUST_OUT";
          updated.price = getDefaultPrice(product, nextType);

          if (product?.isLotControl) {
            updated.lotItems = [
              {
                lotNo: "",
                qty: updated.qty,
                unitCost: updated.price,
                mfgDate: "",
                expDate: "",
              },
            ];
            setAvailableLots((prevLots) => {
              const next = { ...prevLots };
              delete next[i];
              return next;
            });
            if (nextType === "ADJUST_OUT") loadLots(i, product.id, product.lotIssueMethod);
          }
        }

        if (field === "qty" && updated.productId) {
          const product = products.find((p) => p.id === updated.productId);
          if (product?.isLotControl && updated.lotItems.length === 1) {
            updated.lotItems = [{ ...updated.lotItems[0], qty: Number(value) }];
          }
        }

        if (field === "price" && updated.productId) {
          const product = products.find((p) => p.id === updated.productId);
          if (product?.isLotControl && updated.type === "ADJUST_IN" && updated.lotItems.length === 1) {
            updated.lotItems = [{ ...updated.lotItems[0], unitCost: Number(value) }];
          }
        }

        return updated;
      }),
    );
  };

  const handleLotSelect = (itemIdx: number, lotIdx: number, lotNo: string) => {
    const item = items[itemIdx];
    const product = products.find((p) => p.id === item.productId);
    const scale = product?.units.find((u) => u.name === item.unitName)?.scale ?? 1;
    const availableLot = (availableLots[itemIdx] ?? []).find((lot) => lot.lotNo === lotNo);
    const usedQty = item.lotItems.reduce((sum, lot, rowIdx) => (rowIdx !== lotIdx ? sum + lot.qty : sum), 0);
    const remainingQty = Math.max(0, item.qty - usedQty);
    const availableQty = availableLot ? Math.round((availableLot.qtyOnHand / scale) * 10000) / 10000 : 0;

    setItems((prev) =>
      prev.map((current, idx) => {
        if (idx !== itemIdx) return current;
        return {
          ...current,
          lotItems: current.lotItems.map((lot, rowIdx) =>
            rowIdx !== lotIdx
              ? lot
              : {
                  lotNo,
                  qty: availableLot ? Math.min(availableQty, remainingQty) : 0,
                  unitCost: availableLot ? availableLot.unitCost * scale : 0,
                  mfgDate: availableLot?.mfgDate ?? "",
                  expDate: availableLot?.expDate ?? "",
                },
          ),
        };
      }),
    );
  };

  const handleAutoAllocate = async (itemIdx: number) => {
    const item = items[itemIdx];
    const product = products.find((p) => p.id === item.productId);
    if (!product?.isLotControl) return;

    const scale = product.units.find((u) => u.name === item.unitName)?.scale ?? 1;
    let available = availableLots[itemIdx];
    if (!available) {
      const result = await fetchAdjustmentProductLots(item.productId, product.lotIssueMethod);
      if ("error" in result) return;
      available = result;
      setAvailableLots((prev) => ({ ...prev, [itemIdx]: available }));
    }

    const allocated = autoAllocateLots(available, item.qty, scale);
    setItems((prev) =>
      prev.map((current, idx) => (idx !== itemIdx ? current : { ...current, lotItems: allocated })),
    );
  };

  const addLotRow = (itemIdx: number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== itemIdx) return item;
        return {
          ...item,
          lotItems: [
            ...item.lotItems,
            {
              lotNo: "",
              qty: 0,
              unitCost: item.type === "ADJUST_IN" ? item.price : 0,
              mfgDate: "",
              expDate: "",
            },
          ],
        };
      }),
    );
  };

  const removeLotRow = (itemIdx: number, lotIdx: number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== itemIdx) return item;
        return { ...item, lotItems: item.lotItems.filter((_, rowIdx) => rowIdx !== lotIdx) };
      }),
    );
  };

  const updateLotRow = (itemIdx: number, lotIdx: number, field: keyof LotSubRow, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== itemIdx) return item;
        return {
          ...item,
          lotItems: item.lotItems.map((lot, rowIdx) =>
            rowIdx === lotIdx ? { ...lot, [field]: value } : lot,
          ),
        };
      }),
    );
  };

  const getUnits = (productId: string) => products.find((p) => p.id === productId)?.units ?? [];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

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
      if (item.price < 0) {
        setError("ราคาต้องไม่น้อยกว่า 0");
        return;
      }

      const product = products.find((p) => p.id === item.productId);
      if (product?.isLotControl && item.lotItems.length > 0) {
        const lotError = validateLotRows(
          item.lotItems,
          item.qty,
          item.type === "ADJUST_IN" && product.requireExpiryDate,
        );
        if (lotError) {
          setError(lotError);
          return;
        }
      }
    }

    const formData = new FormData(e.currentTarget);
    formData.set("items", JSON.stringify(items));

    startTransition(async () => {
      const result = await createAdjustment(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      setSuccess(`บันทึกสำเร็จ เลขที่เอกสาร: ${result.adjustNo}`);
      setItems([emptyItem()]);
      setAvailableLots({});
      (e.target as HTMLFormElement).reset();
    });
  };

  if (!canCreate) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-5">บันทึกปรับสต๊อก</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              วันที่เอกสาร <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="adjustDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={`${inputCls} bg-white`}
            />
          </div>
          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <input
              type="text"
              name="note"
              maxLength={500}
              className={`${inputCls} bg-white`}
              placeholder="หมายเหตุเอกสาร"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">รายการสินค้า</p>
            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors"
            >
              <Plus size={14} /> เพิ่มรายการ
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, i) => {
              const units = getUnits(item.productId);
              const product = products.find((p) => p.id === item.productId);
              const isLotControl = product?.isLotControl ?? false;
              const totalLotQty = item.lotItems.reduce((sum, lot) => sum + lot.qty, 0);

              return (
                <div key={i} className="p-3 bg-white border border-gray-200 rounded-lg space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 md:col-span-3">
                      {i === 0 && <p className="text-xs text-gray-500 mb-1">สินค้า</p>}
                      <ProductSearchSelect
                        products={products}
                        value={item.productId}
                        onChange={(id) => updateItem(i, "productId", id)}
                      />
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      {i === 0 && <p className="text-xs text-gray-500 mb-1">หน่วย</p>}
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
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      {i === 0 && <p className="text-xs text-gray-500 mb-1">จำนวน</p>}
                      <AdminNumberInput
                        value={item.qty}
                        min={0.0001}
                        step={0.0001}
                        onValueChange={(value) => updateItem(i, "qty", value)}
                        className={`${inputCls} bg-white`}
                      />
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      {i === 0 && <p className="text-xs text-gray-500 mb-1">ประเภท</p>}
                      <select
                        value={item.type}
                        onChange={(e) => updateItem(i, "type", e.target.value as "ADJUST_IN" | "ADJUST_OUT")}
                        className={`${inputCls} bg-white`}
                      >
                        <option value="ADJUST_IN">เพิ่ม (+)</option>
                        <option value="ADJUST_OUT">ลด (-)</option>
                      </select>
                    </div>
                    <div className="col-span-6 md:col-span-2">
                      {i === 0 && <p className="text-xs text-gray-500 mb-1">ราคา/หน่วย</p>}
                      <AdminNumberInput
                        value={item.price}
                        min={0}
                        step={0.01}
                        onValueChange={(value) => updateItem(i, "price", value)}
                        className={`${inputCls} bg-white`}
                      />
                    </div>
                    <div className="col-span-10 md:col-span-2">
                      {i === 0 && <p className="text-xs text-gray-500 mb-1">เหตุผล</p>}
                      <input
                        type="text"
                        value={item.reason}
                        onChange={(e) => updateItem(i, "reason", e.target.value)}
                        maxLength={200}
                        placeholder="เหตุผล"
                        className={`${inputCls} bg-white`}
                      />
                    </div>
                    <div className="col-span-2 md:col-span-1 flex justify-center pb-0.5">
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          className="text-red-400 hover:text-red-600 transition-colors p-1"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isLotControl && item.lotItems.length > 0 && (
                    <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2 ml-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                            Lot Control
                          </span>
                          <span className={`text-xs ${totalLotQty > 0 ? "text-amber-700" : "text-gray-400"}`}>
                            Lot รวม: {totalLotQty} | ต้องการ: {item.qty}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.type === "ADJUST_OUT" && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleAutoAllocate(i)}
                                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 bg-indigo-50 px-2 py-0.5 rounded transition-colors"
                              >
                                <Zap size={11} /> Auto จัดสรร
                              </button>
                              {lotsLoading[i] && (
                                <span className="text-xs text-gray-400 animate-pulse">กำลังโหลด...</span>
                              )}
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => addLotRow(i)}
                            className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 border border-dashed border-amber-300 px-2 py-0.5 rounded transition-colors"
                          >
                            <Plus size={11} /> เพิ่ม Lot
                          </button>
                        </div>
                      </div>

                      {item.type === "ADJUST_IN" && (
                        <div className="space-y-1.5">
                          {item.lotItems.map((lot, li) => (
                            <div key={li} className="grid grid-cols-12 gap-2 items-end">
                              <div className="col-span-12 md:col-span-2">
                                {li === 0 && (
                                  <p className="text-xs text-gray-500 mb-1">
                                    Lot No <span className="text-red-500">*</span>
                                  </p>
                                )}
                                <input
                                  type="text"
                                  value={lot.lotNo}
                                  onChange={(e) => updateLotRow(i, li, "lotNo", e.target.value)}
                                  className={`${inputCls} bg-white`}
                                  placeholder="LOT-001"
                                />
                              </div>
                              <div className="col-span-6 md:col-span-2">
                                {li === 0 && (
                                  <p className="text-xs text-gray-500 mb-1">
                                    จำนวน <span className="text-red-500">*</span>
                                  </p>
                                )}
                                <AdminNumberInput
                                  value={lot.qty}
                                  min={0.0001}
                                  step={0.0001}
                                  onValueChange={(value) => updateLotRow(i, li, "qty", value)}
                                  className={`${inputCls} bg-white`}
                                />
                              </div>
                              <div className="col-span-6 md:col-span-2">
                                {li === 0 && <p className="text-xs text-gray-500 mb-1">ต้นทุน/หน่วย</p>}
                                <AdminNumberInput
                                  value={lot.unitCost}
                                  min={0}
                                  step={0.01}
                                  onValueChange={(value) => updateLotRow(i, li, "unitCost", value)}
                                  className={`${inputCls} bg-white`}
                                />
                              </div>
                              <div className="col-span-6 md:col-span-2">
                                {li === 0 && <p className="text-xs text-gray-500 mb-1">วันผลิต</p>}
                                <input
                                  type="date"
                                  value={lot.mfgDate}
                                  onChange={(e) => updateLotRow(i, li, "mfgDate", e.target.value)}
                                  className={`${inputCls} bg-white`}
                                />
                              </div>
                              <div className="col-span-6 md:col-span-2">
                                {li === 0 && (
                                  <p className="text-xs text-gray-500 mb-1">
                                    วันหมดอายุ
                                    {product?.requireExpiryDate && <span className="text-red-500"> *</span>}
                                  </p>
                                )}
                                <input
                                  type="date"
                                  value={lot.expDate}
                                  onChange={(e) => updateLotRow(i, li, "expDate", e.target.value)}
                                  className={`${inputCls} bg-white`}
                                />
                              </div>
                              <div className="col-span-12 md:col-span-2 flex items-center gap-2">
                                {item.lotItems.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeLotRow(i, li)}
                                    className="text-red-400 hover:text-red-600 transition-colors p-1"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {item.type === "ADJUST_OUT" && (
                        <div className="space-y-1.5">
                          {item.lotItems.map((lot, li) => {
                            const scale = product?.units.find((u) => u.name === item.unitName)?.scale ?? 1;
                            const selectedLotNos = item.lotItems
                              .filter((_, rowIdx) => rowIdx !== li)
                              .map((row) => row.lotNo);
                            const lotOptions = (availableLots[i] ?? []).filter(
                              (availableLot) =>
                                availableLot.lotNo === lot.lotNo || !selectedLotNos.includes(availableLot.lotNo),
                            );

                            return (
                              <div
                                key={li}
                                className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-2 py-1.5"
                              >
                                <div className="flex-1 min-w-0">
                                  <select
                                    value={lot.lotNo}
                                    onChange={(e) => handleLotSelect(i, li, e.target.value)}
                                    className="w-full px-2 py-1 border border-amber-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                                  >
                                    <option value="">-- เลือก Lot --</option>
                                    {lotOptions.length === 0 && lot.lotNo === "" && (
                                      <option disabled value="">
                                        ไม่มี Lot คงเหลือ
                                      </option>
                                    )}
                                    {lotOptions.map((availableLot) => {
                                      const qtyInUnit = Math.round((availableLot.qtyOnHand / scale) * 10000) / 10000;
                                      const expLabel = availableLot.expDate
                                        ? new Date(availableLot.expDate).toLocaleDateString("th-TH-u-ca-gregory", {
                                            day: "2-digit",
                                            month: "2-digit",
                                            year: "numeric",
                                          })
                                        : "ไม่มี EXP";

                                      return (
                                        <option key={availableLot.lotNo} value={availableLot.lotNo}>
                                          {availableLot.lotNo} | EXP {expLabel} | คงเหลือ {qtyInUnit} {item.unitName}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                                <div className="w-24 shrink-0">
                                  <AdminNumberInput
                                    value={lot.qty}
                                    min={0.0001}
                                    step={0.0001}
                                    onValueChange={(value) => updateLotRow(i, li, "qty", value)}
                                    className="w-full px-2 py-1 border border-amber-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 text-right bg-white"
                                    placeholder="จำนวน"
                                  />
                                </div>
                                {lot.expDate && (
                                  <span className="text-xs text-gray-500 whitespace-nowrap shrink-0">
                                    EXP{" "}
                                    {new Date(lot.expDate).toLocaleDateString("th-TH-u-ca-gregory", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                    })}
                                  </span>
                                )}
                                {item.lotItems.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeLotRow(i, li)}
                                    className="text-red-400 hover:text-red-600 shrink-0"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {success && (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle size={16} /> {success}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isPending}
            className="px-6 py-2.5 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึกการปรับสต๊อก"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdjustmentForm;
