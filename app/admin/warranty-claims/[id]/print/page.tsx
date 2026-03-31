export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import AutoPrint from "@/components/shared/AutoPrint";
import { ChevronLeft } from "lucide-react";
import PrintButton from "./PrintButton";

interface Props {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}

const PrintClaimPage = async ({ params, searchParams }: Props) => {
  await requirePermission("warranty_claims.view");

  const { id }   = await params;
  const { print: autoPrint } = await searchParams;

  const [claim, config] = await Promise.all([
    db.warrantyClaim.findUnique({
      where: { id },
      include: {
        warranty: {
          select: {
            unitSeq: true,
            warrantyDays: true,
            startDate: true,
            endDate: true,
            product: { select: { code: true, name: true } },
            sale:    { select: { saleNo: true, saleDate: true, customerName: true, customerPhone: true } },
          },
        },
      },
    }),
    getSiteConfig(),
  ]);

  if (!claim) notFound();

  const STATUS_LABEL: Record<string, string> = {
    DRAFT:             "รอส่งเคลม",
    SENT_TO_SUPPLIER:  "ส่งซัพพลายเออร์แล้ว",
    CLOSED:            "ปิดเคลม",
  };

  return (
    <div>
      {/* Screen-only controls */}
      <div className="print:hidden flex items-center gap-3 mb-6">
        <Link
          href={`/admin/warranty-claims/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> กลับ
        </Link>
        <PrintButton />
      </div>

      {autoPrint === "1" && (
        <Suspense fallback={null}><AutoPrint /></Suspense>
      )}

      {/* Print content */}
      <div className="bg-white p-8 max-w-2xl mx-auto print:max-w-none print:p-6 print:shadow-none border border-gray-200 print:border-0 rounded-xl shadow-sm">
        {/* Header */}
        <div className="text-center mb-6 border-b border-gray-200 pb-4">
          <h1 className="text-xl font-bold text-gray-900">{config.shopName}</h1>
          {config.shopAddress && <p className="text-xs text-gray-500 mt-1">{config.shopAddress}</p>}
          {config.shopPhone && <p className="text-xs text-gray-500">{config.shopPhone}</p>}
          <h2 className="text-lg font-bold mt-4 text-[#1e3a5f] uppercase tracking-wide">ใบเคลมสินค้า</h2>
        </div>

        {/* Claim meta */}
        <div className="grid grid-cols-2 gap-4 mb-5 text-sm">
          <div className="space-y-1">
            <div className="flex gap-2">
              <span className="text-gray-500 w-28 shrink-0">เลขที่ใบเคลม:</span>
              <span className="font-semibold text-gray-800">{claim.claimNo}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 w-28 shrink-0">วันที่:</span>
              <span className="text-gray-800">
                {new Date(claim.claimDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 w-28 shrink-0">สถานะ:</span>
              <span className="text-gray-800">{STATUS_LABEL[claim.status] ?? claim.status}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 w-28 shrink-0">ประเภท:</span>
              <span className="text-gray-800">
                {claim.claimType === "REPLACE_NOW" ? "เปลี่ยนของให้ทันที" : "ลูกค้ารอผลเคลม"}
              </span>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex gap-2">
              <span className="text-gray-500 w-28 shrink-0">ลูกค้า:</span>
              <span className="text-gray-800">{claim.warranty.sale.customerName ?? "—"}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 w-28 shrink-0">ใบขาย:</span>
              <span className="font-mono text-gray-800">{claim.warranty.sale.saleNo}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-gray-500 w-28 shrink-0">วันที่ขาย:</span>
              <span className="text-gray-800">
                {new Date(claim.warranty.sale.saleDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </span>
            </div>
          </div>
        </div>

        {/* Product info */}
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-5">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">ข้อมูลสินค้า</p>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-gray-400 text-xs mb-0.5">สินค้า</p>
              <p className="font-semibold text-gray-800">{claim.warranty.product.name}</p>
              <p className="text-xs text-gray-500">[{claim.warranty.product.code}]</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-0.5">ลำดับชิ้น</p>
              <p className="text-gray-700">#{claim.warranty.unitSeq}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-0.5">ระยะประกัน</p>
              <p className="text-gray-700">{claim.warranty.warrantyDays} วัน</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs mb-0.5">วันหมดประกัน</p>
              <p className="text-gray-700">
                {new Date(claim.warranty.endDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </p>
            </div>
            {claim.symptom && (
              <div className="col-span-2">
                <p className="text-gray-400 text-xs mb-0.5">อาการ / สาเหตุ</p>
                <p className="text-gray-800">{claim.symptom}</p>
              </div>
            )}
          </div>
        </div>

        {/* Supplier info */}
        {(claim.supplierName || claim.supplierPhone) && (
          <div className="border border-gray-200 rounded-lg overflow-hidden mb-5">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">ข้อมูลซัพพลายเออร์</p>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-400 text-xs mb-0.5">ชื่อ</p>
                <p className="text-gray-800">{claim.supplierName ?? "—"}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">เบอร์โทร</p>
                <p className="text-gray-800">{claim.supplierPhone ?? "—"}</p>
              </div>
              {claim.supplierAddress && (
                <div className="col-span-2">
                  <p className="text-gray-400 text-xs mb-0.5">ที่อยู่</p>
                  <p className="text-gray-800">{claim.supplierAddress}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Note */}
        {claim.note && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-5 text-sm">
            <p className="text-xs text-yellow-700 font-semibold mb-1">หมายเหตุ</p>
            <p className="text-yellow-800">{claim.note}</p>
          </div>
        )}

        {/* Signatures */}
        <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div className="text-center">
            <div className="border-b border-gray-300 mb-2 h-10" />
            <p className="text-gray-500 text-xs">ผู้รับเคลม / เจ้าหน้าที่ร้าน</p>
          </div>
          <div className="text-center">
            <div className="border-b border-gray-300 mb-2 h-10" />
            <p className="text-gray-500 text-xs">ลูกค้า</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrintClaimPage;
