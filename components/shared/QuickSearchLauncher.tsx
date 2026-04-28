"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";

import { useGlobalShortcut, getPlatformShortcutLabel } from "@/hooks/useGlobalShortcut";
import { useQuickSearchStore } from "@/lib/quick-search-store";

const CommandPalette = dynamic(
  () => import("@/components/shared/CommandPalette"),
  { ssr: false },
);

type QuickSearchLauncherProps = {
  role: string;
  permissions: readonly string[];
  userId: string;
};

const QuickSearchLauncher = ({ role, permissions, userId }: QuickSearchLauncherProps) => {
  const isOpen = useQuickSearchStore((s) => s.isOpen);
  const open = useQuickSearchStore((s) => s.open);
  const toggle = useQuickSearchStore((s) => s.toggle);
  const [shortcut, setShortcut] = useState("Ctrl+K");
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    setShortcut(getPlatformShortcutLabel("k"));
  }, []);

  useEffect(() => {
    if (isOpen) setHasOpened(true);
  }, [isOpen]);

  const handleTrigger = useCallback(() => toggle(), [toggle]);

  useGlobalShortcut({
    key: "k",
    withMod: true,
    force: true,
    onTrigger: handleTrigger,
  });

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={`ค้นหา (${shortcut})`}
        title={`ค้นหา (${shortcut})`}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Search size={16} />
        <span className="hidden sm:inline">ค้นหา</span>
        <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 sm:inline-block dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
          {shortcut}
        </kbd>
      </button>
      {hasOpened && (
        <CommandPalette role={role} permissions={permissions} userId={userId} />
      )}
    </>
  );
};

export default QuickSearchLauncher;
