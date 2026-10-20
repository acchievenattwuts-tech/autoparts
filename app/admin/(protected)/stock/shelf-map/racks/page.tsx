export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import AdminEmptyState from "@/components/shared/AdminEmptyState";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { getAllPermissionKeys, hasPermissionAccess } from "@/lib/access-control";
import { getSession } from "@/lib/auth-session";
import { requirePermission } from "@/lib/require-auth";
import { MAX_SHELF_RACK_LEVELS } from "@/lib/shelf-location-rules";
import { loadShelfRackAdminRows, type ShelfRackAdminRow } from "@/lib/shelf-map-queries";
import ShelfRackForm from "./ShelfRackForm";

const loadRacks = async (): Promise<ShelfRackAdminRow[] | null> => {
  try {
    return await loadShelfRackAdminRows();
  } catch (error) {
    console.error("[shelf-rack] load failed", { error });
    return null;
  }
};

const ShelfRacksPage = async () => {
  await requirePermission("stock.shelf_map.view");

  const session = await getSession();
  const role = session?.user?.role;
  const permissions = role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);
  const canManage = hasPermissionAccess(role, permissions, "stock.shelf_map.manage");

  const racks = await loadRacks();
  const nextSortOrder = racks && racks.length > 0 ? Math.max(...racks.map((rack) => rack.sortOrder)) + 1 : 1;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ตั้งค่าชั้นวาง"
        description={`กำหนดชั้นวางและจำนวนชั้น (สูงสุด ${MAX_SHELF_RACK_LEVELS} ชั้น) ตำแหน่งเขียนเป็น "รหัสชั้นวาง-ชั้น" เช่น A-2 โดยชั้น 1 คือชั้นล่างสุด ชั้นวางที่ไม่ใช้แล้วให้ปิดใช้งาน ระบบไม่ลบทิ้ง`}
        actions={
          <Link
            href="/admin/stock/shelf-map"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <ArrowLeft size={16} />
            กลับไปผังชั้นวาง
          </Link>
        }
      />
      {racks === null ? (
        <AdminEmptyState title="โหลดรายการชั้นวางไม่สำเร็จ" description="กรุณาโหลดหน้าใหม่อีกครั้ง" />
      ) : (
        <ShelfRackForm racks={racks} canManage={canManage} nextSortOrder={nextSortOrder} />
      )}
    </div>
  );
};

export default ShelfRacksPage;
