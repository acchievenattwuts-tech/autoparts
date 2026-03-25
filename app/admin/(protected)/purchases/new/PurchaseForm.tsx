"use client";

import { useState, useTransition } from "react";
import { createPurchase } from "../actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  purchaseUnitName: string;
  costPrice: number;
  units: { name: string; scale: number; isBase: boolean }[];
}

interface SupplierOption { id: string; name: string }

interface LineItem {
  productId:  string;
  unitName:   string;
  qty:        number;
  costPrice:  number;
  landedCost: number;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const PurchaseForm = ({ products, suppliers }: { products: ProductOption[]; suppliers: SupplierOption[] }) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [discount, setDiscount] = useState(0);
  const [items, setItems]     = useState<LineItem[]>([
    { productId: "", unitName: "", qty: 1, costPrice: 0, landedCost: 0 },
  ]);

  const addItem = () =>
    setItems((prev) => [...prev, { productId: "", unitName: "", qty: 1, costPrice: 0, landedCost: 0 }]);

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof LineItem, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const updated = { ...item, [field]: value };
        if (field === "productId") {
          const prod = products.find((p) => p.id === String(value));
          updated.unitName  = prod?.purchaseUnitName ?? "";
          updated.costPrice = prod?.costPrice ?? 0;
        }
        return updated;
      })
    );
  };

  const getUnits = (productId: string) =>
    products.find((p) => p.id === productId)?.units ?? [];

  const totalAmount = items.reduce((sum, it) => sum + it.qty * it.costPrice, 0);
  const netAmount   = Math.max(0, totalAmount - discount);

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
    formData.set("discount", String(discount));

    startTransition(async () => {
      const result = await createPurchase(formData);
      if (result.error) setError(result.error);
      else {
        setSuccess(`บันทึกสำเร็จ เลขที่ใบซื้อ: ${result.purchaseNo}`);
        setItems([{ productId: "", unitName: "", qty: 1, costPrice: 0, landedCost: 0 }]);
        setDiscount(0);
        (e.target as HTMLFormElement).reset();
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
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ซัพพลายเออร์</label>
            <select name="supplierId" className={`${inputCls} bg-white`}>
              <option value="">-- ไม่ระบุ --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>เลขที่เอกสารอ้างอิง</label>
            <input
              type="text"
              name="referenceNo"
              maxLength={100}
              className={inputCls}
              placeholder="เช่น เลขที่ใบกำกับซัพพลายเออร์"
            />
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
            <input type="text" name="note" maxLength={500} className={inputCls} placeholder="หมายเหตุ" />
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
                return (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2 px-2">
                      <select value={item.productId}
                        onChange={(e) => updateItem(i, "productId", e.target.value)}
                        className={`${inputCls} bg-white`}>
                        <option value="">-- เลือกสินค้า --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>[{p.code}] {p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <select value={item.unitName}
                        onChange={(e) => updateItem(i, "unitName", e.target.value)}
                        disabled={!item.productId}
                        className={`${inputCls} bg-white`}>
                        <option value="">หน่วย</option>
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
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-100">
                <td colSpan={4} className="py-2 px-2 text-right text-sm text-gray-500">รวมก่อนส่วนลด</td>
                <td className="py-2 px-2 text-right text-gray-700">
                  {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
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
          ) : "บันทึกใบซื้อ"}
        </button>
      </div>
    </form>
  );
};

export default PurchaseForm;
