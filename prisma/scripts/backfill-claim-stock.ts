import { db, dbTx } from "@/lib/db";
import { getOriginalClaimUnitCost, writeClaimStockMovement } from "@/lib/claim-stock";
import {
  ClaimOutcome,
  ClaimStockMovementType,
  ClaimType,
  DocStatus,
  PurchaseReturnSettlementType,
  WarrantyClaimStatus,
} from "@/lib/generated/prisma";

const SEND_DOC_SUFFIX = "-S";
const RECEIVE_DOC_SUFFIX = "-R";

type BackfillMode = "dry-run" | "apply";

interface PlannedMovement {
  productId: string;
  movementType: ClaimStockMovementType;
  docNo: string;
  docDate: Date;
  qtyIn: number;
  qtyOut: number;
  lotNo: string;
  unitCost: number;
  detail: string;
}

interface BackfillSummary {
  mode: BackfillMode;
  claimsTotal: number;
  claimsWithExistingMovements: number;
  claimsSkippedCancelled: number;
  claimsBackfilled: number;
  movementsPlanned: number;
  movementsInserted: number;
  purchaseReturnsLinked: number;
  supplierCreditMovementsInserted: number;
  warnings: string[];
}

const getMode = (): BackfillMode => (process.argv.includes("--apply") ? "apply" : "dry-run");

const getFallbackDate = (...dates: Array<Date | null>): Date => dates.find(Boolean) ?? new Date();

async function getReceivedLotSnapshot(claimNo: string): Promise<{ lotNo: string; unitCost: number } | null> {
  const stockCard = await db.stockCard.findFirst({
    where: { docNo: `${claimNo}${RECEIVE_DOC_SUFFIX}`, source: "CLAIM_RECV_IN" },
    select: {
      priceIn: true,
      lotMovements: {
        select: {
          lotNo: true,
          unitCost: true,
          qtyIn: true,
        },
      },
    },
  });

  const lotMovement = stockCard?.lotMovements.find((lot) => Number(lot.qtyIn) > 0);
  if (lotMovement) {
    return { lotNo: lotMovement.lotNo, unitCost: Number(lotMovement.unitCost) };
  }

  if (stockCard) {
    return { lotNo: "", unitCost: Number(stockCard.priceIn) };
  }

  return null;
}

async function planClaimMovements(claimId: string): Promise<PlannedMovement[]> {
  const claim = await db.warrantyClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      claimNo: true,
      claimDate: true,
      claimType: true,
      status: true,
      outcome: true,
      sentAt: true,
      resolvedAt: true,
      warrantyId: true,
    },
  });

  if (!claim || claim.status === WarrantyClaimStatus.CANCELLED) return [];

  const originalCost = await dbTx((tx) => getOriginalClaimUnitCost(tx, claim.warrantyId));
  const sentDate = getFallbackDate(claim.sentAt, claim.claimDate);
  const resolvedDate = getFallbackDate(claim.resolvedAt, claim.sentAt, claim.claimDate);
  const receivedLot = claim.outcome === ClaimOutcome.RECEIVED ? await getReceivedLotSnapshot(claim.claimNo) : null;
  const supplierReceiveLotNo = receivedLot?.lotNo ?? originalCost.lotNo;
  const supplierReceiveUnitCost = receivedLot?.unitCost ?? originalCost.unitCost;

  const movements: PlannedMovement[] = [
    {
      productId: originalCost.productId,
      movementType: ClaimStockMovementType.CUSTOMER_RETURN_IN,
      docNo: claim.claimNo,
      docDate: claim.claimDate,
      qtyIn: 1,
      qtyOut: 0,
      lotNo: originalCost.lotNo,
      unitCost: originalCost.unitCost,
      detail: `รับคืนสินค้าเคลม ${claim.claimNo}`,
    },
  ];

  if (
    claim.status === WarrantyClaimStatus.SENT_TO_SUPPLIER ||
    claim.status === WarrantyClaimStatus.CLOSED ||
    claim.status === WarrantyClaimStatus.RETURNED_TO_CUSTOMER
  ) {
    movements.push({
      productId: originalCost.productId,
      movementType: ClaimStockMovementType.SEND_TO_SUPPLIER_OUT,
      docNo: `${claim.claimNo}${SEND_DOC_SUFFIX}`,
      docDate: sentDate,
      qtyIn: 0,
      qtyOut: 1,
      lotNo: originalCost.lotNo,
      unitCost: originalCost.unitCost,
      detail: `ส่งสินค้าเคลมไปซัพพลายเออร์ ${claim.claimNo}`,
    });
  }

  if (
    (claim.status === WarrantyClaimStatus.CLOSED || claim.status === WarrantyClaimStatus.RETURNED_TO_CUSTOMER) &&
    claim.outcome === ClaimOutcome.RECEIVED
  ) {
    movements.push(
      {
        productId: originalCost.productId,
        movementType: ClaimStockMovementType.SUPPLIER_RECEIVE_IN,
        docNo: `${claim.claimNo}${RECEIVE_DOC_SUFFIX}`,
        docDate: resolvedDate,
        qtyIn: 1,
        qtyOut: 0,
        lotNo: supplierReceiveLotNo,
        unitCost: supplierReceiveUnitCost,
        detail: `รับสินค้าทดแทนจากซัพพลายเออร์ ${claim.claimNo}`,
      },
      {
        productId: originalCost.productId,
        movementType: ClaimStockMovementType.TRANSFER_TO_NORMAL_OUT,
        docNo: `${claim.claimNo}${RECEIVE_DOC_SUFFIX}`,
        docDate: resolvedDate,
        qtyIn: 0,
        qtyOut: 1,
        lotNo: supplierReceiveLotNo,
        unitCost: supplierReceiveUnitCost,
        detail: `โอนสินค้าเคลมเข้า stock ปกติ ${claim.claimNo}`,
      },
    );
  }

  if (
    (claim.status === WarrantyClaimStatus.CLOSED || claim.status === WarrantyClaimStatus.RETURNED_TO_CUSTOMER) &&
    claim.outcome === ClaimOutcome.NO_RESOLUTION
  ) {
    movements.push({
      productId: originalCost.productId,
      movementType: ClaimStockMovementType.SUPPLIER_REJECT,
      docNo: `${claim.claimNo}${RECEIVE_DOC_SUFFIX}`,
      docDate: resolvedDate,
      qtyIn: 0,
      qtyOut: 0,
      lotNo: originalCost.lotNo,
      unitCost: originalCost.unitCost,
      detail: `ซัพพลายเออร์ไม่รับเคลม ${claim.claimNo}`,
    });
  }

  if (claim.claimType === ClaimType.REPLACE_NOW) {
    return movements;
  }

  return movements;
}

