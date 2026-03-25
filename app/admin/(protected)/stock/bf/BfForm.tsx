"use client";

import { useState, useTransition } from "react";
import { createBF } from "./actions";
import { CheckCircle } from "lucide-react";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  avgCost: number;
  stock: number;
  units: { name: string; scale: number; isBase: boolean }[];
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const BfForm = ({ products }: { products: ProductOption[] }) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);

  const handleProductChange = (id: string) => {
    setSelectedProduct(products.find((p) => p.id === id) ?? null);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createBF(formData);
      if (result.error) setError(result.error);
      else {
        setSuccess(`บันทึกสำเร็จ เลขที่เอกสาร: ${result.docNo}`);
        (e.target as HTMLFormElement).reset();
        setSelectedProduct(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-5">บันทึกยอดยกมา</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>วันที่เอกสาร <span className="text-red-500">*</span></label>
              <input type="date" name="docDate" required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>สินค้า <span className="text-red-500">*</span></label>
              <select name="productId" required
                onChange={(e) => handleProductChange(e.target.value)}
                className={`${inputCls} bg-white`}>
                <option value="">-- เลือกสินค้า --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>[{p.code}] {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>หน่วยนับ <span className="text-red-500">*</span></label>
              <select name="unitName" required className={`${inputCls} bg-white`}
                disabled={!selectedProduct}>
                <option value="">-- เลือกหน่วย --</option>
                {selectedProduct?.units.map((u) => (
                  <option key={u.name} value={u.name}>
                    {u.name}{u.isBase ? " (หน่วยหลัก)" : ` (1 ${u.name} = ${u.scale} หน่วยหลัก)`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>จำนวน <span className="text-red-500">*</span></label>
              <input type="number" name="qty" required min={0.0001} step={0.0001}
                className={inputCls} placeholder="0" />
            </div>
            <div>
              <label className={labelCls}>ราคาทุน/หน่วยหลัก (บาท) <span className="text-red-500">*</span></label>
              <input type="number" name="costPerBaseUnit" required min={0} step={0.0001}
                defaultValue={selectedProduct?.avgCost ?? 0}
                className={inputCls} placeholder="0.00" />
              <p className="text-xs text-gray-400 mt-1">ราคาทุนต่อหน่วยหลัก (base unit) ของสินค้า</p>
            </div>
            <div>
              <label className={labelCls}>หมายเหตุ</label>
              <input type="text" name="note" maxLength={500}
                className={inputCls} placeholder="หมายเหตุเพิ่มเติม" />
            </div>
          </div>

          {selectedProduct && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-blue-700">
              Stock ปัจจุบัน: <span className="font-medium">{selectedProduct.stock}</span> หน่วยหลัก |
              avgCost: <span className="font-medium">{Number(selectedProduct.avgCost).toFixed(4)}</span> บาท/หน่วยหลัก
            </div>
          )}

          {error && <p className="text-red-600 text-sm">{error}</p>}
          {success && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle size={16} /> {success}
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={isPending}
              className="px-6 py-2.5 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60">
              {isPending ? "กำลังบันทึก..." : "บันทึกยอดยกมา"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BfForm;
