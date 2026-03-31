export const dynamic = "force-dynamic";

import { hasPermissionAccess } from "@/lib/access-control";
import { getSiteConfig } from "@/lib/site-config";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import CompanySettingsForm from "@/components/shared/CompanySettingsForm";

const CompanySettingsPage = async () => {
  await requirePermission("settings.company.view");
  const { role, permissions } = await getSessionPermissionContext();
  const config = await getSiteConfig();
  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2">ตั้งค่าร้านค้า</h1>
      <p className="text-sm text-gray-500 mb-6">ข้อมูลร้านที่แก้ไขแล้วจะอัปเดตหน้าเว็บไซต์ทันที</p>
      <CompanySettingsForm
        config={config}
        canManage={hasPermissionAccess(role, permissions, "settings.company.manage")}
      />
    </div>
  );
};

export default CompanySettingsPage;
