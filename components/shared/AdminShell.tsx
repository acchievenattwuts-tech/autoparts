"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { AlertTriangle, Menu } from "lucide-react";

import AdminSidebar from "@/components/shared/AdminSidebar";
import AdminThemeProvider, { useAdminTheme } from "@/components/shared/AdminThemeProvider";
import AdminThemeToggle from "@/components/shared/AdminThemeToggle";
import AdminUserMenu from "@/components/shared/AdminUserMenu";
import TabsBar from "@/components/shared/TabsBar";
import type { AdminTheme } from "@/lib/admin-theme";
import { cn } from "@/lib/utils";

type AdminShellProps = {
  children: ReactNode;
  initialTheme: AdminTheme;
  permissions: string[];
  mustChangePassword: boolean;
  userId: string;
  username?: string;
};

type AdminShellContentProps = Omit<AdminShellProps, "initialTheme" | "userId">;

const AdminShellContent = ({ children, permissions, mustChangePassword, username }: AdminShellContentProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme } = useAdminTheme();

  return (
    <div
      data-admin-theme={theme}
      className={cn(
        "admin-theme-root flex h-screen overflow-hidden bg-gray-100 font-sarabun text-gray-900 transition-colors dark:bg-[#0b1220] dark:text-slate-100",
        theme === "dark" && "dark",
      )}
    >
      <div
        className={`hidden flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out lg:flex ${
          sidebarOpen ? "w-64" : "w-0"
        }`}
      >
        <AdminSidebar permissions={permissions} />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-50">
            <AdminSidebar permissions={permissions} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#0f172a]">
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-white/10"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <AdminThemeToggle />
            <AdminUserMenu username={username} />
          </div>
        </header>

        <TabsBar />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {mustChangePassword && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">ควรเปลี่ยนรหัสผ่านก่อนใช้งานต่อ</p>
                <p className="mt-1 text-amber-800 dark:text-amber-200/90">
                  ไปที่เมนูเปลี่ยนรหัสผ่านเพื่ออัปเดตรหัสผ่านของคุณ
                </p>
              </div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
};

const AdminShell = ({ children, initialTheme, permissions, mustChangePassword, userId, username }: AdminShellProps) => {
  return (
    <AdminThemeProvider initialTheme={initialTheme} userId={userId}>
      <AdminShellContent permissions={permissions} mustChangePassword={mustChangePassword} username={username}>
        {children}
      </AdminShellContent>
    </AdminThemeProvider>
  );
};

export default AdminShell;
