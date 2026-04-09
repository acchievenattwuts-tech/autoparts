"use client";

import { useState, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import { getCreditSalesForCustomer, createReceipt, updateReceipt, CreditSaleItem } from "../actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

interface CustomerOption {
  id: string;
  name: string;
  code: string | null;
  amountRemain: number;
}

interface SelectedItem {
  saleId?: string;
  cnId?: string;
  saleNo: string;
  outstanding: number;
  paidAmount: number;
  isCN: boolean;
}

interface CashBankAccountOption {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
}

interface InitialData {
  id: string;
  customerId: string;
  customerName: string;
  receiptDate: string;
  paymentMethod: "CASH" | "TRANSFER";
  cashBankAccountId: string;
  note: string;
  items: SelectedItem[];
}

interface Props {
  customers: CustomerOption[];
  cashBankAccounts: CashBankAccountOption[];
  initialData?: InitialData;
  initialCreditSales?: CreditSaleItem[];
}

const ReceiptForm = ({ customers, cashBankAccounts, initialData, initialCreditSales }: Props) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const today = new Date().toISOString().slice(0, 10);

  const [customerId, setCustomerId] = useState(initialData?.customerId ?? "");
  const [receiptDate, setReceiptDate] = useState(initialData?.receiptDate ?? today);
  const [creditSales, setCreditSales] = useState<CreditSaleItem[]>(initialCreditSales ?? []);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>(initialData?.items ?? []);
  const [cashBankAccountId, setCashBankAccountId] = useState(initialData?.cashBankAccountId ?? "");
  const [note, setNote] = useState(initialData?.note ?? "");
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));

  const skipFirstLoad = useRef(isEdit);

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
        setSelectedItems(
          sales
            .filter((sale) => sale.type === "SALE")
            .map((sale) => ({
              saleId: sale.id,
              saleNo: sale.saleNo,
              outstanding: sale.outstanding,
              paidAmount: sale.outstanding,
              isCN: false,
            })),
        );
      })
      .catch(() => {
        setCreditSales([]);
        setSelectedItems([]);
      })
      .finally(() => setIsLoadingSales(false));
  }, [customerId, isEdit]);

  const isChecked = (itemId: string) => selectedItems.some((item) => (item.saleId ?? item.cnId) === itemId);

  const toggleItem = (sale: CreditSaleItem) => {
    const key = sale.id;
    if (isChecked(key)) {
      setSelectedItems((prev) => prev.filter((item) => (item.saleId ?? item.cnId) !== key));
      return;
    }
    setSelectedItems((prev) => [
      ...prev,
      {
        saleId: sale.type === "SALE" ? sale.id : undefined,
        cnId: sale.type === "CN" ? sale.id : undefined,
        saleNo: sale.saleNo,
        outstanding: sale.outstanding,
        paidAmount: sale.outstanding,
        isCN: sale.type === "CN",
      },
    ]);
  };

  const updatePaidAmount = (itemId: string, value: number) => {
    setSelectedItems((prev) =>
      prev.map((item) =>
        (item.saleId ?? item.cnId) === itemId
          ? { ...item, paidAmount: Math.max(0, Math.min(value, item.outstanding)) }
          : item,
      ),
    );
  };

  const saleItems = creditSales.filter((sale) => sale.type === "SALE");
  const cnItems = creditSales.filter((sale) => sale.type === "CN");

  const saleTotal = selectedItems.filter((item) => !item.isCN).reduce((sum, item) => sum + item.paidAmount, 0);
  const cnTotal = selectedItems.filter((item) => item.isCN).reduce((sum, item) => sum + item.paidAmount, 0);
  const netTotal = saleTotal - cnTotal;

  const selectedCustomer = customerMap.get(customerId);

  const handleSubmit = () => {
    setError("");
    setSuccessMsg("");

    if (!customerId) {
      setError("กรุณาเลือกลูกค้า");
      return;
    }
    if (selectedItems.length === 0) {
      setError("กรุณาเลือกรายการที่ต้องการรับชำระหรือใช้เครดิต");
      return;
    }
    if (selectedItems.some((item) => item.paidAmount <= 0)) {
      setError("ยอดของแต่ละรายการต้องมากกว่า 0");
      return;
    }
    if (netTotal > 0 && !cashBankAccountId) {
      setError("กรุณาเลือกบัญชีรับเงิน");
      return;
    }

    const formData = new FormData();
    formData.set("customerId", customerId);
    formData.set("customerName", selectedCustomer?.name ?? "");
    formData.set("receiptDate", receiptDate);
    formData.set("cashBankAccountId", cashBankAccountId);
    formData.set("note", note);
    formData.set(
      "items",
      JSON.stringify(
        selectedItems.map((item) => ({
          saleId: item.saleId,
          cnId: item.cnId,
          paidAmount: item.paidAmount,
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
    const item = selectedItems.find((selected) => (selected.saleId ?? selected.cnId) === sale.id);
    return (
      <tr key={sale.id} className={`border-t border-gray-50 transition-colors ${checked ? "bg-blue-50/40" : "hover:bg-gray-50"}`}>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleItem(sale)}
            className="h-4 w-4 accent-[#1e3a5f]"
          />
        </td>
        <td className="px-3 py-2 font-mono font-medium text-[#1e3a5f]">{sale.saleNo}</td>
        <td className="px-3 py-2 text-gray-600">
          {new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", dateLocale)}
        </td>
        <td className="px-3 py-2 text-right text-gray-800">
          {sale.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right text-gray-600">
          {sale.paidAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right font-medium text-orange-600">
          {sale.outstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right">
          {checked ? (
            <AdminNumberInput
              min={0}
              max={sale.outstanding}
              step={0.01}
              value={item?.paidAmount ?? sale.outstanding}
              onValueChange={(value) => updatePaidAmount(sale.id, value)}
              className="w-28 rounded border border-gray-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          ) : (
            <span className="text-sm text-gray-400">-</span>
          )}
        </td>
      </tr>
    );
  };

  const renderCNRow = (sale: CreditSaleItem) => {
    const checked = isChecked(sale.id);
    const item = selectedItems.find((selected) => (selected.saleId ?? selected.cnId) === sale.id);
    return (
      <tr key={sale.id} className={`border-t border-gray-50 transition-colors ${checked ? "bg-emerald-50/40" : "hover:bg-gray-50"}`}>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleItem(sale)}
            className="h-4 w-4 accent-emerald-600"
          />
        </td>
        <td className="px-3 py-2 font-mono font-medium text-emerald-700">{sale.saleNo}</td>
        <td className="px-3 py-2 text-gray-600">
          {new Date(sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", dateLocale)}
        </td>
        <td className="px-3 py-2 text-right text-gray-800">
          {sale.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right text-gray-600">
          {sale.paidAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right font-medium text-emerald-600">
          {sale.outstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right">
          {checked ? (
            <AdminNumberInput
              min={0}
              max={sale.outstanding}
              step={0.01}
              value={item?.paidAmount ?? sale.outstanding}
              onValueChange={(value) => updatePaidAmount(sale.id, value)}
              className="w-28 rounded border border-emerald-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            />
          ) : (
            <span className="text-sm text-gray-400">-</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">ข้อมูลทั่วไป</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              ลูกค้า <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={customers.map((customer): SelectOption => ({
                id: customer.id,
                label: customer.name,
                sublabel: `ค้างชำระสุทธิ ${customer.amountRemain.toLocaleString("th-TH", {
                  minimumFractionDigits: 2,
                })}${customer.code ? ` | ${customer.code}` : ""}`,
              }))}
              value={customerId}
              onChange={setCustomerId}
              placeholder="โปรดระบุลูกค้า"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              วันที่รับชำระ <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={receiptDate}
              onChange={(event) => setReceiptDate(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 md:col-span-2">
            ระบบจะระบุช่องทางรับเงินจากประเภทบัญชีให้อัตโนมัติ และถ้ายอดสุทธิไม่เกิน 0 จะถือว่าเป็นการตัดเครดิตโดยไม่มีการรับเงินจริง
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              บัญชีรับเงิน {netTotal > 0 && <span className="text-red-500">*</span>}
            </label>
            <SearchableSelect
              options={cashBankAccounts.map((account): SelectOption => ({
                id: account.id,
                label: account.name,
                sublabel: [account.code, account.type === "BANK" ? account.bankName : "เงินสด", account.accountNo]
                  .filter(Boolean)
                  .join(" | ") || undefined,
              }))}
              value={cashBankAccountId}
              onChange={setCashBankAccountId}
              placeholder="โปรดระบุบัญชีรับเงิน"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
            />
          </div>
        </div>
      </div>

      {customerId && (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800">รายการขายเชื่อค้างชำระ</h2>

          {isLoadingSales ? (
            <p className="py-6 text-center text-sm text-gray-400">กำลังโหลด...</p>
          ) : saleItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">ลูกค้ารายนี้ไม่มียอดค้างชำระ</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-10 px-3 py-3" />
                    <th className="px-3 py-3 text-left font-medium text-gray-600">เลขที่ใบขาย</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600">วันที่</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600">ยอดทั้งหมด</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600">ชำระแล้ว</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600">ค้างชำระ</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600">รับชำระงวดนี้</th>
                  </tr>
                </thead>
                <tbody>{saleItems.map(renderSaleRow)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {customerId && !isLoadingSales && cnItems.length > 0 && (
        <div className="rounded-xl border border-emerald-100 bg-white p-6 shadow-sm">
          <h2 className="mb-1 font-kanit text-lg font-semibold text-emerald-800">เครดิตจากใบลดหนี้ที่ยังไม่ใช้</h2>
          <p className="mb-4 text-xs text-gray-500">เลือกรายการเครดิตที่ต้องการนำมาหักลบกับยอดค้างชำระ</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-emerald-50">
                <tr>
                  <th className="w-10 px-3 py-3" />
                  <th className="px-3 py-3 text-left font-medium text-emerald-700">เลขที่ใบลดหนี้</th>
                  <th className="px-3 py-3 text-left font-medium text-emerald-700">วันที่</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700">เครดิตทั้งหมด</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700">ใช้แล้ว</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700">คงเหลือ</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700">นำมาหักงวดนี้</th>
                </tr>
              </thead>
              <tbody>{cnItems.map(renderCNRow)}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
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
                    {saleTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center gap-8 text-sm text-emerald-700">
                  <span>หักเครดิต CN</span>
                  <span className="font-medium">
                    -{cnTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="my-1 h-px bg-gray-200" />
              </>
            )}
            <p className="text-sm text-gray-500">ยอดสุทธิที่รับชำระ</p>
            <p className="font-kanit text-2xl font-bold text-[#1e3a5f]">
              {netTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              <span className="ml-1 text-sm font-normal text-gray-500">บาท</span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || selectedItems.length === 0}
            className="rounded-lg bg-[#1e3a5f] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#162d4a] disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกใบเสร็จ"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReceiptForm;
