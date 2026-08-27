export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/require-auth";

/** ไม่มีหน้ารวมทุกช่องทาง — ส่งกลับไปที่รอบรับเงินของช่องทางแรกที่ตั้งค่าไว้ */
export default async function Page() {
  await requirePermission("marketplace.manage");
  redirect("/admin/sales/lazada/settlements");
}
