import { NextRequest } from "next/server";

import { lineAdminApiErrorResponse } from "@/lib/line-admin-api";
import { getPaymentSlipById } from "@/lib/line-payment-slip-repository";
import { readPaymentSlipImage } from "@/lib/line-payment-slip-storage";
import { requirePermission } from "@/lib/require-auth";

export const dynamic = "force-dynamic";

/**
 * Streams a payment-slip image to an authenticated admin. Slips are PII, so unlike
 * public product images they are never exposed by a public URL — this route is the
 * only way to view them and it enforces the same `line_payment_slips.view`
 * permission as the slip pages. Used when slips live in the private Vercel Blob
 * store; `readPaymentSlipImage` falls back to Supabase for not-yet-migrated slips.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requirePermission("line_payment_slips.view");

    const { id } = await params;
    const slip = await getPaymentSlipById(id);
    if (!slip?.imageUrl) {
      return new Response("Not Found", { status: 404 });
    }

    const image = await readPaymentSlipImage(slip.imageUrl);
    if (!image) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(image.stream, {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        // PII: browser-only cache, short-lived, never a shared/CDN cache.
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return lineAdminApiErrorResponse(error);
  }
}
