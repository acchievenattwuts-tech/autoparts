import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import generatedPrisma from "../lib/generated/prisma/index.js";

const { PrismaClient } = generatedPrisma;

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const SOURCE_DIR = path.join(process.cwd(), "import", "vanichanan_import_csv_with_cost (1)");
const SUPPLIER_NAME = "บริษัท วาณิชอนันต์";
const PRODUCT_CODE_START = "P0314";
const PRODUCT_CODE_END = "P0408";
const EXPECTED_MATCH_COUNT = 89;
const UPDATE_FILE = "supplier_product_name_update.csv";
const AUDIT_FILE = "supplier_product_name_update_audit.csv";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const modes = argv.filter((arg) => arg === "--dry-run" || arg === "--execute");
  if (modes.length !== 1) fail("Choose exactly one mode: --dry-run or --execute");
  const confirmArg = argv.find((arg) => arg.startsWith("--confirm-match-count="));
  const confirmMatchCount = confirmArg ? Number(confirmArg.slice("--confirm-match-count=".length)) : null;
  if (confirmArg && !Number.isInteger(confirmMatchCount)) fail("Invalid --confirm-match-count value");
  return {
    mode: modes[0] === "--dry-run" ? "dry-run" : "execute",
    confirmMatchCount,
  };
}

