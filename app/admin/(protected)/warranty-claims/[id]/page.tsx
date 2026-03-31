export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Printer } from "lucide-react";
import ClaimStatusActions from "./ClaimStatusActions";
import ClaimEditPanel from "./ClaimEditPanel";

interface Props {
  params: Promise<{ id: string }>;
}

const ClaimDetailPage = async ({ params }: Props) => {
  await requirePermission("warranty_claims.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canUpdate = hasPermissionAccess(role, permissions, "warranty_claims.update");

  const { id } = await params;

  const [claim, suppliers] = await Promise.all([
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
            sale:    { select: { saleNo: true, customerName: true } },
          },
        },
      },
    }),
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, address: true },
    }),
  ]);

  if (!claim) notFound();

  const STATUS_LABEL: Record<string, string> = {
    DRAFT:             "รอส่งเคลม",
    SENT_TO_SUPPLIER:  "ส่งซัพพลายเออร์แล้ว",
    CLOSED:            "ปิดเคลม",
    CANCELLED:         "ยกเลิกแล้ว",
  };

  const STATUS_COLOR: Record<string, string> = {
    DRAFT:             "bg-yellow-100 text-yellow-700 border-yellow-200",
    SENT_TO_SUPPLIER:  "bg-blue-100 text-blue-700 border-blue-200",
    CLOSED:            "bg-green-100 text-green-700 border-green-200",
    CANCELLED:         "bg-red-100 text-red-500 border-red-200",
  };

  const isEditable      = claim.status === "DRAFT" || claim.status === "SENT_TO_SUPPLIER";
  const canManageStatus = claim.status !== "CANCELLED";

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/warranty-claims"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> ใบเคลมทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">{claim.claimNo}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">{claim.claimNo}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {new Date(claim.claimDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex px-3 py-1.5 rounded-full text-sm font-medium border ${STATUS_COLOR[claim.status]}`}>
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
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors"
          >
            <Printer size={14} /> พิมพ์
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: claim info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Product / warranty */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-kanit text-base font-semibold text-[#1e3a5f] mb-4">ข้อมูลสินค้า / ประกัน</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-400 text-xs mb-0.5">สินค้า</p>
                <p className="font-medium text-gray-800">{claim.warranty.product.name}</p>
                <p className="text-xs text-gray-400">[{claim.warranty.product.code}]</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">ลำดับชิ้น</p>
                <p className="font-medium text-gray-700">#{claim.warranty.unitSeq}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">ใบขาย</p>
                <Link href={`/admin/sales/${claim.warranty.sale.saleNo}`}
                  className="font-mono text-sm text-[#1e3a5f] hover:underline">
                  {claim.warranty.sale.saleNo}
                </Link>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">ลูกค้า</p>
                <p className="text-gray-700">{claim.warranty.sale.customerName ?? "—"}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">ประกัน</p>
                <p className="text-gray-700">{claim.warranty.warrantyDays} วัน</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">วันหมดประกัน</p>
                <p className="text-gray-700">
                  {new Date(claim.warranty.endDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </p>
              </div>
            </div>
          </div>

          {/* Claim details */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-kanit text-base font-semibold text-[#1e3a5f] mb-4">รายละเอียดการเคลม</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-400 text-xs mb-0.5">ประเภทเคลม</p>
                <p className="font-medium text-gray-700">
                  {claim.claimType === "REPLACE_NOW" ? "เปลี่ยนของให้ทันที" : "ลูกค้ารอผลเคลม"}
                </p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">อาการ</p>
                <p className="text-gray-700">{claim.symptom ?? "—"}</p>
              </div>
              {claim.sentAt && (
                <div>
                  <p className="text-gray-400 text-xs mb-0.5">วันที่ส่งซัพพลายเออร์</p>
                  <p className="text-gray-700">
                    {new Date(claim.sentAt).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </p>
                </div>
              )}
              {claim.resolvedAt && (
                <div>
                  <p className="text-gray-400 text-xs mb-0.5">วันที่ปิดเคลม</p>
                  <p className="text-gray-700">
                    {new Date(claim.resolvedAt).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </p>
                </div>
              )}
              {claim.outcome && (
                <div>
                  <p className="text-gray-400 text-xs mb-0.5">ผลลัพธ์</p>
                  <p className="font-medium text-gray-700">
                    {claim.outcome === "RECEIVED" ? "ได้รับของคืน" : "ไม่ได้รับการแก้ไข"}
                  </p>
                </div>
              )}
              {claim.note && (
                <div className="col-span-2">
                  <p className="text-gray-400 text-xs mb-0.5">หมายเหตุ</p>
                  <p className="text-gray-700">{claim.note}</p>
                </div>
              )}
            </div>
          </div>

          {/* Supplier */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-kanit text-base font-semibold text-[#1e3a5f] mb-4">ซัพพลายเออร์</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-400 text-xs mb-0.5">ชื่อ</p>
                <p className="text-gray-700">{claim.supplierName ?? "—"}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs mb-0.5">เบอร์โทร</p>
                <p className="text-gray-700">{claim.supplierPhone ?? "—"}</p>
              </div>
              <div className="col-span-2">
                <p className="text-gray-400 text-xs mb-0.5">ที่อยู่</p>
                <p className="text-gray-700">{claim.supplierAddress ?? "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: status actions */}
        {canUpdate && canManageStatus && (
          <div>
            <ClaimStatusActions claimId={id} claimNo={claim.claimNo} currentStatus={claim.status} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ClaimDetailPage;
