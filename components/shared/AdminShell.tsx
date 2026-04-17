"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { Menu, LogOut, AlertTriangle, UserCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import AdminSidebar from "@/components/shared/AdminSidebar";
import TabsBar from "@/components/shared/TabsBar";
import { useTabStore } from "@/hooks/useTabStore";

type AdminShellProps = {
  children: ReactNode;
  permissions: string[];
  mustChangePassword: boolean;
  username?: string;
};

const AdminShell = ({ children, permissions, mustChangePassword, username }: AdminShellProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const router = useRouter();
  const clearAll = useTabStore((state) => state.clearAll);

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    clearAll();

    try {
      const result = await signOut({
        redirect: false,
        callbackUrl: "/admin/login",
      });

      router.replace(result?.url ?? "/admin/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 font-sarabun">
      {/* Desktop sidebar — inline, default hidden, toggles with transition */}
      <div
        className={`hidden flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out lg:flex ${
          sidebarOpen ? "w-64" : "w-0"
        }`}
      >
        <AdminSidebar permissions={permissions} />
      </div>

      {/* Mobile overlay */}
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
            onClick={() => setSidebarOpen((prev) => !prev)}
            className="rounded-lg p-2 hover:bg-gray-100"
          >
            <Menu size={20} />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            {username && (
              <div className="hidden sm:flex items-center gap-1.5 text-sm text-gray-600">
                <UserCircle size={16} className="text-gray-400" />
                <span>{username}</span>
              </div>
            )}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">
                {loggingOut ? "กำลังออกจากระบบ..." : "ออกจากระบบ"}
              </span>
            </button>
          </div>
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
