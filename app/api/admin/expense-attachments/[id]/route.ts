import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { EXPENSE_ATTACHMENT_ROOT } from "@/lib/expense-attachment-constants";
import {
  privateFileNotFoundResponse,
  privateFileRouteErrorResponse,
  respondWithStoredFile,
} from "@/lib/private-file-response";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9]+$/),
});

/**
 * Streams one expense attachment (transfer slip / receipt — PII) to an admin
 * with the same `expenses.view` permission the expense pages require. New files
 * live in the private Blob store; legacy rows holding a public URL redirect to it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requirePermission("expenses.view");

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) return privateFileNotFoundResponse();

    const attachment = await db.expenseAttachment.findUnique({
      where: { id: parsed.data.id },
      select: { url: true, fileName: true },
    });
    if (!attachment) return privateFileNotFoundResponse();

    return await respondWithStoredFile({
      storedValue: attachment.url,
      root: EXPENSE_ATTACHMENT_ROOT,
      fileName: attachment.fileName,
    });
  } catch (error) {
    return privateFileRouteErrorResponse(error, "expense-attachment-view");
  }
}
