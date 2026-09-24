import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Cancelled on-site warranties are kept (status CANCELLED) instead of deleted, so
// every reader that treats warranties as "in cover" must filter them out.

const read = (path: string): string => readFileSync(join(process.cwd(), path), "utf8");

test("LIFF warranty list and counts only use ACTIVE warranties", () => {
  const source = read("app/liff/warranties/page.tsx");
  assert.match(source, /baseWarrantyWhere: Prisma\.WarrantyWhereInput = \{\s*(?:\/\/[^\n]*\n\s*)*status: "ACTIVE",/);
  // active / expired / list / counts all derive from the base filter.
  assert.equal(source.match(/\.\.\.baseWarrantyWhere/g)?.length, 2);
  assert.match(source, /db\.warranty\.count\(\{ where: baseWarrantyWhere \}\)/);
});

test("LIFF warranty detail does not open a cancelled warranty", () => {
  assert.match(read("app/liff/warranties/[id]/page.tsx"), /findFirst\(\{\s*where: \{\s*id,\s*status: "ACTIVE",/);
});

test("expiring-warranty report skips cancelled warranties", () => {
  assert.match(
    read("lib/reports.ts"),
    /warrantiesPromise = db\.warranty\.findMany\(\{\s*where: \{\s*(?:\/\/[^\n]*\n\s*)*status: "ACTIVE",\s*endDate: \{ lte: soonDate \}/,
  );
});

test("workboard and LINE daily summary open-claim counts exclude cancelled warranties", () => {
  assert.match(
    read("app/admin/(protected)/workboard/workboard-data.ts"),
    /status: "SENT_TO_SUPPLIER" as const,\s*(?:\/\/[^\n]*\n\s*)*warranty: \{ status: "ACTIVE" as const \}/,
  );
  assert.match(
    read("lib/line-daily-summary.ts"),
    /openClaimCount[\s\S]{0,200}warranty: \{ status: "ACTIVE" \}/,
  );
});

test("admin warranty list: cancelled rows get a badge/filter and no claim or cancel action", () => {
  const source = read("app/admin/(protected)/warranties/page.tsx");
  assert.match(source, /if \(status === "cancelled"\) \{\s*return \{ status: "CANCELLED" \};/);
  for (const bucket of ["expired", "soon", "active"]) {
    assert.match(source, new RegExp(`if \\(status === "${bucket}"\\) \\{\\s*return \\{ status: "ACTIVE",`));
  }
  assert.match(source, /w\.wStatus !== "expired" && w\.wStatus !== "cancelled" && w\._count\.claims === 0/);
  assert.match(source, /canCancel && w\.createdVia === "MANUAL" && w\.wStatus !== "cancelled"/);
  assert.match(source, /<Ban size=\{11\} \/> ยกเลิก/);
});
