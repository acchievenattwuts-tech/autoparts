import { db } from "@/lib/db";

export type CashBankAccountOption = {
  id: string;
  name: string;
  code: string;
  type: "CASH" | "BANK";
  bankName: string | null;
  accountNo: string | null;
};

export async function getActiveCashBankAccountOptions(): Promise<CashBankAccountOption[]> {
  const accounts = await db.cashBankAccount.findMany({
    where: { isActive: true },
    orderBy: [
      { type: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      bankName: true,
      accountNo: true,
    },
  });

  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    code: account.code,
    type: account.type,
    bankName: account.bankName,
    accountNo: account.accountNo,
  }));
}
