import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("sales line profit filters normalize multi-select values and return flag", async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";
  const { parseSalesLineProfitFilters } = await import("@/lib/sales-line-profit-report");

  const filters = parseSalesLineProfitFilters({
    from: "2026-09-01",
    to: "2026-09-20",
    channel: "LAZADA",
    customerIds: "customer-1,customer-1, customer-2 ",
    productIds: "product-2,product-1,product-2",
    status: "CANCELLED",
    includeReturns: "0",
  });

  assert.equal(filters.fromStr, "2026-09-01");
  assert.equal(filters.toStr, "2026-09-20");
  assert.equal(filters.channel, "LAZADA");
  assert.deepEqual(filters.customerIds, ["customer-1", "customer-2"]);
  assert.deepEqual(filters.productIds, ["product-2", "product-1"]);
  assert.equal(filters.status, "CANCELLED");
  assert.equal(filters.includeReturns, false);
});

test("sales line profit query preserves every active report filter", async () => {
  process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";
  const { buildSalesLineProfitQuery, parseSalesLineProfitFilters } = await import(
    "@/lib/sales-line-profit-report"
  );
  const filters = parseSalesLineProfitFilters({
    from: "2026-08-01",
    to: "2026-08-31",
    channel: "SHOPEE",
    customerIds: "customer-1,customer-2",
    categoryId: "category-1",
    productCodeFrom: "A001",
    productCodeTo: "A999",
    productIds: "product-1,product-2",
    status: "CANCELLED",
    includeReturns: "1",
  });
  const params = new URLSearchParams(buildSalesLineProfitQuery(filters));

  assert.equal(params.get("from"), "2026-08-01");
  assert.equal(params.get("to"), "2026-08-31");
  assert.equal(params.get("channel"), "SHOPEE");
  assert.equal(params.get("customerIds"), "customer-1,customer-2");
  assert.equal(params.get("categoryId"), "category-1");
  assert.equal(params.get("productCodeFrom"), "A001");
  assert.equal(params.get("productCodeTo"), "A999");
  assert.equal(params.get("productIds"), "product-1,product-2");
  assert.equal(params.get("status"), "CANCELLED");
  assert.equal(params.get("includeReturns"), "1");
});

test("sales line profit is searchable without becoming a top-level sidebar item", async () => {
  const [{ ADMIN_NAVIGATION, filterAdminNavigationByPermission }, { QUICK_COMMANDS }] =
    await Promise.all([
      import("@/lib/admin-navigation"),
      import("@/lib/quick-search-commands"),
    ]);
  const href = "/admin/reports/sales-line-profit";
  const sidebarHrefs = filterAdminNavigationByPermission(ADMIN_NAVIGATION, ["reports.view"])
    .flatMap((section) => section.items)
    .map((item) => item.href);

  assert.equal(sidebarHrefs.includes(href), false);
  assert.equal(QUICK_COMMANDS.some((command) => command.href === href), true);
});

test("sales line profit export opts into the bounded low-egress query path", () => {
  const routeSource = readFileSync(
    path.join(
      process.cwd(),
      "app",
      "admin",
      "(protected)",
      "reports",
      "sales-line-profit",
      "export",
      "route.ts",
    ),
    "utf8",
  );

  assert.match(routeSource, /mode:\s*["']EXPORT["']/);
  assert.match(routeSource, /SALES_LINE_PROFIT_EXPORT_LIMIT/);
});
