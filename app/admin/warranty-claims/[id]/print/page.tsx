export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";

import AutoPrint from "@/components/shared/AutoPrint";
import WarrantyClaimPrintDocument from "@/app/admin/_components/WarrantyClaimPrintDocument";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import PrintButton from "./PrintButton";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "รอส่งเคลม",
  SENT_TO_SUPPLIER: "ส่งซัพพลายเออร์แล้ว",
  CLOSED: "ปิดเคลม",
  RETURNED_TO_CUSTOMER: "ส่งคืนลูกค้าแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
};

const CLAIM_TYPE_LABEL: Record<string, string> = {
  REPLACE_NOW: "เปลี่ยนของให้ทันที",
  CUSTOMER_WAIT: "ลูกค้ารอเคลม",
};

const OUTCOME_LABEL: Record<string, string> = {
  RECEIVED: "ได้รับสินค้ากลับ",
  NO_RESOLUTION: "ไม่ได้รับการแก้ไข",
};

const PrintClaimPage = async ({ params, searchParams }: Props) => {
  await requirePermission("warranty_claims.view");

  const { id } = await params;
  const { print: autoPrint } = await searchParams;

  const [claim, config] = await Promise.all([
    db.warrantyClaim.findUnique({
      where: { id },
      include: {
        warranty: {
          select: {
            lotNo: true,
            unitSeq: true,
            warrantyDays: true,
            startDate: true,
            endDate: true,
            product: { select: { code: true, name: true } },
            sale: { select: { saleNo: true, saleDate: true, customerName: true, customerPhone: true } },
          },
        },
      },
    }),
    getSiteConfig(),
  ]);

  if (!claim) notFound();
  return (
    <>
      <style>{`
        @page { margin: 0; }
        @media print {
          .no-print { display: none !important; }
          .claim-form, .claim-form * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .claim-form {
            width: 100%;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }
          .claim-footer { margin-top: auto; }
        }
        @media screen {
          body { background: #f3f4f6; }
          .claim-form {
            max-width: 900px;
            margin: 24px auto;
            background: white;
            padding: 32px;
            border-radius: 8px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.1);
          }
        }
      `}</style>

      <div className="no-print mb-6 flex items-center gap-3">
        <Link
          href={`/admin/warranty-claims/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ChevronLeft size={16} /> กลับ
        </Link>
        <PrintButton />
      </div>

      {autoPrint === "1" ? (
        <Suspense fallback={null}>
          <AutoPrint />
        </Suspense>
      ) : null}

      <WarrantyClaimPrintDocument
        claim={claim}
        shopConfig={config}
        statusLabel={STATUS_LABEL}
        claimTypeLabel={CLAIM_TYPE_LABEL}
        outcomeLabel={OUTCOME_LABEL}
        rootClassName="claim-form mx-auto bg-white p-8 text-[13px] leading-snug"
      />
    </>
  );
};

export default PrintClaimPage;
