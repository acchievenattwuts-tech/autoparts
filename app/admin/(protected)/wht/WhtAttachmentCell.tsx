"use client";

import { useRef, useState, useTransition } from "react";
import { Paperclip, Upload, X } from "lucide-react";
import { WHT_ATTACHMENT_ACCEPT, WHT_ATTACHMENT_MAX_FILES } from "@/lib/wht-attachment-constants";
import { deleteWhtAttachment, uploadWhtAttachments } from "./attachment-actions";

export interface WhtAttachmentItem {
  id: string;
  url: string;
  fileName: string;
}

interface Props {
  whtReceivedId: string;
  attachments: WhtAttachmentItem[];
  canEdit: boolean;
}

/** ไฟล์แนบหนังสือรับรอง 50 ทวิ ที่ลูกค้าส่งมา — ไม่มีใบ = เครดิตภาษีไม่ได้ */
const WhtAttachmentCell = ({ whtReceivedId, attachments, canEdit }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const atLimit = attachments.length >= WHT_ATTACHMENT_MAX_FILES;

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");

    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);

    startTransition(async () => {
      const result = await uploadWhtAttachments(whtReceivedId, formData);
      if (fileRef.current) fileRef.current.value = "";
      if (!result.success) setError(result.error ?? "อัปโหลดไม่สำเร็จ");
    });
  };

  const removeAttachment = (attachmentId: string) => {
    setError("");
    startTransition(async () => {
      const result = await deleteWhtAttachment(attachmentId);
      if (!result.success) setError(result.error ?? "ลบไฟล์ไม่สำเร็จ");
    });
  };

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
          attachments.length > 0
            ? "bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
            : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-400 dark:hover:bg-white/10"
        }`}
      >
        <Paperclip size={12} />
        {attachments.length > 0 ? `${attachments.length} ไฟล์` : "ไม่มีไฟล์"}
      </button>

      {open && (
        <div className="space-y-1.5">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-1.5">
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-xs text-[#1e3a5f] hover:underline dark:text-sky-300"
                title={attachment.fileName}
              >
                {attachment.fileName}
              </a>
              {canEdit && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => removeAttachment(attachment.id)}
                  className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-500/10"
                  title="ลบไฟล์แนบ"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}

          {canEdit && !atLimit && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={WHT_ATTACHMENT_ACCEPT}
                disabled={isPending}
                onChange={(event) => handleFiles(event.target.files)}
                className="hidden"
                id={`wht-attachment-${whtReceivedId}`}
              />
              <label
                htmlFor={`wht-attachment-${whtReceivedId}`}
                className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300 ${
                  isPending ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <Upload size={12} />
                {isPending ? "กำลังอัปโหลด..." : "แนบไฟล์ 50 ทวิ"}
              </label>
            </>
          )}

          {canEdit && atLimit && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              แนบได้สูงสุด {WHT_ATTACHMENT_MAX_FILES} ไฟล์
            </p>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-300">{error}</p>}
        </div>
      )}
    </div>
  );
};

export default WhtAttachmentCell;
