import { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  privateFileNotFoundResponse,
  privateFileRouteErrorResponse,
  respondWithStoredFile,
} from "@/lib/private-file-response";
import { DELIVERY_PROOF_ROOT } from "@/lib/private-file-ref";
import { requireAnyPermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().min(1).max(50).regex(/^[a-z0-9]+$/),
  kind: z.enum(["signature", "photo"]),
});

/**
 * Streams a delivery-proof image (recipient signature or delivery photo — PII).
 * Proofs are shown on the sale detail / sale proof history pages (`sales.view`)
 * and in the mobile delivery sheet (`delivery.view`), so either permission may
 * view them. New images live in the private Blob store; legacy rows holding a
 * public URL redirect to it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; kind: string }> },
): Promise<Response> {
  try {
    await requireAnyPermission(["sales.view", "delivery.view"]);

    const parsed = paramsSchema.safeParse(await params);
    if (!parsed.success) return privateFileNotFoundResponse();

    const proof = await db.deliveryProof.findUnique({
      where: { id: parsed.data.id },
      select: { signatureImageUrl: true, deliveryPhotoUrl: true },
    });
    if (!proof) return privateFileNotFoundResponse();

    return await respondWithStoredFile({
      storedValue: parsed.data.kind === "signature" ? proof.signatureImageUrl : proof.deliveryPhotoUrl,
      root: DELIVERY_PROOF_ROOT,
    });
  } catch (error) {
    return privateFileRouteErrorResponse(error, "delivery-proof-view");
  }
}
