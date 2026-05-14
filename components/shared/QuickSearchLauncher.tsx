"use client";

import dynamic from "next/dynamic";
import { useCallback, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";

import { getPlatformShortcutLabel, useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { useQuickSearchStore } from "@/lib/quick-search-store";

const CommandPalette = dynamic(
  () => import("@/components/shared/CommandPalette"),
  { ssr: false },
);

const subscribe = () => () => {};

type QuickSearchLauncherProps = {
  role: string;
  permissions: readonly string[];
  userId: string;
};

const QuickSearchLauncher = ({ role, permissions, userId }: QuickSearchLauncherProps) => {
  const isOpen = useQuickSearchStore((s) => s.isOpen);
  const open = useQuickSearchStore((s) => s.open);
  const toggle = useQuickSearchStore((s) => s.toggle);
  const shortcut = useSyncExternalStore(
    subscribe,
    () => getPlatformShortcutLabel("k"),
    () => "Ctrl+K",
  );
  const [hasOpened, setHasOpened] = useState(false);

  const ensureOpened = useCallback(() => setHasOpened(true), []);
  const handleTrigger = useCallback(() => {
    ensureOpened();
    toggle();
  }, [ensureOpened, toggle]);
  const handleOpen = useCallback(() => {
    ensureOpened();
    open();
  }, [ensureOpened, open]);

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
        onClick={handleOpen}
        aria-label={`ค้นหา (${shortcut})`}
        title={`ค้นหา (${shortcut})`}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <Search size={16} />
        <span className="hidden sm:inline">ค้นหา</span>
        <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 md:inline-block dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
          {shortcut}
        </kbd>
      </button>
      {(hasOpened || isOpen) && (
        <CommandPalette role={role} permissions={permissions} userId={userId} />
      )}
    </>
  );
};

export default QuickSearchLauncher;
