import ProfitSectionPaginationClient, {
  type ProfitPaginationItem,
} from "@/app/admin/(protected)/ProfitSectionPaginationClient";
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

/**
 * ส่วน server ของแถบแบ่งหน้า: คำนวณ href ทุกปุ่มไว้ล่วงหน้าแล้วส่งเป็น array ให้
 * client component เพราะ buildHref เป็นฟังก์ชัน ส่งข้าม server/client boundary ไม่ได้
 */
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
  const firstVisible = visiblePages[0] ?? currentPage;
  const lastVisible = visiblePages[visiblePages.length - 1] ?? currentPage;
  const items: ProfitPaginationItem[] = [];

  if (firstVisible > 1) {
    items.push({ kind: "page", page: 1, href: buildHref(1) });
    if (firstVisible > 2) {
      items.push({ kind: "ellipsis" });
    }
  }

  for (const page of visiblePages) {
    items.push({ kind: "page", page, href: buildHref(page) });
  }

  if (lastVisible < totalPages) {
    if (lastVisible < totalPages - 1) {
      items.push({ kind: "ellipsis" });
    }
    items.push({ kind: "page", page: totalPages, href: buildHref(totalPages) });
  }

  return (
    <ProfitSectionPaginationClient
      currentPage={currentPage}
      totalPages={totalPages}
      items={items}
      prevHref={currentPage > 1 ? buildHref(currentPage - 1) : null}
      nextHref={currentPage < totalPages ? buildHref(currentPage + 1) : null}
    />
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
