"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { MANUAL_SHOPEE_SHOP_ID } from "@/lib/shopee/manual";

const setupSchema = z.object({
  settlementCashBankAccountId: z.string().min(1),
  defaultCustomerId: z.string().min(1),
});

export async function saveManualShopeeSetup(formData: FormData) {
  const session = await requirePermission("marketplace.manage").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsed = setupSchema.safeParse({
    settlementCashBankAccountId: formData.get("settlementCashBankAccountId"),
    defaultCustomerId: formData.get("defaultCustomerId"),
  });
  if (!parsed.success) return { error: "กรุณาเลือกบัญชีพักเงินและลูกค้าเริ่มต้น" };

  const [account, customer] = await Promise.all([
    db.cashBankAccount.findFirst({ where: { id: parsed.data.settlementCashBankAccountId, isActive: true }, select: { id: true } }),
    db.customer.findFirst({ where: { id: parsed.data.defaultCustomerId, isActive: true }, select: { id: true } }),
  ]);
  if (!account) return { error: "ไม่พบบัญชีพักเงินที่ใช้งานอยู่" };
  if (!customer) return { error: "ไม่พบลูกค้าเริ่มต้นที่ใช้งานอยู่" };

  await db.shopeeShop.upsert({
    where: { shopId: MANUAL_SHOPEE_SHOP_ID },
    create: {
      shopId: MANUAL_SHOPEE_SHOP_ID,
      shopName: "Shopee (บันทึกเอง)",
      region: "TH",
      manualMode: true,
      syncEnabled: false,
      settlementCashBankAccountId: account.id,
      defaultCustomerId: customer.id,
      authorizedByUserId: session.user.id,
    },
    update: {
      manualMode: true,
      syncEnabled: false,
      settlementCashBankAccountId: account.id,
      defaultCustomerId: customer.id,
      authorizedByUserId: session.user.id,
    },
  });
  revalidatePath("/admin/sales/shopee/new");
  revalidatePath("/admin/sales/shopee/settlements");
  return { success: true };
}
