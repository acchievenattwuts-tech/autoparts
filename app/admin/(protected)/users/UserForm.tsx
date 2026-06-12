"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { CheckCircle, Upload, X } from "lucide-react";
import { createUser, updateUser, uploadUserSignature } from "./actions";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";

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
    phone: string | null;
    role: "ADMIN" | "STAFF";
    appRoleId: string | null;
    mustChangePassword: boolean;
    isActive: boolean;
    signatureUrl: string | null;
  };
  roleOptions: RoleOption[];
}

const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-orange-400/30";
const labelCls = "mb-1.5 block text-sm font-medium text-gray-700 dark:text-slate-300";

const UserForm = ({ user, roleOptions }: UserFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(user?.mustChangePassword ?? true);
  const signatureFileRef = useRef<HTMLInputElement>(null);
  const [signatureUrl, setSignatureUrl] = useState(user?.signatureUrl ?? "");
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  const signaturePreviewSrc = toPublicStorageCdnPath(signatureUrl) ?? signatureUrl ?? "";

  const isEdit = Boolean(user);

  const handleSignatureChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSignatureError("");
    setSignatureUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadUserSignature(formData);

    setSignatureUploading(false);

    if (result.error) {
      setSignatureError(result.error);
    }

    if (result.url) {
      setSignatureUrl(result.url);
    }

    if (signatureFileRef.current) {
      signatureFileRef.current.value = "";
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const formData = new FormData(e.currentTarget);
    formData.set("mustChangePassword", String(mustChangePassword));
    formData.set("signatureUrl", signatureUrl);

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
      <AdminSectionCard title="ข้อมูลผู้ใช้">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ชื่อผู้ใช้</label>
            <input name="name" defaultValue={user?.name ?? ""} required maxLength={100} className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>เบอร์โทรศัพท์</label>
            <input
              name="phone"
              type="tel"
              defaultValue={user?.phone ?? ""}
              maxLength={20}
              className={inputCls}
              placeholder="เช่น 0812345678"
            />
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
            <select name="role" defaultValue={user?.role ?? "STAFF"} className={inputCls}>
              <option value="ADMIN">ADMIN</option>
              <option value="STAFF">STAFF</option>
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">ใช้เพื่อ compatibility กับระบบเดิมในช่วงเปลี่ยนผ่าน</p>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>บทบาทการใช้งาน</label>
            <select name="appRoleId" defaultValue={user?.appRoleId ?? ""} className={inputCls}>
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
              <span className="text-sm text-gray-700 dark:text-slate-300">บังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าระบบ</span>
            </label>
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>ลายเซ็นอิเล็กทรอนิก</label>
            <input type="hidden" name="signatureUrl" value={signatureUrl} />
            <div className="flex flex-col gap-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-slate-900/60 sm:flex-row sm:items-start">
              <div className="relative flex h-24 w-full flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950 sm:w-56">
                {signatureUrl ? (
                  <>
                    <Image
                      src={signaturePreviewSrc}
                      alt="ตัวอย่างลายเซ็น"
                      fill
                      sizes="224px"
                      className="object-contain p-3"
                    />
                    <button
                      type="button"
                      onClick={() => setSignatureUrl("")}
                      className="absolute right-1 top-1 rounded-full border border-gray-200 bg-white p-1 text-gray-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-500 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                    >
                      <X size={12} />
                    </button>
                  </>
                ) : (
                  <p className="px-3 text-center text-sm text-gray-400 dark:text-slate-500">ยังไม่ได้อัปโหลดลายเซ็น</p>
                )}
              </div>

              <div className="flex-1 space-y-3">
                <input
                  ref={signatureFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleSignatureChange}
                  className="hidden"
                  id="user-signature-upload"
                />
                <label
                  htmlFor="user-signature-upload"
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors ${
                    signatureUploading
                      ? "cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500"
                      : "bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  <Upload size={14} />
                  {signatureUploading ? "กำลังอัปโหลด..." : "เลือกลายเซ็น"}
                </label>
                <div className="space-y-1 text-xs text-gray-400 dark:text-slate-500">
                  <p>รองรับไฟล์ JPG, PNG, WebP ขนาดไม่เกิน 3MB</p>
                  <p>แนะนำ PNG พื้นหลังโปร่งใส เพื่อให้แสดงผลบนเอกสารได้คมชัด</p>
                </div>
                {signatureError && <p className="text-xs text-red-500 dark:text-red-300">{signatureError}</p>}
              </div>
            </div>
          </div>
        </div>
      </AdminSectionCard>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/20 dark:bg-red-500/10">
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-500/20 dark:bg-green-500/10">
          <CheckCircle size={16} className="text-green-600 dark:text-green-300" />
          <p className="text-sm text-green-600 dark:text-green-300">{success}</p>
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
