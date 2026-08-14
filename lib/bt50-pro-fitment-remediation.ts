export type Bt50ProAuditFitment = {
  id: string;
  carModelId: string;
  carBrandName: string;
  carModelName: string;
  submodel: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  engineCode: string | null;
  engineSize: string | null;
  fitmentType: string;
  note: string | null;
};

export type Bt50ProAuditProduct = {
  id: string;
  code: string;
  name: string;
  aliases: string[];
  fitments: Bt50ProAuditFitment[];
};

export type Bt50ProRemediationCandidate = {
  productId: string;
  productCode: string;
  productName: string;
  source: Bt50ProAuditFitment;
};

const normalize = (value: string | null | undefined): string =>
  value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() ?? "";

const BT50_PRO_EVIDENCE_RE = /\bbt[\s-]*50\s*pro\b/i;

export function hasExplicitBt50ProProductEvidence(product: Bt50ProAuditProduct): boolean {
  return [product.name, ...product.aliases].some((value) => BT50_PRO_EVIDENCE_RE.test(value));
}

/**
 * Only an existing Mazda BT-50 fitment whose submodel is exactly "Pro" may be
 * copied to the dedicated BT-50 Pro master. Notes that merely say "รุ่นเทียบ"
 * and broad BT-50 rows are intentionally excluded for manual review.
 */
export function selectBt50ProRemediationCandidates(
  products: Bt50ProAuditProduct[],
): Bt50ProRemediationCandidate[] {
  const candidates: Bt50ProRemediationCandidate[] = [];

  for (const product of products) {
    if (!hasExplicitBt50ProProductEvidence(product)) continue;
    const alreadyHasTarget = product.fitments.some(
      (fitment) =>
        normalize(fitment.carBrandName) === "mazda" &&
        normalize(fitment.carModelName) === "bt-50 pro",
    );
    if (alreadyHasTarget) continue;

    for (const fitment of product.fitments) {
      const isConfirmedLegacyShape =
        normalize(fitment.carBrandName) === "mazda" &&
        normalize(fitment.carModelName) === "bt-50" &&
        normalize(fitment.submodel) === "pro";
      if (!isConfirmedLegacyShape) continue;
      candidates.push({
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        source: fitment,
      });
    }
  }

  return candidates;
}
