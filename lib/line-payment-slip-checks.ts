import { db } from "@/lib/db";
import { CashBankAccountType, PaymentSlipVerificationStatus, Prisma } from "@/lib/generated/prisma";
import {
  buildPaymentSlipWarnings,
  checkPaymentSlipReceiver,
  getPaymentSlipDuplicateKind,
  getPaymentSlipTransferMinuteRange,
  normalizePaymentSlipReferenceKey,
  type PaymentSlipDuplicateFields,
  type PaymentSlipDuplicateKind,
  type PaymentSlipReceiverCheck,
  type PaymentSlipWarning,
} from "@/lib/line-payment-slip-check-rules";
import { formatPaymentSlipBaht } from "@/lib/line-payment-slip-display";
import type { PaymentSlipOcr } from "@/lib/line-payment-slip-service";
import { notifyPaymentSlipFlagged } from "@/lib/notifications";

/**
 * Automatic payment-slip checks against the database: the same slip sent before
 * (reference number, or amount + transfer minute) and a receiver name that is not
 * one of the shop's active bank accounts. Advisory only — never changes a slip's
 * status, receipts, AR or cash/bank.
 */

/** Other slips listed on one slip's page; more than this is already a red flag. */
const MAX_DUPLICATES_PER_SLIP = 20;
/** Upper bound for the list page's batched duplicate lookup. */
const MAX_LIST_DUPLICATE_CANDIDATES = 500;

export type PaymentSlipChannelLabel = "LINE" | "Messenger";

export type PaymentSlipCheckInput = PaymentSlipDuplicateFields & {
  receiverName: string | null;
};

export type PaymentSlipDuplicateMatch = {
  id: string;
  kind: PaymentSlipDuplicateKind;
  createdAt: Date;
  verificationStatus: PaymentSlipVerificationStatus;
  amount: number | null;
  channelLabel: PaymentSlipChannelLabel;
  customerLabel: string | null;
};

export type PaymentSlipCheckResult = {
  duplicates: PaymentSlipDuplicateMatch[];
  receiver: PaymentSlipReceiverCheck;
  referenceReadable: boolean;
  warnings: PaymentSlipWarning[];
};

type DecimalLike = { toString(): string };

