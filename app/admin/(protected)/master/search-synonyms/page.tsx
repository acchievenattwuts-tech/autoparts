export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import SearchSynonymsClient from "./SearchSynonymsClient";

const SearchSynonymsPage = async () => {
  await requirePermission("search_synonyms.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const synonyms = await db.searchSynonym.findMany({
    orderBy: [{ isActive: "desc" }, { term: "asc" }],
    select: {
      id: true,
      term: true,
      synonyms: true,
      language: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="คลังคำพ้อง / Synonym Dictionary"
        description="กำหนดคำพ้อง-คำสะกดหลายแบบ-ไทย-อังกฤษ เพื่อให้ระบบค้นหาสินค้าครอบคลุมคำที่ลูกค้าใช้จริง"
      />
      <SearchSynonymsClient
        synonyms={synonyms.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }))}
        canCreate={hasPermissionAccess(role, permissions, "search_synonyms.create")}
        canUpdate={hasPermissionAccess(role, permissions, "search_synonyms.update")}
        canCancel={hasPermissionAccess(role, permissions, "search_synonyms.cancel")}
      />
    </div>
  );
};

export default SearchSynonymsPage;
