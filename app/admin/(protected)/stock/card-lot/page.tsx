import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/require-auth";

export default async function StockCardLotAliasPage() {
  await requirePermission("lot_reports.view");
  redirect("/admin/lots/balance");
}
