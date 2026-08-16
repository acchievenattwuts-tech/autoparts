"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import PrintCopyModeLink from "@/app/admin/_components/print/PrintCopyModeLink";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import { getCreditSalesForCustomer, createReceipt, updateReceipt, CreditSaleItem } from "../actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";

interface PaymentRow {
  cashBankAccountId: string;
  amount: number;
}

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
  payments?: PaymentRow[];
  note: string;
  items: SelectedItem[];
}

interface Props {
  customers: CustomerOption[];
  cashBankAccounts: CashBankAccountOption[];
  initialData?: InitialData;
  initialCreditSales?: CreditSaleItem[];
  canPrint?: boolean;
}

const ReceiptForm = ({ customers, cashBankAccounts, initialData, initialCreditSales, canPrint = false }: Props) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const today = getThailandDateKey();
  const [savedReceiptId, setSavedReceiptId] = useState("");
  const printReceiptId = isEdit ? (initialData?.id ?? "") : savedReceiptId;

  const [customerId, setCustomerId] = useState(initialData?.customerId ?? "");
  const [receiptDate, setReceiptDate] = useState(initialData?.receiptDate ?? today);
  const [creditSales, setCreditSales] = useState<CreditSaleItem[]>(initialCreditSales ?? []);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>(initialData?.items ?? []);
  const [payments, setPayments] = useState<PaymentRow[]>(
    initialData?.payments && initialData.payments.length > 0
      ? initialData.payments
      : initialData?.cashBankAccountId
        ? [{ cashBankAccountId: initialData.cashBankAccountId, amount: 0 }]
        : [{ cashBankAccountId: "", amount: 0 }],
  );
  const [note, setNote] = useState(initialData?.note ?? "");
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));

  const handleCustomerChange = (nextCustomerId: string) => {
    setCustomerId(nextCustomerId);
    setCreditSales([]);
    setSelectedItems([]);
    if (!nextCustomerId) return;

    setIsLoadingSales(true);
    getCreditSalesForCustomer(nextCustomerId)
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
  };

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

  const round2 = (value: number) => Math.round(value * 100) / 100;
  const paymentsTotal = round2(payments.reduce((sum, row) => sum + (row.amount || 0), 0));
  const remainingToAllocate = round2(netTotal - paymentsTotal);

  const updatePaymentAccount = (index: number, accountId: string) => {
    setPayments((prev) => prev.map((row, i) => (i === index ? { ...row, cashBankAccountId: accountId } : row)));
  };
  const updatePaymentAmount = (index: number, amount: number) => {
    setPayments((prev) => prev.map((row, i) => (i === index ? { ...row, amount: Math.max(0, amount) } : row)));
  };
  const fillRemaining = (index: number) => {
    setPayments((prev) =>
      prev.map((row, i) =>
        i === index ? { ...row, amount: round2(Math.max(0, (row.amount || 0) + remainingToAllocate)) } : row,
      ),
    );
  };
  const addPaymentRow = () => {
    setPayments((prev) => [
      ...prev,
      { cashBankAccountId: "", amount: round2(Math.max(0, remainingToAllocate)) },
    ]);
  };
  const removePaymentRow = (index: number) => {
    setPayments((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

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
    const activePayments = netTotal > 0 ? payments.filter((row) => row.amount > 0) : [];
    if (netTotal > 0) {
      if (activePayments.length === 0) {
        setError("กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง");
        return;
      }
      if (activePayments.some((row) => !row.cashBankAccountId)) {
        setError("กรุณาเลือกบัญชีให้ครบทุกช่องทางที่มียอดเงิน");
        return;
      }
      if (Math.abs(remainingToAllocate) > 0.005) {
        setError(
          `ยอดรวมช่องทางรับเงินต้องเท่ากับยอดสุทธิ (คงเหลือที่ต้องระบุ ${remainingToAllocate.toLocaleString(
            "th-TH",
            { minimumFractionDigits: 2 },
          )} บาท)`,
        );
        return;
      }
    }

    const formData = new FormData();
    formData.set("customerId", customerId);
    formData.set("customerName", selectedCustomer?.name ?? "");
    formData.set("receiptDate", receiptDate);
    formData.set(
      "payments",
      JSON.stringify(
        activePayments.map((row) => ({ cashBankAccountId: row.cashBankAccountId, amount: row.amount })),
      ),
    );
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
          if (result.receiptId) setSavedReceiptId(result.receiptId);
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
      <tr key={sale.id} className={`border-t border-gray-50 transition-colors dark:border-white/5 ${checked ? "bg-blue-50/40 dark:bg-sky-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleItem(sale)}
            className="h-4 w-4 accent-[#1e3a5f]"
          />
        </td>
        <td className="px-3 py-2 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{sale.saleNo}</td>
        <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                          {formatDateThai(sale.saleDate, dateLocale)}
        </td>
        <td className="px-3 py-2 text-right text-gray-800 dark:text-slate-200">
          {sale.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-400">
          {sale.paidAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right font-medium text-orange-600 dark:text-orange-400">
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
              className="w-28 rounded border border-gray-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
            />
          ) : (
            <span className="text-sm text-gray-400 dark:text-slate-500">-</span>
          )}
        </td>
      </tr>
    );
  };

  const renderCNRow = (sale: CreditSaleItem) => {
    const checked = isChecked(sale.id);
    const item = selectedItems.find((selected) => (selected.saleId ?? selected.cnId) === sale.id);
    return (
      <tr key={sale.id} className={`border-t border-gray-50 transition-colors dark:border-white/5 ${checked ? "bg-emerald-50/40 dark:bg-emerald-500/10" : "hover:bg-gray-50 dark:hover:bg-white/5"}`}>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => toggleItem(sale)}
            className="h-4 w-4 accent-emerald-600"
          />
        </td>
        <td className="px-3 py-2 font-mono font-medium text-emerald-700 dark:text-emerald-400">{sale.saleNo}</td>
        <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                          {formatDateThai(sale.saleDate, dateLocale)}
        </td>
        <td className="px-3 py-2 text-right text-gray-800 dark:text-slate-200">
          {sale.netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-400">
          {sale.paidAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
        </td>
        <td className="px-3 py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">
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
              className="w-28 rounded border border-emerald-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-emerald-400/30 dark:bg-slate-900 dark:text-slate-100"
            />
          ) : (
            <span className="text-sm text-gray-400 dark:text-slate-500">-</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800 dark:text-slate-100">ข้อมูลทั่วไป</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">
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
              onChange={handleCustomerChange}
              placeholder="โปรดระบุลูกค้า"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">
              วันที่รับชำระ <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={receiptDate}
              onChange={(event) => setReceiptDate(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 md:col-span-2 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300">
            ระบบจะระบุช่องทางรับเงินจากประเภทบัญชีให้อัตโนมัติ และถ้ายอดสุทธิไม่เกิน 0 จะถือว่าเป็นการตัดเครดิตโดยไม่มีการรับเงินจริง
          </div>

          {netTotal > 0 && (
            <div className="md:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                  ช่องทางรับเงิน <span className="text-red-500">*</span>
                </label>
                <span
                  className={`text-xs font-medium ${
                    Math.abs(remainingToAllocate) > 0.005
                      ? "text-orange-600 dark:text-orange-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }`}
                >
                  คงเหลือที่ต้องระบุ {remainingToAllocate.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท
                </span>
              </div>

              <div className="space-y-2">
                {payments.map((row, index) => (
                  <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="flex-1">
                      <SearchableSelect
                        options={cashBankAccounts.map((account): SelectOption => ({
                          id: account.id,
                          label: account.name,
                          sublabel:
                            [account.code, account.type === "BANK" ? account.bankName : "เงินสด", account.accountNo]
                              .filter(Boolean)
                              .join(" | ") || undefined,
                        }))}
                        value={row.cashBankAccountId}
                        onChange={(value) => updatePaymentAccount(index, value)}
                        placeholder="โปรดระบุบัญชีรับเงิน"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <AdminNumberInput
                        min={0}
                        step={0.01}
                        value={row.amount}
                        onValueChange={(value) => updatePaymentAmount(index, value)}
                        className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => fillRemaining(index)}
                        className="whitespace-nowrap rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
                      >
                        เติมยอดที่เหลือ
                      </button>
                      <button
                        type="button"
                        onClick={() => removePaymentRow(index)}
                        disabled={payments.length <= 1}
                        className="rounded-lg border border-gray-200 p-2 text-gray-400 transition-colors hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:text-slate-400 dark:hover:border-red-400/50 dark:hover:text-red-400"
                        aria-label="ลบช่องทาง"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addPaymentRow}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
              >
                <Plus size={14} /> เพิ่มช่องทางรับเงิน
              </button>
            </div>
          )}

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-slate-300">หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder="หมายเหตุ (ไม่บังคับ)"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500"
            />
          </div>
        </div>
      </div>

      {customerId && (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <h2 className="mb-4 font-kanit text-lg font-semibold text-gray-800 dark:text-slate-100">รายการขายเชื่อค้างชำระ</h2>

          {isLoadingSales ? (
            <p className="py-6 text-center text-sm text-gray-400 dark:text-slate-500">กำลังโหลด...</p>
          ) : saleItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400 dark:text-slate-500">ลูกค้ารายนี้ไม่มียอดค้างชำระ</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/50">
                  <tr>
                    <th className="w-10 px-3 py-3" />
                    <th className="px-3 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เลขที่ใบขาย</th>
                    <th className="px-3 py-3 text-left font-medium text-gray-600 dark:text-slate-300">วันที่</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดทั้งหมด</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ชำระแล้ว</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ค้างชำระ</th>
                    <th className="px-3 py-3 text-right font-medium text-gray-600 dark:text-slate-300">รับชำระงวดนี้</th>
                  </tr>
                </thead>
                <tbody>{saleItems.map(renderSaleRow)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {customerId && !isLoadingSales && cnItems.length > 0 && (
        <div className="rounded-xl border border-emerald-100 bg-white p-6 shadow-sm dark:border-emerald-400/20 dark:bg-[#101b2e]">
          <h2 className="mb-1 font-kanit text-lg font-semibold text-emerald-800 dark:text-emerald-300">เครดิตจากใบลดหนี้ที่ยังไม่ใช้</h2>
          <p className="mb-4 text-xs text-gray-500 dark:text-slate-400">เลือกรายการเครดิตที่ต้องการนำมาหักลบกับยอดค้างชำระ</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-emerald-50 dark:bg-emerald-500/10">
                <tr>
                  <th className="w-10 px-3 py-3" />
                  <th className="px-3 py-3 text-left font-medium text-emerald-700 dark:text-emerald-300">เลขที่ใบลดหนี้</th>
                  <th className="px-3 py-3 text-left font-medium text-emerald-700 dark:text-emerald-300">วันที่</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700 dark:text-emerald-300">เครดิตทั้งหมด</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700 dark:text-emerald-300">ใช้แล้ว</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700 dark:text-emerald-300">คงเหลือ</th>
                  <th className="px-3 py-3 text-right font-medium text-emerald-700 dark:text-emerald-300">นำมาหักงวดนี้</th>
                </tr>
              </thead>
              <tbody>{cnItems.map(renderCNRow)}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-400/30 dark:bg-green-500/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-green-700 dark:text-green-400">{successMsg}</span>
              <div className="flex items-center gap-2">
                {canPrint && printReceiptId && (
                  <PrintCopyModeLink
                    href={`/admin/receipts/${printReceiptId}?print=1`}
                    label="พิมพ์ใบเสร็จ"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600"
                  />
                )}
                <button
                  type="button"
                  onClick={() => router.push("/admin/receipts")}
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
                >
                  ไปหน้ารายการ
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-end justify-between">
          <div className="space-y-1">
            {cnTotal > 0 && (
              <>
                <div className="flex items-center gap-8 text-sm text-gray-600 dark:text-slate-400">
                  <span>ยอดค้างชำระที่เลือก</span>
                  <span className="font-medium text-gray-900 dark:text-slate-200">
                    {saleTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex items-center gap-8 text-sm text-emerald-700 dark:text-emerald-400">
                  <span>หักเครดิต CN</span>
                  <span className="font-medium">
                    -{cnTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="my-1 h-px bg-gray-200 dark:bg-white/10" />
              </>
            )}
            <p className="text-sm text-gray-500 dark:text-slate-400">ยอดสุทธิที่รับชำระ</p>
            <p className="font-kanit text-2xl font-bold text-[#1e3a5f] dark:text-sky-300">
              {netTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              <span className="ml-1 text-sm font-normal text-gray-500 dark:text-slate-400">บาท</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canPrint && isEdit && printReceiptId && (
              <PrintCopyModeLink
                href={`/admin/receipts/${printReceiptId}?print=1`}
                label="พิมพ์"
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#162d4a] dark:bg-sky-700 dark:hover:bg-sky-600"
              />
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || selectedItems.length === 0 || (!isEdit && !!savedReceiptId)}
              className="rounded-lg bg-[#1e3a5f] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#162d4a] disabled:cursor-not-allowed disabled:bg-gray-300 dark:bg-sky-700 dark:hover:bg-sky-600 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
            >
              {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกใบเสร็จ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptForm;
