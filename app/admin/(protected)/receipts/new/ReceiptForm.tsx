"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getCreditSalesForCustomer, createReceipt, CreditSaleItem } from "../actions";

interface CustomerOption {
  id:   string;
  name: string;
  code: string | null;
}

interface Props {
  customers: CustomerOption[];
}

interface SelectedItem {
  saleId:      string;
  saleNo:      string;
  outstanding: number;
  paidAmount:  number;
}

const ReceiptForm = ({ customers }: Props) => {
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);

  const [customerId,      setCustomerId]      = useState("");
  const [receiptDate,     setReceiptDate]      = useState(today);
  const [creditSales,     setCreditSales]      = useState<CreditSaleItem[]>([]);
  const [selectedItems,   setSelectedItems]    = useState<SelectedItem[]>([]);
  const [paymentMethod,   setPaymentMethod]    = useState<"CASH" | "TRANSFER">("CASH");
  const [note,            setNote]             = useState("");
  const [isLoadingSales,  setIsLoadingSales]   = useState(false);
  const [isPending,       startTransition]     = useTransition();
  const [error,           setError]            = useState("");
  const [successMsg,      setSuccessMsg]       = useState("");

  // Load credit sales when customer changes
  useEffect(() => {
    if (!customerId) {
      setCreditSales([]);
      setSelectedItems([]);
      return;
    }
    setIsLoadingSales(true);
    getCreditSalesForCustomer(customerId)
      .then((sales) => {
        setCreditSales(sales);
        // Default: select all with full outstanding
        setSelectedItems(
          sales.map((s) => ({
            saleId:      s.id,
            saleNo:      s.saleNo,
            outstanding: s.outstanding,
            paidAmount:  s.outstanding,
          })),
        );
      })
      .catch(() => {
        setCreditSales([]);
        setSelectedItems([]);
      })
      .finally(() => setIsLoadingSales(false));
  }, [customerId]);

  const isChecked = (saleId: string) =>
    selectedItems.some((i) => i.saleId === saleId);

  const toggleItem = (sale: CreditSaleItem) => {
    if (isChecked(sale.id)) {
      setSelectedItems((prev) => prev.filter((i) => i.saleId !== sale.id));
    } else {
      setSelectedItems((prev) => [
        ...prev,
        {
          saleId:      sale.id,
          saleNo:      sale.saleNo,
          outstanding: sale.outstanding,
          paidAmount:  sale.outstanding,
        },
      ]);
    }
  };

  const updatePaidAmount = (saleId: string, value: number) => {
    setSelectedItems((prev) =>
      prev.map((i) =>
        i.saleId === saleId
          ? { ...i, paidAmount: Math.max(0, Math.min(value, i.outstanding)) }
          : i,
      ),
    );
  };

  const totalToPay = selectedItems.reduce((sum, i) => sum + i.paidAmount, 0);

  const selectedCustomer = customers.find((c) => c.id === customerId);

  const handleSubmit = () => {
    setError("");
    setSuccessMsg("");

    if (!customerId) {
      setError("กรุณาเลือกลูกค้า");
      return;
    }
    if (selectedItems.length === 0) {
      setError("กรุณาเลือกรายการขายที่ต้องการชำระ");
      return;
    }
    if (selectedItems.some((i) => i.paidAmount <= 0)) {
      setError("ยอดชำระงวดนี้ต้องมากกว่า 0 ทุกรายการ");
      return;
    }

    const formData = new FormData();
    formData.set("customerId",    customerId);
    formData.set("customerName",  selectedCustomer?.name ?? "");
    formData.set("receiptDate",   receiptDate);
    formData.set("paymentMethod", paymentMethod);
    formData.set("note",          note);
    formData.set("items",         JSON.stringify(
      selectedItems.map((i) => ({ saleId: i.saleId, paidAmount: i.paidAmount })),
    ));

    startTransition(async () => {
      const result = await createReceipt(formData);
      if (result.success) {
        setSuccessMsg(`บันทึกใบเสร็จ ${result.receiptNo} สำเร็จ`);
        setTimeout(() => router.push("/admin/receipts"), 1500);
      } else {
        setError(result.error ?? "เกิดข้อผิดพลาด");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">ข้อมูลทั่วไป</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Customer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ลูกค้า <span className="text-red-500">*</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            >
              <option value="">-- เลือกลูกค้า --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `[${c.code}] ` : ""}{c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              วันที่รับชำระ <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          </div>

          {/* Payment method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ช่องทางชำระ <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-3">
              {(["CASH", "TRANSFER"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium border transition-colors ${
                    paymentMethod === method
                      ? "bg-[#1e3a5f] text-white border-[#1e3a5f]"
                      : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {method === "CASH" ? "เงินสด" : "โอนเงิน"}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Credit sales */}
      {customerId && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">
            รายการขายเชื่อค้างชำระ
          </h2>

          {isLoadingSales ? (
            <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด...</p>
          ) : creditSales.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              ลูกค้ารายนี้ไม่มียอดค้างชำระ
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-10 py-3 px-3" />
                    <th className="text-left py-3 px-3 font-medium text-gray-600">เลขที่ใบขาย</th>
                    <th className="text-left py-3 px-3 font-medium text-gray-600">วันที่</th>
                    <th className="text-right py-3 px-3 font-medium text-gray-600">ยอดทั้งหมด</th>
                    <th className="text-right py-3 px-3 font-medium text-gray-600">ชำระแล้ว</th>
                    <th className="text-right py-3 px-3 font-medium text-gray-600">ค้างชำระ</th>
                    <th className="text-right py-3 px-3 font-medium text-gray-600">ชำระงวดนี้</th>
                  </tr>
                </thead>
                <tbody>
                  {creditSales.map((sale) => {
                    const checked = isChecked(sale.id);
                    const item    = selectedItems.find((i) => i.saleId === sale.id);
                    return (
                      <tr
                        key={sale.id}
                        className={`border-t border-gray-50 transition-colors ${
                          checked ? "bg-blue-50/40" : "hover:bg-gray-50"
                        }`}
                      >
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleItem(sale)}
                            className="w-4 h-4 accent-[#1e3a5f]"
                          />
                        </td>
                        <td className="py-2 px-3 font-mono text-[#1e3a5f] font-medium">
                          {sale.saleNo}
                        </td>
                        <td className="py-2 px-3 text-gray-600">
                          {new Date(sale.saleDate).toLocaleDateString("th-TH")}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-800">
                          {sale.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-600">
                          {sale.paidAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-right font-medium text-orange-600">
                          {sale.outstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {checked ? (
                            <input
                              type="number"
                              min={0}
                              max={sale.outstanding}
                              step={0.01}
                              value={item?.paidAmount ?? sale.outstanding}
                              onChange={(e) =>
                                updatePaidAmount(sale.id, Number(e.target.value))
                              }
                              className="w-28 border border-gray-200 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                            />
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Footer summary & submit */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {/* Error / success */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
            {successMsg}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">ยอดรวมที่จะรับชำระ</p>
            <p className="font-kanit text-2xl font-bold text-[#1e3a5f]">
              {totalToPay.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              <span className="text-sm font-normal text-gray-500 ml-1">บาท</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || selectedItems.length === 0}
            className="px-6 py-2.5 bg-[#1e3a5f] hover:bg-[#162d4a] disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึกใบเสร็จ"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiptForm;
