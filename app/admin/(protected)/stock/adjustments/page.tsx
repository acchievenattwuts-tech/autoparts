import { db } from "@/lib/db";
import AdjustmentForm from "./AdjustmentForm";

const AdjustmentsPage = async () => {
  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      stock: true,
      units: {
        select: { name: true, scale: true, isBase: true },
        orderBy: { isBase: "desc" },
      },
    },
  });

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2">ปรับสต็อก</h1>
      <p className="text-sm text-gray-500 mb-6">ปรับเพิ่ม/ลดจำนวนสินค้าพร้อมระบุเหตุผล</p>
      <AdjustmentForm products={products} />
    </div>
  );
};

export default AdjustmentsPage;
