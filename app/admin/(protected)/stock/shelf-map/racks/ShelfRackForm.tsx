"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";

import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";
import { MAX_SHELF_RACK_LEVELS, SHELF_RACK_CODE_MAX_LENGTH } from "@/lib/shelf-location-rules";
import type { ShelfRackAdminRow } from "@/lib/shelf-map-queries";
import { formatDateThai } from "@/lib/th-date";
import { submitFormData } from "../../../master/submit-form-data";
import { createShelfRack, toggleShelfRack, updateShelfRack } from "./actions";

type ShelfRackFormProps = {
  racks: ShelfRackAdminRow[];
  canManage: boolean;
  nextSortOrder: number;
};

const TABLE_COLUMN_COUNT = 7;
const NAME_MAX_LENGTH = 50;
const SORT_ORDER_MAX = 9999;
const DEFAULT_LEVELS = 4;

// Input / label tokens shared with app/admin/(protected)/sales/new/SaleForm.tsx.
const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";
const codeInputCls = `${inputCls} font-mono uppercase`;
const thCls = "px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300";
const errorCls = "text-xs text-red-500 dark:text-red-300";

type RackFieldsProps = {
  idPrefix: string;
  defaults: { code: string; name: string; levels: number; sortOrder: number };
  minLevelHint?: number;
};

const RackFields = ({ idPrefix, defaults, minLevelHint }: RackFieldsProps) => (
  <>
    <div className="sm:w-28">
      <label htmlFor={`${idPrefix}-code`} className={labelCls}>
        รหัส
      </label>
      <input
        id={`${idPrefix}-code`}
        type="text"
        name="code"
        defaultValue={defaults.code}
        required
        maxLength={SHELF_RACK_CODE_MAX_LENGTH}
        pattern="[A-Za-z0-9]{1,4}"
        title="ตัวอักษร A–Z หรือตัวเลข ยาว 1–4 ตัว"
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="เช่น A"
        className={codeInputCls}
      />
    </div>
    <div className="min-w-0 flex-1">
      <label htmlFor={`${idPrefix}-name`} className={labelCls}>
        ชื่อ <span className="font-normal text-gray-400 dark:text-slate-500">(ไม่บังคับ)</span>
      </label>
      <input
        id={`${idPrefix}-name`}
        type="text"
        name="name"
        defaultValue={defaults.name}
        maxLength={NAME_MAX_LENGTH}
        placeholder="เช่น ชั้นคอยล์เย็น ฝั่งซ้าย"
        className={inputCls}
      />
    </div>
    <div className="sm:w-28">
      <label htmlFor={`${idPrefix}-levels`} className={labelCls}>
        จำนวนชั้น
      </label>
      <input
        id={`${idPrefix}-levels`}
        type="number"
        name="levels"
        defaultValue={defaults.levels}
        required
        min={1}
        max={MAX_SHELF_RACK_LEVELS}
        className={inputCls}
      />
      {minLevelHint && minLevelHint > 0 ? (
        <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">มีสินค้าถึงชั้น {minLevelHint}</p>
      ) : null}
    </div>
    <div className="sm:w-24">
      <label htmlFor={`${idPrefix}-sortOrder`} className={labelCls}>
        ลำดับ
      </label>
      <input
        id={`${idPrefix}-sortOrder`}
        type="number"
        name="sortOrder"
        defaultValue={defaults.sortOrder}
        min={0}
        max={SORT_ORDER_MAX}
        className={inputCls}
      />
    </div>
  </>
);

type RackRowProps = {
  rack: ShelfRackAdminRow;
  canManage: boolean;
  isBusy: boolean;
  onToggle: (rack: ShelfRackAdminRow) => void;
  toggleError?: string;
};

const RackEditRow = ({ rack, onClose }: { rack: ShelfRackAdminRow; onClose: () => void }) => {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleUpdate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await updateShelfRack(rack.id, formData);
      if (result.error) setError(result.error);
      else onClose();
    });
  };

  return (
    <tr className="border-b border-gray-100 bg-blue-50 dark:border-white/10 dark:bg-sky-500/10">
      <td colSpan={TABLE_COLUMN_COUNT} className="px-4 py-4">
        <form
          onSubmit={(event) => submitFormData(event, handleUpdate)}
          className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start"
        >
          <RackFields
            idPrefix={`rack-${rack.id}`}
            defaults={{ code: rack.code, name: rack.name ?? "", levels: rack.levels, sortOrder: rack.sortOrder }}
            minLevelHint={rack.maxUsedLevel}
          />
          <div className="flex gap-2 sm:pt-7">
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
            >
              <Check size={15} />
              {isPending ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              <X size={15} />
              ยกเลิก
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
          ถ้าเปลี่ยนรหัส ตำแหน่งทุกชิ้นในชั้นวางนี้จะเปลี่ยนชื่อตาม (ตอนนี้คือ {rack.code}-1, {rack.code}-2, …)
        </p>
        {error && (
          <p role="alert" className={`mt-2 ${errorCls}`}>
            {error}
          </p>
        )}
      </td>
    </tr>
  );
};

