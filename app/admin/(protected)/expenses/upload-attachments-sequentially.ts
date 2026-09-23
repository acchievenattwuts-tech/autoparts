import { uploadExpenseAttachments } from "./attachment-actions";

const UPLOAD_FAILED_MESSAGE = "อัปโหลดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";

export type SequentialUploadResult = {
  /** Files that were stored successfully, in the order they were sent. */
  uploadedCount: number;
  /** Thai error for the first file that failed; later files are not attempted. */
  error: string | null;
};

/**
 * Uploads expense attachments one file per Server Action call.
 *
 * Server Action request bodies are capped at 3mb (next.config.ts). Sending
 * several phone photos in one FormData exceeds that cap even when every file
 * is individually under the limit, and the request then fails without a Thai
 * message. One call per file keeps each body within the cap. The server action
 * still enforces the per-document file count and per-file size on every call.
 */
export const uploadExpenseAttachmentsSequentially = async (
  expenseId: string,
  files: File[],
): Promise<SequentialUploadResult> => {
  let uploadedCount = 0;
  for (const file of files) {
    const formData = new FormData();
    formData.append("files", file);
    try {
      const result = await uploadExpenseAttachments(expenseId, formData);
      if (result.error) return { uploadedCount, error: result.error };
    } catch (error) {
      console.error("[uploadExpenseAttachmentsSequentially]", error);
      return { uploadedCount, error: UPLOAD_FAILED_MESSAGE };
    }
    uploadedCount += 1;
  }
  return { uploadedCount, error: null };
};
