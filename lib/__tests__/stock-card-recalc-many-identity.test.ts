import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import {
  STOCK_REPLAY_SELECT,
  recalculateStockCard,
  recalculateStockCardMany,
  replayStockCardMavg,
  sortRowsForReplay,
} from "@/lib/stock-card";

// Proves, without a database, that
//   (1) recalculateStockCardMany(tx, ids) leaves StockCard + Product in exactly
//       the state produced by looping recalculateStockCard(tx, id), and
//   (2) the narrowed StockCard select (STOCK_REPLAY_SELECT) produces exactly the
//       same numbers as replaying the full rows.
// Cancel-adjustment switched from the loop to the batched call, and both
// recalculators now read only the replay columns.

type Row = {
  id: string;
  productId: string;
  docNo: string;
  detail: string;
  referenceId: string;
  createdAt: Date;
  docDate: Date;
  sorder: number;
  source: string;
  qtyIn: Prisma.Decimal;
  qtyOut: Prisma.Decimal;
  priceIn: Prisma.Decimal;
  landedCost: Prisma.Decimal;
  usesReferenceCost: boolean;
  qtyBalance: Prisma.Decimal;
  priceBalance: Prisma.Decimal;
  priceOut: Prisma.Decimal;
};

type Store = {
  rows: Row[];
  products: Map<string, { stock: number; avgCost: string }>;
};

