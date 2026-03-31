export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import NewClaimForm from "./NewClaimForm";

interface Props {
  searchParams: Promise<{ warrantyId?: string }>;
}

const NewClaimPage = async ({ searchParams }: Props) => {
  await requirePermission("warranty_claims.create");

  const { warrantyId } = await searchParams;
  if (!warrantyId) notFound();

  const [warranty, suppliers] = await Promise.all([
    db.warranty.findUnique({
      where: { id: warrantyId },
      select: {
        id: true,
        unitSeq: true,
        warrantyDays: true,
        startDate: true,
        endDate: true,
        product: { select: { id: true, code: true, name: true } },
        sale:    { select: { saleNo: true, customerName: true } },
        saleItem: {
          select: {
            supplierId:   true,
            supplierName: true,
            product: {
              select: {
                preferredSupplierId:  true,
                preferredSupplier: { select: { id: true, name: true, phone: true, address: true } },
              },
            },
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

  if (!warranty) notFound();

  // Pre-fill supplier from saleItem snapshot or product preferred supplier
  const defaultSupplierId   = warranty.saleItem?.supplierId
    ?? warranty.saleItem?.product.preferredSupplierId
    ?? "";
  const defaultSupplierName = warranty.saleItem?.supplierName
    ?? warranty.saleItem?.product.preferredSupplier?.name
    ?? "";
  const defaultSupplier = suppliers.find(s => s.id === defaultSupplierId);
  const defaultSupplierPhone   = defaultSupplier?.phone   ?? "";
  const defaultSupplierAddress = defaultSupplier?.address ?? "";

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/warranties"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> ประกันสินค้า
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">เปิดใบเคลมใหม่</span>
      </div>

      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2">เปิดใบเคลมสินค้า</h1>

      {/* Warranty info card */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm">
        <p className="font-semibold text-blue-800 mb-2">{warranty.product.name}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-blue-700">
          <span>รหัส: <strong>{warranty.product.code}</strong></span>
          <span>ลำดับ: <strong>#{warranty.unitSeq}</strong></span>
          <span>ใบขาย: <strong>{warranty.sale.saleNo}</strong></span>
          <span>ลูกค้า: <strong>{warranty.sale.customerName ?? "—"}</strong></span>
          <span>เริ่ม: <strong>{new Date(warranty.startDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}</strong></span>
          <span>หมด: <strong>{new Date(warranty.endDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" })}</strong></span>
        </div>
      </div>

      <NewClaimForm
        warrantyId={warrantyId}
        suppliers={suppliers}
        defaultSupplierId={defaultSupplierId}
        defaultSupplierName={defaultSupplierName}
        defaultSupplierPhone={defaultSupplierPhone}
        defaultSupplierAddress={defaultSupplierAddress}
      />
    </div>
  );
};

export default NewClaimPage;
