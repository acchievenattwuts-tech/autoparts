export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/require-auth";

interface PageProps {
  searchParams: Promise<{ filter?: string }>;
}

export default async function SearchCoverageRedirectPage({ searchParams }: PageProps) {
  await requirePermission("search_coverage.view");
  const params = await searchParams;

  redirect(
    `/admin/reports/search-coverage-audit${params.filter ? `?filter=${encodeURIComponent(params.filter)}` : ""}`,
  );
}
