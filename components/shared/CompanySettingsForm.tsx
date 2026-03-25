"use client";

import { useTransition, useRef, useState } from "react";
import { updateCompanySettings } from "@/app/admin/(protected)/settings/company/actions";
import type { SiteConfig } from "@/lib/site-config";
import { Save, CheckCircle } from "lucide-react";

const inputClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";

interface ToggleProps {
  name: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
}

const Toggle = ({ name, checked, onChange, label }: ToggleProps) => (
  <label className="flex items-center gap-2 cursor-pointer select-none">
    <input type="hidden" name={name} value={checked ? "true" : "false"} />
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:ring-offset-1 ${
        checked ? "bg-[#1e3a5f]" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
    <span className="text-sm text-gray-600">{label}</span>
  </label>
);

interface SocialRowProps {
  platform: string;
  urlName: string;
  urlValue: string;
  enabledName: string;
  enabled: boolean;
  onToggle: (val: boolean) => void;
  placeholder: string;
  icon: React.ReactNode;
}

const SocialRow = ({
  platform,
  urlName,
  urlValue,
  enabledName,
  enabled,
  onToggle,
  placeholder,
  icon,
}: SocialRowProps) => (
  <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b border-gray-100 last:border-0">
    <div className="flex items-center gap-2 w-32 flex-shrink-0">
      {icon}
      <span className="text-sm font-medium text-gray-700">{platform}</span>
    </div>
    <div className="flex-1">
      <input
        name={urlName}
        defaultValue={urlValue}
        className={inputClass}
        placeholder={placeholder}
      />
    </div>
    <Toggle
      name={enabledName}
      checked={enabled}
      onChange={onToggle}
      label={enabled ? "แสดง" : "ซ่อน"}
    />
  </div>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#1877F2]">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const TiktokIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-gray-900">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.2 8.2 0 0 0 4.78 1.52V6.74a4.85 4.85 0 0 1-1.01-.05z" />
  </svg>
);

const ShopeeIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#EE4D2D]">
    <path d="M12 1a5.33 5.33 0 0 0-5.33 5.33H4.5L3 22h18L19.5 6.33h-2.17A5.33 5.33 0 0 0 12 1zm0 1.67a3.67 3.67 0 0 1 3.67 3.66H8.33A3.67 3.67 0 0 1 12 2.67zM9.5 11a1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5A1.5 1.5 0 0 1 8 12.5 1.5 1.5 0 0 1 9.5 11zm5 0a1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5 1.5 1.5 0 0 1-1.5-1.5A1.5 1.5 0 0 1 14.5 11z" />
  </svg>
);

const LazadaIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#0F146D]">
    <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.5 14.5h-9v-1.5h3.75V9.75H8.25V8.5h7.5v1.25h-2.25v5.25H16.5v1.5z" />
  </svg>
);

const CompanySettingsForm = ({ config }: { config: SiteConfig }) => {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [facebookEnabled, setFacebookEnabled] = useState(config.shopFacebookEnabled);
  const [tiktokEnabled, setTiktokEnabled] = useState(config.shopTiktokEnabled);
  const [shopeeEnabled, setShopeeEnabled] = useState(config.shopShopeeEnabled);
  const [lazadaEnabled, setLazadaEnabled] = useState(config.shopLazadaEnabled);

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

      {/* Social Media */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit font-semibold text-gray-800 mb-1">ช่องทางโซเชียลมีเดีย</h2>
        <p className="text-xs text-gray-400 mb-4">วาง URL และเปิด/ปิดการแสดงในหน้าเว็บ</p>
        <div>
          <SocialRow
            platform="Facebook"
            urlName="shop_facebook_url"
            urlValue={config.shopFacebookUrl}
            enabledName="shop_facebook_enabled"
            enabled={facebookEnabled}
            onToggle={setFacebookEnabled}
            placeholder="https://facebook.com/yourpage"
            icon={<FacebookIcon />}
          />
          <SocialRow
            platform="TikTok"
            urlName="shop_tiktok_url"
            urlValue={config.shopTiktokUrl}
            enabledName="shop_tiktok_enabled"
            enabled={tiktokEnabled}
            onToggle={setTiktokEnabled}
            placeholder="https://tiktok.com/@yourpage"
            icon={<TiktokIcon />}
          />
          <SocialRow
            platform="Shopee"
            urlName="shop_shopee_url"
            urlValue={config.shopShopeeUrl}
            enabledName="shop_shopee_enabled"
            enabled={shopeeEnabled}
            onToggle={setShopeeEnabled}
            placeholder="https://shopee.co.th/yourshop"
            icon={<ShopeeIcon />}
          />
          <SocialRow
            platform="Lazada"
            urlName="shop_lazada_url"
            urlValue={config.shopLazadaUrl}
            enabledName="shop_lazada_enabled"
            enabled={lazadaEnabled}
            onToggle={setLazadaEnabled}
            placeholder="https://www.lazada.co.th/shop/yourshop"
            icon={<LazadaIcon />}
          />
        </div>
      </div>

      {/* VAT Settings */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] mb-5 pb-3 border-b border-gray-100">
          การตั้งค่าภาษี (VAT)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>ประเภทภาษีเริ่มต้น</label>
            <select name="vat_type" defaultValue={config.vatType} className={`${inputClass} bg-white`}>
              <option value="NO_VAT">ไม่มีภาษี (No VAT)</option>
              <option value="EXCLUDING_VAT">ราคาไม่รวม VAT (Excl. VAT)</option>
              <option value="INCLUDING_VAT">ราคารวม VAT แล้ว (Incl. VAT)</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">ค่าเริ่มต้นสำหรับทุก transaction ใหม่ (สามารถเปลี่ยนแปลงได้ต่อรายการ)</p>
          </div>
          <div>
            <label className={labelClass}>อัตราภาษี VAT (%)</label>
            <input
              type="number"
              name="vat_rate"
              defaultValue={config.vatRate}
              min={0}
              max={100}
              step={0.01}
              className={inputClass}
              placeholder="7"
            />
            <p className="mt-1 text-xs text-gray-400">อัตราภาษีมูลค่าเพิ่ม เช่น 7 สำหรับ 7%</p>
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
