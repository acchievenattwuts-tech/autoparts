import { db } from "@/lib/db";
import BfForm from "./BfForm";

const BfPage = async () => {
  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      avgCost: true,
      stock: true,
      units: {
        select: { name: true, scale: true, isBase: true },
        orderBy: { isBase: "desc" },
      },
    },
  });

  const mapped = products.map((p) => ({
    ...p,
    avgCost: Number(p.avgCost),
  }));

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2">ยอดยกมา (BF)</h1>
      <p className="text-sm text-gray-500 mb-6">บันทึกจำนวนสินค้าเริ่มต้นก่อนเริ่มใช้ระบบ</p>
      <BfForm products={mapped} />
    </div>
  );
};

export default BfPage;
