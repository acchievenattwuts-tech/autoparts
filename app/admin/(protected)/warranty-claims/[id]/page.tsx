export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft, CreditCard, Printer } from "lucide-react";
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

const CLAIM_STOCK_MOVEMENT_LABEL: Record<string, string> = {
  CUSTOMER_RETURN_IN: "รับคืนจากลูกค้าเข้าสต็อกเคลม",
  SEND_TO_SUPPLIER_OUT: "ส่งสต็อกเคลมไปซัพพลายเออร์",
  SUPPLIER_RECEIVE_IN: "รับคืนจากซัพพลายเออร์เข้าสต็อกเคลม",
  TRANSFER_TO_NORMAL_OUT: "โอนจากสต็อกเคลมเข้าสต็อกปกติ",
  SUPPLIER_REJECT: "ซัพพลายเออร์ปฏิเสธ / ปิดเคลม",
  SUPPLIER_CREDIT_SETTLE: "ผูกใบลดหนี้ซื้อ",
  SCRAP_OUT: "ตัดทิ้ง",
  CANCEL_REVERSAL: "รายการย้อนกลับ",
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
        claimStockBalances: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            lotNo: true,
            qtyOnHand: true,
            unitCost: true,
            updatedAt: true,
          },
        },
        claimStockMovements: {
          orderBy: [{ docDate: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            movementType: true,
            docNo: true,
            docDate: true,
            lotNo: true,
            qtyIn: true,
            qtyOut: true,
            unitCost: true,
            stockCardId: true,
            purchaseReturnId: true,
            reversedAt: true,
            reversalOfId: true,
            createdAt: true,
          },
        },
        purchaseReturns: {
          where: { status: "ACTIVE" },
          orderBy: { returnDate: "desc" },
          select: {
            id: true,
            returnNo: true,
            returnDate: true,
            totalAmount: true,
            amountRemain: true,
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
          {canUpdate && claim.supplierId && (
            <Link
              href={`/admin/purchase-returns/new?claimId=${id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
            >
              <CreditCard size={14} /> สร้างใบลดหนี้ซื้อ
            </Link>
          )}
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

          <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-kanit text-base font-semibold text-[#1e3a5f]">
                ประวัติสต็อกเคลม
              </h2>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                {claim.claimStockMovements.length} รายการ
              </span>
            </div>

            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {claim.claimStockBalances.length === 0 ? (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-500 sm:col-span-3">
                  ไม่มี claim stock balance คงเหลือ
                </div>
              ) : (
                claim.claimStockBalances.map((balance) => (
                  <div key={balance.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <p className="text-xs text-gray-400">ล็อต</p>
                    <p className="font-mono text-sm text-gray-700">{balance.lotNo || "-"}</p>
                    <p className="mt-2 text-xs text-gray-400">คงเหลือ / ต้นทุน</p>
                    <p className="text-sm font-semibold text-gray-800">
                      {Number(balance.qtyOnHand).toLocaleString("th-TH", { maximumFractionDigits: 4 })} @{" "}
                      {Number(balance.unitCost).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-400">
                    <th className="py-2 pr-3">วันที่</th>
                    <th className="py-2 pr-3">เอกสาร</th>
                    <th className="py-2 pr-3">รายการเคลื่อนไหว</th>
                    <th className="py-2 pr-3">ล็อต</th>
                    <th className="py-2 pr-3 text-right">เข้า</th>
                    <th className="py-2 pr-3 text-right">ออก</th>
                    <th className="py-2 pr-3 text-right">ต้นทุน</th>
                    <th className="py-2 text-right">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {claim.claimStockMovements.map((movement) => (
                    <tr key={movement.id} className="border-b border-gray-50 text-gray-700">
                      <td className="py-2 pr-3">{formatDateThai(movement.docDate)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{movement.docNo}</td>
                      <td className="py-2 pr-3">
                        {CLAIM_STOCK_MOVEMENT_LABEL[movement.movementType] ?? movement.movementType}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{movement.lotNo || "-"}</td>
                      <td className="py-2 pr-3 text-right">
                        {Number(movement.qtyIn).toLocaleString("th-TH", { maximumFractionDigits: 4 })}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {Number(movement.qtyOut).toLocaleString("th-TH", { maximumFractionDigits: 4 })}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {Number(movement.unitCost).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 text-right">
                        {movement.reversedAt ? (
                          <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-500">
                            ถูกย้อนกลับ
                          </span>
                        ) : movement.reversalOfId ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-600">
                            รายการย้อนกลับ
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600">
                            ใช้งานอยู่
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {claim.claimStockMovements.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-sm text-gray-400">
                        ไม่มีรายการเคลื่อนไหวสต็อกเคลม
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {claim.purchaseReturns.length > 0 && (
              <div className="mt-5 rounded-lg border border-orange-100 bg-orange-50 p-3">
                <p className="mb-2 text-sm font-semibold text-orange-700">ใบลดหนี้ซื้อที่ผูกกับเคลมนี้</p>
                <div className="space-y-1 text-sm">
                  {claim.purchaseReturns.map((purchaseReturn) => (
                    <Link
                      key={purchaseReturn.id}
                      href={`/admin/purchase-returns/${purchaseReturn.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-orange-700 hover:bg-orange-100"
                    >
                      <span className="font-mono">{purchaseReturn.returnNo}</span>
                      <span>
                        {Number(purchaseReturn.totalAmount).toLocaleString("th-TH", { minimumFractionDigits: 2 })}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
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
