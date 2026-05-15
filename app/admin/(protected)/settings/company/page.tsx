export const dynamic = "force-dynamic";

import { hasPermissionAccess } from "@/lib/access-control";
import { getSiteConfig } from "@/lib/site-config";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import CompanySettingsForm from "@/components/shared/CompanySettingsForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";

const CompanySettingsPage = async () => {
  await requirePermission("settings.company.view");
  const { role, permissions } = await getSessionPermissionContext();
  const config = await getSiteConfig();
  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ตั้งค่าร้านค้า"
        description="ข้อมูลร้านที่แก้ไขแล้วจะอัปเดตหน้าเว็บไซต์ทันที"
      />
      <CompanySettingsForm
        config={config}
        canManage={hasPermissionAccess(role, permissions, "settings.company.manage")}
      />
    </div>
  );
};

export default CompanySettingsPage;
