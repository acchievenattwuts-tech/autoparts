"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getCreditSalesForCustomer, createReceipt, updateReceipt, CreditSaleItem } from "../actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

interface CustomerOption {
  id:           string;
  name:         string;
  code:         string | null;
  amountRemain: number;
}

interface SelectedItem {
  saleId?:     string;
  cnId?:       string;
  saleNo:      string;
  outstanding: number;
  paidAmount:  number;
  isCN:        boolean;
}

interface InitialData {
  id:            string;
  customerId:    string;
  customerName:  string;
  receiptDate:   string;
  paymentMethod: "CASH" | "TRANSFER";
  note:          string;
  items:         SelectedItem[];
}

interface Props {
  customers:           CustomerOption[];
  initialData?:        InitialData;
  initialCreditSales?: CreditSaleItem[];
}

const ReceiptForm = ({ customers, initialData, initialCreditSales }: Props) => {
  const router  = useRouter();
  const isEdit  = !!initialData;
  const today   = new Date().toISOString().slice(0, 10);

  const [customerId,      setCustomerId]      = useState(initialData?.customerId ?? "");
  const [receiptDate,     setReceiptDate]      = useState(initialData?.receiptDate ?? today);
  const [creditSales,     setCreditSales]      = useState<CreditSaleItem[]>(initialCreditSales ?? []);
  const [selectedItems,   setSelectedItems]    = useState<SelectedItem[]>(initialData?.items ?? []);
  const [paymentMethod,   setPaymentMethod]    = useState<"CASH" | "TRANSFER">(initialData?.paymentMethod ?? "CASH");
  const [note,            setNote]             = useState(initialData?.note ?? "");
  const [isLoadingSales,  setIsLoadingSales]   = useState(false);
  const [isPending,       startTransition]     = useTransition();
  const [error,           setError]            = useState("");
  const [successMsg,      setSuccessMsg]       = useState("");
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));

  // Skip the first effect run if initialData is provided (sales already pre-loaded)
  const skipFirstLoad = useRef(isEdit);

  // Load credit sales when customer changes
  useEffect(() => {
    if (skipFirstLoad.current) {
      skipFirstLoad.current = false;
      return;
    }
    if (!customerId) {
      setCreditSales([]);
      setSelectedItems([]);
      return;
    }
    setIsLoadingSales(true);
    getCreditSalesForCustomer(customerId)
      .then((sales) => {
        setCreditSales(sales);
        // Default: select all with full outstanding (Sale items only)
        setSelectedItems(
          sales
            .filter((s) => s.type === "SALE")
            .map((s) => ({
              saleId:      s.id,
              saleNo:      s.saleNo,
              outstanding: s.outstanding,
              paidAmount:  s.outstanding,
              isCN:        false,
            })),
        );
      })
      .catch(() => {
        setCreditSales([]);
        setSelectedItems([]);
      })
      .finally(() => setIsLoadingSales(false));
  }, [customerId]);

  const isChecked = (itemId: string) =>
    selectedItems.some((i) => (i.saleId ?? i.cnId) === itemId);

  const toggleItem = (sale: CreditSaleItem) => {
    const key = sale.id;
    if (isChecked(key)) {
      setSelectedItems((prev) =>
        prev.filter((i) => (i.saleId ?? i.cnId) !== key),
      );
    } else {
      setSelectedItems((prev) => [
        ...prev,
        {
          saleId:      sale.type === "SALE" ? sale.id : undefined,
          cnId:        sale.type === "CN"   ? sale.id : undefined,
          saleNo:      sale.saleNo,
          outstanding: sale.outstanding,
          paidAmount:  sale.outstanding,
          isCN:        sale.type === "CN",
        },
      ]);
    }
  };

  const updatePaidAmount = (itemId: string, value: number) => {
    setSelectedItems((prev) =>
      prev.map((i) =>
        (i.saleId ?? i.cnId) === itemId
          ? { ...i, paidAmount: Math.max(0, Math.min(value, i.outstanding)) }
          : i,
      ),
    );
  };

  const saleItems = creditSales.filter((s) => s.type === "SALE");
  const cnItems   = creditSales.filter((s) => s.type === "CN");

  const saleTotal = selectedItems.filter((i) => !i.isCN).reduce((sum, i) => sum + i.paidAmount, 0);
  const cnTotal   = selectedItems.filter((i) => i.isCN).reduce((sum, i) => sum + i.paidAmount, 0);
  const netTotal  = saleTotal - cnTotal;

  const selectedCustomer = customerMap.get(customerId);

  const handleSubmit = () => {
    setError("");
    setSuccessMsg("");

    if (!customerId) {
      setError("กรุณาเลือกลูกค้า");
      return;
    }
    if (selectedItems.length === 0) {
      setError("กรุณาเลือกรายการที่ต้องการชำระหรือนำเครดิตมาหัก");
      return;
    }
    if (selectedItems.some((i) => i.paidAmount <= 0)) {
      setError("ยอดแต่ละรายการต้องมากกว่า 0");
      return;
    }

    const formData = new FormData();
    formData.set("customerId",    customerId);
    formData.set("customerName",  selectedCustomer?.name ?? "");
    formData.set("receiptDate",   receiptDate);
    formData.set("paymentMethod", paymentMethod);
    formData.set("note",          note);
    formData.set(
      "items",
      JSON.stringify(
        selectedItems.map((i) => ({
          saleId:     i.saleId,
          cnId:       i.cnId,
          paidAmount: i.paidAmount,
        })),
      ),
    );

    startTransition(async () => {
      if (isEdit && initialData) {
        const result = await updateReceipt(initialData.id, formData);
        if (result.success) {
          router.push("/admin/receipts");
        } else {
          setError(result.error ?? "เกิดข้อผิดพลาด");
        }
      } else {
        const result = await createReceipt(formData);
        if (result.success) {
          setSuccessMsg(`บันทึกใบเสร็จ ${result.receiptNo} สำเร็จ`);
          setTimeout(() => router.push("/admin/receipts"), 1500);
        } else {
          setError(result.error ?? "เกิดข้อผิดพลาด");
        }
      }
    });
  };

  const dateLocale = { day: "2-digit" as const, month: "2-digit" as const, year: "numeric" as const };

  const renderSaleRow = (sale: CreditSaleItem) => {
    const checked = isChecked(sale.id);
    const item    = selectedItems.find((i) => (i.saleId ?? i.cnId) === sale.id);
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
        <td className="py-2 px-3 font-mono text-[#1e3a5f] font-medium">{sale.saleNo}</td>
        <td className="py-2 px-3 text-gray-600">
          {new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", dateLocale)}
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
              onChange={(e) => updatePaidAmount(sale.id, Number(e.target.value))}
              className="w-28 border border-gray-200 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          ) : (
            <span className="text-gray-400 text-sm">-</span>
          )}
        </td>
      </tr>
    );
  };

  const renderCNRow = (sale: CreditSaleItem) => {
    const checked = isChecked(sale.id);
    const item    = selectedItems.find((i) => (i.saleId ?? i.cnId) === sale.id);
    return (
      <tr
        key={sale.id}
        className={`border-t border-gray-50 transition-colors ${
          checked ? "bg-emerald-50/40" : "hover:bg-gray-50"
        }`}
      >
        <td className="py-2 px-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleItem(sale)}
            className="w-4 h-4 accent-emerald-600"
          />
        </td>
        <td className="py-2 px-3 font-mono text-emerald-700 font-medium">{sale.saleNo}</td>
        <td className="py-2 px-3 text-gray-600">
          {new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", dateLocale)}
        </td>
        <td className="py-2 px-3 text-right text-gray-800">
          {sale.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="py-2 px-3 text-right text-gray-600">
          {sale.paidAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="py-2 px-3 text-right font-medium text-emerald-600">
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
              onChange={(e) => updatePaidAmount(sale.id, Number(e.target.value))}
              className="w-28 border border-emerald-200 rounded px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          ) : (
            <span className="text-gray-400 text-sm">-</span>
          )}
        </td>
      </tr>
    );
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
            <SearchableSelect
              options={customers.map((c): SelectOption => ({
                id:       c.id,
                label:    c.name,
                sublabel: `ค้างชำระสุทธิ ฿${c.amountRemain.toLocaleString("th-TH", { minimumFractionDigits: 2 })}${c.code ? ` · ${c.code}` : ""}`,
              }))}
              value={customerId}
              onChange={setCustomerId}
              placeholder="โปรดระบุลูกค้า"
            />
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

      {/* Credit sales — Sale items */}
      {customerId && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-kanit text-lg font-semibold text-gray-800 mb-4">
            รายการขายเชื่อค้างชำระ
          </h2>

          {isLoadingSales ? (
            <p className="text-sm text-gray-400 text-center py-6">กำลังโหลด...</p>
          ) : saleItems.length === 0 ? (
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
                <tbody>{saleItems.map(renderSaleRow)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CN credits section */}
      {customerId && !isLoadingSales && cnItems.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-emerald-100 p-6">
          <h2 className="font-kanit text-lg font-semibold text-emerald-800 mb-1">
            เครดิตใบลดหนี้ที่ยังไม่ได้ใช้
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            เลือกรายการเครดิตที่ต้องการนำมาหักลบกับยอดค้างชำระ
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-emerald-50">
                <tr>
                  <th className="w-10 py-3 px-3" />
                  <th className="text-left py-3 px-3 font-medium text-emerald-700">เลขที่ใบลดหนี้</th>
                  <th className="text-left py-3 px-3 font-medium text-emerald-700">วันที่</th>
                  <th className="text-right py-3 px-3 font-medium text-emerald-700">เครดิตทั้งหมด</th>
                  <th className="text-right py-3 px-3 font-medium text-emerald-700">ใช้แล้ว</th>
                  <th className="text-right py-3 px-3 font-medium text-emerald-700">คงเหลือ</th>
                  <th className="text-right py-3 px-3 font-medium text-emerald-700">นำมาหักงวดนี้</th>
                </tr>
              </thead>
              <tbody>{cnItems.map(renderCNRow)}</tbody>
            </table>
          </div>
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

        <div className="flex items-end justify-between">
          <div className="space-y-1">
            {cnTotal > 0 && (
              <>
                <div className="flex items-center gap-8 text-sm text-gray-600">
                  <span>ยอดค้างชำระที่เลือก</span>
                  <span className="font-medium text-gray-900">
                    ฿{saleTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center gap-8 text-sm text-emerald-700">
                  <span>หักเครดิต CN</span>
                  <span className="font-medium">
                    −฿{cnTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="h-px bg-gray-200 my-1" />
              </>
            )}
            <p className="text-sm text-gray-500">ยอดสุทธิที่รับชำระ</p>
            <p className="font-kanit text-2xl font-bold text-[#1e3a5f]">
              {netTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              <span className="text-sm font-normal text-gray-500 ml-1">บาท</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || selectedItems.length === 0}
            className="px-6 py-2.5 bg-[#1e3a5f] hover:bg-[#162d4a] disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกใบเสร็จ"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiptForm;
