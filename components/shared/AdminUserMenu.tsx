"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ChevronDown, KeyRound, LogOut, UserCircle } from "lucide-react";

import { useTabStore } from "@/hooks/useTabStore";
import { cn } from "@/lib/utils";

type AdminUserMenuProps = {
  username?: string;
};

const AdminUserMenu = ({ username }: AdminUserMenuProps) => {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const clearAll = useTabStore((state) => state.clearAll);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    clearAll();
    try {
      const result = await signOut({ redirect: false, callbackUrl: "/admin/login" });
      router.replace(result?.url ?? "/admin/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
          "text-gray-700 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-white/10",
          open && "bg-gray-100 dark:bg-white/10",
        )}
      >
        <UserCircle size={18} className="text-gray-400 dark:text-slate-400" />
        <span className="hidden max-w-[160px] truncate sm:inline">{username || "ผู้ใช้"}</span>
        <ChevronDown size={14} className="text-gray-400 dark:text-slate-500" />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border bg-white shadow-lg",
            "border-gray-200 dark:border-white/10 dark:bg-slate-900",
          )}
        >
          <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
            <p className="text-xs uppercase tracking-wider text-gray-400 dark:text-slate-500">
              เข้าสู่ระบบในชื่อ
            </p>
            <p className="mt-1 truncate text-sm font-medium text-gray-900 dark:text-slate-100">
              {username || "ผู้ใช้"}
            </p>
          </div>
          <div className="py-1">
            <Link
              href="/admin/profile/change-password"
              onClick={() => setOpen(false)}
              role="menuitem"
              className="flex items-center gap-3 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <KeyRound size={16} className="text-gray-400 dark:text-slate-400" />
              เปลี่ยนรหัสผ่าน
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              role="menuitem"
              className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              <LogOut size={16} />
              {loggingOut ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUserMenu;