function decimalToNumber(value: DecimalLike | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Maps a stored PaymentSlip row to the fields the checks compare. */
export function toPaymentSlipCheckInput(row: {
  id: string;
  referenceNoKey: string | null;
  detectedAmount: DecimalLike | null;
  detectedTransferDatetime: Date | null;
  detectedReceiverName: string | null;
}): PaymentSlipCheckInput {
  return {
    id: row.id,
    referenceNoKey: row.referenceNoKey,
    amount: decimalToNumber(row.detectedAmount),
    transferDatetime: row.detectedTransferDatetime,
    receiverName: row.detectedReceiverName,
  };
}

/** Names of the shop's active BANK-type cash/bank accounts — the accepted receivers. */
export async function loadPaymentSlipReceiverAccountNames(): Promise<string[]> {
  const accounts = await db.cashBankAccount.findMany({
    where: { type: CashBankAccountType.BANK, isActive: true },
    select: { name: true },
  });
  return accounts.map((account) => account.name);
}

function buildDuplicateCandidateWhere(
  targets: readonly PaymentSlipDuplicateFields[],
): Prisma.PaymentSlipWhereInput | null {
  const conditions: Prisma.PaymentSlipWhereInput[] = [];
  const keys = Array.from(
    new Set(targets.map((target) => target.referenceNoKey).filter((key): key is string => Boolean(key))),
  );
  if (keys.length > 0) conditions.push({ referenceNoKey: { in: keys } });
  for (const target of targets) {
    if (target.amount === null || !target.transferDatetime) continue;
    conditions.push({
      detectedAmount: target.amount,
      detectedTransferDatetime: getPaymentSlipTransferMinuteRange(target.transferDatetime),
    });
  }
  return conditions.length > 0 ? { OR: conditions } : null;
}

function getCustomerLabel(row: {
  conversation: { displayName: string | null; customer: { name: string } | null } | null;
  messengerConversation: { displayName: string | null } | null;
}): string | null {
  return (
    row.conversation?.customer?.name ??
    row.conversation?.displayName ??
    row.messengerConversation?.displayName ??
    null
  );
}

/** Earlier/later slips that look like the same transfer as `target`. */
export async function findPaymentSlipDuplicates(
  target: PaymentSlipDuplicateFields,
): Promise<PaymentSlipDuplicateMatch[]> {
  const where = buildDuplicateCandidateWhere([target]);
  if (!where) return [];

  const rows = await db.paymentSlip.findMany({
    where: { AND: [where, { id: { not: target.id } }] },
    select: {
      id: true,
      referenceNoKey: true,
      detectedAmount: true,
      detectedTransferDatetime: true,
      verificationStatus: true,
      createdAt: true,
      messengerConversationId: true,
      conversation: { select: { displayName: true, customer: { select: { name: true } } } },
      messengerConversation: { select: { displayName: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_DUPLICATES_PER_SLIP,
  });

  const matches: PaymentSlipDuplicateMatch[] = [];
  for (const row of rows) {
    const amount = decimalToNumber(row.detectedAmount);
    const kind = getPaymentSlipDuplicateKind(target, {
      id: row.id,
      referenceNoKey: row.referenceNoKey,
      amount,
      transferDatetime: row.detectedTransferDatetime,
    });
    if (!kind) continue;
    matches.push({
      id: row.id,
      kind,
      createdAt: row.createdAt,
      verificationStatus: row.verificationStatus,
      amount,
      channelLabel: row.messengerConversationId ? "Messenger" : "LINE",
      customerLabel: getCustomerLabel(row),
    });
  }
  return matches;
}

/** Runs every check for one slip (slip page, review audit, new-slip alert). */
export async function evaluatePaymentSlipChecks(slip: PaymentSlipCheckInput): Promise<PaymentSlipCheckResult> {
  const [duplicates, accountNames] = await Promise.all([
    findPaymentSlipDuplicates(slip),
    loadPaymentSlipReceiverAccountNames(),
  ]);
  const receiver = checkPaymentSlipReceiver(slip.receiverName, accountNames);
  return {
    duplicates,
    receiver,
    referenceReadable: slip.referenceNoKey !== null,
    warnings: buildPaymentSlipWarnings({ duplicateKinds: duplicates.map((match) => match.kind), receiver }),
  };
}

/**
 * Warnings for every slip on the list page with two queries total (duplicate
 * candidates + bank-account names), instead of one lookup per row.
 */
export async function getPaymentSlipListWarnings(
  slips: readonly PaymentSlipCheckInput[],
): Promise<Map<string, PaymentSlipWarning[]>> {
  const result = new Map<string, PaymentSlipWarning[]>();
  if (slips.length === 0) return result;

  const where = buildDuplicateCandidateWhere(slips);
  const [candidateRows, accountNames] = await Promise.all([
    where
      ? db.paymentSlip.findMany({
          where,
          select: { id: true, referenceNoKey: true, detectedAmount: true, detectedTransferDatetime: true },
          take: MAX_LIST_DUPLICATE_CANDIDATES,
        })
      : Promise.resolve([]),
    loadPaymentSlipReceiverAccountNames(),
  ]);
  const candidates: PaymentSlipDuplicateFields[] = candidateRows.map((row) => ({
    id: row.id,
    referenceNoKey: row.referenceNoKey,
    amount: decimalToNumber(row.detectedAmount),
    transferDatetime: row.detectedTransferDatetime,
  }));

  for (const slip of slips) {
    const duplicateKinds = candidates
      .map((candidate) => getPaymentSlipDuplicateKind(slip, candidate))
      .filter((kind): kind is PaymentSlipDuplicateKind => kind !== null);
    const receiver = checkPaymentSlipReceiver(slip.receiverName, accountNames);
    result.set(slip.id, buildPaymentSlipWarnings({ duplicateKinds, receiver }));
  }
  return result;
}

async function loadSlipCustomerLabel(input: {
  lineConversationId?: string | null;
  messengerConversationId?: string | null;
}): Promise<string | null> {
  if (input.lineConversationId) {
    const conversation = await db.lineConversation.findUnique({
      where: { id: input.lineConversationId },
      select: { displayName: true, customer: { select: { name: true } } },
    });
    return conversation?.customer?.name ?? conversation?.displayName ?? null;
  }
  if (input.messengerConversationId) {
    const conversation = await db.messengerConversation.findUnique({
      where: { id: input.messengerConversationId },
      select: { displayName: true },
    });
    return conversation?.displayName ?? null;
  }
  return null;
}

/**
 * Checks a slip right after it is saved and alerts admins (bell + Telegram) when
 * something looks wrong. Never throws: a failed check must not block saving the
 * slip or the bot's reply to the customer.
 */
export async function checkNewPaymentSlipAndNotify(input: {
  slipId: string;
  ocr: PaymentSlipOcr;
  channelLabel: PaymentSlipChannelLabel;
  lineConversationId?: string | null;
  messengerConversationId?: string | null;
}): Promise<PaymentSlipWarning[]> {
  let warnings: PaymentSlipWarning[];
  try {
    const result = await evaluatePaymentSlipChecks({
      id: input.slipId,
      referenceNoKey: normalizePaymentSlipReferenceKey(input.ocr.referenceNo),
      amount: input.ocr.amount,
      transferDatetime: input.ocr.transferDatetimeIso ? new Date(input.ocr.transferDatetimeIso) : null,
      receiverName: input.ocr.receiverName,
    });
    warnings = result.warnings;
  } catch (error) {
    console.error("[payment-slip-checks] check failed", {
      slipId: input.slipId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
  if (warnings.length === 0) return warnings;

  try {
    const customerLabel = await loadSlipCustomerLabel(input);
    await notifyPaymentSlipFlagged({
      slipId: input.slipId,
      channelLabel: input.channelLabel,
      customerLabel,
      amountLabel: formatPaymentSlipBaht(input.ocr.amount),
      warningMessages: warnings.map((warning) => warning.message),
    });
  } catch (error) {
    console.error("[payment-slip-checks] flagged-slip notification failed", {
      slipId: input.slipId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return warnings;
}
