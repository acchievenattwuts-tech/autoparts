import { hasMoreThanTwoDecimals, roundStoredMoney } from "@/lib/sale-profit-revenue";

export type SaleRoundingLine = {
  qty: number;
  salePrice: number;
  productName: string;
};

export type SaleRoundingRow = {
  lineNo: number;
  productName: string;
  unitPrice: number;
  savedUnitPrice: number;
  lineAmount: number;
  savedLineAmount: number;
};

/**
 * Lines whose unit price or line amount has more than 2 decimals. The sale stores both
 * with 2 decimals (Decimal(10,2)), so the form asks the user to confirm the rounded
 * amounts before saving; lines already at 2 decimals are not listed.
 */
export function buildSaleRoundingRows(lines: readonly SaleRoundingLine[]): SaleRoundingRow[] {
  return lines.flatMap((line, index) => {
    const lineAmount = line.qty * line.salePrice;
    if (!Number.isFinite(lineAmount) || !Number.isFinite(line.salePrice)) return [];
    if (!hasMoreThanTwoDecimals(line.salePrice) && !hasMoreThanTwoDecimals(lineAmount)) return [];
    return [{
      lineNo: index + 1,
      productName: line.productName,
      unitPrice: line.salePrice,
      savedUnitPrice: roundStoredMoney(line.salePrice),
      lineAmount,
      savedLineAmount: roundStoredMoney(lineAmount),
    }];
  });
}
