/** Read-only Price List completeness and legacy parity verifier. */
import { db } from "../../lib/db";
import { SYSTEM_PRICE_LISTS } from "../../lib/pricing/price-lists";

const LEGACY_COLUMN_BY_CODE = {
  WHOLESALE: "salePrice",
  MEMBER: "memberPrice",
  RETAIL: "retailPrice",
} as const;

async function main() {
  const [products, lists, customerTypes, prices] = await Promise.all([
    db.product.findMany({
      select: { id: true, code: true, salePrice: true, memberPrice: true, retailPrice: true },
    }),
    db.priceList.findMany({
      select: { id: true, code: true, channel: true, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    db.customerType.findMany({
      select: { id: true, name: true, priceTier: true, priceListId: true, priceList: { select: { code: true } } },
    }),
    db.productPrice.findMany({
      select: { productId: true, amount: true, priceList: { select: { code: true } } },
    }),
  ]);

  const errors: string[] = [];
  const warnings: string[] = [];
  const listByCode = new Map(lists.map((row) => [row.code, row]));
  for (const definition of SYSTEM_PRICE_LISTS) {
    const actual = listByCode.get(definition.code);
    if (!actual) errors.push(`Missing system Price List ${definition.code}`);
    else if (actual.channel !== definition.channel) {
      errors.push(`${definition.code}: channel ${String(actual.channel)} != ${String(definition.channel)}`);
    }
  }

  const productById = new Map(products.map((row) => [row.id, row]));
  const legacySeen = new Set<string>();
  const marketplaceCoverage = new Map<string, number>([["SHOPEE", 0], ["LAZADA", 0]]);
  for (const row of prices) {
    const code = row.priceList.code;
    if (code === "SHOPEE" || code === "LAZADA") {
      marketplaceCoverage.set(code, (marketplaceCoverage.get(code) ?? 0) + 1);
      continue;
    }
    if (!(code in LEGACY_COLUMN_BY_CODE)) continue;
    const key = `${row.productId}:${code}`;
    legacySeen.add(key);
    const product = productById.get(row.productId);
    if (!product) {
      errors.push(`ProductPrice ${key} references a product absent from verifier result`);
      continue;
    }
    const column = LEGACY_COLUMN_BY_CODE[code as keyof typeof LEGACY_COLUMN_BY_CODE];
    if (Number(row.amount) !== Number(product[column])) {
      errors.push(`${product.code}/${code}: ProductPrice ${row.amount} != Product.${column} ${product[column]}`);
    }
  }

  for (const product of products) {
    for (const code of Object.keys(LEGACY_COLUMN_BY_CODE)) {
      if (!legacySeen.has(`${product.id}:${code}`)) errors.push(`${product.code}: missing ${code} ProductPrice`);
    }
  }

  for (const customerType of customerTypes) {
    if (!customerType.priceListId || !customerType.priceList) {
      errors.push(`Customer Type ${customerType.name}: missing Price List mapping`);
    }
  }

  for (const [code, count] of marketplaceCoverage) {
    if (count < products.length) warnings.push(`${code}: ${count}/${products.length} products configured`);
  }

  console.log(`Price Lists: ${lists.length}`);
  console.log(`Products: ${products.length}`);
  console.log(`ProductPrice rows: ${prices.length}`);
  console.log(`Customer Types: ${customerTypes.length}`);
  warnings.forEach((warning) => console.warn(`WARN ${warning}`));

  if (errors.length > 0) {
    errors.slice(0, 100).forEach((error) => console.error(`ERROR ${error}`));
    if (errors.length > 100) console.error(`ERROR ...and ${errors.length - 100} more`);
    throw new Error(`Price List verification failed with ${errors.length} error(s)`);
  }
  console.log("Price List verification passed with complete legacy parity.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
