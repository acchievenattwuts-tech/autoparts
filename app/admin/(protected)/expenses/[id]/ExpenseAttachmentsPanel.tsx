"use client";

import { ExternalLink, FileText, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import ExpenseAttachmentPicker, { formatAttachmentSize } from "@/components/shared/ExpenseAttachmentPicker";
import { EXPENSE_ATTACHMENT_PDF_MIME_TYPE } from "@/lib/expense-attachment-constants";
import { deleteExpenseAttachment, uploadExpenseAttachments } from "../attachment-actions";

export interface ExpenseAttachmentView {
  id: string;
  url: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  createdAtLabel: string;
  uploadedByName: string;
}

interface Props {
  expenseId: string;
  attachments: ExpenseAttachmentView[];
  /** Add/remove is hidden without `expenses.update`, or once the document is cancelled. */
  canManage: boolean;
}

const THUMBNAIL_SIZE = 56;

const ExpenseAttachmentsPanel = ({ expenseId, attachments, canManage }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = () => {
    if (pendingFiles.length === 0) return;
    setError(null);

    const formData = new FormData();
    for (const file of pendingFiles) formData.append("files", file);

    startTransition(async () => {
      const result = await uploadExpenseAttachments(expenseId, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setPendingFiles([]);
      router.refresh();
    });
  };

  const handleDelete = (attachmentId: string, fileName: string) => {
    if (!window.confirm(`ลบไฟล์แนบ "${fileName}" ?`)) return;
    setError(null);

    startTransition(async () => {
      const result = await deleteExpenseAttachment(attachmentId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mb-6 rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
      <h2 className="mb-4 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
        ไฟล์แนบ (หลักฐานการจ่ายเงิน)
      </h2>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}

      {attachments.length === 0 ? (
        <p className="mb-4 text-sm text-gray-400 dark:text-slate-500">ยังไม่มีไฟล์แนบ</p>
      ) : (
        <ul className="mb-4 space-y-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 dark:border-white/10"
            >
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-3 text-sm text-gray-700 transition-colors hover:text-[#1e3a5f] dark:text-slate-300 dark:hover:text-sky-300"
              >
                {attachment.contentType === EXPENSE_ATTACHMENT_PDF_MIME_TYPE ? (
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-gray-100 bg-gray-50 dark:border-white/10 dark:bg-white/5">
                    <FileText size={20} className="text-gray-400 dark:text-slate-500" />
                  </span>
                ) : (
                  <Image
                    src={attachment.url}
                    alt={attachment.fileName}
                    width={THUMBNAIL_SIZE}
                    height={THUMBNAIL_SIZE}
                    sizes="56px"
                    className="h-14 w-14 shrink-0 rounded-md border border-gray-100 object-cover dark:border-white/10"
                  />
                )}
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {attachment.fileName}
                    <ExternalLink size={13} className="shrink-0 text-gray-400 dark:text-slate-500" />
                  </span>
                  <span className="block text-xs text-gray-400 dark:text-slate-500">
                    {formatAttachmentSize(attachment.fileSize)} · {attachment.createdAtLabel} ·{" "}
                    {attachment.uploadedByName}
                  </span>
                </span>
              </a>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleDelete(attachment.id, attachment.fileName)}
                  disabled={isPending}
                  className="shrink-0 text-red-400 transition-colors hover:text-red-600 disabled:opacity-50"
                  aria-label={`ลบไฟล์แนบ ${attachment.fileName}`}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="border-t border-gray-100 pt-4 dark:border-white/10">
          <ExpenseAttachmentPicker
            files={pendingFiles}
            onChange={setPendingFiles}
            onError={setError}
            existingCount={attachments.length}
            disabled={isPending}
          />
          {pendingFiles.length > 0 && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={isPending}
              className="mt-3 rounded-lg bg-[#1e3a5f] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60"
            >
              {isPending ? "กำลังอัปโหลด..." : `อัปโหลด ${pendingFiles.length} ไฟล์`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ExpenseAttachmentsPanel;
