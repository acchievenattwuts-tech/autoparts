"use client";

import { useTransition, useRef, useState } from "react";
import { updateCompanySettings } from "./actions";
import type { SiteConfig } from "@/lib/site-config";
import { Save, CheckCircle } from "lucide-react";

const inputClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

const CompanySettingsForm = ({ config }: { config: SiteConfig }) => {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    startTransition(async () => {
      const result = await updateCompanySettings(formData);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      {/* ข้อมูลร้าน */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit font-semibold text-gray-800 mb-4">ข้อมูลร้านค้า</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>ชื่อร้าน *</label>
            <input name="shop_name" defaultValue={config.shopName} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>คำแนะนำร้าน (Slogan)</label>
            <input name="shop_slogan" defaultValue={config.shopSlogan} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>เบอร์โทรศัพท์</label>
            <input name="shop_phone" defaultValue={config.shopPhone} className={inputClass} placeholder="0xx-xxx-xxxx" />
          </div>
          <div>
            <label className={labelClass}>อีเมลร้าน</label>
            <input name="shop_email" defaultValue={config.shopEmail} className={inputClass} placeholder="email@example.com" />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>ที่อยู่ร้าน</label>
            <textarea name="shop_address" defaultValue={config.shopAddress} rows={2} className={inputClass} placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์" />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>URL โลโก้ร้าน</label>
            <input name="shop_logo_url" defaultValue={config.shopLogoUrl} className={inputClass} placeholder="https://..." />
            <p className="text-xs text-gray-400 mt-1">อัปโหลดรูปภาพไปยัง Supabase Storage แล้วนำ URL มาวาง</p>
          </div>
        </div>
      </div>

      {/* LINE OA */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit font-semibold text-gray-800 mb-4">LINE Official Account</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>LINE ID</label>
            <input name="shop_line_id" defaultValue={config.shopLineId} className={inputClass} placeholder="@xxxxxxx" />
          </div>
          <div>
            <label className={labelClass}>LINE URL</label>
            <input name="shop_line_url" defaultValue={config.shopLineUrl} className={inputClass} placeholder="https://lin.ee/..." />
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit font-semibold text-gray-800 mb-4">หน้าแรก (Hero Section)</h2>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>หัวข้อหลัก</label>
            <input name="hero_title" defaultValue={config.heroTitle} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>คำอธิบาย</label>
            <textarea name="hero_subtitle" defaultValue={config.heroSubtitle} rows={2} className={inputClass} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="flex items-center gap-2 bg-[#1e3a5f] hover:bg-[#163055] text-white px-6 py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-60"
        >
          <Save size={16} />
          {isPending ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-green-600 text-sm">
            <CheckCircle size={16} />
            บันทึกสำเร็จ! หน้าเว็บอัปเดตแล้ว
          </span>
        )}
      </div>
    </form>
  );
};

export default CompanySettingsForm;
