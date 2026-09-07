import { requirePermission } from "@/lib/require-auth";
import QuotationEditor from "../QuotationEditor";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export default async function NewQuotationPage() {
  await requirePermission("sales_quotations.create");
  return <QuotationEditor />;
}
