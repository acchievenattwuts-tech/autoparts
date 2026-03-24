import { db } from "@/lib/db";
import SuppliersClient from "./SuppliersClient";

const SuppliersPage = async () => {
  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">จัดการผู้จำหน่าย</h1>
      <SuppliersClient suppliers={suppliers} />
    </div>
  );
};

export default SuppliersPage;
