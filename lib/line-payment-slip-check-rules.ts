/**
 * Pure rules for the automatic payment-slip checks (duplicate slip + receiver
 * name). Shared by LINE and Messenger slips. These checks only WARN an admin —
 * they never confirm, reject or match a payment on their own.
 *
 * Kept free of DB / framework imports so the rules stay unit-testable.
 */

/** Shorter normalized references are OCR noise, not a bank transaction id. */
const MIN_REFERENCE_KEY_LENGTH = 8;
/** Shortest receiver-name fragment that may count as a bank-truncated name. */
const MIN_RECEIVER_PREFIX_LENGTH = 4;
const ONE_MINUTE_MS = 60_000;

/** Name prefixes banks print before an account name; ignored when comparing. */
const RECEIVER_TITLE_PATTERN =
  /^(?:นางสาว|นาง|นาย|น\.\s*ส\.?|ด\.\s*ช\.?|ด\.\s*ญ\.?|ร้าน|บริษัท|บจก\.?|หจก\.?|mrs\.?|mr\.?|ms\.?|miss)\s*/iu;
const RECEIVER_IGNORED_CHARS = /[\s.*\-_()[\]'"]/gu;

export type PaymentSlipReceiverCheck = "MATCH" | "MISMATCH" | "UNREADABLE" | "NO_ACCOUNTS";
export type PaymentSlipDuplicateKind = "REFERENCE" | "AMOUNT_TIME";
export type PaymentSlipWarningCode = "DUPLICATE_REFERENCE" | "POSSIBLE_DUPLICATE" | "RECEIVER_MISMATCH";

export type PaymentSlipWarning = {
  code: PaymentSlipWarningCode;
  message: string;
};

/** The fields the duplicate rule compares. Amount is in baht. */
export type PaymentSlipDuplicateFields = {
  id: string;
  referenceNoKey: string | null;
  amount: number | null;
  transferDatetime: Date | null;
};

/**
 * Normalizes an OCR reference number into the duplicate lookup key: keeps only
 * letters and digits, upper-cased. Returns null when nothing usable is left.
 */
export function normalizePaymentSlipReferenceKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.normalize("NFKC").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return key.length >= MIN_REFERENCE_KEY_LENGTH ? key : null;
}

/** Normalizes a receiver / account name for comparison (titles, spaces, masks removed). */
export function normalizePaymentSlipReceiverName(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.normalize("NFKC").trim();
  return trimmed.replace(RECEIVER_TITLE_PATTERN, "").replace(RECEIVER_IGNORED_CHARS, "").toLowerCase();
}

function receiverNamesMatch(slipName: string, accountName: string): boolean {
  if (slipName === accountName) return true;
  // Banks often cut long names ("ศรีวรรณอะไหล่…"), so a long-enough prefix counts.
  const [shorter, longer] =
    slipName.length <= accountName.length ? [slipName, accountName] : [accountName, slipName];
  return shorter.length >= MIN_RECEIVER_PREFIX_LENGTH && longer.startsWith(shorter);
}

/**
 * Compares the slip's receiver name with the shop's bank-account names.
 * NO_ACCOUNTS / UNREADABLE mean the check could not run — they are not warnings.
 */
export function checkPaymentSlipReceiver(
  receiverName: string | null | undefined,
  accountNames: readonly string[],
): PaymentSlipReceiverCheck {
  const accounts = accountNames.map(normalizePaymentSlipReceiverName).filter((name) => name.length > 0);
  if (accounts.length === 0) return "NO_ACCOUNTS";
  const slipName = normalizePaymentSlipReceiverName(receiverName);
  if (!slipName) return "UNREADABLE";
  return accounts.some((account) => receiverNamesMatch(slipName, account)) ? "MATCH" : "MISMATCH";
}

function startOfMinute(date: Date): number {
  return Math.floor(date.getTime() / ONE_MINUTE_MS) * ONE_MINUTE_MS;
}

/**
 * How `candidate` duplicates `target`: same reference key, or (when the keys do
 * not match) the same amount transferred in the same minute. Null = not a duplicate.
 */
export function getPaymentSlipDuplicateKind(
  target: PaymentSlipDuplicateFields,
  candidate: PaymentSlipDuplicateFields,
): PaymentSlipDuplicateKind | null {
  if (candidate.id === target.id) return null;
  if (target.referenceNoKey && candidate.referenceNoKey === target.referenceNoKey) return "REFERENCE";
  if (
    target.amount !== null &&
    candidate.amount !== null &&
    target.transferDatetime &&
    candidate.transferDatetime &&
    Math.round(target.amount * 100) === Math.round(candidate.amount * 100) &&
    startOfMinute(target.transferDatetime) === startOfMinute(candidate.transferDatetime)
  ) {
    return "AMOUNT_TIME";
  }
  return null;
}

/** Inclusive start / exclusive end of the transfer minute, for the DB lookup. */
export function getPaymentSlipTransferMinuteRange(transferDatetime: Date): { gte: Date; lt: Date } {
  const start = startOfMinute(transferDatetime);
  return { gte: new Date(start), lt: new Date(start + ONE_MINUTE_MS) };
}

/** Admin-facing Thai warnings, most serious first. Empty = nothing to flag. */
export function buildPaymentSlipWarnings(input: {
  duplicateKinds: readonly PaymentSlipDuplicateKind[];
  receiver: PaymentSlipReceiverCheck;
}): PaymentSlipWarning[] {
  const warnings: PaymentSlipWarning[] = [];
  const referenceCount = input.duplicateKinds.filter((kind) => kind === "REFERENCE").length;
  const amountTimeCount = input.duplicateKinds.filter((kind) => kind === "AMOUNT_TIME").length;

  if (referenceCount > 0) {
    warnings.push({
      code: "DUPLICATE_REFERENCE",
      message: `เลขอ้างอิงซ้ำกับสลิปอื่น ${referenceCount} ใบ`,
    });
  }
  if (amountTimeCount > 0) {
    warnings.push({
      code: "POSSIBLE_DUPLICATE",
      message: `ยอดเงินและเวลาโอนตรงกับสลิปอื่น ${amountTimeCount} ใบ (อาจเป็นสลิปใบเดียวกัน)`,
    });
  }
  if (input.receiver === "MISMATCH") {
    warnings.push({
      code: "RECEIVER_MISMATCH",
      message: "ชื่อผู้รับไม่ตรงกับบัญชีธนาคารของร้าน",
    });
  }
  return warnings;
}

/** Short Thai label per receiver result, for the admin check panel. */
export const PAYMENT_SLIP_RECEIVER_CHECK_LABEL: Record<PaymentSlipReceiverCheck, string> = {
  MATCH: "ตรงกับบัญชีธนาคารของร้าน",
  MISMATCH: "ไม่ตรงกับบัญชีธนาคารของร้าน",
  UNREADABLE: "อ่านชื่อผู้รับจากสลิปไม่ได้ — ตรวจเองจากรูป",
  NO_ACCOUNTS: "ยังไม่มีบัญชีประเภทธนาคารที่เปิดใช้ในระบบ — เช็กชื่อผู้รับไม่ได้",
};
