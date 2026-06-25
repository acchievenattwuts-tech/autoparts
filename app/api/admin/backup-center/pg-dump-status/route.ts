import { NextResponse } from "next/server";

import { checkPgDumpStatus } from "@/lib/backup-center";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  await requirePermission("system.backup");
  const status = await checkPgDumpStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
