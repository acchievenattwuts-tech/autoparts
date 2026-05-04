import { redirect } from "next/navigation";

import { getLiffCustomerSession } from "@/lib/liff-session";

export default async function LiffHomePage() {
  const session = await getLiffCustomerSession();
  redirect(session ? "/liff/orders" : "/liff/link");
}
