export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft, Printer } from "lucide-react";
import { notFound } from "next/navigation";

import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import ClaimEditPanel from "./ClaimEditPanel";
import ClaimStatusActions from "./ClaimStatusActions";
import { formatDateThai } from "@/lib/th-date";

interface Props {
  params: Promise<{ id: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "รอส่งเคลม",
  SENT_TO_SUPPLIER: "ส่งซัพพลายเออร์แล้ว",
  CLOSED: "ปิดเคลม",
  RETURNED_TO_CUSTOMER: "ส่งคืนลูกค้าแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-700 border-yellow-200",
  SENT_TO_SUPPLIER: "bg-blue-100 text-blue-700 border-blue-200",
  CLOSED: "bg-green-100 text-green-700 border-green-200",
  RETURNED_TO_CUSTOMER: "bg-emerald-100 text-emerald-700 border-emerald-200",
  CANCELLED: "bg-red-100 text-red-500 border-red-200",
};

const ClaimDetailPage = async ({ params }: Props) => {
  await requirePermission("warranty_claims.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "warranty_claims.update");

  const { id } = await params;

  const [claim, suppliers, receivedStockCard] = await Promise.all([
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
            product: { select: { code: true, name: true, isLotControl: true } },
            sale: { select: { saleNo: true, customerName: true } },
          },
        },
        claimLots: {
          select: {
            id: true,
            lotNo: true,
            qty: true,
            direction: true,
          },
        },
      },
    }),
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, address: true },
    }),
    db.stockCard.findFirst({
      where: {
        referenceId: id,
        source: "CLAIM_RECV_IN",
      },
      select: {
        lotMovements: {
          select: {
            lotNo: true,
            qtyIn: true,
          },
          orderBy: { lotNo: "asc" },
        },
      },
    }),
  ]);

  if (!claim) notFound();

  const isEditable = claim.status === "DRAFT" || claim.status === "SENT_TO_SUPPLIER";
  const canManageStatus = claim.status !== "CANCELLED";
  const receivedLot = receivedStockCard?.lotMovements.find((lot) => Number(lot.qtyIn) > 0) ?? null;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <Link
          href="/admin/warranty-claims"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ChevronLeft size={16} /> ใบเคลมทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{claim.claimNo}</span>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">{claim.claimNo}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {formatDateThai(claim.claimDate)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex rounded-full border px-3 py-1.5 text-sm font-medium ${STATUS_COLOR[claim.status]}`}
          >
            {STATUS_LABEL[claim.status]}
          </span>
          {canUpdate && isEditable && (
            <ClaimEditPanel
              claimId={id}
              initialSymptom={claim.symptom ?? ""}
              initialNote={claim.note ?? ""}
              initialSupplierId={claim.supplierId ?? ""}
              initialSupplierName={claim.supplierName ?? ""}
              initialSupplierPhone={claim.supplierPhone ?? ""}
              initialSupplierAddress={claim.supplierAddress ?? ""}
              suppliers={suppliers}
            />
          )}
          <Link
            href={`/admin/warranty-claims/${id}/print?print=1`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
          >
            <Printer size={14} /> พิมพ์
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-kanit text-base font-semibold text-[#1e3a5f]">
              ข้อมูลสินค้า / ประกัน
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="mb-0.5 text-xs text-gray-400">สินค้า</p>
                <p className="font-medium text-gray-800">{claim.warranty.product.name}</p>
                <p className="text-xs text-gray-400">[{claim.warranty.product.code}]</p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">ลำดับชิ้น</p>
                <p className="font-medium text-gray-700">#{claim.warranty.unitSeq}</p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">Lot ต้นทาง</p>
                <p className="font-mono text-gray-700">{claim.warranty.lotNo ?? "—"}</p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">ใบขาย</p>
                <Link
                  href={`/admin/sales/${claim.warranty.sale.saleNo}`}
                  className="font-mono text-sm text-[#1e3a5f] hover:underline"
                >
                  {claim.warranty.sale.saleNo}
                </Link>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">ลูกค้า</p>
                <p className="text-gray-700">{claim.warranty.sale.customerName ?? "—"}</p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">ประกัน</p>
                <p className="text-gray-700">{claim.warranty.warrantyDays} วัน</p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">วันหมดประกัน</p>
                <p className="text-gray-700">
                  {formatDateThai(claim.warranty.endDate)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-kanit text-base font-semibold text-[#1e3a5f]">
              รายละเอียดการเคลม
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="mb-0.5 text-xs text-gray-400">ประเภทเคลม</p>
                <p className="font-medium text-gray-700">
                  {claim.claimType === "REPLACE_NOW" ? "เปลี่ยนของให้ทันที" : "ลูกค้ารอเคลม"}
                </p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">อาการ</p>
                <p className="text-gray-700">{claim.symptom ?? "—"}</p>
              </div>
              {claim.sentAt && (
                <div>
                  <p className="mb-0.5 text-xs text-gray-400">วันที่ส่งซัพพลายเออร์</p>
                  <p className="text-gray-700">
                    {formatDateThai(claim.sentAt)}
                  </p>
                </div>
              )}
              {claim.resolvedAt && (
                <div>
                  <p className="mb-0.5 text-xs text-gray-400">วันที่ปิดเคลม</p>
                  <p className="text-gray-700">
                    {formatDateThai(claim.resolvedAt)}
                  </p>
                </div>
              )}
              {claim.returnedAt && (
                <div>
                  <p className="mb-0.5 text-xs text-gray-400">วันที่ส่งคืนลูกค้า</p>
                  <p className="text-gray-700">
                    {formatDateThai(claim.returnedAt)}
                  </p>
                </div>
              )}
              {claim.outcome && (
                <div>
                  <p className="mb-0.5 text-xs text-gray-400">ผลลัพธ์</p>
                  <p className="font-medium text-gray-700">
                    {claim.outcome === "RECEIVED" ? "ได้รับสินค้าคืน" : "ไม่ได้รับการแก้ไข"}
                  </p>
                </div>
              )}
              {claim.warranty.product.isLotControl && receivedLot && (
                <div>
                  <p className="mb-0.5 text-xs text-gray-400">Lot ที่รับกลับตอนปิดเคลม</p>
                  <p className="font-mono text-gray-700">{receivedLot.lotNo}</p>
                </div>
              )}
              {claim.note && (
                <div className="col-span-2">
                  <p className="mb-0.5 text-xs text-gray-400">หมายเหตุ</p>
                  <p className="text-gray-700">{claim.note}</p>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-kanit text-base font-semibold text-[#1e3a5f]">
              ซัพพลายเออร์
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="mb-0.5 text-xs text-gray-400">ชื่อ</p>
                <p className="text-gray-700">{claim.supplierName ?? "—"}</p>
              </div>
              <div>
                <p className="mb-0.5 text-xs text-gray-400">เบอร์โทร</p>
                <p className="text-gray-700">{claim.supplierPhone ?? "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="mb-0.5 text-xs text-gray-400">ที่อยู่</p>
                <p className="text-gray-700">{claim.supplierAddress ?? "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {canUpdate && canManageStatus && (
          <div>
            <ClaimStatusActions
              claimId={id}
              claimNo={claim.claimNo}
              currentStatus={claim.status}
              claimType={claim.claimType}
              outcome={claim.outcome}
              isLotControl={claim.warranty.product.isLotControl}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default ClaimDetailPage;
