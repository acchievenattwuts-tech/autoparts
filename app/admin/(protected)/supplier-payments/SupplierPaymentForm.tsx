"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import AdminNumberInput from "@/components/shared/AdminNumberInput";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import {
  createSupplierPayment,
  getOutstandingSupplierDocuments,
  updateSupplierPayment,
  type SupplierSettlementDocument,
  type SupplierSettlementDocumentBundle,
} from "./actions";

type SupplierOption = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
};

type CashBankAccountOption = {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
};

type SelectedItem = {
  kind: "PURCHASE" | "SUPPLIER_CREDIT" | "ADVANCE";
  refId: string;
  docNo: string;
  outstanding: number;
  paidAmount: number;
};

type InitialData = {
  id: string;
  supplierId: string;
  paymentDate: string;
  cashBankAccountId: string;
  note: string;
  items: SelectedItem[];
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

const labelCls = "mb-1.5 block text-sm font-medium text-gray-700";

const SupplierPaymentForm = ({
  suppliers,
  cashBankAccounts,
  initialData,
  initialDocuments,
}: {
  suppliers: SupplierOption[];
  cashBankAccounts: CashBankAccountOption[];
  initialData?: InitialData;
  initialDocuments?: SupplierSettlementDocumentBundle;
}) => {
  const router = useRouter();
  const isEdit = !!initialData;
  const [isPending, startTransition] = useTransition();
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [supplierId, setSupplierId] = useState(initialData?.supplierId ?? "");
  const [paymentDate, setPaymentDate] = useState(
    initialData?.paymentDate ?? new Date().toISOString().slice(0, 10),
  );
  const [cashBankAccountId, setCashBankAccountId] = useState(initialData?.cashBankAccountId ?? "");
  const [note, setNote] = useState(initialData?.note ?? "");
  const [documents, setDocuments] = useState<SupplierSettlementDocumentBundle>(
    initialDocuments ?? { purchases: [], credits: [], advances: [] },
  );
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>(initialData?.items ?? []);

  const handleSupplierChange = (nextSupplierId: string) => {
    setSupplierId(nextSupplierId);
    setDocuments({ purchases: [], credits: [], advances: [] });
    setSelectedItems([]);
    if (!nextSupplierId) return;

    setIsLoadingDocs(true);
    getOutstandingSupplierDocuments(nextSupplierId, initialData?.id)
      .then((nextDocuments) => {
        setDocuments(nextDocuments);
        setSelectedItems((prev) =>
          prev.filter((item) => {
            const sourceList =
              item.kind === "PURCHASE"
                ? nextDocuments.purchases
                : item.kind === "SUPPLIER_CREDIT"
                  ? nextDocuments.credits
                  : nextDocuments.advances;
            return sourceList.some((doc) => doc.id === item.refId);
          }),
        );
      })
      .catch(() => {
        setDocuments({ purchases: [], credits: [], advances: [] });
        setSelectedItems([]);
      })
      .finally(() => setIsLoadingDocs(false));
  };

  const supplierOptions: SelectOption[] = suppliers.map((supplier) => ({
    id: supplier.id,
    label: supplier.name,
    sublabel: [supplier.code, supplier.phone].filter(Boolean).join(" | ") || undefined,
  }));

  const accountOptions: SelectOption[] = cashBankAccounts.map((account) => ({
    id: account.id,
    label: account.name,
    sublabel:
      [account.code, account.type === "BANK" ? account.bankName : "เงินสด", account.accountNo]
        .filter(Boolean)
        .join(" | ") || undefined,
  }));

  const isSelected = (kind: SelectedItem["kind"], refId: string) =>
    selectedItems.some((item) => item.kind === kind && item.refId === refId);

  const getSelectedItem = (kind: SelectedItem["kind"], refId: string) =>
    selectedItems.find((item) => item.kind === kind && item.refId === refId);

  const toggleItem = (kind: SelectedItem["kind"], doc: SupplierSettlementDocument) => {
    if (isSelected(kind, doc.id)) {
      setSelectedItems((prev) => prev.filter((item) => !(item.kind === kind && item.refId === doc.id)));
      return;
    }

    setSelectedItems((prev) => [
      ...prev,
      {
        kind,
        refId: doc.id,
        docNo: doc.docNo,
        outstanding: doc.outstanding,
        paidAmount: doc.outstanding,
      },
    ]);
  };

  const updatePaidAmount = (kind: SelectedItem["kind"], refId: string, value: number) => {
    setSelectedItems((prev) =>
      prev.map((item) =>
        item.kind === kind && item.refId === refId
          ? { ...item, paidAmount: Math.max(0, Math.min(value, item.outstanding)) }
          : item,
      ),
    );
  };

  const purchaseTotal = selectedItems
    .filter((item) => item.kind === "PURCHASE")
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const creditTotal = selectedItems
    .filter((item) => item.kind === "SUPPLIER_CREDIT")
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const advanceTotal = selectedItems
    .filter((item) => item.kind === "ADVANCE")
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const netCashPaid = purchaseTotal - creditTotal - advanceTotal;

  const handleSubmit = () => {
    setError("");
    setSuccess("");

    if (!supplierId) {
      setError("กรุณาเลือกซัพพลายเออร์");
      return;
    }
    if (!paymentDate) {
      setError("กรุณาระบุวันที่เอกสาร");
      return;
    }
    if (selectedItems.length === 0) {
      setError("กรุณาเลือกรายการอย่างน้อย 1 รายการ");
      return;
    }
    if (!selectedItems.some((item) => item.kind === "PURCHASE")) {
      setError("กรุณาเลือกใบซื้อเชื่ออย่างน้อย 1 รายการ");
      return;
    }
    if (selectedItems.some((item) => item.paidAmount <= 0)) {
      setError("ยอดของแต่ละรายการต้องมากกว่า 0");
      return;
    }
    if (netCashPaid < 0) {
      setError("ยอดเครดิตและเงินมัดจำที่เลือกมากกว่ายอดซื้อเชื่อที่ต้องการชำระ");
      return;
    }
    if (netCashPaid > 0 && !cashBankAccountId) {
      setError("กรุณาเลือกบัญชีจ่ายเงิน");
      return;
    }

    const formData = new FormData();
    formData.set("supplierId", supplierId);
    formData.set("paymentDate", paymentDate);
    formData.set("cashBankAccountId", netCashPaid > 0 ? cashBankAccountId : "");
    formData.set("note", note);
    formData.set(
      "items",
      JSON.stringify(
        selectedItems.map((item) => ({
          purchaseId: item.kind === "PURCHASE" ? item.refId : undefined,
          purchaseReturnId: item.kind === "SUPPLIER_CREDIT" ? item.refId : undefined,
          advanceId: item.kind === "ADVANCE" ? item.refId : undefined,
          paidAmount: item.paidAmount,
        })),
      ),
    );

    startTransition(async () => {
      if (isEdit && initialData) {
        const result = await updateSupplierPayment(initialData.id, formData);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.push("/admin/supplier-payments");
        return;
      }

      const result = await createSupplierPayment(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess(`บันทึกสำเร็จ เลขที่เอกสาร: ${result.paymentNo}`);
      setTimeout(() => router.push("/admin/supplier-payments"), 1500);
    });
  };

  const renderTable = ({
    kind,
    title,
    description,
    documents: rows,
    headClassName,
    docLabel,
    amountColor,
  }: {
    kind: SelectedItem["kind"];
    title: string;
    description: string;
    documents: SupplierSettlementDocument[];
    headClassName: string;
    docLabel: string;
    amountColor: string;
  }) => (
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <h2 className="mb-1 font-kanit text-lg font-semibold text-gray-800">{title}</h2>
      <p className="mb-4 text-xs text-gray-500">{description}</p>

      {isLoadingDocs ? (
        <p className="py-6 text-center text-sm text-gray-400">กำลังโหลดข้อมูล...</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">ไม่พบรายการที่ใช้งานได้</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className={headClassName}>
              <tr>
                <th className="w-10 px-3 py-3" />
                <th className="px-3 py-3 text-left font-medium text-gray-600">{docLabel}</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">วันที่</th>
                <th className="px-3 py-3 text-right font-medium text-gray-600">ยอดทั้งหมด</th>
                <th className="px-3 py-3 text-right font-medium text-gray-600">ใช้แล้ว</th>
                <th className="px-3 py-3 text-right font-medium text-gray-600">คงเหลือ</th>
                <th className="px-3 py-3 text-right font-medium text-gray-600">ใช้ในงวดนี้</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => {
                const checked = isSelected(kind, doc.id);
                const selected = getSelectedItem(kind, doc.id);
                return (
                  <tr
                    key={`${kind}-${doc.id}`}
                    className={`border-t border-gray-50 transition-colors ${
                      checked ? "bg-blue-50/40" : "hover:bg-gray-50"
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(kind, doc)}
                        className="h-4 w-4 accent-[#1e3a5f]"
                      />
                    </td>
                    <td className={`px-3 py-2 font-mono font-medium ${amountColor}`}>{doc.docNo}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {new Date(doc.docDate).toLocaleDateString("th-TH-u-ca-gregory", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-800">
                      {doc.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {doc.usedAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${amountColor}`}>
                      {doc.outstanding.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {checked ? (
                        <AdminNumberInput
                          min={0}
                          max={doc.outstanding}
                          step={0.01}
                          value={selected?.paidAmount ?? doc.outstanding}
                          onValueChange={(value) => updatePaidAmount(kind, doc.id, value)}
                          className="w-28 rounded border border-gray-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                        />
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
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
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="mb-5 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f]">
          ข้อมูลจ่ายชำระซัพพลายเออร์
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelCls}>
              วันที่เอกสาร <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>
              ซัพพลายเออร์ <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={supplierOptions}
              value={supplierId}
              onChange={handleSupplierChange}
              placeholder="โปรดระบุซัพพลายเออร์"
            />
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 md:col-span-2">
            เลือกใบซื้อเชื่อที่ต้องการชำระ และสามารถเลือกใช้เครดิตจาก CN ซื้อหรือเงินมัดจำซัพพลายเออร์เพื่อนำมาหักได้
            หากยอดสุทธิหลังหักเครดิตและมัดจำเท่ากับ 0 ระบบจะบันทึกเป็นการตัดยอดโดยไม่มีการจ่ายเงินจริง
          </div>

          <div>
            <label className={labelCls}>
              บัญชีจ่ายเงิน {netCashPaid > 0 ? <span className="text-red-500">*</span> : null}
            </label>
            <SearchableSelect
              options={accountOptions}
              value={cashBankAccountId}
              onChange={setCashBankAccountId}
              placeholder="โปรดระบุบัญชีจ่ายเงิน"
            />
          </div>

          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              className={`${inputCls} resize-none`}
              placeholder="ระบุรายละเอียดเพิ่มเติม (ถ้ามี)"
            />
          </div>
        </div>
      </div>

      {supplierId
        ? renderTable({
            kind: "PURCHASE",
            title: "ใบซื้อเชื่อคงค้าง",
            description: "เลือกรายการซื้อเชื่อที่ต้องการนำมาชำระในงวดนี้",
            documents: documents.purchases,
            headClassName: "bg-gray-50",
            docLabel: "เลขที่ใบซื้อ",
            amountColor: "text-[#1e3a5f]",
          })
        : null}

      {supplierId
        ? renderTable({
            kind: "SUPPLIER_CREDIT",
            title: "เครดิตจาก CN ซื้อคงเหลือ",
            description: "เลือกเครดิตซัพพลายเออร์ที่ต้องการนำมาหักกับยอดซื้อเชื่อ",
            documents: documents.credits,
            headClassName: "bg-emerald-50",
            docLabel: "เลขที่ CN ซื้อ",
            amountColor: "text-emerald-700",
          })
        : null}

      {supplierId
        ? renderTable({
            kind: "ADVANCE",
            title: "เงินมัดจำซัพพลายเออร์คงเหลือ",
            description: "เลือกเงินมัดจำที่ต้องการนำมาหักกับยอดซื้อเชื่อ",
            documents: documents.advances,
            headClassName: "bg-amber-50",
            docLabel: "เลขที่มัดจำ",
            amountColor: "text-amber-700",
          })
        : null}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <CheckCircle size={16} className="text-green-600" />
            <p className="text-sm text-green-600">{success}</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-8 text-sm text-gray-600">
              <span>ยอดซื้อเชื่อที่เลือก</span>
              <span className="font-medium text-gray-900">
                {purchaseTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center gap-8 text-sm text-emerald-700">
              <span>หักเครดิต CN ซื้อ</span>
              <span className="font-medium">
                -{creditTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center gap-8 text-sm text-amber-700">
              <span>หักเงินมัดจำซัพพลายเออร์</span>
              <span className="font-medium">
                -{advanceTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="my-1 h-px bg-gray-200" />
            <p className="text-sm text-gray-500">ยอดสุทธิที่ต้องจ่ายเงินจริง</p>
            <p className={`font-kanit text-2xl font-bold ${netCashPaid < 0 ? "text-red-600" : "text-[#1e3a5f]"}`}>
              {netCashPaid.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              <span className="ml-1 text-sm font-normal text-gray-500">บาท</span>
            </p>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || selectedItems.length === 0}
            className="inline-flex items-center justify-center rounded-lg bg-[#f97316] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "บันทึกจ่ายชำระ"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SupplierPaymentForm;
