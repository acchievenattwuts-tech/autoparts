/**
 * READ-ONLY audit: replays the MAVG engine over every product's StockCard and
 * compares the result with what is actually stored in the database.
 *
 * ไม่มีการเขียนข้อมูลใด ๆ — SELECT อย่างเดียว
 * รัน: npx tsx --env-file=.env prisma/scripts/audit-stock-card.ts
 */
import { db } from "../../lib/db";
import { Prisma } from "../../lib/generated/prisma";
import { formatDateOnlyForInput } from "../../lib/th-date";

const STOCK_QTY_SCALE = 4;
const STOCK_PRICE_SCALE = 4;
const NEUTRAL_IN_SOURCES = ["RETURN_IN", "CLAIM_RETURN_IN", "CLAIM_RECV_IN"];
const PRODUCT_CHUNK_SIZE = 200;

type Row = {
  id: string;
  docNo: string;
  docDate: Date;
  sorder: number;
  source: string;
  qtyIn: Prisma.Decimal;
  qtyOut: Prisma.Decimal;
  priceIn: Prisma.Decimal;
  priceOut: Prisma.Decimal;
  qtyBalance: Prisma.Decimal;
  priceBalance: Prisma.Decimal;
  landedCost: Prisma.Decimal;
  usesReferenceCost: boolean;
};

const round = (value: number, scale: number): Prisma.Decimal =>
  new Prisma.Decimal(Number.isFinite(value) ? value : 0).toDecimalPlaces(scale);

/** สำเนาตรงจาก replayStockCardMavg() ใน lib/stock-card.ts (pure, ไม่เขียน DB) */
function replay(rows: Row[]) {
  let baQty = 0;
  let baPrice = 0;
  let baTotal = 0;
  const expected: { row: Row; priceOut: number; qtyBalance: number; priceBalance: number }[] = [];

  for (const row of rows) {
    const qIn = Number(row.qtyIn);
    const qOut = Number(row.qtyOut);
    const usesRef = row.usesReferenceCost === true;
    const pIn =
      qIn > 0 && NEUTRAL_IN_SOURCES.includes(row.source) && !usesRef ? baPrice : Number(row.priceIn);
    const lc = Number(row.landedCost);

    const newBaQty = baQty + qIn - qOut;
    let newBaPrice = 0;
    let newBaTotal = 0;
    let priceOut = baPrice;

    if (qIn > 0) {
      if (newBaQty > 0) {
        if (baQty > 0) {
          newBaTotal = baTotal + qIn * pIn - qOut * baPrice + lc;
          newBaPrice = newBaTotal / newBaQty;
        } else {
          newBaPrice = pIn + lc / qIn;
          newBaTotal = newBaPrice * newBaQty;
        }
      }
    } else if (usesRef && Number(row.priceIn) > 0) {
      const refCost = Number(row.priceIn);
      priceOut = refCost;
      if (newBaQty >= 0) {
        newBaTotal = baTotal - qOut * refCost;
        if (newBaTotal < 0) newBaTotal = 0;
        newBaPrice = newBaQty > 0 ? newBaTotal / newBaQty : 0;
      }
    } else {
      priceOut = baPrice;
      if (newBaQty >= 0) {
        newBaPrice = baPrice;
        newBaTotal = baTotal - qOut * baPrice;
        if (newBaTotal < 0) newBaTotal = 0;
      }
    }

    expected.push({
      row,
      priceOut,
      qtyBalance: newBaQty,
      priceBalance: newBaPrice > 0 ? newBaPrice : 0,
    });

    baQty = newBaQty;
    baPrice = newBaPrice;
    baTotal = newBaTotal;
  }

  return { expected, finalQty: Math.round(baQty), finalPrice: baPrice > 0 ? baPrice : 0 };
}

