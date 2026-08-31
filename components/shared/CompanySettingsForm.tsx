"use client";

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import Image from "next/image";
import { Save, CheckCircle, Upload, X } from "lucide-react";
import { updateCompanySettings, uploadLogoImage } from "@/app/admin/(protected)/settings/company/actions";
import type { SiteConfig } from "@/lib/site-config";
import LazadaLogoIcon from "@/components/shared/LazadaLogoIcon";
import ShopeeLogoIcon from "@/components/shared/ShopeeLogoIcon";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100";
const labelClass = "mb-1 block text-sm font-medium text-gray-700 dark:text-slate-200";

interface ToggleProps {
  name: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}

const Toggle = ({ name, checked, onChange, label }: ToggleProps) => (
  <label className="flex cursor-pointer select-none items-center gap-2">
    <input type="hidden" name={name} value={checked ? "true" : "false"} />
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:ring-offset-1 dark:focus:ring-sky-400 ${checked ? "bg-[#1e3a5f] dark:bg-sky-600" : "bg-gray-300 dark:bg-slate-700"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
    <span className="text-sm text-gray-600 dark:text-slate-300">{label}</span>
  </label>
);

interface SocialRowProps {
  platform: string;
  urlName: string;
  urlValue: string;
  enabledName: string;
  enabled: boolean;
  onToggle: (value: boolean) => void;
  placeholder: string;
  icon: ReactNode;
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
  <div className="flex flex-col gap-3 border-b border-gray-100 py-4 last:border-0 dark:border-white/10 sm:flex-row sm:items-center">
    <div className="flex w-32 flex-shrink-0 items-center gap-2">
      {icon}
      <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{platform}</span>
    </div>
    <div className="flex-1">
      <input name={urlName} defaultValue={urlValue} className={inputClass} placeholder={placeholder} />
    </div>
    <Toggle name={enabledName} checked={enabled} onChange={onToggle} label={enabled ? "แสดง" : "ซ่อน"} />
  </div>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#1877F2]">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const TiktokIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-gray-900">
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.2 8.2 0 0 0 4.78 1.52V6.74a4.85 4.85 0 0 1-1.01-.05z" />
  </svg>
);


const CompanySettingsForm = ({ config, canManage }: { config: SiteConfig; canManage: boolean }) => {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState(config.shopLogoUrl ?? "");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");
  const lineQrFileRef = useRef<HTMLInputElement>(null);
  const [lineQrUrl, setLineQrUrl] = useState(config.shopLineQrUrl ?? "");
  const [lineQrUploading, setLineQrUploading] = useState(false);
  const [lineQrError, setLineQrError] = useState("");
  const logoPreviewSrc = toPublicStorageCdnPath(logoUrl) ?? logoUrl ?? "";
  const lineQrPreviewSrc = toPublicStorageCdnPath(lineQrUrl) ?? lineQrUrl ?? "";
  const [facebookEnabled, setFacebookEnabled] = useState(config.shopFacebookEnabled);
  const [tiktokEnabled, setTiktokEnabled] = useState(config.shopTiktokEnabled);
  const [shopeeEnabled, setShopeeEnabled] = useState(config.shopShopeeEnabled);
  const [lazadaEnabled, setLazadaEnabled] = useState(config.shopLazadaEnabled);
  const [productSearchAutoApplySynonymsEnabled, setProductSearchAutoApplySynonymsEnabled] = useState(
    config.productSearchAutoApplySynonymsEnabled,
  );
  const [lineAiAutoReplyEnabled, setLineAiAutoReplyEnabled] = useState(config.lineAiAutoReplyEnabled);
  const [lineAiDryRun, setLineAiDryRun] = useState(config.lineAiDryRun);
  const [lineAiImageSearchEnabled, setLineAiImageSearchEnabled] = useState(config.lineAiImageSearchEnabled);

  const handleLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLogoError("");
    setLogoUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadLogoImage(formData);
    setLogoUploading(false);

    if (result.error) setLogoError(result.error);
    if (result.url) setLogoUrl(result.url);
    if (logoFileRef.current) logoFileRef.current.value = "";
  };

  const handleLineQrChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLineQrError("");
    setLineQrUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadLogoImage(formData);
    setLineQrUploading(false);

    if (result.error) setLineQrError(result.error);
    if (result.url) setLineQrUrl(result.url);
    if (lineQrFileRef.current) lineQrFileRef.current.value = "";
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !formRef.current) return;

    const formData = new FormData(formRef.current);
    setSaveError("");
    startTransition(async () => {
      const result = await updateCompanySettings(formData);
      if (result.success) {
        setSaved(true);
        setSaveError("");
        setTimeout(() => setSaved(false), 3000);
        return;
      }

      setSaved(false);
      setSaveError(result.error ?? "บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-4 font-kanit font-semibold text-gray-800 dark:text-slate-100">ข้อมูลร้านค้า</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>ชื่อร้าน *</label>
            <input name="shop_name" defaultValue={config.shopName} required className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>คำโปรยร้าน (Slogan)</label>
            <input name="shop_slogan" defaultValue={config.shopSlogan} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>เบอร์โทรหลัก</label>
            <input name="shop_phone" defaultValue={config.shopPhone} className={inputClass} placeholder="0xx-xxx-xxxx" />
          </div>
          <div>
            <label className={labelClass}>เบอร์โทรสำรอง</label>
            <input name="shop_phone_secondary" defaultValue={config.shopPhoneSecondary} className={inputClass} placeholder="0xx-xxx-xxxx" />
          </div>
          <div>
            <label className={labelClass}>อีเมลร้าน</label>
            <input name="shop_email" defaultValue={config.shopEmail} className={inputClass} placeholder="email@example.com" />
          </div>
          <div>
            <label className={labelClass}>เว็บไซต์ร้าน</label>
            <input name="shop_website_url" defaultValue={config.shopWebsiteUrl} className={inputClass} placeholder="https://www.example.com" />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>ที่อยู่ร้าน</label>
            <textarea name="shop_address" defaultValue={config.shopAddress} rows={2} className={inputClass} placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์" />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>โลโกร้าน</label>
            <input type="hidden" name="shop_logo_url" value={logoUrl} />
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="relative flex h-24 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {logoUrl ? (
                  <>
                    <Image src={logoPreviewSrc} alt="logo preview" fill sizes="160px" className="object-contain p-3" />
                    <button
                      type="button"
                      onClick={() => setLogoUrl("")}
                      className="absolute right-0.5 top-0.5 rounded-full border border-gray-200 bg-white p-0.5 transition-colors hover:border-red-300 hover:bg-red-50"
                    >
                      <X size={12} className="text-gray-500 hover:text-red-500" />
                    </button>
                  </>
                ) : (
                  <p className="px-3 text-center text-sm text-gray-400 dark:text-slate-500">ยังไม่มีโลโก้</p>
                )}
              </div>
              <div className="flex-1 space-y-3">
                <input ref={logoFileRef} type="file" accept="image/*" onChange={handleLogoChange} className="hidden" id="logoUpload" />
                <label
                  htmlFor="logoUpload"
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors dark:border-white/10 ${logoUploading ? "cursor-not-allowed bg-gray-50 opacity-60 dark:bg-slate-900" : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}
                >
                  <Upload size={14} />
                  {logoUploading ? "กำลังอัปโหลด..." : "เลือกไฟล์"}
                </label>
                <div className="space-y-1">
                  <p className="text-xs text-gray-400 dark:text-slate-500">JPG, PNG, WebP ไม่เกิน 3MB</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">แนะนำพื้นหลังโปร่งใส และใช้สัดส่วน 1:1, 3:1 หรือ 4:1 เพื่อให้แสดงผลได้ดีทั้งโลโก้แนวนอนและไอคอนร้าน</p>
                </div>
                {logoError && <p className="text-xs text-red-500">{logoError}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-1 font-kanit font-semibold text-gray-800 dark:text-slate-100">ข้อมูลหน้าเพจและการติดต่อ</h2>
        <p className="mb-4 text-xs text-gray-400 dark:text-slate-500">กลุ่มนี้ใช้ควบคุมข้อมูลที่แสดงบนหน้าบ้านและส่วนท้ายเว็บไซต์ทั้งหมด รวมถึงข้อความ Hero</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className={labelClass}>หัวข้อหลักหน้าแรก (Hero Title)</label>
            <input name="hero_title" defaultValue={config.heroTitle} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>คำอธิบายหน้าแรก (Hero Subtitle)</label>
            <textarea name="hero_subtitle" defaultValue={config.heroSubtitle} rows={2} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>LINE ID</label>
            <input name="shop_line_id" defaultValue={config.shopLineId} className={inputClass} placeholder="@xxxxxxx" />
          </div>
          <div>
            <label className={labelClass}>LINE URL</label>
            <input name="shop_line_url" defaultValue={config.shopLineUrl} className={inputClass} placeholder="https://lin.ee/..." />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>QR Code LINE OA</label>
            <input type="hidden" name="shop_line_qr_url" value={lineQrUrl} />
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <div className="relative flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {lineQrUrl ? (
                  <>
                    <Image src={lineQrPreviewSrc} alt="LINE QR Code" fill sizes="96px" className="object-contain p-1" />
                    <button
                      type="button"
                      onClick={() => setLineQrUrl("")}
                      className="absolute right-0.5 top-0.5 rounded-full border border-gray-200 bg-white p-0.5 transition-colors hover:border-red-300 hover:bg-red-50"
                    >
                      <X size={12} className="text-gray-500 hover:text-red-500" />
                    </button>
                  </>
                ) : (
                  <p className="px-2 text-center text-xs text-gray-400 dark:text-slate-500">ยังไม่มี QR</p>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input ref={lineQrFileRef} type="file" accept="image/*" onChange={handleLineQrChange} className="hidden" id="lineQrUpload" />
                <label
                  htmlFor="lineQrUpload"
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium transition-colors dark:border-white/10 ${lineQrUploading ? "cursor-not-allowed bg-gray-50 opacity-60 dark:bg-slate-900" : "bg-white text-gray-700 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"}`}
                >
                  <Upload size={14} />
                  {lineQrUploading ? "กำลังอัปโหลด..." : "เลือกไฟล์ QR"}
                </label>
                <p className="text-xs text-gray-400 dark:text-slate-500">อัปโหลด QR Code ที่ได้จาก LINE OA Manager (PNG, JPG, WebP ไม่เกิน 3MB)</p>
                {lineQrError && <p className="text-xs text-red-500">{lineQrError}</p>}
              </div>
            </div>
          </div>
          <div>
            <label className={labelClass}>เวลาทำการ</label>
            <input name="shop_business_hours" defaultValue={config.shopBusinessHours} className={inputClass} placeholder="จันทร์ - เสาร์ 08:00 - 18:00 น." />
          </div>
          <div>
            <label className={labelClass}>Google Maps URL</label>
            <input name="shop_google_map_url" defaultValue={config.shopGoogleMapUrl} className={inputClass} placeholder="https://maps.app.goo.gl/... หรือ https://www.google.com/maps/..." />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Google Maps Embed URL</label>
            <input name="shop_google_map_embed_url" defaultValue={config.shopGoogleMapEmbedUrl} className={inputClass} placeholder="https://www.google.com/maps/embed?pb=..." />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">ใช้ลิงก์จาก Share &gt; Embed a map เพื่อให้แผนที่แสดงในส่วนท้ายเว็บ</p>
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>วันหยุด / หมายเหตุหน้าร้าน</label>
            <textarea name="shop_holiday_note" defaultValue={config.shopHolidayNote} rows={2} className={inputClass} placeholder="เช่น หยุดทุกวันอาทิตย์ หรือกรุณาโทรยืนยันก่อนเดินทาง" />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>ข้อความติดต่อเพิ่มเติม</label>
            <textarea name="shop_contact_note" defaultValue={config.shopContactNote} rows={3} className={inputClass} placeholder="เช่น มีที่จอดรถหน้าร้าน แนะนำให้นัดรับก่อนเข้ามา หรือข้อมูลเส้นทางเพิ่มเติม" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-1 font-kanit font-semibold text-gray-800 dark:text-slate-100">ช่องทางโซเชียลมีเดีย</h2>
        <p className="mb-4 text-xs text-gray-400 dark:text-slate-500">วาง URL และเปิด/ปิดการแสดงผลในหน้าเว็บ</p>
        <div>
          <SocialRow platform="Facebook" urlName="shop_facebook_url" urlValue={config.shopFacebookUrl} enabledName="shop_facebook_enabled" enabled={facebookEnabled} onToggle={setFacebookEnabled} placeholder="https://facebook.com/yourpage" icon={<FacebookIcon />} />
          <SocialRow platform="TikTok" urlName="shop_tiktok_url" urlValue={config.shopTiktokUrl} enabledName="shop_tiktok_enabled" enabled={tiktokEnabled} onToggle={setTiktokEnabled} placeholder="https://tiktok.com/@yourpage" icon={<TiktokIcon />} />
          <SocialRow platform="Shopee" urlName="shop_shopee_url" urlValue={config.shopShopeeUrl} enabledName="shop_shopee_enabled" enabled={shopeeEnabled} onToggle={setShopeeEnabled} placeholder="https://shopee.co.th/yourshop" icon={<ShopeeLogoIcon className="h-5 w-5" />} />
          <SocialRow platform="Lazada" urlName="shop_lazada_url" urlValue={config.shopLazadaUrl} enabledName="shop_lazada_enabled" enabled={lazadaEnabled} onToggle={setLazadaEnabled} placeholder="https://www.lazada.co.th/shop/yourshop" icon={<LazadaLogoIcon className="h-5 w-5" />} />
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-5 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">การตั้งค่าภาษี (VAT)</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>ประเภทภาษีเริ่มต้น</label>
            <select name="vat_type" defaultValue={config.vatType} className={inputClass}>
              <option value="NO_VAT">ไม่มีภาษี (No VAT)</option>
              <option value="EXCLUDING_VAT">ราคาไม่รวม VAT (Excl. VAT)</option>
              <option value="INCLUDING_VAT">ราคารวม VAT แล้ว (Incl. VAT)</option>
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">ค่าเริ่มต้นสำหรับเอกสารใหม่ สามารถปรับต่อรายการได้ภายหลัง</p>
          </div>
          <div>
            <label className={labelClass}>อัตรา VAT (%)</label>
            <input type="number" name="vat_rate" defaultValue={config.vatRate} min={0} max={100} step={0.01} className={inputClass} placeholder="7" />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">เช่น 7 สำหรับ VAT 7%</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-2 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          Product Search Guardrails
        </h2>
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl space-y-1">
            <p className="text-sm font-medium text-gray-800 dark:text-slate-100">Auto-apply SearchSynonym</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              เปิดให้ Product Search Quality report เขียน SearchSynonym อัตโนมัติจากรายการ dry-run ที่ผ่าน guard แล้วเท่านั้น ระบบยังไม่ auto-apply ProductAlias/OEM หรือ fitment/year
            </p>
          </div>
          <Toggle
            name="product_search_auto_apply_synonyms_enabled"
            checked={productSearchAutoApplySynonymsEnabled}
            onChange={setProductSearchAutoApplySynonymsEnabled}
            label={productSearchAutoApplySynonymsEnabled ? "เปิด" : "ปิด"}
          />
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-2 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          LINE OA AI Agent
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-slate-400">
          ควบคุมผู้ช่วย AI ตอบแชท LINE — ระบบจะเก็บบทสนทนาเสมอ สวิตช์เหล่านี้คุมเฉพาะการตอบ/ค้นหาเท่านั้น
        </p>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 border-b border-gray-50 pb-4 dark:border-white/5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl space-y-1">
              <p className="text-sm font-medium text-gray-800 dark:text-slate-100">เปิดใช้งาน AI ตอบแชท</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                สวิตช์หลัก — ปิด = AI ไม่ทำงาน (เก็บแชทอย่างเดียว), เปิด = AI อ่านข้อความและคิดคำตอบ
              </p>
            </div>
            <Toggle
              name="line_ai_auto_reply_enabled"
              checked={lineAiAutoReplyEnabled}
              onChange={setLineAiAutoReplyEnabled}
              label={lineAiAutoReplyEnabled ? "เปิด" : "ปิด"}
            />
          </div>

          <div className="flex flex-col gap-3 border-b border-gray-50 pb-4 dark:border-white/5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl space-y-1">
              <p className="text-sm font-medium text-gray-800 dark:text-slate-100">โหมดซ้อม (Dry-run)</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                เปิด = AI คิดคำตอบแต่<strong>ไม่ส่งหาลูกค้า</strong> (เก็บไว้ให้ตรวจก่อน), ปิด = ส่งจริง
                — มีผลเฉพาะเมื่อเปิดสวิตช์หลักแล้ว แนะนำให้เปิดไว้ช่วงทดลอง
              </p>
            </div>
            <Toggle
              name="line_ai_dry_run"
              checked={lineAiDryRun}
              onChange={setLineAiDryRun}
              label={lineAiDryRun ? "เปิด" : "ปิด"}
            />
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl space-y-1">
              <p className="text-sm font-medium text-gray-800 dark:text-slate-100">ค้นหาสินค้าจากรูปอะไหล่อัตโนมัติ</p>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                เปิด = เมื่อลูกค้าส่งรูปอะไหล่ AI จะดึงคำใบ้แล้วค้นเว็บร้านเสนอรายการใกล้เคียง (แบบระมัดระวัง),
                ปิด = ส่งรูปให้แอดมินดูเอง
              </p>
            </div>
            <Toggle
              name="line_ai_image_search_enabled"
              checked={lineAiImageSearchEnabled}
              onChange={setLineAiImageSearchEnabled}
              label={lineAiImageSearchEnabled ? "เปิด" : "ปิด"}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-5 border-b border-gray-100 pb-3 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-200">
          ตั้งค่าค่าส่งพนักงาน
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={labelClass}>เปอร์เซ็นต์ค่าส่งเริ่มต้น (%)</label>
            <input
              type="number"
              name="delivery_commission_percent"
              defaultValue={config.deliveryCommissionPercent}
              min={0}
              max={100}
              step={0.01}
              className={inputClass}
              placeholder="30"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
              ใช้เป็นค่าเริ่มต้นตอนทำจ่ายค่าส่งพนักงาน และจะถูกบันทึก snapshot ลงเอกสารแต่ละรอบ
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <h2 className="mb-1 font-kanit font-semibold text-gray-800 dark:text-slate-100">โปรดทราบในฟอร์มพิมพ์</h2>
        <p className="mb-4 text-xs text-gray-400 dark:text-slate-500">ใช้กับใบแจ้งหนี้ / ใบส่งของ และใบเสร็จรับเงิน โดยระบบรับไม่เกิน 5 บรรทัด</p>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className={labelClass}>รายละเอียดโปรดทราบ</label>
            <textarea
              name="print_notice_text"
              defaultValue={config.printNoticeText}
              rows={5}
              className={inputClass}
              placeholder={"1. เก็บเอกสารนี้ไว้เป็นหลักฐาน\n2. ตรวจสอบสินค้าและจำนวนก่อนรับของ\n3. ติดต่อร้านเมื่อพบความผิดปกติ"}
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">บรรทัดว่างจะไม่ถูกนำไปแสดงในฟอร์มพิมพ์</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={isPending || !canManage} className="flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#163055] disabled:opacity-60">
          <Save size={16} />
          {isPending ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
        </button>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle size={16} />
            บันทึกสำเร็จ หน้าเว็บอัปเดตแล้ว
          </span>
        )}
        {saveError && <span className="text-sm text-red-600">{saveError}</span>}
      </div>
    </form>
  );
};

export default CompanySettingsForm;
