export const dynamic = "force-dynamic";

import { requirePermission } from "@/lib/require-auth";
import ChangePasswordForm from "./ChangePasswordForm";

const ChangePasswordPage = async () => {
  await requirePermission("dashboard.view");

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2">เปลี่ยนรหัสผ่าน</h1>
      <p className="text-sm text-gray-500 mb-6">ผู้ใช้แต่ละคนสามารถเปลี่ยนรหัสผ่านของตัวเองได้จากหน้านี้</p>
      <ChangePasswordForm />
    </div>
  );
};

export default ChangePasswordPage;
