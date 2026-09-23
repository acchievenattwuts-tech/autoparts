import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

const listTsx = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsx(entryPath);
    return entry.name.endsWith(".tsx") ? [entryPath] : [];
  });

// Detached promises in a Server Component can be cut off on serverless once the
// response is sent; LIFF document-view audits must go through after().
test("LIFF pages never fire-and-forget an audit write", () => {
  const offenders = listTsx(path.join(repoRoot, "app", "liff"))
    .filter((filePath) => /void\s+safeWriteAuditLog\s*\(/.test(readFileSync(filePath, "utf8")))
    .map((filePath) => path.relative(repoRoot, filePath));
  assert.deepEqual(offenders, []);

  for (const page of ["app/liff/orders/[id]/invoice/page.tsx", "app/liff/orders/[id]/receipt/page.tsx"]) {
    const source = read(page);
    assert.match(source, /import \{ after \} from "next\/server";/, page);
    assert.match(source, /after\(\(\) =>\s+safeWriteAuditLog\(\{/, page);
  }
});

// Tracking pages: no background polling once the delivery is final, and a
// resume only forces a new OSRM route when no real route line is shown.
for (const file of [
  "app/liff/tracking/[token]/DeliveryTrackingClient.tsx",
  "app/liff/orders/[id]/InlineDeliveryTracker.tsx",
]) {
  test(`${file} stops polling after delivery and does not force re-routing on every resume`, () => {
    const source = read(file);
    assert.match(source, /new Set\(\["DELIVERED", "CANCELLED"\]\)/);
    assert.match(source, /if \(isFinalStatus\) return;\s+const id = setInterval\(/);
    assert.match(source, /refreshTracking\(\{ forceRoute: !routeLayerRef\.current, recenter: true \}\)/);
    // The explicit refresh button still forces a fresh route.
    if (file.includes("InlineDeliveryTracker")) {
      assert.match(source, /refreshTracking\(\{ forceRoute: true, recenter: true, showSpinner: true \}\)/);
    }
  });
}
