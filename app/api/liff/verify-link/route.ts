import { NextResponse } from "next/server";

import { verifyLiffIdToken } from "@/lib/liff-auth";
import { resolveLiffCustomerFromPhone } from "@/lib/liff-customer";
import { setLiffCustomerSession } from "@/lib/liff-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: unknown; phone?: unknown };
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const phone = typeof body.phone === "string" ? body.phone : "";
    const identity = await verifyLiffIdToken(idToken);
    const result = await resolveLiffCustomerFromPhone({
      lineUserId: identity.lineUserId,
      displayName: identity.displayName,
      phone,
    });

    if (result.status === "LINKED" || result.status === "REGISTERED") {
      await setLiffCustomerSession({
        customerId: result.customerId,
        lineUserId: identity.lineUserId,
      });
    }

    return NextResponse.json(result, {
      status: result.status === "BLOCKED" || result.status === "AMBIGUOUS" ? 409 : 200,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

    console.error("[liff/verify-link]", error);

    return NextResponse.json({ status: "ERROR", message }, { status: 400 });
  }
}
