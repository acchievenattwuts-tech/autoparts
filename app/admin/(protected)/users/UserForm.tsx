"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { createUser, updateUser } from "./actions";

type RoleOption = {
  id: string;
  name: string;
  description: string | null;
};

interface UserFormProps {
  user?: {
    id: string;
    name: string;
    username: string;
    role: "ADMIN" | "STAFF";
    appRoleId: string | null;
    mustChangePassword: boolean;
    isActive: boolean;
  };
  roleOptions: RoleOption[];
}

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const UserForm = ({ user, roleOptions }: UserFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(user?.mustChangePassword ?? true);

  const isEdit = Boolean(user);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const formData = new FormData(e.currentTarget);
    formData.set("mustChangePassword", String(mustChangePassword));

    startTransition(async () => {
      const result = isEdit ? await updateUser(user!.id, formData) : await createUser(formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (isEdit) {
        setSuccess("บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว");
      } else {
        router.push("/admin/users");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          ข้อมูลผู้ใช้
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ชื่อผู้ใช้</label>
            <input name="name" defaultValue={user?.name ?? ""} required maxLength={100} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Username สำหรับเข้าสู่ระบบ</label>
            <input
              name="username"
              defaultValue={user?.username ?? ""}
              required
              maxLength={100}
              className={inputCls}
              placeholder="เช่น admin หรือ staff01"
            />
          </div>

          <div>
            <label className={labelCls}>
              {isEdit ? "รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)" : "รหัสผ่าน"}
            </label>
            <input
              type="password"
              name="password"
              required={!isEdit}
              minLength={8}
              maxLength={100}
              className={inputCls}
              placeholder="อย่างน้อย 8 ตัวอักษร"
            />
          </div>

          <div>
            <label className={labelCls}>Legacy Role</label>
            <select name="role" defaultValue={user?.role ?? "STAFF"} className={`${inputCls} bg-white`}>
              <option value="ADMIN">ADMIN</option>
              <option value="STAFF">STAFF</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">ใช้เพื่อ compatibility กับระบบเดิมในช่วงเปลี่ยนผ่าน</p>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>บทบาทการใช้งาน</label>
            <select name="appRoleId" defaultValue={user?.appRoleId ?? ""} className={`${inputCls} bg-white`}>
              <option value="">ยังไม่กำหนด</option>
              {roleOptions.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={mustChangePassword}
                onChange={(event) => setMustChangePassword(event.target.checked)}
                className="w-4 h-4 text-[#1e3a5f] rounded border-gray-300 focus:ring-[#1e3a5f]"
              />
              <span className="text-sm text-gray-700">บังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าระบบ</span>
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-600">{success}</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : isEdit ? "บันทึกการแก้ไข" : "เพิ่มผู้ใช้"}
        </button>
      </div>
    </form>
  );
};

export default UserForm;
