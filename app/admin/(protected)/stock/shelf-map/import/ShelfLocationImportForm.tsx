"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { CheckCircle2, Download, Save, Search, X } from "lucide-react";

import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminStatCard from "@/components/shared/AdminStatCard";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import ShelfLocationBadges from "@/components/shared/ShelfLocationBadges";
import type { ShelfImportIssue, ShelfImportIssueKind, ShelfImportPreview } from "@/lib/shelf-location-excel";
import { applyShelfLocationImport, previewShelfLocationImport } from "./actions";

const XLSX_ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ISSUE_TABLE_MAX_ROWS = 200;
const OBJECT_URL_REVOKE_DELAY_MS = 1_000;
const CONNECTION_ERROR = "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่";

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100 dark:placeholder-slate-500";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5 dark:text-slate-300";
const primaryButtonCls =
  "flex items-center justify-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-700 dark:hover:bg-sky-600";
const saveButtonCls =
  "flex items-center justify-center gap-1.5 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-60";
const secondaryButtonCls =
  "flex items-center justify-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:opacity-60 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15";
const thCls = "px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300";
const tdCls = "px-4 py-3 align-top text-gray-700 dark:text-slate-200";

const ISSUE_KIND_META: Record<ShelfImportIssueKind, { label: string; tone: "danger" | "pending" | "warning" }> = {
  error: { label: "ข้อมูลผิด", tone: "danger" },
  conflict: { label: "ขัดแย้ง", tone: "pending" },
  warning: { label: "คำเตือน", tone: "warning" },
};

const formatNumber = (value: number): string => value.toLocaleString("th-TH");

// ─── CSV of the rows to fix (built in the browser) ──────────────────────────

const CSV_HEADERS = ["แถว", "ปัญหา", "รหัสสินค้า", "ชื่อสินค้า", "ตำแหน่งปัจจุบัน", "ที่กรอก", "เหตุผล"];

