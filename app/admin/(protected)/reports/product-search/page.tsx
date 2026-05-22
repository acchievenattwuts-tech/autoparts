export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/require-auth";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function ProductSearchReportRedirectPage({ searchParams }: PageProps) {
  await requirePermission("product_search_report.view");
  const params = await searchParams;
  const target = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) target.set(key, value);
  }

  redirect(`/admin/reports/product-search-no-result${target.size > 0 ? `?${target.toString()}` : ""}`);
}
