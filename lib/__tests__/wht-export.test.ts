import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_INCOME_LINES_PER_DETAIL,
  buildFormat20File,
  buildFormat20FileName,
  buildRdPrepFile,
  formatExportAmount,
  formatExportDate,
  sanitizeExportText,
  toPayConditionCode,
  type WhtExportFilingHeader,
  type WhtExportPayee,
} from "@/lib/wht-export";

const header: WhtExportFilingHeader = {
  taxType: "PND53",
  payerTaxId13: "1234567890123",
  payerBranchNo: "000000",
  departmentName: "สำนักงานใหญ่",
  taxMonth: 9,
  taxYear: 2569,
  formTypeCode: "00",
  surchargeAmount: 0,
  userId: "user01",
  formFlag: "1",
};

const payee = (overrides: Partial<WhtExportPayee> = {}): WhtExportPayee => ({
  taxId13: "9876543210987",
  taxId10: null,
  branchNo: "000000",
  titleName: "บริษัท",
  firstName: "ทดสอบ จำกัด",
  lastName: null,
  addrNo: "12",
  moo: "3",
  soi: null,
  road: "พหลโยธิน",
  subdistrict: "พญาไท",
  district: "ราชเทวี",
  province: "กรุงเทพมหานคร",
  postcode: "10400",
  lines: [
    {
      payDate: "2026-09-07T03:00:00.000Z",
      rate: 3,
      baseAmount: 10000,
      taxAmount: 300,
      incomeLabel: "ค่าจ้างทำของ ตามมาตรา 40(7)(8)",
      payConditionCode: "1",
    },
  ],
  ...overrides,
});

test("formatExportDate uses ddmmyyyy in the Buddhist era", () => {
  assert.equal(formatExportDate("2026-09-07T03:00:00.000Z"), "07092569");
  // 31 ธ.ค. 23:30 UTC = 1 ม.ค. ตามเวลาไทย ปีภาษีต้องเดินไปปีถัดไป
  assert.equal(formatExportDate("2026-12-31T23:30:00.000Z"), "01012570");
});

test("formatExportAmount always carries two decimals", () => {
  assert.equal(formatExportAmount(0), "0.00");
  assert.equal(formatExportAmount(null), "0.00");
  assert.equal(formatExportAmount(1234.5), "1234.50");
  assert.equal(formatExportAmount(0.005), "0.01");
});

test("sanitizeExportText drops the characters the spec forbids", () => {
  assert.equal(sanitizeExportText("ห้าง* หุ้นส่วน/จำกัด, & @ #", 100), "ห้าง หุ้นส่วน จำกัด");
  assert.equal(sanitizeExportText("a|b", 100), "a b");
  assert.equal(sanitizeExportText(null, 10), "");
  assert.equal(sanitizeExportText("abcdefghij", 5), "abcde");
});

test("toPayConditionCode maps the enum onto the numbers the form uses", () => {
  assert.equal(toPayConditionCode("WITHHELD"), "1");
  assert.equal(toPayConditionCode("PAID_ALWAYS"), "2");
  assert.equal(toPayConditionCode("PAID_ONCE"), "3");
  assert.equal(toPayConditionCode("UNKNOWN"), "1");
});

test("Format 2.0 file has one header row plus one detail row per payee", () => {
  const { content } = buildFormat20File(header, [payee(), payee()]);
  const rows = content.trimEnd().split("\r\n");

  assert.equal(rows.length, 3);
  assert.ok(rows[0].startsWith("H|"));
  assert.ok(rows[1].startsWith("D|"));
  assert.ok(rows[2].startsWith("D|"));
  assert.ok(content.endsWith("\r\n"), "แต่ละ record ต้องปิดท้ายด้วย CR/LF");
});

test("Format 2.0 rows never start or end with a pipe", () => {
  const { content } = buildFormat20File(header, [payee()]);
  for (const row of content.trimEnd().split("\r\n")) {
    assert.ok(!row.startsWith("|"), "ห้ามมี pipe ปิดหัวแถว");
    assert.ok(!row.endsWith("|"), "ห้ามมี pipe ปิดท้ายแถว");
  }
});

