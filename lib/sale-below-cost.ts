import type { VatType } from "@/lib/generated/prisma";
import { calcItemSubtotal } from "@/lib/vat";

/**
 * M10 (review 2026-11-12): a sale line priced below its cost is reported to the owner after the
 * sale is saved (bell + Telegram, lib/notifications.ts). It never blocks or changes the sale.
 *
 * The comparison, per line, in base-unit terms:
 * - revenue = the line's pre-VAT amount, `calcItemSubtotal(qty × salePrice)` — the same figure
 *   stored as SaleItem.subtotalAmount. `salePrice` is already net of the line discount (list price
 *   minus discount per unit), and a VAT-included price has its VAT taken out, so the shop's own
 *   revenue is compared. The bill-level discount and shipping fee are not spread over the lines.
 * - cost = the cost snapshot the sale stores (`resolveSaleUnitCost`, per base unit) × base quantity.
 * - below cost when revenue is lower than cost by at least one satang. A product with no cost
 *   (0) is never reported.
 */

/** Half a satang: a difference smaller than this is rounding, not a lower price. */
const BELOW_COST_TOLERANCE = 0.005;

export type SaleLineCostCheckInput = {
  productId: string;
  unitName: string;
  /** Quantity in the unit sold. */
  qty: number;
  /** Net price per unit sold, after the line discount. */
  salePrice: number;
  /** Base units per unit sold. */
  unitScale: number;
  /** Cost per base unit stored on the line. */
  costPerBase: number;
  vatType: VatType;
  vatRate: number;
};

export type SaleBelowCostLine = {
  productId: string;
  unitName: string;
  qty: number;
  /** Pre-VAT price per unit sold. */
  pricePerUnit: number;
  /** Cost per unit sold (cost per base unit × scale). */
  costPerUnit: number;
};

/** The line as reported when its pre-VAT revenue is below its cost; null otherwise. */
export const findSaleLineBelowCost = (line: SaleLineCostCheckInput): SaleBelowCostLine | null => {
  if (!(line.costPerBase > 0) || !(line.qty > 0) || !(line.unitScale > 0)) return null;
  const revenue = calcItemSubtotal(line.qty * line.salePrice, line.vatType, line.vatRate);
  const cost = line.costPerBase * line.qty * line.unitScale;
  if (revenue + BELOW_COST_TOLERANCE > cost) return null;
  return {
    productId: line.productId,
    unitName: line.unitName,
    qty: line.qty,
    pricePerUnit: revenue / line.qty,
    costPerUnit: line.costPerBase * line.unitScale,
  };
};
