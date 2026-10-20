export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";

import AdminExportLink from "@/components/shared/AdminExportLink";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { hasPermissionAccess } from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import ShelfLocationImportForm from "./ShelfLocationImportForm";

const SHELF_MAP_PATH = "/admin/stock/shelf-map";
const SURVEY_SHEET_HREF = `${SHELF_MAP_PATH}/export?mode=survey`;
const RECHECK_SHEET_HREF = `${SHELF_MAP_PATH}/export?mode=recheck`;

const exportButtonClassName =
  "inline-flex items-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 dark:bg-emerald-600 dark:hover:bg-emerald-500";

const ShelfLocationImportPage = async () => {
  const session = await requirePermission("stock.shelf_map.manage");
  const canExport = hasPermissionAccess(session.user.role, session.user.permissions, "stock.shelf_map.view");

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="ผังชั้นวาง"
        title="นำเข้าตำแหน่งสินค้า"
        description="ส่งออกใบสำรวจหรือใบตรวจซ้ำ พิมพ์ไปตรวจที่ชั้นวาง กรอกผลลงไฟล์ Excel แล้วนำเข้าที่หน้านี้ ระบบจะแสดงผลตรวจไฟล์ให้ดูก่อนบันทึกทุกครั้ง"
        actions={
          <>
            <Link
              href={SHELF_MAP_PATH}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-300 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
            >
              <ArrowLeft size={16} />
              ผังชั้นวาง
            </Link>
            {canExport ? (
              <>
                <AdminExportLink href={SURVEY_SHEET_HREF} className={exportButtonClassName}>
                  <FileSpreadsheet size={16} />
                  ใบสำรวจ
                </AdminExportLink>
                <AdminExportLink href={RECHECK_SHEET_HREF} className={exportButtonClassName}>
                  <FileSpreadsheet size={16} />
                  ใบตรวจซ้ำ
                </AdminExportLink>
              </>
            ) : null}
          </>
        }
      />
      <ShelfLocationImportForm />
    </div>
  );
};

export default ShelfLocationImportPage;