async function main(): Promise<void> {
  const [productCount, cardCount] = await Promise.all([
    db.product.count(),
    db.stockCard.count(),
  ]);
  console.log(`Products: ${productCount} | StockCard rows: ${cardCount}\n`);

  const products = await db.product.findMany({
    select: { id: true, code: true, name: true, stock: true, avgCost: true },
    orderBy: { id: "asc" },
  });

  let checkedProducts = 0;
  let checkedRows = 0;
  const rowMismatches: string[] = [];
  const productMismatches: string[] = [];
  const anomalies: string[] = [];
  let rowMismatchCount = 0;
  let qtyMismatchCount = 0;
  let stockMismatchCount = 0;
  let maxQtyDelta = 0;
  let maxPriceDelta = 0;
  let maxAvgDelta = 0;

  for (let i = 0; i < products.length; i += PRODUCT_CHUNK_SIZE) {
    const chunk = products.slice(i, i + PRODUCT_CHUNK_SIZE);
    const rows = (await db.stockCard.findMany({
      where: { productId: { in: chunk.map((p) => p.id) } },
      select: {
        id: true, productId: true, docNo: true, docDate: true, sorder: true, source: true,
        qtyIn: true, qtyOut: true, priceIn: true, priceOut: true,
        qtyBalance: true, priceBalance: true, landedCost: true, usesReferenceCost: true,
      },
      orderBy: [{ productId: "asc" }, { docDate: "asc" }, { sorder: "asc" }],
    })) as (Row & { productId: string })[];

    const byProduct = new Map<string, Row[]>();
    for (const row of rows) {
      const group = byProduct.get(row.productId);
      if (group) group.push(row);
      else byProduct.set(row.productId, [row]);
    }

    for (const product of chunk) {
      const productRows = byProduct.get(product.id) ?? [];
      if (productRows.length === 0) {
        if (Number(product.stock) !== 0 || Number(product.avgCost) !== 0) {
          productMismatches.push(
            `[NO-CARD] ${product.code ?? "-"} ${product.name} : stock=${product.stock} avgCost=${product.avgCost} แต่ไม่มี StockCard เลย`,
          );
        }
        continue;
      }

      checkedProducts += 1;
      checkedRows += productRows.length;
      const { expected, finalQty, finalPrice } = replay(productRows);

      for (const item of expected) {
        const r = item.row;
        const qtyBad = !round(item.qtyBalance, STOCK_QTY_SCALE).equals(r.qtyBalance);
        const priceBad = !round(item.priceBalance, STOCK_PRICE_SCALE).equals(r.priceBalance);
        const outBad = !round(item.priceOut, STOCK_PRICE_SCALE).equals(r.priceOut);
        if (qtyBad) {
          qtyMismatchCount += 1;
          maxQtyDelta = Math.max(maxQtyDelta, Math.abs(item.qtyBalance - Number(r.qtyBalance)));
        }
        if (priceBad) maxPriceDelta = Math.max(maxPriceDelta, Math.abs(item.priceBalance - Number(r.priceBalance)));
        if (outBad) maxPriceDelta = Math.max(maxPriceDelta, Math.abs(item.priceOut - Number(r.priceOut)));
        if (qtyBad || priceBad || outBad) {
          rowMismatchCount += 1;
          if (rowMismatches.length < 40) {
            rowMismatches.push(
              // docDate is a date-only business field stored at Bangkok
              // midnight, i.e. 17:00 UTC the day before — toISOString() printed
              // the previous day for every row in this report.
              `${product.code ?? "-"} | ${r.docNo} | ${formatDateOnlyForInput(r.docDate)} | ${r.source}` +
                (qtyBad ? ` | qtyBalance stored=${r.qtyBalance} expected=${round(item.qtyBalance, STOCK_QTY_SCALE)}` : "") +
                (priceBad ? ` | priceBalance stored=${r.priceBalance} expected=${round(item.priceBalance, STOCK_PRICE_SCALE)}` : "") +
                (outBad ? ` | priceOut stored=${r.priceOut} expected=${round(item.priceOut, STOCK_PRICE_SCALE)}` : ""),
            );
          }
        }

        if (Number(r.qtyIn) > 0 && Number(r.qtyOut) > 0 && anomalies.length < 40) {
          anomalies.push(`[IN+OUT] ${product.code ?? "-"} | ${r.docNo} qtyIn=${r.qtyIn} qtyOut=${r.qtyOut}`);
        }
        if (item.qtyBalance < 0 && anomalies.length < 40) {
          anomalies.push(`[NEG-BAL] ${product.code ?? "-"} | ${r.docNo} balance=${round(item.qtyBalance, STOCK_QTY_SCALE)}`);
        }
      }

      const storedStock = Number(product.stock);
      const storedAvg = Number(product.avgCost);
      const stockBad = storedStock !== finalQty;
      const avgBad = !round(finalPrice, STOCK_PRICE_SCALE).equals(round(storedAvg, STOCK_PRICE_SCALE));
      if (stockBad) stockMismatchCount += 1;
      if (avgBad) maxAvgDelta = Math.max(maxAvgDelta, Math.abs(finalPrice - storedAvg));
      if (stockBad || avgBad) {
        productMismatches.push(
          `${product.code ?? "-"} ${product.name}` +
            (stockBad ? ` | stock stored=${storedStock} expected=${finalQty}` : "") +
            (avgBad ? ` | avgCost stored=${storedAvg} expected=${round(finalPrice, STOCK_PRICE_SCALE)}` : ""),
        );
      }
    }
  }

  console.log(`ตรวจแล้ว: ${checkedProducts} สินค้า / ${checkedRows} แถว StockCard\n`);
  console.log(
    `สรุปขนาดความคลาดเคลื่อน: qty rows=${qtyMismatchCount} (max ${maxQtyDelta}) | ` +
      `price rows max=${maxPriceDelta.toFixed(6)} | product stock=${stockMismatchCount} | ` +
      `product avgCost max=${maxAvgDelta.toFixed(6)}\n`,
  );
  console.log(`== StockCard row mismatches: ${rowMismatchCount}`);
  rowMismatches.forEach((m) => console.log("   " + m));
  console.log(`\n== Product stock/avgCost mismatches: ${productMismatches.length}`);
  productMismatches.slice(0, 40).forEach((m) => console.log("   " + m));
  console.log(`\n== Anomalies: ${anomalies.length}`);
  anomalies.forEach((m) => console.log("   " + m));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
