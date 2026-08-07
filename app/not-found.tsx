import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ไม่พบหน้าที่ต้องการ",
  // A 404 must never be indexed, and Next does not add this for us.
  robots: { index: false, follow: false },
};

/**
 * Shown for any unmatched URL and for every explicit `notFound()` call that
 * has no closer not-found boundary — product and category pages included.
 *
 * Before this existed the site fell through to the framework's built-in 404:
 * an unstyled English page with no way back into the catalogue.
 */
const NotFound = () => {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-kanit text-6xl font-bold text-[#f97316]">404</p>

      <h1 className="mt-4 font-kanit text-2xl font-semibold text-slate-800">
        ไม่พบหน้าที่ต้องการ
      </h1>

      <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-500">
        หน้านี้อาจถูกย้าย เปลี่ยนชื่อ หรือลิงก์ที่เข้ามาไม่ถูกต้อง
        ลองค้นหาสินค้าที่ต้องการอีกครั้งได้เลยครับ
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/products"
          className="rounded-lg bg-[#f97316] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#ea580c]"
        >
          ดูสินค้าทั้งหมด
        </Link>
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

export default NotFound;
