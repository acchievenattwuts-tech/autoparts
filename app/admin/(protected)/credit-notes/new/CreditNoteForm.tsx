"use client";

import { useState, useTransition } from "react";
import { createCreditNote } from "../actions";
import { Plus, Trash2, CheckCircle, Info } from "lucide-react";
import { calcVat, VAT_TYPE_LABELS, type VatType } from "@/lib/vat";

interface ProductOption {
  id: string;
  code: string;
  name: string;
  salePrice: number;
  saleUnitName: string;
  units: { name: string; scale: number; isBase: boolean }[];
}

interface SaleOption {
  id: string;
  saleNo: string;
  customerName: string | null;
  saleDate: Date;
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

const CreditNoteForm = ({
  products,
  sales,
  defaultVatType,
  defaultVatRate,
}: {
  products: ProductOption[];
  sales: SaleOption[];
  defaultVatType: string;
  defaultVatRate: number;
}) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError]         = useState("");
  const [success, setSuccess]     = useState("");
  const [items, setItems]         = useState<LineItem[]>([emptyItem()]);
  const [cnType, setCnType]       = useState<"RETURN" | "DISCOUNT" | "OTHER">("RETURN");
  const [settlementType, setSettlementType] = useState<"CASH_REFUND" | "CREDIT_DEBT">("CASH_REFUND");
  const [refundMethod, setRefundMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [vatType, setVatType] = useState<string>(defaultVatType);
  const [vatRate, setVatRate] = useState<number>(defaultVatRate);

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
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, vatType as VatType, vatRate);

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
    formData.set("vatType", vatType);
    formData.set("vatRate", String(vatRate));

    startTransition(async () => {
      const result = await createCreditNote(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(`บันทึกสำเร็จ เลขที่ CN: ${result.cnNo}`);
        setItems([emptyItem()]);
        setCnType("RETURN");
        setSettlementType("CASH_REFUND");
        setRefundMethod("CASH");
        setVatType(defaultVatType);
        setVatRate(defaultVatRate);
        form.reset();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลใบลดหนี้ (Credit Note)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>
              วันที่ CN <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              name="cnDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>อ้างอิงใบขาย</label>
            <select name="saleId" className={`${inputCls} bg-white`}>
              <option value="">-- ไม่อ้างอิง --</option>
              {sales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.saleNo}{s.customerName ? ` - ${s.customerName}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>การชำระ CN</label>
            <input type="hidden" name="settlementType" value={settlementType} />
            <input type="hidden" name="refundMethod" value={settlementType === "CASH_REFUND" ? refundMethod : ""} />
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setSettlementType("CASH_REFUND")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  settlementType === "CASH_REFUND"
                    ? "bg-emerald-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                คืนเป็นเงินสด
              </button>
              <button
                type="button"
                onClick={() => setSettlementType("CREDIT_DEBT")}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${
                  settlementType === "CREDIT_DEBT"
                    ? "bg-orange-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ตั้งหนี้
              </button>
            </div>
          </div>
          {settlementType === "CASH_REFUND" && (
            <div>
              <label className={labelCls}>ช่องทางการคืนเงิน <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                {(["CASH", "TRANSFER"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRefundMethod(m)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      refundMethod === m
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                    }`}
                  >
                    {m === "CASH" ? "เงินสด" : "โอนเงิน"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <label className={labelCls}>
              ประเภท CN <span className="text-red-500">*</span>
            </label>
            <select
              name="type"
              value={cnType}
              onChange={(e) => setCnType(e.target.value as "RETURN" | "DISCOUNT" | "OTHER")}
              className={`${inputCls} bg-white`}
            >
              <option value="RETURN">รับคืนสินค้า</option>
              <option value="DISCOUNT">ส่วนราคา / ส่วนลด</option>
              <option value="OTHER">อื่นๆ</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className={labelCls}>หมายเหตุ</label>
            <input
              type="text"
              name="note"
              maxLength={500}
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
                  <input
                    type="number"
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value))}
                    min={0} max={100} step={0.01}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm text-center"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Type info box */}
        {cnType === "RETURN" ? (
          <div className="mt-4 flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>รับคืนสินค้าเข้าสต็อก — ระบบจะบันทึกการรับสินค้าคืนเข้าคลังโดยอัตโนมัติ</span>
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>ไม่กระทบสต็อก — ใช้สำหรับออกใบลดหนี้ประเภทส่วนลดราคาหรืออื่นๆ เท่านั้น</span>
          </div>
        )}
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
                        <option value="">-- โปรดระบุ --</option>
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
            <tfoot>
              <tr className="border-t border-gray-100">
                <td colSpan={4} className="py-2 px-2 text-right text-sm text-gray-500">ยอดรวม</td>
                <td className="py-2 px-2 text-right text-gray-700">
                  {totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                </td>
                <td />
              </tr>
              {vatType !== "NO_VAT" && (
                <>
                  <tr>
                    <td colSpan={4} className="py-1 px-2 text-right text-sm text-gray-500">
                      ยอดก่อนภาษี
                    </td>
                    <td className="py-1 px-2 text-right text-gray-700">
                      {subtotalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={4} className="py-1 px-2 text-right text-sm text-gray-500">
                      VAT {vatRate}%
                    </td>
                    <td className="py-1 px-2 text-right text-gray-700">
                      +{vatAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td />
                  </tr>
                </>
              )}
              <tr className="border-t border-gray-200">
                <td colSpan={4} className="py-3 px-2 text-right text-sm font-medium text-gray-600">
                  ยอดรวม CN
                </td>
                <td className="py-3 px-2 text-right font-bold text-gray-900">
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
          ) : (
            "บันทึก Credit Note"
          )}
        </button>
      </div>
    </form>
  );
};

export default CreditNoteForm;