function parseCsv(text, fileLabel) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (quoted) {
      if (ch === "\"" && normalized[i + 1] === "\"") {
        value += "\"";
        i += 1;
      } else if (ch === "\"") {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === "\"") {
      quoted = true;
    } else if (ch === ",") {
      row.push(value);
      value = "";
    } else if (ch === "\n") {
      row.push(value);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
  }
  if (quoted) fail(`Unclosed quoted CSV value in ${fileLabel}`);
  if (value !== "" || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  if (rows.length === 0) fail(`CSV file is empty: ${fileLabel}`);
  const headers = rows[0].map((header) => String(header).replace(/^\uFEFF/, "").trim());
  return rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      fail(`${fileLabel} row ${index + 2} has ${cells.length} columns; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, cellIndex) => [header, String(cells[cellIndex] ?? "").trim()]));
  });
}

function readCsv(name) {
  return parseCsv(fs.readFileSync(path.join(SOURCE_DIR, name), "utf8"), name);
}

function requireColumns(rows, fileLabel, columns) {
  const first = rows[0] || {};
  const missing = columns.filter((column) => !(column in first));
  if (missing.length > 0) fail(`${fileLabel} is missing columns: ${missing.join(", ")}`);
}

function ensureUnique(rows, key, fileLabel) {
  const seen = new Set();
  for (const row of rows) {
    const value = row[key];
    if (seen.has(value)) fail(`${fileLabel} has duplicate ${key}: ${value}`);
    seen.add(value);
  }
}

function summarizeChanges(changes) {
  let changedCount = 0;
  let unchangedCount = 0;
  for (const item of changes) {
    if (item.currentName === item.newName) unchangedCount += 1;
    else changedCount += 1;
  }
  return { changedCount, unchangedCount };
}

async function loadPlan(db) {
  const updates = readCsv(UPDATE_FILE);
  const audit = readCsv(AUDIT_FILE);
  requireColumns(updates, UPDATE_FILE, ["supplier_product_code", "name"]);
  requireColumns(audit, AUDIT_FILE, ["supplier_product_code", "name", "review_status"]);
  ensureUnique(updates, "supplier_product_code", UPDATE_FILE);
  ensureUnique(audit, "supplier_product_code", AUDIT_FILE);

  if (updates.length !== EXPECTED_MATCH_COUNT) {
    fail(`${UPDATE_FILE} expected ${EXPECTED_MATCH_COUNT} rows, got ${updates.length}`);
  }
  if (audit.length !== updates.length) {
    fail(`${AUDIT_FILE} count ${audit.length} does not match ${UPDATE_FILE} count ${updates.length}`);
  }

  const auditByCode = new Map(audit.map((row) => [row.supplier_product_code, row]));
  for (const row of updates) {
    const auditRow = auditByCode.get(row.supplier_product_code);
    if (!auditRow) fail(`Audit row missing for ${row.supplier_product_code}`);
    if (auditRow.name !== row.name) {
      fail(`Audit name mismatch for ${row.supplier_product_code}`);
    }
  }

  const aliases = await db.productAlias.findMany({
    where: {
      kind: "PART_NO",
      alias: { in: updates.map((row) => row.supplier_product_code) },
      product: {
        code: { gte: PRODUCT_CODE_START, lte: PRODUCT_CODE_END },
        preferredSupplier: { name: SUPPLIER_NAME },
      },
    },
    select: {
      alias: true,
      product: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ product: { code: "asc" } }, { alias: "asc" }],
  });

  const aliasMap = new Map(aliases.map((row) => [row.alias, row.product]));
  const missingInProduction = updates
    .filter((row) => !aliasMap.has(row.supplier_product_code))
    .map((row) => row.supplier_product_code);
  if (missingInProduction.length > 0) {
    fail(`PART_NO not found in production for: ${missingInProduction.join(", ")}`);
  }

  const changes = updates.map((row) => {
    const product = aliasMap.get(row.supplier_product_code);
    const auditRow = auditByCode.get(row.supplier_product_code);
    return {
      productId: product.id,
      code: product.code,
      partNo: row.supplier_product_code,
      currentName: product.name,
      newName: row.name,
      reviewStatus: auditRow.review_status,
      reviewNote: auditRow.review_note || null,
    };
  });

  const duplicateProductIds = changes
    .map((row) => row.productId)
    .filter((id, index, arr) => arr.indexOf(id) !== index);
  if (duplicateProductIds.length > 0) {
    fail(`Duplicate target products in update plan: ${Array.from(new Set(duplicateProductIds)).join(", ")}`);
  }

  return {
    changes,
    ...summarizeChanges(changes),
    needReview: changes.filter((row) => row.reviewStatus === "NEED_REVIEW"),
  };
}

function printReport(plan, mode) {
  const summary = {
    mode,
    sourceDir: SOURCE_DIR,
    supplier: SUPPLIER_NAME,
    productRange: `${PRODUCT_CODE_START}-${PRODUCT_CODE_END}`,
    matchedCount: plan.changes.length,
    changedCount: plan.changedCount,
    unchangedCount: plan.unchangedCount,
    needReviewCount: plan.needReview.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log("CHANGES");
  for (const row of plan.changes) {
    const suffix = row.reviewStatus === "NEED_REVIEW" ? " [NEED_REVIEW]" : "";
    console.log(`${row.code}\t${row.partNo}\t${row.currentName}\t=>\t${row.newName}${suffix}`);
  }
}

async function executePlan(db, plan, args) {
  if (args.confirmMatchCount !== EXPECTED_MATCH_COUNT) {
    fail(`Execute requires --confirm-match-count=${EXPECTED_MATCH_COUNT}`);
  }
  if (plan.changes.length !== EXPECTED_MATCH_COUNT) {
    fail(`Matched ${plan.changes.length} rows; expected ${EXPECTED_MATCH_COUNT}`);
  }
  await db.$transaction(async (tx) => {
    const reloaded = await loadPlan(tx);
    if (reloaded.changes.length !== EXPECTED_MATCH_COUNT) {
      fail(`Recheck matched ${reloaded.changes.length} rows; expected ${EXPECTED_MATCH_COUNT}`);
    }
    for (const row of reloaded.changes) {
      if (row.currentName === row.newName) continue;
      await tx.product.update({
        where: { id: row.productId },
        data: { name: row.newName },
      });
    }
  }, {
    maxWait: 10_000,
    timeout: 60_000,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }),
  });
  try {
    const plan = await loadPlan(db);
    printReport(plan, args.mode);
    if (args.mode === "execute") {
      await executePlan(db, plan, args);
      console.log("EXECUTE_OK");
    } else {
      console.log("DRY_RUN_ONLY");
    }
  } finally {
    await db.$disconnect();
  }
}

await main();
