export const dynamic = "force-dynamic";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { getBackupCenterEnvStatus } from "@/lib/backup-center";
import { requirePermission } from "@/lib/require-auth";
import BackupCenterClient from "./BackupCenterClient";

const BackupCenterPage = async () => {
  await requirePermission("system.backup");
  const envStatus = await getBackupCenterEnvStatus();

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Backup Center"
        description="สำรองไฟล์ Vercel Blob และ PostgreSQL พร้อมติดตามสถานะงาน"
      />
      <BackupCenterClient envStatus={envStatus} />
    </div>
  );
};

export default BackupCenterPage;
