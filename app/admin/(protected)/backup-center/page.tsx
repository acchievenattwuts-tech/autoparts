export const dynamic = "force-dynamic";

import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { isGithubBackupConfigured } from "@/lib/github-backup";
import { requirePermission } from "@/lib/require-auth";
import BackupCenterClient from "./BackupCenterClient";

const BackupCenterPage = async () => {
  await requirePermission("system.backup");
  const envStatus = { githubBackup: isGithubBackupConfigured() };

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Backup Center"
        description="สำรองฐานข้อมูลและไฟล์รูปเข้า Google Drive พร้อมติดตามสถานะงาน"
      />
      <BackupCenterClient envStatus={envStatus} />
    </div>
  );
};

export default BackupCenterPage;
