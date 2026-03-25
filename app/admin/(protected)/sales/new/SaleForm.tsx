"use client";

import { useState, useTransition } from "react";
import { createSale } from "../actions";
import { Plus, Trash2, CheckCircle } from "lucide-react";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  salePrice: number;
  saleUnitName: string;
  units: { name: string; scale: number; isBase: boolean }[];
}

interface CustomerOption {
  id:    string;
  name:  string;
  phone: string | null;
  code:  string | null;
}

interface LineItem {
  productId: string;
  unitName:  string;
  qty:       number;
  salePrice: number;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const emptyItem = (): LineItem => ({ productId: "", unitName: "", qty: 1, salePrice: 0 });

const SaleForm = ({ products, customers }: { products: ProductOption[]; customers: CustomerOption[] }) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");
  const [items, setItems]         = useState<LineItem[]>([emptyItem()]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerNameOverride, setCustomerNameOverride] = useState("");
  const [customerPhoneOverride, setCustomerPhoneOverride] = useState("");

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof LineItem, value: string | number) => {
    setItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== i) return item;
        const updated = { ...item, [field]: value };
        if (field === "productId") {
          const prod = products.find((p) => p.id === String(value));
          updated.unitName  = prod?.saleUnitName ?? "";
          updated.salePrice = prod?.salePrice ?? 0;
        }
        return updated;
      })
    );
  };

  const getUnits = (productId: string) =>
    products.find((p) => p.id === productId)?.units ?? [];

  const totalAmount = items.reduce((sum, it) => sum + it.qty * it.salePrice, 0);

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId) {
      const found = customers.find((c) => c.id === customerId);
      setCustomerNameOverride(found?.name ?? "");
      setCustomerPhoneOverride(found?.phone ?? "");
    } else {
      setCustomerNameOverride("");
      setCustomerPhoneOverride("");
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    for (const item of items) {
      if (!item.productId) { setError("กรุณาเลือกสินค้าทุกรายการ"); return; }
      if (!item.unitName)  { setError("กรุณาเลือกหน่วยนับทุกรายการ"); return; }
      if (item.qty <= 0)   { setError("จำนวนต้องมากกว่า 0"); return; }
    }

    const form = e.currentTarget;
    const formData = new FormData(form);
    formData.set("items", JSON.stringify(items));

    startTransition(async () => {
      const result = await createSale(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`บันทึกสำเร็จ เลขที่ใบขาย: ${result.saleNo}`);
        setItems([emptyItem()]);
        setSelectedCustomerId("");
        setCustomerNameOverride("");
        setCustomerPhoneOverride("");
        form.reset();
      }
    });
  };

  // Compute discount from form state — we use a local state trick via controlled inputs
  // Since discount is a form field (uncontrolled), we read it live for the summary
  const [discount, setDiscount] = useState(0);
  const netAmount = Math.max(0, totalAmount - discount);

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
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>ลูกค้า</label>
            <select
              name="customerId"
              value={selectedCustomerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              className={`${inputCls} bg-white`}
            >
              <option value="">-- ลูกค้าทั่วไป --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `[${c.code}] ` : ""}{c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>ประเภทการขาย</label>
            <select name="saleType" className={`${inputCls} bg-white`}>
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
            <label className={labelCls}>ช่องทางชำระเงิน</label>
            <select name="paymentMethod" className={`${inputCls} bg-white`}>
              <option value="CASH">เงินสด</option>
              <option value="TRANSFER">โอนเงิน</option>
              <option value="CREDIT">เครดิต</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>ส่วนลดรวม (บาท)</label>
            <input
              type="number"
              name="discount"
              min={0}
              step={0.01}
              defaultValue={0}
              onChange={(e) => setDiscount(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <input
              type="text"
              name="note"
              maxLength={500}
              className={inputCls}
              placeholder="หมายเหตุ"
            />
          </div>
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
                      <select
                        value={item.productId}
                        onChange={(e) => updateItem(i, "productId", e.target.value)}
                        className={`${inputCls} bg-white`}
                      >
                        <option value="">-- เลือกสินค้า --</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            [{p.code}] {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={item.unitName}
                        onChange={(e) => updateItem(i, "unitName", e.target.value)}
                        disabled={!item.productId}
                        className={`${inputCls} bg-white`}
                      >
                        <option value="">หน่วย</option>
                        {units.map((u) => (
                          <option key={u.name} value={u.name}>
                            {u.name}
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
            <div className="flex justify-between text-gray-600">
              <span>ส่วนลด</span>
              <span className="font-medium text-red-500">
                -{discount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
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
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก..." : "บันทึกการขาย"}
        </button>
      </div>
    </form>
  );
};

export default SaleForm;
