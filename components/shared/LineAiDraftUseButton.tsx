"use client";

type LineAiDraftUseButtonProps = {
  text: string;
};

export const LINE_AI_DRAFT_USE_EVENT = "line-ai-draft-use";

export default function LineAiDraftUseButton({ text }: LineAiDraftUseButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new CustomEvent(LINE_AI_DRAFT_USE_EVENT, { detail: { text } }));
      }}
      className="inline-flex h-8 items-center rounded-md border border-amber-200 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-400/30 dark:text-amber-200 dark:hover:bg-amber-500/10"
    >
      ใช้ข้อความนี้
    </button>
  );
}