async function backfillClaimStock(summary: BackfillSummary): Promise<void> {
  const claims = await db.warrantyClaim.findMany({
    select: {
      id: true,
      claimNo: true,
      status: true,
      _count: { select: { claimStockMovements: true } },
    },
    orderBy: [{ claimDate: "asc" }, { id: "asc" }],
  });
  summary.claimsTotal = claims.length;

  for (const claim of claims) {
    if (claim.status === WarrantyClaimStatus.CANCELLED) {
      summary.claimsSkippedCancelled += 1;
      continue;
    }

    if (claim._count.claimStockMovements > 0) {
      summary.claimsWithExistingMovements += 1;
      continue;
    }

    const movements = await planClaimMovements(claim.id);
    if (movements.length === 0) continue;

    summary.claimsBackfilled += 1;
    summary.movementsPlanned += movements.length;

    if (summary.mode === "apply") {
      await dbTx(async (tx) => {
        for (const movement of movements) {
          await writeClaimStockMovement(tx, {
            claimId: claim.id,
            productId: movement.productId,
            movementType: movement.movementType,
            docNo: movement.docNo,
            docDate: movement.docDate,
            qtyIn: movement.qtyIn,
            qtyOut: movement.qtyOut,
            lotNo: movement.lotNo,
            unitCost: movement.unitCost,
            detail: movement.detail,
          });
          summary.movementsInserted += 1;
        }
      });
    }
  }
}

async function backfillPurchaseReturnLinks(summary: BackfillSummary): Promise<void> {
  const claims = await db.warrantyClaim.findMany({
    where: { status: { not: WarrantyClaimStatus.CANCELLED } },
    select: {
      id: true,
      claimNo: true,
      warrantyId: true,
      supplierId: true,
      warranty: { select: { productId: true } },
    },
  });

  for (const claim of claims) {
    const candidates = await db.purchaseReturn.findMany({
      where: {
        claimId: null,
        status: DocStatus.ACTIVE,
        note: { contains: claim.claimNo },
        ...(claim.supplierId ? { supplierId: claim.supplierId } : {}),
      },
      select: {
        id: true,
        returnNo: true,
        returnDate: true,
        settlementType: true,
      },
    });

    if (candidates.length > 1) {
      summary.warnings.push(`ใบเคลม ${claim.claimNo} พบ CN purchase ที่ note อ้างอิงมากกว่า 1 ใบ จึงไม่ auto-link`);
      continue;
    }

    const purchaseReturn = candidates[0];
    if (!purchaseReturn) continue;

    const existingMovement = await db.claimStockMovement.findFirst({
      where: {
        claimId: claim.id,
        purchaseReturnId: purchaseReturn.id,
        movementType: ClaimStockMovementType.SUPPLIER_CREDIT_SETTLE,
      },
      select: { id: true },
    });

    if (summary.mode === "apply") {
      await dbTx(async (tx) => {
        await tx.purchaseReturn.update({
          where: { id: purchaseReturn.id },
          data: { claimId: claim.id },
        });

        if (!existingMovement && purchaseReturn.settlementType === PurchaseReturnSettlementType.SUPPLIER_CREDIT) {
          const originalCost = await getOriginalClaimUnitCost(tx, claim.warrantyId);
          await writeClaimStockMovement(tx, {
            claimId: claim.id,
            productId: claim.warranty.productId,
            movementType: ClaimStockMovementType.SUPPLIER_CREDIT_SETTLE,
            docNo: purchaseReturn.returnNo,
            docDate: purchaseReturn.returnDate,
            qtyIn: 0,
            qtyOut: 0,
            lotNo: originalCost.lotNo,
            unitCost: originalCost.unitCost,
            purchaseReturnId: purchaseReturn.id,
            detail: `ผูกใบลดหนี้ซื้อกับใบเคลม ${claim.claimNo}`,
          });
          summary.supplierCreditMovementsInserted += 1;
        }
      });
    }

    summary.purchaseReturnsLinked += 1;
  }
}

async function main(): Promise<void> {
  const summary: BackfillSummary = {
    mode: getMode(),
    claimsTotal: 0,
    claimsWithExistingMovements: 0,
    claimsSkippedCancelled: 0,
    claimsBackfilled: 0,
    movementsPlanned: 0,
    movementsInserted: 0,
    purchaseReturnsLinked: 0,
    supplierCreditMovementsInserted: 0,
    warnings: [],
  };

  await backfillClaimStock(summary);
  await backfillPurchaseReturnLinks(summary);

  console.log(JSON.stringify(summary, null, 2));
  if (summary.mode === "dry-run") {
    console.log("Dry-run only. Run with --apply to write production data.");
  }
}

main()
  .catch((error) => {
    console.error("[backfill-claim-stock]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
