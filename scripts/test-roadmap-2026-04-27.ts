import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  AUDIT_PAGE_SIZE,
  buildAuditDiffRows,
  buildAuditLogListHref,
  buildAuditLogWhere,
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditSourceHref,
  parseAuditLogSearchParams,
} from "../lib/audit-log-view";
import { AuditAction } from "../lib/generated/prisma";
import { getThailandDateKey } from "../lib/th-date";

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message);
}

function expectExcludes(source: string, needle: string, message: string) {
  assert.ok(!source.includes(needle), message);
}

function expectFile(relativePath: string, message: string) {
  assert.ok(existsSync(path.join(repoRoot, relativePath)), message);
}

function runAuditLogHelperChecks() {
  const defaultDate = getThailandDateKey();
  const parsedDefaults = parseAuditLogSearchParams({});
  assert.equal(parsedDefaults.ready, false);
  assert.equal(parsedDefaults.page, 1);
  assert.equal(parsedDefaults.startDate, defaultDate);
  assert.equal(parsedDefaults.endDate, defaultDate);

  const parsedCustom = parseAuditLogSearchParams({
    user: "owner",
    action: AuditAction.LOGIN_FAILED,
    entityType: "Sale",
    entityRef: "SO-001",
    startDate: "2026-04-01",
    endDate: "2026-04-30",
    ready: "1",
    page: "3",
  });
  assert.equal(parsedCustom.ready, true);
  assert.equal(parsedCustom.page, 3);
  assert.equal(parsedCustom.action, AuditAction.LOGIN_FAILED);
  assert.equal(parsedCustom.user, "owner");

  const href = buildAuditLogListHref(parsedCustom, 2);
  expectIncludes(href, "user=owner", "Audit log list href must preserve the user filter");
  expectIncludes(href, "action=LOGIN_FAILED", "Audit log list href must preserve the action filter");
  expectIncludes(href, "page=2", "Audit log list href must use the requested page");
  expectIncludes(href, "ready=1", "Audit log list href must preserve the ready state");

  const where = buildAuditLogWhere(parsedCustom);
  assert.ok(where, "Audit log where clause must be created when the filters are ready");
  assert.equal(where?.action, AuditAction.LOGIN_FAILED);
  assert.ok(where?.createdAt, "Audit log where clause must constrain the createdAt range");

  const diffRows = buildAuditDiffRows(
    {
      amountRemain: 1200,
      nested: { status: "ACTIVE", paymentType: "CREDIT_SALE" },
    },
    {
      amountRemain: 0,
      nested: { status: "CANCELLED", paymentType: "CREDIT_SALE" },
    },
  );
  assert.ok(
    diffRows.some((row) => row.path === "amountRemain" && row.before === "1200" && row.after === "0"),
    "Audit diff rows must include changed scalar fields",
  );
  assert.ok(
    diffRows.some((row) => row.path === "nested.status" && row.before === "ACTIVE" && row.after === "CANCELLED"),
    "Audit diff rows must include changed nested fields",
  );

  assert.equal(getAuditActionLabel(AuditAction.LOGIN_FAILED), "เข้าสู่ระบบไม่สำเร็จ");
  assert.equal(getAuditEntityLabel("Sale"), "ใบขาย");
  assert.equal(getAuditSourceHref("Sale", "sale-1"), "/admin/sales/sale-1");
  assert.equal(getAuditSourceHref("AuditLog", "audit-1"), null);
  assert.equal(AUDIT_PAGE_SIZE, 100);
}

function runAuditLogSourceChecks() {
  const auditLogLib = readRepoFile("lib/audit-log.ts");
  const auditLogPage = readRepoFile("app/admin/(protected)/audit-log/page.tsx");
  const auditLogDetailPage = readRepoFile("app/admin/(protected)/audit-log/[id]/page.tsx");

  expectIncludes(auditLogLib, "export async function writeAuditLog(", "Audit log library must expose writeAuditLog");
  expectIncludes(auditLogLib, "export async function writeAuditLogTx(", "Audit log library must expose writeAuditLogTx");
  expectIncludes(auditLogLib, "export async function safeWriteAuditLog(", "Audit log library must expose safeWriteAuditLog");
  expectIncludes(auditLogLib, "export function diffEntity(", "Audit log library must expose diffEntity");
  expectIncludes(auditLogLib, "export function redactSensitive(", "Audit log library must expose redactSensitive");
  expectIncludes(auditLogLib, "export async function getRequestContext(", "Audit log library must expose getRequestContext");
  expectIncludes(auditLogLib, "console.error(\"[audit-log]\"", "Audit log safe writer must log failures without throwing");

  expectIncludes(auditLogPage, "export const dynamic = \"force-dynamic\";", "Audit log list page must stay dynamic");
  expectIncludes(auditLogPage, "requirePermission(\"audit_log.view\")", "Audit log list page must require audit_log.view");
  expectIncludes(auditLogPage, "db.auditLog.findMany", "Audit log list page must query auditLog rows");
  expectExcludes(auditLogPage, "db.auditLog.create", "Audit log list page must remain read-only");
  expectExcludes(auditLogPage, "db.auditLog.update", "Audit log list page must remain append-only");
  expectExcludes(auditLogPage, "db.auditLog.delete", "Audit log list page must remain append-only");

  expectIncludes(auditLogDetailPage, "export const dynamic = \"force-dynamic\";", "Audit log detail page must stay dynamic");
  expectIncludes(auditLogDetailPage, "requirePermission(\"audit_log.view\")", "Audit log detail page must require audit_log.view");
  expectIncludes(auditLogDetailPage, "buildAuditDiffRows", "Audit log detail page must render diff rows");

  expectFile("app/admin/(protected)/audit-log/loading.tsx", "Audit log list segment must include loading.tsx");
  expectFile("app/admin/(protected)/audit-log/[id]/loading.tsx", "Audit log detail segment must include loading.tsx");
}

