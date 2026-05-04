import { db } from "@/lib/db";
import { generateCustomerCode } from "@/lib/entity-code";
import { AuditAction } from "@/lib/generated/prisma";
import { getRequestContext, safeWriteAuditLog } from "@/lib/audit-log";
import { buildCustomerPhoneLookupValues, normalizeCustomerPhone } from "@/lib/customer-phone";

const PHONE_LOOKUP_LIMIT = 5;
const PHONE_LOOKUP_WINDOW_MS = 60 * 60 * 1000;

type PhoneAttemptBucket = {
  count: number;
  resetAt: number;
};

const phoneLookupAttempts = new Map<string, PhoneAttemptBucket>();

export type LiffLinkResult =
  | { status: "LINKED"; customerId: string; customerName: string }
  | { status: "REGISTERED"; customerId: string; customerName: string }
  | { status: "BLOCKED"; message: string }
  | { status: "AMBIGUOUS"; message: string };

export function assertLiffPhoneLookupAllowed(lineUserId: string) {
  const now = Date.now();
  const existing = phoneLookupAttempts.get(lineUserId);

  if (!existing || existing.resetAt <= now) {
    phoneLookupAttempts.set(lineUserId, { count: 1, resetAt: now + PHONE_LOOKUP_WINDOW_MS });
    return;
  }

  if (existing.count >= PHONE_LOOKUP_LIMIT) {
    throw new Error("ลองหลายครั้งเกินไป กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่อีกครั้ง");
  }

  existing.count += 1;
}

async function writeCustomerLineAudit(input: {
  action: AuditAction;
  customerId?: string | null;
  customerRef?: string | null;
  meta?: unknown;
}) {
  await safeWriteAuditLog({
    ...(await getRequestContext()),
    action: input.action,
    entityType: "Customer",
    entityId: input.customerId ?? null,
    entityRef: input.customerRef ?? null,
    meta: input.meta,
  });
}

export async function resolveCustomerByLineUserId(lineUserId: string) {
  return db.customer.findFirst({
    where: { lineUserId, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      lineUserId: true,
      lineLinkedAt: true,
      source: true,
    },
  });
}

export async function resolveLiffCustomerFromPhone(input: {
  lineUserId: string;
  displayName: string | null;
  phone: string;
}): Promise<LiffLinkResult> {
  assertLiffPhoneLookupAllowed(input.lineUserId);

  const normalizedPhone = normalizeCustomerPhone(input.phone);
  if (!normalizedPhone) {
    throw new Error("กรุณาระบุเบอร์โทรศัพท์");
  }
  const phoneVariants = buildCustomerPhoneLookupValues(normalizedPhone);
  const matchedCustomers = await db.customer.findMany({
    where: { phone: { in: phoneVariants }, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      lineUserId: true,
    },
    take: 2,
  });

  if (matchedCustomers.length > 1) {
    await writeCustomerLineAudit({
      action: AuditAction.LINE_LINK_AMBIGUOUS,
      meta: { lineUserId: input.lineUserId, phone: normalizedPhone, matchedCount: matchedCustomers.length },
    });
    return {
      status: "AMBIGUOUS",
      message: "พบบัญชีหลายรายการจากเบอร์นี้ กรุณาติดต่อร้านเพื่อยืนยันข้อมูล",
    };
  }

  const matchedCustomer = matchedCustomers[0];

  if (matchedCustomer?.lineUserId && matchedCustomer.lineUserId !== input.lineUserId) {
    await writeCustomerLineAudit({
      action: AuditAction.LINE_LINK_BLOCKED,
      customerId: matchedCustomer.id,
      customerRef: matchedCustomer.code ?? matchedCustomer.name,
      meta: { lineUserId: input.lineUserId, phone: normalizedPhone },
    });
    return {
      status: "BLOCKED",
      message: "เบอร์นี้ผูกกับ LINE อื่นแล้ว กรุณาติดต่อร้านเพื่อให้พนักงานตรวจสอบ",
    };
  }

  if (matchedCustomer) {
    const customer = await db.customer.update({
      where: { id: matchedCustomer.id },
      data: {
        phone: normalizedPhone,
        lineUserId: input.lineUserId,
        lineLinkedAt: new Date(),
      },
      select: { id: true, code: true, name: true },
    });

    await writeCustomerLineAudit({
      action: AuditAction.LINE_LINK,
      customerId: customer.id,
      customerRef: customer.code ?? customer.name,
      meta: { lineUserId: input.lineUserId, phone: normalizedPhone },
    });

    return { status: "LINKED", customerId: customer.id, customerName: customer.name };
  }

  const code = await generateCustomerCode();
  const customer = await db.customer.create({
    data: {
      code,
      name: input.displayName?.trim() || "ลูกค้า LINE",
      phone: normalizedPhone,
      source: "LINE_LIFF",
      lineUserId: input.lineUserId,
      lineLinkedAt: new Date(),
    },
    select: { id: true, code: true, name: true },
  });

  await writeCustomerLineAudit({
    action: AuditAction.LINE_REGISTER,
    customerId: customer.id,
    customerRef: customer.code ?? customer.name,
    meta: { lineUserId: input.lineUserId, phone: normalizedPhone, source: "LINE_LIFF" },
  });

  return { status: "REGISTERED", customerId: customer.id, customerName: customer.name };
}
