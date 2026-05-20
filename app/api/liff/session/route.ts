import { NextResponse } from "next/server";

import { verifyLiffIdentity } from "@/lib/liff-auth";
import { resolveCustomerByLineUserId } from "@/lib/liff-customer";
import {
  clearLiffCustomerSession,
  createLiffSessionTransferToken,
  setLiffCustomerSession,
} from "@/lib/liff-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { accessToken?: unknown; idToken?: unknown };
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
    const idToken = typeof body.idToken === "string" ? body.idToken : "";
    const identity = await verifyLiffIdentity({ accessToken, idToken });
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
