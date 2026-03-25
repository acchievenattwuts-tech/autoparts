import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PurchaseForm from "./PurchaseForm";

const NewPurchasePage = async () => {
  const [products, suppliers] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        purchaseUnitName: true,
        units: {
          select: { name: true, scale: true, isBase: true },
          orderBy: { isBase: "desc" },
        },
      },
    }),
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href="/admin/purchases"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> ใบซื้อทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">สร้างใบซื้อใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">สร้างใบซื้อสินค้า</h1>
      <PurchaseForm products={products} suppliers={suppliers} />
    </div>
  );
};

export default NewPurchasePage;
