export const dynamic = "force-dynamic";

import { getRequiredSession } from "@/lib/require-auth";
import ChangePasswordForm from "./ChangePasswordForm";

const ChangePasswordPage = async () => {
  await getRequiredSession();

  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2 dark:text-slate-100">เปลี่ยนรหัสผ่าน</h1>
      <p className="text-sm text-gray-500 mb-6 dark:text-slate-400">
        ผู้ใช้แต่ละคนสามารถเปลี่ยนรหัสผ่านของตัวเองได้จากหน้านี้ เมื่อเปลี่ยนแล้ว
        ทุกอุปกรณ์ที่เข้าสู่ระบบด้วยบัญชีนี้จะถูกออกจากระบบ และต้องเข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่
      </p>
      <ChangePasswordForm />
    </div>
  );
};

export default ChangePasswordPage;
