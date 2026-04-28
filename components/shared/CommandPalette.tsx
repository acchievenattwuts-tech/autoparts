"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  ArrowRight,
  ClipboardList,
  Compass,
  History,
  Loader2,
  PackageSearch,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";

import { useAdminTheme } from "@/components/shared/AdminThemeProvider";
import { useQuickSearchStore } from "@/lib/quick-search-store";
import {
  COMMAND_GROUP_LABEL,
  QUICK_COMMANDS,
  filterCommandsByPermission,
  type CommandGroupKey,
  type QuickCommand,
} from "@/lib/quick-search-commands";
import { getPlatformShortcutLabel } from "@/hooks/useGlobalShortcut";

type ResultItem = {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

type ResultGroup = {
  key: string;
  label: string;
  items: ResultItem[];
};

type RecentEntry = {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  groupKey: string;
};

type CommandPaletteProps = {
  role: string;
  permissions: readonly string[];
  userId: string;
};

const DEBOUNCE_MS = 200;
const MAX_RECENTS = 5;
const MAX_CACHE_ENTRIES = 30;

const recentsStorageKey = (userId: string) => `quick-search-recent:${userId}`;

const readRecents = (userId: string): RecentEntry[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(recentsStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECENTS) as RecentEntry[];
  } catch {
    return [];
  }
};

const writeRecents = (userId: string, items: RecentEntry[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      recentsStorageKey(userId),
      JSON.stringify(items.slice(0, MAX_RECENTS)),
    );
  } catch {
    /* ignore storage errors (private mode etc.) */
  }
};

const groupIcon = (key: string) => {
  if (key === "products") return PackageSearch;
  if (key === "create") return Sparkles;
  if (key === "navigate") return Compass;
  if (key === "personal") return Settings;
  return ClipboardList;
};

