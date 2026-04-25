export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { resolveCategoryVisual } from "@/lib/category-visual-config";
import { getCategoryVisualSettings } from "@/lib/category-visual-settings";
import { requirePermission } from "@/lib/require-auth";
import CategoryForm from "./CategoryForm";

const CategoriesPage = async () => {
  await requirePermission("master.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const [categories, visualSettings] = await Promise.all([
    db.category.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        createdAt: true,
      },
    }),
    getCategoryVisualSettings(),
  ]);

  const categoriesWithVisual = categories.map((category) => ({
    ...category,
    visual: resolveCategoryVisual(category, visualSettings[category.id]),
  }));

  return (
    <div>
      <h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900">จัดการหมวดหมู่สินค้า</h1>
      <CategoryForm
        categories={categoriesWithVisual}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canUpdate={hasPermissionAccess(role, permissions, "master.update")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
      />
    </div>
  );
};

export default CategoriesPage;
