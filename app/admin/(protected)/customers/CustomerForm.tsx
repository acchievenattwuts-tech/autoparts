"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, CheckCircle2, Link2Off, MapPin } from "lucide-react";
import TaxIdInput from "@/components/shared/TaxIdInput";
import LocationPinPickerSheet from "@/components/shared/LocationPinPickerSheet";
import { formatDateThai } from "@/lib/th-date";
import { CUSTOMER_PHONE_EXAMPLE, formatCustomerPhoneInput } from "@/lib/customer-phone";
import { createCustomer, unlinkCustomerLine, updateCustomer } from "./actions";

interface CustomerFormProps {
  customer?: {
    id: string;
    code: string | null;
    name: string;
    phone: string | null;
    address: string | null;
    shippingAddress: string | null;
    taxId: string | null;
    note: string | null;
    creditTerm: number | null;
    defaultLatitude: number | null;
    defaultLongitude: number | null;
    source?: string | null;
    lineUserId?: string | null;
    lineLinkedAt?: Date | null;
  };
}

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100";
const labelCls = "mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-200";

const CustomerForm = ({ customer }: CustomerFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isUnlinkPending, startUnlinkTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pinLat, setPinLat] = useState<number | null>(customer?.defaultLatitude ?? null);
  const [pinLon, setPinLon] = useState<number | null>(customer?.defaultLongitude ?? null);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);

  const isEdit = Boolean(customer);
  const hasLineLink = Boolean(customer?.lineUserId);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const formData = new FormData(e.currentTarget);
    if (pinLat !== null) formData.set("defaultLatitude", String(pinLat));
    if (pinLon !== null) formData.set("defaultLongitude", String(pinLon));

    startTransition(async () => {
      const result = isEdit
        ? await updateCustomer(customer!.id, formData)
        : await createCustomer(formData);

      if (result.error) {
        setError(result.error);
      } else if (isEdit) {
        setSuccess("บันทึกการเปลี่ยนแปลงเรียบร้อยแล้ว");
      } else {
        router.push("/admin/customers");
      }
    });
  };

  const handleUnlinkLine = () => {
    if (!customer?.id || !hasLineLink) return;
    const confirmed = window.confirm(
      "ยืนยันปลดการเชื่อมต่อ LINE ของลูกค้ารายนี้? ลูกค้าจะต้องยืนยันเบอร์ใหม่อีกครั้งผ่าน LINE",
    );
    if (!confirmed) return;

    setError("");
    setSuccess("");

    startUnlinkTransition(async () => {
      const result = await unlinkCustomerLine(customer.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSuccess("ปลดการเชื่อมต่อ LINE เรียบร้อยแล้ว ลูกค้าสามารถยืนยันเบอร์ผ่าน LINE ได้อีกครั้ง");
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
        <h2 className="mb-5 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-300">
          ข้อมูลลูกค้า
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {customer?.code && (
            <div>
              <label className={labelCls}>รหัสลูกค้า</label>
              <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm font-medium text-[#1e3a5f] dark:border-white/10 dark:bg-white/5 dark:text-sky-300">
                {customer.code}
              </div>
            </div>
          )}

          {(customer?.source === "LINE_LIFF" || hasLineLink) && (
            <div>
              <label className={labelCls}>แหล่งที่มา</label>
              <div className="flex flex-wrap gap-2">
                {customer?.source === "LINE_LIFF" ? (
                  <span className="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">
                    สมัครผ่าน LINE
                  </span>
                ) : null}
                {customer?.lineUserId ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                    ผูก LINE แล้ว
                  </span>
                ) : null}
              </div>
              {customer?.lineLinkedAt ? (
                <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
                  ผูกเมื่อ {formatDateThai(customer?.lineLinkedAt)}
                </p>
              ) : null}
            </div>
          )}

          <div>
            <label className={labelCls}>
              ชื่อลูกค้า <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              required
              maxLength={100}
              defaultValue={customer?.name ?? ""}
              className={inputCls}
              placeholder="ชื่อ-นามสกุล หรือชื่อบริษัท"
            />
          </div>

          <div>
            <label className={labelCls}>เบอร์โทร</label>
            <input
              type="tel"
              name="phone"
              inputMode="tel"
              maxLength={12}
              pattern="0[0-9]{2}-[0-9]{3}-[0-9]{4}"
              defaultValue={customer?.phone ?? ""}
              onChange={(event) => {
                event.currentTarget.value = formatCustomerPhoneInput(event.currentTarget.value);
              }}
              className={inputCls}
              placeholder={CUSTOMER_PHONE_EXAMPLE}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
              รูปแบบเดียวกับ LINE: {CUSTOMER_PHONE_EXAMPLE}
            </p>
          </div>

          <div>
            <label className={labelCls}>เครดิต (วัน)</label>
            <input
              type="number"
              name="creditTerm"
              min={0}
              max={365}
              defaultValue={customer?.creditTerm ?? 0}
              onBlur={(e) => {
                if (e.target.value.trim() === "") {
                  e.target.value = "0";
                }
              }}
              className={inputCls}
              placeholder="0 = เงินสด"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
              จำนวนวันเครดิตสำหรับลูกค้า (ว่างไว้ = ไม่กำหนด)
            </p>
          </div>

          <div>
            <label className={labelCls}>เลขผู้เสียภาษี</label>
            <TaxIdInput
              name="taxId"
              defaultValue={customer?.taxId ?? ""}
              className={inputCls}
              placeholder="13 หลัก"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>ที่อยู่</label>
            <textarea
              name="address"
              rows={3}
              maxLength={300}
              defaultValue={customer?.address ?? ""}
              className={inputCls}
              placeholder="ที่อยู่สำหรับออกเอกสาร"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>ที่อยู่จัดส่ง</label>
            <textarea
              name="shippingAddress"
              rows={3}
              maxLength={500}
              defaultValue={customer?.shippingAddress ?? ""}
              className={inputCls}
              placeholder="ที่อยู่จัดส่งสินค้า (ถ้าต่างจากที่อยู่ปกติ)"
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>ปักหมุดที่อยู่จัดส่ง</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm">
                {pinLat !== null && pinLon !== null ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <CheckCircle2 size={14} />
                    ปักหมุดแล้ว ({pinLat.toFixed(6)}, {pinLon.toFixed(6)})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    ยังไม่ได้ปักหมุด
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPinSheetOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/20"
              >
                <MapPin size={15} />
                {pinLat !== null && pinLon !== null ? "แก้ไขหมุด" : "ปักหมุดที่อยู่จัดส่ง"}
              </button>
            </div>
          </div>

          <LocationPinPickerSheet
            mode="customer"
            open={pinSheetOpen}
            onClose={() => setPinSheetOpen(false)}
            initialLat={pinLat}
            initialLon={pinLon}
            title="ปักหมุดที่อยู่จัดส่ง"
            subtitle={customer ? customer.name : undefined}
            onConfirm={(lat, lon) => {
              setPinLat(lat);
              setPinLon(lon);
            }}
          />

          <div className="md:col-span-2">
            <label className={labelCls}>หมายเหตุ</label>
            <textarea
              name="note"
              rows={2}
              maxLength={500}
              defaultValue={customer?.note ?? ""}
              className={inputCls}
              placeholder="หมายเหตุเพิ่มเติม"
            />
          </div>
        </div>
      </div>

      {hasLineLink && customer ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="font-kanit text-base font-semibold text-amber-900 dark:text-amber-100">
                การเชื่อมต่อบัญชี LINE
              </h3>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                ใช้เมื่อลูกค้าเปลี่ยนบัญชี LINE หรือไม่สามารถเข้าใช้งานบริการผ่าน LINE ได้
              </p>
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                หลังปลดการเชื่อมต่อ ลูกค้าต้องเปิดบริการผ่าน LINE และยืนยันเบอร์ {customer.phone ?? "เดิม"} ใหม่อีกครั้ง
              </p>
              <div className="mt-3 rounded-lg border border-amber-200 bg-white/70 px-3 py-2 dark:border-amber-400/30 dark:bg-slate-950/60">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  LINE userId
                </p>
                <p className="mt-1 break-all font-mono text-xs font-semibold text-amber-950 dark:text-amber-50">
                  {customer.lineUserId}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleUnlinkLine}
              disabled={isUnlinkPending || isPending}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-400/40 dark:bg-slate-950/80 dark:text-amber-100 dark:hover:bg-amber-500/15"
            >
              <Link2Off size={16} />
              {isUnlinkPending ? "กำลังปลด..." : "ปลดการเชื่อมต่อ LINE"}
            </button>
          </div>
        </div>
      ) : null}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-400/30 dark:bg-red-500/10">
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-400/30 dark:bg-green-500/10">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-600 dark:text-green-300">{success}</p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              กำลังบันทึก...
            </span>
          ) : isEdit ? (
            "บันทึกการแก้ไข"
          ) : (
            "เพิ่มลูกค้า"
          )}
        </button>
      </div>
    </form>
  );
};

export default CustomerForm;
