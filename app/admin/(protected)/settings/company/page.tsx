import { getSiteConfig } from "@/lib/site-config";
import CompanySettingsForm from "./CompanySettingsForm";

const CompanySettingsPage = async () => {
  const config = await getSiteConfig();
  return (
    <div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-2">ตั้งค่าร้านค้า</h1>
      <p className="text-sm text-gray-500 mb-6">ข้อมูลร้านที่แก้ไขแล้วจะอัปเดตหน้าเว็บไซต์ทันที</p>
      <CompanySettingsForm config={config} />
    </div>
  );
};

export default CompanySettingsPage;
