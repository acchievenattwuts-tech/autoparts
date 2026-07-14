import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runProductSearchRefreshWithRequestLifetime } from "@/lib/product-search-request-lifecycle";

test("cached search refresh registers before its work starts", async () => {
  const events: string[] = [];
  let registeredTask: Promise<unknown> | null = null;

  const task = runProductSearchRefreshWithRequestLifetime(
    async () => {
      events.push("started");
      return "ok";
    },
    (pending) => {
      events.push("registered");
      registeredTask = pending;
    },
  );

  assert.equal(registeredTask, task);
  assert.deepEqual(events, ["registered"]);
  assert.equal(await task, "ok");
  assert.deepEqual(events, ["registered", "started"]);
});

test("request-lifetime registration does not change task rejection", async () => {
  const expected = new Error("refresh failed");
  const task = runProductSearchRefreshWithRequestLifetime(
    async () => {
      throw expected;
    },
    (pending) => {
      void pending.catch(() => undefined);
    },
  );

  await assert.rejects(task, expected);
});

test("both raw and bundled search transactions set the server-side idle guard", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/db.ts"), "utf8");
  const rawStart = source.indexOf("export async function dbSearchRaw");
  const bundleStart = source.indexOf("export async function dbSearchTx");

  assert.ok(rawStart >= 0);
  assert.ok(bundleStart > rawStart);

  const rawHelper = source.slice(rawStart, bundleStart);
  const bundleHelper = source.slice(bundleStart);
  const idleGuard = "set_config('idle_in_transaction_session_timeout'";

  assert.match(source, /const SEARCH_IDLE_IN_TX_TIMEOUT_MS = 20_000;/);
  assert.ok(rawHelper.includes(idleGuard));
  assert.ok(bundleHelper.includes(idleGuard));
});

test("the unstable product-search cache wires regeneration into the request lifecycle", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/product-search.ts"), "utf8");

  assert.ok(source.includes("runProductSearchRefreshWithRequestLifetime(async () =>"));
  assert.ok(source.includes("revalidate: getProductSearchCacheTtl(cacheProfile)"));
});
