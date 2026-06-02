"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { AlertTriangle, Menu } from "lucide-react";

import AdminSidebar from "@/components/shared/AdminSidebar";
import AdminNotificationBell from "@/components/shared/AdminNotificationBell";
import AdminLineCustomerNotifications from "@/components/shared/AdminLineCustomerNotifications";
import AdminThemeProvider, { useAdminTheme } from "@/components/shared/AdminThemeProvider";
import AdminThemeToggle from "@/components/shared/AdminThemeToggle";
import AdminUserMenu from "@/components/shared/AdminUserMenu";
import QuickSearchLauncher from "@/components/shared/QuickSearchLauncher";
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
  role: string;
};

type AdminShellContentProps = Omit<AdminShellProps, "initialTheme">;

const hasPermission = (role: string, permissions: readonly string[], permission: string) =>
  role === "ADMIN" || permissions.includes(permission);

const AdminShellContent = ({ children, permissions, mustChangePassword, username, userId, role }: AdminShellContentProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme } = useAdminTheme();
  const canViewCustomerNotifications = hasPermission(role, permissions, "customers.view");
  const canUpdateCustomer = hasPermission(role, permissions, "customers.update");

  return (
    <div
      data-admin-theme={theme}
      className={cn(
        "admin-theme-root flex h-screen overflow-hidden bg-slate-100 font-sarabun text-slate-900 transition-colors dark:bg-[#08111f] dark:text-slate-100",
        theme === "dark" && "dark",
      )}
    >
      <div
        className={`hidden flex-shrink-0 overflow-hidden border-r border-slate-200/80 bg-slate-50 shadow-[0_0_0_1px_rgba(255,255,255,0.4)] transition-all duration-300 ease-in-out lg:flex dark:border-white/10 dark:bg-[#0b1424] dark:shadow-none ${
          sidebarOpen ? "w-72" : "w-0"
        }`}
      >
        <AdminSidebar permissions={permissions} />
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/55 backdrop-blur-[2px]" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-50 shadow-2xl shadow-slate-950/30">
            <AdminSidebar permissions={permissions} onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative z-20 flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-[#0d1728]/95 sm:px-4 lg:px-5">
          <button
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label="Toggle admin navigation"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200/70 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/15 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1" />
          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50 px-2 py-1 dark:border-white/10 dark:bg-white/5">
            <QuickSearchLauncher role={role} permissions={permissions} userId={userId} />
            <AdminNotificationBell userId={userId} />
            {canViewCustomerNotifications ? (
              <AdminLineCustomerNotifications userId={userId} canUpdateCustomer={canUpdateCustomer} />
            ) : null}
            <AdminThemeToggle />
            <AdminUserMenu username={username} />
          </div>
        </header>

        <TabsBar />

        <main className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 lg:px-6 lg:py-5">
          {mustChangePassword && (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
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

const AdminShell = ({ children, initialTheme, permissions, mustChangePassword, userId, username, role }: AdminShellProps) => {
  return (
    <AdminThemeProvider initialTheme={initialTheme} userId={userId}>
      <AdminShellContent
        permissions={permissions}
        mustChangePassword={mustChangePassword}
        username={username}
        userId={userId}
        role={role}
      >
        {children}
      </AdminShellContent>
    </AdminThemeProvider>
  );
};

export default AdminShell;
