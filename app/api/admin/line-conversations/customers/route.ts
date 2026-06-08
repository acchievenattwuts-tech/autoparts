import { NextRequest, NextResponse } from "next/server";

import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { searchCustomersForConversationLink } from "@/lib/line-conversation-repository";
import { requirePermission } from "@/lib/require-auth";

export async function GET(request: NextRequest) {
  try {
    await requirePermission("line_conversations.manage");
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const customers = await searchCustomersForConversationLink({ query, take: 10 });
    return NextResponse.json({ customers });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
