import { NextResponse } from "next/server";

import { verifyLiffIdToken } from "@/lib/liff-auth";
import { resolveCustomerByLineUserId } from "@/lib/liff-customer";
import {
  clearLiffCustomerSession,
  createLiffSessionTransferToken,
  setLiffCustomerSession,
} from "@/lib/liff-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: unknown };
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const identity = await verifyLiffIdToken(idToken);
    const customer = await resolveCustomerByLineUserId(identity.lineUserId);

    if (!customer) {
      await clearLiffCustomerSession();
      return NextResponse.json({ linked: false });
    }

    const session = {
      customerId: customer.id,
      lineUserId: identity.lineUserId,
    };

    await setLiffCustomerSession(session);

    return NextResponse.json({
      linked: true,
      sessionToken: createLiffSessionTransferToken(session),
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        source: customer.source,
        lineLinkedAt: customer.lineLinkedAt,
      },
    });
  } catch (error) {
    console.error("[liff/session]", error);
    await clearLiffCustomerSession();
    return NextResponse.json(
      { linked: false, error: "ไม่สามารถยืนยันตัวตน LINE ได้" },
      { status: 401 },
    );
  }
}
