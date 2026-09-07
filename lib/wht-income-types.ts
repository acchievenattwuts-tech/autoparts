import { db } from "@/lib/db";
import type { WhtIncomeTypeOption } from "@/components/shared/WhtReceivedFields";

/** ประเภทเงินได้ที่ใช้กับฝั่ง "เราถูกหัก" — ใช้ร่วมกันในฟอร์มใบเสร็จและฟอร์มขายสด */
export async function getWhtReceivedIncomeTypeOptions(): Promise<WhtIncomeTypeOption[]> {
  const rows = await db.whtIncomeType.findMany({
    where: { isActive: true, usableForReceived: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, label: true, defaultRate: true },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    defaultRate: Number(row.defaultRate),
  }));
}

/** ประเภทเงินได้ที่ใช้กับฝั่ง "เราหักคนอื่น" — ใช้ตอนออกหนังสือรับรอง 50 ทวิ */
export async function getWhtIssuedIncomeTypeOptions(): Promise<WhtIncomeTypeOption[]> {
  const rows = await db.whtIncomeType.findMany({
    where: { isActive: true, usableForIssued: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: { id: true, code: true, label: true, defaultRate: true },
  });

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    defaultRate: Number(row.defaultRate),
  }));
}