const csvCell = (value: string | number): string => {
  const raw = String(value);
  const text = typeof value === "string" && /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const buildIssuesCsv = (issues: readonly ShelfImportIssue[]): string => {
  const rows = issues.map((issue) => [
    issue.rowNumber,
    ISSUE_KIND_META[issue.kind].label,
    issue.productCode,
    issue.productName,
    issue.location,
    issue.entered,
    issue.message,
  ]);
  return `﻿${[CSV_HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
};

const downloadCsv = (content: string, fileName: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS);
};

const toFormData = (file: File): FormData => {
  const formData = new FormData();
  formData.set("file", file);
  return formData;
};

// ─── Preview pieces ─────────────────────────────────────────────────────────

const PreviewStats = ({ preview }: { preview: ShelfImportPreview }) => {
  const { counts } = preview;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <AdminStatCard label="จะเปลี่ยน" value={formatNumber(counts.changedProducts)} hint="สินค้า" />
      <AdminStatCard label="ยืนยันตำแหน่ง" value={formatNumber(counts.confirmedProducts)} hint="สินค้า" accent="success" />
      <AdminStatCard label="ไม่เปลี่ยน" value={formatNumber(counts.unchangedRows)} hint="แถว" accent="info" />
      <AdminStatCard label="ข้าม - ข้อมูลผิด" value={formatNumber(counts.errorRows)} hint="แถว" accent="danger" />
      <AdminStatCard label="ข้าม - ข้อมูลขัดแย้ง" value={formatNumber(counts.conflictRows)} hint="แถว" accent="warning" />
    </div>
  );
};

const ChangesTable = ({ preview }: { preview: ShelfImportPreview }) => (
  <AdminTableSection
    title={`สินค้าที่จะเปลี่ยนตำแหน่ง (${formatNumber(preview.counts.changedProducts)})`}
    description={
      preview.hiddenChangeCount > 0
        ? `แสดง ${formatNumber(preview.changes.length)} รายการแรก อีก ${formatNumber(preview.hiddenChangeCount)} รายการจะบันทึกด้วย`
        : "ตำแหน่งเดิมในระบบ เทียบกับตำแหน่งหลังบันทึก"
    }
  >
    {preview.changes.length === 0 ? (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">ไม่มีสินค้าที่ตำแหน่งจะเปลี่ยน</p>
    ) : (
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-gray-50 dark:bg-white/5">
          <tr className="border-b border-gray-100 dark:border-white/10">
            <th className={thCls}>สินค้า</th>
            <th className={thCls}>เดิม</th>
            <th className={thCls}>ใหม่</th>
            <th className={thCls}>แถว</th>
          </tr>
        </thead>
        <tbody>
          {preview.changes.map((change) => (
            <tr key={change.productId} className="border-b border-gray-100 last:border-0 dark:border-white/10">
              <td className={tdCls}>
                <p className="font-mono text-xs text-gray-500 dark:text-slate-400">{change.productCode}</p>
                <p className="font-medium text-gray-800 dark:text-slate-100">{change.productName}</p>
              </td>
              <td className={tdCls}>
                <ShelfLocationBadges locations={change.before} />
              </td>
              <td className={tdCls}>
                <ShelfLocationBadges locations={change.after} />
              </td>
              <td className={`${tdCls} whitespace-nowrap text-xs text-gray-500 dark:text-slate-400`}>
                {change.rowNumbers.join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminTableSection>
);

const IssuesTable = ({ issues }: { issues: readonly ShelfImportIssue[] }) => {
  if (issues.length === 0) return null;
  const shown = issues.slice(0, ISSUE_TABLE_MAX_ROWS);
  return (
    <AdminTableSection
      title={`แถวที่ข้ามและคำเตือน (${formatNumber(issues.length)})`}
      description={
        issues.length > shown.length
          ? `แสดง ${formatNumber(shown.length)} แถวแรก ดาวน์โหลดแถวที่ผิดเพื่อดูทั้งหมด`
          : "แถวที่ข้ามจะไม่ถูกบันทึก แก้ไขในไฟล์แล้วนำเข้าใหม่ได้"
      }
    >
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-gray-50 dark:bg-white/5">
          <tr className="border-b border-gray-100 dark:border-white/10">
            <th className={thCls}>แถว</th>
            <th className={thCls}>ปัญหา</th>
            <th className={thCls}>สินค้า</th>
            <th className={thCls}>ตำแหน่งปัจจุบัน</th>
            <th className={thCls}>ที่กรอก</th>
            <th className={thCls}>เหตุผล</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((issue, index) => (
            <tr
              key={`${issue.rowNumber}-${issue.kind}-${index}`}
              className="border-b border-gray-100 last:border-0 dark:border-white/10"
            >
              <td className={`${tdCls} font-mono text-xs`}>{issue.rowNumber}</td>
              <td className={tdCls}>
                <AdminStatusBadge tone={ISSUE_KIND_META[issue.kind].tone}>{ISSUE_KIND_META[issue.kind].label}</AdminStatusBadge>
              </td>
              <td className={tdCls}>
                <p className="font-mono text-xs text-gray-500 dark:text-slate-400">{issue.productCode || "-"}</p>
                <p className="text-gray-800 dark:text-slate-100">{issue.productName}</p>
              </td>
              <td className={`${tdCls} font-mono text-xs`}>{issue.location || "-"}</td>
              <td className={`${tdCls} text-xs`}>{issue.entered || "-"}</td>
              <td className={`${tdCls} text-xs`}>{issue.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminTableSection>
  );
};

type PreviewSectionProps = {
  preview: ShelfImportPreview;
  isPending: boolean;
  isApplying: boolean;
  onApply: () => void;
};

const PreviewSection = ({ preview, isPending, isApplying, onApply }: PreviewSectionProps) => {
  const { counts } = preview;
  const saveCount = counts.changedProducts + counts.confirmedProducts;
  const skipCount = counts.errorRows + counts.conflictRows;
  const rowsToFix = preview.issues.filter((issue) => issue.kind !== "warning");

  const handleDownload = (): void => {
    const baseName = preview.fileName.replace(/\.xlsx$/i, "");
    downloadCsv(buildIssuesCsv(rowsToFix), `${baseName}-rows-to-fix.csv`);
  };

  return (
    <div className="space-y-4">
      <AdminSectionCard
        title="ผลตรวจไฟล์"
        description={`${preview.fileName} · มีข้อมูล ${formatNumber(counts.rows)} แถว · ยังไม่ได้บันทึก`}
        actions={
          <>
            {rowsToFix.length > 0 ? (
              <button type="button" onClick={handleDownload} className={secondaryButtonCls}>
                <Download size={15} />
                ดาวน์โหลดแถวที่ผิด
              </button>
            ) : null}
            <button type="button" onClick={onApply} disabled={isPending || saveCount === 0} className={saveButtonCls}>
              <Save size={15} />
              {isApplying
                ? "กำลังบันทึก..."
                : `บันทึก ${formatNumber(saveCount)} รายการ (ข้าม ${formatNumber(skipCount)} แถว)`}
            </button>
          </>
        }
      >
        <PreviewStats preview={preview} />
        {saveCount === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">ไม่มีรายการที่ต้องบันทึกจากไฟล์นี้</p>
        ) : null}
      </AdminSectionCard>
      <ChangesTable preview={preview} />
      <IssuesTable issues={preview.issues} />
    </div>
  );
};

// ─── Form ───────────────────────────────────────────────────────────────────

const ShelfLocationImportForm = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ShelfImportPreview | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [pendingAction, setPendingAction] = useState<"preview" | "apply" | null>(null);
  const [isPending, startTransition] = useTransition();

  const resetFile = (): void => {
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setError("");
    setSuccess("");
  };

  const handleClear = (): void => {
    resetFile();
    setError("");
    setSuccess("");
  };

  const handlePreview = (): void => {
    if (!file) {
      setError("กรุณาเลือกไฟล์ .xlsx");
      return;
    }
    setError("");
    setSuccess("");
    setPendingAction("preview");
    startTransition(async () => {
      try {
        const result = await previewShelfLocationImport(toFormData(file));
        setPreview(result.ok ? result.preview : null);
        if (!result.ok) setError(result.error);
      } catch {
        setError(CONNECTION_ERROR);
      } finally {
        setPendingAction(null);
      }
    });
  };

  const handleApply = (): void => {
    if (!file) return;
    setError("");
    setPendingAction("apply");
    startTransition(async () => {
      try {
        const result = await applyShelfLocationImport(toFormData(file));
        if (result.ok) {
          resetFile();
          setSuccess(result.message);
        } else {
          setError(result.error);
        }
      } catch {
        setError(CONNECTION_ERROR);
      } finally {
        setPendingAction(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <AdminSectionCard
        title="เลือกไฟล์ที่กรอกแล้ว"
        description="รองรับเฉพาะไฟล์ .xlsx ที่ส่งออกจากหน้าผังชั้นวาง ขนาดไม่เกิน 2 MB"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="shelf-location-import-file" className={labelCls}>
              ไฟล์ Excel
            </label>
            <input
              id="shelf-location-import-file"
              ref={fileInputRef}
              type="file"
              accept={XLSX_ACCEPT}
              onChange={handleFileChange}
              disabled={isPending}
              className={`${inputCls} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-sm file:text-slate-700 dark:file:bg-white/10 dark:file:text-slate-200`}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handlePreview} disabled={!file || isPending} className={`${primaryButtonCls} flex-1 md:flex-none`}>
              <Search size={15} />
              {pendingAction === "preview" ? "กำลังตรวจ..." : "ตรวจไฟล์"}
            </button>
            {file || preview ? (
              <button type="button" onClick={handleClear} disabled={isPending} className={secondaryButtonCls}>
                <X size={15} />
                ล้าง
              </button>
            ) : null}
          </div>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-400/40 dark:bg-rose-950/30 dark:text-rose-200"
          >
            {error}
          </p>
        ) : null}
        {success ? (
          <p
            role="status"
            className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-950/30 dark:text-emerald-200"
          >
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            {success}
          </p>
        ) : null}
      </AdminSectionCard>
      {preview ? (
        <PreviewSection
          preview={preview}
          isPending={isPending}
          isApplying={pendingAction === "apply"}
          onApply={handleApply}
        />
      ) : null}
    </div>
  );
};

export default ShelfLocationImportForm;
