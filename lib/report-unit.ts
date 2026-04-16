export type ReportUnitOption = {
  name: string;
  scale: number;
  isBase?: boolean;
};

export type ReportUnitProductLike = {
  reportUnitName: string;
  units: ReportUnitOption[];
};

export function resolveReportUnit(product: ReportUnitProductLike): {
  unitName: string;
  scale: number;
} {
  const matchedUnit = product.units.find((unit) => unit.name === product.reportUnitName);
  const fallbackUnit = product.units.find((unit) => unit.isBase) ?? product.units[0];
  const unit = matchedUnit ?? fallbackUnit;

  return {
    unitName: unit?.name ?? product.reportUnitName,
    scale: Number(unit?.scale ?? 1) || 1,
  };
}

export function toReportUnitQty(baseQty: number, scale: number): number {
  return scale > 0 ? baseQty / scale : baseQty;
}

export function toReportUnitPrice(basePrice: number, scale: number): number {
  return scale > 0 ? basePrice * scale : basePrice;
}
