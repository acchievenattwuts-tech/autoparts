import { requirePermission } from "@/lib/require-auth";
import QuotationEditor from "../../QuotationEditor";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function EditQuotationPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales_quotations.update");
  return <QuotationEditor id={(await params).id} />;
}
