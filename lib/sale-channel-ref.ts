import { Prisma } from "@/lib/generated/prisma";

/**
 * M9 (owner approved 2026-11-12): a marketplace order number (Sale.channelRefNo) is unique per channel among ACTIVE
 * sales only, compared upper-case and trimmed, so a cancelled sale's order number can be keyed again. The database
 * enforces it with the partial expression unique index
 *   "Sale_active_channel_ref_key" ON "Sale" ("channel", upper(btrim("channelRefNo")))
 *   WHERE "status" = 'ACTIVE' AND "channelRefNo" IS NOT NULL
 * Every writer stores the normalized value, so the stored text equals the index key and plain equality finds it.
 * JavaScript trim() removes every whitespace character btrim() removes (and more), and toUpperCase() agrees with
 * upper() on ASCII order numbers; the index stays the final authority (isActiveChannelRefViolation).
 */
export const SALE_ACTIVE_CHANNEL_REF_INDEX = "Sale_active_channel_ref_key";

/** The stored form of an order number: surrounding whitespace removed, upper-case. */
export const normalizeChannelRefNo = (value: string): string => value.trim().toUpperCase();

/** P2002 raised by the M9 index. Prisma 7 + adapter-pg name the index only in meta (the driver's original message). */
export function isActiveChannelRefViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  let meta = "";
  try {
    meta = JSON.stringify(error.meta ?? {});
  } catch {
    meta = "";
  }
  return error.message.includes(SALE_ACTIVE_CHANNEL_REF_INDEX) || meta.includes(SALE_ACTIVE_CHANNEL_REF_INDEX);
}
