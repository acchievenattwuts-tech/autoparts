import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";

export type LotExpiryRow = {
  productId: string;
  lotNo: string;
  expDate: Date;
  qtyOnHand: number;
};

type QueryRow = {
  totalRows: number;
  productId: string | null;
  lotNo: string | null;
  expDate: Date | null;
  qtyOnHand: Prisma.Decimal | null;
};

// JavaScript's previous comparator orders UTF-16 code units. Database locale
// collations (and even UTF-8 byte order for supplementary characters) differ.
const utf16SortKey = (column: Prisma.Sql): Prisma.Sql => Prisma.sql`
  ARRAY(
    SELECT unit
    FROM regexp_split_to_table(${column}, '') WITH ORDINALITY AS chars(ch, pos)
    CROSS JOIN LATERAL unnest(
      CASE WHEN ascii(ch) > 65535 THEN
        ARRAY[55296 + ((ascii(ch) - 65536) >> 10), 56320 + ((ascii(ch) - 65536) & 1023)]
      ELSE ARRAY[ascii(ch)] END
    ) WITH ORDINALITY AS units(unit, unitpos)
    ORDER BY pos, unitpos
  )`;

/** Read-only SQL exception approved for this report; no schema changes. */
export async function getLotExpiryPage(
  thresholdDate: Date | undefined,
  page: number,
  pageSize: number,
): Promise<{ totalRows: number; lots: LotExpiryRow[] }> {
  try {
    const offset = (page - 1) * pageSize;
    // Legacy pageSlice returns no rows for NaN or offsets beyond the array.
    const validOffset = Number.isSafeInteger(offset) && offset >= 0;
    const threshold = thresholdDate
      ? Prisma.sql`AND pl."expDate" <= ${thresholdDate.toISOString()}::timestamptz`
      : Prisma.empty;
    const rows = await db.$queryRaw<QueryRow[]>(Prisma.sql`
      WITH matching AS NOT MATERIALIZED (
        SELECT pl."productId", pl."lotNo", pl."expDate", lb."qtyOnHand",
          ${utf16SortKey(Prisma.sql`pl."productId"`)} AS "productSort",
          ${utf16SortKey(Prisma.sql`pl."lotNo"`)} AS "lotSort"
        FROM "ProductLot" pl
        JOIN "LotBalance" lb
          ON lb."productId" = pl."productId" AND lb."lotNo" = pl."lotNo"
        WHERE lb."qtyOnHand" > 0 AND pl."expDate" IS NOT NULL ${threshold}
      ), total AS (
        SELECT count(*)::int AS "totalRows" FROM matching
      ), paged AS (
        SELECT * FROM matching
        ORDER BY "expDate", "productSort", "lotSort"
        LIMIT ${validOffset ? pageSize : 0} OFFSET ${validOffset ? offset : 0}
      )
      SELECT total."totalRows", paged."productId", paged."lotNo", paged."expDate", paged."qtyOnHand"
      FROM total LEFT JOIN paged ON true
      ORDER BY paged."expDate", paged."productSort", paged."lotSort"
    `);
    const lots = rows.flatMap((row): LotExpiryRow[] =>
      row.productId !== null && row.lotNo !== null && row.expDate !== null && row.qtyOnHand !== null
        ? [{ productId: row.productId, lotNo: row.lotNo, expDate: row.expDate, qtyOnHand: Number(row.qtyOnHand) }]
        : [],
    );
    return { totalRows: rows[0]?.totalRows ?? 0, lots };
  } catch (error) {
    console.error("[lot-expiry] report query failed", error);
    throw error;
  }
}
