/**
 * Run after prisma/scripts/wht-schema.sql.
 * Seeds the withholding-tax income-type master and registers wht.* permissions.
 * Safe to re-run: income types upsert by `code`, permissions use skipDuplicates.
 *
 * อัตราภาษีอ้างอิงตารางในคู่มือการหักภาษี ณ ที่จ่าย ของกรมสรรพากร
 * (เฉพาะกรณีนำส่งด้วยแบบ ภ.ง.ด.3 และ ภ.ง.ด.53) — ผู้ใช้แก้อัตรารายใบได้เสมอ
 */
import { db, dbTx } from "../../lib/db";
import { PERMISSION_CATALOG } from "../../lib/access-control";
import { writeAuditLogTx } from "../../lib/audit-log";
import { WhtFormType } from "../../lib/generated/prisma";

interface IncomeTypeSeed {
  code: string;
  label: string;
  defaultRate: string;
  formTypes: WhtFormType[];
  legalRef: string;
  usableForReceived: boolean;
  usableForIssued: boolean;
}

const BOTH_FORMS: WhtFormType[] = [WhtFormType.PND3, WhtFormType.PND53];

const INCOME_TYPES: IncomeTypeSeed[] = [
  {
    code: "RENT",
    label: "ค่าเช่าทรัพย์สิน ตามมาตรา 40(5)(ก)",
    defaultRate: "5.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 6",
    usableForReceived: true,
    usableForIssued: true,
  },
  {
    code: "RENT_SHIP",
    label: "ค่าเช่าเรือตามกฎหมายว่าด้วยการส่งเสริมพาณิชยนาวี",
    defaultRate: "1.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 7",
    usableForReceived: false,
    usableForIssued: true,
  },
  {
    code: "PROFESSION",
    label: "ค่าวิชาชีพอิสระ ตามมาตรา 40(6)",
    defaultRate: "3.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 7",
    usableForReceived: true,
    usableForIssued: true,
  },
  {
    code: "HIRE_OF_WORK",
    label: "ค่าจ้างทำของ ตามมาตรา 40(7)(8)",
    defaultRate: "3.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 8",
    usableForReceived: true,
    usableForIssued: true,
  },
  {
    code: "PRIZE",
    label: "รางวัลจากการประกวด การแข่งขัน การชิงโชค",
    defaultRate: "5.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 9",
    usableForReceived: false,
    usableForIssued: true,
  },
  {
    code: "PUBLIC_PERFORMER",
    label: "ค่าแสดงของนักแสดงสาธารณะ",
    defaultRate: "5.00",
    formTypes: [WhtFormType.PND3],
    legalRef: "ท.ป.4/2528 ข้อ 9 ทวิ",
    usableForReceived: false,
    usableForIssued: true,
  },
  {
    code: "ADVERTISING",
    label: "ค่าโฆษณา",
    defaultRate: "2.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 10",
    usableForReceived: true,
    usableForIssued: true,
  },
  {
    code: "SERVICE",
    label: "ค่าบริการ ตามมาตรา 40(8)",
    defaultRate: "3.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 12/1",
    usableForReceived: true,
    usableForIssued: true,
  },
  {
    code: "SALES_PROMOTION",
    label: "รางวัล ส่วนลด หรือประโยชน์ใดๆ เนื่องจากการส่งเสริมการขาย",
    defaultRate: "3.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 12/2",
    usableForReceived: true,
    usableForIssued: true,
  },
  {
    code: "NON_LIFE_INSURANCE",
    label: "ค่าเบี้ยประกันวินาศภัย",
    defaultRate: "1.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 12/3",
    usableForReceived: false,
    usableForIssued: true,
  },
  {
    code: "TRANSPORT",
    label: "ค่าขนส่ง (ไม่รวมค่าโดยสารสำหรับการขนส่งสาธารณะ)",
    defaultRate: "1.00",
    formTypes: BOTH_FORMS,
    legalRef: "ท.ป.4/2528 ข้อ 12/4",
    usableForReceived: true,
    usableForIssued: true,
  },
];

const LABEL_MAX_LENGTH = 100;

