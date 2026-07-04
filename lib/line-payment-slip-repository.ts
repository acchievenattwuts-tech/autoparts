import { db } from "@/lib/db";
import { Prisma, PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import { getInitialPaymentSlipStatus, type PaymentSlipOcr } from "@/lib/line-payment-slip-service";

const DEFAULT_TAKE = 50;
const MAX_TAKE = 100;

function normalizeTake(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TAKE;
  return Math.min(MAX_TAKE, Math.max(1, Math.trunc(value)));
}

function toRawOcr(ocr: PaymentSlipOcr): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(ocr)) as Prisma.InputJsonValue;
}

/**
 * Persists a payment-slip submission with advisory OCR fields. Stored separately
 * from transactional truth — never confirms a payment or touches receipt/AR.
 */
export async function createPaymentSlip(input: {
  conversationId?: string | null;
  messengerConversationId?: string | null;
  lineUserId?: string | null;
  lineMessageId?: string | null;
  ocr: PaymentSlipOcr;
}) {
  return db.paymentSlip.create({
    data: {
      conversationId: input.conversationId ?? null,
      messengerConversationId: input.messengerConversationId ?? null,
      lineUserId: input.lineUserId ?? null,
      lineMessageId: input.lineMessageId ?? null,
      detectedAmount: input.ocr.amount ?? null,
      detectedTransferDatetime: input.ocr.transferDatetimeIso
        ? new Date(input.ocr.transferDatetimeIso)
        : null,
      detectedBank: input.ocr.bank,
      detectedSenderName: input.ocr.senderName,
      detectedReceiverName: input.ocr.receiverName,
      detectedReferenceNo: input.ocr.referenceNo,
      verificationStatus: getInitialPaymentSlipStatus(),
      rawOcr: toRawOcr(input.ocr),
    },
    select: { id: true, verificationStatus: true, createdAt: true },
  });
}

export async function setPaymentSlipImagePath(input: { id: string; imageUrl: string | null }) {
  return db.paymentSlip.update({
    where: { id: input.id },
    data: { imageUrl: input.imageUrl },
    select: { id: true },
  });
}

export async function listPaymentSlips(input: {
  status?: PaymentSlipVerificationStatus | null;
  take?: number | null;
}) {
  return db.paymentSlip.findMany({
    where: input.status ? { verificationStatus: input.status } : undefined,
    select: {
      id: true,
      lineUserId: true,
      detectedAmount: true,
      detectedTransferDatetime: true,
      detectedBank: true,
      detectedSenderName: true,
      verificationStatus: true,
      createdAt: true,
      conversation: {
        select: { id: true, displayName: true, customer: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: normalizeTake(input.take),
  });
}

/**
 * Lists a customer's LINE payment slips (newest first) via their linked
 * conversation (`LineConversation.customerId`). View-only; no image URLs are
 * resolved here — the customer page links out to the slip detail page instead.
 */
export async function listPaymentSlipsByCustomer(customerId: string, take = 30) {
  return db.paymentSlip.findMany({
    where: { conversation: { customerId } },
    select: {
      id: true,
      detectedAmount: true,
      detectedTransferDatetime: true,
      detectedBank: true,
      detectedSenderName: true,
      detectedReferenceNo: true,
      verificationStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function getPaymentSlipById(id: string) {
  return db.paymentSlip.findUnique({
    where: { id },
    select: {
      id: true,
      lineUserId: true,
      lineMessageId: true,
      imageUrl: true,
      detectedAmount: true,
      detectedTransferDatetime: true,
      detectedBank: true,
      detectedSenderName: true,
      detectedReceiverName: true,
      detectedReferenceNo: true,
      verificationStatus: true,
      rawOcr: true,
      createdAt: true,
      reviewedAt: true,
      reviewedBy: { select: { id: true, name: true } },
      conversation: {
        select: {
          id: true,
          displayName: true,
          lineUserId: true,
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });
}

/**
 * Admin review decision. Updates only the slip's own verification state and
 * reviewer metadata — it never writes to receipts/AR/stock.
 */
export async function reviewPaymentSlip(input: {
  id: string;
  adminUserId: string;
  status: PaymentSlipVerificationStatus;
}) {
  return db.paymentSlip.update({
    where: { id: input.id },
    data: {
      verificationStatus: input.status,
      reviewedById: input.adminUserId,
      reviewedAt: new Date(),
    },
    select: { id: true, verificationStatus: true },
  });
}
