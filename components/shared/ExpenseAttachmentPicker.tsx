"use client";

import { FileText, ImageIcon, Paperclip, Trash2 } from "lucide-react";
import { useId, useRef } from "react";

import {
  EXPENSE_ATTACHMENT_ACCEPT,
  EXPENSE_ATTACHMENT_MAX_FILES,
  EXPENSE_ATTACHMENT_MAX_FILE_BYTES,
} from "@/lib/expense-attachment-constants";

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  onError: (message: string | null) => void;
  /** Attachments already stored on the document — counts toward the per-document cap. */
  existingCount?: number;
  disabled?: boolean;
}

const BYTES_PER_MB = 1024 * 1024;

export const formatAttachmentSize = (bytes: number): string =>
  bytes >= BYTES_PER_MB
    ? `${(bytes / BYTES_PER_MB).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Optional evidence-file picker (transfer slips / receipts). Holds the chosen
 * files in memory; the caller uploads them once the expense document exists.
 */
const ExpenseAttachmentPicker = ({
  files,
  onChange,
  onError,
  existingCount = 0,
  disabled = false,
}: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const remaining = EXPENSE_ATTACHMENT_MAX_FILES - existingCount - files.length;

  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;

    const oversized = selected.find((file) => file.size > EXPENSE_ATTACHMENT_MAX_FILE_BYTES);
    if (oversized) {
      onError(`ไฟล์ "${oversized.name}" มีขนาดเกิน 3MB`);
      return;
    }
    if (selected.length > remaining) {
      onError(`แนบไฟล์ได้สูงสุด ${EXPENSE_ATTACHMENT_MAX_FILES} ไฟล์ต่อเอกสาร`);
      return;
    }

    onError(null);
    onChange([...files, ...selected]);
  };

  const removeAt = (index: number) => {
    onError(null);
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
            ไฟล์แนบ <span className="text-xs font-normal text-gray-400 dark:text-slate-500">(ไม่บังคับ)</span>
          </p>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            สลิปโอนเงิน / ใบเสร็จ — รูปภาพหรือ PDF ไม่เกิน 3MB สูงสุด {EXPENSE_ATTACHMENT_MAX_FILES} ไฟล์
            (รูปภาพจะถูกย่อและแปลงเป็นขาวดำอัตโนมัติ)
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || remaining <= 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-slate-400 dark:hover:border-sky-500 dark:hover:text-sky-300"
        >
          <Paperclip size={14} /> เลือกไฟล์
        </button>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={EXPENSE_ATTACHMENT_ACCEPT}
        onChange={handleSelect}
        className="hidden"
      />

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm dark:border-white/10"
            >
              <span className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-slate-300">
                {file.type === "application/pdf" ? (
                  <FileText size={15} className="shrink-0 text-gray-400 dark:text-slate-500" />
                ) : (
                  <ImageIcon size={15} className="shrink-0 text-gray-400 dark:text-slate-500" />
                )}
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-gray-400 dark:text-slate-500">
                  {formatAttachmentSize(file.size)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeAt(index)}
                disabled={disabled}
                className="shrink-0 text-red-400 transition-colors hover:text-red-600 disabled:opacity-50"
                aria-label={`ลบไฟล์ ${file.name}`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ExpenseAttachmentPicker;