async function seedIncomeTypes(): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const [index, seed] of INCOME_TYPES.entries()) {
    if (seed.label.length > LABEL_MAX_LENGTH) {
      throw new Error(`ประเภทเงินได้ ${seed.code} มีชื่อยาวเกิน ${LABEL_MAX_LENGTH} ตัวอักษร`);
    }

    const existing = await db.whtIncomeType.findUnique({
      where: { code: seed.code },
      select: { id: true },
    });

    await db.whtIncomeType.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        label: seed.label,
        defaultRate: seed.defaultRate,
        formTypes: seed.formTypes,
        legalRef: seed.legalRef,
        usableForReceived: seed.usableForReceived,
        usableForIssued: seed.usableForIssued,
        sortOrder: (index + 1) * 10,
      },
      update: {
        label: seed.label,
        formTypes: seed.formTypes,
        legalRef: seed.legalRef,
        usableForReceived: seed.usableForReceived,
        usableForIssued: seed.usableForIssued,
        sortOrder: (index + 1) * 10,
      },
    });

    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated };
}

/**
 * ค่าใช้จ่ายเดิมไม่มีผู้รับเงิน — เจ้าของสั่งให้ผูกทั้งหมดกับซัพพลายเออร์ S0018 "No Supplier"
 * เติมเฉพาะแถวที่ยังว่าง จึงรันซ้ำได้โดยไม่ทับข้อมูลที่คีย์ผู้รับเงินไว้แล้ว
 */
const FALLBACK_EXPENSE_SUPPLIER_CODE = "S0018";

async function backfillExpenseSupplier(): Promise<{ supplierCode: string; updated: number }> {
  const supplier = await db.supplier.findFirst({
    where: { code: FALLBACK_EXPENSE_SUPPLIER_CODE },
    select: { id: true },
  });
  if (!supplier) {
    throw new Error(`ไม่พบซัพพลายเออร์รหัส ${FALLBACK_EXPENSE_SUPPLIER_CODE} สำหรับ backfill ค่าใช้จ่ายเดิม`);
  }

  const result = await db.expense.updateMany({
    where: { supplierId: null },
    data: { supplierId: supplier.id },
  });

  return { supplierCode: FALLBACK_EXPENSE_SUPPLIER_CODE, updated: result.count };
}

async function registerPermissions(): Promise<{ inserted: number; granted: number }> {
  return dbTx(async (tx) => {
    const catalog = PERMISSION_CATALOG.filter(
      (permission) => permission.key.startsWith("wht.") || permission.key.startsWith("wht_filings."),
    );

    const inserted = await tx.permission.createMany({
      data: catalog.map(({ key, group, label }) => ({ key, group, label })),
      skipDuplicates: true,
    });

    const role = await tx.appRole.findUnique({ where: { name: "ADMIN" }, select: { id: true } });
    const permissions = await tx.permission.findMany({
      where: { key: { in: catalog.map((row) => row.key) } },
      select: { id: true },
    });

    const granted = role
      ? await tx.appRolePermission.createMany({
          data: permissions.map((permission) => ({ appRoleId: role.id, permissionId: permission.id })),
          skipDuplicates: true,
        })
      : { count: 0 };

    if (inserted.count || granted.count) {
      await writeAuditLogTx(tx, {
        userName: "System",
        action: "UPDATE",
        entityType: "Permission",
        entityRef: "wht",
        after: {
          permissions: catalog.map((row) => row.key),
          role: "ADMIN",
          inserted: inserted.count,
          granted: granted.count,
        },
      });
    }

    return { inserted: inserted.count, granted: granted.count };
  });
}

async function main() {
  const incomeTypes = await seedIncomeTypes();
  const permissions = await registerPermissions();
  const expenseSupplier = await backfillExpenseSupplier();

  const searchColumn = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_search_documents' AND column_name = 'trgm_text'
  `;

  console.log(
    JSON.stringify({
      incomeTypes,
      incomeTypeCount: await db.whtIncomeType.count(),
      permissions,
      expenseSupplier,
      expensesWithoutSupplier: await db.expense.count({ where: { supplierId: null } }),
      searchColumnPreserved: searchColumn.length === 1,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Setup failed");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
