export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { getCategoryAliasCoverageGaps } from "@/lib/category-alias-audit";
import { resolveCategoryVisual } from "@/lib/category-visual-config";
import { getCategoryVisualSettings } from "@/lib/category-visual-settings";
import { requirePermission } from "@/lib/require-auth";
import CategoriesTabs from "./CategoriesTabs";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const CategoriesPage = async () => {
  await requirePermission("master.view");

  const session = await getSession();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const [categories, visualSettings, pendingRows] = await Promise.all([
    db.category.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        createdAt: true,
        aliases: {
          // Only human-facing (APPROVED) aliases here — AI suggestions awaiting
          // review live in the dedicated "AI เสนอ" tab, rejected ones stay hidden.
          where: { reviewStatus: "APPROVED" },
          orderBy: [{ isActive: "desc" }, { priority: "desc" }, { alias: "asc" }],
          select: {
            id: true,
            alias: true,
            kind: true,
            matchMode: true,
            priority: true,
            isActive: true,
            notes: true,
          },
        },
      },
    }),
    getCategoryVisualSettings(),
    db.categoryAlias.findMany({
      where: { source: "AI_AUTO", reviewStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        alias: true,
        aiCorrectedTerm: true,
        notes: true,
        createdAt: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  const categoriesWithVisual = categories.map((category) => ({
    ...category,
    visual: resolveCategoryVisual(category, visualSettings[category.id]),
  }));
  const aliasCoverageGaps = getCategoryAliasCoverageGaps(categories);

  const pendingSuggestions = pendingRows.map((row) => ({
    id: row.id,
    alias: row.alias,
    correctedTerm: row.aiCorrectedTerm,
    categoryName: row.category?.name ?? null,
    notes: row.notes,
    createdAt: row.createdAt,
  }));

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="จัดการหมวดหมู่สินค้า"
        description="จัดการหมวดหมู่ สถานะ และภาพลักษณ์หมวดหมู่บนหน้าร้าน"
      />
      <CategoriesTabs
        categories={categoriesWithVisual}
        aliasCoverageGaps={aliasCoverageGaps}
        canCreate={hasPermissionAccess(role, permissions, "master.create")}
        canUpdate={hasPermissionAccess(role, permissions, "master.update")}
        canCancel={hasPermissionAccess(role, permissions, "master.cancel")}
        pendingSuggestions={pendingSuggestions}
      />
    </div>
  );
};

export default CategoriesPage;
