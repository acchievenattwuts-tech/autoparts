import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  privateFileNotFoundResponse,
  privateFileRouteErrorResponse,
  respondWithStoredFile,
} from "@/lib/private-file-response";
import { requirePermission } from "@/lib/require-auth";
import { WHT_ATTACHMENT_ROOT } from "@/lib/wht-attachment-constants";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9]+$/),
});

/**
 * Streams one WHT certificate (50 ทวิ) attachment — it carries tax IDs (PII) —
 * to an admin with the same `wht.view` permission the `/admin/wht` page requires.
 * New files live in the private Blob store; legacy rows holding a public URL
 * redirect to it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requirePermission("wht.view");

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) return privateFileNotFoundResponse();

    const attachment = await db.whtReceivedAttachment.findUnique({
      where: { id: parsed.data.id },
      select: { url: true, fileName: true },
    });
    if (!attachment) return privateFileNotFoundResponse();

    return await respondWithStoredFile({
      storedValue: attachment.url,
      root: WHT_ATTACHMENT_ROOT,
      fileName: attachment.fileName,
    });
  } catch (error) {
    return privateFileRouteErrorResponse(error, "wht-attachment-view");
  }
}
