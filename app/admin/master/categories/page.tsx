import { db } from "@/lib/db";
import CategoryForm from "./CategoryForm";

const CategoriesPage = async () => {
  const categories = await db.category.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">จัดการหมวดหมู่สินค้า</h1>
      <CategoryForm categories={categories} />
    </div>
  );
};

export default CategoriesPage;
