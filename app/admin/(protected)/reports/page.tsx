import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/require-auth";

export default async function ReportsPage() {
  await requirePermission("reports.view");
  redirect("/admin/reports/sales");
}
