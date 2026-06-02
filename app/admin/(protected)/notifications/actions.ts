"use server";

import { revalidatePath } from "next/cache";

import { getRequiredSession } from "@/lib/require-auth";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function markAllNotificationsReadAction(): Promise<void> {
  const session = await getRequiredSession();
  await markAllNotificationsRead(session.user.id);
  revalidatePath("/admin/notifications");
}
