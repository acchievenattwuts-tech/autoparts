import type { CashBankSourceType } from "@/lib/generated/prisma";

export function getCashBankSourceHref(sourceType: CashBankSourceType, sourceId: string): string | null {
  switch (sourceType) {
    case "SALE":
      return `/admin/sales/${sourceId}`;
    case "RECEIPT":
      return `/admin/receipts/${sourceId}`;
    case "PURCHASE":
      return `/admin/purchases/${sourceId}`;
    case "EXPENSE":
      return `/admin/expenses/${sourceId}`;
    case "CN_SALE":
      return `/admin/credit-notes/${sourceId}`;
    case "TRANSFER":
      return "/admin/cash-bank/transfers";
    case "ADJUSTMENT":
      return "/admin/cash-bank/adjustments";
    default:
      return null;
  }
}

export function getCashBankSourceLabel(sourceType: CashBankSourceType): string {
  switch (sourceType) {
    case "SALE":
      return "ขายสินค้า";
    case "RECEIPT":
      return "รับชำระหนี้";
    case "PURCHASE":
      return "ซื้อสินค้า";
    case "EXPENSE":
      return "ค่าใช้จ่าย";
    case "CN_SALE":
      return "CN คืนขาย";
    case "TRANSFER":
      return "โอนเงิน";
    case "ADJUSTMENT":
      return "ปรับยอดเงิน";
    default:
      return sourceType;
  }
}
