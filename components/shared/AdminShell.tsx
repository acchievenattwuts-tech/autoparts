"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Menu, LogOut, AlertTriangle } from "lucide-react";
import { signOut } from "next-auth/react";
import AdminSidebar from "@/components/shared/AdminSidebar";
import TabsBar from "@/components/shared/TabsBar";
import { useTabStore } from "@/hooks/useTabStore";

type AdminShellProps = {
  children: ReactNode;
  permissions: string[];
  mustChangePassword: boolean;
};

const AdminShell = ({ children, permissions, mustChangePassword }: AdminShellProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const clearAll = useTabStore((state) => state.clearAll);

  const handleLogout = () => {
    clearAll();
    signOut({ callbackUrl: "/admin/login" });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 font-sarabun">
      <div className="hidden flex-shrink-0 lg:flex">
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
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 hover:bg-gray-100 lg:hidden"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1 lg:flex-none" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">ออกจากระบบ</span>
          </button>
        </header>

        <TabsBar />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {mustChangePassword && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">ควรเปลี่ยนรหัสผ่านก่อนใช้งานต่อ</p>
                <p className="mt-1 text-amber-800">
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

export default AdminShell;
