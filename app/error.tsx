"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Catches a render/data error anywhere under the root layout that no closer
 * boundary handled. Keeps the layout (nav, footer) mounted and offers a retry,
 * instead of the framework's bare error screen.
 *
 * `error.message` is deliberately not rendered: in production Next replaces it
 * with a digest, and in development it can carry query text or connection
 * details that do not belong on a customer's screen (.rules §7).
 */
const RootError = ({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) => {
  useEffect(() => {
    // Server-side logging is the only place the real cause is safe to keep.
    console.error("[storefront] unhandled render error", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className="font-kanit text-2xl font-semibold text-slate-800">
        ระบบขัดข้องชั่วคราว
      </h1>

      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-500">
        ขออภัยครับ เกิดข้อผิดพลาดระหว่างโหลดหน้านี้
        กรุณาลองใหม่อีกครั้ง หากยังไม่หายรบกวนติดต่อแอดมินได้เลย
      </p>

      {error.digest ? (
        // The digest is the only handle that ties a customer report to the
        // server log, so it is worth showing — it carries no detail itself.
        <p className="mt-2 font-mono text-xs text-slate-400">
          รหัสอ้างอิง: {error.digest}
        </p>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-[#f97316] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#ea580c]"
        >
          ลองใหม่อีกครั้ง
        </button>
        <Link
          href="/"
          className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          กลับหน้าแรก
        </Link>
      </div>
    </main>
  );
};

export default RootError;
