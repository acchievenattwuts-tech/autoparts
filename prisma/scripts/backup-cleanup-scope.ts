import "dotenv/config";

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

const TABLES = [
  "Product",
  "ProductUnit",
  "ProductAlias",
  "ProductCarModel",
  "ProductLot",
  "LotBalance",
  "product_search_documents",
  "BalanceForward",
  "StockCard",
  "StockMovementLot",
  "Purchase",
  "PurchaseItem",
  "PurchaseItemLot",
  "Sale",
  "SaleItem",
  "SaleItemLot",
  "Warranty",
  "WarrantyClaim",
  "WarrantyClaimLot",
  "CreditNote",
  "CreditNoteItem",
  "CreditNoteItemLot",
  "Receipt",
  "ReceiptItem",
  "PurchaseReturn",
  "PurchaseReturnItem",
  "PurchaseReturnItemLot",
  "Expense",
  "ExpenseItem",
  "Adjustment",
  "AdjustmentItem",
  "CashBankMovement",
  "CashBankTransfer",
  "CashBankAdjustment",
  "SupplierAdvance",
  "SupplierPayment",
  "SupplierPaymentItem",
  "FactProfit",
  "Customer",
  "Supplier",
  "CashBankAccount",
] as const;

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const metaResult = await client.query<{
      db: string;
      user_name: string;
      now: string;
    }>("select current_database() as db, current_user as user_name, now()::text as now");

    const meta = metaResult.rows[0];
    const snapshot: Record<string, unknown> = {
      _meta: {
        generatedAt: new Date().toISOString(),
        database: meta.db,
        user: meta.user_name,
        serverNow: meta.now,
        tables: TABLES,
      },
    };

    for (const table of TABLES) {
      const sql = `select * from ${quoteIdent(table)}`;
      const result = await client.query(sql);
      snapshot[table] = result.rows;
      console.log(`${table}: ${result.rows.length} rows`);
    }

    const outDir = path.join(__dirname, "snapshots", "cleanup-scope");
    fs.mkdirSync(outDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(outDir, `cleanup-scope-${timestamp}.json`);
    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf-8");

    console.log(`\nSaved snapshot: ${outFile}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Backup failed:", error);
  process.exit(1);
});
