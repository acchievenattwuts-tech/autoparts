import { revalidateTag } from "next/cache";

/**
 * Cache tag ของข้อมูล Profit Dashboard (lib/profit-dashboard.ts)
 * แยกไฟล์ไว้เพื่อให้ Server Action ที่แก้ FactProfit import ได้โดยไม่ต้องดึง
 * query layer ทั้งก้อนเข้ามา
 */
export const PROFIT_DASHBOARD_CACHE_TAG = "profit-dashboard";

/**
 * ล้างแคช Profit Dashboard หลังเอกสารที่กระทบกำไรถูกบันทึก/แก้ไข/ยกเลิก
 *
 * ต้องเรียก "หลัง" db.$transaction() commit แล้วเท่านั้น และห้ามให้ error
 * จากการล้างแคชทำให้ business flow ล้ม (ตาม .rules — notification/cache
 * side-effect ต้องไม่ทำลาย flow หลัก)
 */
export function revalidateProfitDashboardCache(): void {
  try {
    revalidateTag(PROFIT_DASHBOARD_CACHE_TAG, "max");
  } catch (error) {
    console.error("[profit-cache] revalidateTag failed", error);
  }
}