const D = (value: number | string) => new Prisma.Decimal(value);
// Postgres persists numeric(_, 4); mimic the column rounding.
const col4 = (value: unknown) =>
  D(String(value)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

let seq = 0;
function row(
  productId: string,
  day: string,
  sorder: number,
  source: string,
  qtyIn: number,
  qtyOut: number,
  priceIn: number,
  extra: Partial<Pick<Row, "landedCost" | "usesReferenceCost">> = {},
): Row {
  seq += 1;
  return {
    id: `sc-${String(seq).padStart(3, "0")}`,
    productId,
    docNo: `DOC-${seq}`,
    detail: "รายละเอียดยาว ๆ ที่ replay ไม่ได้ใช้",
    referenceId: `ref-${seq}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    docDate: new Date(`${day}T00:00:00+07:00`),
    sorder,
    source,
    qtyIn: D(qtyIn),
    qtyOut: D(qtyOut),
    priceIn: D(priceIn),
    landedCost: extra.landedCost ?? D(0),
    usesReferenceCost: extra.usesReferenceCost ?? false,
    // Deliberately stale stored balances so the diff-write path rewrites them.
    qtyBalance: D(999),
    priceBalance: D(1),
    priceOut: D(0),
  };
}

function seedRows(): Row[] {
  seq = 0;
  return [
    // p1: same-day sale keyed before purchase, BF, landed cost, neutral return, reference-cost OUT
    row("p1", "2026-05-27", 1, "SALE", 0, 3, 0),
    row("p1", "2026-05-27", 2, "PURCHASE", 10, 0, 123.4567, { landedCost: D(17.3) }),
    row("p1", "2026-05-27", 3, "BF", 5, 0, 99.99),
    row("p1", "2026-05-28", 1, "RETURN_IN", 1, 0, 50),
    row("p1", "2026-05-29", 1, "RETURN_OUT", 0, 2, 110.25, { usesReferenceCost: true }),
    row("p1", "2026-05-30", 1, "ADJUST_OUT", 0, 20, 0),
    row("p1", "2026-05-31", 1, "ADJUST_IN", 7, 0, 33.3333),
    // p2: fractional quantities and a sequence with identical sorders
    row("p2", "2026-06-01", 1, "PURCHASE", 2.5, 0, 10.1),
    row("p2", "2026-06-01", 1, "PURCHASE", 1.25, 0, 11.7),
    row("p2", "2026-06-02", 1, "SALE", 0, 3.1, 0),
    row("p2", "2026-06-03", 1, "CLAIM_RECV_IN", 0.5, 0, 0, { usesReferenceCost: false }),
    // p3: no rows at all (product whose only document was cancelled)
  ];
}

function sqlText(strings: TemplateStringsArray): string {
  return strings.join("?");
}

function sqlValues(values: unknown[]): unknown[] {
  const isSql = (value: unknown): value is { values: unknown[]; strings: string[] } =>
    typeof value === "object" && value !== null && "strings" in value && Array.isArray((value as { values?: unknown }).values);
  return values.flatMap((value) => (isSql(value) ? value.values : [value]));
}

function createTx(store: Store, selects: unknown[]) {
  const applyUpdates = (text: string, flat: unknown[]) => {
    if (text.includes('"qtyBalance" = data."qtyBalance"')) {
      for (let i = 0; i < flat.length; i += 4) {
        const target = store.rows.find((r) => r.id === flat[i]);
        assert.ok(target);
        target.priceOut = col4(flat[i + 1]);
        target.qtyBalance = col4(flat[i + 2]);
        target.priceBalance = col4(flat[i + 3]);
      }
    } else if (text.includes('SET "sorder" = data."sorder"')) {
      for (let i = 0; i < flat.length; i += 2) {
        const target = store.rows.find((r) => r.id === flat[i]);
        assert.ok(target);
        target.sorder = Number(flat[i + 1]);
      }
    } else if (text.includes('UPDATE "Product"')) {
      for (let i = 0; i < flat.length; i += 3) {
        store.products.set(String(flat[i]), {
          stock: Number(flat[i + 1]),
          avgCost: D(String(flat[i + 2])).toString(),
        });
      }
    } else {
      assert.fail(`unexpected $executeRaw: ${text}`);
    }
  };

  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      applyUpdates(sqlText(strings), sqlValues(values));
      return 0;
    },
    stockCard: {
      findMany: async (args: {
        where: { productId: string | { in: string[] } };
        select?: Record<string, boolean>;
      }) => {
        selects.push(args.select);
        const ids = typeof args.where.productId === "string" ? [args.where.productId] : args.where.productId.in;
        const matched = store.rows
          .filter((r) => ids.includes(r.productId))
          .sort(
            (a, b) =>
              a.productId.localeCompare(b.productId) ||
              a.docDate.getTime() - b.docDate.getTime() ||
              a.sorder - b.sorder,
          );
        return matched.map((r) => {
          if (!args.select) return { ...r };
          const projected: Record<string, unknown> = {};
          for (const [key, on] of Object.entries(args.select)) {
            if (on) projected[key] = r[key as keyof Row];
          }
          return projected;
        });
      },
    },
    product: {
      update: async ({ where, data }: { where: { id: string }; data: { stock: number; avgCost: Prisma.Decimal } }) => {
        store.products.set(where.id, { stock: data.stock, avgCost: D(data.avgCost.toString()).toString() });
        return {};
      },
    },
    productStorefrontStockInvalidation: {
      upsert: async () => ({}),
      createMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
  };
  return tx as unknown as Parameters<typeof recalculateStockCard>[0];
}

function snapshot(store: Store) {
  return {
    rows: [...store.rows]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => `${r.id}|${r.sorder}|${r.qtyBalance.toString()}|${r.priceBalance.toString()}|${r.priceOut.toString()}`),
    products: [...store.products.entries()].sort(([a], [b]) => a.localeCompare(b)),
  };
}

const PRODUCT_IDS = ["p2", "p1", "p3"];

test("recalculateStockCardMany == looping recalculateStockCard (StockCard balances, sorder, Product stock/avgCost)", async () => {
  const loopStore: Store = { rows: seedRows(), products: new Map() };
  const manyStore: Store = { rows: seedRows(), products: new Map() };
  const selects: unknown[] = [];

  const loopTx = createTx(loopStore, selects);
  for (const productId of PRODUCT_IDS) {
    await recalculateStockCard(loopTx, productId);
  }
  await recalculateStockCardMany(createTx(manyStore, selects), PRODUCT_IDS);

  assert.deepEqual(snapshot(manyStore), snapshot(loopStore));
  // Sanity: the scenario really rewrote balances and set every product.
  assert.equal(loopStore.products.size, 3);
  assert.deepEqual(loopStore.products.get("p3"), { stock: 0, avgCost: "0" });
  assert.ok(loopStore.rows.every((r) => !r.qtyBalance.equals(999)));
  // Both recalculators read only the replay columns.
  assert.ok(selects.length > 0);
  for (const select of selects) assert.deepEqual(select, STOCK_REPLAY_SELECT);
});

test("replaying the narrowed select gives the same result as replaying full StockCard rows", () => {
  for (const productId of ["p1", "p2"]) {
    const full = seedRows().filter((r) => r.productId === productId);
    const narrowed = full.map((r) => {
      const projected: Record<string, unknown> = {};
      for (const key of Object.keys(STOCK_REPLAY_SELECT)) projected[key] = r[key as keyof Row];
      return projected as unknown as Row;
    });
    assert.deepEqual(
      replayStockCardMavg(sortRowsForReplay(narrowed)),
      replayStockCardMavg(sortRowsForReplay(full)),
    );
  }
});
