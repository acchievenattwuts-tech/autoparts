/**
 * Expense-attachment limits shared by the client picker and the server storage
 * module. Kept free of `sharp`/`@vercel/blob` imports so the Client Component
 * that renders the picker never pulls server-only code into its bundle.
 */

export const EXPENSE_ATTACHMENT_ROOT = "expense-attachments";
export const EXPENSE_ATTACHMENT_MAX_FILES = 5;
/** Server Action bodies are capped at 3mb in `next.config.ts` (Vercel caps at 4.5MB). */
export const EXPENSE_ATTACHMENT_MAX_FILE_BYTES = 3 * 1024 * 1024;
export const EXPENSE_ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";
export const EXPENSE_ATTACHMENT_PDF_MIME_TYPE = "application/pdf";