test("Format 2.0 header totals sum every income line", () => {
  const { content } = buildFormat20File(header, [
    payee(),
    payee({
      lines: [
        {
          payDate: "2026-09-08T03:00:00.000Z",
          rate: 1,
          baseAmount: 500,
          taxAmount: 5,
          incomeLabel: "ค่าขนส่ง",
          payConditionCode: "1",
        },
      ],
    }),
  ]);
  const fields = content.split("\r\n")[0].split("|");

  assert.equal(fields[17], "2", "จำนวนรายต้องเท่ากับจำนวนแถว DETAIL");
  assert.equal(fields[18], "10500.00");
  assert.equal(fields[19], "305.00");
  assert.equal(fields[21], "305.00", "ยอดรวมภาษีและเงินเพิ่ม");
});

test("Format 2.0 detail pads unused income slots instead of dropping fields", () => {
  const { content } = buildFormat20File(header, [payee()]);
  const fields = content.split("\r\n")[1].split("|");

  // 8 ฟิลด์แรก + 6 ฟิลด์ต่อรายการเงินได้ 3 ชุด + 12 ฟิลด์ที่อยู่ = 38
  assert.equal(fields.length, 38);
  assert.equal(fields[4], "0000000000", "ไม่มีเลข 10 หลักให้ระบุศูนย์");
  assert.equal(fields[8], "07092569");
  assert.equal(fields[14], "00000000", "รายการที่ 2 ที่ไม่มีข้อมูลใช้วันที่ศูนย์");
  assert.equal(fields[16], "0.00");
  assert.equal(fields[37], "10400");
});

test("Format 2.0 fills at most three income lines per detail row", () => {
  const manyLines = Array.from({ length: 5 }, (_, index) => ({
    payDate: "2026-09-07T03:00:00.000Z",
    rate: 3,
    baseAmount: 100 * (index + 1),
    taxAmount: 3 * (index + 1),
    incomeLabel: `รายการ ${index + 1}`,
    payConditionCode: "1" as const,
  }));
  const { content } = buildFormat20File(header, [payee({ lines: manyLines })]);
  const fields = content.split("\r\n")[1].split("|");

  assert.equal(MAX_INCOME_LINES_PER_DETAIL, 3);
  assert.equal(fields[12], "รายการ 1");
  assert.equal(fields[18], "รายการ 2");
  assert.equal(fields[24], "รายการ 3");
});

test("Format 2.0 file name follows the naming rule in the spec", () => {
  assert.equal(buildFormat20FileName(header), "PND53_1234567890123_000000_2569_09_00_00.txt");
  assert.equal(
    buildFormat20FileName({ ...header, formTypeCode: "1", taxMonth: 12 }, 3),
    "PND53_1234567890123_000000_2569_12_01_03.txt",
  );
});

test("RD Prep file emits one row per income line with dd/mm/yy dates", () => {
  const { content } = buildRdPrepFile([
    payee({
      lines: [
        {
          payDate: "2026-09-07T03:00:00.000Z",
          rate: 3,
          baseAmount: 10000,
          taxAmount: 300,
          incomeLabel: "ค่าจ้างทำของ",
          payConditionCode: "1",
        },
        {
          payDate: "2026-09-08T03:00:00.000Z",
          rate: 1,
          baseAmount: 500,
          taxAmount: 5,
          incomeLabel: "ค่าขนส่ง",
          payConditionCode: "3",
        },
      ],
    }),
  ]);
  const rows = content.trimEnd().split("\r\n");

  assert.equal(rows.length, 2);
  const first = rows[0].split("|");
  assert.equal(first.length, 18);
  assert.equal(first[0], "1");
  assert.equal(first[12], "07/09/69");
  assert.equal(first[16], "300.00");
  assert.equal(rows[1].split("|")[0], "2", "ลำดับที่เดินต่อข้ามบรรทัด");
  assert.equal(rows[1].split("|")[17], "3");
});
