export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Images, Info } from "lucide-react";

import PaymentSlipGallery from "@/components/shared/PaymentSlipGallery";
import PaymentSlipGalleryFilterBar from "@/components/shared/PaymentSlipGalleryFilterBar";
import {
  fetchPaymentSlipGalleryPage,
  getPaymentSlipGallerySummary,
  listPaymentSlipBanks,
  normalizeGalleryStatus,
  type PaymentSlipGalleryFilters,
} from "@/lib/line-payment-slip-gallery";
import { requirePermission } from "@/lib/require-auth";
import { loadMorePaymentSlipGalleryAction } from "./actions";

type PageProps = {
  searchParams: Promise<{
    from?: string;
    to?: string;
    status?: string;
    bank?: string;
    sender?: string;
    reference?: string;
    amount?: string;
  }>;
};

export default async function LinePaymentSlipGalleryPage({ searchParams }: PageProps) {
  await requirePermission("line_payment_slips.view");
  const params = await searchParams;

  const amountValue = params.amount ? Number(params.amount) : NaN;
  const filters: PaymentSlipGalleryFilters = {
    from: params.from?.trim() || null,
    to: params.to?.trim() || null,
    status: normalizeGalleryStatus(params.status),
    bank: params.bank?.trim() || null,
    sender: params.sender?.trim() || null,
    reference: params.reference?.trim() || null,
    amount: Number.isFinite(amountValue) ? amountValue : null,
  };

  const [firstPage, summary, banks] = await Promise.all([
    fetchPaymentSlipGalleryPage(filters, 0),
    getPaymentSlipGallerySummary(filters),
    listPaymentSlipBanks(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/line-payment-slips"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <ArrowLeft size={16} /> กลับไปรายการสลิป
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-sky-500/10 dark:text-sky-200">
          <Images size={21} />
        </div>
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            แกลเลอรีสลิปการชำระเงิน
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            ดูสลิปย้อนหลังตามวัน/สถานะ/ธนาคาร — คลิกที่รูปเพื่อดูขนาดเต็มและเลื่อนดูทีละรายการ
          </p>
        </div>
      </div>

      <PaymentSlipGalleryFilterBar
        banks={banks}
        current={{
          from: filters.from ?? "",
          to: filters.to ?? "",
          status: filters.status ?? "",
          bank: filters.bank ?? "",
          sender: filters.sender ?? "",
          reference: filters.reference ?? "",
          amount: filters.amount !== null ? String(filters.amount) : "",
        }}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-950/70">
        <span className="text-gray-500 dark:text-slate-400">
          พบ <span className="font-semibold text-gray-900 dark:text-slate-100">{summary.count.toLocaleString("th-TH")}</span> สลิป
        </span>
        <span className="text-gray-500 dark:text-slate-400">
          รวม{" "}
          <span className="font-kanit font-bold text-gray-900 dark:text-slate-100">
            ฿{summary.totalAmount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </span>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>
          วันที่อ้างอิงใช้ <span className="font-semibold">วันเวลาโอนจากสลิป</span> เป็นหลัก — หาก OCR
          อ่านไม่ได้จะใช้วันที่ระบบรับสลิปแทน และทำเครื่องหมาย <span className="font-semibold">*</span> ไว้
        </p>
      </div>

      <PaymentSlipGallery
        initialItems={firstPage.items}
        initialHasMore={firstPage.hasMore}
        initialNextSkip={firstPage.nextSkip}
        filters={filters}
        loadMore={loadMorePaymentSlipGalleryAction}
      />
    </div>
  );
}
