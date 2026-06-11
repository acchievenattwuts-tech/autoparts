import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERAL_REPORT_EXPORT_ROW_LIMIT,
  getReportExportRowLimit,
} from "../lib/report-export-limits";

test("getReportExportRowLimit caps document-style report exports", () => {
  assert.equal(getReportExportRowLimit("sales"), GENERAL_REPORT_EXPORT_ROW_LIMIT);
  assert.equal(getReportExportRowLimit("purchases"), GENERAL_REPORT_EXPORT_ROW_LIMIT);
});

test("getReportExportRowLimit preserves uncapped aggregate report exports", () => {
  assert.equal(getReportExportRowLimit("ar"), null);
  assert.equal(getReportExportRowLimit("cash-bank-ledger"), null);
  assert.equal(getReportExportRowLimit("stock"), null);
});
