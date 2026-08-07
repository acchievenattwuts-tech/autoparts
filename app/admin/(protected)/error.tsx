"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for every protected admin page.
 *
 * It sits inside the admin layout, so the sidebar and header stay usable and
 * the operator can move to another menu instead of losing the whole shell —
 * which is what happened before, when an unhandled error fell through to the
 * framework's bare screen.
 *
 * The raw message is never shown. Admin errors routinely wrap Prisma output
 * that quotes table and column names, and .rules §7 keeps that off the client;
 * `digest` is the handle for matching a report to the server log.
 */
const AdminError = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  useEffect(() => {
    console.error("[admin] unhandled render error", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div
        role="alert"
        className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-gray-100 bg-white/95 px-6 py-7 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/80"
      >
        <p className="text-base font-semibold text-gray-800 dark:text-slate-100">
          เกิดข้อผิดพลาดในการโหลดหน้านี้
        </p>

        <p className="text-sm leading-relaxed text-gray-500 dark:text-slate-400">
          ระบบไม่สามารถแสดงข้อมูลได้ในขณะนี้ กรุณากดลองใหม่อีกครั้ง
          หากยังไม่หาย กรุณาแจ้งผู้ดูแลระบบพร้อมรหัสอ้างอิงด้านล่าง
        </p>

        {error.digest ? (
          <p className="font-mono text-xs text-gray-400 dark:text-slate-500">
            รหัสอ้างอิง: {error.digest}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-[#1e3a5f] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#16304e] dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            ลองใหม่อีกครั้ง
          </button>
          <Link
            href="/admin"
            className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AdminError;
