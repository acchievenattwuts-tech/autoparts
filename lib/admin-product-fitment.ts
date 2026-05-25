export type AdminProductFitmentInput = {
  yearStart?: number | null;
  yearEnd?: number | null;
  carModel: {
    name: string;
    carBrand: {
      name: string;
    };
  };
};

export type AdminProductFitmentSummary = {
  lines: string[];
  hiddenCount: number;
};

const MAX_VISIBLE_LINES = 2;

const formatFitmentYear = (yearStart?: number | null, yearEnd?: number | null) => {
  if (yearStart && yearEnd) return `${yearStart} - ${yearEnd}`;
  if (yearStart) return `${yearStart} - ปัจจุบัน`;
  if (yearEnd) return `ถึง ${yearEnd}`;
  return null;
};

const buildFitmentLabel = (fitment: AdminProductFitmentInput) => {
  const year = formatFitmentYear(fitment.yearStart, fitment.yearEnd);
  const parts = [fitment.carModel.carBrand.name, fitment.carModel.name];

  if (year) {
    parts.push(year);
  }

  return parts.join(" ");
};

export function buildAdminProductFitmentSummary(
  fitments: AdminProductFitmentInput[],
): AdminProductFitmentSummary {
  const uniqueLabels: string[] = [];
  const seenLabels = new Set<string>();

  for (const label of fitments
    .map(buildFitmentLabel)
    .map((item) => item.trim())
    .filter(Boolean)) {
    if (seenLabels.has(label)) {
      continue;
    }

    seenLabels.add(label);
    uniqueLabels.push(label);
  }

  return {
    lines: uniqueLabels,
    hiddenCount: Math.max(0, uniqueLabels.length - MAX_VISIBLE_LINES),
  };
}
