import Link from "next/link";

import { ProfitSourceType } from "@/lib/generated/prisma";
import type { ProfitRevenueBasis } from "@/lib/profit-dashboard";

/**
 * Context ที่ทุก section ของ Profit Dashboard ใช้ร่วมกัน เก็บเลขหน้าของทุกตารางไว้
 * ด้วยกัน เพราะลิงก์แบ่งหน้าของตารางหนึ่งต้องพาเลขหน้าของตารางอื่นไปด้วย ไม่งั้น
 * กดเปลี่ยนหน้าตารางหนึ่งแล้วตารางที่เหลือจะเด้งกลับหน้า 1
 */
export type ProfitSectionContext = {
  from: string;
  to: string;
  basis: ProfitRevenueBasis;
  stockPage: number;
  customerPage: number;
  invoicePage: number;
  alertPage: number;
};

export type ProfitSectionPageKey = "stockPage" | "customerPage" | "invoicePage" | "alertPage";

export function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;

  return `${safeValue.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}
export function buildInvoiceHref(sourceType: ProfitSourceType, sourceId: string): string {
  if (sourceType === ProfitSourceType.SALE_RETURN) {
    return `/admin/credit-notes/${sourceId}`;
  }

  return `/admin/sales/${sourceId}`;
}

export function buildCustomerHref(customerId: string | null): string | null {
  if (!customerId) {
    return null;
  }

  return `/admin/customers/${customerId}`;
}

export function buildProductHref(productId: string | null): string | null {
  if (!productId) {
    return null;
  }

  return `/admin/products/${productId}/edit`;
}

export function buildSalesDrilldownHref(options: {
  from: string;
  to: string;
  customerId?: string | null;
  productId?: string | null;
}): string {
  const params = new URLSearchParams({
    from: options.from,
    to: options.to,
  });

  if (options.customerId) {
    params.set("customerId", options.customerId);
  }
  if (options.productId) {
    params.set("productId", options.productId);
  }

  return `/admin/sales?${params.toString()}`;
}

export function buildCreditNoteDrilldownHref(options: {
  from: string;
  to: string;
  customerId?: string | null;
  productId?: string | null;
}): string {
  const params = new URLSearchParams({
    from: options.from,
    to: options.to,
  });

  if (options.customerId) {
    params.set("customerId", options.customerId);
  }
  if (options.productId) {
    params.set("productId", options.productId);
  }

  return `/admin/credit-notes?${params.toString()}`;
}

export function getBasisLabel(basis: ProfitRevenueBasis): string {
  return basis === "inc_vat" ? "รวม VAT" : "ก่อน VAT";
}

export function getAlertSeverityLabel(severity: "high" | "medium" | "low"): string {
  if (severity === "high") return "สูง";
  if (severity === "medium") return "กลาง";
  return "ต่ำ";
}

export function parsePositivePage(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * ลิงก์แบ่งหน้าต้องชี้ `/admin/dashboard` ตรง ๆ — `/admin` เป็นหน้า redirect ไป
 * `/admin/workboard` และ `redirect()` ของ Next ไม่พา query string ไปด้วย เลขหน้าจึง
 * หายทั้งชุดและผู้ใช้เด้งไปกระดานงานวันนี้
 */
export function buildProfitDashboardHref(
  context: ProfitSectionContext,
  overrides?: Partial<Pick<ProfitSectionContext, ProfitSectionPageKey>>,
): string {
  const target = { ...context, ...overrides };
  const params = new URLSearchParams({
    tab: "profit",
    profitFrom: target.from,
    profitTo: target.to,
    profitBasis: target.basis,
  });

  if (target.stockPage > 1) {
    params.set("profitStockPage", String(target.stockPage));
  }
  if (target.customerPage > 1) {
    params.set("profitCustomerPage", String(target.customerPage));
  }
  if (target.invoicePage > 1) {
    params.set("profitInvoicePage", String(target.invoicePage));
  }
  if (target.alertPage > 1) {
    params.set("profitAlertPage", String(target.alertPage));
  }

  return `/admin/dashboard?${params.toString()}`;
}

export function getVisiblePages(currentPage: number, totalPages: number): number[] {
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  const pages: number[] = [];

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  return pages;
}
export function SectionPagination({
  currentPage,
  totalPages,
  buildHref,
}: {
  currentPage: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const visiblePages = getVisiblePages(currentPage, totalPages);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-white/10">
      <p className="text-xs text-gray-500">
        หน้า {currentPage} จาก {totalPages}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {currentPage > 1 ? (
          <Link
            href={buildHref(currentPage - 1)}
            scroll={false}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            ก่อนหน้า
          </Link>
        ) : null}
        {visiblePages[0] > 1 ? (
          <>
            <Link
              href={buildHref(1)}
              scroll={false}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              1
            </Link>
            {visiblePages[0] > 2 ? <span className="px-1 text-xs text-gray-400">...</span> : null}
          </>
        ) : null}
        {visiblePages.map((page) => (
          <Link
            key={page}
            href={buildHref(page)}
            scroll={false}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              page === currentPage
                ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-950"
                : "border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            }`}
          >
            {page}
          </Link>
        ))}
        {visiblePages[visiblePages.length - 1] < totalPages ? (
          <>
            {visiblePages[visiblePages.length - 1] < totalPages - 1 ? (
              <span className="px-1 text-xs text-gray-400">...</span>
            ) : null}
            <Link
              href={buildHref(totalPages)}
              scroll={false}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
            >
              {totalPages}
            </Link>
          </>
        ) : null}
        {currentPage < totalPages ? (
          <Link
            href={buildHref(currentPage + 1)}
            scroll={false}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
          >
            ถัดไป
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Fallback ของ <Suspense> รอบแต่ละ section ให้ตารางที่กำลังเปลี่ยนหน้าขึ้น skeleton
 * เฉพาะตัวมันเอง ส่วนที่เหลือของ dashboard ยังอยู่ครบ
 */
export function ProfitSectionSkeleton({
  rows = 5,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <section
      aria-busy="true"
      className={`animate-pulse rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80 ${className}`}
    >
      <div className="mb-4 h-6 w-56 rounded-lg bg-gray-100 dark:bg-white/10" />
      <div className="mb-3 h-16 rounded-2xl bg-gray-50 dark:bg-white/5" />
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div key={`skeleton-row-${index}`} className="h-10 rounded-xl bg-gray-50 dark:bg-white/5" />
        ))}
      </div>
    </section>
  );
}
