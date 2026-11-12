/**
 * cleanup-product-transaction-data.ts
 * Delete transaction, customer, supplier and product rows and reset
 * CashBankAccount.openingBalance to 0.
 *
 * TEST DATABASES ONLY. Refuses to run against the production Supabase project,
 * and against any other remote database unless it is named explicitly
 * (see lib/destructive-db-script-guard.ts). `dotenv/config` loads `.env`,
 * which points at production, so a bare run is refused before connecting.
 *
 * Usage:
 *   npx tsx prisma/scripts/cleanup-product-transaction-data.ts             # dry run: print row counts only
 *   npx tsx prisma/scripts/cleanup-product-transaction-data.ts --execute   # actually delete
 *
 * Remote disposable database: set ALLOW_DESTRUCTIVE_DB_SCRIPT to the exact
 * target string the refusal message prints.
 */

import "dotenv/config";

import { Client } from "pg";
import {
  DESTRUCTIVE_DB_OVERRIDE_ENV,
  checkDestructiveDbTarget,
} from "../../lib/destructive-db-script-guard";

const TARGET_TABLES = [
  "WarrantyClaimLot",
  "WarrantyClaim",
  "Warranty",
  "ReceiptItem",
  "Receipt",
  "CreditNoteItemLot",
  "CreditNoteItem",
  "CreditNote",
  "PurchaseReturnItemLot",
  "PurchaseReturnItem",
  "PurchaseReturn",
  "SaleItemLot",
  "SaleItem",
  "Sale",
  "PurchaseItemLot",
  "PurchaseItem",
  "Purchase",
  "SupplierPaymentItem",
  "DocumentPayment",
  "SupplierPayment",
  "CustomerAdvanceRefund",
  "SupplierAdvanceRefund",
  "CustomerAdvance",
  "SupplierAdvance",
  "ExpenseItem",
  "Expense",
  "AdjustmentItem",
  "Adjustment",
  "StockMovementLot",
  "StockCard",
  "BalanceForward",
  "LotBalance",
  "ProductLot",
  "FactProfit",
  "CashBankMovement",
  "CashBankTransfer",
  "CashBankAdjustment",
  "Customer",
  "Supplier",
  "ProductAlias",
  "ProductCarModel",
  "ProductUnit",
  "Product",
  "product_search_documents",
] as const;

const DELETE_STATEMENTS = [
  'delete from "WarrantyClaimLot"',
  'delete from "WarrantyClaim"',
  'delete from "Warranty"',
  'delete from "ReceiptItem"',
  'delete from "Receipt"',
  'delete from "CreditNoteItemLot"',
  'delete from "CreditNoteItem"',
  'delete from "CreditNote"',
  'delete from "PurchaseReturnItemLot"',
  'delete from "PurchaseReturnItem"',
  'delete from "PurchaseReturn"',
  'delete from "SaleItemLot"',
  'delete from "SaleItem"',
  'delete from "Sale"',
  'delete from "PurchaseItemLot"',
  'delete from "PurchaseItem"',
  'delete from "Purchase"',
  'delete from "SupplierPaymentItem"',
  'delete from "DocumentPayment"',
  'delete from "SupplierPayment"',
  'delete from "CustomerAdvanceRefund"',
  'delete from "SupplierAdvanceRefund"',
  'delete from "CustomerAdvance"',
  'delete from "SupplierAdvance"',
  'delete from "ExpenseItem"',
  'delete from "Expense"',
  'delete from "AdjustmentItem"',
  'delete from "Adjustment"',
  'delete from "StockMovementLot"',
  'delete from "StockCard"',
  'delete from "BalanceForward"',
  'delete from "LotBalance"',
  'delete from "ProductLot"',
  'delete from "FactProfit"',
  'delete from "CashBankMovement"',
  'delete from "CashBankTransfer"',
  'delete from "CashBankAdjustment"',
  'delete from "Customer"',
  'delete from "Supplier"',
  'delete from "ProductAlias"',
  'delete from "ProductCarModel"',
  'delete from "ProductUnit"',
  'delete from "Product"',
  'delete from "product_search_documents"',
  'update "CashBankAccount" set "openingBalance" = 0, "updatedAt" = now()',
] as const;

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function countRows(client: Client, table: string): Promise<number> {
  const result = await client.query<{ n: string }>(`select count(*)::text as n from ${quoteIdent(table)}`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  // Before connecting: even the dry run's row counts are never read from production.
  const check = checkDestructiveDbTarget(connectionString, process.env[DESTRUCTIVE_DB_OVERRIDE_ENV]);
  if (!check.allowed) {
    console.error(`\nREFUSED — ${check.reason}\nNothing was read or deleted.\n`);
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const countsBefore: Record<string, number> = {};
    for (const table of TARGET_TABLES) {
      countsBefore[table] = await countRows(client, table);
    }

    const cashBankBefore = await client.query<{
      code: string;
      openingBalance: string;
      openingDate: string;
    }>('select "code", "openingBalance"::text as "openingBalance", "openingDate"::text as "openingDate" from "CashBankAccount" order by "code"',
    );

    console.log("Target row counts before cleanup:");
    for (const table of TARGET_TABLES) {
      console.log(`${table}: ${countsBefore[table]}`);
    }

    console.log("\nCashBankAccount before reset:");
    for (const row of cashBankBefore.rows) {
      console.log(`${row.code}: openingBalance=${row.openingBalance} openingDate=${row.openingDate}`,
      );
    }

    if (!execute) {
      console.log("\nDry run only. Re-run with --execute to apply the cleanup.",
      );
      return;
    }

    await client.query("begin");

    for (const sql of DELETE_STATEMENTS) {
      await client.query(sql);
    }

    await client.query("commit");

    const countsAfter: Record<string, number> = {};
    for (const table of TARGET_TABLES) {
      countsAfter[table] = await countRows(client, table);
    }

    const cashBankAfter = await client.query<{
      code: string;
      openingBalance: string;
      openingDate: string;
    }>('select "code", "openingBalance"::text as "openingBalance", "openingDate"::text as "openingDate" from "CashBankAccount" order by "code"',
    );

    console.log("\nTarget row counts after cleanup:");
    for (const table of TARGET_TABLES) {
      console.log(`${table}: ${countsAfter[table]}`);
    }

    console.log("\nCashBankAccount after reset:");
    for (const row of cashBankAfter.rows) {
      console.log(`${row.code}: openingBalance=${row.openingBalance} openingDate=${row.openingDate}`,
      );
    }
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback errors after a failed transaction.
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exit(1);
});
