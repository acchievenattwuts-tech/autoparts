"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

import { savePartnerProfile } from "../actions";

export type PartnerRow = {
  userId: string;
  name: string;
  email: string;
  defaultSharePercent: number;
  bankName: string;
  bankAccountNo: string;
  joinedAt: string;
  note: string;
  isActive: boolean;
};

type Props = {
  partners: PartnerRow[];
  candidateOptions: SelectOption[];
  today: string;
};

const INPUT_CLASS =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-sky-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100";
const LABEL_CLASS = "mb-1 block text-xs font-medium text-gray-600 dark:text-slate-300";
const CARD_CLASS =
  "rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900";

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PartnerManager = ({ partners, candidateOptions, today }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [form, setForm] = useState({
    userId: "",
    defaultSharePercent: "0",
    bankName: "",
    bankAccountNo: "",
    joinedAt: today,
    note: "",
    isActive: true,
  });

  const percentTotal = partners
    .filter((partner) => partner.isActive)
    .reduce((sum, partner) => sum + partner.defaultSharePercent, 0);

  const resetForm = () => {
    setEditingUserId("");
    setForm({
      userId: "",
      defaultSharePercent: "0",
      bankName: "",
      bankAccountNo: "",
      joinedAt: today,
      note: "",
      isActive: true,
    });
  };

  const startEdit = (partner: PartnerRow) => {
    setError("");
    setEditingUserId(partner.userId);
    setForm({
      userId: partner.userId,
      defaultSharePercent: String(partner.defaultSharePercent),
      bankName: partner.bankName,
      bankAccountNo: partner.bankAccountNo,
      joinedAt: partner.joinedAt,
      note: partner.note,
      isActive: partner.isActive,
    });
  };

  const handleSave = () => {
    setError("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("userId", form.userId);
      formData.set("defaultSharePercent", form.defaultSharePercent);
      formData.set("bankName", form.bankName);
      formData.set("bankAccountNo", form.bankAccountNo);
      formData.set("joinedAt", form.joinedAt);
      formData.set("note", form.note);
      formData.set("isActive", form.isActive ? "1" : "0");

      const result = await savePartnerProfile(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <section className={CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
            ผู้ร่วมทุนปัจจุบัน
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              Math.abs(percentTotal - 100) < 0.01
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200"
            }`}
          >
            สัดส่วนตั้งต้นรวม {money(percentTotal)}%
          </span>
        </div>

        {partners.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">
            ยังไม่มีผู้ร่วมทุน — เพิ่มได้จากฟอร์มด้านล่าง
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
              <thead className="text-left text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3">ชื่อ</th>
                  <th className="py-2 pr-3 text-right">สัดส่วนตั้งต้น</th>
                  <th className="py-2 pr-3">บัญชีรับเงิน</th>
                  <th className="py-2 pr-3">หมายเหตุ</th>
                  <th className="py-2 pr-3">สถานะ</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {partners.map((partner) => (
                  <tr key={partner.userId}>
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-gray-800 dark:text-slate-100">
                        {partner.name}
                      </p>
                      <p className="text-[11px] text-gray-400 dark:text-slate-500">
                        {partner.email}
                      </p>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-gray-700 dark:text-slate-200">
                      {money(partner.defaultSharePercent)}%
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-gray-600 dark:text-slate-300">
                      {partner.bankName || partner.bankAccountNo ? (
                        <>
                          {partner.bankName ? <span>{partner.bankName} </span> : null}
                          {partner.bankAccountNo ? (
                            <span className="font-mono">{partner.bankAccountNo}</span>
                          ) : null}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-gray-600 dark:text-slate-300">
                      {partner.note || "-"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          partner.isActive
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
                            : "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-slate-400"
                        }`}
                      >
                        {partner.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                      </span>
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(partner)}
                        className="text-sm font-medium text-[#1e3a5f] hover:underline dark:text-sky-300"
                      >
                        แก้ไข
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={CARD_CLASS}>
        <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">
          {editingUserId ? "แก้ไขผู้ร่วมทุน" : "เพิ่มผู้ร่วมทุน"}
        </h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <span className={LABEL_CLASS}>ผู้ใช้ในระบบ</span>
            {editingUserId ? (
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-white/5 dark:text-slate-200">
                {partners.find((partner) => partner.userId === editingUserId)?.name ?? "-"}
              </p>
            ) : (
              <SearchableSelect
                options={candidateOptions}
                value={form.userId}
                onChange={(userId) => setForm((previous) => ({ ...previous, userId }))}
                placeholder="เลือกผู้ใช้"
              />
            )}
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="defaultSharePercent">
              สัดส่วนตั้งต้น (%)
            </label>
            <input
              id="defaultSharePercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={form.defaultSharePercent}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, defaultSharePercent: event.target.value }))
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="bankName">
              ธนาคาร
            </label>
            <input
              id="bankName"
              type="text"
              maxLength={100}
              value={form.bankName}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, bankName: event.target.value }))
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="bankAccountNo">
              เลขที่บัญชี
            </label>
            <input
              id="bankAccountNo"
              type="text"
              maxLength={50}
              value={form.bankAccountNo}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, bankAccountNo: event.target.value }))
              }
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="joinedAt">
              วันที่เริ่มร่วมทุน
            </label>
            <input
              id="joinedAt"
              type="date"
              value={form.joinedAt}
              max={today}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, joinedAt: event.target.value }))
              }
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS} htmlFor="note">
              หมายเหตุ
            </label>
            <input
              id="note"
              type="text"
              maxLength={300}
              value={form.note}
              onChange={(event) =>
                setForm((previous) => ({ ...previous, note: event.target.value }))
              }
              className={INPUT_CLASS}
              placeholder="เช่น ดูแลงานหน้าร้าน / ผู้ลงทุนหลัก"
            />
          </div>
        </div>

        <label className="mt-3 inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, isActive: event.target.checked }))
            }
            className="h-4 w-4 rounded border-gray-300 dark:border-white/20"
          />
          ใช้งานอยู่ (ปิดไว้เมื่อไม่ต้องการให้เข้ารอบแบ่งกำไรใหม่)
        </label>

        {error ? (
          <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {editingUserId ? (
            <button
              type="button"
              onClick={resetForm}
              disabled={isPending}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 px-5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            >
              ยกเลิกการแก้ไข
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || form.userId.length === 0}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-[#1e3a5f] px-6 text-sm font-semibold text-white hover:bg-[#274b78] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </section>
    </div>
  );
};

export default PartnerManager;
