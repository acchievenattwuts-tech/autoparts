import { NextResponse } from "next/server";

import { verifyLiffIdToken } from "@/lib/liff-auth";
import { resolveCustomerByLineUserId } from "@/lib/liff-customer";
import { clearLiffCustomerSession, setLiffCustomerSession } from "@/lib/liff-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const redirectUrl = new URL("/liff/orders", request.url);
  const linkUrl = new URL("/liff/link", request.url);

  try {
    const formData = await request.formData();
    const idToken = formData.get("idToken");
    const identity = await verifyLiffIdToken(typeof idToken === "string" ? idToken : "");
    const customer = await resolveCustomerByLineUserId(identity.lineUserId);

    if (!customer) {
      await clearLiffCustomerSession();
      return NextResponse.redirect(linkUrl, 303);
    }

    await setLiffCustomerSession({
      customerId: customer.id,
      lineUserId: identity.lineUserId,
    });

    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    console.error("[liff/session/complete]", error);
    await clearLiffCustomerSession();
    return NextResponse.redirect(linkUrl, 303);
  }
}
