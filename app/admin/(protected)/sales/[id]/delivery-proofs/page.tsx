export const dynamic = "force-dynamic";

import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";

const DELIVERY_PROOFS_PAGE_SIZE = 50;

const parsePage = (value?: string) => {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) return 1;
  return page;
};

const buildPageHref = (saleId: string, page: number) =>
  page <= 1
    ? `/admin/sales/${saleId}/delivery-proofs`
    : `/admin/sales/${saleId}/delivery-proofs?page=${page}`;

const DeliveryProofsPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) => {
  await requirePermission("sales.view");

  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = parsePage(pageParam);
  const skip = (currentPage - 1) * DELIVERY_PROOFS_PAGE_SIZE;

  const [sale, proofs] = await Promise.all([
    db.sale.findUnique({
      where: { id },
      select: {
        id:              true,
        saleNo:          true,
        customerName:    true,
        fulfillmentType: true,
        customer:        { select: { name: true } },
        _count:          { select: { deliveryProofs: true } },
      },
    }),
    db.deliveryProof.findMany({
      where: { saleId: id },
      orderBy: { capturedAt: "desc" },
      skip,
      take: DELIVERY_PROOFS_PAGE_SIZE,
      select: {
        id:                true,
        receiverName:      true,
        signatureImageUrl: true,
        deliveryPhotoUrl:  true,
        note:              true,
        capturedAt:        true,
        capturedByUser:    { select: { name: true } },
      },
    }),
  ]);

  if (!sale || sale.fulfillmentType !== "DELIVERY") notFound();

  const totalProofs = sale._count.deliveryProofs;
  const totalPages = Math.max(1, Math.ceil(totalProofs / DELIVERY_PROOFS_PAGE_SIZE));
  const customerName = sale.customer?.name ?? sale.customerName ?? "-";

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-4 flex items-center gap-2">
          <Link
            href={`/admin/sales/${sale.id}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
          >
            <ChevronLeft size={16} /> กลับไปใบขาย
          </Link>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-300">
                {sale.saleNo}
              </p>
              <h1 className="mt-1 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
                หลักฐานการส่งทั้งหมด
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                {customerName}
              </p>
            </div>
            <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-slate-200">
              {totalProofs.toLocaleString("th-TH")} รายการ
            </div>
          </div>
        </div>
      </div>

      {proofs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-slate-900 dark:text-slate-400">
          ไม่พบหลักฐานการส่งในหน้านี้
        </div>
      ) : (
        <div className="space-y-4">
          {proofs.map((proof) => {
            const signatureImageSrc = toPublicStorageCdnPath(proof.signatureImageUrl) ?? proof.signatureImageUrl ?? "";
            const deliveryPhotoSrc = toPublicStorageCdnPath(proof.deliveryPhotoUrl) ?? proof.deliveryPhotoUrl ?? "";

            return (
            <article
              key={proof.id}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                    {proof.receiverName ? `ผู้รับ: ${proof.receiverName}` : "ไม่ได้ระบุชื่อผู้รับ"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    บันทึกโดย {proof.capturedByUser?.name ?? "-"} · {formatDateThai(proof.capturedAt)}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {proof.signatureImageUrl ? (
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                      ลายเซ็นผู้รับ
                    </p>
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <Image
                        src={signatureImageSrc}
                        alt="ลายเซ็นผู้รับ"
                        width={640}
                        height={256}
                        loading="lazy"
                        className="h-32 w-full object-contain"
                        sizes="(max-width: 768px) 100vw, 50vw"
                      />
                    </div>
                  </div>
                ) : null}

                {proof.deliveryPhotoUrl ? (
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-500 dark:text-slate-400">
                      รูปหลักฐานการส่ง
                    </p>
                    <a
                      href={deliveryPhotoSrc}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-xl border border-gray-200 bg-white"
                    >
                      <Image
                        src={deliveryPhotoSrc}
                        alt="รูปหลักฐานการส่ง"
                        width={1200}
                        height={900}
                        loading="lazy"
                        className="max-h-72 w-full object-cover"
                        sizes="(max-width: 768px) 100vw, 50vw"
                      />
                    </a>
                  </div>
                ) : null}
              </div>

              {proof.note ? (
                <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-white/5 dark:text-slate-200">
                  {proof.note}
                </p>
              ) : null}
            </article>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-900">
        <span className="text-gray-500 dark:text-slate-400">
          หน้า {currentPage.toLocaleString("th-TH")} จาก {totalPages.toLocaleString("th-TH")}
        </span>
        <div className="flex items-center gap-2">
          {currentPage > 1 ? (
            <Link
              href={buildPageHref(sale.id, currentPage - 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            >
              ก่อนหน้า
            </Link>
          ) : null}
          {currentPage < totalPages ? (
            <Link
              href={buildPageHref(sale.id, currentPage + 1)}
              className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 font-medium text-white hover:bg-[#162d4a] dark:bg-sky-600 dark:hover:bg-sky-500"
            >
              ถัดไป
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default DeliveryProofsPage;
