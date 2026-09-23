/**
 * Result line for the pricing screens. Success and failure used to share one
 * neutral grey string rendered only inside the create form, so an error such as
 * "ช่วงโปรโมชั่นซ้อนกับรายการที่เผยแพร่แล้ว" read like a normal notice and row
 * buttons reported far away from the row. Each area now keeps its own message
 * with a tone.
 */
export type ActionMessage = { type: "success" | "error"; text: string };

export const toActionMessage = (error: string | undefined, successText: string): ActionMessage =>
  error ? { type: "error", text: error } : { type: "success", text: successText };

/** Boxed message for a form or section (light + dark). */
export const ACTION_MESSAGE_BOX_CLASS: Record<ActionMessage["type"], string> = {
  success:
    "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  error:
    "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-300",
};

/** Compact message under a table row's buttons (light + dark). */
export const ACTION_MESSAGE_INLINE_CLASS: Record<ActionMessage["type"], string> = {
  success: "mt-1 text-xs text-emerald-600 dark:text-emerald-300",
  error: "mt-1 text-xs text-red-500 dark:text-red-300",
};

/** Screen-reader role: errors interrupt, success is announced politely. */
export const actionMessageRole = (message: ActionMessage): "alert" | "status" =>
  message.type === "error" ? "alert" : "status";

/** Shared label style for the pricing forms (light + dark). */
export const PRICING_LABEL_CLASS = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300";
