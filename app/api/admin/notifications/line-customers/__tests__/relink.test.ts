import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { AuditAction } from "@/lib/generated/prisma";
import { isAdminLineUnlinkAudit } from "@/lib/liff-customer";
import { findRelinkedCustomerIds, type CustomerLinkStateAudit } from "../relink";

// The bell list marks an old customer "relinked" by the same rule the LIFF link flow uses
// (lib/liff-customer.ts): among the LINE link-state events before the current link, the newest
// wins — an admin unlink (flagged UPDATE/CANCEL, or a legacy audit whose before/after cleared
// lineUserId) means relinked; a LIFF link/registration means not.

const LINKED_AT = new Date("2026-09-20T05:00:00.000Z");
const at = (iso: string) => new Date(iso);
const customer = { id: "c1", lineLinkedAt: LINKED_AT };

const audit = (overrides: Partial<CustomerLinkStateAudit>): CustomerLinkStateAudit => ({
  action: AuditAction.UPDATE,
  entityId: "c1",
  createdAt: at("2026-09-10T00:00:00.000Z"),
  meta: null,
  before: null,
  after: null,
  ...overrides,
});

const flaggedUnlink = (createdAt: string, action: AuditAction = AuditAction.UPDATE) =>
  audit({ action, createdAt: at(createdAt), meta: { lineUnlinkedByAdmin: true } });

const relinked = (logs: CustomerLinkStateAudit[]) => findRelinkedCustomerIds([customer], logs).has("c1");

test("a flagged admin unlink (UPDATE) before the current link is a relink", () => {
  assert.equal(relinked([flaggedUnlink("2026-09-10T00:00:00.000Z")]), true);
});

test("a flagged deactivation (CANCEL) that released the link counts too", () => {
  assert.equal(relinked([flaggedUnlink("2026-09-10T00:00:00.000Z", AuditAction.CANCEL)]), true);
});

test("an old unflagged audit whose before/after cleared lineUserId counts too", () => {
  const legacy = audit({ before: { lineUserId: "U123", name: "ก" }, after: { lineUserId: null, name: "ก" } });
  assert.equal(isAdminLineUnlinkAudit(legacy), true, "same predicate as the LIFF flow");
  assert.equal(relinked([legacy]), true);
});

test("the newest link-state event wins: a later LIFF link before the current one means not a relink", () => {
  const logs = [
    flaggedUnlink("2026-09-01T00:00:00.000Z"),
    audit({ action: AuditAction.LINE_LINK, createdAt: at("2026-09-05T00:00:00.000Z"), meta: { lineUserId: "U1" } }),
  ];
  assert.equal(relinked(logs), false);
  // Unlinked again after that link → relink.
  assert.equal(relinked([...logs, flaggedUnlink("2026-09-15T00:00:00.000Z")]), true);
});

test("unrelated audits (a profile edit) never hide the unlink; the current link's own audit is ignored", () => {
  const logs = [
    flaggedUnlink("2026-09-01T00:00:00.000Z"),
    audit({ createdAt: at("2026-09-12T00:00:00.000Z"), before: { phone: "081" }, after: { phone: "082" } }),
    audit({ action: AuditAction.LINE_LINK, createdAt: at("2026-09-20T05:00:01.000Z") }),
  ];
  assert.equal(relinked(logs), true);
});

test("an UPDATE that only set lineUserId (not cleared) is not an unlink", () => {
  assert.equal(relinked([audit({ before: { lineUserId: null }, after: { lineUserId: "U1" } })]), false);
  assert.equal(relinked([]), false);
});

test("the route reuses the shared rule instead of its own meta check", () => {
  const route = readFileSync(path.join(process.cwd(), "app/api/admin/notifications/line-customers/route.ts"), "utf8");
  assert.match(route, /findRelinkedCustomerIds/);
  assert.doesNotMatch(route, /lineUnlinkedByAdmin/);
  const relink = readFileSync(path.join(process.cwd(), "app/api/admin/notifications/line-customers/relink.ts"), "utf8");
  assert.match(relink, /isAdminLineUnlinkAudit/);
  assert.match(relink, /from "@\/lib\/liff-customer"/);
});
