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
import AdminPageHeader from "@/components/shared/AdminPageHeader";

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
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการหมวดหมู่สินค้า"
        description="จัดการหมวดหมู่ สถานะ และภาพลักษณ์หมวดหมู่บนหน้าร้าน"
      />
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