const RackRow = ({ rack, canManage, isBusy, onToggle, toggleError }: RackRowProps) => {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing && canManage) return <RackEditRow rack={rack} onClose={() => setIsEditing(false)} />;

  return (
    <Fragment>
      <tr className={`border-b border-gray-50 transition-colors dark:border-white/10 ${getAdminMasterRowClass(rack.isActive)}`}>
        <td className="px-4 py-3 font-mono text-base font-bold text-[#1e3a5f] dark:text-sky-200">{rack.code}</td>
        <td className="px-4 py-3 text-gray-700 dark:text-slate-200">
          {rack.name ?? <span className="text-gray-300 dark:text-slate-600">-</span>}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-800 dark:text-slate-100">{rack.levels}</td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-800 dark:text-slate-100">
          {rack.productCount.toLocaleString("th-TH")}
          {rack.productCount > 0 ? (
            <span className="block text-xs text-gray-400 dark:text-slate-500">ใช้ถึงชั้น {rack.maxUsedLevel}</span>
          ) : null}
        </td>
        <td className="px-4 py-3">
          <AdminStatusBadge tone={getAdminActiveBadgeTone(rack.isActive)}>
            {rack.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
          </AdminStatusBadge>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-slate-400">{formatDateThai(rack.createdAt)}</td>
        <td className="px-4 py-3 text-right">
          {canManage ? (
            <AdminActionGroup align="end" className="flex-nowrap">
              <button
                type="button"
                onClick={() => setIsEditing(true)}
                disabled={isBusy}
                className="flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
              >
                <Pencil size={12} />
                แก้ไข
              </button>
              <button
                type="button"
                onClick={() => onToggle(rack)}
                disabled={isBusy}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
                  rack.isActive
                    ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500"
                    : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
                }`}
              >
                {isBusy ? "..." : rack.isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
            </AdminActionGroup>
          ) : (
            <span className="text-xs text-gray-300 dark:text-slate-600">-</span>
          )}
        </td>
      </tr>
      {toggleError ? (
        <tr className="border-b border-gray-100 bg-red-50 dark:border-white/10 dark:bg-red-500/10">
          <td colSpan={TABLE_COLUMN_COUNT} className="px-4 py-2">
            <p role="alert" className={errorCls}>
              {toggleError}
            </p>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
};

const AddRackSection = ({ nextSortOrder }: { nextSortOrder: number }) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleCreate = (formData: FormData) => {
    setError("");
    startTransition(async () => {
      const result = await createShelfRack(formData);
      if (result.error) setError(result.error);
      else formRef.current?.reset();
    });
  };

  return (
    <AdminSectionCard title="เพิ่มชั้นวาง" description="รหัสใช้ตัวอักษร A–Z หรือตัวเลข 1–4 ตัว ชั้น 1 คือชั้นล่างสุด">
      <form
        ref={formRef}
        onSubmit={(event) => submitFormData(event, handleCreate)}
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start"
      >
        <RackFields
          key={nextSortOrder}
          idPrefix="rack-new"
          defaults={{ code: "", name: "", levels: DEFAULT_LEVELS, sortOrder: nextSortOrder }}
        />
        <div className="sm:pt-7">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60 sm:w-auto"
          >
            <Plus size={15} />
            {isPending ? "กำลังบันทึก..." : "เพิ่ม"}
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className={`mt-2 ${errorCls}`}>
          {error}
        </p>
      )}
    </AdminSectionCard>
  );
};

const ShelfRackForm = ({ racks, canManage, nextSortOrder }: ShelfRackFormProps) => {
  const [isPending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<{ id: string; message: string } | null>(null);
  const activeCount = racks.filter((rack) => rack.isActive).length;

  const handleToggle = (rack: ShelfRackAdminRow) => {
    setToggleError(null);
    setTogglingId(rack.id);
    startTransition(async () => {
      const result = await toggleShelfRack(rack.id, !rack.isActive);
      if (result.error) setToggleError({ id: rack.id, message: result.error });
      setTogglingId(null);
    });
  };

  return (
    <div className="space-y-6">
      {canManage && <AddRackSection nextSortOrder={nextSortOrder} />}

      <AdminTableSection
        title={`รายการชั้นวาง (${racks.length} รายการ)`}
        description={`ใช้งานอยู่ ${activeCount} ชั้นวาง`}
      >
        {racks.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">ยังไม่มีชั้นวาง</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr className="border-b border-gray-100 dark:border-white/10">
                <th className={thCls}>รหัส</th>
                <th className={thCls}>ชื่อ</th>
                <th className={`${thCls} text-right`}>จำนวนชั้น</th>
                <th className={`${thCls} text-right`}>สินค้าที่วาง</th>
                <th className={thCls}>สถานะ</th>
                <th className={thCls}>วันที่เพิ่ม</th>
                <th className={`${thCls} text-right`}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {racks.map((rack) => (
                <RackRow
                  key={rack.id}
                  rack={rack}
                  canManage={canManage}
                  isBusy={togglingId === rack.id || isPending}
                  onToggle={handleToggle}
                  toggleError={toggleError?.id === rack.id ? toggleError.message : undefined}
                />
              ))}
            </tbody>
          </table>
        )}
      </AdminTableSection>
    </div>
  );
};

export default ShelfRackForm;
