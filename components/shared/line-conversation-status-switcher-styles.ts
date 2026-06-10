export function getLineConversationDropdownClassName() {
  return [
    "absolute left-0 top-full z-30 mt-1 min-w-[10rem] overflow-hidden rounded-lg border",
    "border-slate-200/90 bg-white/98 shadow-xl backdrop-blur-sm",
    "dark:border-slate-700 dark:bg-slate-950 dark:shadow-2xl",
  ].join(" ");
}

export function getLineConversationMenuItemClassName(isCurrent: boolean) {
  return [
    "flex w-full flex-col items-start px-3 py-2 text-left text-xs font-medium transition-colors",
    isCurrent
      ? "bg-slate-50 text-slate-950 dark:bg-white/5 dark:text-slate-100"
      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5",
  ].join(" ");
}

export function getLineConversationCurrentBadgeClassName() {
  return "mt-1 text-[11px] font-semibold text-sky-600 dark:text-sky-300";
}
