"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";
import { formatDateThai } from "@/lib/th-date";
import {
  createSearchSynonym,
  toggleSearchSynonym,
  updateSearchSynonym,
} from "./actions";

export interface SearchSynonymRow {
  id: string;
  term: string;
  synonyms: string[];
  language: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  synonyms: SearchSynonymRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canCancel: boolean;
}

// Mirror of lib/search-synonyms.ts MAX_SYNONYMS_PER_TERM (kept here so the
// client bundle does not pull in server-only db imports). Keep the two in sync —
// the Server Action validates against the lib value, so a stale copy here only
// blocks the admin from typing words the backend would have accepted.
const MAX_SYNONYMS_PER_TERM = 18;

const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] " +
  "dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-sky-500";

const labelCls = "block text-xs font-semibold text-gray-600 mb-1 dark:text-slate-300";

// ─── Chip input (manage `synonyms` array) ─────────────────────────────────────

const SynonymChipsInput = ({
  initial,
  name,
}: {
  initial: string[];
  name: string;
}) => {
  const [chips, setChips] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (chips.length >= MAX_SYNONYMS_PER_TERM) return;
    if (chips.some((c) => c.toLowerCase() === v.toLowerCase())) {
      setDraft("");
      return;
    }
    setChips((prev) => [...prev, v]);
    setDraft("");
  };

  const remove = (c: string) => setChips((prev) => prev.filter((x) => x !== c));

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(chips)} />
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`กรอกคำพ้อง แล้วกด Enter (สูงสุด ${MAX_SYNONYMS_PER_TERM} คำ)`}
          className={inputCls}
          disabled={chips.length >= MAX_SYNONYMS_PER_TERM}
        />
        <button
          type="button"
          onClick={add}
          disabled={chips.length >= MAX_SYNONYMS_PER_TERM}
          className="inline-flex items-center gap-1 rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
        >
          <Plus size={14} />
          เพิ่ม
        </button>
      </div>
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
            >
              {c}
              <button
                type="button"
                onClick={() => remove(c)}
                className="opacity-60 transition-opacity hover:opacity-100"
                aria-label="ลบ"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">ยังไม่มีคำพ้อง</p>
      )}
    </div>
  );
};

// ─── Editable row ─────────────────────────────────────────────────────────────

