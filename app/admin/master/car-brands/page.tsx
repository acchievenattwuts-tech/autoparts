import { db } from "@/lib/db";
import CarBrandsClient from "./CarBrandsClient";

const CarBrandsPage = async () => {
  const carBrands = await db.carBrand.findMany({
    orderBy: { name: "asc" },
    include: {
      carModels: {
        orderBy: { name: "asc" },
      },
    },
  });

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">จัดการยี่ห้อและรุ่นรถ</h1>
      <CarBrandsClient carBrands={carBrands} />
    </div>
  );
};

export default CarBrandsPage;
