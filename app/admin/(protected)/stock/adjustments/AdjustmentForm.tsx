"use client";

import { useState, useTransition } from "react";
import { createAdjustment } from "./actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";
import ProductSearchSelect from "@/components/shared/ProductSearchSelect";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  stock: number;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  units: { name: string; scale: number; isBase: boolean }[];
}

interface AdjItem {
  productId: string;
  unitName: string;
  qty: number;
  type: "ADJUST_IN" | "ADJUST_OUT";
  reason: string;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const AdjustmentForm = ({ products }: { products: ProductOption[] }) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [items, setItems]     = useState<AdjItem[]>([
    { productId: "", unitName: "", qty: 1, type: "ADJUST_IN", reason: "" },
  ]);

  const addItem = () =>
    setItems((prev) => [...prev, { productId: "", unitName: "", qty: 1, type: "ADJUST_IN", reason: "" }]);

  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof AdjItem, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const updated = { ...item, [field]: value };
        if (field === "productId") updated.unitName = "";
        return updated;
      })
    );
  };

  const getUnits = (productId: string) =>
    products.find((p) => p.id === productId)?.units ?? [];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setSuccess("");

    for (const item of items) {
      if (!item.productId) { setError("กรุณาเลือกสินค้าทุกรายการ"); return; }
      if (!item.unitName)  { setError("กรุณาเลือกหน่วยนับทุกรายการ"); return; }
      if (item.qty <= 0)   { setError("จำนวนต้องมากกว่า 0"); return; }
    }

    const formData = new FormData(e.currentTarget);
    formData.set("items", JSON.stringify(items));

    startTransition(async () => {
      const result = await createAdjustment(formData);
      if (result.error) setError(result.error);
      else {
        setSuccess(`บันทึกสำเร็จ เลขที่เอกสาร: ${result.adjustNo}`);
        setItems([{ productId: "", unitName: "", qty: 1, type: "ADJUST_IN", reason: "" }]);
        (e.target as HTMLFormElement).reset();
      }
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-5">บันทึกปรับสต็อก</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>วันที่เอกสาร <span className="text-red-500">*</span></label>
            <input type="date" name="adjustDate" required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <input type="text" name="note" maxLength={500} className={inputCls} placeholder="หมายเหตุเอกสาร" />
          </div>
        </div>

        {/* Items */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">รายการสินค้า</p>
            <button type="button" onClick={addItem}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-gray-300 hover:border-[#1e3a5f] text-gray-500 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors">
              <Plus size={14} /> เพิ่มรายการ
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item, i) => {
              const units = getUnits(item.productId);
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-end p-3 bg-gray-50 rounded-lg">
                  <div className="col-span-3">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">สินค้า</p>}
                    <ProductSearchSelect
                      products={products}
                      value={item.productId}
                      onChange={(id) => updateItem(i, "productId", id)}
                    />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">หน่วย</p>}
                    <select value={item.unitName}
                      onChange={(e) => updateItem(i, "unitName", e.target.value)}
                      disabled={!item.productId}
                      className={`${inputCls} bg-white`}>
                      <option value="">-- โปรดระบุ --</option>
                      {units.map((u) => (
                        <option key={u.name} value={u.name}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">จำนวน</p>}
                    <input type="number" value={item.qty} min={0.0001} step={0.0001}
                      onChange={(e) => updateItem(i, "qty", Number(e.target.value))}
                      className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">ประเภท</p>}
                    <select value={item.type}
                      onChange={(e) => updateItem(i, "type", e.target.value as "ADJUST_IN" | "ADJUST_OUT")}
                      className={`${inputCls} bg-white`}>
                      <option value="ADJUST_IN">เพิ่ม (+)</option>
                      <option value="ADJUST_OUT">ลด (-)</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">เหตุผล</p>}
                    <input type="text" value={item.reason}
                      onChange={(e) => updateItem(i, "reason", e.target.value)}
                      maxLength={200} placeholder="เหตุผล" className={inputCls} />
                  </div>
                  <div className="col-span-1 flex justify-center pb-0.5">
                    {items.length > 1 && (
                      <button type="button" onClick={() => removeItem(i)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1">
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
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
          <button type="submit" disabled={isPending}
            className="px-6 py-2.5 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60">
            {isPending ? "กำลังบันทึก..." : "บันทึกการปรับสต็อก"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AdjustmentForm;