const EditableRow = ({
  row,
  canUpdate,
  canCancel,
}: {
  row: SearchSynonymRow;
  canUpdate: boolean;
  canCancel: boolean;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleUpdate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await updateSearchSynonym(row.id, formData);
      if (result.error) setError(result.error);
      else setIsEditing(false);
    });
  };

  const handleToggle = () => {
    startTransition(async () => {
      await toggleSearchSynonym(row.id, !row.isActive);
    });
  };

  if (isEditing && canUpdate) {
    return (
      <tr className="border-b border-gray-100 bg-blue-50 dark:border-white/10 dark:bg-sky-500/10">
        <td colSpan={5} className="px-4 py-4">
          {error && <p className="mb-2 text-xs text-red-500 dark:text-red-300">{error}</p>}
          <form action={handleUpdate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_120px]">
              <div>
                <label className={labelCls}>คำหลัก *</label>
                <input
                  type="text"
                  name="term"
                  defaultValue={row.term}
                  required
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>คำพ้อง</label>
                <SynonymChipsInput initial={row.synonyms} name="synonyms" />
              </div>
              <div>
                <label className={labelCls}>ภาษา</label>
                <select
                  name="language"
                  defaultValue={row.language ?? ""}
                  className={inputCls}
                >
                  <option value="">— ไม่ระบุ —</option>
                  <option value="th">ไทย</option>
                  <option value="en">อังกฤษ</option>
                  <option value="mixed">ผสม</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
              >
                <Check size={15} />
                {isPending ? "กำลังบันทึก..." : "บันทึก"}
              </button>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
              >
                <X size={15} />
                ยกเลิก
              </button>
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={`border-b border-gray-50 transition-colors ${
        getAdminMasterRowClass(row.isActive)
      }`}
    >
      <td className="px-4 py-3 font-medium text-gray-800 dark:text-slate-100">{row.term}</td>
      <td className="px-4 py-3">
        {row.synonyms.length === 0 ? (
          <span className="text-xs text-gray-400 dark:text-slate-500">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {row.synonyms.map((s) => (
              <span
                key={s}
                className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
        {row.language ?? "—"}
      </td>
      <td className="px-4 py-3">
        {row.isActive ? (
          <AdminStatusBadge tone={getAdminActiveBadgeTone(row.isActive)}>ใช้งาน</AdminStatusBadge>
        ) : (
          <AdminStatusBadge tone={getAdminActiveBadgeTone(row.isActive)}>ยกเลิก</AdminStatusBadge>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <AdminActionGroup align="end">
          {canUpdate && (
            <button
              onClick={() => setIsEditing(true)}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
            >
              <Pencil size={12} />
              แก้ไข
            </button>
          )}
          {canCancel && (
            <button
              onClick={handleToggle}
              disabled={isPending}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                row.isActive
                  ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500"
                  : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
              }`}
            >
              {row.isActive ? "ยกเลิก" : "เปิดใช้งาน"}
            </button>
          )}
        </AdminActionGroup>
      </td>
    </tr>
  );
};

// ─── Main client ──────────────────────────────────────────────────────────────

const SearchSynonymsClient = ({ synonyms, canCreate, canUpdate, canCancel }: Props) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createSearchSynonym(formData);
      if (result.error) setError(result.error);
      else {
        formRef.current?.reset();
        setResetKey((k) => k + 1);
      }
    });
  };

  return (
    <div className="space-y-6">
      {canCreate && (
        <AdminSectionCard title="เพิ่มคำพ้องใหม่">
          <form ref={formRef} action={handleCreate} className="space-y-3" key={resetKey}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_120px]">
              <div>
                <label className={labelCls}>คำหลัก *</label>
                <input
                  type="text"
                  name="term"
                  placeholder="เช่น คอมแอร์"
                  required
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>คำพ้อง</label>
                <SynonymChipsInput initial={[]} name="synonyms" />
              </div>
              <div>
                <label className={labelCls}>ภาษา</label>
                <select name="language" defaultValue="" className={inputCls}>
                  <option value="">— ไม่ระบุ —</option>
                  <option value="th">ไทย</option>
                  <option value="en">อังกฤษ</option>
                  <option value="mixed">ผสม</option>
                </select>
              </div>
            </div>

            {error && <p className="text-xs text-red-500 dark:text-red-300">{error}</p>}

            <button
              type="submit"
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60"
            >
              {isPending ? "กำลังบันทึก..." : "เพิ่มคำพ้อง"}
            </button>

            <p className="text-xs text-gray-500 dark:text-slate-400">
              ระบบใช้แบบสองทาง (bi-directional) — ไม่ว่าลูกค้าค้นด้วยคำหลักหรือคำพ้อง ระบบจะขยายค้นทั้งกลุ่ม
            </p>
          </form>
        </AdminSectionCard>
      )}

      <AdminTableSection title={`คำพ้องทั้งหมด (${synonyms.length} รายการ)`}>
        {synonyms.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">
            ยังไม่มีคำพ้อง — เพิ่มได้จากฟอร์มด้านบน
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">คำหลัก</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">คำพ้อง</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ภาษา</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {synonyms.map((row) => (
                  <EditableRow
                    key={row.id}
                    row={row}
                    canUpdate={canUpdate}
                    canCancel={canCancel}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminTableSection>
    </div>
  );
};

// `formatDateThai` reserved for future "วันที่อัปเดต" column.
void formatDateThai;

export default SearchSynonymsClient;