const normalizeCommandSearch = (value: string) => value.replace(/^[>#]\s*/, "").trim().toLowerCase();

const CommandPalette = ({ role, permissions, userId }: CommandPaletteProps) => {
  const router = useRouter();
  const isOpen = useQuickSearchStore((s) => s.isOpen);
  const close = useQuickSearchStore((s) => s.close);
  const { toggleTheme } = useAdminTheme();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [groups, setGroups] = useState<ResultGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [shortcutLabel, setShortcutLabel] = useState("Ctrl+K");

  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, ResultGroup[]>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allowedCommands = useMemo<QuickCommand[]>(
    () => filterCommandsByPermission(QUICK_COMMANDS, role, permissions),
    [role, permissions],
  );

  // Capture focus + load recents when opening; restore focus on close
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = (document.activeElement as HTMLElement | null) ?? null;
      setRecents(readRecents(userId));
      setShortcutLabel(getPlatformShortcutLabel("k"));
    } else {
      setQuery("");
      setDebouncedQuery("");
      setGroups([]);
      setIsLoading(false);
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = null;
      const target = previouslyFocusedRef.current;
      if (target && document.contains(target)) {
        // defer to after cmdk unmount
        setTimeout(() => target.focus({ preventScroll: true }), 0);
      }
    }
  }, [isOpen, userId]);

  // Debounce query
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const isCommandMode = query.startsWith(">");
  const isDocOnlyMode = query.startsWith("#");
  const searchValue = (() => {
    if (isCommandMode || isDocOnlyMode) return debouncedQuery.slice(1).trim();
    return debouncedQuery;
  })();

  // Fetch results
  useEffect(() => {
    if (!isOpen) return;
    if (isCommandMode) {
      setGroups([]);
      setIsLoading(false);
      return;
    }
    if (searchValue.length < 1) {
      setGroups([]);
      setIsLoading(false);
      return;
    }

    const cacheKey = `${isDocOnlyMode ? "docs:" : "all:"}${searchValue.toLowerCase()}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setGroups(cached);
      setIsLoading(false);
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    const params = new URLSearchParams({ q: searchValue });
    if (isDocOnlyMode) params.set("scope", "docs");

    fetch(`/api/admin/quick-search?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { groups: ResultGroup[] };
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        const result = data.groups ?? [];
        if (cacheRef.current.size >= MAX_CACHE_ENTRIES) {
          const firstKey = cacheRef.current.keys().next().value;
          if (firstKey) cacheRef.current.delete(firstKey);
        }
        cacheRef.current.set(cacheKey, result);
        setGroups(result);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGroups([]);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery, isCommandMode, isDocOnlyMode, isOpen, searchValue]);

  const pushRecent = useCallback(
    (item: RecentEntry) => {
      setRecents((prev) => {
        const filtered = prev.filter((entry) => entry.id !== item.id);
        const next = [item, ...filtered].slice(0, MAX_RECENTS);
        writeRecents(userId, next);
        return next;
      });
    },
    [userId],
  );

  const navigateTo = useCallback(
    (href: string, recent?: RecentEntry) => {
      if (recent) pushRecent(recent);
      close();
      router.push(href);
    },
    [close, pushRecent, router],
  );

  const runCommand = useCallback(
    (cmd: QuickCommand) => {
      if (cmd.action === "logout") {
        close();
        void signOut({ redirect: true, callbackUrl: "/admin/login" });
        return;
      }
      if (cmd.action === "toggle-theme") {
        toggleTheme();
        close();
        return;
      }
      if (cmd.href) navigateTo(cmd.href);
    },
    [close, navigateTo, toggleTheme],
  );

  const groupedCommands = useMemo(() => {
    const map: Partial<Record<CommandGroupKey, QuickCommand[]>> = {};
    for (const cmd of allowedCommands) {
      (map[cmd.group] ??= []).push(cmd);
    }
    return map;
  }, [allowedCommands]);

  // Empty state condition
  const hasResults = groups.length > 0;
  const showRecents = !isCommandMode && searchValue.length === 0 && recents.length > 0;
  const showEmpty =
    !isCommandMode &&
    !showRecents &&
    !isLoading &&
    searchValue.length > 0 &&
    !hasResults;

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ค้นหาด่วน"
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[10vh] sm:pt-[15vh]"
    >
      <button
        type="button"
        aria-label="ปิด"
        onClick={close}
        className="absolute inset-0 animate-in fade-in bg-slate-950/40 backdrop-blur-sm duration-150 dark:bg-slate-950/60"
      />

      <Command
        label="ค้นหาด่วน"
        shouldFilter={isCommandMode}
        filter={(value, search) => {
          const normalizedSearch = normalizeCommandSearch(search);
          if (!normalizedSearch) return 1;
          return normalizeCommandSearch(value).includes(normalizedSearch) ? 1 : 0;
        }}
        className="relative z-10 w-full max-w-2xl animate-in fade-in zoom-in-95 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl ring-1 ring-black/5 duration-200 dark:border-white/10 dark:bg-[#0f172a] dark:ring-white/10"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      >
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-white/10">
          <Search size={18} className="shrink-0 text-gray-400 dark:text-slate-400" />
          <Command.Input
            autoFocus
            placeholder='ค้นหาเอกสาร / สินค้า / ลูกค้า — พิมพ์ ">" สำหรับคำสั่ง, "#" เพื่อค้นเฉพาะเลขเอกสาร'
            value={query}
            onValueChange={setQuery}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {isLoading && (
            <Loader2 size={16} className="shrink-0 animate-spin text-gray-400 dark:text-slate-500" />
          )}
          <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 sm:inline-block dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
            Esc
          </kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          {isCommandMode && (
            <Command.Empty className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
              {`\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a "${searchValue}"`}
            </Command.Empty>
          )}
          {false && isCommandMode && (
            <Command.Empty className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
              à¹„à¸¡à¹ˆà¸žà¸šà¸„à¸³à¸ªà¸±à¹ˆà¸‡à¸ªà¸³à¸«à¸£à¸±à¸š &quot;{searchValue}&quot;
            </Command.Empty>
          )}
          {showEmpty && (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
              {`\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1c\u0e25\u0e25\u0e31\u0e1e\u0e18\u0e4c\u0e2a\u0e33\u0e2b\u0e23\u0e31\u0e1a "${searchValue}"`}
            </div>
          )}
          {false && showEmpty && (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
              ไม่พบผลลัพธ์สำหรับ &quot;{searchValue}&quot;
            </div>
          )}

          {showRecents && (
            <Command.Group
              heading={
                <span className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                  <History size={12} /> ล่าสุด
                </span>
              }
            >
              {recents.map((item) => (
                <Command.Item
                  key={item.id}
                  value={`recent-${item.id}-${item.label}`}
                  onSelect={() => navigateTo(item.href, item)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 aria-selected:bg-sky-50 aria-selected:text-sky-900 dark:text-slate-200 dark:aria-selected:bg-sky-500/10 dark:aria-selected:text-sky-200"
                >
                  <History size={14} className="shrink-0 text-gray-400 dark:text-slate-500" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.sublabel && (
                    <span className="hidden truncate text-xs text-gray-500 sm:inline dark:text-slate-400">
                      {item.sublabel}
                    </span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {isCommandMode &&
            (Object.keys(groupedCommands) as CommandGroupKey[]).map((groupKey) => {
              const list = groupedCommands[groupKey];
              if (!list || list.length === 0) return null;
              const Icon = groupIcon(groupKey);
              return (
                <Command.Group
                  key={groupKey}
                  heading={
                    <span className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      <Icon size={12} /> {COMMAND_GROUP_LABEL[groupKey]}
                    </span>
                  }
                >
                  {list.map((cmd) => (
                    <Command.Item
                      key={cmd.id}
                      value={`${cmd.label} ${cmd.keywords ?? ""}`}
                      onSelect={() => runCommand(cmd)}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 aria-selected:bg-sky-50 aria-selected:text-sky-900 dark:text-slate-200 dark:aria-selected:bg-sky-500/10 dark:aria-selected:text-sky-200"
                    >
                      <ArrowRight size={14} className="shrink-0 text-gray-400 dark:text-slate-500" />
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.sublabel && (
                        <span className="hidden truncate text-xs text-gray-500 sm:inline dark:text-slate-400">
                          {cmd.sublabel}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}

          {!isCommandMode &&
            hasResults &&
            groups.map((group) => {
              const Icon = groupIcon(group.key);
              return (
                <Command.Group
                  key={group.key}
                  heading={
                    <span className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                      <Icon size={12} /> {group.label}
                    </span>
                  }
                >
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.id} ${item.label} ${item.sublabel ?? ""}`}
                      onSelect={() =>
                        navigateTo(item.href, {
                          id: item.id,
                          label: item.label,
                          sublabel: item.sublabel,
                          href: item.href,
                          groupKey: group.key,
                        })
                      }
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 aria-selected:bg-sky-50 aria-selected:text-sky-900 dark:text-slate-200 dark:aria-selected:bg-sky-500/10 dark:aria-selected:text-sky-200"
                    >
                      <ArrowRight size={14} className="shrink-0 text-gray-400 dark:text-slate-500" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="hidden max-w-[40%] truncate text-xs text-gray-500 sm:inline dark:text-slate-400">
                          {item.sublabel}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}

          {!isCommandMode && !hasResults && !showRecents && !showEmpty && !isLoading && (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
              พิมพ์เพื่อค้นหา · ขึ้นต้นด้วย <kbd className="rounded bg-gray-100 px-1 dark:bg-white/10">&gt;</kbd> สำหรับคำสั่ง · <kbd className="rounded bg-gray-100 px-1 dark:bg-white/10">#</kbd> สำหรับเลขเอกสาร
            </div>
          )}
        </Command.List>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-4 py-2 text-[11px] text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
          <span className="flex items-center gap-3">
            <span><kbd className="rounded bg-white px-1.5 py-0.5 shadow-sm dark:bg-slate-900">↑↓</kbd> เลื่อน</span>
            <span><kbd className="rounded bg-white px-1.5 py-0.5 shadow-sm dark:bg-slate-900">⏎</kbd> เลือก</span>
            <span><kbd className="rounded bg-white px-1.5 py-0.5 shadow-sm dark:bg-slate-900">Esc</kbd> ปิด</span>
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <kbd className="rounded bg-white px-1.5 py-0.5 shadow-sm dark:bg-slate-900">{shortcutLabel}</kbd>
            เปิดได้จากทุกหน้า
          </span>
        </div>
      </Command>
    </div>
  );
};

export default CommandPalette;
