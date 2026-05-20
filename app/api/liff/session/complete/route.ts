import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import {
  clearLiffCustomerSession,
  setLiffCustomerSessionFromTransferToken,
} from "@/lib/liff-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const redirectUrl = new URL("/liff/orders", request.url);
  const linkUrl = new URL("/liff/link", request.url);

  try {
    const formData = await request.formData();
    const sessionToken = formData.get("sessionToken");
    const session = await setLiffCustomerSessionFromTransferToken(
      typeof sessionToken === "string" ? sessionToken : "",
    );
    const customer = await db.customer.findFirst({
      where: {
        id: session.customerId,
        lineUserId: session.lineUserId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!customer) {
      await clearLiffCustomerSession();
      return NextResponse.redirect(linkUrl, 303);
    }

    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    console.error("[liff/session/complete]", error);
    await clearLiffCustomerSession();
    return NextResponse.redirect(linkUrl, 303);
  }
}
