import { db } from "@/lib/db";
import PartsBrandForm from "./PartsBrandForm";

const PartsBrandsPage = async () => {
  const brands = await db.partsBrand.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">จัดการแบรนด์อะไหล่</h1>
      <PartsBrandForm brands={brands} />
    </div>
  );
};

export default PartsBrandsPage;