function runWorkboardSourceChecks() {
  const workboardPage = readRepoFile("app/admin/(protected)/workboard/page.tsx");
  const workboardData = readRepoFile("app/admin/(protected)/workboard/workboard-data.ts");

  expectIncludes(workboardPage, "export const dynamic = \"force-dynamic\";", "Workboard page must stay dynamic");
  expectIncludes(workboardPage, "requirePermission(\"workboard.view\")", "Workboard page must require workboard.view");
  expectIncludes(workboardPage, "ไม่มีงานค้างในหมวดนี้", "Workboard page must keep the shared empty state text");
  expectIncludes(workboardPage, "Today Workboard", "Workboard page must keep the Today Workboard title");
  expectIncludes(workboardPage, "ใบขายรอจัดส่งวันนี้", "Workboard page must keep the pending deliveries section");
  expectIncludes(workboardPage, "COD รอรับเงิน", "Workboard page must keep the COD section");
  expectIncludes(workboardPage, "ลูกหนี้เกินเครดิต", "Workboard page must keep the overdue AR section");
  expectIncludes(workboardPage, "Supplier ครบกำหนดจ่าย", "Workboard page must keep the overdue AP section");
  expectIncludes(workboardPage, "Lot ใกล้หมดอายุ", "Workboard page must keep the expiring lot section");
  expectIncludes(workboardPage, "เงินสด/ธนาคาร ต่ำกว่าเกณฑ์เตือน", "Workboard page must keep the low balance section");
  expectIncludes(workboardPage, "dark:", "Workboard page must include dark-mode classes");

  expectIncludes(workboardData, "lowBalanceThreshold", "Workboard data query must include the low balance threshold field");
  expectIncludes(workboardData, "Promise.all([", "Workboard data loader must fetch sections in parallel");
  expectIncludes(workboardData, "take: 5", "Workboard data queries must cap top lists at 5 items");
  expectIncludes(workboardData, "slice(0, 5)", "Workboard in-memory lists must be capped to 5 items");

  expectFile("app/admin/(protected)/workboard/loading.tsx", "Workboard segment must include loading.tsx");
}

function runRegisterSourceChecks() {
  const arReportPage = readRepoFile("app/admin/(protected)/reports/ar/page.tsx");
  const apReportPage = readRepoFile("app/admin/(protected)/reports/ap/page.tsx");
  const registerQueries = readRepoFile("lib/ar-ap-register-queries.ts");

  expectIncludes(arReportPage, "export const dynamic = \"force-dynamic\";", "AR report page must stay dynamic");
  expectIncludes(apReportPage, "export const dynamic = \"force-dynamic\";", "AP report page must stay dynamic");
  expectIncludes(arReportPage, "option value=\"register\"", "AR report page must expose the register view option");
  expectIncludes(apReportPage, "option value=\"register\"", "AP report page must expose the register view option");
  expectIncludes(arReportPage, "params.set(\"view\", \"register\")", "AR export links must preserve the register view");
  expectIncludes(apReportPage, "params.set(\"view\", \"register\")", "AP export links must preserve the register view");
  expectIncludes(arReportPage, "italic text-gray-400", "AR register table must style cancelled rows distinctly");
  expectIncludes(apReportPage, "italic text-gray-400", "AP register table must style cancelled rows distinctly");
  expectIncludes(arReportPage, "dark:", "AR report page must include dark-mode classes");
  expectIncludes(apReportPage, "dark:", "AP report page must include dark-mode classes");

  expectIncludes(registerQueries, "const BOM = \"﻿\";", "Register CSV exports must keep the UTF-8 BOM");
  expectIncludes(registerQueries, "export function buildARRegisterCsv(", "Register queries must expose AR CSV export");
  expectIncludes(registerQueries, "export async function buildARRegisterExcel(", "Register queries must expose AR Excel export");
  expectIncludes(registerQueries, "export function buildAPRegisterCsv(", "Register queries must expose AP CSV export");
  expectIncludes(registerQueries, "export async function buildAPRegisterExcel(", "Register queries must expose AP Excel export");
  expectIncludes(registerQueries, "export function summarizeARRegister(", "Register queries must expose AR summary helpers");
  expectIncludes(registerQueries, "export function summarizeAPRegister(", "Register queries must expose AP summary helpers");

  expectFile("app/admin/(protected)/reports/ar/loading.tsx", "AR report segment must include loading.tsx");
  expectFile("app/admin/(protected)/reports/ap/loading.tsx", "AP report segment must include loading.tsx");
}

runAuditLogHelperChecks();
runAuditLogSourceChecks();
runWorkboardSourceChecks();
runRegisterSourceChecks();

console.log("Roadmap 2026-04-27 regression checks passed");
