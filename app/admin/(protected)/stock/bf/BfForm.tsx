"use client";

import { useState, useTransition } from "react";
import { createBF } from "./actions";
import { CheckCircle, Plus, Trash2 } from "lucide-react";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { getThailandDateKey } from "@/lib/th-date";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  avgCost: number;
  stock: number;
  isLotControl: boolean;
  requireExpiryDate: boolean;
  units: { name: string; scale: number; isBase: boolean }[];
}

interface LotRow {
  lotNo: string;
  qty: number;
  unitCost: number;
  mfgDate: string;
  expDate: string;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const BfForm = ({
  products,
  canCreate,
}: {
  products: ProductOption[];
  canCreate: boolean;
}) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [productId, setProductId]       = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [lotRows, setLotRows] = useState<LotRow[]>([]);

  const handleProductChange = (id: string) => {
    setProductId(id);
    const prod = products.find((p) => p.id === id) ?? null;
    setSelectedProduct(prod);
    setLotRows(prod?.isLotControl ? [{ lotNo: "", qty: 0, unitCost: 0, mfgDate: "", expDate: "" }] : []);
  };

  const addLotRow = () =>
    setLotRows((prev) => [...prev, { lotNo: "", qty: 0, unitCost: 0, mfgDate: "", expDate: "" }]);

  const removeLotRow = (i: number) =>
    setLotRows((prev) => prev.filter((_, idx) => idx !== i));

  const updateLotRow = (i: number, field: keyof LotRow, value: string | number) =>
    setLotRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const lotTotal = lotRows.reduce((s, r) => s + (r.qty || 0), 0);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const formData = new FormData(e.currentTarget);
    if (selectedProduct?.isLotControl && lotRows.length > 0) {
      formData.set("lotItems", JSON.stringify(lotRows));
    }
    startTransition(async () => {
      const result = await createBF(formData);
      if (result.error) setError(result.error);
      else {
        setSuccess(`บันทึกสำเร็จ เลขที่เอกสาร: ${result.docNo}`);
        (e.target as HTMLFormElement).reset();
        setSelectedProduct(null);
        setLotRows([]);
      }
    });
  };

  if (!canCreate) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-5">บันทึกยอดยกมา</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>วันที่เอกสาร <span className="text-red-500">*</span></label>
              <input type="date" name="docDate" required
              defaultValue={getThailandDateKey()}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>สินค้า <span className="text-red-500">*</span></label>
              <SearchableSelect
                options={products.map((p): SelectOption => ({ id: p.id, label: p.name, sublabel: p.code }))}
                value={productId}
                onChange={handleProductChange}
                placeholder="โปรดระบุสินค้า"
              />
              <input type="hidden" name="productId" value={productId} />
            </div>
            <div>
              <label className={labelCls}>หน่วยนับ <span className="text-red-500">*</span></label>
              <select name="unitName" required className={`${inputCls} bg-white`}
                disabled={!selectedProduct}>
                <option value="">-- โปรดระบุ --</option>
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
              {selectedProduct.isLotControl && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">Lot Control</span>
              )}
            </div>
          )}

          {/* Lot Sub-table */}
          {selectedProduct?.isLotControl && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-amber-800">รายการ Lot</p>
                <button type="button" onClick={addLotRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1 border border-dashed border-amber-400 hover:border-amber-600 text-amber-600 hover:text-amber-800 text-xs rounded-lg transition-colors">
                  <Plus size={12} /> เพิ่ม Lot
                </button>
              </div>
              {lotRows.map((lot, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">Lot No <span className="text-red-500">*</span></p>}
                    <input type="text" value={lot.lotNo}
                      onChange={(e) => updateLotRow(i, "lotNo", e.target.value)}
                      className={inputCls} placeholder="LOT-001" />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">จำนวน <span className="text-red-500">*</span></p>}
                    <AdminNumberInput value={lot.qty} min={0.0001} step={0.0001}
                      onValueChange={(value) => updateLotRow(i, "qty", value)}
                      className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">ต้นทุน/หน่วย</p>}
                    <AdminNumberInput value={lot.unitCost} min={0} step={0.01}
                      onValueChange={(value) => updateLotRow(i, "unitCost", value)}
                      className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">วันผลิต</p>}
                    <input type="date" value={lot.mfgDate}
                      onChange={(e) => updateLotRow(i, "mfgDate", e.target.value)}
                      className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <p className="text-xs text-gray-500 mb-1">วันหมดอายุ{selectedProduct.requireExpiryDate && <span className="text-red-500"> *</span>}</p>}
                    <input type="date" value={lot.expDate}
                      onChange={(e) => updateLotRow(i, "expDate", e.target.value)}
                      className={inputCls} />
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    {lotRows.length > 1 && (
                      <button type="button" onClick={() => removeLotRow(i)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <p className={`text-xs font-medium ${lotTotal > 0 ? "text-amber-700" : "text-gray-400"}`}>
                Lot รวม: {lotTotal} ชิ้น
              </p>
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
